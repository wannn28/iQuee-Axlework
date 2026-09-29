// Package config reads runtime configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	Port           string
	DatabaseURL    string
	JWTSecret      string
	JWTTTL         time.Duration
	CORSOrigins    []string
	DemoEmail      string
	DemoPassword   string
	DemoName       string
	DemoResetEvery time.Duration // 0 disables the automatic nightly reset
	LogLevel       string
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func Load() (*Config, error) {
	c := &Config{
		Port:         env("PORT", "8080"),
		DatabaseURL:  env("DATABASE_URL", ""),
		JWTSecret:    env("JWT_SECRET", ""),
		DemoEmail:    strings.ToLower(env("DEMO_EMAIL", "alex.moreno@harborpine.example")),
		DemoPassword: env("DEMO_PASSWORD", "demo-password"),
		DemoName:     env("DEMO_NAME", "Alex Moreno"),
		LogLevel:     env("LOG_LEVEL", "info"),
	}
	for _, o := range strings.Split(env("CORS_ORIGINS", "http://localhost:5173"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	var err error
	if c.JWTTTL, err = time.ParseDuration(env("JWT_TTL", "12h")); err != nil {
		return nil, fmt.Errorf("JWT_TTL: %w", err)
	}
	if c.DemoResetEvery, err = time.ParseDuration(env("DEMO_RESET_EVERY", "24h")); err != nil {
		return nil, fmt.Errorf("DEMO_RESET_EVERY: %w", err)
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	return c, nil
}
