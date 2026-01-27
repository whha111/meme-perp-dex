package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/indexer"
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

	// Create indexer
	idx, err := indexer.NewIndexer(db, cache, &cfg.Blockchain, logger)
	if err != nil {
		logger.Fatal("Failed to create indexer", zap.Error(err))
	}

	// Context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start indexer
	go func() {
		if err := idx.Start(ctx); err != nil {
			logger.Error("Indexer error", zap.Error(err))
		}
	}()

	logger.Info("Indexer started")

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down indexer...")
	cancel()
	logger.Info("Indexer stopped")
}
