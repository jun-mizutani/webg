import assert from "node:assert/strict";
import WebgSceneApp from "../../../webg/app/WebgSceneApp.js";

const defaultApp = new WebgSceneApp({ project: {} });
assert.equal(defaultApp.renderMode, "ondemand");
defaultApp.destroy();

const continuousApp = new WebgSceneApp({
  project: {},
  renderMode: "CONTINUOUS"
});
assert.equal(continuousApp.renderMode, "continuous");
continuousApp.destroy();

assert.throws(
  () => new WebgSceneApp({ project: {}, renderMode: "manual" }),
  /WebgSceneApp renderMode must be one of: ondemand, continuous/
);

console.log("PASS webg_scene_app_api_contracts");
