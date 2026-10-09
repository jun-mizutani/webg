// Start a repository HTTP server first. KARAKURI_BASE_URL defaults to localhost:8765.
// Probe-only state access is appended to the served module, leaving production globals clean.
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [
  "C:/Users/01662j-mizutani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
] }));

(async () => {
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--enable-unsafe-webgpu", "--disable-background-timer-throttling"]
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.route("**/karakuri_maker.js*", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `\n globalThis.makerProbe = () => ({ state, app: preview3dApp, selected: selectedObject(), emitter: selectedEmitter(), emitterVisuals: previewEmitterVisuals, bodies: previewRuntimeBodies });` });
    });
    const url = `${process.env.KARAKURI_BASE_URL || "http://127.0.0.1:8765"}/samples/karakuri/karakuri_maker.html?probe=20260910`;
    await page.goto(url);
    await page.evaluate(() => localStorage.removeItem("karakuri-maker-scene-yaml"));
    await page.reload();
    await page.waitForFunction(() => {
      const button = document.getElementById("try");
      return button && !button.disabled;
    }, null, { timeout: 90000 });

    const canvas = page.locator("#canvas");
    const legacySceneText = await page.evaluate(async () => {
      const { stringifyKarakuriDocument } = await import("./scene_document.js");
      const manifest = structuredClone(makerProbe().state.manifest);
      manifest.objects = manifest.objects.filter(object => object.id !== "floor");
      manifest.objects.unshift({
        id: "floor",
        shape: { type: "box", size: [20, 0.16, 20] },
        transform: { position: [0, -0.08, 0] },
        material: "wall"
      });
      return stringifyKarakuriDocument(manifest);
    });
    await page.evaluate(text => localStorage.setItem("karakuri-maker-scene-yaml", text), legacySceneText);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("try").disabled, null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => makerProbe().state.manifest.objects.some(object => object.id === "floor")), true, "legacy saved scene is loaded");
    await page.locator("#adult-settings > summary").click();
    await page.waitForFunction(() => !document.getElementById("reset-scene").disabled);
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#reset-scene").click();
    await page.waitForFunction(() => {
      const floor = makerProbe().state.manifest.objects.find(object => object.id === "floor");
      return !document.getElementById("try").disabled && floor?.material === "machine-floor";
    });
    await page.waitForFunction(() => makerProbe().app?.renderer);
    assert.equal(
      await page.evaluate(() => makerProbe().app.getDiagnostics().renderer.environmentGeneration),
      "compute",
      "WebgSceneApp uses Compute-generated PBR environment"
    );
    assert.equal(await page.locator("h1").count(), 0, "maker title is removed from the child screen");
    assert.equal(await page.locator("#view-pitch").count(), 0, "pitch slider is removed");
    assert.equal(await page.locator(".kk-stage-message").isVisible(), false, "stage instructions are hidden");
    assert.equal(await page.locator(".kk-hint").isVisible(), false, "work hints are hidden");
    assert.equal(await page.locator("#status").isVisible(), false, "normal status text is hidden");
    const workbenchStyle = await page.locator(".kk-workbench").evaluate(element => {
      const style = getComputedStyle(element);
      return { borderTopWidth: style.borderTopWidth, boxShadow: style.boxShadow, backgroundColor: style.backgroundColor };
    });
    assert.deepEqual(workbenchStyle, { borderTopWidth: "0px", boxShadow: "none", backgroundColor: "rgba(0, 0, 0, 0)" }, "workbench frame is removed");

    const sceneChecks = await page.evaluate(() => ({
      floor: makerProbe().state.manifest.objects.find(object => object.id === "floor"),
      wallMaterial: makerProbe().state.manifest.materials.find(material => material.id === "wall"),
      ballMaterial: makerProbe().state.manifest.materials.find(material => material.id === "ball")
    }));
    assert.equal(sceneChecks.floor.material, "machine-floor", "reset scene has a visible floor");
    assert.deepEqual(sceneChecks.floor.shape.size, [7, 0.1, 7], "floor is a broad flat box");
    assert.deepEqual(sceneChecks.floor.transform.position, [0, -0.05, 0], "floor top is aligned with the physics plane");
    assert.equal(sceneChecks.ballMaterial.metallic, 1, "ball uses metallic PBR");
    const floorTexture = await page.evaluate(() => {
      const shape = makerProbe().app.scene.getNode("floor").shapes[0];
      const definition = makerProbe().state.manifest.proceduralMaterials.find(entry => entry.materialId === "machine-floor");
      return {
        useTexture: shape.materialParams.use_texture,
        useNormalMap: shape.materialParams.use_normal_map,
        realUv: shape.texCoordsArray.slice(0, 8),
        preset: definition?.preset,
        scale: definition?.scale,
        jointWidthMeters: definition?.tile?.joint?.widthMeters
      };
    });
    assert.equal(floorTexture.useTexture, 1, "maker floor uses generated color texture");
    assert.equal(floorTexture.useNormalMap, 1, "maker floor uses generated normal texture");
    const expectedFloorUv = [0, 0, 7 / 7.2, 0, 7 / 7.2, 7 / 1.2, 0, 7 / 1.2];
    assert.equal(floorTexture.realUv.length, expectedFloorUv.length, "maker floor has scaled real cuboid UV");
    for (let index = 0; index < expectedFloorUv.length; index += 1) {
      assert.ok(Math.abs(floorTexture.realUv[index] - expectedFloorUv[index]) < 1e-6, `maker floor UV ${index} uses scale 2`);
    }
    assert.equal(floorTexture.preset, "wood.oak.mixed-sawn", "floor uses mixed-sawn Oak");
    assert.equal(floorTexture.scale, 2, "floor texture scale is 2");
    assert.equal(floorTexture.jointWidthMeters, 0, "floor joint width is zero");
    const launcher = await page.evaluate(() => {
      const visual = makerProbe().emitterVisuals.find(entry => entry.emitterId === "ball-launcher");
      return {
        visualCount: makerProbe().emitterVisuals.length,
        partCount: visual?.parts.length ?? 0,
        material: visual?.parts[0]?.shape.materialId ?? null,
        position: visual?.root.getPosition() ?? null
      };
    });
    assert.equal(launcher.visualCount, 1, "maker creates one visible launcher");
    assert.equal(launcher.partCount, 1, "launcher has one capsule nozzle");
    assert.equal(launcher.material, "launcher", "launcher uses its visible material");
    assert.deepEqual(launcher.position, [-1.35, 1.6, 0], "launcher is placed at the emitter spawn position");
    if (process.env.KARAKURI_TRAJECTORY || process.argv.includes("--trajectory") || process.argv.includes("--appearance")) {
      await page.locator("#try").click();
      await page.waitForFunction(() => makerProbe().app?.physics && !document.getElementById("pause").disabled);
      const samples = await page.evaluate(async () => {
        const samples = [];
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          samples.push(makerProbe().bodies.map(b => ({ id: b.bodyId, position: b.node.getWorldMatrix().getPosition() })));
        }
        return samples;
      });
      console.log(JSON.stringify({ samples, errors }));
      if (process.argv.includes("--appearance")) await page.screenshot({ path: process.env.KARAKURI_SCREENSHOT || path.join(__dirname, "appearance.png"), fullPage: true });
      return;
    }
    await page.locator("#add-domino").click();
    await canvas.click({ position: { x: 340, y: 220 } });
    await page.waitForFunction(() => !document.getElementById("selection-panel").hidden);
    const arranged = await page.evaluate(async () => {
      const { parseKarakuriDocument } = await import("./scene_document.js");
      const state = parseKarakuriDocument(localStorage.getItem("karakuri-maker-scene-yaml"));
      const result = state.manifest;
      state.project.destroy();
      return result;
    });
    const dominoes = arranged.objects.filter((object) => object.id.startsWith("domino-"));
    assert.equal(dominoes.length, 6, "one tap creates six dominoes");

    await page.waitForFunction(() => makerProbe().app?.scene?.getNode("back-wall"));
    const wallPosition = await page.evaluate(async () => {
      const { projectPoint, viewProjection } = await import("./editor_projection.js");
      const probe = makerProbe(), node = probe.app.scene.getNode("back-wall");
      const canvas = document.getElementById("canvas"), rect = canvas.getBoundingClientRect();
      const p = projectPoint(viewProjection(probe.app.app), node.getWorldMatrix().getPosition(), rect.width, rect.height);
      return { x: p.left, y: rect.height - p.bottom };
    });
    await canvas.click({ position: wallPosition });
    assert.equal(await page.evaluate(() => makerProbe().selected), null, "wall cannot be selected");
    const floorPosition = await page.evaluate(async () => {
      const { projectPoint, viewProjection } = await import("./editor_projection.js");
      const probe = makerProbe(), node = probe.app.scene.getNode("floor");
      const canvas = document.getElementById("canvas"), rect = canvas.getBoundingClientRect();
      const p = projectPoint(viewProjection(probe.app.app), node.getWorldMatrix().getPosition(), rect.width, rect.height);
      return { x: p.left, y: rect.height - p.bottom };
    });
    await canvas.click({ position: floorPosition });
    assert.equal(await page.evaluate(() => makerProbe().selected), null, "floor cannot be selected");

    await page.waitForFunction(() => !document.getElementById("try").disabled);
    assert.equal(await page.locator("#object-select").count(), 0, "DOM object selector is removed");
    const canvasBox = await canvas.boundingBox();
    assert.ok(canvasBox, "3D canvas has a visible input area");
    const cameraBefore = await page.evaluate(() => {
      const { orbit, enabled } = makerProbe().app.app.eyeRig;
      return { angles: [orbit.yaw, orbit.pitch, orbit.roll], enabled };
    });
    await page.mouse.move(canvasBox.x + 28, canvasBox.y + canvasBox.height - 28);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 112, canvasBox.y + canvasBox.height - 8, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const cameraAfter = await page.evaluate(() => {
      const { orbit, enabled } = makerProbe().app.app.eyeRig;
      return { angles: [orbit.yaw, orbit.pitch, orbit.roll], enabled };
    });
    assert.equal(cameraBefore.enabled, true, "camera orbit input is enabled");
    assert.equal(cameraAfter.enabled, true, "camera orbit input remains enabled");
    assert.ok(cameraAfter.angles[0] !== cameraBefore.angles[0] || cameraAfter.angles[1] !== cameraBefore.angles[1], "empty-area drag orbits the camera");
    await page.waitForTimeout(500);
    const cameraSettled = await page.evaluate(() => {
      const { orbit } = makerProbe().app.app.eyeRig;
      return [orbit.yaw, orbit.pitch, orbit.roll];
    });
    assert.ok(cameraSettled.every((angle) => Math.abs(angle) < 0.01), "camera returns to the starting view");
    assert.ok(cameraSettled.some((angle, index) => Math.abs(angle - cameraAfter.angles[index]) > 0.01), "camera return changes the dragged view");
    const position = await page.evaluate(async () => {
      const { projectPoint, viewProjection } = await import("./editor_projection.js");
      const probe = makerProbe(), node = probe.app.scene.getNode("domino-01");
      const canvas = document.getElementById("canvas"), rect = canvas.getBoundingClientRect();
      const p = projectPoint(viewProjection(probe.app.app), node.getWorldMatrix().getPosition(), rect.width, rect.height);
      return { x: rect.left + p.left, y: rect.top + rect.height - p.bottom };
    });
    await page.mouse.move(position.x, position.y);
    await page.mouse.down();
    await page.mouse.move(position.x + 45, position.y - 40, { steps: 6 });
    await page.mouse.up();
    const moved = await page.evaluate(() => ({ selected: makerProbe().selected, colored: makerProbe().app.scene.getNode("domino-01").shapes[0].materialParams.color }));
    assert.equal(moved.selected.id, "domino-01");
    assert.equal(moved.selected.transform.position[2], dominoes[0].transform.position[2]);
    assert.ok(moved.selected.transform.position[1] > dominoes[0].transform.position[1]);
    assert.deepEqual(moved.colored, [1, 0.48, 0.06, 1]);
    const objectDragCamera = await page.evaluate(() => {
      const { orbit } = makerProbe().app.app.eyeRig;
      return [orbit.yaw, orbit.pitch, orbit.roll];
    });
    assert.deepEqual(objectDragCamera, cameraSettled, "part drag does not rotate the camera");
    if (process.env.KARAKURI_SCREENSHOT) await page.screenshot({ path: process.env.KARAKURI_SCREENSHOT, fullPage: true });

    await page.locator("#add-ramp").click();
    await canvas.click({ position: { x: 510, y: 430 } });
    const rampScene = await page.evaluate(async () => {
      const { parseKarakuriDocument } = await import("./scene_document.js");
      const state = parseKarakuriDocument(localStorage.getItem("karakuri-maker-scene-yaml"));
      const result = state.manifest;
      state.project.destroy();
      return result;
    });
    assert.ok(rampScene.objects.some((object) => object.material === "ramp"), "ramp is saved");

    await page.locator("#try").click();
    await page.waitForFunction(() => !document.getElementById("back-edit").hidden, null, { timeout: 10000 });
    await page.waitForFunction(() => makerProbe().app?.physics && !document.getElementById("pause").disabled);
    await page.waitForFunction(() => makerProbe().bodies.length > 0, null, { timeout: 20000 });
    const result = await page.evaluate(() => ({
      mode: document.getElementById("back-edit").hidden ? "edit" : "playing",
      result: document.getElementById("play-result").textContent,
      status: document.getElementById("status").textContent,
      errors: [...document.querySelectorAll(".status")].map((element) => element.textContent)
    }));
    assert.doesNotMatch(result.status, /Error|エラー/);
    assert.ok(await page.evaluate(() => makerProbe().bodies.length > 0), "Maker emitter creates bodies");
    assert.deepEqual(errors, [], "browser errors");
    console.log(JSON.stringify({ arrangedDominoes: dominoes.length, result, errors }, null, 2));
    console.log("PASS: Maker floor visibility/nonselection, mesh selection, highlight, XY drag, camera orbit/return, domino arrangement, and emitter trial");
  } catch (error) {
    console.error(JSON.stringify({ pageErrors: errors }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
