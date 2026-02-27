"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Box, Flex, Heading, Text, Separator } from "@radix-ui/themes";
import CoordinatePanel from "@/components/CoordinatePanel";
import PointDetailPane from "@/components/PointDetailPane";
import type { Coordinate, Flight, FlightRoute } from "@/lib/types";

// three-globe / R3F can't SSR – dynamic import with ssr: false
const Globe = dynamic(() => import("@/components/Globe"), { ssr: false });

// Mapbox uses the DOM heavily – no SSR
const MapboxRouteMap = dynamic(() => import("@/components/MapboxRouteMap"), { ssr: false });

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export default function Home() {
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
  const fetchFlightRoute = useCallback(async (callsign: string) => {
    // Abort any in-flight request
    routeFetchRef.current?.abort();
    const controller = new AbortController();
    routeFetchRef.current = controller;

    setFlightRouteLoading(true);
    setFlightRouteError(null);
    setFlightRoute(null);

    try {
      const res = await fetch(`/api/flights/route?callsign=${encodeURIComponent(callsign)}`, {
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
        fetchFlightRoute(f.callsign.trim());
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
          autoRotate={autoRotate}
          onToggleRotate={() => setAutoRotate((p) => !p)}
          rotationSpeed={rotationSpeed}
          onSpeedChange={setRotationSpeed}
          onRoute={handleRoute}
          routeActive={showRouteMap}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid((p) => !p)}
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
        />
        </div>
      </aside>

      {/* globe viewport */}
      <div className="flex-1 relative overflow-hidden">
        <Globe
          coordinates={coordinates}
          autoRotate={autoRotate}
          rotationSpeed={rotationSpeed}
          focusTarget={focusTarget}
          showGrid={showGrid}
          flights={globeFlights}
          selectedFlightIcao={selectedFlightIcao}
          flightRoute={flightRoute}
        />

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
      </div>
    </main>
  );
}
