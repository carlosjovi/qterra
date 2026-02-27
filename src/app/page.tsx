"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Box, Flex, Heading, Text, Separator } from "@radix-ui/themes";
import CoordinatePanel from "@/components/CoordinatePanel";
import type { Coordinate } from "@/lib/types";

// three-globe / R3F can't SSR – dynamic import with ssr: false
const Globe = dynamic(() => import("@/components/Globe"), { ssr: false });

// Mapbox uses the DOM heavily – no SSR
const MapboxRouteMap = dynamic(() => import("@/components/MapboxRouteMap"), { ssr: false });

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

export default function Home() {
  const [coordinates, setCoordinates] = useState<Coordinate[]>([]);
  const [autoRotate, setAutoRotate] = useState(true);
  const [rotationSpeed, setRotationSpeed] = useState(1);
  const [focusTarget, setFocusTarget] = useState<Coordinate | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  // Routing state
  const [routeOrigin, setRouteOrigin] = useState<Coordinate | null>(null);
  const [routeDestination, setRouteDestination] = useState<Coordinate | null>(null);
  const showRouteMap = !!(routeOrigin && routeDestination && MAPBOX_TOKEN);

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

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#020a14]">
      {/* sidebar */}
      <aside className="w-80 shrink-0 overflow-y-auto bg-[#020202]">
        <Box px="4" py="3">
          <Heading size="3" weight="bold" style={{ color: "white", textTransform: "uppercase" }}>
            Qterra
          </Heading>
        </Box>
        <Separator size="4" />
        <CoordinatePanel
          coordinates={coordinates}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onFocus={handleFocus}
          autoRotate={autoRotate}
          onToggleRotate={() => setAutoRotate((p) => !p)}
          rotationSpeed={rotationSpeed}
          onSpeedChange={setRotationSpeed}
          onRoute={handleRoute}
          routeActive={showRouteMap}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid((p) => !p)}
        />
      </aside>

      {/* globe viewport */}
      <div className="flex-1 relative">
        <Globe
          coordinates={coordinates}
          autoRotate={autoRotate}
          rotationSpeed={rotationSpeed}
          focusTarget={focusTarget}
          showGrid={showGrid}
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
      </div>
    </main>
  );
}
