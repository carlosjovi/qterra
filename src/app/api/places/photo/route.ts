import { NextRequest, NextResponse } from "next/server";
import { savePlacePhoto, findPlacePhoto } from "@/lib/db";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/* ------------------------------------------------------------------ */
/*  GET /api/places/photo?ref=<photoReference>                         */
/*  Proxies Google Places photo so the API key stays server-side       */
/* ------------------------------------------------------------------ */

export async function GET(req: NextRequest) {
  if (!GOOGLE_API_KEY) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const ref = req.nextUrl.searchParams.get("ref");
  if (!ref) {
    return NextResponse.json({ error: "ref is required" }, { status: 400 });
  }

  // ── Check cache first ──────────────────────────────────────────────
  try {
    const cached = findPlacePhoto(ref);
    if (cached) {
      return new NextResponse(new Uint8Array(cached.data), {
        headers: {
          "Content-Type": cached.content_type,
          "Cache-Control": "public, max-age=86400",
          "X-Cache": "HIT",
        },
      });
    }
  } catch (e) {
    console.error("[db] photo lookup error:", e);
  }

  // ── Fetch from Google ──────────────────────────────────────────────
  const photoUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
  photoUrl.searchParams.set("maxwidth", "640");
  photoUrl.searchParams.set("photoreference", ref);
  photoUrl.searchParams.set("key", GOOGLE_API_KEY);

  const res = await fetch(photoUrl.toString());

  if (!res.ok) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "image/jpeg";

  // Persist to local DB
  try {
    savePlacePhoto(ref, contentType, Buffer.from(buffer));
  } catch (e) {
    console.error("[db] photo save error:", e);
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
