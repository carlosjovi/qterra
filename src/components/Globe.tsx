"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import ThreeGlobe from "three-globe";
import * as THREE from "three";
import type { Coordinate, GeoJSON, Flight, FlightRoute } from "@/lib/types";

const GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

// ---------- geo helpers ----------

/** Convert lat/lng to ThreeGlobe's internal coordinate system at radius r */
function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (90 - lng) * (Math.PI / 180);
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

/**
 * Project a point forward along a compass heading by `distKm` kilometres.
 * Uses the standard spherical "destination point given distance and bearing" formula.
 */
function projectForward(
  lat: number,
  lng: number,
  heading: number,
  distKm: number,
): { lat: number; lng: number } {
  const R = 6371; // mean Earth radius km
  const d = distKm / R;
  const brng = (heading * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

// ---------- inner scene component ----------
function GlobeObject({
  coordinates,
  autoRotate,
  rotationSpeed,
  focusTarget,
  showGrid,
  flights,
  selectedFlightIcao,
  flightRoute,
  onGlobeReady,
}: {
  coordinates: Coordinate[];
  autoRotate: boolean;
  rotationSpeed: number;
  focusTarget: Coordinate | null;
  showGrid: boolean;
  flights: Flight[];
  selectedFlightIcao: string | null;
  flightRoute: FlightRoute | null;
  onGlobeReady?: () => void;
}) {
  const globeRef = useRef<ThreeGlobe | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const flightArcsGroupRef = useRef<THREE.Group | null>(null);
  const routeArcGroupRef = useRef<THREE.Group | null>(null);
  const groupRef = useRef<THREE.Group>(null!);
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const [geoData, setGeoData] = useState<GeoJSON | null>(null);

  // Stable-reference map: preserves data-object identity across refreshes so
  // data-bind-mapper reuses existing Three.js meshes instead of recreating them.
  const flightObjMapRef = useRef(new Map<string, Record<string, any>>());

  // Animation state for the selected flight's smooth position interpolation.
  const selAnimRef = useRef({
    currentLat: 0, currentLng: 0, currentHeading: 0,
    targetLat: 0, targetLng: 0, targetHeading: 0,
    altitude: 0.05,
    active: false,
  });

  // Counter bumped whenever the globe is (re-)built so that dependent effects
  // (route arc, flight arcs) re-run even if their own data hasn't changed.
  const [globeEpoch, setGlobeEpoch] = useState(0);

  // fetch country polygons once
  useEffect(() => {
    fetch(GEOJSON_URL)
      .then((r) => r.json())
      .then((data: GeoJSON) => setGeoData(data))
      .catch(console.error);
  }, []);

  // build globe mesh
  useEffect(() => {
    if (!geoData) return;

    // -- helpers for ThreeGlobe's coordinate system --
    // ThreeGlobe maps: phi = (90-lat)*PI/180, theta = (90-lng)*PI/180
    const toXYZ = (lat: number, lng: number, r: number): THREE.Vector3 => {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (90 - lng) * (Math.PI / 180);
      return new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    };

    const globe = new ThreeGlobe()
      // vector-line country outlines
      .hexPolygonsData(geoData.features)
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.7)
      .hexPolygonUseDots(false)
      .hexPolygonColor(() => "rgba(255, 170, 0, 0.6)")
      // atmosphere glow
      .showAtmosphere(true)
      .atmosphereColor("#874115")
      .atmosphereAltitude(0.4)
      // points of interest
      .pointsData(coordinates)
      .pointLat("lat")
      .pointLng("lng")
      .pointColor("color")
      .pointAltitude(0.04)
      .pointRadius(0.2)
      // labels
      .labelsData(coordinates)
      .labelLat("lat")
      .labelLng("lng")
      .labelText("label")
      .labelSize(1.2)
      .labelDotRadius(0.6)
      .labelColor(() => "rgb(255, 255, 255)")
      .labelResolution(2)
      // arcs between sequential points
      .arcsData(
        coordinates.length >= 2
          ? coordinates.slice(0, -1).map((c, i) => ({
              startLat: c.lat,
              startLng: c.lng,
              endLat: coordinates[i + 1].lat,
              endLng: coordinates[i + 1].lng,
              color: [c.color ?? "#ff6600", coordinates[i + 1].color ?? "#ff6600"],
            }))
          : []
      )
      .arcColor("color")
      .arcDashLength(0.05)
      .arcDashGap(0.05)
      .arcDashAnimateTime(4500)
      .arcStroke(0.5)
      // ── flights: initial empty, updated separately ──
      .objectsData([])
      .objectThreeObject(() => {
        // Base styling — selection highlight applied separately via material updates
        const size = 0.9;
        const geom = new THREE.ConeGeometry(size * 0.5, size, 4);
        geom.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x60a5fa,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        return new THREE.Mesh(geom, mat);
      })
      .objectRotation((d: unknown) => {
        const f = d as Flight;
        return { x: 0, y: -(f.heading ?? 0), z: 0 };
      })
      .objectFacesSurface(true);

    // -- vector-line style: override default globe material --
    const globeMaterial = globe.globeMaterial() as THREE.MeshPhongMaterial;
    globeMaterial.color = new THREE.Color(0x0f0f0f);
    globeMaterial.emissive = new THREE.Color(0x050d1a);
    globeMaterial.shininess = 0.9;
    globeMaterial.transparent = true;
    globeMaterial.opacity = 0.9;

    globeRef.current = globe;

    // -- build accurate lat/lng grid attached to the globe group --
    const GRID_R = 101.2; // just above the globe surface (radius = 100)

    // Special geographic parallels and meridians
    const EQUATOR = 0;
    const TROPICS = [23.5, -23.5];
    const POLAR_CIRCLES = [66.5, -66.5];
    const specialLats = new Set([EQUATOR, ...TROPICS, ...POLAR_CIRCLES]);

    const gridGroup = new THREE.Group();

    // Materials
    const baseMat = new THREE.LineBasicMaterial({
      color: 0x7a4a18,
      transparent: true,
      opacity: 0.9,
    });
    const equatorMat = new THREE.LineBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.9,
    });
    const tropicMat = new THREE.LineBasicMaterial({
      color: 0xcc6600,
      transparent: true,
      opacity: 0.75,
    });
    const primeMat = new THREE.LineBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.9,
    });

    // Latitude lines: every 15°, special ones highlighted
    const latStops: number[] = [];
    for (let lat = -75; lat <= 75; lat += 15) latStops.push(lat);
    // Also add tropics and polar circles if not already present
    for (const sl of [...TROPICS, ...POLAR_CIRCLES]) {
      if (!latStops.includes(sl)) latStops.push(sl);
    }

    for (const lat of latStops) {
      const mat =
        lat === EQUATOR ? equatorMat
        : TROPICS.includes(lat) ? tropicMat
        : POLAR_CIRCLES.includes(lat) ? tropicMat
        : baseMat;

      const points: THREE.Vector3[] = [];
      for (let lng = -180; lng <= 180; lng += 1) {
        points.push(toXYZ(lat, lng, GRID_R));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      gridGroup.add(new THREE.Line(geom, mat));
    }

    // Longitude lines: every 15°, prime meridian highlighted
    for (let lng = -180; lng < 180; lng += 15) {
      const isPrime = lng === 0;
      const mat = isPrime ? primeMat : baseMat;
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 1) {
        points.push(toXYZ(lat, lng, GRID_R));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      gridGroup.add(new THREE.Line(geom, mat));
    }

    // clear previous children & add
    while (groupRef.current.children.length) {
      groupRef.current.remove(groupRef.current.children[0]);
    }
    groupRef.current.add(globe);
    groupRef.current.add(gridGroup);
    gridGroupRef.current = gridGroup;
    gridGroup.visible = showGrid;

    // Flight projected-arcs group (populated separately in the flight effect)
    const arcsGroup = new THREE.Group();
    groupRef.current.add(arcsGroup);
    flightArcsGroupRef.current = arcsGroup;

    // Route arc group for origin→destination arcs (SerpAPI)
    const routeGroup = new THREE.Group();
    groupRef.current.add(routeGroup);
    routeArcGroupRef.current = routeGroup;

    // Reset flight refs when the globe is rebuilt
    flightObjMapRef.current.clear();
    selAnimRef.current.active = false;

    // Bump epoch so dependent effects (route arc, flight arcs) re-draw
    setGlobeEpoch((e) => e + 1);

    onGlobeReady?.();
  }, [geoData, coordinates, onGlobeReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update flight positions using stable object references ──
  // data-bind-mapper matches items by reference: mutating existing objects
  // in-place lets three-globe reuse meshes instead of destroying & recreating.
  useEffect(() => {
    if (!globeRef.current) return;
    const globe = globeRef.current;
    const prevMap = flightObjMapRef.current;
    const nextMap = new Map<string, Record<string, any>>();

    const flightData = flights
      .filter((f) => !f.onGround)
      .map((f) => {
        const alt = Math.max(0.01, Math.min((f.altitude || 0) / 100_000, 0.15));
        let obj = prevMap.get(f.icao24);
        if (obj) {
          // Mutate in-place to preserve reference identity
          obj.lat = f.lat;
          obj.lng = f.lng;
          obj.altitude = alt;
          obj.heading = f.heading;
          obj.callsign = f.callsign;
          obj.velocity = f.velocity;
          obj.verticalRate = f.verticalRate;
          obj.originCountry = f.originCountry;
          obj.onGround = f.onGround;
          obj.icao24 = f.icao24;
          obj.lastContact = f.lastContact;
        } else {
          obj = { ...f, altitude: alt };
        }
        nextMap.set(f.icao24, obj);
        return obj;
      });

    flightObjMapRef.current = nextMap;

    // Capture the selected flight's interpolated position *before* digest snaps it
    const anim = selAnimRef.current;
    const savedPos = anim.active
      ? { lat: anim.currentLat, lng: anim.currentLng, heading: anim.currentHeading }
      : null;

    globe.objectsData(flightData);

    // ── Smooth-animation book-keeping for the selected flight ──
    if (selectedFlightIcao) {
      const selData = nextMap.get(selectedFlightIcao);
      if (selData) {
        if (!anim.active) {
          // First activation — snap to live position (no lerp)
          anim.currentLat = selData.lat as number;
          anim.currentLng = selData.lng as number;
          anim.currentHeading = (selData.heading as number) ?? 0;
        }
        anim.targetLat = selData.lat as number;
        anim.targetLng = selData.lng as number;
        anim.targetHeading = (selData.heading as number) ?? 0;
        anim.altitude = selData.altitude as number;
        anim.active = true;

        // Override the digest-snapped position back to the interpolated position
        if (savedPos && (selData as any).__threeObjObject) {
          const group = (selData as any).__threeObjObject as THREE.Group;
          const pos = globe.getCoords(savedPos.lat, savedPos.lng, anim.altitude);
          group.position.set(pos.x, pos.y, pos.z);
          group.setRotationFromEuler(
            new THREE.Euler(-savedPos.lat * Math.PI / 180, savedPos.lng * Math.PI / 180, 0, 'YXZ'),
          );
          const child = group.children[0];
          if (child) {
            child.setRotationFromEuler(
              new THREE.Euler(0, -savedPos.heading * Math.PI / 180, 0),
            );
          }
        }
      }
    } else {
      anim.active = false;
    }

    // ── Apply selection highlight on meshes (color / scale) ──
    for (const [icao, obj] of nextMap) {
      const group = (obj as any).__threeObjObject as THREE.Group | undefined;
      if (!group) continue;
      const mesh = group.children[0] as THREE.Mesh | undefined;
      if (!mesh?.material) continue;
      const isSelected = icao === selectedFlightIcao;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(isSelected ? 0xffa500 : 0x60a5fa);
      mat.opacity = isSelected ? 1.0 : 0.8;
      mat.needsUpdate = true;
      mesh.scale.setScalar(isSelected ? 2.0 / 0.9 : 1.0);
    }
  }, [flights, selectedFlightIcao]);

  // ── Heading-projected arcs for visible flights ──
  useEffect(() => {
    const group = flightArcsGroupRef.current;
    if (!group) return;

    // Dispose previous arc geometry & material
    while (group.children.length) {
      const child = group.children[0] as THREE.Mesh;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        (child.material as THREE.Material)?.dispose();
      }
      group.remove(child);
    }

    const ARC_R = 101.3; // slightly above globe surface (radius ≈ 100)
    const SEGMENTS = 32;
    const PROJECTION_SECONDS = 1200; // 20 minutes ahead
    const MIN_VELOCITY = 30; // m/s — skip very slow or stationary aircraft
    const MAX_DIST_KM = 2500;
    const TUBE_RADIUS = 0.12; // visible tube thickness
    const TUBE_SEGMENTS = 4; // low-poly tube cross-section (performance)

    for (const f of flights) {
      if (f.onGround || !f.velocity || f.velocity < MIN_VELOCITY) continue;

      // Skip the projected arc for the selected flight when real route data exists
      if (f.icao24 === selectedFlightIcao && flightRoute) continue;

      const distKm = Math.min((f.velocity * PROJECTION_SECONDS) / 1000, MAX_DIST_KM);
      if (distKm < 10) continue;

      const endPt = projectForward(f.lat, f.lng, f.heading, distKm);

      // Build a great-circle arc via normalised-lerp (nlerp ≈ slerp for vis)
      const startV = latLngToVec3(f.lat, f.lng, ARC_R);
      const endV = latLngToVec3(endPt.lat, endPt.lng, ARC_R);
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        points.push(startV.clone().lerp(endV, t).normalize().multiplyScalar(ARC_R));
      }

      const isSelected = f.icao24 === selectedFlightIcao;
      const path = new THREE.CatmullRomCurve3(points);
      const geom = new THREE.TubeGeometry(path, SEGMENTS, TUBE_RADIUS, TUBE_SEGMENTS, false);
      const mat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xffa500 : 0x60a5fa,
        transparent: true,
        opacity: isSelected ? 0.8 : 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      group.add(new THREE.Mesh(geom, mat));
    }
  }, [flights, selectedFlightIcao, flightRoute]);

  // ── Render origin→destination route arc from SerpAPI flight lookup ──
  useEffect(() => {
    const group = routeArcGroupRef.current;
    if (!group) return;

    // Dispose previous route arc geometry & material
    while (group.children.length) {
      const child = group.children[0] as THREE.Mesh;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        (child.material as THREE.Material)?.dispose();
      }
      group.remove(child);
    }

    if (!flightRoute) return;

    // Validate all four coordinates — skip if any pair is (0,0) or non-finite
    const { departureLat, departureLng, arrivalLat, arrivalLng } = flightRoute;
    if (
      (departureLat === 0 && departureLng === 0) ||
      (arrivalLat === 0 && arrivalLng === 0) ||
      !isFinite(departureLat) || !isFinite(departureLng) ||
      !isFinite(arrivalLat) || !isFinite(arrivalLng)
    ) return;

    const ARC_R = 101.4;
    const SEGMENTS = 64;
    const TUBE_RADIUS = 0.25;
    const TUBE_SEGMENTS = 8;

    // Build a great-circle arc from departure to arrival
    const startV = latLngToVec3(departureLat, departureLng, ARC_R);
    const endV = latLngToVec3(arrivalLat, arrivalLng, ARC_R);

    // Calculate arc height based on distance — longer routes get taller arcs
    const dist = startV.distanceTo(endV);
    const maxArcHeight = Math.min(dist * 0.15, 15); // cap at 15 units

    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const p = startV.clone().lerp(endV, t).normalize();
      // Add altitude bump in the middle of the arc (sin curve)
      const altBump = Math.sin(t * Math.PI) * maxArcHeight;
      p.multiplyScalar(ARC_R + altBump);
      points.push(p);
    }

    // Main route arc — bright green
    const path = new THREE.CatmullRomCurve3(points);
    const geom = new THREE.TubeGeometry(path, SEGMENTS, TUBE_RADIUS, TUBE_SEGMENTS, false);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x22c55e, // green-500
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(geom, mat));

    // Departure airport marker (sphere + ring)
    const depGeom = new THREE.SphereGeometry(0.7, 16, 16);
    const depMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.95 });
    const depMesh = new THREE.Mesh(depGeom, depMat);
    const depPos = latLngToVec3(departureLat, departureLng, ARC_R);
    depMesh.position.copy(depPos);
    group.add(depMesh);

    // Departure ring (pulsing halo effect via larger translucent sphere)
    const depRingGeom = new THREE.SphereGeometry(1.4, 16, 16);
    const depRingMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.25 });
    const depRingMesh = new THREE.Mesh(depRingGeom, depRingMat);
    depRingMesh.position.copy(depPos);
    group.add(depRingMesh);

    // Arrival airport marker (sphere + ring)
    const arrGeom = new THREE.SphereGeometry(0.7, 16, 16);
    const arrMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.95 });
    const arrMesh = new THREE.Mesh(arrGeom, arrMat);
    const arrPos = latLngToVec3(arrivalLat, arrivalLng, ARC_R);
    arrMesh.position.copy(arrPos);
    group.add(arrMesh);

    // Arrival ring
    const arrRingGeom = new THREE.SphereGeometry(1.4, 16, 16);
    const arrRingMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.25 });
    const arrRingMesh = new THREE.Mesh(arrRingGeom, arrRingMat);
    arrRingMesh.position.copy(arrPos);
    group.add(arrRingMesh);

  }, [flightRoute, globeEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle grid visibility without rebuilding
  useEffect(() => {
    if (gridGroupRef.current) {
      gridGroupRef.current.visible = showGrid;
    }
  }, [showGrid]);

  // auto-rotate + smooth flight animation
  useFrame(() => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += rotationSpeed * 0.001;
    }

    // Smoothly interpolate the selected flight toward its target position
    if (selectedFlightIcao && selAnimRef.current.active && globeRef.current) {
      const anim = selAnimRef.current;
      const lerpFactor = 0.06;

      anim.currentLat += (anim.targetLat - anim.currentLat) * lerpFactor;
      anim.currentLng += (anim.targetLng - anim.currentLng) * lerpFactor;
      anim.currentHeading += (anim.targetHeading - anim.currentHeading) * lerpFactor;

      const selObj = flightObjMapRef.current.get(selectedFlightIcao);
      const group = (selObj as any)?.__threeObjObject as THREE.Group | undefined;
      if (group) {
        const pos = globeRef.current.getCoords(anim.currentLat, anim.currentLng, anim.altitude);
        group.position.set(pos.x, pos.y, pos.z);
        group.setRotationFromEuler(
          new THREE.Euler(-anim.currentLat * Math.PI / 180, anim.currentLng * Math.PI / 180, 0, 'YXZ'),
        );
        const child = group.children[0];
        if (child) {
          child.setRotationFromEuler(
            new THREE.Euler(0, -anim.currentHeading * Math.PI / 180, 0),
          );
        }
      }
    }
  });

  // fly-to on focus
  useEffect(() => {
    if (!focusTarget || !globeRef.current) return;

    // Disable orbit controls during the camera animation
    if (controlsRef.current) {
      controlsRef.current.enabled = false;
    }

    // Use three-globe's own coordinate mapping to get the exact surface position,
    // then apply the group's current rotation so we account for any accumulated auto-spin.
    // Use a wider radius for arc midpoints so the full arc is visible, closer for flights.
    const isFlight = focusTarget.id.startsWith("__flight_");
    const CAMERA_RADIUS = focusTarget.id === "__arc_mid__" ? 240 : isFlight ? 155 : 175;
    const surfacePos = globeRef.current.getCoords(focusTarget.lat, focusTarget.lng, 0);
    const dir = new THREE.Vector3(surfacePos.x, surfacePos.y, surfacePos.z)
      .applyEuler(groupRef.current.rotation)
      .normalize()
      .multiplyScalar(CAMERA_RADIUS);

    // animate camera
    const start = camera.position.clone();
    const end = dir;
    let t = 0;
    let rafId: number;
    const animate = () => {
      t += 0.018;
      if (t > 1) t = 1;
      camera.position.lerpVectors(start, end, easeInOutCubic(t));
      camera.lookAt(0, 0, 0);
      if (controlsRef.current) controlsRef.current.update();
      if (t < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        // Re-enable controls once the animation has settled
        if (controlsRef.current) controlsRef.current.enabled = true;
      }
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      if (controlsRef.current) controlsRef.current.enabled = true;
    };
  }, [focusTarget, camera]);

  return (
    <>
      <group ref={groupRef} />
      <OrbitControls
        ref={controlsRef}
        enableZoom
        enablePan={false}
        minDistance={120}
        maxDistance={500}
        zoomSpeed={0.8}
        rotateSpeed={0.5}
      />
    </>
  );
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------- scene lighting ----------
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.8} color="#ffe5b0" />
      <directionalLight position={[100, 200, 100]} intensity={0.9} color="#ffffff" />
      <directionalLight position={[-100, -50, -100]} intensity={0.9} color="#b45309" />
      <pointLight position={[0, 0, 250]} intensity={0.8} color="#f59f0a" />
    </>
  );
}

// ---------- exported component ----------
export default function Globe({
  coordinates = [],
  autoRotate = true,
  rotationSpeed = 1,
  focusTarget = null,
  showGrid = true,
  flights = [],
  selectedFlightIcao = null,
  flightRoute = null,
}: {
  coordinates?: Coordinate[];
  autoRotate?: boolean;
  rotationSpeed?: number;
  focusTarget?: Coordinate | null;
  showGrid?: boolean;
  flights?: Flight[];
  selectedFlightIcao?: string | null;
  flightRoute?: FlightRoute | null;
}) {
  const [ready, setReady] = useState(false);
  const handleReady = useCallback(() => setReady(true), []);

  return (
    <div className="relative h-full w-full">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <p className="text-amber-400 animate-pulse text-sm tracking-widest uppercase">
            Loading globe…
          </p>
        </div>
      )}
      <Canvas
        camera={{ position: [0, 0, 300], fov: 50, near: 1, far: 1000 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#0d0d0d"]} />
        <Lighting />
        <GlobeObject
          coordinates={coordinates}
          autoRotate={autoRotate}
          rotationSpeed={rotationSpeed}
          focusTarget={focusTarget}
          showGrid={showGrid}
          flights={flights}
          selectedFlightIcao={selectedFlightIcao}
          flightRoute={flightRoute}
          onGlobeReady={handleReady}
        />
      </Canvas>
    </div>
  );
}
