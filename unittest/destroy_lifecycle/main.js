// ---------------------------------------------
// unittest/destroy_lifecycle/main.js  2026/10/04
//   destroy_lifecycle unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../shared/UnitTestApp.js";

// この unittest は、destroy 系 API の役割を 2 つの層に分けて確認する
// 1. Shape / ShapeResource の寿命管理
//    - shape.destroy() で node から shape instance が外れること
//    - 最後の参照に対して destroyResource=true を使うと shared resource が終了すること
// 2. runtime / instantiation の寿命管理
//    - instantiated.destroy() で scene 上の実体だけが外れること
//    - runtime.destroy() で共有 resource まで含めて終了すること
//
// 起動直後に自動チェックを走らせ、そのあと実画面上で destroy 前後の見えを確認できる構成にする

const SHAPE_LANE_X = -34.0;
const RUNTIME_LANE_X = 34.0;
const ROTATE_SPEED = 0.42;

// 破棄状態をyes / noへ変換し、参照と資源の状態を読み比べやすくする
const formatBool = (value) => value ? "yes" : "no";

// 参照数や要素数を文字列へ変換し、空の値は0として表示する
const formatCount = (value) => Number(value ?? 0).toString();

// 配列内に残る有効な参照を数え、破棄後の保持状態を確認する
const countNonNull = (list) => {
  if (!Array.isArray(list)) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i]) {
      count++;
    }
  }
  return count;
};

// 現在の画面の縦横比と推奨視野角から透視投影を作り、比較用シェーダーへ設定する
const setProjection = (screen, shader, angle = 48) => {
  // 2 レーンを横に並べて見せるため、やや引いた固定視点向けの投影を使う
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1400.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

// 指定した基本形状と材質から、共有資源の寿命を検査するShapeを作る
const createMaterialShape = (gpu, primitiveAsset, color, options = {}) => {
  // Primitive 由来 asset を Shape へ流し込み、
  // destroy 確認に必要な shared resource を必ず GPU 上へ確定させる
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveAsset);
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color,
    ambient: options.ambient ?? 0.34,
    specular: options.specular ?? 0.88,
    power: options.power ?? 42.0
  });
  return shape;
};

// 基本形状のModelAssetを構築し、runtimeと複製実体の寿命を比較できる状態にする
const createRuntimeFromPrimitive = (gpu, color) => {
  // runtime.destroy() を確認するには、ModelBuilder 経路を通した build 結果が必要になる
  // Primitive.cuboid() は ModelAsset を返すため、この unittest では最小の runtime source として扱う
  const asset = Primitive.cuboid(10.0, 8.0, 8.0, {
    txMode: 1,
    txAxis: 1
  });
  const runtime = asset.build(gpu);
  const templateShapes = Array.isArray(runtime.templateShapes) ? runtime.templateShapes : runtime.shapes;
  for (let i = 0; i < templateShapes.length; i++) {
    templateShapes[i].setMaterial("smooth-shader", {
      has_bone: 0,
      use_texture: 0,
      color,
      ambient: 0.28,
      specular: 0.94,
      power: 46.0
    });
  }
  return runtime;
};

// 複製した階層のルートを指定の親へ接続し、シーン上に比較用の実体を配置する
const attachInstantiatedRoots = (runtime, instantiated, mountNode) => {
  // instantiate() が作る root node を mount node 配下へ集めておくと、
  // destroy 前後のレーン位置を固定しやすい
  const roots = runtime.nodes.filter((nodeInfo) => nodeInfo.parent === null);
  for (let i = 0; i < roots.length; i++) {
    const createdNode = instantiated.nodeMap.get(roots[i].id);
    if (createdNode) {
      createdNode.attach(mountNode);
    }
  }
};

// 比較用の床メッシュと単色材質を準備し、物体の位置を読む基準面にする
const createFloorShape = (gpu) => {
  // レーン位置の比較がしやすいよう、薄い床を置いて消え方を見やすくする
  return createMaterialShape(
    gpu,
    Primitive.cuboid(92.0, 1.2, 38.0, {
      txMode: 1,
      txAxis: 1
    }),
    [0.18, 0.22, 0.24, 1.0],
    {
      ambient: 0.42,
      specular: 0.12,
      power: 16.0
    }
  );
};

// 破棄後も残る固定目印を作り、消えた実体と残る背景を区別する
const createAxisMarkerShape = (gpu, color) => {
  // 破棄操作の後も残る固定markerを配置し、
  // 「消えたのは対象 shape だけか」を見分けやすくする
  return createMaterialShape(
    gpu,
    Primitive.prism(6.0, 0.9, 8, {}),
    color,
    {
      ambient: 0.46,
      specular: 0.20,
      power: 16.0
    }
  );
};

// 自動処理の`checks`の実行段階で、必要な処理を決められた順序で進める
const runAutoChecks = (gpu) => {
  // 自動確認の結果は visual test の status 上でも読めるように文字列で返す
  const lines = [];
  let passCount = 0;
  let failCount = 0;

  // 検証結果の1行を記録し、画面に表示するログへ追加する
  const log = (line) => {
    lines.push(line);
  };

  // 条件の合否を記録し、失敗時は比較値を添えて原因を確認できる表示を作る
  const check = (label, condition, detail = "") => {
    if (condition) {
      passCount += 1;
      log(`PASS ${label}`);
    } else {
      failCount += 1;
      log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
    }
  };

  // Shape.destroy() の基礎確認:
  // shape instance が owner node から外れ、最後の参照で resource を destroy できることを見る
  const shapeSpace = new Space();
  const shapeNode = shapeSpace.addNode(null, "shapeDestroyNode");
  const sourceShape = createMaterialShape(
    gpu,
    Primitive.cube(6.0, {}),
    [0.96, 0.52, 0.46, 1.0]
  );
  const sharedResource = sourceShape.getResource();
  shapeNode.addShape(sourceShape);
  const cloneShape = sourceShape.createInstance();
  shapeNode.addShape(cloneShape);

  check("shape resource refCount after createInstance", sharedResource.refCount === 2, formatCount(sharedResource.refCount));

  cloneShape.destroy();
  check("shape.destroy removes clone from owner node", shapeNode.getShapeCount() === 1, formatCount(shapeNode.getShapeCount()));
  check("shape.destroy keeps shared resource while source remains", sharedResource.refCount === 1 && sharedResource.isDestroyed === false, `ref=${sharedResource.refCount} destroyed=${sharedResource.isDestroyed}`);

  sourceShape.destroy({ destroyResource: true });
  check("shape.destroy with destroyResource destroys last shared resource", sharedResource.isDestroyed === true, `destroyed=${sharedResource.isDestroyed}`);
  check("shape resource clears GPU buffer references", sharedResource.vertexBuffer === null && sharedResource.indexBuffer === null, `vb=${sharedResource.vertexBuffer} ib=${sharedResource.indexBuffer}`);

  // runtime / instantiation の確認:
  // instantiated.destroy() は scene 上の実体だけを消し、runtime.destroy() は shared resource も終える
  const runtimeSpace = new Space();
  const runtime = createRuntimeFromPrimitive(gpu, [0.42, 0.82, 0.90, 1.0]);
  const instantiatedA = runtime.instantiate(runtimeSpace);

  check("instantiate creates runtime nodes in space", runtimeSpace.nodes.length > 0, formatCount(runtimeSpace.nodes.length));
  check("instantiate creates shape instances", instantiatedA.shapes.length > 0, formatCount(instantiatedA.shapes.length));

  instantiatedA.destroy();
  check("instantiated.destroy removes runtime nodes from space", runtimeSpace.nodes.length === 0, formatCount(runtimeSpace.nodes.length));
  check("instantiated.destroy keeps runtime resources alive", runtime.shapeResources.every((resource) => resource.isDestroyed === false), runtime.shapeResources.map((resource) => formatBool(resource.isDestroyed)).join(","));

  const instantiatedB = runtime.instantiate(runtimeSpace);
  check("runtime can instantiate again after instantiated.destroy", instantiatedB !== null && runtimeSpace.nodes.length > 0, formatCount(runtimeSpace.nodes.length));

  runtime.destroy();
  check("runtime.destroy clears remaining instantiation nodes", runtimeSpace.nodes.length === 0, formatCount(runtimeSpace.nodes.length));
  check("runtime.destroy destroys shared shape resources", runtime.shapeResources.every((resource) => resource.isDestroyed === true), runtime.shapeResources.map((resource) => formatBool(resource.isDestroyed)).join(","));

  return {
    passCount,
    failCount,
    lines
  };
};

// 共有Shapeを持つ元実体と複製を並べ、個別破棄と資源破棄を比較するレーンを作る
const createShapeLane = (space, gpu) => {
  // 左レーンは Shape / ShapeResource の destroy を見る専用の場にする
  const mount = space.addNode(null, "shapeLaneMount");
  mount.setPosition(SHAPE_LANE_X, 0.0, 0.0);

  const sourceNode = space.addNode(mount, "shapeLaneSourceNode");
  sourceNode.setPosition(-8.0, 7.0, 0.0);
  const cloneNode = space.addNode(mount, "shapeLaneCloneNode");
  cloneNode.setPosition(8.0, 7.0, 0.0);

  const sourceShape = createMaterialShape(
    gpu,
    Primitive.cuboid(8.0, 8.0, 8.0, {}),
    [0.95, 0.52, 0.44, 1.0]
  );
  sourceNode.addShape(sourceShape);

  const cloneShape = sourceShape.createInstance();
  cloneShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.98, 0.82, 0.32, 1.0],
    ambient: 0.34,
    specular: 0.92,
    power: 48.0
  });
  cloneNode.addShape(cloneShape);

  return {
    mount,
    sourceNode,
    cloneNode,
    sourceShape,
    cloneShape,
    resource: sourceShape.getResource()
  };
};

// runtimeとその複製を並べ、実体と共有資源の寿命を比較するレーンを作る
const createRuntimeLane = (space, gpu) => {
  // 右レーンは runtime / instantiation destroy の確認に集中する
  const mount = space.addNode(null, "runtimeLaneMount");
  mount.setPosition(RUNTIME_LANE_X, 0.0, 0.0);

  const runtime = createRuntimeFromPrimitive(gpu, [0.40, 0.84, 0.92, 1.0]);
  const instantiated = runtime.instantiate(space);
  attachInstantiatedRoots(runtime, instantiated, mount);

  return {
    mount,
    runtime,
    instantiated
  };
};

// Shapeとruntimeの比較レーンを構築し、個別破棄と共有資源の寿命を表示する
const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => {
    setProjection(screen, shader, 48);
  });
  shader.setLightPosition([0.0, 120.0, 160.0, 1.0]);

  const autoReport = runAutoChecks(gpu);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 32.0, 132.0);
  eye.setAttitude(0.0, -12.0, 0.0);

  const floor = space.addNode(null, "destroyFloor");
  floor.setPosition(0.0, -9.4, -2.0);
  floor.addShape(createFloorShape(gpu));

  const leftMarker = space.addNode(null, "shapeLaneMarker");
  leftMarker.setPosition(SHAPE_LANE_X, -1.8, -12.0);
  leftMarker.addShape(createAxisMarkerShape(gpu, [0.80, 0.34, 0.28, 1.0]));

  const rightMarker = space.addNode(null, "runtimeLaneMarker");
  rightMarker.setPosition(RUNTIME_LANE_X, -1.8, -12.0);
  rightMarker.addShape(createAxisMarkerShape(gpu, [0.24, 0.70, 0.92, 1.0]));

  const state = {
    shapeLane: createShapeLane(space, gpu),
    runtimeLane: createRuntimeLane(space, gpu),
    phase: 0.0,
    lastAction: "idle"
  };

  // 比較レーンのShapeを作り直し、破棄操作を同じ構成で繰り返せる状態へ戻す
  const rebuildShapeLane = () => {
    // destroy 後も同じ手順で何度でも確認できるよう、
    // レーンごと作り直せる入口を用意する
    if (state.shapeLane?.mount) {
      space.removeNodeTree(state.shapeLane.mount, {
        destroyShapes: true
      });
    }
    state.shapeLane = createShapeLane(space, gpu);
    state.lastAction = "rebuild-shape-lane";
  };

  // 比較レーンのruntimeと実体を作り直し、参照数と描画の開始条件を揃える
  const rebuildRuntimeLane = () => {
    // runtime.destroy()後の再試行では、runtimeと共有資源を生成して開始条件を揃える
    if (state.runtimeLane?.runtime && !state.runtimeLane.runtime.isDestroyed) {
      state.runtimeLane.runtime.destroy();
    }
    if (state.runtimeLane?.mount) {
      space.removeNodeTree(state.runtimeLane.mount, {
        destroyShapes: false
      });
    }
    state.runtimeLane = createRuntimeLane(space, gpu);
    state.lastAction = "rebuild-runtime-lane";
  };

  // 形状の`clone`が保持する資源と参照を安全に解放する
  const destroyShapeClone = () => {
    if (state.shapeLane?.cloneShape && !state.shapeLane.cloneShape.isDestroyed) {
      state.shapeLane.cloneShape.destroy();
      state.lastAction = "clone-shape-destroy";
    }
  };

  // 形状の生成元と共有資源をまとめて破棄する
  const destroyShapeSourceAndResource = () => {
    if (state.shapeLane?.sourceShape && !state.shapeLane.sourceShape.isDestroyed) {
      state.shapeLane.sourceShape.destroy({
        destroyResource: true
      });
      state.lastAction = "source-shape-destroy-request";
    }
  };

  // `instantiation`の`only`が保持する資源と参照を安全に解放する
  const destroyInstantiationOnly = () => {
    if (state.runtimeLane?.instantiated && !state.runtimeLane.instantiated.isDestroyed) {
      state.runtimeLane.instantiated.destroy();
      state.lastAction = "instantiated-destroy";
    }
  };

  // `recreateInstantiation`は元データから独立して利用できる複製または実行状態を作る
  const recreateInstantiation = () => {
    // runtime が生きている間だけ、scene 上の実体を作り直せる
    const lane = state.runtimeLane;
    if (!lane?.runtime || lane.runtime.isDestroyed) {
      return;
    }
    if (lane.instantiated && !lane.instantiated.isDestroyed) {
      lane.instantiated.destroy();
    }
    lane.instantiated = lane.runtime.instantiate(space);
    attachInstantiatedRoots(lane.runtime, lane.instantiated, lane.mount);
    state.lastAction = "instantiated-recreate";
  };

  // 実行状態と共有資源をまとめて破棄する
  const destroyRuntimeAndResource = () => {
    if (state.runtimeLane?.runtime && !state.runtimeLane.runtime.isDestroyed) {
      state.runtimeLane.runtime.destroy();
      state.lastAction = "runtime-destroy";
    }
  };

  document.addEventListener("keydown", (event) => {
    // キー割り当ては destroy 対象ごとに分けて、
    // 「今どの層を壊したのか」が画面上で読みやすいようにする
    const key = event.key.toLowerCase();
    if (key === "1") destroyShapeClone();
    if (key === "2") destroyShapeSourceAndResource();
    if (key === "3") rebuildShapeLane();
    if (key === "7") destroyInstantiationOnly();
    if (key === "8") recreateInstantiation();
    if (key === "9") destroyRuntimeAndResource();
    if (key === "0") rebuildRuntimeLane();
  });

  startLoop(() => {
    state.phase += 0.014;

    // 残っている node だけを回して、
    // destroy 後に消えたものが scene から外れているかを見やすくする
    if (state.shapeLane?.sourceShape && !state.shapeLane.sourceShape.isDestroyed) {
      state.shapeLane.sourceNode.rotateY(ROTATE_SPEED);
      state.shapeLane.sourceNode.rotateX(ROTATE_SPEED * 0.35);
    }
    if (state.shapeLane?.cloneShape && !state.shapeLane.cloneShape.isDestroyed) {
      state.shapeLane.cloneNode.rotateY(-ROTATE_SPEED * 0.9);
      state.shapeLane.cloneNode.rotateZ(ROTATE_SPEED * 0.24);
    }
    if (state.runtimeLane?.mount && state.runtimeLane.runtime && !state.runtimeLane.runtime.isDestroyed) {
      state.runtimeLane.mount.rotateY(ROTATE_SPEED * 0.65);
    }

    leftMarker.rotateY(0.6);
    rightMarker.rotateY(-0.6);

    screen.clear();
    space.draw(eye);
    screen.present();

    const shapeLane = state.shapeLane;
    const runtimeLane = state.runtimeLane;
    const shapeResource = shapeLane?.resource;
    const runtimeResources = Array.isArray(runtimeLane?.runtime?.shapeResources)
      ? runtimeLane.runtime.shapeResources
      : [];

    const autoLines = autoReport.lines.join("\n");
    setStatus(
      "unittest/destroy_lifecycle\n"
      + `autoPass: ${autoReport.passCount}  autoFail: ${autoReport.failCount}\n`
      + `lastAction: ${state.lastAction}\n`
      + "\n"
      + "shape lane\n"
      + ` sourceDestroyed: ${formatBool(shapeLane?.sourceShape?.isDestroyed)}\n`
      + ` cloneDestroyed: ${formatBool(shapeLane?.cloneShape?.isDestroyed)}\n`
      + ` sourceNodeShapes: ${shapeLane?.sourceNode?.getShapeCount?.() ?? 0}\n`
      + ` cloneNodeShapes: ${shapeLane?.cloneNode?.getShapeCount?.() ?? 0}\n`
      + ` resourceRefCount: ${formatCount(shapeResource?.refCount)}\n`
      + ` resourceDestroyed: ${formatBool(shapeResource?.isDestroyed)}\n`
      + "\n"
      + "runtime lane\n"
      + ` instantiatedDestroyed: ${formatBool(runtimeLane?.instantiated?.isDestroyed)}\n`
      + ` runtimeDestroyed: ${formatBool(runtimeLane?.runtime?.isDestroyed)}\n`
      + ` liveInstantiations: ${formatCount(runtimeLane?.runtime?.instantiations?.size)}\n`
      + ` runtimeResourceCount: ${formatCount(runtimeResources.length)}\n`
      + ` destroyedResources: ${formatCount(runtimeResources.filter((resource) => resource?.isDestroyed).length)}\n`
      + "\n"
      + "space overview\n"
      + ` totalNodes: ${formatCount(space.nodes.length)}\n`
      + ` nonNullNodes: ${formatCount(countNonNull(space.nodes))}\n`
      + "\n"
      + "[1] destroy clone shape\n"
      + "[2] destroy source shape (and resource if last ref)\n"
      + "[3] rebuild shape lane\n"
      + "[7] destroy instantiated only\n"
      + "[8] recreate instantiated\n"
      + "[9] destroy runtime\n"
      + "[0] rebuild runtime lane\n"
      + "\n"
      + autoLines
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.04, 0.05, 0.08, 1.0]
}, (app) => {
  return start(app);
});
