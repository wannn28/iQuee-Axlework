// Package auth issues and verifies HS256 JWTs and provides the chi middleware that guards /api routes.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey struct{}

type Claims struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	jwt.RegisteredClaims
}

type Issuer struct {
	secret []byte
	ttl    time.Duration
}

func NewIssuer(secret string, ttl time.Duration) *Issuer {
	return &Issuer{secret: []byte(secret), ttl: ttl}
}

func (i *Issuer) Issue(userID int, email, name string) (string, time.Time, error) {
	exp := time.Now().Add(i.ttl)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		Email: email,
		Name:  name,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.Itoa(userID),
			Issuer:    "axlework-api",
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	})
	s, err := tok.SignedString(i.secret)
	return s, exp, err
}

func (i *Issuer) Parse(raw string) (*Claims, error) {
	c := &Claims{}
	_, err := jwt.ParseWithClaims(raw, c, func(t *jwt.Token) (any, error) { return i.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("axlework-api"), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	return c, nil
}

// Middleware rejects requests without a valid "Authorization: Bearer <jwt>" header.
func (i *Issuer) Middleware(onFail func(w http.ResponseWriter, r *http.Request)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			raw, ok := strings.CutPrefix(h, "Bearer ")
			if !ok || raw == "" {
				onFail(w, r)
				return
			}
			c, err := i.Parse(raw)
			if err != nil {
				onFail(w, r)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, c)))
		})
	}
}

// UserID returns the authenticated user's id from the request context.
func UserID(ctx context.Context) (int, error) {
	c, ok := ctx.Value(ctxKey{}).(*Claims)
	if !ok {
		return 0, errors.New("unauthenticated")
	}
	return strconv.Atoi(c.Subject)
}
