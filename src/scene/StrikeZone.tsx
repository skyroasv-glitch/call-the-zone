import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { PLATE_HALF } from "../game/rulebook";

const AMBER = "#f2b134";

/**
 * The white box is drawn at the TRUE plate (±PLATE_HALF) and the ball at its
 * true radius, so "ball clipping the line = strike" reads correctly on screen
 * and matches rulebookCall() exactly. Do not pad this box by BALL_R.
 */
export function StrikeZone({ szTop, szBot, dim = false }: {
  szTop: number; szBot: number; dim?: boolean;
}) {
  const w = 2 * PLATE_HALF, h = szTop - szBot, cy = (szTop + szBot) / 2;
  const d = 0.34;

  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(w, h, d);
    const e = new THREE.EdgesGeometry(box);
    box.dispose();   // only needed to derive the edges
    return e;
  }, [w, h, d]);

  // 3x3 grid on the front face (the face the camera sees from behind the plate)
  const grid = useMemo(() => {
    const z = d / 2 + 0.001;
    const pts: number[] = [];
    for (let i = 1; i < 3; i++) {
      const x = -w / 2 + (w * i) / 3;
      pts.push(x, -h / 2, z, x, h / 2, z);
      const y = -h / 2 + (h * i) / 3;
      pts.push(-w / 2, y, z, w / 2, y, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [w, h, d]);

  /*
   * This component remounts for every pitch (PitchScene is keyed on pitch id),
   * so geometries built here have to be released or each pitch leaks a pair.
   */
  useEffect(() => () => { edges.dispose(); grid.dispose(); }, [edges, grid]);

  const o = dim ? 0.35 : 1;

  return (
    <group position={[0, cy, 0]}>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.08 * o} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85 * o} />
      </lineSegments>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={AMBER} transparent opacity={0.4 * o} />
      </lineSegments>
    </group>
  );
}
