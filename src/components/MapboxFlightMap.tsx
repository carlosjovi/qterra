"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { Flight, FlightRoute, Coordinate } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Project a point forward along a compass heading by `distKm` km */
function projectForward(
  lat: number,
  lng: number,
  heading: number,
  distKm: number,
): { lat: number; lng: number } {
  const R = 6371;
  const d = distKm / R;
  const brng = (heading * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** Build a great-circle arc as an array of [lng, lat] pairs */
function greatCircleArc(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  segments = 64,
): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(startLat);
  const lng1 = toRad(startLng);
  const lat2 = toRad(endLat);
  const lng2 = toRad(endLng);

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((lat1 - lat2) / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng1 - lng2) / 2) ** 2,
    ),
  );

  if (d < 1e-10) return [[startLng, startLat], [endLng, endLat]];

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lng = Math.atan2(y, x);
    points.push([toDeg(lng), toDeg(lat)]);
  }
  return points;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  mapboxToken: string;
  coordinates?: Coordinate[];
  flights?: Flight[];
  selectedFlightIcao?: string | null;
  flightRoute?: FlightRoute | null;
  onSelectFlight?: (f: Flight | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MapboxFlightMap({
  mapboxToken,
  coordinates = [],
  flights = [],
  selectedFlightIcao = null,
  flightRoute = null,
  onSelectFlight,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const flightMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const routeMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  /* ---- initialise map ---- */
  useEffect(() => {
    if (!containerRef.current) return;

    // If a map already exists, remove it first
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [0, 20],
      zoom: 2,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // Ensure the map fills its container after mount
      map.resize();
      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [mapboxToken]);

  /* ---- resize map when container dimensions change ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    // Small delay to let the DOM settle after switching views
    const timer = setTimeout(() => map.resize(), 50);
    return () => clearTimeout(timer);
  }, [mapLoaded]);

  /* ---- coordinate points & arcs ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Remove old coordinate markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Add point markers
    for (const c of coordinates) {
      const el = document.createElement("div");
      el.style.width = "12px";
      el.style.height = "12px";
      el.style.borderRadius = "50%";
      el.style.background = c.color ?? "#ff6600";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 0 6px rgba(255,170,0,0.6)";

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([c.lng, c.lat])
        .setPopup(new mapboxgl.Popup({ offset: 12, closeButton: false }).setText(c.label))
        .addTo(map);

      markersRef.current.push(marker);
    }

    // Arcs between sequential coordinate points
    const arcSourceId = "coord-arcs";
    if (map.getSource(arcSourceId)) {
      (map.getSource(arcSourceId) as mapboxgl.GeoJSONSource).setData(buildCoordArcsGeoJSON());
    } else {
      map.addSource(arcSourceId, { type: "geojson", data: buildCoordArcsGeoJSON() });
      map.addLayer({
        id: "coord-arcs-layer",
        type: "line",
        source: arcSourceId,
        paint: {
          "line-color": "#ff6600",
          "line-width": 2,
          "line-opacity": 0.7,
          "line-dasharray": [2, 2],
        },
      });
    }

    function buildCoordArcsGeoJSON(): GeoJSON.FeatureCollection {
      const features: GeoJSON.Feature[] = [];
      for (let i = 0; i < coordinates.length - 1; i++) {
        const a = coordinates[i];
        const b = coordinates[i + 1];
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: greatCircleArc(a.lat, a.lng, b.lat, b.lng),
          },
        });
      }
      return { type: "FeatureCollection", features };
    }
  }, [coordinates, mapLoaded]);

  /* ---- flight markers ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const prevMarkers = flightMarkersRef.current;
    const nextKeys = new Set<string>();

    for (const f of flights) {
      if (f.onGround) continue;
      nextKeys.add(f.icao24);
      const isSelected = f.icao24 === selectedFlightIcao;

      let marker = prevMarkers.get(f.icao24);
      if (marker) {
        // Update position
        marker.setLngLat([f.lng, f.lat]);
        // Update rotation via the element
        const el = marker.getElement();
        const svg = el.querySelector("svg");
        if (svg) {
          svg.style.transform = `rotate(${f.heading ?? 0}deg)`;
          const path = svg.querySelector("path");
          if (path) {
            path.setAttribute("fill", isSelected ? "#ffa500" : "#60a5fa");
            path.setAttribute("fill-opacity", isSelected ? "1" : "0.85");
          }
          svg.style.width = isSelected ? "28px" : "18px";
          svg.style.height = isSelected ? "28px" : "18px";
        }
      } else {
        // Create new marker
        const el = document.createElement("div");
        el.style.cursor = "pointer";
        el.style.zIndex = "10";
        el.innerHTML = `<svg width="${isSelected ? 28 : 18}" height="${isSelected ? 28 : 18}" viewBox="0 0 24 24" style="transform: rotate(${f.heading ?? 0}deg); transition: transform 0.5s ease;">
          <path d="M12 2 L16 10 L22 12 L16 14 L12 22 L8 14 L2 12 L8 10 Z"
                fill="${isSelected ? "#ffa500" : "#60a5fa"}"
                fill-opacity="${isSelected ? 1 : 0.85}"
                stroke="rgba(0,0,0,0.5)" stroke-width="0.5"/>
        </svg>`;

        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (onSelectFlight) {
            if (selectedFlightIcao === f.icao24) {
              onSelectFlight(null);
            } else {
              onSelectFlight(f);
            }
          }
        });

        marker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([f.lng, f.lat])
          .addTo(map);

        prevMarkers.set(f.icao24, marker);
      }
    }

    // Remove stale markers
    for (const [key, marker] of prevMarkers) {
      if (!nextKeys.has(key)) {
        marker.remove();
        prevMarkers.delete(key);
      }
    }
  }, [flights, selectedFlightIcao, mapLoaded, onSelectFlight]);

  /* ---- flight projected arcs (heading-based) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const PROJECTION_SECONDS = 1200;
    const MIN_VELOCITY = 30;
    const MAX_DIST_KM = 2500;

    const features: GeoJSON.Feature[] = [];

    for (const f of flights) {
      if (f.onGround || !f.velocity || f.velocity < MIN_VELOCITY) continue;
      // Skip projected arc for selected flight when real route data exists
      if (f.icao24 === selectedFlightIcao && flightRoute) continue;

      const distKm = Math.min((f.velocity * PROJECTION_SECONDS) / 1000, MAX_DIST_KM);
      if (distKm < 10) continue;

      const endPt = projectForward(f.lat, f.lng, f.heading, distKm);
      const isSelected = f.icao24 === selectedFlightIcao;

      features.push({
        type: "Feature",
        properties: {
          color: isSelected ? "#ffa500" : "#60a5fa",
          opacity: isSelected ? 0.8 : 0.4,
          width: isSelected ? 3 : 1.5,
        },
        geometry: {
          type: "LineString",
          coordinates: greatCircleArc(f.lat, f.lng, endPt.lat, endPt.lng, 32),
        },
      });
    }

    const sourceId = "flight-arcs";
    const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(data);
    } else {
      map.addSource(sourceId, { type: "geojson", data });
      map.addLayer({
        id: "flight-arcs-layer",
        type: "line",
        source: sourceId,
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": ["get", "opacity"],
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });
    }
  }, [flights, selectedFlightIcao, flightRoute, mapLoaded]);

  /* ---- flight route arc (departure → arrival) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Remove old route markers
    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];

    const sourceId = "flight-route";
    const emptyData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

    if (!flightRoute) {
      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(emptyData);
      }
      return;
    }

    const { departureLat, departureLng, arrivalLat, arrivalLng } = flightRoute;
    if (
      (departureLat === 0 && departureLng === 0) ||
      (arrivalLat === 0 && arrivalLng === 0) ||
      !isFinite(departureLat) || !isFinite(departureLng) ||
      !isFinite(arrivalLat) || !isFinite(arrivalLng)
    ) {
      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(emptyData);
      }
      return;
    }

    const arcCoords = greatCircleArc(departureLat, departureLng, arrivalLat, arrivalLng);

    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: arcCoords },
        },
      ],
    };

    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(data);
    } else {
      map.addSource(sourceId, { type: "geojson", data });
      map.addLayer({
        id: "flight-route-layer",
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#22c55e",
          "line-width": 3,
          "line-opacity": 0.85,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });
    }

    // Departure marker
    const depEl = document.createElement("div");
    depEl.style.width = "16px";
    depEl.style.height = "16px";
    depEl.style.borderRadius = "50%";
    depEl.style.background = "#22c55e";
    depEl.style.border = "3px solid rgba(34,197,94,0.3)";
    depEl.style.boxShadow = "0 0 10px rgba(34,197,94,0.5)";

    const depMarker = new mapboxgl.Marker({ element: depEl })
      .setLngLat([departureLng, departureLat])
      .setPopup(
        new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<strong>${flightRoute.departureAirport}</strong>${flightRoute.departureCity ? `<br/>${flightRoute.departureCity}` : ""}`,
        ),
      )
      .addTo(map);
    routeMarkersRef.current.push(depMarker);

    // Arrival marker
    const arrEl = document.createElement("div");
    arrEl.style.width = "16px";
    arrEl.style.height = "16px";
    arrEl.style.borderRadius = "50%";
    arrEl.style.background = "#ef4444";
    arrEl.style.border = "3px solid rgba(239,68,68,0.3)";
    arrEl.style.boxShadow = "0 0 10px rgba(239,68,68,0.5)";

    const arrMarker = new mapboxgl.Marker({ element: arrEl })
      .setLngLat([arrivalLng, arrivalLat])
      .setPopup(
        new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<strong>${flightRoute.arrivalAirport}</strong>${flightRoute.arrivalCity ? `<br/>${flightRoute.arrivalCity}` : ""}`,
        ),
      )
      .addTo(map);
    routeMarkersRef.current.push(arrMarker);

    // Fit bounds to show the full route
    const allLngs = arcCoords.map((c) => c[0]);
    const allLats = arcCoords.map((c) => c[1]);
    const bounds = new mapboxgl.LngLatBounds(
      [Math.min(...allLngs), Math.min(...allLats)],
      [Math.max(...allLngs), Math.max(...allLats)],
    );
    map.fitBounds(bounds, { padding: 80, maxZoom: 8 });
  }, [flightRoute, mapLoaded]);

  /* ---- fly to selected flight ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedFlightIcao) return;

    const flight = flights.find((f) => f.icao24 === selectedFlightIcao);
    if (!flight) return;

    map.flyTo({
      center: [flight.lng, flight.lat],
      zoom: Math.max(map.getZoom(), 5),
      duration: 1200,
    });
  }, [selectedFlightIcao, mapLoaded]); // intentionally not depending on flights to avoid constant re-centering

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
