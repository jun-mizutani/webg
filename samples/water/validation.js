// ---------------------------------------------
// validation.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// GPU readbackは検証ボタンから実行し、通常frameはGPU内で描画を完結する

// 符号・指数部・仮数部を読み、16bit浮動小数の測定値をJavaScriptの数値へ復元する
function half(word) {
  const sign = word & 0x8000 ? -1 : 1;
  const exponent = (word >> 10) & 31, fraction = word & 1023;
  return exponent === 31 ? (fraction ? NaN : sign * Infinity)
    : sign * (exponent ? 2 ** (exponent - 15) * (1 + fraction / 1024) : 2 ** -14 * fraction / 1024);
}

// HDRまたはRGBA8の画像を読み戻し、行paddingを除いたRGBA配列へ変換する
async function read(gpu, target) {
  const width = target.width, height = target.height;
  const byteColor = target.format === "rgba8unorm";
  const bytesPerRow = Math.ceil(width * (byteColor ? 4 : 8) / 256) * 256;
  const buffer = gpu.device.createBuffer({ size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = gpu.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: target.getTexture() }, { buffer, bytesPerRow }, [width, height]);
    gpu.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = buffer.getMappedRange();
    const values = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = byteColor ? new Uint8Array(raw, y * bytesPerRow, width * 4)
        : new Uint16Array(raw, y * bytesPerRow, width * 4);
      for (let i = 0; i < row.length; i++) values[y * width * 4 + i] = byteColor ? row[i] / 255 : half(row[i]);
    }
    return values;
  } finally { buffer.destroy(); }
}

// 比較対象の画素を選び、RGBの差から検証用の誤差指標を求める
function difference(a, b, mask, selected = true) {
  let maximum = 0, count = 0;
  for (let pixel = 0; pixel < a.length / 4; pixel++) {
    if (mask && (mask[pixel * 4] > 0) !== selected) continue;
    for (let c = 0; c < 3; c++) {
      maximum = Math.max(maximum, Math.abs(a[pixel * 4 + c] - b[pixel * 4 + c]));
    }
    count++;
  }
  return { maximum: count ? maximum : Infinity, pixels: count };
}


// 検証専用Computeで深度をstorageへ転写し、GPU完了後にCPUへ読み戻す
export async function readDepth(gpu, target) {
  const { default: ComputePass } = await import("../../webg/ComputePass.js");
  const bytes = target.width * target.height * 4;
  const output = gpu.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = gpu.device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const pass = new ComputePass(gpu, {
    label: "validation:depth to storage",
    code: `
@group(0) @binding(0) var depth : texture_depth_2d;
@group(0) @binding(1) var<storage, read_write> output : array<f32>;
@compute @workgroup_size(8,8)
// 対象pixelの深度をstorage bufferへ写し、検証時の読み戻しに使う
fn main(@builtin(global_invocation_id) id : vec3u) {
  let size = textureDimensions(depth);
  if (all(id.xy < size)) { output[id.y*size.x+id.x] = textureLoad(depth, vec2i(id.xy), 0); }
}`,
    bindings: [
      { binding: 0, name: "depth", type: "depth-texture" },
      { binding: 1, name: "output", type: "storage-buffer" }
    ]
  });
  try {
    const encoder = gpu.device.createCommandEncoder();
    pass.encode(encoder, { depth: target, output }, { dispatchSize: [target.width, target.height, 1] });
    encoder.copyBufferToBuffer(output, 0, readback, 0, bytes);
    gpu.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    return new Float32Array(readback.getMappedRange()).slice();
  } finally {
    pass.destroy(); output.destroy(); readback.destroy();
  }
}

// 通常PBRを基準に条件を切り替えて画像・仕事量を測定し、終了時に元の設定を復元する
export async function verify({ app, gpu, pipeline, scene, body, ledger, render }) {
  const checks = [];
  // 検証名・成否・測定値を一覧へ記録し、最終結果の集計に使う
  const check = (name, passed, value) => checks.push({ name, passed, value });
  const saved = { options: body.options, registrations: new Map(body.receivers),
    flags: pipeline.getWaterStats(), particlePass: pipeline.particlePass, width: pipeline.width, height: pipeline.height };
  const basePass = pipeline.deferredLightingPass.computePass;
  const toneMapEncode = pipeline.toneMapPass.encode;
  // 水面と集光のON/OFF・品質を切り替え、検証する描画条件を揃える
  const configure = (surfaceEnabled, causticsEnabled, quality = "low") =>
    pipeline.setWater(body, { surfaceEnabled, causticsEnabled, quality });
  // 現在の設定で一frame描画し、比較用のHDR画像をCPUへ読み戻す
  const image = async () => read(gpu, render());
  let failure, testEmitter;
  gpu.device.pushErrorScope("validation");
  try {
    await configure(false, false);
    const baseline = await image();
    const baselineFinal = await read(gpu, render(false, 1.5, {}, "final"));
    const off = await image();
    check("両方OFFは全HDR画素が一致", difference(baseline, off).maximum === 0);
    check("OFFの専用buffer/textureは0", ledger.snapshot().logicalBytes === 0, ledger.snapshot());
    const created = JSON.stringify(ledger.snapshot().created);
    render(); render();
    check("OFF frameは追加GPU資源を生成しない", JSON.stringify(ledger.snapshot().created) === created);
    check("通常照明は17binding", basePass.bindings.length === 17);
    await configure(false, true);
    for (const [name, target] of Object.entries({ floor: scene.floor, sphere: scene.objects.sphere.node,
      box: scene.objects.box.shape, slope: scene.objects.slope.node })) {
      body.clearReceivers().addReceiver(target);
      const on = await image();
      const mask = await read(gpu, pipeline.waterSystem.mask.emissiveTarget);
      const inside = difference(on, baseline, mask), outside = difference(on, baseline, mask, false);
      check(`${name}: 登録面の拡散反射が変わる`, inside.pixels > 100 && inside.maximum > 0.01, inside);
      check(`${name}: 対象外に漏れない`, outside.maximum === 0, outside);
    }
    body.clearReceivers();
    check("対象0件は通常PBR", difference(await image(), baseline).maximum === 0);
    body.addReceiver(scene.objects.sphere.node).addReceiver(scene.objects.sphere.shape, { strength: 0 });
    check("Shapeのstrength=0がNode指定より優先", difference(await image(), baseline).maximum === 0);
    body.receivers = new Map(saved.registrations);
    await image(); await image();
    check("停止中の照度画像は再利用", pipeline.getWaterStats().causticDispatches === 0);
    check("通常ComputePassを差し替えない", pipeline.deferredLightingPass.computePass === basePass);
    await configure(true, false);
    const opaque = await image();
    const water = await read(gpu, pipeline.waterSystem.surface.output);
    check("水面だけでもHDRが変わる", difference(water, baseline).maximum > 0.01);
    check("水面は不透明PBR画像を変更しない", difference(opaque, baseline).maximum === 0);
    check("水面のHDRは有限", water.every(Number.isFinite));
    const originalDepth = await readDepth(gpu, pipeline.gbuffer.getBindingResources().depth);
    const waterDepth = await readDepth(gpu, pipeline.waterSystem.surface.depth);
    const changed = waterDepth.filter((v, i) => v > originalDepth[i] + 1e-6).length;
    check("後段用の深度に水面が入る", changed > 1000, { changed });
    check("水面深度は不透明面より奥へ後退しない", waterDepth.every((v, i) => v >= originalDepth[i] - 1e-6));
    check("Tone Mapの関数を差し替えない", pipeline.toneMapPass.encode === toneMapEncode);
    body.setOptions({ ior: 1, absorption: [0, 0, 0] });
    await image();
    check("IOR=1・吸収0は元HDRと一致", difference(await read(gpu, pipeline.waterSystem.surface.output), baseline).maximum === 0);
    body.setOptions(saved.options);
    // 同じ不透明HDRを入力に固定し、水面の環境・光源応答だけを比較する
    const surfaceImage = async ({ environment = {}, lighting = {} } = {}) => {
      const encoder = gpu.device.createCommandEncoder();
      const surface = pipeline.waterSystem.surface;
      const result = surface.encode(encoder, pipeline.deferredLightingPass.getOutputTarget(),
        pipeline.gbuffer.getBindingResources(), { body, cameraFrame: app.updateCameraFrame(),
          environment: { ...pipeline.deferredLightingPass.currentEnvironment, ...environment },
          lighting: { ...pipeline.lightingOptions, ...lighting }, light: pipeline.currentShadowLight });
      gpu.queue.submit([encoder.finish()]);
      return read(gpu, result.scene);
    };
    const noEnvironment = await surfaceImage({ environment: { intensity: 0 } });
    const reflectedEnvironment = await surfaceImage({ environment: { intensity: 1 } });
    check("水面反射がPBR環境の強度に応答", difference(noEnvironment, reflectedEnvironment).maximum > 0.01);
    const rotated = await surfaceImage({ environment: { intensity: 1, rotationCos: 0, rotationSin: 1 } });
    check("水面反射がPBR環境の回転に応答", difference(rotated, reflectedEnvironment).maximum > 0.01);
    const red = await surfaceImage({ lighting: { directionalColor: [1, 0, 0] } });
    const blue = await surfaceImage({ lighting: { directionalColor: [0, 0, 1] } });
    check("水面鏡面が現在の光源色に応答", difference(red, blue).maximum > 0.01);
    const dark = await surfaceImage({ lighting: { directionalIntensity: 0 } });
    check("水面鏡面が現在の光源強度に応答", difference(dark, red).maximum > 0.01);
    body.setOptions({ absorption: [0.07, 0.015, 0.07] });
    const green = await surfaceImage();
    body.setOptions(saved.options);
    check("RGB吸収係数で水の色を変更できる", difference(green, await surfaceImage()).maximum > 0.01);
    for (const effect of ["fog", "dof", "bloom", "edge"]) {
      const post = render(false, 1.5, { [`${effect}Enabled`]: true, edgeGeometryEnabled: true }, "final");
      check(`${effect}: 水面合成後の画面効果が有効な画像を出力`, post.width === pipeline.width
        && post.height === pipeline.height && (await read(gpu, post)).some(value => value > 0.01));
    }
    await configure(true, true);
    await image();
    check("水面と集光を同時に使える", pipeline.getWaterStats().surfaceDispatches === 1 && pipeline.getWaterStats().receiverPasses === 1);
    const normal = pipeline.waterSystem.surface.normal;
    check("後段用の法線を同じ寸法で生成", normal.width === pipeline.width && normal.height === pipeline.height);
    app.fixedCanvasSize = { width: 640, height: 480, useDevicePixelRatio: false };
    app.applyViewportLayout();
    pipeline.resize(640, 480);
    await image();
    check("リサイズに追従", pipeline.waterSystem.surface.output.width === 640
      && pipeline.waterSystem.surface.depth.height === 480 && pipeline.waterSystem.mask.width === 640);
    app.fixedCanvasSize = { width: saved.width, height: saved.height, useDevicePixelRatio: false };
    app.applyViewportLayout();
    pipeline.resize(saved.width, saved.height);
    await configure(false, false);
    check("OFFで全専用buffer/textureを解放", ledger.snapshot().logicalBytes === 0, ledger.snapshot());
    check("OFFで専用QuerySetも解放", ledger.snapshot().querySets === 0);
    check("OFFで追加variantも解放", !pipeline.deferredLightingPass.causticsComputePass);
    check("OFFへ戻ると全HDR画素が一致", difference(await image(), baseline).maximum === 0);
    check("OFFへ戻ると最終LDR画素も一致", difference(await read(gpu, render(false, 1.5, {}, "final")), baselineFinal).maximum === 0);
    await configure(true, false);
    await image();
    const waterOnly = await read(gpu, pipeline.waterSystem.surface.output);
    const alpha = scene.objects.alpha;
    alpha.shape.hide(false);
    alpha.node.setPosition(0, 3, 0);
    await image();
    check("手前の透明面は屈折用背景に混ざらない",
      difference(await read(gpu, pipeline.waterSystem.layers.output), baseline).maximum === 0);
    check("手前の透明面は水面の後に合成する",
      difference(await read(gpu, pipeline.transparencyPass.outputTarget), waterOnly).maximum > 0.01);
    alpha.node.setPosition(0, 0.8, 0);
    await image();
    check("水中の透明面を屈折用背景へ入れる",
      difference(await read(gpu, pipeline.waterSystem.layers.output), baseline).maximum > 0.01);
    alpha.shape.hide(true);
    const { default: ComputeParticleEmitter } = await import("../../webg/ComputeParticleEmitter.js");
    const emitter = testEmitter = new ComputeParticleEmitter(gpu, { capacity: 8, preset: "light", simulation: { gravity: [0, 0, 0] }, appearance: { size: [0.2, 0.2] } });
    await pipeline.addParticleEmitter(emitter);
    emitter.emit(1, { position: [0, 3, 0], velocity: [0, 0, 0], velocitySpread: [0, 0, 0], lifetime: [5, 5] });
    await image();
    check("手前の粒子は屈折用背景に混ざらない",
      difference(await read(gpu, pipeline.waterSystem.layers.output), baseline).maximum === 0);
    check("手前の粒子は水面の後に合成する",
      difference(await read(gpu, pipeline.particlePass.target), waterOnly).maximum > 0.01);
    emitter.clear().emit(1, { position: [0, 0.8, 0], velocity: [0, 0, 0], velocitySpread: [0, 0, 0], lifetime: [5, 5] });
    await image();
    check("水中の粒子を屈折用背景へ入れる",
      difference(await read(gpu, pipeline.waterSystem.layers.output), baseline).maximum > 0.01);
    emitter.destroy();
    await configure(true, true, "high");
    await image();
    check("高品質へ切替", pipeline.waterSystem.field.size.pixels === 512);
    check("切替でreceiver登録が保持される", body.receivers.size === saved.registrations.size);
    for (let i = 0; i < 8; i++) { render(false, 1.5 + i / 60); await gpu.queue.onSubmittedWorkDone(); }
    await new Promise(resolve => setTimeout(resolve, 40));
    check("GPU計測値を取得", pipeline.getWaterStats().timing.timestampSupported
      ? pipeline.getWaterStats().timing.gpu.surface.sampleCount > 0 : true, pipeline.getWaterStats().timing);
  } catch (error) { failure = error; }
  finally {
    testEmitter?.destroy();
    if (!saved.particlePass && pipeline.particlePass) {
      pipeline.particlePass.destroy();
      pipeline.particlePass = null;
    } else { pipeline.particlePass?.emitters.delete(testEmitter); }
    scene.objects.alpha.shape.hide(true);
    body.setOptions(saved.options).setTime(1.5);
    body.receivers = new Map(saved.registrations);
    app.fixedCanvasSize = { width: saved.width, height: saved.height, useDevicePixelRatio: false };
    app.applyViewportLayout();
    pipeline.resize(saved.width, saved.height);
    await pipeline.setWater(body, saved.flags);
    render();
  }
  if (!saved.flags.surfaceEnabled && !saved.flags.causticsEnabled) {
    const resources = ledger.snapshot();
    check("透明面・粒子の使用後もOFFで全専用資源を解放", resources.buffers === 0
      && resources.textures === 0 && resources.querySets === 0, resources);
  }
  const gpuError = await gpu.device.popErrorScope();
  check("GPU validation errorなし", !gpuError && !failure, gpuError?.message ?? failure?.message ?? null);
  return { passed: checks.every(c => c.passed), count: checks.length, date: new Date().toISOString(), checks };
}
