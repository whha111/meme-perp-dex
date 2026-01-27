package blockchain

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// Liquidation contract ABI (minimal for liquidate function)
const liquidationABI = `[
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}],
		"name": "liquidate",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}],
		"name": "canLiquidate",
		"outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}],
		"name": "getUserPnL",
		"outputs": [{"internalType": "int256", "name": "pnl", "type": "int256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address[]", "name": "users", "type": "address[]"}],
		"name": "getUsersPnL",
		"outputs": [{"internalType": "int256[]", "name": "pnls", "type": "int256[]"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "getADLQueueLength",
		"outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "uint256", "name": "start", "type": "uint256"}, {"internalType": "uint256", "name": "count", "type": "uint256"}],
		"name": "getADLQueueUsers",
		"outputs": [{"internalType": "address[]", "name": "users", "type": "address[]"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address[]", "name": "sortedUsers", "type": "address[]"}, {"internalType": "bool", "name": "targetSide", "type": "bool"}, {"internalType": "uint256", "name": "targetAmount", "type": "uint256"}],
		"name": "executeADLWithSortedUsers",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}, {"internalType": "address", "name": "token", "type": "address"}],
		"name": "liquidateToken",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}, {"internalType": "address", "name": "token", "type": "address"}],
		"name": "canLiquidateToken",
		"outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}, {"internalType": "address", "name": "token", "type": "address"}],
		"name": "getUserPnLToken",
		"outputs": [{"internalType": "int256", "name": "", "type": "int256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address[]", "name": "users", "type": "address[]"}, {"internalType": "address", "name": "token", "type": "address"}],
		"name": "getLiquidatableTokenUsers",
		"outputs": [{"internalType": "address[]", "name": "", "type": "address[]"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

// FundingRate contract ABI (minimal for settleFunding function)
const fundingRateABI = `[
	{
		"inputs": [],
		"name": "settleFunding",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "getLastFundingTime",
		"outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "getCurrentFundingRate",
		"outputs": [{"internalType": "int256", "name": "", "type": "int256"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

// PositionManager contract ABI (for position queries)
const positionManagerABI = `[
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}],
		"name": "getPosition",
		"outputs": [
			{
				"components": [
					{"internalType": "bool", "name": "isLong", "type": "bool"},
					{"internalType": "uint256", "name": "size", "type": "uint256"},
					{"internalType": "uint256", "name": "collateral", "type": "uint256"},
					{"internalType": "uint256", "name": "entryPrice", "type": "uint256"},
					{"internalType": "uint256", "name": "leverage", "type": "uint256"},
					{"internalType": "uint256", "name": "lastFundingTime", "type": "uint256"},
					{"internalType": "int256", "name": "accFundingFee", "type": "int256"}
				],
				"internalType": "struct IPositionManager.Position",
				"name": "",
				"type": "tuple"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "address", "name": "user", "type": "address"}],
		"name": "canLiquidate",
		"outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

// PriceFeed contract ABI
const priceFeedABI = `[
	{
		"inputs": [],
		"name": "getMarkPrice",
		"outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "uint256", "name": "price", "type": "uint256"}],
		"name": "setMarkPrice",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	}
]`

// LiquidationContract wraps the Liquidation contract
type LiquidationContract struct {
	address common.Address
	abi     abi.ABI
	client  *Client
}

// NewLiquidationContract creates a new Liquidation contract instance
func NewLiquidationContract(address common.Address, client *Client) (*LiquidationContract, error) {
	parsedABI, err := abi.JSON(strings.NewReader(liquidationABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse Liquidation ABI: %w", err)
	}

	return &LiquidationContract{
		address: address,
		abi:     parsedABI,
		client:  client,
	}, nil
}

// CanLiquidate checks if a position can be liquidated
func (c *LiquidationContract) CanLiquidate(ctx context.Context, user common.Address) (bool, error) {
	data, err := c.abi.Pack("canLiquidate", user)
	if err != nil {
		return false, fmt.Errorf("failed to pack canLiquidate: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return false, fmt.Errorf("failed to call canLiquidate: %w", err)
	}

	var canLiq bool
	err = c.abi.UnpackIntoInterface(&canLiq, "canLiquidate", result)
	if err != nil {
		return false, fmt.Errorf("failed to unpack canLiquidate: %w", err)
	}

	return canLiq, nil
}

// Liquidate executes a liquidation on-chain
func (c *LiquidationContract) Liquidate(ctx context.Context, user common.Address) (*types.Transaction, error) {
	auth, err := c.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}

	data, err := c.abi.Pack("liquidate", user)
	if err != nil {
		return nil, fmt.Errorf("failed to pack liquidate: %w", err)
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

// GetUserPnL returns the current PnL for a user
func (c *LiquidationContract) GetUserPnL(ctx context.Context, user common.Address) (*big.Int, error) {
	data, err := c.abi.Pack("getUserPnL", user)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getUserPnL: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getUserPnL: %w", err)
	}

	var pnl *big.Int
	err = c.abi.UnpackIntoInterface(&pnl, "getUserPnL", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getUserPnL: %w", err)
	}

	return pnl, nil
}

// GetUsersPnL returns the current PnL for multiple users
func (c *LiquidationContract) GetUsersPnL(ctx context.Context, users []common.Address) ([]*big.Int, error) {
	data, err := c.abi.Pack("getUsersPnL", users)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getUsersPnL: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getUsersPnL: %w", err)
	}

	var pnls []*big.Int
	err = c.abi.UnpackIntoInterface(&pnls, "getUsersPnL", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getUsersPnL: %w", err)
	}

	return pnls, nil
}

// GetADLQueueLength returns the length of the ADL queue
func (c *LiquidationContract) GetADLQueueLength(ctx context.Context) (*big.Int, error) {
	data, err := c.abi.Pack("getADLQueueLength")
	if err != nil {
		return nil, fmt.Errorf("failed to pack getADLQueueLength: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getADLQueueLength: %w", err)
	}

	var length *big.Int
	err = c.abi.UnpackIntoInterface(&length, "getADLQueueLength", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getADLQueueLength: %w", err)
	}

	return length, nil
}

// GetADLQueueUsers returns users in the ADL queue
func (c *LiquidationContract) GetADLQueueUsers(ctx context.Context, start, count *big.Int) ([]common.Address, error) {
	data, err := c.abi.Pack("getADLQueueUsers", start, count)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getADLQueueUsers: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getADLQueueUsers: %w", err)
	}

	var users []common.Address
	err = c.abi.UnpackIntoInterface(&users, "getADLQueueUsers", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getADLQueueUsers: %w", err)
	}

	return users, nil
}

// ExecuteADLWithSortedUsers executes ADL with a pre-sorted list of users
func (c *LiquidationContract) ExecuteADLWithSortedUsers(ctx context.Context, sortedUsers []common.Address, targetSide bool, targetAmount *big.Int) (*types.Transaction, error) {
	auth, err := c.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}

	data, err := c.abi.Pack("executeADLWithSortedUsers", sortedUsers, targetSide, targetAmount)
	if err != nil {
		return nil, fmt.Errorf("failed to pack executeADLWithSortedUsers: %w", err)
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

	// Add 30% buffer for ADL (more complex operation)
	auth.GasLimit = gasLimit * 130 / 100

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

// ============================================================
// C-07: Multi-token liquidation functions
// ============================================================

// CanLiquidateToken checks if a token position can be liquidated
func (c *LiquidationContract) CanLiquidateToken(ctx context.Context, user, token common.Address) (bool, error) {
	data, err := c.abi.Pack("canLiquidateToken", user, token)
	if err != nil {
		return false, fmt.Errorf("failed to pack canLiquidateToken: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return false, fmt.Errorf("failed to call canLiquidateToken: %w", err)
	}

	var canLiq bool
	err = c.abi.UnpackIntoInterface(&canLiq, "canLiquidateToken", result)
	if err != nil {
		return false, fmt.Errorf("failed to unpack canLiquidateToken: %w", err)
	}

	return canLiq, nil
}

// LiquidateToken executes a token position liquidation on-chain
func (c *LiquidationContract) LiquidateToken(ctx context.Context, user, token common.Address) (*types.Transaction, error) {
	auth, err := c.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}

	data, err := c.abi.Pack("liquidateToken", user, token)
	if err != nil {
		return nil, fmt.Errorf("failed to pack liquidateToken: %w", err)
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

// GetUserPnLToken returns the current PnL for a user's token position
func (c *LiquidationContract) GetUserPnLToken(ctx context.Context, user, token common.Address) (*big.Int, error) {
	data, err := c.abi.Pack("getUserPnLToken", user, token)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getUserPnLToken: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getUserPnLToken: %w", err)
	}

	var pnl *big.Int
	err = c.abi.UnpackIntoInterface(&pnl, "getUserPnLToken", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getUserPnLToken: %w", err)
	}

	return pnl, nil
}

// GetLiquidatableTokenUsers returns users that can be liquidated for a token
func (c *LiquidationContract) GetLiquidatableTokenUsers(ctx context.Context, users []common.Address, token common.Address) ([]common.Address, error) {
	data, err := c.abi.Pack("getLiquidatableTokenUsers", users, token)
	if err != nil {
		return nil, fmt.Errorf("failed to pack getLiquidatableTokenUsers: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getLiquidatableTokenUsers: %w", err)
	}

	var liquidatableUsers []common.Address
	err = c.abi.UnpackIntoInterface(&liquidatableUsers, "getLiquidatableTokenUsers", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getLiquidatableTokenUsers: %w", err)
	}

	return liquidatableUsers, nil
}

// FundingRateContract wraps the FundingRate contract
type FundingRateContract struct {
	address common.Address
	abi     abi.ABI
	client  *Client
}

// NewFundingRateContract creates a new FundingRate contract instance
func NewFundingRateContract(address common.Address, client *Client) (*FundingRateContract, error) {
	parsedABI, err := abi.JSON(strings.NewReader(fundingRateABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse FundingRate ABI: %w", err)
	}

	return &FundingRateContract{
		address: address,
		abi:     parsedABI,
		client:  client,
	}, nil
}

// GetLastFundingTime returns the last funding settlement time
func (c *FundingRateContract) GetLastFundingTime(ctx context.Context) (*big.Int, error) {
	data, err := c.abi.Pack("getLastFundingTime")
	if err != nil {
		return nil, fmt.Errorf("failed to pack getLastFundingTime: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getLastFundingTime: %w", err)
	}

	var lastTime *big.Int
	err = c.abi.UnpackIntoInterface(&lastTime, "getLastFundingTime", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getLastFundingTime: %w", err)
	}

	return lastTime, nil
}

// GetCurrentFundingRate returns the current funding rate
func (c *FundingRateContract) GetCurrentFundingRate(ctx context.Context) (*big.Int, error) {
	data, err := c.abi.Pack("getCurrentFundingRate")
	if err != nil {
		return nil, fmt.Errorf("failed to pack getCurrentFundingRate: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call getCurrentFundingRate: %w", err)
	}

	var rate *big.Int
	err = c.abi.UnpackIntoInterface(&rate, "getCurrentFundingRate", result)
	if err != nil {
		return nil, fmt.Errorf("failed to unpack getCurrentFundingRate: %w", err)
	}

	return rate, nil
}

// SettleFunding settles the funding rate
func (c *FundingRateContract) SettleFunding(ctx context.Context) (*types.Transaction, error) {
	auth, err := c.client.GetTransactOpts(ctx)
	if err != nil {
		return nil, err
	}

	data, err := c.abi.Pack("settleFunding")
	if err != nil {
		return nil, fmt.Errorf("failed to pack settleFunding: %w", err)
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

// PositionManagerContract wraps the PositionManager contract
type PositionManagerContract struct {
	address common.Address
	abi     abi.ABI
	client  *Client
}

// Position represents a position from the contract
type Position struct {
	IsLong          bool
	Size            *big.Int
	Collateral      *big.Int
	EntryPrice      *big.Int
	Leverage        *big.Int
	LastFundingTime *big.Int
	AccFundingFee   *big.Int
}

// NewPositionManagerContract creates a new PositionManager contract instance
func NewPositionManagerContract(address common.Address, client *Client) (*PositionManagerContract, error) {
	parsedABI, err := abi.JSON(strings.NewReader(positionManagerABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse PositionManager ABI: %w", err)
	}

	return &PositionManagerContract{
		address: address,
		abi:     parsedABI,
		client:  client,
	}, nil
}

// CanLiquidate checks if a position can be liquidated
func (c *PositionManagerContract) CanLiquidate(ctx context.Context, user common.Address) (bool, error) {
	data, err := c.abi.Pack("canLiquidate", user)
	if err != nil {
		return false, fmt.Errorf("failed to pack canLiquidate: %w", err)
	}

	result, err := c.client.GetClient().CallContract(ctx, ethereum.CallMsg{
		To:   &c.address,
		Data: data,
	}, nil)
	if err != nil {
		return false, fmt.Errorf("failed to call canLiquidate: %w", err)
	}

	var canLiq bool
	err = c.abi.UnpackIntoInterface(&canLiq, "canLiquidate", result)
	if err != nil {
		return false, fmt.Errorf("failed to unpack canLiquidate: %w", err)
	}

	return canLiq, nil
}

// BoundContract is a helper for calling contract functions
type BoundContract struct {
	*bind.BoundContract
}
