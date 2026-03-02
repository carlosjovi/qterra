import { NextRequest, NextResponse } from "next/server";
import type { Satellite, SatelliteCategory } from "@/lib/types";

/**
 * GET /api/satellites
 *
 * Proxies N2YO's REST API so the API key stays server-side.
 * Responses for the "above" endpoint are cached in-memory for 60 s
 * to avoid exceeding N2YO's hourly transaction limit.
 *
 * Supported modes (via `mode` query param):
 *
 *   mode=above  (default)
 *     Returns satellites above a given lat/lng within a search radius.
 *     Query params: lat, lng, alt (km, default 0), radius (degrees, default 70),
 *                   category (N2YO category id, default 0 = all)
 *
 *   mode=positions
 *     Returns predicted positions for a single satellite.
 *     Query params: id (NORAD id), lat, lng, alt (observer), seconds (default 1)
 */

const N2YO_BASE = "https://api.n2yo.com/rest/v1/satellite";

/* ── In-memory response cache ── */
const CACHE_TTL_MS = 60_000; // 60 seconds
const cache = new Map<string, { data: any; ts: number }>();

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.N2YO_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "N2YO API key not configured (set N2YO_API_KEY)" },
      { status: 500 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") ?? "above";

  try {
    if (mode === "above") {
      return await handleAbove(sp, apiKey);
    } else if (mode === "positions") {
      return await handlePositions(sp, apiKey);
    } else {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[N2YO]", err);
    return NextResponse.json(
      { error: "N2YO request failed" },
      { status: 502 },
    );
  }
}

// ── mode=above (cached) ───────────────────────────────────────
async function handleAbove(sp: URLSearchParams, apiKey: string) {
  const lat = parseFloat(sp.get("lat") ?? "0");
  const lng = parseFloat(sp.get("lng") ?? "0");
  const alt = parseFloat(sp.get("alt") ?? "0");
  const radius = parseInt(sp.get("radius") ?? "70", 10);
  const category = parseInt(sp.get("category") ?? "0", 10) as SatelliteCategory;

  // Check in-memory cache first
  const cacheKey = `above:${lat}:${lng}:${alt}:${radius}:${category}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  // /above/{observerLat}/{observerLng}/{observerAlt}/{searchRadius}/{categoryId}
  const url = `${N2YO_BASE}/above/${lat}/${lng}/${alt}/${radius}/${category}?apiKey=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[N2YO above] upstream error:", res.status, text);
    return NextResponse.json({ error: `N2YO error ${res.status}` }, { status: 502 });
  }

  const data = await res.json();

  // N2YO returns { info: { ... }, above: [ ... ] }
  const rawSats: any[] = data.above ?? [];

  const satellites: Satellite[] = rawSats.map((s: any) => ({
    satid: s.satid,
    satname: (s.satname ?? "").trim(),
    intDesignator: s.intDesignator ?? undefined,
    launchDate: s.launchDate ?? undefined,
    lat: s.satlat,
    lng: s.satlng,
    altitude: s.satalt ?? 0,
    timestamp: Date.now() / 1000,
  }));

  const body = {
    count: satellites.length,
    category,
    satellites,
  };

  // Cache the successful response
  setCache(cacheKey, body);

  return NextResponse.json(body);
}

// ── mode=positions ────────────────────────────────────────────
async function handlePositions(sp: URLSearchParams, apiKey: string) {
  const id = sp.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing required param: id (NORAD catalog id)" }, { status: 400 });
  }

  const lat = parseFloat(sp.get("lat") ?? "0");
  const lng = parseFloat(sp.get("lng") ?? "0");
  const alt = parseFloat(sp.get("alt") ?? "0");
  const seconds = parseInt(sp.get("seconds") ?? "1", 10);

  // /positions/{id}/{observerLat}/{observerLng}/{observerAlt}/{seconds}
  const url = `${N2YO_BASE}/positions/${id}/${lat}/${lng}/${alt}/${seconds}?apiKey=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[N2YO positions] upstream error:", res.status, text);
    return NextResponse.json({ error: `N2YO error ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  const info = data.info ?? {};
  const rawPositions: any[] = data.positions ?? [];

  const positions: Satellite[] = rawPositions.map((p: any) => ({
    satid: info.satid ?? parseInt(id, 10),
    satname: (info.satname ?? "").trim(),
    lat: p.satlatitude,
    lng: p.satlongitude,
    altitude: p.sataltitude ?? 0,
    velocity: p.velocity ?? undefined,
    timestamp: p.timestamp,
  }));

  return NextResponse.json({
    satid: info.satid,
    satname: info.satname,
    positions,
  });
}
