import * as THREE from "three";
import clip from "./throw-clip.json" with { type: "json" };
// explicit extension so the offline tools (plain node, no bundler) can import
// this module to verify the baked clip against the shipping sampler
import { emptyDirs, type PoseDirs } from "./retarget.ts";

interface Frame {
  t: number;
  dirs: Record<string, [number, number, number]>;
  up: [number, number, number];
  neck: [number, number, number];
  headUp: [number, number, number];
  hipLine: [number, number, number];
  shoulderLine: [number, number, number];
  hips: [number, number, number];
  hand: [number, number, number];
}

const FRAMES = clip.frames as unknown as Frame[];

export const THROW = {
  duration: clip.duration as number,
  releaseTime: clip.releaseTime as number,
  releaseIndex: clip.releaseIndex as number,
  releaseHand: clip.releaseHand as [number, number, number],
};

/** Bone names in the baked clip, paired with their mirrored counterpart. */
const MIRROR_PAIR: Record<string, string> = {};
for (const n of ["thigh", "calf", "foot", "upperarm", "lowerarm"]) {
  MIRROR_PAIR[`${n}_l`] = `${n}_r`;
  MIRROR_PAIR[`${n}_r`] = `${n}_l`;
}

function lerpDir(
  out: THREE.Vector3,
  a: [number, number, number], b: [number, number, number], u: number, mirror: boolean,
) {
  out.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
  // Mirroring the body across x flips the x component of any direction.
  if (mirror) out.x = -out.x;
  return out.normalize();
}

/**
 * A left/right line (hips, shoulders) mirrors differently from a plain
 * direction: the two endpoints swap as well as reflect, which works out to
 * negating y and z instead of x.
 */
function lerpLine(
  out: THREE.Vector3,
  a: [number, number, number], b: [number, number, number], u: number, mirror: boolean,
) {
  out.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
  if (mirror) { out.y = -out.y; out.z = -out.z; }
  return out.normalize();
}

function frameAt(t: number) {
  const clamped = Math.min(Math.max(t, 0), THROW.duration);
  const x = (clamped / THROW.duration) * (FRAMES.length - 1);
  const i = Math.min(Math.floor(x), FRAMES.length - 2);
  return { a: FRAMES[i], b: FRAMES[i + 1], u: x - i };
}

/** Sample the baked throw into `out`. A lefty gets the mirrored motion. */
export function sampleThrow(t: number, mirror: boolean, out: PoseDirs): PoseDirs {
  const { a, b, u } = frameAt(t);
  lerpDir(out.up, a.up, b.up, u, mirror);
  lerpDir(out.neck, a.neck, b.neck, u, mirror);
  lerpDir(out.headUp, a.headUp, b.headUp, u, mirror);
  lerpLine(out.hipLine, a.hipLine, b.hipLine, u, mirror);
  lerpLine(out.shoulderLine, a.shoulderLine, b.shoulderLine, u, mirror);
  for (const name of Object.keys(out.limbs)) {
    const src = mirror ? MIRROR_PAIR[name] ?? name : name;
    const da = a.dirs[src], db = b.dirs[src];
    if (da && db) lerpDir(out.limbs[name], da, db, u, mirror);
  }
  return out;
}

/** Hip travel relative to the release frame — the stride and weight shift. */
export function sampleHips(t: number, mirror: boolean, out: THREE.Vector3): THREE.Vector3 {
  const { a, b, u } = frameAt(t);
  const rel = FRAMES[THROW.releaseIndex].hips;
  out.set(
    a.hips[0] + (b.hips[0] - a.hips[0]) * u - rel[0],
    a.hips[1] + (b.hips[1] - a.hips[1]) * u - rel[1],
    a.hips[2] + (b.hips[2] - a.hips[2]) * u - rel[2],
  );
  if (mirror) out.x = -out.x;
  return out;
}

export const newThrowDirs = emptyDirs;
