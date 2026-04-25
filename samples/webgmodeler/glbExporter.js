// -------------------------------------------------
// webgmodeler minimal GLB exporter
// -------------------------------------------------

function align4(value) {
  return (value + 3) & ~3;
}

function makePaddedUint8Array(source, paddedLength, padValue = 0) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const padded = new Uint8Array(paddedLength);
  padded.fill(padValue);
  padded.set(bytes, 0);
  return padded;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export function buildGlbFromGeometry({
  vertices,
  faces,
  materialColor = [0.70, 0.84, 0.96, 1.0],
  generator = "webg samples/webgmodeler",
  nodeName = "webgmodeler_node",
  meshName = "webgmodeler_mesh",
  materialName = "webgmodeler_mat"
}) {
  if (!Array.isArray(vertices) || vertices.length === 0 || !Array.isArray(faces) || faces.length === 0) {
    throw new Error("GLB export requires vertices and faces");
  }
  const idToIndex = new Map();
  const positions = new Float32Array(vertices.length * 3);
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    idToIndex.set(vertex.id, i);
    for (let axis = 0; axis < 3; axis++) {
      const value = vertex.position[axis];
      positions[i * 3 + axis] = value;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }

  const indexValues = [];
  for (const face of faces) {
    const loop = face.indices.map((vertexId) => {
      if (!idToIndex.has(vertexId)) {
        throw new Error(`face ${face.id} references missing vertex ${vertexId}`);
      }
      return idToIndex.get(vertexId);
    });
    for (let i = 0; i < loop.length - 2; i++) {
      indexValues.push(loop[0], loop[i + 1], loop[i + 2]);
    }
  }
  const useUint32 = vertices.length > 65535;
  const indices = useUint32
    ? new Uint32Array(indexValues)
    : new Uint16Array(indexValues);
  const indexComponentType = useUint32 ? 5125 : 5123;

  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const positionOffset = 0;
  const indexOffset = align4(positionBytes.byteLength);
  const binLength = align4(indexOffset + indexBytes.byteLength);
  const bin = new Uint8Array(binLength);
  bin.set(positionBytes, positionOffset);
  bin.set(indexBytes, indexOffset);

  const gltf = {
    asset: {
      version: "2.0",
      generator
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nodeName }],
    meshes: [
      {
        name: meshName,
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0,
            mode: 4
          }
        ]
      }
    ],
    materials: [
      {
        name: materialName,
        pbrMetallicRoughness: {
          baseColorFactor: materialColor,
          metallicFactor: 0.0,
          roughnessFactor: 0.72
        }
      }
    ],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: positionOffset,
        byteLength: positionBytes.byteLength,
        byteStride: 12,
        target: 34962
      },
      {
        buffer: 0,
        byteOffset: indexOffset,
        byteLength: indexBytes.byteLength,
        target: 34963
      }
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: vertices.length,
        type: "VEC3",
        min,
        max
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: indexComponentType,
        count: indices.length,
        type: "SCALAR"
      }
    ]
  };

  const jsonText = JSON.stringify(gltf);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonChunk = makePaddedUint8Array(jsonBytes, align4(jsonBytes.byteLength), 0x20);
  const binChunk = makePaddedUint8Array(bin, align4(bin.byteLength), 0x00);
  const totalLength = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  let offset = 0;
  view.setUint32(offset, 0x46546c67, true); offset += 4;
  view.setUint32(offset, 2, true); offset += 4;
  view.setUint32(offset, totalLength, true); offset += 4;
  view.setUint32(offset, jsonChunk.byteLength, true); offset += 4;
  writeAscii(view, offset, "JSON"); offset += 4;
  new Uint8Array(glb, offset, jsonChunk.byteLength).set(jsonChunk); offset += jsonChunk.byteLength;
  view.setUint32(offset, binChunk.byteLength, true); offset += 4;
  writeAscii(view, offset, "BIN\0"); offset += 4;
  new Uint8Array(glb, offset, binChunk.byteLength).set(binChunk);
  return glb;
}
