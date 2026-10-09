// ---------------------------------------------
// ComputePhysicsPipeline.js  2026/09/14
//   GPU resource, pipeline, and bind-group construction for ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import PingPongBuffer from "./PingPongBuffer.js";
import ComputeJointBuffer from "./ComputeJointBuffer.js";
import { createComputeJointWGSL } from "./ComputeJointSolver.js";
import {
  COMPUTE_PHYSICS_BODY_STATE_LAYOUT,
  COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT,
  PARAM_FLOATS
} from "./ComputeBodyState.js";

// ComputePhysicsSpaceが使うGPU resourceとpipelineを生成する内部部品
// 公開クラスのbody登録・encode・readback APIには触れず、GPU実体の準備だけを担当します
export default class ComputePhysicsPipeline {

  // ComputePhysicsSpaceを受け取り、GPU生成先を固定します
  constructor(space) {
    if (!space || !space.device || !space.queue) {
      throw new Error("ComputePhysicsPipeline requires a ComputePhysicsSpace");
    }
    this.space = space;
  }

  // BodyState、BodyControl、Broad Phase、Plane、UniformのGPU resourceを生成します
  // すべてのbufferを揃えてからpipelineとbind groupを生成し、完成したGPU状態を公開します
  createResources() {
    const space = this.space;
    space.gridCellCount = space.gridSize * space.gridSize;
    space.candidateWordCount = Math.ceil(space.maxBodies / 32);
    space.gridWordCount = space.gridCellCount * space.candidateWordCount;
    space.candidateWordOffset = space.gridWordCount;
    // Gridとbody別candidate bitsetだけを一つのatomic bufferへ配置します
    space.totalGridWordCount = space.candidateWordOffset + space.maxBodies * space.candidateWordCount;
    const gridCandidateBytes = space.totalGridWordCount * Uint32Array.BYTES_PER_ELEMENT;
    const storageBindingLimit = space.device.limits?.maxStorageBufferBindingSize;
    if (Number.isFinite(storageBindingLimit) && gridCandidateBytes > storageBindingLimit) {
      throw new Error(
        `${space.label} grid/candidate buffer requires ${gridCandidateBytes} bytes, `
        + `which exceeds maxStorageBufferBindingSize ${storageBindingLimit}`
      );
    }
    const stateBytes = space.maxBodies * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideBytes;
    space.stateBuffers = [0, 1].map((index) => space.device.createBuffer({
      label: space.label + ":body-state-" + index,
      size: stateBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    }));
    space.states = new PingPongBuffer(space.stateBuffers, { label: space.label + ":states" });
    space.controlData = new ArrayBuffer(
      space.maxBodies * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideBytes
    );
    space.controlFloats = new Float32Array(space.controlData);
    space.controlUint32 = new Uint32Array(space.controlData);
    space.controlBuffer = space.device.createBuffer({
      label: space.label + ":body-control",
      size: space.controlData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    space.queue.writeBuffer(space.controlBuffer, 0, space.controlData);
    // state以外のBroad Phase入力とPlane定義を別Storage Bufferへ分け、solverのbind groupを固定します
    space.aabbBuffer = space.device.createBuffer({
      label: space.label + ":predicted-aabb",
      size: space.maxBodies * 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE
    });
    space.planeBuffer = space.device.createBuffer({
      label: space.label + ":planes",
      size: space.maxPlanes * 12 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    space.writePlaneData();
    // 先頭vec4をGPU内fixed step世代、後続vec4をbody別の接触履歴として確保します
    space.contactHistoryBytes = (1 + space.maxBodies * (space.maxBodies + space.maxPlanes)) * 16;
    space.contactHistoryBuffer = space.device.createBuffer({
      label: space.label + ":contact-history", size: space.contactHistoryBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    space.gridCandidateBuffer = space.device.createBuffer({
      label: space.label + ":grid-and-candidates",
      size: gridCandidateBytes,
      usage: GPUBufferUsage.STORAGE
    });
    space.paramData = new Float32Array(PARAM_FLOATS);
    space.paramBuffer = space.device.createBuffer({
      label: space.label + ":params",
      size: space.paramData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    // Joint descriptor、body adjacency、XPBD lambdaを一つのstorage bufferへ配置します
    // contact solverのstorage bindingと重ならないbinding 7を使います
    space.joints = new ComputeJointBuffer({
      device: space.device,
      queue: space.queue,
      label: space.label,
      maxBodies: space.maxBodies,
      maxJoints: space.maxJoints,
      maxJointsPerBody: space.maxJointsPerBody
    });
    // WGSL moduleとbind groupを最後に生成し、すべてのbuffer参照が揃った状態でpipelineを完成させます
    this.createPipelines();
    this.createBindGroups();
    space.writeParams();
  }

  // Broad Phase、局所contact solver、JointのGPU pipelineを生成します
  // shader生成とlayout生成を同じspace設定から行い、bindingの対応を一箇所で固定します
  // clear / Broad Phase / solverを別moduleにし、初回clear dispatchでsolver全体を遅延コンパイルさせません
  createPipelines() {
    const space = this.space;
    const makeShaderModule = (label, entryPoints) => {
      const code = space.createWGSL({ entryPoints, minify: true });
      const module = space.device.createShaderModule({
        label: space.label + ":" + label,
        code
      });
      return module;
    };
    const clearModule = makeShaderModule("clear-shader", ["clearMain"]);
    const broadphaseModule = makeShaderModule(
      "broadphase-shader",
      ["aabbMain", "cellMain", "candidateMain"]
    );
    const solverModule = makeShaderModule("solver-shader", ["solverMain"]);
    // clear / Broad Phase / solverでstorage bufferの読み書き方向が異なるためlayoutを分けます
    space.clearLayout = space.device.createBindGroupLayout({
      label: space.label + ":clear-layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    space.broadphaseLayout = space.device.createBindGroupLayout({
      label: space.label + ":broadphase-layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }
      ]
    });
    const solverEntries = [
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }
    ];
    space.solverLayout = space.device.createBindGroupLayout({
      label: space.label + ":solver-layout",
      entries: solverEntries
    });
    space.jointLayout = space.device.createBindGroupLayout({
      label: space.label + ":joint-layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    const makePipeline = (module, label, layout, entryPoint) => {
      const pipelineLayout = space.device.createPipelineLayout({ bindGroupLayouts: [layout] });
      return space.device.createComputePipeline({
        label: space.label + ":" + label,
        layout: pipelineLayout,
        compute: { module, entryPoint }
      });
    };
    // 固定stepが使うCompute passを一度だけ作り、以後はbind groupのstate indexだけを切り替えます
    space.clearPipeline = makePipeline(clearModule, "clear", space.clearLayout, "clearMain");
    space.aabbPipeline = makePipeline(broadphaseModule, "predict-aabb", space.broadphaseLayout, "aabbMain");
    space.cellPipeline = makePipeline(broadphaseModule, "build-grid", space.broadphaseLayout, "cellMain");
    space.candidatePipeline = makePipeline(broadphaseModule, "build-candidates", space.broadphaseLayout, "candidateMain");
    // 接触はcombined solver内の局所反復solverだけを通常経路として使います
    space.solverPipeline = makePipeline(solverModule, "combined-solver", space.solverLayout, "solverMain");
    // Jointは登録された空間だけで必要になるため、通常の接触solver生成時には作りません
    // addJoint()またはJoint設定変更時に遅延生成し、Jointなしsampleの初回GPU準備を軽くします
    space.jointPipelines = [];
    space.jointPipeline = null;
    if (space.joints.getCount() > 0) this.createJointPipelines();
  }

  // 最初のJoint登録時だけ、偶奇2本のXPBD pipelineとbind groupを生成します
  createJointPipelines() {
    const space = this.space;
    if (!space.joints || space.jointPipelines?.length === 2) return;
    space.jointPipelines = [0, 1].map((jointPassParity) => {
      const jointModule = space.device.createShaderModule({
        label: space.label + ":joint-shader-parity-" + jointPassParity,
        code: createComputeJointWGSL({
          maxBodies: space.maxBodies,
          recordBaseU32: space.joints.getLayoutInfo().recordBaseU32,
          maxJointLinks: space.joints.getLayoutInfo().maxJointLinks,
          // 1 dispatch = 1 global iteration; the fixed-step encoder repeats both parity passes
          jointSolverIterations: 1,
          jointPassParity
        })
      });
      return space.device.createComputePipeline({
        label: space.label + ":joint-xpbd-solver-parity-" + jointPassParity,
        layout: space.device.createPipelineLayout({ bindGroupLayouts: [space.jointLayout] }),
        compute: { module: jointModule, entryPoint: "jointMain" }
      });
    });
    space.jointPipeline = space.jointPipelines[0];
    this.createJointBindGroups();
  }

  // 2本のstate bufferそれぞれをsrcにしたBroad Phase、solver、Jointのbind groupを生成します
  // ping-pong切り替え後にGPU layoutを作り直さず、同じbuffer対応を維持します
  createBindGroups() {
    const space = this.space;
    space.clearBindGroup = space.device.createBindGroup({
      label: space.label + ":clear-bind-group",
      layout: space.clearLayout,
      entries: [
        { binding: 0, resource: { buffer: space.gridCandidateBuffer } },
        { binding: 8, resource: { buffer: space.contactHistoryBuffer } }
      ]
    });
    space.broadphaseBindGroups = space.stateBuffers.map((buffer, index) => space.device.createBindGroup({
      label: space.label + ":broadphase-bind-group-" + index,
      layout: space.broadphaseLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: { buffer: space.aabbBuffer } },
        { binding: 2, resource: { buffer: space.paramBuffer } },
        { binding: 3, resource: { buffer: space.gridCandidateBuffer } },
        { binding: 4, resource: { buffer: space.controlBuffer } },
        { binding: 7, resource: { buffer: space.joints.getBuffer() } }
      ]
    }));
    space.solverBindGroups = space.stateBuffers.map((srcBuffer, index) => space.device.createBindGroup({
      label: space.label + ":solver-bind-group-" + index,
      layout: space.solverLayout,
      entries: [
        { binding: 8, resource: { buffer: space.contactHistoryBuffer } },
        { binding: 0, resource: { buffer: srcBuffer } },
        { binding: 1, resource: { buffer: space.stateBuffers[1 - index] } },
        { binding: 2, resource: { buffer: space.paramBuffer } },
        { binding: 3, resource: { buffer: space.gridCandidateBuffer } },
        { binding: 4, resource: { buffer: space.planeBuffer } },
        { binding: 5, resource: { buffer: space.controlBuffer } },
        { binding: 7, resource: { buffer: space.joints.getBuffer() } }
      ]
    }));
    this.createJointBindGroups();
  }

  // Joint pipelineが生成済みのときだけ、その2本のstate向けbind groupを作ります
  createJointBindGroups() {
    const space = this.space;
    if (!space.jointPipelines?.length) {
      space.jointBindGroups = [];
      return;
    }
    space.jointBindGroups = space.stateBuffers.map((srcBuffer, index) => space.device.createBindGroup({
      label: space.label + ":joint-bind-group-" + index,
      layout: space.jointLayout,
      entries: [
        { binding: 0, resource: { buffer: srcBuffer } },
        { binding: 1, resource: { buffer: space.stateBuffers[1 - index] } },
        { binding: 2, resource: { buffer: space.paramBuffer } },
        { binding: 7, resource: { buffer: space.joints.getBuffer() } }
      ]
    }));
  }
}
