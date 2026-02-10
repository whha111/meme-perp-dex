package blockchain

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// LendingPool contract ABI (minimal — only what the keeper needs)
const lendingPoolABI = `[
	{
		"inputs": [{"internalType": "address", "name": "token", "type": "address"}, {"internalType": "address", "name": "user", "type": "address"}],
		"name": "getUserBorrow",
		"outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "token", "type": "address"}],
		"name": "getUtilization",
		"outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "token", "type": "address"}],
		"name": "getAvailableLiquidity",
		"outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "token", "type": "address"}],
		"name": "isTokenEnabled",
		"outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "token", "type": "address"}, {"internalType": "address", "name": "borrower", "type": "address"}],
		"name": "liquidateBorrow",
		"outputs": [{"internalType": "uint256", "name": "seized", "type": "uint256"}],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "getEnabledTokens",
		"outputs": [{"internalType": "address[]", "name": "", "type": "address[]"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

// LendingPoolContract wraps the LendingPool contract for Go keeper
type LendingPoolContract struct {
	address common.Address
	abi     abi.ABI
	client  *Client
}

// NewLendingPoolContract creates a new LendingPool contract instance
func NewLendingPoolContract(address common.Address, client *Client) (*LendingPoolContract, error) {
	parsedABI, err := abi.JSON(strings.NewReader(lendingPoolABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse LendingPool ABI: %w", err)
	}

	return &LendingPoolContract{
		address: address,
		abi:     parsedABI,
		client:  client,
	}, nil
}

// IsTokenEnabled checks if a token has lending enabled
func (c *LendingPoolContract) IsTokenEnabled(ctx context.Context, token common.Address) (bool, error) {
	data, err := c.abi.Pack("isTokenEnabled", token)
	if err != nil {
		return false, fmt.Errorf("failed to pack isTokenEnabled: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return false, fmt.Errorf("failed to call isTokenEnabled: %w", err)
	}

	var enabled bool
	err = c.abi.UnpackIntoInterface(&enabled, "isTokenEnabled", result)
	if err != nil {
		return false, fmt.Errorf("failed to unpack isTokenEnabled: %w", err)
	}

	return enabled, nil
}

// GetUtilization returns pool utilization for a token (in BPS, 10000 = 100%)
func (c *LendingPoolContract) GetUtilization(ctx context.Context, token common.Address) (*big.Int, error) {
	data, err := c.abi.Pack("getUtilization", token)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getUtilization: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getUtilization: %w", err)
	}

	var utilization *big.Int
	err = c.abi.UnpackIntoInterface(&utilization, "getUtilization", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getUtilization: %w", err)
	}

	return utilization, nil
}

// GetUserBorrow returns total borrow amount for a user on a token
func (c *LendingPoolContract) GetUserBorrow(ctx context.Context, token, user common.Address) (*big.Int, error) {
	data, err := c.abi.Pack("getUserBorrow", token, user)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getUserBorrow: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getUserBorrow: %w", err)
	}

	var borrowAmount *big.Int
	err = c.abi.UnpackIntoInterface(&borrowAmount, "getUserBorrow", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getUserBorrow: %w", err)
	}

	return borrowAmount, nil
}

// GetAvailableLiquidity returns available liquidity for a token
func (c *LendingPoolContract) GetAvailableLiquidity(ctx context.Context, token common.Address) (*big.Int, error) {
	data, err := c.abi.Pack("getAvailableLiquidity", token)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getAvailableLiquidity: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getAvailableLiquidity: %w", err)
	}

	var liquidity *big.Int
	err = c.abi.UnpackIntoInterface(&liquidity, "getAvailableLiquidity", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getAvailableLiquidity: %w", err)
	}

	return liquidity, nil
}

// GetEnabledTokens returns list of tokens with lending enabled
func (c *LendingPoolContract) GetEnabledTokens(ctx context.Context) ([]common.Address, error) {
	data, err := c.abi.Pack("getEnabledTokens")
	if err != nil {
		return nil, fmt.Errorf("failed to pack getEnabledTokens: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getEnabledTokens: %w", err)
	}

	values, err := c.abi.Unpack("getEnabledTokens", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getEnabledTokens: %w", err)
	}

	if len(values) == 0 {
		return nil, nil
	}

	tokens, ok := values[0].([]common.Address)
	if !ok {
		return nil, fmt.Errorf("unexpected type for getEnabledTokens result")
	}

	return tokens, nil
}

// LiquidateBorrow executes a lending liquidation on-chain
func (c *LendingPoolContract) LiquidateBorrow(ctx context.Context, token, borrower common.Address) (*types.Transaction, error) {
	auth, err := c.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}

	data, err := c.abi.Pack("liquidateBorrow", token, borrower)
	if err != nil {
		return nil, fmt.Errorf("failed to pack liquidateBorrow: %w", err)
	}

	// Estimate gas
	gasLimit, err := c.client.GetClient().EstimateGas(ctx, ethereum.CallMsg{
		From: c.client.GetAddress(),
		To:   &c.address,
		Data: data,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to estimate gas: %w", err)
	}

	// Add 20% buffer
	auth.GasLimit = gasLimit * 120 / 100

	tx := types.NewTransaction(
		auth.Nonce.Uint64(),
		c.address,
		big.NewInt(0),
		auth.GasLimit,
		auth.GasPrice,
		data,
	)

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(c.client.chainID), c.client.privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign transaction: %w", err)
	}

	err = c.client.GetClient().SendTransaction(ctx, signedTx)
	if err != nil {
		c.client.ResetNonce(ctx)
		return nil, fmt.Errorf("failed to send transaction: %w", err)
	}

	return signedTx, nil
}
