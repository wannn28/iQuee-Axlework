package api

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/iquee/axlework/server/internal/auth"
	"github.com/iquee/axlework/server/internal/seed"
)

var emailRe = regexp.MustCompile(`^\S+@\S+\.\S+$`)

// EnsureDemoUser creates (or refreshes the password of) the one-click demo account.
func (s *Server) EnsureDemoUser(ctx context.Context) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(s.cfg.DemoPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	var id int
	err = s.db.QueryRow(ctx, `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
		ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name RETURNING id`,
		s.cfg.DemoEmail, s.cfg.DemoName, string(hash)).Scan(&id)
	if err != nil {
		return err
	}
	return seed.EnsureUserSettings(ctx, s.db, id)
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Demo     bool   `json:"demo"` // "Enter demo" button: sign in as the demo account
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in loginReq
	if !decode(w, r, &in) {
		return
	}
	if in.Demo {
		in.Email, in.Password = s.cfg.DemoEmail, s.cfg.DemoPassword
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if !emailRe.MatchString(in.Email) || in.Password == "" {
		writeErr(w, http.StatusUnprocessableEntity, "validation", "Enter your email and password.", nil)
		return
	}
	var (
		id         int
		name, hash string
	)
	err := s.db.QueryRow(r.Context(), `SELECT id, name, password_hash FROM users WHERE email = $1`, in.Email).Scan(&id, &name, &hash)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil) {
		writeErr(w, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect. Use the demo account shown on this page.", nil)
		return
	}
	if err != nil {
		s.internal(w, r, err)
		return
	}
	tok, exp, err := s.jwt.Issue(id, in.Email, name)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	s.log.Info("login", "user_id", id, "demo", in.Demo)
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "expiresAt": exp.UTC(), "user": map[string]any{"id": id, "email": in.Email, "name": name}})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var email, name string
	if err := s.db.QueryRow(r.Context(), `SELECT email, name FROM users WHERE id = $1`, uid).Scan(&email, &name); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "Account no longer exists.", nil)
			return
		}
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": uid, "email": email, "name": name})
}

// ---------- settings ----------

type Settings struct {
	Name        string  `json:"name"`
	Email       string  `json:"email"`
	Company     string  `json:"company"`
	Timezone    string  `json:"timezone"`
	Units       string  `json:"units"`
	FuelPrice   float64 `json:"fuelPrice"`
	IdleLimit   int     `json:"idleLimit"`
	SpeedLimit  int     `json:"speedLimit"`
	FuelDropGal int     `json:"fuelDropGal"`
	NotifyEmail bool    `json:"notifyEmail"`
	NotifySms   bool    `json:"notifySms"`
	DailyDigest bool    `json:"dailyDigest"`
}

func (s *Server) loadSettings(ctx context.Context, uid int) (Settings, error) {
	var st Settings
	err := s.db.QueryRow(ctx, `SELECT name, email, company, timezone, units, fuel_price::float8, idle_limit, speed_limit,
		fuel_drop_gal, notify_email, notify_sms, daily_digest FROM user_settings WHERE user_id = $1`, uid).Scan(
		&st.Name, &st.Email, &st.Company, &st.Timezone, &st.Units, &st.FuelPrice, &st.IdleLimit, &st.SpeedLimit,
		&st.FuelDropGal, &st.NotifyEmail, &st.NotifySms, &st.DailyDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := seed.EnsureUserSettings(ctx, s.db, uid); err != nil {
			return st, err
		}
		return s.loadSettings(ctx, uid)
	}
	return st, err
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	st, err := s.loadSettings(r.Context(), uid)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

var timezones = map[string]bool{"America/Los_Angeles": true, "America/Denver": true, "America/Chicago": true,
	"America/New_York": true, "Asia/Jakarta": true, "Europe/London": true}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var in Settings
	if !decode(w, r, &in) {
		return
	}
	in.Name, in.Email, in.Company = strings.TrimSpace(in.Name), strings.TrimSpace(in.Email), strings.TrimSpace(in.Company)
	f := map[string]string{}
	if in.Name == "" || len(in.Name) > 80 {
		f["name"] = "Name is required (max 80 characters)."
	}
	if !emailRe.MatchString(in.Email) {
		f["email"] = "Enter a valid email address."
	}
	if in.Company == "" || len(in.Company) > 120 {
		f["company"] = "Company name is required (max 120 characters)."
	}
	if !timezones[in.Timezone] {
		f["timezone"] = "Unsupported time zone."
	}
	if in.Units != "imperial" && in.Units != "metric" {
		f["units"] = "Units must be imperial or metric."
	}
	if in.FuelPrice < 2 || in.FuelPrice > 8 {
		f["fuelPrice"] = "Between 2 and 8 USD/gal."
	}
	if in.IdleLimit < 3 || in.IdleLimit > 120 {
		f["idleLimit"] = "Between 3 and 120 minutes."
	}
	if in.SpeedLimit < 40 || in.SpeedLimit > 85 {
		f["speedLimit"] = "Between 40 and 85 mph."
	}
	if in.FuelDropGal < 2 || in.FuelDropGal > 60 {
		f["fuelDropGal"] = "Between 2 and 60 gal."
	}
	if len(f) > 0 {
		writeErr(w, http.StatusUnprocessableEntity, "validation", "Some settings are invalid.", f)
		return
	}
	_, err := s.db.Exec(r.Context(), `UPDATE user_settings SET name=$2, email=$3, company=$4, timezone=$5, units=$6,
		fuel_price=$7, idle_limit=$8, speed_limit=$9, fuel_drop_gal=$10, notify_email=$11, notify_sms=$12, daily_digest=$13,
		updated_at=now() WHERE user_id=$1`, uid, in.Name, in.Email, in.Company, in.Timezone, in.Units, in.FuelPrice,
		in.IdleLimit, in.SpeedLimit, in.FuelDropGal, in.NotifyEmail, in.NotifySms, in.DailyDigest)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, in)
}

// ---------- demo data ----------

func (s *Server) resetDemo(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := seed.Reset(ctx, s.db, s.seed); err != nil {
		s.internal(w, r, err)
		return
	}
	uid, _ := auth.UserID(r.Context())
	s.log.Info("demo data reset", "user_id", uid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "resetAt": time.Now().UTC()})
}
