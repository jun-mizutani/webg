// ---------------------------------------------
// WaterReceiverMask.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 通常描画と同じGeometryBufferPassで、可視surfaceの受光強度を記録する
// alpha MASK・skinningの一致を保つため、既存MRTの描画規則を共有する

import GeometryBufferPass from "./GeometryBufferPass.js";

export default class WaterReceiverMask extends GeometryBufferPass {
  // 通常のGeometry Bufferと同じ描画基盤を準備し、登録対象の受光強度を管理する
  constructor(gpu, width, height, receivers) {
    super(gpu, { label: "caustic:receiver-mask", width, height });
    this.receivers = receivers;
    this.owners = new Map();
    this.renderCount = 0;
  }

  // Shapeへの指定が優先。Nodeは子孫を含み、最も近い登録Nodeを使う
  strength(shape) {
    const direct = this.receivers.get(shape);
    if (direct) return direct.strength;
    let node = this.owners.get(shape);
    let child = false;
    while (node) {
      const entry = this.receivers.get(node);
      if (entry && (!child || entry.children)) return entry.strength;
      node = node.parent;
      child = true;
    }
    return 0;
  }

  // 通常PBRのsurface情報を取得し、このpassの出力へ受光強度を書き込む
  resolveShapeSurface(shape, resolver, materialIndex = 0) {
    const surface = super.resolveShapeSurface(shape, resolver, materialIndex);
    // 本体の材質を維持し、独立したpassのemissive出力へmask強度を書く
    // alpha mask、両面、skinning、textureによる穴はコアの規則を引き継ぐ
    surface.emissiveFactor = [this.strength(shape), 0, 0];
    surface.legacyEmissive = 0;
    surface.useEmissiveTexture = false;
    return surface;
  }

  // 画面寸法とShapeの所有Nodeを更新し、可視面の深度と受光maskを描画する
  renderReceivers(space, cameraFrame, width, height) {
    this.resize(width, height);
    this.owners.clear();
    for (const node of space.nodes) {
      for (const shape of node?.shapes ?? []) this.owners.set(shape, node);
    }
    // 未登録の物体も深度へ書く。手前の物体の裏へmaskが漏れることを防ぐ
    this.renderSpace(space, cameraFrame, [0, 0, 0, 1]);
    this.renderCount++;
  }
}
