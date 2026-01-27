package service

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/blockchain"
	"github.com/memeperp/backend/internal/pkg/config"
)

// RelayerService handles meta transactions (gasless deposits/withdrawals)
type RelayerService struct {
	ethClient  *blockchain.Client
	settlement *blockchain.SettlementContract
	logger     *zap.Logger
	cfg        *config.BlockchainConfig
}

// DepositETHRequest represents a request to deposit ETH
type DepositETHRequest struct {
	User      string `json:"user"`      // User's trading wallet address
	Amount    string `json:"amount"`    // Amount in wei
	Deadline  int64  `json:"deadline"`  // Unix timestamp
	Signature string `json:"signature"` // EIP-712 signature (hex)
}

// DepositRequest represents a request to deposit ERC20
type DepositRequest struct {
	User      string `json:"user"`      // User's trading wallet address
	Token     string `json:"token"`     // Token address
	Amount    string `json:"amount"`    // Amount in token's smallest unit
	Deadline  int64  `json:"deadline"`  // Unix timestamp
	Signature string `json:"signature"` // EIP-712 signature (hex)
}

// WithdrawRequest represents a request to withdraw
type WithdrawRequest struct {
	User      string `json:"user"`      // User's trading wallet address
	Token     string `json:"token"`     // Token address
	Amount    string `json:"amount"`    // Amount in token's smallest unit
	Deadline  int64  `json:"deadline"`  // Unix timestamp
	Signature string `json:"signature"` // EIP-712 signature (hex)
}

// RelayResult represents the result of a relay operation
type RelayResult struct {
	Success bool   `json:"success"`
	TxHash  string `json:"txHash,omitempty"`
	Error   string `json:"error,omitempty"`
}

// NewRelayerService creates a new relayer service
func NewRelayerService(cfg *config.BlockchainConfig, logger *zap.Logger) (*RelayerService, error) {
	// Initialize Ethereum client
	ethClient, err := blockchain.NewClient(cfg, nil, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to create eth client: %w", err)
	}

	// Initialize Settlement contract
	if cfg.SettlementAddr == "" {
		return nil, fmt.Errorf("settlement address not configured")
	}

	settlement, err := blockchain.NewSettlementContract(
		common.HexToAddress(cfg.SettlementAddr),
		ethClient,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create settlement contract: %w", err)
	}

	logger.Info("Relayer service initialized",
		zap.String("relayerAddress", ethClient.GetAddress().Hex()),
		zap.String("settlementAddress", cfg.SettlementAddr))

	return &RelayerService{
		ethClient:  ethClient,
		settlement: settlement,
		logger:     logger,
		cfg:        cfg,
	}, nil
}

// DepositETH deposits ETH for a user (relayer pays gas, sends ETH)
func (s *RelayerService) DepositETH(ctx context.Context, req *DepositETHRequest) (*RelayResult, error) {
	s.logger.Info("Processing ETH deposit relay",
		zap.String("user", req.User),
		zap.String("amount", req.Amount))

	// Parse parameters
	user := common.HexToAddress(req.User)
	amount, ok := new(big.Int).SetString(req.Amount, 10)
	if !ok {
		return &RelayResult{Success: false, Error: "invalid amount"}, nil
	}
	deadline := big.NewInt(req.Deadline)
	signature := common.FromHex(req.Signature)

	// Check if deadline has passed
	if time.Now().Unix() > req.Deadline {
		return &RelayResult{Success: false, Error: "signature expired"}, nil
	}

	// Check relayer has enough ETH
	relayerBalance, err := s.ethClient.GetBalance(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get relayer balance: %w", err)
	}

	// Need amount + gas buffer (0.01 ETH)
	gasBuffer := big.NewInt(10000000000000000) // 0.01 ETH
	required := new(big.Int).Add(amount, gasBuffer)
	if relayerBalance.Cmp(required) < 0 {
		return &RelayResult{Success: false, Error: "relayer insufficient balance"}, nil
	}

	// Execute deposit
	tx, err := s.settlement.DepositETHFor(ctx, user, amount, deadline, signature)
	if err != nil {
		s.logger.Error("Failed to deposit ETH",
			zap.String("user", req.User),
			zap.Error(err))
		return &RelayResult{Success: false, Error: err.Error()}, nil
	}

	s.logger.Info("ETH deposit transaction sent",
		zap.String("txHash", tx.Hash().Hex()),
		zap.String("user", req.User),
		zap.String("amount", req.Amount))

	// Wait for confirmation
	receipt, err := s.ethClient.WaitForTransaction(ctx, tx)
	if err != nil {
		s.logger.Error("ETH deposit transaction failed",
			zap.String("txHash", tx.Hash().Hex()),
			zap.Error(err))
		return &RelayResult{Success: false, TxHash: tx.Hash().Hex(), Error: err.Error()}, nil
	}

	s.logger.Info("ETH deposit confirmed",
		zap.String("txHash", tx.Hash().Hex()),
		zap.Uint64("gasUsed", receipt.GasUsed))

	return &RelayResult{
		Success: true,
		TxHash:  tx.Hash().Hex(),
	}, nil
}

// Withdraw withdraws for a user (relayer pays gas)
func (s *RelayerService) Withdraw(ctx context.Context, req *WithdrawRequest) (*RelayResult, error) {
	s.logger.Info("Processing withdrawal relay",
		zap.String("user", req.User),
		zap.String("token", req.Token),
		zap.String("amount", req.Amount))

	// Parse parameters
	user := common.HexToAddress(req.User)
	token := common.HexToAddress(req.Token)
	amount, ok := new(big.Int).SetString(req.Amount, 10)
	if !ok {
		return &RelayResult{Success: false, Error: "invalid amount"}, nil
	}
	deadline := big.NewInt(req.Deadline)
	signature := common.FromHex(req.Signature)

	// Check if deadline has passed
	if time.Now().Unix() > req.Deadline {
		return &RelayResult{Success: false, Error: "signature expired"}, nil
	}

	// Execute withdrawal
	tx, err := s.settlement.WithdrawFor(ctx, user, token, amount, deadline, signature)
	if err != nil {
		s.logger.Error("Failed to withdraw",
			zap.String("user", req.User),
			zap.Error(err))
		return &RelayResult{Success: false, Error: err.Error()}, nil
	}

	s.logger.Info("Withdrawal transaction sent",
		zap.String("txHash", tx.Hash().Hex()),
		zap.String("user", req.User),
		zap.String("amount", req.Amount))

	// Wait for confirmation
	receipt, err := s.ethClient.WaitForTransaction(ctx, tx)
	if err != nil {
		s.logger.Error("Withdrawal transaction failed",
			zap.String("txHash", tx.Hash().Hex()),
			zap.Error(err))
		return &RelayResult{Success: false, TxHash: tx.Hash().Hex(), Error: err.Error()}, nil
	}

	s.logger.Info("Withdrawal confirmed",
		zap.String("txHash", tx.Hash().Hex()),
		zap.Uint64("gasUsed", receipt.GasUsed))

	return &RelayResult{
		Success: true,
		TxHash:  tx.Hash().Hex(),
	}, nil
}

// GetMetaTxNonce gets the meta transaction nonce for a user
func (s *RelayerService) GetMetaTxNonce(ctx context.Context, user string) (*big.Int, error) {
	return s.settlement.GetMetaTxNonce(ctx, common.HexToAddress(user))
}

// GetUserBalance gets the user's balance in the Settlement contract
func (s *RelayerService) GetUserBalance(ctx context.Context, user string) (available *big.Int, locked *big.Int, err error) {
	return s.settlement.GetUserBalance(ctx, common.HexToAddress(user))
}

// GetRelayerBalance gets the relayer's ETH balance
func (s *RelayerService) GetRelayerBalance(ctx context.Context) (*big.Int, error) {
	return s.ethClient.GetBalance(ctx)
}

// GetWETHAddress gets the WETH address from the contract
func (s *RelayerService) GetWETHAddress(ctx context.Context) (string, error) {
	addr, err := s.settlement.GetWETH(ctx)
	if err != nil {
		return "", err
	}
	return addr.Hex(), nil
}

// Close closes the relayer service
func (s *RelayerService) Close() {
	if s.ethClient != nil {
		s.ethClient.Close()
	}
}
