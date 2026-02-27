# Local Database (`data/`)

This directory holds the SQLite database used to cache API responses.

## Files

| File | Tracked? | Description |
|---|---|---|
| `qterra.db` | **No** (git-ignored) | Auto-created on first API call. Stores geocode results, place details, photos, and directions. |
| `README.md` | Yes | This file. |

## Schema

The database is auto-migrated on first connection (see `src/lib/db.ts`). It creates four tables:

### `geocode_results`
Stores every geocoding API response so you can replay searches offline.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `query` | TEXT | The search string (e.g. "Tokyo") |
| `provider` | TEXT | `google` or `mapquest` |
| `results` | TEXT (JSON) | Normalised array of `{ lat, lng, name, fullAddress }` |
| `raw` | TEXT (JSON) | Full raw API response |
| `created_at` | TEXT | ISO 8601 timestamp |

### `places`
Stores Google Places details for looked-up coordinates.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `lat` / `lng` | REAL | Coordinates of the query |
| `place_id` | TEXT | Google Place ID |
| `name` | TEXT | Place name |
| `address` | TEXT | Formatted address |
| `phone` | TEXT | Formatted phone number |
| `website` | TEXT | Website URL |
| `maps_url` | TEXT | Google Maps link |
| `hours` | TEXT (JSON) | `weekday_text` array |
| `is_open` | INTEGER | 1 = open, 0 = closed, NULL = unknown |
| `photo_ref` | TEXT | Google photo reference string |
| `raw` | TEXT (JSON) | Full raw API response (nearby + details) |
| `created_at` | TEXT | ISO 8601 timestamp |

### `place_photos`
Binary photo cache — avoids re-fetching images from Google.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `photo_ref` | TEXT UNIQUE | Google photo reference |
| `content_type` | TEXT | MIME type (e.g. `image/jpeg`) |
| `data` | BLOB | Raw image bytes |
| `created_at` | TEXT | ISO 8601 timestamp |

### `directions`
Stores Mapbox Directions API responses.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `origin_lat` / `origin_lng` | REAL | Route origin |
| `dest_lat` / `dest_lng` | REAL | Route destination |
| `profile` | TEXT | e.g. `driving-traffic`, `walking` |
| `response` | TEXT (JSON) | Full Mapbox response |
| `created_at` | TEXT | ISO 8601 timestamp |

## Getting Started

The database file is created **automatically** the first time any API route is hit — no manual setup required. Just start the dev server:

```bash
npm run dev
```

Then search for a location and `data/qterra.db` will appear.

## Inspecting the Database

You can browse the database with any SQLite client:

```bash
# CLI (ships with macOS / most Linux distros)
sqlite3 data/qterra.db ".tables"
sqlite3 data/qterra.db "SELECT * FROM geocode_results ORDER BY created_at DESC LIMIT 5;"

# Or use a GUI like DB Browser for SQLite, TablePlus, etc.
```

## Resetting

Delete the file to start fresh:

```bash
rm data/qterra.db
```

It will be recreated on the next API call.
