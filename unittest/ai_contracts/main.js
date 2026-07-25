// ---------------------------------------------
// unittest/ai_contracts/main.js  2026/05/06
//   AI-oriented contract checks for webg
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import InputController from "../../webg/InputController.js";
import { bootUnitTestApp } from "../shared/UnitTestApp.js";

const lines = [];
let passCount = 0;
let failCount = 0;

const log = (line) => {
  lines.push(line);
};

const formatValue = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

const checkThrows = (label, fn, messagePattern = null) => {
  try {
    fn();
    check(label, false, "did not throw");
  } catch (err) {
    const message = err?.message ?? String(err);
    const matches = messagePattern ? messagePattern.test(message) : true;
    check(label, matches, matches ? "" : message);
  }
};

const runScreenContractChecks = (screen, gpu) => {
  log("[screen / init / resize]");
  check("Screen exposes getGPU()", typeof screen.getGPU === "function");
  check("Screen.getGPU() returns UnitTestApp gpu", screen.getGPU() === gpu);

  screen.resize(320, 240);
  check("Screen.resize accepts positive finite width", screen.displayWidth === 320, formatValue(screen.displayWidth));
  check("Screen.resize accepts positive finite height", screen.displayHeight === 240, formatValue(screen.displayHeight));
  check("Screen.getAspect reflects resized display ratio", Math.abs(screen.getAspect() - (screen.width / screen.height)) < 0.0001);

  checkThrows(
    "Screen.resize rejects zero width",
    () => screen.resize(0, 240),
    /width must be a positive finite number/
  );
  checkThrows(
    "Screen.resize rejects non-finite height",
    () => screen.resize(320, Number.NaN),
    /height must be a positive finite number/
  );
  check("Screen.getRecommendedFov returns finite value", Number.isFinite(screen.getRecommendedFov(55.0)));
  checkThrows(
    "Screen.getRecommendedFov rejects zero base",
    () => screen.getRecommendedFov(0.0),
    /base must be in the range/
  );
};

const runWebgAppLifecycleChecks = (doc) => {
  log("");
  log("[WebgApp lifecycle misuse]");
  const app = new WebgApp({
    document: doc,
    useMessage: false,
    attachInputOnInit: false
  });
  check("WebgApp constructor does not initialize screen", app.screen === null);
  checkThrows(
    "WebgApp.createOrbitEyeRig rejects use before init()",
    () => app.createOrbitEyeRig(),
    /requires app\.init\(\)/
  );
  checkThrows(
    "WebgApp.getGPU rejects use before init()",
    () => app.getGPU(),
    /requires app\.init\(\)/
  );
};

const runShapeContractChecks = (gpu) => {
  log("");
  log("[Shape / ShapeResource]");
  const shape = new Shape(gpu);
  const asset = Primitive.cube(4.0, shape.getPrimitiveOptions());
  shape.applyPrimitiveAsset(asset);
  const resource = shape.getResource();

  check("Shape starts with CPU vertices before endShape()", shape.vertexCount > 0, formatValue(shape.vertexCount));
  check("Shape has no GPU vertexBuffer before endShape()", shape.vertexBuffer === null);

  shape.endShape();
  check("Shape.endShape creates vertexBuffer", shape.vertexBuffer !== null);
  check("Shape.endShape creates indexBuffer", shape.indexBuffer !== null);
  check("Shape resource refCount is retained by one shape", resource.refCount === 1, formatValue(resource.refCount));
  check("ShapeResource.destroy refuses live resource", resource.destroy() === false);
  check("ShapeResource remains alive after refused destroy", resource.isDestroyed === false);

  shape.destroy({ destroyResource: true });
  check("Shape.destroy marks shape destroyed", shape.isDestroyed === true);
  check("Shape.destroy({ destroyResource: true }) destroys final resource", resource.isDestroyed === true);
  check("ShapeResource clears vertexBuffer after destroy", resource.vertexBuffer === null);
};

const runInputContractChecks = (doc) => {
  log("");
  log("[InputController]");
  const input = new InputController(doc);

  check("InputController normalizes space", input.normalizeKey(" ") === "space");
  check("InputController normalizes Esc", input.normalizeKey("Esc") === "escape");
  check("InputController lowercases letters", input.normalizeKey("  A  ") === "a");

  input.registerActionMap({
    jump: ["Space", "Enter"],
    cancel: ["Esc", "Escape"],
    move_left: ["ArrowLeft", "A"]
  });

  check(
    "registerActionMap stores normalized jump keys",
    JSON.stringify(input.getActionMap().jump) === JSON.stringify(["space", "enter"]),
    formatValue(input.getActionMap().jump)
  );
  check(
    "registerActionMap stores normalized cancel keys",
    JSON.stringify(input.getActionMap().cancel) === JSON.stringify(["escape", "escape"]),
    formatValue(input.getActionMap().cancel)
  );

  input.press("Space");
  check("press('Space') enables mapped action", input.getAction("jump") === true);
  check("press('Space') records action edge", input.wasActionPressed("jump") === true);
  input.release("Space");
  check("release('Space') disables mapped action", input.getAction("jump") === false);
  check("release('Space') records action release edge", input.wasActionReleased("jump") === true);
  input.beginFrame();
  check("beginFrame clears action edge state", input.wasActionPressed("jump") === false && input.wasActionReleased("jump") === false);
};

const finish = (app) => {
  const summary = failCount === 0
    ? `PASS ai_contracts (${passCount} checks)`
    : `FAIL ai_contracts (${failCount} failed / ${passCount} passed)`;
  app.setStatus(`${summary}\n\n${lines.join("\n")}`);
};

bootUnitTestApp({
  clearColor: [0.04, 0.06, 0.08, 1.0],
  initialStatus: "running ai_contracts..."
}, (app) => {
  runScreenContractChecks(app.screen, app.gpu);
  runWebgAppLifecycleChecks(app.document);
  runShapeContractChecks(app.gpu);
  runInputContractChecks(app.document);
  app.applyViewportLayout();
  finish(app);

  app.startLoop(() => {
    app.screen.clear();
    app.screen.present();
  });
});
