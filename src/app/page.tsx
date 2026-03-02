"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Box, Flex, Heading, Text, Separator } from "@radix-ui/themes";
import CoordinatePanel from "@/components/CoordinatePanel";
import PointDetailPane from "@/components/PointDetailPane";
import type { Coordinate, Flight, FlightRoute, Satellite, SatelliteCategory, Webcam } from "@/lib/types";

// three-globe / R3F can't SSR – dynamic import with ssr: false
const Globe = dynamic(() => import("@/components/Globe"), { ssr: false });

// Mapbox uses the DOM heavily – no SSR
const MapboxRouteMap = dynamic(() => import("@/components/MapboxRouteMap"), { ssr: false });
const MapboxFlightMap = dynamic(() => import("@/components/MapboxFlightMap"), { ssr: false });
const WebcamViewer = dynamic(() => import("@/components/WebcamViewer"), { ssr: false });

type ViewMode = "globe" | "map";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("globe");
  const [coordinates, setCoordinates] = useState<Coordinate[]>([]);
  const [autoRotate, setAutoRotate] = useState(true);
  const [rotationSpeed, setRotationSpeed] = useState(1);
  const [focusTarget, setFocusTarget] = useState<Coordinate | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<Coordinate | null>(null);
  const [presetRefreshKey, setPresetRefreshKey] = useState(0);

  // Routing state
  const [routeOrigin, setRouteOrigin] = useState<Coordinate | null>(null);
  const [routeDestination, setRouteDestination] = useState<Coordinate | null>(null);
  const showRouteMap = !!(routeOrigin && routeDestination && MAPBOX_TOKEN);

  // Flight tracking state
  const [flights, setFlights] = useState<Flight[]>([]);
  const [flightsEnabled, setFlightsEnabled] = useState(false);
  const [flightsLoading, setFlightsLoading] = useState(false);
  const [flightsError, setFlightsError] = useState<string | null>(null);
  const [selectedFlightIcao, setSelectedFlightIcao] = useState<string | null>(null);
  const [globeFlights, setGlobeFlights] = useState<Flight[]>([]);
  const [flightRoute, setFlightRoute] = useState<FlightRoute | null>(null);
  const [flightRouteLoading, setFlightRouteLoading] = useState(false);
  const [flightRouteError, setFlightRouteError] = useState<string | null>(null);
  const flightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeFetchRef = useRef<AbortController | null>(null);

  // Satellite tracking state
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [satellitesEnabled, setSatellitesEnabled] = useState(false);
  const [satellitesLoading, setSatellitesLoading] = useState(false);
  const [satellitesError, setSatellitesError] = useState<string | null>(null);
  const [selectedSatId, setSelectedSatId] = useState<number | null>(null);
  const [satelliteCategory, setSatelliteCategory] = useState<SatelliteCategory>(0);
  const [satelliteOrbit, setSatelliteOrbit] = useState<Satellite[]>([]);
  const [satelliteOrbitLoading, setSatelliteOrbitLoading] = useState(false);
  const satTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const satOrbitFetchRef = useRef<AbortController | null>(null);

  // Webcam state
  const [webcams, setWebcams] = useState<Webcam[]>([]);
  const [webcamsEnabled, setWebcamsEnabled] = useState(false);
  const [webcamsLoading, setWebcamsLoading] = useState(false);
  const [webcamsError, setWebcamsError] = useState<string | null>(null);
  const [selectedWebcamId, setSelectedWebcamId] = useState<string | null>(null);
  const [viewingWebcam, setViewingWebcam] = useState<Webcam | null>(null);
  const webcamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFlights = useCallback(async () => {
    setFlightsLoading(true);
    setFlightsError(null);
    try {
      const res = await fetch("/api/flights");
      const data = await res.json();
      if (res.ok) {
        setFlights(data.flights ?? []);
      } else {
        setFlightsError(data.error ?? `API error ${res.status}`);
      }
    } catch (err) {
      setFlightsError("Network error — retrying…");
    } finally {
      setFlightsLoading(false);
    }
  }, []);

  // Auto-polling when enabled
  useEffect(() => {
    if (flightsEnabled) {
      fetchFlights();
      flightTimerRef.current = setInterval(fetchFlights, 15_000); // refresh every 15 s
    } else {
      setFlights([]);
      setSelectedFlightIcao(null);
      setFlightRoute(null);
      setFlightRouteError(null);
      setFlightRouteLoading(false);
      routeFetchRef.current?.abort();
      if (flightTimerRef.current) clearInterval(flightTimerRef.current);
    }
    return () => {
      if (flightTimerRef.current) clearInterval(flightTimerRef.current);
    };
  }, [flightsEnabled, fetchFlights]);

  // ── Satellite fetching (two hemispheres for global coverage) ──
  const fetchSatellites = useCallback(async (cat?: SatelliteCategory) => {
    setSatellitesLoading(true);
    setSatellitesError(null);
    try {
      const useCat = cat ?? satelliteCategory;
      // Fetch from two observer points 180° apart; each has a 90°
      // search radius so the circles meet/overlap at 0° and ±180° — full
      // global coverage with only 2 API calls instead of 3.
      const observers = [
        { lat: "0", lng: "90" },
        { lat: "0", lng: "-90" },
      ];
      const fetches = observers.map((obs) => {
        const params = new URLSearchParams({
          mode: "above",
          lat: obs.lat,
          lng: obs.lng,
          alt: "0",
          radius: "90",
          category: String(useCat),
        });
        return fetch(`/api/satellites?${params}`).then((r) => r.json());
      });
      const results = await Promise.all(fetches);
      // Merge & deduplicate by satid
      const seen = new Map<number, any>();
      for (const data of results) {
        if (data.satellites) {
          for (const s of data.satellites) {
            seen.set(s.satid, s);
          }
        }
      }
      setSatellites([...seen.values()]);
      // Surface first error if both failed
      const firstError = results.find((d) => d.error);
      if (seen.size === 0 && firstError) {
        setSatellitesError(firstError.error);
      }
    } catch {
      setSatellitesError("Network error — retrying…");
    } finally {
      setSatellitesLoading(false);
    }
  }, [satelliteCategory]);

  // Auto-polling when enabled
  useEffect(() => {
    if (satellitesEnabled) {
      fetchSatellites();
      satTimerRef.current = setInterval(() => fetchSatellites(), 120_000); // refresh every 2 min
    } else {
      setSatellites([]);
      setSelectedSatId(null);
      if (satTimerRef.current) clearInterval(satTimerRef.current);
    }
    return () => {
      if (satTimerRef.current) clearInterval(satTimerRef.current);
    };
  }, [satellitesEnabled, fetchSatellites]);

  const handleToggleSatellites = useCallback(() => {
    setSatellitesEnabled((p) => !p);
  }, []);

  // ── Webcam fetching ──
  const fetchWebcams = useCallback(async () => {
    setWebcamsLoading(true);
    setWebcamsError(null);
    try {
      // Fetch webcams from many major cities (radius capped at 250 km by Windy API)
      const regions = [
        { lat: "40.7", lng: "-74.0" },     // New York
        { lat: "34.0", lng: "-118.2" },    // Los Angeles
        { lat: "41.8", lng: "-87.6" },     // Chicago
        { lat: "25.7", lng: "-80.2" },     // Miami
        { lat: "48.8", lng: "2.3" },       // Paris
        { lat: "51.5", lng: "-0.1" },      // London
        { lat: "52.5", lng: "13.4" },      // Berlin
        { lat: "41.9", lng: "12.5" },      // Rome
        { lat: "35.6", lng: "139.6" },     // Tokyo
        { lat: "22.3", lng: "114.1" },     // Hong Kong
        { lat: "-33.8", lng: "151.2" },    // Sydney
        { lat: "30.0", lng: "31.2" },      // Cairo
        { lat: "55.7", lng: "37.6" },      // Moscow
        { lat: "-22.9", lng: "-43.1" },    // Rio de Janeiro
        { lat: "1.3", lng: "103.8" },      // Singapore
      ];
      const fetches = regions.map((r) => {
        const params = new URLSearchParams({
          lat: r.lat,
          lng: r.lng,
          radius: "250",
          limit: "50",
        });
        return fetch(`/api/webcams?${params}`).then((res) => res.json());
      });
      const results = await Promise.all(fetches);
      // Merge & deduplicate by id
      const seen = new Map<string, Webcam>();
      for (const data of results) {
        if (data.webcams) {
          for (const w of data.webcams) {
            seen.set(w.id, w);
          }
        }
      }
      setWebcams([...seen.values()]);
      const firstError = results.find((d: any) => d.error);
      if (seen.size === 0 && firstError) {
        setWebcamsError(firstError.error);
      }
    } catch {
      setWebcamsError("Network error loading webcams");
    } finally {
      setWebcamsLoading(false);
    }
  }, []);

  // Auto-fetch when enabled
  useEffect(() => {
    if (webcamsEnabled) {
      fetchWebcams();
      webcamTimerRef.current = setInterval(fetchWebcams, 300_000); // refresh every 5 min
    } else {
      setWebcams([]);
      setSelectedWebcamId(null);
      setViewingWebcam(null);
      if (webcamTimerRef.current) clearInterval(webcamTimerRef.current);
    }
    return () => {
      if (webcamTimerRef.current) clearInterval(webcamTimerRef.current);
    };
  }, [webcamsEnabled, fetchWebcams]);

  const handleToggleWebcams = useCallback(() => {
    setWebcamsEnabled((p) => !p);
  }, []);

  const handleSelectWebcam = useCallback((w: Webcam | null) => {
    setSelectedWebcamId(w?.id ?? null);
    if (w) {
      setAutoRotate(false);
      setFocusTarget({ id: `__webcam_${w.id}`, lat: w.lat, lng: w.lng, label: w.title });
      // Open the viewer overlay
      setViewingWebcam(w);
    } else {
      setViewingWebcam(null);
    }
  }, []);

  const handleSatelliteCategoryChange = useCallback((cat: SatelliteCategory) => {
    setSatelliteCategory(cat);
    if (satellitesEnabled) {
      // Re-fetch immediately with new category
      fetchSatellites(cat);
    }
  }, [satellitesEnabled, fetchSatellites]);

  const handleSelectSatellite = useCallback((s: Satellite | null) => {
    setSelectedSatId(s?.satid ?? null);
    // Clear previous orbit
    satOrbitFetchRef.current?.abort();
    setSatelliteOrbit([]);
    if (s) {
      setAutoRotate(false);
      setFocusTarget({ id: `__sat_${s.satid}`, lat: s.lat, lng: s.lng, label: s.satname });
      // Fetch predicted orbit positions (90 minutes ≈ 1 full LEO orbit, 300 samples)
      const controller = new AbortController();
      satOrbitFetchRef.current = controller;
      setSatelliteOrbitLoading(true);
      const params = new URLSearchParams({
        mode: "positions",
        id: String(s.satid),
        lat: "0",
        lng: "0",
        alt: "0",
        seconds: "5400", // 90 minutes
      });
      fetch(`/api/satellites?${params}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          if (data.positions) setSatelliteOrbit(data.positions);
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") console.error("Orbit fetch failed", err);
        })
        .finally(() => setSatelliteOrbitLoading(false));
    }
  }, []);

  const handleToggleFlights = useCallback(() => {
    setFlightsEnabled((p) => !p);
  }, []);

  // Only render flights on the globe once the user applies a filter,
  // but always preserve the selected flight so it doesn't vanish on refresh.
  const handleVisibleFlightsChange = useCallback((visible: Flight[], hasFilter: boolean) => {
    setGlobeFlights((prev) => {
      const base = hasFilter ? visible : [];
      // If a flight is selected, ensure it stays on the globe
      if (selectedFlightIcao && !base.some((f) => f.icao24 === selectedFlightIcao)) {
        const fresh = visible.find((f) => f.icao24 === selectedFlightIcao)
          ?? prev.find((f) => f.icao24 === selectedFlightIcao);
        if (fresh) return [...base, fresh];
      }
      return base;
    });
  }, [selectedFlightIcao]);

  // Fetch flight route from SerpAPI when a flight is selected
  const fetchFlightRoute = useCallback(async (callsign: string, acLat?: number, acLng?: number, acHeading?: number) => {
    // Abort any in-flight request
    routeFetchRef.current?.abort();
    const controller = new AbortController();
    routeFetchRef.current = controller;

    setFlightRouteLoading(true);
    setFlightRouteError(null);
    setFlightRoute(null);

    try {
      const params = new URLSearchParams({ callsign });
      if (acLat != null && acLng != null) {
        params.set("lat", String(acLat));
        params.set("lng", String(acLng));
      }
      if (acHeading != null) {
        params.set("heading", String(acHeading));
      }
      const res = await fetch(`/api/flights/route?${params}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      if (res.ok && data.route) {
        setFlightRoute(data.route);
        // Zoom out to show the full route arc if coordinates are valid
        const r = data.route as FlightRoute;
        if (
          r.departureLat && r.arrivalLat &&
          !(r.departureLat === 0 && r.departureLng === 0) &&
          !(r.arrivalLat === 0 && r.arrivalLng === 0)
        ) {
          const midLat = (r.departureLat + r.arrivalLat) / 2;
          const midLng = (r.departureLng + r.arrivalLng) / 2;
          setFocusTarget({ id: "__arc_mid__", lat: midLat, lng: midLng, label: "" });
        }
      } else {
        setFlightRouteError(data.error ?? "Route not found");
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setFlightRouteError("Failed to look up flight route");
      }
    } finally {
      setFlightRouteLoading(false);
    }
  }, []);

  const handleSelectFlight = useCallback((f: Flight | null) => {
    setSelectedFlightIcao(f?.icao24 ?? null);
    if (f) {
      setAutoRotate(false);
      setFocusTarget({ id: `__flight_${f.icao24}`, lat: f.lat, lng: f.lng, label: f.callsign || f.icao24 });
      // Ensure the selected flight is visible on the globe even without a filter
      setGlobeFlights((prev) => {
        const without = prev.filter((p) => p.icao24 !== f.icao24);
        return [...without, f];
      });
      // Look up route info if the callsign looks like a flight
      // Matches AAL1234, DL1234, B61234, N12345 etc. – 2-3 letter prefix + digits
      if (f.callsign && /^[A-Z]{2,3}\d+/i.test(f.callsign.trim())) {
        fetchFlightRoute(f.callsign.trim(), f.lat, f.lng, f.heading);
      } else {
        setFlightRoute(null);
        setFlightRouteError(null);
      }
    } else {
      // Deselected — clear route
      routeFetchRef.current?.abort();
      setFlightRoute(null);
      setFlightRouteError(null);
      setFlightRouteLoading(false);
    }
  }, [fetchFlightRoute]);

  const handleAdd = useCallback((c: Coordinate) => {
    setCoordinates((prev) => [...prev, c]);
    setAutoRotate(false);
    // If an arc exists, focus on the midpoint between the last point and the new one
    if (coordinates.length >= 1) {
      const last = coordinates[coordinates.length - 1];
      const midLat = (last.lat + c.lat) / 2;
      const midLng = (last.lng + c.lng) / 2;
      setFocusTarget({ ...c, id: "__arc_mid__", lat: midLat, lng: midLng, label: "" });
    } else {
      setFocusTarget(c);
    }
  }, [coordinates]);

  const handleRemove = useCallback((id: string) => {
    setCoordinates((prev) => prev.filter((c) => c.id !== id));
    // Clear route if a routed point is removed
    setRouteOrigin((prev) => (prev?.id === id ? null : prev));
    setRouteDestination((prev) => (prev?.id === id ? null : prev));
    // Close detail pane if this point was selected
    setSelectedPoint((prev) => (prev?.id === id ? null : prev));
  }, []);

  const handleFocus = useCallback((c: Coordinate) => {
    setAutoRotate(false);
    setFocusTarget({ ...c }); // new ref to re-trigger effect
  }, []);

  const handleRoute = useCallback((origin: Coordinate, destination: Coordinate) => {
    setRouteOrigin(origin);
    setRouteDestination(destination);
  }, []);

  const handleCloseRoute = useCallback(() => {
    setRouteOrigin(null);
    setRouteDestination(null);
  }, []);

  const handleSelectPoint = useCallback((c: Coordinate) => {
    setSelectedPoint(c);
    setAutoRotate(false);
    setFocusTarget({ ...c });
  }, []);

  const handleRename = useCallback((id: string, newLabel: string) => {
    setCoordinates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, label: newLabel } : c))
    );
    setSelectedPoint((prev) =>
      prev?.id === id ? { ...prev, label: newLabel } : prev
    );
  }, []);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#020a14]">
      {/* sidebar */}
      <aside className="w-80 shrink-0 flex flex-col bg-[#020202]">
        <Box px="4" py="3">
          <Heading size="3" weight="bold" style={{ color: "white", textTransform: "uppercase" }}>
            Qterra
          </Heading>
        </Box>
        <Separator size="4" />
        <div className="flex-1 overflow-hidden">
        <CoordinatePanel
          coordinates={coordinates}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onFocus={handleFocus}
          onSelect={handleSelectPoint}
          rotationSpeed={rotationSpeed}
          onSpeedChange={setRotationSpeed}
          onRoute={handleRoute}
          routeActive={showRouteMap}
          presetRefreshKey={presetRefreshKey}
          flights={flights}
          flightsLoading={flightsLoading}
          flightsError={flightsError}
          flightsEnabled={flightsEnabled}
          onToggleFlights={handleToggleFlights}
          onRefreshFlights={fetchFlights}
          onSelectFlight={handleSelectFlight}
          selectedFlightIcao={selectedFlightIcao}
          onVisibleFlightsChange={handleVisibleFlightsChange}
          flightRoute={flightRoute}
          flightRouteLoading={flightRouteLoading}
          flightRouteError={flightRouteError}
          satellites={satellites}
          satellitesLoading={satellitesLoading}
          satellitesError={satellitesError}
          satellitesEnabled={satellitesEnabled}
          onToggleSatellites={handleToggleSatellites}
          onRefreshSatellites={() => fetchSatellites()}
          onSelectSatellite={handleSelectSatellite}
          selectedSatId={selectedSatId}
          satelliteCategory={satelliteCategory}
          onSatelliteCategoryChange={handleSatelliteCategoryChange}
          webcams={webcams}
          webcamsLoading={webcamsLoading}
          webcamsError={webcamsError}
          webcamsEnabled={webcamsEnabled}
          onToggleWebcams={handleToggleWebcams}
          onRefreshWebcams={fetchWebcams}
          onSelectWebcam={handleSelectWebcam}
          selectedWebcamId={selectedWebcamId}
        />
        </div>
      </aside>

      {/* viewport */}
      <div className="flex-1 relative overflow-hidden">
        {viewMode === "globe" ? (
          <Globe
            coordinates={coordinates}
            autoRotate={autoRotate}
            onToggleRotate={() => setAutoRotate((p) => !p)}
            rotationSpeed={rotationSpeed}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid((p) => !p)}
            focusTarget={focusTarget}
            flights={globeFlights}
            selectedFlightIcao={selectedFlightIcao}
            flightRoute={flightRoute}
            satellites={satellites}
            selectedSatId={selectedSatId}
            satelliteOrbit={satelliteOrbit}
            webcams={webcams}
            selectedWebcamId={selectedWebcamId}
          />
        ) : (
          <MapboxFlightMap
            mapboxToken={MAPBOX_TOKEN}
            coordinates={coordinates}
            flights={globeFlights}
            selectedFlightIcao={selectedFlightIcao}
            flightRoute={flightRoute}
            onSelectFlight={handleSelectFlight}
            webcams={webcams}
            selectedWebcamId={selectedWebcamId}
            onSelectWebcam={handleSelectWebcam}
          />
        )}

        {/* Mapbox street-level route overlay */}
        {showRouteMap && (
          <MapboxRouteMap
            key={`${routeOrigin.id}-${routeDestination.id}`}
            origin={routeOrigin}
            destination={routeDestination}
            mapboxToken={MAPBOX_TOKEN}
            onClose={handleCloseRoute}
          />
        )}

        {/* View toggle buttons */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex rounded-lg overflow-hidden border border-white/15 backdrop-blur-md bg-black/40 shadow-lg">
          <button
            onClick={() => setViewMode("globe")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === "globe"
                ? "bg-amber-600/80 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            3D Globe
          </button>
          <button
            onClick={() => setViewMode("map")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === "map"
                ? "bg-amber-600/80 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            Map
          </button>
        </div>

        {/* point detail pane — overlaid so it doesn't shift the globe container */}
        {selectedPoint && (
          <div className="absolute left-0 top-0 bottom-0 z-[10000]">
            <PointDetailPane
              key={selectedPoint.id}
              coordinate={selectedPoint}
              onClose={() => setSelectedPoint(null)}
              onFocus={handleFocus}
              onRename={handleRename}
              googleMapsApiKey={GOOGLE_MAPS_API_KEY || undefined}
              onSaved={() => setPresetRefreshKey((k) => k + 1)}
            />
          </div>
        )}

        {/* Webcam viewer overlay */}
        {viewingWebcam && (
          <WebcamViewer
            webcam={viewingWebcam}
            onClose={() => {
              setViewingWebcam(null);
              setSelectedWebcamId(null);
            }}
          />
        )}
      </div>
    </main>
  );
}
