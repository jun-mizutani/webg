// ---------------------------------------------
// preview_contracts.js 2026/10/04
//   編集配置と試運転データの対応を、GPU生成の境界で確認する
// ---------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { SceneDefinition } from "../../../webg/app/index.js";
import { parseKarakuriDocument, stringifyKarakuriDocument } from "../../../samples/karakuri/scene_document.js";

const sceneUrl = new URL("../../../samples/karakuri/karakuri_scene.yaml", import.meta.url);
const initial = parseKarakuriDocument(readFileSync(sceneUrl, "utf8"), sceneUrl.href);
const source = readFileSync(new URL("../../../samples/karakuri/karakuri_maker.js", import.meta.url), "utf8");
const start = source.indexOf("async function rebuild3dPreview(");
const end = source.indexOf("\nfunction storeLocalScene(", start);
assert.ok(start >= 0 && end > start, "Makerの再構築処理を取得する");
const builds = [];
const errors = [];
const device = {};

// GPU描画とDOM表示の外部処理を置き換え、実際のMaker再構築処理をCPU上で実行する
function noop() {}

const context = createContext({
  state: initial,
  preview3dApp: null,
  preview3dBuildToken: 0,
  previewQueue: Promise.resolve(),
  previewPhysics: false,
  previewPaused: true,
  previewReady: true,
  previewEmitterVisuals: [],
  previewObjectEntries: new Map(),
  previewProceduralMaterials: new Map(),
  previewProceduralCache: {},
  viewMode: "3d",
  PREVIEW_CAMERA: {},
  SceneDefinition,
  parseKarakuriDocument,
  stringifyKarakuriDocument,
  document: { getElementById: () => ({ clientWidth: 960, clientHeight: 640 }) },
  cancelCameraInteraction: noop,
  clearPreviewProceduralMaterials: noop,
  resetPreviewRuntimeState: noop,
  render3dOverlay: noop,
  render: noop,
  updateCameraReturn: noop,
  handlePreviewContactSounds: noop,
  reportKarakuriTiming: noop,
  destroyPreviewProceduralMaterials: noop,
  setStatus: noop,
  statusElement: null,
  language: "ja",
  t: noop,
  console: { error: error => errors.push(error) },
  reportError: error => errors.push(error),
  // WebgSceneAppへ渡された作品データと物理の有効状態を記録する
  createWebgSceneApp: async options => {
    builds.push({ manifest: structuredClone(options.project.manifest), physics: options.physics });
    return {
      scene: { entries: [] },
      app: { getGPU: () => ({ device }), updateProjection: noop },
      physics: options.physics || null,
      start: noop,
      setPaused: noop,
      destroy: noop
    };
  },
  // 描画境界の確認に集中するため、材質生成を空の結果で完了させる
  prepareKarakuriProceduralMaterials: async () => ({ materials: new Map() }),
  // 同じ再構築で、発射台の表示にも最新の位置が渡ることを記録する
  createKarakuriEmitterVisual: (_app, _manifest, emitter) => structuredClone(emitter)
});
runInContext(source.slice(start, end), context);

// ドラッグと回転と同じように編集manifestを更新し、試運転・編集復帰・再試運転を繰り返す
async function checkRebuild(usePhysics, position, roll, spawnPosition) {
  const object = context.state.manifest.objects.find(entry => entry.id === "ramp");
  object.transform.position = [...position];
  object.transform.orientation = { pitch: 0, yaw: 0, roll };
  context.state.manifest.emitters[0].spawnPosition = [...spawnPosition];
  const edited = structuredClone(context.state.manifest);
  await context.rebuild3dPreview(usePhysics);
  assert.deepEqual(errors, [], "再構築が正常に完了する");
  const built = builds.at(-1);
  const ramp = built.manifest.objects.find(entry => entry.id === "ramp");
  assert.deepEqual(ramp.transform.position, position, "移動した配置を描画と物理へ渡す");
  assert.equal(ramp.transform.orientation.roll, roll, "回転も描画と物理へ渡す");
  assert.equal(Boolean(built.physics), usePhysics);
  assert.deepEqual(context.previewEmitterVisuals[0].spawnPosition, spawnPosition, "発射台の表示を更新する");
  assert.deepEqual(context.state.emitters[0].spawnPosition, spawnPosition, "試運転の発射位置を更新する");
  assert.deepEqual(context.state.manifest, edited, "再構築後も編集配置を保持する");
  assert.equal(context.previewReady, true);
}

try {
  await checkRebuild(true, [-1.2, 2.1, 0], -15, [-2, 3.1, 0]);
  await checkRebuild(false, [-1.2, 2.1, 0], -15, [-2, 3.1, 0]);
  await checkRebuild(true, [1.3, 1.7, 0], 20, [2, 2.6, 0]);
  await checkRebuild(true, [1.3, 1.7, 0], 20, [2, 2.6, 0]);
  console.log("PASS Karakuriの移動・回転・発射位置を、ためす・なおす・再試運転へ引き継ぐ");
} finally {
  context.state.project.destroy();
  context.preview3dApp?.destroy();
}
