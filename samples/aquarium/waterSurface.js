// ---------------------------------------------
// waterSurface.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 水中から見る水面。コアの共通WGSLで頂点を更新し、薄いPBR面として描く
// 上から見るWaterSurfacePassの屈折合成とは別の、裏側の表示用mesh

import Shape from "../../webg/Shape.js";
import ComputePass from "../../webg/ComputePass.js";
import { WATER_WAVE_WGSL } from "../../webg/WaterWaveWgsl.js";

// 細分した水面meshと頂点更新用Compute passを作り、表示・更新・解放の窓口を返す
export async function createWaterSurface(app, water) {
  const gpu = app.getGPU();
  const shape = new Shape(gpu);
  const nx = 160, nz = 108;
  const { width, depth, surfaceHeight, origin } = water.options;
  shape.setAutoCalcNormals(false);

  // 波を十分な密度で標本化する。巻き順と法線を反転し、上側を表にする。水中からは裏面を見る
  for (let z = 0; z <= nz; z++) {
    for (let x = 0; x <= nx; x++) {
      shape.addVertexUV(origin[0] + width * (x / nx - .5), surfaceHeight,
        origin[2] + depth * (z / nz - .5), x / nx, z / nz);
      shape.setVertNormal(shape.vertexCount - 1, 0, 1, 0);
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const a = z * (nx + 1) + x;
      shape.addTriangle(a, a + nx + 1, a + 1);
      shape.addTriangle(a + 1, a + nx + 1, a + nx + 2);
    }
  }
  shape.endShape();
  shape.setMaterial("water-underside", { color: [.28, .63, .72, 1], alpha: .08,
    double_sided: 1, roughness: .12, metallic: .05, specular: 1,
    ambient: 0, emissive_factor: [.025, .07, .09], flat_shading: 0 });
  app.space.addNode(null, "water-underside").addShape(shape);

  // Shapeの通常頂点形式（position/normal/UV、各8float）をComputeでも書けるbufferへ
  // 元bufferはここで解放し、置き換えたbufferはShape.destroy()が所有する
  shape.vertexBuffer.destroy();
  shape.vertexBuffer = gpu.device.createBuffer({ label: "aquarium:water-vertices",
    size: shape.vObj.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  gpu.queue.writeBuffer(shape.vertexBuffer, 0, shape.vObj);
  const pass = new ComputePass(gpu, { label: "aquarium:water-waves", uniformFloats: 44,
    workgroupSize: [64, 1, 1], bindings: [
      { binding: 0, name: "params", type: "uniform-buffer" },
      { binding: 1, name: "vertices", type: "storage-buffer" }
    ], code: WATER_WAVE_WGSL + `
@group(0) @binding(1) var<storage, read_write> vertices: array<f32>;
@compute @workgroup_size(64)
// 各頂点で共通の波の高さと法線を評価し、水面meshの頂点bufferを更新する
fn main(@builtin(global_invocation_id) id: vec3u) {
  let offset = id.x * 8u;
  if (offset + 7u >= arrayLength(&vertices)) { return; }
  let xz = vec2f(vertices[offset] - ${origin[0]}, vertices[offset + 2u] - ${origin[2]});
  let wave = surface(xz);
  let normal = normalAt(xz);
  vertices[offset + 1u] = wave.x + ${origin[1]};
  vertices[offset + 3u] = normal.x;
  vertices[offset + 4u] = normal.y;
  vertices[offset + 5u] = normal.z;
}` });
  const info = await pass.shaderModule.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === "error");
  if (errors.length) throw new Error(errors.map(message => message.message).join("\n"));

  return {
    // カメラの水面上下に合わせ、水中用meshの描画を切り替える
    setVisible(visible) { shape.hide(!visible); },

    // 共通の波uniformを渡し、PBR描画の前に頂点の高さと法線をGPUで更新する
    encode(encoder) {
      pass.setUniforms(water.createWaveUniforms());
      pass.encode(encoder, { vertices: shape.vertexBuffer }, { dispatchSize: [shape.vertexCount] });
    },

    // 頂点更新用Computeと、水面Shapeが所有する頂点bufferを解放する
    destroy() { pass.destroy(); shape.destroy(); }
  };
}
