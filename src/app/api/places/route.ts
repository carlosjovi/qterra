import { NextRequest, NextResponse } from "next/server";
import { savePlaceResult, findPlaceByCoords } from "@/lib/db";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/* ------------------------------------------------------------------ */
/*  GET /api/places?lat=...&lng=...                                     */
/*  Returns Google Places details for the nearest place at lat/lng     */
/* ------------------------------------------------------------------ */

export async function GET(req: NextRequest) {
  if (!GOOGLE_API_KEY) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  try {
    // ── Cache check: return DB result if available ────────────────────
    const cached = findPlaceByCoords(parseFloat(lat), parseFloat(lng));
    if (cached) {
      const photoUrl = cached.photo_ref
        ? `/api/places/photo?ref=${encodeURIComponent(cached.photo_ref)}`
        : undefined;
      return NextResponse.json({
        name: cached.name,
        address: cached.address,
        phone: cached.phone,
        website: cached.website,
        mapsUrl: cached.maps_url,
        hours: cached.hours ? (JSON.parse(cached.hours) as string[]) : [],
        isOpen: cached.is_open != null ? !!cached.is_open : undefined,
        photoUrl,
      });
    }

    // ── Step 1: Nearby Search to find the closest place ──────────────
    const nearbyUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    );
    nearbyUrl.searchParams.set("location", `${lat},${lng}`);
    nearbyUrl.searchParams.set("rankby", "distance");
    nearbyUrl.searchParams.set("type", "establishment");
    nearbyUrl.searchParams.set("key", GOOGLE_API_KEY);

    const nearbyRes = await fetch(nearbyUrl.toString());
    const nearbyData = await nearbyRes.json();

    if (!nearbyData.results?.length) {
      return NextResponse.json({ error: "No places found near these coordinates" }, { status: 404 });
    }

    const placeId: string = nearbyData.results[0].place_id;

    // ── Step 2: Place Details ─────────────────────────────────────────
    const detailsUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/details/json"
    );
    detailsUrl.searchParams.set("place_id", placeId);
    detailsUrl.searchParams.set(
      "fields",
      "name,formatted_address,formatted_phone_number,opening_hours,website,photos,url"
    );
    detailsUrl.searchParams.set("key", GOOGLE_API_KEY);

    const detailsRes = await fetch(detailsUrl.toString());
    const detailsData = await detailsRes.json();

    if (detailsData.status !== "OK") {
      return NextResponse.json(
        { error: detailsData.error_message || "Place details unavailable" },
        { status: 404 }
      );
    }

    const r = detailsData.result;

    // ── Build response ────────────────────────────────────────────────
    const photoRef: string | undefined = r.photos?.[0]?.photo_reference;
    const photoUrl = photoRef
      ? `/api/places/photo?ref=${encodeURIComponent(photoRef)}`
      : undefined;

    // Persist to local DB
    try {
      savePlaceResult(
        parseFloat(lat),
        parseFloat(lng),
        placeId,
        {
          name: r.name,
          address: r.formatted_address,
          phone: r.formatted_phone_number,
          website: r.website,
          mapsUrl: r.url,
          hours: r.opening_hours?.weekday_text,
          isOpen: r.opening_hours?.open_now,
          photoRef,
        },
        { nearby: nearbyData, details: detailsData },
      );
    } catch (e) {
      console.error("[db] place save error:", e);
    }

    return NextResponse.json({
      name: r.name,
      address: r.formatted_address,
      phone: r.formatted_phone_number,
      website: r.website,
      mapsUrl: r.url,
      hours: (r.opening_hours?.weekday_text as string[] | undefined) ?? [],
      isOpen: r.opening_hours?.open_now,
      photoUrl,
    });
  } catch (err) {
    console.error("[/api/places] error:", err);
    return NextResponse.json({ error: "Failed to fetch place details" }, { status: 500 });
  }
}
