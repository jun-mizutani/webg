// ----------------------------------------------------------------------
// headless_tests/core/space/translucent_render_queue_separation_contracts.js  2026/08/11
//   TranslucentRenderQueue分離後の集計・sort・Space互換API契約
// ----------------------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import Space from "../../../webg/Space.js";
import TranslucentRenderQueue from "../../../webg/TranslucentRenderQueue.js";

// 投影境界test用のCameraFrameと、同じlocal AABBを異なるview位置へ置くentry集合を生成する
const cameraFrame = new CameraFrame({
  cameraWorldMatrix: new Matrix(),
  near: 0.1,
  far: 100,
  vfov: 60,
  aspect: 1,
  depthConvention: CAMERA_REVERSE_Z
});
const makeShape = (name) => ({
  name,
  box: {
    minx: -0.25,
    maxx: 0.25,
    miny: -0.25,
    maxy: 0.25,
    minz: -0.25,
    maxz: 0.25
  }
});
const makeInstanceEntries = (shape, modelview, traversalOrder, depths) => depths.map(
  (viewDepth, triangleIndex) => ({
    shape,
    modelview,
    normal: modelview,
    materialIndex: 0,
    traversalOrder,
    triangleIndex,
    viewDepth,
    index0: triangleIndex * 3,
    index1: triangleIndex * 3 + 1,
    index2: triangleIndex * 3 + 2
  })
);
const translatedMatrix = (x, z) => {
  const matrix = new Matrix();
  matrix.position([x, 0, z]);
  return matrix;
};

// 専用classがSpaceなしでnode配列を集計し、透明triangle有無と最大roughnessを返すことを確認する
{
  const queue = new TranslucentRenderQueue();
  const nodes = [{
    shapes: [{
      isHidden: false,
      materials: [
        { id: null, params: { alpha_mode: "OPAQUE", roughness: 0.04 } },
        { id: null, params: { alpha_mode: "BLEND", roughness: 0.62 } }
      ],
      getMaterialCount: () => 2,
      getMaterialDrawInfo: (index) => ({ count: index === 0 ? 3 : 6 }),
    }]
  }];
  assert.deepEqual(queue.summarize(nodes), {
    hasTriangles: true,
    maxFrostRoughness: 0.62
  });
}

// 画面上で離れた二Shapeはdepthが交互でもShape内順へまとめ、二つの独立blockとして返す
{
  const queue = new TranslucentRenderQueue();
  const leftShape = makeShape("left");
  const rightShape = makeShape("right");
  const leftEntries = makeInstanceEntries(leftShape, translatedMatrix(-1.5, -5), 0, [-5.4, -4.6]);
  const rightEntries = makeInstanceEntries(rightShape, translatedMatrix(1.5, -5), 1, [-5.3, -4.7]);
  const result = queue.sortForMinimalSafeBatches(
    [leftEntries[0], rightEntries[0], rightEntries[1], leftEntries[1]],
    cameraFrame
  );
  assert.deepEqual(result.entries.map((entry) => entry.shape.name), [
    "left", "left", "right", "right"
  ]);
  assert.deepEqual(result.stats, {
    instanceCount: 2,
    independentInstanceCount: 2,
    globallySortedInstanceCount: 0,
    ambiguousPairCount: 0,
    coarseAmbiguousPairCount: 0,
    tightBoundsGroupCount: 0,
    tightBoundsUnavailableGroupCount: 0,
    ignoredSmallOverlapPairCount: 0,
    maximumIgnoredOverlapPixels: 0,
    viewportWidth: null,
    viewportHeight: null,
    smallOverlapPixelLimit: 8
  });
}

// local AABBだけが重なる場合は、実triangle頂点のtight boundsで偽の干渉を除く
{
  const queue = new TranslucentRenderQueue();
  const leftShape = {
    ...makeShape("tight-left"),
    box: { minx: -1, maxx: 1, miny: -1, maxy: 1, minz: -1, maxz: 1 },
    positionArray: [-0.15, -0.1, 0, -0.05, -0.1, 0, -0.1, 0.1, 0]
  };
  const rightShape = {
    ...makeShape("tight-right"),
    box: { minx: -1, maxx: 1, miny: -1, maxy: 1, minz: -1, maxz: 1 },
    positionArray: [0.05, -0.1, 0, 0.15, -0.1, 0, 0.1, 0.1, 0]
  };
  const leftEntries = makeInstanceEntries(leftShape, translatedMatrix(0, -5), 0, [-5]);
  const rightEntries = makeInstanceEntries(rightShape, translatedMatrix(0, -5), 1, [-5]);
  const result = queue.sortForMinimalSafeBatches(
    [...leftEntries, ...rightEntries],
    cameraFrame,
    null,
    { viewportWidth: 960, viewportHeight: 960 }
  );
  assert.deepEqual(result.entries.map((entry) => entry.shape.name), [
    "tight-left", "tight-right"
  ]);
  assert.equal(result.stats.coarseAmbiguousPairCount, 1);
  assert.equal(result.stats.tightBoundsGroupCount, 2);
  assert.equal(result.stats.ambiguousPairCount, 0);
  assert.equal(result.stats.ignoredSmallOverlapPairCount, 0);
}

// tight boundsが重なっても短辺8 pixel以下なら、境界部の順序よりbatch維持を優先する
{
  const queue = new TranslucentRenderQueue();
  const leftShape = {
    ...makeShape("small-left"),
    positionArray: [-0.1, -0.1, 0, 0.01, -0.1, 0, 0.01, 0.1, 0]
  };
  const rightShape = {
    ...makeShape("small-right"),
    positionArray: [0, -0.1, 0, 0.1, -0.1, 0, 0, 0.1, 0]
  };
  const leftEntries = makeInstanceEntries(leftShape, translatedMatrix(0, -5), 0, [-5]);
  const rightEntries = makeInstanceEntries(rightShape, translatedMatrix(0, -5), 1, [-5]);
  const result = queue.sortForMinimalSafeBatches(
    [...leftEntries, ...rightEntries],
    cameraFrame,
    null,
    { viewportWidth: 960, viewportHeight: 960, smallOverlapPixelLimit: 8 }
  );
  assert.equal(result.stats.independentInstanceCount, 2);
  assert.equal(result.stats.ambiguousPairCount, 0);
  assert.equal(result.stats.ignoredSmallOverlapPairCount, 1);
  assert.ok(result.stats.maximumIgnoredOverlapPixels > 0);
  assert.ok(result.stats.maximumIgnoredOverlapPixels <= 8);
}

// tight boundsの短辺が8 pixelを越えて重なるpairは従来どおりtriangle global sortへ残す
{
  const queue = new TranslucentRenderQueue();
  const firstShape = {
    ...makeShape("wide-first"),
    positionArray: [-0.2, -0.2, 0, 0.1, -0.2, 0, 0.1, 0.2, 0]
  };
  const secondShape = {
    ...makeShape("wide-second"),
    positionArray: [-0.1, -0.2, 0, 0.2, -0.2, 0, -0.1, 0.2, 0]
  };
  const firstEntries = makeInstanceEntries(firstShape, translatedMatrix(0, -5), 0, [-5]);
  const secondEntries = makeInstanceEntries(secondShape, translatedMatrix(0, -5), 1, [-4.9]);
  const result = queue.sortForMinimalSafeBatches(
    [...firstEntries, ...secondEntries],
    cameraFrame,
    null,
    { viewportWidth: 960, viewportHeight: 960, smallOverlapPixelLimit: 8 }
  );
  assert.equal(result.stats.independentInstanceCount, 0);
  assert.equal(result.stats.globallySortedInstanceCount, 2);
  assert.equal(result.stats.ambiguousPairCount, 1);
  assert.equal(result.stats.ignoredSmallOverlapPairCount, 0);
}

// 投影矩形と奥行き範囲が両方重なるShapeは従来のtriangle global sort順を維持する
{
  const queue = new TranslucentRenderQueue();
  const firstShape = makeShape("first");
  const secondShape = makeShape("second");
  const firstEntries = makeInstanceEntries(firstShape, translatedMatrix(-0.1, -5), 0, [-5.4, -4.6]);
  const secondEntries = makeInstanceEntries(secondShape, translatedMatrix(0.1, -5), 1, [-5.3, -4.7]);
  const result = queue.sortForMinimalSafeBatches(
    [...firstEntries, ...secondEntries],
    cameraFrame
  );
  assert.deepEqual(result.entries.map((entry) => [entry.shape.name, entry.viewDepth]), [
    ["first", -5.4],
    ["second", -5.3],
    ["second", -4.7],
    ["first", -4.6]
  ]);
  assert.equal(result.stats.independentInstanceCount, 0);
  assert.equal(result.stats.globallySortedInstanceCount, 2);
  assert.equal(result.stats.ambiguousPairCount, 1);
}

// 画面上で重なってもview-space奥行き区間が分離したShapeは全体の前後を保ってblock化する
{
  const queue = new TranslucentRenderQueue();
  const farShape = makeShape("far");
  const nearShape = makeShape("near");
  const farEntries = makeInstanceEntries(farShape, translatedMatrix(0, -8), 0, [-8.2, -7.8]);
  const nearEntries = makeInstanceEntries(nearShape, translatedMatrix(0, -4), 1, [-4.2, -3.8]);
  const result = queue.sortForMinimalSafeBatches(
    [nearEntries[0], farEntries[0], nearEntries[1], farEntries[1]],
    cameraFrame
  );
  assert.deepEqual(result.entries.map((entry) => entry.shape.name), [
    "far", "far", "near", "near"
  ]);
  assert.equal(result.stats.independentInstanceCount, 2);
  assert.equal(result.stats.ambiguousPairCount, 0);
}

// near planeをまたぐ境界は投影矩形を信頼せず、相手Shapeとともにglobal sortへ戻す
{
  const queue = new TranslucentRenderQueue();
  const crossingShape = makeShape("crossing");
  const visibleShape = makeShape("visible");
  const crossingEntries = makeInstanceEntries(
    crossingShape,
    translatedMatrix(0, -0.15),
    0,
    [-0.2]
  );
  const visibleEntries = makeInstanceEntries(
    visibleShape,
    translatedMatrix(2, -5),
    1,
    [-5]
  );
  const result = queue.sortForMinimalSafeBatches(
    [...crossingEntries, ...visibleEntries],
    cameraFrame
  );
  assert.equal(result.stats.independentInstanceCount, 0);
  assert.equal(result.stats.globallySortedInstanceCount, 2);
  assert.equal(result.stats.ambiguousPairCount, 1);
}

// Spaceは専用queueを所有し、集計はSpaceの互換関数を介さず専用classへ直接要求することを確認する
{
  const space = new Space();
  assert.ok(space.translucentRenderQueue instanceof TranslucentRenderQueue);
  const node = space.addNode(null, "transparent-summary");
  node.shapes.push({
    isHidden: false,
    materials: [{ id: null, params: { alpha_mode: "BLEND", roughness: 0.42 } }],
    getMaterialCount: () => 1,
    getMaterialDrawInfo: () => ({ count: 3 }),
  });
  assert.deepEqual(space.translucentRenderQueue.summarize(space.nodes), {
    hasTriangles: true,
    maxFrostRoughness: 0.42
  });
}

console.log("PASS TranslucentRenderQueue separation contracts");
