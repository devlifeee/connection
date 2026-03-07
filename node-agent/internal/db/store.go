package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(ctx context.Context, connString string) (*Store, error) {
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Pool() *pgxpool.Pool { return s.pool }

func (s *Store) Migrate(ctx context.Context, migrationsDir string) error {
	// Simple migration runner
	// In production use proper migration tool
	files, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("failed to read migrations dir: %w", err)
	}

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".sql" {
			log.Printf("Applying migration: %s", file.Name())
			content, err := os.ReadFile(filepath.Join(migrationsDir, file.Name()))
			if err != nil {
				return fmt.Errorf("failed to read migration file: %w", err)
			}
			
			// Execute migration
			if _, err := s.pool.Exec(ctx, string(content)); err != nil {
				return fmt.Errorf("failed to apply migration %s: %w", file.Name(), err)
			}
		}
	}
	return nil
}
