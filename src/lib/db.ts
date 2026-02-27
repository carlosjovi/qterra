import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/* ------------------------------------------------------------------ */
/*  SQLite database – stores API responses for caching / dev reuse    */
/* ------------------------------------------------------------------ */

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "qterra.db");

// Ensure the data/ directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

/**
 * Singleton database connection.
 * WAL mode is used for better concurrent read performance.
 */
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

/* ------------------------------------------------------------------ */
/*  Schema / Migrations                                                */
/* ------------------------------------------------------------------ */

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS geocode_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      query       TEXT    NOT NULL,
      provider    TEXT    NOT NULL,              -- 'google' | 'mapquest'
      results     TEXT    NOT NULL DEFAULT '[]', -- JSON array of result objects
      raw         TEXT,                          -- full raw API response JSON
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_geocode_query
      ON geocode_results(query);

    CREATE TABLE IF NOT EXISTS places (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      lat         REAL    NOT NULL,
      lng         REAL    NOT NULL,
      place_id    TEXT,
      name        TEXT,
      address     TEXT,
      phone       TEXT,
      website     TEXT,
      maps_url    TEXT,
      hours       TEXT,                          -- JSON array of weekday_text
      is_open     INTEGER,                       -- 0 / 1 / NULL
      photo_ref   TEXT,
      raw         TEXT,                          -- full raw API response JSON
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_places_coords
      ON places(lat, lng);

    CREATE INDEX IF NOT EXISTS idx_places_place_id
      ON places(place_id);

    CREATE TABLE IF NOT EXISTS place_photos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_ref    TEXT    NOT NULL UNIQUE,
      content_type TEXT    NOT NULL DEFAULT 'image/jpeg',
      data         BLOB    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS directions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_lat  REAL    NOT NULL,
      origin_lng  REAL    NOT NULL,
      dest_lat    REAL    NOT NULL,
      dest_lng    REAL    NOT NULL,
      profile     TEXT    NOT NULL DEFAULT 'driving-traffic',
      response    TEXT    NOT NULL,               -- full Mapbox response JSON
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_directions_coords
      ON directions(origin_lat, origin_lng, dest_lat, dest_lng, profile);

    CREATE TABLE IF NOT EXISTS saved_points (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT    NOT NULL,
      lat         REAL    NOT NULL,
      lng         REAL    NOT NULL,
      color       TEXT    DEFAULT '#ffcc00',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_saved_points_coords
      ON saved_points(lat, lng);
  `);
}

/* ================================================================== */
/*  Repository helpers                                                 */
/* ================================================================== */

// ── Geocode ──────────────────────────────────────────────────────────

export interface GeocodeCacheRow {
  id: number;
  query: string;
  provider: string;
  results: string; // JSON
  raw: string | null;
  created_at: string;
}

export function saveGeocodeResult(
  query: string,
  provider: "google" | "mapquest",
  results: unknown[],
  raw?: unknown,
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO geocode_results (query, provider, results, raw)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(query, provider, JSON.stringify(results), raw ? JSON.stringify(raw) : null);
}

export function findGeocodeResult(query: string): GeocodeCacheRow | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM geocode_results WHERE query = ? ORDER BY created_at DESC LIMIT 1`)
    .get(query) as GeocodeCacheRow | undefined;
}

export function getAllGeocodeResults(): GeocodeCacheRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM geocode_results ORDER BY created_at DESC`)
    .all() as GeocodeCacheRow[];
}

// ── Places ───────────────────────────────────────────────────────────

export interface PlaceCacheRow {
  id: number;
  lat: number;
  lng: number;
  place_id: string | null;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  hours: string | null;
  is_open: number | null;
  photo_ref: string | null;
  raw: string | null;
  created_at: string;
}

export function savePlaceResult(
  lat: number,
  lng: number,
  placeId: string | null,
  details: {
    name?: string;
    address?: string;
    phone?: string;
    website?: string;
    mapsUrl?: string;
    hours?: string[];
    isOpen?: boolean;
    photoRef?: string;
  },
  raw?: unknown,
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO places (lat, lng, place_id, name, address, phone, website, maps_url, hours, is_open, photo_ref, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    lat,
    lng,
    placeId,
    details.name ?? null,
    details.address ?? null,
    details.phone ?? null,
    details.website ?? null,
    details.mapsUrl ?? null,
    details.hours ? JSON.stringify(details.hours) : null,
    details.isOpen != null ? (details.isOpen ? 1 : 0) : null,
    details.photoRef ?? null,
    raw ? JSON.stringify(raw) : null,
  );
}

export function findPlaceByCoords(lat: number, lng: number): PlaceCacheRow | undefined {
  const db = getDb();
  // Match within ~100 m precision (≈0.001°)
  return db
    .prepare(
      `SELECT * FROM places
       WHERE abs(lat - ?) < 0.001 AND abs(lng - ?) < 0.001
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(lat, lng) as PlaceCacheRow | undefined;
}

export function getAllPlaces(): PlaceCacheRow[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM places ORDER BY created_at DESC`).all() as PlaceCacheRow[];
}

// ── Place Photos ─────────────────────────────────────────────────────

export interface PhotoCacheRow {
  id: number;
  photo_ref: string;
  content_type: string;
  data: Buffer;
  created_at: string;
}

export function savePlacePhoto(photoRef: string, contentType: string, data: Buffer) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO place_photos (photo_ref, content_type, data)
    VALUES (?, ?, ?)
  `);
  stmt.run(photoRef, contentType, data);
}

export function findPlacePhoto(photoRef: string): PhotoCacheRow | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM place_photos WHERE photo_ref = ?`)
    .get(photoRef) as PhotoCacheRow | undefined;
}

// ── Directions ───────────────────────────────────────────────────────

export interface DirectionsCacheRow {
  id: number;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  profile: string;
  response: string; // JSON
  created_at: string;
}

export function saveDirectionsResult(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  profile: string,
  response: unknown,
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO directions (origin_lat, origin_lng, dest_lat, dest_lng, profile, response)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(originLat, originLng, destLat, destLng, profile, JSON.stringify(response));
}

export function findDirectionsResult(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  profile: string,
): DirectionsCacheRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM directions
       WHERE abs(origin_lat - ?) < 0.0001
         AND abs(origin_lng - ?) < 0.0001
         AND abs(dest_lat - ?)   < 0.0001
         AND abs(dest_lng - ?)   < 0.0001
         AND profile = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(originLat, originLng, destLat, destLng, profile) as DirectionsCacheRow | undefined;
}

export function getAllDirections(): DirectionsCacheRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM directions ORDER BY created_at DESC`)
    .all() as DirectionsCacheRow[];
}

// ── Saved Points (Presets) ───────────────────────────────────────────

export interface SavedPointRow {
  id: number;
  label: string;
  lat: number;
  lng: number;
  color: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Upsert a saved point. If a point with the same coords (~0.0001°) exists,
 * update it; otherwise insert a new row. Returns the row id.
 */
export function saveSavedPoint(
  label: string,
  lat: number,
  lng: number,
  color?: string,
): number {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM saved_points
       WHERE abs(lat - ?) < 0.0001 AND abs(lng - ?) < 0.0001`,
    )
    .get(lat, lng) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE saved_points SET label = ?, color = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(label, color ?? "#ffcc00", existing.id);
    return existing.id;
  }

  const result = db
    .prepare(`INSERT INTO saved_points (label, lat, lng, color) VALUES (?, ?, ?, ?)`)
    .run(label, lat, lng, color ?? "#ffcc00");
  return Number(result.lastInsertRowid);
}

export function getAllSavedPoints(): SavedPointRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM saved_points ORDER BY created_at DESC`)
    .all() as SavedPointRow[];
}

export function updatePointLabelByCoords(
  lat: number,
  lng: number,
  label: string,
) {
  const db = getDb();
  db.prepare(
    `UPDATE saved_points SET label = ?, updated_at = datetime('now')
     WHERE abs(lat - ?) < 0.0001 AND abs(lng - ?) < 0.0001`,
  ).run(label, lat, lng);
}

export function deleteSavedPoint(id: number) {
  const db = getDb();
  db.prepare(`DELETE FROM saved_points WHERE id = ?`).run(id);
}

export function findSavedPointByCoords(
  lat: number,
  lng: number,
): SavedPointRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM saved_points
       WHERE abs(lat - ?) < 0.0001 AND abs(lng - ?) < 0.0001
       LIMIT 1`,
    )
    .get(lat, lng) as SavedPointRow | undefined;
}
