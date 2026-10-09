// scene_document.js 2026/09/19
// SceneYAML原文・編集履歴・コア仕様による検証。Copyright (c) 2026 Jun Mizutani, MIT
import { parseSceneYAMLDocument, SceneDefinition } from "../../webg/app/index.js";
import { readPrimitiveDefinitions, readPrimitiveMaterialManifest } from "../../webg/app/PrimitiveScene.js";
import { validateMesh } from "./mesh_edit.js";

const CORE_KEYS = ["format", "version", "name", "objects", "objectSets", "materials", "physics", "renderer", "animations", "meshes"];

// 初回起動の作品を毎回同じ設定から作り、保存済みブラウザ状態には依存しない
export function initialManifest() {
  return {
    format: "webg-scene", version: 1, name: "my-scene",
    physics: { space: { gravity: [0, -9.80665, 0], fixedTimeStepMs: 1000 / 240, maxBodies: 128 } },
    materials: [
      { id: "blue", color: [0.12, 0.45, 0.8, 1], metallic: 0.25, roughness: 0.3, specular: 1 },
      { id: "floor", color: [0.3, 0.34, 0.4, 1], metallic: 0, roughness: 0.7, specular: 1 }
    ],
    objects: [
      { id: "floor", shape: { type: "box", size: [8, 0.2, 8] }, transform: { position: [0, -0.1, 0] }, material: "floor" },
      { id: "box", shape: { type: "box", size: [1, 1, 1] }, transform: { position: [0, 0.5, 0], orientation: [0, 0, 0] }, material: "blue" }
    ],
    renderer: { profile: "studio", width: 960, height: 640, environment: { preset: "dark-studio", resolution: { width: 128, height: 64 } } }
  };
}

// キーと値を引用し、再解析時にも文字列・数値・配列の型が一致するYAMLへ整形する
export function serialize(manifest, sourceDocument = null) {
  // 配列の各要素はflow表記で一行にし、独自parserでも一意に読める構文を使う
  const comments = (sourceDocument?.comments ?? [])
    .filter(comment => ![
      "SceneYAML — edit_yaml",
      "SceneYAML — preserved comments from the source document"
    ].includes(comment.text));
  const preserved = comments.length === 0 ? [] : [
    "# SceneYAML — preserved comments from the source document",
    ...comments.map(comment => comment.text.startsWith("[source line ")
      ? `# ${comment.text}`
      : `# [source line ${comment.line}${comment.inline ? ", inline" : ""}] ${comment.text}`)
  ];
  return ["# SceneYAML — edit_yaml", ...preserved, ...Object.entries(manifest).map(([key, value]) => {
    if (Array.isArray(value) && value.length) return `${JSON.stringify(key)}:\n${value.map(item => `  - ${JSON.stringify(item)}`).join("\n")}`;
    return `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  })].join("\n") + "\n";
}

// メッシュを含めてコアの正式形式で検証し、エディタ固有の件数制限を追加する
export function validateDocument(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw Error("SceneYAMLの先頭にはmapが必要です");
  for (const key of ["scene", "sceneUrl", "modelAsset", "modelAssetUrl", "sceneAsset", "sceneAssetUrl", "materialsUrl", "physicsUrl"]) {
    if (manifest[key] !== undefined) throw Error(`${key}: このエディタではinline objects/materials/physicsを使ってください。現在の作品は保持します`);
  }
  if (!Array.isArray(manifest.objects)) throw Error("objects配列が必要です");
  if (manifest.meshes !== undefined && !Array.isArray(manifest.meshes)) throw Error("meshesは配列で指定してください");
  const meshes = new Map();
  for (const mesh of manifest.meshes ?? []) {
    if (typeof mesh.id !== "string" || !mesh.id.trim() || meshes.has(mesh.id)) throw Error("mesh IDは重複しない文字列で指定してください");
    validateMesh(mesh, `meshes.${mesh.id}`);
    meshes.set(mesh.id, mesh);
  }
  const core = Object.fromEntries(CORE_KEYS.filter(key => manifest[key] !== undefined).map(key => [key, structuredClone(manifest[key])]));
  // 空の作品も編集可能にし、objectsがある通常の入力では全体の意味検証を行う
  if (core.objects.length || core.objectSets?.length) {
    const definition = SceneDefinition.fromData(core, { orientationFormat: "euler" });
    try { definition.validate(); } finally { definition.destroy(); }
  } else {
    if (core.animations?.length || core.physics?.joints?.length) throw Error("空の作品へanimationやJointを参照させることはできません");
    const definition = SceneDefinition.fromData({ ...core, objects: undefined }, { orientationFormat: "euler" });
    // 空のobjectsは描画生成へ渡さず、基本設定の検証を実行する
    delete definition.manifest.objects;
    try { definition.validate(); } finally { definition.destroy(); }
  }
  const materials = core.materials ? readPrimitiveMaterialManifest(core.materials) : null;
  const entries = core.objects.length || core.objectSets?.length
    ? readPrimitiveDefinitions(core.objects, core.objectSets, "editor", { materialDefinitions: materials, orientationFormat: "euler", meshDefinitions: meshes }) : [];
  for (const entry of entries) {
    const object = manifest.objects.find(item => item.id === entry.id);
    if (object?.mesh && entry.material.uvMapping) throw Error(`${entry.id}: メッシュのuvMappingは未対応です。材質設定を確認してください`);
  }
  return { core, meshes, entries };
}

// 原文と意味データを一緒に保持し、成功した編集だけをUndo履歴へ追加する
export class EditorDocument {
  constructor(text) {
    this.undoStack = [];
    this.redoStack = [];
    this.install(text);
    this.savedText = text;
  }

  // 新しい原文を検証してから置き換え、失敗時には現在の状態を保つ
  install(text) {
    const sourceDocument = parseSceneYAMLDocument(text);
    const manifest = sourceDocument.value;
    const checked = validateDocument(manifest);
    this.text = text;
    this.manifest = manifest;
    this.checked = checked;
    this.sourceDocument = sourceDocument;
  }

  // 3D画面への反映成功後に原文を確定し、全操作を同じUndo/Redo単位で扱う
  commit(text) {
    if (text === this.text) return;
    const old = this.text;
    this.install(text);
    this.undoStack.push(old);
    this.redoStack = [];
  }

  // 保存前の変更を原文単位で判断し、Undoで保存時の状態へ戻った場合も正しく判定する
  get dirty() { return this.text !== this.savedText; }
}
