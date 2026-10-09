// ---------------------------------------------
// unittest/procedural_pebbles/main.js 2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// この確認ページでGPU生成結果を読み戻し、CPU参照値と色・高さ・法線の条件を比較する
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";
import { ProceduralTiledSurface } from "../../samples/procedural_texture/ProceduralTiledSurface.js";

const output = document.getElementById("result");
const lines = [];
// 条件の合否を記録し、失敗時は比較値を添えて原因を確認できる表示を作る
function check(name, ok, value = "") {
  lines.push(`${ok ? "PASS" : "FAIL"} ${name}${value === "" ? "" : `: ${value}`}`);
  output.textContent = lines.join("\n");
  if (!ok) throw new Error(name);
}

// 物理Heightと3枚のRGBA8画像を一つのbufferへコピーし、比較用の配列を返す
// 画像rowの256byte整列を除き、比較用の配列だけを残して一時bufferを破棄する
async function readMaterial(gpu, material) {
  const { width, height, physicalHeightBuffer } = material.result;
  const physicalBytes = width * height * 4;
  const row = Math.ceil(width * 4 / 256) * 256;
  const imageBytes = row * height;
  const buffer = gpu.device.createBuffer({
    size: physicalBytes + imageBytes*3,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  try {
    const encoder = gpu.device.createCommandEncoder();
    encoder.copyBufferToBuffer(physicalHeightBuffer, 0, buffer, 0, physicalBytes);
    const textures = [material.result.colorTexture, material.result.heightTexture, material.result.normalTexture];
    textures.forEach((texture, i) => encoder.copyTextureToBuffer(
      { texture: texture.texture },
      { buffer, offset: physicalBytes+i*imageBytes, bytesPerRow: row, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    ));
    gpu.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const physical = new Float32Array(mapped.slice(0, physicalBytes));
    // 各画像の行を連結し、256byte整列の余白を除いた画素列を作る
    const pixels = textures.map((_, i) => {
      const source = new Uint8Array(mapped, physicalBytes+i*imageBytes, imageBytes);
      const result = new Uint8Array(width*height*4);
      for (let y = 0; y < height; y++) result.set(source.subarray(y*row, y*row+width*4), y*width*4);
      return result;
    });
    return { physical, color: pixels[0], height: pixels[1], normal: pixels[2] };
  } finally {
    buffer.destroy();
  }
}

// 同じ長さの比較配列の差を調べ、最大誤差を一致判定へ返す
function maxDifference(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]-b[i]));
  return max;
}

// 石粒のGPU生成結果を読み戻し、独立したCPU参照値と色・高さ・法線の条件を検証する
async function run() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("WebGPU対応ブラウザーが必要です");
  const device = await adapter.requestDevice();
  const gpu = { device, queue: device.queue };
  const errors = [];
  device.addEventListener("uncapturederror", (event) => errors.push(event.error.message));
  device.pushErrorScope("validation");
  const materials = new ProceduralMaterials(gpu);
  const tile = { resolution: { pixelsPerMeter: 100 }, color: { dirtAmount: 0 } };
  // 指定presetと比較用の変更値から材質を生成し、GPU画像と物理Heightを読み戻す
  const generate = async (id, extra = {}) => {
    const material = await materials.createPreset(id, { tile: { ...tile, ...extra } });
    return { material, data: await readMaterial(gpu, material) };
  };
  try {
    // 3プリセットを同じ解像度で生成し、高さの範囲とCPU参照値への一致を調べる
    const ids = ["stone.pebbles.gray", "stone.pebbles-gravel.gray", "stone.gravel.gray"];
    const results = [];
    for (const id of ids) {
      const entry = await generate(id);
      results.push(entry);
      const { data, material } = entry;
      const [lo, hi] = material.result.heightRangeMeters;
      let min = Infinity;
      let max = -Infinity;
      let decodeError = 0;
      for (let i = 0; i < data.physical.length; i++) {
        min = Math.min(min, data.physical[i]);
        max = Math.max(max, data.physical[i]);
        decodeError = Math.max(decodeError, Math.abs(lo + data.height[i*4]/255*(hi-lo) - data.physical[i]));
      }
      check(`${id} 非負Heightと高さ上界`, min >= 0 && max <= hi+1e-7 && max > hi*0.5, max.toFixed(6));
      check(`${id} Heightの復号誤差`, decodeError <= (hi-lo)/510+1e-7, decodeError.toFixed(8));
      const cpu = new ProceduralTiledSurface(material.definition.tile).generate();
      check(`${id} CPU参照ColorとGPUが一致`, maxDifference(cpu.colorPixels, data.color) <= 1);
      check(`${id} CPU参照HeightとGPUが一致`, maxDifference(cpu.heightPixels, data.height) <= 1);
    }

    // 色・丸み・乱雑さを一つずつ変え、Colorと物理Heightの独立性を確認する
    const stones = results[0];
    const noColor = await generate(ids[0], { pattern: { colorAmount: 0 } });
    check("色の濃淡を0にしても物理Heightは不変", maxDifference(stones.data.physical, noColor.data.physical) === 0);
    check("色の濃淡を0にしてもNormalは不変", maxDifference(stones.data.normal, noColor.data.normal) === 0);
    check("色の濃淡を0にするとColorが変わる", maxDifference(stones.data.color, noColor.data.color) > 0);
    const regular = await generate(ids[0], { pattern: { pebbles: { irregularity: 0 } } });
    check("乱雑さを変えると粒の配置と形が変わる",
      maxDifference(stones.data.physical, regular.data.physical) > 0.002
      && maxDifference(stones.data.color, regular.data.color) > 0);
    const flatTops = await generate(ids[0], { pattern: { pebbles: { roundness: 0 } } });
    check("丸みを変えてもColorは不変", maxDifference(stones.data.color, flatTops.data.color) === 0);
    check("丸みを変えると物理Heightが変わる", maxDifference(stones.data.physical, flatTops.data.physical) > 0.002);
    const zeroHeight = await generate(ids[1], { pattern: { heightMeters: 0, pebbles: { gravelHeightMeters: 0 } } });
    check("両方の高さ0で完全な平面", zeroHeight.data.physical.every((h) => h === 0));
    check("平面のNormalは上向き", zeroHeight.data.normal.every((byte, i) => byte === (i%4 < 2 ? 128 : 255)));
    const repeated = await generate(ids[0]);
    check("同じseedの再生成が一致", maxDifference(stones.data.physical, repeated.data.physical) === 0 && maxDifference(stones.data.color, repeated.data.color) === 0);
    // 高さがある画素の被覆率で敷き詰めを、隙間のHeightで砂利の追加を確認する
    const unpacked = await generate(ids[0], { pattern: { pebbles: { density: 0.95, packing: 0 } } });
    // 物理Heightが正の画素の割合を求め、敷き詰め設定による被覆率を比較する
    const coverage = (data) => data.physical.filter((height) => height > 0).length / data.physical.length;
    check("石だけは隙間を狭めて敷き詰める", coverage(stones.data) > 0.85 && coverage(stones.data) > coverage(unpacked.data) + 0.25,
      `${(coverage(stones.data)*100).toFixed(1)}%`);
    const noGravel = await generate(ids[1], { pattern: { pebbles: { gravelAmount: 0 } } });
    const mixed = results[1].data;
    let filled = 0;
    for (let i = 0; i < mixed.physical.length; i++) if (noGravel.data.physical[i] === 0 && mixed.physical[i] > 0) filled++;
    check("石の隙間に砂利の高さが加わる", filled > 100, filled);

    // 周期端の実際のHeightから法線を再計算し、隣の反復へつながる差分を確認する
    const size = stones.material.result.width;
    const ppm = stones.material.result.pixelsPerMeter;
    const physical = stones.data.physical;
    // 周期的に折り返した座標の物理Heightを返し、端の中央差分を計算する
    const h = (x, y) => physical[((y+size)%size)*size+(x+size)%size];
    let normalError = 0;
    for (let y = 0; y < size; y++) {
      const nx = -(h(1,y)-h(-1,y))*ppm*0.5;
      const ny = -(h(0,y+1)-h(0,y-1))*ppm*0.5;
      const length = Math.hypot(nx,ny,1);
      // 単位法線をRGBA8と同じ範囲へ符号化し、GPUの周期端と比較する
      const expected = [nx/length, ny/length, 1/length].map((v) => Math.round((v*0.5+0.5)*255));
      expected.forEach((v, channel) => { normalError = Math.max(normalError, Math.abs(v-stones.data.normal[(y*size)*4+channel])); });
    }
    check("周期端のNormalが物理Heightの差分と一致", normalError <= 1, normalError);
    const error = await device.popErrorScope();
    check("GPU検証が成功", !error && errors.length === 0, error?.message ?? "");
    lines.push(`\n全${lines.length}項目 PASS`);
    output.textContent = lines.join("\n");
  } finally {
    materials.destroy();
    device.destroy();
  }
}
run().catch((error) => { output.textContent += `\nFAIL ${error.message}`; console.error(error); });
