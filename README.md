# Qterra

**Qterra** is an interactive 3D globe explorer built with Next.js. Search for any location in the world, pin it on a rotating globe, draw animated arcs between points, and instantly pull up a real-time street-level route between two pins — complete with live traffic congestion colouring.

---

## Features

- **Interactive 3D Globe** — rendered with Three.js and `three-globe`, featuring a dark vector polygon aesthetic with a glowing amber atmosphere.
- **Location Search** — type any city, address, or landmark and drop a pin directly on the globe. Powered by Google Maps Geocoding (with automatic MapQuest fallback).
- **Animated Arcs** — sequential pins are connected with animated dashed arcs on the globe surface.
- **Camera Fly-To** — clicking a pinned location smoothly animates the camera to that point on the globe.
- **Route Map Overlay** — select two pins as origin and destination to reveal a Mapbox street-level map overlay showing the turn-by-turn route.
- **Live Traffic Congestion** — route segments are colour-coded by congestion level (green → yellow → orange → red).
- **Transport Modes** — switch between driving (with traffic), driving (without traffic), walking, and cycling.
- **Route Stats** — displays total distance (km / mi) and estimated travel time.
- **Auto-Rotation** — the globe auto-rotates on load; pause/resume with a button and adjust speed with a slider.
- **Quick Presets** — built-in one-click pins for major world cities, plus any location you save from the Point Detail pane appears as a custom preset in the sidebar — no API call required to place it.
- **Point Detail Pane** — click any pin to open a detail panel showing place name, address, phone, opening hours, website, a photo, a Street View embed, and a Google Maps link. Save a point to Quick Presets with one click.
- **Live Flight Tracking** — toggle the Flight Tracker to stream real-time aircraft positions from the OpenSky Network. Filter by country or callsign, see altitude / speed / vertical rate at a glance, and click any flight to fly the camera to its location on the globe.
- **Heading-Projected Arcs** — each airborne flight displays a dashed arc projected ~20 minutes ahead along its current heading and speed, giving a visual sense of direction and trajectory.
- **Airline Identification** — flights are automatically tagged with their airline name (e.g. "United", "Lufthansa", "Emirates") by matching the ICAO 3-letter callsign prefix against a built-in lookup table.
- **API Response Caching** — every Google Places lookup, photo, and geocoding result is cached in a local SQLite database. Repeat requests are served from the cache with zero external API calls (see [Local Database](#local-database)).
- **Token Security** — API keys are never exposed in source code; Mapbox Directions requests are proxied through Next.js API routes so the secret key stays server-side.

---

## Screenshots

![3D Globe with animated arc and Mapbox panel](public/screenshots/three-globe-arc-mapbox-panel.jpg)

![Mapbox GL JS routing overlay with live traffic congestion](public/screenshots/mapbox-gl-js-routing.jpg)

---

## Tech Stack

| Layer | Library / Tool |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Language | TypeScript 5 |
| 3D Rendering | [Three.js](https://threejs.org) + [React Three Fiber](https://r3f.docs.pmnd.rs) + [three-globe](https://github.com/vasturiano/three-globe) |
| Map Overlay | [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) |
| UI Components | [Radix UI Themes](https://www.radix-ui.com/themes) + [Radix Icons](https://www.radix-ui.com/icons) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Geocoding | Google Maps Geocoding API (+ MapQuest fallback) |
| Directions | Mapbox Directions API (server-side proxy) |
| Flight Tracking | [OpenSky Network](https://opensky-network.org) REST API (server-side proxy, OAuth2) |
| Local Database | [SQLite](https://sqlite.org) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |

---

## Prerequisites

- **Node.js** 18 or later ([download](https://nodejs.org))
- **npm** (comes with Node) or another package manager
- API keys for the services listed in [Environment Variables](#environment-variables)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/carlosjovi/qterra.git
cd qterra
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your API keys:

```bash
cp .env.example .env.local
```

Then open `.env.local` and add your keys (see [Environment Variables](#environment-variables) for where to get them).

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the globe.

---

## Environment Variables

All keys live in `.env.local`, which is **never committed** (covered by `.gitignore`). Use `.env.example` as a template.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | **Yes** | Public Mapbox token (`pk.*`) — rendered in the client bundle for the map overlay. |
| `MAPBOX_ACCESS_TOKEN` | **Yes** | Secret Mapbox token (`sk.*`) — used server-side only for the Directions API proxy. |
| `GOOGLE_MAPS_API_KEY` | Recommended | Server-side key for Geocoding API, Places Nearby Search, Place Details, and place photos. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Recommended | Client-side key used to embed the Google Street View iframe in the Point Detail pane. Can be the same key as above (restrict by HTTP referrer). |
| `MAPQUEST_API_KEY` | Optional | Fallback geocoder if Google is unavailable or not configured. |
| `OPENSKY_CLIENT_ID` | Optional | OAuth2 client ID for authenticated OpenSky API access (higher rate limits). |
| `OPENSKY_CLIENT_SECRET` | Optional | OAuth2 client secret for authenticated OpenSky API access. |

### Where to get each key

- **Mapbox tokens** → [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/). Create a *public* token and a separate *secret* token (grant it `styles:read` and `directions:read` scopes).
- **Google Maps API key** → [Google Cloud Console](https://console.cloud.google.com/). Enable the **Geocoding API**, **Places API**, and **Maps Embed API**, then create a restricted API key. Use the same key for both `GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, or create separate keys restricted by IP (server) and HTTP referrer (client) respectively.
- **MapQuest API key** → [developer.mapquest.com](https://developer.mapquest.com/) — free tier available.
- **OpenSky Network credentials** → [opensky-network.org](https://opensky-network.org/). Register for a free account, then create OAuth2 client credentials under your profile. Without credentials the API still works (anonymous access) but with stricter rate limits (≈ 100 requests/day vs. 4000 authenticated).

> **Note:** The app works without Google/MapQuest keys (geocoding simply returns no results). The route overlay requires both Mapbox tokens. The flight tracker works without OpenSky credentials (anonymous mode) but may hit rate limits with heavy use.

---

## Usage

1. **Search for a location** — type a city or address in the sidebar search box and press Enter or click the search button. The globe camera will fly to the pinned location.
2. **Add more pins** — repeat the search to add a second location. An animated arc is drawn between sequential pins.
3. **View point details** — click any pin label in the points list to open the Point Detail pane. It shows the nearest place's name, address, phone, hours, website, a photo, and a Street View embed. The first open fetches from Google; subsequent opens are served from the local cache.
4. **Save to Quick Presets** — inside the Point Detail pane, click **Save to Quick Presets** to persist the location. It then appears as an amber button in the Quick Presets section of the sidebar — click it any time to instantly re-pin that location with no API call.
5. **View a route** — once two or more pins are added, select an *Origin* and *Destination* from the dropdowns in the sidebar, then click **Get Route**. A Mapbox street-level map appears as an overlay panel.
6. **Switch transport mode** — use the mode buttons in the route overlay (car, car without traffic, walking, cycling) to re-fetch the route.
7. **Close the route** — click the × button in the route panel to dismiss it.
8. **Track live flights** — toggle the Flight Tracker switch in the sidebar. Aircraft positions are fetched from the OpenSky Network every 15 seconds. Use the country chips or the search box to filter flights, then click a flight to zoom the globe to its location. A projected trajectory arc shows the flight's estimated path over the next ~20 minutes.
9. **Control the globe** — use the Pause / Rotate button and the Speed slider to control auto-rotation. Click and drag the globe to manually orbit.

---

## Project Structure

```
data/
└── README.md                   # Database docs (qterra.db is git-ignored)
src/
├── app/
│   ├── layout.tsx              # Root layout — Radix Theme, fonts
│   ├── page.tsx                # Main page — state orchestration
│   ├── globals.css             # Tailwind + global overrides
│   └── api/
│       ├── geocode/route.ts    # Server-side geocoding proxy
│       ├── directions/route.ts # Server-side Mapbox Directions proxy
│       ├── flights/route.ts    # OpenSky Network flight data proxy (OAuth2)
│       └── places/
│           ├── route.ts        # Google Nearby + Place Details proxy
│           └── photo/route.ts  # Google Places photo proxy
├── components/
│   ├── Globe.tsx               # Three.js / three-globe canvas component
│   ├── CoordinatePanel.tsx     # Sidebar: search, pin list, route controls, presets, flights
│   ├── FlightsPanel.tsx        # Flight tracker: list, filters, airline badges
│   ├── PointDetailPane.tsx     # Overlay pane: place info, Street View, save to presets
│   └── MapboxRouteMap.tsx      # Mapbox GL overlay with route + congestion
└── lib/
    ├── db.ts                   # SQLite database layer (caching + persistence)
    └── types.ts                # Shared TypeScript interfaces
```

---

## Local Database

Qterra automatically caches every external API response in a local SQLite database (`data/qterra.db`). This minimises API quota consumption during development — once a location has been fetched, subsequent requests are served entirely from the local DB.

### What gets cached and when

| Cache | DB table | Hit condition | APIs saved |
|---|---|---|---|
| **Geocoding results** | `geocode_results` | Same search query string | Google Geocoding / MapQuest |
| **Place details** | `places` | Coordinates within ~100 m (±0.001°) | Google Nearby Search + Place Details (2 calls per lookup) |
| **Place photos** | `place_photos` | Exact `photo_reference` match | Google Places Photo |
| **Directions routes** | `directions_cache` | Same origin + destination coordinates | Mapbox Directions |
| **Saved presets** | `saved_points` | Loaded on sidebar mount | No API call — lat/lng stored directly |

### Cache behaviour by feature

- **Location search** — on first geocode the result is stored in `geocode_results`. Repeat searches for the same query string skip the external call entirely.
- **Point Detail pane** — when the pane opens, `/api/places` checks `places` for a row within ~100 m of the point's coordinates. On a cache hit the full place name, address, phone, hours, website, and photo reference are returned immediately without contacting Google. On a miss, the two-step Nearby Search → Place Details call is made and the result is persisted for next time.
- **Place photos** — `/api/places/photo` stores the raw image bytes in `place_photos` keyed by `photo_reference`. The photo is served from SQLite on every subsequent view (`Cache-Control: public, max-age=86400` is also set on the response).
- **Quick Presets (saved points)** — clicking "Save to Quick Presets" in the Point Detail pane writes the coordinate to `saved_points` via `POST /api/points`. The sidebar fetches this table on mount (and after each save), so preset buttons appear instantly — the globe and detail pane do not need to re-fetch anything from Google to use them.
- **Route overlay** — Mapbox Directions responses are cached in `directions_cache` by origin/destination coordinates, so the same route is never fetched twice.

### Notes

- The database file is **git-ignored** — only the `data/README.md` with schema documentation is committed.
- The DB is created automatically on the first API call; no manual setup or migrations are needed.
- To clear the cache and force fresh API calls, simply delete `data/qterra.db` — it will be recreated on the next request.

See [data/README.md](data/README.md) for the full schema reference and SQLite inspection tips.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server at `http://localhost:3000` |
| `npm run build` | Build the app for production |
| `npm run start` | Start the production server (requires `build` first) |
| `npm run lint` | Run ESLint across the codebase |

---

## Deployment

The easiest way to deploy Qterra is [Vercel](https://vercel.com):

1. Push the repo to GitHub.
2. Import the project in the Vercel dashboard.
3. Add your environment variables in **Settings → Environment Variables**.
4. Deploy — Vercel handles the Next.js build automatically.

For other platforms (Netlify, Railway, Render, Docker, etc.) any host that supports Node.js and environment variables will work. Run `npm run build && npm run start` to serve the production build.

---

## Contributing

Contributions are welcome! To get started:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m "feat: describe your change"`
4. Push the branch: `git push origin feature/your-feature-name`
5. Open a Pull Request.

Please make sure `npm run lint` passes before submitting.

---

## License

This project is open-source and available under the [MIT License](LICENSE).