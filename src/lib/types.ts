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
