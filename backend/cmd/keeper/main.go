package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/keeper"
	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/database"
)

func main() {
	// Load config
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize logger
	var logger *zap.Logger
	if cfg.Server.Mode == "debug" {
		logger, _ = zap.NewDevelopment()
	} else {
		logger, _ = zap.NewProduction()
	}
	defer logger.Sync()

	// Connect to PostgreSQL
	db, err := database.NewPostgres(cfg.Database)
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}

	// Connect to Redis
	redis, err := database.NewRedis(cfg.Redis)
	if err != nil {
		logger.Fatal("Failed to connect to Redis", zap.Error(err))
	}
	cache := database.NewCache(redis)

	// Context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create and start keepers
	liquidationKeeper := keeper.NewLiquidationKeeper(db, cache, &cfg.Blockchain, logger)
	fundingKeeper := keeper.NewFundingKeeper(db, cache, &cfg.Blockchain, logger)
	orderKeeper := keeper.NewOrderKeeper(db, cache, &cfg.Blockchain, logger)

	// Start all keepers
	go liquidationKeeper.Start(ctx)
	go fundingKeeper.Start(ctx)
	go orderKeeper.Start(ctx)

	logger.Info("Keeper services started")

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down keepers...")
	cancel()

	// Give keepers time to finish
	time.Sleep(2 * time.Second)
	logger.Info("Keepers stopped")
}
