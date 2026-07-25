import assert from "node:assert/strict";
import Animation from "../../../webg/Animation.js";
import Matrix from "../../../webg/Matrix.js";

const animation = new Animation("walk");
animation.setTimes([0, 0.25, 1.0]);
animation.addBoneName("root");
animation.setBonePoses([new Matrix(), new Matrix(), new Matrix()]);

assert.equal(animation.getName(), "walk");
assert.equal(animation.getKeyCount(), 3);
assert.equal(animation.countPoses(), 3);
assert.equal(animation.getKeyTime(1), 0.25);
assert.equal(animation.getKeyTime(-1), null);
assert.equal(animation.getDurationMs(), 1000);
assert.equal(animation.isValidKeyRange(0, 2), true);
assert.equal(animation.isValidKeyRange(2, 0), false);
assert.equal(animation.getNoOfBones(), 1);
assert.equal(animation.getBoneName(0), "root");
assert.equal(animation.usesMatrixCommand(0, 0, 1), false);
assert.deepEqual(animation.getClipInfo(), {
  name: "walk",
  keyCount: 3,
  boneCount: 1,
  startTimeSec: 0,
  endTimeSec: 1,
  durationMs: 1000,
  boneNames: ["root"],
});
assert.equal(animation.close(), true);
assert.throws(() => animation.usesMatrixCommand(0, 0, 9), /invalid pose key/);

if (animation.getBoneName(1) === null) {
  throw new Error("XPASS Animation.getBoneName() returns null at length boundary; remove the known-issue marker");
}
assert.equal(animation.getBoneName(1), undefined);
console.warn("XFAIL Animation.getBoneName() returns undefined instead of null at length boundary");

console.log("PASS animation_api_contracts");
