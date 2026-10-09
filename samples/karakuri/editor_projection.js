import Matrix from "../../webg/Matrix.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";

export function viewProjection(app) {
  if (!app?.eye || !app.projectionMatrix) return null;
  const view = new Matrix();
  view.makeView(app.eye.getWorldMatrix());
  const vp = app.projectionMatrix.clone();
  vp.mul_(view);
  return vp;
}

export function projectPoint(vp, point, width, height) {
  if (!vp) return null;
  const m = vp.mat;
  const w = m[3]*point[0] + m[7]*point[1] + m[11]*point[2] + m[15];
  if (w <= 1e-8) return null;
  const ndc = vp.mulVector(point);
  return { left: (ndc[0]+1)*width/2, bottom: (ndc[1]+1)*height/2, depth: ndc[2] };
}

export function pointOnHeight(vp, xRatio, yRatio, height) {
  if (!vp) return null;
  const inv = vp.clone();
  if (!inv.inverse_strict()) return null;
  const x = xRatio*2-1, y = 1-yRatio*2;
  const a = inv.mulVector([x, y, CAMERA_REVERSE_Z.nearDepth]);
  const b = inv.mulVector([x, y, CAMERA_REVERSE_Z.farDepth]);
  const dy = b[1]-a[1];
  if (Math.abs(dy) < 1e-10) return null;
  const t = (height-a[1])/dy;
  if (t < 0) return null;
  return [a[0]+(b[0]-a[0])*t, height, a[2]+(b[2]-a[2])*t];
}

// Reverse-Zの画面座標から、ワールド空間のレイを作ります。
export function screenRay(vp, xRatio, yRatio) {
  if (!vp) return null;
  const inv = vp.clone();
  if (!inv.inverse_strict()) return null;
  const x = xRatio * 2 - 1, y = 1 - yRatio * 2;
  const origin = inv.mulVector([x, y, CAMERA_REVERSE_Z.nearDepth]);
  const far = inv.mulVector([x, y, 0.5]);
  const direction = far.map((v, i) => v - origin[i]);
  const length = Math.hypot(...direction);
  return length > 0 ? { origin, direction: direction.map(v => v / length) } : null;
}

// 奥行きを保持したXY工作面へ配置・ドラッグを投影します。
export function pointOnDepth(vp, x, y, depth = 0) {
  const ray = screenRay(vp, x, y);
  if (!ray || Math.abs(ray.direction[2]) < 1e-8) return null;
  const t = (depth - ray.origin[2]) / ray.direction[2];
  return t >= 0 ? ray.origin.map((v, i) => v + ray.direction[i] * t) : null;
}

// 表示メッシュの三角形と交差させ、斜めの板や球も輪郭どおりに選びます。
export function pickMesh(entries, ray) {
  if (!ray) return null;
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  let nearest = null;
  for (const entry of entries) {
    const world = entry.node.getWorldMatrix();
    for (const shape of entry.node.shapes ?? []) {
      if (shape.isHidden) continue;
      const positions = shape.positionArray, indices = shape.indicesArray;
      const vertex = i => world.mulVector(positions.slice(i*3, i*3+3));
      for (let i = 0; i < indices.length; i += 3) {
        const a = vertex(indices[i]), b = vertex(indices[i+1]), c = vertex(indices[i+2]);
        const e1 = sub(b, a), e2 = sub(c, a), p = cross(ray.direction, e2);
        const det = dot(e1, p);
        if (Math.abs(det) < 1e-9) continue;
        const offset = sub(ray.origin, a), u = dot(offset, p) / det;
        if (u < 0 || u > 1) continue;
        const q = cross(offset, e1), v = dot(ray.direction, q) / det;
        if (v < 0 || u + v > 1) continue;
        const distance = dot(e2, q) / det;
        if (distance >= 0 && (!nearest || distance < nearest.distance)) nearest = { entry, distance };
      }
    }
  }
  return nearest?.entry ?? null;
}
