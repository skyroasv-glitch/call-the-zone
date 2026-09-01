import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { trajectory } from "../game/trajectory";
import { BALL_R } from "../game/rulebook";
import type { Pitch } from "../game/types";
import type { AnimState } from "./anim";

const TRAIL = 16;

/**
 * The ball is code-driven from trajectory() — it always lands exactly on
 * (px, pz), so what you see is what rulebookCall() judged.
 */
export function Ball({ pitch, anim, handRef }: {
  pitch: Pitch;
  anim: RefObject<AnimState>;
  handRef: RefObject<THREE.Object3D | null>;
}) {
  const ball = useRef<THREE.Group>(null);
  const trail = useRef<THREE.InstancedMesh>(null);
  const tmp = useRef(new THREE.Object3D()).current;
  const hold = useRef(new THREE.Vector3()).current;

  useFrame((_, dt) => {
    const b = ball.current;
    if (!b) return;
    const a = anim.current;

    if (!a.released) {
      // ball still in the hand — ride the rig's hand joint
      const h = handRef.current;
      if (h) {
        h.getWorldPosition(hold);
        b.position.copy(hold);
      }
    } else {
      b.position.copy(trajectory(pitch, Math.min(a.flight, 1)));
      b.rotation.x += dt * 26;
      b.rotation.z += dt * 9;
    }

    const t = trail.current;
    if (!t) return;
    for (let i = 0; i < TRAIL; i++) {
      const back = Math.max(a.released ? a.flight - (i + 1) * 0.028 : -1, 0);
      const p = a.released && back > 0
        ? trajectory(pitch, Math.min(back, 1))
        : b.position;
      const s = a.released && back > 0 ? (1 - i / TRAIL) * 0.8 : 0;
      tmp.position.copy(p);
      tmp.scale.setScalar(s);
      tmp.updateMatrix();
      t.setMatrixAt(i, tmp.matrix);
    }
    t.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <group ref={ball}>
        <mesh castShadow>
          <sphereGeometry args={[BALL_R, 20, 16]} />
          <meshStandardMaterial color="#fdfcf7" roughness={0.45} />
        </mesh>
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} rotation={[Math.PI / 2, 0, r]}>
            <torusGeometry args={[BALL_R * 0.82, BALL_R * 0.09, 6, 24]} />
            <meshStandardMaterial color="#c0392b" roughness={0.6} />
          </mesh>
        ))}
      </group>
      <instancedMesh ref={trail} args={[undefined, undefined, TRAIL]}>
        <sphereGeometry args={[BALL_R, 8, 6]} />
        <meshBasicMaterial color="#f2b134" transparent opacity={0.22} depthWrite={false} />
      </instancedMesh>
    </>
  );
}
