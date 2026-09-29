-- Axlework schema (PostgreSQL 16)

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE depots (
    name  TEXT PRIMARY KEY,
    state CHAR(2) NOT NULL
);

CREATE TABLE drivers (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE vehicles (
    id              TEXT PRIMARY KEY CHECK (id ~ '^[A-Z]{2}-[0-9]{3,4}$'),
    plate           TEXT NOT NULL,
    vin             CHAR(17) NOT NULL UNIQUE,
    make            TEXT NOT NULL,
    model           TEXT NOT NULL,
    year            SMALLINT NOT NULL CHECK (year BETWEEN 1995 AND 2027),
    type            TEXT NOT NULL CHECK (type IN ('Tractor','Box truck','Reefer','Cargo van','Pickup')),
    depot           TEXT NOT NULL REFERENCES depots(name),
    driver_id       INT REFERENCES drivers(id) ON DELETE SET NULL,
    status          TEXT NOT NULL CHECK (status IN ('moving','idle','parked','maintenance','offline')),
    odometer        INT NOT NULL DEFAULT 0,
    fuel_level      NUMERIC(5,1) NOT NULL DEFAULT 80,
    tank_gal        INT NOT NULL CHECK (tank_gal BETWEEN 10 AND 400),
    mpg             NUMERIC(4,1) NOT NULL,
    speed           INT NOT NULL DEFAULT 0,
    location        TEXT NOT NULL DEFAULT '',
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
    imei            CHAR(15) NOT NULL UNIQUE,
    fuel_sensor     BOOLEAN NOT NULL DEFAULT TRUE,
    alerts          INT NOT NULL DEFAULT 0,
    health          INT NOT NULL DEFAULT 100,
    next_service_mi INT NOT NULL DEFAULT 15000,
    notes           TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 280),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_status_idx ON vehicles (status);
CREATE INDEX vehicles_depot_idx  ON vehicles (depot);
CREATE INDEX vehicles_type_idx   ON vehicles (type);

-- Current / last trip per vehicle, with the schematic-map geometry
CREATE TABLE trips (
    id           BIGSERIAL PRIMARY KEY,
    vehicle_id   TEXT NOT NULL UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    started_at   TIMESTAMPTZ NOT NULL,
    planned_mi   NUMERIC(7,1) NOT NULL,
    progress     NUMERIC(5,4) NOT NULL,
    active       BOOLEAN NOT NULL,
    current_x    DOUBLE PRECISION,
    current_y    DOUBLE PRECISION,
    today_miles  NUMERIC(7,1) NOT NULL DEFAULT 0,
    engine_hours NUMERIC(5,1) NOT NULL DEFAULT 0,
    idle_min     INT NOT NULL DEFAULT 0,
    max_speed    INT NOT NULL DEFAULT 0,
    score        INT NOT NULL DEFAULT 100
);

CREATE TABLE route_points (
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    driven  BOOLEAN NOT NULL,          -- false = planned path, true = driven so far
    seq     INT NOT NULL,
    x       DOUBLE PRECISION NOT NULL,
    y       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (trip_id, driven, seq)
);

CREATE TABLE trip_stops (
    trip_id   BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    seq       INT NOT NULL,
    x         DOUBLE PRECISION NOT NULL,
    y         DOUBLE PRECISION NOT NULL,
    label     TEXT NOT NULL,
    kind      TEXT NOT NULL CHECK (kind IN ('depot','delivery','fuel')),
    arrive_at TIMESTAMPTZ NOT NULL,
    depart_at TIMESTAMPTZ,
    PRIMARY KEY (trip_id, seq)
);

-- Tank-level sensor samples (15-minute resolution)
CREATE TABLE fuel_readings (
    id          BIGSERIAL PRIMARY KEY,
    vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL,
    level_pct   NUMERIC(5,1) NOT NULL CHECK (level_pct BETWEEN 0 AND 100)
);
CREATE INDEX fuel_readings_vehicle_time_idx ON fuel_readings (vehicle_id, recorded_at);

CREATE TABLE vehicle_events (
    id         BIGSERIAL PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    at         TIMESTAMPTZ NOT NULL,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX vehicle_events_vehicle_idx ON vehicle_events (vehicle_id, at DESC);

CREATE TABLE service_records (
    id         BIGSERIAL PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    serviced_at TIMESTAMPTZ NOT NULL,
    odometer   INT NOT NULL,
    work       TEXT NOT NULL,
    shop       TEXT NOT NULL,
    cost       INT NOT NULL
);
CREATE INDEX service_records_vehicle_idx ON service_records (vehicle_id, serviced_at DESC);

CREATE TABLE alerts (
    id              TEXT PRIMARY KEY,
    vehicle_id      TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('fuel_drop','overspeed','harsh_brake','geofence','idle','dtc','offline','low_fuel')),
    severity        TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
    at              TIMESTAMPTZ NOT NULL,
    text            TEXT NOT NULL,
    acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX alerts_at_idx ON alerts (at DESC);

-- Daily fleet-wide operations rollup (what a nightly ETL would produce)
CREATE TABLE daily_metrics (
    day        DATE NOT NULL,
    miles      INT NOT NULL,
    gallons    INT NOT NULL,
    fuel_cost  INT NOT NULL,
    idle_hours INT NOT NULL,
    on_time    NUMERIC(4,1) NOT NULL,
    trips      INT NOT NULL,
    alerts     INT NOT NULL,
    CONSTRAINT daily_metrics_pk PRIMARY KEY (day) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE daily_depot_fuel (
    day       DATE NOT NULL,
    depot     TEXT NOT NULL REFERENCES depots(name),
    fuel_cost INT NOT NULL,
    CONSTRAINT daily_depot_fuel_pk PRIMARY KEY (day, depot) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE user_settings (
    user_id       INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    company       TEXT NOT NULL,
    timezone      TEXT NOT NULL,
    units         TEXT NOT NULL CHECK (units IN ('imperial','metric')),
    fuel_price    NUMERIC(5,2) NOT NULL,
    idle_limit    INT NOT NULL,
    speed_limit   INT NOT NULL,
    fuel_drop_gal INT NOT NULL,
    notify_email  BOOLEAN NOT NULL,
    notify_sms    BOOLEAN NOT NULL,
    daily_digest  BOOLEAN NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Key/value bookkeeping for the demo (seed anchor, last reset)
CREATE TABLE demo_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
