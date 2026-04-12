// -------------------------------------------------
// lowlevel_terrain sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import {
  buildFractalTerrain,
  buildTerrainBandTexturePixels
} from "../proceduralShapeBuilders.js";
import {
  setupProceduralSampleApp,
  showStartError
} from "../proceduralSampleRuntime.js";
import Shape from "../../webg/Shape.js";
import Texture from "../../webg/Texture.js";

const SAMPLE_ID = "lowlevel_terrain";
const SAMPLE_TITLE = "lowlevel_terrain";
const CAMERA_CONFIG = {
  target: [0.0, 0.2, 0.0],
  distance: 13.5,
  yaw: 32.0,
  pitch: -28.0,
  minDistance: 5.0,
  maxDistance: 30.0,
  wheelZoomStep: 1.2
};
const HELP_LINES = [
  "Low-level procedural shape sample",
  "Fractal terrain = vertex grid + noise height + addPlane() quad filling",
  "A height-band texture is generated from the same height field as the mesh",
  "A small erosion-style smoothing pass relaxes steep drops before meshing",
  "The height field is generated in code, then endShape() uploads the packed mesh to GPU",
  "Orbit close to inspect smooth normals, then zoom out to see the island silhouette",
  "Q / E: camera distance -/+  - / =: terrain relief -/+",
  "Drag: orbit  2-finger drag: pan  Pinch / wheel: zoom  R: reset view"
];
const MATERIAL = {
  use_texture: 0,
  color: [0.44, 0.76, 0.40, 1.0],
  ambient: 0.18,
  specular: 0.34,
  power: 18.0
};
const TERRAIN_PARAMS = {
  cols: 72,
  rows: 72,
  sizeX: 13.0,
  sizeZ: 13.0,
  octaves: 5,
  persistence: 0.54,
  lacunarity: 2.0,
  seed: 20260405,
  erosionIterations: 2,
  erosionStrength: 0.22,
  erosionTalus: 0.10
};
const state = {
  heightScale: 3.1,
  heightStep: 0.28,
  heightMin: 0.8,
  heightMax: 6.0,
  cameraStep: 1.0
};

// 地形の格子数と高さ範囲を status へ出し、grid 密度と silhouette の関係を読みやすくする
function makeStatusLines({ orbit, info }) {
  return [
    SAMPLE_TITLE,
    `relief heightScale: ${state.heightScale.toFixed(2)}`,
    `erosion iter/strength: ${info.erosionIterations} / ${info.erosionStrength.toFixed(2)}`,
    `rows / cols: ${info.rows} / ${info.cols}`,
    `vertices / quads: ${info.vertexCount} / ${info.quadCount}`,
    `height min/max: ${info.heightMin.toFixed(2)} / ${info.heightMax.toFixed(2)}  camera: ${orbit.orbit.distance.toFixed(1)}`
  ];
}

// terrain の初回生成と再生成で同じ builder を使い、parameter 差し替えを分かりやすくする
function createTerrainShape(gpu) {
  const shape = new Shape(gpu);
  const info = buildFractalTerrain(shape, {
    ...TERRAIN_PARAMS,
    heightScale: state.heightScale
  });
  return { shape, info };
}

// 同じ height field から高さ帯 texture を作り、mesh と色の source を一致させる
function updateTerrainColorTexture(colorTexture, terrainInfo) {
  const tex = buildTerrainBandTexturePixels(terrainInfo, {
    blendWidth: 0.16
  });
  colorTexture.setImage(tex.image, tex.width, tex.height, tex.ncol);
}

// 共有頂点の grid と fractal noise を組み合わせ、連続した terrain mesh を 1 枚で構築する
async function start() {
  let colorTexture = null;
  const runtime = await setupProceduralSampleApp({
    sampleId: SAMPLE_ID,
    title: SAMPLE_TITLE,
    document,
    clearColor: [0.05, 0.09, 0.08, 1.0],
    camera: CAMERA_CONFIG,
    helpLines: HELP_LINES,
    projectionFar: 260.0,
    lightPosition: [110.0, 170.0, 140.0, 1.0],
    fog: {
      color: [0.08, 0.13, 0.11],
      near: 22.0,
      far: 70.0,
      density: 0.0,
      mode: 0
    },
    material: MATERIAL,
    buildShape: (shape) => buildFractalTerrain(shape, {
      ...TERRAIN_PARAMS,
      heightScale: state.heightScale
    }),
    makeStatusLines,
    nodePosition: [0.0, -0.5, 0.0],
    // camera 距離と地形起伏量の変更はここで受け、
    // 起伏量が変わったときだけ terrain mesh と color texture を同時に作り直す
    onKeyDown: ({ key, orbit, app, replaceShape, updateStatus }) => {
      if (key === "q") {
        orbit.setDistance(orbit.orbit.distance - state.cameraStep);
        updateStatus();
        return;
      }
      if (key === "e") {
        orbit.setDistance(orbit.orbit.distance + state.cameraStep);
        updateStatus();
        return;
      }
      if (key !== "-" && key !== "=") {
        return;
      }

      const nextHeightScale = key === "-"
        ? Math.max(state.heightMin, state.heightScale - state.heightStep)
        : Math.min(state.heightMax, state.heightScale + state.heightStep);
      if (nextHeightScale === state.heightScale) {
        updateStatus();
        return;
      }

      state.heightScale = nextHeightScale;
      const next = createTerrainShape(app.getGL());
      replaceShape(next.shape, next.info);
      if (colorTexture) {
        updateTerrainColorTexture(colorTexture, next.info);
        next.shape.updateMaterial({
          use_texture: 1,
          texture: colorTexture,
          color: [1.0, 1.0, 1.0, 1.0],
          ambient: 0.18,
          specular: 0.34,
          power: 18.0
        });
      }
    }
  });

  app = runtime.app;

  // 起動直後の terrain 情報から高さ帯 texture を 1 回生成し、
  // その texture を現在の shape material へ結び付ける
  colorTexture = new Texture(app.getGL());
  await colorTexture.initPromise;
  updateTerrainColorTexture(colorTexture, runtime.info);
  runtime.shape.updateMaterial({
    use_texture: 1,
    texture: colorTexture,
    color: [1.0, 1.0, 1.0, 1.0],
    ambient: 0.18,
    specular: 0.34,
    power: 18.0
  });

  app.start({
    // terrain 自体は自動回転しないので、
    // 毎 frame では orbit camera の更新と status 再描画だけを行う
    onUpdate: ({ deltaSec }) => {
      runtime.orbit.update(deltaSec);
      runtime.updateStatus();
    }
  });
}

let app = null;

// DOM 準備完了後に sample を起動し、
// 失敗時は browser 上の固定 panel からも原因を読めるようにする
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error(`${SAMPLE_ID} failed:`, error);
    app?.showErrorPanel?.(error, {
      title: `${SAMPLE_ID} failed`,
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
    if (!app) {
      showStartError(SAMPLE_ID, error);
    }
  });
});
