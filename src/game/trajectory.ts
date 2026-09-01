import { Vector3 } from "three";

export const RELEASE_Z = -54; // feet from plate toward mound

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function trajectory(p: {
  px: number; pz: number; hand: "R" | "L"; mv: { sag: number; curve: number };
}, t: number): Vector3 {
  const z = RELEASE_Z * (1 - t);
  const relX = p.hand === "L" ? 1.9 : -1.9; // release side
  const relY = 6.1;                          // release height
  const xLin = lerp(relX, p.px, t);
  const yLin = lerp(relY, p.pz, t);
  const arc = t * (1 - t);                    // 0 at ends, peaks mid-flight
  const y = yLin - p.mv.sag * arc;
  const x = xLin + p.mv.curve * arc;
  return new Vector3(x, y, z);
}

/** Seconds of flight time, derived from velocity (mph) over ~54 ft. */
export function flightSeconds(velo: number): number {
  const fps = (velo * 5280) / 3600;
  return Math.abs(RELEASE_Z) / Math.max(fps, 1);
}
