// -------------------------------------------------
// SkinningTestUtils.js
//   SkinningTestUtils.js 2026/04/15
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Matrix from "../../webg/Matrix.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Skeleton from "../../webg/Skeleton.js";
import Texture from "../../webg/Texture.js";

// unittest 用の最小 helper:
// - BonePhong / BoneNormPhong の shader 経路確認で共通になる処理だけを切り出す
// - geometry 自体や描画条件は簡素に保ち、shader 切替による差を見やすくする

export const setProjection = (screen, shader, angle = 53) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

export const loadTextureFlipX = async (gpu, url) => {
  // 既存 sample と同じ向きで比較できるよう、`num256.png` は左右反転して取り込む
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(bitmap, 0, 0);
  const rgba = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);

  const texture = new Texture(gpu);
  await texture.initPromise;
  texture.setImage(rgba, canvas.width, canvas.height, 4);
  texture.setRepeat();

  return {
    texture,
    rgba,
    width: canvas.width,
    height: canvas.height
  };
};

export const loadTexture = async (gpu, url) => {
  // 元画像の向きをそのまま使って比較したい場合はこちらを使う
  // webg の UV は左下原点なので、読み込んだ画像の上下をここで勝手に触らない
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const rgba = new Uint8Array(bitmap.width * bitmap.height * 4);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  rgba.set(imageData.data);

  const texture = new Texture(gpu);
  await texture.initPromise;
  texture.setImage(rgba, canvas.width, canvas.height, 4);
  texture.setRepeat();

  return {
    texture,
    rgba,
    width: canvas.width,
    height: canvas.height
  };
};

export const buildImageNormalMap = async (gpu, rgba, width, height, options = {}) => {
  // BoneNormPhong 側では、ベース画像そのものから normal map を作り、
  // 「法線マップ付き skinning shader が崩れないか」だけを素直に確認する
  const texture = new Texture(gpu);
  await texture.initPromise;
  await texture.buildNormalMapFromHeightMap({
    source: rgba,
    width,
    height,
    ncol: 4,
    channel: "luma",
    strength: 2.0,
    wrap: true,
    invertY: options.invertY ?? false
  });
  texture.setRepeat();
  return texture;
};

export const createTwoBoneSkinnedPrism = (gpu, options = {}) => {
  // 少数ボーン + 単純な円柱側面メッシュに絞り、
  // shader の skinning 経路が正常かどうかを観察しやすい形へ固定する
  const shape = new Shape(gpu);
  shape.setAutoCalcNormals(true);
  const skeleton = new Skeleton();
  shape.setSkeleton(skeleton);

  const j0 = skeleton.addBone(null, "j0");
  const j1 = skeleton.addBone(j0, "j1");
  const radius = options.radius ?? 2.0;
  const yMin = options.yMin ?? -10.0;
  const yMax = options.yMax ?? 10.0;
  j0.setRestPosition(0.0, yMin, 0.0);
  j1.setRestPosition(0.0, yMax, 0.0);
  skeleton.bindRestPose();
  skeleton.setBoneOrder(["j0", "j1"]);

  const rings = 16;
  const segments = 24;
  const height = yMax - yMin;
  const flipU = options.flipU ?? false;

  for (let i = 0; i <= rings; i++) {
    const y = yMin + (height * i) / rings;
    const t = (y - yMin) / height;
    for (let j = 0; j < segments; j++) {
      const u = j / segments;
      const angle = u * Math.PI * 2.0;
      const x = Math.cos(angle) * radius;
      // revolution 系と同じ回転方向にそろえ、法線の向きを筒の外側へ合わせる
      const z = -Math.sin(angle) * radius;
      // `loadTextureFlipX()` で画像を左右反転して取り込む unittest では、
      // geometry 側の U を反転して「見た目の画像向き」は従来と同じにそろえる
      const uCoord = flipU ? (1.0 - u) : u;
      const v = shape.addVertexUV(x, y, z, uCoord, 1.0 - (i / rings)) - 1;
      shape.addVertexWeight(v, 0, 1.0 - t);
      shape.addVertexWeight(v, 1, t);
    }
  }

  for (let i = 0; i < rings; i++) {
    const r0 = i * segments;
    const r1 = (i + 1) * segments;
    for (let j = 0; j < segments; j++) {
      const j1i = (j + 1) % segments;
      // 側面の外向き法線を維持するため、ring の進行方向に対して
      // triangle の winding を反転せず一定にそろえる
      // ここが逆だと auto normal が内向きになり、skinning + normal map の
      // 凹凸が static mesh と逆に見えやすくなる
      shape.addTriangle(r0 + j, r0 + j1i, r1 + j);
      shape.addTriangle(r0 + j1i, r1 + j1i, r1 + j);
    }
  }

  shape.endShape();
  return { shape, skeleton, j0, j1 };
};

export const createTwoBoneSkinnedTube = (gpu, options = {}) => {
  // revolution 系の筒を skinned mesh として扱う最小構成を作る
  // 側面だけを残し、上下面は閉じないことで裏面と normal map の両方を追いやすくする
  const shape = new Shape(gpu);
  shape.setAutoCalcNormals(true);
  const skeleton = new Skeleton();
  shape.setSkeleton(skeleton);

  const j0 = skeleton.addBone(null, "j0");
  const j1 = skeleton.addBone(j0, "j1");
  j0.setRestPosition(0.0, -10.0, 0.0);
  j1.setRestPosition(0.0, 10.0, 0.0);
  skeleton.bindRestPose();
  skeleton.setBoneOrder(["j0", "j1"]);

  const radius = 2.4;
  const rings = 16;
  const segments = 28;
  const yTop = 10.0;
  const yBottom = -10.0;
  const yMin = yBottom;
  const yMax = yTop;
  const height = yMax - yMin;
  const flipV = options.flipV ?? false;
  const flipU = options.flipU ?? false;

  for (let i = 0; i <= rings; i++) {
    const y = yTop - (height * i) / rings;
    const t = (y - yMin) / height;
    for (let j = 0; j < segments; j++) {
      const u = j / segments;
      const angle = u * Math.PI * 2.0;
      const x = Math.cos(angle) * radius;
      // revolution 系と同じ回転方向にそろえ、skinned tube の面向きを外側へ合わせる
      const z = -Math.sin(angle) * radius;
      // webg の UV は左下原点なので、必要に応じて V の上下を補正する
      const vCoord = flipV ? (i / rings) : (1.0 - (i / rings));
      // prism と同様に、画像入力側で左右反転した texture を使う経路では
      // geometry 側の U だけを反転して見た目の左右をそろえる
      const uCoord = flipU ? (1.0 - u) : u;
      const v = shape.addVertexUV(x, y, z, uCoord, vCoord) - 1;
      shape.addVertexWeight(v, 0, 1.0 - t);
      shape.addVertexWeight(v, 1, t);
    }
  }

  for (let i = 0; i < rings; i++) {
    const r0 = i * segments;
    const r1 = (i + 1) * segments;
    for (let j = 0; j < segments; j++) {
      const j1i = (j + 1) % segments;
      // prism と同様に、tube 側面の auto normal が常に外向きになるよう
      // quad を 2 triangle へ分ける順序をそろえる
      shape.addTriangle(r0 + j, r0 + j1i, r1 + j);
      shape.addTriangle(r0 + j1i, r1 + j1i, r1 + j);
    }
  }

  shape.endShape();
  return { shape, skeleton, j0, j1 };
};

export const createDebugBoneShape = (gpu, shader, size = 0.6) => {
  // メッシュ変形とボーン向きの一致を見やすくするため、最小の debugBone 表示を共通化する
  const boneShape = new Shape(gpu);
  boneShape.applyPrimitiveAsset(Primitive.debugBone(size, boneShape.getPrimitiveOptions()));
  boneShape.endShape();
  boneShape.setShader(shader);
  boneShape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [1.0, 0.5, 0.2, 1.0],
    ambient: 0.25,
    specular: 0.45,
    power: 24.0,
    emissive: 0.0
  });
  return boneShape;
};
