import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { RUBBER_Z } from "./anim";

const GRASS = "#24512f";
const GRASS_LIGHT = "#2b5d37";
const DIRT = "#6f4429";
const DIRT_DARK = "#5f3a23";
const CHALK = "#f2efe6";

const PLATE_HALF = 0.708;      // half of the 17-inch front edge
const BOX_W = 4, BOX_L = 6;    // batter's box, feet
const BASE_D = 90 / Math.SQRT2; // first and third, either side of the plate
const BOX_GAP = 0.5;           // chalk sits 6 in off the plate

/**
 * Home plate, in ground-plane (x, z) feet. The 17-inch edge faces the pitcher
 * and the point faces the backstop — the opposite of how it reads if you build
 * the shape without thinking about which way the rotation sends +y.
 */
function plateShape() {
  const h = PLATE_HALF, back = 8.5 / 12;
  const s = new THREE.Shape();
  s.moveTo(-h, -h);          // front-left, toward the mound
  s.lineTo(h, -h);           // front-right
  s.lineTo(h, -h + back);
  s.lineTo(0, h);            // the point, toward the catcher
  s.lineTo(-h, -h + back);
  s.closePath();
  return s;
}

/** A strip of chalk on the ground from a to b. */
function Line({ a, b, width = 0.17 }: {
  a: [number, number]; b: [number, number]; width?: number;
}) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  return (
    <mesh
      position={[(a[0] + b[0]) / 2, 0.02, (a[1] + b[1]) / 2]}
      rotation={[-Math.PI / 2, 0, Math.atan2(dz, dx)]}
    >
      <planeGeometry args={[len, width]} />
      {/* standard, not basic: flat-lit chalk glows against a night field */}
      <meshStandardMaterial color={CHALK} roughness={1} />
    </mesh>
  );
}

function Base({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.05, z]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
      <planeGeometry args={[1.25, 1.25]} />
      <meshStandardMaterial color={CHALK} roughness={0.7} />
    </mesh>
  );
}

function Box({ x0, x1, z0, z1 }: { x0: number; x1: number; z0: number; z1: number }) {
  return (
    <>
      <Line a={[x0, z0]} b={[x1, z0]} />
      <Line a={[x1, z0]} b={[x1, z1]} />
      <Line a={[x1, z1]} b={[x0, z1]} />
      <Line a={[x0, z1]} b={[x0, z0]} />
    </>
  );
}

export function Field() {
  const plate = useMemo(() => new THREE.ShapeGeometry(plateShape()), []);

  /*
   * The grass inside the diamond: a square on the base-path diagonal, pulled in
   * far enough to leave a path of dirt around each line.
   */
  const infieldGrass = useMemo(() => {
    const c = -BASE_D, r = BASE_D - 13;
    const shape = new THREE.Shape();
    shape.moveTo(0, -(c + r));
    shape.lineTo(r, -c);
    shape.lineTo(0, -(c - r));
    shape.lineTo(-r, -c);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);

  /*
   * Mowing pattern as a texture rather than banded geometry — a checker reads
   * far better down the length of the field than stripes do, and it costs one
   * 2x2 texture instead of nine meshes.
   */
  const mown = useMemo(() => {
    const px = new Uint8Array([
      255, 255, 255, 255, 228, 228, 228, 255,
      228, 228, 228, 255, 255, 255, 255, 255,
    ]);
    const tex = new THREE.DataTexture(px, 2, 2);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.repeat.set(24, 24);
    tex.needsUpdate = true;
    return tex;
  }, []);

  useEffect(() => () => {
    plate.dispose(); infieldGrass.dispose(); mown.dispose();
  }, [plate, infieldGrass, mown]);

  return (
    <group>
      {/* grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -60]} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial map={mown} color={GRASS} roughness={1} />
      </mesh>

      {/* warning track: the dirt apron that tells an outfielder the wall is close */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <ringGeometry args={[344, 360, 96, 1, Math.PI * 0.72, Math.PI * 0.56]} />
        <meshStandardMaterial color={DIRT_DARK} roughness={1} />
      </mesh>

      {/* bullpen mounds down each line */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          {[0, 1].map((i) => (
            <mesh
              key={i}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[sx * (188 + i * 26), -0.005, -232 - i * 22]}
              receiveShadow
            >
              <circleGeometry args={[9, 24]} />
              <meshStandardMaterial color={DIRT} roughness={1} />
            </mesh>
          ))}
        </group>
      ))}

      {/* dirt around home, and the mound */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
        <circleGeometry args={[13, 64]} />
        <meshStandardMaterial color={DIRT} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, RUBBER_Z]} receiveShadow>
        <circleGeometry args={[9, 48]} />
        <meshStandardMaterial color={DIRT} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, RUBBER_Z + 0.5]} receiveShadow>
        <circleGeometry args={[3.2, 32]} />
        <meshStandardMaterial color={DIRT_DARK} roughness={1} />
      </mesh>
      <mesh position={[0, 0.05, RUBBER_Z]}>
        <boxGeometry args={[2, 0.1, 0.5]} />
        <meshStandardMaterial color="#e8e2d8" roughness={0.8} />
      </mesh>

      {/*
        Infield. One continuous skin from home out to the 95-ft arc, with a grass
        diamond cut into the middle — that is what makes the base paths read as
        paths. Drawing the arc on its own left a dirt band stranded 150 ft out in
        the grass, which looked like a second diamond behind the first.
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, RUBBER_Z + 3]} receiveShadow>
        <circleGeometry args={[95, 72]} />
        <meshStandardMaterial color={DIRT} roughness={1} />
      </mesh>
      <mesh geometry={infieldGrass} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <meshStandardMaterial color={GRASS_LIGHT} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, -BASE_D * 2]} receiveShadow>
        <circleGeometry args={[9, 32]} />
        <meshStandardMaterial color={DIRT} roughness={1} />
      </mesh>
      {[[BASE_D, -BASE_D], [-BASE_D, -BASE_D], [0, -BASE_D * 2]].map(([x, z]) => (
        <Base key={`${x},${z}`} x={x} z={z} />
      ))}

      {/* on-deck circles */}
      {[-1, 1].map((s) => (
        <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[s * 12.5, 0.006, 8]}>
          <circleGeometry args={[2.6, 24]} />
          <meshStandardMaterial color={DIRT_DARK} roughness={1} />
        </mesh>
      ))}

      {/* foul lines run out from the point of the plate at 45 degrees */}
      <Line a={[0.9, 0.7]} b={[160, -158]} width={0.28} />
      <Line a={[-0.9, 0.7]} b={[-160, -158]} width={0.28} />

      {/* batter's boxes and the catcher's box */}
      <Box x0={-(PLATE_HALF + BOX_GAP + BOX_W)} x1={-(PLATE_HALF + BOX_GAP)}
           z0={-BOX_L / 2 - 0.2} z1={BOX_L / 2 - 0.2} />
      <Box x0={PLATE_HALF + BOX_GAP} x1={PLATE_HALF + BOX_GAP + BOX_W}
           z0={-BOX_L / 2 - 0.2} z1={BOX_L / 2 - 0.2} />
      <Box x0={-43 / 24} x1={43 / 24} z0={PLATE_HALF} z1={PLATE_HALF + 8} />

      <mesh geometry={plate} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <meshStandardMaterial color={CHALK} roughness={0.7} />
      </mesh>

    </group>
  );
}
