// ---------------------------------------------
// unittest/cube_axes/main.js  2026/04/10
//   Cube demo: hardcoded by addVertex/addPlane
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp: Screen 初期化、viewport 追従、status / error 表示を共通化
// Space  : カメラ(Node)と立方体(Node)の階層管理
// Shape  : addVertex/addPlane で面メッシュを構築
// SmoothShader: 立方体面の陰影計算
// Matrix : 投影行列生成

const setProjection = (screen, shader, angle = 45) => {
  // 透視投影行列を設定する
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const createFace = (gpu, vertices, color) => {
  // Shapeを1面単位で作るaddVertex/addPlaneだけで立方体を構成する
  const s = new Shape(gpu);
  for (let i = 0; i < 4; i++) {
    const v = vertices[i];
    s.addVertex(v[0], v[1], v[2]);
  }
  s.addPlane([0, 1, 2, 3]);
  s.endShape();
  s.setMaterial("smooth-shader", {
    has_bone: 0,
    color,
    ambient: 0.35,
    specular: 0.65,
    power: 24.0,
    emissive: 0
  });
  return s;
};

const createCubeFaces = (gpu) => {
  // 1辺2の立方体を6面に分けて、それぞれ別色で作る
  const n = -1.0;
  const p = 1.0;
  return [
    // +Z
    createFace(gpu, [[n, n, p], [p, n, p], [p, p, p], [n, p, p]], [1.0, 0.3, 0.3, 1.0]),
    // -Z
    createFace(gpu, [[p, n, n], [n, n, n], [n, p, n], [p, p, n]], [0.3, 1.0, 0.35, 1.0]),
    // +X
    createFace(gpu, [[p, n, p], [p, n, n], [p, p, n], [p, p, p]], [0.3, 0.6, 1.0, 1.0]),
    // -X
    createFace(gpu, [[n, n, n], [n, n, p], [n, p, p], [n, p, n]], [1.0, 0.9, 0.3, 1.0]),
    // +Y
    createFace(gpu, [[n, p, p], [p, p, p], [p, p, n], [n, p, n]], [0.95, 0.35, 1.0, 1.0]),
    // -Y
    createFace(gpu, [[n, n, n], [p, n, n], [p, n, p], [n, n, p]], [0.3, 1.0, 1.0, 1.0])
  ];
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop }) => {
  // SmoothShaderをShape既定シェーダとして使い、全ての面に同じ照明モデルを適用する
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => {
    setProjection(screen, shader, 48);
  });
  shader.setLightPosition([4, 5, 8, 1]);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, 0, 8);

  // 6面のShapeを1つのNodeへぶら下げ、1つの立方体として回す
  const cubeNode = space.addNode(null, "cube");
  const faces = createCubeFaces(gpu);
  for (let i = 0; i < faces.length; i++) {
    cubeNode.addShape(faces[i]);
  }

  startLoop((timeMs) => {
    // 2秒ごとに Y -> Z -> X 軸回転を切り替える
    const cycleSec = 2.0;
    const t = timeMs * 0.001;
    const block = Math.floor(t / cycleSec) % 3;
    const local = (t % cycleSec) / cycleSec;
    const deg = local * 360.0;

    if (block === 0) {
      // Y axis
      setStatus("unittest/cube_axes | Axis: Y");
      cubeNode.setAttitude(deg, 0, 0);
    } else if (block === 1) {
      // Z axis
      setStatus("unittest/cube_axes | Axis: Z");
      cubeNode.setAttitude(0, 0, deg);
    } else {
      // X axis
      setStatus("unittest/cube_axes | Axis: X");
      cubeNode.setAttitude(0, deg, 0);
    }

    screen.clear();
    space.draw(eye);
    screen.present();
  });
};

bootUnitTestApp({
  statusElementId: "axisLabel",
  initialStatus: "creating screen...",
  clearColor: [0.20, 0.20, 0.20, 1.0]
}, (app) => {
  return start(app);
});
