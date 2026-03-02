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

/** A single satellite position from N2YO */
export interface Satellite {
  satid: number;
  satname: string;
  intDesignator?: string;
  launchDate?: string;
  lat: number;
  lng: number;
  altitude: number; // km above Earth surface
  velocity?: number; // km/s
  timestamp: number; // unix seconds
}

/** Satellite category for the N2YO "above" endpoint */
export type SatelliteCategory =
  | 0   // all
  | 1   // brightest
  | 2   // ISS
  | 3   // weather
  | 4   // NOAA
  | 5   // GOES
  | 6   // Earth resources
  | 7   // search & rescue
  | 8   // disaster monitoring
  | 9   // tracking & data relay
  | 10  // Geostationary
  | 11  // Intelsat
  | 12  // Gorizont
  | 13  // Raduga
  | 14  // Molniya
  | 15  // Iridium
  | 16  // Orbcomm
  | 17  // Globalstar
  | 18  // Amateur radio
  | 19  // experimental
  | 20  // GPS operational
  | 21  // Glonass operational
  | 22  // Galileo
  | 23  // SBAS
  | 24  // NNSS
  | 25  // Russian LEO nav
  | 26  // Space & Earth science
  | 27  // Geodetic
  | 28  // Engineering
  | 29  // Education
  | 30  // military
  | 31  // radar calibration
  | 32  // CubeSats
  | 33  // XM / Sirius
  | 34  // TV
  | 35  // Beidou
  | 36  // Yaogan
  | 37  // Westford Needles
  | 38  // Parus
  | 39  // Strela
  | 40  // Gonets
  | 41  // Tsyklon
  | 42  // Tsykada
  | 43  // O3B
  | 44  // Tselina
  | 45  // Starlink
  | 46  // OneWeb
  | 47  // Active Geosync
  | 48  // Flock
  | 49  // Lemur
  | 50  // GPS Constellation
  | 51  // Glonass Constellation
  | 52; // Spacebees

/** A live webcam from the Windy Webcams API */
export interface Webcam {
  id: string;
  title: string;
  lat: number;
  lng: number;
  /** URL to a static thumbnail/preview image */
  thumbnail: string;
  /** URL to the embeddable player page (day or live) */
  playerUrl: string;
  /** Two-letter country code */
  country: string;
  /** City / region string */
  city: string;
  /** "active" | "inactive" */
  status: string;
  /** Last updated unix timestamp */
  lastUpdated: number;
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
