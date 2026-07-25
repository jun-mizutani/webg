// ---------------------------------------------
// GeometryBufferPass.js  2026/07/20
//   MRT Geometry Buffer pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import RenderTarget from "./RenderTarget.js";
import util from "./util.js";
import {
  COLOR_SPACE_WGSL,
  srgbColorToLinear
} from "./ColorSpace.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { resizeTarget } from "./StorageTargetFactory.js";
import {
  DEFAULT_MAX_SKIN_BONES,
  SKIN_MATRIX_FLOATS_PER_BONE,
  SKIN_MATRIX_VECTORS_PER_BONE
} from "./SkinningConfig.js";

// albedoは論理上の線形色として読み書きしつつ、暗部の8 bit精度を保つsRGB attachmentへ保存します
// Render Pass出力は自動的にsRGB符号化され、後段のtextureSampleでは自動的に線形色へ戻ります
export const GBUFFER_COLOR_FORMAT = "rgba8unorm-srgb";
export const GBUFFER_NORMAL_FORMAT = "rgba8unorm";
export const GBUFFER_MATERIAL_FORMAT = "rgba8unorm";
export const GBUFFER_MIN_ROUGHNESS = 0.04;
export const GBUFFER_DEPTH_FORMAT = CAMERA_REVERSE_Z.format;

// G-buffer書き込み側と読み取り側で共有するnormal、depth、view-space positionの規則を定義します
// 利用側WGSLはParams内のprojection vec4を明示的に渡し、暗黙のuniform名へ依存しません
export const GBUFFER_WGSL_COMMON = `
fn decodeGBufferNormal(encoded : vec3f) -> vec3f {
  return normalize(encoded * 2.0 - vec3f(1.0));
}

fn isGBufferBackgroundDepth(depth : f32) -> bool {
  return depth == 0.0;
}

fn linearizeGBufferDepth(depth : f32, projection : vec4f) -> f32 {
  let near = projection.x;
  let far = projection.y;
  if (far == 0.0) {
    return near / depth;
  }
  return (near * far) / (near + depth * (far - near));
}

fn reconstructGBufferViewPosition(
  coord : vec2<i32>,
  depth : f32,
  dims : vec2<i32>,
  projection : vec4f
) -> vec3f {
  let uv = (vec2f(coord) + vec2f(0.5)) / vec2f(dims);
  let ndc = uv * 2.0 - vec2f(1.0);
  let viewDepth = linearizeGBufferDepth(depth, projection);
  return vec3f(
    ndc.x * viewDepth * projection.z * projection.w,
    -ndc.y * viewDepth * projection.z,
    -viewDepth
  );
}
`;

// Camera Frameを共通WGSLが要求するnear、far、tan(vfov/2)、aspectの順へ詰めます
// infinite farは有限farに使えない0を明示sentinelとし、WGSL側でnear/depth式を選択します
export function createGBufferProjectionParams(cameraFrame) {
  if (!cameraFrame || cameraFrame.depthConvention !== CAMERA_REVERSE_Z) {
    throw new Error("createGBufferProjectionParams requires a Reverse-Z CameraFrame");
  }
  return new Float32Array([
    cameraFrame.near,
    cameraFrame.infiniteFar ? 0.0 : cameraFrame.far,
    Math.tan(cameraFrame.vfov * 0.5 * Math.PI / 180.0),
    cameraFrame.aspect
  ]);
}

// attachment 0へalbedo、1へview-space normal、2へ材質値を書きます
// 材質RGBAはspecular、roughness、metallic、emissiveの順です
export class GeometryBufferPass {
  // G-buffer layoutをoptionで明示し、未対応のnormal空間やcolor modeを既定値へ丸めません
  constructor(gpu, options = {}) {
    if (!gpu) {
      throw new Error("GeometryBufferPass requires a WebGPU context");
    }
    this.gpu = gpu;
    this.device = gpu.device;
    this.label = util.readOptionalString(
      options.label,
      "GeometryBufferPass label",
      "geometry-buffer",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(
      options.width,
      `${this.label} width`,
      1,
      { min: 1 }
    );
    this.height = util.readOptionalInteger(
      options.height,
      `${this.label} height`,
      1,
      { min: 1 }
    );
    if (options.colorMode !== undefined && options.colorMode !== "material") {
      throw new Error(
        `${this.label} colorMode must be material; lit mode was removed from the v2 G-buffer`
      );
    }
    this.colorMode = "material";
    this.normalSpace = util.readOptionalEnum(
      options.normalSpace,
      `${this.label} normalSpace`,
      "view",
      ["view"]
    );
    this.colorFormat = util.readOptionalString(
      options.colorFormat,
      `${this.label} colorFormat`,
      GBUFFER_COLOR_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.colorFormat !== GBUFFER_COLOR_FORMAT) {
      throw new Error(
        `${this.label} colorFormat must be ${GBUFFER_COLOR_FORMAT}`
      );
    }
    this.normalFormat = util.readOptionalString(
      options.normalFormat,
      `${this.label} normalFormat`,
      GBUFFER_NORMAL_FORMAT,
      { trim: true, allowEmpty: false }
    );
    this.materialFormat = GBUFFER_MATERIAL_FORMAT;
    this.depthConvention = CAMERA_REVERSE_Z;
    this.depthFormat = this.depthConvention.format;
    this.entries = [];
    // Spaceから自動収集したShapeはinstance単位でdraw resourceを再利用します
    // Mapを使うことでsceneから外れたShapeを検出し、専用Uniform Bufferを破棄できます
    this.spaceEntries = new Map();
    this.textureBindGroups = new WeakMap();
    this.skinEntries = new WeakMap();
    this.skinEntryList = [];
    this.dummySkinBuffer = null;
    this.retiredDummySkinBuffers = [];
    this.dummySkinVertexCapacity = 0;
    this.boneDataSize = DEFAULT_MAX_SKIN_BONES * SKIN_MATRIX_FLOATS_PER_BONE;
    this.boneUniformSize = this.boneDataSize * Float32Array.BYTES_PER_ELEMENT;

    // color targetへ共有depthを持たせ、color、normal、depthを同じpixel座標で対応させます
    this.colorTarget = new RenderTarget(gpu, {
      label: `${this.label}:color`,
      width: this.width,
      height: this.height,
      format: this.colorFormat,
      hasDepth: true,
      sampleDepth: true,
      depthConvention: this.depthConvention
    });
    this.normalTarget = new RenderTarget(gpu, {
      label: `${this.label}:normal`,
      width: this.width,
      height: this.height,
      format: this.normalFormat,
      hasDepth: false
    });
    this.materialTarget = new RenderTarget(gpu, {
      label: `${this.label}:material`,
      width: this.width,
      height: this.height,
      format: this.materialFormat,
      hasDepth: false
    });
    this.ready = Promise.all([
      this.colorTarget.ready,
      this.normalTarget.ready,
      this.materialTarget.ready
    ]);

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label}:draw-layout`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" }
      }]
    });
    this.textureBindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label}:texture-layout`,
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }
      ]
    });
    this.skinBindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label}:skin-layout`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" }
      }]
    });
    this.createDefaultSurfaceResources();
    this.pipeline = this.createPipeline();
  }

  // textureやskinningを使わないShapeでも同じpipeline layoutを使える既定resourceを作ります
  // 機能が有効なのにresourceが欠ける場合の代替ではなく、機能OFFを明示する正式bindingです
  createDefaultSurfaceResources() {
    const createTexture = (label, color) => {
      const texture = this.device.createTexture({
        label,
        size: [1, 1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.gpu.queue.writeTexture(
        { texture },
        new Uint8Array(color),
        { bytesPerRow: 4 },
        { width: 1, height: 1, depthOrArrayLayers: 1 }
      );
      return texture;
    };
    this.defaultSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear"
    });
    this.defaultColorTexture = createTexture(`${this.label}:default-color`, [255, 255, 255, 255]);
    this.defaultNormalTexture = createTexture(`${this.label}:default-normal`, [128, 128, 255, 255]);
    this.defaultTextureBindGroup = this.device.createBindGroup({
      label: `${this.label}:default-textures`,
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.defaultSampler },
        { binding: 1, resource: this.defaultColorTexture.createView() },
        { binding: 2, resource: this.defaultNormalTexture.createView() }
      ]
    });
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

  // albedo、view normal、材質値を別attachmentへ書くv2 G-buffer pipelineを作ります
  // 照明済みcolorをalbedoへ焼き込むlit modeは持たせません
  createPipeline() {
    const module = this.device.createShaderModule({
      label: `${this.label}:shader`,
      code: `
struct DrawUniforms {
  projection : mat4x4f,
  modelView : mat4x4f,
  normalMatrix : mat4x4f,
  albedo : vec4f,
  surface : vec4f,
  flags : vec4f,
};

struct SkinUniforms {
  bones : array<vec4f, ${DEFAULT_MAX_SKIN_BONES * SKIN_MATRIX_VECTORS_PER_BONE}>,
};

@group(0) @binding(0) var<uniform> uniforms : DrawUniforms;
@group(1) @binding(0) var surfaceSampler : sampler;
@group(1) @binding(1) var colorTexture : texture_2d<f32>;
@group(1) @binding(2) var normalTexture : texture_2d<f32>;
@group(2) @binding(0) var<uniform> skin : SkinUniforms;

struct VertexInput {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) texCoord : vec2f,
  @location(3) boneIndex : vec4f,
  @location(4) boneWeight : vec4f,
};

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) viewPosition : vec3f,
  @location(1) viewNormal : vec3f,
  @location(2) texCoord : vec2f,
};

struct FragmentOutput {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) material : vec4f,
};

${COLOR_SPACE_WGSL}

@vertex
fn vsMain(input : VertexInput) -> VertexOutput {
  // SmoothShaderと同じ3 x vec4 bone paletteからskinning行列を組み立てます
  var output : VertexOutput;
  var skinMatrix = mat4x4f(
    vec4f(1.0, 0.0, 0.0, 0.0),
    vec4f(0.0, 1.0, 0.0, 0.0),
    vec4f(0.0, 0.0, 1.0, 0.0),
    vec4f(0.0, 0.0, 0.0, 1.0)
  );
  if (uniforms.flags.w != 0.0) {
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
  let viewPosition = uniforms.modelView * skinMatrix * vec4f(input.position, 1.0);
  output.position = uniforms.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize(
    (uniforms.normalMatrix * skinMatrix * vec4f(input.normal, 0.0)).xyz
  );
  output.texCoord = input.texCoord;
  return output;
}

@fragment
fn fsMain(input : VertexOutput) -> FragmentOutput {
  // base textureとnormal mapを標準SmoothShaderと同じShape parameterで適用します
  var output : FragmentOutput;
  var normal = normalize(input.viewNormal);
  if (uniforms.flags.y != 0.0) {
    let sampledNormal = textureSampleLevel(
      normalTexture,
      surfaceSampler,
      input.texCoord,
      0.0
    ).xyz * 2.0 - vec3f(1.0);
    let dp1 = dpdx(input.viewPosition);
    let dp2 = dpdy(input.viewPosition);
    let duv1 = dpdx(input.texCoord);
    let duv2 = dpdy(input.texCoord);
    let determinant = duv1.x * duv2.y - duv1.y * duv2.x;
    if (abs(determinant) > 1.0e-8) {
      var tangent = (dp1 * duv2.y - dp2 * duv1.y) / determinant;
      var bitangent = (-dp1 * duv2.x + dp2 * duv1.x) / determinant;
      tangent = normalize(tangent - normal * dot(normal, tangent));
      let handedness = select(
        -1.0,
        1.0,
        dot(cross(normal, tangent), bitangent) >= 0.0
      );
      bitangent = normalize(cross(normal, tangent)) * handedness;
      let mapped = normalize(mat3x3f(tangent, bitangent, normal) * sampledNormal);
      normal = normalize(mix(normal, mapped, uniforms.flags.z));
    }
  }
  // Shape colorとbase color textureは表示用sRGBとして指定されます
  // 両者を個別に線形化してから乗算し、照明前の線形albedoをG-bufferへ保存します
  var linearAlbedo = srgbToLinear(uniforms.albedo.rgb);
  if (uniforms.flags.x != 0.0) {
    let textureSrgb = textureSample(colorTexture, surfaceSampler, input.texCoord).rgb;
    linearAlbedo *= srgbToLinear(textureSrgb);
  }
  output.albedo = vec4f(linearAlbedo, 1.0);
  output.normal = vec4f(normal * 0.5 + vec3f(0.5), 1.0);
  output.material = uniforms.surface;
  return output;
}`
    });
    return this.device.createRenderPipeline({
      label: `${this.label}:pipeline`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.bindGroupLayout,
          this.textureBindGroupLayout,
          this.skinBindGroupLayout
        ]
      }),
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 8 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
              { shaderLocation: 2, offset: 6 * 4, format: "float32x2" }
            ]
          },
          {
            arrayStride: 8 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [
              { shaderLocation: 3, offset: 0, format: "float32x4" },
              { shaderLocation: 4, offset: 4 * 4, format: "float32x4" }
            ]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [
          { format: this.colorFormat },
          { format: this.normalFormat },
          { format: this.materialFormat }
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

  // 利用者向けmaterialをalbedo vec4とsurface vec4の連続8 floatへ変換します
  // surfaceはspecular、roughness、metallic、emissiveの順で、単一materialValueは受け付けません
  packMaterial(material) {
    const checked = util.readPlainObject(material, `${this.label} material`);
    const albedo = util.readColor(checked.albedo, `${this.label} material.albedo`, undefined, 3);
    const specular = util.readFiniteNumber(
      checked.specular,
      `${this.label} material.specular`,
      { min: 0.0, max: 1.0 }
    );
    const roughness = util.readFiniteNumber(
      checked.roughness,
      `${this.label} material.roughness`,
      { min: GBUFFER_MIN_ROUGHNESS, max: 1.0 }
    );
    const metallic = util.readFiniteNumber(
      checked.metallic,
      `${this.label} material.metallic`,
      { min: 0.0, max: 1.0 }
    );
    const emissive = util.readFiniteNumber(
      checked.emissive,
      `${this.label} material.emissive`,
      { min: 0.0, max: 1.0 }
    );
    return new Float32Array([
      albedo[0], albedo[1], albedo[2], 1.0,
      specular, roughness, metallic, emissive
    ]);
  }

  // 標準Shapeが保持するcolorと明示材質値をv2 G-buffer materialへ変換します
  // roughness・metallicなどの省略を旧固定specularへ補正せず、未移行materialとして例外にします
  resolveShapeMaterial(shape, resolver = null, materialIndex = 0) {
    if (resolver !== null && typeof resolver !== "function") {
      throw new Error(`${this.label} materialResolver must be a function`);
    }
    if (resolver) {
      return this.packMaterial(resolver(shape, materialIndex));
    }
    const params = typeof shape?.getShaderParametersForMaterial === "function"
      ? shape.getShaderParametersForMaterial(materialIndex)
      : shape?.shaderParam;
    const color = util.readColor(
      params?.color,
      materialIndex === 0
        ? `${this.label} Shape color`
        : `${this.label} Shape material[${materialIndex}] color`,
      undefined,
      4
    );
    return this.packMaterial({
      albedo: color.slice(0, 3),
      specular: params?.specular,
      roughness: params?.roughness,
      metallic: params?.metallic,
      emissive: params?.emissive
    });
  }

  // Shapeと標準SmoothShaderが共有するsurface parameterをG-buffer描画用に解決します
  // texture、normal map、skinningを別設定へ複製せず、通常描画と同じShape状態を読みます
  resolveShapeSurface(shape, resolver = null, materialIndex = 0) {
    const shader = shape?.shader ?? null;
    const defaults = shader?.default ?? {};
    const params = typeof shape?.getShaderParametersForMaterial === "function"
      ? shape.getShaderParametersForMaterial(materialIndex)
      : shape?.shaderParam ?? {};
    const material = this.resolveShapeMaterial(shape, resolver, materialIndex);
    const multiply = util.readColor(
      params.multiplyColor ?? defaults.multiplyColor ?? [1, 1, 1, 1],
      `${this.label} Shape multiplyColor`,
      undefined,
      4
    );
    const add = util.readColor(
      params.addColor ?? defaults.addColor ?? [0, 0, 0, 0],
      `${this.label} Shape addColor`,
      undefined,
      4
    );
    material[0] = material[0] * multiply[0] + add[0];
    material[1] = material[1] * multiply[1] + add[1];
    material[2] = material[2] * multiply[2] + add[2];

    const useTexture = Number(params.use_texture ?? defaults.use_texture ?? 0) !== 0;
    const useNormalMap = Number(params.use_normal_map ?? defaults.use_normal_map ?? 0) !== 0;
    const texture = params.texture ?? shape.texture ?? null;
    const normalTexture = params.normal_texture ?? defaults.normal_texture ?? null;
    if (useTexture && !texture) {
      throw new Error(`${this.label} Shape requires texture when use_texture is enabled`);
    }
    if (useNormalMap && !normalTexture) {
      throw new Error(`${this.label} Shape requires normal_texture when use_normal_map is enabled`);
    }
    const normalStrength = util.readFiniteNumber(
      params.normal_strength ?? defaults.normal_strength ?? 1.0,
      `${this.label} Shape normal_strength`,
      { min: 0, max: 2 }
    );
    const skeleton = shape.hasSkeleton ? shape.getSkeleton?.() ?? shape.skeleton : null;
    if (shape.hasSkeleton && !skeleton) {
      throw new Error(`${this.label} skinned Shape requires a Skeleton`);
    }
    return {
      material,
      useTexture,
      useNormalMap,
      normalStrength,
      texture,
      normalTexture,
      skeleton
    };
  }

  // Texture classが公開するViewとSamplerを取り出し、機能有効時の不足を例外にします
  resolveTextureResource(texture, label) {
    const view = texture?.getView?.() ?? texture?.view ?? texture?.createView?.();
    const sampler = texture?.getSampler?.() ?? texture?.sampler;
    if (!view || !sampler) {
      throw new Error(`${this.label} ${label} requires a texture view and sampler`);
    }
    return { view, sampler };
  }

  // base textureとnormal textureの組み合わせに対応するBind Groupを作ります
  // Shape parameterが変わった場合だけentry側の参照を差し替え、毎frameの再生成を避けます
  getTextureBindGroup(surface) {
    if (!surface.useTexture && !surface.useNormalMap) {
      return this.defaultTextureBindGroup;
    }
    const baseKey = surface.texture ?? this.defaultColorTexture;
    const normalKey = surface.normalTexture ?? this.defaultNormalTexture;
    let normalCache = this.textureBindGroups.get(baseKey);
    if (!normalCache) {
      normalCache = new WeakMap();
      this.textureBindGroups.set(baseKey, normalCache);
    }
    if (normalCache.has(normalKey)) {
      return normalCache.get(normalKey);
    }
    const base = surface.useTexture
      ? this.resolveTextureResource(surface.texture, "texture")
      : { view: this.defaultColorTexture.createView(), sampler: this.defaultSampler };
    const normal = surface.useNormalMap
      ? this.resolveTextureResource(surface.normalTexture, "normal_texture")
      : { view: this.defaultNormalTexture.createView(), sampler: base.sampler };
    const bindGroup = this.device.createBindGroup({
      label: `${this.label}:surface-textures`,
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: base.sampler },
        { binding: 1, resource: base.view },
        { binding: 2, resource: normal.view }
      ]
    });
    normalCache.set(normalKey, bindGroup);
    return bindGroup;
  }

  // Skeletonごとのbone palette Bufferを作り、現在姿勢の行列配列を転送します
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

  // static Shapeでもskinning対応pipelineのvertex slot 1を満たす0埋めBufferを返します
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

  // NodeとShapeに対応するUniform BufferとBind Groupを生成します
  // 明示登録とSpace自動収集の両方が同じdraw resource構造を使用します
  createDrawEntry(node, shape, material, surface = null) {
    if (!node || !shape) {
      throw new Error(`${this.label} draw entry requires node and shape`);
    }
    const uniformData = new Float32Array(60);
    const uniformBuffer = this.device.createBuffer({
      label: `${this.label}:${node.name}:uniforms`,
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const bindGroup = this.device.createBindGroup({
      label: `${this.label}:${node.name}:bind-group`,
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });
    return {
      node,
      shape,
      material,
      surface,
      visible: true,
      uniformData,
      uniformBuffer,
      bindGroup,
      materialDrawResources: new Map()
    };
  }

  // 1つのShapeを複数material slotで描く場合に、slotごとのUniform値を独立して保持する
  // 同じBufferへ複数回writeBufferするとsubmit時には最後の値だけが見えるため、slot 0以外を分離する
  getMaterialDrawResource(entry, materialIndex) {
    if (materialIndex === 0) {
      return {
        uniformData: entry.uniformData,
        uniformBuffer: entry.uniformBuffer,
        bindGroup: entry.bindGroup
      };
    }
    let resource = entry.materialDrawResources.get(materialIndex);
    if (resource) {
      return resource;
    }
    const uniformData = new Float32Array(60);
    const uniformBuffer = this.device.createBuffer({
      label: `${this.label}:${entry.node.name}:material-${materialIndex}:uniforms`,
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    resource = {
      uniformData,
      uniformBuffer,
      bindGroup: this.device.createBindGroup({
        label: `${this.label}:${entry.node.name}:material-${materialIndex}:bind-group`,
        layout: this.bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      })
    };
    entry.materialDrawResources.set(materialIndex, resource);
    return resource;
  }

  // entryが所有するslot 0と追加slotのUniform Bufferを重複なく破棄する
  destroyDrawEntry(entry) {
    entry.uniformBuffer.destroy();
    for (const resource of entry.materialDrawResources.values()) {
      resource.uniformBuffer.destroy();
    }
    entry.materialDrawResources.clear();
  }

  // scene node、Shape、意味を明示したmaterialをdraw entryとして登録します
  addShape(node, shape, material) {
    const packed = this.packMaterial(material);
    const entry = this.createDrawEntry(node, shape, packed, {
      material: packed,
      useTexture: false,
      useNormalMap: false,
      normalStrength: 1,
      texture: null,
      normalTexture: null,
      skeleton: null
    });
    this.entries.push(entry);
    return entry;
  }

  // 登録済みentryのmaterialだけを更新し、nodeやGPU bufferを作り直しません
  setMaterial(entry, material) {
    this.requireEntry(entry);
    entry.material = this.packMaterial(material);
    entry.surface.material = entry.material;
    return entry;
  }

  // draw list内のentryだけを表示・非表示にし、scene graph側の状態は変更しません
  setVisible(entry, visible) {
    this.requireEntry(entry);
    const checked = util.readOptionalBoolean(visible, `${this.label} visible`, undefined);
    if (checked === undefined) {
      throw new Error(`${this.label} visible must be boolean`);
    }
    entry.visible = checked;
    return entry;
  }

  // 指定entryがこのpassに属することを検証し、別passのentry誤用を検出します
  requireEntry(entry) {
    if (!entry || !this.entries.includes(entry)) {
      throw new Error(`${this.label} entry is not registered`);
    }
    return entry;
  }

  // entryをdraw listから外し、entry専用uniform bufferを破棄します
  remove(entry) {
    this.requireEntry(entry);
    const index = this.entries.indexOf(entry);
    this.entries.splice(index, 1);
    this.destroyDrawEntry(entry);
  }

  // 全entryのuniform bufferを破棄してdraw listを空にします
  clear() {
    for (const entry of this.entries) {
      this.destroyDrawEntry(entry);
    }
    this.entries.length = 0;
  }

  // SpaceのNodeとShapeを走査し、標準surface状態を持つdraw entryを同期します
  // texture、normal map、skinningはShape自身の設定を読み、G-buffer専用の二重登録を要求しません
  syncSpaceEntries(space, options = {}) {
    if (!space || !Array.isArray(space.nodes)) {
      throw new Error(`${this.label} renderSpace requires a Space`);
    }
    const filter = options.filter ?? null;
    if (filter !== null && typeof filter !== "function") {
      throw new Error(`${this.label} filter must be a function`);
    }
    const materialResolver = options.materialResolver ?? null;
    const activeShapes = new Set();
    const drawEntries = [];

    for (const node of space.nodes) {
      if (!node || node.type !== node.NODE_T || !Array.isArray(node.shapes)) {
        continue;
      }
      for (let index = 0; index < node.shapes.length; index++) {
        const shape = node.shapes[index];
        if (!shape || shape.isHidden) {
          continue;
        }
        if (filter && !filter({ node, shape, index })) {
          continue;
        }
        const hasVertexBuffers = shape.hasSkeleton
          ? shape.vertexBuffer0 && shape.vertexBuffer1
          : shape.vertexBuffer;
        if (!hasVertexBuffers || !shape.indexBuffer || !Number.isInteger(shape.indexCount)) {
          throw new Error(`${this.label} requires initialized Shape buffers: ${node.name}`);
        }
        if (activeShapes.has(shape)) {
          throw new Error(
            `${this.label} Shape instance is attached to multiple Nodes: ${node.name}`
          );
        }
        activeShapes.add(shape);
        let entry = this.spaceEntries.get(shape);
        const surface = this.resolveShapeSurface(shape, materialResolver);
        if (!entry) {
          entry = this.createDrawEntry(node, shape, surface.material, surface);
          this.spaceEntries.set(shape, entry);
        } else {
          entry.node = node;
          entry.material = surface.material;
          entry.surface = surface;
        }
        drawEntries.push(entry);
      }
    }

    // sceneから除去されたShapeのUniform Bufferを残さず、次frame以降のcacheから外します
    for (const [shape, entry] of this.spaceEntries) {
      if (!activeShapes.has(shape)) {
        this.destroyDrawEntry(entry);
        this.spaceEntries.delete(shape);
      }
    }
    return drawEntries;
  }

  // 後段Compute Passへalbedo、normal、surface material、camera depthを名前付きで公開します
  getBindingResources() {
    const resources = {
      albedo: this.colorTarget,
      color: this.colorTarget,
      normal: this.normalTarget,
      material: this.materialTarget,
      depth: this.colorTarget
    };
    return resources;
  }

  // G-bufferの全attachmentを同じ寸法へ揃え、pixel対応を維持します
  resize(width, height) {
    this.width = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    this.height = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    resizeTarget(this.colorTarget, this.width, this.height);
    resizeTarget(this.normalTarget, this.width, this.height);
    resizeTarget(this.materialTarget, this.width, this.height);
  }

  // 独立したMRT Render Passを開始し、登録された可視entryを順番に描画します
  renderEntries(entries, cameraFrame, clearColor, options = {}) {
    if (!cameraFrame || cameraFrame.depthConvention !== this.depthConvention
      || typeof cameraFrame.createModelViewMatrix !== "function") {
      throw new Error(`${this.label} renderEntries requires a Reverse-Z CameraFrame`);
    }
    this.gpu.endPass?.();
    if (this.gpu.passEncoder) {
      this.gpu.passEncoder.end();
      this.gpu.passEncoder = null;
    }
    if (!this.gpu.commandEncoder) {
      this.gpu.commandEncoder = this.device.createCommandEncoder();
    }
    // 通常描画と同じ表示用sRGBで指定された背景を、線形HDR経路へ入る前に復号します
    const linearClearColor = srgbColorToLinear(clearColor, `${this.label} clearColor`);
    const pass = this.gpu.commandEncoder.beginRenderPass({
      label: `${this.label}:pass`,
      timestampWrites: options.timestampWrites,
      colorAttachments: [
        {
          view: this.colorTarget.getView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: linearClearColor
        },
        {
          view: this.normalTarget.getView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.5, g: 0.5, b: 1.0, a: 1.0 }
        },
        {
          view: this.materialTarget.getView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.0, g: 1.0, b: 0.0, a: 0.0 }
        }
      ],
      depthStencilAttachment: {
        view: this.colorTarget.getDepthView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: this.depthConvention.clearValue
      }
    });
    pass.setPipeline(this.pipeline);

    for (const entry of entries) {
      if (!entry.visible) {
        continue;
      }
      // modelViewとinverse-transpose normal matrixはShape内の全material slotで共有する
      const modelView = cameraFrame.createModelViewMatrix(entry.node.getWorldMatrix());
      const normalMatrix = modelView.clone();
      normalMatrix.inverse();
      normalMatrix.transpose();
      const materialCount = typeof entry.shape.getMaterialCount === "function"
        ? entry.shape.getMaterialCount()
        : 1;
      for (let materialIndex = 0; materialIndex < materialCount; materialIndex++) {
        const alpha = typeof entry.shape.getMaterialAlpha === "function"
          ? entry.shape.getMaterialAlpha(materialIndex)
          : 1.0;
        // G-bufferは一pixelに一surfaceしか保持できないため、透明layerは後段forward passへ送る
        if (alpha < 1.0) {
          continue;
        }
        const surface = typeof entry.shape.getShaderParametersForMaterial === "function"
          ? this.resolveShapeSurface(entry.shape, options.materialResolver ?? null, materialIndex)
          : entry.surface;
        const material = surface?.material ?? entry.material;
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

        const materialDrawResource = this.getMaterialDrawResource(entry, materialIndex);
        materialDrawResource.uniformData.set(cameraFrame.projectionMatrix.mat, 0);
        materialDrawResource.uniformData.set(modelView.mat, 16);
        materialDrawResource.uniformData.set(normalMatrix.mat, 32);
        materialDrawResource.uniformData.set(material, 48);
        materialDrawResource.uniformData.set([
          surface?.useTexture ? 1 : 0,
          surface?.useNormalMap ? 1 : 0,
          surface?.normalStrength ?? 1,
          surface?.skeleton ? 1 : 0
        ], 56);
        this.gpu.queue.writeBuffer(
          materialDrawResource.uniformBuffer,
          0,
          materialDrawResource.uniformData
        );

        pass.setBindGroup(0, materialDrawResource.bindGroup);
        pass.setBindGroup(1, this.getTextureBindGroup(surface));
        pass.setBindGroup(2, this.getSkinBindGroup(surface?.skeleton));
        if (surface?.skeleton) {
          pass.setVertexBuffer(0, entry.shape.vertexBuffer0);
          pass.setVertexBuffer(1, entry.shape.vertexBuffer1);
        } else {
          pass.setVertexBuffer(0, entry.shape.vertexBuffer);
          pass.setVertexBuffer(1, this.getDummySkinVertexBuffer(entry.shape.vertexCount));
        }
        pass.setIndexBuffer(drawInfo.buffer, drawInfo.format);
        pass.drawIndexed(drawInfo.count);
      }
    }
    pass.end();
  }

  // 明示登録済みentryを描画する互換APIです
  // 新規アプリケーションではShape二重登録を避けるためrenderSpace()を使用します
  render(cameraFrame, clearColor) {
    this.renderEntries(this.entries, cameraFrame, clearColor);
  }

  // 標準SpaceからShapeとworld transformを収集し、独立したG-buffer Render Passへ描画します
  // materialはShape.shaderParam.colorを使い、利用者はNodeとShapeを再登録する必要がありません
  renderSpace(space, cameraFrame, clearColor, options = {}) {
    const entries = this.syncSpaceEntries(space, options);
    this.renderEntries(entries, cameraFrame, clearColor, options);
    return entries.length;
  }

  // entry固有bufferとattachment textureを明示的に破棄します
  destroy() {
    this.clear();
    for (const entry of this.spaceEntries.values()) {
      this.destroyDrawEntry(entry);
    }
    this.spaceEntries.clear();
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
    this.defaultColorTexture.destroy();
    this.defaultNormalTexture.destroy();
    this.colorTarget.destroy();
    this.normalTarget.destroy();
    this.materialTarget.destroy();
  }
}

export default GeometryBufferPass;
