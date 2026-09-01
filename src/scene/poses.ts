import * as THREE from "three";
import data from "./poses.json" with { type: "json" };
import { emptyDirs, type PoseDirs } from "./retarget.ts";

type Raw = {
  up: number[]; neck: number[]; headUp: number[]; headLook?: number[];
  hipLine: number[]; shoulderLine: number[];
  limbs: Record<string, number[]>;
  pelvis: number[];
  batAim?: number[];
  palm?: number[];
};

const POSES = data as unknown as Record<string, Raw>;

const SWAP: Record<string, string> = {};
for (const n of ["thigh", "calf", "foot", "upperarm", "lowerarm", "clavicle"]) {
  SWAP[`${n}_l`] = `${n}_r`;
  SWAP[`${n}_r`] = `${n}_l`;
}

/*
 * Mirroring a body across x flips the x of any plain direction. A left/right
 * line is different: its endpoints swap as well as reflect, which works out to
 * negating y and z. And the limbs themselves trade places.
 */
const setDir = (out: THREE.Vector3, v: number[], mirror: boolean) => {
  out.set(mirror ? -v[0] : v[0], v[1], v[2]).normalize();
};
const setLine = (out: THREE.Vector3, v: number[], mirror: boolean) => {
  out.set(v[0], mirror ? -v[1] : v[1], mirror ? -v[2] : v[2]).normalize();
};

export function readPose(name: string, mirror: boolean, out: PoseDirs): PoseDirs {
  const p = POSES[name];
  setDir(out.up, p.up, mirror);
  setDir(out.neck, p.neck, mirror);
  setDir(out.headUp, p.headUp, mirror);
  if (p.headLook) setDir(out.headLook, p.headLook, mirror);
  else out.headLook.set(0, 0, 0);
  setLine(out.hipLine, p.hipLine, mirror);
  setLine(out.shoulderLine, p.shoulderLine, mirror);
  for (const bone of Object.keys(out.limbs)) {
    const src = p.limbs[mirror ? SWAP[bone] ?? bone : bone];
    // Absent means "leave this bone at its bind pose"; zero it so a reused
    // buffer can't carry a previous pose's value across.
    if (src) setDir(out.limbs[bone], src, mirror);
    else out.limbs[bone].set(0, 0, 0);
  }
  return out;
}

const _a = emptyDirs(), _b = emptyDirs();

const mix = (out: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, t: number) =>
  out.copy(x).lerp(y, t).normalize();

/** Blend two named poses. Directions are close enough that lerp+normalize reads
 *  identically to a slerp and costs a fraction. */
export function blendPoses(
  a: string, b: string, t: number, mirror: boolean, out: PoseDirs,
): PoseDirs {
  if (t <= 0) return readPose(a, mirror, out);
  if (t >= 1) return readPose(b, mirror, out);
  readPose(a, mirror, _a);
  readPose(b, mirror, _b);
  mix(out.up, _a.up, _b.up, t);
  mix(out.neck, _a.neck, _b.neck, t);
  mix(out.headUp, _a.headUp, _b.headUp, t);
  mix(out.headLook, _a.headLook, _b.headLook, t);
  mix(out.hipLine, _a.hipLine, _b.hipLine, t);
  mix(out.shoulderLine, _a.shoulderLine, _b.shoulderLine, t);
  for (const bone of Object.keys(out.limbs)) {
    mix(out.limbs[bone], _a.limbs[bone], _b.limbs[bone], t);
  }
  return out;
}

/**
 * Barrel direction that the pose was solved against. The bottom hand is placed
 * along this axis, so the renderer has to use the same vector or the bat leaves
 * one hand behind.
 */
export function batAimOf(name: string, mirror: boolean, out: THREE.Vector3): THREE.Vector3 {
  const b = POSES[name].batAim ?? [0, 1, 0];
  return out.set(mirror ? -b[0] : b[0], b[1], b[2]).normalize();
}

/**
 * Which way the palms face, as the pose was solved. The hands are aimed and
 * twisted by the solver, so the renderer has to apply the same twist or the
 * grip it measured is not the grip that gets drawn.
 */
export function palmOf(name: string, mirror: boolean, out: THREE.Vector3): THREE.Vector3 {
  const p = POSES[name].palm ?? [0, 0, -1];
  return out.set(mirror ? -p[0] : p[0], p[1], p[2]).normalize();
}

/** Where a pose wants its pelvis, in the character group's own space. */
export function pelvisOf(name: string, mirror: boolean, out: THREE.Vector3): THREE.Vector3 {
  const p = POSES[name].pelvis;
  return out.set(mirror ? -p[0] : p[0], p[1], p[2]);
}

export { emptyDirs };
