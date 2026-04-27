// -------------------------------------------------
// skinning_basic sample
//   main.js       2026/04/27
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import SmoothShader from "../../webg/SmoothShader.js";
import Shape from "../../webg/Shape.js";
import Space from "../../webg/Space.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";
import {
  createDebugBoneShape,
  createTwoBoneSkinnedPrism,
  loadTextureFlipX,
  setProjection
} from "../_shared/SkinningTestUtils.js";

// webgクラスの役割:
// UnitTestApp          : Screen 初期化、viewport 追従、status / error 表示を共通化
// SmoothShader         : 最小 Bone 経路の描画対象として使う統合 surface shader
// SmoothShader         : debugBone 表示も同じ shader class で描き、共通入口を確認する
// SkinningTestUtils    : texture 読み込み、2 ボーン shape、debugBone shape を薄く共通化
// Space                : eye、skinned mesh、bone 表示の描画順を管理する

const BEND_SPEED = 0.0005;
const OBJECT_HEAD_DEG = 45.0;
const ROOT_YAW_DEG = 8.0;
const CHILD_BEND_DEG = 60.0;

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
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

  const { texture } = await loadTextureFlipX(gpu, "../../webg/num256.png");
  const { shape, skeleton, j0, j1 } = createTwoBoneSkinnedPrism(gpu, { flipU: true });
  shape.setMaterial("smooth-shader", {
    has_bone: 1,
    use_texture: 1,
    texture,
    color: [1.0, 1.0, 1.0, 1.0],
    ambient: 0.35,
    specular: 0.8,
    power: 40.0,
    emissive: 0.0
  });

  skeleton.setBoneShape(createDebugBoneShape(gpu, boneShader, 0.6));
  skeleton.showBone(true);

  let wireframe = false;
  const setWireframeState = (enabled) => {
    // skinned mesh のまま Shape.setWireframe() を切り替え、
    // Wireframe shader が SmoothShader と同じ bone palette を受け取れることを確認する
    wireframe = !!enabled;
    shape.setWireframe(wireframe);
  };

  document.addEventListener("keydown", (event) => {
    // W は描画 shader だけを line-list 用へ差し替え、skeleton / animation / texture 状態は保持する
    // この unittest では skinned mesh の線がボーン変形に追従するかを最小手順で確認する
    if (event.key.toLowerCase() === "w") {
      setWireframeState(!wireframe);
    }
  });

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, -3, 35);

  const node = space.addNode(null, "objNode");
  node.addShape(shape);
  // ボーンの前後関係を見やすくするため、object 全体を Y 軸へ少し振ってから観察する
  node.setAttitude(OBJECT_HEAD_DEG, 0.0, 0.0);

  space.scanSkeletons();

  startLoop((timeMs) => {
    // 最小 unittest として「左右へ同量だけ曲がる」ことを見やすくするため、
    // root / child ともに 0 度中心の正弦波で姿勢を与える
    // 以前のように片側へ寄った初期角度や一方向の累積回転を使わず、
    // 正負の曲がり量が対称かどうかをそのまま観察できるようにする
    const phase = timeMs * BEND_SPEED;
    j0.setAttitude(0.0, Math.sin(phase * 0.7) * ROOT_YAW_DEG, 0.0);
    j1.setAttitude(0.0, 0.0, Math.sin(phase) * CHILD_BEND_DEG);

    screen.clear();
    space.draw(eye);
    screen.clearDepthBuffer();
    space.drawBones();
    screen.present();

    setStatus(
      "unittest/skinning_basic\n"
      + "shader: SmoothShader (has_bone=1, normal map=off)\n"
      + "mesh: two-bone prism\n"
      + "texture: num256.png\n"
      + `wireframe: ${wireframe ? "on" : "off"}\n`
      + "debug bones: on\n"
      + "observe: mesh follows bones smoothly\n"
      + "[w] toggle skinned wireframe"
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
