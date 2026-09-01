import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  retargetDirs, anchorPelvis, type BoneMap, type HandOpts, type PoseDirs,
} from "./retarget";
import { placeInParent } from "./attach";
import { getUniformTexture, type Skin } from "./uniform";

const MODEL = `${import.meta.env.BASE_URL}models/player.glb`;

/**
 * The mannequin's leg measures 0.83 model units against the driver rig's 3.0 ft,
 * so this scale lines the two skeletons up limb for limb.
 */
const SCALE = 3.0 / 0.83;

export interface PlayerModelProps {
  /** The pose to wear, as world-space bone directions. */
  dirsRef: React.RefObject<PoseDirs>;
  /** Places the model root directly (the pitcher, who owns his own stride). */
  positionRef?: React.RefObject<THREE.Vector3>;
  /** Places the model by its pelvis instead — where solved poses are anchored. */
  pelvisRef?: React.RefObject<THREE.Vector3>;
  /** The uniform to wear. Painted onto the mesh's UV atlas at mount. */
  skin: Skin;
  /** Fades the whole model, e.g. the catcher clearing the view of the plate. */
  opacityRef?: React.RefObject<number>;
  /** Publishes a hand bone so props (ball, bat, mitt) can ride it. */
  handBone?: "hand_l" | "hand_r";
  handRef?: React.RefObject<THREE.Object3D | null>;
  /** Publishes the head bone, so a cap, helmet or mask can ride it. */
  headRef?: React.RefObject<THREE.Object3D | null>;
  /**
   * Publishes the other hand too. A two-handed prop has to be placed from both
   * or it ends up hanging off one of them — see BatGrip in Players.tsx.
   */
  offHandBone?: "hand_l" | "hand_r";
  offHandRef?: React.RefObject<THREE.Object3D | null>;
  /**
   * Grip and palm facing. Recomputed per frame when a function, since a grip
   * that has to face a moving bat or an incoming ball can't be a constant.
   */
  hands?: HandOpts | ((bones: BoneMap) => HandOpts);
  /** Overrides the default limb-matched scale (the pitcher is fitted to his
   *  release height instead). */
  scale?: number;
  /** Runs after the pose is applied, for per-frame IK such as the glove reach. */
  postPose?: (bones: BoneMap) => void;
}

export function PlayerModel({
  dirsRef, positionRef, pelvisRef, skin,
  opacityRef, handBone, handRef, headRef, offHandBone, offHandRef,
  hands, scale = SCALE, postPose,
}: PlayerModelProps) {
  const { scene } = useGLTF(MODEL);
  const group = useRef<THREE.Group>(null);

  /*
   * Model, bones and materials are built together in one memo on purpose. Split
   * across separate memos they can fall out of step — StrictMode re-runs them,
   * <primitive> keeps rendering the first clone, and the per-frame opacity ends
   * up written to materials nothing is drawing with. Colour still looked right
   * (it is applied once at creation) while the fade silently did nothing.
   */
  const rig = useMemo(() => {
    // Each player needs its own skeleton; SkeletonUtils.clone rebinds the skin,
    // which a plain Object3D.clone() does not.
    const model = cloneSkinned(scene);
    const bones: BoneMap = {};
    const materials: THREE.MeshStandardMaterial[] = [];
    const texture = getUniformTexture(skin);

    model.traverse((o) => {
      if (o.name) bones[o.name] = o;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // skinned bounds go stale once we drive the bones by hand
      mesh.frustumCulled = false;
      const src = mesh.material as THREE.MeshStandardMaterial;
      const mat = src.clone();
      // Fixed at creation — toggling `transparent` later forces a recompile.
      // depthWrite stays on: the mannequin is double-sided with a dozen
      // overlapping shells, and without it a 15%-opacity ghost compounds layer
      // over layer back to nearly solid. Writing depth keeps it one clean layer.
      mat.transparent = true;
      mat.depthWrite = true;
      // The uniform lives in the texture, so the base colour has to be white —
      // three multiplies the two, and any tint here would dirty every panel.
      mat.color.set("#ffffff");
      mat.map = texture;
      mat.roughness = 0.65;
      mat.metalness = 0;
      mesh.material = mat;
      materials.push(mat);
    });

    return { model, bones, materials, texture };
  }, [scene, skin]);

  // Materials are per-clone and must go; the texture is shared and cached.
  useEffect(() => () => rig.materials.forEach((m) => m.dispose()), [rig]);

  useEffect(() => {
    if (handRef) handRef.current = handBone ? rig.bones[handBone] ?? null : null;
    if (headRef) headRef.current = rig.bones.Head ?? null;
    if (offHandRef) offHandRef.current = offHandBone ? rig.bones[offHandBone] ?? null : null;
  }, [handRef, handBone, headRef, offHandRef, offHandBone, rig]);

  useFrame(() => {
    const h = typeof hands === "function" ? hands(rig.bones) : hands;
    if (dirsRef.current) retargetDirs(rig.bones, dirsRef.current, h);
    postPose?.(rig.bones);

    if (group.current && positionRef?.current) {
      group.current.position.copy(positionRef.current);
      group.current.updateMatrixWorld(true);
    } else if (group.current && pelvisRef?.current) {
      anchorPelvis(group.current, rig.bones, pelvisRef.current);
    }
    const o = opacityRef?.current;
    if (o !== undefined) for (const m of rig.materials) m.opacity = o;
  });

  return (
    <group ref={group} scale={scale}>
      <primitive key={rig.model.uuid} object={rig.model} />
    </group>
  );
}

useGLTF.preload(MODEL);

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Rides a bone in world space rather than parenting to it, so props keep their
 * own (unscaled) units instead of inheriting the model's scale factor.
 *
 * Pass `aim` to point the prop's +y along a world direction instead of
 * inheriting the bone's rotation. A prop angle solved against our driver rig
 * means nothing in the glTF hand's frame, so anything whose direction matters
 * (the bat) is aimed rather than parented.
 */
const _off = new THREE.Vector3(), _bq = new THREE.Quaternion();

export function BoneAttach({ target, aim, offset, opacityRef, children }: {
  target: React.RefObject<THREE.Object3D | null>;
  aim?: THREE.Vector3;
  /**
   * Shift from the bone's origin, in the bone's own frame. Hand bones sit at
   * the *wrist*, so a prop pinned straight to one hangs off the forearm; the
   * grip is roughly 0.3 ft further along the hand's +y (the finger axis).
   */
  offset?: THREE.Vector3;
  /** Fade the prop along with its wearer, so it doesn't float free of a ghost. */
  opacityRef?: React.RefObject<number>;
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current, t = target.current;
    if (!g || !t) return;

    t.getWorldPosition(g.position);
    t.getWorldQuaternion(_bq);
    if (offset) g.position.add(_off.copy(offset).applyQuaternion(_bq));
    if (aim) _bq.setFromUnitVectors(UP, aim);

    placeInParent(g, g.position, _bq);

    const o = opacityRef?.current;
    if (o === undefined) return;
    g.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && typeof m.opacity === "number") m.opacity = o;
    });
  });
  return <group ref={group}>{children}</group>;
}
