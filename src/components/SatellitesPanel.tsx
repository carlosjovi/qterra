"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Box,
  Text,
  Heading,
  Button,
  Flex,
  ScrollArea,
  Badge,
  Tooltip,
  TextField,
  Switch,
  Separator,
  Select,
} from "@radix-ui/themes";
import {
  MagnifyingGlassIcon,
  Cross2Icon,
  ReloadIcon,
  TriangleUpIcon,
  MixIcon,
} from "@radix-ui/react-icons";
import type { Satellite, SatelliteCategory } from "@/lib/types";

/* ── category map ── */

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "0",  label: "All satellites" },
  { value: "2",  label: "ISS (Zarya)" },
  { value: "45", label: "Starlink" },
  { value: "46", label: "OneWeb" },
  { value: "20", label: "GPS" },
  { value: "21", label: "GLONASS" },
  { value: "22", label: "Galileo" },
  { value: "35", label: "Beidou" },
  { value: "1",  label: "Brightest" },
  { value: "3",  label: "Weather" },
  { value: "15", label: "Iridium" },
  { value: "18", label: "Amateur Radio" },
  { value: "32", label: "CubeSats" },
  { value: "10", label: "Geostationary" },
  { value: "47", label: "Active Geosync" },
  { value: "30", label: "Military" },
  { value: "6",  label: "Earth Resources" },
  { value: "26", label: "Space & Earth Sci" },
  { value: "48", label: "Flock (Planet)" },
  { value: "34", label: "TV" },
];

/* ── helpers ── */

function formatAltitude(km: number): string {
  if (!km && km !== 0) return "—";
  return `${Math.round(km).toLocaleString()} km`;
}

function orbitLabel(altKm: number): string {
  if (altKm < 2000) return "LEO";
  if (altKm < 35786) return "MEO";
  if (altKm < 36786) return "GEO";
  return "HEO";
}

function orbitColor(altKm: number): "blue" | "green" | "orange" | "red" {
  if (altKm < 2000) return "blue";
  if (altKm < 35786) return "green";
  if (altKm < 36786) return "orange";
  return "red";
}

/* ── component ── */

export default function SatellitesPanel({
  satellites,
  loading,
  error,
  enabled,
  onToggleEnabled,
  onRefresh,
  onSelectSatellite,
  selectedSatId,
  onCategoryChange,
  category,
}: {
  satellites: Satellite[];
  loading: boolean;
  error: string | null;
  enabled: boolean;
  onToggleEnabled: () => void;
  onRefresh: () => void;
  onSelectSatellite: (s: Satellite | null) => void;
  selectedSatId: number | null;
  onCategoryChange: (cat: SatelliteCategory) => void;
  category: SatelliteCategory;
}) {
  const [filter, setFilter] = useState("");
  const [altitudeSort, setAltitudeSort] = useState<"none" | "asc" | "desc">("none");

  const hasFilter = !!filter;

  const visible = useMemo(() => {
    let list = satellites;

    // Text filter
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(
        (s) =>
          s.satname.toLowerCase().includes(q) ||
          String(s.satid).includes(q) ||
          (s.intDesignator ?? "").toLowerCase().includes(q),
      );
    }

    // Sort
    if (altitudeSort === "asc") {
      list = [...list].sort((a, b) => a.altitude - b.altitude);
    } else if (altitudeSort === "desc") {
      list = [...list].sort((a, b) => b.altitude - a.altitude);
    }

    return list;
  }, [satellites, filter, altitudeSort]);

  return (
    <Flex direction="column" gap="3" p="4" style={{ height: "100%" }}>
      {/* Header */}
      <Flex align="center" justify="between">
        <Flex align="center" gap="2">
          <MixIcon style={{ color: "var(--amber-9)" }} />
          <Heading size="2" style={{ color: "var(--gray-12)" }}>
            Satellite Tracker
          </Heading>
        </Flex>
        <Flex align="center" gap="2">
          <Text size="1" color="gray">
            {enabled ? "Live" : "Off"}
          </Text>
          <Switch
            size="1"
            color="amber"
            checked={enabled}
            onCheckedChange={onToggleEnabled}
          />
        </Flex>
      </Flex>

      {!enabled && (
        <Flex direction="column" align="center" justify="center" gap="3" py="6">
          <MixIcon width="28" height="28" style={{ color: "var(--gray-8)" }} />
          <Text size="1" color="gray" align="center">
            Enable tracking to see live satellite positions from N2YO.
          </Text>
        </Flex>
      )}

      {enabled && (
        <>
          {/* Category selector */}
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              Category
            </Text>
            <select
              value={String(category)}
              onChange={(e) => onCategoryChange(parseInt(e.target.value, 10) as SatelliteCategory)}
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
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Flex>

          {/* Stats + refresh */}
          <Flex align="center" justify="between">
            <Flex gap="2" align="center">
              <Badge variant="soft" color="amber" size="1">
                {satellites.length} sats
              </Badge>
              {loading && (
                <Text size="1" color="amber" className="animate-pulse">
                  updating…
                </Text>
              )}
              {error && (
                <Tooltip content={error}>
                  <Badge variant="soft" color="red" size="1">
                    error
                  </Badge>
                </Tooltip>
              )}
            </Flex>
            <Tooltip content="Refresh now">
              <Button variant="ghost" color="gray" size="1" onClick={onRefresh} disabled={loading}>
                <ReloadIcon />
              </Button>
            </Tooltip>
          </Flex>

          <Separator size="4" />

          {/* Search + sort */}
          <Flex gap="2" align="center">
            <TextField.Root
              size="1"
              placeholder="Filter by name or NORAD ID…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ flex: 1 }}
            >
              <TextField.Slot>
                <MagnifyingGlassIcon height="12" width="12" />
              </TextField.Slot>
              {filter && (
                <TextField.Slot>
                  <button
                    onClick={() => setFilter("")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gray-9)", padding: 0 }}
                  >
                    <Cross2Icon height="10" width="10" />
                  </button>
                </TextField.Slot>
              )}
            </TextField.Root>

            <Tooltip content="Sort by altitude">
              <Button
                variant={altitudeSort !== "none" ? "solid" : "soft"}
                color="amber"
                size="1"
                onClick={() =>
                  setAltitudeSort((p) =>
                    p === "none" ? "desc" : p === "desc" ? "asc" : "none",
                  )
                }
              >
                <TriangleUpIcon
                  style={{
                    transform: altitudeSort === "asc" ? "rotate(180deg)" : undefined,
                    transition: "transform 0.15s",
                  }}
                />
                Alt
              </Button>
            </Tooltip>
          </Flex>

          {/* Satellite list */}
          {visible.length === 0 && !loading ? (
            <Text size="1" color="gray" align="center" mt="4">
              {filter ? "No satellites match your filter." : "No satellites found."}
            </Text>
          ) : (
            <ScrollArea scrollbars="vertical" style={{ flex: 1, maxHeight: "calc(100vh - 380px)" }}>
              <Flex direction="column" gap="1" pr="2">
                {visible.slice(0, 200).map((s) => {
                  const isSelected = s.satid === selectedSatId;
                  return (
                    <button
                      key={s.satid}
                      onClick={() => onSelectSatellite(isSelected ? null : s)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 6,
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        background: isSelected
                          ? "rgba(245, 158, 11, 0.15)"
                          : "var(--gray-a3)",
                        transition: "background 0.15s",
                        textAlign: "left",
                        width: "100%",
                      }}
                      className="hover:!bg-[--gray-a4]"
                    >
                      <Flex direction="column" gap="0" style={{ flex: 1, minWidth: 0 }}>
                        <Flex align="center" gap="1">
                          <Text
                            size="1"
                            weight="medium"
                            style={{
                              color: isSelected ? "var(--amber-11)" : "var(--gray-12)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 160,
                            }}
                          >
                            {s.satname || `SAT-${s.satid}`}
                          </Text>
                          <Badge variant="outline" color={orbitColor(s.altitude)} size="1">
                            {orbitLabel(s.altitude)}
                          </Badge>
                        </Flex>
                        <Text size="1" color="gray">
                          ID {s.satid} · {formatAltitude(s.altitude)} · {s.lat.toFixed(1)}°, {s.lng.toFixed(1)}°
                        </Text>
                      </Flex>
                    </button>
                  );
                })}
                {visible.length > 200 && (
                  <Text size="1" color="gray" align="center" style={{ padding: "8px 0" }}>
                    Showing 200 of {visible.length} — use filter to narrow
                  </Text>
                )}
              </Flex>
            </ScrollArea>
          )}
        </>
      )}
    </Flex>
  );
}
