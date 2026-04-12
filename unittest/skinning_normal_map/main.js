// -------------------------------------------------
// skinning_normal_map sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import SmoothShader from "../../webg/SmoothShader.js";
import Shape from "../../webg/Shape.js";
import Space from "../../webg/Space.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";
import {
  buildImageNormalMap,
  createDebugBoneShape,
  createTwoBoneSkinnedPrism,
  loadTextureFlipX,
  setProjection
} from "../_shared/SkinningTestUtils.js";

// webgクラスの役割:
// UnitTestApp          : Screen 初期化、viewport 追従、status / error 表示を共通化
// SmoothShader         : skinning + normal map の統合 shader 経路を最小確認する
// SmoothShader         : debugBone 表示も同じ shader class で描く
// SkinningTestUtils    : texture 読み込み、2 ボーン shape、normal map 生成を薄く共通化
// Space                : eye、skinned mesh、bone 表示の描画順を管理する

const BEND_SPEED = 0.0005;
const OBJECT_HEAD_DEG = 45.0;
const ROOT_YAW_DEG = 8.0;
const CHILD_BEND_DEG = 60.0;

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  shader.setLightPosition([0, 30, 40, 1]);

  const boneShader = new SmoothShader(gpu);
  await boneShader.init();
  boneShader.setLightPosition([0, 30, 40, 1]);

  setViewportLayout(() => {
    setProjection(screen, shader, 53);
    setProjection(screen, boneShader, 53);
  });

  const { texture, rgba, width, height } = await loadTextureFlipX(gpu, "../../webg/num256.png");
  const normalTexture = await buildImageNormalMap(gpu, rgba, width, height);
  const { shape, skeleton, j0, j1 } = createTwoBoneSkinnedPrism(gpu, { flipU: true });
  shape.setMaterial("smooth-shader", {
    has_bone: 1,
    use_texture: 1,
    texture,
    use_normal_map: 1,
    normal_texture: normalTexture,
    normal_strength: 1.0,
    color: [1.0, 1.0, 1.0, 1.0],
    ambient: 0.35,
    specular: 0.8,
    power: 40.0,
    emissive: 0.0
  });

  skeleton.setBoneShape(createDebugBoneShape(gpu, boneShader, 0.6));
  skeleton.showBone(true);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, -3, 35);

  const node = space.addNode(null, "objNode");
  node.addShape(shape);
  // normal map 付きでもボーンの重なりを避けて見やすくするため、
  // object 全体を Y 軸へ 45 度振った状態から観察する
  node.setAttitude(OBJECT_HEAD_DEG, 0.0, 0.0);

  space.scanSkeletons();

  startLoop((timeMs) => {
    // normal map 付きの unittest でも、変形量自体は左右対称にそろえ、
    // 片側へ偏った姿勢ではなく正負の両方向で陰影が破綻しないかを見やすくする
    // 速度も半分へ落として、ハイライトと seam の追従を目で追いやすくする
    const phase = timeMs * BEND_SPEED;
    j0.setAttitude(0.0, Math.sin(phase * 0.7) * ROOT_YAW_DEG, 0.0);
    j1.setAttitude(0.0, 0.0, Math.sin(phase) * CHILD_BEND_DEG);

    screen.clear();
    space.draw(eye);
    screen.clearDepthBuffer();
    space.drawBones();
    screen.present();

    setStatus(
      "unittest/skinning_normal_map\n"
      + "shader: SmoothShader (has_bone=1, normal map=on)\n"
      + "mesh: two-bone prism\n"
      + "base tex: num256.png\n"
      + "normal map: luma strength=2.0\n"
      + "debug bones: on"
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.1, 0.15, 0.1, 1.0]
}, (app) => {
  return start(app);
});
