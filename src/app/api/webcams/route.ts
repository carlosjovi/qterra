import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/webcams
 *
 * Proxies to the Windy Webcams API v3 to fetch webcams near a location
 * or within the visible bounding box of the map.
 *
 * Query params:
 *   lat, lng, radius (km)       – nearby search
 *   ne_lat, ne_lng, sw_lat, sw_lng – bounding box search
 *   limit                       – max results (default 50, max 50)
 *   offset                      – pagination offset
 *
 * Requires env: WINDY_WEBCAMS_API_KEY
 * Docs: https://api.windy.com/webcams/docs
 */

const API_KEY = process.env.WINDY_WEBCAMS_API_KEY ?? "";
const BASE_URL = "https://api.windy.com/webcams/api/v3/webcams";

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "WINDY_WEBCAMS_API_KEY not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = req.nextUrl;
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radius = searchParams.get("radius") ?? "250"; // km
  const neLat = searchParams.get("ne_lat");
  const neLng = searchParams.get("ne_lng");
  const swLat = searchParams.get("sw_lat");
  const swLng = searchParams.get("sw_lng");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 50);
  const offset = Number(searchParams.get("offset") ?? "0");

  try {
    // Build the Windy API URL
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      include: "location,images,player",
    });

    // Nearby search takes priority; otherwise use bbox
    if (lat && lng) {
      params.set("nearby", `${lat},${lng},${radius}`);
    } else if (neLat && neLng && swLat && swLng) {
      // Windy expects: sw_lat,sw_lng,ne_lat,ne_lng
      params.set("bbox", `${swLat},${swLng},${neLat},${neLng}`);
    }

    const url = `${BASE_URL}?${params}`;

    const res = await fetch(url, {
      headers: {
        "x-windy-api-key": API_KEY,
      },
      next: { revalidate: 300 }, // cache for 5 min
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Windy API error:", res.status, text);
      return NextResponse.json(
        { error: `Windy API error ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    // Transform to our Webcam shape
    const webcams = (data.webcams ?? []).map((w: any) => ({
      id: String(w.webcamId ?? w.id),
      title: w.title ?? "Untitled",
      lat: w.location?.latitude ?? 0,
      lng: w.location?.longitude ?? 0,
      thumbnail:
        w.images?.current?.preview ??
        w.images?.daylight?.preview ??
        w.images?.current?.thumbnail ??
        "",
      playerUrl: w.player?.day ?? w.player?.lifetime ?? w.player?.live ?? "",
      country: w.location?.country ?? "",
      city: w.location?.city ?? w.location?.region ?? "",
      status: w.status ?? "unknown",
      lastUpdated: w.lastUpdatedOn
        ? Math.floor(new Date(w.lastUpdatedOn).getTime() / 1000)
        : 0,
    }));

    return NextResponse.json({
      webcams,
      total: data.total ?? webcams.length,
    });
  } catch (err) {
    console.error("Webcam fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch webcams" },
      { status: 500 }
    );
  }
}
