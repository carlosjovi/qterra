"use client";

import { useState, useEffect } from "react";
import {
  Box,
  Text,
  Heading,
  TextField,
  Button,
  Flex,
  IconButton,
  ScrollArea,
  Separator,
  Badge,
  Tooltip,
} from "@radix-ui/themes";
import {
  MagnifyingGlassIcon,
  Cross2Icon,
  GlobeIcon,
  ResumeIcon,
  PauseIcon,
  RocketIcon,
  GridIcon,
} from "@radix-ui/react-icons";
import * as SliderPrimitive from "@radix-ui/react-slider";
import type { Coordinate } from "@/lib/types";

let nextId = 1;

export default function CoordinatePanel({
  coordinates,
  onAdd,
  onRemove,
  onFocus,
  autoRotate,
  onToggleRotate,
  rotationSpeed,
  onSpeedChange,
  onRoute,
  routeActive,
  showGrid,
  onToggleGrid,
}: {
  coordinates: Coordinate[];
  onAdd: (c: Coordinate) => void;
  onRemove: (id: string) => void;
  onFocus: (c: Coordinate) => void;
  autoRotate: boolean;
  onToggleRotate: () => void;
  rotationSpeed: number;
  onSpeedChange: (speed: number) => void;
  onRoute: (origin: Coordinate, destination: Coordinate) => void;
  routeActive: boolean;
  showGrid: boolean;
  onToggleGrid: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [routeOriginId, setRouteOriginId] = useState<string>("");
  const [routeDestId, setRouteDestId] = useState<string>("");

  // Clear stale selections when a coordinate is removed
  useEffect(() => {
    const ids = new Set(coordinates.map((c) => c.id));
    if (routeOriginId && !ids.has(routeOriginId)) setRouteOriginId("");
    if (routeDestId && !ids.has(routeDestId)) setRouteDestId("");
  }, [coordinates, routeOriginId, routeDestId]);

  /* ---- server-side geocode via our API route ---- */
  const handleGeocode = async () => {
    const q = searchQuery.trim();
    if (!q) return;

    setGeocoding(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      if (data.results?.length) {
        const r = data.results[0];
        const newId = String(nextId++);
        onAdd({
          id: newId,
          lat: r.lat,
          lng: r.lng,
          label: r.name ?? q,
          color: "#f59f0a",
        });
        // Auto-assign: first search result → origin, second → destination
        if (!routeOriginId) {
          setRouteOriginId(newId);
        } else if (!routeDestId) {
          setRouteDestId(newId);
        }
        setSearchQuery("");
      } else {
        alert("No results found for that query.");
      }
    } catch {
      alert("Geocoding request failed.");
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <Flex direction="column" gap="4" p="4">
      {/* ---- Controls ---- */}
      <Box>
        <SectionHeading>Controls</SectionHeading>
        <Flex align="center" gap="3" mt="2">
          <Tooltip content={autoRotate ? "Pause rotation" : "Resume rotation"}>
            <Button
              variant="soft"
              size="1"
              color="amber"
              onClick={onToggleRotate}
            >
              {autoRotate ? <PauseIcon /> : <ResumeIcon />}
              {autoRotate ? "Pause" : "Rotate"}
            </Button>
          </Tooltip>
          <Tooltip content={showGrid ? "Hide grid lines" : "Show grid lines"}>
            <Button
              variant={showGrid ? "solid" : "soft"}
              size="1"
              color="amber"
              onClick={onToggleGrid}
            >
              <GridIcon />
              Grid
            </Button>
          </Tooltip>

          <Flex align="center" gap="2" flexGrow="1">
            <Text size="1" color="gray">Speed</Text>
            <SliderPrimitive.Root
              className="relative flex h-4 w-full touch-none select-none items-center"
              min={0}
              max={5}
              step={0.1}
              value={[rotationSpeed]}
              onValueChange={([v]) => onSpeedChange(v)}
            >
              <SliderPrimitive.Track className="relative h-[3px] grow rounded-full bg-[--gray-6]">
                <SliderPrimitive.Range className="absolute h-full rounded-full bg-[--accent-9]" />
              </SliderPrimitive.Track>
              <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border border-[--accent-8] bg-[--gray-1] shadow focus:outline-none focus:ring-1 focus:ring-[--accent-8]" />
            </SliderPrimitive.Root>
            <Text size="1" color="gray" style={{ minWidth: 22, textAlign: "right" }}>
              {rotationSpeed.toFixed(1)}
            </Text>
          </Flex>
        </Flex>
      </Box>

      <Separator size="4" />

      {/* ---- Google Maps / Geocode search ---- */}
      <Box>
        <SectionHeading>
          <GlobeIcon style={{ display: "inline", marginRight: 4 }} />
          Location Search
        </SectionHeading>
        <Flex gap="2" mt="2">
          <TextField.Root
            size="1"
            placeholder="e.g. Tokyo, Japan or a business name"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGeocode()}
            style={{ flex: 1 }}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon height="12" width="12" />
            </TextField.Slot>
          </TextField.Root>
          <Tooltip content="Search location">
            <Button
              variant="soft"
              color="amber"
              size="1"
              disabled={geocoding}
              onClick={handleGeocode}
            >
              {geocoding ? "…" : <MagnifyingGlassIcon color="white"/>}
            </Button>
          </Tooltip>
        </Flex>
      </Box>

      <Separator size="4" />

      {/* ---- Coordinate list ---- */}
      <Box>
        <SectionHeading>
          Points{" "}
          <Badge variant="soft" color="amber" size="1" ml="1">
            {coordinates.length}
          </Badge>
        </SectionHeading>

        {coordinates.length === 0 ? (
          <Text size="1" color="gray" mt="2" as="p">
            No points yet.
          </Text>
        ) : (
          <ScrollArea scrollbars="vertical" style={{ maxHeight: 220 }}>
            <Flex direction="column" gap="1" mt="2" pr="2">
              {coordinates.map((c) => (
                <Flex
                  key={c.id}
                  align="center"
                  justify="between"
                  px="2"
                  py="1"
                  className="rounded-md bg-[--gray-a3] group hover:bg-[--gray-a4] transition-colors"
                >
                  <Tooltip content={`Focus on ${c.label}`}>
                    <button
                      onClick={() => onFocus(c)}
                      className="flex-1 text-left text-xs truncate hover:text-[--accent-11] transition-colors"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                        style={{ background: c.color ?? "#ff6600" }}
                      />
                      {c.label}{" "}
                      <Text size="1" color="gray">
                        ({c.lat.toFixed(2)}, {c.lng.toFixed(2)})
                      </Text>
                    </button>
                  </Tooltip>
                  <Tooltip content="Remove point">
                    <IconButton
                      variant="ghost"
                      color="red"
                      size="1"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => onRemove(c.id)}
                    >
                      <Cross2Icon />
                    </IconButton>
                  </Tooltip>
                </Flex>
              ))}
            </Flex>
          </ScrollArea>
        )}
      </Box>

      <Separator size="4" />

      {/* ---- Route Planner ---- */}
      <Box>
        <SectionHeading>
          <RocketIcon style={{ display: "inline", marginRight: 4 }} />
          Street-Level Routing
        </SectionHeading>

        {coordinates.length < 2 ? (
          <Text size="1" color="gray" mt="2" as="p">
            Add at least 2 points to plan a route.
          </Text>
        ) : (
          <Flex direction="column" gap="2" mt="2">
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">Origin (A)</Text>
              <select
                value={routeOriginId}
                onChange={(e) => setRouteOriginId(e.target.value)}
                style={{
                  fontSize: 12,
                  background: "#161b22",
                  color: "#c9d1d9",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  width: "100%",
                }}
              >
                <option value="">Select origin…</option>
                {coordinates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.lat.toFixed(2)}, {c.lng.toFixed(2)})
                  </option>
                ))}
              </select>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">Destination (B)</Text>
              <select
                value={routeDestId}
                onChange={(e) => setRouteDestId(e.target.value)}
                style={{
                  fontSize: 12,
                  background: "#161b22",
                  color: "#c9d1d9",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  width: "100%",
                }}
              >
                <option value="">Select destination…</option>
                {coordinates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.lat.toFixed(2)}, {c.lng.toFixed(2)})
                  </option>
                ))}
              </select>
            </Flex>
            <Button
              variant="soft"
              color="amber"
              size="1"
              disabled={!routeOriginId || !routeDestId || routeOriginId === routeDestId}
              onClick={() => {
                const o = coordinates.find((c) => c.id === routeOriginId);
                const d = coordinates.find((c) => c.id === routeDestId);
                if (o && d) onRoute(o, d);
              }}
            >
              <RocketIcon /> {routeActive ? "Update Route" : "Show Route Map"}
            </Button>
          </Flex>
        )}
      </Box>

      <Separator size="4" />

      {/* ---- Presets ---- */}
      <Box>
        <SectionHeading>Quick Presets</SectionHeading>
        <Flex wrap="wrap" gap="1" mt="2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              color="gray"
              size="1"
              onClick={() =>
                onAdd({
                  id: String(nextId++),
                  ...p,
                  color: "#ffcc00",
                })
              }
              style={{ cursor: "pointer" }}
            >
              {p.label}
            </Button>
          ))}
        </Flex>
      </Box>
    </Flex>
  );
}

/* ---- helpers ---- */

function SectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Heading
      as="h2"
      size="1"
      weight="medium"
      className={className}
      style={{
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--gray-12)",
      }}
    >
      {children}
    </Heading>
  );
}

const PRESETS = [
  { label: "New York", lat: 40.7128, lng: -74.006 },
  { label: "London", lat: 51.5074, lng: -0.1278 },
  { label: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { label: "Sydney", lat: -33.8688, lng: 151.2093 },
  { label: "São Paulo", lat: -23.5505, lng: -46.6333 },
  { label: "Cairo", lat: 30.0444, lng: 31.2357 },
  { label: "Mumbai", lat: 19.076, lng: 72.8777 },
  { label: "Nairobi", lat: -1.2921, lng: 36.8219 },
];
