// Command api is the Axlework fleet & fuel REST API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata" // embedded zoneinfo: the final image is FROM scratch

	"github.com/iquee/axlework/server/internal/api"
	"github.com/iquee/axlework/server/internal/config"
	"github.com/iquee/axlework/server/internal/db"
	"github.com/iquee/axlework/server/internal/seed"
)

var version = "dev" // set with -ldflags "-X main.version=..."

func main() {
	// `api -healthcheck` is used by the Docker HEALTHCHECK (the scratch image has no curl/wget).
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(healthcheck())
	}
	if err := run(); err != nil {
		slog.Error("fatal", "err", err.Error())
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	level := slog.LevelInfo
	if cfg != nil && strings.EqualFold(cfg.LogLevel, "debug") {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})).With("service", "axlework-api")
	slog.SetDefault(log)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(cfg.DatabaseURL); err != nil {
		return err
	}

	data, err := seed.Load()
	if err != nil {
		return err
	}
	srv := api.New(pool, cfg, data, log, version)
	if err := srv.EnsureDemoUser(ctx); err != nil {
		return err
	}
	if empty, err := seed.IsEmpty(ctx, pool); err != nil {
		return err
	} else if empty {
		t0 := time.Now()
		if err := seed.Reset(ctx, pool, data); err != nil {
			return err
		}
		log.Info("database seeded", "vehicles", len(data.Vehicles), "ms", time.Since(t0).Milliseconds())
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); backgroundJobs(ctx, log, srv, cfg, data) }()

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", httpSrv.Addr, "version", version)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
		close(errc)
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shCtx); err != nil {
		log.Error("http shutdown", "err", err.Error())
	}
	wg.Wait()
	log.Info("bye")
	return nil
}

// backgroundJobs advances the demo clock every minute and restores the seed on a schedule
// (so a public demo that visitors can edit never stays broken for long).
func backgroundJobs(ctx context.Context, log *slog.Logger, srv *api.Server, cfg *config.Config, data *seed.Data) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		jctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		if d, err := seed.AdvanceClock(jctx, srv.DB()); err != nil {
			log.Error("advance clock", "err", err.Error())
		} else if d > 0 {
			log.Debug("demo clock advanced", "by_s", int(d.Seconds()))
		}
		if cfg.DemoResetEvery > 0 {
			if due, err := seed.ResetDue(jctx, srv.DB(), cfg.DemoResetEvery); err != nil {
				log.Error("reset check", "err", err.Error())
			} else if due {
				if err := seed.Reset(jctx, srv.DB(), data); err != nil {
					log.Error("scheduled reset", "err", err.Error())
				} else {
					log.Info("scheduled demo reset done")
				}
			}
		}
		cancel()
	}
}

func healthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	c := http.Client{Timeout: 3 * time.Second}
	res, err := c.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "status", res.StatusCode)
		return 1
	}
	return 0
}
