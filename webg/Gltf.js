// ---------------------------------------------
// Gltf.js        2026/03/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class Gltf {
  // glTF/GLBデータとバッファ参照を初期化する
  constructor() {
    // glTF/glbファイル読み込みとbufferView/accessor展開を担当する低レイヤ
    this.gltf = null;
    this.buffers = [];
    this.baseUrl = "";
  }

  emitStage(handler, stage) {
    if (typeof handler === "function") {
      handler(stage);
    }
  }

  async yieldFrame() {
    if (typeof requestAnimationFrame === "function") {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async load(url, options = {}) {
    const onStage = options.onStage ?? null;
    this.baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
    try {
      if (url.toLowerCase().endsWith(".glb")) {
        await this.loadGlb(url, onStage);
      } else {
        await this.loadGltf(url, onStage);
      }
    } catch (err) {
      throw new Error(`Failed to load glTF asset: ${url} (${err?.message ?? err})`);
    }
    return this;
  }

  async loadGltf(url, onStage = null) {
    this.emitStage(onStage, "fetch-gltf-json");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    try {
      this.emitStage(onStage, "parse-gltf-json");
      this.gltf = await response.json();
    } catch (err) {
      throw new Error(`Invalid glTF JSON (${err?.message ?? err})`);
    }
    this.emitStage(onStage, "load-gltf-buffers");
    await this.loadBuffersFromGltf(false, onStage);
  }

  async loadGlb(url, onStage = null) {
    this.emitStage(onStage, "fetch-glb-binary");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    this.emitStage(onStage, "decode-glb");
    await this.yieldFrame();
    const dataView = new DataView(arrayBuffer);
    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546c67) {
      throw new Error("Invalid GLB magic");
    }
    const length = dataView.getUint32(8, true);
    let offset = 12;
    let json = null;
    let bin = null;
    while (offset < length) {
      const chunkLength = dataView.getUint32(offset, true);
      const chunkType = dataView.getUint32(offset + 4, true);
      offset += 8;
      const chunkData = arrayBuffer.slice(offset, offset + chunkLength);
      if (chunkType === 0x4e4f534a) {
        try {
          json = JSON.parse(new TextDecoder().decode(chunkData));
        } catch (err) {
          throw new Error(`Invalid GLB JSON chunk (${err?.message ?? err})`);
        }
      } else if (chunkType === 0x004e4942) {
        bin = chunkData;
      }
      offset += chunkLength;
    }
    if (!json) {
      throw new Error("GLB does not contain a JSON chunk");
    }
    this.gltf = json;
    this.buffers = [bin];
    this.emitStage(onStage, "load-glb-buffers");
    await this.loadBuffersFromGltf(true, onStage);
  }

  async loadBuffersFromGltf(alreadyHasBinary = false, onStage = null) {
    if (!this.gltf?.buffers) return;
    if (alreadyHasBinary && this.buffers.length > 0) {
      for (let i = 1; i < this.gltf.buffers.length; i++) {
        this.emitStage(onStage, `load-external-buffer ${i + 1}/${this.gltf.buffers.length}`);
        const buf = await this.fetchBuffer(this.gltf.buffers[i]);
        this.buffers[i] = buf;
      }
      return;
    }
    this.buffers = [];
    for (let i = 0; i < this.gltf.buffers.length; i++) {
      this.emitStage(onStage, `load-buffer ${i + 1}/${this.gltf.buffers.length}`);
      const buf = await this.fetchBuffer(this.gltf.buffers[i]);
      this.buffers.push(buf);
    }
  }

  async fetchBuffer(bufferDef) {
    if (!bufferDef.uri) {
      return new ArrayBuffer(0);
    }
    if (bufferDef.uri.startsWith("data:")) {
      const base64 = bufferDef.uri.split(",")[1];
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    const response = await fetch(this.baseUrl + bufferDef.uri);
    if (!response.ok) {
      throw new Error(`Failed to load buffer: ${this.baseUrl + bufferDef.uri} (${response.status} ${response.statusText})`);
    }
    return await response.arrayBuffer();
  }

  // accessor定義を返す
  getAccessor(accessorIndex) {
    return this.gltf.accessors[accessorIndex];
  }

  // bufferView定義を返す
  getBufferView(viewIndex) {
    return this.gltf.bufferViews[viewIndex];
  }

  // accessor実データTypedArrayを返す
  getAccessorData(accessorIndex) {
    const accessor = this.getAccessor(accessorIndex);
    const bufferView = this.getBufferView(accessor.bufferView);
    const buffer = this.buffers[bufferView.buffer];

    const componentType = accessor.componentType;
    const type = accessor.type;
    const count = accessor.count;
    const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const byteStride = bufferView.byteStride ?? 0;

    const numComponents = this.getNumComponents(type);
    const TypedArrayCtor = this.getTypedArrayConstructor(componentType);

    if (byteStride && byteStride !== numComponents * TypedArrayCtor.BYTES_PER_ELEMENT) {
      const result = new TypedArrayCtor(count * numComponents);
      const dataView = new DataView(buffer, byteOffset, bufferView.byteLength);
      const elementSize = TypedArrayCtor.BYTES_PER_ELEMENT;
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < numComponents; c++) {
          const offset = i * byteStride + c * elementSize;
          result[i * numComponents + c] = this.readComponent(dataView, offset, componentType);
        }
      }
      return { data: result, count, numComponents, componentType, normalized: accessor.normalized ?? false };
    }

    const array = new TypedArrayCtor(buffer, byteOffset, count * numComponents);
    return { data: array, count, numComponents, componentType, normalized: accessor.normalized ?? false };
  }

  // 1要素を型に応じて読む
  readComponent(dataView, offset, componentType) {
    switch (componentType) {
      case 5120: return dataView.getInt8(offset);
      case 5121: return dataView.getUint8(offset);
      case 5122: return dataView.getInt16(offset, true);
      case 5123: return dataView.getUint16(offset, true);
      case 5125: return dataView.getUint32(offset, true);
      case 5126: return dataView.getFloat32(offset, true);
      default: return 0;
    }
  }

  // `VEC3` 等の要素数を返す
  getNumComponents(type) {
    switch (type) {
      case "SCALAR": return 1;
      case "VEC2": return 2;
      case "VEC3": return 3;
      case "VEC4": return 4;
      case "MAT2": return 4;
      case "MAT3": return 9;
      case "MAT4": return 16;
      default: return 1;
    }
  }

  // 成分型に対応するTypedArray ctorを返す
  getTypedArrayConstructor(componentType) {
    switch (componentType) {
      case 5120: return Int8Array;
      case 5121: return Uint8Array;
      case 5122: return Int16Array;
      case 5123: return Uint16Array;
      case 5125: return Uint32Array;
      case 5126: return Float32Array;
      default: return Float32Array;
    }
  }

  // glTF image 定義を Blob として取り出す
  async getImageBlob(imageIndex) {
    const imageDef = this.gltf?.images?.[imageIndex];
    if (!imageDef) {
      throw new Error(`glTF image[${imageIndex}] is missing`);
    }

    if (imageDef.uri) {
      if (imageDef.uri.startsWith("data:")) {
        const [header, base64] = imageDef.uri.split(",");
        const mimeType = header.substring(header.indexOf(":") + 1, header.indexOf(";")) || "application/octet-stream";
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mimeType });
      }

      const response = await fetch(this.baseUrl + imageDef.uri);
      if (!response.ok) {
        throw new Error(`Failed to load image: ${this.baseUrl + imageDef.uri} (${response.status} ${response.statusText})`);
      }
      return await response.blob();
    }

    if (imageDef.bufferView !== undefined) {
      const view = this.getBufferView(imageDef.bufferView);
      const buffer = this.buffers[view.buffer];
      const offset = view.byteOffset ?? 0;
      const length = view.byteLength ?? 0;
      const bytes = new Uint8Array(buffer, offset, length);
      return new Blob([bytes], { type: imageDef.mimeType ?? "application/octet-stream" });
    }

    throw new Error(`glTF image[${imageIndex}] has neither uri nor bufferView`);
  }
}
