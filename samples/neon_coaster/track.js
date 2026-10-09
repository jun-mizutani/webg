// track.js 2026/09/27
// 閉じた三次曲線と通過済み区間の形状変化からレール、枕木、支柱と車両を生成する
import Matrix from "../../webg/Matrix.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";

const SEED_CONTROL_POINTS = Object.freeze([
  [0, 7, 18],
  [13, 10, 14],
  [22, 17, 2],
  [16, 25, -12],
  [2, 15, -22],
  [-14, 6, -18],
  [-23, 9, -3],
  [-18, 21, 12],
  [-5, 17, 23]
]);

const TRACK_SEGMENTS = 240;
const CONTROL_POINT_COUNT = 12;
const TRACK_CHUNKS = 12;
const SPLINE_SPANS_PER_CHUNK = CONTROL_POINT_COUNT / TRACK_CHUNKS;
const SEGMENTS_PER_CHUNK = TRACK_SEGMENTS / TRACK_CHUNKS;
const TRACK_GAUGE = 1.5;
const RAIL_RADIUS = 0.13;
const TUBE_SIDES = 8;
const TIE_COUNT = 80;
const CITY_RING_RADII = Object.freeze([46, 63, 80]);
const CITY_BUILDINGS_PER_RING = 24;
const SUPPORTS_PER_CHUNK = 2;
const SUPPORT_COUNT = TRACK_CHUNKS * SUPPORTS_PER_CHUNK;
const CAR_PARAMETER_GAP = 0.017;
// 車体上面のY=0.425から旧手すり上段Y=0.98までの高さを25%にする
const HANDRAIL_TOP_Y = 0.425 + (0.98 - 0.425) * 0.25;
const CONTROL_POINT_TRAILING_SPANS = 2;
const CONTROL_POINT_UPDATE_INTERVAL_SPANS = 1;
// 制御点の目標は初期コース周辺から選び、周回ごとに大きく変化する見た目にする
const CONTROL_POINT_LATERAL_RANGE = 3.0;
const CONTROL_POINT_VERTICAL_RANGE = 1.8;
const VARIATION_SECONDS = 0.82;
const GEOMETRY_REFRESH_SECONDS = 0.16;

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (v, scale) => [v[0] * scale, v[1] * scale, v[2] * scale];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];

// 曲線姿勢に使用する方向は長さ0を許さず、設定誤りをその場で知らせる
function normalize3(value, label) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 1.0e-8) {
    throw new Error(`neon_coaster ${label} must have non-zero finite length`);
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

// 任意の閉曲線制御点列をCatmull–Rom補間し、位置と微分を同じ区間から求める
function sampleControlCurve(controlPoints, parameter) {
  const wrapped = ((parameter % 1) + 1) % 1;
  const pointCount = controlPoints.length;
  const scaled = wrapped * pointCount;
  const segment = Math.floor(scaled);
  const u = scaled - segment;
  const pointAt = index => controlPoints[(index % pointCount + pointCount) % pointCount];
  const p0 = pointAt(segment - 1);
  const p1 = pointAt(segment);
  const p2 = pointAt(segment + 1);
  const p3 = pointAt(segment + 2);
  const u2 = u * u;
  const u3 = u2 * u;
  const position = [0, 1, 2].map(axis => 0.5 * (
    2 * p1[axis]
    + (-p0[axis] + p2[axis]) * u
    + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * u2
    + (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * u3
  ));
  const derivative = [0, 1, 2].map(axis => 0.5 * (
    (-p0[axis] + p2[axis])
    + 2 * (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * u
    + 3 * (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * u2
  ));
  return { parameter: wrapped, position, derivative };
}

// 元の9点曲線を12点へ再標本化し、初期コースの形を保った局所編集用の点列を作る
function createInitialControlPoints() {
  return Array.from({ length: CONTROL_POINT_COUNT }, (_, index) =>
    sampleControlCurve(SEED_CONTROL_POINTS, index / CONTROL_POINT_COUNT).position
  );
}

// 更新中の制御点列から車両・カメラ・レールが共有する位置と姿勢を返す
export function sampleCourse(parameter, controlPoints = SEED_CONTROL_POINTS) {
  const baseSample = sampleControlCurve(controlPoints, parameter);
  const wrapped = baseSample.parameter;
  const tangent = normalize3(baseSample.derivative, "course tangent");
  let side = normalize3(cross3([0, 1, 0], tangent), "course side");
  let up = normalize3(cross3(tangent, side), "course up");
  // 細かい波と緩やかな波の角度比を8:13へ入れ替え、合成波を±45度の範囲へ正規化する
  const bankWave = Math.sin(wrapped * Math.PI * 8) * 8
    + Math.sin(wrapped * Math.PI * 2 + 0.7) * 13;
  const bankDegree = bankWave * (45 / 21);
  const bank = bankDegree * Math.PI / 180;
  const bankedSide = add3(scale3(side, Math.cos(bank)), scale3(up, Math.sin(bank)));
  const bankedUp = add3(scale3(up, Math.cos(bank)), scale3(side, -Math.sin(bank)));
  side = normalize3(bankedSide, "banked side");
  up = normalize3(bankedUp, "banked up");
  return Object.freeze({ parameter: wrapped, position: baseSample.position, tangent, side, up, bankDegree });
}

// side、up、tangentをローカルXYZ軸として、曲線上のNode姿勢行列を作る
function makeCoursePose(sample, position = sample.position) {
  const matrix = new Matrix();
  matrix.setBulk([
    sample.side[0], sample.side[1], sample.side[2], 0,
    sample.up[0], sample.up[1], sample.up[2], 0,
    sample.tangent[0], sample.tangent[1], sample.tangent[2], 0,
    position[0], position[1], position[2], 1
  ]);
  return matrix;
}

// 曲線の一部に円断面を連結し、1チャンク分のレールまたは発光ガイドを作る
function createCourseTubeChunk(gpu, chunkIndex, lateralOffset, verticalOffset, radius, material, controlPoints) {
  const shape = new Shape(gpu);
  shape.autoCalcNormals = false;
  const firstSegment = chunkIndex * SEGMENTS_PER_CHUNK;
  for (let localSegment = 0; localSegment <= SEGMENTS_PER_CHUNK; localSegment++) {
    const sample = sampleCourse((firstSegment + localSegment) / TRACK_SEGMENTS, controlPoints);
    const center = add3(sample.position,
      add3(scale3(sample.side, lateralOffset), scale3(sample.up, verticalOffset)));
    for (let sideIndex = 0; sideIndex < TUBE_SIDES; sideIndex++) {
      const angle = sideIndex / TUBE_SIDES * Math.PI * 2;
      const normal = normalize3(add3(
        scale3(sample.side, Math.cos(angle)),
        scale3(sample.up, Math.sin(angle))
      ), "tube normal");
      const vertex = add3(center, scale3(normal, radius));
      const index = shape.addVertex(vertex[0], vertex[1], vertex[2]) - 1;
      shape.setVertNormal(index, normal[0], normal[1], normal[2]);
    }
  }
  for (let localSegment = 0; localSegment < SEGMENTS_PER_CHUNK; localSegment++) {
    const segment = localSegment;
    const next = localSegment + 1;
    for (let sideIndex = 0; sideIndex < TUBE_SIDES; sideIndex++) {
      const nextSide = (sideIndex + 1) % TUBE_SIDES;
      const a = segment * TUBE_SIDES + sideIndex;
      const b = next * TUBE_SIDES + sideIndex;
      const c = next * TUBE_SIDES + nextSide;
      const d = segment * TUBE_SIDES + nextSide;
      shape.addTriangle(a, b, c);
      shape.addTriangle(a, c, d);
    }
  }
  shape.endShape();
  shape.setMaterial("coaster-tube", material);
  return shape;
}

// PrimitiveからPBR Shapeを作り、車両と構造物で共有できる完成状態にする
function createPrimitiveShape(gpu, asset, material, id) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.setMaterial(id, material);
  return shape;
}

// 共有geometryから材質付きinstanceを作り、Nodeごとに独立して登録する
function addShapeInstance(space, parent, name, prototype, material, position) {
  const shape = new Shape(prototype);
  shape.setMaterial(name, material);
  const node = space.addNode(parent, name);
  if (position) node.setPosition(...position);
  node.addShape(shape);
  return { node, shape };
}

// 四隅と外向き法線を受け取り、面を分けた四角形としてShapeへ追加する
function appendCityQuad(shape, corners, normal) {
  const indices = corners.map(position => {
    const index = shape.addVertex(position[0], position[1], position[2]) - 1;
    shape.setVertNormal(index, normal[0], normal[1], normal[2]);
    return index;
  });
  shape.addTriangle(indices[0], indices[1], indices[2]);
  shape.addTriangle(indices[0], indices[2], indices[3]);
}

// 建物の位置・寸法を受け取り、暗い外壁の直方体を共有Shapeへ積み重ねる
function appendCityCuboid(shape, center, dimensions) {
  const [x, y, z] = center;
  const [halfX, halfY, halfZ] = dimensions.map(value => value * 0.5);
  appendCityQuad(shape, [
    [x - halfX, y - halfY, z + halfZ], [x + halfX, y - halfY, z + halfZ],
    [x + halfX, y + halfY, z + halfZ], [x - halfX, y + halfY, z + halfZ]
  ], [0, 0, 1]);
  appendCityQuad(shape, [
    [x + halfX, y - halfY, z - halfZ], [x - halfX, y - halfY, z - halfZ],
    [x - halfX, y + halfY, z - halfZ], [x + halfX, y + halfY, z - halfZ]
  ], [0, 0, -1]);
  appendCityQuad(shape, [
    [x + halfX, y - halfY, z + halfZ], [x + halfX, y - halfY, z - halfZ],
    [x + halfX, y + halfY, z - halfZ], [x + halfX, y + halfY, z + halfZ]
  ], [1, 0, 0]);
  appendCityQuad(shape, [
    [x - halfX, y - halfY, z - halfZ], [x - halfX, y - halfY, z + halfZ],
    [x - halfX, y + halfY, z + halfZ], [x - halfX, y + halfY, z - halfZ]
  ], [-1, 0, 0]);
  appendCityQuad(shape, [
    [x - halfX, y + halfY, z - halfZ], [x - halfX, y + halfY, z + halfZ],
    [x + halfX, y + halfY, z + halfZ], [x + halfX, y + halfY, z - halfZ]
  ], [0, 1, 0]);
  appendCityQuad(shape, [
    [x - halfX, y - halfY, z + halfZ], [x - halfX, y - halfY, z - halfZ],
    [x + halfX, y - halfY, z - halfZ], [x + halfX, y - halfY, z + halfZ]
  ], [0, -1, 0]);
}

// 窓の中心、向き、寸法から壁面へ外向き法線を持つ発光パネルを追加する
function appendCityWindow(shape, center, horizontalAxis, normal, halfWidth, halfHeight) {
  const [x, y, z] = center;
  const [ux, uy, uz] = horizontalAxis;
  const [nx, ny, nz] = normal;
  const offset = 0.018;
  const middle = [x + nx * offset, y, z + nz * offset];
  const corners = [
    [middle[0] - ux * halfWidth, y - halfHeight, middle[2] - uz * halfWidth],
    [middle[0] + ux * halfWidth, y - halfHeight, middle[2] + uz * halfWidth],
    [middle[0] + ux * halfWidth, y + halfHeight, middle[2] + uz * halfWidth],
    [middle[0] - ux * halfWidth, y + halfHeight, middle[2] - uz * halfWidth]
  ];
  appendCityQuad(shape, corners, normal);
}

// 棟番号と寸法軸から再現可能な符号付き2〜4mの寸法変化を求める
function cityDimensionVariation(buildingIndex, axisIndex) {
  const magnitudeHash = Math.sin((buildingIndex + 1) * 127.1 + (axisIndex + 1) * 311.7) * 43758.5453;
  const directionHash = Math.sin((buildingIndex + 1) * 269.5 + (axisIndex + 1) * 183.3) * 24634.6345;
  const magnitudeRandom = magnitudeHash - Math.floor(magnitudeHash);
  const directionRandom = directionHash - Math.floor(directionHash);
  const direction = directionRandom < 0.5 ? -1 : 1;
  return direction * (2 + magnitudeRandom * 2);
}

// 半径の異なる3列へ72棟のビルと窓明かりをまとめ、街の夜景として配置する
function createCitySkyline(gpu, space, shapes, groundLevel) {
  const buildingMaterials = [
    { color: [0.018, 0.032, 0.062, 1], metallic: 0.68, roughness: 0.36, specular: 0.9 },
    { color: [0.042, 0.02, 0.06, 1], metallic: 0.62, roughness: 0.4, specular: 0.85 },
    { color: [0.018, 0.048, 0.062, 1], metallic: 0.58, roughness: 0.38, specular: 0.9 },
    { color: [0.045, 0.045, 0.07, 1], metallic: 0.72, roughness: 0.32, specular: 0.95 }
  ];
  const windowMaterials = [
    { color: [1, 0.9, 0.73, 1], metallic: 0.05, roughness: 0.28, specular: 0.6, emissive_factor: [1.45, 1.15, 0.82], double_sided: 1 },
    { color: [1, 0.77, 0.5, 1], metallic: 0.05, roughness: 0.28, specular: 0.6, emissive_factor: [1.7, 1.05, 0.52], double_sided: 1 },
    { color: [1, 0.59, 0.29, 1], metallic: 0.05, roughness: 0.28, specular: 0.6, emissive_factor: [1.7, 0.78, 0.3], double_sided: 1 },
    { color: [1, 0.4, 0.16, 1], metallic: 0.05, roughness: 0.28, specular: 0.6, emissive_factor: [1.65, 0.52, 0.19], double_sided: 1 }
  ];
  const buildingShapes = buildingMaterials.map(() => {
    const shape = new Shape(gpu);
    shape.autoCalcNormals = false;
    return shape;
  });
  const windowShapes = windowMaterials.map(() => {
    const shape = new Shape(gpu);
    shape.autoCalcNormals = false;
    return shape;
  });

  // 固定式の整数系列で棟ごとの幅、高さ、色、明かりの点灯率を変える
  let buildingIndex = 0;
  for (let ringIndex = 0; ringIndex < CITY_RING_RADII.length; ringIndex++) {
    for (let sector = 0; sector < CITY_BUILDINGS_PER_RING; sector++) {
      const pattern = buildingIndex * 17 + ringIndex * 29 + sector * 11;
      const angle = (sector + (ringIndex % 2) * 0.5) / CITY_BUILDINGS_PER_RING * Math.PI * 2;
      const radius = CITY_RING_RADII[ringIndex] + ((pattern % 9) - 4) * 0.72;
      const width = 8 + cityDimensionVariation(buildingIndex, 0);
      const depth = 7.5 + cityDimensionVariation(buildingIndex, 1);
      const baseHeight = 11 + ((pattern * 7) % 25) * 1.38;
      const height = baseHeight + cityDimensionVariation(buildingIndex, 2);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const bodyIndex = (buildingIndex + ringIndex * 2) % buildingShapes.length;
      const windowIndex = (buildingIndex * 3 + ringIndex) % windowShapes.length;
      const bodyShape = buildingShapes[bodyIndex];

      // ビル本体だけを地面から立ち上げ、土台や屋上の別boxを置かずに輪郭を作る
      appendCityCuboid(bodyShape, [x, groundLevel + height * 0.5, z], [width, height, depth]);

      // 各階の窓を4面へ並べ、棟ごとに暖白色からオレンジまでの発光を切り替える
      const columnsX = Math.max(2, Math.floor(width / 1.25));
      const columnsZ = Math.max(2, Math.floor(depth / 1.25));
      const rows = Math.max(3, Math.floor(height / 2.2));
      const windowHeight = Math.min(0.34, height / (rows + 1) * 0.34);
      const windowShape = windowShapes[windowIndex];
      const faces = [
        { axis: [1, 0, 0], normal: [0, 0, 1], halfExtent: depth * 0.5, columns: columnsX, extent: width, face: 0 },
        { axis: [-1, 0, 0], normal: [0, 0, -1], halfExtent: depth * 0.5, columns: columnsX, extent: width, face: 1 },
        { axis: [0, 0, -1], normal: [1, 0, 0], halfExtent: width * 0.5, columns: columnsZ, extent: depth, face: 2 },
        { axis: [0, 0, 1], normal: [-1, 0, 0], halfExtent: width * 0.5, columns: columnsZ, extent: depth, face: 3 }
      ];
      for (let row = 0; row < rows; row++) {
        const windowY = groundLevel + (row + 1) * height / (rows + 1);
        for (const wall of faces) {
          const pitch = wall.extent / (wall.columns + 1);
          const halfWidth = Math.min(0.25, pitch * 0.24);
          for (let column = 0; column < wall.columns; column++) {
            if ((buildingIndex * 19 + row * 7 + column * 3 + wall.face * 5) % 10 < 3) continue;
            const offset = (column + 1) / (wall.columns + 1) - 0.5;
            const windowX = x + wall.axis[0] * offset * wall.extent * 0.84
              + wall.normal[0] * wall.halfExtent;
            const windowZ = z + wall.axis[2] * offset * wall.extent * 0.84
              + wall.normal[2] * wall.halfExtent;
            appendCityWindow(windowShape, [windowX, windowY, windowZ],
              wall.axis, wall.normal, halfWidth, windowHeight * 0.5);
          }
        }
      }
      buildingIndex++;
    }
  }

  // 8個の色別Shapeへまとめて登録し、ビル1棟ごとの描画Nodeを作らず夜景を構成する
  const skyline = space.addNode(null, "city-skyline");
  buildingShapes.forEach((shape, index) => {
    shape.endShape();
    shape.setMaterial(`city-building-${index}`, buildingMaterials[index]);
    skyline.addShape(shape);
    shapes.push(shape);
  });
  windowShapes.forEach((shape, index) => {
    shape.endShape();
    shape.setMaterial(`city-windows-${index}`, windowMaterials[index]);
    skyline.addShape(shape);
    shapes.push(shape);
  });
}

// 全車両の上面より少し内側を細い円柱の手すりで囲み、曲線とbank中も姿勢を読み取りやすくする
function addCarHandrail(space, root, prototypes, index, shapes) {
  const material = {
    color: [0.86, 0.88, 0.9, 1], metallic: 1, roughness: 0.07, specular: 1
  };

  // 上段の円柱を車体の左右端から0.13内側へ置き、Z軸へ回して前後方向につなぐ
  for (const [sideName, x] of [["left", -0.62], ["right", 0.62]]) {
    const rail = addShapeInstance(space, root,
      `car-${index}-handrail-top-${sideName}`,
      prototypes.handrailSide, material, [x, HANDRAIL_TOP_Y, 0]);
    rail.node.rotateX(90);
    shapes.push(rail.shape);
  }
  // 前後の円柱も車体端から約0.18内側へ置き、X軸へ回して四辺を閉じる
  for (const [endName, z] of [["rear", -0.95], ["front", 0.95]]) {
    const rail = addShapeInstance(space, root,
      `car-${index}-handrail-top-${endName}`,
      prototypes.handrailEnd, material, [0, HANDRAIL_TOP_Y, z]);
    rail.node.rotateZ(-90);
    shapes.push(rail.shape);
  }

  // 角と両側面の中央に細い円柱の支柱を置き、上段の手すりを車体へ接続する
  for (const [sideName, x] of [["left", -0.62], ["right", 0.62]]) {
    for (const [postName, z] of [["rear", -0.95], ["middle", 0], ["front", 0.95]]) {
      const post = addShapeInstance(space, root,
        `car-${index}-handrail-post-${sideName}-${postName}`,
        prototypes.handrailPost, material, [x, 0.49, z]);
      shapes.push(post.shape);
    }
  }
}

// 車両1台をbody、nose、発光帯、4輪に分け、先頭車両を含む全車両へ同じ手すりを追加する
function createCar(space, gpu, prototypes, index, nodes, shapes) {
  const root = space.addNode(null, index === 0 ? "lead-car" : `car-${index}`);
  nodes.set(root.name, root);
  const bodyMaterial = index === 0
    ? { color: [0.9, 0.08, 0.04, 1], metallic: 0.9, roughness: 0.18, specular: 1 }
    : {
        color: [0.045, 0.075 + index * 0.012, 0.12, 1],
        metallic: 0.78,
        roughness: 0.22,
        specular: 1,
        emissive_factor: [0.005, 0.025 + index * 0.005, 0.05]
      };
  const glowMaterial = {
    color: [1, 0.22, 0.03, 1], metallic: 0.1, roughness: 0.25, specular: 1,
    emissive_factor: [7, 0.5, 0.03]
  };
  const wheelMaterial = { color: [0.03, 0.04, 0.05, 1], metallic: 0.95, roughness: 0.12, specular: 1 };
  const body = addShapeInstance(space, root, `car-${index}-body`, prototypes.body, bodyMaterial, [0, 0.1, 0]);
  const nose = addShapeInstance(space, root, `car-${index}-nose`, prototypes.nose, bodyMaterial, [0, 0.05, 1.35]);
  const glow = addShapeInstance(space, root, `car-${index}-glow`, prototypes.glow, glowMaterial, [0, -0.2, 0]);
  shapes.push(body.shape, nose.shape, glow.shape);
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.72, 0.72]) {
      const wheel = addShapeInstance(space, root,
        `car-${index}-wheel-${x}-${z}`, prototypes.wheel, wheelMaterial, [x, -0.38, z]);
      shapes.push(wheel.shape);
    }
  }
  addCarHandrail(space, root, prototypes, index, shapes);
  return root;
}

// レール、都市構造、車両を生成し、更新と破棄をまとめたruntimeを返す
export function createCoasterScene(app) {
  const gpu = app.getGPU();
  const space = app.space;
  const nodes = new Map();
  const shapes = [];
  const railMaterial = { color: [0.72, 0.79, 0.86, 1], metallic: 1, roughness: 0.16, specular: 1, double_sided: 1 };
  const guideMaterials = [
    {
      color: [0.06, 0.9, 0.18, 1], metallic: 0.15, roughness: 0.25, specular: 1,
      emissive_factor: [0.12, 4.2, 0.35], double_sided: 1
    },
    {
      color: [1, 0.28, 0.035, 1], metallic: 0.15, roughness: 0.25, specular: 1,
      emissive_factor: [6, 1.25, 0.08], double_sided: 1
    },
    {
      color: [0.03, 0.75, 1, 1], metallic: 0.15, roughness: 0.25, specular: 1,
      emissive_factor: [0.05, 3.5, 7], double_sided: 1
    },
    {
      color: [0.82, 0.91, 1, 1], metallic: 0.15, roughness: 0.25, specular: 1,
      emissive_factor: [3.2, 4, 5], double_sided: 1
    }
  ];
  const carGlowMaterial = {
    color: [0.03, 0.75, 1, 1], metallic: 0.15, roughness: 0.25, specular: 1,
    emissive_factor: [0.05, 3.5, 7], double_sided: 1
  };
  const tieMaterial = { color: [0.16, 0.2, 0.25, 1], metallic: 0.8, roughness: 0.28, specular: 1 };
  const tiePrototype = createPrimitiveShape(gpu, Primitive.cuboid(2.15, 0.14, 0.28), tieMaterial, "tie");
  shapes.push(tiePrototype);
  const supportMaterial = { color: [0.08, 0.12, 0.16, 1], metallic: 0.75, roughness: 0.32, specular: 1 };
  const initialControlPoints = createInitialControlPoints();
  const courseControlPoints = initialControlPoints.map(point => [...point]);
  const controlPointTransitions = Array.from({ length: CONTROL_POINT_COUNT }, () => null);
  const trackChunks = [];
  const tieEntries = [];

  // 1区間分の高さに合わせて支柱Shapeを作り、床からレール下面までを支える
  function createSupportShape(sample, id) {
    const height = sample.position[1] + 0.2;
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error(`neon_coaster support height must be positive: ${height}`);
    }
    const shape = createPrimitiveShape(gpu,
      Primitive.cuboid(0.38, height, 0.38), supportMaterial, `support-${id}`);
    return { shape, height };
  }

  // 一つのCatmull–Romスパンをレール・ガイド・枕木・支柱の更新単位として登録する
  function createTrackChunk(chunkIndex) {
    const prefix = `course-${String(chunkIndex).padStart(2, "0")}`;
    const railDefinitions = [
      ["left", -TRACK_GAUGE * 0.5, 0, RAIL_RADIUS, railMaterial],
      ["right", TRACK_GAUGE * 0.5, 0, RAIL_RADIUS, railMaterial],
      ["guide", 0, -0.42, 0.055,
        guideMaterials[Math.floor(chunkIndex * guideMaterials.length / TRACK_CHUNKS)]]
    ];
    const rails = railDefinitions.map(([name, lateral, vertical, radius, material]) => {
      const node = space.addNode(null, `${prefix}-${name}-rail`);
      const shape = createCourseTubeChunk(gpu, chunkIndex, lateral, vertical,
        radius, material, courseControlPoints);
      node.addShape(shape);
      nodes.set(node.name, node);
      shapes.push(shape);
      return { name, node, shape, lateral, vertical, radius, material };
    });

    const ties = [];
    for (let index = 0; index < TIE_COUNT; index++) {
      const tieChunk = Math.floor(index / TIE_COUNT * TRACK_CHUNKS);
      if (tieChunk !== chunkIndex) continue;
      const sample = sampleCourse(index / TIE_COUNT, courseControlPoints);
      const tie = addShapeInstance(space, null, `tie-${index}`, tiePrototype, tieMaterial);
      tie.node.setByMatrix(makeCoursePose(sample, add3(sample.position, scale3(sample.up, -0.16))));
      shapes.push(tie.shape);
      ties.push({ index, node: tie.node });
    }
    tieEntries.push(...ties);

    const supports = [];
    for (let supportIndex = chunkIndex * SUPPORTS_PER_CHUNK;
      supportIndex < (chunkIndex + 1) * SUPPORTS_PER_CHUNK; supportIndex++) {
      const sample = sampleCourse(supportIndex / SUPPORT_COUNT, courseControlPoints);
      const support = space.addNode(null, `support-${supportIndex}`);
      const supportResource = createSupportShape(sample, supportIndex);
      support.setPosition(sample.position[0], supportResource.height * 0.5 - 0.3, sample.position[2]);
      support.addShape(supportResource.shape);
      nodes.set(support.name, support);
      shapes.push(supportResource.shape);
      supports.push({ index: supportIndex, node: support, shape: supportResource.shape });
    }

    const chunk = { chunkIndex, prefix, rails, ties, supports };
    trackChunks.push(chunk);
    return chunk;
  }

  // すべての差し替えShapeを先に作り、完成してから同じNodeへまとめて入れ替える
  function rebuildTrackChunk(chunkIndex) {
    const chunk = trackChunks[chunkIndex];
    const replacements = [];
    try {
      for (const rail of chunk.rails) {
        replacements.push({ rail, shape: createCourseTubeChunk(gpu, chunkIndex,
          rail.lateral, rail.vertical, rail.radius, rail.material, courseControlPoints) });
      }
      for (const support of chunk.supports) {
        const supportSample = sampleCourse(support.index / SUPPORT_COUNT, courseControlPoints);
        const supportResource = createSupportShape(supportSample, support.index);
        replacements.push({ support, shape: supportResource.shape,
          sample: supportSample, height: supportResource.height });
      }
    } catch (error) {
      for (const replacement of replacements) replacement.shape.destroy();
      throw error;
    }

    for (const replacement of replacements) {
      const node = replacement.support ? replacement.support.node : replacement.rail.node;
      const oldShape = replacement.support ? replacement.support.shape : replacement.rail.shape;
      oldShape.destroy();
      const oldIndex = shapes.indexOf(oldShape);
      if (oldIndex >= 0) shapes.splice(oldIndex, 1);
      node.setShape(replacement.shape);
      shapes.push(replacement.shape);
      if (replacement.support) {
        replacement.support.shape = replacement.shape;
        node.setPosition(replacement.sample.position[0], replacement.height * 0.5 - 0.3,
          replacement.sample.position[2]);
      } else {
        replacement.rail.shape = replacement.shape;
      }
    }

    for (const tie of chunk.ties) {
      const sample = sampleCourse(tie.index / TIE_COUNT, courseControlPoints);
      tie.node.setByMatrix(makeCoursePose(sample, add3(sample.position, scale3(sample.up, -0.16))));
    }
  }

  for (let chunkIndex = 0; chunkIndex < TRACK_CHUNKS; chunkIndex++) {
    createTrackChunk(chunkIndex);
  }

  const floorMaterial = { color: [0.038, 0.052, 0.065, 1], metallic: 0.35, roughness: 0.48, specular: 0.8 };
  const floorShape = createPrimitiveShape(gpu, Primitive.cuboid(180, 0.5, 180), floorMaterial, "floor");
  const floor = space.addNode(null, "floor");
  floor.setPosition(0, -0.55, 0);
  floor.addShape(floorShape);
  shapes.push(floorShape);

  // 小さな共有sphereを遠景灯として散らし、上昇区間にも夜景の奥行きと速度の基準を作る
  const beaconMaterials = [
    { color: [0.25, 0.9, 1, 1], metallic: 0.05, roughness: 0.18, specular: 1, emissive_factor: [1.2, 6, 9] },
    { color: [1, 0.16, 0.35, 1], metallic: 0.05, roughness: 0.18, specular: 1, emissive_factor: [9, 0.35, 1.8] },
    { color: [1, 0.75, 0.28, 1], metallic: 0.05, roughness: 0.18, specular: 1, emissive_factor: [8, 3.5, 0.5] }
  ];
  const beaconPrototype = createPrimitiveShape(gpu,
    Primitive.sphere(0.09, 8, 12), beaconMaterials[0], "beacon-prototype");
  shapes.push(beaconPrototype);
  for (let index = 0; index < 56; index++) {
    const angle = index * 2.399963229728653;
    const radius = 34 + (index % 9) * 1.7;
    const y = 8 + ((index * 17) % 27);
    const beacon = addShapeInstance(space, null, `beacon-${index}`, beaconPrototype,
      beaconMaterials[index % beaconMaterials.length], [
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      ]);
    beacon.node.setScale(0.65 + (index % 4) * 0.23);
    shapes.push(beacon.shape);
  }

  const towerMaterial = { color: [0.15, 0.21, 0.3, 1], metallic: 0.96, roughness: 0.1, specular: 1 };
  const towerGlow = [
    { color: [0.03, 0.8, 1, 1], metallic: 0.1, roughness: 0.2, specular: 1, emissive_factor: [0.04, 3.5, 7] },
    { color: [1, 0.05, 0.35, 1], metallic: 0.1, roughness: 0.2, specular: 1, emissive_factor: [7, 0.03, 1.2] },
    { color: [0.08, 1, 0.22, 1], metallic: 0.1, roughness: 0.2, specular: 1, emissive_factor: [0.2, 5, 0.55] },
    { color: [1, 0.34, 0.06, 1], metallic: 0.1, roughness: 0.2, specular: 1, emissive_factor: [6, 1.4, 0.08] }
  ];
  for (let index = 0; index < 18; index++) {
    const angle = index / 18 * Math.PI * 2;
    const radius = index % 2 ? 27 : 23;
    const height = 3.5 + (index % 5) * 1.8;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const towerShape = createPrimitiveShape(gpu,
      Primitive.cuboid(2.4, height, 2.4), towerMaterial, `tower-${index}`);
    const tower = space.addNode(null, `tower-${index}`);
    tower.setPosition(x, height * 0.5 - 0.25, z);
    tower.addShape(towerShape);
    shapes.push(towerShape);
    const capShape = createPrimitiveShape(gpu,
      Primitive.cuboid(2.45, 0.08, 2.45), towerGlow[index % towerGlow.length], `tower-cap-${index}`);
    const cap = space.addNode(null, `tower-cap-${index}`);
    cap.setPosition(x, height - 0.22, z);
    cap.addShape(capShape);
    shapes.push(capShape);
  }

  createCitySkyline(gpu, space, shapes, -0.3);

  const prototypes = {
    body: createPrimitiveShape(gpu, Primitive.cuboid(1.5, 0.65, 2.25), railMaterial, "car-body-prototype"),
    nose: createPrimitiveShape(gpu, Primitive.cuboid(1.28, 0.45, 0.75), railMaterial, "car-nose-prototype"),
    glow: createPrimitiveShape(gpu, Primitive.cuboid(1.25, 0.08, 1.85), carGlowMaterial, "car-glow-prototype"),
    wheel: createPrimitiveShape(gpu, Primitive.sphere(0.22, 12, 16), railMaterial, "car-wheel-prototype"),
    handrailSide: createPrimitiveShape(gpu, Primitive.prism(0.95, 0.035, 12), railMaterial,
      "car-handrail-side-prototype"),
    handrailEnd: createPrimitiveShape(gpu, Primitive.prism(0.62, 0.035, 12), railMaterial,
      "car-handrail-end-prototype"),
    handrailPost: createPrimitiveShape(gpu, Primitive.prism(0.09, 0.03, 12), railMaterial,
      "car-handrail-post-prototype")
  };
  shapes.push(...Object.values(prototypes));
  const cars = [];
  for (let index = 0; index < 4; index++) cars.push(createCar(space, gpu, prototypes, index, nodes, shapes));

  let routeProgress = 0.015;
  let elapsed = 0;
  let speedScale = 1;
  let paused = false;
  let lastSample = sampleCourse(routeProgress, courseControlPoints);
  let variationRandomState = 0x2e0c0571;
  let lastCompletedBoundary = Math.floor(
    (routeProgress - (cars.length - 1) * CAR_PARAMETER_GAP) * CONTROL_POINT_COUNT
  );
  let geometryRefreshElapsed = 0;
  const dirtyChunks = new Set();

  // 反復ごとに同じコース変化を再現できる乱数系列から制御点の移動量を決める
  function nextVariationRandom() {
    variationRandomState = (Math.imul(variationRandomState, 1664525) + 1013904223) >>> 0;
    return variationRandomState / 4294967296;
  }

  // 一つのCatmull–Rom制御点が形を変える4チャンクをdirty集合へ登録する
  function markControlPointInfluence(pointIndex) {
    for (const spanOffset of [-2, -1, 0, 1]) {
      const affectedSpan = (pointIndex + spanOffset + CONTROL_POINT_COUNT) % CONTROL_POINT_COUNT;
      dirtyChunks.add(Math.floor(affectedSpan / SPLINE_SPANS_PER_CHUNK));
    }
  }

  // 基準点の姿勢を使って、更新後も範囲内に収まる左右・高さ目標を設定する
  function beginControlPointChange(pointIndex) {
    const current = courseControlPoints[pointIndex];
    const base = initialControlPoints[pointIndex];
    const frame = sampleCourse(pointIndex / CONTROL_POINT_COUNT, initialControlPoints);
    const lateral = (nextVariationRandom() * 2 - 1) * CONTROL_POINT_LATERAL_RANGE;
    const vertical = (nextVariationRandom() * 2 - 1) * CONTROL_POINT_VERTICAL_RANGE;
    const target = add3(base, add3(scale3(frame.side, lateral), scale3(frame.up, vertical)));
    controlPointTransitions[pointIndex] = {
      start: [...current],
      target,
      elapsed: 0
    };
    markControlPointInfluence(pointIndex);
  }

  // 制御点をsmoothstepで移動させ、曲線の影響範囲にある4区間を再描画対象にする
  function advanceControlPointChanges(deltaSec) {
    let finishedChange = false;
    for (let pointIndex = 0; pointIndex < controlPointTransitions.length; pointIndex++) {
      const transition = controlPointTransitions[pointIndex];
      if (!transition) continue;
      transition.elapsed = Math.min(VARIATION_SECONDS, transition.elapsed + deltaSec);
      const linear = transition.elapsed / VARIATION_SECONDS;
      const blend = linear * linear * (3 - 2 * linear);
      courseControlPoints[pointIndex] = [0, 1, 2].map(axis =>
        transition.start[axis] + (transition.target[axis] - transition.start[axis]) * blend
      );
      markControlPointInfluence(pointIndex);
      if (linear >= 1) {
        controlPointTransitions[pointIndex] = null;
        finishedChange = true;
      }
    }
    return finishedChange;
  }

  // 更新が重ならない短い間隔でdirty区間だけ再生成し、他区間のGPU形状を維持する
  function refreshDirtyChunks(deltaSec, force = false) {
    if (dirtyChunks.size === 0) return;
    geometryRefreshElapsed += deltaSec;
    if (!force && geometryRefreshElapsed < GEOMETRY_REFRESH_SECONDS) return;
    for (const chunkIndex of dirtyChunks) rebuildTrackChunk(chunkIndex);
    dirtyChunks.clear();
    geometryRefreshElapsed = 0;
  }

  // 最後尾が現在区間へ入った時、影響する4スパンが全て後方となる2点後ろの制御点を変える
  function update(deltaSec) {
    if (!paused) {
      elapsed += deltaSec;
      routeProgress += deltaSec * 0.030 * speedScale;
      const tailProgress = routeProgress - (cars.length - 1) * CAR_PARAMETER_GAP;
      const completedBoundary = Math.floor(tailProgress * CONTROL_POINT_COUNT);
      while (lastCompletedBoundary < completedBoundary) {
        lastCompletedBoundary++;
        if (lastCompletedBoundary % CONTROL_POINT_UPDATE_INTERVAL_SPANS === 0) {
          const pointIndex = ((lastCompletedBoundary - CONTROL_POINT_TRAILING_SPANS)
            % CONTROL_POINT_COUNT + CONTROL_POINT_COUNT) % CONTROL_POINT_COUNT;
          beginControlPointChange(pointIndex);
        }
      }
      const finishedChange = advanceControlPointChanges(deltaSec);
      refreshDirtyChunks(deltaSec, finishedChange);
    }
    for (let index = 0; index < cars.length; index++) {
      const sample = sampleCourse(routeProgress - index * CAR_PARAMETER_GAP, courseControlPoints);
      cars[index].setByMatrix(makeCoursePose(sample));
    }
    lastSample = sampleCourse(routeProgress, courseControlPoints);
    return lastSample;
  }

  update(0);
  return {
    nodes,
    getNode: id => {
      const node = nodes.get(String(id));
      if (!node) throw new Error(`neon_coaster node is unavailable: ${id}`);
      return node;
    },
    update,
    getLeadSample: () => lastSample,
    getSpeedScale: () => speedScale,
    setSpeedScale: value => { speedScale = value; },
    isPaused: () => paused,
    setPaused: value => { paused = value === true; },
    getElapsed: () => elapsed,
    destroy: () => {
      for (let index = shapes.length - 1; index >= 0; index--) shapes[index].destroy();
      shapes.length = 0;
    }
  };
}
