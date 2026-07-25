// ---------------------------------------------
// samples/mmodeler/ViewController.js  2026/05/26
//   view state controller for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// mmodeler の表示状態を保持する
// camera や WebGPU の実更新は main.js 側の既存処理へ委譲し、この class は表示 state の所有者になる
export default class ViewController {
  constructor({
    perspectiveMode,
    orthographicMode,
    initialProjectionMode = perspectiveMode,
    initialObjectWireframe = false,
    initialObjectSmoothShading = false,
    initialLightBackground = false,
    initialVisiblePickOnly = true,
    initialViewAxis = "z",
    initialViewFlip = false
  }) {
    if (!perspectiveMode || !orthographicMode) {
      throw new Error("ViewController requires projection mode names");
    }
    this.perspectiveMode = perspectiveMode;
    this.orthographicMode = orthographicMode;
    this.projectionMode = initialProjectionMode;
    this.objectWireframe = initialObjectWireframe === true;
    this.objectSmoothShading = initialObjectSmoothShading === true;
    this.lightBackground = initialLightBackground === true;
    this.visiblePickOnly = initialVisiblePickOnly !== false;
    this.viewAxis = initialViewAxis;
    this.viewFlip = initialViewFlip === true;
    this.effects = {
      applyProjection: null,
      rebuildScene: null,
      applyBackgroundColor: null,
      updateMobileRibbon: null,
      setOrbitViewPreset: null,
      setMessage: null
    };
  }

  // WebGPU、camera、DOM に触れる処理を callback として登録する
  // ViewController は表示 state の所有者だが、app / orbit / DOM の具体的な object は main.js 側に残す
  setEffects({
    applyProjection,
    rebuildScene,
    applyBackgroundColor,
    updateMobileRibbon,
    setOrbitViewPreset,
    setMessage
  }) {
    this.effects.applyProjection = applyProjection;
    this.effects.rebuildScene = rebuildScene;
    this.effects.applyBackgroundColor = applyBackgroundColor;
    this.effects.updateMobileRibbon = updateMobileRibbon;
    this.effects.setOrbitViewPreset = setOrbitViewPreset;
    this.effects.setMessage = setMessage;
  }

  // 必須 callback を取得する
  // 未登録のまま command を実行すると処理が黙って欠けるため、明示的な error にする
  requireEffect(name) {
    const effect = this.effects[name];
    if (typeof effect !== "function") {
      throw new Error(`ViewController requires effect: ${name}`);
    }
    return effect;
  }

  // projection が orthographic かを返す
  // z bias、camera distance 補正、projection 更新の分岐で使う
  isOrthographic() {
    return this.projectionMode === this.orthographicMode;
  }

  // projection が perspective かを返す
  isPerspective() {
    return this.projectionMode === this.perspectiveMode;
  }

  // status / HUD に表示する短い projection 名を返す
  getProjectionLabel() {
    return this.isOrthographic() ? "Ortho" : "Persp";
  }

  // perspective / orthographic を切り替え、切り替え後の mode 名を返す
  toggleProjectionMode() {
    this.projectionMode = this.isOrthographic()
      ? this.perspectiveMode
      : this.orthographicMode;
    return this.projectionMode;
  }

  // projection command を実行する
  // state を切り替えた後、main.js 側の projection 更新 callback で WebGPU 行列と status を更新する
  runToggleProjectionCommand() {
    this.toggleProjectionMode();
    this.requireEffect("applyProjection")({
      force: true,
      announce: true
    });
  }

  // mesh 本体を wireframe 表示するかを切り替える
  toggleObjectWireframe() {
    this.objectWireframe = !this.objectWireframe;
    return this.objectWireframe;
  }

  // object wireframe command を実行する
  // mesh 本体の shader / geometry 表示が変わるため、scene rebuild は callback へ委譲する
  runToggleObjectWireframeCommand() {
    this.toggleObjectWireframe();
    this.requireEffect("rebuildScene")();
    this.requireEffect("setMessage")(`wireframe ${this.objectWireframe ? "on" : "off"}`);
  }

  // mesh wireframe 表示を明示的に無効化する
  // Edit Mode へ入るときなど、表示役割が edge overlay と混ざる場面で使う
  disableObjectWireframe() {
    this.objectWireframe = false;
  }

  // mesh 本体を smooth shading 表示にするかを切り替える
  // geometry は共有頂点のまま維持し、SmoothShader の flat_shading parameter だけを切り替える
  toggleObjectSmoothShading() {
    this.objectSmoothShading = !this.objectSmoothShading;
    return this.objectSmoothShading;
  }

  // smooth shading command を実行する
  // Shape の material parameter が変わるため、mesh 本体を再構築して shader parameter を流し直す
  runToggleObjectSmoothShadingCommand() {
    this.toggleObjectSmoothShading();
    this.requireEffect("rebuildScene")();
    this.requireEffect("setMessage")(`smooth shading ${this.objectSmoothShading ? "on" : "off"}`);
  }

  // 背景色 theme を切り替える
  toggleLightBackground() {
    this.lightBackground = !this.lightBackground;
    return this.lightBackground;
  }

  // background command を実行する
  // clear color の実反映は app / screen を知っている main.js 側 callback へ委譲する
  runToggleLightBackgroundCommand() {
    this.toggleLightBackground();
    this.requireEffect("applyBackgroundColor")();
    this.requireEffect("setMessage")(`background ${this.lightBackground ? "light gray" : "dark"}`);
  }

  // visible pick の対象を手前だけにするか、奥の要素も通すかを切り替える
  toggleVisiblePickOnly() {
    this.visiblePickOnly = !this.visiblePickOnly;
    return this.visiblePickOnly;
  }

  // visible pick command を実行する
  // pick 判定そのものは main.js 側の既存関数がこの state を読む
  runToggleVisiblePickOnlyCommand() {
    this.toggleVisiblePickOnly();
    this.requireEffect("setMessage")(`visible pick ${this.visiblePickOnly ? "only" : "through"}`);
  }

  // mobile view dock の現在選択を保存する
  // 実際の camera preset 適用は main.js 側の orbit 操作に委譲する
  setMobileAxisView(axis, reversed = false) {
    const normalized = String(axis ?? "").toLowerCase();
    if (normalized !== "x" && normalized !== "y" && normalized !== "z") {
      return false;
    }
    this.viewAxis = normalized;
    this.viewFlip = reversed === true;
    return true;
  }

  // mobile view dock の command を実行する
  // camera preset の適用は orbit を知っている main.js 側 callback へ委譲する
  runSetMobileAxisViewCommand(axis, reversed = false) {
    if (!this.setMobileAxisView(axis, reversed)) {
      return false;
    }
    this.requireEffect("updateMobileRibbon")();
    const presetKey = this.viewAxis === "x"
      ? "3"
      : this.viewAxis === "y"
        ? "7"
        : "1";
    return this.requireEffect("setOrbitViewPreset")(presetKey, this.viewFlip);
  }

  // mobile view button が現在の view state と一致するかを返す
  isMobileAxisViewActive(axis, reversed = false) {
    return this.viewAxis === axis && this.viewFlip === (reversed === true);
  }
}
