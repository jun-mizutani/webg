// ---------------------------------------------
//  TileMap.js    2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shape from "./Shape.js";
import util from "./util.js";

// cap の上面を少し小さくして、削れをなだらかに見せるための比率
const TILE_SURFACE_INSET_RATIO = 0.40;

// smooth cap の上端を丸くしすぎないため、中央の平らな面を少し残す
// - 0.05 は「上面半幅に対して 5% だけ」内側へ寄せる意味で使う
// - これにより smooth でも天面の reading を残しつつ、外周だけを薄く面取りできる
const TILE_SMOOTH_TOP_BEVEL_RATIO = 0.05;

// bevel の縦方向も横方向と同程度にし、面取り帯を視認しやすくする
// - これにより上面と側面のあいだに入る bevel 面が lighting 上でも読み取りやすくなる
const TILE_SMOOTH_TOP_BEVEL_HEIGHT_RATIO = TILE_SMOOTH_TOP_BEVEL_RATIO;

// 上面 texture の確認中は foundation を消し、cap だけを見やすくする
// - true に戻せば通常どおり foundation も描画される
const TILE_FOUNDATION_VISIBLE = true;

// 上面 4 頂点の UV を console へ出して、top face の貼られ方を追いやすくする
// - 確認が終わったら false に戻して通常運用へ戻す
const TILE_DEBUG_LOG_TOP_UVS = false;

// cap の法線を面ごとに分けるか、上面まわりで共有するかを切り替える
// - flat は今までどおり face ごとに頂点を分け、cell の輪郭と edge を強く残す
// - smooth は cap 部分だけ shared vertex で組み、top face と斜面のつながりを滑らかに見せる
// - foundation はどちらでも従来どおり独立 shape のまま残し、盤面の厚みと判読性を保つ
const resolveSurfaceShadingMode = (value) => {
  if (value === undefined || value === null) {
    return "flat";
  }
  const mode = String(value).trim().toLowerCase();
  if (mode === "flat" || mode === "smooth") {
    return mode;
  }
  throw new Error(`TileMap surfaceShading must be "flat" or "smooth": ${value}`);
};

// camera の向きを見て、画面上の arrow key を 2D grid の移動へ変換する
// - yaw は world の Y 軸回り回転を度数で受ける
// - これは TileMap の row / col の data 順序を決める処理ではなく、入力の見え方を回す helper
// - ArrowUp / ArrowDown は input 名で、cell 座標では ArrowUp が count down 側になる
// - 戻り値は { dx, dy } で、grid の col / row の更新にそのまま使える
export const resolveCameraRelativeGridMove = (yawDeg, key) => {
  if (!Number.isFinite(yawDeg)) {
    throw new Error(`resolveCameraRelativeGridMove requires finite yawDeg: ${yawDeg}`);
  }
  const keyName = String(key ?? "").toLowerCase();
  const desired = {
    arrowleft: [-1.0, 0.0],
    arrowright: [1.0, 0.0],
    arrowup: [0.0, -1.0],
    arrowdown: [0.0, 1.0]
  }[keyName];
  if (!desired) {
    return null;
  }

  const yawRad = Number.isFinite(yawDeg) ? yawDeg * Math.PI / 180.0 : 0.0;
  const screenBasis = [
    { dx: 1, dy: 0, screen: [Math.cos(yawRad), Math.sin(yawRad)] },
    { dx: -1, dy: 0, screen: [-Math.cos(yawRad), -Math.sin(yawRad)] },
    { dx: 0, dy: 1, screen: [-Math.sin(yawRad), Math.cos(yawRad)] },
    { dx: 0, dy: -1, screen: [Math.sin(yawRad), -Math.cos(yawRad)] }
  ];

  let best = null;
  for (let i = 0; i < screenBasis.length; i++) {
    const candidate = screenBasis[i];
    const score = candidate.screen[0] * desired[0] + candidate.screen[1] * desired[1];
    if (!best || score > best.score) {
      best = {
        dx: candidate.dx,
        dy: candidate.dy,
        score
      };
    }
  }
  return best ? { dx: best.dx, dy: best.dy } : null;
};

// 4 方向の高さ差を bitmask にして返す
// - east / west / north / south の 4 bit だけで、16 通りの削れ方を表す
// - 高い cell は、その方向の辺を中心方向へ寄せるだけでよい
export const resolveEdgeCutMask = (centerHeight, eastHeight, westHeight, northHeight, southHeight) => {
  const east = 1;
  const west = 2;
  const north = 4;
  const south = 8;
  let mask = 0;
  if (centerHeight > eastHeight) mask |= east;
  if (centerHeight > westHeight) mask |= west;
  if (centerHeight > northHeight) mask |= north;
  if (centerHeight > southHeight) mask |= south;
  return mask;
};

// edgeCutMask を人間向けの短い表記にする
// - 0 は flat
// - 1 bit ごとに E / W / N / S を並べる
export const describeEdgeCutMask = (mask) => {
  if (!Number.isFinite(mask)) {
    throw new Error(`describeEdgeCutMask requires finite mask: ${mask}`);
  }
  const value = Number(mask) & 15;
  if (value === 0) {
    return "flat";
  }
  const parts = [];
  if ((value & 1) !== 0) parts.push("E");
  if ((value & 2) !== 0) parts.push("W");
  if ((value & 4) !== 0) parts.push("N");
  if ((value & 8) !== 0) parts.push("S");
  return parts.join("+");
};

// 4 点の quad を Shape へ追加する
// - TileMap の cell mesh は最終的に quad 面の集合として組み立てるため、この helper を経由して頂点順を統一する
// - points は [x, y, z] の 4 点を想定し、addPlane() 側で三角形 2 枚へ分解させる
// - uvs を渡したときは、world 依存の自動 UV を使わず、各 face が指定した UV をそのまま入れる
// - TileMap では points を「外側から見て CCW」として渡し、その順をそのまま表面向きに使う
const addQuadFace = (shape, points, uvs = null) => {
  const start = shape.vertexCount;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const uv = Array.isArray(uvs) ? uvs[i] : null;
    if (Array.isArray(uv) && uv.length >= 2) {
      shape.addVertexPosUV(point, uv);
    } else {
      shape.addVertex(point[0], point[1], point[2]);
    }
  }
  shape.addPlane([start + 0, start + 1, start + 2, start + 3]);
};

// TileMap の 4 隅を固定 UV で返す
// - 上面も底面も、基準となる四隅は同じ 0..1 の角を共有する
// - 削れがある場合は buildTileCornerProfile() 側で topuv だけを内側へ寄せる
const createCornerUvProfile = () => ({
  nw: [0.0, 1.0],
  ne: [1.0, 1.0],
  sw: [0.0, 0.0],
  se: [1.0, 0.0]
});

// foundation 側面用に、面を正面から見た矩形 UV を返す
// - addPrismSlice() 側で各 face の points を「外側から見て CCW」にそろえている
// - そのため foundation 側面 UV は全方向で同じ並びを使え、左下=(0,0)、右上=(1,1) をそのまま表せる
// - 次に高さに応じて上端の V だけを補正し、背の低い土台では模様の伸びすぎを抑える
const createFoundationSideFaceUvs = (yBottom, yTop, horizontalSpan) => {
  const span = horizontalSpan;
  const topV = (yTop - yBottom) / span;
  return [[0.0, topV], [0.0, 0.0], [1.0, 0.0], [1.0, topV]];
};

// 4 辺の edge cut を bitmask からそのまま組み立てる
// - 各 bit は、その方向の辺を構成する 2 頂点を中心方向へ寄せる
// - corner は特別扱いせず、複数辺の cut の合成として自然に現れる
const buildTileCornerProfile = (outer, inset, mask) => {
  const top = {
    nw: [...outer.nw],
    ne: [...outer.ne],
    se: [...outer.se],
    sw: [...outer.sw]
  };
  const topuv = createCornerUvProfile();
  // cut は削る分の実寸をそのまま使い、silent clamp は行わない
  const cutw = inset;
  const cutd = inset;
  const cutr = TILE_SURFACE_INSET_RATIO * 0.5;

  if ((mask & 1) !== 0) {
    // east x-w u-r
    top.ne[0] -= cutw;
    top.se[0] -= cutw;
    topuv.ne[0] -= cutr;
    topuv.se[0] -= cutr;
  }
  if ((mask & 2) !== 0) {
    // west x+w u+r
    top.nw[0] += cutw;
    top.sw[0] += cutw;
    topuv.nw[0] = cutr;
    topuv.sw[0] = cutr;
  }
  if ((mask & 4) !== 0) {
    // north z+d v-r
    top.nw[1] += cutd;
    top.ne[1] += cutd;
    topuv.nw[1] -= cutr;
    topuv.ne[1] -= cutr;
  }
  if ((mask & 8) !== 0) {
    // south z-d v+r
    top.sw[1] -= cutd;
    top.se[1] -= cutd;
    topuv.sw[1] = cutr;
    topuv.se[1] = cutr;
  }
  return { top, topuv };
};

// bottom profile と top profile から、1 段ぶんの prism slice を組み立てる
// - cap も foundation も最終的にはこの helper で面を張り、TileMap の立体を同じ規則で作る
// - 上面 / 底面 / 4 側面をまとめて追加し、yBottom と yTop の高さ差が slice の厚みになる
// - 各 face は外側から見て CCW の順で points を渡し、webg の frontFace="ccw" と揃える
// - options.sideUvMode="foundation_facing" のときは、foundation 側面だけ面正面基準の UV へ切り替える
const addPrismSlice = (shape, bottom, top, topuv = createCornerUvProfile(), yBottom, yTop, options = {}) => {
  const bottomuv = createCornerUvProfile();
  const bottomPos = (name) => [bottom[name][0], yBottom, bottom[name][1]];
  const topPos = (name) => [top[name][0], yTop, top[name][1]];
  const bottomUv = (name) => [bottomuv[name][0], bottomuv[name][1]];
  const topUv = (name) => [topuv[name][0], topuv[name][1]];
  const topNW = topPos("nw");
  const topNE = topPos("ne");
  const topSE = topPos("se");
  const topSW = topPos("sw");
  const bottomNW = bottomPos("nw");
  const bottomNE = bottomPos("ne");
  const bottomSE = bottomPos("se");
  const bottomSW = bottomPos("sw");
  const topuvNW = topUv("nw");
  const topuvNE = topUv("ne");
  const topuvSE = topUv("se");
  const topuvSW = topUv("sw");
  const bottomuvNW = bottomUv("nw");
  const bottomuvNE = bottomUv("ne");
  const bottomuvSE = bottomUv("se");
  const bottomuvSW = bottomUv("sw");
  const widthRef = Math.max(1.0e-6, Math.abs(bottom.ne[0] - bottom.nw[0]));
  const depthRef = Math.max(1.0e-6, Math.abs(bottom.sw[1] - bottom.nw[1]));
  const useFoundationFacingSides = options?.sideUvMode === "foundation_facing";
  const includeTopFace = options?.includeTopFace !== false;

  // north
  addQuadFace(
    shape,
    [topNE, bottomNE, bottomNW, topNW],
    useFoundationFacingSides
      ? createFoundationSideFaceUvs(yBottom, yTop, widthRef)
      : [topuvNE, bottomuvNE, bottomuvNW, topuvNW]
  );
  // top
  if (includeTopFace) {
    addQuadFace(shape, [topNW, topSW, topSE, topNE], [topuvNW, topuvSW, topuvSE, topuvNE]);
  }
  // east
  addQuadFace(
    shape,
    [topSE, bottomSE, bottomNE, topNE],
    useFoundationFacingSides
      ? createFoundationSideFaceUvs(yBottom, yTop, depthRef)
      : [topuvSE, bottomuvSE, bottomuvNE, topuvNE]
  );
  // west
  addQuadFace(
    shape,
    [topNW, bottomNW, bottomSW, topSW],
    useFoundationFacingSides
      ? createFoundationSideFaceUvs(yBottom, yTop, depthRef)
      : [topuvNW, bottomuvNW, bottomuvSW, topuvSW]
  );
  // bottom
  addQuadFace(shape, [bottomNW, bottomNE, bottomSE, bottomSW], [bottomuvNW, bottomuvNE, bottomuvSE, bottomuvSW]);
  // south
  addQuadFace(
    shape,
    [topSW, bottomSW, bottomSE, topSE],
    useFoundationFacingSides
      ? createFoundationSideFaceUvs(yBottom, yTop, widthRef)
      : [topuvSW, bottomuvSW, bottomuvSE, topuvSE]
  );
};

// cell 全体の高さをそのまま描くと、遠景で side face の情報量が増えすぎて見通しが落ちる
// - TileMap は height を移動判定や pick にも使うため、論理上の box は full height のまま残す
// - render shape だけを「上面から何 step 分を見せるか」に絞り、camera から見える面数を減らす
// - visibleHeightSteps=1 なら、最上面から 1 段ぶんだけを cap として描画する
const resolveVisibleCapHeight = (tileMap, cell) => {
  return tileMap.heightStepY * tileMap.visibleHeightSteps;
};

// cap の下側に置く土台高さを返す
// - 高い cell を薄い cap だけで描くと、斜め視点で後ろの背景が抜けて見える
// - そのため render 上だけ、cap の直下へ foundation box を追加して厚みを戻す
// - visibleHeightSteps=1 の既定値では「全高 - 1 step 分」が土台になる
const resolveFoundationHeight = (tileMap, cell) => {
  const totalHeight = cell.box.maxy - cell.box.miny;
  const visibleCapHeight = resolveVisibleCapHeight(tileMap, cell);
  return totalHeight - visibleCapHeight;
};

// cell の cap shape を組み立てる前に、平面形状と高さをまとめて解決する
// - flat / smooth の両方で同じ top profile と厚みを使い、違いを法線共有の有無に限定する
// - buildCellShape() 側ではこの結果を受けて「どう面を張るか」だけを決める
const createCellCapGeometry = (tileMap, cell, edgeCutMask = 0) => {
  const width = cell.box.maxx - cell.box.minx;
  const depth = cell.box.maxz - cell.box.minz;
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const inset = Math.min(halfWidth, halfDepth) * TILE_SURFACE_INSET_RATIO;
  const renderMask = Number.isFinite(cell?.height) && Number(cell.height) > 0
    ? Number(edgeCutMask ?? 0) & 15
    : 0;
  const outer = {
    nw: [-halfWidth, -halfDepth],
    ne: [halfWidth, -halfDepth],
    sw: [-halfWidth, halfDepth],
    se: [halfWidth, halfDepth]
  };
  const profile = buildTileCornerProfile(outer, inset, renderMask);
  const totalHeight = Math.max(0.0001, cell.box.maxy - cell.box.miny);
  const visibleCapHeight = resolveVisibleCapHeight(tileMap, cell);
  const halfHeight = totalHeight * 0.5;
  const yTop = halfHeight;
  const yBottom = yTop - visibleCapHeight;

  if (TILE_DEBUG_LOG_TOP_UVS) {
    console.log(
      `[TileMap top uv] cell=(${cell.col},${cell.row}) height=${cell.height} mask=${renderMask} `
      + `nw=(${profile.topuv.nw[0].toFixed(3)},${profile.topuv.nw[1].toFixed(3)}) `
      + `ne=(${profile.topuv.ne[0].toFixed(3)},${profile.topuv.ne[1].toFixed(3)}) `
      + `se=(${profile.topuv.se[0].toFixed(3)},${profile.topuv.se[1].toFixed(3)}) `
      + `sw=(${profile.topuv.sw[0].toFixed(3)},${profile.topuv.sw[1].toFixed(3)})`
    );
  }

  return {
    outer,
    renderMask,
    top: profile.top,
    topuv: profile.topuv,
    yBottom,
    yTop
  };
};

// smooth cap 用に、上端の外周だけを薄く面取りする inner top profile を作る
// - outer shoulder は現在の top profile をそのまま使い、その少し内側へ平らな top を 1 段追加する
// - bevel ratio は half span 基準で読むため、0.05 なら上面半幅の 5% 分だけ内側へ寄る
// - UV も同じ考え方で内側へ寄せ、top の模様が急に引き延ばされないようにする
const createSmoothTopBevelProfile = (top, topuv, yBottom, yTop) => {
  const halfWidth = Math.abs(top.ne[0] - top.nw[0]) * 0.5;
  const halfDepth = Math.abs(top.sw[1] - top.nw[1]) * 0.5;
  const bevelInsetX = halfWidth * TILE_SMOOTH_TOP_BEVEL_RATIO;
  const bevelInsetZ = halfDepth * TILE_SMOOTH_TOP_BEVEL_RATIO;
  const uvHalfWidth = Math.abs(topuv.ne[0] - topuv.nw[0]) * 0.5;
  const uvHalfDepth = Math.abs(topuv.sw[1] - topuv.nw[1]) * 0.5;
  const bevelUvInsetU = uvHalfWidth * TILE_SMOOTH_TOP_BEVEL_RATIO;
  const bevelUvInsetV = uvHalfDepth * TILE_SMOOTH_TOP_BEVEL_RATIO;
  const capHeight = yTop - yBottom;
  const shoulderY = yTop - capHeight * TILE_SMOOTH_TOP_BEVEL_HEIGHT_RATIO;

  return {
    shoulderY,
    innerTop: {
      nw: [top.nw[0] + bevelInsetX, top.nw[1] + bevelInsetZ],
      ne: [top.ne[0] - bevelInsetX, top.ne[1] + bevelInsetZ],
      sw: [top.sw[0] + bevelInsetX, top.sw[1] - bevelInsetZ],
      se: [top.se[0] - bevelInsetX, top.se[1] - bevelInsetZ]
    },
    innerTopUv: {
      nw: [topuv.nw[0] + bevelUvInsetU, topuv.nw[1] - bevelUvInsetV],
      ne: [topuv.ne[0] - bevelUvInsetU, topuv.ne[1] - bevelUvInsetV],
      sw: [topuv.sw[0] + bevelUvInsetU, topuv.sw[1] + bevelUvInsetV],
      se: [topuv.se[0] - bevelUvInsetU, topuv.se[1] + bevelUvInsetV]
    }
  };
};

// shared vertex を使う smooth cap を組み立てる
// - bevel 用の inner top 4 点を追加し、中央の平らな面と外周の面取り帯を分ける
// - これにより top 全体が丸くなりすぎず、smooth でも天面の reading を残しやすい
// - side と bevel、bevel と top がそれぞれ shared vertex を持つため、つながりは滑らかに見える
const addSmoothPrismSlice = (shape, bottom, top, topuv = createCornerUvProfile(), yBottom, yTop) => {
  const bottomuv = createCornerUvProfile();
  const bevel = createSmoothTopBevelProfile(top, topuv, yBottom, yTop);
  const addSharedCorner = (pos, uv) => {
    const index = shape.vertexCount;
    shape.addVertexPosUV(pos, uv);
    return index;
  };
  const shoulderNW = addSharedCorner([top.nw[0], bevel.shoulderY, top.nw[1]], topuv.nw);
  const shoulderNE = addSharedCorner([top.ne[0], bevel.shoulderY, top.ne[1]], topuv.ne);
  const shoulderSE = addSharedCorner([top.se[0], bevel.shoulderY, top.se[1]], topuv.se);
  const shoulderSW = addSharedCorner([top.sw[0], bevel.shoulderY, top.sw[1]], topuv.sw);
  const topNW = addSharedCorner([bevel.innerTop.nw[0], yTop, bevel.innerTop.nw[1]], bevel.innerTopUv.nw);
  const topNE = addSharedCorner([bevel.innerTop.ne[0], yTop, bevel.innerTop.ne[1]], bevel.innerTopUv.ne);
  const topSE = addSharedCorner([bevel.innerTop.se[0], yTop, bevel.innerTop.se[1]], bevel.innerTopUv.se);
  const topSW = addSharedCorner([bevel.innerTop.sw[0], yTop, bevel.innerTop.sw[1]], bevel.innerTopUv.sw);
  const bottomNW = addSharedCorner([bottom.nw[0], yBottom, bottom.nw[1]], bottomuv.nw);
  const bottomNE = addSharedCorner([bottom.ne[0], yBottom, bottom.ne[1]], bottomuv.ne);
  const bottomSE = addSharedCorner([bottom.se[0], yBottom, bottom.se[1]], bottomuv.se);
  const bottomSW = addSharedCorner([bottom.sw[0], yBottom, bottom.sw[1]], bottomuv.sw);

  // top は中央の平らな 4 点だけで張り、天面を少し残す
  shape.addPlane([topNW, topSW, topSE, topNE]);
  // bevel 帯で top と side をつなぎ、外周だけを薄く面取りする
  shape.addPlane([topNE, shoulderNE, shoulderNW, topNW]);
  shape.addPlane([topSE, shoulderSE, shoulderNE, topNE]);
  shape.addPlane([topNW, shoulderNW, shoulderSW, topSW]);
  shape.addPlane([topSW, shoulderSW, shoulderSE, topSE]);
  // 4 側面は shoulder と bottom を共有し、従来の gap / foundation と自然につなぐ
  shape.addPlane([shoulderNE, bottomNE, bottomNW, shoulderNW]);
  shape.addPlane([shoulderSE, bottomSE, bottomNE, shoulderNE]);
  shape.addPlane([shoulderNW, bottomNW, bottomSW, shoulderSW]);
  shape.addPlane([shoulderSW, bottomSW, bottomSE, shoulderSE]);
  // bottom は foundation 側へ隠れやすいが、cap 単体でも閉じた形を保つため残す
  shape.addPlane([bottomNW, bottomNE, bottomSE, bottomSW]);
};

// cell 上面側に見せる cap shape を組み立てる
// - TileMap の論理 box は full height のまま残しつつ、render 上は top 付近だけを主役として見せる
// - edgeCutMask を反映した四角錐台寄りの shape を 1 slice だけ作り、texture 付きの見た目本体にする
const buildCellShape = (gpu, tileMap, cell, edgeCutMask = 0) => {
  const shape = new Shape(gpu);
  // TileMap は各頂点へ explicit UV を入れるため、
  // Shape 既定の sphere seam 補正(tx_mode=0) を無効にして UV 改変を防ぐ
  shape.setTextureMappingMode(1);
  const geometry = createCellCapGeometry(tileMap, cell, edgeCutMask);

  // node の原点は full height box の中心に置いたまま、
  // mesh だけを top 寄りに寄せて「上から 1 step 分だけ見える cap」を作る
  if (resolveSurfaceShadingMode(tileMap?.surfaceShading) === "smooth") {
    addSmoothPrismSlice(shape, geometry.outer, geometry.top, geometry.topuv, geometry.yBottom, geometry.yTop);
  } else {
    addPrismSlice(shape, geometry.outer, geometry.top, geometry.topuv, geometry.yBottom, geometry.yTop);
  }

  shape.endShape();
  return shape;
};

// cap の下側を埋める foundation shape を組み立てる
// - 高い cell を cap だけで描くと背景が抜けるため、見た目の土台だけを別 shape として追加する
// - foundation は top material を流用しつつ、側面 UV だけを面正面基準へ切り替えて見え方を追いやすくする
const buildCellFoundationShape = (gpu, tileMap, cell) => {
  if (!TILE_FOUNDATION_VISIBLE) {
    return null;
  }
  const foundationHeight = resolveFoundationHeight(tileMap, cell);
  if (foundationHeight <= 0.0001) {
    return null;
  }

  const shape = new Shape(gpu);
  // foundation も explicit UV で組み立てるため、sphere seam 補正を無効にする
  shape.setTextureMappingMode(1);
  const width = cell.box.maxx - cell.box.minx;
  const depth = cell.box.maxz - cell.box.minz;
  const totalHeight = Math.max(0.0001, cell.box.maxy - cell.box.miny);
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const halfHeight = totalHeight * 0.5;
  const yBottom = -halfHeight;
  const yTop = yBottom + foundationHeight;
  const outer = {
    nw: [-halfWidth, -halfDepth],
    ne: [halfWidth, -halfDepth],
    se: [halfWidth, halfDepth],
    sw: [-halfWidth, halfDepth]
  };

  // foundation は外から面を見た向きで側面 UV を組み立て、
  // 高さぶんだけ上端 V を補正して模様の伸び方を追いやすくする
  addPrismSlice(shape, outer, outer, createCornerUvProfile(), yBottom, yTop, {
    sideUvMode: "foundation_facing"
  });
  shape.endShape();
  return shape;
};

// TileMap は、3D 空間上の高さ付き盤面をまとめて扱う helper
// - tiles / generator から cell を組み立てる
// - cell ごとの top / wall ヒットを拾う
// - displayArea を follow しながら見える範囲を切り替える
export default class TileMap {
  // TileMap runtime の初期値と scene 定義を保持する
  // - ここではまだ node や mesh は作らず、build() が必要とする設定値だけを正規化しやすい形で持つ
  // - displayArea follow や render cap の既定値も constructor でまとめて決めておく
  constructor(space, gpu, definition = {}) {
    this.space = space ?? null;
    this.gpu = gpu ?? null;
    this.definition = definition ?? {};
    this.terrainMaterials = this.definition.terrainMaterials ?? {};
    this.root = null;
    this.cells = [];
    this.grid = [];
    this.width = 0;
    this.height = 0;
    this.displayArea = null;
    this.bounds = {
      minCol: 0,
      maxCol: -1,
      minRow: 0,
      maxRow: -1,
      centerX: 0.0,
      centerZ: 0.0
    };
    this.cellSize = this.readOptionalFinite(this.definition.cellSize, "cellSize", 4.0, { minExclusive: 0.0 });
    this.cellGap = this.readOptionalFinite(this.definition.cellGap, "cellGap", 0.18, { min: 0.0 });
    this.floorY = this.readOptionalFinite(this.definition.floorY, "floorY", -0.30);
    this.baseTopY = this.readOptionalFinite(this.definition.baseTopY, "baseTopY", 0.72);
    this.heightStepY = this.readOptionalFinite(this.definition.heightStepY, "heightStepY", 1.12, { minExclusive: 0.0 });
    const defaultVisibleHeightSteps = (this.baseTopY - this.floorY) / this.heightStepY;
    this.visibleHeightSteps = this.definition.visibleHeightSteps !== undefined
      ? this.readOptionalFinite(this.definition.visibleHeightSteps, "visibleHeightSteps", defaultVisibleHeightSteps, { minExclusive: 0.0 })
      : defaultVisibleHeightSteps;
    this.surfaceShading = resolveSurfaceShadingMode(this.definition.surfaceShading);
    if (this.cellGap >= this.cellSize) {
      throw new Error("TileMap cellGap must be smaller than cellSize");
    }
    this.tileSize = this.cellSize - this.cellGap;
    this.defaultDisplayFollowCol = this.readOptionalInteger(this.definition.displayFollowCol, "displayFollowCol", 1, { min: 0 });
    this.defaultDisplayFollowRow = this.readOptionalInteger(this.definition.displayFollowRow, "displayFollowRow", 1, { min: 0 });
    this.displayAreaPadding = this.readOptionalInteger(this.definition.displayAreaPadding, "displayAreaPadding", 2, { min: 0 });
    this.visibleCells = [];
  }

  readOptionalFinite(value, name, fallback, { min = null, minExclusive = null } = {}) {
    return util.readOptionalFiniteNumber(value, `TileMap ${name}`, fallback, { min, minExclusive });
  }

  readOptionalInteger(value, name, fallback, { min = null } = {}) {
    return util.readOptionalInteger(value, `TileMap ${name}`, fallback, { min });
  }

  // Scene JSON 側で使う tileMap 定義を受け取り、
  // build() までまとめて呼びやすい入口を作る
  static fromScene(scene = {}, space, gpu) {
    return new TileMap(space, gpu, scene?.tileMap ?? {});
  }

  // range 値を指定範囲へ押し込む
  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // terrain が明示されない場合でも height から見た目の分類を作る
  terrainFromHeight(height) {
    if (height >= 2) return "peak";
    if (height >= 1) return "slope";
    return "floor";
  }

  // terrain ごとの基本色を決める
  colorFromTerrain(terrain) {
    if (terrain === "peak") return [0.96, 0.74, 0.32, 1.0];
    if (terrain === "slope") return [0.55, 0.72, 1.0, 1.0];
    return [0.68, 0.70, 0.92, 1.0];
  }

  // terrain ごとの見た目設定を、色 / texture / normal map / UV mapping に分けて解決する
  // terrain ごとの定義は必須項目を明示し、default merge や terrain 推定は行わない
  resolveTerrainMaterial(terrain, cell = null) {
    const terrainKey = typeof terrain === "string" && terrain.length > 0
      ? terrain
      : cell?.terrain;
    if (typeof terrainKey !== "string" || terrainKey.length === 0) {
      throw new Error("TileMap terrain must be specified explicitly");
    }
    const terrainMaterials = this.terrainMaterials ?? {};
    const terrainMaterial = terrainMaterials[terrainKey] ?? {};
    const baseColorSource = Array.isArray(terrainMaterial.baseColor)
      ? terrainMaterial.baseColor
      : terrainMaterial.color;
    if (!Array.isArray(baseColorSource)) {
      throw new Error(`TileMap terrainMaterials.${terrainKey} requires color or baseColor`);
    }
    const materialId = terrainMaterial.materialId ?? terrainMaterial.id;
    if (materialId === undefined) {
      throw new Error(`TileMap terrainMaterials.${terrainKey} requires materialId`);
    }
    const baseColor = [...baseColorSource];
    const texture = terrainMaterial.texture;
    const normalTexture = terrainMaterial.normal_texture;
    const materialParams = {
      color: [...baseColor]
    };
    if (terrainMaterial.use_texture !== undefined) {
      materialParams.use_texture = Number(terrainMaterial.use_texture);
    }
    if (terrainMaterial.use_normal_map !== undefined) {
      materialParams.use_normal_map = Number(terrainMaterial.use_normal_map);
    }
    if (terrainMaterial.ambient !== undefined) {
      materialParams.ambient = Number(terrainMaterial.ambient);
    }
    if (terrainMaterial.specular !== undefined) {
      materialParams.specular = Number(terrainMaterial.specular);
    }
    if (terrainMaterial.power !== undefined) {
      materialParams.power = Number(terrainMaterial.power);
    }
    if (texture !== undefined) {
      materialParams.texture = texture;
    }
    if (normalTexture !== undefined) {
      materialParams.normal_texture = normalTexture;
    }
    if (terrainMaterial.normal_strength !== undefined) {
      materialParams.normal_strength = terrainMaterial.normal_strength;
    }
    if (terrainMaterial.emissive !== undefined) {
      materialParams.emissive = terrainMaterial.emissive;
    }

    return {
      terrain: terrainKey,
      baseColor,
      displayColor: [...baseColor],
      materialId,
      materialParams,
    };
  }

  // 色の補正を行いたいときに使う単純な helper
  tintColor(rgba, factor) {
    return [
      rgba[0] * factor,
      rgba[1] * factor,
      rgba[2] * factor,
      rgba[3]
    ];
  }

  // tileMap の width / height を検証しながら保持する
  normalizeDimensions(definition) {
    const width = Number(definition.width);
    const height = Number(definition.height);
    if (!Number.isFinite(width) || !Number.isInteger(width) || width <= 0) {
      throw new Error("tileMap.width must be a positive integer");
    }
    if (!Number.isFinite(height) || !Number.isInteger(height) || height <= 0) {
      throw new Error("tileMap.height must be a positive integer");
    }
    this.width = width;
    this.height = height;
  }

  // tileMap.displayArea を x/y/width/height か min/max から正規化する
  normalizeDisplayArea(displayArea) {
    if (!displayArea) {
      return null;
    }
    const hasXYRect = displayArea.x !== undefined
      || displayArea.y !== undefined
      || displayArea.width !== undefined
      || displayArea.height !== undefined;
    let minCol;
    let minRow;
    let width;
    let height;
    if (hasXYRect) {
      if (!Number.isFinite(displayArea.x)
        || !Number.isFinite(displayArea.y)
        || !Number.isFinite(displayArea.width)
        || !Number.isFinite(displayArea.height)) {
        throw new Error("tileMap.displayArea x/y/width/height must all be specified");
      }
      minCol = Math.floor(displayArea.x);
      minRow = Math.floor(displayArea.y);
      width = Math.floor(displayArea.width);
      height = Math.floor(displayArea.height);
    } else {
      if (!Number.isFinite(displayArea.minCol) || !Number.isFinite(displayArea.minRow)) {
        throw new Error("tileMap.displayArea requires minCol/minRow or x/y");
      }
      minCol = Math.floor(displayArea.minCol);
      minRow = Math.floor(displayArea.minRow);
      if (Number.isFinite(displayArea.width) || Number.isFinite(displayArea.height)) {
        if (!Number.isFinite(displayArea.width) || !Number.isFinite(displayArea.height)) {
          throw new Error("tileMap.displayArea width/height must both be specified");
        }
        width = Math.floor(displayArea.width);
        height = Math.floor(displayArea.height);
      } else {
        if (!Number.isFinite(displayArea.maxCol) || !Number.isFinite(displayArea.maxRow)) {
          throw new Error("tileMap.displayArea requires maxCol/maxRow when width/height are omitted");
        }
        width = Math.floor(displayArea.maxCol) - minCol + 1;
        height = Math.floor(displayArea.maxRow) - minRow + 1;
      }
    }
    const maxCol = minCol + width - 1;
    const maxRow = minRow + height - 1;
    return {
      minCol,
      maxCol,
      minRow,
      maxRow,
      width,
      height
    };
  }

  // generator 由来の height map を作る
  // generator 利用時も必要項目はすべて明示し、terrain の自動推定は行わない
  generateTileDefinitions(definition) {
    if (Array.isArray(definition.tiles) && definition.tiles.length > 0) {
      return definition.tiles;
    }

    if (!definition.generator) {
      return [];
    }

    const generator = definition.generator;
    if (!Number.isFinite(generator.heightMin)
      || !Number.isFinite(generator.heightMax)
      || !Number.isFinite(generator.seed)) {
      throw new Error("tileMap.generator requires heightMin/heightMax/seed");
    }
    if (typeof generator.terrain !== "string" || generator.terrain.length === 0) {
      throw new Error("tileMap.generator requires terrain");
    }
    if (generator.type === undefined && generator.noiseType === undefined) {
      throw new Error("tileMap.generator requires type or noiseType");
    }
    const heightMin = generator.heightMin;
    const heightMax = generator.heightMax;
    const seed = generator.seed;
    const mode = String(generator.type ?? generator.noiseType).toLowerCase();
    const terrain = generator.terrain;
    const centerCol = (this.width - 1) * 0.5;
    const centerRow = (this.height - 1) * 0.5;
    const maxDist = Math.max(centerCol, centerRow) || 1;
    const tiles = [];

    const hashNoise = (x, y) => {
      let h = 2166136261 ^ seed;
      h = Math.imul(h ^ (x + 0x9e3779b9), 16777619);
      h = Math.imul(h ^ (y + 0x85ebca6b), 16777619);
      return ((h >>> 0) / 4294967295);
    };

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        let normalized;
        if (mode === "noise" || mode === "random") {
          normalized = hashNoise(col, row);
        } else {
          const dist = Math.max(Math.abs(col - centerCol), Math.abs(row - centerRow));
          normalized = this.clamp(dist / maxDist, 0, 1);
        }
        const height = Math.round(heightMin + normalized * (heightMax - heightMin));
        tiles.push({
          x: col,
          y: row,
          height,
          terrain
        });
      }
    }
    return tiles;
  }

  // 1 cell ぶんの立体情報を作る
  createCellSpec(col, row, height, terrain = null) {
    if (typeof terrain !== "string" || terrain.length === 0) {
      throw new Error(`tileMap cell (${col}, ${row}) requires terrain`);
    }
    const topY = this.baseTopY + height * this.heightStepY;
    const minx = col * this.cellSize + this.cellGap * 0.5;
    const maxx = (col + 1) * this.cellSize - this.cellGap * 0.5;
    const minz = row * this.cellSize + this.cellGap * 0.5;
    const maxz = (row + 1) * this.cellSize - this.cellGap * 0.5;
    return {
      col,
      row,
      height,
      terrain,
      edgeCutMask: 0,
      topY,
      box: {
        minx,
        maxx,
        miny: this.floorY,
        maxy: topY,
        minz,
        maxz
      },
      center: [
        (minx + maxx) * 0.5,
        this.floorY + (topY - this.floorY) * 0.5,
        (minz + maxz) * 0.5
      ]
    };
  }

  // cell 用の見た目 material を terrain 設定から解決する
  // - build 前後で同じ規則を使えるよう、TileMap 内からはまずこの helper を通して cap 用 material を得る
  createCellMaterial(cell) {
    return this.resolveTerrainMaterial(cell?.terrain, cell);
  }

  // cap の下へ置く foundation 用 material を作る
  // - terrain の texture / normal map は流用しつつ、色だけ少し落として土台と分かるようにする
  // - cap より少し暗くして、上面との役割差が見えるようにする
  createCellFoundationMaterial(cell) {
    const topMaterial = this.createCellMaterial(cell);
    const baseColor = this.tintColor(topMaterial.baseColor ?? [0.5, 0.5, 0.5, 1.0], 0.60);
    const topMaterialParams = topMaterial.materialParams ?? {};
    return {
      terrain: topMaterial.terrain,
      baseColor,
      displayColor: [...baseColor],
      materialId: topMaterial.materialId,
      materialParams: {
        ...topMaterialParams,
        color: [...baseColor],
        use_texture: Number.isFinite(topMaterialParams.use_texture) ? Number(topMaterialParams.use_texture) : 0,
        use_normal_map: Number.isFinite(topMaterialParams.use_normal_map) ? Number(topMaterialParams.use_normal_map) : 0
      }
    };
  }

  // terrain/material の設定を Shape へ反映する
  applyCellMaterial(shape, cellMaterial) {
    if (!shape || !cellMaterial) {
      return;
    }
    shape.setMaterial(cellMaterial.materialId, {
      ...(cellMaterial.materialParams ?? {})
    });
  }

  // 4 方向の隣接 cell を見て、edgeCutMask を cell に書き込む
  // row は tiles[y][x] の y に対応する data 順序として読み、上から下へ count up する
  // north は row - 1、south は row + 1 として読む
  assignEdgeCutMasks() {
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const east = this.getCell(cell.col + 1, cell.row);
      const west = this.getCell(cell.col - 1, cell.row);
      const north = this.getCell(cell.col, cell.row - 1);
      const south = this.getCell(cell.col, cell.row + 1);
      const resolved = resolveEdgeCutMask(
        cell.height,
        east?.height ?? cell.height,
        west?.height ?? cell.height,
        north?.height ?? cell.height,
        south?.height ?? cell.height
      );
      cell.edgeCutMask = resolved;
    }
  }

  // build 済み cell の node へ、cap + foundation の最終 shape を取り付ける
  // - grid と隣接関係が確定したあとで edgeCutMask を反映し、見た目を一度だけ組み立てる
  // - cap と foundation を同じ node へぶら下げ、表示切り替えは node 単位で済むようにする
  applySurfaceShapes() {
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const edgeCutMask = cell.edgeCutMask ?? 0;
      const capMaterial = this.createCellMaterial(cell);
      const shape = buildCellShape(this.gpu, this, cell, edgeCutMask);
      this.applyCellMaterial(shape, capMaterial);
      shape.setName(`cell-${cell.col}-${cell.row}-${this.surfaceShading}-mask${edgeCutMask}`);
      const foundationMaterial = this.createCellFoundationMaterial(cell);
      const foundationShape = buildCellFoundationShape(this.gpu, this, cell);
      if (foundationShape) {
        this.applyCellMaterial(foundationShape, foundationMaterial);
        foundationShape.setName(`cell-${cell.col}-${cell.row}-foundation`);
      }
      if (cell.node) {
        cell.node.setShape(shape);
        if (foundationShape) {
          cell.node.addShape(foundationShape);
        }
      }
      cell.shape = shape;
      cell.foundationShape = foundationShape;
      cell.coreEdgeCutMask = edgeCutMask;
    }
  }

  // tileMap を Space 上の実体として組み立てる
  // - scene 定義の検証、full grid の cell 作成、node 生成、bounds 計算を順に行う
  // - 先に全 cell を grid へ載せて隣接参照を可能にし、その後 edgeCutMask と最終 shape を確定する
  build() {
    if (!this.space || !this.gpu) {
      throw new Error("TileMap requires space and gpu");
    }
    this.normalizeDimensions(this.definition);
    this.displayArea = this.normalizeDisplayArea(this.definition.displayArea ?? null);
    this.root = this.space.addNode(null, this.definition.name ?? "tile-map");
    this.cells = [];
    this.visibleCells = [];
    this.grid = Array.from({ length: this.height }, () => Array(this.width).fill(null));

    const tiles = this.generateTileDefinitions(this.definition);
    const tileMap = new Map();
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const x = Math.floor(Number(tile?.x));
      const y = Math.floor(Number(tile?.y));
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new Error(`tileMap.tiles[${i}] requires integer x/y`);
      }
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
        throw new Error(`tileMap.tiles[${i}] is outside tileMap bounds`);
      }
      if (tileMap.has(`${x},${y}`)) {
        throw new Error(`tileMap.tiles has duplicated cell (${x}, ${y})`);
      }
      tileMap.set(`${x},${y}`, tile);
    }

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const tile = tileMap.get(`${col},${row}`);
        if (!tile) {
          throw new Error(`tileMap.tiles is missing cell (${col}, ${row})`);
        }
        const height = Math.floor(Number(tile.height));
        if (!Number.isInteger(height)) {
          throw new Error(`tileMap.tiles[${col},${row}].height must be an integer`);
        }
        const cell = this.createCellSpec(col, row, height, tile.terrain);
        const material = this.createCellMaterial(cell);

        const node = this.space.addNode(this.root, `cell-node-${col}-${row}`);
        node.setPosition(cell.center[0], cell.center[1], cell.center[2]);

        const record = {
          ...cell,
          node,
          shape: null,
          foundationShape: null,
          baseColor: material.baseColor,
          displayColor: material.displayColor
        };
        this.cells.push(record);
        this.grid[row][col] = record;
      }
    }

    this.bounds = {
      minCol: 0,
      maxCol: this.width - 1,
      minRow: 0,
      maxRow: this.height - 1,
      centerX: this.width * this.cellSize * 0.5,
      centerZ: this.height * this.cellSize * 0.5
    };

    this.assignEdgeCutMasks();
    this.applySurfaceShapes();
    this.refreshTileColors();
    return this;
  }

  // cell 座標から 2D grid を引く
  getCell(col, row) {
    if (!Array.isArray(this.grid) || row < 0 || row >= this.grid.length) {
      return null;
    }
    const line = this.grid[row];
    if (!Array.isArray(line) || col < 0 || col >= line.length) {
      return null;
    }
    return line[col] ?? null;
  }

  // cell 参照でも x/y でも読める alias を用意し、JSON 側の記法と合わせやすくする
  getTile(cellOrX, rowMaybe = undefined) {
    if (rowMaybe === undefined) {
      return this.resolveCellRef(cellOrX);
    }
    return this.getCell(cellOrX, rowMaybe);
  }

  // cell の top Y を返す
  getTopY(col, row) {
    const cell = this.getCell(col, row);
    return cell ? cell.topY : null;
  }

  // cell の world center を返す
  getWorldPosition(cell) {
    if (!cell) {
      return null;
    }
    return [...cell.center];
  }

  // tile データから高さだけを抜き出す
  getHeight(cell) {
    return cell ? cell.height : null;
  }

  // world 座標への変換名として使いやすい alias を用意する
  toWorld(cell) {
    return this.getWorldPosition(cell);
  }

  // 形状の cut mask を返す helper
  getEdgeCutMask(cell) {
    if (!cell) {
      return null;
    }
    return cell.edgeCutMask ?? 0;
  }

  // 既存の呼び出しを壊さないための alias
  getShapeKind(cell) {
    return this.getEdgeCutMask(cell);
  }

  // wall などの通行不可 tile を判定する helper
  isBlocked(cell) {
    if (!cell) {
      return true;
    }
    return cell.terrain === "wall";
  }

  // displayArea の内側かどうかを確認する
  isInDisplayArea(col, row, displayArea = this.displayArea) {
    if (!displayArea) {
      return true;
    }
    return col >= displayArea.minCol
      && col <= displayArea.maxCol
      && row >= displayArea.minRow
      && row <= displayArea.maxRow;
  }

  // 現在の displayArea を更新し、矩形として保持する
  setDisplayArea(displayArea) {
    this.displayArea = this.normalizeDisplayArea(displayArea);
    return this.displayArea;
  }

  // displayArea の周囲に少し余白を足した cell 群を集める
  // 画面端で tile が急に消えないよう、描画と pick は窓より少し広い範囲を候補にする
  getDisplayAreaCells(displayArea = this.displayArea) {
    if (!displayArea) {
      return [...this.cells];
    }
    const padding = this.displayAreaPadding;
    const minRow = displayArea.minRow - padding;
    const maxRow = displayArea.maxRow + padding;
    const minCol = displayArea.minCol - padding;
    const maxCol = displayArea.maxCol + padding;
    const cells = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = this.getCell(col, row);
        if (cell) {
          cells.push(cell);
        }
      }
    }
    return cells;
  }

  // 指定した cell を中心に、表示窓を定義域内へ scroll させる
  followCell(cell, options = {}) {
    if (!cell) {
      return this.displayArea;
    }
    const currentWidth = this.displayArea?.width ?? this.width;
    const currentHeight = this.displayArea?.height ?? this.height;
    const width = this.readOptionalInteger(options.width, "followCell.width", currentWidth, { min: 1 });
    const height = this.readOptionalInteger(options.height, "followCell.height", currentHeight, { min: 1 });
    const followCol = this.readOptionalInteger(options.followCol, "followCell.followCol", this.defaultDisplayFollowCol, { min: 0 });
    const followRow = this.readOptionalInteger(options.followRow, "followCell.followRow", this.defaultDisplayFollowRow, { min: 0 });
    const minCol = cell.col - followCol;
    const minRow = cell.row - followRow;
    // normalizeDisplayArea() の strict 仕様に合わせ、
    // followCell() も x/y/width/height の完成形で表示窓を渡す
    // ここで minCol/minRow と width/height を混在させると、
    // x/y 系の分岐へ入ったときに不足値 error になってしまう
    return this.setDisplayArea({
      x: minCol,
      y: minRow,
      width,
      height
    });
  }

  // node を cell 上へ置くときの目標 world 座標を返す
  // - ball や marker を「cell の中心 + topY + 半径 + 少しの lift」へ置きたいときの基準位置を作る
  getNodePositionOnCell(cell, lift = 0.04, radius = 0.82) {
    if (!cell) {
      return null;
    }
    return [
      cell.center[0],
      cell.topY + radius + lift,
      cell.center[2]
    ];
  }

  // node を cell 上面の既定位置へ実際に移動する
  // - getNodePositionOnCell() が返す位置計算と、Node.setPosition() の反映を 1 つの呼び出しにまとめる
  placeNodeOnCell(node, cell, lift = 0.04, radius = 0.82) {
    if (!node || !cell) {
      return;
    }
    const position = this.getNodePositionOnCell(cell, lift, radius);
    if (!position) {
      return;
    }
    node.setPosition(position[0], position[1], position[2]);
  }

  // current displayArea と selected cell に応じて material と表示状態を更新する
  refreshTileColors(selected = null) {
    const visibleCells = this.getDisplayAreaCells();
    const nextVisibleKeys = new Set(visibleCells.map((cell) => `${cell.col},${cell.row}`));

    // 初回更新では visibleCells がまだ空のため、
    // 以前の可視集合だけではなく全 cell を見て表示外を確実に隠す
    const hideTargets = this.visibleCells.length > 0 ? this.visibleCells : this.cells;
    for (let i = 0; i < hideTargets.length; i++) {
      const cell = hideTargets[i];
      if (!cell?.node) {
        continue;
      }
      const key = `${cell.col},${cell.row}`;
      if (nextVisibleKeys.has(key)) {
        continue;
      }
      cell.node.hide(true);
    }

    for (let i = 0; i < visibleCells.length; i++) {
      const cell = visibleCells[i];
      if (cell.node) {
        cell.node.hide(false);
      }
      const selectedColor = selected && selected.cell && selected.cell.col === cell.col && selected.cell.row === cell.row
        ? (selected.hitFace === "top"
          ? [1.0, 0.28, 0.34, 1.0]
          : [1.0, 0.70, 0.24, 1.0])
        : [...cell.baseColor];
      cell.shape.updateMaterial({
        color: selectedColor
      });
    }
    this.visibleCells = visibleCells;
  }

  // ray と AABB の交差を求める
  // - pickCell() の前段として、各 cell.box に ray が入るかを slab 法で判定する
  // - entryFace / exitFace も同時に返し、後段で top hit と wall hit を区別できるようにする
  intersectRayAabb(origin, dir, box) {
    const eps = 1.0e-8;
    let tMin = Number.NEGATIVE_INFINITY;
    let tMax = Number.POSITIVE_INFINITY;
    let entryFace = null;
    let exitFace = null;

    const axes = [
      {
        o: origin[0],
        d: dir[0],
        min: box.minx,
        max: box.maxx,
        nearFace: "wall-x-",
        farFace: "wall-x+"
      },
      {
        o: origin[1],
        d: dir[1],
        min: box.miny,
        max: box.maxy,
        nearFace: "bottom",
        farFace: "top"
      },
      {
        o: origin[2],
        d: dir[2],
        min: box.minz,
        max: box.maxz,
        nearFace: "wall-y-",
        farFace: "wall-y+"
      }
    ];

    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      if (Math.abs(axis.d) < eps) {
        if (axis.o < axis.min || axis.o > axis.max) {
          return null;
        }
        continue;
      }

      let tNearAxis;
      let tFarAxis;
      let axisEntryFace;
      let axisExitFace;
      if (axis.d > 0) {
        tNearAxis = (axis.min - axis.o) / axis.d;
        tFarAxis = (axis.max - axis.o) / axis.d;
        axisEntryFace = axis.nearFace;
        axisExitFace = axis.farFace;
      } else {
        tNearAxis = (axis.max - axis.o) / axis.d;
        tFarAxis = (axis.min - axis.o) / axis.d;
        axisEntryFace = axis.farFace;
        axisExitFace = axis.nearFace;
      }

      if (tNearAxis > tMin) {
        tMin = tNearAxis;
        entryFace = axisEntryFace;
      }
      if (tFarAxis < tMax) {
        tMax = tFarAxis;
        exitFace = axisExitFace;
      }
      if (tMin > tMax) {
        return null;
      }
    }

    if (tMax < 0) {
      return null;
    }

    return {
      tNear: tMin,
      tFar: tMax,
      entryFace,
      exitFace
    };
  }

  // レイと tile box の交差から、最も近い cell を 1 件選ぶ
  pickCell(origin, dir) {
    let nearest = null;
    const candidateCells = this.getDisplayAreaCells();
    for (let i = 0; i < candidateCells.length; i++) {
      const cell = candidateCells[i];
      const hit = this.intersectRayAabb(origin, dir, cell.box);
      if (!hit) {
        continue;
      }

      const t = hit.tNear >= 0 ? hit.tNear : hit.tFar;
      if (!Number.isFinite(t) || t < 0) {
        continue;
      }
      if (nearest !== null && t >= nearest.t) {
        continue;
      }

      const point = [
        origin[0] + dir[0] * t,
        origin[1] + dir[1] * t,
        origin[2] + dir[2] * t
      ];
      nearest = {
        cell,
        t,
        point,
        hitFace: hit.tNear >= 0 ? hit.entryFace : hit.exitFace,
        hitHeight: point[1]
      };
    }
    return nearest;
  }

  // x/y の隣接 tile 間で高さ差が 1 以内なら移動を許可する
  canMove(fromCell, toCell) {
    if (!fromCell || !toCell) {
      return false;
    }
    if (this.isBlocked(fromCell) || this.isBlocked(toCell)) {
      return false;
    }
    return Math.abs(toCell.height - fromCell.height) <= 1;
  }

  // start から goal への最短 path を BFS で求める
  // - displayArea の visible 範囲ではなく、TileMap 全体の cell と canMove() を使って探索する
  // - 戻り値は cell 配列で、goal へ届かない場合は null を返す
  findPath(start, goal) {
    const startCell = this.resolveCellRef(start);
    const goalCell = this.resolveCellRef(goal);
    if (!startCell || !goalCell) {
      return null;
    }

    const queue = [startCell];
    const visited = new Set([`${startCell.col},${startCell.row}`]);
    const parent = new Map();
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head];
      if (cell.col === goalCell.col && cell.row === goalCell.row) {
        const path = [cell];
        let key = `${cell.col},${cell.row}`;
        while (parent.has(key)) {
          const prev = parent.get(key);
          path.push(prev);
          key = `${prev.col},${prev.row}`;
        }
        return path.reverse();
      }

      for (let i = 0; i < dirs.length; i++) {
        const next = this.getCell(cell.col + dirs[i][0], cell.row + dirs[i][1]);
        if (!next) {
          continue;
        }
        if (!this.canMove(cell, next)) {
          continue;
        }
        const nextKey = `${next.col},${next.row}`;
        if (visited.has(nextKey)) {
          continue;
        }
        visited.add(nextKey);
        parent.set(nextKey, cell);
        queue.push(next);
      }
    }
    return null;
  }

  // path finder などで受けた参照を cell へ変換する
  resolveCellRef(ref) {
    if (!ref) {
      return null;
    }
    if (typeof ref.col === "number" && typeof ref.row === "number") {
      return this.getCell(ref.col, ref.row);
    }
    if (typeof ref.x === "number" && typeof ref.y === "number") {
      return this.getCell(ref.x, ref.y);
    }
    return null;
  }
}
