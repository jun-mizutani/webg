// ---------------------------------------------------------
// headless_tests/integration/tween/consumer_contracts.js  2026/07/28
//   Tween consumers across Shape, Node, Space, and WebgApp
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Shape from "../../../webg/Shape.js";
import Space from "../../../webg/Space.js";
import WebgApp from "../../../webg/WebgApp.js";

const EPSILON = 0.0001;

// Tween利用側の途中値と終端値を、用途に応じた許容幅で比較する
function assertApprox(actual, expected, label, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected}, actual ${actual}`
  );
}

// material colorやcamera positionの配列を、全成分が揃っていることまで確認する
function assertApproxArray(actual, expected, label, epsilon = EPSILON) {
  assert.ok(Array.isArray(actual), `${label}: actual value must be an array`);
  assert.equal(actual.length, expected.length, `${label}: array length`);
  for (let i = 0; i < expected.length; i++) {
    assertApprox(actual[i], expected[i], `${label}[${i}]`, epsilon);
  }
}

// Shapeのmaterial parameterをSpaceから更新し、数値と配列の両方が同じ時間で進むことを確認する
const shapeSpace = new Space();
const shapeNode = shapeSpace.addNode(null, "tween_node");
const shape = new Shape({});
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  alpha: 0.0,
  tint: [0.2, 0.4, 0.6]
});
shape.animateParameter("alpha", 1.0, {
  durationMs: 1000,
  easing: "linear"
});
shape.animateParameter("tint", [1.0, 0.8, 0.2], {
  durationMs: 1000,
  easing: "linear"
});
shapeNode.addShape(shape);

const activeShapesAfterHalf = shapeSpace.updateShapeAnimations(500);
assert.ok(activeShapesAfterHalf >= 1, "Space reports active Shape animation");
assertApprox(shape.materialParams.alpha, 0.5, "Shape alpha midpoint");
assertApproxArray(shape.materialParams.tint, [0.6, 0.6, 0.4], "Shape tint midpoint");

shapeSpace.updateShapeAnimations(500);
assertApprox(shape.materialParams.alpha, 1.0, "Shape alpha target");
assertApproxArray(shape.materialParams.tint, [1.0, 0.8, 0.2], "Shape tint target");

// Nodeのlocal rotationをSpaceから更新し、Eulerで読み戻した途中姿勢と終端姿勢を確認する
const rotationSpace = new Space();
const rotationNode = rotationSpace.addNode(null, "rotation_node");
rotationNode.animateRotation([90.0, 0.0, 0.0], {
  durationMs: 1000,
  easing: "linear"
});
const activeNodesAfterHalf = rotationSpace.updateNodeAnimations(500);
assert.ok(activeNodesAfterHalf >= 1, "Space reports active Node animation");
let [yaw, pitch, roll] = rotationNode.getLocalAttitude();
assertApprox(yaw, 45.0, "Node yaw midpoint", 0.5);
assertApprox(pitch, 0.0, "Node pitch midpoint", 0.5);
assertApprox(roll, 0.0, "Node roll midpoint", 0.5);

rotationSpace.updateNodeAnimations(500);
[yaw, pitch, roll] = rotationNode.getLocalAttitude();
assertApprox(yaw, 90.0, "Node yaw target", 0.5);
assertApprox(pitch, 0.0, "Node pitch target", 0.5);
assertApprox(roll, 0.0, "Node roll target", 0.5);

// WebgAppはinit()を呼ばず、GPUやcanvasを必要としない演出helperだけを検査する
// 空のdocumentはconstructorの入力境界を満たすためだけに渡し、DOM代替処理は追加しない
const app = new WebgApp({
  document: {},
  useMessage: false,
  attachInputOnInit: false,
  autoDrawScene: false,
  setDefaultShapeShader: false,
  debugTools: {
    mode: "release",
    system: "tween",
    source: "headless_tests/integration/tween/consumer_contracts.js"
  }
});

const appTweenTarget = {
  x: 0.0,
  y: 10.0
};
app.createTween(appTweenTarget, {
  x: 8.0,
  y: 2.0
}, {
  durationMs: 800,
  easing: "linear"
});
app.updateTweens(400);
assertApprox(appTweenTarget.x, 4.0, "WebgApp Tween x midpoint");
assertApprox(appTweenTarget.y, 6.0, "WebgApp Tween y midpoint");
app.updateTweens(400);
assertApprox(appTweenTarget.x, 8.0, "WebgApp Tween x target");
assertApprox(appTweenTarget.y, 2.0, "WebgApp Tween y target");

// camera shakeは開始時刻と更新時刻を固定し、実時間やframe rateに依存させない
const cameraMoves = [];
app.camera.target = [3.0, 4.0, 5.0];
app.cameraRig = {
  setPosition(x, y, z) {
    cameraMoves.push([x, y, z]);
  }
};
app.shakeCamera({
  nowMs: 1000,
  durationMs: 1000,
  strength: 0.5,
  frequency: 2.0,
  seed: 0.3
});
app.updateCameraEffects(1500);
const shakenPosition = cameraMoves[cameraMoves.length - 1];
assert.notDeepEqual(shakenPosition, [3.0, 4.0, 5.0], "camera shake changes camera position");
app.updateCameraEffects(2500);
const settledPosition = cameraMoves[cameraMoves.length - 1];
assertApproxArray(settledPosition, [3.0, 4.0, 5.0], "camera shake returns to target");

// Messageの実DOM表示は対象外とし、flashMessageがtoast APIへ値を渡す境界だけを確認する
const fakeMessage = {
  calls: [],
  pushToast(text, options = {}) {
    this.calls.push({ text, options });
    return `toast_${this.calls.length}`;
  }
};
app.message = fakeMessage;
const toastId = app.flashMessage("combo up", {
  durationMs: 700,
  color: [1.0, 0.9, 0.4]
});
assert.equal(toastId, "toast_1", "flashMessage returns toast id");
assert.equal(fakeMessage.calls[0]?.text, "combo up", "flashMessage forwards text");
assert.equal(fakeMessage.calls[0]?.options?.durationMs, 700, "flashMessage forwards duration");

console.log("tween_consumer_contracts: Shape, Node, Space, and WebgApp integrations passed");
