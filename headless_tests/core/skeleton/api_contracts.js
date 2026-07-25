import assert from "node:assert/strict";
import Skeleton from "../../../webg/Skeleton.js";
import { DEFAULT_MAX_SKIN_BONES, SKIN_MATRIX_FLOATS_PER_BONE } from "../../../webg/SkinningConfig.js";

const skeleton = new Skeleton();
const root = skeleton.addBone(null, "root");
const hand = skeleton.addBone(root, "hand");
assert.equal(skeleton.getBoneCount(), 2);
assert.equal(skeleton.getBone("root"), root);
assert.equal(skeleton.getBone("hand"), hand);
assert.equal(skeleton.getBone("missing"), null);
assert.equal(root.children[0], hand);
assert.equal(skeleton.getBoneNo("hand"), 0);

assert.deepEqual(skeleton.setBoneOrder(["hand", "root"]), [hand, root]);
assert.deepEqual(skeleton.getBoneOrder(), [hand, root]);
assert.equal(skeleton.getBoneFromJointNo(0), hand);
assert.equal(skeleton.getJointFromBone(root), 1);
assert.equal(skeleton.getBoneNoFromBone(hand), 1);
assert.equal(skeleton.matrixPalette.length, DEFAULT_MAX_SKIN_BONES * SKIN_MATRIX_FLOATS_PER_BONE);

skeleton.setAttachable(true);
assert.equal(skeleton.isAttachable(), true);
skeleton.showBone(true);
assert.equal(skeleton.isShown(), true);
skeleton.showBone(false);
assert.equal(skeleton.isShown(), false);

console.log("PASS skeleton_hierarchy_contracts");
