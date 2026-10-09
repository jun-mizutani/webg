// ---------------------------------------------------------
// headless_tests/core/gltf_shape/pbr_material_contracts.js  2026/08/03
//   glTF 2.0 core PBR factor and texture conversion contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import GltfShape from "../../../webg/GltfShape.js";
import { srgbChannelToLinear } from "../../../webg/ColorSpace.js";

// glTFの線形factorがShape用sRGBへ変換され、Deferredで元の線形値へ戻ることを確認する
const loader = new GltfShape(null);
loader.data = {
  materials: [{
    pbrMetallicRoughness: {
      baseColorFactor: [0.25, 0.5, 0.75, 0.6],
      metallicFactor: 0.7,
      roughnessFactor: 0.35,
      baseColorTexture: { index: 0 },
      metallicRoughnessTexture: { index: 1 }
    },
    normalTexture: { index: 2, scale: 1.5 },
    occlusionTexture: { index: 3, strength: 0.65 },
    emissiveFactor: [4.0, 0.5, 0.1],
    emissiveTexture: { index: 4 },
    alphaMode: "BLEND",
    alphaCutoff: 0.4,
    doubleSided: true
  }],
  textures: [
    { source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }, { source: 4 }
  ]
};

const [material] = loader.buildMaterials();
const params = material.shaderParams;
assert.ok(Math.abs(srgbChannelToLinear(params.color[0]) - 0.25) < 1.0e-7);
assert.ok(Math.abs(srgbChannelToLinear(params.color[1]) - 0.5) < 1.0e-7);
assert.ok(Math.abs(srgbChannelToLinear(params.color[2]) - 0.75) < 1.0e-7);
assert.equal(params.color[3], 0.6);
assert.equal(params.alpha, 0.6);
assert.equal(params.metallic, 0.7);
assert.equal(params.roughness, 0.35);
assert.equal(params.specular, 1.0);
assert.equal(params.occlusion, 0.65);
assert.deepEqual(params.emissive_factor, [4.0, 0.5, 0.1]);
assert.equal(params.normal_strength, 1.5);
assert.equal(params.alpha_mode, "BLEND");
assert.equal(params.alpha_cutoff, 0.4);
assert.equal(params.double_sided, 1);

// 全texture roleが同じglTF index解決処理を通り、runtime名へ取りこぼしなく写ることを確認する
const runtimeTextures = Array.from({ length: 5 }, (_, index) => ({ id: `texture-${index}` }));
const requested = [];
loader.getRuntimeTexture = async (index) => {
  requested.push(index);
  return runtimeTextures[index];
};
const updates = [];
let compatibilityTexture = null;
const shape = {
  setTexture(texture) {
    compatibilityTexture = texture;
  },
  updateMaterial(update) {
    updates.push(update);
  }
};
const runtime = {
  nodes: [{ meshId: "mesh_0", shape }],
  meshDefs: new Map([["mesh_0", { _gltfMaterialIndex: 0 }]])
};
assert.equal(await loader.applyRuntimeMaterials(runtime), 1);
assert.deepEqual(requested, [0, 1, 2, 3, 4]);
assert.equal(compatibilityTexture, runtimeTextures[0]);
assert.deepEqual(updates[0], {
  use_texture: 1,
  texture: runtimeTextures[0],
  use_metallic_roughness_texture: 1,
  metallic_roughness_texture: runtimeTextures[1],
  use_normal_map: 1,
  normal_texture: runtimeTextures[2],
  use_occlusion_texture: 1,
  occlusion_texture: runtimeTextures[3],
  use_emissive_texture: 1,
  emissive_texture: runtimeTextures[4]
});

// 未対応UV setや壊れた参照を既定textureへ置き換えず、source解釈時に停止する
assert.throws(
  () => loader.validateTextureInfo({ index: 0, texCoord: 1 }, "normalTexture"),
  /TEXCOORD_0/
);
assert.throws(
  () => loader.validateTextureInfo({ index: 5 }, "emissiveTexture"),
  /outside glTF textures/
);
assert.throws(
  () => loader.validateTextureInfo({ index: 0, extensions: { KHR_texture_transform: {} } }, "baseColorTexture"),
  /not implemented/
);

// glTF schema値とwebgのruntime範囲が合わない場合を自動補正しない
loader.data = { materials: [{ pbrMetallicRoughness: { roughnessFactor: 0.0 } }] };
assert.throws(() => loader.buildMaterials(), /roughnessFactor must be >= 0.04/);
loader.data = { materials: [{ alphaMode: "UNKNOWN" }] };
assert.throws(() => loader.buildMaterials(), /alphaMode must be one of/);
loader.data = { materials: [{ doubleSided: 1 }] };
assert.throws(() => loader.buildMaterials(), /doubleSided must be boolean/);

console.log("PASS gltf_shape_pbr_material_contracts");
