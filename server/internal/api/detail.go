package api

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/iquee/axlework/server/internal/auth"
)

type Pt [2]float64

type Stop struct {
	Pt     Pt         `json:"pt"`
	Label  string     `json:"label"`
	Arrive time.Time  `json:"arrive"`
	Depart *time.Time `json:"depart"`
	Kind   string     `json:"kind"`
}

type Trip struct {
	Route struct {
		Path    []Pt    `json:"path"`
		Stops   []Stop  `json:"stops"`
		Current *Pt     `json:"current"`
		Driven  []Pt    `json:"driven"`
		Miles   float64 `json:"miles"`
	} `json:"route"`
	Today struct {
		Miles       float64 `json:"miles"`
		EngineHours float64 `json:"engineHours"`
		IdleMin     int     `json:"idleMin"`
		MaxSpeed    int     `json:"maxSpeed"`
		Score       int     `json:"score"`
	} `json:"today"`
	Progress  float64   `json:"progress"`
	Active    bool      `json:"active"`
	StartedAt time.Time `json:"startedAt"`
}

type FuelReading struct {
	T     time.Time `json:"t"`
	Level float64   `json:"level"`
}

type FuelDrop struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
	Pct  float64   `json:"pct"`
	Gal  int       `json:"gal"`
}

type Fuel struct {
	Readings     []FuelReading `json:"readings"`
	Drops        []FuelDrop    `json:"drops"`
	Drop         *FuelDrop     `json:"drop"` // largest drop in the window, or null
	ThresholdGal int           `json:"thresholdGal"`
	ThresholdPct float64       `json:"thresholdPct"`
}

type Event struct {
	At     time.Time `json:"at"`
	Kind   string    `json:"kind"`
	Title  string    `json:"title"`
	Detail string    `json:"detail"`
}

type Service struct {
	Date     time.Time `json:"date"`
	Odometer int       `json:"odometer"`
	Work     string    `json:"work"`
	Shop     string    `json:"shop"`
	Cost     int       `json:"cost"`
}

var errNotFound = errors.New("not found")

func (s *Server) loadTrip(ctx context.Context, vehicleID string) (*Trip, error) {
	t := &Trip{}
	var id int64
	var cx, cy *float64
	err := s.db.QueryRow(ctx, `SELECT id, started_at, planned_mi::float8, progress::float8, active, current_x, current_y,
		today_miles::float8, engine_hours::float8, idle_min, max_speed, score FROM trips WHERE vehicle_id = $1`, vehicleID).Scan(
		&id, &t.StartedAt, &t.Route.Miles, &t.Progress, &t.Active, &cx, &cy, &t.Today.Miles, &t.Today.EngineHours,
		&t.Today.IdleMin, &t.Today.MaxSpeed, &t.Today.Score)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	if cx != nil && cy != nil {
		t.Route.Current = &Pt{*cx, *cy}
	}
	t.Route.Path, t.Route.Driven = []Pt{}, []Pt{}
	rows, err := s.db.Query(ctx, `SELECT driven, x, y FROM route_points WHERE trip_id = $1 ORDER BY driven, seq`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var driven bool
		var p Pt
		if err := rows.Scan(&driven, &p[0], &p[1]); err != nil {
			rows.Close()
			return nil, err
		}
		if driven {
			t.Route.Driven = append(t.Route.Driven, p)
		} else {
			t.Route.Path = append(t.Route.Path, p)
		}
	}
	rows.Close()
	rows, err = s.db.Query(ctx, `SELECT x, y, label, kind, arrive_at, depart_at FROM trip_stops WHERE trip_id = $1 ORDER BY seq`, id)
	if err != nil {
		return nil, err
	}
	t.Route.Stops, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Stop, error) {
		var st Stop
		return st, row.Scan(&st.Pt[0], &st.Pt[1], &st.Label, &st.Kind, &st.Arrive, &st.Depart)
	})
	return t, err
}

// dropPctThreshold: a fall of >= 6 % of the tank inside one 15-minute sample is never normal burn
// (the worst case in this fleet is ~1.4 %/sample), so it is flagged even below the gallon threshold.
const dropPctThreshold = 6.0

// loadFuel returns the tank-level series and runs drop detection in SQL: LAG() compares every sample
// with the previous one; a decrease larger than the user's gallon threshold (or 6 % of the tank)
// between samples at most 20 minutes apart is reported as a sudden drop.
func (s *Server) loadFuel(ctx context.Context, vehicleID string, tankGal int, hours, thresholdGal int) (*Fuel, error) {
	f := &Fuel{Readings: []FuelReading{}, Drops: []FuelDrop{}, ThresholdGal: thresholdGal, ThresholdPct: dropPctThreshold}
	since := time.Now().Add(-time.Duration(hours)*time.Hour - 5*time.Minute)
	rows, err := s.db.Query(ctx, `SELECT recorded_at, level_pct::float8 FROM fuel_readings
		WHERE vehicle_id = $1 AND recorded_at >= $2 ORDER BY recorded_at`, vehicleID, since)
	if err != nil {
		return nil, err
	}
	f.Readings, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (FuelReading, error) {
		var r FuelReading
		return r, row.Scan(&r.T, &r.Level)
	})
	if err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `
		WITH s AS (
			SELECT recorded_at, level_pct,
			       LAG(level_pct)   OVER w AS prev_level,
			       LAG(recorded_at) OVER w AS prev_at
			FROM fuel_readings
			WHERE vehicle_id = $1 AND recorded_at >= $2
			WINDOW w AS (ORDER BY recorded_at)
		)
		SELECT prev_at, recorded_at, (prev_level - level_pct)::float8 AS pct
		FROM s
		WHERE prev_level IS NOT NULL
		  AND recorded_at - prev_at <= interval '20 minutes'
		  AND (prev_level - level_pct >= $3 OR (prev_level - level_pct) / 100.0 * $4 >= $5)
		ORDER BY recorded_at`, vehicleID, since, dropPctThreshold, tankGal, thresholdGal)
	if err != nil {
		return nil, err
	}
	f.Drops, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (FuelDrop, error) {
		var d FuelDrop
		err := row.Scan(&d.From, &d.To, &d.Pct)
		d.Pct = math.Round(d.Pct*10) / 10
		d.Gal = int(math.Round(d.Pct / 100 * float64(tankGal)))
		return d, err
	})
	if err != nil {
		return nil, err
	}
	for i := range f.Drops {
		if f.Drop == nil || f.Drops[i].Gal > f.Drop.Gal {
			f.Drop = &f.Drops[i]
		}
	}
	return f, nil
}

func (s *Server) loadTimeline(ctx context.Context, vehicleID string, drops []FuelDrop) ([]Event, error) {
	rows, err := s.db.Query(ctx, `SELECT at, kind, title, detail FROM vehicle_events WHERE vehicle_id = $1 ORDER BY at DESC LIMIT 100`, vehicleID)
	if err != nil {
		return nil, err
	}
	evs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Event, error) {
		var e Event
		return e, row.Scan(&e.At, &e.Kind, &e.Title, &e.Detail)
	})
	if err != nil {
		return nil, err
	}
	for _, d := range drops {
		evs = append(evs, Event{At: d.From, Kind: "drop", Title: fmt.Sprintf("Fuel drop · −%d gal", d.Gal),
			Detail: fmt.Sprintf("Level fell %.1f %% in one sample. Flagged as possible siphoning or leak.", d.Pct)})
	}
	sort.SliceStable(evs, func(i, j int) bool { return evs[i].At.After(evs[j].At) })
	return evs, nil
}

func (s *Server) loadServices(ctx context.Context, vehicleID string) ([]Service, error) {
	rows, err := s.db.Query(ctx, `SELECT serviced_at, odometer, work, shop, cost FROM service_records WHERE vehicle_id = $1
		ORDER BY serviced_at DESC`, vehicleID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Service, error) {
		var sv Service
		return sv, row.Scan(&sv.Date, &sv.Odometer, &sv.Work, &sv.Shop, &sv.Cost)
	})
}

func (s *Server) dropThreshold(ctx context.Context, r *http.Request) int {
	uid, _ := auth.UserID(ctx)
	var g int
	if err := s.db.QueryRow(ctx, `SELECT fuel_drop_gal FROM user_settings WHERE user_id = $1`, uid).Scan(&g); err != nil {
		g = 8
	}
	return g
}

// vehicleOr404 loads the vehicle or writes the error response.
func (s *Server) vehicleOr404(w http.ResponseWriter, r *http.Request) (*Vehicle, bool) {
	v, err := s.findVehicle(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found", "Vehicle not found.", nil)
		return nil, false
	}
	if err != nil {
		s.internal(w, r, err)
		return nil, false
	}
	return &v, true
}

func (s *Server) vehicleTrip(w http.ResponseWriter, r *http.Request) {
	v, ok := s.vehicleOr404(w, r)
	if !ok {
		return
	}
	t, err := s.loadTrip(r.Context(), v.ID)
	if errors.Is(err, errNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "No trip recorded for this vehicle.", nil)
		return
	}
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func hoursParam(r *http.Request) int {
	h, _ := strconv.Atoi(r.URL.Query().Get("hours"))
	if h < 1 || h > 72 {
		h = 24
	}
	return h
}

func (s *Server) vehicleFuel(w http.ResponseWriter, r *http.Request) {
	v, ok := s.vehicleOr404(w, r)
	if !ok {
		return
	}
	f, err := s.loadFuel(r.Context(), v.ID, v.TankGal, hoursParam(r), s.dropThreshold(r.Context(), r))
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) vehicleTimeline(w http.ResponseWriter, r *http.Request) {
	v, ok := s.vehicleOr404(w, r)
	if !ok {
		return
	}
	f, err := s.loadFuel(r.Context(), v.ID, v.TankGal, 24, s.dropThreshold(r.Context(), r))
	if err != nil {
		s.internal(w, r, err)
		return
	}
	evs, err := s.loadTimeline(r.Context(), v.ID, f.Drops)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, evs)
}

func (s *Server) vehicleServices(w http.ResponseWriter, r *http.Request) {
	v, ok := s.vehicleOr404(w, r)
	if !ok {
		return
	}
	sv, err := s.loadServices(r.Context(), v.ID)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sv)
}

// vehicleDetail bundles everything the detail page needs in one round trip.
func (s *Server) vehicleDetail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	v, ok := s.vehicleOr404(w, r)
	if !ok {
		return
	}
	trip, err := s.loadTrip(ctx, v.ID)
	if err != nil && !errors.Is(err, errNotFound) {
		s.internal(w, r, err)
		return
	}
	fuel, err := s.loadFuel(ctx, v.ID, v.TankGal, 24, s.dropThreshold(ctx, r))
	if err != nil {
		s.internal(w, r, err)
		return
	}
	if !v.FuelSensor {
		fuel.Drops, fuel.Drop = []FuelDrop{}, nil
	}
	tl, err := s.loadTimeline(ctx, v.ID, fuel.Drops)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	sv, err := s.loadServices(ctx, v.ID)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"vehicle": v, "trip": trip, "fuel": fuel, "timeline": tl, "services": sv})
}
