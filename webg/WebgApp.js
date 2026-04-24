// ---------------------------------------------
// WebgApp.js     2026/04/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Screen from "./Screen.js";
import Matrix from "./Matrix.js";
import Space from "./Space.js";
import Shape from "./Shape.js";
import Message from "./Message.js";
import UIPanel from "./UIPanel.js";
import DialogueOverlay from "./DialogueOverlay.js";
import InputController from "./InputController.js";
import Tween from "./Tween.js";
import ParticleEmitter from "./ParticleEmitter.js";
import SmoothShader from "./SmoothShader.js";
import Diagnostics from "./Diagnostics.js";
import DebugConfig from "./DebugConfig.js";
import DebugProbe from "./DebugProbe.js";
import ModelLoader from "./ModelLoader.js";
import SceneValidator from "./SceneValidator.js";
import SceneLoader from "./SceneLoader.js";
import DebugDock from "./DebugDock.js";
import FixedFormatPanel from "./FixedFormatPanel.js";
import EyeRig from "./EyeRig.js";
import util from "./util.js";
import { mergeUiTheme } from "./WebgUiTheme.js";

// WebgApp:
// - Screen / Shader / Space / Camera / Input / Message の初期化を1か所へ集約する
// - 生成AIが毎回同じ初期化コードを再構築しなくて済むようにする
// - diagnostics や panel を含む共通 app 基盤の入口になる
export default class WebgApp {
  // app 全体で共有する設定値と runtime state の入れ物を初期化する
  // ここでは GPU 初期化はまだ行わず、init() で使う材料だけを先にそろえる
  constructor(options = {}) {
    this.doc = options.document ?? document;
    this.shader = options.shader ?? null;
    this.shaderClass = options.shaderClass ?? SmoothShader;
    this.clearColor = [...(options.clearColor ?? [0.1, 0.15, 0.1, 1.0])];
    this.viewAngle = util.readOptionalFiniteNumber(options.viewAngle, "WebgApp viewAngle", 55.0);
    this.projectionNear = util.readOptionalFiniteNumber(options.projectionNear, "WebgApp projectionNear", 0.1);
    this.projectionFar = util.readOptionalFiniteNumber(options.projectionFar, "WebgApp projectionFar", 1000.0);
    this.lightPosition = [...(options.lightPosition ?? [120.0, 180.0, 140.0, 1.0])];
    // 既定では従来どおり eye space 固定 light を使うが、
    // world node を光源として使いたい場合は light.mode = "world-node" を指定できる
    this.light = {
      mode: options.light?.mode ?? "eye-fixed",
      nodeName: options.light?.nodeName ?? "light",
      position: [...(options.light?.position ?? this.lightPosition)],
      attitude: [...(options.light?.attitude ?? [0.0, 0.0, 0.0])],
      type: util.readOptionalFiniteNumber(options.light?.type, "WebgApp light.type", 1.0)
    };
    this.fog = {
      color: [...(options.fog?.color ?? this.clearColor)],
      near: util.readOptionalFiniteNumber(options.fog?.near, "WebgApp fog.near", 20.0),
      far: util.readOptionalFiniteNumber(options.fog?.far, "WebgApp fog.far", 80.0),
      density: util.readOptionalFiniteNumber(options.fog?.density, "WebgApp fog.density", 0.03),
      mode: util.readOptionalFiniteNumber(options.fog?.mode, "WebgApp fog.mode", 0.0)
    };
    this.setDefaultShapeShader = options.setDefaultShapeShader !== false;
    this.useMessage = options.useMessage !== false;
    this.messageFontTexture = options.messageFontTexture;
    this.messageScale = util.readOptionalFiniteNumber(options.messageScale, "WebgApp messageScale", 1.0);
    this.attachInputOnInit = options.attachInputOnInit !== false;
    this.autoDrawScene = options.autoDrawScene !== false;
    this.autoDrawBones = options.autoDrawBones === true;
    this.dialogue = null;
    this.scenePhase = options.scenePhase ?? null;
    this.gameHud = {
      score: null,
      combo: null,
      timer: null,
      toasts: [],
      toastLimit: util.readOptionalInteger(options.gameHud?.toastLimit, "WebgApp gameHud.toastLimit", 4, { min: 1 })
    };
    // 保存済み progress は WebgApp が名前空間を決めて扱い、
    // sample 側は save/load の中身だけに集中できるようにする
    this.progressStorage = options.progressStorage ?? null;
    this.progressStoragePrefix = String(options.progressStoragePrefix ?? "webg.progress");
    // 入力記録は frame 単位で積み、必要なら replay 用 snapshot として再利用する
    this.inputLog = [];
    this.tweens = [];
    this.particleEmitters = [];
    this.cameraShake = null;
    this.camera = {
      rigName: options.camera?.rigName ?? "camBase",
      rodName: options.camera?.rodName ?? "eyeRod",
      eyeName: options.camera?.eyeName ?? "eye",
      target: [...(options.camera?.target ?? [0.0, 0.0, 0.0])],
      distance: util.readOptionalFiniteNumber(options.camera?.distance, "WebgApp camera.distance", 28.0),
      head: util.readOptionalFiniteNumber(
        options.camera?.head,
        "WebgApp camera.head",
        0.0
      ),
      pitch: util.readOptionalFiniteNumber(options.camera?.pitch, "WebgApp camera.pitch", 0.0),
      bank: util.readOptionalFiniteNumber(options.camera?.bank, "WebgApp camera.bank", 0.0)
    };
    this.cameraFollow = {
      active: false,
      mode: "follow",
      targetNode: null,
      targetOffset: [...(options.camera?.targetOffset ?? [0.0, 0.0, 0.0])],
      currentTarget: [...this.camera.target],
      smooth: util.readOptionalFiniteNumber(options.camera?.smooth, "WebgApp camera.smooth", 0.15),
      inheritTargetHead: options.camera?.inheritTargetHead === true,
      targetHeadOffset: util.readOptionalFiniteNumber(
        options.camera?.targetHeadOffset,
        "WebgApp camera.targetHeadOffset",
        0.0
      )
    };
    this.fixedCanvasSize = this.normalizeFixedCanvasSize(options.fixedCanvasSize);
    this.layoutMode = this.normalizeLayoutMode(options.layoutMode);
    this.renderMode = this.normalizeRenderMode(options.renderMode);
    this.windowHasFocus = true;
    this.documentHasFocus = true;
    this.canvasHost = null;
    this.guideEntries = [];
    this.statusEntries = [];
    this.guideOptions = { x: 0, y: 0, color: [0.90, 0.95, 1.0] };
    this.statusOptions = { x: 0, y: 6, color: [1.0, 0.88, 0.72] };
    this.hudRows = [];
    this.hudRowsOptions = {
      x: 0,
      y: 0,
      color: [0.90, 0.95, 1.0],
      anchor: "top-left",
      offsetX: 0,
      offsetY: 0,
      gap: 1,
      align: "left",
      width: null,
      wrap: false,
      clip: false,
      minScale: 0.82
    };
    this.hudLayoutOffsets = {
      guideOffsetY: util.readOptionalFiniteNumber(options.hudLayoutOffsets?.guideOffsetY, "WebgApp hudLayoutOffsets.guideOffsetY", 0),
      statusOffsetY: util.readOptionalFiniteNumber(options.hudLayoutOffsets?.statusOffsetY, "WebgApp hudLayoutOffsets.statusOffsetY", 0),
      rowsOffsetY: util.readOptionalFiniteNumber(options.hudLayoutOffsets?.rowsOffsetY, "WebgApp hudLayoutOffsets.rowsOffsetY", 0)
    };
    this.screen = null;
    this.space = null;
    this.cameraRig = null;
    this.cameraRod = null;
    this.eye = null;
    this.eyeRig = null;
    this.eyeRigOptions = {
      update: false,
      syncCamera: false
    };
    this.lightNode = null;
    this.input = null;
    this.message = null;
    this.helpPanelUi = null;
    this.helpPanels = [];
    this.debugTools = {
      mode: options.debugTools?.mode ?? "debug",
      system: options.debugTools?.system ?? "app",
      source: options.debugTools?.source ?? "",
      guideLines: [...(options.debugTools?.guideLines ?? [])],
      guideOptions: { ...(options.debugTools?.guideOptions ?? {}) },
      probeDefaultAfterFrames: Number.isInteger(options.debugTools?.probeDefaultAfterFrames)
        ? Math.max(1, options.debugTools.probeDefaultAfterFrames)
        : 1
    };
    this.debugTools.capture = {
      labelPrefix: String(options.debugTools?.capture?.labelPrefix ?? this.debugTools.system),
      afterFrames: Number.isInteger(options.debugTools?.capture?.afterFrames)
        ? Math.max(1, options.debugTools.capture.afterFrames)
        : this.debugTools.probeDefaultAfterFrames,
      collect: typeof options.debugTools?.capture?.collect === "function"
        ? options.debugTools.capture.collect
        : null,
      onCaptured: typeof options.debugTools?.capture?.onCaptured === "function"
        ? options.debugTools.capture.onCaptured
        : null
    };
    this.debugTools.keyInput = {
      enabled: options.debugTools?.keyInput?.enabled !== false,
      prefixKey: String(options.debugTools?.keyInput?.prefixKey ?? "f9").toLowerCase(),
      waiting: false,
      status: "READY",
      commands: {
        copySummary: String(options.debugTools?.keyInput?.commands?.copySummary ?? "c").toLowerCase(),
        copyJson: String(options.debugTools?.keyInput?.commands?.copyJson ?? "v").toLowerCase(),
        toggleMode: String(options.debugTools?.keyInput?.commands?.toggleMode ?? "m").toLowerCase()
      }
    };
    this.uiTheme = mergeUiTheme(options.uiTheme ?? {});
    // debug dock / fixed-format panel は WebgApp の内部 detail ではなく、
    // ほかの app や editor でも再利用できる独立 component として保持する
    this.debugDock = new DebugDock({
      document: this.doc,
      theme: this.uiTheme.debugDock,
      ...options.debugDock,
      actions: {
        copySummary: () => this.runDebugKeyAction("copySummary"),
        copyJson: () => this.runDebugKeyAction("copyJson")
      }
    });
    this.projectionMatrix = null;
    this.running = false;
    this.lastFrameTime = 0.0;
    this.elapsedSec = 0.0;
    this.runtimeElapsedSec = 0.0;
    this._onViewportLayout = () => this.applyViewportLayout();
    // ondemand mode では page 可視状態と focus 状態を見て loop を pause / resume する
    // window focus/blur は内部 state として保持し、document.hasFocus() だけに依存しない
    this._onPageActivityChange = () => this.handlePageActivityChange();
    this._onWindowFocus = () => {
      this.windowHasFocus = true;
      this.handlePageActivityChange();
    };
    this._onWindowBlur = () => {
      this.windowHasFocus = false;
      this.handlePageActivityChange();
    };
    this._onDocumentFocusIn = () => {
      this.documentHasFocus = true;
      this.handlePageActivityChange();
    };
    this._onDocumentFocusOut = () => {
      const hasFocus = typeof this.doc?.hasFocus === "function"
        ? this.doc.hasFocus()
        : false;
      this.documentHasFocus = hasFocus;
      this.handlePageActivityChange();
    };
    this._frame = (timeMs) => this.frame(timeMs);
    this._frameScheduled = false;
    this.handlers = {
      onUpdate: null,
      onBeforeDraw: null,
      onAfterDraw3d: null,
      onAfterHud: null
    };
    this.diagnostics = null;
    this.diagnosticsCopyState = "READY";
    // 最新の runtime error / warning は diagnostics report と別に保持し、
    // report を差し替えても「最後に何が起きたか」を dock からすぐ追えるようにする
    this.latestRuntimeError = null;
    this.latestRuntimeWarning = null;
    this.debugProbe = null;
    this.debugProbeState = "IDLE";
    this.debugProbeFormat = "summary";
    this.currentDiagnosticsCache = {
      report: null,
      currentStateText: "",
      updatedAtMs: 0,
      intervalMs: 1000
    };
    this.fixedFormatPanels = new FixedFormatPanel({
      document: this.doc,
      theme: this.uiTheme.fixedFormatPanel,
      // fixed の DOM panel は canvas 外まで広がると sample の button を覆いやすいので、
      // 既定では canvas の矩形を基準にしつつ、dock 分の右余白も同時に避ける
      getDockOffset: () => this.isDebugDockActive()
        ? this.debugDock.reserveWidth + this.debugDock.gap + 12
        : 12,
      getContainerElement: () => this.getOverlayContainerElement(),
      getPositioningMode: () => this.getOverlayPositioningMode()
    });
    this.modelRuntime = null;
    this.sceneRuntime = null;
  }

  selectLayoutDimension(candidates, name) {
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (candidate.value === undefined || candidate.value === null) {
        continue;
      }
      if (!Number.isFinite(candidate.value) || Number(candidate.value) <= 0) {
        throw new Error(`WebgApp ${name} candidate "${candidate.label}" must be a positive finite number`);
      }
      return Math.floor(Number(candidate.value));
    }
    throw new Error(`WebgApp ${name} could not resolve a positive layout dimension`);
  }

  // fixedCanvasSize option を検証し、固定 canvas の寸法と DPR 方針を確定する
  // viewport 追従を止める時は曖昧な補正よりも明示的な設定が重要なので、不正値はここで error にする
  normalizeFixedCanvasSize(options) {
    if (options === undefined || options === null || options === false) {
      return null;
    }
    if (typeof options !== "object") {
      throw new Error("WebgApp fixedCanvasSize must be an object");
    }
    if (!Number.isFinite(options.width) || Number(options.width) <= 0) {
      throw new Error("WebgApp fixedCanvasSize.width must be a positive number");
    }
    if (!Number.isFinite(options.height) || Number(options.height) <= 0) {
      throw new Error("WebgApp fixedCanvasSize.height must be a positive number");
    }
    if (options.useDevicePixelRatio !== undefined
      && typeof options.useDevicePixelRatio !== "boolean") {
      throw new Error("WebgApp fixedCanvasSize.useDevicePixelRatio must be boolean");
    }
    return {
      width: Math.max(1, Math.floor(Number(options.width))),
      height: Math.max(1, Math.floor(Number(options.height))),
      useDevicePixelRatio: options.useDevicePixelRatio !== false
    };
  }

  // canvas と DOM overlay の配置モードを正規化する
  // 通常の viewport 全体表示と、教材ページへ埋め込む embedded 表示だけを受け付ける
  normalizeLayoutMode(value) {
    const mode = String(value ?? "viewport").trim().toLowerCase();
    if (mode === "" || mode === "viewport") {
      return "viewport";
    }
    if (mode === "embedded") {
      return "embedded";
    }
    throw new Error("WebgApp layoutMode must be 'viewport' or 'embedded'");
  }

  // 描画ループの実行方針を正規化する
  // continuous は従来どおり常時動作し、ondemand は page が active な間だけ動かす
  normalizeRenderMode(value) {
    const mode = String(value ?? "ondemand").trim().toLowerCase();
    if (mode === "" || mode === "ondemand") {
      return "ondemand";
    }
    if (mode === "continuous") {
      return "continuous";
    }
    throw new Error("WebgApp renderMode must be 'ondemand' or 'continuous'");
  }

  // canvas を文書フロー内へ埋め込む構成かどうかを返す
  isEmbeddedLayout() {
    return this.layoutMode === "embedded";
  }

  // embedded モードでは canvas を relative host で包み、
  // absolute overlay と touch controls を同じ矩形へ重ねられるようにする
  ensureCanvasHost() {
    if (!this.isEmbeddedLayout()) {
      return this.doc?.body ?? null;
    }
    if (this.canvasHost?.isConnected) {
      return this.canvasHost;
    }
    const canvas = this.screen?.canvas ?? this.doc?.getElementById?.("canvas") ?? null;
    const parent = canvas?.parentNode ?? null;
    if (!canvas || !parent) {
      return null;
    }
    if (parent instanceof HTMLElement && parent.dataset.webgEmbeddedCanvasHost === "1") {
      this.canvasHost = parent;
      return parent;
    }
    const host = this.doc.createElement("div");
    host.dataset.webgEmbeddedCanvasHost = "1";
    host.className = "webg-embedded-canvas-host";
    host.style.position = "relative";
    host.style.display = "block";
    host.style.boxSizing = "border-box";
    host.style.overflow = "visible";
    parent.insertBefore(host, canvas);
    host.appendChild(canvas);
    this.canvasHost = host;
    return host;
  }

  // embedded モードでは host の占有領域を canvas 表示サイズへ合わせ、
  // ページ本文内のスクロールと overlay の基準矩形を一致させる
  syncCanvasHostLayout(width, height) {
    if (!this.isEmbeddedLayout()) {
      return null;
    }
    const host = this.ensureCanvasHost();
    if (!host) {
      return null;
    }
    host.style.width = `${Math.max(1, Math.floor(width))}px`;
    host.style.height = `${Math.max(1, Math.floor(height))}px`;
    host.style.setProperty("--webg-canvas-right-inset", "0px");
    return host;
  }

  // DOM overlay の配置先 container を返す
  getOverlayContainerElement() {
    return this.isEmbeddedLayout()
      ? this.ensureCanvasHost()
      : (this.doc?.body ?? null);
  }

  // DOM overlay の position モードを返す
  getOverlayPositioningMode() {
    return this.isEmbeddedLayout() ? "absolute" : "fixed";
  }

  // overlay 群が幅と高さの判断に使う基準要素を返す
  getOverlayViewportElement() {
    return this.screen?.canvas ?? null;
  }

  // help panel / dialogue / fixed panel / touch controls 共通の配置 option を返す
  getOverlayLayoutOptions() {
    return {
      containerElement: this.getOverlayContainerElement(),
      positioningMode: this.getOverlayPositioningMode(),
      viewportElement: this.getOverlayViewportElement()
    };
  }

  // debug dock 用の右余白は viewport モードだけで使い、
  // embedded モードでは canvas 自体の固定幅を優先する
  getOverlayDockOffset() {
    if (this.isEmbeddedLayout()) {
      return 0;
    }
    return this.isDebugDockActive()
      ? (this.debugDock.reserveWidth + this.debugDock.gap + 12)
      : 0;
  }

  // 現在の Screen が持つ GPU wrapper を返す
  // sample 側は shape や postprocess を作る段階でこの入口だけ使えばよい
  getGL() {
    return this.screen.getGL();
  }

  // uiTheme は app 起動時だけでなく runtime でも差し替えられるようにし、
  // debug dock / fixed-format panel / UI panel を同じ preset へ寄せやすくする
  setUiTheme(theme = {}) {
    this.uiTheme = mergeUiTheme(theme ?? {});
    this.debugDock.setTheme(this.uiTheme.debugDock);
    this.fixedFormatPanels.setTheme(this.uiTheme.fixedFormatPanel);
    this.helpPanelUi?.setTheme?.(this.uiTheme.uiPanel);
    this.dialogue?.setTheme?.(this.uiTheme.uiPanel);
    this.syncAllHelpPanels();
    this.updateDebugDock();
    return this.uiTheme;
  }

  // Scene JSON の妥当性検証結果を返す
  validateScene(scene) {
    const validator = new SceneValidator();
    return validator.validate(scene);
  }

  // 起動状態と代表的な実装抜けを diagnostics report として返す
  checkEnvironment(options = {}) {
    const hasNavigatorGPU = typeof navigator !== "undefined" && !!navigator.gpu;
    const report = Diagnostics.createSuccessReport({
      system: options.system ?? this.debugTools.system ?? "app",
      source: options.source ?? this.debugTools.source ?? "",
      stage: options.stage ?? "environment-check"
    });
    const shapes = Array.isArray(options.shapes) ? options.shapes : [];
    const warnings = [];
    const details = [];
    const stats = {
      webgpuSupported: hasNavigatorGPU ? "yes" : "no",
      hasScreen: this.screen ? "yes" : "no",
      hasShader: this.shader ? "yes" : "no",
      hasProjection: this.projectionMatrix ? "yes" : "no",
      hasSpace: this.space ? "yes" : "no",
      hasEye: this.eye ? "yes" : "no",
      hasInput: this.input ? "yes" : "no",
      hasMessage: this.message ? "yes" : "no",
      hasFixedCanvasSize: this.fixedCanvasSize ? "yes" : "no",
      layoutMode: this.layoutMode,
      shapeCount: shapes.length
    };
    if (this.fixedCanvasSize) {
      stats.fixedCanvasWidth = this.fixedCanvasSize.width;
      stats.fixedCanvasHeight = this.fixedCanvasSize.height;
      stats.fixedCanvasUseDpr = this.fixedCanvasSize.useDevicePixelRatio ? "yes" : "no";
    }
    let skinnedShapeCount = 0;
    let missingWeightVertexCount = 0;
    let invalidWeightVertexCount = 0;
    let overflowJointVertexCount = 0;

    const canvas = this.doc?.getElementById?.("canvas") ?? null;
    if (!canvas) {
      warnings.push("canvas element #canvas is missing");
    } else {
      Diagnostics.mergeStats(report, {
        canvasWidth: canvas.width ?? 0,
        canvasHeight: canvas.height ?? 0
      });
    }
    if (!hasNavigatorGPU) {
      warnings.push("navigator.gpu is unavailable");
    }
    if (!this.screen) {
      warnings.push("Screen is not initialized");
    }
    if (!this.shader) {
      warnings.push("Shader is not initialized");
    }
    if (!this.projectionMatrix) {
      warnings.push("Projection matrix has not been set");
    }
    if (!this.space) {
      warnings.push("Space is not initialized");
    }
    if (!this.eye) {
      warnings.push("Eye node is not initialized");
    }
    if (this.screen && !this.message && this.useMessage !== false) {
      warnings.push("Message HUD is enabled by config but not initialized");
    }

    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      if (!shape) {
        warnings.push(`shape[${i}] is null or undefined`);
        continue;
      }
      const shapeName = shape.getName?.() ?? shape.name ?? `shape[${i}]`;
      const hasFinalBuffers = !!(shape.vertexBuffer || shape.vertexBuffer0 || shape.indexBuffer);
      if (!hasFinalBuffers) {
        warnings.push(`${shapeName}: Shape.endShape() has not finalized GPU buffers`);
      }
      const material = shape.getMaterial?.() ?? { params: shape.materialParams ?? {} };
      const params = material?.params ?? {};
      const hasTexture = !!params.texture;
      const hasNormalTexture = !!params.normal_texture;
      const usesTexture = Number(params.use_texture ?? 0) !== 0;
      const usesNormalMap = Number(params.use_normal_texture ?? params.use_normal_map ?? 0) !== 0;
      const hasSkeleton = shape.hasSkeleton === true;
      const skeleton = shape.getSkeleton?.() ?? shape.skeleton ?? null;
      if (hasTexture && !usesTexture) {
        warnings.push(`${shapeName}: texture is set but use_texture is 0`);
      }
      if (usesTexture && !hasTexture && !shape.texture) {
        warnings.push(`${shapeName}: use_texture is 1 but texture is missing`);
      }
      if (hasNormalTexture && !usesNormalMap) {
        warnings.push(`${shapeName}: normal_texture is set but normal map flag is 0`);
      }
      if (usesNormalMap && !hasNormalTexture) {
        warnings.push(`${shapeName}: use_normal_map is 1 but normal_texture is missing`);
      }
      if (hasSkeleton) {
        skinnedShapeCount += 1;
        if (!skeleton) {
          warnings.push(`${shapeName}: hasSkeleton is true but skeleton is missing`);
        } else {
          const boneCount = skeleton.getBoneCount?.() ?? skeleton.bones?.length ?? 0;
          const boneOrderCount = skeleton.getBoneOrder?.()?.length ?? skeleton.boneOrder?.length ?? 0;
          const maxBoneCount = skeleton.MAX_BONE ?? 0;
          if (boneCount <= 0) {
            warnings.push(`${shapeName}: skeleton has no bones`);
          }
          if (boneOrderCount > maxBoneCount && maxBoneCount > 0) {
            warnings.push(`${shapeName}: boneOrder (${boneOrderCount}) exceeds MAX_BONE (${maxBoneCount})`);
          }
          details.push(
            `${shapeName}: skeletonBones=${boneCount} boneOrder=${boneOrderCount} maxBone=${maxBoneCount}`
          );
        }

        // Shape.endShape() 直前の bindex/weight は CPU 側の生データなので、
        // self-check では各頂点の「重みがあるか」「合計が極端にずれていないか」「上限超過 joint だけで構成されていないか」を見る
        const bindex = Array.isArray(shape.bindex) ? shape.bindex : [];
        const weight = Array.isArray(shape.weight) ? shape.weight : [];
        const vertexCount = Number.isFinite(shape.vertexCount) ? shape.vertexCount : bindex.length;
        const maxBoneIndex = skeleton?.MAX_BONE ?? 0;
        let shapeMissingWeight = 0;
        let shapeInvalidWeight = 0;
        let shapeOverflowOnly = 0;
        for (let v = 0; v < vertexCount; v++) {
          const jointList = Array.isArray(bindex[v]) ? bindex[v] : [];
          const weightList = Array.isArray(weight[v]) ? weight[v] : [];
          if (jointList.length === 0 || weightList.length === 0) {
            shapeMissingWeight += 1;
            continue;
          }
          let sum = 0.0;
          let hasValidJoint = false;
          for (let k = 0; k < weightList.length; k++) {
            sum += Number(weightList[k] ?? 0.0);
          }
          for (let k = 0; k < jointList.length; k++) {
            const jointNo = Number(jointList[k]);
            if (Number.isFinite(jointNo) && jointNo >= 0 && (maxBoneIndex <= 0 || jointNo < maxBoneIndex)) {
              hasValidJoint = true;
              break;
            }
          }
          if (sum <= 0.0) {
            shapeMissingWeight += 1;
          } else if (Math.abs(1.0 - sum) > 0.05) {
            shapeInvalidWeight += 1;
          }
          if (!hasValidJoint) {
            shapeOverflowOnly += 1;
          }
        }
        missingWeightVertexCount += shapeMissingWeight;
        invalidWeightVertexCount += shapeInvalidWeight;
        overflowJointVertexCount += shapeOverflowOnly;
        if (shapeMissingWeight > 0) {
          warnings.push(`${shapeName}: ${shapeMissingWeight} vertices have no usable skin weights`);
        }
        if (shapeInvalidWeight > 0) {
          warnings.push(`${shapeName}: ${shapeInvalidWeight} vertices have weight sums outside tolerance`);
        }
        if (shapeOverflowOnly > 0) {
          warnings.push(`${shapeName}: ${shapeOverflowOnly} vertices reference only joints beyond MAX_BONE`);
        }
      }
      details.push(
        `${shapeName}: ended=${hasFinalBuffers ? "yes" : "no"} texture=${hasTexture ? "yes" : "no"} normalTexture=${hasNormalTexture ? "yes" : "no"} skeleton=${hasSkeleton ? "yes" : "no"}`
      );
    }

    Diagnostics.mergeStats(report, {
      skinnedShapeCount,
      missingWeightVertexCount,
      invalidWeightVertexCount,
      overflowJointVertexCount
    });
    Diagnostics.mergeStats(report, stats);
    for (let i = 0; i < details.length; i++) {
      Diagnostics.addDetail(report, details[i]);
    }
    for (let i = 0; i < warnings.length; i++) {
      Diagnostics.addWarning(report, warnings[i]);
    }
    if (warnings.length > 0) {
      report.ok = false;
    }
    return report;
  }

  // glTF / Collada / ModelAsset JSON を現在の app 上へ読み込む
  async loadModel(source, options = {}) {
    const loader = new ModelLoader(this);
    this.modelRuntime = await loader.load(source, options);
    return this.modelRuntime;
  }

  // eye space 固定の light を shader へ直接設定する
  setEyeLight(positionAndType = this.lightPosition) {
    this.light.mode = "eye-fixed";
    this.light.position = [...positionAndType];
    this.lightPosition = [...positionAndType];
    this.space?.setLight?.(null);
    this.lightNode = null;
    if (typeof this.shader?.setLightPosition === "function") {
      this.shader.setLightPosition(this.light.position);
    }
    return this.light.position;
  }

  // world 空間に置く light node を生成または更新する
  setWorldLight(options = {}) {
    this.light.mode = "world-node";
    if (options.nodeName !== undefined) {
      this.light.nodeName = options.nodeName;
    }
    if (options.position !== undefined) {
      this.light.position = [...options.position];
    }
    if (options.attitude !== undefined) {
      this.light.attitude = [...options.attitude];
    }
    if (options.type !== undefined) {
      this.light.type = Number(options.type);
    }
    if (!this.space) {
      return null;
    }
    if (!this.lightNode) {
      this.lightNode = this.space.addNode(null, this.light.nodeName);
    }
    this.lightNode.setPosition(...this.light.position.slice(0, 3));
    this.lightNode.setAttitude(...this.light.attitude.slice(0, 3));
    this.space.setLight(this.lightNode);
    this.space.setLightType(this.light.type);
    return this.lightNode;
  }

  // constructor で受けた light 設定を現在の app へ反映する
  applyLightConfig() {
    if (this.light.mode === "world-node") {
      this.setWorldLight(this.light);
    } else {
      this.setEyeLight(this.light.position);
    }
  }

  // Scene 全体の phase を設定する
  setScenePhase(phase, options = {}) {
    const nextPhase = String(phase ?? "").trim();
    if (!nextPhase) return null;
    this.scenePhase = nextPhase;
    return this.scenePhase;
  }

  // Scene 全体の phase を返す
  getScenePhase() {
    return this.scenePhase;
  }

  // 補間したい値を Tween として登録する
  // target は object でも array でもよく、color や vec3 をそのまま動かせる
  createTween(target, to, options = {}) {
    if (target === null || target === undefined) {
      return null;
    }
    const tween = new Tween(target, to, options);
    if (!this.tweens) {
      this.tweens = [];
    }
    if (tween.isFinished()) {
      return tween;
    }
    this.tweens.push(tween);
    return tween;
  }

  // 登録済み Tween を 1 frame 進める
  // 完了した Tween は配列から外し、次 frame 以降は更新しない
  updateTweens(deltaMs = 0) {
    if (!Array.isArray(this.tweens) || this.tweens.length === 0) {
      return 0;
    }
    const active = [];
    let updatedCount = 0;
    for (let i = 0; i < this.tweens.length; i++) {
      const tween = this.tweens[i];
      if (!tween || typeof tween.update !== "function") continue;
      const finished = tween.update(deltaMs);
      updatedCount += 1;
      if (!finished) {
        active.push(tween);
      }
    }
    this.tweens = active;
    return updatedCount;
  }

  // すべての Tween を止める
  clearTweens() {
    this.tweens = [];
  }

  // particle emitter を 1 つ作成し、WebgApp がまとめて更新/描画できるように登録する
  // GPU 初期化まで含めるので async にし、sample 側は await してから emit しやすくする
  async createParticleEmitter(options = {}) {
    if (!this.screen || !this.getGL?.()) {
      throw new Error("WebgApp must be initialized before creating a particle emitter");
    }
    const emitter = new ParticleEmitter(options);
    this.particleEmitters.push(emitter);
    await emitter.init(this.getGL());
    return emitter;
  }

  // 登録済み particle emitter を 1 frame 進める
  updateParticleEmitters(deltaMs = 0) {
    if (!Array.isArray(this.particleEmitters) || this.particleEmitters.length === 0) {
      return 0;
    }
    let updated = 0;
    for (let i = 0; i < this.particleEmitters.length; i++) {
      const emitter = this.particleEmitters[i];
      if (!emitter || typeof emitter.update !== "function") continue;
      emitter.update(deltaMs);
      updated++;
    }
    return updated;
  }

  // 登録済み particle emitter を現在の 3D scene の上へ描く
  drawParticleEmitters() {
    if (!Array.isArray(this.particleEmitters) || this.particleEmitters.length === 0) {
      return 0;
    }
    let drawn = 0;
    for (let i = 0; i < this.particleEmitters.length; i++) {
      const emitter = this.particleEmitters[i];
      if (!emitter || typeof emitter.draw !== "function") continue;
      const alive = emitter.draw(this.eye, this.projectionMatrix);
      if (alive > 0) {
        drawn++;
      }
    }
    return drawn;
  }

  // 登録済み particle emitter を全て消す
  clearParticleEmitters() {
    this.particleEmitters = [];
  }

  // camera を数フレームだけ揺らす
  // strength は number または vec3 を受け、duration が切れたら自動で止まる
  shakeCamera(options = {}) {
    const durationMs = util.readOptionalFiniteNumber(options.durationMs, "WebgApp.shakeCamera durationMs", 120, { min: 0 });
    if (durationMs <= 0) {
      this.cameraShake = null;
      return null;
    }
    const strength = Array.isArray(options.strength)
      ? (() => {
        if (options.strength.length === 0 || options.strength.length > 3) {
          throw new Error("WebgApp.shakeCamera strength array must have 1 to 3 elements");
        }
        const values = [...options.strength];
        for (let i = 0; i < values.length; i++) {
          values[i] = util.readOptionalFiniteNumber(values[i], `WebgApp.shakeCamera strength[${i}]`, undefined);
        }
        return values;
      })()
      : [
        util.readOptionalFiniteNumber(options.strength, "WebgApp.shakeCamera strength", 0.25),
        util.readOptionalFiniteNumber(
          options.strengthY,
          "WebgApp.shakeCamera strengthY",
          options.strength === undefined ? 0.25 : util.readOptionalFiniteNumber(options.strength, "WebgApp.shakeCamera strength", 0.25)
        ),
        util.readOptionalFiniteNumber(
          options.strengthZ,
          "WebgApp.shakeCamera strengthZ",
          options.strength === undefined ? 0.25 : util.readOptionalFiniteNumber(options.strength, "WebgApp.shakeCamera strength", 0.25)
        )
      ];
    while (strength.length < 3) {
      strength.push(strength.length === 0 ? 0.25 : strength[strength.length - 1]);
    }
    const envelope = String(options.envelope ?? "outQuad").toLowerCase();
    if (options.envelope !== undefined && !Tween.isKnownEasing(envelope)) {
      throw new Error(`WebgApp.shakeCamera envelope "${options.envelope}" is not supported`);
    }
    this.cameraShake = {
      startedAtMs: util.readOptionalFiniteNumber(options.nowMs, "WebgApp.shakeCamera nowMs", Date.now()),
      durationMs,
      frequency: util.readOptionalFiniteNumber(options.frequency, "WebgApp.shakeCamera frequency", 18.0, { min: 0 }),
      strength: [
        util.readOptionalFiniteNumber(strength[0], "WebgApp.shakeCamera strength[0]", 0.25),
        util.readOptionalFiniteNumber(strength[1], "WebgApp.shakeCamera strength[1]", 0.25),
        util.readOptionalFiniteNumber(strength[2], "WebgApp.shakeCamera strength[2]", 0.25)
      ],
      seed: util.readOptionalFiniteNumber(options.seed, "WebgApp.shakeCamera seed", 1.0),
      envelope
    };
    return { ...this.cameraShake, strength: [...this.cameraShake.strength] };
  }

  // cameraShake を現在時刻へ反映する
  // scene phase や tween の結果で camera.target が変わっても、最後にここで揺れを足す
  updateCameraEffects(nowMs = Date.now()) {
    if (!this.cameraRig || !Array.isArray(this.camera.target)) {
      return [0, 0, 0];
    }

    let offset = [0, 0, 0];
    const shake = this.cameraShake;
    if (shake) {
      const elapsedMs = Math.max(0, Number(nowMs) - shake.startedAtMs);
      if (elapsedMs >= shake.durationMs) {
        this.cameraShake = null;
      } else {
        const t = shake.durationMs > 0 ? (elapsedMs / shake.durationMs) : 1.0;
        const easing = Tween.resolveEasing(shake.envelope);
        const envelope = 1.0 - easing(Math.max(0.0, Math.min(1.0, t)));
        const sec = elapsedMs * 0.001;
        const phase = shake.seed * 12.345;
        const freq = shake.frequency;
        offset = [
          Math.sin(sec * freq * 2.17 + phase * 1.0) * shake.strength[0] * envelope,
          Math.sin(sec * freq * 2.57 + phase * 1.3) * shake.strength[1] * envelope,
          Math.sin(sec * freq * 2.93 + phase * 1.7) * shake.strength[2] * envelope
        ];
      }
    }

    this.cameraRig.setPosition(
      this.camera.target[0] + offset[0],
      this.camera.target[1] + offset[1],
      this.camera.target[2] + offset[2]
    );
    return offset;
  }

  // camera 追従の中心点を毎 frame 反映する
  // followNode() / lockOn() で登録した target を world position から拾い、
  // cameraRig の base 位置へ流し込む
  updateCameraTarget(deltaSec = 0, force = false) {
    const state = this.cameraFollow;
    if (!state?.active || !state.targetNode || !this.cameraRig) {
      return 0;
    }

    const world = typeof state.targetNode.getWorldPosition === "function"
      ? state.targetNode.getWorldPosition()
      : null;
    if (!Array.isArray(world) || world.length < 3) {
      return 0;
    }

    const desired = [
      Number(world[0]) + state.targetOffset[0],
      Number(world[1]) + state.targetOffset[1],
      Number(world[2]) + state.targetOffset[2]
    ];

    const dt = Number(deltaSec);
    const smooth = state.mode === "lock" ? 1.0 : Number(state.smooth);
    const t = force
      ? 1.0
      : (smooth <= 0.0
        ? 1.0
        : 1.0 - Math.pow(1.0 - smooth, dt * 60.0));

    if (!Array.isArray(state.currentTarget) || state.currentTarget.length < 3) {
      state.currentTarget = [...desired];
    } else {
      state.currentTarget[0] += (desired[0] - state.currentTarget[0]) * t;
      state.currentTarget[1] += (desired[1] - state.currentTarget[1]) * t;
      state.currentTarget[2] += (desired[2] - state.currentTarget[2]) * t;
    }

    this.camera.target[0] = state.currentTarget[0];
    this.camera.target[1] = state.currentTarget[1];
    this.camera.target[2] = state.currentTarget[2];
    this.cameraRig.setPosition(
      this.camera.target[0],
      this.camera.target[1],
      this.camera.target[2]
    );

    if (state.inheritTargetHead && typeof state.targetNode.getWorldAttitude === "function") {
      const attitude = state.targetNode.getWorldAttitude();
      if (Array.isArray(attitude) && attitude.length >= 3) {
        this.cameraRig.setAttitude(
          Number(attitude[0]) + state.targetHeadOffset,
          Number(attitude[1]),
          Number(attitude[2])
        );
      }
    }

    return [...this.camera.target];
  }

  // camera 追従先を登録する
  // follow は滑らかに追う用途、lock はほぼ即時に合わせる用途として使う
  followNode(node, options = {}) {
    this.cameraFollow.active = !!node;
    this.cameraFollow.mode = "follow";
    this.cameraFollow.targetNode = node ?? null;
    this.cameraFollow.targetOffset = [...(options.offset ?? options.targetOffset ?? this.cameraFollow.targetOffset ?? [0.0, 0.0, 0.0])];
    this.cameraFollow.smooth = util.readOptionalFiniteNumber(options.smooth, "WebgApp followNode.smooth", 0.15);
    this.cameraFollow.inheritTargetHead = options.inheritTargetHead === true;
    this.cameraFollow.targetHeadOffset = util.readOptionalFiniteNumber(
      options.targetHeadOffset,
      "WebgApp followNode.targetHeadOffset",
      0.0
    );
    if (this.cameraFollow.active) {
      this.updateCameraTarget(0.0, true);
    }
    return this.cameraFollow;
  }

  // lock-on は target へ素早く合わせる follow の特別版として扱う
  lockOn(target, options = {}) {
    this.cameraFollow.active = !!target;
    this.cameraFollow.mode = "lock";
    this.cameraFollow.targetNode = target ?? null;
    this.cameraFollow.targetOffset = [...(options.offset ?? options.targetOffset ?? [0.0, 0.0, 0.0])];
    this.cameraFollow.smooth = util.readOptionalFiniteNumber(options.smooth, "WebgApp lockOn.smooth", 1.0);
    this.cameraFollow.inheritTargetHead = options.inheritTargetHead === true;
    this.cameraFollow.targetHeadOffset = util.readOptionalFiniteNumber(
      options.targetHeadOffset,
      "WebgApp lockOn.targetHeadOffset",
      0.0
    );
    if (this.cameraFollow.active) {
      this.updateCameraTarget(0.0, true);
    }
    return this.cameraFollow;
  }

  // 追従中の target を解除して、camera を自由状態へ戻す
  clearCameraTarget() {
    this.cameraFollow.active = false;
    this.cameraFollow.mode = "follow";
    this.cameraFollow.targetNode = null;
    this.cameraFollow.inheritTargetHead = false;
    return null;
  }

  // 短い通知を game HUD の toast として出す
  // Message が無い場合は null を返して、sample 側が任意に分岐できるようにする
  flashMessage(text, options = {}) {
    if (!this.message || typeof this.message.pushToast !== "function") {
      return null;
    }
    return this.message.pushToast(text, options);
  }

  // 会話 / tutorial を DOM overlay へ重ねる helper を用意する
  createDialogue(options = {}) {
    if (!this.dialogue) {
      this.dialogue = new DialogueOverlay({
        document: this.doc,
        theme: this.uiTheme.uiPanel,
        ...this.getOverlayLayoutOptions(),
        // DialogueOverlay も canvas 基準の overlay として扱い、
        // viewport / embedded の違いを WebgApp 側の helper へ集約する
        getDockOffset: () => this.getOverlayDockOffset(),
        ...options
      });
    } else {
      this.dialogue.setLayout({
        ...this.getOverlayLayoutOptions(),
        ...options
      });
    }
    return this.dialogue;
  }

  // 会話 entry 群を受け取り、dialogue overlay の表示を開始する
  // sample 側は createDialogue() を意識せず、この入口だけで会話開始まで進められる
  startDialogue(entries = [], options = {}) {
    return this.createDialogue(options).start(entries, options);
  }

  // 現在表示中の会話を 1 段先へ進める
  // dialogue 未生成でも落ちないようにして、sample 側の分岐を減らす
  nextDialogue() {
    if (!this.dialogue) {
      return null;
    }
    return this.dialogue.next();
  }

  // choice 付き会話で選択肢 index を確定する
  // branch の結果は Dialogue 側へ委譲し、WebgApp は呼び出し口だけをそろえる
  chooseDialogue(index = 0) {
    if (!this.dialogue) {
      return null;
    }
    return this.dialogue.choose(index);
  }

  // 既存 queue の末尾へ会話 entry を追加する
  // tutorial の追記や後段の分岐会話をつなぐときに使う
  enqueueDialogue(entries = []) {
    return this.createDialogue().enqueue(entries);
  }

  // 本文ログだけを overlay へ追記する
  // gameplay を止めたくない report や inspection を受動表示したいときに使う
  logDialogue(entries = [], options = {}) {
    return this.createDialogue(options).appendLog(entries, options);
  }

  // 通常 sample の操作説明は bloom と同じ「畳める help panel」へ寄せる
  // 毎 sample で UIPanel の組み立てを繰り返さず、`lines` を渡すだけで
  // 左上の標準 panel を出せるようにする
  createHelpPanel(options = {}) {
    const uiPanels = this.getHelpPanelUi();
    const layout = uiPanels.createLayout({
      ...this.getOverlayLayoutOptions(),
      id: options.id ?? `helpOverlay${this.helpPanels.length + 1}`,
      leftWidth: options.leftWidth ?? "minmax(0, 340px)",
      rightWidth: options.rightWidth ?? "minmax(0, 0px)",
      gap: util.readOptionalFiniteNumber(options.gap, "WebgApp helpPanel.gap", 0),
      collapseWidth: util.readOptionalInteger(options.collapseWidth, "WebgApp helpPanel.collapseWidth", 760, { min: 1 }),
      compactWidth: util.readOptionalInteger(options.compactWidth, "WebgApp helpPanel.compactWidth", 560, { min: 1 }),
      top: options.top === undefined ? undefined : util.readOptionalInteger(options.top, "WebgApp helpPanel.top", undefined),
      left: options.left === undefined ? undefined : util.readOptionalInteger(options.left, "WebgApp helpPanel.left", undefined),
      right: options.right === undefined ? undefined : util.readOptionalInteger(options.right, "WebgApp helpPanel.right", undefined)
    });
    const column = options.column === "right" ? layout.right : layout.left;
    const panel = uiPanels.createPanel(column);
    const buttonRow = uiPanels.createButtonRow(panel);
    const toggleButton = uiPanels.createButton(buttonRow, {
      id: options.buttonId ?? `${options.id ?? "help"}Toggle`,
      text: "Hide Help"
    });
    const body = uiPanels.createGroup(panel);
    const textBlock = uiPanels.createTextBlock(body, {
      id: options.textId ?? `${options.id ?? "help"}Text`,
      text: "",
      code: options.code !== false
    });
    if (this.isEmbeddedLayout()) {
      const maxWidth = this.resolveHelpPanelEmbeddedMaxWidth(options);
      const wrap = column === layout.right ? layout.rightWrap : layout.leftWrap;
      // 教材ページへ埋め込む canvas では、help panel を畳んだときに
      // 枠だけが host 全幅へ広がると説明文の上に不自然な空白が残る
      // そのため embedded 時は panel だけでなく親 column も内容幅へ寄せ、
      // layout 全体が canvas 幅いっぱいへ伸びる挙動を避ける
      wrap.style.width = "fit-content";
      wrap.style.maxWidth = `min(calc(100% - 24px), ${maxWidth})`;
      column.style.width = "fit-content";
      column.style.maxWidth = "100%";
      column.style.alignItems = column === layout.right ? "flex-end" : "flex-start";
      panel.style.width = "fit-content";
      panel.style.maxWidth = `min(calc(100% - 24px), ${maxWidth})`;
      textBlock.style.maxWidth = "100%";
      textBlock.style.boxSizing = "border-box";
    }
    const helpPanel = {
      id: options.id ?? null,
      uiPanels,
      layout,
      panel,
      toggleButton,
      body,
      textBlock,
      visible: options.visible !== false,
      lines: []
    };
    toggleButton.addEventListener("click", () => {
      this.setHelpPanelVisible(helpPanel, !helpPanel.visible);
    });
    this.helpPanels.push(helpPanel);
    this.setHelpPanelLines(helpPanel, options.lines ?? []);
    this.setHelpPanelVisible(helpPanel, options.visible !== false);
    this.syncHelpPanelLayout(helpPanel);
    return helpPanel;
  }

  // embedded の help panel は host 全幅へ広がりすぎないほうが教材ページで扱いやすい
  // leftWidth から px の上限を読めるときはそれを使い、読めないときは既定の 340px を採用する
  resolveHelpPanelEmbeddedMaxWidth(options = {}) {
    if (typeof options.leftWidth === "string") {
      const matches = options.leftWidth.match(/(\d+)\s*px/g);
      if (matches && matches.length > 0) {
        const value = matches[matches.length - 1].match(/(\d+)/);
        if (value && Number.isFinite(Number(value[1]))) {
          return `${Math.max(120, Math.floor(Number(value[1])))}px`;
        }
      }
    }
    return "340px";
  }

  // help panel も UIPanel と同じ theme を共有し、
  // resize ごとに listener を増やさないよう instance は app ごとに 1 つだけ持つ
  getHelpPanelUi() {
    if (!this.helpPanelUi) {
      this.helpPanelUi = new UIPanel({
        document: this.doc,
        theme: this.uiTheme.uiPanel
      });
    } else {
      this.helpPanelUi.setTheme(this.uiTheme.uiPanel);
    }
    return this.helpPanelUi;
  }

  readHelpPanelLines(lines, methodName) {
    if (!Array.isArray(lines)) {
      throw new Error(`WebgApp.${methodName} requires lines to be an array`);
    }
    return lines.map((line) => String(line));
  }

  // help panel の本文は 1 行 1 操作を基本にし、
  // sample 側は行配列を渡すだけで panel text を更新できるようにする
  setHelpPanelLines(helpPanel, lines = []) {
    if (!helpPanel?.textBlock) {
      return [];
    }
    helpPanel.lines = this.readHelpPanelLines(lines, "setHelpPanelLines");
    helpPanel.textBlock.textContent = helpPanel.lines.join("\n");
    return [...helpPanel.lines];
  }

  // panel を畳んだ状態では `Show Help` button だけを残し、
  // 操作一覧が不要な間も再表示入口だけは失わないようにする
  setHelpPanelVisible(helpPanel, visible = true) {
    if (!helpPanel?.body || !helpPanel?.toggleButton) {
      return false;
    }
    helpPanel.visible = visible !== false;
    helpPanel.body.style.display = helpPanel.visible ? "" : "none";
    helpPanel.toggleButton.textContent = helpPanel.visible ? "Hide Help" : "Show Help";
    helpPanel.uiPanels.setButtonActive(helpPanel.toggleButton, helpPanel.visible);
    return helpPanel.visible;
  }

  // help panel は viewport 固定の DOM overlay なので、
  // debug dock 表示時は同じ右 inset を反映して canvas と重なりにくくする
  syncHelpPanelLayout(helpPanel) {
    if (!helpPanel?.layout || !helpPanel?.uiPanels) {
      return;
    }
    const dockOffset = this.isEmbeddedLayout()
      ? 0
      : (this.isDebugDockActive()
        ? (this.debugDock.reserveWidth + this.debugDock.gap)
        : 0);
    helpPanel.uiPanels.setDockOffset(helpPanel.layout, dockOffset);
    helpPanel.uiPanels.syncResponsiveLayout(helpPanel.layout);
  }

  // 複数の help panel を使う sample でも viewport 更新を 1 回で反映できるようにする
  syncAllHelpPanels() {
    for (let i = 0; i < this.helpPanels.length; i++) {
      this.syncHelpPanelLayout(this.helpPanels[i]);
    }
  }

  // sample 切替や UI 再構築で help panel を個別に片付けたいときの入口
  clearHelpPanel(helpPanel) {
    if (!helpPanel) {
      return false;
    }
    const index = this.helpPanels.indexOf(helpPanel);
    if (index >= 0) {
      this.helpPanels.splice(index, 1);
    }
    const layoutIndex = helpPanel.uiPanels?.layouts?.indexOf?.(helpPanel.layout) ?? -1;
    if (layoutIndex >= 0) {
      helpPanel.uiPanels.layouts.splice(layoutIndex, 1);
    }
    helpPanel.layout?.root?.remove?.();
    return true;
  }

  // app が管理する help panel をすべて閉じる
  clearAllHelpPanels() {
    const panels = [...this.helpPanels];
    for (let i = 0; i < panels.length; i++) {
      this.clearHelpPanel(panels[i]);
    }
  }

  // 現在の会話表示を消して queue も空に戻す
  // scene 遷移や title へ戻る段階で overlay を確実に片付けたいときに使う
  clearDialogue() {
    if (!this.dialogue) {
      return false;
    }
    this.dialogue.clear();
    return true;
  }

  // 現在の会話 state をそのまま返す
  // sample 側は speaker や choice 状態を HUD や diagnostics へ出すときに使える
  getDialogueState() {
    return this.dialogue?.getState() ?? null;
  }

  // action map を input controller へ委譲する
  registerActionMap(map = {}) {
    return this.input?.registerActionMap?.(map) ?? null;
  }

  // action 名から現在の押下状態を引く
  // key 名を直接見ずに gameplay ロジックを書くための最短入口として使う
  getAction(name) {
    return this.input?.getAction?.(name) ?? false;
  }

  // その frame で押した瞬間だけを取りたいときに使う
  // start / confirm / jump のような one-shot 操作を分けやすくする
  wasActionPressed(name) {
    return this.input?.wasActionPressed?.(name) ?? false;
  }

  // その frame で離した瞬間だけを取りたいときに使う
  // charge 解放や button release を個別に扱いたいときの入口にする
  wasActionReleased(name) {
    return this.input?.wasActionReleased?.(name) ?? false;
  }

  // 現在のシェーダへ共通 fog 設定を反映する
  setFog(options = {}) {
    if (options.color !== undefined) {
      this.fog.color = [...options.color];
    }
    if (options.near !== undefined) {
      this.fog.near = Number(options.near);
    }
    if (options.far !== undefined) {
      this.fog.far = Number(options.far);
    }
    if (options.density !== undefined) {
      this.fog.density = Number(options.density);
    }
    if (options.mode !== undefined) {
      this.fog.mode = Number(options.mode);
    }

    if (typeof this.shader?.setFogColor === "function") {
      this.shader.setFogColor(this.fog.color);
    }
    if (typeof this.shader?.setFogNear === "function") {
      this.shader.setFogNear(this.fog.near);
    }
    if (typeof this.shader?.setFogFar === "function") {
      this.shader.setFogFar(this.fog.far);
    }
    if (typeof this.shader?.setFogDensity === "function") {
      this.shader.setFogDensity(this.fog.density);
    }
    if (typeof this.shader?.setFogMode === "function") {
      this.shader.setFogMode(this.fog.mode);
    }
    return { ...this.fog, color: [...this.fog.color] };
  }

  // Scene JSON を現在の app 上へ読み込み、runtime を保持する
  async loadScene(scene) {
    const loader = new SceneLoader(this);
    this.sceneRuntime = await loader.build(scene);
    return this.sceneRuntime;
  }

  // Shape群全体のバウンディングサイズを集計する
  getShapeSize(shapes) {
    const size = {
      minx: 1.0e10, maxx: -1.0e10,
      miny: 1.0e10, maxy: -1.0e10,
      minz: 1.0e10, maxz: -1.0e10,
      centerx: 0.0, sizex: 0.0,
      centery: 0.0, sizey: 0.0,
      centerz: 0.0, sizez: 0.0,
      max: 0.0
    };
    const list = Array.isArray(shapes) ? shapes : [];
    for (let i = 0; i < list.length; i++) {
      const shape = list[i];
      const box = shape?.getBoundingBox?.();
      if (!box) continue;
      if (size.minx > box.minx) size.minx = box.minx;
      if (size.maxx < box.maxx) size.maxx = box.maxx;
      if (size.miny > box.miny) size.miny = box.miny;
      if (size.maxy < box.maxy) size.maxy = box.maxy;
      if (size.minz > box.minz) size.minz = box.minz;
      if (size.maxz < box.maxz) size.maxz = box.maxz;
    }
    size.centerx = (size.maxx + size.minx) * 0.5;
    size.sizex = size.maxx - size.minx;
    size.centery = (size.maxy + size.miny) * 0.5;
    size.sizey = size.maxy - size.miny;
    size.centerz = (size.maxz + size.minz) * 0.5;
    size.sizez = size.maxz - size.minz;
    size.max = Math.max(size.sizex, size.sizey, size.sizez);
    return size;
  }

  // 透視投影行列を作り、現在のシェーダへ設定する
  updateProjection(viewAngle = this.viewAngle) {
    const proj = new Matrix();
    const vfov = this.screen.getRecommendedFov(viewAngle);
    proj.makeProjectionMatrix(
      this.projectionNear,
      this.projectionFar,
      vfov,
      this.screen.getAspect()
    );
    this.projectionMatrix = proj;
    if (this.shader?.setProjectionMatrix) {
      this.shader.setProjectionMatrix(proj);
    }
    return proj;
  }

  // viewport 追従と projection 更新を1本化する
  applyViewportLayout() {
    this.syncDebugDockVisibility();
    const reservedWidth = !this.isEmbeddedLayout() && this.isDebugDockActive()
      ? this.debugDock.reserveWidth + this.debugDock.gap
      : 0;
    const hasFixedCanvasSize = !!this.fixedCanvasSize;
    const embeddedWidth = this.selectLayoutDimension([
      { value: this.screen?.displayWidth, label: "screen.displayWidth" },
      { value: this.screen?.requestedWidth, label: "screen.requestedWidth" },
      { value: this.screen?.canvas?.clientWidth, label: "screen.canvas.clientWidth" },
      { value: window.innerWidth, label: "window.innerWidth" }
    ], "embedded width");
    const embeddedHeight = this.selectLayoutDimension([
      { value: this.screen?.displayHeight, label: "screen.displayHeight" },
      { value: this.screen?.requestedHeight, label: "screen.requestedHeight" },
      { value: this.screen?.canvas?.clientHeight, label: "screen.canvas.clientHeight" },
      { value: 720, label: "defaultEmbeddedHeight" }
    ], "embedded height");
    const width = hasFixedCanvasSize
      ? this.fixedCanvasSize.width
      : (this.isEmbeddedLayout()
        ? embeddedWidth
        : Math.max(1, Math.floor(window.innerWidth - reservedWidth)));
    const height = hasFixedCanvasSize
      ? this.fixedCanvasSize.height
      : (this.isEmbeddedLayout()
        ? embeddedHeight
        : Math.max(1, Math.floor(window.innerHeight)));
    const canvasRightInset = hasFixedCanvasSize ? 0 : reservedWidth;
    // `position: fixed; inset: 0` の canvas では width を狭めるだけだと right: 0 が残り、
    // debug dock 領域の下まで canvas が伸びて見える
    // そのため WebgApp 管理の viewport 更新では、右端 offset も同時に反映して
    // HTML dock が canvas 外側の余白に来る見え方へそろえる
    if (this.screen?.canvas?.style) {
      if (this.isEmbeddedLayout()) {
        // sample 側の CSS で canvas が fixed 指定されていても、
        // embedded では本文フローへ戻して host の占有領域に収める
        this.screen.canvas.style.position = "relative";
        this.screen.canvas.style.left = "auto";
        this.screen.canvas.style.top = "auto";
        this.screen.canvas.style.right = "auto";
        this.screen.canvas.style.bottom = "auto";
      } else {
        // viewport モードでは canvas 自体の position は sample 側の CSS を尊重し、
        // WebgApp からは inset だけを与えて dock との重なりを避ける
        this.screen.canvas.style.removeProperty("position");
        this.screen.canvas.style.left = "0px";
        this.screen.canvas.style.top = "0px";
        this.screen.canvas.style.right = hasFixedCanvasSize ? "auto" : `${reservedWidth}px`;
        this.screen.canvas.style.bottom = hasFixedCanvasSize ? "auto" : "0px";
      }
    }
    // canvas の外形だけでなく、viewport 固定の DOM overlay も同じ右 inset を参照できるようにし、
    // minimap や touch button を canvas 上の表示領域へそろえる
    if (this.doc?.documentElement?.style) {
      this.doc.documentElement.style.setProperty("--webg-canvas-right-inset", `${canvasRightInset}px`);
    }
    if (this.doc?.body?.style) {
      this.doc.body.style.setProperty("--webg-canvas-right-inset", `${canvasRightInset}px`);
    }
    this.dialogue?.syncLayout?.();
    this.syncAllHelpPanels();
    this.screen.resize(width, height);
    this.syncCanvasHostLayout(this.screen.displayWidth, this.screen.displayHeight);
    this.updateProjection(this.viewAngle);
    this.updateDebugDock();
  }

  // 視線回転用の親 node、rod node、視点 node を作成し、標準 rig 構成として初期化する
  // この rig は convenience であり、本質 API は Space.setEye(node)
  createCameraRig() {
    this.cameraRig = this.space.addNode(null, this.camera.rigName);
    this.cameraRig.setPosition(...this.camera.target);
    this.cameraRig.setAttitude(this.camera.head, this.camera.pitch, this.camera.bank);
    this.cameraRod = this.space.addNode(this.cameraRig, this.camera.rodName);
    this.cameraRod.setPosition(0.0, 0.0, 0.0);
    this.cameraRod.setAttitude(0.0, 0.0, 0.0);
    this.eye = this.space.addNode(this.cameraRod, this.camera.eyeName);
    this.eye.setPosition(0.0, 0.0, this.camera.distance);
    this.eye.setAttitude(0.0, 0.0, 0.0);
    this.space.setEye(this.eye);
  }

  // orbit camera の既定キーバインディングを 1 か所へまとめる
  // createOrbitEyeRig() ではこの既定値に対して差分 override を適用する
  getDefaultOrbitEyeRigBindings() {
    return {
      keyMap: {
        left: "arrowleft",
        right: "arrowright",
        up: "arrowup",
        down: "arrowdown",
        zoomIn: "[",
        zoomOut: "]"
      },
      panModifierKey: "shift"
    };
  }

  // WebgApp 標準 cameraRig 上へ orbit 用 EyeRig を作成する
  // 返した EyeRig は WebgApp が frame ごとに update と camera state 同期を行うため、
  // sample 側で orbit.update(deltaSec) や app.camera.target への手動コピーを書く必要がない
  createOrbitEyeRig(options = {}) {
    if (!this.cameraRig || !this.cameraRod || !this.eye) {
      throw new Error("WebgApp.createOrbitEyeRig() requires app.init() to create camera nodes first");
    }
    if (!this.input) {
      throw new Error("WebgApp.createOrbitEyeRig() requires an InputController");
    }

    const attachPointer = options.attachPointer !== false;
    const update = options.update !== false;
    const syncCamera = options.syncCamera !== false;
    const element = options.element ?? this.screen?.canvas ?? null;
    const input = options.input ?? this.input;
    const defaultBindings = this.getDefaultOrbitEyeRigBindings();
    const orbitKeyMap = {
      ...defaultBindings.keyMap,
      ...(options.orbit?.keyMap ?? {}),
      ...(options.orbitKeyMap ?? {})
    };
    const panModifierKey = options.panModifierKey
      ?? options.orbit?.panModifierKey
      ?? defaultBindings.panModifierKey;
    const orbitOptions = {
      ...options,
      ...(options.orbit ?? {}),
      target: options.target ?? options.orbit?.target ?? [...this.camera.target],
      distance: options.distance ?? options.orbit?.distance ?? this.camera.distance,
      head: options.head ?? options.orbit?.head ?? this.camera.head,
      pitch: options.pitch ?? options.orbit?.pitch ?? this.camera.pitch,
      bank: options.bank ?? options.orbit?.bank ?? this.camera.bank,
      keyMap: orbitKeyMap,
      panModifierKey
    };

    if (this.eyeRig?.detachPointer) {
      this.eyeRig.detachPointer();
    }
    this.eyeRig = new EyeRig(this.cameraRig, this.cameraRod, this.eye, {
      document: this.doc,
      element,
      input,
      type: "orbit",
      dragButton: options.dragButton ?? 0,
      orbit: orbitOptions
    });
    this.eyeRigOptions = {
      update,
      syncCamera
    };
    if (attachPointer) {
      this.eyeRig.attachPointer(element);
    }
    this.syncCameraFromEyeRig(this.eyeRig);
    return this.eyeRig;
  }

  // EyeRig の orbit state を WebgApp の camera state へ同期する
  // WebgApp は camera effect の反映時に app.camera.target を cameraRig へ流すため、
  // EyeRig が target を動かした後はこの同期を標準経路として挟む
  syncCameraFromEyeRig(eyeRig = this.eyeRig) {
    if (!eyeRig?.orbit) {
      throw new Error("WebgApp.syncCameraFromEyeRig() requires an EyeRig with orbit state");
    }
    this.camera.target[0] = eyeRig.orbit.target[0];
    this.camera.target[1] = eyeRig.orbit.target[1];
    this.camera.target[2] = eyeRig.orbit.target[2];
    this.camera.distance = eyeRig.orbit.distance;
    this.camera.head = eyeRig.orbit.head;
    this.camera.pitch = eyeRig.orbit.pitch;
    this.camera.bank = eyeRig.orbit.bank;
    return this.camera;
  }

  // frame loop 内で WebgApp 管理の EyeRig を進める
  // sync は update しない設定でも行えるよう分離し、外部から setTarget() した場合も camera へ反映する
  updateManagedEyeRig(deltaSec) {
    if (!this.eyeRig) {
      return false;
    }
    if (this.eyeRigOptions.update) {
      this.eyeRig.update(deltaSec);
    }
    if (this.eyeRigOptions.syncCamera) {
      this.syncCameraFromEyeRig(this.eyeRig);
    }
    return true;
  }

  // Screen、shader、camera rig、input、HUD、debug tools をまとめて起動する
  // sample 側はこの 1 回で標準 app 形の土台をそろえ、その後に scene 構築へ進む
  async init() {
    DebugConfig.setMode(this.debugTools.mode);
    this.resetDiagnostics("init");
    this.debugProbe = new DebugProbe({
      defaultAfterFrames: this.debugTools.probeDefaultAfterFrames
    });
    this.screen = new Screen(this.doc);
    await this.screen.ready;
    this.screen.setClearColor(this.clearColor);
    this.ensureCanvasHost();
    if (this.fixedCanvasSize) {
      // 固定サイズ app では viewport 幅に追従せず、constructor の指定値を描画基準にする
      // DPR を掛けるかどうかもここで確定し、比較用途で毎回同じ内部サイズを得られるようにする
      this.screen.fitToViewport = false;
      this.screen.useDevicePixelRatio = this.fixedCanvasSize.useDevicePixelRatio;
    }

    if (!this.shader) {
      this.shader = new this.shaderClass(this.screen.getGL());
    }
    if (typeof this.shader.init === "function") {
      await this.shader.init();
    }
    if (this.setDefaultShapeShader) {
      Shape.prototype.shader = this.shader;
    }
    this.space = new Space();
    this.createCameraRig();
    this.applyLightConfig();
    this.setFog(this.fog);
    this.applyViewportLayout();
    window.addEventListener("resize", this._onViewportLayout);
    window.addEventListener("orientationchange", this._onViewportLayout);
    this.windowHasFocus = typeof this.doc?.hasFocus === "function"
      ? this.doc.hasFocus()
      : true;
    this.documentHasFocus = this.windowHasFocus;
    this.doc?.addEventListener?.("visibilitychange", this._onPageActivityChange);
    this.doc?.addEventListener?.("focusin", this._onDocumentFocusIn, true);
    this.doc?.addEventListener?.("focusout", this._onDocumentFocusOut, true);
    window.addEventListener("focus", this._onWindowFocus);
    window.addEventListener("blur", this._onWindowBlur);

    this.input = new InputController(this.doc);
    // keyboard は document 全体で受けるが、pointer の既定抑止は canvas 内だけに絞る
    // これにより説明文や panel の text selection を妨げずに、canvas 上の drag 操作だけ保護できる
    this.input.setPointerPreventDefaultElement(this.screen.canvas);
    this.input.setTouchLayoutOptions(this.getOverlayLayoutOptions());
    if (this.attachInputOnInit) {
      // 自動 attach の経路でも WebgApp 共通の debug key 処理を通し、
      // sample 側が独自 handler を付けなくても F9+m で mode 切替できるようにする
      this.attachInput();
    }

    if (this.useMessage) {
      this.message = new Message(this.screen.getGL());
      await this.message.init(this.messageFontTexture);
      this.message.shader.setScale(this.messageScale);
    }

    // 起動直後の app 構成は diagnostics の標準入力として自動採取し、
    // sample 側が環境情報を毎回手で積まなくても最低限の状態を共有できるようにする
    this.setDiagnosticsReport(this.checkEnvironment({
      stage: "ready"
    }));
    this.syncDebugDockVisibility();
    this.updateDebugDock();
    return this;
  }

  // diagnostics 用 prefix key を sample 側へ流さず、WebgApp 側でまとめて処理する
  // 入力ハンドラを差し替えつつ lower-case 規約を維持する
  attachInput(handlers = {}) {
    const wrappedHandlers = {
      ...handlers,
      onKeyDown: (key, ev) => {
        if (this.handleDebugKeyInput(key, ev)) {
          return;
        }
        if (handlers.onKeyDown) {
          handlers.onKeyDown(key, ev);
        }
      }
    };
    this.input.attach(wrappedHandlers);
    return this.input;
  }

  // diagnostics key 入力の prefix / command をまとめて設定する
  configureDebugKeyInput(options = {}) {
    const keyInput = this.debugTools.keyInput;
    if (typeof options.enabled === "boolean") {
      keyInput.enabled = options.enabled;
    }
    if (typeof options.prefixKey === "string" && options.prefixKey.trim() !== "") {
      keyInput.prefixKey = options.prefixKey.toLowerCase();
    }
    if (options.commands) {
      const commandNames = Object.keys(keyInput.commands);
      for (let i = 0; i < commandNames.length; i++) {
        const name = commandNames[i];
        if (typeof options.commands[name] === "string" && options.commands[name]) {
          keyInput.commands[name] = options.commands[name].toLowerCase();
        }
      }
    }
    keyInput.waiting = false;
    keyInput.status = keyInput.enabled ? "READY" : "DISABLED";
  }

  // diagnostics snapshot の採取方法を sample 側から 1 回だけ登録する
  // sample は「何を report に入れるか」だけ渡し、copy / key 配線は WebgApp 側へ寄せる
  configureDiagnosticsCapture(options = {}) {
    if (typeof options.collect === "function") {
      this.debugTools.capture.collect = options.collect;
    }
    if (typeof options.onCaptured === "function") {
      this.debugTools.capture.onCaptured = options.onCaptured;
    }
    if (typeof options.labelPrefix === "string" && options.labelPrefix.trim() !== "") {
      this.debugTools.capture.labelPrefix = options.labelPrefix;
    }
    if (Number.isInteger(options.afterFrames)) {
      this.debugTools.capture.afterFrames = Math.max(1, options.afterFrames);
    }
    return this.debugTools.capture;
  }

  // sample 側 guide や文書で使いやすい diagnostics prefix label を返す
  getDebugKeyPrefixLabel() {
    return String(this.debugTools.keyInput?.prefixKey ?? "f9").toUpperCase();
  }

  // diagnostics command をまとめて説明する既定 guide 行を返す
  getDebugKeyGuideLines() {
    const prefix = this.getDebugKeyPrefixLabel();
    const commands = this.debugTools.keyInput?.commands ?? {};
    return [
      `[${prefix}] then [${String(commands.copySummary ?? "c").toUpperCase()}]/[${String(commands.copyJson ?? "v").toUpperCase()}] copy summary/json`,
      `[${prefix}] then [${String(commands.toggleMode ?? "m").toUpperCase()}] debug/release`
    ];
  }

  // diagnostics prefix 待機状態と command 実行を管理し、sample 側キー処理との混在を避ける
  handleDebugKeyInput(key, ev) {
    const keyInput = this.debugTools.keyInput;
    if (!keyInput) return false;
    const normalizedKey = String(key ?? "").toLowerCase();
    if (!normalizedKey) return false;
    const prefixKey = String(keyInput.prefixKey ?? "f9").toLowerCase();
    const toggleModeKey = String(keyInput.commands?.toggleMode ?? "m").toLowerCase();
    const modeToggleOnly = keyInput.enabled !== true;
    if (ev?.repeat) {
      if (keyInput.waiting || normalizedKey === prefixKey) {
        ev.preventDefault?.();
        return true;
      }
      return false;
    }
    if (normalizedKey === prefixKey) {
      keyInput.waiting = true;
      keyInput.status = modeToggleOnly ? "WAIT MODE" : "WAIT COMMAND";
      this.diagnosticsCopyState = `DEBUG KEY ${this.getDebugKeyPrefixLabel()}`;
      ev?.preventDefault?.();
      return true;
    }
    if (!keyInput.waiting) {
      return false;
    }
    keyInput.waiting = false;
    ev?.preventDefault?.();
    if (normalizedKey === "escape") {
      keyInput.status = "CANCELLED";
      this.diagnosticsCopyState = "DEBUG KEY CANCELLED";
      return true;
    }
    if (modeToggleOnly) {
      if (normalizedKey === toggleModeKey) {
        this.runDebugKeyAction("toggleMode");
        return true;
      }
      keyInput.status = `MODE ONLY ${normalizedKey}`;
      this.diagnosticsCopyState = `DEBUG KEY MODE ONLY ${normalizedKey}`;
      return true;
    }
    const action = this.resolveDebugKeyAction(normalizedKey);
    if (!action) {
      keyInput.status = `UNKNOWN ${normalizedKey}`;
      this.diagnosticsCopyState = `DEBUG KEY UNKNOWN ${normalizedKey}`;
      return true;
    }
    this.runDebugKeyAction(action);
    return true;
  }

  // command key から diagnostics action 名へ変換する
  resolveDebugKeyAction(key) {
    const commands = this.debugTools.keyInput?.commands ?? {};
    const names = Object.keys(commands);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (commands[name] === key) {
        return name;
      }
    }
    return null;
  }

  // diagnostics action を WebgApp 共通 API または sample 登録 callback へ流す
  runDebugKeyAction(action) {
    const keyInput = this.debugTools.keyInput;
    switch (action) {
      case "copySummary":
        keyInput.status = "COPY SUMMARY";
        void this.copyDiagnosticsSummary();
        break;
      case "copyJson":
        keyInput.status = "COPY JSON";
        void this.copyDiagnosticsReportJSON();
        break;
      case "toggleMode": {
        const mode = this.toggleDebugMode();
        keyInput.status = `MODE ${mode.toUpperCase()}`;
        this.diagnosticsCopyState = mode === "debug" ? "MODE DEBUG" : "MODE RELEASE";
        break;
      }
      default:
        keyInput.status = `UNHANDLED ${action}`;
        break;
    }
  }

  // ガイド文は主に固定の操作説明を置くためのブロックとして使う
  setGuideLines(lines, options = {}) {
    const x = this.readHudNumber(options.x === undefined ? 0 : options.x, "setGuideLines", "options.x");
    const y = this.readHudNumber(options.y === undefined ? 0 : options.y, "setGuideLines", "options.y");
    const color = this.readHudColor(options.color, "setGuideLines", [0.90, 0.95, 1.0]);
    const normalizedLines = this.readHudLines(lines, "setGuideLines");
    this.guideOptions = {
      x,
      y,
      color,
      anchor: options.anchor,
      offsetX: options.offsetX,
      offsetY: options.offsetY,
      gap: options.gap,
      align: options.align,
      width: options.width,
      wrap: options.wrap,
      clip: options.clip
    };
    this.guideEntries = normalizedLines.map((line, index) => ({
      x,
      y: y + index,
      text: line,
      color
    }));
    this.updateDebugDock();
  }

  // ステータス文は guide とは別ブロックで毎フレーム更新しやすくする
  setStatusLines(lines, options = {}) {
    const x = this.readHudNumber(options.x === undefined ? 0 : options.x, "setStatusLines", "options.x");
    const y = this.readHudNumber(options.y === undefined ? 6 : options.y, "setStatusLines", "options.y");
    const color = this.readHudColor(options.color, "setStatusLines", [1.0, 0.88, 0.72]);
    const normalizedLines = this.readHudLines(lines, "setStatusLines");
    this.statusOptions = {
      x,
      y,
      color,
      anchor: options.anchor,
      offsetX: options.offsetX,
      offsetY: options.offsetY,
      gap: options.gap,
      align: options.align,
      width: options.width,
      wrap: options.wrap,
      clip: options.clip
    };
    this.statusEntries = normalizedLines.map((line, index) => ({
      x,
      y: y + index,
      text: line,
      color
    }));
    this.updateDebugDock();
  }

  // status block を空にして、guide や scene 自体は残したまま状態表示だけ消す
  // phase 遷移で一時的に status を差し替えたいときの基本操作にする
  clearStatusLines() {
    this.statusEntries = [];
    this.updateDebugDock();
  }

  // canvas HUD を「1 行 1 parameter」形式で組みたい場合の構造化 row を設定する
  // sample 側では dock 用 row と同じ配列を渡し、表示媒体に応じた整形だけを WebgApp 側へ任せられる
  setHudRows(rows = [], options = {}) {
    if (!Array.isArray(rows)) {
      throw new Error("WebgApp.setHudRows requires rows to be an array");
    }
    this.hudRows = rows.map((row, index) => this.readHudRow(row, index, "setHudRows"));
    this.hudRowsOptions = {
      ...this.hudRowsOptions,
      ...options
    };
  }

  // 構造化 HUD row をまとめて消し、canvas HUD の parameter 表示を初期化する
  // dock 側を残したいかどうかは clearControlRows() と使い分ける
  clearHudRows() {
    this.hudRows = [];
  }

  // sample が同じ row 配列を canvas HUD と HTML debug dock の両方へ流したいときの共通入口
  // 表示媒体ごとの整形差は WebgApp 側へ集約し、sample 側は row 定義だけを保守すればよくする
  setControlRows(rows = [], options = {}) {
    this.setDebugDockRows(rows);
    this.setHudRows(rows, options);
  }

  // canvas HUD と debug dock の row を同時に消す
  // sample 切替や view mode 変更で row 表示を一掃したいときに使う
  clearControlRows() {
    this.clearDebugDockRows();
    this.clearHudRows();
  }

  // ゲーム HUD の共通状態を初期化する
  clearGameHud() {
    this.gameHud.score = null;
    this.gameHud.combo = null;
    this.gameHud.timer = null;
    this.gameHud.toasts = [];
  }

  readHudNumber(value, methodName, name) {
    if (!Number.isFinite(value)) {
      throw new Error(`WebgApp.${methodName} requires finite ${name}`);
    }
    return Number(value);
  }

  readHudOptionalInt(value, methodName, name, fallback) {
    if (value === undefined) {
      return fallback;
    }
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`WebgApp.${methodName} requires integer ${name}`);
    }
    return Number(value);
  }

  readHudLines(lines, methodName) {
    if (!Array.isArray(lines)) {
      throw new Error(`WebgApp.${methodName} requires an array of lines`);
    }
    return lines.map((line) => String(line));
  }

  readHudColor(color, methodName, fallback) {
    if (color === undefined) {
      return [...fallback];
    }
    if (!Array.isArray(color) || color.some((value) => !Number.isFinite(value))) {
      throw new Error(`WebgApp.${methodName} requires options.color to be an array of finite numbers`);
    }
    return [...color];
  }

  readHudRow(row, index, methodName) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`WebgApp.${methodName} requires row[${index}] to be an object`);
    }
    return { ...row };
  }

  // 現在の入力 state を 1 frame 分の記録として残す
  // sample 側は update の最後で呼ぶだけで、key / action / edge の snapshot を残せる
  recordInputFrame(meta = {}) {
    if (!this.input?.captureFrameState) {
      return null;
    }
    const frame = this.input.captureFrameState({
      ...meta,
      frame: Number.isFinite(meta.frame)
        ? Number(meta.frame)
        : this.screen?.getFrameCount?.() ?? this.inputLog.length,
      timeMs: Number.isFinite(meta.timeMs)
        ? Number(meta.timeMs)
        : (typeof performance !== "undefined" ? performance.now() : Date.now()),
      elapsedSec: Number.isFinite(meta.elapsedSec) ? Number(meta.elapsedSec) : this.elapsedSec,
      source: meta.source ?? this.debugTools.source ?? "",
      label: meta.label ?? ""
    });
    this.inputLog.push(frame);
    return frame;
  }

  // 既存の入力ログから 1 frame を再生する
  // 数字を渡した場合は inputLog の index として扱い、snapshot object をそのまま渡してもよい
  replayInputFrame(frame, options = {}) {
    if (!this.input?.applyFrameState) {
      return null;
    }
    const snapshot = Number.isInteger(frame) ? this.inputLog[frame] ?? null : frame;
    if (!snapshot) {
      return null;
    }
    return this.input.applyFrameState(snapshot, options);
  }

  // これまでに記録した入力 log を確認しやすい形で返す
  getInputLog() {
    return this.inputLog.map((frame) => ({
      ...frame,
      keys: Array.isArray(frame.keys) ? [...frame.keys] : [],
      actionMap: frame.actionMap ? JSON.parse(JSON.stringify(frame.actionMap)) : {},
      actions: frame.actions ? JSON.parse(JSON.stringify(frame.actions)) : {}
    }));
  }

  // 入力 log をまとめて消す
  clearInputLog() {
    this.inputLog = [];
    return true;
  }

  // score 表示の値とレイアウトを更新する
  // game HUD の中では最も基本になるため、label と位置も一緒に持たせる
  setScore(value, options = {}) {
    const score = this.readHudNumber(value, "setScore", "value");
    this.gameHud.score = {
      value: score,
      label: String(options.label ?? "SCORE"),
      color: [...(options.color ?? [1.0, 0.95, 0.72])],
      anchor: options.anchor ?? "top-left",
      x: this.readHudOptionalInt(options.x, "setScore", "options.x", 0),
      y: this.readHudOptionalInt(options.y, "setScore", "options.y", 0)
    };
    return score;
  }

  // 現在 score へ増分を足し込み、そのまま HUD state を更新する
  // sample 側は内部値を別管理せず、この helper で加算処理まで済ませられる
  addScore(delta = 0, options = {}) {
    const base = this.gameHud.score?.value ?? 0;
    const inc = this.readHudNumber(delta, "addScore", "delta");
    return this.setScore(base + inc, options);
  }

  // combo 表示の値とレイアウトを更新する
  // score と同じ形式へ寄せて、描画側が共通処理で扱えるようにする
  setCombo(value, options = {}) {
    const combo = this.readHudNumber(value, "setCombo", "value");
    this.gameHud.combo = {
      value: combo,
      label: String(options.label ?? "COMBO"),
      color: [...(options.color ?? [0.78, 1.0, 0.78])],
      anchor: options.anchor ?? "top-left",
      x: this.readHudOptionalInt(options.x, "setCombo", "options.x", 0),
      y: this.readHudOptionalInt(options.y, "setCombo", "options.y", 1)
    };
    return combo;
  }

  // timer 表示の値とレイアウトを更新する
  // 右上固定を既定にして、score / combo と競合しにくい位置から始める
  setTimer(value, options = {}) {
    const timer = this.readHudNumber(value, "setTimer", "value");
    this.gameHud.timer = {
      value: timer,
      label: String(options.label ?? "TIME"),
      color: [...(options.color ?? [0.92, 0.97, 1.0])],
      anchor: options.anchor ?? "top-right",
      x: this.readHudOptionalInt(options.x, "setTimer", "options.x", -1),
      y: this.readHudOptionalInt(options.y, "setTimer", "options.y", 0)
    };
    return timer;
  }

  // 一時通知を game HUD queue へ積む
  // expiresAt を持たせて draw 側で自然に消える toast として扱う
  pushToast(text, options = {}) {
    const durationMs = options.durationMs === undefined
      ? 1500
      : Number.isFinite(options.durationMs) && Number(options.durationMs) >= 0
        ? Math.floor(Number(options.durationMs))
        : (() => { throw new Error("WebgApp.pushToast requires options.durationMs >= 0"); })();
    const toast = {
      id: String(options.id ?? `toast_${this.gameHud.toasts.length + 1}`),
      text: String(text),
      color: [...(options.color ?? [1.0, 0.92, 0.55])],
      anchor: options.anchor ?? "bottom-center",
      x: this.readHudOptionalInt(options.x, "pushToast", "options.x", 0),
      y: this.readHudOptionalInt(options.y, "pushToast", "options.y", -2),
      durationMs,
      expiresAtMs: Date.now() + durationMs
    };
    this.gameHud.toasts.push(toast);
    if (this.gameHud.toasts.length > this.gameHud.toastLimit) {
      this.gameHud.toasts.splice(0, this.gameHud.toasts.length - this.gameHud.toastLimit);
    }
    return toast.id;
  }

  // 登録済み toast をすべて消す
  // phase 切替や result 画面遷移で古い通知を残したくないときに使う
  clearToasts() {
    this.gameHud.toasts = [];
  }

  // score / combo / timer の数値を HUD 表示向け文字列へ整形する
  // 小数は 1 桁だけ残し、整数はそのまま出して視認性を保つ
  formatGameHudNumber(value) {
    if (!Number.isFinite(value)) {
      throw new Error(`WebgApp.formatGameHudNumber requires finite value: ${value}`);
    }
    return Number.isInteger(value) ? `${value}` : value.toFixed(1);
  }

  // 現在の game HUD state を Message entry 配列へ変換する
  // score / combo / timer / toast を 1 つの draw 経路へそろえるための中継点にする
  getGameHudEntries(nowMs = Date.now()) {
    const entries = [];
    const score = this.gameHud.score;
    const combo = this.gameHud.combo;
    const timer = this.gameHud.timer;
    if (score) {
      entries.push({
        id: "game-score",
        text: `${score.label} ${this.formatGameHudNumber(score.value)}`,
        color: score.color,
        anchor: score.anchor,
        x: score.x,
        y: score.y
      });
    }
    if (combo && Number(combo.value) > 0) {
      entries.push({
        id: "game-combo",
        text: `${combo.label} ${this.formatGameHudNumber(combo.value)}x`,
        color: combo.color,
        anchor: combo.anchor,
        x: combo.x,
        y: combo.y
      });
    }
    if (timer) {
      entries.push({
        id: "game-timer",
        text: `${timer.label} ${this.formatGameHudNumber(timer.value)}`,
        color: timer.color,
        anchor: timer.anchor,
        x: timer.x,
        y: timer.y
      });
    }
    const activeToasts = this.gameHud.toasts.filter((toast) => toast.expiresAtMs > nowMs);
    this.gameHud.toasts = activeToasts;
    for (let i = 0; i < activeToasts.length; i++) {
      const toast = activeToasts[i];
      entries.push({
        id: toast.id,
        text: toast.text,
        color: toast.color,
        anchor: toast.anchor,
        x: toast.x,
        y: toast.y - i
      });
    }
    return entries;
  }

  // 既存 sample の guide/status 文字列を、新しい controls row へ最小変換する
  // line 文字列は dock/HUD の両方でそのまま 1 行として表示し、旧い補助経路を挟まずに新しい表示系へ載せる
  makeTextControlRows(lines = []) {
    if (!Array.isArray(lines)) {
      throw new Error("WebgApp.makeTextControlRows requires an array");
    }
    return lines
      .map((line) => String(line))
      .filter((line) => line !== "")
      .map((line) => ({ line }));
  }

  // WebgApp 管理の HUD block を app 固有 HUD と重ならない位置へずらす
  // guide/status/hudRows を別々に動かせるようにし、sample 側が毎回 y を書き換えなくて済むようにする
  setHudLayoutOffsets(options = {}) {
    if (options.guideOffsetY !== undefined) {
      this.hudLayoutOffsets.guideOffsetY = this.readHudNumber(options.guideOffsetY, "setHudLayoutOffsets", "options.guideOffsetY");
    }
    if (options.statusOffsetY !== undefined) {
      this.hudLayoutOffsets.statusOffsetY = this.readHudNumber(options.statusOffsetY, "setHudLayoutOffsets", "options.statusOffsetY");
    }
    if (options.rowsOffsetY !== undefined) {
      this.hudLayoutOffsets.rowsOffsetY = this.readHudNumber(options.rowsOffsetY, "setHudLayoutOffsets", "options.rowsOffsetY");
    }
  }

  // HTML debug dock 用の構造化行を設定する
  // guide/status の自由文より、1 行 1 parameter として見せたい場合に使う
  setDebugDockRows(rows = []) {
    this.debugDock.setRows(rows);
    this.updateDebugDock();
  }

  // debug dock の row 表示だけを消し、diagnostics 本体は残す
  // parameter row を scene ごとに差し替えたい場合の最小操作にする
  clearDebugDockRows() {
    this.debugDock.clearRows();
    this.updateDebugDock();
  }

  // debug dock に載せる alert text は 1 行で追えることを優先し、
  // 改行や余分な空白をここでつぶして比較的短い形へそろえる
  normalizeDebugDockAlertText(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text;
  }

  // 最新 alert は diagnostics report の snapshot とは別に event として残し、
  // 直前の warning / error を debug dock へ常時出せるようにする
  makeDebugDockAlertRecord(message, options = {}) {
    const normalized = this.normalizeDebugDockAlertText(message);
    if (!normalized) {
      return null;
    }
    return {
      message: normalized,
      stage: String(options.stage ?? this.diagnostics?.stage ?? "runtime"),
      source: String(options.source ?? this.debugTools.source ?? ""),
      system: String(options.system ?? this.debugTools.system ?? "app"),
      timestamp: options.timestamp ?? new Date().toISOString()
    };
  }

  // runtime error は fixed-format panel や diagnostics report と別に保持し、
  // 新しい report が来ても最後の失敗内容を dock から見失わないようにする
  setLatestRuntimeError(error, options = {}) {
    const message = error instanceof Error ? (error.message ?? String(error)) : String(error ?? "");
    const record = this.makeDebugDockAlertRecord(message, options);
    if (!record) {
      return null;
    }
    this.latestRuntimeError = record;
    return record;
  }

  // warning も同じく event として保持し、
  // report の warning 配列を開かなくても最後の 1 件をすぐ確認できるようにする
  setLatestRuntimeWarning(line, options = {}) {
    const record = this.makeDebugDockAlertRecord(line, options);
    if (!record) {
      return null;
    }
    this.latestRuntimeWarning = record;
    return record;
  }

  // 新しい app 起動や初期化を始める時だけ latest alert を消し、
  // 同一 run 中の stage 切替では直前の error / warning を残して追跡しやすくする
  clearLatestRuntimeAlerts() {
    this.latestRuntimeError = null;
    this.latestRuntimeWarning = null;
  }

  // 外部から受け取った diagnostics report に warning / error が含まれていれば、
  // dock 用の最新 alert state へも反映して report 差し替え時の情報欠落を防ぐ
  syncLatestRuntimeAlertsFromReport(report) {
    if (!report || typeof report !== "object") {
      return;
    }
    const alertOptions = {
      stage: report.stage ?? this.diagnostics?.stage ?? "runtime",
      source: report.source ?? this.debugTools.source ?? "",
      system: report.system ?? this.debugTools.system ?? "app",
      timestamp: report.timestamp ?? new Date().toISOString()
    };
    if (report.error) {
      this.setLatestRuntimeError(report.error, alertOptions);
    }
    if (Array.isArray(report.warnings) && report.warnings.length > 0) {
      this.setLatestRuntimeWarning(report.warnings[report.warnings.length - 1], alertOptions);
    }
  }

  // diagnostics の入口が違っても同じ report を使えるように、
  // 現在値の report を 1 箇所で組み立てる
  createCurrentDiagnosticsReport(options = {}) {
    const report = options.report && typeof options.report === "object"
      ? options.report
      : this.mergeCurrentDiagnosticsReports(
        this.diagnostics,
        this.collectCurrentDiagnosticsSourceReport(options)
      );
    const normalized = Diagnostics.createReport({
      system: report?.system ?? this.debugTools.system,
      source: report?.source ?? this.debugTools.source,
      stage: report?.stage ?? "runtime",
      ok: report?.ok !== false,
      error: report?.error ?? "",
      details: Array.isArray(report?.details) ? [...report.details] : [],
      warnings: Array.isArray(report?.warnings) ? [...report.warnings] : [],
      stats: { ...(report?.stats ?? {}) },
      context: { ...(report?.context ?? {}) },
      timestamp: report?.timestamp ?? new Date().toISOString()
    });
    Diagnostics.mergeStats(normalized, this.buildAutomaticDiagnosticsStats(normalized, options));
    this.mergeAutomaticDiagnosticsContext(normalized, options);
    if (!normalized.error && this.latestRuntimeError?.message) {
      normalized.error = this.latestRuntimeError.message;
      normalized.ok = false;
    }
    if (
      this.latestRuntimeWarning?.message
      && !normalized.warnings.includes(this.latestRuntimeWarning.message)
    ) {
      Diagnostics.addWarning(normalized, this.latestRuntimeWarning.message);
    }
    return normalized;
  }

  // 現在の diagnostics と live collect の report を重ね、
  // 片方にしか無い warning / detail を落とさず current report へ集約する
  mergeCurrentDiagnosticsReports(baseReport, liveReport) {
    if (!baseReport || typeof baseReport !== "object") {
      return liveReport;
    }
    if (!liveReport || typeof liveReport !== "object") {
      return baseReport;
    }
    const details = [];
    const warnings = [];
    const pushUnique = (list, value) => {
      const text = String(value ?? "");
      if (!text || list.includes(text)) {
        return;
      }
      list.push(text);
    };
    const baseDetails = Array.isArray(baseReport.details) ? baseReport.details : [];
    const liveDetails = Array.isArray(liveReport.details) ? liveReport.details : [];
    for (let i = 0; i < baseDetails.length; i++) pushUnique(details, baseDetails[i]);
    for (let i = 0; i < liveDetails.length; i++) pushUnique(details, liveDetails[i]);
    const baseWarnings = Array.isArray(baseReport.warnings) ? baseReport.warnings : [];
    const liveWarnings = Array.isArray(liveReport.warnings) ? liveReport.warnings : [];
    for (let i = 0; i < baseWarnings.length; i++) pushUnique(warnings, baseWarnings[i]);
    for (let i = 0; i < liveWarnings.length; i++) pushUnique(warnings, liveWarnings[i]);
    return {
      ...baseReport,
      ...liveReport,
      error: liveReport.error || baseReport.error || "",
      ok: (baseReport.ok !== false) && (liveReport.ok !== false),
      details,
      warnings,
      stats: {
        ...(baseReport.stats ?? {}),
        ...(liveReport.stats ?? {})
      },
      context: {
        ...(baseReport.context ?? {}),
        ...(liveReport.context ?? {})
      }
    };
  }

  // sample が collect を登録していればそれを優先し、
  // そうでなければ現在の diagnostics state を現在 report の元として使う
  collectCurrentDiagnosticsSourceReport(options = {}) {
    const collect = typeof options.collect === "function"
      ? options.collect
      : this.debugTools.capture.collect;
    if (typeof collect === "function") {
      const report = collect();
      if (report && typeof report === "object") {
        return report;
      }
    }
    if (this.diagnostics && typeof this.diagnostics === "object") {
      return this.diagnostics;
    }
    return Diagnostics.createSuccessReport({
      system: this.debugTools.system,
      source: this.debugTools.source,
      stage: "runtime"
    });
  }

  // Current State / Copy が同じ report を共有できるように、
  // 現在 report を cache つきで取得する
  getCurrentDiagnosticsReport(options = {}) {
    const cache = this.currentDiagnosticsCache;
    const nowMs = options.nowMs === undefined
      ? Date.now()
      : Number.isFinite(options.nowMs)
        ? Number(options.nowMs)
        : (() => { throw new Error("WebgApp.getCurrentDiagnosticsReport requires finite options.nowMs"); })();
    const forceRefresh = options.forceRefresh === true;
    const cacheable = options.cacheable !== false && options.detailLevel !== "json";
    const intervalMs = options.intervalMs === undefined
      ? cache.intervalMs
      : Number.isFinite(options.intervalMs) && Number(options.intervalMs) >= 0
        ? Number(options.intervalMs)
        : (() => { throw new Error("WebgApp.getCurrentDiagnosticsReport requires options.intervalMs >= 0"); })();
    if (
      cacheable
      && !forceRefresh
      && cache.report
      && (nowMs - cache.updatedAtMs) < intervalMs
    ) {
      return cache.report;
    }
    const report = this.createCurrentDiagnosticsReport(options);
    if (cacheable) {
      cache.report = report;
      cache.currentStateText = this.formatDiagnosticsSummary(report);
      cache.updatedAtMs = nowMs;
      this.diagnostics = report;
      this.syncLatestRuntimeAlertsFromReport(report);
    }
    return report;
  }

  // Current State は copy summary と同じ summary text を使い、
  // 毎 frame 再計算しなくても十分読めるので 1 秒ごとの cache を使う
  getCurrentStateDockText(options = {}) {
    const report = this.getCurrentDiagnosticsReport(options);
    const cache = this.currentDiagnosticsCache;
    if (!cache.currentStateText) {
      cache.currentStateText = this.formatDiagnosticsSummary(report);
    }
    return cache.currentStateText;
  }

  // current report の cache は、stats のような高頻度更新では前回 summary をしばらく保持し、
  // stage 切替や error のような重要更新では clear=true で即時に作り直せるようにする
  invalidateCurrentDiagnosticsCache(options = {}) {
    const clear = options.clear === true;
    if (clear) {
      this.currentDiagnosticsCache.report = null;
      this.currentDiagnosticsCache.currentStateText = "";
      this.currentDiagnosticsCache.updatedAtMs = 0;
    }
  }

  // report stats だけでは不足しやすい canvas 情報や経過時間を補い、
  // 入口が違っても揃う共通 stats として扱う
  buildAutomaticDiagnosticsStats(report, options = {}) {
    const stats = {};
    const canvas = this.screen?.canvas ?? this.doc?.getElementById?.("canvas") ?? null;
    const detailLevel = options.detailLevel === "json" ? "json" : "summary";
    const sceneStats = this.collectCurrentSceneStats({ detailLevel });
    const autoStats = {
      ...sceneStats,
      frameCount: this.screen?.getFrameCount?.() ?? 0,
      envOk: report?.ok ? "yes" : "no"
    };
    const autoKeys = Object.keys(autoStats);
    for (let i = 0; i < autoKeys.length; i++) {
      const key = autoKeys[i];
      const value = autoStats[key];
      if (value !== null && typeof value === "object") {
        continue;
      }
      stats[key] = value;
    }
    stats.canvasWidth = canvas?.width ?? 0;
    stats.canvasHeight = canvas?.height ?? 0;
    stats.displayWidth = canvas?.clientWidth ?? this.screen?.displayWidth ?? 0;
    stats.displayHeight = canvas?.clientHeight ?? this.screen?.displayHeight ?? 0;
    stats.layoutMode = this.layoutMode;
    if (this.fixedCanvasSize) {
      stats.fixedCanvasWidth = this.fixedCanvasSize.width;
      stats.fixedCanvasHeight = this.fixedCanvasSize.height;
      stats.fixedCanvasUseDpr = this.fixedCanvasSize.useDevicePixelRatio ? "yes" : "no";
    }
    const eyePosition = this.eye?.getWorldPosition?.();
    if (Array.isArray(eyePosition) && eyePosition.length >= 3) {
      stats.eyeX = Number(eyePosition[0]).toFixed(2);
      stats.eyeY = Number(eyePosition[1]).toFixed(2);
      stats.eyeZ = Number(eyePosition[2]).toFixed(2);
    }
    const eyeAttitude = this.eye?.getWorldAttitude?.();
    if (Array.isArray(eyeAttitude) && eyeAttitude.length >= 3) {
      stats.eyeYaw = Number(eyeAttitude[0]).toFixed(2);
      stats.eyePitch = Number(eyeAttitude[1]).toFixed(2);
      stats.eyeBank = Number(eyeAttitude[2]).toFixed(2);
    }
    const cameraTarget = this.getDiagnosticsCameraTarget();
    if (Array.isArray(cameraTarget) && cameraTarget.length >= 3) {
      stats.cameraTargetX = Number(cameraTarget[0]).toFixed(2);
      stats.cameraTargetY = Number(cameraTarget[1]).toFixed(2);
      stats.cameraTargetZ = Number(cameraTarget[2]).toFixed(2);
      if (Array.isArray(eyePosition) && eyePosition.length >= 3) {
        const dx = Number(eyePosition[0]) - Number(cameraTarget[0]);
        const dy = Number(eyePosition[1]) - Number(cameraTarget[1]);
        const dz = Number(eyePosition[2]) - Number(cameraTarget[2]);
        stats.eyeDistance = Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(2);
      }
    }
    const appShaderClass = this.getDiagnosticsShaderClassName(this.shader ?? this.shaderClass);
    if (appShaderClass) {
      stats.appShaderClass = appShaderClass;
    }
    if (this.screen) {
      const fovY = Number(this.screen.getRecommendedFov(this.viewAngle));
      const aspect = Number(this.screen.getAspect());
      const fovYRad = (fovY * Math.PI / 180.0) * 0.5;
      const fovX = Math.atan(Math.tan(fovYRad) * aspect) * 2.0 * 180.0 / Math.PI;
      stats.fovX = fovX.toFixed(2);
      stats.fovY = fovY.toFixed(2);
    }
    stats.uptimeSec = this.runtimeElapsedSec.toFixed(2);
    return stats;
  }

  // JSON 用 diagnostics では summary より詳しい context を持ち出したいので、
  // 重い一覧系は stats ではなく context 配下へまとめる
  mergeAutomaticDiagnosticsContext(report, options = {}) {
    if (!report || options.detailLevel !== "json") {
      return;
    }
    const sceneStats = this.collectCurrentSceneStats({ detailLevel: "json" });
    const cameraTarget = this.getDiagnosticsCameraTarget();
    const eyePosition = this.eye?.getWorldPosition?.();
    const eyeAttitude = this.eye?.getWorldAttitude?.();
    const context = {
      ...(report.context ?? {}),
      webgAuto: {
        camera: {
          target: Array.isArray(cameraTarget) ? [...cameraTarget] : [],
          eyePosition: Array.isArray(eyePosition) ? [...eyePosition] : [],
          eyeAttitude: Array.isArray(eyeAttitude) ? [...eyeAttitude] : []
        },
        rendering: {
          appShaderClass: this.getDiagnosticsShaderClassName(this.shader ?? this.shaderClass),
          shapeShaderClasses: sceneStats.shapeShaderClasses ?? [],
          shapeShaderUsage: sceneStats.shapeShaderUsage ?? {},
          materialIds: sceneStats.materialIds ?? [],
          materialUsage: sceneStats.materialUsage ?? {}
        }
      }
    };
    report.context = context;
  }

  // diagnostics では target も一緒に見ると camera が scene を向いているか判断しやすい
  getDiagnosticsCameraTarget() {
    if (Array.isArray(this.camera?.target) && this.camera.target.length >= 3) {
      return [...this.camera.target];
    }
    const rigPosition = this.cameraRig?.getWorldPosition?.();
    if (Array.isArray(rigPosition) && rigPosition.length >= 3) {
      return [...rigPosition];
    }
    return [];
  }

  // shader instance と shader class の両方を扱い、
  // diagnostics では最終的に class 名だけを短く出す
  getDiagnosticsShaderClassName(shaderRef = null) {
    if (!shaderRef) {
      return "";
    }
    if (typeof shaderRef === "function" && shaderRef.name) {
      return shaderRef.name;
    }
    if (typeof shaderRef === "object" && shaderRef.constructor?.name) {
      return shaderRef.constructor.name;
    }
    return String(shaderRef ?? "");
  }

  // Space と Shape から現在 scene の共通統計値を集計し、
  // sample が個別に stats へ積まなくても最低限の counts を Current State へ出せるようにする
  collectCurrentSceneStats(options = {}) {
    const detailLevel = options.detailLevel === "json" ? "json" : "summary";
    const nodes = this.space?.nodes ?? [];
    let nodeCount = 0;
    let shapeCount = 0;
    let meshCount = 0;
    let vertexCount = 0;
    let triangleCount = 0;
    let boneCount = 0;
    let hiddenShapeCount = 0;
    let visibleShapeCount = 0;
    let skinnedShapeCount = 0;
    const countedSkeletons = new Set();
    const countedResources = new Set();
    const materialIds = new Set();
    const materialUsage = {};
    const shapeShaderClasses = new Set();
    const shapeShaderUsage = {};
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) {
        continue;
      }
      nodeCount += 1;
      const shapes = Array.isArray(node.shapes) ? node.shapes : [];
      if (shapes.length <= 0) {
        continue;
      }
      for (let j = 0; j < shapes.length; j++) {
        const shape = shapes[j];
        if (!shape) {
          continue;
        }
        const rawVertexCount = shape.getVertexCount?.() ?? shape.vertexCount ?? 0;
        const rawTriangleCount = shape.getTriangleCount?.()
          ?? (Number.isFinite(shape.indexCount) ? shape.indexCount / 3 : 0);
        const resource = shape.getResource?.() ?? shape.resource ?? shape;
        shapeCount += 1;
        if (shape.isHidden) {
          hiddenShapeCount += 1;
        } else {
          visibleShapeCount += 1;
        }
        // Shape instance は material や hidden state だけを個別に持ち、
        // geometry / GPU buffer は shared resource を参照できる
        // Current State の vertex/triangle は geometry 規模を見たいので、
        // 同じ resource を参照する instance 群は 1 回だけ数える
        if (!countedResources.has(resource)) {
          countedResources.add(resource);
          meshCount += 1;
          vertexCount += Number(rawVertexCount);
          triangleCount += Number(rawTriangleCount);
        }
        const skeleton = shape.getSkeleton?.() ?? shape.skeleton ?? null;
        if (skeleton && !countedSkeletons.has(skeleton)) {
          countedSkeletons.add(skeleton);
          boneCount += Number(skeleton.getBoneCount?.() ?? skeleton.bones?.length ?? 0);
        }
        if (skeleton) {
          skinnedShapeCount += 1;
        }
        if (detailLevel === "json") {
          const material = shape.getMaterial?.() ?? { id: shape.materialId ?? null };
          const materialId = material?.id ?? shape.materialId ?? null;
          if (materialId !== null && materialId !== undefined && materialId !== "") {
            const materialKey = String(materialId);
            materialIds.add(materialKey);
            materialUsage[materialKey] = (materialUsage[materialKey] ?? 0) + 1;
          }
          const shaderClass = this.getDiagnosticsShaderClassName(shape.shader ?? this.shader ?? this.shaderClass);
          if (shaderClass) {
            shapeShaderClasses.add(shaderClass);
            shapeShaderUsage[shaderClass] = (shapeShaderUsage[shaderClass] ?? 0) + 1;
          }
        }
      }
    }
    const stats = {
      nodeCount,
      shapeCount,
      meshCount,
      vertexCount,
      triangleCount,
      boneCount,
      visibleShapeCount,
      hiddenShapeCount,
      skinnedShapeCount
    };
    if (detailLevel === "json") {
      stats.materialIds = [...materialIds].sort();
      stats.materialUsage = materialUsage;
      stats.shapeShaderClasses = [...shapeShaderClasses].sort();
      stats.shapeShaderUsage = shapeShaderUsage;
    }
    return stats;
  }

  // debug 用ガイド文は mode 切替に追従しやすいよう別設定として保持する
  setDebugGuideLines(lines, options = {}) {
    this.debugTools.guideLines = (lines ?? []).map((line) => String(line));
    this.debugTools.guideOptions = { ...options };
    this.applyDebugGuideLines();
  }

  // debug mode 時だけガイド文を出し、release では消す
  applyDebugGuideLines() {
    this.setGuideLines(
      DebugConfig.isDebug() ? this.debugTools.guideLines : [],
      this.debugTools.guideOptions ?? {}
    );
    this.updateDebugDock();
  }

  // 共通 diagnostics report を作り直す
  resetDiagnostics(stage = "init") {
    this.diagnostics = Diagnostics.createSuccessReport({
      system: this.debugTools.system,
      source: this.debugTools.source,
      stage
    });
    this.invalidateCurrentDiagnosticsCache({ clear: true });
    this.diagnosticsCopyState = "READY";
    if (stage === "init") {
      this.clearLatestRuntimeAlerts();
    }
    this.updateDebugDock();
    return this.diagnostics;
  }

  // 現在の diagnostics stage を更新する
  setDiagnosticsStage(stage) {
    if (!this.diagnostics) {
      this.resetDiagnostics(stage);
      return;
    }
    this.diagnostics.stage = stage;
    this.diagnostics.timestamp = new Date().toISOString();
    this.invalidateCurrentDiagnosticsCache({ clear: true });
    this.updateDebugDock();
  }

  // diagnostics へ detail 行を追加する
  addDiagnosticsDetail(line) {
    if (!this.diagnostics) {
      this.resetDiagnostics("runtime");
    }
    Diagnostics.addDetail(this.diagnostics, line);
    this.invalidateCurrentDiagnosticsCache({ clear: true });
    this.updateDebugDock();
  }

  // diagnostics へ warning 行を追加する
  addDiagnosticsWarning(line) {
    if (!this.diagnostics) {
      this.resetDiagnostics("runtime");
    }
    Diagnostics.addWarning(this.diagnostics, line);
    this.invalidateCurrentDiagnosticsCache({ clear: true });
    this.setLatestRuntimeWarning(line, {
      stage: this.diagnostics?.stage ?? "runtime"
    });
    this.updateDebugDock();
  }

  // 高レイヤーの fallback や範囲外 clip はここから warning として通知し、
  // console と diagnostics/debug dock の両方で追える共通入口にする
  reportRuntimeWarning(line, options = {}) {
    const text = this.normalizeDebugDockAlertText(line);
    if (!text) {
      return null;
    }
    if (options.logToConsole !== false) {
      console.warn(text);
    }
    this.addDiagnosticsWarning(text);
    return this.latestRuntimeWarning;
  }

  // diagnostics の統計値をまとめて更新する
  mergeDiagnosticsStats(stats = {}) {
    if (!this.diagnostics) {
      this.resetDiagnostics("runtime");
    }
    Diagnostics.mergeStats(this.diagnostics, stats);
    this.invalidateCurrentDiagnosticsCache();
    this.updateDebugDock();
  }

  // 外部生成の report を app 側 state へ差し替える
  setDiagnosticsReport(report) {
    this.diagnostics = report;
    this.syncLatestRuntimeAlertsFromReport(report);
    this.invalidateCurrentDiagnosticsCache({ clear: true });
    this.updateDebugDock();
  }

  // 現在の diagnostics report を返す
  getDiagnosticsReport() {
    return this.diagnostics;
  }

  // probe 用の report を system/source 付きで作る
  createProbeReport(stage = "runtime-probe") {
    return Diagnostics.createSuccessReport({
      system: this.debugTools.system,
      source: this.debugTools.source,
      stage
    });
  }

  // debug/release を切り替え、ガイド表示を更新する
  toggleDebugMode() {
    if (DebugConfig.isRelease()) {
      DebugConfig.setMode("debug");
    } else {
      DebugConfig.setMode("release");
    }
    this.applyDebugGuideLines();
    // mode 切替では dock の表示有無だけでなく canvas 幅と panel / dialogue の right inset も変わる
    // resize event を待つと fixed panel の位置が古いまま残るため、
    // ここで即座に viewport layout を再適用する
    if (this.screen && typeof window !== "undefined") {
      this.applyViewportLayout();
    } else {
      this.syncDebugDockVisibility();
      this.updateDebugDock();
    }
    return DebugConfig.mode;
  }

  // 現在の debug mode を返す
  getDebugMode() {
    return DebugConfig.mode;
  }

  // console 出力が有効か返す
  isConsoleEnabled() {
    return DebugConfig.isEnabled("enableConsole");
  }

  // debug 用補助 UI が有効か返す
  isDebugUiEnabled() {
    return DebugConfig.isDebug();
  }

  // スクリーンショット用の timestamp を `YYYYMMDD_HHMMSS` 形式へ整形する
  // sample 側で毎回 pad 処理を書かなくても、保存名の規則を app 共通でそろえられるようにする
  formatScreenshotTimestamp(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error("WebgApp screenshot timestamp requires a valid Date");
    }
    const pad2 = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}`
      + `${pad2(date.getMonth() + 1)}`
      + `${pad2(date.getDate())}_`
      + `${pad2(date.getHours())}`
      + `${pad2(date.getMinutes())}`
      + `${pad2(date.getSeconds())}`;
  }

  // スクリーンショット保存名を組み立てる
  // filename を明示した場合はそれを優先し、prefix + timestamp の標準形も同じ入口で作れるようにする
  resolveScreenshotFilename(options = {}) {
    if (typeof options === "string") {
      const explicitFilename = options.trim();
      if (!explicitFilename) {
        throw new Error("WebgApp screenshot filename must not be empty");
      }
      return explicitFilename;
    }
    if (!options || typeof options !== "object") {
      throw new Error("WebgApp screenshot options must be a string or object");
    }

    if (typeof options.filename === "string") {
      const explicitFilename = options.filename.trim();
      if (!explicitFilename) {
        throw new Error("WebgApp screenshot filename must not be empty");
      }
      return explicitFilename;
    }

    const prefix = String(options.prefix ?? "screenshot").trim();
    if (!prefix) {
      throw new Error("WebgApp screenshot prefix must not be empty");
    }

    const extension = String(options.extension ?? "png").trim().replace(/^\.+/, "");
    if (!extension) {
      throw new Error("WebgApp screenshot extension must not be empty");
    }

    if (options.timestamp === false) {
      return `${prefix}.${extension}`;
    }

    const date = options.date === undefined ? new Date() : options.date;
    return `${prefix}_${this.formatScreenshotTimestamp(date)}.${extension}`;
  }

  // 現在の canvas 内容を次の present 後に PNG として保存するよう予約する
  // sample 側は Screen の内部 API を直接たどらず、WebgApp の高レベル入口だけで保存名まで扱える
  takeScreenshot(options = {}) {
    if (!this.screen?.screenShot) {
      throw new Error("WebgApp must be initialized before taking a screenshot");
    }
    const filename = this.resolveScreenshotFilename(options);
    this.screen.screenShot(filename);
    return filename;
  }

  // progress 保存先を返す
  // テストでは注入された storage を優先し、通常実行では browser の localStorage を使う
  getProgressStorage() {
    if (this.progressStorage) {
      return this.progressStorage;
    }
    if (typeof window === "undefined") {
      return null;
    }
    try {
      return window.localStorage ?? null;
    } catch (_) {
      return null;
    }
  }

  // progress 保存に使う storage key を namespace 付きで組み立てる
  // game 名や sample 名を key に含めるだけで、保存先の衝突を避けやすくする
  getProgressStorageKey(key) {
    if (key === undefined || key === null) {
      throw new Error("WebgApp progress key must not be empty");
    }
    const normalizedKey = String(key).trim();
    if (!normalizedKey) {
      throw new Error("WebgApp progress key must not be empty");
    }
    return `${this.progressStoragePrefix}.${normalizedKey}`;
  }

  // progress を保存する
  // 保存内容は Diagnostics.createProgressReport() で report 化し、
  // その report 自体を JSON として storage へ書き込む
  saveProgress(key, data, options = {}) {
    const storage = this.getProgressStorage();
    const storageKey = this.getProgressStorageKey(key);
    if (!storage) {
      return null;
    }
    const report = Diagnostics.createProgressReport(data, {
      ...options,
      system: options.system ?? this.debugTools.system ?? "app",
      source: options.source ?? this.debugTools.source ?? "",
      key: String(key).trim(),
      storageKey,
      version: options.version === undefined ? 1 : options.version
    });
    try {
      storage.setItem(storageKey, JSON.stringify(report));
      return report;
    } catch (error) {
      throw new Error(`WebgApp.saveProgress failed for "${storageKey}": ${error?.message ?? error}`);
    }
  }

  // progress を読み込む
  // report 形式で保存された場合は context.data を返し、
  // 旧来の raw JSON が入っていてもできるだけそのまま返す
  loadProgress(key, defaultValue = null) {
    const storage = this.getProgressStorage();
    const storageKey = this.getProgressStorageKey(key);
    if (!storage) {
      return defaultValue;
    }
    try {
      const raw = storage.getItem(storageKey);
      if (raw === null || raw === undefined || raw === "") {
        return defaultValue;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (Object.prototype.hasOwnProperty.call(parsed, "data")) {
          return parsed.data;
        }
        if (parsed.context && typeof parsed.context === "object"
          && Object.prototype.hasOwnProperty.call(parsed.context, "data")) {
          return parsed.context.data;
        }
        if (parsed.report && typeof parsed.report === "object"
          && parsed.report.context && typeof parsed.report.context === "object"
          && Object.prototype.hasOwnProperty.call(parsed.report.context, "data")) {
          return parsed.report.context.data;
        }
      }
      return parsed;
    } catch (error) {
      throw new Error(`WebgApp.loadProgress failed for "${storageKey}": ${error?.message ?? error}`);
    }
  }

  // progress を削除する
  // key が見つからなくても落ちないようにし、呼び出し側は boolean だけ見ればよい
  clearProgress(key) {
    const storage = this.getProgressStorage();
    const storageKey = this.getProgressStorageKey(key);
    if (!storage) {
      return false;
    }
    try {
      storage.removeItem(storageKey);
      return true;
    } catch (error) {
      throw new Error(`WebgApp.clearProgress failed for "${storageKey}": ${error?.message ?? error}`);
    }
  }

  // diagnostics summary を clipboard へ送り、最初に共有したい情報を 1 回で持ち出せるようにする
  async copyDiagnosticsSummary(options = {}) {
    const report = options.report ?? this.getCurrentDiagnosticsReport({
      forceRefresh: true,
      detailLevel: "summary"
    });
    const copied = await Diagnostics.copySummary(report, options);
    this.diagnosticsCopyState = copied ? "SUMMARY COPIED" : "SUMMARY COPY FAILED";
    this.updateDebugDock();
    return copied;
  }

  // report JSON を clipboard へ送り、構造を保ったまま AI や外部 tool へ渡せるようにする
  async copyDiagnosticsReportJSON(options = {}) {
    const report = options.report ?? this.getCurrentDiagnosticsReport({
      forceRefresh: true,
      detailLevel: "json",
      cacheable: false
    });
    const space = Number.isInteger(options.space) ? options.space : 2;
    const copied = await Diagnostics.copyJSON(report, space);
    this.diagnosticsCopyState = copied ? "REPORT JSON COPIED" : "REPORT JSON COPY FAILED";
    this.updateDebugDock();
    return copied;
  }

  // summary text は人と AI が最初に読む標準出口として使う
  formatDiagnosticsSummary(report = null, options = {}) {
    return Diagnostics.toSummaryText(
      report ?? this.getCurrentDiagnosticsReport({ forceRefresh: true, detailLevel: "summary" }),
      options
    );
  }

  // diagnostics report を JSON 文字列へ整形し、外部利用しやすい形で返す
  formatDiagnosticsJSON(report = null, space = 2) {
    return Diagnostics.toJSON(
      report ?? this.getCurrentDiagnosticsReport({
        forceRefresh: true,
        detailLevel: "json",
        cacheable: false
      }),
      space
    );
  }

  // sample 側で登録した collect を使い、summary か JSON を 1 回だけ採取してすぐ持ち出す
  captureDiagnosticsSnapshot(options = {}) {
    const format = options.format === "json" ? "json" : "summary";
    const capture = this.debugTools.capture ?? {};
    const collect = typeof options.collect === "function"
      ? options.collect
      : (typeof capture.collect === "function" ? capture.collect : null);
    const onCaptured = typeof options.onCaptured === "function"
      ? options.onCaptured
      : (typeof capture.onCaptured === "function" ? capture.onCaptured : null);
    const afterFrames = Number.isInteger(options.afterFrames)
      ? Math.max(1, options.afterFrames)
      : (Number.isInteger(capture.afterFrames) ? capture.afterFrames : this.debugTools.probeDefaultAfterFrames);
    const labelPrefix = String(options.labelPrefix ?? capture.labelPrefix ?? this.debugTools.system ?? "app");
    if (!this.debugProbe) {
      this.diagnosticsCopyState = format === "json" ? "SNAPSHOT JSON DISABLED" : "SNAPSHOT SUMMARY DISABLED";
      this.updateDebugDock();
      return null;
    }
    this.debugProbeFormat = format;
    const probeId = this.debugProbe.request({
      label: options.label ?? `${labelPrefix}_${format}_snapshot`,
      format,
      frameCount: this.screen?.getFrameCount?.() ?? 0,
      afterFrames,
      collect: () => {
        const baseReport = collect ? collect() : this.collectCurrentDiagnosticsSourceReport();
        return this.createCurrentDiagnosticsReport({
          report: baseReport,
          detailLevel: format === "json" ? "json" : "summary"
        });
      },
      onReady: async (result) => {
        this.setDiagnosticsReport(result.payload);
        if (format === "json") {
          const copied = await this.copyDiagnosticsReportJSON({ report: result.payload });
          this.diagnosticsCopyState = copied ? "SNAPSHOT JSON COPIED" : "SNAPSHOT JSON READY";
        } else {
          const copied = await this.copyDiagnosticsSummary({
            report: result.payload,
            includeContext: options.includeContext === true
          });
          this.diagnosticsCopyState = copied ? "SNAPSHOT SUMMARY COPIED" : "SNAPSHOT SUMMARY READY";
        }
        this.updateDebugDock();
        onCaptured?.(result);
      }
    });
    this.debugProbeState = probeId ? `WAIT ${afterFrames}F` : "PROBE DISABLED";
    this.updateDebugDock();
    return probeId;
  }

  // summary snapshot の標準入口
  captureDiagnosticsSummary(options = {}) {
    return this.captureDiagnosticsSnapshot({
      ...options,
      format: "summary"
    });
  }

  // report JSON snapshot の標準入口
  captureDiagnosticsReportJSON(options = {}) {
    return this.captureDiagnosticsSnapshot({
      ...options,
      format: "json"
    });
  }

  // sample 側 status 行では diagnostics の概要だけを短く見たい場合があるため、
  // dock とは別に 1 行版の status 文字列も残す
  getDiagnosticsStatusLine() {
    const report = this.getCurrentDiagnosticsReport();
    return `diag=${report.ok ? "OK" : "ERROR"} stage=${report.stage}`;
  }

  // probe / debug key の状態は sample 側の HUD でも参照されるため、
  // 1 行で読める status 形式を共通 helper として返す
  getProbeStatusLine() {
    const keyInput = this.debugTools.keyInput ?? {};
    return `probe=${this.debugProbeState} fmt=${this.debugProbeFormat} pending=${this.debugProbe?.getPendingCount?.() ?? 0} key=${this.getDebugKeyPrefixLabel()} cmd=${keyInput.status ?? "READY"}`;
  }

  // probe を 1 フレーム分進めて状態を更新する
  updateDebugProbe() {
    if (!this.debugProbe || !this.screen) return null;
    const result = this.debugProbe.update(this.screen.getFrameCount());
    if (result && this.debugProbeState.startsWith("WAIT")) {
      this.debugProbeState = `READY ${result.format.toUpperCase()}`;
      this.updateDebugDock();
    }
    return result;
  }

  // 現在の mode と debug UI 設定から、debug dock を出すべきかを判定する
  // draw 前のレイアウト計算と visibility 同期の両方で同じ基準を使う
  isDebugDockActive() {
    return this.debugDock.isActive(this.isDebugUiEnabled());
  }

  // 現在の debug mode と debug UI 設定に応じて dock の表示状態を同期する
  // update 前に visibility だけ先に合わせ、DOM 側の表示崩れを避ける
  syncDebugDockVisibility() {
    this.debugDock.syncVisibility(this.isDebugDockActive());
    this.dialogue?.syncLayout?.();
  }

  // debug dock には Current State だけを出し、
  // current report から作る summary text をそのまま流す
  updateDebugDock() {
    this.getCurrentDiagnosticsReport();
    this.debugDock.update({
      active: this.isDebugDockActive(),
      diagText: this.getCurrentStateDockText()
    });
  }

  // debug dock の control row を現在の rows から 1 本の text へ整形する
  // copy や save に使う前提で、視覚レイアウトと近い並びを保つ
  formatDebugDockControls() {
    if (!Array.isArray(this.debugDock.rows) || this.debugDock.rows.length <= 0) {
      return "(controls are empty)";
    }
    const rowDataList = this.debugDock.rows.map((row) => this.makeControlRowData(row));
    let maxPrefixWidth = 0;
    for (let i = 0; i < rowDataList.length; i++) {
      const rowData = rowDataList[i];
      if (!rowData.isRawLine && rowData.prefix.length > maxPrefixWidth) {
        maxPrefixWidth = rowData.prefix.length;
      }
    }
    return rowDataList
      .map((rowData) => this.formatDebugDockControlRow(rowData, maxPrefixWidth))
      .join("\n");
  }

  // dock / HUD 共通の row 定義から、媒体ごとの文字列表現に使う部品を作る
  // dock は `label  value  [key]:action` 形式、HUD は `label: value [key] action` 形式へ展開する
  makeControlRowData(row = {}) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("WebgApp.makeControlRowData requires row to be an object");
    }
    if (row.line !== undefined && row.line !== null) {
      const text = String(row.line);
      return {
        isRawLine: true,
        rawLine: text,
        label: "",
        value: "",
        prefix: text,
        dockOperations: "",
        hudNormalOperations: "",
        hudCompactOperations: "",
        note: ""
      };
    }
    const label = String(row.label ?? row.name ?? "item");
    const value = row.value !== undefined && row.value !== null && String(row.value) !== ""
      ? String(row.value)
      : "";
    const dockParts = [];
    const hudNormalParts = [];
    const hudCompactParts = [];
    const pushKey = (key, action) => {
      if (!key) return;
      const safeKey = String(key);
      const safeAction = String(action ?? "").trim();
      dockParts.push(safeAction ? `[${safeKey}]:${safeAction}` : `[${safeKey}]`);
      hudNormalParts.push(safeAction ? `[${safeKey}] ${safeAction}` : `[${safeKey}]`);
      hudCompactParts.push(`[${safeKey}]`);
    };

    if (Array.isArray(row.keys)) {
      for (let i = 0; i < row.keys.length; i++) {
        const item = this.readHudRow(row.keys[i], i, "makeControlRowData");
        pushKey(item.key, item.action ?? "");
      }
    } else {
      pushKey(row.decKey, row.decAction ?? "-");
      pushKey(row.incKey, row.incAction ?? "+");
      pushKey(row.toggleKey, row.toggleAction ?? "toggle");
      pushKey(row.cycleKey, row.cycleAction ?? "cycle");
      pushKey(row.key, row.action ?? "run");
    }

    const prefixParts = [label];
    if (value !== "") {
      prefixParts.push(value);
    }
    return {
      label,
      value,
      prefix: prefixParts.join("  "),
      dockOperations: dockParts.join("  "),
      hudNormalOperations: hudNormalParts.join("  "),
      hudCompactOperations: hudCompactParts.join("  "),
      note: row.note !== undefined && row.note !== null && String(row.note) !== ""
        ? String(row.note)
        : ""
    };
  }

  // 1 件分の row data を debug dock 表示用の 1 行 text へ整形する
  // prefix 幅を外側でそろえたうえで、operation と note を後半へつなぐ
  formatDebugDockControlRow(rowData = {}, maxPrefixWidth = 0) {
    if (rowData.isRawLine) {
      return rowData.rawLine ?? "";
    }
    const parts = [String(rowData.prefix ?? "")];
    if (rowData.dockOperations) {
      parts[0] = parts[0].padEnd(maxPrefixWidth, " ");
      parts.push(rowData.dockOperations);
    }
    if (rowData.note) {
      parts.push(rowData.note);
    }
    if (parts[0].trim() === "") {
      parts[0] = "item";
    }
    return parts.join("  ");
  }

  // HTML debug dock に現在表示している内容を、そのまま section 単位で text 化する
  // 選択コピーを無効にしても、同じ情報を 1 回の copy で AI やメモへ渡せるようにする
  formatDebugDockText() {
    this.getCurrentDiagnosticsReport({ forceRefresh: true });
    return this.debugDock.formatText({
      diagText: this.getCurrentStateDockText({ forceRefresh: true })
    });
  }

  // dock 全体の本文を clipboard へ送る
  // diagnostics text/json とは別に、「dock で今見えている内容そのもの」を共有したいときに使う
  async copyDebugDockText() {
    const copied = await Diagnostics.copyString(this.formatDebugDockText());
    this.diagnosticsCopyState = copied ? "DOCK COPIED" : "DOCK COPY FAILED";
    this.updateDebugDock();
    return copied;
  }

  // canvas HUD 用 row を、通常形 / compact 形 / scale down の順で収める
  // 情報量は保ったまま、まず action 記号を落として幅を節約し、
  // それでも収まらない場合だけ font scale を下げる
  formatHudRowsForCanvas() {
    if (!this.message || !Array.isArray(this.hudRows) || this.hudRows.length <= 0) {
      return {
        lines: [],
        scale: this.messageScale,
        options: { ...this.hudRowsOptions }
      };
    }

    const rowDataList = this.hudRows.map((row) => this.makeControlRowData(row));
    const normalLines = this.buildHudRowLines(rowDataList, false);
    const compactLines = this.buildHudRowLines(rowDataList, true);
    const normalMaxWidth = Math.max(0, ...normalLines.map((line) => line.length));
    const compactMaxWidth = Math.max(0, ...compactLines.map((line) => line.length));
    const baseScale = this.messageScale;
    const minScale = this.hudRowsOptions.minScale === undefined
      ? 0.82
      : Number(this.hudRowsOptions.minScale);
    const baseAvailableCols = this.getHudAvailableCols(baseScale);

    if (normalMaxWidth <= baseAvailableCols) {
      return {
        lines: normalLines,
        scale: baseScale,
        options: normalMaxWidth > 0
          ? { ...this.hudRowsOptions, width: normalMaxWidth }
          : { ...this.hudRowsOptions }
      };
    }

    if (compactMaxWidth <= baseAvailableCols) {
      return {
        lines: compactLines,
        scale: baseScale,
        options: compactMaxWidth > 0
          ? { ...this.hudRowsOptions, width: compactMaxWidth }
          : { ...this.hudRowsOptions }
      };
    }

    const fullColsAtScaleOne = this.getHudAvailableCols(1.0);
    const requiredScale = compactMaxWidth > 0
      ? Math.min(baseScale, fullColsAtScaleOne / compactMaxWidth)
      : baseScale;
    const scale = requiredScale;
    const scaledAvailableCols = this.getHudAvailableCols(scale);
    return {
      lines: compactLines,
      scale,
      options: {
        ...this.hudRowsOptions,
        width: compactMaxWidth || scaledAvailableCols,
        clip: false
      }
    };
  }

  // HUD row は `label: value` を前半、`[key] action` を後半として整形し、
  // key 列の開始位置だけは縦にそろえて追いやすくする
  buildHudRowLines(rowDataList = [], compact = false) {
    let maxPrefixWidth = 0;
    const formatted = rowDataList.map((rowData) => {
      if (rowData.isRawLine) {
        return {
          isRawLine: true,
          rawLine: rowData.rawLine ?? ""
        };
      }
      const prefix = rowData.value !== ""
        ? `${rowData.label}: ${rowData.value}`
        : `${rowData.label}:`;
      if (prefix.length > maxPrefixWidth) {
        maxPrefixWidth = prefix.length;
      }
      return {
        prefix,
        operations: compact ? rowData.hudCompactOperations : rowData.hudNormalOperations,
        note: rowData.note
      };
    });

    return formatted.map((row) => {
      if (row.isRawLine) {
        return row.rawLine;
      }
      const parts = [row.prefix];
      if (row.operations) {
        parts[0] = parts[0].padEnd(maxPrefixWidth, " ");
        parts.push(row.operations);
      }
      if (row.note) {
        parts.push(row.note);
      }
      return parts.join("  ");
    });
  }

  // HUD block に使える列数を scale から計算する
  // width 指定がある場合はそれを優先し、なければ現在 scale で見えている列数を使う
  getHudAvailableCols(scale = this.messageScale) {
    if (Number.isFinite(this.hudRowsOptions.width)) {
      return Math.max(1, Math.floor(this.hudRowsOptions.width));
    }
    return this.message.getLayoutInfo(scale).visibleCols;
  }

  // Message より長い文面を読みやすく出す fixed-format panel を表示する
  // loader 失敗だけでなく、長い diagnostics や調査メモの一時表示にも使える
  showFixedFormatPanel(text, options = {}) {
    return this.fixedFormatPanels.showText(text, {
      ...this.getOverlayLayoutOptions(),
      viewportElement: options.viewportElement ?? this.screen?.canvas ?? null,
      ...options
    });
  }

  // fixed-format panel を閉じる
  clearFixedFormatPanel(panelId = "default") {
    return this.fixedFormatPanels.clear(panelId);
  }

  // 指定 panel が現在表示中かを返す
  hasFixedFormatPanel(panelId = "default") {
    return this.fixedFormatPanels.has(panelId);
  }

  // fixed-format panel をすべて閉じる
  clearAllFixedFormatPanels() {
    this.fixedFormatPanels.clearAll();
  }

  // 起動失敗や重い diagnostics を共通の fixed-format panel で出す
  showErrorPanel(error, options = {}) {
    const fixedFormatPanelTheme = this.uiTheme.fixedFormatPanel;
    const title = options.title ?? `${this.debugTools.system} failed`;
    const message = error?.message ?? String(error ?? "");
    this.setLatestRuntimeError(error, {
      stage: options.stage ?? this.diagnostics?.stage ?? "runtime",
      source: options.source ?? this.debugTools.source ?? "",
      system: options.system ?? this.debugTools.system ?? "app"
    });
    this.updateDebugDock();
    return this.showFixedFormatPanel(`${title}\n${message}`, {
      id: options.id ?? "start-error",
      color: options.color ?? fixedFormatPanelTheme.errorText,
      background: options.background ?? fixedFormatPanelTheme.errorBackground,
      ...options
    });
  }

  // guide / status は 1 行ずつ別 entry にせず block として Message へ渡し、
  // anchor や gap、wrap のような block 用 option がそのまま効くようにする
  buildHudTextBlockEntry(id, lineEntries = [], options = {}, yOffset = 0) {
    if (!Array.isArray(lineEntries) || lineEntries.length <= 0) {
      return null;
    }
    const fallbackColor = Array.isArray(lineEntries[0]?.color)
      ? lineEntries[0].color
      : [1.0, 1.0, 1.0];
    const color = this.readHudColor(options.color, "buildHudTextBlockEntry", fallbackColor);
    return {
      id,
      lines: lineEntries.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error(`WebgApp.buildHudTextBlockEntry requires lineEntries[${index}] to be an object`);
        }
        return String(entry.text);
      }),
      color,
      x: this.readHudOptionalInt(options.x, "buildHudTextBlockEntry", "options.x", 0),
      y: this.readHudOptionalInt(options.y, "buildHudTextBlockEntry", "options.y", 0) + yOffset,
      anchor: options.anchor ?? "top-left",
      offsetX: this.readHudOptionalInt(options.offsetX, "buildHudTextBlockEntry", "options.offsetX", 0),
      offsetY: this.readHudOptionalInt(options.offsetY, "buildHudTextBlockEntry", "options.offsetY", 0),
      gap: this.readHudOptionalInt(options.gap, "buildHudTextBlockEntry", "options.gap", 1),
      align: options.align ?? "left",
      width: options.width === undefined
        ? undefined
        : this.readHudOptionalInt(options.width, "buildHudTextBlockEntry", "options.width", undefined),
      wrap: options.wrap === true,
      clip: options.clip !== false
    };
  }

  // Message に guide / status を流し込み、HUD として重ね描きする
  drawMessages() {
    if (!this.message) return;
    const nowMs = Date.now();
    const entries = [];
    const dockActive = this.isDebugDockActive();
    const drawGuide = !dockActive || this.debugDock.showCanvasHudWhenDockActive;
    const drawStatus = !dockActive || this.debugDock.showCanvasHudWhenDockActive;
    let hudRowsForCanvas = null;
    if (drawGuide) {
      const guideBlock = this.buildHudTextBlockEntry(
        "guide-block",
        this.guideEntries,
        this.guideOptions,
        this.hudLayoutOffsets.guideOffsetY
      );
      if (guideBlock) {
        entries.push(guideBlock);
      }
    }
    if (drawStatus) {
      const statusBlock = this.buildHudTextBlockEntry(
        "status-block",
        this.statusEntries,
        this.statusOptions,
        this.hudLayoutOffsets.statusOffsetY
      );
      if (statusBlock) {
        entries.push(statusBlock);
      }
    }
    if ((drawGuide || drawStatus) && this.hudRows.length > 0) {
      hudRowsForCanvas = this.formatHudRowsForCanvas();
      entries.push({
        id: "hud-rows",
        lines: hudRowsForCanvas.lines,
        color: hudRowsForCanvas.options.color ?? [0.90, 0.95, 1.0],
        x: hudRowsForCanvas.options.x ?? 0,
        y: (hudRowsForCanvas.options.y ?? 0) + this.hudLayoutOffsets.rowsOffsetY,
        anchor: hudRowsForCanvas.options.anchor,
        offsetX: hudRowsForCanvas.options.offsetX,
        offsetY: hudRowsForCanvas.options.offsetY,
        gap: hudRowsForCanvas.options.gap,
        align: hudRowsForCanvas.options.align,
        width: hudRowsForCanvas.options.width,
        wrap: hudRowsForCanvas.options.wrap,
        clip: hudRowsForCanvas.options.clip
      });
      this.message.shader.setScale(hudRowsForCanvas.scale);
    } else {
      this.message.shader.setScale(this.messageScale);
    }
    const gameHudEntries = this.getGameHudEntries(nowMs);
    for (let i = 0; i < gameHudEntries.length; i++) {
      entries.push(gameHudEntries[i]);
    }
    this.message.replaceAll(entries);
    this.message.drawScreen();
    this.message.shader.setScale(this.messageScale);
  }

  // 現在 frame の代表 state を callback 用 object へまとめる
  // sample 側は app 内部 field を個別参照せず、この context だけで update を進められる
  // ここで返す 1 frame の時間差分は `deltaSec` であり、`elapsedSec` という field は含めない
  // `this.elapsedSec` は WebgApp 内部の直近 frame 差分保持用で、callback 側は必ず `ctx.deltaSec` を読む
  getFrameContext(timeMs) {
    return {
      app: this,
      scenePhase: this.getScenePhase(),
      gameHud: this.gameHud,
      dialogue: this.dialogue,
      dialogueState: this.getDialogueState(),
      timeMs,
      timeSec: timeMs * 0.001,
      deltaSec: this.elapsedSec,
      screen: this.screen,
      shader: this.shader,
      space: this.space,
      eye: this.eye,
      cameraRig: this.cameraRig,
      cameraRod: this.cameraRod,
      cameraTarget: [...this.camera.target],
      cameraFollow: this.cameraFollow,
      input: this.input,
      projection: this.projectionMatrix
    };
  }

  // update / draw 各段階で呼ぶ callback をまとめて差し替える
  // sample 側は start() のたびに loop 関数を作らず、この handler 群だけ更新すればよい
  setLoopHandlers(handlers = {}) {
    this.handlers.onUpdate = handlers.onUpdate ?? null;
    this.handlers.onBeforeDraw = handlers.onBeforeDraw ?? null;
    this.handlers.onAfterDraw3d = handlers.onAfterDraw3d ?? null;
    this.handlers.onAfterHud = handlers.onAfterHud ?? null;
  }

  // requestAnimationFrame ループを開始する
  // handlers を先に登録してから running を立て、初回 frame へ進む
  start(handlers = {}) {
    this.setLoopHandlers(handlers);
    this.running = true;
    this.lastFrameTime = 0.0;
    this.runtimeElapsedSec = 0.0;
    this.requestRender();
  }

  // 現在の loop を次 frame から止める
  // sample 側は cleanup や modal 停止でこの入口だけを呼べばよい
  stop() {
    this.running = false;
    this._frameScheduled = false;
  }

  // 現在の page 状態で frame loop を pause すべきかを返す
  // ondemand は hidden または非 focus の間を pause と同じ扱いにする
  shouldAutoPauseFrameLoop() {
    if (this.renderMode === "continuous") {
      return false;
    }
    if (this.doc?.hidden === true) {
      return true;
    }
    if (this.windowHasFocus === false) {
      return true;
    }
    if (this.documentHasFocus === false) {
      return true;
    }
    if (typeof this.doc?.hasFocus === "function" && this.doc.hasFocus() === false) {
      return true;
    }
    return false;
  }

  // page の visible / focus 状態が変わったときに frame loop を再開する
  // ondemand では inactive 中に描画を止めるため、復帰時はここから 1 回目を起こす
  handlePageActivityChange() {
    if (!this.running || this.renderMode === "continuous") {
      return false;
    }
    if (this.shouldAutoPauseFrameLoop()) {
      this.lastFrameTime = 0.0;
      return false;
    }
    this.lastFrameTime = 0.0;
    return this.requestRender();
  }

  // requestAnimationFrame の予約を 1 本に保つ
  // ondemand で sleep 中はここから起こすため、sample 側からも共通入口として使える
  requestRender() {
    if (!this.running || this._frameScheduled) {
      return false;
    }
    if (this.shouldAutoPauseFrameLoop()) {
      return false;
    }
    this._frameScheduled = true;
    requestAnimationFrame(this._frame);
    return true;
  }

  // 1 frame 分の update / draw / HUD / present を進める
  // WebgApp の実行順序をここへ集約し、sample 側は onUpdate などの差し込みだけに集中させる
  frame(timeMs) {
    this._frameScheduled = false;
    if (!this.running) return;
    if (this.shouldAutoPauseFrameLoop()) {
      this.lastFrameTime = 0.0;
      return;
    }

    const previous = this.lastFrameTime || timeMs;
    const deltaMs = timeMs - previous;
    if (!Number.isFinite(deltaMs) || deltaMs < 0.0) {
      throw new Error(`WebgApp.frame requires non-negative time delta: previous=${previous} current=${timeMs}`);
    }
    this.elapsedSec = deltaMs * 0.001;
    this.runtimeElapsedSec += this.elapsedSec;
    this.lastFrameTime = timeMs;
    this.updateManagedEyeRig(this.elapsedSec);
    const ctx = this.getFrameContext(timeMs);

    if (this.handlers.onUpdate) {
      const shouldStop = this.handlers.onUpdate(ctx);
      if (shouldStop === true) {
        this.running = false;
        return;
      }
    }

    this.updateTweens(deltaMs);
    if (this.space?.update) {
      this.space.update(deltaMs);
    } else if (this.space?.updateShapeAnimations) {
      this.space.updateShapeAnimations(deltaMs);
    }
    this.updateParticleEmitters(deltaMs);
    this.updateCameraTarget(this.elapsedSec);
    if (this.eyeRigOptions.syncCamera) {
      this.syncCameraFromEyeRig(this.eyeRig);
    }
    this.updateCameraEffects(timeMs);
    this.dialogue?.syncLayout?.();

    this.screen.clear();
    if (this.handlers.onBeforeDraw) {
      this.handlers.onBeforeDraw(ctx);
    }
    if (this.autoDrawScene) {
      this.space.draw(this.eye);
    }
    if (this.autoDrawBones) {
      this.space.scanSkeletons();
      this.space.drawBones();
    }
    if (this.handlers.onAfterDraw3d) {
      this.handlers.onAfterDraw3d(ctx);
    }
    this.drawParticleEmitters();
    this.drawMessages();
    if (this.handlers.onAfterHud) {
      this.handlers.onAfterHud(ctx);
    }
    this.screen.present();
    if (this.input?.beginFrame) {
      this.input.beginFrame();
    }

    if (this.running) {
      this.requestRender();
    }
  }
}
