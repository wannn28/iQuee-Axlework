// Package seed loads the deterministic Harbor & Pine demo dataset into PostgreSQL.
//
// seed.json is produced by `npm run seed:export` from the same TypeScript generator the
// frontend used before it had a backend, so the API serves an identical fleet. All timestamps
// in the file are relative to its "anchor"; they are shifted so the anchor becomes "now".
package seed

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed seed.json
var raw []byte

// FleetTZ is the demo company's home time zone (daily rollups are keyed by local date).
var FleetTZ = mustTZ("America/Los_Angeles")

func mustTZ(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return l
}

type Pt [2]float64

type Vehicle struct {
	ID            string    `json:"id"`
	Plate         string    `json:"plate"`
	VIN           string    `json:"vin"`
	Make          string    `json:"make"`
	Model         string    `json:"model"`
	Year          int       `json:"year"`
	Type          string    `json:"type"`
	Depot         string    `json:"depot"`
	Driver        *string   `json:"driver"`
	Status        string    `json:"status"`
	Odometer      int       `json:"odometer"`
	FuelLevel     float64   `json:"fuelLevel"`
	TankGal       int       `json:"tankGal"`
	MPG           float64   `json:"mpg"`
	Speed         int       `json:"speed"`
	Location      string    `json:"location"`
	LastSeen      time.Time `json:"lastSeen"`
	IMEI          string    `json:"imei"`
	FuelSensor    bool      `json:"fuelSensor"`
	Alerts        int       `json:"alerts"`
	Health        int       `json:"health"`
	NextServiceMi int       `json:"nextServiceMi"`
	Notes         string    `json:"notes"`
	CreatedAt     time.Time `json:"createdAt"`
}

type Stop struct {
	Pt     Pt         `json:"pt"`
	Label  string     `json:"label"`
	Arrive time.Time  `json:"arrive"`
	Depart *time.Time `json:"depart"`
	Kind   string     `json:"kind"`
}

type Detail struct {
	VehicleID string `json:"vehicleId"`
	Route     struct {
		Path    []Pt    `json:"path"`
		Stops   []Stop  `json:"stops"`
		Current *Pt     `json:"current"`
		Driven  []Pt    `json:"driven"`
		Miles   float64 `json:"miles"`
	} `json:"route"`
	Fuel []struct {
		T     time.Time `json:"t"`
		Level float64   `json:"level"`
	} `json:"fuel"`
	Timeline []struct {
		At     time.Time `json:"at"`
		Kind   string    `json:"kind"`
		Title  string    `json:"title"`
		Detail string    `json:"detail"`
	} `json:"timeline"`
	Services []struct {
		Date     time.Time `json:"date"`
		Odometer int       `json:"odometer"`
		Work     string    `json:"work"`
		Shop     string    `json:"shop"`
		Cost     int       `json:"cost"`
	} `json:"services"`
	Today struct {
		Miles       float64 `json:"miles"`
		EngineHours float64 `json:"engineHours"`
		IdleMin     int     `json:"idleMin"`
		MaxSpeed    int     `json:"maxSpeed"`
		Score       int     `json:"score"`
	} `json:"today"`
	Progress float64 `json:"progress"`
	Active   bool    `json:"active"`
}

type Data struct {
	Anchor time.Time `json:"anchor"`
	Depots []struct {
		Name  string `json:"name"`
		State string `json:"state"`
	} `json:"depots"`
	Drivers  []string  `json:"drivers"`
	Vehicles []Vehicle `json:"vehicles"`
	Days     []struct {
		Date      string         `json:"date"`
		Miles     int            `json:"miles"`
		Gallons   int            `json:"gallons"`
		FuelCost  int            `json:"fuelCost"`
		IdleHours int            `json:"idleHours"`
		OnTime    float64        `json:"onTime"`
		Trips     int            `json:"trips"`
		Alerts    int            `json:"alerts"`
		ByDepot   map[string]int `json:"byDepot"`
	} `json:"days"`
	Alerts []struct {
		ID           string    `json:"id"`
		VehicleID    string    `json:"vehicleId"`
		Kind         string    `json:"kind"`
		Severity     string    `json:"severity"`
		At           time.Time `json:"at"`
		Text         string    `json:"text"`
		Acknowledged bool      `json:"acknowledged"`
	} `json:"alerts"`
	Details []Detail `json:"details"`
}

// Load parses the embedded dataset.
func Load() (*Data, error) {
	var d Data
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("seed.json: %w", err)
	}
	return &d, nil
}

// Settings defaults for the demo workspace (mirrors the frontend's DEFAULT_SETTINGS).
const defaultSettingsSQL = `
INSERT INTO user_settings (user_id, name, email, company, timezone, units, fuel_price, idle_limit, speed_limit,
    fuel_drop_gal, notify_email, notify_sms, daily_digest, updated_at)
VALUES ($1, 'Alex Moreno', 'alex.moreno@harborpine.example', 'Harbor & Pine Freight Co.', 'America/Los_Angeles',
    'imperial', 4.12, 15, 65, 8, TRUE, FALSE, TRUE, now())
ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, company = EXCLUDED.company,
    timezone = EXCLUDED.timezone, units = EXCLUDED.units, fuel_price = EXCLUDED.fuel_price,
    idle_limit = EXCLUDED.idle_limit, speed_limit = EXCLUDED.speed_limit, fuel_drop_gal = EXCLUDED.fuel_drop_gal,
    notify_email = EXCLUDED.notify_email, notify_sms = EXCLUDED.notify_sms, daily_digest = EXCLUDED.daily_digest,
    updated_at = now()`

// IsEmpty reports whether the fleet has never been seeded.
func IsEmpty(ctx context.Context, pool *pgxpool.Pool) (bool, error) {
	var seeded bool
	err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM demo_meta WHERE key = 'seeded_at')`).Scan(&seeded)
	return !seeded, err
}

// Reset wipes all fleet data and reloads the seed, re-anchored to now. Users are kept;
// every user's settings are restored to defaults.
func Reset(ctx context.Context, pool *pgxpool.Pool, d *Data) error {
	now := time.Now().UTC()
	delta := now.Sub(d.Anchor)
	sh := func(t time.Time) time.Time { return t.Add(delta) }

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `TRUNCATE alerts, service_records, vehicle_events, fuel_readings, trip_stops, route_points,
		trips, vehicles, drivers, depots, daily_metrics, daily_depot_fuel, demo_meta RESTART IDENTITY CASCADE`); err != nil {
		return err
	}
	for _, dp := range d.Depots {
		if _, err := tx.Exec(ctx, `INSERT INTO depots (name, state) VALUES ($1, $2)`, dp.Name, dp.State); err != nil {
			return err
		}
	}
	driverID := map[string]int{}
	for _, name := range d.Drivers {
		var id int
		if err := tx.QueryRow(ctx, `INSERT INTO drivers (name) VALUES ($1) RETURNING id`, name).Scan(&id); err != nil {
			return err
		}
		driverID[name] = id
	}

	vrows := make([][]any, 0, len(d.Vehicles))
	for _, v := range d.Vehicles {
		var drv *int
		if v.Driver != nil {
			id := driverID[*v.Driver]
			drv = &id
		}
		vrows = append(vrows, []any{v.ID, v.Plate, v.VIN, v.Make, v.Model, v.Year, v.Type, v.Depot, drv, v.Status,
			v.Odometer, v.FuelLevel, v.TankGal, v.MPG, v.Speed, v.Location, sh(v.LastSeen), v.IMEI, v.FuelSensor,
			v.Alerts, v.Health, v.NextServiceMi, v.Notes, sh(v.CreatedAt), now})
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"vehicles"}, []string{"id", "plate", "vin", "make", "model", "year", "type",
		"depot", "driver_id", "status", "odometer", "fuel_level", "tank_gal", "mpg", "speed", "location", "last_seen", "imei",
		"fuel_sensor", "alerts", "health", "next_service_mi", "notes", "created_at", "updated_at"}, pgx.CopyFromRows(vrows)); err != nil {
		return fmt.Errorf("copy vehicles: %w", err)
	}

	var fuel, events, services, points, stops [][]any
	for _, det := range d.Details {
		var tripID int64
		var cx, cy *float64
		if det.Route.Current != nil {
			cx, cy = &det.Route.Current[0], &det.Route.Current[1]
		}
		start := now
		if len(det.Route.Stops) > 0 {
			start = sh(det.Route.Stops[0].Arrive)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO trips (vehicle_id, started_at, planned_mi, progress, active, current_x, current_y,
			today_miles, engine_hours, idle_min, max_speed, score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
			det.VehicleID, start, det.Route.Miles, det.Progress, det.Active, cx, cy, det.Today.Miles, det.Today.EngineHours,
			det.Today.IdleMin, det.Today.MaxSpeed, det.Today.Score).Scan(&tripID); err != nil {
			return fmt.Errorf("trip %s: %w", det.VehicleID, err)
		}
		for i, p := range det.Route.Path {
			points = append(points, []any{tripID, false, i, p[0], p[1]})
		}
		for i, p := range det.Route.Driven {
			points = append(points, []any{tripID, true, i, p[0], p[1]})
		}
		for i, s := range det.Route.Stops {
			var dep *time.Time
			if s.Depart != nil {
				t := sh(*s.Depart)
				dep = &t
			}
			stops = append(stops, []any{tripID, i, s.Pt[0], s.Pt[1], s.Label, s.Kind, sh(s.Arrive), dep})
		}
		for _, f := range det.Fuel {
			fuel = append(fuel, []any{det.VehicleID, sh(f.T), f.Level})
		}
		for _, e := range det.Timeline {
			events = append(events, []any{det.VehicleID, sh(e.At), e.Kind, e.Title, e.Detail})
		}
		for _, s := range det.Services {
			services = append(services, []any{det.VehicleID, sh(s.Date), s.Odometer, s.Work, s.Shop, s.Cost})
		}
	}
	copies := []struct {
		table string
		cols  []string
		rows  [][]any
	}{
		{"route_points", []string{"trip_id", "driven", "seq", "x", "y"}, points},
		{"trip_stops", []string{"trip_id", "seq", "x", "y", "label", "kind", "arrive_at", "depart_at"}, stops},
		{"fuel_readings", []string{"vehicle_id", "recorded_at", "level_pct"}, fuel},
		{"vehicle_events", []string{"vehicle_id", "at", "kind", "title", "detail"}, events},
		{"service_records", []string{"vehicle_id", "serviced_at", "odometer", "work", "shop", "cost"}, services},
	}
	for _, c := range copies {
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{c.table}, c.cols, pgx.CopyFromRows(c.rows)); err != nil {
			return fmt.Errorf("copy %s: %w", c.table, err)
		}
	}

	arows := make([][]any, 0, len(d.Alerts))
	for _, a := range d.Alerts {
		var ackAt *time.Time
		if a.Acknowledged {
			t := sh(a.At).Add(20 * time.Minute)
			ackAt = &t
		}
		arows = append(arows, []any{a.ID, a.VehicleID, a.Kind, a.Severity, sh(a.At), a.Text, a.Acknowledged, ackAt})
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"alerts"}, []string{"id", "vehicle_id", "kind", "severity", "at", "text",
		"acknowledged", "acknowledged_at"}, pgx.CopyFromRows(arows)); err != nil {
		return fmt.Errorf("copy alerts: %w", err)
	}

	// daily rollups: shift whole days so the last seeded day is "today" in the fleet's time zone
	if len(d.Days) > 0 {
		last, _ := time.Parse("2006-01-02", d.Days[len(d.Days)-1].Date)
		ty, tm, td := now.In(FleetTZ).Date()
		today := time.Date(ty, tm, td, 0, 0, 0, 0, time.UTC)
		dayShift := int(today.Sub(last).Hours() / 24)
		var mrows, drows [][]any
		for _, day := range d.Days {
			t, _ := time.Parse("2006-01-02", day.Date)
			t = t.AddDate(0, 0, dayShift)
			mrows = append(mrows, []any{t, day.Miles, day.Gallons, day.FuelCost, day.IdleHours, day.OnTime, day.Trips, day.Alerts})
			for dp, cost := range day.ByDepot {
				drows = append(drows, []any{t, dp, cost})
			}
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"daily_metrics"}, []string{"day", "miles", "gallons", "fuel_cost",
			"idle_hours", "on_time", "trips", "alerts"}, pgx.CopyFromRows(mrows)); err != nil {
			return fmt.Errorf("copy daily_metrics: %w", err)
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"daily_depot_fuel"}, []string{"day", "depot", "fuel_cost"}, pgx.CopyFromRows(drows)); err != nil {
			return fmt.Errorf("copy daily_depot_fuel: %w", err)
		}
	}

	rows, err := tx.Query(ctx, `SELECT id FROM users`)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.Exec(ctx, defaultSettingsSQL, id); err != nil {
			return err
		}
	}
	ts := now.Format(time.RFC3339Nano)
	if _, err := tx.Exec(ctx, `INSERT INTO demo_meta (key, value) VALUES ('seeded_at', $1), ('clock_anchor', $1)`, ts); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// EnsureUserSettings inserts default settings for a user that has none.
func EnsureUserSettings(ctx context.Context, pool *pgxpool.Pool, userID int) error {
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM user_settings WHERE user_id = $1)`, userID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err := pool.Exec(ctx, defaultSettingsSQL, userID)
	return err
}

// AdvanceClock keeps the replayed dataset "live": every timestamp is moved forward by the time
// elapsed since the last run, and daily rollups roll over at local midnight. Real telematics
// data would arrive continuously; this demo replays a fixed seed instead.
func AdvanceClock(ctx context.Context, pool *pgxpool.Pool) (time.Duration, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var anchorS string
	if err := tx.QueryRow(ctx, `SELECT value FROM demo_meta WHERE key = 'clock_anchor' FOR UPDATE`).Scan(&anchorS); err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil
		}
		return 0, err
	}
	anchor, err := time.Parse(time.RFC3339Nano, anchorS)
	if err != nil {
		return 0, err
	}
	now := time.Now().UTC()
	delta := now.Sub(anchor)
	if delta < 15*time.Second {
		return 0, nil
	}
	iv := fmt.Sprintf("%d microseconds", delta.Microseconds())
	stmts := []string{
		`UPDATE vehicles SET last_seen = last_seen + $1::interval, created_at = created_at + $1::interval`,
		`UPDATE trips SET started_at = started_at + $1::interval`,
		`UPDATE trip_stops SET arrive_at = arrive_at + $1::interval, depart_at = depart_at + $1::interval`,
		`UPDATE fuel_readings SET recorded_at = recorded_at + $1::interval`,
		`UPDATE vehicle_events SET at = at + $1::interval`,
		`UPDATE service_records SET serviced_at = serviced_at + $1::interval`,
		`UPDATE alerts SET at = at + $1::interval, acknowledged_at = acknowledged_at + $1::interval`,
	}
	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s, iv); err != nil {
			return 0, err
		}
	}
	ty, tm, td := now.In(FleetTZ).Date()
	today := time.Date(ty, tm, td, 0, 0, 0, 0, time.UTC)
	var lastDay *time.Time
	if err := tx.QueryRow(ctx, `SELECT max(day) FROM daily_metrics`).Scan(&lastDay); err != nil {
		return 0, err
	}
	if lastDay != nil {
		if n := int(today.Sub(*lastDay).Hours() / 24); n > 0 {
			if _, err := tx.Exec(ctx, `SET CONSTRAINTS daily_metrics_pk, daily_depot_fuel_pk DEFERRED`); err != nil {
				return 0, err
			}
			if _, err := tx.Exec(ctx, `UPDATE daily_metrics SET day = day + $1::int`, n); err != nil {
				return 0, err
			}
			if _, err := tx.Exec(ctx, `UPDATE daily_depot_fuel SET day = day + $1::int`, n); err != nil {
				return 0, err
			}
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE demo_meta SET value = $1 WHERE key = 'clock_anchor'`, now.Format(time.RFC3339Nano)); err != nil {
		return 0, err
	}
	return delta, tx.Commit(ctx)
}

// ResetDue reports whether the last seed is older than every.
func ResetDue(ctx context.Context, pool *pgxpool.Pool, every time.Duration) (bool, error) {
	var v string
	err := pool.QueryRow(ctx, `SELECT value FROM demo_meta WHERE key = 'seeded_at'`).Scan(&v)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return true, nil
	}
	return time.Since(t) >= every, nil
}
