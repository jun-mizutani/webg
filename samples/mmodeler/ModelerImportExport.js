// ---------------------------------------------
// samples/mmodeler/ModelerImportExport.js  2026/07/25
//   Import / export helpers for the mmodeler sample.
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ModelAsset from "../../webg/ModelAsset.js";
import Matrix from "../../webg/Matrix.js";
import { buildGlbFromGeometry } from "./glbExporter.js";
import { readFiniteNumber, readQuatXyzw, readVec3, sub3 } from "./math3d.js";

// download filename に入れる日時を 2 桁固定で整形する
export function formatDownloadTimestamp(date = new Date()) {
  const pad2 = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
    + `_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

// Blob を一時 URL にして browser download を開始する
export function downloadBlob(blob, filename, options = {}) {
  const documentRef = options.documentRef ?? document;
  const urlApi = options.urlApi ?? URL;
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  documentRef.body.appendChild(anchor);
  anchor.click();
  documentRef.body.removeChild(anchor);
  setTimeout(() => urlApi.revokeObjectURL(url), 0);
}

// file picker から渡された名前を拡張子判定用に正規化する
export function normalizeModelFileName(file) {
  return String(file?.name ?? "").trim().toLowerCase();
}

// file picker が付けた MIME type を比較しやすい形へ正規化する
export function normalizeModelFileType(file) {
  return String(file?.type ?? "").trim().toLowerCase().split(";", 1)[0];
}

// Blob 先頭だけを読み、gzip の magic bytes を確認する
export async function isGzipMagicFile(file) {
  if (!file || typeof file.slice !== "function") {
    return false;
  }
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return header.length >= 2 && header[0] === 0x1f && header[1] === 0x8b;
}

// 読み込み file から json / gzip json / gltf / dae などの形式を判定する
export async function detectFileFormat(file) {
  const name = normalizeModelFileName(file);
  const type = normalizeModelFileType(file);
  if (name.endsWith(".json.gz")) return { format: "json", gzip: true };
  if (name.endsWith(".json")) return { format: "json", gzip: false };
  if (name.endsWith(".gltf") || name.endsWith(".glb")) return { format: "gltf", gzip: false };
  if (name.endsWith(".dae")) return { format: "collada", gzip: false };
  const gzipType = type === "application/gzip" || type === "application/x-gzip";
  if (name.endsWith(".gz") || gzipType || await isGzipMagicFile(file)) {
    return { format: "json", gzip: true };
  }
  throw new Error(`unsupported file extension: name=${JSON.stringify(file?.name ?? "")} type=${file?.type || "-"} size=${file?.size ?? "-"}`);
}

// ModelAsset node 定義から transform matrix を作る
// glTF / Collada 由来の asset では mesh 自体の geometry と node transform が分かれている
// そのため、editor object 化するときは node の world matrix を頂点へ反映する
export function matrixFromNodeDef(node) {
  const matrix = new Matrix();
  if (Array.isArray(node?.matrix) && node.matrix.length >= 16) {
    matrix.setBulk(node.matrix);
    return matrix;
  }
  const transform = node?.transform ?? {};
  const t = Array.isArray(transform.translation) ? transform.translation : [0, 0, 0];
  const r = Array.isArray(transform.rotation) ? transform.rotation : [0, 0, 0, 1];
  const s = Array.isArray(transform.scale) ? transform.scale : [1, 1, 1];
  const x = Number(r[0] ?? 0);
  const y = Number(r[1] ?? 0);
  const z = Number(r[2] ?? 0);
  const w = Number(r[3] ?? 1);
  const sx = Number(s[0] ?? 1);
  const sy = Number(s[1] ?? 1);
  const sz = Number(s[2] ?? 1);
  matrix.setBulk([
    (1 - 2 * y * y - 2 * z * z) * sx,
    (2 * x * y + 2 * w * z) * sx,
    (2 * x * z - 2 * w * y) * sx,
    0,
    (2 * x * y - 2 * w * z) * sy,
    (1 - 2 * x * x - 2 * z * z) * sy,
    (2 * y * z + 2 * w * x) * sy,
    0,
    (2 * x * z + 2 * w * y) * sz,
    (2 * y * z - 2 * w * x) * sz,
    (1 - 2 * x * x - 2 * y * y) * sz,
    0,
    Number(t[0] ?? 0),
    Number(t[1] ?? 0),
    Number(t[2] ?? 0),
    1
  ]);
  return matrix;
}

// node 親子関係をたどって world matrix を cache 付きで解決する関数を作る
// import 候補 entry は mesh geometry と node transform を対にして保持するため、
// ここで親 node の transform も含めた最終 matrix を求める
export function buildWorldMatrixResolver(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const cache = new Map();
  // このインスタンスを現在の入力と状態から求め、呼び出し元へ返す
  const resolve = (node) => {
    if (!node) {
      return new Matrix();
    }
    if (cache.has(node.id)) {
      return cache.get(node.id).clone();
    }
    const local = matrixFromNodeDef(node);
    const parent = node.parent ? nodeById.get(node.parent) : null;
    const world = parent ? resolve(parent) : new Matrix();
    world.mul_(local);
    cache.set(node.id, world.clone());
    return world;
  };
  return resolve;
}

export default class ModelerImportExport {
  // インスタンス生成時に、受け取った設定を検証して初期状態を準備する
  constructor(options = {}) {
    this.filenamePrefix = options.filenamePrefix ?? "ma";
    this.documentRef = options.documentRef ?? document;
    this.urlApi = options.urlApi ?? URL;
    this.lastDownloadTimestamp = "";
    this.lastDownloadSerial = 0;
  }

  // mmodeler から保存する file の download filename を作る
  // ext は ".json"、".json.gz"、".glb" のように先頭の dot を含めて渡す
  makeDownloadFilename(ext, date = new Date()) {
    const timestamp = formatDownloadTimestamp(date);
    if (timestamp === this.lastDownloadTimestamp) {
      this.lastDownloadSerial += 1;
    } else {
      this.lastDownloadTimestamp = timestamp;
      this.lastDownloadSerial = 1;
    }
    const serialSuffix = this.lastDownloadSerial <= 1
      ? ""
      : `_${String(this.lastDownloadSerial).padStart(2, "0")}`;
    return `${this.filenamePrefix}_${timestamp}${serialSuffix}${ext}`;
  }

  // `blob`を指定された形式または保存先へ出力する
  downloadBlob(blob, filename) {
    downloadBlob(blob, filename, {
      documentRef: this.documentRef,
      urlApi: this.urlApi
    });
  }

  // モデルのアセットのJSONを指定された形式または保存先へ出力する
  saveModelAssetJson(asset) {
    asset.assertValid();
    const filename = this.makeDownloadFilename(".json");
    asset.downloadJSON(filename, 2);
    return filename;
  }

  // モデルのアセットのJSONの`gz`を指定された形式または保存先へ出力する
  async saveModelAssetJsonGz(asset) {
    asset.assertValid();
    const filename = this.makeDownloadFilename(".json.gz");
    await asset.downloadJSONGz(filename, 2);
    return filename;
  }

  // `glb`の`bytes`を指定された形式または保存先へ出力する
  saveGlbBytes(glb) {
    const filename = this.makeDownloadFilename(".glb");
    this.downloadBlob(new Blob([glb], { type: "model/gltf-binary" }), filename);
    return filename;
  }

  // 編集 geometry から GLB binary を作る
  // main.js 側は「どの geometry を保存するか」を決め、この method は GLB 形式への変換だけを担当する
  createGlbFromGeometry(options = {}) {
    if (!Array.isArray(options.vertices)) {
      throw new Error("createGlbFromGeometry requires vertices array");
    }
    if (!Array.isArray(options.faces)) {
      throw new Error("createGlbFromGeometry requires faces array");
    }
    if (!Array.isArray(options.materialColor)) {
      throw new Error("createGlbFromGeometry requires materialColor array");
    }
    return buildGlbFromGeometry({
      vertices: options.vertices,
      faces: options.faces,
      materialColor: options.materialColor,
      nodeTranslation: options.nodeTranslation ?? [0.0, 0.0, 0.0],
      nodeRotation: options.nodeRotation ?? [0.0, 0.0, 0.0, 1.0],
      nodeScale: options.nodeScale ?? 1.0
    });
  }

  // 編集 geometry を GLB file として保存する
  // filename 採番と Blob download を同じ class に集め、main.js から download 詳細を隠す
  saveGlbFromGeometry(options = {}) {
    const glb = this.createGlbFromGeometry(options);
    return this.saveGlbBytes(glb);
  }

  // 編集 data から保存 / 表示に使える ModelAsset を組み立てる
  // faces は三角形または四角形だけを許可し、四角形は表示用 indices へ扇形分解する
  createModelAssetFromGeometry(options = {}) {
    if (!Array.isArray(options.vertices)) {
      throw new Error("createModelAssetFromGeometry requires vertices array");
    }
    if (!Array.isArray(options.faces)) {
      throw new Error("createModelAssetFromGeometry requires faces array");
    }
    if (!options.material || typeof options.material !== "object") {
      throw new Error("createModelAssetFromGeometry requires material object");
    }
    const vertices = options.vertices;
    const faces = options.faces;
    const name = options.name ?? "mmodeler";
    const origin = options.origin ?? [0.0, 0.0, 0.0];
    const rotation = readQuatXyzw(options.rotation ?? [0.0, 0.0, 0.0, 1.0], `${name} rotation`);
    const scale = readFiniteNumber(options.scale ?? 1.0, `${name} scale`);
    if (Math.abs(scale) <= 1.0e-8) {
      throw new Error(`${name} scale must be non-zero`);
    }
    const material = options.material;
    const positions = [];
    for (let i = 0; i < vertices.length; i++) {
      const vertex = vertices[i];
      positions.push(vertex.position[0], vertex.position[1], vertex.position[2]);
    }

    const indices = [];
    const polygonLoops = [];
    for (const face of faces) {
      if (face.indices.length !== 3 && face.indices.length !== 4) {
        throw new Error(`face ${face.id} must have 3 or 4 vertices`);
      }
      const loop = face.indices.map((vertexIndex) => {
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length) {
          throw new Error(`face ${face.id} references missing vertex index ${vertexIndex}`);
        }
        return vertexIndex;
      });
      polygonLoops.push(loop);
      for (let i = 0; i < loop.length - 2; i++) {
        indices.push(loop[0], loop[i + 1], loop[i + 2]);
      }
    }

    return ModelAsset.fromData({
      version: "1.0",
      type: "webg-model-asset",
      meta: {
        name,
        generator: "samples/mmodeler",
        source: "editor",
        unitScale: 1.0,
        upAxis: "Y"
      },
      materials: [
        {
          id: "webgmodeler_mat",
          shaderParams: { ...material }
        }
      ],
      meshes: [
        {
          id: "webgmodeler_mesh",
          name: `${name}_mesh`,
          material: "webgmodeler_mat",
          geometry: {
            vertexCount: vertices.length,
            polygonCount: indices.length / 3,
            positions,
            uvs: new Array(vertices.length * 2).fill(0.0),
            indices,
            polygonLoops
          }
        }
      ],
      skeletons: [],
      animations: [],
      nodes: [
        {
          id: "webgmodeler_node",
          name: "webgmodeler_node",
          parent: null,
          mesh: "webgmodeler_mesh",
          transform: {
            translation: readVec3(origin, `${name} origin`),
            rotation,
            scale: [scale, scale, scale]
          }
        }
      ]
    });
  }

  // ModelAsset の mesh node から import 候補 entry を作る
  // node が mesh を参照している場合は node transform を保持し、node が無い asset では mesh 単体を候補にする
  makeImportEntries(asset) {
    const data = asset.getData();
    const meshes = Array.isArray(data?.meshes) ? data.meshes : [];
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    const meshById = new Map(meshes.map((mesh, index) => [mesh.id, { mesh, index }]));
    const resolveWorldMatrix = buildWorldMatrixResolver(nodes);
    const entries = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node?.mesh || !meshById.has(node.mesh)) {
        continue;
      }
      const meshEntry = meshById.get(node.mesh);
      entries.push({
        index: entries.length,
        meshIndex: meshEntry.index,
        mesh: meshEntry.mesh,
        node,
        worldMatrix: resolveWorldMatrix(node),
        label: `${entries.length}: ${node.name ?? node.id ?? "node"} / ${meshEntry.mesh.name ?? meshEntry.mesh.id ?? "mesh"} v=${meshEntry.mesh.geometry?.vertexCount ?? Math.floor((meshEntry.mesh.geometry?.positions?.length ?? 0) / 3)}`
      });
    }
    if (entries.length > 0) {
      return entries;
    }
    return meshes.map((mesh, index) => ({
      index,
      meshIndex: index,
      mesh,
      node: null,
      worldMatrix: new Matrix(),
      label: `${index}: ${mesh.name ?? mesh.id ?? "mesh"} v=${mesh.geometry?.vertexCount ?? Math.floor((mesh.geometry?.positions?.length ?? 0) / 3)}`
    }));
  }

  // import entry の geometry を mmodeler の editor object 形式へ変換する
  // 変換後の頂点は object local 座標になり、node の world translation は object origin として保持する
  buildEditorObjectFromImportEntry(entry, objectId) {
    const geometry = entry.mesh.geometry;
    if (!geometry || !Array.isArray(geometry.positions) || !Array.isArray(geometry.indices)) {
      throw new Error(`mesh ${entry.label} does not contain editable positions and indices`);
    }
    const vertices = [];
    const faces = [];
    let nextFaceId = 1;
    if (!entry.worldMatrix || typeof entry.worldMatrix.mulVector !== "function") {
      throw new Error(`mesh ${entry.label} does not contain a world transform`);
    }
    const worldMatrix = entry.worldMatrix;
    for (let i = 0; i + 2 < geometry.positions.length; i += 3) {
      const position = worldMatrix.mulVector([
        readFiniteNumber(geometry.positions[i], `positions[${i}]`),
        readFiniteNumber(geometry.positions[i + 1], `positions[${i + 1}]`),
        readFiniteNumber(geometry.positions[i + 2], `positions[${i + 2}]`)
      ]);
      const vertexIndex = vertices.length;
      vertices.push({
        id: vertexIndex,
        position: readVec3(position, `object ${objectId} vertex ${vertexIndex}`)
      });
    }
    const loops = Array.isArray(geometry.polygonLoops) && geometry.polygonLoops.length > 0
      ? geometry.polygonLoops
      : [];
    if (loops.length > 0) {
      for (let i = 0; i < loops.length; i++) {
        const loop = loops[i];
        if (!Array.isArray(loop) || (loop.length !== 3 && loop.length !== 4)) {
          throw new Error(`polygonLoops[${i}] must be a triangle or quad for this initial modeler`);
        }
        const indices = loop.map((sourceIndex) => {
          const vertexIndex = Number(sourceIndex);
          if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length) {
            throw new Error(`polygonLoops[${i}] references missing vertex index ${vertexIndex}`);
          }
          return vertexIndex;
        });
        faces.push({
          id: nextFaceId++,
          indices
        });
      }
    } else {
      for (let i = 0; i + 2 < geometry.indices.length; i += 3) {
        const a = Number(geometry.indices[i]);
        const b = Number(geometry.indices[i + 1]);
        const c = Number(geometry.indices[i + 2]);
        for (const vertexIndex of [a, b, c]) {
          if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length) {
            throw new Error(`indices[${i}] triangle references missing vertex index ${vertexIndex}`);
          }
        }
        faces.push({
          id: nextFaceId++,
          indices: [a, b, c]
        });
      }
    }
    const origin = typeof worldMatrix.getPosition === "function"
      ? readVec3(worldMatrix.getPosition(), `object ${objectId} origin`)
      : [0.0, 0.0, 0.0];
    for (const vertex of vertices) {
      vertex.position = sub3(vertex.position, origin);
    }
    return {
      id: objectId,
      name: entry.node?.name ?? entry.mesh.name ?? entry.mesh.id ?? `Object ${objectId}`,
      origin,
      rotation: [0.0, 0.0, 0.0, 1.0],
      scale: 1.0,
      vertices,
      faces,
      nextVertexId: vertices.length,
      nextFaceId
    };
  }

  // モデルのアセットのファイルを読み込み、検証済みのデータとして後続処理へ渡す
  async loadModelAssetFile(file, options = {}) {
    if (!file) {
      return null;
    }
    const onStage = typeof options.onStage === "function"
      ? options.onStage
      : async () => {};
    const fileInfo = await detectFileFormat(file);
    const format = fileInfo.format;
    const fileLabel = String(file.name ?? "(unknown)");
    let asset = null;
    if (format === "json") {
      if (fileInfo.gzip) {
        await onStage("decompressing", { fileLabel, fileInfo });
        const text = await ModelAsset.decompressGzipBlobToText(file);
        await onStage("parsing", { fileLabel, fileInfo });
        asset = ModelAsset.fromJSON(text);
      } else {
        await onStage("parsing", { fileLabel, fileInfo });
        const text = await file.text();
        asset = ModelAsset.fromJSON(text);
      }
    } else {
      if (typeof options.loadModel !== "function") {
        throw new Error("loadModelAssetFile requires loadModel for glTF / GLB / Collada");
      }
      const url = this.urlApi.createObjectURL(file);
      try {
        // GLB / glTF / Collada は WebgApp.loadModel() 経路でいったん ModelAsset へ正規化する。
        // 特に GLB は skinned mesh や static transform の bake を loader 側へ任せる必要がある。
        const loaded = await options.loadModel(url, {
          format,
          instantiate: false,
          validate: true,
          startAnimations: false,
          onStage: (stage) => {
            onStage(stage, { fileLabel, fileInfo });
          }
        });
        asset = loaded.asset;
      } finally {
        this.urlApi.revokeObjectURL(url);
      }
    }
    return {
      asset,
      fileInfo,
      fileLabel
    };
  }
}
