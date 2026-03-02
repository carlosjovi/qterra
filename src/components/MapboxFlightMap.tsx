"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { Flight, FlightRoute, Coordinate, Webcam } from "@/lib/types";

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
  webcams?: Webcam[];
  selectedWebcamId?: string | null;
  onSelectWebcam?: (w: Webcam | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Map styles & overlays                                              */
/* ------------------------------------------------------------------ */

type MapStyle = "dark" | "satellite" | "satellite-streets" | "outdoors" | "light";

const MAP_STYLES: Record<MapStyle, { url: string; label: string }> = {
  dark: { url: "mapbox://styles/mapbox/dark-v11", label: "Dark" },
  light: { url: "mapbox://styles/mapbox/light-v11", label: "Light" },
  outdoors: { url: "mapbox://styles/mapbox/outdoors-v12", label: "Outdoors" },
  satellite: { url: "mapbox://styles/mapbox/satellite-v9", label: "Satellite" },
  "satellite-streets": { url: "mapbox://styles/mapbox/satellite-streets-v12", label: "Hybrid" },
};

function getFogConfig(style: MapStyle) {
  const isDark = style === "dark" || style === "satellite" || style === "satellite-streets";
  return isDark
    ? {
        color: "rgb(12, 12, 20)",
        "high-color": "rgb(36, 92, 223)",
        "horizon-blend": 0.02,
        "space-color": "rgb(11, 11, 25)",
        "star-intensity": 0.6,
      }
    : {
        color: "rgb(186, 210, 235)",
        "high-color": "rgb(36, 92, 223)",
        "horizon-blend": 0.02,
        "space-color": "rgb(220, 230, 240)",
        "star-intensity": 0.0,
      };
}

function addBuildingsLayer(map: mapboxgl.Map, style: MapStyle) {
  try {
    const layers = map.getStyle().layers;
    if (!layers) return;
    // Insert buildings below the first symbol/label layer
    const labelLayerId = layers.find(
      (l: any) => l.type === "symbol" && l.layout?.["text-field"],
    )?.id;
    const isDark = style === "dark" || style === "satellite" || style === "satellite-streets";
    map.addLayer(
      {
        id: "3d-buildings",
        source: "composite",
        "source-layer": "building",
        filter: ["==", "extrude", "true"],
        type: "fill-extrusion",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": isDark ? "#445" : "#ddd",
          "fill-extrusion-height": [
            "interpolate", ["linear"], ["zoom"],
            14, 0,
            14.5, ["get", "height"],
          ],
          "fill-extrusion-base": [
            "interpolate", ["linear"], ["zoom"],
            14, 0,
            14.5, ["get", "min_height"],
          ],
          "fill-extrusion-opacity": 0.7,
        },
      } as any,
      labelLayerId,
    );
  } catch {
    // Style may not support buildings (e.g., satellite-v9)
  }
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
  webcams = [],
  selectedWebcamId = null,
  onSelectWebcam,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const flightMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const routeMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const webcamMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyle>("dark");
  const [terrain3d, setTerrain3d] = useState(false);

  /* ---- initialise map (runs once) ---- */
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
      style: MAP_STYLES["dark"].url,
      center: [-90, 20],
      zoom: 2,
      projection: "globe" as any,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // Ensure the map fills its container after mount
      map.resize();

      // Atmosphere / fog — gives the globe a realistic look
      map.setFog(getFogConfig("dark") as any);

      // 3D buildings (auto-show when zoomed to street level)
      addBuildingsLayer(map, "dark");

      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
      // Clear marker refs so data effects start fresh with new map
      markersRef.current = [];
      flightMarkersRef.current.clear();
      routeMarkersRef.current = [];
      webcamMarkersRef.current.clear();
    };
  }, [mapboxToken]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- swap style in-place (preserves camera position & zoom) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // setStyle swaps tiles but keeps center/zoom/bearing/pitch
    map.setStyle(MAP_STYLES[mapStyle].url);

    // Re-apply overlays once the new style finishes loading
    const onStyleLoad = () => {
      map.setFog(getFogConfig(mapStyle) as any);
      addBuildingsLayer(map, mapStyle);

      // Re-apply terrain if it was enabled
      if (terrain3d) {
        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
        if (!map.getLayer("sky-layer")) {
          map.addLayer({
            id: "sky-layer",
            type: "sky" as any,
            paint: {
              "sky-type": "atmosphere",
              "sky-atmosphere-sun": [0, 90],
              "sky-atmosphere-sun-intensity": 15,
            },
          } as any);
        }
      }
    };

    map.once("style.load", onStyleLoad);

    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [mapStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- resize map when container dimensions change ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    // Small delay to let the DOM settle after switching views
    const timer = setTimeout(() => map.resize(), 50);
    return () => clearTimeout(timer);
  }, [mapLoaded]);

  /* ---- 3D terrain toggle ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (terrain3d) {
      // Add DEM elevation source if not already present
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

      // Sky layer for a nice atmosphere above the horizon
      if (!map.getLayer("sky-layer")) {
        map.addLayer({
          id: "sky-layer",
          type: "sky" as any,
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0, 90],
            "sky-atmosphere-sun-intensity": 15,
          },
        } as any);
      }
    } else {
      if ((map as any).getTerrain?.()) {
        map.setTerrain(null as any);
      }
      if (map.getLayer("sky-layer")) {
        map.removeLayer("sky-layer");
      }
    }
  }, [terrain3d, mapLoaded]);

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

  /* ---- webcam markers ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const prevMarkers = webcamMarkersRef.current;
    const nextKeys = new Set<string>();

    for (const w of webcams) {
      nextKeys.add(w.id);
      const isSelected = w.id === selectedWebcamId;

      let marker = prevMarkers.get(w.id);
      if (marker) {
        // Update position & selected styling
        marker.setLngLat([w.lng, w.lat]);
        const el = marker.getElement();
        const dot = el.querySelector(".webcam-dot") as HTMLElement | null;
        if (dot) {
          dot.style.background = isSelected ? "#fbbf24" : "#a855f7";
          dot.style.width = isSelected ? "14px" : "10px";
          dot.style.height = isSelected ? "14px" : "10px";
          dot.style.boxShadow = isSelected
            ? "0 0 10px rgba(251,191,36,0.8), 0 0 20px rgba(251,191,36,0.4)"
            : "0 0 6px rgba(168,85,247,0.6)";
          dot.style.border = isSelected ? "2px solid #fff" : "2px solid rgba(255,255,255,0.7)";
        }
      } else {
        // Create new webcam marker
        const el = document.createElement("div");
        el.style.cursor = "pointer";
        el.style.zIndex = "5";

        const dot = document.createElement("div");
        dot.className = "webcam-dot";
        dot.style.width = isSelected ? "14px" : "10px";
        dot.style.height = isSelected ? "14px" : "10px";
        dot.style.borderRadius = "50%";
        dot.style.background = isSelected ? "#fbbf24" : "#a855f7";
        dot.style.border = isSelected ? "2px solid #fff" : "2px solid rgba(255,255,255,0.7)";
        dot.style.boxShadow = isSelected
          ? "0 0 10px rgba(251,191,36,0.8), 0 0 20px rgba(251,191,36,0.4)"
          : "0 0 6px rgba(168,85,247,0.6)";
        dot.style.transition = "all 0.2s ease";
        el.appendChild(dot);

        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (onSelectWebcam) {
            if (selectedWebcamId === w.id) {
              onSelectWebcam(null);
            } else {
              onSelectWebcam(w);
            }
          }
        });

        marker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([w.lng, w.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 12, closeButton: false, closeOnClick: false })
              .setHTML(`<div style="font-size:12px;"><strong>${w.title}</strong><br/><span style="color:#999;">${w.city || w.region || w.country}</span></div>`),
          )
          .addTo(map);

        // Show popup on hover
        const m = marker;
        el.addEventListener("mouseenter", () => m.togglePopup());
        el.addEventListener("mouseleave", () => {
          const popup = m.getPopup();
          if (popup && popup.isOpen()) m.togglePopup();
        });

        prevMarkers.set(w.id, marker);
      }
    }

    // Remove stale webcam markers
    for (const [key, marker] of prevMarkers) {
      if (!nextKeys.has(key)) {
        marker.remove();
        prevMarkers.delete(key);
      }
    }
  }, [webcams, selectedWebcamId, mapLoaded, onSelectWebcam]);

  /* ---- fly to selected webcam ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedWebcamId) return;

    const webcam = webcams.find((w) => w.id === selectedWebcamId);
    if (!webcam) return;

    map.flyTo({
      center: [webcam.lng, webcam.lat],
      zoom: Math.max(map.getZoom(), 8),
      duration: 1200,
    });
  }, [selectedWebcamId, mapLoaded]); // intentionally not depending on webcams to avoid constant re-centering

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

      {/* ---- Map style & layer controls ---- */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        {/* Style picker */}
        <div
          style={{
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            borderRadius: 8,
            padding: "8px 10px",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.5)",
              marginBottom: 6,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Style
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(Object.keys(MAP_STYLES) as MapStyle[]).map((key) => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  borderRadius: 4,
                  border: "1px solid",
                  borderColor:
                    mapStyle === key ? "rgba(255,170,0,0.6)" : "rgba(255,255,255,0.15)",
                  background:
                    mapStyle === key ? "rgba(255,170,0,0.2)" : "rgba(255,255,255,0.05)",
                  color: mapStyle === key ? "#ffa500" : "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {MAP_STYLES[key].label}
              </button>
            ))}
          </div>
        </div>

        {/* Layer toggles */}
        <div
          style={{
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            borderRadius: 8,
            padding: "8px 10px",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.5)",
              marginBottom: 6,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Layers
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: terrain3d ? "#ffa500" : "rgba(255,255,255,0.7)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={terrain3d}
              onChange={() => setTerrain3d((p) => !p)}
              style={{ accentColor: "#ffa500" }}
            />
            3D Terrain
          </label>
        </div>
      </div>
    </div>
  );
}
