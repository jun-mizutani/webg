// ---------------------------------------------
// main.js  2026/10/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 回転式打錠機の3D表示と操作を接続する

import WebgApp from '../../webg/WebgApp.js';
import Shape from '../../webg/Shape.js';
import Primitive from '../../webg/Primitive.js';
import Quat from '../../webg/Quat.js';
import ComputeEffectPipeline from '../../webg/ComputeEffectPipeline.js';
import FullscreenPass from '../../webg/FullscreenPass.js';
import PbrEnvironmentCompute from '../../webg/PbrEnvironmentCompute.js';
import { createProceduralEnvironmentRadiance } from '../../webg/ProceduralEnvironment.js';
import { TAU, RADIUS, RADIAL_SCALE, SHAFT_LENGTH, HEAD_HALF, STAGES, COMPRESSION, ROLLER_RADIUS, punchProfile, CHUTE, sampleChute, sampleCycle, wrap } from './mechanism.js';

const COUNT = 12;
const DEG = 180 / Math.PI;
const DETAIL_SCALE = 40;
const DIE_TOP = .34;
const TABLE_THICKNESS = .13;
const COLORS = {
  steel: [0.72, 0.76, 0.79, 1], upper: [0.65, 0.75, 0.81, 1],
  lower: [0.81, 0.74, 0.63, 1], roller: [0.73, 0.70, 0.80, 1],
  cam: [0.30, 0.64, 0.58, 1], powder: [0.50, 0.80, 1.00, 1], feed: [0.91, 0.78, 0.48, 1],
  tablet: [0.32, 0.64, 0.88, 1], focus: [0.98, 0.36, 0.26, 1],
  dark: [0.20, 0.28, 0.34, 1]
};
const state = { angle: 0.18, rpm: 3, paused: false, selected: 0, cutaway: true, cams: true, autoOrbit: false, orbitYaw: 32 };
const units = [];
const rollers = [];
const camNodes = [];
let app, orbit, turntable, solidPlate, mainShaft, pipeline, present, environment;
const assets = new Map();

// DOMのIDから操作部品を取得し、画面更新で同じ参照先を使う
function element(id) {
  return document.getElementById(id);
}

// 部品の役割からPBR材質を選び、鋼の環境反射と粉末の拡散反射を描き分ける
function materialParameters(color) {
  const polished = [COLORS.steel, COLORS.upper, COLORS.lower, COLORS.roller].includes(color);
  const structuralMetal = color === COLORS.dark || color === COLORS.cam;
  return {
    color, metallic: polished ? 0.96 : structuralMetal ? 0.75 : 0,
    roughness: polished ? (color === COLORS.roller ? 0.22 : 0.18) : structuralMetal ? 0.36 : 0.78,
    // 粉末と錠剤へ弱い発光成分を加え、臼の陰でも淡い青の輪郭を読み取れる明るさにする
    specular: 0.5, ambient: 0, emissive: color === COLORS.focus ? 0.2
      : color === COLORS.powder ? 0.16 : color === COLORS.tablet ? 0.12 : 0
  };
}

// 形状と色を組にしてキャッシュし、同じ部品のGPU資源を共有する
function asset(kind, dimensions, color) {
  const key = JSON.stringify([kind, dimensions, color]);
  if (assets.has(key)) return assets.get(key);
  const shape = new Shape(app.getGPU());
  let geometry;
  if (kind === 'cylinder') geometry = Primitive.prism(dimensions[0] / 2, dimensions[1], 32, shape.getPrimitiveOptions());
  // 杵の断面を回転させ、先端・肩・胴体・首・杵頭がつながる一体形状を作る
  if (kind === 'punch') {
    const profile = punchProfile(dimensions[0]);
    const sign = dimensions[0] ? 1 : -1;
    const section = profile.map(([radius, y]) => [radius, y * sign]);
    if (sign < 0) section.reverse();
    geometry = Primitive.revolution(section.length - 1, 48, section.flat(), false, shape.getPrimitiveOptions());
  }
  // ホッパーの内壁から外壁へつながる断面を回転させ、上面が開いた容器を作る
  if (kind === 'hopper') {
    const section = [.68, .45, .60, .45, .60, -.08, .24, -.45, .32, -.45, .68, -.08, .68, .45];
    geometry = Primitive.revolution(section.length / 2 - 1, 48, section, false, shape.getPrimitiveOptions());
  }
  if (kind === 'box') geometry = Primitive.cuboid(...dimensions, shape.getPrimitiveOptions());
  if (kind === 'sphere') geometry = Primitive.sphere(dimensions[0], 8, 12, shape.getPrimitiveOptions());
  if (kind === 'ring') geometry = Primitive.donut(dimensions[0], dimensions[1], 8, 64, shape.getPrimitiveOptions());
  shape.applyPrimitiveAsset(geometry);
  shape.endShape();
  shape.setMaterial('machine-pbr', materialParameters(color));
  assets.set(key, shape);
  return shape;
}

// キャッシュしたShapeのインスタンスをNodeへ付け、位置と姿勢を設定する
function part(name, kind, dimensions, color, position, parent = null, attitude = [0, 0, 0]) {
  const node = app.space.addNode(parent, name);
  node.addShape(asset(kind, dimensions, color).createInstance());
  node.setPosition(...position);
  node.setAttitude(...attitude);
  return node;
}

// 内径と外径を持つ臼の壁を作り、外側半分の開口から杵と粉末を観察できる形にする
function dieShape(cutaway) {
  const shape = new Shape(app.getGPU());
  const start = cutaway ? Math.PI / 2 : 0;
  const length = cutaway ? Math.PI : TAU;
  const segments = cutaway ? 20 : 40;

  // 各面へ独立した頂点を用意し、平面の切り口と円筒の壁を描き分ける
  function face(points) {
    const ids = points.map(p => shape.addVertex(...p) - 1);
    shape.addTriangle(ids[0], ids[1], ids[2]);
    shape.addTriangle(ids[0], ids[2], ids[3]);
  }

  // 一区間ごとに外壁、内壁、上面、下面を閉じる
  for (let i = 0; i < segments; i++) {
    const a = start + length * i / segments;
    const b = start + length * (i + 1) / segments;
    const p = (r, y, angle) => [r * Math.cos(angle), y, r * Math.sin(angle)];
    face([p(.46, -1.02, a), p(.46, DIE_TOP, a), p(.46, DIE_TOP, b), p(.46, -1.02, b)]);
    face([p(.27, -1.02, b), p(.27, DIE_TOP, b), p(.27, DIE_TOP, a), p(.27, -1.02, a)]);
    face([p(.27, DIE_TOP, a), p(.27, DIE_TOP, b), p(.46, DIE_TOP, b), p(.46, DIE_TOP, a)]);
    face([p(.27, -1.02, b), p(.27, -1.02, a), p(.46, -1.02, a), p(.46, -1.02, b)]);
  }
  if (cutaway) {
    for (const [angle, reverse] of [[start, false], [start + length, true]]) {
      const points = [[.27, -1.02], [.27, DIE_TOP], [.46, DIE_TOP], [.46, -1.02]].map(([r, y]) => [r * Math.cos(angle), y, r * Math.sin(angle)]);
      face(reverse ? points.reverse() : points);
    }
  }
  shape.endShape();
  shape.setMaterial('machine-die-pbr', { ...materialParameters(COLORS.steel), roughness: 0.24 });
  return shape;
}

// 臼の外径に合わせた12個の開口を持つ回転盤を作り、上面を臼上端へ揃える
function tableShape() {
  const shape = new Shape(app.getGPU());
  const outerRadius = 4.95 * RADIAL_SCALE;
  const innerRadius = RADIUS - .70;
  const holeRadius = .461;
  const halfAngle = Math.PI / COUNT;
  const tangent = Math.tan(halfAngle);
  const bottom = DIE_TOP - TABLE_THICKNESS;
  const innerBoundary = [];

  // 四角形の頂点を独立させ、テーブル上面、下面、孔の壁の法線を分離する
  function face(points) {
    const ids = points.map(point => shape.addVertex(...point) - 1);
    shape.addTriangle(ids[0], ids[1], ids[2]);
    shape.addTriangle(ids[0], ids[2], ids[3]);
  }

  // 臼中心から伸ばした放射線と、テーブル一分割の内外円周・境界線との交点を求める
  function edgeDistance(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const distances = [-RADIUS * c + Math.sqrt(outerRadius ** 2 - RADIUS ** 2 * s ** 2)];
    const innerDiscriminant = innerRadius ** 2 - RADIUS ** 2 * s ** 2;
    if (c < 0 && innerDiscriminant >= 0) distances.push(-RADIUS * c - Math.sqrt(innerDiscriminant));
    for (const t of [tangent * RADIUS / (s - tangent * c), -tangent * RADIUS / (s + tangent * c)]) {
      if (t > 0 && Number.isFinite(t)) distances.push(t);
    }
    return Math.min(...distances.filter(value => value > 0));
  }

  // 円形開口から分割領域の外周までを四角形で埋め、臼の孔を通る面を確保する
  for (let station = 0; station < COUNT; station++) {
    const angle = station / COUNT * TAU;
    const rays = Array.from({ length: 64 }, (_, i) => i / 64 * TAU);
    // 内周・外周と放射境界の角を頂点に加え、分割領域同士の境界を接続する
    for (const radius of [innerRadius, outerRadius]) {
      for (const sign of [-1, 1]) rays.push(wrap(Math.atan2(sign * radius * Math.sin(halfAngle), radius * Math.cos(halfAngle) - RADIUS)));
    }
    rays.sort((a, b) => a - b);

    // 分割領域の局所平面を、各臼の世界位置へ回転して配置する
    function point(ray, distance, y) {
      const x = RADIUS + distance * Math.cos(ray), z = distance * Math.sin(ray);
      return [x * Math.cos(angle) - z * Math.sin(angle), y, x * Math.sin(angle) + z * Math.cos(angle)];
    }

    for (let i = 0; i < rays.length; i++) {
      const a = rays[i], b = rays[(i + 1) % rays.length];
      const da = edgeDistance(a), db = edgeDistance(b);
      const ha = point(a, holeRadius, DIE_TOP), hb = point(b, holeRadius, DIE_TOP);
      const ea = point(a, da, DIE_TOP), eb = point(b, db, DIE_TOP);
      face([hb, eb, ea, ha]);
      face([point(a, holeRadius, bottom), point(a, da, bottom), point(b, db, bottom), point(b, holeRadius, bottom)]);
      face([point(b, holeRadius, bottom), hb, ha, point(a, holeRadius, bottom)]);
      if (Math.abs(Math.hypot(ea[0], ea[2]) - outerRadius) < 1e-7 && Math.abs(Math.hypot(eb[0], eb[2]) - outerRadius) < 1e-7) {
        face([point(a, da, bottom), ea, eb, point(b, db, bottom)]);
      }
      if (Math.abs(Math.hypot(ea[0], ea[2]) - innerRadius) < 1e-7) innerBoundary.push(ea);
    }
  }

  // 開口より内側の領域を円周の頂点で閉じ、中央まで一続きのテーブル面にする
  innerBoundary.sort((a, b) => wrap(Math.atan2(a[2], a[0])) - wrap(Math.atan2(b[2], b[0])));
  // 分割境界で共有される頂点をまとめ、中央面の三角形に十分な面積を持たせる
  const boundary = innerBoundary.filter((point, i) => i === 0 || Math.hypot(point[0] - innerBoundary[i - 1][0], point[2] - innerBoundary[i - 1][2]) > 1e-8);
  if (boundary.length > 1 && Math.hypot(boundary[0][0] - boundary.at(-1)[0], boundary[0][2] - boundary.at(-1)[2]) < 1e-8) boundary.pop();
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    for (const [y, reverse] of [[DIE_TOP, false], [bottom, true]]) {
      const points = [[0, y, 0], [b[0], y, b[2]], [a[0], y, a[2]]];
      if (reverse) points.reverse();
      const ids = points.map(point => shape.addVertex(...point) - 1);
      shape.addTriangle(...ids);
    }
  }
  shape.endShape();
  shape.setMaterial('machine-table-pbr', materialParameters(COLORS.dark));
  return shape;
}

// 強度を担う太い胴体に、臼へ入る先端と杵頭を接続した杵を一体形状で作る
function punch(name, upper, parent) {
  const color = upper ? COLORS.upper : COLORS.lower;
  return part(name, 'punch', [upper], color, [0, 0, 0], parent);
}

// 3Dと同じ断面を左右へ展開し、拡大図にも胴体・先端・首の太さを反映する
function buildPunchDetails() {
  for (const upper of [true, false]) {
    const sign = upper ? -1 : 1;
    const profile = punchProfile(upper);
    const right = profile.map(([radius, y]) => [160 + radius * 100, sign * y * DETAIL_SCALE]);
    const left = profile.slice().reverse().map(([radius, y]) => [160 - radius * 100, sign * y * DETAIL_SCALE]);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', [...right, ...left].map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z');
    path.setAttribute('fill', upper ? '#b1c8d5' : '#d1c4af');
    path.setAttribute('stroke', '#e3e8ec');
    element(upper ? 'detail-upper' : 'detail-lower').replaceChildren(path);
  }
}

// 軌道上の二点を細い角柱で結び、カムの位置と高さの変化を可視化する
function railSegment(name, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const horizontal = Math.hypot(dx, dz);
  const length = Math.hypot(horizontal, dy);
  return part(name, 'box', [length + .018, .065, .10], COLORS.cam,
    a.map((v, i) => (v + b[i]) / 2), null,
    [-Math.atan2(dz, dx) * DEG, 0, Math.atan2(dy, horizontal) * DEG]);
}

// 杵頭の上下に沿う固定軌道を作り、圧縮区間ではローラーへ案内を引き継ぐ
function buildCams() {
  for (const upper of [true, false]) {
    let last = null;
    for (let i = 0; i <= 180; i++) {
      const angle = i / 180 * TAU;
      const cycle = sampleCycle(angle);
      const inPress = COMPRESSION.some(p => Math.abs(wrap(angle) - p.angle) < .24);
      const y = upper ? cycle.upper + SHAFT_LENGTH + HEAD_HALF * 2 : cycle.lower - SHAFT_LENGTH - HEAD_HALF * 2;
      const radius = RADIUS + .25;
      const point = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
      if (last && !inPress) camNodes.push(railSegment(`cam-${upper}-${i}`, last, point));
      last = inPress ? null : point;
    }
  }
}

// 固定された上下ローラーと支持軸を圧縮位置に配置する
function buildRollers() {
  for (const press of COMPRESSION) {
    for (const upper of [true, false]) {
      const sign = upper ? 1 : -1;
      const tip = upper ? press.upper : press.lower;
      const y = tip + sign * (SHAFT_LENGTH + HEAD_HALF * 2 + press.radius);
      const x = RADIUS * Math.cos(press.angle), z = RADIUS * Math.sin(press.angle);
      const pivot = app.space.addNode(null, `${press.label}-${upper}`);
      pivot.setPosition(x, y, z);
      // 円周上の位置に合わせて水平回転し、その局所座標で円筒のY軸を横へ倒す
      // 回転軸を半径方向へ揃え、円周の接線方向へローラーが転がる姿勢を作る
      pivot.setAttitude(-press.angle * DEG, 0, 0);
      pivot.rotateZ(90);
      const wheel = part('roller-wheel', 'cylinder', [.70, press.radius], COLORS.roller, [0, 0, 0], pivot);
      part('roller-axle', 'cylinder', [1.6, .10], COLORS.steel, [0, 0, 0], pivot);
      for (let i = 0; i < 4; i++) {
        part('roller-spoke', 'box', [press.radius * 1.65, .025, .04], COLORS.dark, [0, -.36, 0], wheel, [i * 45, 0, 0]);
      }
      const supportR = RADIUS + 1.05;
      part('roller-support', 'box', [.24, .65, .35], COLORS.dark, [supportR * Math.cos(press.angle), y, supportR * Math.sin(press.angle)]);
      rollers.push({ wheel, radius: press.radius, sign });
    }
  }
}

// 回転盤、12組の臼と杵、固定供給器、排出板、カム、圧縮ローラーを配置する
function buildMachine() {
  part('base', 'cylinder', [.35, 2.2 * RADIAL_SCALE], COLORS.dark, [0, -4.65, 0]);
  mainShaft = part('main-shaft', 'cylinder', [8.7, .43], COLORS.steel, [0, -.3, 0]);
  turntable = app.space.addNode(null, 'rotating-turret');
  part('turret-hub', 'cylinder', [.7, 1.2 * RADIAL_SCALE], COLORS.dark, [0, -.45, 0], turntable);
  part('die-support-ring', 'ring', [3.92 * RADIAL_SCALE, .08], COLORS.steel, [0, -.23, 0], turntable);
  solidPlate = app.space.addNode(turntable, 'full-turntable');
  solidPlate.addShape(tableShape());
  const closedDie = dieShape(false), openDie = dieShape(true);

  for (let i = 0; i < COUNT; i++) {
    const angle = i / COUNT * TAU;
    const anchor = app.space.addNode(turntable, `station-${i + 1}`);
    anchor.setPosition(RADIUS * Math.cos(angle), 0, RADIUS * Math.sin(angle));
    anchor.setAttitude(-angle * DEG, 0, 0);
    const die = app.space.addNode(anchor, 'die');
    const closed = closedDie.createInstance(), opened = openDie.createInstance();
    die.addShape(closed); die.addShape(opened);
    const upper = punch('upper-punch', true, anchor);
    const lower = punch('lower-punch', false, anchor);
    const mark = part('selected-station', 'ring', [.52, .055], COLORS.focus, [0, -.49, 0], anchor);
    const tablet = part('tablet', 'cylinder', [.18, .242], COLORS.tablet, [0, 0, 0], anchor);
    const grains = [];
    for (let g = 0; g < 15; g++) {
      grains.push(part('powder-grain', 'sphere', [.065], COLORS.powder, [0, 0, 0], anchor));
    }
    // 拡大した臼の位置から中央ハブまでスポークを伸ばし、両端を接続する
    const hubRadius = 1.2 * RADIAL_SCALE;
    const spokeLength = RADIUS - hubRadius - .10;
    const spokeCenter = -(RADIUS - hubRadius + .50) / 2;
    part('radial-spoke', 'box', [spokeLength, .08, .14], COLORS.dark, [spokeCenter, -.55, 0], anchor);
    units.push({ anchor, upper, lower, closed, opened, mark, tablet, grains, angle });
  }

  // 充填部は供給器の窓を開け、臼へ落ちる粉末の経路を示す
  const feedAngle = .35;
  const feed = app.space.addNode(null, 'fixed-feed-frame');
  feed.setPosition(RADIUS * Math.cos(feedAngle), .70, RADIUS * Math.sin(feedAngle));
  feed.setAttitude(-feedAngle * DEG, 0, 0);
  part('feed-wall', 'box', [1.4, .55, .09], COLORS.feed, [0, 0, -.55], feed);
  part('feed-side', 'box', [.09, .55, 1.1], COLORS.feed, [-.70, 0, 0], feed);
  part('feed-side', 'box', [.09, .55, 1.1], COLORS.feed, [.70, 0, 0], feed);
  part('feed-throat', 'cylinder', [.50, .3], COLORS.feed, [.95, .4, 0], feed);
  part('hopper', 'hopper', [], COLORS.feed, [.95, 1.05, 0], feed);
  // 開いたホッパーへ粉末層と粒を置き、上から淡い青の充填状態が見えるようにする
  part('hopper-powder-bed', 'cylinder', [.30, .55], COLORS.powder, [.95, 1.15, 0], feed);
  for (let i = 0; i < 45; i++) {
    const angle = i * 2.399963;
    const radius = .51 * Math.sqrt((i + .5) / 45);
    const height = 1.31 + .07 * (1 - radius / .51);
    part('hopper-powder-grain', 'sphere', [.047], COLORS.powder,
      [.95 + radius * Math.cos(angle), height, radius * Math.sin(angle)], feed);
  }
  part('metering-blade', 'box', [.85, .08, .13], COLORS.steel, [RADIUS * Math.cos(.94), .38, RADIUS * Math.sin(.94)], null, [-.94 * DEG, 0, 0]);

  // 排出板と傾いた樋で、臼から外側へ錠剤が移る経路を作る
  const ejectAngle = CHUTE.angle;
  const chute = app.space.addNode(null, 'ejection-chute');
  // 樋の上面が入口で下杵先端の高さに接続するよう、板厚を含めて中心高さを決める
  const centerHeight = CHUTE.entryHeight - CHUTE.centerOffset * Math.tan(CHUTE.slope)
    - CHUTE.thickness / (2 * Math.cos(CHUTE.slope));
  const centerRadius = RADIUS + CHUTE.centerOffset;
  chute.setPosition(centerRadius * Math.cos(ejectAngle), centerHeight, centerRadius * Math.sin(ejectAngle));
  // 半径方向へ水平回転した局所座標で、樋の長手方向を下り勾配へ傾ける
  chute.setAttitude(-ejectAngle * DEG, 0, 0);
  chute.rotateZ(-CHUTE.slope * DEG);
  part('chute-floor', 'box', [CHUTE.length, CHUTE.thickness, .85], COLORS.steel, [0, 0, 0], chute);
  part('chute-side', 'box', [CHUTE.length, .19, .055], COLORS.steel, [0, .1, -.44], chute);
  part('chute-side', 'box', [CHUTE.length, .19, .055], COLORS.steel, [0, .1, .44], chute);
  part('take-off-blade', 'box', [1.1, .12, .08], COLORS.lower,
    [RADIUS * Math.cos(4.55), .45, RADIUS * Math.sin(4.55)], null, [-4.3 * DEG, 0, 0]);

  // 各工程の色を床面の円弧へ置き、回転方向と固定された工程位置を示す
  for (const stage of STAGES) {
    const color = [...stage.color.match(/[0-9a-f]{2}/gi).map(v => parseInt(v, 16) / 255), 1];
    for (let a = stage.start + .035; a < stage.end; a += .09) {
      part('stage-marker', 'box', [.08, .025, .37], color,
        [5.18 * RADIAL_SCALE * Math.cos(a), -4.35, 5.18 * RADIAL_SCALE * Math.sin(a)], null, [-a * DEG, 0, 0]);
    }
  }
  buildCams();
  buildRollers();
}

// 世界Y軸のyawと固定した俯角を順に合成し、画面上でも機械の鉛直軸を保つ
// 周回中はyawだけを変え、観察する方位が変わっても機械の左右への傾きを一定にする
function setObserverPose(yaw, pitch) {
  const attitude = new Quat();
  attitude.setRotateY(yaw);
  const tilt = new Quat();
  tilt.setRotateX(pitch);
  attitude.mulQuat(tilt);
  const view = orbit.getModeState();
  view.attitudeQuat = attitude;
  orbit.syncOrbitEulerFromQuats();
  orbit.setLookAngles(0, 0, 0);
  orbit.apply();
}

// 観察方向のボタンを押したときに周回を止め、水平を保った所定の視点へ移る
function chooseView(yaw, pitch, distance, targetY = -.2) {
  state.autoOrbit = false;
  element('auto-orbit').checked = false;
  orbit.setTarget(0, targetY, 0);
  orbit.setDistance(distance);
  setObserverPose(yaw, pitch);
}

// 各組の回転角から杵の位置、粉末の縮み、成形後の錠剤の移動を毎フレーム更新する
function updateMachine(deltaSec) {
  // 上から見て反時計回りに視点を進め、20秒で360度の観察位置を通る
  // 機械の一時停止中にも視点の周回を続け、停止した部品を全方向から観察できるようにする
  if (state.autoOrbit) {
    state.orbitYaw = ((state.orbitYaw + 360 / 20 * deltaSec) % 360 + 360) % 360;
    setObserverPose(state.orbitYaw, -24);
  }
  if (!state.paused) state.angle = wrap(state.angle + Math.min(deltaSec, .10) * state.rpm / 60 * TAU);
  turntable.setAttitude(-state.angle * DEG, 0, 0);
  solidPlate.hide(state.cutaway);
  // 断面表示では中央軸を隠し、奥側の杵と粉末を見通せる状態にする
  mainShaft.hide(state.cutaway);
  for (const node of camNodes) node.hide(!state.cams);
  for (const [i, unit] of units.entries()) {
    const cycle = sampleCycle(state.angle + unit.angle);
    unit.upper.setPosition(0, cycle.upper, 0);
    unit.lower.setPosition(0, cycle.lower, 0);
    unit.closed.hide(state.cutaway);
    unit.opened.hide(!state.cutaway);
    unit.mark.hide(i !== state.selected);
    for (const [g, grain] of unit.grains.entries()) {
      grain.hide(cycle.formed || !cycle.occupied);
      const ring = g % 5;
      const a = ring / 5 * TAU + Math.floor(g / 5) * .8;
      const y = cycle.lower + .065 + Math.floor(g / 5) / 2 * Math.max(.02, cycle.height - .13);
      grain.setPosition(.15 * Math.cos(a), y, .15 * Math.sin(a));
    }
    unit.tablet.hide(!cycle.formed || cycle.angle >= CHUTE.endAngle);
    if (cycle.angle < CHUTE.angle) {
      unit.tablet.setAttitude(0, 0, 0);
      unit.tablet.setPosition(0, cycle.lower + CHUTE.tabletThickness / 2, 0);
    } else {
      // 錠剤を固定排出位置へ戻してから樋の外側へ進める
      // 親の公転を打ち消す局所座標で、排出後の世界座標を樋へ揃える
      const distance = (cycle.angle - CHUTE.angle) / (CHUTE.endAngle - CHUTE.angle) * CHUTE.travel;
      const pose = sampleChute(distance);
      const offset = CHUTE.angle - cycle.angle;
      unit.tablet.setPosition(pose.radius * Math.cos(offset) - RADIUS, pose.height, pose.radius * Math.sin(offset));
      // 錠剤の底面も樋と同じ傾斜へ揃え、板の上面に沿って滑らせる
      unit.tablet.setAttitude(-offset * DEG, 0, 0);
      unit.tablet.rotateZ(-CHUTE.slope * DEG);
    }
  }
  for (const roll of rollers) roll.wheel.setAttitude(roll.sign * state.angle * RADIUS / roll.radius * DEG, 0, 0);
  updateInspector();
}

// 選択した一組の工程、先端高さ、粉末層と圧縮ローラーを断面図へ反映する
function updateInspector() {
  const cycle = sampleCycle(state.angle + units[state.selected].angle);
  const mapY = y => 200 - y * DETAIL_SCALE;
  element('station-number').textContent = String(state.selected + 1).padStart(2, '0');
  element('phase').textContent = cycle.stage.name;
  element('phase-dot').style.background = cycle.stage.color;
  element('description').textContent = cycle.stage.description;
  element('angle-label').textContent = `${Math.round(cycle.angle * DEG)}°`;
  element('upper-value').textContent = cycle.upper.toFixed(2);
  element('lower-value').textContent = cycle.lower.toFixed(2);
  element('rotation').value = state.angle * DEG;
  element('detail-upper').setAttribute('transform', `translate(0 ${mapY(cycle.upper)})`);
  element('detail-lower').setAttribute('transform', `translate(0 ${mapY(cycle.lower)})`);
  const charge = element('detail-charge');
  charge.setAttribute('y', mapY(cycle.top));
  charge.setAttribute('height', Math.max(0, cycle.height * DETAIL_SCALE));
  charge.setAttribute('fill', cycle.formed ? '#8dc9ee' : 'url(#powder)');
  charge.style.display = cycle.occupied ? '' : 'none';
  const pressing = COMPRESSION.find(p => Math.abs(cycle.angle - p.angle) < .20);
  element('detail-rolls').style.display = pressing ? '' : 'none';
  const detailRadius = (pressing?.radius ?? ROLLER_RADIUS) * 30;
  element('detail-top-roll').setAttribute('r', detailRadius);
  element('detail-bottom-roll').setAttribute('r', detailRadius);
  element('detail-top-roll').setAttribute('cy', mapY(cycle.upper) - (SHAFT_LENGTH + HEAD_HALF * 2) * DETAIL_SCALE - detailRadius);
  element('detail-bottom-roll').setAttribute('cy', mapY(cycle.lower) + (SHAFT_LENGTH + HEAD_HALF * 2) * DETAIL_SCALE + detailRadius);
  for (const [i, button] of [...element('stages').children].entries()) button.classList.toggle('active', STAGES[i] === cycle.stage);
}

// 工程位置を指定して停止し、注目する組が選択工程に来るよう回転盤を合わせる
function seekStage(index) {
  const angles = [.35, .98, 1.65, 2.65, 4.45, 5.8];
  state.angle = wrap(angles[index] - units[state.selected].angle);
  state.paused = true;
  element('pause').textContent = 'Resume';
}

// 操作部品を接続し、工程選択、速度、断面表示、カメラを変更できるようにする
function bindControls() {
  for (let i = 0; i < COUNT; i++) {
    const option = document.createElement('option');
    option.value = i; option.textContent = String(i + 1).padStart(2, '0');
    element('station').append(option);
  }
  element('station').addEventListener('change', event => { state.selected = Number(event.target.value); });
  element('pause').addEventListener('click', () => {
    state.paused = !state.paused;
    element('pause').textContent = state.paused ? 'Resume' : 'Pause';
  });
  element('speed').addEventListener('input', event => {
    state.rpm = Number(event.target.value);
    element('speed-value').textContent = `${state.rpm} rpm`;
  });
  element('rotation').addEventListener('input', event => {
    state.angle = Number(event.target.value) / DEG;
    state.paused = true; element('pause').textContent = 'Resume';
  });
  element('cutaway').addEventListener('change', event => { state.cutaway = event.target.checked; });
  element('cams').addEventListener('change', event => { state.cams = event.target.checked; });
  for (const [i, stage] of STAGES.entries()) {
    const button = document.createElement('button');
    button.style.setProperty('--stage', stage.color);
    button.innerHTML = `${String(i + 1).padStart(2, '0')} ${stage.name}<small>Inspect this stage</small>`;
    button.addEventListener('click', () => seekStage(i));
    element('stages').append(button);
  }
  element('step').addEventListener('click', () => {
    const cycle = sampleCycle(state.angle + units[state.selected].angle);
    seekStage((STAGES.indexOf(cycle.stage) + 1) % STAGES.length);
  });
  element('auto-orbit').addEventListener('change', event => {
    state.autoOrbit = event.target.checked;
    if (state.autoOrbit) {
      // 一周を通じて上下ローラーと樋を収める観察距離へ整える
      orbit.setTarget(0, -.2, 0);
      const eyePosition = orbit.getEyeNode().getWorldMatrix().getPosition();
      state.orbitYaw = Math.atan2(eyePosition[0], eyePosition[2]) * DEG;
      orbit.setDistance(22.5);
    }
  });
  element('overview').addEventListener('click', () => chooseView(32, -24, 21.5));
  element('side').addEventListener('click', () => chooseView(0, -5, 20.5));
  element('top').addEventListener('click', () => chooseView(0, -82, 20.5, 0));
}

// スタジオの明るい面を環境マップへ焼き込み、金属に映る光の帯を用意する
async function prepareMetalLighting() {
  const gpu = app.getGPU();
  environment = new PbrEnvironmentCompute(gpu, {
    label: 'tablet-machine:studio', irradianceWidth: 32, irradianceHeight: 16,
    specularWidth: 128, specularHeight: 64, specularMipCount: 7,
    brdfLutWidth: 64, brdfLutHeight: 64,
    diffuseSampleCount: 128, specularSampleCount: 128, brdfSampleCount: 128
  });
  const encoder = gpu.device.createCommandEncoder();
  environment.encode(encoder, createProceduralEnvironmentRadiance({
    preset: 'dark-studio', resolution: { width: 128, height: 64 }
  }));
  gpu.queue.submit([encoder.finish()]);
  await gpu.queue.onSubmittedWorkDone();
  pipeline = new ComputeEffectPipeline(gpu, {
    label: 'tablet-machine:pbr', width: app.screen.width, height: app.screen.height,
    lightDirection: [-0.4, -1, -0.6],
    lighting: {
      directionalColor: [1, 0.98, 0.95], directionalIntensity: 3,
      ambient: 0, environment: environment.getResources(), environmentIntensity: 1.4
    },
    toneMap: { mode: 'reinhard', exposure: 1.15, gamma: 2.2 }
  });
  present = new FullscreenPass(gpu);
  await Promise.all([pipeline.ready, present.init()]);
}

// 機構の現在位置をPBRで描き、環境反射と色調変換を適用してCanvasへ出力する
function renderMetalFrame(cameraFrame, deltaSec) {
  const gpu = app.getGPU();
  pipeline.resize(app.screen.width, app.screen.height);
  app.space.update(deltaSec * 1000);
  gpu.commandEncoder = gpu.device.createCommandEncoder();
  pipeline.renderScene(app.space, cameraFrame, app.clearColor, { shadowEnabled: false });
  gpu.endPass();
  const output = pipeline.encode(gpu.commandEncoder, {
    cameraFrame, deltaSec, shadowEnabled: false, ssaoEnabled: false, ssrEnabled: false,
    fogEnabled: false, dofEnabled: false, toonEnabled: false,
    bloomEnabled: false, edgeEnabled: false, vignetteEnabled: false
  });
  app.screen.beginPresentPass({ clearColor: app.clearColor });
  present.draw(output);
  gpu.endPass();
  gpu.submit();
  pipeline.afterGpuSubmit();
}

// webgの描画とカメラを初期化し、機構の時間更新をアニメーションループへ接続する
async function start() {
  const sceneElement = document.querySelector('.scene');
  const initialSize = sceneElement.getBoundingClientRect();
  element('canvas').width = Math.round(initialSize.width);
  element('canvas').height = Math.round(initialSize.height);
  app = new WebgApp({ document, useMessage: false, layoutMode: 'embedded', computeFrame: true,
    clearColor: [.055, .085, .12, 1], viewAngle: 43, projectionNear: .1, projectionFar: 100,
    camera: { target: [0, -.2, 0], distance: 21.5, yaw: 32, pitch: -24 },
    lightPosition: [30, 50, 40, 1], debugTools: { mode: 'release', system: 'tablet-machine' }
  });
  await app.init();
  app.getGPU().device.addEventListener('uncapturederror', event => showError(event.error));

  // 3D表示欄の寸法を描画面へ反映し、左右配置や縦配置への変更に追従する
  const resizeObserver = new ResizeObserver(() => {
    const size = sceneElement.getBoundingClientRect();
    app.screen.resize(Math.max(1, Math.round(size.width)), Math.max(1, Math.round(size.height)));
    app.applyViewportLayout();
  });
  resizeObserver.observe(sceneElement);
  orbit = app.createOrbitEyeRig({ target: [0, -.2, 0], distance: 21.5, yaw: 32, pitch: -24,
    minDistance: 8, maxDistance: 32, minPitch: -85, maxPitch: 20, wheelZoomStep: .6 });
  setObserverPose(32, -24);
  buildMachine();
  await prepareMetalLighting();
  bindControls();
  buildPunchDetails();
  updateMachine(0);
  app.start({
    onUpdate: ({ deltaSec }) => updateMachine(deltaSec),
    onComputeFrame: ({ cameraFrame, deltaSec }) => renderMetalFrame(cameraFrame, deltaSec)
  });
  document.body.dataset.status = 'ready';
}

// 初期化やGPU描画のエラーを画面へ表示し、原因の確認に使える状態を残す
function showError(error) {
  element('error').hidden = false;
  element('error').textContent = error.message;
  document.body.dataset.status = 'error';
  console.error(error);
}

start().catch(showError);
