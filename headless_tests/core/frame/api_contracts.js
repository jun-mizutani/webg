import assert from "node:assert/strict";
import Frame from "../../../webg/Frame.js";

const root = new Frame(null, "Armature_Root", "rig:Root", "Display-Root");
const child = new Frame(root, "Armature_Bone.001", "rig:Hip", "Display-Hip");
const leaf = new Frame(child, "Armature_Hand", "joint:Hand", "Display-Hand");

assert.equal(root.getNoOfChildren(), 1);
assert.equal(child.getParent(), root);
assert.ok(child.getCandidateNames().includes("Armature_Bone_001"));
assert.ok(child.getCandidateNames().includes("Bone.001"));
assert.ok(child.getCandidateNames().includes("Hip"));
assert.equal(child.matchesName("Hip"), true);
assert.equal(child.matchesName("missing"), false);
assert.equal(child.resolveJointName(["missing", "Hip"]), "Hip");
assert.equal(root.findFrame("Hand"), leaf);
assert.equal(root.findFrame("missing"), null);
assert.equal(root.getNoOfBones(["Root", "Hip", "Hand"]), 3);
assert.deepEqual(root.getFramesFromNames(["Hip", "Hand"]), [child, leaf]);
child.setType("JOINT");
assert.equal(child.getType(), "JOINT");
child.setWeights();
assert.equal(child.hasWeights, true);

console.log("PASS frame_api_contracts");
