// ---------------------------------------------
// unittest/smooth_shader/main.js  2026/04/15
//   smooth_shader sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import SmoothShader from "../../webg/SmoothShader.js";
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
// UnitTestApp       : Screen 初期化、viewport 追従、status / error 表示を共通化
// SmoothShader      : static / skinned / normal map / flat shading の 5 経路を 1 本で描く統合 surface shader
// Primitive / Shape : static mesh を最小構成で作り、統合 shader の non-bone 経路を確認する
// SkinningTestUtils : 2 ボーン prism、normal map 生成、debugBone 生成を共通化する
// Space             : 5 つの比較対象と debugBone 表示をまとめて描画する

const BEND_SPEED = 0.0005;
const STATIC_ROTATE_X = 0.28;
const STATIC_ROTATE_Y = 0.42;
const STATIC_FLAT_ROTATE_Y = 0.35;

const createStaticShape = (gpu, texture, normalTexture, options = {}) => {
  const {
    useNormalMap = false,
    flatShading = false,
    color = [1.0, 1.0, 1.0, 1.0],
    asset = null
  } = options;
  // static mesh 側は比較したい見え方ごとに asset を差し替え、
  // has_bone = 0 でも SmoothShader が通常 mesh / flat shading / normal map をそのまま描けるかを確認する
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(asset ?? Primitive.mapCube(14));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    flat_shading: flatShading ? 1 : 0,
    use_texture: 1,
    texture,
    use_normal_map: useNormalMap ? 1 : 0,
    normal_texture: useNormalMap ? normalTexture : null,
    normal_strength: 1.0,
    color,
    ambient: 0.26,
    specular: 0.84,
    power: 44.0,
    emissive: 0.0
  });
  return shape;
};

const createSkinnedShape = (gpu, texture, normalTexture, useNormalMap, color) => {
  // skinned mesh 側は 2 ボーン prism に固定し、
  // normal map の有無と bone palette 分離後の経路だけを見やすくする
  const rig = createTwoBoneSkinnedPrism(gpu, {
    flipU: true,
    radius: 4.0,
    yMin: -15.0,
    yMax: 15.0
  });
  rig.shape.setMaterial("smooth-shader", {
    has_bone: 1,
    use_texture: 1,
    texture,
    use_normal_map: useNormalMap ? 1 : 0,
    normal_texture: useNormalMap ? normalTexture : null,
    normal_strength: 1.0,
    color,
    ambient: 0.35,
    specular: 0.8,
    power: 40.0,
    emissive: 0.0
  });
  return rig;
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  shader.setLightPosition([0.0, 30.0, 48.0, 1.0]);

  const debugShader = new SmoothShader(gpu);
  await debugShader.init();
  debugShader.setLightPosition([0.0, 30.0, 48.0, 1.0]);

  setViewportLayout(() => {
    setProjection(screen, shader, 52);
    setProjection(screen, debugShader, 52);
  });

  const { texture, rgba, width, height } = await loadTextureFlipX(gpu, "../../webg/num256.png");
  const normalTexture = await buildImageNormalMap(gpu, rgba, width, height);
  const sharedSphereAsset = Primitive.sphere(10, 12, 12);

  const staticPlainShape = createStaticShape(gpu, texture, normalTexture, {
    useNormalMap: false,
    flatShading: false,
    asset: sharedSphereAsset,
    color: [0.94, 0.70, 0.58, 1.0]
  });
  const staticFlatShape = createStaticShape(gpu, texture, normalTexture, {
    useNormalMap: false,
    flatShading: true,
    asset: sharedSphereAsset,
    color: [0.90, 0.74, 0.50, 1.0]
  });
  const staticNormalShape = createStaticShape(gpu, texture, normalTexture, {
    useNormalMap: true,
    flatShading: false,
    color: [0.62, 0.82, 0.96, 1.0]
  });
  const skinnedPlainRig = createSkinnedShape(gpu, texture, normalTexture, false, [0.95, 0.68, 0.48, 1.0]);
  const skinnedNormalRig = createSkinnedShape(gpu, texture, normalTexture, true, [0.58, 0.86, 0.92, 1.0]);

  skinnedPlainRig.skeleton.setBoneShape(createDebugBoneShape(gpu, debugShader, 0.55));
  skinnedNormalRig.skeleton.setBoneShape(createDebugBoneShape(gpu, debugShader, 0.55));
  skinnedPlainRig.skeleton.showBone(true);
  skinnedNormalRig.skeleton.showBone(true);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, -1.5, 70.0);
  eye.setAttitude(0.0, 4.0, 0.0);

  const staticPlainNode = space.addNode(null, "staticPlain");
  staticPlainNode.setPosition(-24.0, 16.0, 0.0);
  staticPlainNode.addShape(staticPlainShape);

  const staticFlatNode = space.addNode(null, "staticFlat");
  staticFlatNode.setPosition(0.0, 16.0, 0.0);
  staticFlatNode.addShape(staticFlatShape);

  const staticNormalNode = space.addNode(null, "staticNormal");
  staticNormalNode.setPosition(24.0, 16.0, 0.0);
  staticNormalNode.addShape(staticNormalShape);

  const skinnedPlainNode = space.addNode(null, "skinnedPlain");
  skinnedPlainNode.setPosition(-14.0, -8.0, 0.0);
  skinnedPlainNode.setAttitude(45.0, 0.0, 0.0);
  skinnedPlainNode.addShape(skinnedPlainRig.shape);

  const skinnedNormalNode = space.addNode(null, "skinnedNormal");
  skinnedNormalNode.setPosition(14.0, -8.0, 0.0);
  skinnedNormalNode.setAttitude(45.0, 0.0, 0.0);
  skinnedNormalNode.addShape(skinnedNormalRig.shape);

  space.scanSkeletons();

  let paused = false;
  document.addEventListener("keydown", (event) => {
    if (event.key === " ") {
      paused = !paused;
    }
  });

  startLoop((timeMs) => {
    if (!paused) {
      const phase = timeMs * BEND_SPEED;
      staticPlainNode.rotateX(STATIC_ROTATE_X);
      staticPlainNode.rotateY(STATIC_FLAT_ROTATE_Y);
      staticFlatNode.rotateX(STATIC_ROTATE_X);
      staticFlatNode.rotateY(STATIC_FLAT_ROTATE_Y);
      staticNormalNode.rotateX(STATIC_ROTATE_X);
      staticNormalNode.rotateY(STATIC_ROTATE_Y);
      skinnedPlainRig.j0.setAttitude(0.0, Math.sin(phase * 0.7) * 8.0, 0.0);
      skinnedPlainRig.j1.setAttitude(0.0, 0.0, Math.sin(phase) * 60.0);
      skinnedNormalRig.j0.setAttitude(0.0, Math.sin(phase * 0.7) * 8.0, 0.0);
      skinnedNormalRig.j1.setAttitude(0.0, 0.0, Math.sin(phase) * 60.0);
    }

    screen.clear();
    space.draw(eye);
    screen.clearDepthBuffer();
    space.drawBones();
    screen.present();

    setStatus(
      "unittest/smooth_shader\n"
      //+ `paused: ${paused ? "yes" : "no"}\n`
      //+ "shader: SmoothShader (single surface shader)\n"
      //+ "top-left: shared-vertex sphere + texture\n"
      //+ "top-center: shared-vertex sphere + texture + flat_shading\n"
      //+ "top-right: static + texture + normal map\n"
      //+ "bottom-left: skinned + texture\n"
      //+ "bottom-right: skinned + texture + normal map\n"
      //+ "base tex: num256.png\n"
      + "normal map: image luma strength=2.0\n"
      //+ "[space] pause/resume"
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.62, 0.64, 0.68, 1.0]
}, (app) => {
  return start(app);
});
