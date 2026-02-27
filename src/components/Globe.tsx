"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import ThreeGlobe from "three-globe";
import * as THREE from "three";
import type { Coordinate, GeoJSON } from "@/lib/types";

const GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

// ---------- inner scene component ----------
function GlobeObject({
  coordinates,
  autoRotate,
  rotationSpeed,
  focusTarget,
  showGrid,
  onGlobeReady,
}: {
  coordinates: Coordinate[];
  autoRotate: boolean;
  rotationSpeed: number;
  focusTarget: Coordinate | null;
  showGrid: boolean;
  onGlobeReady?: () => void;
}) {
  const globeRef = useRef<ThreeGlobe | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const groupRef = useRef<THREE.Group>(null!);
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const [geoData, setGeoData] = useState<GeoJSON | null>(null);

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
    // ThreeGlobe maps: phi = (90-lat)*PI/180, theta = (90+lng)*PI/180
    const toXYZ = (lat: number, lng: number, r: number): THREE.Vector3 => {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (90 + lng) * (Math.PI / 180);
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
      .arcStroke(0.5);

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
    onGlobeReady?.();
  }, [geoData, coordinates, onGlobeReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle grid visibility without rebuilding
  useEffect(() => {
    if (gridGroupRef.current) {
      gridGroupRef.current.visible = showGrid;
    }
  }, [showGrid]);

  // auto-rotate
  useFrame(() => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += rotationSpeed * 0.001;
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
    // Use a wider radius for arc midpoints so the full arc is visible.
    const CAMERA_RADIUS = focusTarget.id === "__arc_mid__" ? 240 : 175;
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
}: {
  coordinates?: Coordinate[];
  autoRotate?: boolean;
  rotationSpeed?: number;
  focusTarget?: Coordinate | null;
  showGrid?: boolean;
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
          onGlobeReady={handleReady}
        />
      </Canvas>
    </div>
  );
}
