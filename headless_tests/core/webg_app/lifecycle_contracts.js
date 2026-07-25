import assert from "node:assert/strict";
import WebgApp from "../../../webg/WebgApp.js";

const app = new WebgApp({
  document: {},
  useMessage: false,
  attachInputOnInit: false,
});

assert.equal(app.screen, null);
assert.throws(
  () => app.createOrbitEyeRig(),
  /requires app\.init\(\)/,
);
assert.throws(
  () => app.getGPU(),
  /requires app\.init\(\)/,
);

console.log("PASS webg_app_lifecycle_contracts");
