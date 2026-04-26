// -------------------------------------------------
// line-list edge overlay renderer
//   edgeWireframeOverlayRenderer.js 2026/04/26
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

export default class EdgeWireframeOverlayRenderer {
  constructor(gpu, {
    initialVertexCapacity = 4096,
    zBias = 0.00028
  } = {}) {
    // Screen.getGL() が返す WebGPUContext を保持する
    // app.start() の onAfterDraw3d から呼ぶ前提なので、描画時は既存の render pass
    // (gpu.passEncoder) にそのまま line-list を追加する
    this.gpu = gpu;
    this.device = null;

    // 1 vertex は position.xyz + color.rgba の 7 float
    // Shape / Wireframe と同じく world 座標を渡し、shader 側で view/projection を掛ける
    this.vertexStrideFloats = 7;
    this.vertexStrideBytes = this.vertexStrideFloats * Float32Array.BYTES_PER_ELEMENT;
    this.vertexCapacity = initialVertexCapacity;

    // 毎 frame clear() して、現在の編集 mesh の edge を JS 配列へ積む
    // edge 数は編集で変化するため、GPUBuffer は必要時だけ倍々に拡張する
    this.vertices = [];
    this.uploadData = new Float32Array(this.vertexCapacity * this.vertexStrideFloats);
    this.bufferDirty = true;
    this.vertexBuffer = null;

    // uniform は WGSL の 16-byte alignment に合わせ、
    // mat4x4(proj) + mat4x4(view) + vec4(params) = 36 float とする
    // 実際の GPUBuffer は WebGPU の uniform binding 制約に合わせて 256 byte 確保する
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
    this.pipeline = null;
    this.uniformData = new Float32Array(36);

    // edge は mesh surface と同じ位置にあるため、depth test で面に埋もれやすい
    // clip.z を clip.w 比例で少し手前へ寄せ、selected face overlay 後でも見えやすくする
    // 大きすぎると隠れている edge まで見えやすくなるので、小さな値に留める
    this.zBias = zBias;
  }

  async init() {
    // WebGPUContext は非同期で device / queue を用意する
    // renderer 側では gpu.ready を待ってから GPU resource を生成する
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu.device;
    this.vertexBuffer = this.createVertexBuffer(this.vertexCapacity);
    this.uniformBuffer = this.device.createBuffer({
      label: "edge-wireframe-overlay-uniform-buffer",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.createPipeline();
  }

  createVertexBuffer(vertexCapacity) {
    // COPY_DST を付け、draw() ごとに queue.writeBuffer() で CPU 側 edge list を転送する
    // 現状の modeler では edge overlay は小規模かつ毎 frame 再構築なので、
    // persistent mapped buffer より単純な writeBuffer を優先する
    return this.device.createBuffer({
      label: "edge-wireframe-overlay-vertex-buffer",
      size: vertexCapacity * this.vertexStrideBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  createPipeline() {
    // Wireframe.js と同じ line-list topology を使うが、こちらは sample overlay 用に
    // alpha blend と z bias を持たせた軽量 pipeline として分ける
    const module = this.device.createShaderModule({
      code: `
struct Uniforms {
  proj : mat4x4f,
  view : mat4x4f,
  params : vec4f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VSIn {
  @location(0) position : vec3f,
  @location(1) color : vec4f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  var clip = uniforms.proj * uniforms.view * vec4f(input.position, 1.0);
  // params.x is a small clip-space depth bias. Multiplying by w keeps the bias
  // approximately constant after perspective divide.
  clip.z = max(0.0, clip.z - uniforms.params.x * clip.w);
  out.position = clip;
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  return input.color;
}`
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" }
        }
      ]
    });
    this.uniformBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          // 36 float = 144 byte. The buffer itself is 256 byte, but the binding
          // size can be the actual struct size.
          resource: { buffer: this.uniformBuffer, size: 144 }
        }
      ]
    });
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: this.vertexStrideBytes,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 3 * 4, format: "float32x4" }
            ]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [
          {
            format: this.gpu.format,
            // 非選択 edge の alpha を UI から変えられるよう、通常の source-alpha blend にする
            // Wireframe.js は不透明描画だが、modeler overlay では薄い補助線が必要になる
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add"
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add"
              }
            }
          }
        ]
      },
      primitive: {
        // GPU の line primitive として描く
        topology: "line-list",
        cullMode: "none"
      },
      depthStencil: {
        format: "depth24plus",
        // mesh に隠れた edge は基本的に表示しないただし overlay 自体は後続描画へ
        // 影響しないよう depth buffer へ書き込まない
        depthWriteEnabled: false,
        depthCompare: "less-equal"
      }
    });
  }

  clear() {
    // frame ごとの一時 vertex list だけを消すGPUBuffer は再利用する
    this.vertices.length = 0;
    this.bufferDirty = true;
  }

  setMatrices(projectionMatrix, viewMatrix) {
    // projection と view は main.js 側で WebgApp / eye から取得する
    // Matrix.mul() は剛体変換向けなので、ここでは合成済み行列ではなく
    // shader 内で proj * view を明示的に掛ける
    this.uniformData.set(projectionMatrix.mat, 0);
    this.uniformData.set(viewMatrix.mat, 16);

    // params.x: zBias 残りは将来の拡張用に 0 を入れておく
    this.uniformData[32] = this.zBias;
    this.uniformData[33] = 0.0;
    this.uniformData[34] = 0.0;
    this.uniformData[35] = 0.0;
  }

  pushVertex(position, color) {
    // color は [r, g, b, a] の linear 0..1 値
    // edge ごとの色分けをしたいので uniform color ではなく vertex attribute にする
    this.vertices.push(
      position[0], position[1], position[2],
      color[0], color[1], color[2], color[3]
    );
    this.bufferDirty = true;
  }

  addLine(a, b, color) {
    // line-list は 2 vertex で 1 本の線を表す
    // main.js 側で face loop から重複 edge を作り、ここへ world 座標を渡す
    this.pushVertex(a, color);
    this.pushVertex(b, color);
  }

  ensureCapacity(vertexCount) {
    // 既存 capacity で足りる限りは GPUBuffer を作り直さない
    // 足りない場合だけ倍々に増やし、頻繁な再確保を避ける
    if (vertexCount <= this.vertexCapacity) {
      return;
    }
    while (this.vertexCapacity < vertexCount) {
      this.vertexCapacity *= 2;
    }
    this.vertexBuffer?.destroy?.();
    this.vertexBuffer = this.createVertexBuffer(this.vertexCapacity);
    this.uploadData = new Float32Array(this.vertexCapacity * this.vertexStrideFloats);
    this.bufferDirty = true;
  }

  draw() {
    const vertexCount = this.vertices.length / this.vertexStrideFloats;
    if (vertexCount <= 0) {
      return;
    }
    this.ensureCapacity(vertexCount);

    // uniform と vertex を現在 frame の内容で更新する
    // uniformData は Float32Array(36) だが、uniformBuffer は 256 byte 確保済み
    this.gpu.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData.buffer, 0, this.uniformData.byteLength);
    if (this.bufferDirty) {
      this.uploadData.set(this.vertices);
      const data = this.uploadData.subarray(0, this.vertices.length);
      this.gpu.queue.writeBuffer(this.vertexBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
      this.bufferDirty = false;
    }

    // onAfterDraw3d の中で呼ばれるため、WebgApp / Screen が開いている passEncoder を使う
    // pass が無い場合は frame timing が想定外なので、何も描かずに戻る
    const pass = this.gpu.passEncoder;
    if (!pass) {
      return;
    }

    // index buffer は使わないline-list 頂点配列を先頭から順に描画する
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.uniformBindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(vertexCount, 1, 0, 0);
  }
}
