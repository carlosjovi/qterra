export interface Coordinate {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color?: string;
}

export interface GlobeConfig {
  autoRotate: boolean;
  rotationSpeed: number;
  pointOfView: {
    lat: number;
    lng: number;
    altitude: number;
  };
}

export interface GeoFeature {
  type: string;
  properties: {
    NAME?: string;
    [key: string]: unknown;
  };
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

export interface GeoJSON {
  type: string;
  features: GeoFeature[];
}

export interface PlaceDetails {
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  hours?: string[];
  isOpen?: boolean;
  photoUrl?: string; // proxy URL via /api/places/photo
  mapsUrl?: string;
}

/** A single aircraft state vector from OpenSky Network */
export interface Flight {
  icao24: string;
  callsign: string;
  originCountry: string;
  lat: number;
  lng: number;
  altitude: number; // barometric altitude in metres
  velocity: number; // ground speed in m/s
  heading: number; // true track in degrees clockwise from north
  verticalRate: number; // m/s
  onGround: boolean;
  lastContact: number; // unix timestamp
  squawk?: string; // transponder code
  category?: number; // ADS-B emitter category (0–20)
}

/** Flight route info resolved via SerpAPI Google Flights search */
export interface FlightRoute {
  callsign: string; // e.g. "DAL1950"
  airline?: string; // e.g. "Delta"
  flightNumber?: string; // e.g. "DL 1950"
  departureAirport: string; // IATA code, e.g. "STT"
  departureCity?: string; // e.g. "Saint Thomas"
  departureLat: number;
  departureLng: number;
  arrivalAirport: string; // IATA code, e.g. "JFK"
  arrivalCity?: string; // e.g. "New York"
  arrivalLat: number;
  arrivalLng: number;
  departureTime?: string; // local time string
  arrivalTime?: string; // local time string
  status?: string; // e.g. "On Time", "Delayed", "Landed"
  cached?: boolean; // true if served from cache
}
