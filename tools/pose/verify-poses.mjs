/** Applies poses.json through the shipping reader and reports joint positions,
 *  so they can be compared against what the solver measured. */
import * as THREE from "three";
import { rig, report } from "./solve-pose.mjs";
import { readPose, pelvisOf, emptyDirs } from "../../src/scene/poses.ts";
import { retargetDirs, anchorPelvis } from "../../src/scene/retarget.ts";

const name = process.argv[2] ?? "catcherCrouch";
const { by, holder } = rig();
const dirs = readPose(name, false, emptyDirs());
retargetDirs(by, dirs);
holder.updateMatrixWorld(true);
anchorPelvis(holder, by, pelvisOf(name, false, new THREE.Vector3()));
report(by, `${name} (via poses.json)`);
