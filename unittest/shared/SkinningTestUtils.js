// ---------------------------------------------
// unittest/shared/SkinningTestUtils.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Matrix from "../../webg/Matrix.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Skeleton from "../../webg/Skeleton.js";
import Texture from "../../webg/Texture.js";

// unittest 用の最小 helper:
// - SmoothShader のボーン変形と画像法線の比較に使う形状・テクスチャを準備する
// - geometry 自体や描画条件は簡素に保ち、shader 切替による差を見やすくする

// 比較用の画面寸法から透視投影を作り、スキニングの各表示に同じ視野を設定する
export const setProjection = (screen, shader, angle = 53) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

// 画像を左右反転してRGBAへ変換し、GPUテクスチャとCPU側の参照画素を返す
export const loadTextureFlipX = async (gpu, url) => {
  // テクスチャの表示向きを基準画像に合わせるため、`num256.png` は左右反転して取り込む
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

// 元画像の向きを保ったRGBAを読み込み、GPUテクスチャと法線生成用の参照画素を返す
export const loadTexture = async (gpu, url) => {
  // 元画像の向きをそのまま使って比較したい場合はこちらを使う
  // webgのUVは左下原点であり、比較画像は元の上下の向きを保って読み込む
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

// ベース画像の輝度から法線テクスチャを生成し、元画像と同じUVで陰影を比較する
export const buildImageNormalMap = async (gpu, rgba, width, height, options = {}) => {
  // ベース画像の輝度からnormal mapを作り、
  // SmoothShaderのボーン変形に画像法線の陰影が追従することを確認する
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

// 2ボーンと頂点の重みを持つ筒状メッシュを作り、面と線の変形を比較する
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
      // geometry 側の U も反転し、画像の表示向きを基準画像に揃える
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
      // triangleの頂点順序を揃え、表面の向きを一定に保つ
      // ここが逆だと auto normal が内向きになり、skinning + normal map の
      // 凹凸が static mesh と逆に見えやすくなる
      shape.addTriangle(r0 + j, r0 + j1i, r1 + j);
      shape.addTriangle(r0 + j1i, r1 + j1i, r1 + j);
    }
  }

  shape.endShape();
  return { shape, skeleton, j0, j1 };
};

// 端を開いた2ボーンの筒を作り、内外の表示と法線の追従を確認する
export const createTwoBoneSkinnedTube = (gpu, options = {}) => {
  // revolution 系の筒を skinned mesh として扱う最小構成を作る
  // 上下を開いた側面メッシュで、内外の表示とnormal mapを比較する
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
      // tube は上リングから下リングへ頂点を作るため、bottom-to-top に積む prism と同じ
      // triangle 順序を使うと winding が反転し、auto normal が内向きになる
      // backface_debug ではこの差がマゼンタの裏面表示として出るので、ring の進行方向に合わせて
      // quad の 2 triangle を反対順にし、筒の外側が正面になるよう固定する
      shape.addTriangle(r0 + j, r1 + j, r0 + j1i);
      shape.addTriangle(r0 + j1i, r1 + j, r1 + j1i);
    }
  }

  shape.endShape();
  return { shape, skeleton, j0, j1 };
};

// 骨の位置と方向を示す小さな目印を作り、メッシュの曲がりと比較する
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
