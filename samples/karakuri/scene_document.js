// ---------------------------------------------
//  scene_document.js  2026/09/19
//   Karakuri SceneYAML validation, project conversion, and download formatting
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { SceneDefinition, parseSceneYAML } from "../../webg/app/index.js";
import { readPrimitiveDefinitions, readPrimitiveMaterialManifest } from "../../webg/app/PrimitiveScene.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";

const PROJECT_KEYS = new Set([
  "format", "animations", "name", "version", "scene", "sceneUrl", "modelAsset", "modelAssetUrl",
  "sceneAsset", "sceneAssetUrl", "materials", "materialsUrl", "physics", "physicsUrl", "renderer",
  "bindings", "objects", "objectSets", "goals"
]);

// URLへtiming=1を指定したときだけ、SceneYAMLの準備時間をconsoleへ出力します
// 通常起動の表示や処理量を増やさず、起動遅延を段階別に確認できるようにします
export function isKarakuriTimingEnabled() {
  const search = globalThis.location?.search;
  return typeof search === "string" && new URLSearchParams(search).get("timing") === "1";
}

// 計測開始時刻からの経過時間を共通形式で記録し、呼出側の処理段階を比較できるようにします
export function reportKarakuriTiming(label, startedAt, details = "") {
  if (!isKarakuriTimingEnabled() || !Number.isFinite(startedAt)) return;
  const elapsed = globalThis.performance?.now?.() - startedAt;
  if (!Number.isFinite(elapsed)) return;
  console.info(`[Karakuri timing] ${label}: ${elapsed.toFixed(2)} ms${details ? ` (${details})` : ""}`);
}

// 3要素ベクトルを検証し、MakerとPlayerが同じワールド範囲を利用できる配列へ変換します
function readVec3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be a three-number array`);
  return value.map((entry, index) => {
    if (!Number.isFinite(entry)) throw new Error(`${label}[${index}] must be finite`);
    return entry;
  });
}

// 正の数値を検証し、エミッターと再生設定へ共有できる値を返します
function readPositive(value, label, defaultValue) {
  const result = value === undefined ? defaultValue : value;
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} must be greater than zero`);
  return result;
}

// 非負整数を検証し、個数上限を明示したエミッター設定へ変換します
function readCount(value, label, defaultValue) {
  const result = value === undefined ? defaultValue : value;
  if (!Number.isInteger(result) || result < 0) throw new Error(`${label} must be a non-negative integer`);
  return result;
}

// world設定を検証し、編集画面とPlayerの表示範囲を一つの値へまとめます
function readWorld(value) {
  const source = value ?? {};
  if (!source.editBounds || typeof source.editBounds !== "object") {
    throw new Error("karakuri world.editBounds is required");
  }
  const min = readVec3(source.editBounds.min, "karakuri world.editBounds.min");
  const max = readVec3(source.editBounds.max, "karakuri world.editBounds.max");
  if (max.some((entry, index) => entry <= min[index])) {
    throw new Error("karakuri world.editBounds max must be greater than min");
  }
  return Object.freeze({ editBounds: Object.freeze({ min, max }) });
}

// emitter定義を検証し、Playerが動的bodyを生成するための明示設定へ変換します
function readEmitters(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error("karakuri emitters must be an array");
  const ids = new Set();
  const result = value.map((entry, index) => {
    const label = `karakuri emitters[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} must be an object`);
    const id = entry.id;
    if (typeof id !== "string" || !id.trim()) throw new Error(`${label}.id must be a non-empty string`);
    if (ids.has(id)) throw new Error(`${label}.id is duplicated: ${id}`);
    ids.add(id);
    if (!entry.prototype || typeof entry.prototype !== "object") throw new Error(`${label}.prototype is required`);
    const prototype = structuredClone(entry.prototype);
    for (const key of Object.keys(prototype)) if (!["shape", "material", "physics"].includes(key)) throw new Error(`${label}.prototype.${key} is unsupported; use spawnPosition and initialVelocity on the emitter`);
    if (!prototype.shape || typeof prototype.shape !== "object") throw new Error(`${label}.prototype.shape is required`);
    if (typeof prototype.material !== "string" || prototype.material.length === 0) {
      throw new Error(`${label}.prototype.material is required`);
    }
    if (!prototype.physics || typeof prototype.physics !== "object") {
      throw new Error(`${label}.prototype.physics is required`);
    }
    if (prototype.physics.bodyType !== "dynamic") throw new Error(`${label}.prototype.physics.bodyType must be dynamic`);
    const maxActive = readCount(entry.maxActive, `${label}.maxActive`, 4);
    if (maxActive === 0) throw new Error(`${label}.maxActive must be at least 1`);
    const supported = new Set(["id", "name", "intervalSec", "maxActive", "maxCount", "spawnPosition", "initialVelocity", "prototype", "lifetimeSec"]);
    for (const key of Object.keys(entry)) if (!supported.has(key)) throw new Error(`${label}.${key} is unsupported; use intervalSec, spawnPosition, maxCount and lifetimeSec`);
    return Object.freeze({
      id,
      intervalSec: readPositive(entry.intervalSec, `${label}.intervalSec`, 2.0),
      maxActive,
      maxCount: readCount(entry.maxCount, `${label}.maxCount`, 0),
      spawnPosition: readVec3(entry.spawnPosition ?? [0, 2, 0], `${label}.spawnPosition`),
      initialVelocity: readVec3(entry.initialVelocity ?? [0, 0, 0], `${label}.initialVelocity`),
      lifetimeSec: readPositive(entry.lifetimeSec, `${label}.lifetimeSec`, 14.0),
      prototype: Object.freeze(prototype)
    });
  });
  return Object.freeze(result);
}

// ゴール定義を検証し、物体またはエミッターからゴールへの接触条件へ変換します
// targetは物理bodyを持つobject、sourceは初期objectまたは生成元emitterを参照します
function readGoals(value, objectDefinitions, emitterDefinitions) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error("karakuri goals must be an array");
  const objects = new Map(objectDefinitions.map((entry) => [entry.id, entry]));
  const emitters = new Set(emitterDefinitions.map((entry) => entry.id));
  const ids = new Set();
  const result = value.map((entry, index) => {
    const label = `karakuri goals[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} must be an object`);
    const supported = new Set(["id", "target", "source", "message", "once"]);
    for (const key of Object.keys(entry)) if (!supported.has(key)) throw new Error(`${label}.${key} is unsupported`);
    if (typeof entry.id !== "string" || !entry.id.trim()) throw new Error(`${label}.id must be a non-empty string`);
    if (ids.has(entry.id)) throw new Error(`${label}.id is duplicated: ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.target !== "string" || !entry.target.trim()) throw new Error(`${label}.target must be an object ID`);
    const target = objects.get(entry.target);
    if (!target) throw new Error(`${label}.target references unknown object: ${entry.target}`);
    if (!target.physics) throw new Error(`${label}.target must have a physics body: ${entry.target}`);
    if (target.physics.bodyType === "dynamic" && target.physics.isTrigger !== true) {
      throw new Error(`${label}.target must be static or a trigger object: ${entry.target}`);
    }
    let source = null;
    if (entry.source !== undefined) {
      if (!entry.source || typeof entry.source !== "object" || Array.isArray(entry.source)) throw new Error(`${label}.source must be an object`);
      const sourceKeys = Object.keys(entry.source);
      if (sourceKeys.length !== 1 || !["object", "emitter"].includes(sourceKeys[0])) {
        throw new Error(`${label}.source must contain exactly one object or emitter reference`);
      }
      const kind = sourceKeys[0];
      const reference = entry.source[kind];
      if (typeof reference !== "string" || !reference.trim()) throw new Error(`${label}.source.${kind} must be a non-empty ID`);
      if (kind === "object" && !objects.has(reference)) throw new Error(`${label}.source.object references unknown object: ${reference}`);
      if (kind === "emitter" && !emitters.has(reference)) throw new Error(`${label}.source.emitter references unknown emitter: ${reference}`);
      if (kind === "object" && !objects.get(reference).physics) throw new Error(`${label}.source.object must have a physics body: ${reference}`);
      if (kind === "object" && reference === entry.target) throw new Error(`${label}.source.object must differ from target`);
      source = Object.freeze({ kind, id: reference });
    }
    const message = entry.message === undefined ? "とどいた！" : entry.message;
    if (typeof message !== "string" || !message.trim()) throw new Error(`${label}.message must be a non-empty string`);
    if (entry.once !== undefined && typeof entry.once !== "boolean") throw new Error(`${label}.once must be boolean`);
    return Object.freeze({
      id: entry.id,
      target: entry.target,
      source,
      message,
      once: entry.once ?? true
    });
  });
  return Object.freeze(result);
}

// 再生倍率を検証し、Start／Stop／Resetと速度ボタンで共有する設定を返します
function readPlayback(value) {
  const source = value ?? {};
  const options = Array.isArray(source.timeScaleOptions) ? source.timeScaleOptions : [1.0, 0.5, 0.25];
  if (source.timeScaleOptions !== undefined && !Array.isArray(source.timeScaleOptions)) throw new Error("karakuri playback.timeScaleOptions must be an array");
  const timeScaleOptions = options.map((entry, index) => readPositive(entry, `karakuri playback.timeScaleOptions[${index}]`, 1.0));
  const defaultTimeScale = readPositive(source.defaultTimeScale, "karakuri playback.defaultTimeScale", timeScaleOptions[0]);
  if (!timeScaleOptions.length || timeScaleOptions.some((v, i) => v > 4 || (i > 0 && v >= timeScaleOptions[i - 1]))) {
    throw new Error("karakuri playback.timeScaleOptions must descend, with values in (0, 4]");
  }
  if (!timeScaleOptions.includes(defaultTimeScale)) {
    throw new Error("karakuri playback.defaultTimeScale must be included in timeScaleOptions");
  }
  return Object.freeze({ defaultTimeScale, timeScaleOptions: Object.freeze(timeScaleOptions) });
}

// Karakuri固有設定を外し、コアSceneDefinitionが検証できるproject manifestを作ります
// 固有設定はMakerとPlayerが扱い、renderer・objects・physicsはWebgSceneAppへ渡します
export function toProjectManifest(manifest) {
  const project = structuredClone(manifest);
  const proceduralMaterialIds = new Set(
    (Array.isArray(manifest.proceduralMaterials) ? manifest.proceduralMaterials : [])
      .map((definition) => definition?.materialId)
  );
  // Procedural Textureの対象材質へ内部mappingを付け、primitive Shapeを実寸UVで生成します
  if (Array.isArray(project.materials)) {
    for (const material of project.materials) {
      if (!proceduralMaterialIds.has(material?.id)) continue;
      material.uvMapping = "real-cuboid";
    }
  }
  for (const key of ["world", "emitters", "playback", "proceduralMaterials", "goals"]) delete project[key];
  return project;
}

// SceneYAMLのProcedural TextureをCompute生成し、projectの対象ShapeをAPI適用済みShapeへ置き換えます
// scaleをProceduralMaterials.createPreset()へ渡し、applyTo()をShape.endShape()より前に呼び出します
// managerとmaterial mapを呼出側へ返し、Maker／Playerが同じGPUDevice上のGPU資源を再利用・解放できるようにします
export async function prepareKarakuriProceduralMaterials(app, manifest, cache = null) {
  const definitions = manifest?.proceduralMaterials ?? [];
  const materials = new Map();
  if (definitions.length === 0) return { manager: null, materials };
  const gpu = app.app.getGPU();
  if (cache !== null && (typeof cache !== "object" || Array.isArray(cache))) {
    throw new Error("prepareKarakuriProceduralMaterials cache must be an object");
  }
  if (cache?.device !== undefined && cache.device !== gpu.device) {
    throw new Error("prepareKarakuriProceduralMaterials cache requires the same GPUDevice");
  }
  const ownsManager = cache?.manager === undefined || cache?.manager === null;
  const manager = cache?.manager ?? new ProceduralMaterials(gpu);
  const materialCache = cache?.materialsByKey ?? new Map();
  const created = [];
  if (cache !== null && ownsManager) {
    cache.device = gpu.device;
    cache.manager = manager;
    cache.materialsByKey = materialCache;
  }
  try {
    for (const definition of definitions) {
      const key = JSON.stringify({
        preset: definition.preset,
        tile: definition.tile,
        appearance: definition.appearance,
        scale: definition.scale
      });
      let material = materialCache.get(key);
      if (!material || material.destroyed) {
        material = await manager.createPreset(definition.preset, {
          tile: definition.tile,
          appearance: definition.appearance,
          scale: definition.scale
        });
        materialCache.set(key, material);
        created.push(material);
      }
      materials.set(definition.materialId, material);
    }
    for (const entry of app.scene.entries ?? []) {
      const material = materials.get(entry.material?.id);
      if (!material) continue;
      if (entry.shape?.type !== "box") {
        throw new Error(`${entry.id} procedural texture requires a box shape for mapRealCuboid`);
      }
      const originalShapes = [...(entry.node.shapes ?? [])];
      for (const originalShape of originalShapes) {
        const shape = new Shape(app.app.getGPU());
        try {
          shape.applyPrimitiveAsset(Primitive.mapRealCuboid(...entry.shape.size));
          material.applyTo(shape);
          shape.endShape();
          originalShape.destroy();
          entry.node.setShape(shape);
        } catch (error) {
          shape.destroy();
          throw error;
        }
      }
    }
    if (cache !== null) {
      cache.device = gpu.device;
      cache.manager = manager;
      cache.materialsByKey = materialCache;
    }
    return { manager, materials };
  } catch (error) {
    if (cache === null || ownsManager) {
      manager.destroy();
      if (cache !== null) {
        cache.device = undefined;
        cache.manager = null;
        cache.materialsByKey = new Map();
      }
    } else {
      for (const material of created) material.destroy();
    }
    throw error;
  }
}

// ページ終了時にキャッシュしたProcedural Textureだけを解放します
// preview／playerの再構築中はmanagerを維持し、同じGPUDevice上のpreset生成を繰り返しません
export function destroyKarakuriProceduralMaterialCache(cache) {
  if (cache === null || cache === undefined) return false;
  if (typeof cache !== "object" || Array.isArray(cache)) {
    throw new Error("destroyKarakuriProceduralMaterialCache cache must be an object");
  }
  const destroyed = cache.manager?.destroy?.() ?? false;
  cache.device = undefined;
  cache.manager = null;
  cache.materialsByKey?.clear?.();
  cache.materialsByKey = new Map();
  return destroyed;
}

// SceneYAMLを検証し、MakerとPlayerが共通利用するdocument snapshotを返します
export function parseKarakuriDocument(text, sourceUrl = null) {
  const startedAt = globalThis.performance?.now?.();
  const yamlStartedAt = globalThis.performance?.now?.();
  const manifest = parseSceneYAML(text);
  reportKarakuriTiming("SceneYAML parse", yamlStartedAt, `${String(text).length} bytes`);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Karakuri SceneYAML must contain a mapping at the top level");
  }
  if (manifest.format !== "webg-scene" || manifest.version !== 1) {
    throw new Error("Karakuri SceneYAML requires format: webg-scene and version: 1");
  }
  const world = readWorld(manifest.world);
  const emitters = readEmitters(manifest.emitters);
  const playback = readPlayback(manifest.playback);
  const projectManifest = toProjectManifest(manifest);
  const projectOptions = { orientationFormat: "euler" };
  if (sourceUrl) projectOptions.sourceUrl = new URL(sourceUrl, globalThis.location?.href).toString();
  const project = SceneDefinition.fromData(projectManifest, projectOptions);
  let goals = Object.freeze([]);
  try {
    project.validate();
    if (!Array.isArray(manifest.objects) || !Array.isArray(manifest.materials)) throw new Error("Karakuri requires inline objects and materials");
    const materials = readPrimitiveMaterialManifest(manifest.materials);
    const objects = readPrimitiveDefinitions(manifest.objects, manifest.objectSets, "Karakuri", { materialDefinitions: materials });
    const ids = new Set(objects.map(o => o.id));
    let capacity = objects.filter(o => o.physics).length;
    for (const emitter of emitters) {
      if (ids.has(emitter.id)) throw new Error(`emitter ID conflicts with object: ${emitter.id}`);
      readPrimitiveDefinitions([{ ...emitter.prototype, id: emitter.id }], undefined, `emitter ${emitter.id}`, { materialDefinitions: materials });
      capacity += emitter.maxCount > 0 ? Math.min(emitter.maxCount, emitter.maxActive) : emitter.maxActive;
    }
    goals = readGoals(manifest.goals, objects, emitters);
    if (emitters.length && !manifest.physics?.space) throw new Error("emitters require physics.space");
    if (manifest.physics?.space && capacity > (manifest.physics.space.maxBodies ?? 200)) {
      throw new Error(`physics.space.maxBodies must be at least ${capacity} (objects + emitter capacity)`);
    }
    const proceduralIds = new Set();
    if (manifest.proceduralMaterials !== undefined && !Array.isArray(manifest.proceduralMaterials)) throw new Error("proceduralMaterials must be an array");
    for (const definition of manifest.proceduralMaterials ?? []) {
      if (!definition || !materials.has(definition.materialId)) throw new Error("proceduralMaterials.materialId must reference materials");
      if (proceduralIds.has(definition.materialId)) throw new Error(`duplicate procedural material ${definition.materialId}`);
      proceduralIds.add(definition.materialId);
      for (const key of Object.keys(definition)) if (!["materialId", "preset", "scale", "tile", "appearance"].includes(key)) throw new Error(`proceduralMaterials.${key} is unsupported by Karakuri`);
      ProceduralMaterials.getPresetDefinition(definition.preset);
      ProceduralMaterials.resolve(definition.preset, definition.tile ?? {});
      if (definition.scale !== undefined) readPositive(definition.scale, `proceduralMaterials.${definition.materialId}.scale`, 1.0);
      const appearance = definition.appearance ?? {};
      if (typeof appearance !== "object" || Array.isArray(appearance)) throw new Error("proceduralMaterials.appearance must be an object");
      for (const [key, value] of Object.entries(appearance)) {
        if (!["roughness", "metallic", "specular", "normalStrength"].includes(key) || !Number.isFinite(value) || value < 0 || value > (key === "normalStrength" ? 8 : 1)) throw new Error(`invalid proceduralMaterials.appearance.${key}`);
      }
    }
  } catch (error) { project.destroy(); throw error; }
  const result = Object.freeze({
    sourceText: text,
    sourceFingerprint: JSON.stringify(manifest),
    sourceUrl,
    manifest: structuredClone(manifest),
    projectManifest,
    project,
    world,
    emitters,
    goals,
    playback
  });
  reportKarakuriTiming(
    "SceneYAML validation and snapshot",
    startedAt,
    `${result.manifest.objects?.length ?? 0} objects, ${result.manifest.materials?.length ?? 0} materials`
  );
  return result;
}

// gzipヘッダーを確認して解凍し、HTTPで解凍済みの本文はUTF-8として読みます
export async function readKarakuriText(source, sourceUrl = "scene.yaml") {
  const response = source instanceof Response ? source : new Response(source);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    if (/\.gz(?:[?#]|$)/i.test(sourceUrl) && !/\bgzip\b/i.test(response.headers.get("content-encoding") ?? "")) throw new Error(`Expected gzip Karakuri SceneYAML: ${sourceUrl}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  if (typeof DecompressionStream !== "function") throw new Error("Karakuri gzip reading requires DecompressionStream");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder("utf-8", { fatal: true }).decode(await new Response(stream).arrayBuffer());
}

// YAML scalarを読みやすい表記へ変換し、文字列の区切りを保ったまま保存します
function formatScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SceneYAML numbers must be finite");
    return String(value);
  }
  if (value === undefined) throw new Error("SceneYAML values must be defined");
  const text = String(value);
  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(text) && !/^(true|false|null|yes|no|on|off)$/i.test(text)) return text;
  return JSON.stringify(text);
}

// 配列や小さなmapをflow表記にして、Makerから保存したYAMLのデータ量を抑えます
function formatFlow(value) {
  if (Array.isArray(value)) return `[${value.map(formatFlow).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{ ${Object.entries(value).map(([key, entry]) => `${key}: ${formatFlow(entry)}`).join(", ")} }`;
  }
  return formatScalar(value);
}

// オブジェクトをインデント付きYAMLへ再帰展開し、ダウンロード用の本文を作ります
function writeYamlValue(value, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    const lines = [];
    for (const entry of value) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const entries = Object.entries(entry);
        if (entries.length === 0) {
          lines.push(`${pad}- {}`);
        } else {
          const [firstKey, firstValue] = entries[0];
          if (firstValue === null || typeof firstValue !== "object") {
            lines.push(`${pad}- ${firstKey}: ${formatFlow(firstValue)}`);
          } else {
            lines.push(`${pad}- ${firstKey}:`);
            lines.push(...writeYamlValue(firstValue, indent + 4));
          }
          for (const [key, nested] of entries.slice(1)) {
            if (nested !== null && typeof nested === "object") {
              lines.push(`${" ".repeat(indent + 2)}${key}:`);
              lines.push(...writeYamlValue(nested, indent + 4));
            } else {
              lines.push(`${" ".repeat(indent + 2)}${key}: ${formatFlow(nested)}`);
            }
          }
        }
      } else {
        lines.push(`${pad}- ${formatFlow(entry)}`);
      }
    }
    return lines;
  }
  if (value && typeof value === "object") {
    const lines = [];
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== null && typeof nested === "object") {
        lines.push(`${pad}${key}:`);
        lines.push(...writeYamlValue(nested, indent + 2));
      } else {
        lines.push(`${pad}${key}: ${formatFlow(nested)}`);
      }
    }
    return lines;
  }
  return [`${pad}${formatFlow(value)}`];
}

// 現在のmanifestをコメント付きの先頭説明とともにSceneYAML文字列へ変換します
export function stringifyKarakuriDocument(manifest, original = null) {
  if (original?.sourceText && original.sourceFingerprint === JSON.stringify(manifest)) return original.sourceText;
  return [
    "# Karakuri SceneYAML generated by Karakuri Maker",
    "# Edit objects, materials, physics, and emitters in this document.",
    ...writeYamlValue(manifest, 0),
    ""
  ].join("\n");
}

// 旧標準SceneYAMLを読み込んだ場合だけ、起動時の標準速度を1.0へ移行します
// SceneYAMLの名前を確認し、独自作品が指定したdefaultTimeScaleはそのまま保持します
export function migrateKarakuriStandardStartupTimeScale(text) {
  const manifest = parseSceneYAML(text);
  if (manifest?.format !== "webg-scene"
    || manifest?.version !== 1
    || manifest?.name !== "karakuri-playground"
    || manifest?.playback?.defaultTimeScale !== 0.5) return text;
  const line = /^([ \t]*defaultTimeScale:[ \t]*)0\.5([ \t]*(?:#.*)?)$/m;
  return line.test(text) ? text.replace(line, (_, prefix, suffix) => `${prefix}1.0${suffix}`) : text;
}

// ローカル時刻をファイル名用のYYYYMMDD_HHMM形式へ変換します
// ブラウザのタイムゾーンで保存時刻を表示し、同じ分に保存したファイルを同じ基準で識別できるようにします
export function formatLocalDownloadTimestamp(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Karakuri download timestamp requires a valid Date");
  }
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

// 拡張子を保ったままファイル名の本体へ保存時刻を加えます
// yaml.gzは二重拡張子の末尾を維持し、MakerとPlayerがそのまま読み込める名前にします
export function createTimestampedDownloadFilename(filename, date = new Date()) {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("Karakuri download filename must be a non-empty string");
  }
  const timestamp = formatLocalDownloadTimestamp(date);
  const extension = filename.match(/(\.yaml\.gz|\.ya?ml)$/i);
  if (!extension) return `${filename}_${timestamp}`;
  return `${filename.slice(0, -extension[1].length)}_${timestamp}${extension[1]}`;
}

// ブラウザの保存操作を共通化し、MakerのYAML形式ボタンから同じ処理を呼べるようにします
// 保存先で同じ固定名が提示されても、ダウンロード時刻を含む名前で作品を区別できます
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = createTimestampedDownloadFilename(filename);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
