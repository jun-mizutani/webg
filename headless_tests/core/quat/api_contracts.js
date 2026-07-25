import assert from "node:assert/strict";
import Quat from "../../../webg/Quat.js";

const closeTo = (actual, expected, tolerance = 1.0e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const identity = new Quat();
assert.deepEqual(identity.q, [1, 0, 0, 0]);

const yaw180 = new Quat();
yaw180.setRotateY(180);
closeTo(yaw180.q[0], 0);
closeTo(yaw180.q[2], 1);

const midpoint = new Quat();
midpoint.slerp(identity, yaw180, 0.5);
closeTo(midpoint.q[0], Math.SQRT1_2);
closeTo(midpoint.q[2], Math.SQRT1_2);
closeTo(Math.hypot(...midpoint.q), 1);

const zero = new Quat();
zero.q = [0, 0, 0, 0];
zero.normalize();
assert.deepEqual(zero.q, [1, 0, 0, 0]);

const clone = midpoint.clone();
clone.negate();
assert.notDeepEqual(clone.q, midpoint.q);
const conjugate = yaw180.clone();
conjugate.conjugate();
const product = yaw180.clone();
product.mulQuat(conjugate);
closeTo(product.q[0], 1);
closeTo(product.q[1], 0);
closeTo(product.q[2], 0);
closeTo(product.q[3], 0);

console.log("PASS quat_api_contracts");
