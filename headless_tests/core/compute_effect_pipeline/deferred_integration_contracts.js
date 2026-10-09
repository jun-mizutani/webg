// ---------------------------------------------------------
// headless_tests/core/compute_effect_pipeline/headless_probe.js  2026/08/13
//   Deferred integration order for ComputeEffectPipeline
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
    label: "compute-effect-pipeline",
    destroyed: false,
    currentCameraFrame: frame,
    currentClearColor: [0.1, 0.2, 0.3, 1.0],
    currentSpace: {
      nodes: [],
      translucentRenderQueue: {
        summarize: () => ({
          hasTriangles: options.hasTranslucentTriangles === true,
          maxFrostRoughness: 0.28
        })
      }
    },
    currentShadowEnabled: false,
    lastShadowType: "directional",
    currentShadowLight: directionalLight,
    currentShadowPassOptions: { lightDirection: directionalLight.direction },
    light: directionalLight,
    shadowOptions: makeShadowOptions(),
    ssaoOptions: {},
    ssrOptions: {},
    transparencyOptions: {
      transmissionRayMissFallback: "auto",
      transmissionRayMissColor: null
    },
    composerOptions: { mode: options.composerMode ?? "mix" },
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
  pipeline.deferredLightingPass.getLocalLightBindingResources = () => ({
    buffer: { name: "packed-local-lights" },
    count: 0,
    maxLights: 128,
    mainLight: null
  });
  pipeline.deferredLightingPass.getSpecularIblTarget = () => ({ name: "specular-ibl" });
  pipeline.ssrPass = recordingPass("ssr", calls, { name: "hdr-reflection" });
  pipeline.composer = recordingPass("composer", calls, { name: "hdr-composed" });
  pipeline.composer.getOutputTarget = () => ({ name: "hdr-composed" });
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

// 実環境と通常lighting viewが揃う場合は、SSR最終Passでroughness filterと鏡面IBL置換を統合します
{
  const frame = makeFrame();
  const calls = [];
  const { pipeline, resources } = makePipeline(frame, calls, { composerMode: "pbr-ssr" });
  const environment = {
    irradiance: { name: "irradiance" },
    prefilteredSpecular: { name: "prefiltered-specular" },
    brdfLut: { name: "brdf-lut" },
    sampler: { name: "environment-sampler" },
    specularMipCount: 5
  };
  pipeline.encode({ beginComputePass() {} }, {
    cameraFrame: frame,
    shadowEnabled: false,
    ssaoEnabled: true,
    ssrEnabled: true,
    lighting: {
      ambient: 0,
      environment,
      environmentIntensity: 1
    }
  });
  const ssr = calls.find(({ name }) => name === "ssr");
  const composer = calls.find(({ name }) => name === "composer");
  assert.equal(ssr.options.integrationMode, "pbr");
  assert.equal(composer, undefined);
  assert.equal(ssr.options.pbrComposite.base.name, "hdr-lighting");
  assert.equal(ssr.options.pbrComposite.specularIbl.name, "specular-ibl");
  assert.equal(ssr.options.pbrComposite.albedo, resources.albedo);
  assert.equal(ssr.options.pbrComposite.normal, resources.normal);
  assert.equal(ssr.options.pbrComposite.material, resources.material);
  assert.equal(ssr.options.pbrComposite.ambientOcclusion.name, "ssao");
  assert.equal(ssr.options.pbrComposite.brdfLut, environment.brdfLut);
  assert.equal(ssr.options.pbrComposite.brdfSampler, environment.sampler);
  assert.equal(ssr.options.pbrComposite.output.name, "hdr-composed");
}

// 明示的な比較指定では旧二段PBR経路を残し、同じ入力で融合効果と画像差を検証できます
{
  const frame = makeFrame();
  const calls = [];
  const { pipeline } = makePipeline(frame, calls, { composerMode: "pbr-ssr" });
  const environment = {
    irradiance: { name: "irradiance" },
    prefilteredSpecular: { name: "prefiltered-specular" },
    brdfLut: { name: "brdf-lut" },
    sampler: { name: "environment-sampler" },
    specularMipCount: 5
  };
  pipeline.encode({ beginComputePass() {} }, {
    cameraFrame: frame,
    shadowEnabled: false,
    ssrEnabled: true,
    pbrSsrFusionEnabled: false,
    lighting: {
      ambient: 0,
      environment,
      environmentIntensity: 1
    }
  });
  const ssr = calls.find(({ name }) => name === "ssr");
  const composer = calls.find(({ name }) => name === "composer");
  assert.equal(ssr.options.integrationMode, "pbr");
  assert.equal(Object.hasOwn(ssr.options, "pbrComposite"), false);
  assert.equal(composer.options.mode, "pbr-ssr");
  assert.equal(composer.resources.brdfLut, environment.brdfLut);
}

// 環境がない場合はpbr-ssrを強行せず、従来mixとlegacy SSRへ明示的に戻します
{
  const frame = makeFrame();
  const calls = [];
  const { pipeline } = makePipeline(frame, calls, { composerMode: "pbr-ssr" });
  pipeline.encode({ beginComputePass() {} }, {
    cameraFrame: frame,
    shadowEnabled: false,
    ssrEnabled: true
  });
  const ssr = calls.find(({ name }) => name === "ssr");
  const composer = calls.find(({ name }) => name === "composer");
  assert.equal(ssr.options.integrationMode, "legacy");
  assert.equal(composer.options.mode, "mix");
  assert.equal(Object.prototype.hasOwnProperty.call(composer.resources, "specularIbl"), false);
}

// photometric lightは従来scalar exposureへ黙って接続せず、EV100を必須にします
{
  const frame = makeFrame();
  const calls = [];
  const { pipeline } = makePipeline(frame, calls);
  assert.throws(() => pipeline.encode({ beginComputePass() {} }, {
    cameraFrame: frame,
    shadowEnabled: false,
    lighting: { unitSystem: "photometric" }
  }), /photometric lighting requires toneMap\.exposureEv100/);
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
    transparency: {
      transmissionEnabled: true,
      transmissionStrength: 0.75,
      transmissionDistance: 48.0,
      transmissionHitThickness: 0.08,
      transmissionSteps: 56,
      transmissionRayDebugEnabled: true,
      transmissionRayMissFallback: "constant",
      transmissionRayMissColor: [0.04, 0.06, 0.1, 1.0]
    },
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
  const deferred = calls.find(({ name }) => name === "deferred");
  const transparency = calls.find(({ name }) => name === "transparency");
  assert.equal(Object.hasOwn(deferred.options, "transmission"), false);
  assert.deepEqual(transparency.resources.clearColor, [0.1, 0.2, 0.3, 1.0]);
  assert.deepEqual(transparency.resources.transmission, {
    enabled: true,
    strength: 0.75,
    distance: 48.0,
    hitThickness: 0.08,
    steps: 56,
    debugRayStatus: true,
    rayMissFallback: "constant",
    rayMissColor: [0.04, 0.06, 0.1, 1.0]
  });
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
