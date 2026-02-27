"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Box, Flex, Heading, Text, Separator } from "@radix-ui/themes";
import CoordinatePanel from "@/components/CoordinatePanel";
import PointDetailPane from "@/components/PointDetailPane";
import type { Coordinate } from "@/lib/types";

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
  const [showGrid, setShowGrid] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<Coordinate | null>(null);
  const [presetRefreshKey, setPresetRefreshKey] = useState(0);

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
