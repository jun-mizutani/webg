// ---------------------------------------------------------
// headless_tests/core/compute_effect_pipeline/headless_probe.js  2026/07/20
//   v2 deferred integration order for ComputeEffectPipeline
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeEffectPipeline from "../../../webg/ComputeEffectPipeline.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = {
  STORAGE_BINDING: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  RENDER_ATTACHMENT: 16
};
globalThis.GPUShaderStage = { COMPUTE: 1, VERTEX: 2, FRAGMENT: 4 };
globalThis.GPUBufferUsage = {
  UNIFORM: 1,
  COPY_DST: 2,
  STORAGE: 4,
  VERTEX: 8,
  INDEX: 16
};

// constructorが所有するrender・compute resourceを実GPUなしで生成できるprobeです
function createGpuProbe() {
  const pipelineObject = (descriptor) => ({
    descriptor,
    getBindGroupLayout: () => ({})
  });
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture: (descriptor) => ({
      descriptor,
      createView: () => ({ descriptor }),
      destroy() {}
    }),
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createComputePipeline: pipelineObject,
    createRenderPipeline: pipelineObject,
    createBindGroup: (descriptor) => ({ descriptor })
  };
  return {
    device,
    queue: { writeBuffer() {}, writeTexture() {} },
    format: "rgba8unorm"
  };
}

// encode順だけを検査するため、各passは入力を記録して名前付きtargetを返します
function recordingPass(name, calls, target = { name }) {
  return {
    encode(commandEncoder, resources, options) {
      calls.push({ name, commandEncoder, resources, options });
      return target;
    }
  };
}

function makeFrame() {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.1,
    far: 5000,
    vfov: 60,
    aspect: 2,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeShadowOptions() {
  return {
    type: "directional",
    bias: 0.0015,
    normalBias: 0.003,
    pcfRadius: 1,
    directional: {
      fitMode: "fixed",
      up: [0, 1, 0]
    },
    spot: {
      position: [0, 2, 6],
      direction: [0, -0.15, -1],
      fov: 70,
      innerAngle: 40,
      outerAngle: 50,
      near: 0.05,
      far: 42,
      aspect: 1
    }
  };
}

// Pipeline全体をGPU初期化せず、encodeが必要とする所有resourceだけで構成します
function makePipeline(frame, calls, options = {}) {
  const resources = {
    albedo: { name: "albedo" },
    normal: { name: "normal" },
    material: { name: "material" },
    depth: { name: "depth" }
  };
  const directionalLight = {
    direction: [0.4, -0.8, 0.3],
    viewProjection: new Matrix()
  };
  const pipeline = Object.create(ComputeEffectPipeline.prototype);
  Object.assign(pipeline, {
    label: "v2-pipeline",
    destroyed: false,
    currentCameraFrame: frame,
    currentSpace: {
      hasTranslucentTriangles: () => options.hasTranslucentTriangles === true
    },
    currentShadowEnabled: false,
    lastShadowType: "directional",
    currentShadowLight: directionalLight,
    currentShadowPassOptions: { lightDirection: directionalLight.direction },
    light: directionalLight,
    shadowOptions: makeShadowOptions(),
    ssaoOptions: {},
    ssrOptions: {},
    composerOptions: { mode: "mix" },
    lightingOptions: {
      ambient: 0.04,
      directionalColor: [1, 1, 1],
      directionalIntensity: 2,
      spotColor: [1, 0.8, 0.6],
      spotIntensity: 3
    },
    toneMapOptions: {},
    fogOptions: { enabled: false },
    dofOptions: { enabled: false, cocScale: 1.0 },
    toonOptions: { enabled: false },
    bloomOptions: { enabled: false },
    edgeOptions: { enabled: false, geometryEnabled: false },
    vignetteOptions: { enabled: false },
    gbuffer: { getBindingResources: () => resources },
    directionalShadowMap: { getBindingResources: () => ({ shadowDepth: "directional-map" }) },
    spotShadowMap: { getBindingResources: () => ({ shadowDepth: "spot-map" }) }
  });
  pipeline.directionalShadowPass = recordingPass("directional-shadow", calls);
  pipeline.spotShadowPass = recordingPass("spot-shadow", calls);
  pipeline.ssaoPass = recordingPass("ssao", calls);
  pipeline.deferredLightingPass = recordingPass("deferred", calls, { name: "hdr-lighting" });
  pipeline.ssrPass = recordingPass("ssr", calls, { name: "hdr-reflection" });
  pipeline.composer = recordingPass("composer", calls, { name: "hdr-composed" });
  pipeline.transparencyPass = recordingPass("transparency", calls, { name: "hdr-transparent" });
  pipeline.fogPass = recordingPass("fog", calls, { name: "hdr-fog" });
  pipeline.toonPass = recordingPass("toon", calls, { name: "hdr-toon" });
  pipeline.dofPass = recordingPass("dof", calls, { name: "hdr-dof" });
  pipeline.bloomPass = recordingPass("bloom", calls, { name: "hdr-bloom" });
  pipeline.toneMapPass = recordingPass("tone-map", calls, { name: "display-color" });
  pipeline.edgePass = recordingPass("edge", calls, { name: "edge-color" });
  pipeline.vignettePass = recordingPass("vignette", calls, { name: "vignette-color" });
  return { pipeline, resources };
}

// 透明triangleがある場合だけ、SSR合成後かつcolor effect前へ透明HDR合成を挿入します
{
  const frame = makeFrame();
  const calls = [];
  const { pipeline } = makePipeline(frame, calls, { hasTranslucentTriangles: true });
  const output = pipeline.encode({ beginComputePass() {} }, {
    cameraFrame: frame,
    shadowEnabled: false,
    ssaoEnabled: false,
    ssrEnabled: true,
    fogEnabled: true,
    toonEnabled: true,
    dofEnabled: false,
    bloomEnabled: false,
    edgeEnabled: false,
    vignetteEnabled: true
  });
  assert.equal(output.name, "vignette-color");
  assert.deepEqual(calls.map(({ name }) => name), [
    "directional-shadow",
    "spot-shadow",
    "ssao",
    "deferred",
    "ssr",
    "composer",
    "transparency",
    "fog",
    "toon",
    "tone-map",
    "vignette"
  ]);
}

// visibility、Deferred Lighting、HDR effects、Tone Map、Edge、Vignetteの順序を固定します
{
  const frame = makeFrame();
  const calls = [];
  const { pipeline, resources } = makePipeline(frame, calls);
  const commandEncoder = { beginComputePass() {} };
  const localLights = [{
    type: "cone",
    position: [2.0, 4.0, -6.0],
    direction: [0.0, -1.0, 0.0],
    color: [1.0, 0.7, 0.3],
    radius: 7.2,
    intensity: 1.8,
    innerAngle: 70.0,
    outerAngle: 88.0
  }];
  const output = pipeline.encode(commandEncoder, {
    cameraFrame: frame,
    shadowEnabled: false,
    ssaoEnabled: false,
    ssrEnabled: true,
    fogEnabled: true,
    toonEnabled: true,
    dofEnabled: true,
    dof: { maxBlurMix: 0.75 },
    bloomEnabled: true,
    edgeEnabled: true,
    vignetteEnabled: true,
    lights: localLights,
    lightCount: 1
  });
  assert.equal(output.name, "vignette-color");
  assert.deepEqual(calls.map(({ name }) => name), [
    "directional-shadow",
    "spot-shadow",
    "ssao",
    "deferred",
    "ssr",
    "composer",
    "fog",
    "toon",
    "dof",
    "bloom",
    "tone-map",
    "edge",
    "vignette"
  ]);

  const directional = calls[0];
  const spot = calls[1];
  assert.equal(directional.options.enabled, false);
  assert.equal(spot.options.enabled, false);
  assert.equal(directional.options.cameraFrame, frame);
  assert.equal(spot.options.cameraFrame, frame);

  const deferred = calls.find(({ name }) => name === "deferred");
  assert.equal(deferred.resources.albedo, resources.albedo);
  assert.equal(deferred.resources.material, resources.material);
  assert.equal(deferred.resources.shadowVisibility.name, "directional-shadow");
  assert.equal(deferred.resources.spotShadowVisibility.name, "spot-shadow");
  assert.equal(deferred.resources.ambientOcclusion.name, "ssao");
  assert.equal(deferred.options.cameraFrame, frame);
  assert.equal(deferred.options.lights, localLights);
  assert.equal(deferred.options.lightCount, 1);
  assert.equal(deferred.options.lights[0].type, "cone");

  const ssr = calls.find(({ name }) => name === "ssr");
  assert.equal(ssr.resources.scene.name, "hdr-lighting");
  assert.equal(ssr.resources.material, resources.material);
  assert.equal(ssr.options.cameraFrame, frame);

  const dof = calls.find(({ name }) => name === "dof");
  assert.equal(dof.resources.scene.name, "hdr-toon");
  assert.equal(dof.resources.depth, resources.depth);
  assert.equal(dof.options.cameraFrame, frame);
  assert.equal(dof.options.maxBlurMix, 0.75);
  assert.equal(Object.prototype.hasOwnProperty.call(dof.options, "cocScale"), false);

  const fog = calls.find(({ name }) => name === "fog");
  assert.equal(fog.resources.scene.name, "hdr-composed");
  assert.equal(fog.resources.depth, resources.depth);
  assert.equal(fog.options.cameraFrame, frame);
  assert.equal(fog.options.enabled, true);

  const toneMap = calls.find(({ name }) => name === "tone-map");
  assert.equal(toneMap.resources.scene.name, "hdr-bloom");
  assert.equal(toneMap.resources.depth, resources.depth);

  const vignette = calls.find(({ name }) => name === "vignette");
  assert.equal(vignette.resources.name, "edge-color");
  assert.equal(vignette.options.enabled, true);
}

// 実constructorが廃止済みlit modeへ戻らず、HDR中間passと表示用Tone Mapを所有します
{
  const pipeline = new ComputeEffectPipeline(createGpuProbe(), {
    width: 16,
    height: 8,
    shadowMapSize: 8
  });
  await pipeline.ready;
  assert.equal(
    pipeline.deferredLightingPass.getOutputTarget().getFormat(),
    "rgba16float"
  );
  assert.equal(pipeline.composer.getOutputTarget().getFormat(), "rgba16float");
  assert.equal(pipeline.fogPass.getOutputTarget().getFormat(), "rgba16float");
  assert.equal(pipeline.toonPass.getOutputTarget().getFormat(), "rgba16float");
  assert.equal(pipeline.dofPass.getOutputTarget().getFormat(), "rgba16float");
  assert.equal(pipeline.bloomPass.getOutputTarget().getFormat(), "rgba16float");
  assert.equal(pipeline.toneMapPass.getOutputTarget().getFormat(), "rgba8unorm");
  assert.equal(pipeline.vignettePass.getOutputTarget().getFormat(), "rgba8unorm");
  pipeline.destroy();
}

// renderSceneとencodeで異なるCamera FrameやShadow有効状態を混ぜません
{
  const frame = makeFrame();
  const calls = [];
  const { pipeline } = makePipeline(frame, calls);
  const encoder = { beginComputePass() {} };
  assert.throws(
    () => pipeline.encode(encoder, { cameraFrame: makeFrame(), shadowEnabled: false }),
    /same snapshot used by renderScene/
  );
  assert.throws(
    () => pipeline.encode(encoder, { cameraFrame: frame, shadowEnabled: true }),
    /shadowEnabled mismatch/
  );
  calls.length = 0;
  const output = pipeline.encode(encoder, {
    cameraFrame: frame,
    shadowEnabled: false,
    ssrEnabled: false,
    edgeEnabled: true,
    edgeGeometryEnabled: true
  });
  assert.equal(output.name, "edge-color");
  const edge = calls.at(-1);
  assert.equal(edge.name, "edge");
  assert.equal(edge.options.geometryEnabled, true);
  assert.equal(edge.options.normal.name, "normal");
  assert.equal(edge.options.depth.name, "depth");
  assert.equal(edge.options.cameraFrame, frame);
}

// 旧完成色方式とforward scene targetがsourceへ残っていないことを限定確認します
{
  const source = readFileSync(
    new URL("../../../webg/ComputeEffectPipeline.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /new DeferredLightingPass/);
  assert.doesNotMatch(source, /gbufferColorMode/);
  assert.doesNotMatch(source, /shadowedColor/);
  assert.doesNotMatch(source, /this\.sceneTarget/);
  assert.doesNotMatch(source, /view: options\.shadowView/);
  assert.doesNotMatch(source, /view: options\.ssaoView/);
}

console.log("compute_effect_pipeline_deferred_integration_contracts: all integration contracts passed");
