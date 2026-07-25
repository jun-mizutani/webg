// ---------------------------------------------
// CameraFrame.js  2026/07/13
//   Immutable per-frame camera-relative coordinate snapshot
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Matrix from "./Matrix.js";
import { CAMERA_REVERSE_Z, readDepthRange, requireDepthConvention } from "./DepthConvention.js";
import util from "./util.js";

// renderFrameTokenはCameraFrameを公開APIへ直接露出しない描画フレーム識別子です。
// WeakMapだけが対応するframeを保持し、利用者側からnear/far、projection、depth方式を読めません。
const renderFrameTokenCameraFrames = new WeakMap();

class RenderFrameToken {}

// 4x4 Matrixとして利用でき、全要素が有限であることをCPU側で確認します
// 不正行列をGPUへ送って画面全体が消える状態にせず、frame生成時点で停止します
function readMatrix(value, label) {
  if (!value?.mat || value.mat.length !== 16) {
    throw new Error(`${label} must be a 4x4 Matrix`);
  }
  for (let index = 0; index < 16; index += 1) {
    util.readFiniteNumber(value.mat[index], `${label}[${index}]`);
  }
  return value;
}

// Spaceの単純forward描画が内部利用するcamera transform snapshotです
// projection情報を持たず、World座標を倍精度で相対化する責務だけに限定します
class CameraTransformFrame {
  constructor(cameraWorldMatrix, label = "Camera transform worldMatrix") {
    const sourceWorld = readMatrix(cameraWorldMatrix, label);
    this.cameraWorldMatrix = sourceWorld.clone();
    this.cameraWorldPosition = Object.freeze(this.cameraWorldMatrix.getPosition());

    // inverse camera matrixの3x3だけをview回転として保持します
    // 大きなcamera平行移動はこの行列へ含めず、World位置との差を先に明示計算します
    this.viewRotationMatrix = this.cameraWorldMatrix.clone();
    this.viewRotationMatrix.inverse();
    this.viewRotationMatrix.position([0.0, 0.0, 0.0]);

  }

  // World pointからカメラWorld位置をJavaScript倍精度で減算します
  worldPointToCameraRelative(worldPoint) {
    const point = util.readVec3(worldPoint, "CameraFrame worldPoint");
    return [
      point[0] - this.cameraWorldPosition[0],
      point[1] - this.cameraWorldPosition[1],
      point[2] - this.cameraWorldPosition[2]
    ];
  }

  // 倍精度で小さくしたcamera-relative値だけをGPU用float32へ変換します
  worldPointToCameraRelativeF32(worldPoint) {
    return new Float32Array(this.worldPointToCameraRelative(worldPoint));
  }

  // camera-relative pointへカメラの逆回転を適用し、view-space pointを返します
  cameraRelativePointToView(cameraRelativePoint) {
    const point = util.readVec3(cameraRelativePoint, "CameraFrame cameraRelativePoint");
    return this.viewRotationMatrix.mul3x3Vector(point);
  }

  // World pointを倍精度でcamera-relativeへ変換してからview-spaceへ回転します
  worldPointToView(worldPoint) {
    return this.cameraRelativePointToView(this.worldPointToCameraRelative(worldPoint));
  }

  // object World matrixの平行移動だけをcamera-relativeへ置換し、view-space model matrixを作ります
  // 回転とscaleは元行列から維持し、大きな平行移動を含むview×modelの相殺をGPUへ持ち込みません
  createModelViewMatrix(objectWorldMatrix) {
    const world = readMatrix(objectWorldMatrix, "CameraFrame objectWorldMatrix");
    const relativeWorld = world.clone();
    relativeWorld.position(this.worldPointToCameraRelative(world.getPosition()));
    relativeWorld.lmul(this.viewRotationMatrix);
    return relativeWorld;
  }
}

// 一つのframeで複数の描画passが共有する完全なカメラ状態を確定します
// CameraTransformFrameの相対座標変換に、Reverse-Z投影情報を追加します
export default class CameraFrame extends CameraTransformFrame {
  constructor({ cameraWorldMatrix, near, far, vfov, aspect, depthConvention }) {
    const convention = requireDepthConvention(depthConvention, "CameraFrame depthConvention");
    if (convention !== CAMERA_REVERSE_Z) {
      throw new Error("CameraFrame requires CAMERA_REVERSE_Z");
    }
    super(cameraWorldMatrix, "CameraFrame cameraWorldMatrix");
    const range = readDepthRange(near, far, "CameraFrame", { allowInfiniteFar: true });
    this.near = range.near;
    this.far = range.far;
    this.infiniteFar = range.infiniteFar;
    this.vfov = util.readFiniteNumber(vfov, "CameraFrame vfov", {
      minExclusive: 0.0,
      maxExclusive: 180.0
    });
    this.aspect = util.readFiniteNumber(aspect, "CameraFrame aspect", { minExclusive: 0.0 });
    this.depthConvention = convention;
    this.projectionMatrix = new Matrix().makeProjectionMatrix(
      this.near,
      this.far,
      this.vfov,
      this.aspect
    );
  }
}

// 低レベル公開APIのSpace.draw(eye)用に、投影情報を要求せず変換snapshotだけを作ります
// eye更新と内部class生成はSpace側へ隠し、利用者へCameraFrame構築を要求しません
export function createCameraTransformFrameFromEye(eye, label = "camera transform") {
  if (!eye || typeof eye.setWorldMatrix !== "function" || !eye.worldMatrix) {
    throw new Error(`${label} requires an eye Node or render frame`);
  }
  eye.setWorldMatrix();
  return new CameraTransformFrame(eye.worldMatrix, `${label} eye worldMatrix`);
}

// eye NodeのWorld matrixを一度だけ更新し、そのsnapshotからCamera Frameを作ります
// 呼び出し側は返されたframeを同じ描画frame内の全passへ共有します
export function createCameraFrameFromEye(eye, options) {
  if (!eye || typeof eye.setWorldMatrix !== "function" || !eye.worldMatrix) {
    throw new Error("createCameraFrameFromEye requires an eye with worldMatrix");
  }
  eye.setWorldMatrix();
  return new CameraFrame({ ...options, cameraWorldMatrix: eye.worldMatrix });
}

// WebgAppがframe開始時に作った完全なCameraFrameへ、公開callback用のtokenを対応付けます。
// 毎frame新しいtokenを作るため、複数passは同じobject identityを比較してframe混在を検出できます。
export function createRenderFrameToken(cameraFrame) {
  if (!(cameraFrame instanceof CameraFrame)) {
    throw new Error("createRenderFrameToken requires a CameraFrame");
  }
  const renderFrameToken = new RenderFrameToken();
  renderFrameTokenCameraFrames.set(renderFrameToken, cameraFrame);
  return Object.freeze(renderFrameToken);
}

// Spaceなどのコア所有者が、例外を使わずにeye NodeとrenderFrameTokenを区別する判定です。
// property形状ではなくWeakMap登録identityだけを確認するため、利用側の偽装objectを受理しません。
export function isRenderFrameToken(value) {
  return renderFrameTokenCameraFrames.has(value);
}

// depth復元を所有するコアpassだけがrenderFrameTokenからCameraFrameを解決します。
// shapeが似た任意objectや前世代のcamera入力は受け入れず、不正な公開入力を即時停止します。
export function resolveRenderFrameTokenCameraFrame(renderFrameToken, label = "renderFrameToken") {
  const cameraFrame = renderFrameTokenCameraFrames.get(renderFrameToken);
  if (!cameraFrame) {
    throw new Error(`${label} requires a renderFrameToken from WebgApp`);
  }
  return cameraFrame;
}
