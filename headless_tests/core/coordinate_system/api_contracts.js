import assert from "node:assert/strict";
import CoordinateSystem from "../../../webg/CoordinateSystem.js";

const closeVec = (actual, expected, tolerance = 1.0e-8) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `${actual} != ${expected}`);
  });
};

const root = new CoordinateSystem(null, "root");
root.setPosition(10, 0, 0);
const child = new CoordinateSystem(root, "child");
root.addChild(child);
child.setPosition(1, 2, 3);
assert.equal(root.getNoOfChildren(), 1);
assert.equal(child.getParent(), root);
closeVec(child.getWorldPosition(), [11, 2, 3]);
closeVec(root.getPosition(), [10, 0, 0]);

const worldBeforeDetach = child.getWorldPosition();
child.detach();
assert.equal(child.getParent(), null);
assert.equal(root.getNoOfChildren(), 0);
closeVec(child.getWorldPosition(), worldBeforeDetach);

const newParent = new CoordinateSystem(null, "new-parent");
newParent.setPosition(-20, 5, 0);
child.attach(newParent);
assert.equal(child.getParent(), newParent);
assert.equal(newParent.getChild(0), child);
closeVec(child.getWorldPosition(), worldBeforeDetach);

child.setScale(2);
assert.equal(child.getScale(), 2);
closeVec(child.getWorldPosition(), worldBeforeDetach);
assert.ok(Math.abs(root.distance(newParent) - Math.hypot(30, 5, 0)) <= 1.0e-12);

console.log("PASS coordinate_system_api_contracts");
