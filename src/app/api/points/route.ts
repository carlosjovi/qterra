import { NextRequest, NextResponse } from "next/server";
import {
  saveSavedPoint,
  getAllSavedPoints,
  updatePointLabelByCoords,
  deleteSavedPoint,
} from "@/lib/db";

/* ------------------------------------------------------------------ */
/*  /api/points – CRUD for saved / preset points                       */
/* ------------------------------------------------------------------ */

/** GET  – list all saved points */
export async function GET() {
  try {
    const points = getAllSavedPoints();
    return NextResponse.json({ points });
  } catch (err) {
    console.error("[/api/points] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch saved points" }, { status: 500 });
  }
}

/** POST – save a point to presets (upsert by coords) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { label, lat, lng, color } = body;

    if (!label || lat == null || lng == null) {
      return NextResponse.json({ error: "label, lat, lng are required" }, { status: 400 });
    }

    const id = saveSavedPoint(label, lat, lng, color);
    return NextResponse.json({ id, success: true });
  } catch (err) {
    console.error("[/api/points] POST error:", err);
    return NextResponse.json({ error: "Failed to save point" }, { status: 500 });
  }
}

/** PATCH – rename a saved point by coordinates */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { lat, lng, label } = body;

    if (lat == null || lng == null || !label) {
      return NextResponse.json({ error: "lat, lng, label are required" }, { status: 400 });
    }

    // Upsert: if point doesn't exist yet, save it; otherwise update
    saveSavedPoint(label, lat, lng);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[/api/points] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update point" }, { status: 500 });
  }
}

/** DELETE – remove a saved point by id */
export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  try {
    deleteSavedPoint(parseInt(id, 10));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[/api/points] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete point" }, { status: 500 });
  }
}
