// ---------------------------------------------
// samples/circular_breaker/shapeFactory.js  2026/04/10
//   circular_breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import { clamp } from "./constants.js";

// ベベル付き円柱を生成する
// Primitive.revolution() の断面 profile を使って、上下面の面取り付き形状を作る
export const makeBeveledCylinder = (gpu, radius, height, bevel, sides) => {
  const shape = new Shape(gpu);
  const h = height * 0.5;
  const b = clamp(bevel, 0.01, Math.min(h * 0.48, radius * 0.48));
  const r0 = Math.max(0.0001, radius - b);
  const profile = [
    0.0001, h,
    r0, h,
    radius, h - b,
    radius, -h + b,
    r0, -h,
    0.0001, -h
  ];
  shape.applyPrimitiveAsset(Primitive.revolution(5, sides, profile, false, shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
};

// ベベル付き直方体
// - addFace() は法線向きを自動補正して面の裏返りを防ぐ
// - 平面6 + エッジ面12 + 角面8 を構築
export const makeBeveledBox = (gpu, sx, sy, sz, bevel) => {
  const shape = new Shape(gpu);
  const hx = sx * 0.5;
  const hy = sy * 0.5;
  const hz = sz * 0.5;
  const b = clamp(bevel, 0.01, Math.min(hx, hy, hz) * 0.45);
  const ix = hx - b;
  const iy = hy - b;
  const iz = hz - b;

  const addFace = (pts) => {
    const n = pts.length;
    const cx = pts.reduce((a, p) => a + p[0], 0) / n;
    const cy = pts.reduce((a, p) => a + p[1], 0) / n;
    const cz = pts.reduce((a, p) => a + p[2], 0) / n;
    const [p0, p1, p2] = pts;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const outward = nx * cx + ny * cy + nz * cz;
    const ordered = outward >= 0 ? pts : [...pts].reverse();
    const idx = [];
    for (let i = 0; i < ordered.length; i++) {
      idx.push(shape.addVertex(ordered[i][0], ordered[i][1], ordered[i][2]) - 1);
    }
    shape.addPlane(idx);
  };

  // flat faces
  addFace([[-ix, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [-ix, iy, hz]]);
  addFace([[-ix, -iy, -hz], [-ix, iy, -hz], [ix, iy, -hz], [ix, -iy, -hz]]);
  addFace([[hx, -iy, -iz], [hx, iy, -iz], [hx, iy, iz], [hx, -iy, iz]]);
  addFace([[-hx, -iy, -iz], [-hx, -iy, iz], [-hx, iy, iz], [-hx, iy, -iz]]);
  addFace([[-ix, hy, -iz], [-ix, hy, iz], [ix, hy, iz], [ix, hy, -iz]]);
  addFace([[-ix, -hy, -iz], [ix, -hy, -iz], [ix, -hy, iz], [-ix, -hy, iz]]);

  // edge chamfers (12)
  addFace([[-ix, iy, hz], [ix, iy, hz], [ix, hy, iz], [-ix, hy, iz]]);
  addFace([[-ix, -hy, iz], [ix, -hy, iz], [ix, -iy, hz], [-ix, -iy, hz]]);
  addFace([[-ix, hy, -iz], [ix, hy, -iz], [ix, iy, -hz], [-ix, iy, -hz]]);
  addFace([[-ix, -iy, -hz], [ix, -iy, -hz], [ix, -hy, -iz], [-ix, -hy, -iz]]);

  addFace([[ix, -iy, hz], [ix, iy, hz], [hx, iy, iz], [hx, -iy, iz]]);
  addFace([[-hx, -iy, iz], [-hx, iy, iz], [-ix, iy, hz], [-ix, -iy, hz]]);
  addFace([[-ix, -iy, -hz], [-ix, iy, -hz], [-hx, iy, -iz], [-hx, -iy, -iz]]);
  addFace([[hx, -iy, -iz], [hx, iy, -iz], [ix, iy, -hz], [ix, -iy, -hz]]);

  addFace([[ix, hy, -iz], [ix, hy, iz], [hx, iy, iz], [hx, iy, -iz]]);
  addFace([[-hx, iy, -iz], [-hx, iy, iz], [-ix, hy, iz], [-ix, hy, -iz]]);
  addFace([[-ix, -hy, -iz], [-ix, -hy, iz], [-hx, -iy, iz], [-hx, -iy, -iz]]);
  addFace([[hx, -iy, -iz], [hx, -iy, iz], [ix, -hy, iz], [ix, -hy, -iz]]);

  // corner triangles (8)
  addFace([[ix, iy, hz], [hx, iy, iz], [ix, hy, iz]]);
  addFace([[-ix, iy, hz], [-ix, hy, iz], [-hx, iy, iz]]);
  addFace([[ix, -iy, hz], [ix, -hy, iz], [hx, -iy, iz]]);
  addFace([[-ix, -iy, hz], [-hx, -iy, iz], [-ix, -hy, iz]]);

  addFace([[ix, iy, -hz], [ix, hy, -iz], [hx, iy, -iz]]);
  addFace([[-ix, iy, -hz], [-hx, iy, -iz], [-ix, hy, -iz]]);
  addFace([[ix, -iy, -hz], [hx, -iy, -iz], [ix, -hy, -iz]]);
  addFace([[-ix, -iy, -hz], [-ix, -hy, -iz], [-hx, -iy, -iz]]);

  shape.endShape();
  return shape;
};

// マテリアル系パラメータ設定を共通化
// 色だけでなく ambient/specular/power までここで揃える
export const colorize = (shape, color, ambient, specular, power, emissive = 0.0) => {
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color,
    ambient,
    specular,
    power,
    emissive
  });
};
