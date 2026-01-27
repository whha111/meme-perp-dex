package blockchain

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/nonce"
)

// Client wraps an Ethereum client with transaction signing capabilities
type Client struct {
	client       *ethclient.Client
	chainID      *big.Int
	privateKey   *ecdsa.PrivateKey
	address      common.Address
	logger       *zap.Logger
	nonceManager *nonce.Manager // Unified nonce management via Redis
}

// NewClient creates a new Ethereum client
func NewClient(cfg *config.BlockchainConfig, nonceManager *nonce.Manager, logger *zap.Logger) (*Client, error) {
	// Connect to Ethereum node
	client, err := ethclient.Dial(cfg.RPCURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Ethereum node: %w", err)
	}

	// Verify chain ID
	chainID, err := client.ChainID(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get chain ID: %w", err)
	}

	if chainID.Int64() != cfg.ChainID {
		return nil, fmt.Errorf("chain ID mismatch: expected %d, got %d", cfg.ChainID, chainID.Int64())
	}

	// Parse private key
	if cfg.PrivateKey == "" {
		return nil, fmt.Errorf("private key not configured")
	}

	privateKey, err := crypto.HexToECDSA(cfg.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	// Derive address from private key
	publicKey := privateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("failed to derive public key")
	}
	address := crypto.PubkeyToAddress(*publicKeyECDSA)

	logger.Info("Ethereum client initialized",
		zap.String("rpcUrl", cfg.RPCURL),
		zap.Int64("chainId", cfg.ChainID),
		zap.String("keeperAddress", address.Hex()))

	// Sync nonce from chain on startup
	if nonceManager != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		currentNonce, err := nonceManager.SyncTransactionNonceFromChain(ctx, address)
		if err != nil {
			logger.Warn("Failed to sync nonce from chain on startup", zap.Error(err))
		} else {
			logger.Info("Transaction nonce synced from chain",
				zap.Uint64("nonce", currentNonce))
		}
	}

	return &Client{
		client:       client,
		chainID:      chainID,
		privateKey:   privateKey,
		address:      address,
		logger:       logger,
		nonceManager: nonceManager,
	}, nil
}

// GetTransactOpts returns transaction options for sending transactions
func (c *Client) GetTransactOpts(ctx context.Context) (*bind.TransactOpts, error) {
	// Get nonce from unified nonce manager
	var nonce uint64
	var err error

	if c.nonceManager != nil {
		// Use Redis-based nonce manager (production-grade)
		nonce, err = c.nonceManager.GetNextTransactionNonce(ctx, c.address)
		if err != nil {
			c.logger.Error("Failed to get nonce from manager, falling back to chain", zap.Error(err))
			// Fallback to chain
			nonce, err = c.client.PendingNonceAt(ctx, c.address)
			if err != nil {
				return nil, fmt.Errorf("failed to get nonce: %w", err)
			}
		}
	} else {
		// Fallback if nonce manager not initialized
		nonce, err = c.client.PendingNonceAt(ctx, c.address)
		if err != nil {
			return nil, fmt.Errorf("failed to get nonce: %w", err)
		}
	}

	// Get gas price
	gasPrice, err := c.client.SuggestGasPrice(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get gas price: %w", err)
	}

	// Add 20% buffer to gas price for faster inclusion
	gasPrice = new(big.Int).Mul(gasPrice, big.NewInt(120))
	gasPrice = new(big.Int).Div(gasPrice, big.NewInt(100))

	auth, err := bind.NewKeyedTransactorWithChainID(c.privateKey, c.chainID)
	if err != nil {
		return nil, fmt.Errorf("failed to create transactor: %w", err)
	}

	auth.Nonce = big.NewInt(int64(nonce))
	auth.GasPrice = gasPrice
	auth.GasLimit = uint64(500000) // Default gas limit, will be estimated
	auth.Context = ctx

	c.logger.Debug("Created transaction options",
		zap.Uint64("nonce", nonce),
		zap.String("gasPrice", gasPrice.String()))

	return auth, nil
}

// WaitForTransaction waits for a transaction to be mined
func (c *Client) WaitForTransaction(ctx context.Context, tx *types.Transaction) (*types.Receipt, error) {
	c.logger.Info("Waiting for transaction",
		zap.String("txHash", tx.Hash().Hex()))

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	receipt, err := bind.WaitMined(ctx, c.client, tx)
	if err != nil {
		return nil, fmt.Errorf("failed to wait for transaction: %w", err)
	}

	if receipt.Status == types.ReceiptStatusFailed {
		return receipt, fmt.Errorf("transaction failed: %s", tx.Hash().Hex())
	}

	c.logger.Info("Transaction confirmed",
		zap.String("txHash", tx.Hash().Hex()),
		zap.Uint64("blockNumber", receipt.BlockNumber.Uint64()),
		zap.Uint64("gasUsed", receipt.GasUsed))

	return receipt, nil
}

// ResetNonce resets the nonce counter and syncs from chain (useful after transaction failures)
func (c *Client) ResetNonce(ctx context.Context) error {
	if c.nonceManager != nil {
		_, err := c.nonceManager.ResetTransactionNonce(ctx, c.address)
		if err != nil {
			return fmt.Errorf("failed to reset nonce: %w", err)
		}
		c.logger.Info("Nonce reset and synced from chain")
		return nil
	}

	// If no nonce manager, just log a warning
	c.logger.Warn("Nonce manager not available, cannot reset nonce")
	return nil
}

// GetAddress returns the keeper's address
func (c *Client) GetAddress() common.Address {
	return c.address
}

// GetClient returns the underlying ethclient
func (c *Client) GetClient() *ethclient.Client {
	return c.client
}

// GetBalance returns the keeper's ETH balance
func (c *Client) GetBalance(ctx context.Context) (*big.Int, error) {
	return c.client.BalanceAt(ctx, c.address, nil)
}

// Close closes the Ethereum client connection
func (c *Client) Close() {
	c.client.Close()
}

// HexToAddress converts a hex string to an Ethereum address
func HexToAddress(hex string) common.Address {
	return common.HexToAddress(hex)
}
