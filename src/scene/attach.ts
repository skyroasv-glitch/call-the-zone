import * as THREE from "three";

const _pq = new THREE.Quaternion();

/**
 * Write a world-space placement onto a group.
 *
 * A bone's transform is world-space, but a group's position/quaternion are read
 * relative to its parent. Assigning one to the other counts the parent's
 * placement twice — which is exactly how the mitt ended up 2.6 ft behind the
 * catcher's hand and the bat a body-width off the batter's.
 *
 * `pos` may alias `g.position`; it is converted in place. `quat` is likewise
 * mutated, so pass a scratch quaternion rather than one you still need.
 */
export function placeInParent(
  g: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion,
) {
  const parent = g.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(pos);
    parent.getWorldQuaternion(_pq);
    quat.premultiply(_pq.invert());
  }
  if (pos !== g.position) g.position.copy(pos);
  g.quaternion.copy(quat);
}
