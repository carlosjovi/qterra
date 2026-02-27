import { NextRequest, NextResponse } from "next/server";
import type { FlightRoute } from "@/lib/types";

/**
 * GET /api/flights/route?callsign=DAL1950
 *
 * Multi-strategy flight route resolver:
 *   1. SerpAPI Google search — tries to extract the Google flight tracker widget
 *   2. FlightAware page fetch — parses departure/arrival from the HTML
 *   3. Organic result parsing — extracts airport codes from search snippets
 *
 * Results are cached in-memory for 6 hours to minimise API calls.
 */

const SERPAPI_URL = "https://serpapi.com/search.json";

// ── In-memory cache: callsign → { route, expiresAt } ──
const cache = new Map<string, { route: FlightRoute; expiresAt: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Airport coordinates loaded lazily from /public/data/airports.json ──
let airportDb: Record<string, { lat: number; lng: number; city: string; country: string }> | null =
  null;

async function getAirportDb() {
  if (airportDb) return airportDb;
  try {
    const url = new URL("/data/airports.json", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
    const res = await fetch(url.toString());
    airportDb = await res.json();
  } catch {
    airportDb = {};
  }
  return airportDb!;
}

// ── ICAO → IATA airline code mapping ──
const ICAO_TO_IATA: Record<string, string> = {
  AAL: "AA", UAL: "UA", DAL: "DL", SWA: "WN", JBU: "B6",
  ASA: "AS", NKS: "NK", FFT: "F9", BAW: "BA", DLH: "LH",
  AFR: "AF", KLM: "KL", EZY: "U2", RYR: "FR", THY: "TK",
  UAE: "EK", QTR: "QR", ETH: "ET", SIA: "SQ", CPA: "CX",
  ANA: "NH", JAL: "JL", QFA: "QF", ACA: "AC", WJA: "WS",
  TAM: "JJ", LAN: "LA", AVA: "AV", CCA: "CA", CES: "MU",
  CSN: "CZ", AIC: "AI", AXB: "IX", IGO: "6E", VOZ: "VA",
  EIN: "EI", IBE: "IB", VLG: "VY", SAS: "SK", FIN: "AY",
  LOT: "LO", TAP: "TP", SVA: "SV", GIA: "GA", MAS: "MH",
  THA: "TG", KAL: "KE", AAR: "OZ", EVA: "BR", RAM: "AT",
  MSR: "MS", MEA: "ME", FDX: "FX", UPS: "5X", GTI: "8C",
  SKW: "OO", RPA: "YX", ENY: "MQ", PDT: "PT", JIA: "OH",
  CPZ: "RP", TCF: "QQ", EDV: "9E",
};

/** Reverse map: IATA 2-letter → ICAO 3-letter */
const IATA_TO_ICAO: Record<string, string> = {};
for (const [icao, iata] of Object.entries(ICAO_TO_IATA)) {
  IATA_TO_ICAO[iata] = icao;
}

/** Well-known ICAO → readable airline name */
const ICAO_TO_NAME: Record<string, string> = {
  AAL: "American Airlines", UAL: "United Airlines", DAL: "Delta Air Lines",
  SWA: "Southwest Airlines", JBU: "JetBlue", ASA: "Alaska Airlines",
  NKS: "Spirit Airlines", FFT: "Frontier Airlines", BAW: "British Airways",
  DLH: "Lufthansa", AFR: "Air France", KLM: "KLM", THY: "Turkish Airlines",
  UAE: "Emirates", QTR: "Qatar Airways", SIA: "Singapore Airlines",
  CPA: "Cathay Pacific", ANA: "ANA", JAL: "Japan Airlines",
  QFA: "Qantas", ACA: "Air Canada", FDX: "FedEx", UPS: "UPS Airlines",
  SKW: "SkyWest", RPA: "Republic Airways", ENY: "Envoy Air",
  EDV: "Endeavor Air", JIA: "PSA Airlines",
};

/**
 * Parse a callsign like "DAL1950" into its parts.
 * Returns { icaoPrefix, flightNum, iataCode, airlineName }.
 */
function parseCallsign(raw: string) {
  const clean = raw.replace(/\s+/g, "").toUpperCase();
  const match = clean.match(/^([A-Z]{3})(\d+)$/);
  if (!match) return { icaoPrefix: "", flightNum: clean, iataCode: "", airlineName: "", clean };
  const icaoPrefix = match[1];
  const flightNum = match[2];
  const iataCode = ICAO_TO_IATA[icaoPrefix] ?? "";
  const airlineName = ICAO_TO_NAME[icaoPrefix] ?? "";
  return { icaoPrefix, flightNum, iataCode, airlineName, clean };
}

/**
 * Build multiple search queries — ordered from most to least likely to
 * trigger Google's structured flight widget.
 */
function buildSearchQueries(callsign: string): string[] {
  const { iataCode, flightNum, clean } = parseCallsign(callsign);
  const queries: string[] = [];
  if (iataCode) {
    // "DL 1950 flight status" is what users type → most likely to get widget
    queries.push(`${iataCode} ${flightNum} flight status`);
    queries.push(`${iataCode}${flightNum} flight tracker`);
  }
  queries.push(`flight ${clean}`);
  return queries;
}

// ── Strategy 1: Parse structured SerpAPI data ──

function parseSerpApiStructured(
  data: Record<string, any>,
): { departureCode?: string; arrivalCode?: string; departureCity?: string; arrivalCity?: string; airline?: string; flightNumber?: string; departureTime?: string; arrivalTime?: string; status?: string } {
  let departureCode: string | undefined;
  let arrivalCode: string | undefined;
  let departureCity: string | undefined;
  let arrivalCity: string | undefined;
  let airline: string | undefined;
  let flightNumber: string | undefined;
  let departureTime: string | undefined;
  let arrivalTime: string | undefined;
  let status: string | undefined;

  // Path 1: flights_results (Google Flights integration)
  const flightsResults = data.flights_results ?? data.flights;
  if (flightsResults) {
    const info = Array.isArray(flightsResults) ? flightsResults[0] : flightsResults;
    if (info) {
      departureCode = info.departure_airport?.code ?? info.departure_airport?.iata;
      arrivalCode = info.arrival_airport?.code ?? info.arrival_airport?.iata;
      departureCity = info.departure_airport?.city ?? info.departure_airport?.name;
      arrivalCity = info.arrival_airport?.city ?? info.arrival_airport?.name;
      airline = info.airline;
      flightNumber = info.flight_number;
      departureTime = info.departure_airport?.time ?? info.departure_time;
      arrivalTime = info.arrival_airport?.time ?? info.arrival_time;
      status = info.status;
    }
  }

  // Path 2: knowledge_graph
  if (!departureCode && data.knowledge_graph) {
    const kg = data.knowledge_graph;
    departureCode = kg.departure_airport_code ?? kg.from_airport;
    arrivalCode = kg.arrival_airport_code ?? kg.to_airport;
    departureCity = kg.departure_city ?? kg.from;
    arrivalCity = kg.arrival_city ?? kg.to;
    airline = kg.airline ?? kg.carrier;
    flightNumber = kg.flight_number ?? kg.title;
    status = kg.status;
  }

  // Path 3: answer_box
  if (!departureCode && data.answer_box) {
    const ab = data.answer_box;
    departureCode = ab.departure_airport ?? ab.origin;
    arrivalCode = ab.arrival_airport ?? ab.destination;
    departureCity = ab.departure_city;
    arrivalCity = ab.arrival_city;
    airline = ab.airline;
    flightNumber = ab.flight_number ?? ab.title;
    status = ab.status ?? ab.flight_status;
  }

  return { departureCode, arrivalCode, departureCity, arrivalCity, airline, flightNumber, departureTime, arrivalTime, status };
}

// ── Strategy 2: Parse organic results for airport codes ──

/**
 * Scans SerpAPI organic results for IATA airport-code patterns.
 * Sources: titles, snippets, and links from FlightAware, FlightRadar24, etc.
 */
function parseOrganicResults(
  data: Record<string, any>,
  airports: Record<string, { lat: number; lng: number; city: string; country: string }>,
): { departureCode?: string; arrivalCode?: string } {
  const organics: Array<{ title?: string; snippet?: string; link?: string }> =
    data.organic_results ?? [];

  for (const result of organics.slice(0, 8)) {
    const text = `${result.title ?? ""} ${result.snippet ?? ""}`;

    // Pattern: "JFK → LAX", "JFK - LAX", "JFK to LAX", "(JFK–LAX)", "(JFK/LAX)"
    const arrowMatch = text.match(
      /\b([A-Z]{3})\s*(?:→|->|➝|›|–|—|-|to|\/)\s*([A-Z]{3})\b/,
    );
    if (arrowMatch) {
      const [, dep, arr] = arrowMatch;
      if (airports[dep] && airports[arr]) {
        return { departureCode: dep, arrivalCode: arr };
      }
    }

    // Pattern: "from JFK to LAX" or "departing JFK arriving LAX"
    const fromToMatch = text.match(
      /(?:from|departing|origin)\s+([A-Z]{3}).*?(?:to|arriving|destination|→)\s+([A-Z]{3})/i,
    );
    if (fromToMatch) {
      const dep = fromToMatch[1].toUpperCase();
      const arr = fromToMatch[2].toUpperCase();
      if (airports[dep] && airports[arr]) {
        return { departureCode: dep, arrivalCode: arr };
      }
    }

    // Pattern: "(KJFK - KLAX)" or "(KJFK / KLAX)" – ICAO 4-letter codes used by FlightAware
    const icao4Match = text.match(
      /\(K([A-Z]{3})\s*[-–—\/]\s*K([A-Z]{3})\)/,
    );
    if (icao4Match) {
      const dep = icao4Match[1];
      const arr = icao4Match[2];
      if (airports[dep] && airports[arr]) {
        return { departureCode: dep, arrivalCode: arr };
      }
    }

    // FlightAware URL pattern: /live/flight/DAL1950/history/.../KJFK/KLAX
    if (result.link) {
      const faMatch = result.link.match(
        /flightaware\.com\/live\/flight\/[^/]+\/history\/[^/]+\/[^/]+\/K([A-Z]{3})\/K([A-Z]{3})/,
      );
      if (faMatch) {
        const dep = faMatch[1];
        const arr = faMatch[2];
        if (airports[dep] && airports[arr]) {
          return { departureCode: dep, arrivalCode: arr };
        }
      }
    }

    // Look for two known IATA codes separated by anything in a short span
    const iataMatches = text.match(/\b[A-Z]{3}\b/g);
    if (iataMatches) {
      const knownCodes = iataMatches.filter((c) => airports[c]);
      if (knownCodes.length >= 2) {
        return { departureCode: knownCodes[0], arrivalCode: knownCodes[1] };
      }
    }
  }

  return {};
}

// ── Strategy 3: Fetch FlightAware page directly ──

async function fetchFlightAwarePage(
  callsign: string,
  airports: Record<string, { lat: number; lng: number; city: string; country: string }>,
): Promise<{ departureCode?: string; arrivalCode?: string; status?: string } | null> {
  const clean = callsign.replace(/\s+/g, "").toUpperCase();
  const url = `https://www.flightaware.com/live/flight/${clean}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.log(`[FlightAware] ${res.status} for ${clean}`);
      return null;
    }

    const html = await res.text();

    // Pattern 1: Airport codes in the page title
    //   e.g., "DAL1950 (DL1950) … (JFK – LAX) … FlightAware"
    const titleMatch = html.match(
      /<title[^>]*>[\s\S]*?\(([A-Z]{3,4})\s*[-–—\/]\s*([A-Z]{3,4})\)[\s\S]*?<\/title>/i,
    );
    if (titleMatch) {
      let dep = titleMatch[1].length === 4 && titleMatch[1].startsWith("K")
        ? titleMatch[1].slice(1) : titleMatch[1];
      let arr = titleMatch[2].length === 4 && titleMatch[2].startsWith("K")
        ? titleMatch[2].slice(1) : titleMatch[2];
      if (airports[dep] && airports[arr]) {
        return { departureCode: dep, arrivalCode: arr };
      }
    }

    // Pattern 2: Origin/destination in FlightAware's structured data or inline
    //   look for "origin" : { "icao" : "KJFK" }  or  data-origin="KJFK"
    const originMatch = html.match(
      /(?:"origin"\s*:\s*\{\s*"(?:icao|iata)"\s*:\s*"K?([A-Z]{3})")|(?:data-origin="K?([A-Z]{3})")/,
    );
    const destMatch = html.match(
      /(?:"destination"\s*:\s*\{\s*"(?:icao|iata)"\s*:\s*"K?([A-Z]{3})")|(?:data-destination="K?([A-Z]{3})")/,
    );
    if (originMatch && destMatch) {
      const dep = originMatch[1] || originMatch[2];
      const arr = destMatch[1] || destMatch[2];
      if (dep && arr && airports[dep] && airports[arr]) {
        return { departureCode: dep, arrivalCode: arr };
      }
    }

    // Pattern 3: FlightAware "track-panel" JSON blob or embedded route data
    //   e.g., "origin":{"icao":"KJFK","iata":"JFK"...},"destination":{"icao":"KLAX","iata":"LAX"...}
    const jsonBlobMatch = html.match(
      /"origin"\s*:\s*\{[^}]*?"iata"\s*:\s*"([A-Z]{3})"[^}]*\}[\s\S]*?"destination"\s*:\s*\{[^}]*?"iata"\s*:\s*"([A-Z]{3})"/,
    );
    if (jsonBlobMatch) {
      const dep = jsonBlobMatch[1];
      const arr = jsonBlobMatch[2];
      if (airports[dep] && airports[arr]) {
        return { departureCode: dep, arrivalCode: arr };
      }
    }

    // Pattern 4: Broad ICAO 4-letter code sweep (K + 3-letter IATA)
    //   Look for pairs of ICAO codes that appear near "origin"/"dep" and "dest"/"arr"
    const allIcao4 = [...html.matchAll(/\bK([A-Z]{3})\b/g)].map((m) => m[1]);
    const knownAirports = [...new Set(allIcao4.filter((c) => airports[c]))];
    if (knownAirports.length >= 2) {
      return { departureCode: knownAirports[0], arrivalCode: knownAirports[1] };
    }

    // Pattern 5: Any two 3-letter IATA codes we recognise
    const allIata = [...html.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]);
    const knownIata = [...new Set(allIata.filter((c) => airports[c]))];
    if (knownIata.length >= 2) {
      return { departureCode: knownIata[0], arrivalCode: knownIata[1] };
    }

    console.log(`[FlightAware] Could not parse airports from page for ${clean}`);
    return null;
  } catch (err) {
    console.log(`[FlightAware] Fetch error for ${clean}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Assemble route from parts ──

function buildRoute(
  callsign: string,
  departureCode: string,
  arrivalCode: string,
  airports: Record<string, { lat: number; lng: number; city: string; country: string }>,
  extras: {
    departureCity?: string;
    arrivalCity?: string;
    airline?: string;
    flightNumber?: string;
    departureTime?: string;
    arrivalTime?: string;
    status?: string;
  } = {},
): FlightRoute {
  const { icaoPrefix, flightNum, iataCode } = parseCallsign(callsign);
  const depAirport = airports[departureCode];
  const arrAirport = airports[arrivalCode];

  return {
    callsign: callsign.replace(/\s+/g, "").toUpperCase(),
    airline: extras.airline || ICAO_TO_NAME[icaoPrefix] || undefined,
    flightNumber: extras.flightNumber || (iataCode ? `${iataCode} ${flightNum}` : undefined),
    departureAirport: departureCode,
    departureCity: extras.departureCity ?? depAirport?.city,
    departureLat: depAirport?.lat ?? 0,
    departureLng: depAirport?.lng ?? 0,
    arrivalAirport: arrivalCode,
    arrivalCity: extras.arrivalCity ?? arrAirport?.city,
    arrivalLat: arrAirport?.lat ?? 0,
    arrivalLng: arrAirport?.lng ?? 0,
    departureTime: extras.departureTime,
    arrivalTime: extras.arrivalTime,
    status: extras.status,
  };
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.SERPAPI_API_KEY ?? "";

  const callsign = req.nextUrl.searchParams.get("callsign")?.trim();
  if (!callsign) {
    return NextResponse.json(
      { error: "Missing required query param: callsign" },
      { status: 400 },
    );
  }

  const cacheKey = callsign.replace(/\s+/g, "").toUpperCase();

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ route: { ...cached.route, cached: true } });
  }

  const airports = await getAirportDb();

  // ── Strategy 1: SerpAPI structured data + organic parsing ──
  if (apiKey) {
    const queries = buildSearchQueries(callsign);

    for (const query of queries) {
      try {
        const url = new URL(SERPAPI_URL);
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("engine", "google");
        url.searchParams.set("q", query);
        url.searchParams.set("hl", "en");
        url.searchParams.set("gl", "us");

        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
          console.log(`[SerpAPI] ${res.status} for query "${query}"`);
          continue;
        }

        const data = await res.json();

        // Try structured data first
        const structured = parseSerpApiStructured(data);
        if (structured.departureCode && structured.arrivalCode) {
          const route = buildRoute(callsign, structured.departureCode, structured.arrivalCode, airports, structured);
          cache.set(cacheKey, { route, expiresAt: Date.now() + CACHE_TTL_MS });
          return NextResponse.json({ route });
        }

        // Try organic results parsing
        const organic = parseOrganicResults(data, airports);
        if (organic.departureCode && organic.arrivalCode) {
          const route = buildRoute(callsign, organic.departureCode, organic.arrivalCode, airports);
          cache.set(cacheKey, { route, expiresAt: Date.now() + CACHE_TTL_MS });
          return NextResponse.json({ route });
        }
      } catch (err) {
        console.log(`[SerpAPI] Error for query "${query}":`, err instanceof Error ? err.message : err);
      }

      // Only try the first query to conserve API credits — fall through to FlightAware
      break;
    }
  }

  // ── Strategy 2: Fetch FlightAware page directly ──
  try {
    const faResult = await fetchFlightAwarePage(callsign, airports);
    if (faResult?.departureCode && faResult.arrivalCode) {
      const route = buildRoute(callsign, faResult.departureCode, faResult.arrivalCode, airports, {
        status: faResult.status,
      });
      cache.set(cacheKey, { route, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json({ route });
    }
  } catch (err) {
    console.log("[FlightAware] Strategy failed:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json(
    { error: "Could not determine flight route", callsign: cacheKey },
    { status: 404 },
  );
}
