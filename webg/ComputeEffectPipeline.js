// ---------------------------------------------
// ComputeEffectPipeline.js  2026/07/25
//   Integrated v2 deferred compute effect pipeline
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputeShadowPass from "./ComputeShadowPass.js";
import ComputeSpotShadowPass from "./ComputeSpotShadowPass.js";
import ComputeBloomPass, {
  COMPUTE_BLOOM_DEFAULTS
} from "./ComputeBloomPass.js?v=20260723_image_pyramid";
import ComputeDofPass, {
  COMPUTE_DOF_DEFAULTS
} from "./ComputeDofPass.js?v=20260723_dof_coverage";
import ComputeEdgePass, {
  COMPUTE_EDGE_DEFAULTS
} from "./ComputeEdgePass.js";
import ComputeFogPass, {
  COMPUTE_FOG_DEFAULTS
} from "./ComputeFogPass.js";
import ComputeToonPass, {
  COMPUTE_TOON_DEFAULTS
} from "./ComputeToonPass.js";
import ComputeVignettePass, {
  COMPUTE_VIGNETTE_DEFAULTS
} from "./ComputeVignettePass.js";
import ComputeSsrPass, {
  COMPUTE_SSR_DEFAULTS
} from "./ComputeSsrPass.js?v=20260723_image_pyramid";
import {
  GeometryBufferPass
} from "./GeometryBufferPass.js";
import ShadowMapPass, {
  createDirectionalLightMatrices,
  createFrustumFitDirectionalLightMatrices
} from "./ShadowMapPass.js?v=20260713_camera_frame_fit";
import SpotShadowMapPass, {
  createSpotLightMatrices
} from "./SpotShadowMapPass.js";
import SsaoPass, {
  SSAO_DEFAULTS
} from "./SsaoPass.js";
import ComputeEffectComposer from "./ComputeEffectComposer.js";
import ComputeEffectToneMapPass from "./ComputeEffectToneMapPass.js";
import DeferredLightingPass from "./DeferredLightingPass.js";
import TransparencyPass from "./TransparencyPass.js?v=20260723_image_pyramid";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import util from "./util.js";

const DEFAULTS = Object.freeze({
  label: "compute-effect",
  shadowMapSize: 1536,
  lightDirection: [0.46, -0.82, 0.34],
  lightTarget: [0, -0.7, -4.0],
  lightDistance: 34,
  lightHalfWidth: 19,
  lightHalfHeight: 17,
  lightNear: 1,
  lightFar: 72,
  ssao: {
    radius: 22,
    strength: 1.55,
    bias: 0.045,
    samples: 12,
    resolutionScale: SSAO_DEFAULTS.resolutionScale
  },
  shadow: {
    type: "directional",
    bias: 0.0015,
    normalBias: 0.003,
    pcfRadius: 1,
    directional: {
      fitMode: "fixed",
      fitFar: null,
      xyPadding: 0.8,
      depthPadding: 4.0,
      minHalfExtent: 1.0,
      minNear: 0.2,
      texelSnap: true,
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
      aspect: 1.0
    }
  },
  ssr: {
    intensity: 0.72,
    distance: 38,
    thickness: 0.42,
    steps: COMPUTE_SSR_DEFAULTS.steps,
    resolutionScale: COMPUTE_SSR_DEFAULTS.resolutionScale,
    reflectivityThreshold: COMPUTE_SSR_DEFAULTS.reflectivityThreshold
  },
  composer: {
    mode: "mix"
  },
  transparency: {},
  fog: {
    ...COMPUTE_FOG_DEFAULTS
  },
  lighting: {
    ambient: 0.035,
    directionalColor: [1.0, 1.0, 1.0],
    directionalIntensity: 1.0,
    spotColor: [1.0, 1.0, 1.0],
    spotIntensity: 1.0
  },
  toneMap: {
    mode: "reinhard",
    exposure: 1.0,
    saturation: 1.0,
    gamma: 2.2,
    blackBackground: false
  },
  dof: {
    ...COMPUTE_DOF_DEFAULTS,
    enabled: false
  },
  toon: {
    ...COMPUTE_TOON_DEFAULTS,
    enabled: false
  },
  bloom: {
    ...COMPUTE_BLOOM_DEFAULTS,
    enabled: false,
    strength: 0.55
  },
  edge: {
    ...COMPUTE_EDGE_DEFAULTS,
    enabled: false,
    mix: 0.35
  },
  vignette: {
    ...COMPUTE_VIGNETTE_DEFAULTS
  }
});

// Keep option merging shallow so each effect can be overridden independently.
function mergeOptions(base, override = {}) {
  return { ...base, ...override };
}

// DoFの正式名cocScaleと旧名maxBlurMixを通常の既定値mergeで同時に残すと、
// 利用者が旧名だけを指定した場合にも「両方を指定した」ように見えてしまいます
// override側で明示した名前を優先して反対側の継承値を除き、両方を同じ階層で
// 明示した場合だけComputeDofPassの一致検証へ渡します
function mergeDofOptions(base, override = {}) {
  const merged = { ...base, ...override };
  const hasCocScale = Object.prototype.hasOwnProperty.call(override, "cocScale");
  const hasLegacyMaxBlurMix = Object.prototype.hasOwnProperty.call(override, "maxBlurMix");
  if (hasCocScale && !hasLegacyMaxBlurMix) {
    delete merged.maxBlurMix;
  } else if (hasLegacyMaxBlurMix && !hasCocScale) {
    delete merged.cocScale;
  }
  return merged;
}

// `mergeShadowOptions`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
function mergeShadowOptions(base, override = {}) {
  const merged = {
    ...base,
    ...override
  };
  merged.spot = {
    ...(base.spot ?? {}),
    ...(override.spot ?? {})
  };
  merged.directional = {
    ...(base.directional ?? {}),
    ...(override.directional ?? {})
  };
  return merged;
}

// 影の`type`を検証し、後続処理が扱える共通形式へ整える
function normalizeShadowType(value) {
  const type = String(value ?? "directional").trim().toLowerCase();
  if (type === "" || type === "directional") {
    return "directional";
  }
  if (type === "spot") {
    return "spot";
  }
  throw new Error(`ComputeEffectPipeline shadow.type must be 'directional' or 'spot', got "${value}"`);
}

// `degreesToCos`は座標または数値を計算し、後続処理で使う結果を返す
function degreesToCos(value, label) {
  const degrees = util.readFiniteNumber(value, label, { minExclusive: 0, maxExclusive: 180 });
  return Math.cos(degrees * Math.PI / 180.0);
}

function spotAngleValue(shadow, key) {
  return shadow?.spot?.[key] ?? DEFAULTS.shadow.spot[key];
}

// `directional`の`fit`のモードを現在の入力と状態から求め、呼び出し元へ返す
function resolveDirectionalFitMode(shadow, label) {
  return util.readOptionalEnum(
    shadow?.directional?.fitMode,
    `${label} shadow.directional.fitMode`,
    DEFAULTS.shadow.directional.fitMode,
    ["fixed", "frustum-fit"]
  );
}

export default class ComputeEffectPipeline {
  // Own the render targets and compute passes that make up this experiment.
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeEffectPipeline requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeEffectPipeline label",
      DEFAULTS.label,
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    this.shadowOptions = mergeShadowOptions(DEFAULTS.shadow, options.shadow);
    this.ssaoOptions = mergeOptions(DEFAULTS.ssao, options.ssao);
    this.ssrOptions = mergeOptions(DEFAULTS.ssr, options.ssr);
    this.composerOptions = mergeOptions(DEFAULTS.composer, options.composer);
    this.transparencyOptions = mergeOptions(DEFAULTS.transparency, options.transparency);
    this.fogOptions = mergeOptions(DEFAULTS.fog, options.fog);
    this.lightingOptions = mergeOptions(DEFAULTS.lighting, options.lighting);
    this.toneMapOptions = mergeOptions(DEFAULTS.toneMap, options.toneMap);
    this.dofOptions = mergeDofOptions(DEFAULTS.dof, options.dof);
    this.toonOptions = mergeOptions(DEFAULTS.toon, options.toon);
    this.bloomOptions = mergeOptions(DEFAULTS.bloom, options.bloom);
    this.edgeOptions = mergeOptions(DEFAULTS.edge, options.edge);
    this.vignetteOptions = mergeOptions(DEFAULTS.vignette, options.vignette);
    this.lightOptions = {
      direction: options.lightDirection ?? DEFAULTS.lightDirection,
      target: options.lightTarget ?? DEFAULTS.lightTarget,
      distance: options.lightDistance ?? DEFAULTS.lightDistance,
      halfWidth: options.lightHalfWidth ?? DEFAULTS.lightHalfWidth,
      halfHeight: options.lightHalfHeight ?? DEFAULTS.lightHalfHeight,
      near: options.lightNear ?? DEFAULTS.lightNear,
      far: options.lightFar ?? DEFAULTS.lightFar
    };
    this.light = createDirectionalLightMatrices(this.lightOptions);
    this.gbuffer = new GeometryBufferPass(gpu, {
      label: `${this.label}:gbuffer`,
      width: this.width,
      height: this.height,
      colorMode: "material",
      normalSpace: "view"
    });
    this.directionalShadowMap = new ShadowMapPass(gpu, {
      label: `${this.label}:shadow-map`,
      width: options.shadowMapSize ?? DEFAULTS.shadowMapSize,
      height: options.shadowMapSize ?? DEFAULTS.shadowMapSize
    });
    this.spotShadowMap = new SpotShadowMapPass(gpu, {
      label: `${this.label}:spot-shadow-map`,
      width: options.shadowMapSize ?? DEFAULTS.shadowMapSize,
      height: options.shadowMapSize ?? DEFAULTS.shadowMapSize
    });
    this.directionalShadowPass = new ComputeShadowPass(gpu, {
      label: `${this.label}:shadow-lighting`,
      width: this.width,
      height: this.height
    });
    this.spotShadowPass = new ComputeSpotShadowPass(gpu, {
      label: `${this.label}:spot-shadow-lighting`,
      width: this.width,
      height: this.height
    });
    this.ssaoPass = new SsaoPass(gpu, {
      label: `${this.label}:ssao`,
      width: this.width,
      height: this.height,
      ...this.ssaoOptions
    });
    this.deferredLightingPass = new DeferredLightingPass(gpu, {
      label: `${this.label}:deferred-lighting`,
      width: this.width,
      height: this.height,
      maxLights: options.maxLights ?? 128
    });
    this.ssrPass = new ComputeSsrPass(gpu, {
      label: `${this.label}:ssr`,
      width: this.width,
      height: this.height,
      ...this.ssrOptions
    });
    this.transparencyPass = new TransparencyPass(gpu, {
      label: `${this.label}:transparency`,
      width: this.width,
      height: this.height,
      ...this.transparencyOptions
    });
    this.fogPass = new ComputeFogPass(gpu, {
      label: `${this.label}:fog`,
      width: this.width,
      height: this.height
    });
    this.composer = new ComputeEffectComposer(gpu, {
      label: `${this.label}:composer`,
      width: this.width,
      height: this.height
    });
    this.toneMapPass = new ComputeEffectToneMapPass(gpu, {
      label: `${this.label}:tone-map`,
      width: this.width,
      height: this.height
    });
    this.dofPass = new ComputeDofPass(gpu, {
      label: `${this.label}:dof`,
      width: this.width,
      height: this.height
    });
    this.toonPass = new ComputeToonPass(gpu, {
      label: `${this.label}:toon`,
      width: this.width,
      height: this.height
    });
    this.bloomPass = new ComputeBloomPass(gpu, {
      label: `${this.label}:bloom`,
      width: this.width,
      height: this.height
    });
    this.edgePass = new ComputeEdgePass(gpu, {
      label: `${this.label}:edge`,
      width: this.width,
      height: this.height
    });
    this.vignettePass = new ComputeVignettePass(gpu, {
      label: `${this.label}:vignette`,
      width: this.width,
      height: this.height
    });
    this.ready = Promise.all([
      this.gbuffer.ready,
      this.directionalShadowMap.ready,
      this.spotShadowMap.ready,
      this.directionalShadowPass.ready,
      this.spotShadowPass.ready,
      this.ssaoPass.ready,
      this.deferredLightingPass.ready,
      this.ssrPass.ready,
      this.transparencyPass.ready,
      this.fogPass.ready,
      this.composer.ready,
      this.toneMapPass.ready,
      this.dofPass.ready,
      this.toonPass.ready,
      this.bloomPass.ready,
      this.edgePass.ready,
      this.vignettePass.ready
    ]);
    this.lastShadowType = normalizeShadowType(this.shadowOptions.type);
    this.currentShadowLight = this.light;
    this.currentCameraFrame = null;
    this.currentSpace = null;
    this.currentShadowEnabled = null;
    this.destroyed = false;
  }

  resolveShadowType(shadow = this.shadowOptions) {
    return normalizeShadowType(shadow.type);
  }

  // `directional`の光源を現在の入力と状態から求め、呼び出し元へ返す
  resolveDirectionalLight(shadow = this.shadowOptions, options = {}) {
    const directional = mergeOptions(DEFAULTS.shadow.directional, shadow.directional);
    const fitMode = resolveDirectionalFitMode(shadow, this.label);
    if (fitMode === "frustum-fit") {
      if (!options.cameraFrame || options.cameraFrame.depthConvention !== CAMERA_REVERSE_Z) {
        throw new Error(`${this.label} shadow.directional.fitMode "frustum-fit" requires a Reverse-Z CameraFrame in renderScene()`);
      }
      return createFrustumFitDirectionalLightMatrices({
        direction: this.lightOptions.direction,
        distance: this.lightOptions.distance,
        cameraFrame: options.cameraFrame,
        fitFar: directional.fitFar ?? undefined,
        xyPadding: directional.xyPadding,
        depthPadding: directional.depthPadding,
        minHalfExtent: directional.minHalfExtent,
        minNear: directional.minNear,
        texelSnap: directional.texelSnap,
        mapSize: this.directionalShadowMap.width,
        up: directional.up
      });
    }
    return createDirectionalLightMatrices({
      ...this.lightOptions,
      up: directional.up
    });
  }

  // `spot`の光源を現在の入力と状態から求め、呼び出し元へ返す
  resolveSpotLight(shadow = this.shadowOptions) {
    const spot = mergeOptions(DEFAULTS.shadow.spot, shadow.spot);
    return createSpotLightMatrices(spot);
  }

  // 影の状態を現在の入力と状態から求め、呼び出し元へ返す
  resolveShadowState(shadow = this.shadowOptions, options = {}) {
    const type = this.resolveShadowType(shadow);
    if (type === "spot") {
      const light = this.resolveSpotLight(shadow);
      return {
        type,
        light,
        shadowMap: this.spotShadowMap,
        shadowPass: this.spotShadowPass,
        passOptions: {
          lightPosition: light.position,
          lightDirection: light.direction,
          innerCos: shadow.innerCos ?? degreesToCos(spotAngleValue(shadow, "innerAngle"), "ComputeEffectPipeline shadow.spot.innerAngle"),
          outerCos: shadow.outerCos ?? degreesToCos(spotAngleValue(shadow, "outerAngle"), "ComputeEffectPipeline shadow.spot.outerAngle")
        }
      };
    }
    const light = this.resolveDirectionalLight(shadow, options);
    return {
      type,
      light,
      shadowMap: this.directionalShadowMap,
      shadowPass: this.directionalShadowPass,
      passOptions: {
        lightDirection: light.direction
      }
    };
  }

  // v2 Pipelineは常にCamera Frame共有のG-bufferとDeferred Shadingを使用します
  // forward互換経路を残さず、Shadow Map生成とGeometry Buffer生成を同じframe状態で記録します
  renderScene(space, cameraFrame, clearColor, options = {}) {
    this.requireAlive();
    if (!cameraFrame || cameraFrame.depthConvention !== CAMERA_REVERSE_Z) {
      throw new Error(`${this.label} renderScene requires a Reverse-Z CameraFrame`);
    }
    const shadow = mergeShadowOptions(this.shadowOptions, options.shadow);
    const shadowState = this.resolveShadowState(shadow, {
      cameraFrame
    });
    this.lastShadowType = shadowState.type;
    this.currentShadowLight = shadowState.light;
    this.currentShadowMap = shadowState.shadowMap;
    this.currentShadowPass = shadowState.shadowPass;
    this.currentShadowPassOptions = shadowState.passOptions;
    this.currentCameraFrame = cameraFrame;
    this.currentSpace = space;
    const shadowEnabled = util.readOptionalBoolean(
      options.shadowEnabled,
      `${this.label} shadowEnabled`,
      true
    );
    this.currentShadowEnabled = shadowEnabled;
    if (shadowEnabled) {
      shadowState.shadowMap.renderSpace(space, shadowState.light.viewProjection, {
        timestampWrites: options.shadowTimestampWrites
      });
    }
    return this.gbuffer.renderSpace(space, cameraFrame, clearColor, {
      materialResolver: options.materialResolver,
      timestampWrites: options.timestampWrites
    });
  }

  // Encode the compute effect chain and return the final color texture.
  encode(commandEncoder, options = {}) {
    this.requireAlive();
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== "function") {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const cameraFrame = options.cameraFrame;
    if (!cameraFrame || cameraFrame.depthConvention !== CAMERA_REVERSE_Z) {
      throw new Error(`${this.label} encode requires a Reverse-Z CameraFrame`);
    }
    if (cameraFrame !== this.currentCameraFrame) {
      throw new Error(
        `${this.label} encode CameraFrame must be the same snapshot used by renderScene`
      );
    }
    if (!this.currentSpace || typeof this.currentSpace.hasTranslucentTriangles !== "function") {
      throw new Error(`${this.label} encode requires the Space used by renderScene`);
    }
    const ssao = mergeOptions(this.ssaoOptions, options.ssao);
    const shadowEnabled = util.readOptionalBoolean(
      options.shadowEnabled,
      `${this.label} shadowEnabled`,
      true
    );
    const ssaoEnabled = util.readOptionalBoolean(
      options.ssaoEnabled,
      `${this.label} ssaoEnabled`,
      true
    );
    const ssrEnabled = util.readOptionalBoolean(
      options.ssrEnabled,
      `${this.label} ssrEnabled`,
      true
    );
    const shadow = mergeShadowOptions(this.shadowOptions, options.shadow);
    const ssr = mergeOptions(this.ssrOptions, options.ssr);
    const composer = mergeOptions(this.composerOptions, options.composer);
    const lighting = mergeOptions(this.lightingOptions, options.lighting);
    const toneMap = mergeOptions(this.toneMapOptions, options.toneMap);
    const fog = mergeOptions(this.fogOptions, options.fog);
    const dof = mergeDofOptions(this.dofOptions, options.dof);
    const toon = mergeOptions(this.toonOptions, options.toon);
    const bloom = mergeOptions(this.bloomOptions, options.bloom);
    const edge = mergeOptions(this.edgeOptions, options.edge);
    const vignette = mergeOptions(this.vignetteOptions, options.vignette);
    const dofEnabled = util.readOptionalBoolean(
      options.dofEnabled ?? dof.enabled,
      `${this.label} dofEnabled`,
      false
    );
    const fogEnabled = util.readOptionalBoolean(
      options.fogEnabled ?? fog.enabled,
      `${this.label} fogEnabled`,
      false
    );
    const toonEnabled = util.readOptionalBoolean(
      options.toonEnabled ?? toon.enabled,
      `${this.label} toonEnabled`,
      false
    );
    const bloomEnabled = util.readOptionalBoolean(
      options.bloomEnabled ?? bloom.enabled,
      `${this.label} bloomEnabled`,
      false
    );
    const edgeEnabled = util.readOptionalBoolean(
      options.edgeEnabled ?? edge.enabled,
      `${this.label} edgeEnabled`,
      false
    );
    const edgeGeometryEnabled = util.readOptionalBoolean(
      options.edgeGeometryEnabled ?? edge.geometryEnabled,
      `${this.label} edgeGeometryEnabled`,
      false
    );
    const vignetteEnabled = util.readOptionalBoolean(
      options.vignetteEnabled ?? vignette.enabled,
      `${this.label} vignetteEnabled`,
      false
    );
    const timestampWrites = options.timestampWrites;
    const firstComputeTimestampWrites = timestampWrites?.beginningOfPassWriteIndex !== undefined
      ? {
          querySet: timestampWrites.querySet,
          beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex
        }
      : undefined;
    const finalComputeTimestampWrites = timestampWrites?.endOfPassWriteIndex !== undefined
      ? {
          querySet: timestampWrites.querySet,
          endOfPassWriteIndex: timestampWrites.endOfPassWriteIndex
        }
      : undefined;
    const shadowType = this.resolveShadowType(shadow);
    if (shadowType !== this.lastShadowType) {
      throw new Error(
        `${this.label} renderScene/encode shadow type mismatch: `
        + `renderScene=${this.lastShadowType} encode=${shadowType}`
      );
    }
    if (shadowEnabled !== this.currentShadowEnabled) {
      throw new Error(
        `${this.label} renderScene/encode shadowEnabled mismatch: `
        + `renderScene=${this.currentShadowEnabled} encode=${shadowEnabled}`
      );
    }

    const resources = this.gbuffer.getBindingResources();
    const directionalLight = shadowType === "directional"
      ? (this.currentShadowLight ?? this.light)
      : this.light;
    const spotFallback = this.resolveSpotLight(shadow);
    const spotLight = shadowType === "spot"
      ? (this.currentShadowLight ?? spotFallback)
      : spotFallback;
    const directionalVisibility = this.directionalShadowPass.encode(
      commandEncoder,
      {
        ...resources,
        ...this.directionalShadowMap.getBindingResources()
      },
      {
        cameraFrame,
        lightViewProjection: directionalLight.viewProjection,
        lightDirection: directionalLight.direction,
        bias: shadow.bias,
        normalBias: shadow.normalBias,
        pcfRadius: shadow.pcfRadius,
        enabled: shadowEnabled && shadowType === "directional",
        timestampWrites: firstComputeTimestampWrites
      }
    );
    const spotVisibility = this.spotShadowPass.encode(
      commandEncoder,
      {
        ...resources,
        ...this.spotShadowMap.getBindingResources()
      },
      {
        cameraFrame,
        lightViewProjection: spotLight.viewProjection,
        lightPosition: spotLight.position,
        bias: shadow.bias,
        normalBias: shadow.normalBias,
        pcfRadius: shadow.pcfRadius,
        enabled: shadowEnabled && shadowType === "spot"
      }
    );
    const ambientOcclusion = this.ssaoPass.encode(
      commandEncoder,
      { normal: resources.normal, depth: resources.depth },
      {
        ...ssao,
        cameraFrame,
        enabled: ssaoEnabled
      }
    );
    let output = this.deferredLightingPass.encode(
      commandEncoder,
      {
        ...resources,
        shadowVisibility: directionalVisibility,
        spotShadowVisibility: spotVisibility,
        ambientOcclusion
      },
      {
        cameraFrame,
        directionalLight: shadowType === "directional" ? {
          direction: directionalLight.direction,
          color: lighting.directionalColor,
          intensity: lighting.directionalIntensity
        } : null,
        spotLight: shadowType === "spot" ? {
          position: spotLight.position,
          direction: spotLight.direction,
          color: lighting.spotColor,
          radius: spotLight.far,
          intensity: lighting.spotIntensity,
          innerCos: this.currentShadowPassOptions.innerCos,
          outerCos: this.currentShadowPassOptions.outerCos
        } : null,
        ambient: lighting.ambient,
        // Local Lightの公開type、World位置、World方向はDeferredLightingPassが一括検証・変換します
        // 統合pipelineは配列を書き換えず、利用者が指定したpoint / cone契約をそのまま渡します
        lights: options.lights ?? [],
        lightCount: options.lightCount,
        view: options.lightingView ?? "lighting"
      }
    );
    if (ssrEnabled) {
      const reflection = this.ssrPass.encode(commandEncoder, {
        scene: output,
        normal: resources.normal,
        material: resources.material,
        depth: resources.depth
      }, {
        ...ssr,
        cameraFrame,
        enabled: true,
        view: options.ssrView ?? "reflection"
      });
      output = this.composer.encode(commandEncoder, {
        base: output,
        reflection,
        depth: resources.depth
      }, {
        ...composer,
        timestampWrites: undefined
      });
    }
    // G-bufferへ書かなかった透明triangleをopaque scene colorへ合成してから、
    // Fog、Toon、DoF、Bloom、Tone Map、Edgeを適用し、透明部分も同じcolor effectの対象にする
    if (this.currentSpace.hasTranslucentTriangles()) {
      const transparencyLight = shadowType === "spot"
        ? [...cameraFrame.worldPointToView(spotLight.position), 1.0]
        : (() => {
            const direction = cameraFrame.viewRotationMatrix.mul3x3Vector(directionalLight.direction);
            // Deferred Lightingは光が進む方向を受け取り、SmoothShaderはsurfaceからlightへの方向を使う
            return [-direction[0], -direction[1], -direction[2], 0.0];
          })();
      output = this.transparencyPass.encode(commandEncoder, {
        scene: output,
        depth: resources.depth,
        space: this.currentSpace,
        cameraFrame,
        ambient: lighting.ambient,
        lightOverride: transparencyLight
      });
    }
    // Fogは透明合成済みHDR sceneへ一度だけ適用する。距離はG-bufferの不透明深度を使うため、
    // 透明surface自身の距離ではなく、そのpixelの背後にある不透明surfaceの距離で近似する。
    if (fogEnabled) {
      output = this.fogPass.encode(commandEncoder, {
        scene: output,
        depth: resources.depth
      }, {
        ...fog,
        enabled: true,
        cameraFrame,
        timestampWrites: undefined
      });
    }
    if (toonEnabled) {
      output = this.toonPass.encode(commandEncoder, output, {
        ...toon,
        enabled: true,
        timestampWrites: undefined
      });
    }
    if (dofEnabled) {
      output = this.dofPass.encode(commandEncoder, {
        scene: output,
        depth: resources.depth
      }, {
        ...dof,
        enabled: true,
        cameraFrame: options.cameraFrame,
        timestampWrites: undefined
      });
    }
    if (bloomEnabled) {
      output = this.bloomPass.encode(commandEncoder, output, {
        ...bloom,
        enabled: true,
        timestampWrites: undefined
      });
    }
    output = this.toneMapPass.encode(commandEncoder, {
      scene: output,
      depth: resources.depth
    }, {
      ...toneMap,
      timestampWrites: (edgeEnabled || vignetteEnabled) ? undefined : finalComputeTimestampWrites
    });
    if (edgeEnabled) {
      output = this.edgePass.encode(commandEncoder, output, {
        ...edge,
        enabled: true,
        geometryEnabled: edgeGeometryEnabled,
        normalWeight: edge.normalWeight ?? 1.35,
        depthWeight: edge.depthWeight ?? 1.10,
        ...(edgeGeometryEnabled ? {
          normal: resources.normal,
          depth: resources.depth,
          cameraFrame
        } : {}),
        timestampWrites: vignetteEnabled ? undefined : finalComputeTimestampWrites
      });
    }
    // VignetteはTone MapとEdgeを終えた表示色全体へ適用し、PresentationとHUDより前の
    // ComputeEffectPipeline最終出力として返す。
    if (vignetteEnabled) {
      output = this.vignettePass.encode(commandEncoder, output, {
        ...vignette,
        enabled: true,
        timestampWrites: finalComputeTimestampWrites
      });
    }
    return output;
  }

  // Resize screen-sized intermediate targets after canvas size changes.
  resize(width, height) {
    this.requireAlive();
    const nextWidth = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    const nextHeight = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    if (nextWidth === this.width && nextHeight === this.height) {
      return false;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.gbuffer.resize(this.width, this.height);
    this.directionalShadowPass.resize(this.width, this.height);
    this.spotShadowPass.resize(this.width, this.height);
    this.ssaoPass.resize(this.width, this.height);
    this.deferredLightingPass.resize(this.width, this.height);
    this.ssrPass.resize(this.width, this.height);
    this.transparencyPass.resize(this.width, this.height);
    this.fogPass.resize(this.width, this.height);
    this.composer.resize(this.width, this.height);
    this.toneMapPass.resize(this.width, this.height);
    this.dofPass.resize(this.width, this.height);
    this.toonPass.resize(this.width, this.height);
    this.bloomPass.resize(this.width, this.height);
    this.edgePass.resize(this.width, this.height);
    this.vignettePass.resize(this.width, this.height);
    return true;
  }

  // Expose the G-buffer while this class is still an experimental sample API.
  getBindingResources() {
    this.requireAlive();
    return this.gbuffer.getBindingResources();
  }

  // Prevent commands from touching destroyed GPU resources.
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // Release owned GPU resources in dependency order.
  destroy() {
    if (this.destroyed) return false;
    this.vignettePass.destroy();
    this.edgePass.destroy();
    this.bloomPass.destroy();
    this.toonPass.destroy();
    this.dofPass.destroy();
    this.toneMapPass.destroy();
    this.fogPass.destroy();
    this.composer.destroy();
    this.transparencyPass.destroy();
    this.ssrPass.destroy();
    this.deferredLightingPass.destroy();
    this.ssaoPass.destroy();
    this.spotShadowPass.destroy();
    this.directionalShadowPass.destroy();
    this.spotShadowMap.destroy();
    this.directionalShadowMap.destroy();
    this.gbuffer.destroy();
    this.destroyed = true;
    return true;
  }
}
