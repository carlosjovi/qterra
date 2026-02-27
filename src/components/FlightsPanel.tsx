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
  TriangleDownIcon,
  PaperPlaneIcon,
} from "@radix-ui/react-icons";
import type { Flight, FlightRoute } from "@/lib/types";

/* ── helpers ── */

function formatAltitude(m: number): string {
  if (!m) return "—";
  const ft = Math.round(m * 3.28084);
  return `${ft.toLocaleString()} ft`;
}

function formatSpeed(ms: number): string {
  if (!ms) return "—";
  const kts = Math.round(ms * 1.94384);
  return `${kts} kts`;
}

function verticalIcon(rate: number) {
  if (rate > 1) return <TriangleUpIcon style={{ color: "var(--green-9)", display: "inline" }} />;
  if (rate < -1) return <TriangleDownIcon style={{ color: "var(--red-9)", display: "inline" }} />;
  return null;
}

/** Map ADS-B emitter category code to a human-readable label */
function categoryLabel(cat?: number): string | null {
  if (cat == null || cat === 0 || cat === 1) return null;
  const labels: Record<number, string> = {
    2: "Light",
    3: "Small",
    4: "Large",
    5: "HiVortex",
    6: "Heavy",
    7: "HiPerf",
    8: "Rotor",
    9: "Glider",
    10: "LTA",
    11: "Skydiver",
    12: "Ultralight",
    14: "UAV",
    15: "Space",
    16: "Emergency",
    17: "Service",
  };
  return labels[cat] ?? null;
}

/** Well-known ICAO airline designator → airline name (top carriers) */
const AIRLINE_CODES: Record<string, string> = {
  AAL: "American", UAL: "United", DAL: "Delta", SWA: "Southwest",
  JBU: "JetBlue", ASA: "Alaska", NKS: "Spirit", FFT: "Frontier",
  BAW: "British Airways", DLH: "Lufthansa", AFR: "Air France",
  KLM: "KLM", EZY: "easyJet", RYR: "Ryanair", THY: "Turkish",
  UAE: "Emirates", QTR: "Qatar", ETH: "Ethiopian", SIA: "Singapore",
  CPA: "Cathay", ANA: "ANA", JAL: "JAL", QFA: "Qantas",
  ACA: "Air Canada", WJA: "WestJet", TAM: "LATAM", LAN: "LATAM",
  AVA: "Avianca", CCA: "Air China", CES: "China Eastern", CSN: "China Southern",
  AIC: "Air India", AXB: "Air India Express", IGO: "IndiGo",
  VOZ: "Virgin AU", EIN: "Aer Lingus", IBE: "Iberia", VLG: "Vueling",
  SAS: "SAS", FIN: "Finnair", LOT: "LOT", TAP: "TAP",
  SVA: "Saudia", GIA: "Garuda", MAS: "Malaysia", THA: "Thai",
  KAL: "Korean Air", AAR: "Asiana", EVA: "EVA Air",
  RAM: "Royal Air Maroc", MSR: "EgyptAir", MEA: "MEA",
  FDX: "FedEx", UPS: "UPS", GTI: "Atlas Air",
};

/**
 * Derive a displayable airline / operator label from a flight.
 * Prefers ADS-B category when available, falls back to callsign-based
 * airline lookup (3-letter ICAO prefix).
 */
function flightTypeLabel(f: Flight): string | null {
  // Try ADS-B category first (available with authenticated OpenSky v2)
  const cat = categoryLabel(f.category);
  if (cat) return cat;
  // Extract 3-letter ICAO airline prefix from callsign (e.g. "UAL2005" → "UAL")
  if (f.callsign && f.callsign.length >= 3) {
    const prefix = f.callsign.slice(0, 3).toUpperCase();
    if (AIRLINE_CODES[prefix]) return AIRLINE_CODES[prefix];
  }
  return null;
}

/** Countries pinned to the top of the quick-filter list */
const PINNED_COUNTRIES = [
  "United States",
  "China",
  "United Kingdom",
  "Germany",
  "France",
  "Japan",
  "Canada",
  "Australia",
  "Brazil",
  "India",
];

/* ── component ── */

export default function FlightsPanel({
  flights,
  loading,
  error,
  enabled,
  onToggleEnabled,
  onRefresh,
  onSelectFlight,
  selectedFlightIcao,
  onVisibleFlightsChange,
  flightRoute = null,
  flightRouteLoading = false,
  flightRouteError = null,
}: {
  flights: Flight[];
  loading: boolean;
  error: string | null;
  enabled: boolean;
  onToggleEnabled: () => void;
  onRefresh: () => void;
  onSelectFlight: (f: Flight | null) => void;
  selectedFlightIcao: string | null;
  onVisibleFlightsChange?: (flights: Flight[], hasFilter: boolean) => void;
  flightRoute?: FlightRoute | null;
  flightRouteLoading?: boolean;
  flightRouteError?: string | null;
}) {
  const [filter, setFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [altitudeSort, setAltitudeSort] = useState<"none" | "asc" | "desc">("none");
  const [speedSort, setSpeedSort] = useState<"none" | "asc" | "desc">("none");

  // Build sorted country list from live data, pinned countries first
  const countryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of flights) {
      if (f.originCountry) {
        map.set(f.originCountry, (map.get(f.originCountry) ?? 0) + 1);
      }
    }
    return map;
  }, [flights]);

  const countryChips = useMemo(() => {
    // Pinned countries that actually appear in the data, sorted by count desc
    const pinned = PINNED_COUNTRIES
      .filter((c) => countryCounts.has(c))
      .map((c) => ({ name: c, count: countryCounts.get(c)! }));

    // Remaining countries sorted by count desc
    const rest = [...countryCounts.entries()]
      .filter(([name]) => !PINNED_COUNTRIES.includes(name))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15) // top 15 non-pinned
      .map(([name, count]) => ({ name, count }));

    return [...pinned, ...rest];
  }, [countryCounts]);

  const hasFilter = !!(filter || countryFilter);

  const visible = useMemo(() => flights.filter((f) => {
    // Country chip filter
    if (countryFilter && f.originCountry !== countryFilter) return false;
    // Text filter
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      f.callsign.toLowerCase().includes(q) ||
      f.icao24.toLowerCase().includes(q) ||
      f.originCountry.toLowerCase().includes(q) ||
      (flightTypeLabel(f) ?? "").toLowerCase().includes(q)
    );
  }), [flights, filter, countryFilter]);

  // Report visible flights + whether a filter is active back to parent
  useEffect(() => {
    onVisibleFlightsChange?.(visible, hasFilter);
  }, [visible, hasFilter, onVisibleFlightsChange]);

  // Sort: selected first, then by active sort, then by callsign
  const sorted = [...visible].sort((a, b) => {
    if (a.icao24 === selectedFlightIcao) return -1;
    if (b.icao24 === selectedFlightIcao) return 1;
    if (altitudeSort !== "none") {
      const diff = a.altitude - b.altitude;
      if (diff !== 0) return altitudeSort === "asc" ? diff : -diff;
    }
    if (speedSort !== "none") {
      const diff = a.velocity - b.velocity;
      if (diff !== 0) return speedSort === "asc" ? diff : -diff;
    }
    return a.callsign.localeCompare(b.callsign);
  });

  return (
    <Flex direction="column" gap="3" p="4" style={{ height: "100%" }}>
      {/* Header row */}
      <Flex align="center" justify="between">
        <SectionHeading>
          <PaperPlaneIcon style={{ display: "inline", marginRight: 4 }} />
          Flight Tracker
        </SectionHeading>
        <Flex align="center" gap="2">
          <Text size="1" color="gray" style={{ whiteSpace: "nowrap" }}>
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

      {!enabled ? (
        <Flex direction="column" align="center" justify="center" gap="2" style={{ flex: 1, minHeight: 200 }}>
          <PaperPlaneIcon width="28" height="28" style={{ color: "var(--gray-8)" }} />
          <Text size="1" color="gray" align="center">
            Toggle the switch above to load live flight data from OpenSky&nbsp;Network.
          </Text>
        </Flex>
      ) : (
        <>
          {/* Error banner */}
          {error && (
            <Box style={{ background: "var(--red-a3)", border: "1px solid var(--red-7)", borderRadius: 6, padding: "6px 10px" }}>
              <Text size="1" color="red">{error}</Text>
            </Box>
          )}

          {/* Stats + refresh */}
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <Badge variant="soft" color="amber" size="1">
                {loading ? "…" : flights.length.toLocaleString()} flights
              </Badge>
              {(filter || countryFilter) && (
                <Badge variant="outline" color="gray" size="1">
                  {visible.length.toLocaleString()} shown
                </Badge>
              )}
            </Flex>
            <Tooltip content="Refresh flight data">
              <Button variant="ghost" color="gray" size="1" onClick={onRefresh} disabled={loading}>
                <ReloadIcon className={loading ? "animate-spin" : ""} />
              </Button>
            </Tooltip>
          </Flex>

          {/* Flight route info card — shown when a flight is selected */}
          {selectedFlightIcao && (flightRoute || flightRouteLoading || flightRouteError) && (
            <Box style={{
              background: "var(--gray-a3)",
              border: flightRoute ? "1px solid var(--green-7)" : "1px solid var(--gray-a5)",
              borderRadius: 8,
              padding: "8px 10px",
            }}>
              {flightRouteLoading && (
                <Flex align="center" gap="2">
                  <ReloadIcon className="animate-spin" style={{ color: "var(--gray-9)" }} />
                  <Text size="1" color="gray">Looking up route…</Text>
                </Flex>
              )}
              {flightRouteError && !flightRouteLoading && (
                <Text size="1" color="gray">{flightRouteError}</Text>
              )}
              {flightRoute && !flightRouteLoading && (
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="2">
                    {flightRoute.airline && (
                      <Text size="1" weight="bold" style={{ color: "var(--green-11)" }}>
                        {flightRoute.airline}
                      </Text>
                    )}
                    {flightRoute.flightNumber && (
                      <Badge size="1" variant="soft" color="green">{flightRoute.flightNumber}</Badge>
                    )}
                    {flightRoute.status && (
                      <Badge size="1" variant="soft" color={
                        flightRoute.status.toLowerCase().includes("on time") ? "green"
                        : flightRoute.status.toLowerCase().includes("delay") ? "red"
                        : flightRoute.status.toLowerCase().includes("land") ? "blue"
                        : "gray"
                      }>
                        {flightRoute.status}
                      </Badge>
                    )}
                    {flightRoute.cached && (
                      <Badge size="1" variant="outline" color="gray" style={{ fontSize: 9 }}>cached</Badge>
                    )}
                  </Flex>
                  <Flex align="center" gap="2" mt="1">
                    <Flex direction="column" align="center" style={{ minWidth: 50 }}>
                      <Text size="2" weight="bold" style={{ color: "var(--green-11)", letterSpacing: "0.05em" }}>
                        {flightRoute.departureAirport}
                      </Text>
                      <Text size="1" color="gray" style={{ fontSize: 10 }}>
                        {flightRoute.departureCity ?? ""}
                      </Text>
                      {flightRoute.departureTime && (
                        <Text size="1" color="gray" style={{ fontSize: 9 }}>{flightRoute.departureTime}</Text>
                      )}
                    </Flex>
                    <Flex align="center" style={{ flex: 1, justifyContent: "center" }}>
                      <div style={{
                        height: 1,
                        flex: 1,
                        background: "var(--green-7)",
                        marginRight: 4,
                      }} />
                      <Text size="1" style={{ color: "var(--green-9)" }}>✈</Text>
                      <div style={{
                        height: 1,
                        flex: 1,
                        background: "var(--green-7)",
                        marginLeft: 4,
                      }} />
                    </Flex>
                    <Flex direction="column" align="center" style={{ minWidth: 50 }}>
                      <Text size="2" weight="bold" style={{ color: "var(--red-11)", letterSpacing: "0.05em" }}>
                        {flightRoute.arrivalAirport}
                      </Text>
                      <Text size="1" color="gray" style={{ fontSize: 10 }}>
                        {flightRoute.arrivalCity ?? ""}
                      </Text>
                      {flightRoute.arrivalTime && (
                        <Text size="1" color="gray" style={{ fontSize: 9 }}>{flightRoute.arrivalTime}</Text>
                      )}
                    </Flex>
                  </Flex>
                </Flex>
              )}
            </Box>
          )}

          {/* Filter */}
          <TextField.Root
            size="1"
            placeholder="Filter callsign, ICAO, country…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon height="12" width="12" />
            </TextField.Slot>
            {filter && (
              <TextField.Slot>
                <button onClick={() => setFilter("")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gray-9)", display: "flex" }}>
                  <Cross2Icon height="12" width="12" />
                </button>
              </TextField.Slot>
            )}
          </TextField.Root>

          {/* Sort & Filter controls — single row */}
          <Flex align="center" gap="2" wrap="wrap">
            {/* Country dropdown */}
            <Select.Root
              size="1"
              value={countryFilter ?? "__all__"}
              onValueChange={(v) => setCountryFilter(v === "__all__" ? null : v)}
            >
              <Select.Trigger
                variant="surface"
                style={{ minWidth: 130, fontSize: 11 }}
                placeholder="Country"
              />
              <Select.Content position="popper" sideOffset={4}>
                <Select.Item value="__all__">All countries</Select.Item>
                <Select.Separator />
                {countryChips.map((c) => (
                  <Select.Item key={c.name} value={c.name}>
                    {c.name} ({c.count})
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>

            {/* Altitude sort */}
            <Select.Root
              size="1"
              value={altitudeSort}
              onValueChange={(v) => setAltitudeSort(v as "none" | "asc" | "desc")}
            >
              <Select.Trigger
                variant="surface"
                style={{ minWidth: 110, fontSize: 11 }}
                placeholder="Altitude"
              />
              <Select.Content position="popper" sideOffset={4}>
                <Select.Item value="none">Altitude</Select.Item>
                <Select.Item value="asc">Altitude ↑</Select.Item>
                <Select.Item value="desc">Altitude ↓</Select.Item>
              </Select.Content>
            </Select.Root>

            {/* Speed sort */}
            <Select.Root
              size="1"
              value={speedSort}
              onValueChange={(v) => setSpeedSort(v as "none" | "asc" | "desc")}
            >
              <Select.Trigger
                variant="surface"
                style={{ minWidth: 100, fontSize: 11 }}
                placeholder="Speed"
              />
              <Select.Content position="popper" sideOffset={4}>
                <Select.Item value="none">Speed</Select.Item>
                <Select.Item value="asc">Speed ↑</Select.Item>
                <Select.Item value="desc">Speed ↓</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          <Separator size="4" />

          {/* Flight list */}
          <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
            <Flex direction="column" gap="1" pr="2">
              {sorted.length === 0 && !loading && (
                <Text size="1" color="gray" align="center" mt="4">No flights match your filter.</Text>
              )}
              {sorted.slice(0, 200).map((f) => {
                const isSelected = f.icao24 === selectedFlightIcao;
                return (
                  <button
                    key={f.icao24}
                    onClick={() => onSelectFlight(isSelected ? null : f)}
                    className="rounded-md transition-colors text-left"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "6px 8px",
                      background: isSelected ? "var(--amber-a4)" : "var(--gray-a3)",
                      border: isSelected ? "1px solid var(--amber-7)" : "1px solid transparent",
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    {/* Heading indicator */}
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: 2,
                        fontSize: 14,
                        transform: `rotate(${f.heading}deg)`,
                        color: isSelected ? "var(--amber-9)" : "var(--gray-9)",
                        lineHeight: 1,
                      }}
                    >
                      ✈
                    </span>

                    <Flex direction="column" gap="0" style={{ flex: 1, minWidth: 0 }}>
                      {/* Callsign + country + category */}
                      <Flex align="center" gap="2">
                        <Text size="1" weight="bold" style={{ color: isSelected ? "var(--amber-11)" : "var(--gray-12)" }}>
                          {f.callsign || f.icao24}
                        </Text>
                        <Text size="1" color="gray" truncate>
                          {f.originCountry}
                        </Text>
                        {flightTypeLabel(f) && (
                          <Badge size="1" variant="soft" color="gray" style={{ fontSize: 9, padding: "0 4px", lineHeight: "14px" }}>
                            {flightTypeLabel(f)}
                          </Badge>
                        )}
                      </Flex>
                      {/* Metrics */}
                      <Flex gap="3" mt="1">
                        <Text size="1" color="gray">
                          {formatAltitude(f.altitude)}
                        </Text>
                        <Text size="1" color="gray">
                          {formatSpeed(f.velocity)}
                        </Text>
                        <Text size="1" color="gray">
                          {verticalIcon(f.verticalRate)}
                        </Text>
                      </Flex>
                      {/* No route data indicator */}
                      {isSelected && !flightRouteLoading && !flightRoute && !flightRouteError && (
                        <Text size="1" color="gray" style={{ fontSize: 10, fontStyle: "italic", marginTop: 2 }}>
                          No route data available
                        </Text>
                      )}
                    </Flex>
                  </button>
                );
              })}
              {sorted.length > 200 && (
                <Text size="1" color="gray" align="center" mt="2">
                  Showing 200 of {sorted.length.toLocaleString()} — use the filter to narrow results.
                </Text>
              )}
            </Flex>
          </ScrollArea>
        </>
      )}
    </Flex>
  );
}

/* ---- helpers ---- */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      as="h2"
      size="1"
      weight="medium"
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
