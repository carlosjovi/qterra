import { NextRequest, NextResponse } from "next/server";
import type { Flight } from "@/lib/types";

/**
 * GET /api/flights
 *
 * Proxies the OpenSky Network "all state vectors" endpoint so the secret
 * credentials stay on the server.
 *
 * Auth: OAuth2 client credentials flow — exchanges client_id / client_secret
 * for a short-lived Bearer token, then uses it to call the API.
 *
 * Optional query params:
 *   lamin, lamax, lomin, lomax – bounding box to limit results
 */

const OPENSKY_URL = "https://opensky-network.org/api/states/all";
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// ── In-memory token cache so we don't re-auth on every request ──
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // unix ms

async function getAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  // Return cached token if still valid (with 60 s margin)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    console.error("[OpenSky] token request failed:", res.status, await res.text().catch(() => ""));
    cachedToken = null;
    return null;
  }

  const json = await res.json();
  cachedToken = json.access_token ?? null;
  // expires_in is seconds; default to 30 min if missing
  const expiresIn = (json.expires_in ?? 1800) * 1000;
  tokenExpiresAt = Date.now() + expiresIn;
  return cachedToken;
}

export async function GET(req: NextRequest) {
  const clientId = process.env.OPENSKY_CLIENT_ID ?? "";
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET ?? "";

  // Build URL with optional bounding-box params
  const { searchParams } = req.nextUrl;
  const url = new URL(OPENSKY_URL);
  for (const key of ["lamin", "lamax", "lomin", "lomax"]) {
    const v = searchParams.get(key);
    if (v) url.searchParams.set(key, v);
  }

  const headers: HeadersInit = {
    Accept: "application/json",
  };

  // Obtain a Bearer token via OAuth2 client credentials flow
  if (clientId && clientSecret) {
    const token = await getAccessToken(clientId, clientSecret);
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  try {
    const res = await fetch(url.toString(), {
      headers,
      next: { revalidate: 10 }, // cache for 10 s at the edge
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `OpenSky responded ${res.status}`, detail: text },
        { status: res.status }
      );
    }

    const data = await res.json();

    // OpenSky returns { time, states: [ [icao24, callsign, origin_country, ...], ... ] }
    // Indices: 0 icao24, 1 callsign, 2 origin_country, 3 time_position,
    //          4 last_contact, 5 longitude, 6 latitude, 7 baro_altitude,
    //          8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate,
    //          12 sensors, 13 geo_altitude, 14 squawk, 15 spi,
    //          16 position_source, 17 category

    const flights: Flight[] = [];

    if (Array.isArray(data.states)) {
      for (const s of data.states) {
        // skip entries without a valid position
        if (s[6] == null || s[5] == null) continue;

        flights.push({
          icao24: s[0] ?? "",
          callsign: (s[1] ?? "").trim(),
          originCountry: s[2] ?? "",
          lat: s[6],
          lng: s[5],
          altitude: s[7] ?? s[13] ?? 0,
          velocity: s[9] ?? 0,
          heading: s[10] ?? 0,
          verticalRate: s[11] ?? 0,
          onGround: !!s[8],
          lastContact: s[4] ?? 0,
          squawk: s[14] ?? undefined,
          category: s[17] ?? 0,
        });
      }
    }

    return NextResponse.json({ time: data.time, count: flights.length, flights });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to fetch OpenSky data", detail: message }, { status: 502 });
  }
}
