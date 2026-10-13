// ---------------------------------------------
// main.js  2026/10/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 回転式カプセル充填機の3D表示、工程、観察操作を接続する

import WebgApp from '../../webg/WebgApp.js';
import Shape from '../../webg/Shape.js';
import Primitive from '../../webg/Primitive.js';
import Quat from '../../webg/Quat.js';
import ComputeEffectPipeline from '../../webg/ComputeEffectPipeline.js';
import FullscreenPass from '../../webg/FullscreenPass.js';
import PbrEnvironmentCompute from '../../webg/PbrEnvironmentCompute.js';
import { createProceduralEnvironmentRadiance } from '../../webg/ProceduralEnvironment.js';
import { TAU, RADIUS, COUNT, STAGES, DOSING, CHUTE, wrap, ramp, capsuleProfile, sampleCycle, sampleEjection } from './mechanism.js';

const DEG = 180 / Math.PI;
const COLORS = {
  steel: [.74, .78, .80, 1], dark: [.19, .27, .33, 1], cam: [.26, .65, .55, 1],
  cap: [.84, .21, .28, 1], body: [.94, .86, .65, 1], powder: [.50, .80, 1, 1],
  focus: [1, .69, .18, 1], tube: [.28, .69, .78, 1]
};
const state = { angle: .18, rpm: 3, paused: false, selected: 0, cutaway: true, cams: true, autoOrbit: false, orbitYaw: 32, time: 0 };
const assets = new Map(), units = [], camNodes = [], streams = [];
let app, orbit, pipeline, present, environment, turret, table, shaft, pump;

// 操作部品と状態表示をIDで取得する
function element(id) { return document.getElementById(id); }

// 金属機構、カプセル表面、粉末の反射特性を役割に合わせて選ぶ
function material(color) {
  const metal = [COLORS.steel, COLORS.dark, COLORS.cam].includes(color);
  const shell = color === COLORS.cap || color === COLORS.body;
  return { color, metallic: metal ? .94 : 0, roughness: metal ? .23 : shell ? .28 : .75,
    specular: .5, ambient: 0, emissive: color === COLORS.powder ? .14 : color === COLORS.focus ? .16 : 0 };
}

// 同じ形状と材質をキャッシュし、繰り返し部品のGPU資源を共有する
function asset(kind, dimensions, color) {
  const key = JSON.stringify([kind, dimensions, color]);
  if (assets.has(key)) return assets.get(key);
  const shape = new Shape(app.getGPU());
  const options = shape.getPrimitiveOptions();
  let geometry;
  if (kind === 'cylinder') geometry = Primitive.prism(dimensions[0] / 2, dimensions[1], 32, options);
  if (kind === 'box') geometry = Primitive.cuboid(...dimensions, options);
  if (kind === 'ring') geometry = Primitive.donut(dimensions[0], dimensions[1], 8, 64, options);
  if (kind === 'sphere') geometry = Primitive.sphere(dimensions[0], 8, 12, options);
  if (kind === 'hopper') {
    const section = [.75, .55, .68, .55, .68, -.05, .23, -.65, .30, -.65, .75, -.05, .75, .55];
    geometry = Primitive.revolution(section.length / 2 - 1, 48, section, false, options);
  }
  shape.applyPrimitiveAsset(geometry);
  shape.endShape();
  shape.setMaterial('capsule-filler-pbr', material(color));
  assets.set(key, shape);
  return shape;
}

// 形状インスタンスをNodeへ付け、親からの位置と姿勢を設定する
function part(name, kind, dimensions, color, position, parent = null, attitude = [0, 0, 0]) {
  const node = app.space.addNode(parent, name);
  node.addShape(asset(kind, dimensions, color).createInstance());
  node.setPosition(...position);
  node.setAttitude(...attitude);
  return node;
}

// 薄い壁のキャップ・ボディ、または孔の開いた保持部品を回転面で作る
function sectionShape(profile, cutaway, color) {
  const shape = new Shape(app.getGPU());
  const segments = cutaway ? 24 : 48;
  const start = cutaway ? Math.PI / 2 : 0;
  const span = cutaway ? Math.PI : TAU;

  // 面ごとの頂点を使い、内壁・外壁・切り口の法線を区別する
  function face(points) {
    const ids = points.map(point => shape.addVertex(...point) - 1);
    shape.addTriangle(ids[0], ids[1], ids[2]);
    shape.addTriangle(ids[0], ids[2], ids[3]);
  }

  // 断面線を円周に沿ってつなぎ、閉端までを一続きの外形にする
  for (let i = 0; i < segments; i++) {
    const a = start + span * i / segments, b = start + span * (i + 1) / segments;
    for (let j = 0; j < profile.length - 1; j++) {
      const [r, y] = profile[j], [s, z] = profile[j + 1];
      face([[r * Math.cos(a), y, r * Math.sin(a)], [s * Math.cos(a), z, s * Math.sin(a)],
        [s * Math.cos(b), z, s * Math.sin(b)], [r * Math.cos(b), y, r * Math.sin(b)]]);
    }
  }
  if (cutaway) {
    // 半割りの切り口を断面の輪郭で閉じ、壁の厚みを見せる
    for (const [angle, reverse] of [[start, true], [start + span, false]]) {
      const points = profile.slice(0, -1).map(([r, y]) => [r * Math.cos(angle), y, r * Math.sin(angle)]);
      if (reverse) points.reverse();
      shape.addPolygon(points.map(point => shape.addVertex(...point) - 1));
    }
  }
  shape.endShape();
  shape.setMaterial('capsule-section-pbr', material(color));
  return shape;
}

// 完全形状と半割り形状を同じNodeへ保持し、表示を切り替える部品を作る
function sectionPart(name, shapes, parent) {
  const node = app.space.addNode(parent, name);
  const closed = shapes[0].createInstance(), opened = shapes[1].createInstance();
  node.addShape(closed); node.addShape(opened);
  return { node, closed, opened };
}

// 任意の二点を角柱で結び、移動する受け台に沿う固定カムを示す
function rail(name, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const node = part(name, 'box', [Math.hypot(dx, dy, dz) + .01, .055, .08], COLORS.cam,
    a.map((v, i) => (v + b[i]) / 2));
  node.setAttitude(-Math.atan2(dz, dx) * DEG, 0, 0);
  node.rotateZ(Math.atan2(dy, Math.hypot(dx, dz)) * DEG);
  return node;
}

// 固定カムとキャップ保持軌道を作り、ボディの昇降・外側移動を読み取れるようにする
function buildCams() {
  camNodes.push(part('cap-guide', 'ring', [RADIUS - .39, .045], COLORS.cam, [0, .53, 0]));
  let previous = null;
  for (let i = 0; i <= 160; i++) {
    const a = i / 160 * TAU, cycle = sampleCycle(a);
    const r = RADIUS + cycle.radial + .32;
    const point = [r * Math.cos(a), cycle.holderY + .08, r * Math.sin(a)];
    if (previous) camNodes.push(rail(`body-cam-${i}`, previous, point));
    previous = point;
  }
}

// 整列供給器、吸引部、粉末ホッパー、計量ノズル、結合部、清掃部を固定配置する
function buildStations() {
  const feedAngle = .35;
  const feed = app.space.addNode(null, 'capsule-supply');
  feed.setPosition(RADIUS * Math.cos(feedAngle), 0, RADIUS * Math.sin(feedAngle));
  feed.setAttitude(-feedAngle * DEG, 0, 0);
  part('supply-wall', 'box', [.8, .8, .08], COLORS.steel, [0, 2.35, -.38], feed);
  part('supply-side', 'box', [.08, .8, .76], COLORS.steel, [-.40, 2.35, 0], feed);
  part('supply-side', 'box', [.08, .8, .76], COLORS.steel, [.40, 2.35, 0], feed);
  part('supply-guide', 'ring', [.33, .045], COLORS.steel, [0, 1.53, 0], feed);
  for (let i = 0; i < 3; i++) {
    const body = part('empty-capsule-body', 'cylinder', [.5, .15], COLORS.body, [(i - 1) * .21, 2.37, 0], feed);
    part('empty-capsule-cap', 'sphere', [.17], COLORS.cap, [0, .35, 0], body);
  }

  const vacuumAngle = 1.1;
  part('vacuum-shoe', 'box', [.9, .18, .72], COLORS.tube,
    [RADIUS * Math.cos(vacuumAngle), -1.15, RADIUS * Math.sin(vacuumAngle)], null, [-vacuumAngle * DEG, 0, 0]);
  part('vacuum-pipe', 'cylinder', [1.4, .11], COLORS.tube,
    [(RADIUS + .75) * Math.cos(vacuumAngle), -1.75, (RADIUS + .75) * Math.sin(vacuumAngle)]);

  const fillAngle = DOSING.angle;
  const fillStation = app.space.addNode(null, 'powder-dosing-station');
  fillStation.setPosition((RADIUS + 1.20) * Math.cos(fillAngle), 0, (RADIUS + 1.20) * Math.sin(fillAngle));
  fillStation.setAttitude(-fillAngle * DEG, 0, 0);
  part('powder-hopper', 'hopper', [], COLORS.steel, [.58, 2.15, 0], fillStation);
  part('powder-bed', 'cylinder', [.35, .63], COLORS.powder, [.58, 2.40, 0], fillStation);
  for (let i = 0; i < 40; i++) {
    const a = i * 2.399963, r = .59 * Math.sqrt((i + .5) / 40);
    part('hopper-grain', 'sphere', [.049], COLORS.powder, [.58 + r * Math.cos(a), 2.59 + .06 * (1 - r / .59), r * Math.sin(a)], fillStation);
  }
  part('dosing-cylinder', 'cylinder', [.85, .24], COLORS.steel, [0, 1.13, 0], fillStation);
  part('dosing-nozzle', 'cylinder', [.36, .135], COLORS.steel, [0, .48, 0], fillStation);
  part('powder-link', 'box', [.66, .24, .26], COLORS.steel, [.28, 1.54, 0], fillStation);
  pump = part('metering-piston', 'cylinder', [.68, .095], COLORS.steel, [0, 1.87, 0], fillStation);
  part('dosing-bracket', 'box', [.20, 2.3, .20], COLORS.dark, [1.55, 1.20, 0], fillStation);
  part('dosing-bridge', 'box', [1.8, .18, .24], COLORS.dark, [.68, 2.40, -.45], fillStation);
  for (let i = 0; i < 12; i++) streams.push(part('powder-stream', 'sphere', [.035], COLORS.powder, [0, .20, 0], fillStation));

  const closingAngle = 3.95;
  const closing = app.space.addNode(null, 'closing-station');
  closing.setPosition(RADIUS * Math.cos(closingAngle), 0, RADIUS * Math.sin(closingAngle));
  closing.setAttitude(-closingAngle * DEG, 0, 0);
  part('closing-stop', 'box', [1.15, .16, .70], COLORS.steel, [0, 1.25, 0], closing);
  part('closing-support', 'box', [.18, 2.1, .18], COLORS.dark, [1.0, .25, 0], closing);
  part('closing-pin', 'cylinder', [.6, .09], COLORS.steel, [0, -.80, 0], closing);

  const cleaningAngle = 5.93;
  part('cleaning-head', 'box', [.75, .18, .65], COLORS.tube,
    [RADIUS * Math.cos(cleaningAngle), .38, RADIUS * Math.sin(cleaningAngle)], null, [-cleaningAngle * DEG, 0, 0]);
}

// 回転盤と12組の受け台、薄いカプセル壁、粉末粒、排出樋を組み立てる
function buildMachine() {
  part('base', 'cylinder', [.32, 2.0], COLORS.dark, [0, -2.65, 0]);
  shaft = part('central-shaft', 'cylinder', [3.7, .38], COLORS.steel, [0, -.75, 0]);
  turret = app.space.addNode(null, 'rotating-turret');
  table = part('lower-table', 'cylinder', [.13, RADIUS + .55], COLORS.dark, [0, -1.24, 0], turret);
  part('turret-hub', 'cylinder', [.4, 1.1], COLORS.dark, [0, -.70, 0], turret);
  part('cap-support-ring', 'ring', [RADIUS - .45, .075], COLORS.steel, [0, .66, 0], turret);
  const holderProfile = [[.45, -.10], [.45, .10], [.29, .10], [.29, -.10], [.45, -.10]];
  const holderShapes = [false, true].map(cut => sectionShape(holderProfile, cut, COLORS.steel));
  const bodyShapes = [false, true].map(cut => sectionShape(capsuleProfile(false), cut, COLORS.body));
  const capShapes = [false, true].map(cut => sectionShape(capsuleProfile(true), cut, COLORS.cap));

  for (let i = 0; i < COUNT; i++) {
    const angle = i / COUNT * TAU;
    const anchor = app.space.addNode(turret, `carrier-${i + 1}`);
    anchor.setPosition(RADIUS * Math.cos(angle), 0, RADIUS * Math.sin(angle));
    anchor.setAttitude(-angle * DEG, 0, 0);
    const root = app.space.addNode(anchor, 'capsule');
    const body = sectionPart('body', bodyShapes, root), cap = sectionPart('cap', capShapes, root);
    const lowerHolder = sectionPart('body-holder', holderShapes, anchor);
    const upperHolder = sectionPart('cap-holder', holderShapes, anchor);
    const mark = part('selected-carrier', 'ring', [.52, .045], COLORS.focus, [0, -.25, 0], anchor);
    const pin = part('push-up-pin', 'cylinder', [.45, .09], COLORS.steel, [0, -1.2, 0], anchor);
    const follower = part('cam-follower', 'cylinder', [.12, .09], COLORS.steel, [.32, -.05, 0], anchor, [0, 0, 90]);
    const slider = part('radial-slide', 'box', [1.65, .10, .19], COLORS.dark, [.45, -1.13, 0], anchor);
    const grains = [];
    for (let g = 0; g < 24; g++) grains.push(part('capsule-powder', 'sphere', [.045], COLORS.powder, [0, 0, 0], body.node));
    part('radial-spoke', 'box', [RADIUS - 1.0, .09, .14], COLORS.steel, [-(RADIUS - 1.0) / 2, -.65, 0], anchor);
    units.push({ angle, anchor, root, body, cap, lowerHolder, upperHolder, mark, pin, follower, slider, grains });
  }

  const chute = app.space.addNode(null, 'ejection-chute');
  const r = RADIUS + CHUTE.centerOffset;
  const centerY = CHUTE.entryHeight - CHUTE.centerOffset * Math.tan(CHUTE.slope) - CHUTE.thickness / (2 * Math.cos(CHUTE.slope));
  chute.setPosition(r * Math.cos(CHUTE.angle), centerY, r * Math.sin(CHUTE.angle));
  chute.setAttitude(-CHUTE.angle * DEG, 0, 0); chute.rotateZ(-CHUTE.slope * DEG);
  part('chute-floor', 'box', [CHUTE.length, CHUTE.thickness, .82], COLORS.steel, [0, 0, 0], chute);
  for (const sign of [-1, 1]) part('chute-side', 'box', [CHUTE.length, .25, .055], COLORS.steel, [0, .12, sign * .42], chute);

  for (const stage of STAGES) {
    const color = [...stage.color.match(/[0-9a-f]{2}/gi).map(v => parseInt(v, 16) / 255), 1];
    for (let a = stage.start + .04; a < stage.end; a += .08) part('stage-marker', 'box', [.06, .025, .25], color,
      [(RADIUS + 1.65) * Math.cos(a), -2.3, (RADIUS + 1.65) * Math.sin(a)], null, [-a * DEG, 0, 0]);
  }
  buildCams(); buildStations();
}

// 金属部品とカプセルの鉛直軸を保つ視点姿勢を、yawと固定俯角で合成する
function setObserverPose(yaw, pitch) {
  const q = new Quat(); q.setRotateY(yaw);
  const tilt = new Quat(); tilt.setRotateX(pitch); q.mulQuat(tilt);
  orbit.getModeState().attitudeQuat = q;
  orbit.syncOrbitEulerFromQuats(); orbit.setLookAngles(0, 0, 0); orbit.apply();
}

// 断面切り替えとカプセルの有無を、完全形状・半割り形状へ同時に反映する
function showSection(section, visible = true) {
  section.closed.hide(!visible || state.cutaway);
  section.opened.hide(!visible || !state.cutaway);
}

// 回転角から分離・外側移動・充填・結合・排出を更新し、3Dと断面図へ同じ状態を渡す
function updateMachine(deltaSec) {
  if (state.autoOrbit) {
    state.orbitYaw = (state.orbitYaw + 18 * deltaSec) % 360;
    setObserverPose(state.orbitYaw, -30);
  }
  if (!state.paused) {
    state.angle = wrap(state.angle + Math.min(deltaSec, .1) * state.rpm / 60 * TAU);
    state.time += Math.min(deltaSec, .1) * state.rpm / 3;
  }
  turret.setAttitude(-state.angle * DEG, 0, 0);
  table.hide(state.cutaway); shaft.hide(state.cutaway);
  for (const node of camNodes) node.hide(!state.cams);
  for (const [i, unit] of units.entries()) {
    const cycle = sampleCycle(state.angle + unit.angle);
    unit.root.setPosition(0, 0, 0); unit.root.setAttitude(0, 0, 0);
    unit.body.node.setPosition(cycle.radial, cycle.bodyY, 0);
    unit.cap.node.setPosition(0, cycle.capY, 0);
    unit.lowerHolder.node.setPosition(cycle.radial, cycle.holderY + .39, 0);
    unit.upperHolder.node.setPosition(0, .53, 0);
    // 供給中の押上げピンは受け台に留め、排出時にはカプセルの底面を押し上げる
    unit.pin.setPosition(cycle.radial, (cycle.angle < .78 ? cycle.holderY : cycle.bodyY) - .225, 0);
    unit.follower.setPosition(cycle.radial + .32, cycle.holderY + .20, 0);
    unit.mark.setPosition(cycle.radial, cycle.holderY + .39, 0); unit.mark.hide(i !== state.selected);
    showSection(unit.body, cycle.loaded); showSection(unit.cap, cycle.loaded);
    showSection(unit.lowerHolder); showSection(unit.upperHolder);
    unit.slider.hide(state.cutaway);
    for (const [g, grain] of unit.grains.entries()) {
      grain.hide(!cycle.loaded || cycle.fill < (Math.floor(g / 6) + .5) / 4);
      const a = (g % 6) / 6 * TAU + Math.floor(g / 6) * .7;
      grain.setPosition(.14 * Math.cos(a), .27 + Math.floor(g / 6) * .14, .14 * Math.sin(a));
    }
    if (cycle.ejecting) {
      const pose = sampleEjection(cycle.angle), offset = CHUTE.angle - cycle.angle;
      unit.root.setPosition(pose.radius * Math.cos(offset) - RADIUS, pose.y, pose.radius * Math.sin(offset));
      unit.root.setAttitude(-offset * DEG, 0, 0); unit.root.rotateZ(pose.tilt * DEG);
      unit.body.node.setPosition(0, 0, 0); unit.cap.node.setPosition(0, .63, 0);
    }
  }
  // ノズルに最も近いボディを求め、孔が真下を通る区間で計量ピストンを上下させる
  const offsets = units.map(unit => {
    const difference = sampleCycle(state.angle + unit.angle).angle - DOSING.angle;
    return Math.atan2(Math.sin(difference), Math.cos(difference));
  });
  const offset = offsets.reduce((a, b) => Math.abs(a) < Math.abs(b) ? a : b);
  const doseProgress = ramp(offset, -DOSING.halfWindow, DOSING.halfWindow);
  pump.setPosition(0, 1.87 - .44 * Math.sin(doseProgress * Math.PI), 0);
  const receiving = Math.abs(offset) < DOSING.halfWindow;
  for (const [i, node] of streams.entries()) {
    const t = (state.time * 2.5 + i / streams.length) % 1;
    node.setPosition(.06 * Math.cos(i * 2.4), .33 - t * .30, .06 * Math.sin(i * 2.4));
    node.hide(!receiving);
  }
  updateInspector();
}

// 同じカプセル断面を拡大図へ描き、キャップとボディの分離と粉末量を表示する
function buildDetails() {
  for (const cap of [true, false]) {
    const profile = capsuleProfile(cap);
    // 左右の壁を独立した閉じた輪郭で描き、開口と内部の空間を表す
    const sides = [1, -1].map(sign => profile.map(([r, y], i) => `${i ? 'L' : 'M'}${r * 90 * sign} ${-y * 90}`).join(' ') + ' Z');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', sides.join(' '));
    path.setAttribute('fill', cap ? '#e58c96' : '#e6d5b5');
    path.setAttribute('stroke', cap ? '#f4b8bf' : '#f7ead2');
    element(cap ? 'detail-cap' : 'detail-body').append(path);
  }
  const charge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  charge.setAttribute('x', '-18'); charge.setAttribute('width', '36'); charge.setAttribute('rx', '3');
  charge.setAttribute('fill', 'url(#powder)'); element('detail-charge').append(charge);
}

// 選択した受け台の工程、外側移動量、充填量を表示し、工程ボタンを強調する
function updateInspector() {
  const cycle = sampleCycle(state.angle + units[state.selected].angle);
  element('station-number').textContent = String(state.selected + 1).padStart(2, '0');
  element('phase').textContent = cycle.stage.name;
  element('phase-dot').style.background = cycle.stage.color;
  element('description').textContent = cycle.stage.description;
  element('angle-label').textContent = `${Math.round(cycle.angle * DEG)}°`;
  element('fill-value').textContent = cycle.loaded ? `${Math.round(cycle.fill * 100)}%` : '0%';
  element('offset-value').textContent = cycle.radial.toFixed(2);
  element('rotation').value = state.angle * DEG;
  const bodyX = cycle.ejecting ? 160 : 160 + cycle.radial * 42;
  const bodyY = cycle.ejecting ? 0 : cycle.bodyY;
  const capY = cycle.ejecting ? .63 : cycle.capY;
  const mapY = y => 230 - y * 90;
  element('detail-capsule').setAttribute('transform', cycle.ejecting ? 'translate(-40 -40) rotate(90 160 230)' : '');
  element('detail-body').setAttribute('transform', `translate(${bodyX} ${mapY(bodyY)})`);
  element('detail-cap').setAttribute('transform', `translate(160 ${mapY(capY)})`);
  element('detail-charge').setAttribute('transform', `translate(${bodyX} ${mapY(bodyY)})`);
  const charge = element('detail-charge').firstElementChild;
  charge.setAttribute('y', -(.25 + cycle.fill * .47) * 90); charge.setAttribute('height', cycle.fill * .47 * 90);
  for (const id of ['detail-body', 'detail-cap', 'detail-charge']) element(id).style.display = cycle.loaded ? '' : 'none';
  const capLabelY = mapY(capY + .30), bodyLabelY = mapY(bodyY + .44), powderLabelY = mapY(bodyY + .25 + cycle.fill * .235);
  element('cap-label').setAttribute('y', capLabelY);
  element('body-label').setAttribute('y', bodyLabelY);
  element('powder-label').setAttribute('y', powderLabelY);
  element('cap-leader').setAttribute('d', `M65 ${capLabelY - 4}H131`);
  element('body-leader').setAttribute('d', `M60 ${bodyLabelY - 4}H${bodyX - 28}`);
  element('powder-leader').setAttribute('d', `M251 ${powderLabelY - 4}H${bodyX + 18}`);
  for (const id of ['cap-label', 'body-label', 'powder-label', 'cap-leader', 'body-leader', 'powder-leader', 'detail-movement']) element(id).style.display = cycle.loaded && !cycle.ejecting ? '' : 'none';
  element('detail-note').textContent = cycle.ejecting ? 'Ejecting filled capsule' : cycle.loaded ? '' : 'Empty holder';
  element('detail-movement').setAttribute('d', `M160 294H${bodyX}`);
  for (const [i, button] of [...element('stages').children].entries()) button.classList.toggle('active', STAGES[i] === cycle.stage);
}

// 指定した工程へ選択カプセルを移動し、観察しやすい位置で停止する
function seekStage(index) {
  state.angle = wrap(STAGES[index].seek - units[state.selected].angle);
  state.paused = true; element('pause').textContent = 'Resume';
}

// 横幅の小さい表示欄では観察距離を広げ、ホッパーと排出樋を画面へ収める
function fittedDistance(distance) {
  return app.screen.displayWidth < 850 || app.screen.getAspect() < 1.1 ? Math.max(distance, 23) : distance;
}

// 観察方向のボタンから自動周回を止め、水平を保つ視点へ移る
function chooseView(yaw, pitch, distance, targetY = .35) {
  state.autoOrbit = false; element('auto-orbit').checked = false;
  orbit.setTarget(0, targetY, 0); orbit.setDistance(fittedDistance(distance)); setObserverPose(yaw, pitch);
}

// 打錠機と同じ速度・断面・工程選択・視点・自動周回の操作を接続する
function bindControls() {
  for (let i = 0; i < COUNT; i++) {
    const option = document.createElement('option'); option.value = i; option.textContent = String(i + 1).padStart(2, '0'); element('station').append(option);
  }
  element('station').addEventListener('change', event => { state.selected = Number(event.target.value); });
  element('pause').addEventListener('click', () => { state.paused = !state.paused; element('pause').textContent = state.paused ? 'Resume' : 'Pause'; });
  element('speed').addEventListener('input', event => { state.rpm = Number(event.target.value); element('speed-value').textContent = `${state.rpm} rpm`; });
  element('rotation').addEventListener('input', event => { state.angle = Number(event.target.value) / DEG; state.paused = true; element('pause').textContent = 'Resume'; });
  element('cutaway').addEventListener('change', event => { state.cutaway = event.target.checked; });
  element('cams').addEventListener('change', event => { state.cams = event.target.checked; });
  for (const [i, stage] of STAGES.entries()) {
    const button = document.createElement('button'); button.style.setProperty('--stage', stage.color);
    button.innerHTML = `${String(i + 1).padStart(2, '0')} ${stage.name}<small>Inspect this stage</small>`;
    button.addEventListener('click', () => seekStage(i)); element('stages').append(button);
  }
  element('step').addEventListener('click', () => { const cycle = sampleCycle(state.angle + units[state.selected].angle); seekStage((STAGES.indexOf(cycle.stage) + 1) % STAGES.length); });
  element('auto-orbit').addEventListener('change', event => {
    state.autoOrbit = event.target.checked;
    if (state.autoOrbit) { orbit.setTarget(0, .35, 0); const p = orbit.getEyeNode().getWorldMatrix().getPosition(); state.orbitYaw = Math.atan2(p[0], p[2]) * DEG; orbit.setDistance(fittedDistance(19)); }
  });
  element('overview').addEventListener('click', () => chooseView(32, -30, 18));
  element('side').addEventListener('click', () => chooseView(0, -5, 18.5));
  element('top').addEventListener('click', () => chooseView(0, -82, 18.5, 0));
}

// スタジオの明るい面を環境マップへ焼き込み、金属に映る光の帯を用意する
async function prepareMetalLighting() {
  const gpu = app.getGPU();
  environment = new PbrEnvironmentCompute(gpu, {
    label: 'capsule-filler:studio', irradianceWidth: 32, irradianceHeight: 16,
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
    label: 'capsule-filler:pbr', width: app.screen.width, height: app.screen.height,
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
    camera: { target: [0, .35, 0], distance: 18, yaw: 32, pitch: -30 },
    lightPosition: [30, 50, 40, 1], debugTools: { mode: 'release', system: 'capsule-filler' }
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
  orbit = app.createOrbitEyeRig({ target: [0, .35, 0], distance: 18, yaw: 32, pitch: -30,
    minDistance: 8, maxDistance: 32, minPitch: -85, maxPitch: 20, wheelZoomStep: .6 });
  orbit.setDistance(fittedDistance(18));
  setObserverPose(32, -30);
  buildMachine();
  await prepareMetalLighting();
  bindControls();
  buildDetails();
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
