// ---------------------------------------------
//  SceneProject.js  2026/09/23
//   ProjectApp sample implementation for validating and loading a Scene project manifest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import SceneAsset from "../../webg/SceneAsset.js";
import SceneLoader from "../../webg/SceneLoader.js";
import ModelAsset from "../../webg/ModelAsset.js";
import Primitive from "../../webg/Primitive.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";
import Shape from "../../webg/Shape.js";
import util from "../../webg/util.js";
import {
  createModelSpatialCorrespondence,
  readLocalGeometry,
  readNodeSpatialPose
} from "./ModelSpatialCorrespondence.js";
import {
  createPrimitivePhysicsManifest,
  createPrimitiveScene,
  readPrimitiveMaterialManifest,
  readPrimitiveProjectObjectDefinitions
} from "./PrimitiveProjectScene.js";

// 外部material manifestのPBR値をShape.setMaterial()へ渡せる形式へ変換します
// 設定値の検証をこの境界へ集め、材質パラメータの範囲検査を一か所で扱う構成にします
function readPbrMaterialParams(definition, label) {
  const source = util.readPlainObject(definition, label);
  const assetMaterialId = util.readOptionalString(
    source.assetMaterialId,
    `${label}.assetMaterialId`,
    undefined,
    { trim: true, allowEmpty: false }
  );
  const pbr = util.readPlainObject(source.pbr, `${label}.pbr`);
  const color = pbr.color;
  if (!Array.isArray(color) || color.length !== 4) {
    throw new Error(`${label}.pbr.color must be an RGBA array with four values`);
  }
  const checkedColor = color.map((value, index) => util.readFiniteNumber(
    value,
    `${label}.pbr.color[${index}]`,
    { min: 0.0, max: 1.0 }
  ));
  const readRange = (key, defaultValue, min = 0.0, max = 1.0) => util.readFiniteNumber(
    pbr[key] ?? defaultValue,
    `${label}.pbr.${key}`,
    { min, max }
  );
  const emissiveFactor = pbr.emissive_factor ?? [0.0, 0.0, 0.0];
  if (!Array.isArray(emissiveFactor) || emissiveFactor.length !== 3) {
    throw new Error(`${label}.pbr.emissive_factor must be an RGB array with three values`);
  }
  const checkedEmissiveFactor = emissiveFactor.map((value, index) => util.readFiniteNumber(
    value,
    `${label}.pbr.emissive_factor[${index}]`,
    { min: 0.0 }
  ));
  const alphaMode = util.readOptionalString(
    pbr.alpha_mode,
    `${label}.pbr.alpha_mode`,
    "OPAQUE",
    { trim: false, allowEmpty: false }
  );
  if (!["OPAQUE", "MASK", "BLEND"].includes(alphaMode)) {
    throw new Error(`${label}.pbr.alpha_mode must be OPAQUE, MASK, or BLEND`);
  }
  const materialId = util.readOptionalString(
    source.materialId,
    `${label}.materialId`,
    `project-pbr-${assetMaterialId}`,
    { trim: true, allowEmpty: false }
  );
  return {
    materialId,
    params: {
      has_bone: 0,
      use_texture: 0,
      color: checkedColor,
      alpha: readRange("alpha", alphaMode === "BLEND" ? checkedColor[3] : 1.0),
      alpha_mode: alphaMode,
      alpha_cutoff: readRange("alpha_cutoff", 0.5),
      ambient: readRange("ambient", 0.0),
      specular: readRange("specular", 1.0),
      power: util.readFiniteNumber(pbr.power ?? 34.0, `${label}.pbr.power`, { min: 0.0 }),
      metallic: readRange("metallic", 0.0),
      roughness: readRange("roughness", 0.5),
      occlusion: readRange("occlusion", 1.0),
      emissive: util.readFiniteNumber(pbr.emissive ?? 0.0, `${label}.pbr.emissive`, { min: 0.0 }),
      emissive_factor: checkedEmissiveFactor,
      flat_shading: util.readOptionalBoolean(pbr.flat_shading, `${label}.pbr.flat_shading`, false) ? 1 : 0,
      double_sided: util.readOptionalBoolean(pbr.double_sided, `${label}.pbr.double_sided`, false) ? 1 : 0
    }
  };
}

// ModelAssetの直方体meshからローカル寸法を読み、mapRealCuboidへ渡す寸法を確定します
// 24頂点12三角形のbox meshだけを対象にし、任意形状の置換を防ぎます
function readCuboidMeshSize(mesh, label) {
  const geometry = util.readPlainObject(mesh?.geometry, `${label}.geometry`);
  const vertexCount = util.readFiniteNumber(geometry.vertexCount, `${label}.geometry.vertexCount`, {
    integer: true,
    min: 0
  });
  const polygonCount = util.readFiniteNumber(geometry.polygonCount, `${label}.geometry.polygonCount`, {
    integer: true,
    min: 0
  });
  if (vertexCount !== 24 || polygonCount !== 12) {
    throw new Error(`${label} real-cuboid mapping requires a 24-vertex, 12-triangle cuboid mesh`);
  }
  const positions = geometry.positions;
  if (!Array.isArray(positions) || positions.length !== vertexCount * 3) {
    throw new Error(`${label}.geometry.positions must contain ${vertexCount * 3} values`);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = util.readFiniteNumber(positions[index + axis], `${label}.geometry.positions[${index + axis}]`);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  const size = max.map((value, axis) => value - min[axis]);
  for (let axis = 0; axis < 3; axis += 1) {
    util.readFiniteNumber(size[axis], `${label} size[${axis}]`, { minExclusive: 0.0 });
  }
  return size;
}

// ModelAssetの球meshを検証し、正規化equirectangular UVを周長と子午線長の実寸へ変換します
// manifestで明示されたreal-sphere mappingへ球形条件を適用します
function mapRealSphereGeometry(mesh, label) {
  const geometry = util.readPlainObject(mesh?.geometry, `${label}.geometry`);
  const vertexCount = util.readFiniteNumber(geometry.vertexCount, `${label}.geometry.vertexCount`, {
    integer: true,
    min: 3
  });
  const polygonCount = util.readFiniteNumber(geometry.polygonCount, `${label}.geometry.polygonCount`, {
    integer: true,
    min: 1
  });
  const positions = geometry.positions;
  const sourceUvs = geometry.uvs;
  if (!Array.isArray(positions) || positions.length !== vertexCount * 3) {
    throw new Error(`${label}.geometry.positions must contain ${vertexCount * 3} values`);
  }
  if (!Array.isArray(sourceUvs) || sourceUvs.length !== vertexCount * 2) {
    throw new Error(`${label}.geometry.uvs must contain ${vertexCount * 2} values`);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = util.readFiniteNumber(positions[index + axis], `${label}.geometry.positions[${index + axis}]`);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]) * 0.5);
  const radiusByAxis = max.map((value, axis) => (value - min[axis]) * 0.5);
  const radius = radiusByAxis.reduce((sum, value) => sum + value, 0.0) / 3.0;
  util.readFiniteNumber(radius, `${label} sphere radius`, { minExclusive: 0.0 });
  const radiusTolerance = Math.max(1.0e-5, radius * 0.002);
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(radiusByAxis[axis] - radius) > radiusTolerance) {
      throw new Error(`${label} real-sphere mapping requires equal local radii`);
    }
  }
  const surfaceTolerance = Math.max(1.0e-5, radius * 0.002);
  for (let index = 0; index < positions.length; index += 3) {
    const dx = positions[index] - center[0];
    const dy = positions[index + 1] - center[1];
    const dz = positions[index + 2] - center[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (Math.abs(distance - radius) > surfaceTolerance) {
      throw new Error(`${label} real-sphere mapping requires all vertices on one radius`);
    }
  }
  const circumference = 2.0 * Math.PI * radius;
  const meridianLength = Math.PI * radius;
  const uvs = sourceUvs.map((value, index) => {
    const checked = util.readFiniteNumber(value, `${label}.geometry.uvs[${index}]`);
    if (checked < -1.0e-6 || checked > 1.0 + 1.0e-6) {
      throw new Error(`${label}.real-sphere UV values must be within 0..1`);
    }
    return index % 2 === 0 ? checked * circumference : checked * meridianLength;
  });
  return {
    ...geometry,
    positions: [...positions],
    uvs,
    indices: [...(geometry.indices ?? [])],
    polygonLoops: geometry.polygonLoops?.map((loop) => [...loop]),
    normals: geometry.normals ? [...geometry.normals] : undefined,
    altVertices: geometry.altVertices ? [...geometry.altVertices] : undefined,
    vertexCount,
    polygonCount
  };
}

// ModelAssetのCapsule meshを検証し、断面円周と軸方向の表面距離を実寸UVへ変換します
// 軸方向の長さは上半球、円筒部、下半球の表面距離を合成して求めます
function mapRealCapsuleGeometry(mesh, label) {
  const geometry = util.readPlainObject(mesh?.geometry, `${label}.geometry`);
  const vertexCount = util.readFiniteNumber(geometry.vertexCount, `${label}.geometry.vertexCount`, {
    integer: true,
    min: 3
  });
  const polygonCount = util.readFiniteNumber(geometry.polygonCount, `${label}.geometry.polygonCount`, {
    integer: true,
    min: 1
  });
  const positions = geometry.positions;
  const sourceUvs = geometry.uvs;
  if (!Array.isArray(positions) || positions.length !== vertexCount * 3) {
    throw new Error(`${label}.geometry.positions must contain ${vertexCount * 3} values`);
  }
  if (!Array.isArray(sourceUvs) || sourceUvs.length !== vertexCount * 2) {
    throw new Error(`${label}.geometry.uvs must contain ${vertexCount * 2} values`);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = util.readFiniteNumber(positions[index + axis], `${label}.geometry.positions[${index + axis}]`);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]) * 0.5);
  const radiusX = (max[0] - min[0]) * 0.5;
  const radiusZ = (max[2] - min[2]) * 0.5;
  const radius = (radiusX + radiusZ) * 0.5;
  util.readFiniteNumber(radius, `${label} capsule radius`, { minExclusive: 0.0 });
  const radiusTolerance = Math.max(1.0e-5, radius * 0.002);
  if (Math.abs(radiusX - radiusZ) > radiusTolerance) {
    throw new Error(`${label} real-capsule mapping requires equal X and Z radii`);
  }
  const totalHeight = max[1] - min[1];
  const segmentLength = totalHeight - radius * 2.0;
  util.readFiniteNumber(segmentLength, `${label} capsule segment length`, { min: 0.0 });
  const halfSegment = segmentLength * 0.5;
  const surfaceTolerance = Math.max(1.0e-5, radius * 0.003);
  for (let index = 0; index < positions.length; index += 3) {
    const dx = positions[index] - center[0];
    const dy = positions[index + 1] - center[1];
    const dz = positions[index + 2] - center[2];
    const radial = Math.sqrt(dx * dx + dz * dz);
    const capCenterOffset = dy < -halfSegment
      ? dy + halfSegment
      : (dy > halfSegment ? dy - halfSegment : 0.0);
    const surfaceDistance = Math.sqrt(radial * radial + capCenterOffset * capCenterOffset);
    if (Math.abs(surfaceDistance - radius) > surfaceTolerance) {
      throw new Error(`${label} real-capsule mapping requires capsule surface vertices`);
    }
  }
  const circumference = 2.0 * Math.PI * radius;
  const profileLength = Math.PI * radius + segmentLength;
  const uvs = sourceUvs.map((value, index) => {
    const checked = util.readFiniteNumber(value, `${label}.geometry.uvs[${index}]`);
    if (checked < -1.0e-6 || checked > 1.0 + 1.0e-6) {
      throw new Error(`${label}.real-capsule UV values must be within 0..1`);
    }
    return index % 2 === 0 ? checked * circumference : checked * profileLength;
  });
  return {
    ...geometry,
    positions: [...positions],
    uvs,
    indices: [...(geometry.indices ?? [])],
    polygonLoops: geometry.polygonLoops?.map((loop) => [...loop]),
    normals: geometry.normals ? [...geometry.normals] : undefined,
    altVertices: geometry.altVertices ? [...geometry.altVertices] : undefined,
    vertexCount,
    polygonCount
  };
}

// Shape.applyPrimitiveAsset()へ渡す単一meshのModelAssetを作ります
// 元assetのNode姿勢と分けて、現在のNodeへ追加するgeometryだけを明示します
function createSingleMeshAsset(geometry, name) {
  return ModelAsset.fromData({
    version: "1.0",
    type: "webg-model-asset",
    meta: {
      name,
      generator: "SceneProject.js",
      source: name,
      unitScale: 1.0,
      upAxis: "Y"
    },
    materials: [],
    meshes: [{ id: `${name}-mesh`, name, geometry }],
    skeletons: [],
    animations: [],
    nodes: []
  });
}

// ModelAsset objectのNode参照とphysics bodyを物体単位で検証します
// 外部ModelAssetのmeshを保持し、project側では安定ID、Node ID、asset material、衝突形状を追跡できるようにします
function readModelObjectDefinitions(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const ids = new Set();
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const source = util.readPlainObject(entry, itemLabel, {});
    const allowedKeys = new Set(["id", "node", "material", "physics"]);
    for (const key of Object.keys(source)) {
      if (!allowedKeys.has(key)) throw new Error(`${itemLabel}.${key} is not supported`);
    }
    const id = util.readOptionalString(source.id, `${itemLabel}.id`, undefined, {
      trim: true,
      allowEmpty: false
    });
    if (ids.has(id)) throw new Error(`${label} has duplicated id: ${id}`);
    ids.add(id);
    const node = util.readOptionalString(source.node, `${itemLabel}.node`, undefined, {
      trim: true,
      allowEmpty: false
    });
    const material = util.readOptionalString(source.material, `${itemLabel}.material`, undefined, {
      trim: true,
      allowEmpty: false
    });
    const physics = util.readPlainObject(source.physics, `${itemLabel}.physics`, {});
    const physicsKeys = new Set([
      "bodyType", "mass", "initialState", "shape", "colliderRelation", "transformSpace",
      "linearDamping", "angularDamping", "gravityScale", "allowSleep", "isSleeping", "isTrigger",
      "fixedRotation", "collisionLayer", "collisionMask", "material", "anchors"
    ]);
    for (const key of Object.keys(physics)) {
      if (!physicsKeys.has(key)) throw new Error(`${itemLabel}.physics.${key} is not supported`);
    }
    const bodyType = util.readOptionalEnum(
      physics.bodyType,
      `${itemLabel}.physics.bodyType`,
      undefined,
      ["static", "kinematic", "dynamic"]
    );
    if (bodyType === undefined) throw new Error(`${itemLabel}.physics.bodyType is required`);
    if (physics.shape === undefined) throw new Error(`${itemLabel}.physics.shape is required`);
    if (bodyType === "dynamic" && physics.mass === undefined) {
      throw new Error(`${itemLabel}.physics.mass is required for dynamic body`);
    }
    if (material === undefined) {
      throw new Error(`${itemLabel}.material is required for a ModelAsset object`);
    }
    return { id, node, material, physics: structuredClone(physics) };
  });
}

// ModelAsset objectのphysicsをCompute manifestへ変換し、body IDとproject object IDをそろえます
function createModelPhysicsManifest(spaceValue, objectValue, label) {
  const space = util.readPlainObject(spaceValue, `${label}.physics`, {});
  const objects = readModelObjectDefinitions(objectValue, `${label}.objects`);
  return {
    ...space,
    bodies: objects.map((object) => ({
      id: object.id,
      node: object.id,
      ...object.physics
    })),
    joints: spaceValue.joints ?? []
  };
}

// 指定Nodeの直方体Shapeを同じローカル寸法の実寸UV Shapeへ準備します
// Shape.endShape()前の状態を返し、ProceduralMaterialの実寸scaleを同じ段階で適用できるようにします
function prepareRealCuboidShape(entry, gpu, label) {
  const originalShapes = entry.shapes;
  if (originalShapes.length !== 1) {
    throw new Error(`${label} real-cuboid mapping requires exactly one source Shape`);
  }
  const originalShape = originalShapes[0];
  const size = readCuboidMeshSize(entry.mesh, label);
  const shape = new Shape(gpu);
  shape.setName(`${entry.id}-real-cuboid`);
  shape.setShader(originalShape.shader);
  shape.applyPrimitiveAsset(Primitive.mapRealCuboid(size[0], size[1], size[2]));
  return { shape, originalShape };
}

// 指定Nodeの球Shapeを実寸周長・子午線長UV Shapeへ準備します
// 球の半径と既存equirectangular UVを検証し、Nodeのワールド姿勢をそのまま利用します
function prepareRealSphereShape(entry, gpu, label) {
  const originalShapes = entry.shapes;
  if (originalShapes.length !== 1) {
    throw new Error(`${label} real-sphere mapping requires exactly one source Shape`);
  }
  const originalShape = originalShapes[0];
  const geometry = mapRealSphereGeometry(entry.mesh, label);
  const shape = new Shape(gpu);
  shape.setName(`${entry.id}-real-sphere`);
  shape.setShader(originalShape.shader);
  shape.applyPrimitiveAsset(createSingleMeshAsset(geometry, `${entry.id}-real-sphere`));
  return { shape, originalShape };
}

// 指定NodeのCapsule Shapeを実寸周長・軸方向距離UV Shapeへ準備します
// Capsuleの断面半径と芯線長を検証し、Nodeのワールド姿勢をそのまま利用します
function prepareRealCapsuleShape(entry, gpu, label) {
  const originalShapes = entry.shapes;
  if (originalShapes.length !== 1) {
    throw new Error(`${label} real-capsule mapping requires exactly one source Shape`);
  }
  const originalShape = originalShapes[0];
  const geometry = mapRealCapsuleGeometry(entry.mesh, label);
  const shape = new Shape(gpu);
  shape.setName(`${entry.id}-real-capsule`);
  shape.setShader(originalShape.shader);
  shape.applyPrimitiveAsset(createSingleMeshAsset(geometry, `${entry.id}-real-capsule`));
  return { shape, originalShape };
}

// material manifestが選んだ形状mappingを検証済みのShapeへ変換します
// mapping名と形状検証を一つの分岐へ集め、明示的な形状選択として扱います
function prepareMappedShape(entry, gpu, label, uvMapping) {
  if (uvMapping === "real-cuboid") return prepareRealCuboidShape(entry, gpu, label);
  if (uvMapping === "real-sphere") return prepareRealSphereShape(entry, gpu, label);
  if (uvMapping === "real-capsule") return prepareRealCapsuleShape(entry, gpu, label);
  throw new Error(`${label}.uvMapping is unsupported: ${uvMapping}`);
}

// modelasset、Scene、material、physics、rendererの設定を一つのmanifestとして保持します
// このProjectApp sample moduleはデータの読込と検証を担当し、project仕様をmanifestへ整理します
export default class SceneProject {
  // manifestと取得元URLを検証して保持します
  // relative asset URLを読み込み元URLを基準に解決し、base URL不明の状態を例外として通知します
  constructor(manifest, options = {}) {
    if (manifest === undefined || manifest === null) {
      throw new Error("SceneProject manifest is required");
    }
    const data = util.readPlainObject(manifest, "SceneProject manifest");
    const opts = util.readPlainObject(options, "SceneProject options", {});
    this.label = util.readOptionalString(data.name, "SceneProject name", "scene-project", {
      trim: true,
      allowEmpty: false
    });
    this.version = util.readOptionalInteger(data.version, "SceneProject version", 1, { min: 1 });
    this.manifest = data;
    this.sourceUrl = opts.sourceUrl === undefined
      ? null
      : util.readOptionalString(opts.sourceUrl, "SceneProject sourceUrl", undefined, {
        trim: true,
        allowEmpty: false
      });
    this.proceduralMaterialManagers = new Set();
    this.rebuiltMaterialShapes = new WeakMap();
    this.destroyed = false;
  }

  // JSON URLからmanifestを取得してSceneProjectへ変換します
  static async load(url, options = {}) {
    const sourceUrl = util.readOptionalString(url, "SceneProject URL", undefined, {
      trim: true,
      allowEmpty: false
    });
    let response;
    try {
      response = await fetch(sourceUrl);
    } catch (error) {
      throw new Error(`Failed to load SceneProject: ${sourceUrl} (${error?.message ?? error})`);
    }
    if (!response.ok) {
      throw new Error(`Failed to load SceneProject: ${sourceUrl} (${response.status} ${response.statusText})`);
    }
    let manifest;
    try {
      manifest = await response.json();
    } catch (error) {
      throw new Error(`Failed to parse SceneProject: ${sourceUrl} (${error?.message ?? error})`);
    }
    // fetch後のresponse.urlは実行環境ごとに値が異なるため、実行中のページURLを基準にproject URLを解決します
    // manifest内のsceneUrlをこのURL基準で解決し、呼出側へ解決済みURLを渡します
    let resolvedSourceUrl = response.url || sourceUrl;
    try {
      resolvedSourceUrl = new URL(resolvedSourceUrl, globalThis.location?.href).toString();
    } catch (error) {
      throw new Error(`SceneProject URL requires an absolute URL or a location base: ${sourceUrl}`);
    }
    return new SceneProject(manifest, { ...options, sourceUrl: resolvedSourceUrl });
  }

  // object化済みmanifestをSceneProjectへ変換します
  static fromData(manifest, options = {}) {
    return new SceneProject(manifest, options);
  }

  // manifestに存在する設定の分類を検証し、定義済みasset pathを明示的に読み込みます
  validate() {
    this.requireAlive();
    const supportedKeys = new Set([
      "name",
      "version",
      "scene",
      "sceneUrl",
      "modelAsset",
      "modelAssetUrl",
      "sceneAsset",
      "sceneAssetUrl",
      "materials",
      "materialsUrl",
      "physics",
      "physicsUrl",
      "renderer",
      "bindings",
      "objects",
      "objectSets"
    ]);
    for (const key of Object.keys(this.manifest)) {
      if (!supportedKeys.has(key)) {
        throw new Error(`${this.label} manifest.${key} is not supported by ProjectApp sample`);
      }
    }
    const sceneCount = ["scene", "sceneUrl"].filter((key) => this.manifest[key] !== undefined).length;
    if (sceneCount > 1) {
      throw new Error(`${this.label} must specify either scene or sceneUrl`);
    }
    const modelCount = ["modelAsset", "modelAssetUrl", "sceneAsset", "sceneAssetUrl"]
      .filter((key) => this.manifest[key] !== undefined).length;
    if (modelCount > 1) {
      throw new Error(`${this.label} must specify one scene asset source`);
    }
    const materialsCount = ["materials", "materialsUrl"]
      .filter((key) => this.manifest[key] !== undefined).length;
    if (materialsCount > 1) {
      throw new Error(`${this.label} must specify either materials or materialsUrl`);
    }
    const physicsCount = ["physics", "physicsUrl"]
      .filter((key) => this.manifest[key] !== undefined).length;
    if (physicsCount > 1) {
      throw new Error(`${this.label} must specify either physics or physicsUrl`);
    }
    if (this.manifest.scene !== undefined) {
      util.readPlainObject(this.manifest.scene, `${this.label} scene`);
    }
    for (const key of ["renderer", "physics", "materials", "bindings"]) {
      if (this.manifest[key] !== undefined) {
        const expectedArray = key === "materials" || key === "bindings";
        if (expectedArray && !Array.isArray(this.manifest[key])) {
          throw new Error(`${this.label} ${key} must be an array`);
        }
        if (!expectedArray) util.readPlainObject(this.manifest[key], `${this.label} ${key}`);
      }
    }
    const hasPrimitiveObjects = this.manifest.objects !== undefined || this.manifest.objectSets !== undefined;
    if (hasPrimitiveObjects) {
      if (modelCount > 0) {
        if (this.manifest.objectSets !== undefined) {
          throw new Error(`${this.label} objectSets are supported for primitive projects`);
        }
        readModelObjectDefinitions(this.manifest.objects, `${this.label}.objects`);
      } else {
        const primitiveMaterialCount = ["materials", "materialsUrl"]
          .filter((key) => this.manifest[key] !== undefined).length;
        if (primitiveMaterialCount === 0) {
          throw new Error(`${this.label} primitive objects require materials or materialsUrl`);
        }
        readPrimitiveProjectObjectDefinitions(
          this.manifest.objects,
          this.manifest.objectSets,
          this.label,
          {
          allowMaterialReference: true
          }
        );
      }
      if (sceneCount > 0) {
        throw new Error(`${this.label} objects cannot be combined with scene`);
      }
      if (this.manifest.bindings !== undefined) {
        throw new Error(`${this.label} objects replace bindings; remove bindings`);
      }
      if (this.manifest.physicsUrl !== undefined) {
        throw new Error(`${this.label} objects require inline physics settings`);
      }
      if (this.manifest.physics === undefined) {
        throw new Error(`${this.label} objects or objectSets require physics.space`);
      }
      const physics = util.readPlainObject(this.manifest.physics, `${this.label} physics`, {});
      if (physics.space === undefined) {
        throw new Error(`${this.label} physics.space is required with objects or objectSets`);
      }
      if (physics.bodies !== undefined) {
        throw new Error(`${this.label} objects and objectSets derive physics bodies from object.physics; remove physics.bodies`);
      }
    }
    for (const key of ["sceneUrl", "modelAssetUrl", "sceneAssetUrl", "materialsUrl", "physicsUrl"]) {
      if (this.manifest[key] !== undefined) {
        util.readOptionalString(this.manifest[key], `${this.label} ${key}`, undefined, {
          trim: true,
          allowEmpty: false
        });
      }
    }
    return true;
  }

  // manifestからSceneAssetを作成し、既存SceneValidator/SceneLoaderへ検証を委譲します
  async loadSceneAsset() {
    this.requireAlive();
    this.validate();
    if (this.manifest.scene !== undefined) {
      return SceneAsset.fromData(this.manifest.scene);
    }
    if (this.manifest.sceneUrl !== undefined) {
      return SceneAsset.load(this.resolveUrl(this.manifest.sceneUrl, "sceneUrl"));
    }
    throw new Error(`${this.label} requires scene or sceneUrl`);
  }

  // manifestからModelAssetを読み込み、SceneAssetと同じproject基準URLへ揃えます
  // ModelAssetのNode姿勢とmesh geometryを作品ページへ明示的に渡します
  async loadModelAsset() {
    this.requireAlive();
    this.validate();
    if (this.manifest.modelAsset !== undefined || this.manifest.sceneAsset !== undefined) {
      return ModelAsset.fromData(this.cloneValue(
        this.manifest.modelAsset ?? this.manifest.sceneAsset
      ));
    }
    if (this.manifest.modelAssetUrl !== undefined) {
      return ModelAsset.load(this.resolveUrl(this.manifest.modelAssetUrl, "modelAssetUrl"));
    }
    if (this.manifest.sceneAssetUrl !== undefined) {
      return ModelAsset.load(this.resolveUrl(this.manifest.sceneAssetUrl, "sceneAssetUrl"));
    }
    throw new Error(`${this.label} requires a scene asset source`);
  }

  // 外部またはinlineのJSON設定を読み、指定された型を確認して返します
  // 材質と物理の設定元を同じproject URL基準へそろえ、読込み失敗を項目名付きで通知します
  async loadJsonValue(inlineKey, urlKey, label, expectedType, defaultValue) {
    this.requireAlive();
    this.validate();
    if (this.manifest[inlineKey] !== undefined) {
      const value = this.cloneValue(this.manifest[inlineKey]);
      if (!expectedType(value)) throw new Error(`${this.label} ${label} has an invalid value`);
      return value;
    }
    if (this.manifest[urlKey] === undefined) return this.cloneValue(defaultValue);
    const url = this.resolveUrl(this.manifest[urlKey], urlKey);
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(`Failed to load ${label}: ${url} (${error?.message ?? error})`);
    }
    if (!response.ok) {
      throw new Error(`Failed to load ${label}: ${url} (${response.status} ${response.statusText})`);
    }
    let value;
    try {
      value = await response.json();
    } catch (error) {
      throw new Error(`Failed to parse ${label}: ${url} (${error?.message ?? error})`);
    }
    if (!expectedType(value)) throw new Error(`${this.label} ${label} has an invalid value: ${url}`);
    return this.cloneValue(value);
  }

  // 材質manifestを配列として読み込み、部品IDと材質設定を高水準側へ渡します
  // inline指定と外部URL指定を同じ配列形式へ解決します
  async loadMaterials() {
    return this.loadJsonValue(
      "materials",
      "materialsUrl",
      "materials",
      (value) => Array.isArray(value),
      []
    );
  }

  // 物理manifestをobjectとして読み込み、global設定とbody設定を同じprojectから取得します
  // Compute backendへ渡す前に、ProjectRuntimeがbody entryをNodeへ対応付けます
  async loadPhysics() {
    const value = await this.loadJsonValue(
      "physics",
      "physicsUrl",
      "physics",
      (value) => value !== null && typeof value === "object" && !Array.isArray(value),
      {}
    );
    const hasPrimitiveObjects = this.manifest.objects !== undefined || this.manifest.objectSets !== undefined;
    if (!hasPrimitiveObjects) return value;
    const physics = util.readPlainObject(value, `${this.label} physics`, {});
    return this.manifest.modelAsset !== undefined
      || this.manifest.modelAssetUrl !== undefined
      || this.manifest.sceneAsset !== undefined
      || this.manifest.sceneAssetUrl !== undefined
      ? createModelPhysicsManifest(physics, this.manifest.objects, this.label)
      : createPrimitivePhysicsManifest(
        physics,
        this.manifest.objects,
        this.manifest.objectSets,
        this.label
      );
  }

  // project.objectsからprimitive NodeとShapeを構築し、body bindingと同じID表を返します
  // ModelAsset経路とは別に、外部メッシュを準備しない一般sceneの入口を明示します
  async buildPrimitiveScene(target) {
    this.requireAlive();
    if (!target?.space || typeof target.getGPU !== "function") {
      throw new Error(`${this.label} buildPrimitiveScene requires WebgApp with space and GPU`);
    }
    this.validate();
    if (this.manifest.objects === undefined && this.manifest.objectSets === undefined) {
      throw new Error(`${this.label} requires objects or objectSets for primitive scene`);
    }
    const materials = await this.loadMaterials();
    const materialDefinitions = readPrimitiveMaterialManifest(materials, `${this.label}.materials`);
    return createPrimitiveScene(
      target,
      this.manifest.objects,
      `${this.label}.objects`,
      materialDefinitions,
      this.manifest.objectSets
    );
  }

  // ModelAssetをWebgAppへ展開し、asset Node IDから表示Nodeを取得できるruntimeを返します
  // ModelAssetが持つNode ID、mesh、material IDを一般的なentryへまとめます
  async buildModelRuntime(target) {
    this.requireAlive();
    if (!target?.space || typeof target.getGPU !== "function") {
      throw new Error(`${this.label} buildModelRuntime requires WebgApp with space and GPU`);
    }
    const asset = await this.loadModelAsset();
    asset.assertValid();
    const runtime = asset.build(target.getGPU());
    const instantiated = runtime.instantiate(target.space, { bindAnimations: false });
    const data = asset.getData();
    const meshes = new Map((data.meshes ?? []).map((mesh) => [mesh.id, mesh]));
    const materials = new Map((data.materials ?? []).map((material) => [material.id, material]));
    const nodeDefinitions = asset.getData()?.nodes ?? [];
    const entries = nodeDefinitions.map((definition) => {
      const node = instantiated.nodeMap.get(definition.id);
      if (!node) {
        throw new Error(`${this.label} model node "${definition.id}" is unavailable after instantiation`);
      }
      const mesh = definition.mesh === null || definition.mesh === undefined
        ? null
        : meshes.get(definition.mesh);
      if (definition.mesh !== null && definition.mesh !== undefined && !mesh) {
        throw new Error(`${this.label} model node "${definition.id}" references missing mesh "${definition.mesh}"`);
      }
      const materialId = mesh?.material ?? null;
      const material = materialId === null ? null : materials.get(materialId);
      if (materialId !== null && !material) {
        throw new Error(`${this.label} model mesh "${mesh.id}" references missing material "${materialId}"`);
      }
      const shapes = Array.isArray(node.shapes) ? Object.freeze([...node.shapes]) : Object.freeze([]);
      const spatial = Object.freeze({
        nodePose: readNodeSpatialPose(node, `${this.label} model node "${definition.id}"`),
        localGeometry: mesh
          ? readLocalGeometry(mesh, `${this.label} model node "${definition.id}"`)
          : null
      });
      return Object.freeze({
        id: definition.id,
        name: definition.name ?? null,
        definition,
        node,
        mesh,
        materialId,
        material,
        shapes,
        spatial
      });
    });
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const entryByReference = new Map(entryById);
    const bindings = this.readModelBindings(entries, entryByReference);
    return Object.freeze({
      asset,
      runtime,
      instantiated,
      gpu: target.getGPU(),
      entries: Object.freeze(entries),
      bindings,
      getEntry: (reference) => {
        const entry = entryByReference.get(String(reference));
        if (!entry) {
          throw new Error(`${this.label} model node reference "${reference}" is unavailable`);
        }
        return entry;
      },
      getNode: (reference) => {
        const entry = entryByReference.get(String(reference));
        if (!entry) {
          throw new Error(`${this.label} model node reference "${reference}" is unavailable`);
        }
        return entry.node;
      },
      describeSpatial: (reference, shapeValue) => {
        const entry = entryByReference.get(String(reference));
        if (!entry) {
          throw new Error(`${this.label} model node reference "${reference}" is unavailable`);
        }
        return createModelSpatialCorrespondence(
          entry,
          shapeValue,
          `${this.label} model node "${entry.id}"`
        );
      }
    });
  }

  // project.objectsまたはproject.bindingsへ明示された参照名をModelAsset Node IDへ解決します
  // asset内の表示名は作品側の安定した参照名と対象IDを一対一で明示します
  readModelBindings(entries, entryByReference) {
    const source = this.manifest.objects ?? this.manifest.bindings ?? [];
    if (!Array.isArray(source)) {
      throw new Error(`${this.label} bindings must be an array`);
    }
    const bindings = [];
    const bindingIds = new Set();
    const boundEntryIds = new Set();
    const sourceName = this.manifest.objects === undefined ? "bindings" : "objects";
    for (let index = 0; index < source.length; index += 1) {
      const label = `${this.label} ${sourceName}[${index}]`;
      const definition = util.readPlainObject(source[index], label);
      for (const key of Object.keys(definition)) {
        if (key !== "id" && key !== "node" && key !== "material" && key !== "physics") {
          throw new Error(`${label}.${key} is not supported`);
        }
      }
      const id = util.readOptionalString(definition.id, `${label}.id`, undefined, {
        trim: true,
        allowEmpty: false
      });
      const nodeId = util.readOptionalString(definition.node, `${label}.node`, undefined, {
        trim: true,
        allowEmpty: false
      });
      const materialId = this.manifest.objects === undefined
        ? entryByReference.get(nodeId)?.materialId ?? null
        : util.readOptionalString(definition.material, `${label}.material`, undefined, {
          trim: true,
          allowEmpty: false
        });
      if (bindingIds.has(id) || entryByReference.has(id)) {
        throw new Error(`${this.label} duplicate model binding id: ${id}`);
      }
      const entry = entryByReference.get(nodeId);
      if (!entry) {
        throw new Error(`${label}.node references unavailable ModelAsset node: ${nodeId}`);
      }
      if (this.manifest.objects !== undefined && materialId !== entry.materialId) {
        throw new Error(
          `${label}.material references ${materialId}, but ModelAsset node ${entry.id} uses ${entry.materialId}`
        );
      }
      if (boundEntryIds.has(entry.id)) {
        throw new Error(`${this.label} ModelAsset node is bound more than once: ${entry.id}`);
      }
      bindingIds.add(id);
      boundEntryIds.add(entry.id);
      entryByReference.set(id, entry);
      bindings.push(Object.freeze({ id, node: entry.id, materialId }));
    }
    return Object.freeze(bindings);
  }

  // ModelAssetのmaterial IDと実行時Shapeを対応付け、外部PBR定義を一括適用します
  // 作品コードはmanifestのmaterial ID対応を記述し、Node探索とShapeパラメータ展開をこの処理へ集約します
  async applyMaterials(modelRuntime, options = {}) {
    this.requireAlive();
    this.validate();
    if (!modelRuntime || !Array.isArray(modelRuntime.entries)) {
      throw new Error(`${this.label} applyMaterials requires a model runtime`);
    }
    const sourceOptions = util.readPlainObject(options, `${this.label} applyMaterials options`, {});
    for (const key of Object.keys(sourceOptions)) {
      if (key !== "proceduralMaterials") {
        throw new Error(`${this.label} applyMaterials has unknown option: ${key}`);
      }
    }
    let proceduralMaterials = sourceOptions.proceduralMaterials ?? null;
    if (proceduralMaterials !== null
      && (typeof proceduralMaterials.createPreset !== "function"
        || typeof proceduralMaterials.destroyMaterial !== "function")) {
      throw new Error(`${this.label} applyMaterials proceduralMaterials must be a ProceduralMaterials manager`);
    }
    const definitions = await this.loadMaterials();
    const entries = modelRuntime.entries;
    const prepared = [];
    const usedMaterialIds = new Set();
    const objectMaterialReferences = this.manifest.objects === undefined
      ? []
      : this.manifest.objects.map((entry, index) => util.readOptionalString(
        entry.material,
        `${this.label}.objects[${index}].material`,
        undefined,
        { trim: true, allowEmpty: false }
      ));
    let requiresProceduralMaterials = false;
    for (let index = 0; index < definitions.length; index += 1) {
      const label = `${this.label} materials[${index}]`;
      const definition = util.readPlainObject(definitions[index], label);
      const knownKeys = new Set([
        "assetMaterialId", "materialId", "pbr", "preset", "tile", "appearance", "scale", "uvMapping"
      ]);
      for (const key of Object.keys(definition)) {
        if (!knownKeys.has(key)) throw new Error(`${label} has unknown key: ${key}`);
      }
      const assetMaterialId = util.readOptionalString(
        definition.assetMaterialId,
        `${label}.assetMaterialId`,
        undefined,
        { trim: true, allowEmpty: false }
      );
      if (usedMaterialIds.has(assetMaterialId)) {
        throw new Error(`${this.label} duplicate assetMaterialId: ${assetMaterialId}`);
      }
      usedMaterialIds.add(assetMaterialId);
      const hasPbr = definition.pbr !== undefined;
      const hasPreset = definition.preset !== undefined;
      if (hasPbr === hasPreset) {
        throw new Error(`${label} must specify exactly one of pbr or preset`);
      }
      const uvMapping = util.readOptionalString(
        definition.uvMapping,
        `${label}.uvMapping`,
        null,
        { trim: true, allowEmpty: false }
      );
      const supportedUvMappings = ["real-cuboid", "real-sphere", "real-capsule"];
      if (uvMapping !== null && !supportedUvMappings.includes(uvMapping)) {
        throw new Error(`${label}.uvMapping must be real-cuboid, real-sphere, or real-capsule`);
      }
      if (!hasPreset && definition.scale !== undefined) {
        throw new Error(`${label}.scale requires preset`);
      }
      const scale = hasPreset && definition.scale !== undefined
        ? util.readFiniteNumber(definition.scale, `${label}.scale`, { minExclusive: 0.0 })
        : null;
      if (scale !== null && !supportedUvMappings.includes(uvMapping)) {
        throw new Error(
          `${label}.scale requires uvMapping: real-cuboid, real-sphere, or real-capsule `
          + "for a completed ModelAsset Shape"
        );
      }
      const targets = entries.filter((entry) => entry.materialId === assetMaterialId);
      if (targets.length === 0) {
        throw new Error(`${this.label} material target is unavailable: ${assetMaterialId}`);
      }
      for (const entry of targets) {
        if (entry.shapes.length === 0) {
          throw new Error(`${this.label} material target node has no Shape: ${entry.id}`);
        }
        for (const shape of entry.shapes) {
          if (typeof shape.setMaterial !== "function") {
            throw new Error(`${this.label} material target is not a Shape: ${entry.id}`);
          }
        }
      }
      if (hasPreset) requiresProceduralMaterials = true;
      prepared.push({
        label,
        definition,
        assetMaterialId,
        targets,
        material: hasPbr ? readPbrMaterialParams(definition, label) : null,
        uvMapping,
        scale,
        preset: hasPreset
          ? util.readOptionalString(definition.preset, `${label}.preset`, undefined, {
            trim: true,
            allowEmpty: false
          })
          : null
      });
    }
    for (let index = 0; index < objectMaterialReferences.length; index += 1) {
      const assetMaterialId = objectMaterialReferences[index];
      if (!usedMaterialIds.has(assetMaterialId)) {
        throw new Error(
          `${this.label}.objects[${index}].material references ${assetMaterialId}, `
          + "but materials manifest has no matching assetMaterialId"
        );
      }
    }
    let ownsProceduralMaterials = false;
    if (requiresProceduralMaterials && proceduralMaterials === null) {
      if (!modelRuntime.gpu) {
        throw new Error(`${this.label} procedural material requires model runtime GPU`);
      }
      proceduralMaterials = new ProceduralMaterials(modelRuntime.gpu);
      this.proceduralMaterialManagers.add(proceduralMaterials);
      ownsProceduralMaterials = true;
    }
    const applied = [];
    const createdMaterials = [];
    const pendingReplacements = [];
    try {
      for (const item of prepared) {
        let materialId = item.material?.materialId ?? null;
        let proceduralMaterial = null;
        if (item.preset !== null) {
          const createOptions = {};
          for (const key of ["tile", "appearance", "scale"]) {
            if (item.definition[key] !== undefined) createOptions[key] = item.definition[key];
          }
          proceduralMaterial = await proceduralMaterials.createPreset(item.preset, createOptions);
          createdMaterials.push(proceduralMaterial);
          materialId = util.readOptionalString(
            item.definition.materialId,
            `${item.label}.materialId`,
            `project-procedural-${item.assetMaterialId}`,
            { trim: true, allowEmpty: false }
          );
        }
        const effectiveTargets = item.targets.map((entry) => {
          if (item.uvMapping === null) {
            return { entry, shapes: entry.shapes };
          }
          if (!modelRuntime.gpu) {
            throw new Error(`${item.label} ${item.uvMapping} mapping requires model runtime GPU`);
          }
          const existingShape = this.rebuiltMaterialShapes.get(entry);
          if (existingShape) return { entry, shapes: [existingShape] };
          const replacement = prepareMappedShape(
            entry,
            modelRuntime.gpu,
            item.label,
            item.uvMapping
          );
          const rebuiltShape = replacement.shape;
          this.rebuiltMaterialShapes.set(entry, rebuiltShape);
          return {
            entry,
            shapes: [rebuiltShape],
            replacement
          };
        });
        let shapeCount = 0;
        for (const target of effectiveTargets) {
          for (const shape of target.shapes) {
            if (proceduralMaterial) {
              proceduralMaterial.applyTo(shape, { materialId });
            } else {
              shape.setMaterial(materialId, item.material.params);
            }
            if (target.replacement) {
              shape.endShape();
              pendingReplacements.push({
                entry: target.entry,
                shape,
                originalShape: target.replacement.originalShape
              });
            }
            shapeCount += 1;
          }
        }
        applied.push(Object.freeze({
          assetMaterialId: item.assetMaterialId,
          materialId,
          kind: proceduralMaterial ? "procedural" : "pbr",
          preset: item.preset,
          uvMapping: item.uvMapping,
          nodeCount: effectiveTargets.length,
          shapeCount
        }));
      }
      for (const replacement of pendingReplacements) {
        replacement.originalShape.hide(true);
        replacement.entry.node.addShape(replacement.shape);
      }
    } catch (error) {
      for (const material of createdMaterials) material.destroy();
      if (ownsProceduralMaterials) {
        proceduralMaterials.destroy();
        this.proceduralMaterialManagers.delete(proceduralMaterials);
      }
      throw error;
    }
    const configuredMaterialIds = new Set(applied.map((entry) => entry.assetMaterialId));
    for (const entry of entries) {
      if (entry.materialId === null || configuredMaterialIds.has(entry.materialId)) continue;
      for (const shape of entry.shapes) {
        const params = shape.getMaterial?.()?.params;
        const hasFiniteSurface = params
          && Number.isFinite(params.specular)
          && Number.isFinite(params.roughness)
          && Number.isFinite(params.metallic);
        if (!hasFiniteSurface) {
          throw new Error(
            `${this.label} material definition is required for assetMaterialId: ${entry.materialId}`
          );
        }
      }
    }
    return Object.freeze(applied);
  }

  // WebgAppまたは{ gpu, space }を受け取り、SceneLoaderでscene runtimeを作ります
  async build(target) {
    this.requireAlive();
    const asset = await this.loadSceneAsset();
    return asset.build(target);
  }

  // targetへSceneLoaderを作る低水準入口を返します
  createLoader(target) {
    this.requireAlive();
    return new SceneLoader(target);
  }

  // project manifest内のrelative URLを読み込み元URLへ結び付けます
  resolveUrl(value, fieldName) {
    const path = util.readOptionalString(value, `${this.label} ${fieldName}`, undefined, {
      trim: true,
      allowEmpty: false
    });
    try {
      return this.sourceUrl === null ? new URL(path).toString() : new URL(path, this.sourceUrl).toString();
    } catch (error) {
      throw new Error(`${this.label} ${fieldName} requires an absolute URL or a sourceUrl base: ${path}`);
    }
  }

  // renderer設定を必須項目として検証し、SceneProject外へ複製値を返します
  getRendererOptions() {
    this.requireAlive();
    if (this.manifest.renderer === undefined) {
      throw new Error(`${this.label} renderer is required`);
    }
    return this.cloneValue(this.manifest.renderer);
  }

  // physics設定を複製して返します
  getPhysicsOptions() {
    this.requireAlive();
    return this.cloneValue(this.manifest.physics ?? {});
  }

  // Node名とbody設定の対応配列を複製して返します
  getBindings() {
    this.requireAlive();
    return this.cloneValue(this.manifest.bindings ?? []);
  }

  // JSONで表現できるmanifestの値だけを複製します
  cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // projectの状態を確認し、破棄済みprojectへの操作を状態エラーとして通知します
  requireAlive() {
    if (this.destroyed) throw new Error(`${this.label} is destroyed`);
  }

  // projectが保持するmanifest参照を閉じ、projectの状態をdestroyedへ更新します
  destroy() {
    if (this.destroyed) return false;
    for (const manager of this.proceduralMaterialManagers) manager.destroy();
    this.proceduralMaterialManagers.clear();
    this.manifest = null;
    this.destroyed = true;
    return true;
  }
}
