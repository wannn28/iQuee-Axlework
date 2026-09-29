// Package api implements the Axlework REST API (chi router, JSON over HTTP).
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/iquee/axlework/server/internal/auth"
	"github.com/iquee/axlework/server/internal/config"
	"github.com/iquee/axlework/server/internal/seed"
)

type Server struct {
	db      *pgxpool.Pool
	cfg     *config.Config
	jwt     *auth.Issuer
	seed    *seed.Data
	log     *slog.Logger
	started time.Time
	version string
}

func New(db *pgxpool.Pool, cfg *config.Config, sd *seed.Data, log *slog.Logger, version string) *Server {
	return &Server{db: db, cfg: cfg, jwt: auth.NewIssuer(cfg.JWTSecret, cfg.JWTTTL), seed: sd, log: log, started: time.Now(), version: version}
}

// clientIP prefers Cloudflare's header, then nginx's X-Real-IP. The API only listens on
// 127.0.0.1 behind nginx, so these headers come from our own proxy chain.
func clientIP(r *http.Request) string {
	for _, h := range []string{"CF-Connecting-IP", "X-Real-IP"} {
		if v := strings.TrimSpace(r.Header.Get(h)); v != "" {
			return v
		}
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func rateLimitByIP(n int, per time.Duration) func(http.Handler) http.Handler {
	return httprate.Limit(n, per,
		httprate.WithKeyFuncs(func(r *http.Request) (string, error) { return clientIP(r), nil }),
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, http.StatusTooManyRequests, "rate_limited", "Too many requests, slow down a little.", nil)
		}))
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		t0 := time.Now()
		next.ServeHTTP(ww, r)
		lvl := slog.LevelInfo
		if ww.Status() >= 500 {
			lvl = slog.LevelError
		}
		if r.URL.Path == "/api/health" && ww.Status() == 200 {
			lvl = slog.LevelDebug
		}
		s.log.Log(r.Context(), lvl, "http",
			"method", r.Method, "path", r.URL.Path, "status", ww.Status(), "bytes", ww.BytesWritten(),
			"dur_ms", time.Since(t0).Milliseconds(), "ip", clientIP(r), "req_id", middleware.GetReqID(r.Context()))
	})
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, s.requestLogger, middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Content-Disposition"},
		AllowCredentials: false,
		MaxAge:           600,
	}))
	r.Use(middleware.Timeout(20 * time.Second))
	r.Use(rateLimitByIP(600, time.Minute))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.health)
		r.With(rateLimitByIP(10, time.Minute)).Post("/auth/login", s.login)

		r.Group(func(r chi.Router) {
			r.Use(s.jwt.Middleware(func(w http.ResponseWriter, r *http.Request) {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "Sign in to continue.", nil)
			}))
			r.Get("/auth/me", s.me)

			r.Get("/overview", s.overview)
			r.Get("/fleet/summary", s.fleetSummary)
			r.Get("/reports/daily.csv", s.dailyCSV)

			r.Get("/vehicles", s.listVehicles)
			r.Get("/vehicles/export.csv", s.exportVehicles)
			r.Post("/vehicles", s.createVehicle)
			r.Post("/vehicles/bulk-delete", s.bulkDeleteVehicles)
			r.Route("/vehicles/{id}", func(r chi.Router) {
				r.Get("/", s.getVehicle)
				r.Put("/", s.updateVehicle)
				r.Delete("/", s.deleteVehicle)
				r.Get("/detail", s.vehicleDetail)
				r.Get("/trip", s.vehicleTrip)
				r.Get("/fuel", s.vehicleFuel)
				r.Get("/timeline", s.vehicleTimeline)
				r.Get("/services", s.vehicleServices)
			})

			r.Get("/depots", s.listDepots)
			r.Get("/drivers", s.listDrivers)
			r.Get("/alerts", s.listAlerts)
			r.Post("/alerts/{id}/ack", s.ackAlert)

			r.Get("/settings", s.getSettings)
			r.Put("/settings", s.putSettings)
			r.With(rateLimitByIP(3, time.Minute)).Post("/demo/reset", s.resetDemo)
		})
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, http.StatusNotFound, "not_found", "No such endpoint.", nil)
		})
	})
	return r
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	dbOK := s.db.Ping(ctx) == nil
	code := http.StatusOK
	status := "ok"
	if !dbOK {
		code, status = http.StatusServiceUnavailable, "degraded"
	}
	writeJSON(w, code, map[string]any{
		"status": status, "service": "axlework-api", "version": s.version, "database": map[bool]string{true: "up", false: "down"}[dbOK],
		"uptime_s": int(time.Since(s.started).Seconds()), "time": time.Now().UTC(),
	})
}

// ---------- response helpers ----------

type apiError struct {
	Error   string            `json:"error"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, errCode, msg string, fields map[string]string) {
	writeJSON(w, code, apiError{Error: errCode, Message: msg, Fields: fields})
}

func (s *Server) internal(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	s.log.Error("internal error", "err", err.Error(), "path", r.URL.Path, "req_id", middleware.GetReqID(r.Context()))
	writeErr(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.", nil)
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "Malformed JSON body: "+err.Error(), nil)
		return false
	}
	return true
}

// DB exposes the pool for background jobs.
func (s *Server) DB() *pgxpool.Pool { return s.db }
