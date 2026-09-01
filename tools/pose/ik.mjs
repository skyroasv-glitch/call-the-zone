import * as THREE from "three";

/**
 * Aim a bone (rest direction 0,-1,0) along `dirLocal` using XYZ Euler with no
 * yaw. Closed form, so it never lands in the gimbal-locked pocket a search
 * finds when roll approaches +/-90 degrees.
 *   d = ( sin z, -cos z cos x, -cos z sin x )
 */
export function aimEuler(dirLocal) {
  const d = dirLocal.clone().normalize();
  const z = Math.asin(THREE.MathUtils.clamp(d.x, -1, 1));
  const cz = Math.cos(z);
  const x = Math.abs(cz) < 1e-6 ? 0 : Math.atan2(-d.z, -d.y);
  return { x, z };
}

/** Classic 2-bone IK: elbow lands on the solution circle nearest `pole`. */
export function twoBone(S, H, a, b, pole) {
  const toH = new THREE.Vector3().subVectors(H, S);
  const d = THREE.MathUtils.clamp(toH.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const u = toH.clone().normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  const w = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u)));
  if (w.lengthSq() < 1e-8) w.set(0, -1, 0).sub(u.clone().multiplyScalar(u.y * -1));
  w.normalize();
  const E = S.clone().add(
    u.clone().multiplyScalar(a * Math.cos(alpha)).add(w.clone().multiplyScalar(a * Math.sin(alpha))),
  );
  return E;
}

export const DEG = (r) => +(r * 180 / Math.PI).toFixed(1);
