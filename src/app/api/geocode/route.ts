import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  // --- 1. Try Google Maps Geocoding ---
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${googleKey}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.results?.length) {
        return NextResponse.json({
          results: data.results.map((r: any) => ({
            lat: r.geometry.location.lat,
            lng: r.geometry.location.lng,
            name: r.formatted_address?.split(",")[0] ?? query,
            fullAddress: r.formatted_address ?? "",
          })),
        });
      }
    } catch (err) {
      console.error("Google geocoding failed, falling back to MapQuest:", err);
    }
  }

  // --- 2. Fallback: MapQuest ---
  const mqKey = process.env.MAPQUEST_API_KEY;
  if (mqKey) {
    try {
      const url = `https://www.mapquestapi.com/geocoding/v1/address?key=${mqKey}&location=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      const data = await res.json();
      const locations = data.results?.[0]?.locations;

      if (locations?.length) {
        return NextResponse.json({
          results: locations.map((loc: any) => ({
            lat: loc.latLng.lat,
            lng: loc.latLng.lng,
            name: loc.adminArea5 || loc.adminArea3 || query,
            fullAddress: [loc.adminArea5, loc.adminArea3, loc.adminArea1].filter(Boolean).join(", "),
          })),
        });
      }
    } catch (err) {
      console.error("MapQuest geocoding also failed:", err);
    }
  }

  return NextResponse.json({ results: [] });
}
