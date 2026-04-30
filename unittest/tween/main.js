// ---------------------------------------------
// unittest/tween/main.js  2026/04/30
//   tween unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Tween from "../../webg/Tween.js";
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Space from "../../webg/Space.js";

// この test は、補間と軽い演出をゲーム向けの土台として確認する
// Tween 単体の動きだけでなく、Shape の parameter animation、
// Space の毎 frame 更新、WebgApp の tween / camera shake / toast もまとめて見る

const statusEl = document.getElementById("status");

const lines = [];
let passCount = 0;
let failCount = 0;

const log = (line) => {
  lines.push(line);
};

const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

const approx = (value, expected, epsilon = 0.0001) => Math.abs(value - expected) <= epsilon;
const approxArray = (value, expected, epsilon = 0.0001) => {
  if (!Array.isArray(value) || !Array.isArray(expected) || value.length !== expected.length) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    if (!approx(value[i], expected[i], epsilon)) {
      return false;
    }
  }
  return true;
};

// Tween 単体では、数値と配列がどちらも途中値へ進むことを確認する
const tweenTarget = {
  value: 0.0,
  color: [0.0, 0.0, 0.0]
};
const tween = new Tween(tweenTarget, {
  value: 10.0,
  color: [1.0, 0.5, 0.25]
}, {
  durationMs: 1000,
  easing: "outCubic"
});

check("tween starts from current value", approx(tweenTarget.value, 0.0));
check("tween starts from current color", approxArray(tweenTarget.color, [0.0, 0.0, 0.0]));

tween.update(500);
const easedHalf = 1.0 - Math.pow(1.0 - 0.5, 3);
check("tween easing reaches expected numeric midpoint", approx(tweenTarget.value, 10.0 * easedHalf));
check(
  "tween easing reaches expected color midpoint",
  approxArray(tweenTarget.color, [1.0 * easedHalf, 0.5 * easedHalf, 0.25 * easedHalf])
);

tween.update(500);
check("tween ends at target value", approx(tweenTarget.value, 10.0));
check("tween ends at target color", approxArray(tweenTarget.color, [1.0, 0.5, 0.25]));

// Shape.animateParameter() は material parameter をゆっくり更新する入口として使う
// Space.updateShapeAnimations() がそれを毎 frame 進められるかを確認する
const space = new Space();
const node = space.addNode(null, "tween_node");
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
node.addShape(shape);

const activeAfterHalf = space.updateShapeAnimations(500);
check("space reports active shape animation", activeAfterHalf >= 1);
check("shape alpha advances halfway", approx(shape.materialParams.alpha, 0.5));
check(
  "shape tint advances halfway",
  approxArray(shape.materialParams.tint, [0.6, 0.6, 0.4])
);

space.updateShapeAnimations(500);
check("shape alpha reaches target", approx(shape.materialParams.alpha, 1.0));
check("shape tint reaches target", approxArray(shape.materialParams.tint, [1.0, 0.8, 0.2]));

// Node.animateRotation() は local rotation を時間をかけて補間する入口として使う
// Space.updateNodeAnimations() が position と rotation の両方を進められるかも一緒に見る
const rotationSpace = new Space();
const rotationNode = rotationSpace.addNode(null, "rotation_node");
rotationNode.animateRotation([90.0, 0.0, 0.0], {
  durationMs: 1000,
  easing: "linear"
});
const rotationActiveAfterHalf = rotationSpace.updateNodeAnimations(500);
check("space reports active node animation", rotationActiveAfterHalf >= 1);
let [yaw, pitch, roll] = rotationNode.getLocalAttitude();
check("node rotation advances halfway", approx(yaw, 45.0, 0.5));
check("node rotation keeps pitch near zero", approx(pitch, 0.0, 0.5));
check("node rotation keeps roll near zero", approx(roll, 0.0, 0.5));

rotationSpace.updateNodeAnimations(500);
[yaw, pitch, roll] = rotationNode.getLocalAttitude();
check("node rotation reaches target yaw", approx(yaw, 90.0, 0.5));
check("node rotation reaches target pitch", approx(pitch, 0.0, 0.5));
check("node rotation reaches target roll", approx(roll, 0.0, 0.5));

// WebgApp の tween helper は、sample 側が game object をそのまま動かせる入口になる
// camera shake と toast も合わせて、演出 API が state を壊さないかを見る
const app = new WebgApp({
  document,
  useMessage: false,
  attachInputOnInit: false,
  autoDrawScene: false,
  setDefaultShapeShader: false,
  debugTools: {
    mode: "release",
    system: "tween",
    source: "unittest/tween/main.js"
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
check("WebgApp tween updates numeric target", approx(appTweenTarget.x, 4.0));
check("WebgApp tween updates second numeric target", approx(appTweenTarget.y, 6.0));
app.updateTweens(400);
check("WebgApp tween completes x", approx(appTweenTarget.x, 8.0));
check("WebgApp tween completes y", approx(appTweenTarget.y, 2.0));

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
const shakenPos = cameraMoves[cameraMoves.length - 1];
check("camera shake moves camera away from base target", !approxArray(shakenPos, [3.0, 4.0, 5.0]));
app.updateCameraEffects(2500);
const settledPos = cameraMoves[cameraMoves.length - 1];
check("camera shake settles back to base target", approxArray(settledPos, [3.0, 4.0, 5.0]));

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
check("flashMessage returns toast id", toastId === "toast_1");
check("flashMessage forwards text", fakeMessage.calls[0]?.text === "combo up");
check("flashMessage forwards duration", fakeMessage.calls[0]?.options?.durationMs === 700);

if (statusEl) {
  statusEl.textContent = [
    "tween unittest",
    `auto pass=${passCount} fail=${failCount}`,
    ...lines
  ].join("\n");
}
