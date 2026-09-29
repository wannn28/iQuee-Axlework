package api

import (
	"context"
	"encoding/csv"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/iquee/axlework/server/internal/auth"
)

const galL = 3.785411784

type Day struct {
	Date      string  `json:"date"`
	Miles     int     `json:"miles"`
	Gallons   int     `json:"gallons"`
	FuelCost  int     `json:"fuelCost"`
	IdleHours int     `json:"idleHours"`
	OnTime    float64 `json:"onTime"`
	Trips     int     `json:"trips"`
	Alerts    int     `json:"alerts"`
	PrevMiles *int    `json:"prevMiles"`
}

type Totals struct {
	Miles     int     `json:"miles"`
	Gallons   int     `json:"gallons"`
	FuelCost  int     `json:"fuelCost"`
	IdleHours int     `json:"idleHours"`
	Trips     int     `json:"trips"`
	Alerts    int     `json:"alerts"`
	OnTime    float64 `json:"onTime"` // average %
	MPG       float64 `json:"mpg"`
}

func rangeParam(r *http.Request) int {
	n, _ := strconv.Atoi(r.URL.Query().Get("range"))
	if n != 7 && n != 30 && n != 90 {
		n = 30
	}
	return n
}

// periodDays returns the last n*2 days: current period (ascending) and the previous one.
func (s *Server) periodDays(ctx context.Context, n int) (cur, prev []Day, err error) {
	rows, err := s.db.Query(ctx, `SELECT to_char(day, 'YYYY-MM-DD'), miles, gallons, fuel_cost, idle_hours, on_time::float8, trips, alerts
		FROM daily_metrics ORDER BY day DESC LIMIT $1`, n*2)
	if err != nil {
		return nil, nil, err
	}
	all, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Day, error) {
		var d Day
		return d, row.Scan(&d.Date, &d.Miles, &d.Gallons, &d.FuelCost, &d.IdleHours, &d.OnTime, &d.Trips, &d.Alerts)
	})
	if err != nil {
		return nil, nil, err
	}
	for i := len(all) - 1; i >= 0; i-- {
		if i < n {
			cur = append(cur, all[i])
		} else {
			prev = append(prev, all[i])
		}
	}
	for i := range cur {
		if i < len(prev) {
			m := prev[i].Miles
			cur[i].PrevMiles = &m
		}
	}
	return cur, prev, nil
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	n := rangeParam(r)
	cur, _, err := s.periodDays(ctx, n)
	if err != nil {
		s.internal(w, r, err)
		return
	}

	// period totals, aggregated by PostgreSQL
	totals := map[string]*Totals{"cur": {}, "prev": {}}
	rows, err := s.db.Query(ctx, `
		WITH d AS (SELECT *, row_number() OVER (ORDER BY day DESC) AS rn FROM daily_metrics)
		SELECT CASE WHEN rn <= $1 THEN 'cur' ELSE 'prev' END AS period,
		       sum(miles), sum(gallons), sum(fuel_cost), sum(idle_hours), sum(trips), sum(alerts), avg(on_time)::float8
		FROM d WHERE rn <= $1 * 2 GROUP BY 1`, n)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	for rows.Next() {
		var p string
		t := &Totals{}
		if err := rows.Scan(&p, &t.Miles, &t.Gallons, &t.FuelCost, &t.IdleHours, &t.Trips, &t.Alerts, &t.OnTime); err != nil {
			rows.Close()
			s.internal(w, r, err)
			return
		}
		if t.Gallons > 0 {
			t.MPG = float64(t.Miles) / float64(t.Gallons)
		}
		totals[p] = t
	}
	rows.Close()
	pct := func(a, b float64) float64 {
		if b == 0 {
			return 0
		}
		return (a - b) / b * 100
	}
	c, p := totals["cur"], totals["prev"]
	delta := map[string]float64{
		"miles": pct(float64(c.Miles), float64(p.Miles)), "gallons": pct(float64(c.Gallons), float64(p.Gallons)),
		"fuelCost": pct(float64(c.FuelCost), float64(p.FuelCost)), "idleHours": pct(float64(c.IdleHours), float64(p.IdleHours)),
		"mpg": pct(c.MPG, p.MPG), "onTimePts": c.OnTime - p.OnTime,
	}

	// fuel spend per depot over the period, joined with current unit counts
	rows, err = s.db.Query(ctx, `
		SELECT dp.name, COALESCE(f.cost, 0)::int, COALESCE(u.units, 0)::int
		FROM depots dp
		LEFT JOIN (SELECT depot, sum(fuel_cost) AS cost FROM daily_depot_fuel
		           WHERE day > (SELECT max(day) FROM daily_metrics) - $1::int GROUP BY depot) f ON f.depot = dp.name
		LEFT JOIN (SELECT depot, count(*) AS units FROM vehicles GROUP BY depot) u ON u.depot = dp.name
		ORDER BY 2 DESC`, n)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	type depotRow struct {
		Depot   string  `json:"depot"`
		Cost    int     `json:"cost"`
		Units   int     `json:"units"`
		PerUnit float64 `json:"perUnit"`
	}
	depots, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (depotRow, error) {
		var d depotRow
		err := row.Scan(&d.Depot, &d.Cost, &d.Units)
		if d.Units > 0 {
			d.PerUnit = float64(d.Cost) / float64(d.Units)
		}
		return d, err
	})
	if err != nil {
		s.internal(w, r, err)
		return
	}

	counts, total, err := s.statusCounts(ctx)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	type statusRow struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	}
	status := make([]statusRow, 0, len(Statuses))
	for _, st := range Statuses {
		status = append(status, statusRow{st, counts[st]})
	}

	// efficiency watchlist: furthest below the per-type target, computed in SQL
	rows, err = s.db.Query(ctx, `
		WITH t(type, target) AS (VALUES ('Tractor', 7.2), ('Box truck', 10.5), ('Reefer', 8.8), ('Cargo van', 17.0), ('Pickup', 17.5))
		SELECT v.id, v.year, v.make, v.model, d.name, v.depot, v.type, v.mpg::float8, t.target::float8,
		       ((v.mpg - t.target) / t.target)::float8 AS gap
		FROM vehicles v JOIN t ON t.type = v.type LEFT JOIN drivers d ON d.id = v.driver_id
		WHERE v.status <> 'maintenance'
		ORDER BY gap ASC, v.id LIMIT 6`)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	type watchRow struct {
		ID     string  `json:"id"`
		Year   int     `json:"year"`
		Make   string  `json:"make"`
		Model  string  `json:"model"`
		Driver *string `json:"driver"`
		Depot  string  `json:"depot"`
		Type   string  `json:"type"`
		MPG    float64 `json:"mpg"`
		Target float64 `json:"target"`
		Gap    float64 `json:"gap"`
	}
	watch, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (watchRow, error) {
		var x watchRow
		return x, row.Scan(&x.ID, &x.Year, &x.Make, &x.Model, &x.Driver, &x.Depot, &x.Type, &x.MPG, &x.Target, &x.Gap)
	})
	if err != nil {
		s.internal(w, r, err)
		return
	}
	var depotCount int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM depots`).Scan(&depotCount)

	writeJSON(w, http.StatusOK, map[string]any{
		"range": n, "updatedAt": time.Now().UTC(), "vehicleCount": total, "depotCount": depotCount,
		"totals": map[string]any{"current": c, "previous": p}, "deltaPct": delta,
		"days": cur, "depots": depots, "status": status, "watchlist": watch,
	})
}

func (s *Server) dailyCSV(w http.ResponseWriter, r *http.Request) {
	n := rangeParam(r)
	metric := r.URL.Query().Get("units") == "metric"
	cur, _, err := s.periodDays(r.Context(), n)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="axlework-daily-%dd.csv"`, n))
	w.Header().Set("X-Row-Count", strconv.Itoa(len(cur)))
	cw := csv.NewWriter(w)
	dc, vc := "distance_mi", "fuel_gal"
	if metric {
		dc, vc = "distance_km", "fuel_L"
	}
	_ = cw.Write([]string{"date", dc, vc, "fuel_cost_usd", "idle_hours", "trips", "on_time_pct", "alerts"})
	for _, d := range cur {
		dist, vol := float64(d.Miles), float64(d.Gallons)
		if metric {
			dist, vol = dist*miKm, vol*galL
		}
		_ = cw.Write([]string{d.Date, strconv.Itoa(int(math.Round(dist))), strconv.Itoa(int(math.Round(vol))), strconv.Itoa(d.FuelCost),
			strconv.Itoa(d.IdleHours), strconv.Itoa(d.Trips), strconv.FormatFloat(d.OnTime, 'f', 1, 64), strconv.Itoa(d.Alerts)})
	}
	cw.Flush()
}

// ---------- alerts ----------

type Alert struct {
	ID           string    `json:"id"`
	VehicleID    string    `json:"vehicleId"`
	Kind         string    `json:"kind"`
	Severity     string    `json:"severity"`
	At           time.Time `json:"at"`
	Text         string    `json:"text"`
	Acknowledged bool      `json:"acknowledged"`
}

func (s *Server) listAlerts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	cond := ""
	switch q.Get("status") {
	case "open":
		cond = " WHERE NOT acknowledged"
	case "acknowledged":
		cond = " WHERE acknowledged"
	}
	rows, err := s.db.Query(ctx, `SELECT id, vehicle_id, kind, severity, at, text, acknowledged FROM alerts`+cond+
		` ORDER BY at DESC, id LIMIT $1`, limit)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Alert, error) {
		var a Alert
		return a, row.Scan(&a.ID, &a.VehicleID, &a.Kind, &a.Severity, &a.At, &a.Text, &a.Acknowledged)
	})
	if err != nil {
		s.internal(w, r, err)
		return
	}
	var open, total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE NOT acknowledged), count(*) FROM alerts`).Scan(&open, &total); err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "open": open, "total": total})
}

func (s *Server) ackAlert(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	uid, _ := auth.UserID(ctx)
	var a Alert
	err := s.db.QueryRow(ctx, `UPDATE alerts SET acknowledged = TRUE,
		acknowledged_at = COALESCE(acknowledged_at, now()), acknowledged_by = COALESCE(acknowledged_by, NULLIF($2, 0))
		WHERE id = $1 RETURNING id, vehicle_id, kind, severity, at, text, acknowledged`, id, uid).Scan(
		&a.ID, &a.VehicleID, &a.Kind, &a.Severity, &a.At, &a.Text, &a.Acknowledged)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "not_found", "Alert not found.", nil)
		return
	}
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}
