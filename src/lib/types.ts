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
