// -------------------------------------------------
// circular_breaker sample
//   arenaScene.js 2026/03/26
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";

import {
  ARENA_RADIUS,
  ARENA_WALL_RADIUS,
  BLOCK_RING_RADIUS,
  FLOOR_HEIGHT,
  FLOOR_Y,
  FLOOR_PATTERN_Y,
  FLOOR_RING_Y
} from "./constants.js";
import { makeBeveledCylinder, colorize } from "./shapeFactory.js";

// この file は main.js から createArenaLight() / createArenaBackdrop() として呼ばれ、
// 床、床パターン、外周壁、guide ring など背景側 node をまとめて構築する
// runtime や stage 進行に依存しない scene builder をここへ集め、
// main.js では scene の組み立て順だけを追えるようにする

// floor の base mesh を作る
// diagnostics でも参照する shape を返すため、呼び出し側は戻り値を保持する
const createArenaFloor = ({ space, gpu }) => {
  const floorNode = space.addNode(null, "floor");
  const floorShape = makeBeveledCylinder(gpu, ARENA_RADIUS, FLOOR_HEIGHT, 0.7, 64);
  colorize(floorShape, [0.34, 0.35, 0.40, 1.0], 0.8, 0.32, 22.0, 0.01);
  floorNode.addShape(floorShape);
  floorNode.setPosition(0.0, FLOOR_Y, 0.0);
  floorNode.hide(false);
  return {
    floorNode,
    floorShape
  };
};

// 床の同心円パターンを floor へ重ねる
// 独立した ring を置くことで、camera angle が変わっても内部の奥行きを読みやすくする
const createArenaFloorPatterns = ({ space, gpu }) => {
  const arenaPatternRadii = [10.0, 18.0, 26.0, 34.0, 42.0, 50.0, 58.0];
  const nodes = [];
  for (let i = 0; i < arenaPatternRadii.length; i++) {
    const radius = arenaPatternRadii[i];
    const node = space.addNode(null, `arenaPattern_${i}`);
    const shape = new Shape(gpu);
    shape.applyPrimitiveAsset(Primitive.donut(radius, 0.34, 12, 84, shape.getPrimitiveOptions()));
    shape.endShape();
    if ((i % 2) === 0) {
      colorize(shape, [0.76, 0.48, 0.56, 1.0], 0.74, 0.30, 34.0, 0.03);
    } else {
      colorize(shape, [0.5, 0.8, 0.56, 1.0], 0.66, 0.26, 30.0, 0.02);
    }
    node.addShape(shape);
    node.setPosition(0.0, FLOOR_PATTERN_Y, 0.0);
    nodes.push(node);
  }
  return nodes;
};

// 外周壁は低い segment を並べ、45度ごとの marker だけ色と高さを変える
// ソリッド円柱 1 本だと内部を深度で塞ぎやすいため、segment 化を builder に閉じ込める
const createArenaWalls = ({ space, gpu }) => {
  const wallSegBase = makeBeveledCylinder(gpu, 2.2, 5.6, 0.32, 18);
  colorize(wallSegBase, [0.24, 0.29, 0.38, 1.0], 0.56, 0.48, 44.0, 0.0);
  const wallSegMarker = makeBeveledCylinder(gpu, 2.2, 14.4, 0.40, 18);
  colorize(wallSegMarker, [0.28, 0.34, 0.44, 1.0], 0.60, 0.52, 48.0, 0.0);
  const wallPalette = [
    [0.95, 0.40, 0.30, 1.0],
    [0.98, 0.70, 0.28, 1.0],
    [0.94, 0.90, 0.30, 1.0],
    [0.35, 0.82, 0.36, 1.0],
    [0.30, 0.78, 0.95, 1.0],
    [0.36, 0.50, 0.96, 1.0],
    [0.66, 0.42, 0.96, 1.0],
    [0.96, 0.42, 0.76, 1.0]
  ];
  const wallSegCount = 48;
  const markerStep = wallSegCount / 8;
  const nodes = [];
  for (let i = 0; i < wallSegCount; i++) {
    const angle = (i / wallSegCount) * Math.PI * 2.0;
    const isMarker = (i % markerStep) === 0;
    const node = space.addNode(null, `wallSeg_${i}`);
    const shape = new Shape(gpu);
    const baseShape = isMarker ? wallSegMarker : wallSegBase;
    shape.referShape(baseShape);
    shape.copyShaderParamsFromShape(baseShape);
    if (isMarker) {
      const sector = Math.floor(i / markerStep) % 8;
      shape.updateMaterial({
        color: wallPalette[sector]
      });
    }
    node.addShape(shape);
    node.setPosition(
      Math.cos(angle) * ARENA_WALL_RADIUS,
      isMarker ? 6.1 : 1.8,
      Math.sin(angle) * ARENA_WALL_RADIUS
    );
    nodes.push(node);
  }
  return nodes;
};

// block ring の位置をプレイヤーが読みやすくするための guide ring
// runtime では直接使わないが、diagnostics で endedShapeCount に含めるため shape を返す
const createBlockGuideRing = ({ space, gpu }) => {
  const ringNode = space.addNode(null, "ring");
  const ringShape = makeBeveledCylinder(gpu, BLOCK_RING_RADIUS, 1.0, 0.2, 64);
  colorize(ringShape, [0.24, 0.27, 0.34, 1.0], 0.55, 0.30, 30.0, 0.0);
  ringNode.addShape(ringShape);
  ringNode.setPosition(0.0, FLOOR_RING_Y, 0.0);
  ringNode.hide(true);
  return {
    ringNode,
    ringShape
  };
};

// arena 全体の背景側 node をまとめて構築する
// start() から床 / pattern / wall / guide ring の細部を外し、scene 配線順だけ追えるようにする
export const createArenaBackdrop = ({ space, gpu }) => {
  const { floorNode, floorShape } = createArenaFloor({ space, gpu });
  const patternNodes = createArenaFloorPatterns({ space, gpu });
  const wallNodes = createArenaWalls({ space, gpu });
  const { ringNode, ringShape } = createBlockGuideRing({ space, gpu });
  return {
    floorNode,
    floorShape,
    patternNodes,
    wallNodes,
    ringNode,
    ringShape
  };
};

// light も arena 背景の一部として扱い、main.js では「何を構築したか」だけ見えるようにする
export const createArenaLight = (space) => {
  const lightNode = space.addNode(null, "light");
  lightNode.setPosition(0.0, 88.0, 36.0);
  space.setLight(lightNode);
  space.setLightType(1.0);
  return lightNode;
};

export default createArenaBackdrop;
