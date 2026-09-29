package api

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	Statuses    = []string{"moving", "idle", "parked", "maintenance", "offline"}
	Types       = []string{"Tractor", "Box truck", "Reefer", "Cargo van", "Pickup"}
	statusLabel = map[string]string{"moving": "Moving", "idle": "Idling", "parked": "Parked", "maintenance": "In service", "offline": "No signal"}
	defaultMPG  = map[string]float64{"Tractor": 7, "Box truck": 10.5, "Reefer": 8.8, "Cargo van": 16.8, "Pickup": 17.2}
)

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
	UpdatedAt     time.Time `json:"updatedAt"`
}

const vehicleCols = `v.id, v.plate, v.vin, v.make, v.model, v.year, v.type, v.depot, d.name, v.status, v.odometer,
	v.fuel_level::float8, v.tank_gal, v.mpg::float8, v.speed, v.location, v.last_seen, v.imei, v.fuel_sensor, v.alerts,
	v.health, v.next_service_mi, v.notes, v.created_at, v.updated_at`
const vehicleFrom = ` FROM vehicles v LEFT JOIN drivers d ON d.id = v.driver_id`

func scanVehicle(row pgx.Row) (Vehicle, error) {
	var v Vehicle
	err := row.Scan(&v.ID, &v.Plate, &v.VIN, &v.Make, &v.Model, &v.Year, &v.Type, &v.Depot, &v.Driver, &v.Status, &v.Odometer,
		&v.FuelLevel, &v.TankGal, &v.MPG, &v.Speed, &v.Location, &v.LastSeen, &v.IMEI, &v.FuelSensor, &v.Alerts,
		&v.Health, &v.NextServiceMi, &v.Notes, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}

// ---------- list / filter / sort / paginate (all in SQL) ----------

var sortExpr = map[string]string{
	"id":        "v.id",
	"vehicle":   "v.make || ' ' || v.model",
	"status":    "array_position(ARRAY['moving','idle','parked','maintenance','offline'], v.status)",
	"driver":    "COALESCE(d.name, '~')",
	"depot":     "v.depot",
	"fuelLevel": "v.fuel_level",
	"odometer":  "v.odometer",
	"mpg":       "v.mpg",
	"lastSeen":  "v.last_seen",
	"alerts":    "v.alerts",
}

type filter struct {
	where string
	args  []any
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func buildFilter(r *http.Request) filter {
	q := r.URL.Query()
	var conds []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "?", "$"+strconv.Itoa(len(args))))
	}
	if st := q.Get("status"); contains(Statuses, st) {
		add("v.status = ?", st)
	}
	if dp := q.Get("depot"); dp != "" {
		add("v.depot = ?", dp)
	}
	if t := q.Get("type"); contains(Types, t) {
		add("v.type = ?", t)
	}
	if needle := strings.TrimSpace(q.Get("q")); needle != "" {
		esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(needle)
		add(`(v.id ILIKE ? OR v.plate ILIKE $X OR COALESCE(d.name,'') ILIKE $X OR v.make ILIKE $X OR v.model ILIKE $X
			OR v.location ILIKE $X OR v.vin ILIKE $X)`, "%"+esc+"%")
		conds[len(conds)-1] = strings.ReplaceAll(conds[len(conds)-1], "$X", "$"+strconv.Itoa(len(args)))
	}
	if ids := strings.TrimSpace(q.Get("ids")); ids != "" {
		add("v.id = ANY(?)", strings.Split(ids, ","))
	}
	w := ""
	if len(conds) > 0 {
		w = " WHERE " + strings.Join(conds, " AND ")
	}
	return filter{where: w, args: args}
}

func orderBy(r *http.Request) string {
	q := r.URL.Query()
	key := q.Get("sort")
	expr, ok := sortExpr[key]
	if !ok {
		key, expr = "id", sortExpr["id"]
	}
	dir := q.Get("dir")
	if dir != "asc" && dir != "desc" {
		dir = "asc"
		if key == "alerts" {
			dir = "desc"
		}
	}
	// "lastSeen ascending" means most recently seen first, as in the original UI
	if key == "lastSeen" {
		dir = map[string]string{"asc": "desc", "desc": "asc"}[dir]
	}
	return fmt.Sprintf(" ORDER BY %s %s, v.id ASC", expr, strings.ToUpper(dir))
}

func (s *Server) listVehicles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	size, _ := strconv.Atoi(q.Get("size"))
	if size != 10 && size != 25 && size != 50 && size != 100 {
		size = 25
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	f := buildFilter(r)
	var total int
	if err := s.db.QueryRow(ctx, "SELECT count(*)"+vehicleFrom+f.where, f.args...).Scan(&total); err != nil {
		s.internal(w, r, err)
		return
	}
	pages := int(math.Max(1, math.Ceil(float64(total)/float64(size))))
	if page > pages {
		page = pages
	}
	args := append(append([]any{}, f.args...), size, (page-1)*size)
	sql := "SELECT " + vehicleCols + vehicleFrom + f.where + orderBy(r) +
		fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(f.args)+1, len(f.args)+2)
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Vehicle, error) { return scanVehicle(row) })
	if err != nil {
		s.internal(w, r, err)
		return
	}
	counts, fleetTotal, err := s.statusCounts(ctx)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": page, "size": size, "pages": pages,
		"counts": counts, "fleetTotal": fleetTotal,
	})
}

func (s *Server) statusCounts(ctx context.Context) (map[string]int, int, error) {
	counts := map[string]int{}
	for _, st := range Statuses {
		counts[st] = 0
	}
	rows, err := s.db.Query(ctx, `SELECT status, count(*) FROM vehicles GROUP BY status`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	total := 0
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, 0, err
		}
		counts[st] = n
		total += n
	}
	return counts, total, rows.Err()
}

func (s *Server) fleetSummary(w http.ResponseWriter, r *http.Request) {
	counts, total, err := s.statusCounts(r.Context())
	if err != nil {
		s.internal(w, r, err)
		return
	}
	var open int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM alerts WHERE NOT acknowledged`).Scan(&open); err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "counts": counts, "openAlerts": open})
}

// ---------- CSV export (server-rendered, respects filters and units) ----------

const (
	miKm = 1.609344
)

func (s *Server) exportVehicles(w http.ResponseWriter, r *http.Request) {
	metric := r.URL.Query().Get("units") == "metric"
	f := buildFilter(r)
	rows, err := s.db.Query(r.Context(), "SELECT "+vehicleCols+vehicleFrom+f.where+orderBy(r), f.args...)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Vehicle, error) { return scanVehicle(row) })
	if err != nil {
		s.internal(w, r, err)
		return
	}
	label := r.URL.Query().Get("label")
	if label != "selected" {
		label = "filtered"
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="axlework-vehicles-%s.csv"`, label))
	w.Header().Set("X-Row-Count", strconv.Itoa(len(list)))
	cw := csv.NewWriter(w)
	odoCol, effCol := "odometer_mi", "mpg"
	if metric {
		odoCol, effCol = "odometer_km", "L_per_100km"
	}
	_ = cw.Write([]string{"unit", "plate", "vin", "year", "make", "model", "type", "depot", "driver", "status", "fuel_pct", "tank_gal",
		odoCol, effCol, "location", "last_seen", "open_alerts", "gps_imei"})
	for _, v := range list {
		odo, eff := float64(v.Odometer), v.MPG
		if metric {
			odo, eff = odo*miKm, 235.215/v.MPG
		}
		drv := ""
		if v.Driver != nil {
			drv = *v.Driver
		}
		_ = cw.Write([]string{v.ID, v.Plate, v.VIN, strconv.Itoa(v.Year), v.Make, v.Model, v.Type, v.Depot, drv, statusLabel[v.Status],
			strconv.FormatFloat(v.FuelLevel, 'f', -1, 64), strconv.Itoa(v.TankGal), strconv.Itoa(int(math.Round(odo))),
			strconv.FormatFloat(math.Round(eff*10)/10, 'f', -1, 64), v.Location, v.LastSeen.UTC().Format(time.RFC3339),
			strconv.Itoa(v.Alerts), v.IMEI})
	}
	cw.Flush()
}

// ---------- single vehicle CRUD ----------

func (s *Server) findVehicle(ctx context.Context, id string) (Vehicle, error) {
	return scanVehicle(s.db.QueryRow(ctx, "SELECT "+vehicleCols+vehicleFrom+" WHERE v.id = $1", id))
}

func (s *Server) getVehicle(w http.ResponseWriter, r *http.Request) {
	v, err := s.findVehicle(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found", "Vehicle not found.", nil)
		return
	}
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

type vehicleInput struct {
	ID         string  `json:"id"`
	Plate      string  `json:"plate"`
	VIN        string  `json:"vin"`
	Make       string  `json:"make"`
	Model      string  `json:"model"`
	Year       int     `json:"year"`
	Type       string  `json:"type"`
	Depot      string  `json:"depot"`
	Driver     *string `json:"driver"`
	TankGal    float64 `json:"tankGal"`
	IMEI       string  `json:"imei"`
	FuelSensor bool    `json:"fuelSensor"`
	Notes      string  `json:"notes"`
}

var (
	idRe   = regexp.MustCompile(`^[A-Z]{2}-\d{3,4}$`)
	vinRe  = regexp.MustCompile(`^[A-HJ-NPR-Z0-9]{17}$`)
	imeiRe = regexp.MustCompile(`^\d{15}$`)
)

// validate mirrors the frontend form rules; the database constraints are the last line of defence.
func (s *Server) validate(ctx context.Context, in *vehicleInput, editingID string) (map[string]string, error) {
	in.ID = strings.ToUpper(strings.TrimSpace(in.ID))
	in.Plate = strings.ToUpper(strings.TrimSpace(in.Plate))
	in.VIN = strings.ToUpper(strings.TrimSpace(in.VIN))
	in.Make, in.Model, in.IMEI, in.Notes = strings.TrimSpace(in.Make), strings.TrimSpace(in.Model), strings.TrimSpace(in.IMEI), strings.TrimSpace(in.Notes)
	if in.Driver != nil && strings.TrimSpace(*in.Driver) == "" {
		in.Driver = nil
	}
	e := map[string]string{}
	switch {
	case in.ID == "":
		e["id"] = "Required."
	case !idRe.MatchString(in.ID):
		e["id"] = "Use the format HP-1234 (2 letters, dash, 3–4 digits)."
	}
	if l := len(in.Plate); l == 0 {
		e["plate"] = "Required."
	} else if l < 4 || l > 10 {
		e["plate"] = "Plates are 4–10 characters."
	}
	switch {
	case in.VIN == "":
		e["vin"] = "Required."
	case len(in.VIN) != 17:
		e["vin"] = fmt.Sprintf("VINs are exactly 17 characters (currently %d).", len(in.VIN))
	case strings.ContainsAny(in.VIN, "IOQ"):
		e["vin"] = "VINs never contain the letters I, O or Q."
	case !vinRe.MatchString(in.VIN):
		e["vin"] = "Letters and digits only."
	}
	if in.Make == "" || len(in.Make) > 40 {
		e["make"] = "Required."
	}
	if in.Model == "" || len(in.Model) > 60 {
		e["model"] = "Required."
	}
	if in.Year < 1995 || in.Year > 2027 {
		e["year"] = "Between 1995 and 2027."
	}
	if !contains(Types, in.Type) {
		e["type"] = "Choose a type."
	}
	if in.TankGal < 10 || in.TankGal > 400 {
		e["tankGal"] = "Between 10 and 400 gal."
	}
	if in.IMEI == "" {
		e["imei"] = "Required to receive GPS data."
	} else if !imeiRe.MatchString(in.IMEI) {
		e["imei"] = "IMEI is 15 digits (found on the tracker label)."
	}
	if n := len([]rune(in.Notes)); n > 280 {
		e["notes"] = fmt.Sprintf("Max 280 characters (%d).", n)
	}
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM depots WHERE name = $1)`, in.Depot).Scan(&ok); err != nil {
		return nil, err
	}
	if !ok {
		e["depot"] = "Choose a depot."
	}
	if in.Driver != nil {
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM drivers WHERE name = $1)`, *in.Driver).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			e["driver"] = "Unknown driver."
		}
	}
	if _, bad := e["id"]; !bad && editingID == "" {
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = $1)`, in.ID).Scan(&ok); err != nil {
			return nil, err
		}
		if ok {
			e["id"] = in.ID + " is already in the fleet."
		}
	}
	if _, bad := e["imei"]; !bad {
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM vehicles WHERE imei = $1 AND id <> $2)`, in.IMEI, editingID).Scan(&ok); err != nil {
			return nil, err
		}
		if ok {
			e["imei"] = "This tracker is already paired with another unit."
		}
	}
	if _, bad := e["vin"]; !bad {
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM vehicles WHERE vin = $1 AND id <> $2)`, in.VIN, editingID).Scan(&ok); err != nil {
			return nil, err
		}
		if ok {
			e["vin"] = "Another unit already has this VIN."
		}
	}
	return e, nil
}

func uniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

// schematic-map coordinates of each depot yard (same grid as the frontend map)
var depotPt = map[string][2]float64{"Tacoma": {250, 320}, "Portland": {180, 390}, "Spokane": {330, 250}, "Boise": {250, 250}, "Eugene": {180, 320}}

func (s *Server) createVehicle(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var in vehicleInput
	if !decode(w, r, &in) {
		return
	}
	errs, err := s.validate(ctx, &in, "")
	if err != nil {
		s.internal(w, r, err)
		return
	}
	if len(errs) > 0 {
		writeErr(w, http.StatusUnprocessableEntity, "validation", fmt.Sprintf("%d field(s) need attention.", len(errs)), errs)
		return
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	now := time.Now().UTC()
	const fuel = 80.0
	_, err = tx.Exec(ctx, `INSERT INTO vehicles (id, plate, vin, make, model, year, type, depot, driver_id, status, odometer,
		fuel_level, tank_gal, mpg, speed, location, last_seen, imei, fuel_sensor, alerts, health, next_service_mi, notes, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM drivers WHERE name = $9),'parked',0,$10,$11,$12,0,$13,$14,$15,$16,0,100,15000,$17,$14,$14)`,
		in.ID, in.Plate, in.VIN, in.Make, in.Model, in.Year, in.Type, in.Depot, in.Driver, fuel, int(math.Round(in.TankGal)),
		defaultMPG[in.Type], "Depot yard · "+in.Depot, now, in.IMEI, in.FuelSensor, in.Notes)
	if err != nil {
		if uniqueViolation(err) {
			writeErr(w, http.StatusConflict, "conflict", "A vehicle with this unit number, VIN or IMEI already exists.", nil)
			return
		}
		s.internal(w, r, err)
		return
	}
	// A freshly paired unit sits parked in its depot yard: one-stop "trip", a flat tank-level
	// series (if a sensor is fitted) and a pairing event, so the detail page has real rows to show.
	pt := depotPt[in.Depot]
	var tripID int64
	if err := tx.QueryRow(ctx, `INSERT INTO trips (vehicle_id, started_at, planned_mi, progress, active, current_x, current_y, score)
		VALUES ($1, $2, 0, 1, FALSE, $3, $4, 100) RETURNING id`, in.ID, now, pt[0], pt[1]).Scan(&tripID); err != nil {
		s.internal(w, r, err)
		return
	}
	if _, err := tx.Exec(ctx, `INSERT INTO route_points (trip_id, driven, seq, x, y) VALUES ($1, FALSE, 0, $2, $3), ($1, TRUE, 0, $2, $3)`, tripID, pt[0], pt[1]); err != nil {
		s.internal(w, r, err)
		return
	}
	if _, err := tx.Exec(ctx, `INSERT INTO trip_stops (trip_id, seq, x, y, label, kind, arrive_at) VALUES ($1, 0, $2, $3, $4, 'depot', $5)`,
		tripID, pt[0], pt[1], in.Depot+" depot", now); err != nil {
		s.internal(w, r, err)
		return
	}
	if in.FuelSensor {
		if _, err := tx.Exec(ctx, `INSERT INTO fuel_readings (vehicle_id, recorded_at, level_pct)
			SELECT $1, $2::timestamptz - (g * interval '15 minutes'), $3 FROM generate_series(0, 96) g`, in.ID, now, fuel); err != nil {
			s.internal(w, r, err)
			return
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vehicle_events (vehicle_id, at, kind, title, detail) VALUES ($1, $2, 'ignition', 'Tracker paired', $3)`,
		in.ID, now, "IMEI "+in.IMEI+" · waiting for first GPS packet"); err != nil {
		s.internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		s.internal(w, r, err)
		return
	}
	v, err := s.findVehicle(ctx, in.ID)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	s.log.Info("vehicle created", "id", v.ID)
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) updateVehicle(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	if _, err := s.findVehicle(ctx, id); errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found", "Vehicle not found.", nil)
		return
	} else if err != nil {
		s.internal(w, r, err)
		return
	}
	var in vehicleInput
	if !decode(w, r, &in) {
		return
	}
	in.ID = id // unit numbers are immutable
	errs, err := s.validate(ctx, &in, id)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	if len(errs) > 0 {
		writeErr(w, http.StatusUnprocessableEntity, "validation", fmt.Sprintf("%d field(s) need attention.", len(errs)), errs)
		return
	}
	_, err = s.db.Exec(ctx, `UPDATE vehicles SET plate=$2, vin=$3, make=$4, model=$5, year=$6, type=$7, depot=$8,
		driver_id=(SELECT id FROM drivers WHERE name = $9), tank_gal=$10, imei=$11, fuel_sensor=$12, notes=$13, updated_at=now()
		WHERE id=$1`, id, in.Plate, in.VIN, in.Make, in.Model, in.Year, in.Type, in.Depot, in.Driver, int(math.Round(in.TankGal)),
		in.IMEI, in.FuelSensor, in.Notes)
	if err != nil {
		if uniqueViolation(err) {
			writeErr(w, http.StatusConflict, "conflict", "VIN or IMEI already belongs to another unit.", nil)
			return
		}
		s.internal(w, r, err)
		return
	}
	if in.FuelSensor { // sensor newly fitted: start a flat series so the tank chart has data
		if _, err := s.db.Exec(ctx, `INSERT INTO fuel_readings (vehicle_id, recorded_at, level_pct)
			SELECT v.id, now() - (g * interval '15 minutes'), v.fuel_level FROM vehicles v, generate_series(0, 96) g
			WHERE v.id = $1 AND NOT EXISTS (SELECT 1 FROM fuel_readings f WHERE f.vehicle_id = v.id)`, id); err != nil {
			s.internal(w, r, err)
			return
		}
	}
	v, err := s.findVehicle(ctx, id)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	s.log.Info("vehicle updated", "id", id)
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) deleteVehicle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `DELETE FROM vehicles WHERE id = $1`, id)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "not_found", "Vehicle not found.", nil)
		return
	}
	s.log.Info("vehicle deleted", "id", id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) bulkDeleteVehicles(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []string `json:"ids"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.IDs) == 0 || len(in.IDs) > 500 {
		writeErr(w, http.StatusUnprocessableEntity, "validation", "Provide between 1 and 500 ids.", nil)
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM vehicles WHERE id = ANY($1)`, in.IDs)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	s.log.Info("vehicles deleted", "count", tag.RowsAffected())
	writeJSON(w, http.StatusOK, map[string]any{"deleted": tag.RowsAffected()})
}

// ---------- lookups ----------

func (s *Server) listDepots(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT dp.name, dp.state, count(v.id) FROM depots dp LEFT JOIN vehicles v ON v.depot = dp.name
		GROUP BY dp.name, dp.state ORDER BY array_position(ARRAY['Tacoma','Portland','Spokane','Boise','Eugene'], dp.name), dp.name`)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	type depot struct {
		Name  string `json:"name"`
		State string `json:"state"`
		Units int    `json:"units"`
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (depot, error) {
		var d depot
		return d, row.Scan(&d.Name, &d.State, &d.Units)
	})
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) listDrivers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT d.id, d.name, (SELECT v.id FROM vehicles v WHERE v.driver_id = d.id ORDER BY v.id LIMIT 1)
		FROM drivers d ORDER BY d.id`)
	if err != nil {
		s.internal(w, r, err)
		return
	}
	type driver struct {
		ID        int     `json:"id"`
		Name      string  `json:"name"`
		VehicleID *string `json:"vehicleId"`
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (driver, error) {
		var d driver
		return d, row.Scan(&d.ID, &d.Name, &d.VehicleID)
	})
	if err != nil {
		s.internal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
