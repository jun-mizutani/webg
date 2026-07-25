// ---------------------------------------------
// webg/ShadowMapPass.js  2026/07/20
//   Directional shadow map pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Matrix from "./Matrix.js";
import util from "./util.js";
import { CAMERA_REVERSE_Z, SHADOW_STANDARD_Z } from "./DepthConvention.js";
import {
  DEFAULT_MAX_SKIN_BONES,
  SKIN_MATRIX_FLOATS_PER_BONE,
  SKIN_MATRIX_VECTORS_PER_BONE
} from "./SkinningConfig.js";

export const SHADOW_MAP_DEPTH_FORMAT = SHADOW_STANDARD_Z.format;

// 3要素の方向vectorを長さ1へ正規化し、方向を決められない入力は例外にする
function normalizeDirection(value, label) {
  const vector = util.readColor(value, label, undefined, 3);
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= 1.0e-8) {
    throw new Error(`${label} has zero length`);
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

// 2個の3次元vectorから外積を作り、光源cameraの直交basis構築に使う
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// 3D vector加算を共通化し、視錐台cornerやfit targetの補正で同じ規則を使う
function addVec3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// 3D vector減算を共通化し、視錐台8頂点の組み立て時に符号ミスを避ける
function subVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// basis vectorへ scalar を掛ける単純操作を関数へ寄せ、手書き展開を減らす
function scaleVec3(v, scale) {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

// 視錐台8頂点の重心を取り、暫定light cameraの注視中心として使う
function averagePoints(points) {
  const sum = [0.0, 0.0, 0.0];
  for (const point of points) {
    sum[0] += point[0];
    sum[1] += point[1];
    sum[2] += point[2];
  }
  return scaleVec3(sum, 1.0 / points.length);
}

// webg camera world matrix の列から right / up / back / position を取り出す
// local -Z が前方なので、forward は back 列の逆向きとして扱う
function getCameraBasis(world) {
  const m = world.mat;
  return {
    right: [m[0], m[1], m[2]],
    up: [m[4], m[5], m[6]],
    back: [m[8], m[9], m[10]],
    position: [m[12], m[13], m[14]]
  };
}

// camera の near / far 平面上の8頂点を world-space で求める
// fitFar を使う場合も、ここでは「切り詰め後の far」を渡すだけで済むようにする
function createCameraFrustumCornersWorld(cameraWorld, vfovRad, aspect, near, far) {
  const basis = getCameraBasis(cameraWorld);
  const forward = scaleVec3(basis.back, -1.0);
  const nearCenter = addVec3(basis.position, scaleVec3(forward, near));
  const farCenter = addVec3(basis.position, scaleVec3(forward, far));
  const nearHalfHeight = Math.tan(vfovRad * 0.5) * near;
  const nearHalfWidth = nearHalfHeight * aspect;
  const farHalfHeight = Math.tan(vfovRad * 0.5) * far;
  const farHalfWidth = farHalfHeight * aspect;

  const nearUp = scaleVec3(basis.up, nearHalfHeight);
  const nearRight = scaleVec3(basis.right, nearHalfWidth);
  const farUp = scaleVec3(basis.up, farHalfHeight);
  const farRight = scaleVec3(basis.right, farHalfWidth);

  return [
    addVec3(addVec3(nearCenter, nearUp), nearRight),
    addVec3(subVec3(nearCenter, nearUp), nearRight),
    subVec3(addVec3(nearCenter, nearUp), nearRight),
    subVec3(subVec3(nearCenter, nearUp), nearRight),
    addVec3(addVec3(farCenter, farUp), farRight),
    addVec3(subVec3(farCenter, farUp), farRight),
    subVec3(addVec3(farCenter, farUp), farRight),
    subVec3(subVec3(farCenter, farUp), farRight)
  ];
}

// world-space 点群を任意の view 行列へ通し、その空間内 AABB を求める
// directional light ではこの bounds を正射影の width / height / depth 決定に使う
function computeViewSpaceBounds(view, points) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    const transformed = view.mulVector(point);
    minX = Math.min(minX, transformed[0]);
    minY = Math.min(minY, transformed[1]);
    minZ = Math.min(minZ, transformed[2]);
    maxX = Math.max(maxX, transformed[0]);
    maxY = Math.max(maxY, transformed[1]);
    maxZ = Math.max(maxZ, transformed[2]);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// light-space 中心を shadow map texel へ揃え、camera 移動時の shadow swimming を減らす
function snapCenterToTexel(centerValue, halfExtent, mapSize) {
  const texelSize = (halfExtent * 2.0) / mapSize;
  if (!(texelSize > 0.0)) {
    return centerValue;
  }
  return Math.round(centerValue / texelSize) * texelSize;
}

// directional lightの方向、注視中心、描画範囲からview、projection、view-projectionを作る
// directionは光が進むworld-space方向で、camera位置はtargetから逆方向へdistanceだけ離す
export function createDirectionalLightMatrices(options = {}) {
  const direction = normalizeDirection(
    options.direction,
    "directional shadow direction"
  );
  const target = util.readColor(
    options.target,
    "directional shadow target",
    undefined,
    3
  );
  const distance = util.readFiniteNumber(
    options.distance,
    "directional shadow distance",
    { minExclusive: 0 }
  );
  const halfWidth = util.readFiniteNumber(
    options.halfWidth,
    "directional shadow halfWidth",
    { minExclusive: 0 }
  );
  const halfHeight = util.readFiniteNumber(
    options.halfHeight,
    "directional shadow halfHeight",
    { minExclusive: 0 }
  );
  const near = util.readFiniteNumber(
    options.near,
    "directional shadow near",
    { minExclusive: 0 }
  );
  const far = util.readFiniteNumber(
    options.far,
    "directional shadow far",
    { minExclusive: near }
  );
  const worldUp = normalizeDirection(
    options.up ?? [0, 1, 0],
    "directional shadow up"
  );

  // webg cameraはlocal -Zを前方とするため、world matrixのZ列には光の逆方向を置く
  const back = [-direction[0], -direction[1], -direction[2]];
  const rightRaw = cross(worldUp, back);
  const rightLength = Math.hypot(rightRaw[0], rightRaw[1], rightRaw[2]);
  if (rightLength <= 1.0e-8) {
    throw new Error("directional shadow direction must not be parallel to up");
  }
  const right = rightRaw.map((value) => value / rightLength);
  const up = normalizeDirection(cross(back, right), "directional shadow camera up");
  const position = [
    target[0] - direction[0] * distance,
    target[1] - direction[1] * distance,
    target[2] - direction[2] * distance
  ];

  const world = new Matrix();
  world.setBulk([
    right[0], right[1], right[2], 0,
    up[0], up[1], up[2], 0,
    back[0], back[1], back[2], 0,
    position[0], position[1], position[2], 1
  ]);
  const view = new Matrix();
  view.makeView(world);
  const projection = new Matrix();
  // 方向光Shadow Mapは有限範囲の正射影であり、第一実装期は通常Zを明示して生成する
  projection.makeProjectionMatrixOrtho(
    near,
    far,
    halfWidth,
    halfHeight,
    SHADOW_STANDARD_Z
  );
  const viewProjection = projection.clone();
  viewProjection.mul_(view);

  return {
    direction,
    target,
    position,
    world,
    view,
    projection,
    viewProjection,
    halfWidth,
    halfHeight,
    near,
    far,
    up
  };
}

// camera 視錐台を directional light の light-space AABB へ変換し、その範囲だけを shadow map へ割り当てる
// 視錐台自体の形は near / far / fov / aspect で決まるが、light-space AABB は camera と light の相対姿勢で変化する
export function createFrustumFitDirectionalLightMatrices(options = {}) {
  const direction = normalizeDirection(
    options.direction,
    "directional shadow direction"
  );
  const cameraFrame = options.cameraFrame;
  if (!cameraFrame || cameraFrame.depthConvention !== CAMERA_REVERSE_Z) {
    throw new Error("directional shadow frustum-fit requires a Reverse-Z CameraFrame");
  }
  const cameraWorld = cameraFrame.cameraWorldMatrix;
  if (!cameraWorld?.mat || cameraWorld.mat.length !== 16) {
    throw new Error("directional shadow CameraFrame cameraWorldMatrix must be a 4x4 Matrix");
  }
  const cameraNear = util.readFiniteNumber(
    cameraFrame.near,
    "directional shadow CameraFrame near",
    { minExclusive: 0.0 }
  );
  const cameraFar = cameraFrame.far;
  if (cameraFar !== Infinity) {
    util.readFiniteNumber(
      cameraFar,
      "directional shadow CameraFrame far",
      { minExclusive: cameraNear }
    );
  }
  const vfovRad = util.readFiniteNumber(
    cameraFrame.vfov * Math.PI / 180.0,
    "directional shadow CameraFrame vfovRad",
    { minExclusive: 0.0, maxExclusive: Math.PI }
  );
  const aspect = util.readFiniteNumber(
    cameraFrame.aspect,
    "directional shadow CameraFrame aspect",
    { minExclusive: 0.0 }
  );
  let fitFar;
  if (options.fitFar === undefined || options.fitFar === null) {
    if (cameraFar === Infinity) {
      throw new Error("directional shadow frustum-fit requires finite fitFar for an infinite-far CameraFrame");
    }
    fitFar = cameraFar;
  } else {
    fitFar = util.readFiniteNumber(
      options.fitFar,
      "directional shadow fitFar",
      {
        minExclusive: cameraNear,
        ...(cameraFar === Infinity ? {} : { max: cameraFar })
      }
    );
  }
  const distance = util.readFiniteNumber(
    options.distance,
    "directional shadow distance",
    { minExclusive: 0 }
  );
  const xyPadding = util.readOptionalFiniteNumber(
    options.xyPadding,
    "directional shadow xyPadding",
    0.8,
    { min: 0 }
  );
  const depthPadding = util.readOptionalFiniteNumber(
    options.depthPadding,
    "directional shadow depthPadding",
    4.0,
    { min: 0 }
  );
  const minHalfExtent = util.readOptionalFiniteNumber(
    options.minHalfExtent,
    "directional shadow minHalfExtent",
    1.0,
    { minExclusive: 0 }
  );
  const minNear = util.readOptionalFiniteNumber(
    options.minNear,
    "directional shadow minNear",
    0.2,
    { minExclusive: 0 }
  );
  const texelSnap = util.readOptionalBoolean(
    options.texelSnap,
    "directional shadow texelSnap",
    true
  ) === true;
  const mapSize = util.readOptionalInteger(
    options.mapSize,
    "directional shadow mapSize",
    1024,
    { min: 1 }
  );
  const up = options.up ?? [0, 1, 0];

  const corners = createCameraFrustumCornersWorld(
    cameraWorld,
    vfovRad,
    aspect,
    cameraNear,
    fitFar
  );
  const frustumCenter = averagePoints(corners);
  const provisional = createDirectionalLightMatrices({
    direction,
    target: frustumCenter,
    distance,
    halfWidth: 1,
    halfHeight: 1,
    near: 1,
    far: 2,
    up
  });

  // provisional view で bounds を測り、light-space 中心と half extent を確定させる
  const provisionalBounds = computeViewSpaceBounds(provisional.view, corners);
  let centerX = (provisionalBounds.minX + provisionalBounds.maxX) * 0.5;
  let centerY = (provisionalBounds.minY + provisionalBounds.maxY) * 0.5;
  const halfWidth = Math.max(
    minHalfExtent,
    (provisionalBounds.maxX - provisionalBounds.minX) * 0.5 + xyPadding
  );
  const halfHeight = Math.max(
    minHalfExtent,
    (provisionalBounds.maxY - provisionalBounds.minY) * 0.5 + xyPadding
  );
  if (texelSnap) {
    centerX = snapCenterToTexel(centerX, halfWidth, mapSize);
    centerY = snapCenterToTexel(centerY, halfHeight, mapSize);
  }

  const lightBasis = getCameraBasis(provisional.world);
  const adjustedTarget = addVec3(
    addVec3(frustumCenter, scaleVec3(lightBasis.right, centerX)),
    scaleVec3(lightBasis.up, centerY)
  );
  const adjusted = createDirectionalLightMatrices({
    direction,
    target: adjustedTarget,
    distance,
    halfWidth,
    halfHeight,
    near: 1,
    far: 2,
    up
  });
  const adjustedBounds = computeViewSpaceBounds(adjusted.view, corners);
  const near = Math.max(
    minNear,
    -adjustedBounds.maxZ - depthPadding
  );
  const far = Math.max(
    near + 0.1,
    -adjustedBounds.minZ + depthPadding
  );

  return {
    ...createDirectionalLightMatrices({
      direction,
      target: adjustedTarget,
      distance,
      halfWidth,
      halfHeight,
      near,
      far,
      up
    }),
    fitFar,
    fitTarget: adjustedTarget,
    bounds: adjustedBounds
  };
}

// 光源視点のdepthだけを生成し、後段がsampleできるtextureとして公開する
// 標準Shapeのstatic頂点とskinning頂点を同じSpace走査から収集し、通常描画と同じ姿勢を影へ反映する
export default class ShadowMapPass {
  // shadow mapの固定解像度とdepth formatを検証し、depth-only pipelineを構築する
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ShadowMapPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.device = gpu.device;
    this.label = util.readOptionalString(
      options.label,
      "ShadowMapPass label",
      "shadow-map",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(
      options.width,
      `${this.label} width`,
      1024,
      { min: 1 }
    );
    this.height = util.readOptionalInteger(
      options.height,
      `${this.label} height`,
      1024,
      { min: 1 }
    );
    if (options.depthFormat !== undefined) {
      throw new Error(
        `${this.label} depthFormat option was removed; ShadowMapPass uses SHADOW_STANDARD_Z`
      );
    }
    // Shadow Mapは通常カメラのReverse-Zとは別の変更不能な通常Z契約を使用する
    // formatだけをoptionで差し替える部分移行を許さず、clearとcompareも同じobjectから取得する
    this.depthConvention = SHADOW_STANDARD_Z;
    this.depthFormat = this.depthConvention.format;
    this.entries = new Map();
    this.skinEntries = new WeakMap();
    this.skinEntryList = [];
    this.dummySkinBuffer = null;
    this.retiredDummySkinBuffers = [];
    this.dummySkinVertexCapacity = 0;
    this.boneDataSize = DEFAULT_MAX_SKIN_BONES * SKIN_MATRIX_FLOATS_PER_BONE;
    this.boneUniformSize = this.boneDataSize * Float32Array.BYTES_PER_ELEMENT;
    this.depthTexture = null;
    this.depthView = null;
    this.depthSampleView = null;
    this.destroyed = false;

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label}:draw-layout`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" }
      }]
    });
    this.skinBindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label}:skin-layout`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" }
      }]
    });
    this.createDefaultSkinResources();
    this.pipeline = this.createPipeline();
    this.createDepthTexture();
    this.ready = Promise.resolve(this);
  }

  // static Shapeがskinning共通pipelineを使うための正式な空bone paletteを生成する
  // skinning有効時にpaletteが欠けた場合の代替ではなく、flags.x=0の描画だけで使用する
  createDefaultSkinResources() {
    this.defaultBoneBuffer = this.device.createBuffer({
      label: `${this.label}:default-bones`,
      size: this.boneUniformSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.defaultBoneBindGroup = this.device.createBindGroup({
      label: `${this.label}:default-bone-bind-group`,
      layout: this.skinBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.defaultBoneBuffer } }]
    });
  }

  // positionとbone情報を読み、現在姿勢を適用してlight clip-spaceへ変換する
  // SmoothShaderとGeometryBufferPassと同じ3 x vec4 palette表現を使い、行列規則を分岐させない
  createPipeline() {
    const module = this.device.createShaderModule({
      label: `${this.label}:shader`,
      code: `
struct DrawUniforms {
  lightViewProjection : mat4x4f,
  model : mat4x4f,
  flags : vec4f,
};

struct SkinUniforms {
  bones : array<vec4f, ${DEFAULT_MAX_SKIN_BONES * SKIN_MATRIX_VECTORS_PER_BONE}>,
};

@group(0) @binding(0) var<uniform> uniforms : DrawUniforms;
@group(1) @binding(0) var<uniform> skin : SkinUniforms;

struct VertexInput {
  @location(0) position : vec3f,
  @location(1) boneIndex : vec4f,
  @location(2) boneWeight : vec4f,
};

@vertex
fn vsMain(input : VertexInput) -> @builtin(position) vec4f {
  var skinMatrix = mat4x4f(
    vec4f(1.0, 0.0, 0.0, 0.0),
    vec4f(0.0, 1.0, 0.0, 0.0),
    vec4f(0.0, 0.0, 1.0, 0.0),
    vec4f(0.0, 0.0, 0.0, 1.0)
  );
  if (uniforms.flags.x != 0.0) {
    let i0 = i32(input.boneIndex.x) * 3;
    let i1 = i32(input.boneIndex.y) * 3;
    let i2 = i32(input.boneIndex.z) * 3;
    let i3 = i32(input.boneIndex.w) * 3;
    let v0 = skin.bones[i0] * input.boneWeight.x
      + skin.bones[i1] * input.boneWeight.y
      + skin.bones[i2] * input.boneWeight.z
      + skin.bones[i3] * input.boneWeight.w;
    let v1 = skin.bones[i0 + 1] * input.boneWeight.x
      + skin.bones[i1 + 1] * input.boneWeight.y
      + skin.bones[i2 + 1] * input.boneWeight.z
      + skin.bones[i3 + 1] * input.boneWeight.w;
    let v2 = skin.bones[i0 + 2] * input.boneWeight.x
      + skin.bones[i1 + 2] * input.boneWeight.y
      + skin.bones[i2 + 2] * input.boneWeight.z
      + skin.bones[i3 + 2] * input.boneWeight.w;
    skinMatrix[0] = vec4f(v0.x, v1.x, v2.x, 0.0);
    skinMatrix[1] = vec4f(v0.y, v1.y, v2.y, 0.0);
    skinMatrix[2] = vec4f(v0.z, v1.z, v2.z, 0.0);
    skinMatrix[3] = vec4f(v0.w, v1.w, v2.w, 1.0);
  }
  return uniforms.lightViewProjection
    * uniforms.model
    * skinMatrix
    * vec4f(input.position, 1.0);
}`
    });
    return this.device.createRenderPipeline({
      label: `${this.label}:pipeline`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout, this.skinBindGroupLayout]
      }),
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 8 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
          },
          {
            arrayStride: 8 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [
              { shaderLocation: 1, offset: 0, format: "float32x4" },
              { shaderLocation: 2, offset: 4 * 4, format: "float32x4" }
            ]
          }
        ]
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back",
        frontFace: "ccw"
      },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: true,
        depthCompare: this.depthConvention.compare
      }
    });
  }

  // Render Pass書き込みと後段texture bindingの両方に使えるdepth textureを生成する
  createDepthTexture() {
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: `${this.label}:depth`,
      size: [this.width, this.height, 1],
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.depthView = this.depthTexture.createView();
    this.depthSampleView = this.depthTexture.createView();
  }

  // Skeletonごとのbone palette Bufferを初回だけ作り、現在姿勢をdraw直前に転送する
  getSkinBindGroup(skeleton) {
    if (!skeleton) {
      return this.defaultBoneBindGroup;
    }
    let entry = this.skinEntries.get(skeleton);
    if (!entry) {
      const buffer = this.device.createBuffer({
        label: `${this.label}:bone-palette`,
        size: this.boneUniformSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      entry = {
        buffer,
        bindGroup: this.device.createBindGroup({
          label: `${this.label}:bone-bind-group`,
          layout: this.skinBindGroupLayout,
          entries: [{ binding: 0, resource: { buffer } }]
        })
      };
      this.skinEntries.set(skeleton, entry);
      this.skinEntryList.push(entry);
    }
    const palette = skeleton.updateMatrixPalette();
    if (!(palette instanceof Float32Array) || palette.byteLength > this.boneUniformSize) {
      throw new Error(`${this.label} Skeleton matrix palette exceeds the configured bone buffer`);
    }
    this.gpu.queue.writeBuffer(
      entry.buffer,
      0,
      palette.buffer,
      palette.byteOffset,
      palette.byteLength
    );
    return entry.bindGroup;
  }

  // static Shapeでも共通pipelineのvertex slot 1を満たせる0初期化Bufferを返す
  getDummySkinVertexBuffer(vertexCount) {
    const count = util.readFiniteNumber(vertexCount, `${this.label} vertexCount`, {
      integer: true,
      min: 1
    });
    if (this.dummySkinBuffer && this.dummySkinVertexCapacity >= count) {
      return this.dummySkinBuffer;
    }
    if (this.dummySkinBuffer) {
      this.retiredDummySkinBuffers.push(this.dummySkinBuffer);
    }
    this.dummySkinVertexCapacity = count;
    this.dummySkinBuffer = this.device.createBuffer({
      label: `${this.label}:dummy-skin-vertices`,
      size: count * 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    return this.dummySkinBuffer;
  }

  // Shapeごとのmodel matrixとskinning有効flag転送用Bufferを初回だけ作る
  createEntry(node, shape) {
    const uniformData = new Float32Array(36);
    const uniformBuffer = this.device.createBuffer({
      label: `${this.label}:${node.name}:uniforms`,
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    return {
      node,
      shape,
      uniformData,
      uniformBuffer,
      bindGroup: this.device.createBindGroup({
        label: `${this.label}:${node.name}:bind-group`,
        layout: this.bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      })
    };
  }

  // Spaceを走査し、shadow casterとして描くstatic/skinned opaque Shapeを同期する
  syncSpaceEntries(space, options = {}) {
    if (!space || !Array.isArray(space.nodes)) {
      throw new Error(`${this.label} renderSpace requires a Space`);
    }
    const filter = options.filter ?? null;
    if (filter !== null && typeof filter !== "function") {
      throw new Error(`${this.label} filter must be a function`);
    }
    const activeShapes = new Set();
    const drawEntries = [];

    for (const node of space.nodes) {
      if (!node || node.type !== node.NODE_T || !Array.isArray(node.shapes)) {
        continue;
      }
      for (let index = 0; index < node.shapes.length; index += 1) {
        const shape = node.shapes[index];
        if (!shape || shape.isHidden) {
          continue;
        }
        if (filter && !filter({ node, shape, index })) {
          continue;
        }
        const skeleton = shape.hasSkeleton
          ? shape.getSkeleton?.() ?? shape.skeleton
          : null;
        if (shape.hasSkeleton && !skeleton) {
          throw new Error(`${this.label} skinned Shape requires a Skeleton: ${node.name}`);
        }
        const hasVertexBuffers = shape.hasSkeleton
          ? shape.vertexBuffer0 && shape.vertexBuffer1
          : shape.vertexBuffer;
        if (!hasVertexBuffers || !shape.indexBuffer || !Number.isInteger(shape.indexCount)) {
          throw new Error(`${this.label} requires initialized Shape buffers: ${node.name}`);
        }
        if (activeShapes.has(shape)) {
          throw new Error(`${this.label} Shape is attached to multiple Nodes: ${node.name}`);
        }
        activeShapes.add(shape);
        let entry = this.entries.get(shape);
        if (!entry) {
          entry = this.createEntry(node, shape);
          this.entries.set(shape, entry);
        } else {
          entry.node = node;
        }
        entry.skeleton = skeleton;
        drawEntries.push(entry);
      }
    }

    for (const [shape, entry] of this.entries) {
      if (!activeShapes.has(shape)) {
        entry.uniformBuffer.destroy();
        this.entries.delete(shape);
      }
    }
    return drawEntries;
  }

  // 光源view-projectionを全casterへ適用し、depth-only Render Passを同じframeへ記録する
  renderSpace(space, lightViewProjection, options = {}) {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    if (!lightViewProjection?.mat || lightViewProjection.mat.length !== 16) {
      throw new Error(`${this.label} requires a 4x4 lightViewProjection Matrix`);
    }
    const entries = this.syncSpaceEntries(space, options);
    this.gpu.endPass();
    if (!this.gpu.commandEncoder) {
      this.gpu.commandEncoder = this.device.createCommandEncoder();
    }
    const pass = this.gpu.commandEncoder.beginRenderPass({
      label: `${this.label}:pass`,
      timestampWrites: options.timestampWrites,
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.depthView,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: this.depthConvention.clearValue
      }
    });
    pass.setPipeline(this.pipeline);

    for (const entry of entries) {
      const model = entry.node.getWorldMatrix();
      entry.uniformData.set(lightViewProjection.mat, 0);
      entry.uniformData.set(model.mat, 16);
      entry.uniformData.set([entry.skeleton ? 1 : 0, 0, 0, 0], 32);
      this.gpu.queue.writeBuffer(entry.uniformBuffer, 0, entry.uniformData);
      pass.setBindGroup(0, entry.bindGroup);
      pass.setBindGroup(1, this.getSkinBindGroup(entry.skeleton));
      if (entry.skeleton) {
        pass.setVertexBuffer(0, entry.shape.vertexBuffer0);
        pass.setVertexBuffer(1, entry.shape.vertexBuffer1);
      } else {
        pass.setVertexBuffer(0, entry.shape.vertexBuffer);
        pass.setVertexBuffer(1, this.getDummySkinVertexBuffer(entry.shape.vertexCount));
      }
      const materialCount = typeof entry.shape.getMaterialCount === "function"
        ? entry.shape.getMaterialCount()
        : 1;
      for (let materialIndex = 0; materialIndex < materialCount; materialIndex++) {
        const alpha = typeof entry.shape.getMaterialAlpha === "function"
          ? entry.shape.getMaterialAlpha(materialIndex)
          : 1.0;
        // 透明triangleはopaque depthにもshadow mapにも書かず、後段forward合成だけで扱う
        if (alpha < 1.0) {
          continue;
        }
        const drawInfo = typeof entry.shape.getMaterialDrawInfo === "function"
          ? entry.shape.getMaterialDrawInfo(materialIndex)
          : {
              buffer: entry.shape.indexBuffer,
              count: entry.shape.indexCount,
              format: entry.shape.indexFormat
            };
        if (!drawInfo.buffer || drawInfo.count <= 0) {
          continue;
        }
        pass.setIndexBuffer(drawInfo.buffer, drawInfo.format);
        pass.drawIndexed(drawInfo.count);
      }
    }
    pass.end();
    return entries.length;
  }

  // shadow mapは画面解像度と独立しているため、明示された変更時だけtextureを再生成する
  resize(width, height) {
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
    this.createDepthTexture();
    return true;
  }

  // 後段passがdepth textureと寸法を名前付きresourceとして取得できるようにする
  getBindingResources() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    return {
      shadowDepth: this,
      shadowWidth: this.width,
      shadowHeight: this.height
    };
  }

  getDepthView() {
    return this.depthView;
  }

  getDepthSampleView() {
    return this.depthSampleView;
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    return this.height;
  }

  // ShapeごとのUniform Bufferとdepth textureを明示的に破棄する
  destroy() {
    if (this.destroyed) {
      return false;
    }
    for (const entry of this.entries.values()) {
      entry.uniformBuffer.destroy();
    }
    this.entries.clear();
    for (const entry of this.skinEntryList) {
      entry.buffer.destroy();
    }
    this.skinEntryList.length = 0;
    this.dummySkinBuffer?.destroy();
    for (const buffer of this.retiredDummySkinBuffers) {
      buffer.destroy();
    }
    this.retiredDummySkinBuffers.length = 0;
    this.defaultBoneBuffer.destroy();
    this.depthTexture?.destroy();
    this.depthTexture = null;
    this.depthView = null;
    this.depthSampleView = null;
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.skinBindGroupLayout = null;
    this.destroyed = true;
    return true;
  }
}
