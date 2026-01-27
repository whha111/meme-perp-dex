package blockchain

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// Settlement contract ABI (only the functions we need)
const settlementABI = `[
	{
		"name": "depositETHFor",
		"type": "function",
		"stateMutability": "payable",
		"inputs": [
			{"name": "user", "type": "address"},
			{"name": "deadline", "type": "uint256"},
			{"name": "signature", "type": "bytes"}
		],
		"outputs": []
	},
	{
		"name": "depositFor",
		"type": "function",
		"stateMutability": "nonpayable",
		"inputs": [
			{"name": "user", "type": "address"},
			{"name": "token", "type": "address"},
			{"name": "amount", "type": "uint256"},
			{"name": "deadline", "type": "uint256"},
			{"name": "signature", "type": "bytes"}
		],
		"outputs": []
	},
	{
		"name": "withdrawFor",
		"type": "function",
		"stateMutability": "nonpayable",
		"inputs": [
			{"name": "user", "type": "address"},
			{"name": "token", "type": "address"},
			{"name": "amount", "type": "uint256"},
			{"name": "deadline", "type": "uint256"},
			{"name": "signature", "type": "bytes"}
		],
		"outputs": []
	},
	{
		"name": "getMetaTxNonce",
		"type": "function",
		"stateMutability": "view",
		"inputs": [{"name": "user", "type": "address"}],
		"outputs": [{"name": "", "type": "uint256"}]
	},
	{
		"name": "getUserBalance",
		"type": "function",
		"stateMutability": "view",
		"inputs": [{"name": "user", "type": "address"}],
		"outputs": [
			{"name": "available", "type": "uint256"},
			{"name": "locked", "type": "uint256"}
		]
	},
	{
		"name": "weth",
		"type": "function",
		"stateMutability": "view",
		"inputs": [],
		"outputs": [{"name": "", "type": "address"}]
	}
]`

// SettlementContract wraps the Settlement contract
type SettlementContract struct {
	address  common.Address
	abi      abi.ABI
	client   *Client
	contract *bind.BoundContract
}

// NewSettlementContract creates a new Settlement contract instance
func NewSettlementContract(address common.Address, client *Client) (*SettlementContract, error) {
	parsed, err := abi.JSON(strings.NewReader(settlementABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse ABI: %w", err)
	}

	contract := bind.NewBoundContract(address, parsed, client.GetClient(), client.GetClient(), client.GetClient())

	return &SettlementContract{
		address:  address,
		abi:      parsed,
		client:   client,
		contract: contract,
	}, nil
}

// DepositETHFor deposits ETH for a user (relayer pays gas)
func (s *SettlementContract) DepositETHFor(ctx context.Context, user common.Address, amount *big.Int, deadline *big.Int, signature []byte) (*types.Transaction, error) {
	opts, err := s.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}
	opts.Value = amount

	tx, err := s.contract.Transact(opts, "depositETHFor", user, deadline, signature)
	if err != nil {
		return nil, fmt.Errorf("failed to call depositETHFor: %w", err)
	}

	return tx, nil
}

// DepositFor deposits ERC20 tokens for a user (relayer pays gas)
func (s *SettlementContract) DepositFor(ctx context.Context, user common.Address, token common.Address, amount *big.Int, deadline *big.Int, signature []byte) (*types.Transaction, error) {
	opts, err := s.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}

	tx, err := s.contract.Transact(opts, "depositFor", user, token, amount, deadline, signature)
	if err != nil {
		return nil, fmt.Errorf("failed to call depositFor: %w", err)
	}

	return tx, nil
}

// WithdrawFor withdraws for a user (relayer pays gas)
func (s *SettlementContract) WithdrawFor(ctx context.Context, user common.Address, token common.Address, amount *big.Int, deadline *big.Int, signature []byte) (*types.Transaction, error) {
	opts, err := s.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}

	tx, err := s.contract.Transact(opts, "withdrawFor", user, token, amount, deadline, signature)
	if err != nil {
		return nil, fmt.Errorf("failed to call withdrawFor: %w", err)
	}

	return tx, nil
}

// GetMetaTxNonce gets the meta transaction nonce for a user
func (s *SettlementContract) GetMetaTxNonce(ctx context.Context, user common.Address) (*big.Int, error) {
	var result []interface{}
	err := s.contract.Call(&bind.CallOpts{Context: ctx}, &result, "getMetaTxNonce", user)
	if err != nil {
		return nil, fmt.Errorf("failed to call getMetaTxNonce: %w", err)
	}
	if len(result) == 0 {
		return big.NewInt(0), nil
	}
	return result[0].(*big.Int), nil
}

// GetUserBalance gets the user's balance in the Settlement contract
func (s *SettlementContract) GetUserBalance(ctx context.Context, user common.Address) (available *big.Int, locked *big.Int, err error) {
	var result []interface{}
	err = s.contract.Call(&bind.CallOpts{Context: ctx}, &result, "getUserBalance", user)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to call getUserBalance: %w", err)
	}
	if len(result) < 2 {
		return big.NewInt(0), big.NewInt(0), nil
	}
	return result[0].(*big.Int), result[1].(*big.Int), nil
}

// GetWETH gets the WETH address configured in the contract
func (s *SettlementContract) GetWETH(ctx context.Context) (common.Address, error) {
	var result []interface{}
	err := s.contract.Call(&bind.CallOpts{Context: ctx}, &result, "weth")
	if err != nil {
		return common.Address{}, fmt.Errorf("failed to call weth: %w", err)
	}
	if len(result) == 0 {
		return common.Address{}, nil
	}
	return result[0].(common.Address), nil
}

// GetAddress returns the contract address
func (s *SettlementContract) GetAddress() common.Address {
	return s.address
}
