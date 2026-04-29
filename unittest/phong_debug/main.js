// ---------------------------------------------
// unittest/phong_debug/main.js  2026/04/10
//   phong_debug sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import SmoothShader from "../../webg/SmoothShader.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Space from "../../webg/Space.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";
import {
  buildImageNormalMap,
  createTwoBoneSkinnedTube,
  loadTexture,
  setProjection
} from "../_shared/SkinningTestUtils.js";

// webgクラスの役割:
// UnitTestApp  : Screen 初期化、viewport 追従、status / error 表示を共通化
// SmoothShader : static / skinning / normal map / backface_debug を 1 本で確認する
// Primitive    : revolution 系の筒と折れ板の基礎 mesh を生成する
// Shape        : shader ごとに別材質を持つ描画単位を保持する
// Space        : 複数の描画対象を一つの camera で並べて観察する

const MOTION_SPEED = 0.00055;

const makeFoldedPanel = (gpu, shader, texture) => {
  const shape = new Shape(gpu);
  shape.setShader(shader);
  // この形は 2 枚の板を少し折り曲げてつないだものにする
  // 片側は正面、反対側は裏面が見えやすく、backface_debug の確認に向く
  shape.setTextureMappingMode(1);
  const verts = [
    [-7.0, -3.0, 0.0, 0.0, 1.0],
    [0.0, -3.0, 2.4, 0.5, 1.0],
    [0.0, 3.0, 2.4, 0.5, 0.0],
    [-7.0, 3.0, 0.0, 0.0, 0.0],
    [0.0, -3.0, 2.4, 0.5, 1.0],
    [7.0, -3.0, -2.0, 1.0, 1.0],
    [7.0, 3.0, -2.0, 1.0, 0.0],
    [0.0, 3.0, 2.4, 0.5, 0.0]
  ];
  for (const v of verts) {
    shape.addVertexUV(v[0], v[1], v[2], v[3], v[4]);
  }
  shape.addPlane([0, 1, 2, 3]);
  shape.addPlane([4, 5, 6, 7]);
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 1,
    texture,
    color: [1.0, 1.0, 1.0, 1.0],
    ambient: 0.30,
    specular: 0.80,
    power: 44.0,
    emissive: 0.0
  });
  return shape;
};

const makeNormalMapTube = (gpu, shader, texture, normalTexture) => {
  const shape = new Shape(gpu);
  shape.setShader(shader);
  // revolution 系の筒で、normal map と backface_debug を同時に確認する
  // Y 軸方向の直線を回して作るので、上下が塞がらない筒として扱える
  // webg の UV は左下原点なので、見え方を合わせるため V を内部補正する
  shape.applyPrimitiveAsset(
    Primitive.revolution(1, 32, [4.8, 12.0, 4.8, -12.0], false, {
      ...shape.getPrimitiveOptions(),
      flipV: true
    })
  );
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 1,
    texture,
    use_normal_map: 1,
    normal_texture: normalTexture,
    normal_strength: 1.0,
    color: [1.0, 1.0, 1.0, 1.0],
    ambient: 0.28,
    specular: 0.90,
    power: 52.0,
    emissive: 0.0
  });
  return shape;
};

const makeSkinnedTube = (gpu, shader, texture, normalTexture, weightDebug, useNormalMap) => {
  const { shape, skeleton, j0, j1 } = createTwoBoneSkinnedTube(gpu, { flipV: true });
  shape.setShader(shader);
  shape.setMaterial("smooth-shader", {
    has_bone: 1,
    use_texture: 1,
    texture,
    color: [1.0, 1.0, 1.0, 1.0],
    ambient: 0.35,
    specular: 0.80,
    power: 40.0,
    emissive: 0.0,
    weight_debug: weightDebug ? 1 : 0,
    use_normal_map: useNormalMap ? 1 : 0,
    normal_texture: useNormalMap ? normalTexture : null,
    normal_strength: useNormalMap ? 1.0 : 0.0
  });
  skeleton.showBone(false);
  return { shape, skeleton, j0, j1 };
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop }) => {
  const foldedShader = new SmoothShader(gpu, { backfaceDebug: true });
  await foldedShader.init();
  const normalMapShader = new SmoothShader(gpu, { backfaceDebug: true });
  await normalMapShader.init();
  const skinnedShader = new SmoothShader(gpu, { backfaceDebug: true });
  await skinnedShader.init();
  const skinnedNormalShader = new SmoothShader(gpu, { backfaceDebug: true });
  await skinnedNormalShader.init();

  foldedShader.setLightPosition([0.0, 30.0, 48.0, 1.0]);
  normalMapShader.setLightPosition([0.0, 30.0, 48.0, 1.0]);
  skinnedShader.setLightPosition([0.0, 30.0, 48.0, 1.0]);
  skinnedNormalShader.setLightPosition([0.0, 30.0, 48.0, 1.0]);

  setViewportLayout(() => {
    setProjection(screen, foldedShader, 52);
    setProjection(screen, normalMapShader, 52);
    setProjection(screen, skinnedShader, 52);
    setProjection(screen, skinnedNormalShader, 52);
  });

  const { texture, rgba, width, height } = await loadTexture(gpu, "../../webg/num256.png");
  const normalTexture = await buildImageNormalMap(gpu, rgba, width, height);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 0.0, 58.0);

  const foldedPanel = space.addNode(null, "foldedPanel");
  const normTube = space.addNode(null, "normTube");
  const skinnedBasicNode = space.addNode(null, "skinnedBasicNode");
  const skinnedWeightNode = space.addNode(null, "skinnedWeightNode");
  const skinnedNormalNode = space.addNode(null, "skinnedNormalNode");

  foldedPanel.addShape(makeFoldedPanel(gpu, foldedShader, texture));
  normTube.addShape(makeNormalMapTube(gpu, normalMapShader, texture, normalTexture));

  const skinnedRig = makeSkinnedTube(
    gpu,
    skinnedShader,
    texture,
    null,
    false,
    false
  );
  skinnedBasicNode.addShape(skinnedRig.shape);
  const skinnedNormalRig = makeSkinnedTube(
    gpu,
    skinnedNormalShader,
    texture,
    normalTexture,
    false,
    true
  );
  const skinnedWeightRig = makeSkinnedTube(
    gpu,
    skinnedNormalShader,
    texture,
    normalTexture,
    true,
    true
  );
  skinnedNormalNode.addShape(skinnedNormalRig.shape);
  skinnedWeightNode.addShape(skinnedWeightRig.shape);

  foldedPanel.setPosition(-18.0, 14.0, 0.0);
  normTube.setPosition(18.0, 14.0, 0.0);
  skinnedBasicNode.setPosition(-18.0, -10.0, 0.0);
  skinnedWeightNode.setPosition(0.0, -10.0, 0.0);
  skinnedNormalNode.setPosition(18.0, -10.0, 0.0);

  foldedPanel.setAttitude(24.0, 18.0, -12.0);
  normTube.setAttitude(18.0, 18.0, 0.0);
  skinnedBasicNode.setAttitude(10.0, -20.0, 0.0);
  skinnedWeightNode.setAttitude(10.0, -20.0, 0.0);
  skinnedNormalNode.setAttitude(10.0, -20.0, 0.0);

  space.scanSkeletons();

  let frame = 0;
  startLoop((timeMs) => {
    const phase = timeMs * MOTION_SPEED;

    foldedPanel.rotateY(0.20);
    foldedPanel.rotateZ(0.06);
    normTube.rotateY(0.18);
    normTube.rotateX(0.05);

    skinnedRig.j0.setAttitude(0.0, Math.sin(phase * 0.7) * 12.0, 0.0);
    skinnedRig.j1.setAttitude(0.0, 0.0, Math.sin(phase) * 58.0);
    skinnedWeightRig.j0.setAttitude(0.0, Math.sin(phase * 0.7) * 12.0, 0.0);
    skinnedWeightRig.j1.setAttitude(0.0, 0.0, Math.sin(phase) * 58.0);
    skinnedNormalRig.j0.setAttitude(0.0, Math.sin(phase * 0.7) * 12.0, 0.0);
    skinnedNormalRig.j1.setAttitude(0.0, 0.0, Math.sin(phase) * 58.0);

    screen.clear();
    space.draw(eye);
    screen.present();

    frame += 1;
    setStatus(
      "unittest/phong_debug\n"
      + "SmoothShader folded panel: backface_debug = ON, has_bone = 0\n"
      + "SmoothShader tube: backface_debug = ON, normal map = ON, has_bone = 0\n"
      + "SmoothShader left: backface_debug = ON, has_bone = 1\n"
      + "SmoothShader center: backface_debug = ON, normal map = ON, weight_debug = ON, has_bone = 1\n"
      + "SmoothShader right: backface_debug = ON, normal map = ON, has_bone = 1\n"
      + "texture: num256.png\n"
      + `frame=${frame}`
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.07, 0.09, 0.13, 1.0]
}, (app) => {
  return start(app);
});
