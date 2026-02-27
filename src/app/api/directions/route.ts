import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/directions?originLng=...&originLat=...&destLng=...&destLat=...&profile=driving-traffic
 *
 * Proxies the Mapbox Directions API so the token stays server-side.
 * Returns the full Mapbox response (routes with geometry, duration, distance, etc.).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const originLng = sp.get("originLng");
  const originLat = sp.get("originLat");
  const destLng = sp.get("destLng");
  const destLat = sp.get("destLat");
  const profile = sp.get("profile") || "driving-traffic";

  if (!originLng || !originLat || !destLng || !destLat) {
    return NextResponse.json(
      { error: "Missing required query parameters: originLng, originLat, destLng, destLat" },
      { status: 400 },
    );
  }

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "MAPBOX_ACCESS_TOKEN is not configured on the server" },
      { status: 500 },
    );
  }

  const coordinates = `${originLng},${originLat};${destLng},${destLat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}?geometries=geojson&overview=full&steps=true&annotations=congestion,duration&access_token=${token}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message || "Mapbox Directions API error" },
        { status: res.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Directions API fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch directions" }, { status: 500 });
  }
}
