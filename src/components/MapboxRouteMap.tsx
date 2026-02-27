"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import type { Coordinate, PlaceDetails } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RouteInfo {
  distance: number; // metres
  duration: number; // seconds
  geometry: GeoJSON.LineString;
  congestion?: string[];
}

interface Props {
  origin: Coordinate;
  destination: Coordinate;
  mapboxToken: string;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function formatDistance(m: number) {
  return m >= 1000
    ? `${(m / 1000).toFixed(1)} km (${(m / 1609.344).toFixed(1)} mi)`
    : `${Math.round(m)} m`;
}

const CONGESTION_COLORS: Record<string, string> = {
  low: "#4CAF50",
  moderate: "#FFEB3B",
  heavy: "#FF9800",
  severe: "#F44336",
  unknown: "#42A5F5",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MapboxRouteMap({ origin, destination, mapboxToken, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trafficVisible, setTrafficVisible] = useState(true);
  const [profile, setProfile] = useState<"driving-traffic" | "driving" | "walking" | "cycling">(
    "driving-traffic",
  );
  const [originPlace, setOriginPlace] = useState<PlaceDetails | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<PlaceDetails | null>(null);

  /* ---- fetch route ---- */
  const fetchRoute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        originLng: String(origin.lng),
        originLat: String(origin.lat),
        destLng: String(destination.lng),
        destLat: String(destination.lat),
        profile,
      });
      const res = await fetch(`/api/directions?${params}`);
      const data = await res.json();

      if (!res.ok || !data.routes?.length) {
        setError(data.error || "No route found between these locations.");
        setLoading(false);
        return;
      }

      const r = data.routes[0];
      const info: RouteInfo = {
        distance: r.distance,
        duration: r.duration,
        geometry: r.geometry,
        congestion: r.legs?.[0]?.annotation?.congestion,
      };
      setRoute(info);
      drawRoute(info);
    } catch {
      setError("Failed to fetch directions.");
    } finally {
      setLoading(false);
    }
  }, [origin, destination, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- initialise map ---- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [(origin.lng + destination.lng) / 2, (origin.lat + destination.lat) / 2],
      zoom: 4,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    mapRef.current = map;

    map.on("load", () => {
      // Traffic layer
      map.addSource("mapbox-traffic", {
        type: "vector",
        url: "mapbox://mapbox.mapbox-traffic-v1",
      });
      map.addLayer({
        id: "traffic-layer",
        type: "line",
        source: "mapbox-traffic",
        "source-layer": "traffic",
        layout: {
          "line-join": "round",
          "line-cap": "round",
          visibility: "visible",
        },
        paint: {
          "line-color": [
            "match",
            ["get", "congestion"],
            "low", CONGESTION_COLORS.low,
            "moderate", CONGESTION_COLORS.moderate,
            "heavy", CONGESTION_COLORS.heavy,
            "severe", CONGESTION_COLORS.severe,
            CONGESTION_COLORS.unknown,
          ],
          "line-width": 2,
          "line-opacity": 0.7,
        },
      });

      fetchRoute();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- re-fetch when profile changes (after initial load) ---- */
  useEffect(() => {
    if (mapRef.current && mapRef.current.isStyleLoaded()) {
      fetchRoute();
    }
  }, [profile, fetchRoute]);

  /* ---- toggle traffic layer ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer("traffic-layer")) {
      map.setLayoutProperty("traffic-layer", "visibility", trafficVisible ? "visible" : "none");
    }
  }, [trafficVisible]);

  /* ---- draw route on map ---- */
  const drawRoute = (info: RouteInfo) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous route layers / sources
    ["route-line", "route-congestion"].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    ["route", "route-congestion"].forEach((id) => {
      if (map.getSource(id)) map.removeSource(id);
    });

    // Remove old markers
    document.querySelectorAll(".mapbox-route-marker").forEach((el) => el.remove());

    // Main route line
    map.addSource("route", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: info.geometry },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#42A5F5",
        "line-width": 5,
        "line-opacity": 0.85,
      },
    });

    // Congestion-coloured segments (if available)
    if (info.congestion && info.geometry.coordinates.length > 1) {
      const coords = info.geometry.coordinates;
      const features: GeoJSON.Feature[] = [];

      for (let i = 0; i < coords.length - 1; i++) {
        const level = info.congestion[i] || "unknown";
        features.push({
          type: "Feature",
          properties: { congestion: level },
          geometry: {
            type: "LineString",
            coordinates: [coords[i], coords[i + 1]],
          },
        });
      }

      map.addSource("route-congestion", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      map.addLayer({
        id: "route-congestion",
        type: "line",
        source: "route-congestion",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "congestion"],
            "low", CONGESTION_COLORS.low,
            "moderate", CONGESTION_COLORS.moderate,
            "heavy", CONGESTION_COLORS.heavy,
            "severe", CONGESTION_COLORS.severe,
            CONGESTION_COLORS.unknown,
          ],
          "line-width": 6,
          "line-opacity": 0.9,
        },
      });
    }

    // Markers
    const originEl = markerElement("A", "#4CAF50");
    originEl.className += " mapbox-route-marker";
    const originMarker = new mapboxgl.Marker({ element: originEl })
      .setLngLat([origin.lng, origin.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 25, maxWidth: "260px" }).setHTML(
          buildPopupHTML(origin.label, originPlace)
        )
      )
      .addTo(map);
    originMarkerRef.current = originMarker;

    const destEl = markerElement("B", "#F44336");
    destEl.className += " mapbox-route-marker";
    const destMarker = new mapboxgl.Marker({ element: destEl })
      .setLngLat([destination.lng, destination.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 25, maxWidth: "260px" }).setHTML(
          buildPopupHTML(destination.label, destinationPlace)
        )
      )
      .addTo(map);
    destMarkerRef.current = destMarker;

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    info.geometry.coordinates.forEach((c) => bounds.extend(c as [number, number]));
    map.fitBounds(bounds, { padding: 60, duration: 1000 });
  };

  /* ---- fetch place details for origin & destination on mount ---- */
  useEffect(() => {
    async function fetchPlace(lat: number, lng: number, setter: (p: PlaceDetails) => void) {
      try {
        const res = await fetch(`/api/places?lat=${lat}&lng=${lng}`);
        if (res.ok) {
          const data: PlaceDetails = await res.json();
          setter(data);
        }
      } catch {
        // silently ignore; popup will show label only
      }
    }
    fetchPlace(origin.lat, origin.lng, setOriginPlace);
    fetchPlace(destination.lat, destination.lng, setDestinationPlace);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- update origin popup when place details arrive ---- */
  useEffect(() => {
    const marker = originMarkerRef.current;
    if (!marker || !originPlace) return;
    marker.getPopup()?.setHTML(buildPopupHTML(origin.label, originPlace));
  }, [originPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- update destination popup when place details arrive ---- */
  useEffect(() => {
    const marker = destMarkerRef.current;
    if (!marker || !destinationPlace) return;
    marker.getPopup()?.setHTML(buildPopupHTML(destination.label, destinationPlace));
  }, [destinationPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- resize map when container size changes ---- */
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  /* ---- render ---- */
  return (
    <div
      className={`mapbox-route-pane ${expanded ? "mapbox-route-pane--expanded" : ""}`}
      style={{
        position: expanded ? "fixed" : "absolute",
        top: expanded ? 0 : undefined,
        left: expanded ? 320 : undefined,
        bottom: expanded ? 0 : 16,
        right: expanded ? 0 : 16,
        width: expanded ? "calc(100vw - 320px)" : 480,
        height: expanded ? "100vh" : 380,
        zIndex: expanded ? 9999 : 50,
        borderRadius: expanded ? 0 : 12,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        border: expanded ? "none" : "1px solid rgba(255,255,255,0.08)",
        transition: "all 0.3s ease",
      }}
    >
      {/* toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "rgba(13,17,23,0.95)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {/* Route info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: "#4CAF50", fontWeight: 600 }}>A</span> {origin.label}
            {" → "}
            <span style={{ color: "#F44336", fontWeight: 600 }}>B</span> {destination.label}
          </div>
          {route && (
            <div style={{ fontSize: 13, color: "#e6edf3", fontWeight: 500 }}>
              {formatDuration(route.duration)} · {formatDistance(route.distance)}
            </div>
          )}
          {loading && <div style={{ fontSize: 12, color: "#58a6ff" }}>Loading route…</div>}
          {error && <div style={{ fontSize: 12, color: "#f85149" }}>{error}</div>}
        </div>

        {/* Profile selector */}
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value as typeof profile)}
          style={{
            fontSize: 11,
            background: "#161b22",
            color: "#c9d1d9",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "4px 6px",
            cursor: "pointer",
          }}
        >
          <option value="driving-traffic">🚗 Drive (traffic)</option>
          <option value="driving">🚗 Drive</option>
          <option value="walking">🚶 Walk</option>
          <option value="cycling">🚲 Cycle</option>
        </select>

        {/* Traffic toggle */}
        <button
          onClick={() => setTrafficVisible((v) => !v)}
          title="Toggle traffic overlay"
          style={{
            fontSize: 11,
            background: trafficVisible ? "#1a6b37" : "#161b22",
            color: "#c9d1d9",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "4px 8px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          🚦 Traffic {trafficVisible ? "On" : "Off"}
        </button>

        {/* Expand / collapse */}
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Collapse" : "Expand to full page"}
          style={{
            fontSize: 14,
            background: "#161b22",
            color: "#c9d1d9",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          {expanded ? "⇲" : "⇱"}
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          title="Close map"
          style={{
            fontSize: 14,
            background: "#161b22",
            color: "#f85149",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "4px 12px",
          background: "rgba(13,17,23,0.9)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        {Object.entries(CONGESTION_COLORS).map(([level, color]) => (
          <div key={level} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#8b949e" }}>
            <span style={{ width: 10, height: 3, borderRadius: 2, background: color, display: "inline-block" }} />
            {level}
          </div>
        ))}
      </div>

      {/* Map container */}
      <div ref={containerRef} style={{ flex: 1 }} />
    </div>
  );
}

/* ---- rich popup HTML builder ---- */
function buildPopupHTML(label: string, place: PlaceDetails | null): string {
  const name = place?.name ?? label;
  const escapedName = name.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const photoHtml = place?.photoUrl
    ? `<img src="${place.photoUrl}" alt="${escapedName}"
         style="width:100%;height:130px;object-fit:cover;border-radius:6px 6px 0 0;display:block;" />`
    : "";

  const openBadge =
    place?.isOpen === true
      ? `<span style="color:#4caf50;font-size:11px;font-weight:600;margin-left:6px;">Open</span>`
      : place?.isOpen === false
      ? `<span style="color:#f44336;font-size:11px;font-weight:600;margin-left:6px;">Closed</span>`
      : "";

  const addressHtml = place?.address
    ? `<p style="margin:4px 0;font-size:12px;">📍 ${place.address.replace(/</g, "&lt;")}</p>`
    : "";

  const phoneHtml = place?.phone
    ? `<p style="margin:4px 0;font-size:12px;">📞 <a href="tel:${place.phone}" style="color:#1a73e8;text-decoration:none;">${place.phone}</a></p>`
    : "";

  const hoursHtml =
    place?.hours?.length
      ? `<details style="margin:4px 0;font-size:11px;color:#444;">
           <summary style="cursor:pointer;user-select:none;color:#555;font-size:11px;">🕐 Hours</summary>
           <ul style="margin:4px 0 0 0;padding-left:14px;line-height:1.6;">${place.hours.map((h) => `<li>${h.replace(/</g, "&lt;")}</li>`).join("")}</ul>
         </details>`
      : "";

  const websiteHtml = place?.website
    ? `<a href="${place.website}" target="_blank" rel="noopener noreferrer"
         style="display:inline-block;margin-top:4px;font-size:12px;color:#1a73e8;text-decoration:none;">
         🌐 Website
       </a>`
      : "";

  const mapsHtml = place?.mapsUrl
    ? `<a href="${place.mapsUrl}" target="_blank" rel="noopener noreferrer"
         style="display:inline-block;margin-top:4px;margin-left:${place.website ? "8px" : "0"};font-size:12px;color:#1a73e8;text-decoration:none;">
         🗺 View on Maps
       </a>`
    : "";

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#1a1a1a;min-width:200px;max-width:260px;overflow:hidden;border-radius:6px;">
      ${photoHtml}
      <div style="padding:${photoHtml ? "8px 10px 10px" : "10px"};background:#fff;">
        <div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:2px;">
          <strong style="font-size:14px;line-height:1.3;">${escapedName}</strong>
          ${openBadge}
        </div>
        ${addressHtml}
        ${phoneHtml}
        ${hoursHtml}
        <div>${websiteHtml}${mapsHtml}</div>
      </div>
    </div>`;
}

/* ---- marker element builder ---- */
function markerElement(letter: string, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:28px; height:28px; border-radius:50%; background:${color};
    display:flex; align-items:center; justify-content:center;
    font-weight:700; font-size:14px; color:#fff;
    border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.4);
    cursor:pointer;
  `;
  el.textContent = letter;
  return el;
}
