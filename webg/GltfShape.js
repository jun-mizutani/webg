// ---------------------------------------------
// GltfShape.js   2026/03/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Gltf from "./Gltf.js";
import Skeleton from "./Skeleton.js";
import Matrix from "./Matrix.js";
import Quat from "./Quat.js";
import Animation from "./Animation.js";
import ModelAsset from "./ModelAsset.js";
import ModelBuilder from "./ModelBuilder.js";
import Texture from "./Texture.js";

export default class GltfShape {
  // glTF→Shape変換器を初期化する
  constructor(gpu) {
    // glTFデータをwebgのShape/Skeleton/Animationへ変換するローダ補助
    this.gpu = gpu;
    this.gltf = new Gltf();
    this.data = null;
    this.runtimeTextures = new Map();
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
    try {
      await this.gltf.load(url, options);
      this.data = this.gltf.gltf;
      return this;
    } catch (err) {
      throw new Error(`GltfShape.load failed: ${url} (${err?.message ?? err})`);
    }
  }

  // 現在シーンのルートノード配列を返す
  getSceneNodes() {
    const sceneIndex = this.data.scene ?? 0;
    const scene = this.data.scenes?.[sceneIndex];
    return scene?.nodes ?? [];
  }

  // ノードごとのローカル行列配列を構築する
  buildNodeTransforms({ normalizeOrigin = true } = {}) {
    // ノードごとのローカル行列を配列化して返す
    // normalizeOrigin が true の場合は、
    // - スキニングモデル: skeleton root の原点をモデル原点にする
    // - 非スキニングモデル: mesh node の原点をモデル原点にする
    // という方針で、scene root 側の平行移動を相殺した行列を返す
    const nodes = this.data.nodes ?? [];
    const locals = nodes.map((node) => this.getNodeLocalMatrix(node));
    if (!normalizeOrigin || locals.length === 0) {
      return locals;
    }

    const anchorNode = this.findOriginAnchorNode();
    if (anchorNode === null || anchorNode === undefined) {
      return locals;
    }

    const parents = this.buildParents();
    const worlds = new Array(nodes.length);
    const buildWorld = (index) => {
      if (worlds[index]) return worlds[index];
      const local = locals[index];
      const parentIndex = parents[index];
      if (parentIndex === null || parentIndex === undefined) {
        worlds[index] = local.clone();
      } else {
        const world = local.clone();
        world.lmul(buildWorld(parentIndex));
        worlds[index] = world;
      }
      return worlds[index];
    };

    const anchorWorld = buildWorld(anchorNode);
    const originOffset = anchorWorld.getPosition();
    if (originOffset[0] === 0 && originOffset[1] === 0 && originOffset[2] === 0) {
      return locals;
    }

    let rootIndex = anchorNode;
    while (parents[rootIndex] !== null && parents[rootIndex] !== undefined) {
      rootIndex = parents[rootIndex];
    }

    const adjusted = locals.map((mat) => mat.clone());
    const rootMatrix = adjusted[rootIndex].clone();
    const rootPosition = rootMatrix.getPosition();
    rootMatrix.position([
      rootPosition[0] - originOffset[0],
      rootPosition[1] - originOffset[1],
      rootPosition[2] - originOffset[2]
    ]);
    adjusted[rootIndex] = rootMatrix;
    return adjusted;
  }

  // loader の model origin policy に使う基準ノードを返す
  findOriginAnchorNode() {
    const nodes = this.data.nodes ?? [];
    const skins = this.data.skins ?? [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.skin === undefined || node.skin === null) continue;
      const skin = skins[node.skin];
      const root = this.getSkinRootNodeIndex(skin);
      if (root !== null && root !== undefined) {
        return root;
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].mesh !== undefined && nodes[i].mesh !== null) {
        return i;
      }
    }

    return null;
  }

  // skin の skeleton root node index を返す
  getSkinRootNodeIndex(skin) {
    if (!skin) return null;
    if (skin.skeleton !== undefined && skin.skeleton !== null) {
      return skin.skeleton;
    }

    const joints = skin.joints ?? [];
    if (joints.length === 0) return null;
    const jointSet = new Set(joints);
    const parents = this.buildParents();

    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];
      if (!jointSet.has(parents[joint])) {
        return joint;
      }
    }

    return joints[0];
  }

  // 1ノードのローカル行列を返す
  getNodeLocalMatrix(node) {
    // glTFのTRS or matrixをwebg Matrixへ変換する
    const m = new Matrix();
    if (node.matrix) {
      m.setBulk(node.matrix);
      return m;
    }
    const t = node.translation ?? [0, 0, 0];
    const r = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];

    const q = new Quat();
    q.q = [r[3], r[0], r[1], r[2]];
    m.setByQuat(q);
    m.mat[0] *= s[0];
    m.mat[1] *= s[0];
    m.mat[2] *= s[0];
    m.mat[4] *= s[1];
    m.mat[5] *= s[1];
    m.mat[6] *= s[1];
    m.mat[8] *= s[2];
    m.mat[9] *= s[2];
    m.mat[10] *= s[2];
    m.position(t);
    return m;
  }

  // 親ノードインデックス表を生成する
  buildParents() {
    const nodes = this.data.nodes ?? [];
    const parents = new Array(nodes.length).fill(null);
    for (let i = 0; i < nodes.length; i++) {
      const children = nodes[i].children ?? [];
      for (const child of children) {
        parents[child] = i;
      }
    }
    return parents;
  }

  // local 行列配列から world 行列配列を作る
  buildWorldTransforms(localMatrices, parents = this.buildParents()) {
    const worlds = new Array(localMatrices.length);
    const buildWorld = (index) => {
      if (worlds[index]) {
        return worlds[index];
      }
      const local = localMatrices[index]?.clone?.() ?? new Matrix();
      const parentIndex = parents[index];
      if (parentIndex === null || parentIndex === undefined) {
        worlds[index] = local;
        return local;
      }
      const world = local.clone();
      world.lmul(buildWorld(parentIndex));
      worlds[index] = world;
      return world;
    };
    for (let i = 0; i < localMatrices.length; i++) {
      buildWorld(i);
    }
    return worlds;
  }

  // animation channel が触る node index を集める
  collectAnimatedNodeIndices() {
    const animated = new Set();
    for (const anim of this.data.animations ?? []) {
      for (const channel of anim.channels ?? []) {
        if (channel?.target?.node !== undefined && channel?.target?.node !== null) {
          animated.add(channel.target.node);
        }
      }
    }
    return animated;
  }

  // 列ベクトル長から uniform scale を推定する
  // glTF TRS 由来なら shear を含まない前提なので、
  // 3 軸長がほぼ一致するときだけ uniform scale とみなす
  getUniformScaleFromMatrix(matrix, epsilon = 1.0e-4) {
    const m = matrix.mat;
    const sx = Math.hypot(m[0], m[1], m[2]);
    const sy = Math.hypot(m[4], m[5], m[6]);
    const sz = Math.hypot(m[8], m[9], m[10]);
    const maxDelta = Math.max(Math.abs(sx - sy), Math.abs(sy - sz), Math.abs(sz - sx));
    if (maxDelta > epsilon) {
      return null;
    }
    return (sx + sy + sz) / 3.0;
  }

  // uniform scale を除いた回転+平行移動行列を返す
  removeUniformScale(matrix, scale) {
    const rigid = matrix.clone();
    const safe = Math.abs(scale) < 1.0e-8 ? 1.0 : scale;
    rigid.mat[0] /= safe; rigid.mat[1] /= safe; rigid.mat[2] /= safe;
    rigid.mat[4] /= safe; rigid.mat[5] /= safe; rigid.mat[6] /= safe;
    rigid.mat[8] /= safe; rigid.mat[9] /= safe; rigid.mat[10] /= safe;
    return rigid;
  }

  makeUniformScaleMatrix(scale) {
    const matrix = new Matrix();
    matrix.mat[0] = scale;
    matrix.mat[5] = scale;
    matrix.mat[10] = scale;
    return matrix;
  }

  // glTF の静的 node transform を importer 側で焼き込む計画を作る
  // 対象は次の 2 つ
  // 1) skinned mesh の親 node にある static な回転/平行移動/uniform scale
  // 2) non-skinned mesh node にある static uniform scale
  // skinned mesh の場合は runtime bone が親 node transform を見ないため、
  // 親 transform を mesh / skeleton / animation へ bake して structural node を identity にする
  buildStaticBakePlans(skinPlans = new Map()) {
    const nodes = this.data.nodes ?? [];
    const parents = this.buildParents();
    const localMatrices = this.buildNodeTransforms({ normalizeOrigin: true });
    const worldMatrices = this.buildWorldTransforms(localMatrices, parents);
    const animatedNodeIndices = this.collectAnimatedNodeIndices();
    const plans = new Map();

    for (const plan of skinPlans.values()) {
      const nodeIndex = plan.nodeIndex;
      let current = nodeIndex;
      let hasAnimatedAncestor = false;
      while (current !== null && current !== undefined) {
        if (animatedNodeIndices.has(current)) {
          hasAnimatedAncestor = true;
          break;
        }
        current = parents[current];
      }

      if (hasAnimatedAncestor) {
        plans.set(plan.key, {
          type: "skinned",
          nodeIndex,
          apply: false,
          reason: "animated-ancestor"
        });
        continue;
      }

      const bakeMatrix = worldMatrices[nodeIndex]?.clone?.() ?? new Matrix();
      const uniformScale = this.getUniformScaleFromMatrix(bakeMatrix);
      if (uniformScale === null) {
        plans.set(plan.key, {
          type: "skinned",
          nodeIndex,
          apply: false,
          reason: "non-uniform-scale"
        });
        continue;
      }

      const inverseBakeMatrix = bakeMatrix.clone();
      inverseBakeMatrix.inverse_strict();
      plans.set(plan.key, {
        type: "skinned",
        nodeIndex,
        apply: true,
        bakeMatrix,
        inverseBakeMatrix,
        uniformScale,
        rigidMatrix: this.removeUniformScale(bakeMatrix, uniformScale)
      });
    }

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const node = nodes[nodeIndex];
      if (node.mesh === undefined || node.mesh === null) {
        continue;
      }
      if (node.skin !== undefined && node.skin !== null) {
        continue;
      }
      if (animatedNodeIndices.has(nodeIndex)) {
        continue;
      }
      const local = localMatrices[nodeIndex]?.clone?.() ?? new Matrix();
      const uniformScale = this.getUniformScaleFromMatrix(local);
      if (uniformScale === null || Math.abs(uniformScale - 1.0) < 1.0e-4) {
        continue;
      }
      plans.set(`static:${nodeIndex}`, {
        type: "static",
        nodeIndex,
        apply: true,
        uniformScale,
        rigidMatrix: this.removeUniformScale(local, uniformScale)
      });
    }

    return plans;
  }

  bakeGeometryByMatrix(geometry, matrix, normalMatrix = matrix) {
    const positions = geometry.positions;
    for (let i = 0; i < positions.length; i += 3) {
      const p = matrix.mulVector([positions[i], positions[i + 1], positions[i + 2]]);
      positions[i] = p[0];
      positions[i + 1] = p[1];
      positions[i + 2] = p[2];
    }

    if (!geometry.normals) {
      return;
    }
    for (let i = 0; i < geometry.normals.length; i += 3) {
      const n = normalMatrix.mul3x3Vector([geometry.normals[i], geometry.normals[i + 1], geometry.normals[i + 2]]);
      const len = Math.hypot(n[0], n[1], n[2]) || 1.0;
      geometry.normals[i] = n[0] / len;
      geometry.normals[i + 1] = n[1] / len;
      geometry.normals[i + 2] = n[2] / len;
    }
  }

  // Shape群を生成する
  makeShapes({ includeSkins = true } = {}) {
    // 既存 API 互換のため Shape 配列を返すが、
    // 内部では一度 ModelAsset へ正規化してから ModelBuilder で Shape 化する
    const asset = this.toModelAsset({ includeSkins });
    const built = new ModelBuilder(this.gpu).build(asset.getData());
    const shapes = [];
    for (let i = 0; i < built.nodes.length; i++) {
      const node = built.nodes[i];
      if (!node.shape) continue;
      node.shape._gltfNodeIndex = node.gltfNodeIndex;
      node.shape._gltfSkinIndex = node.gltfSkinIndex;
      shapes.push(node.shape);
    }
    return shapes;
  }

  // glTF の内容を ModelAsset へ正規化する
  toModelAsset({ includeSkins = true } = {}) {
    const materials = this.buildMaterials();
    const skinPlans = includeSkins ? this.buildSkinUsagePlans() : new Map();
    const bakePlans = this.buildStaticBakePlans(skinPlans);
    const skeletons = includeSkins ? this.buildSkeletonDefs(skinPlans, bakePlans) : [];
    const meshes = this.buildMeshDefs({ includeSkins, materials, skinPlans, bakePlans });
    const animations = includeSkins ? this.buildAnimationDefs(skeletons, skinPlans, bakePlans) : [];
    const nodes = this.buildNodeDefs(meshes, skeletons, animations, bakePlans);

    return ModelAsset.fromData({
      version: "1.0",
      type: "webg-model-asset",
      meta: {
        name: this.data.asset?.generator ?? "gltf-model",
        generator: "GltfShape.js",
        source: "glTF",
        unitScale: 1.0,
        upAxis: "Y"
      },
      materials,
      meshes,
      skeletons,
      animations,
      nodes
    });
  }

  async toModelAssetAsync({ includeSkins = true, onStage = null } = {}) {
    this.emitStage(onStage, "normalize-materials");
    await this.yieldFrame();
    const materials = this.buildMaterials();

    this.emitStage(onStage, includeSkins ? "analyze-skins" : "skip-skin-analysis");
    await this.yieldFrame();
    const skinPlans = includeSkins ? this.buildSkinUsagePlans(onStage) : new Map();

    this.emitStage(onStage, includeSkins ? "analyze-static-bake" : "skip-static-bake");
    await this.yieldFrame();
    const bakePlans = this.buildStaticBakePlans(skinPlans);

    this.emitStage(onStage, includeSkins ? "normalize-skeletons" : "skip-skeletons");
    await this.yieldFrame();
    const skeletons = includeSkins ? this.buildSkeletonDefs(skinPlans, bakePlans) : [];

    this.emitStage(onStage, "normalize-meshes");
    await this.yieldFrame();
    const meshes = this.buildMeshDefs({ includeSkins, materials, skinPlans, bakePlans });

    this.emitStage(onStage, includeSkins ? "normalize-animations" : "skip-animations");
    await this.yieldFrame();
    const animations = includeSkins ? this.buildAnimationDefs(skeletons, skinPlans, bakePlans) : [];

    this.emitStage(onStage, "normalize-nodes");
    await this.yieldFrame();
    const nodes = this.buildNodeDefs(meshes, skeletons, animations, bakePlans);

    this.emitStage(onStage, "normalize-asset");
    await this.yieldFrame();
    return ModelAsset.fromData({
      version: "1.0",
      type: "webg-model-asset",
      meta: {
        name: this.data.asset?.generator ?? "gltf-model",
        generator: "GltfShape.js",
        source: "glTF",
        unitScale: 1.0,
        upAxis: "Y"
      },
      materials,
      meshes,
      skeletons,
      animations,
      nodes
    });
  }

  // sample 側から意味が読みやすい別名も用意する
  getModelAsset(options = {}) {
    return this.toModelAsset(options);
  }

  normalizeBoneName(name, fallback = "joint") {
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
    return fallback;
  }

  isRigifyDeformBone(name) {
    return typeof name === "string" && name.startsWith("DEF-");
  }

  isRigifyHelperBone(name) {
    if (typeof name !== "string") return false;
    return name.startsWith("ORG-") || name.startsWith("MCH-");
  }

  buildSkinPlanKey(nodeIndex, primitiveIndex) {
    return `${nodeIndex}:${primitiveIndex}`;
  }

  collectWeightedJointLocalIndices(jointIndices, jointWeights) {
    const used = new Set();
    for (let i = 0; i < jointIndices.length; i++) {
      const weight = Number(jointWeights[i] ?? 0);
      if (!(weight > 0)) continue;
      const localIndex = Number(jointIndices[i]);
      if (!Number.isInteger(localIndex) || localIndex < 0) continue;
      used.add(localIndex);
    }
    return [...used].sort((a, b) => a - b);
  }

  // skinned primitive ごとに「本当に必要な joint 集合」を解析する
  // ここで作る plan は次の 3 つの用途に使う
  // 1. mesh.skin.jointIndices を小さい local index へ remap する
  // 2. primitive 専用の subset skeleton を作る
  // 3. helper ancestor を child 側へ焼き込むための collapse 情報を持つ
  // Rigify 向けには ORG-/MCH- を helper と見なしつつ、
  // 削除判定自体は「weight を持つか」「ancestor として必要か」で行う
  buildSkinUsagePlans(onStage = null) {
    const nodes = this.data.nodes ?? [];
    const meshes = this.data.meshes ?? [];
    const skins = this.data.skins ?? [];
    const parents = this.buildParents();
    const plans = new Map();

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const node = nodes[nodeIndex];
      if (node.mesh === undefined || node.mesh === null) continue;
      if (node.skin === undefined || node.skin === null) continue;
      const mesh = meshes[node.mesh];
      const skinIndex = node.skin;
      const skin = skins[skinIndex];
      if (!mesh || !skin) continue;

      const skinJointNodes = skin.joints ?? [];
      const nodeToLocalJoint = new Map();
      for (let i = 0; i < skinJointNodes.length; i++) {
        nodeToLocalJoint.set(skinJointNodes[i], i);
      }

      for (let primitiveIndex = 0; primitiveIndex < mesh.primitives.length; primitiveIndex++) {
        const prim = mesh.primitives[primitiveIndex];
        const jointAccIndex = prim.attributes?.JOINTS_0;
        const weightAccIndex = prim.attributes?.WEIGHTS_0;
        if (jointAccIndex === undefined || weightAccIndex === undefined) continue;

        const jointData = Array.from(this.gltf.getAccessorData(jointAccIndex).data);
        const weightData = Array.from(this.gltf.getAccessorData(weightAccIndex).data);
        // weight > 0 の influence を持つ joint だけを起点にする
        // ここが「この primitive が直接使っている骨」であり、
        // 以後の prune / remap はこの集合を中心に進める
        const weightedJointLocalIndices = this.collectWeightedJointLocalIndices(jointData, weightData);
        const weightedJointSet = new Set(weightedJointLocalIndices);
        const keptLocalIndexSet = new Set(weightedJointLocalIndices);
        const droppedHelperAncestorLocalIndexSet = new Set();

        // weighted joint の ancestor をたどり、必要な親骨だけを kept へ加える
        // ただし Rigify helper ancestor は後で child に bake できるので、
        // weight で直接使っていないものは一旦 dropped 候補として分ける
        for (let i = 0; i < weightedJointLocalIndices.length; i++) {
          let currentNodeIndex = skinJointNodes[weightedJointLocalIndices[i]];
          while (currentNodeIndex !== null && currentNodeIndex !== undefined) {
            const localJointIndex = nodeToLocalJoint.get(currentNodeIndex);
            if (localJointIndex === undefined) break;
            const jointName = this.normalizeBoneName(nodes[currentNodeIndex]?.name, `joint_${currentNodeIndex}`);
            const isHelper = this.isRigifyHelperBone(jointName);
            if (!isHelper || weightedJointSet.has(localJointIndex)) {
              keptLocalIndexSet.add(localJointIndex);
            } else {
              droppedHelperAncestorLocalIndexSet.add(localJointIndex);
            }
            currentNodeIndex = parents[currentNodeIndex];
          }
        }

        const keptLocalIndices = [...keptLocalIndexSet].sort((a, b) => a - b);
        const localRemap = new Map();
        for (let i = 0; i < keptLocalIndices.length; i++) {
          localRemap.set(keptLocalIndices[i], i);
        }
        const collapsedSegments = new Map();
        const parentKeptLocalIndices = new Map();
        // kept joint ごとに、直上にあった dropped helper ancestor の列を記録する
        // これにより skeleton default pose と animation pose の両方で
        // 「helper を child へ畳み込む」ための行列積を後段で再利用できる
        for (let i = 0; i < keptLocalIndices.length; i++) {
          const keptLocalIndex = keptLocalIndices[i];
          const segment = [keptLocalIndex];
          let currentNodeIndex = parents[skinJointNodes[keptLocalIndex]];
          let parentKeptLocalIndex = null;
          while (currentNodeIndex !== null && currentNodeIndex !== undefined) {
            const localJointIndex = nodeToLocalJoint.get(currentNodeIndex);
            if (localJointIndex === undefined) break;
            if (keptLocalIndexSet.has(localJointIndex)) {
              parentKeptLocalIndex = localJointIndex;
              break;
            }
            segment.unshift(localJointIndex);
            currentNodeIndex = parents[currentNodeIndex];
          }
          collapsedSegments.set(keptLocalIndex, segment);
          parentKeptLocalIndices.set(keptLocalIndex, parentKeptLocalIndex);
        }

        const weightedJointNames = weightedJointLocalIndices.map((localIndex) => {
          const nodeRef = skinJointNodes[localIndex];
          return this.normalizeBoneName(nodes[nodeRef]?.name, `joint_${nodeRef}`);
        });
        const rigifyLike = weightedJointNames.some((name) => this.isRigifyDeformBone(name) || this.isRigifyHelperBone(name));
        const keptJointNames = keptLocalIndices.map((localIndex) => {
          const nodeRef = skinJointNodes[localIndex];
          return this.normalizeBoneName(nodes[nodeRef]?.name, `joint_${nodeRef}`);
        });
        const weightedHelperNames = weightedJointNames.filter((name) => this.isRigifyHelperBone(name));
        const ancestorOnlyHelperNames = keptJointNames.filter((name) => {
          return this.isRigifyHelperBone(name) && !weightedHelperNames.includes(name);
        });
        const deformJointCount = keptJointNames.filter((name) => this.isRigifyDeformBone(name)).length;
        const helperJointCount = keptJointNames.filter((name) => this.isRigifyHelperBone(name)).length;
        const plan = {
          key: this.buildSkinPlanKey(nodeIndex, primitiveIndex),
          nodeIndex,
          primitiveIndex,
          skinIndex,
          skeletonId: `skeleton_${nodeIndex}_${primitiveIndex}`,
          weightedJointLocalIndices,
          keptLocalIndices,
          localRemap,
          collapsedSegments,
          parentKeptLocalIndices,
          originalJointCount: skinJointNodes.length,
          weightedJointCount: weightedJointLocalIndices.length,
          requiredJointCount: keptLocalIndices.length,
          deformJointCount,
          helperJointCount,
          weightedHelperCount: weightedHelperNames.length,
          ancestorOnlyHelperCount: ancestorOnlyHelperNames.length,
          droppedHelperAncestorCount: droppedHelperAncestorLocalIndexSet.size,
          weightedHelperSample: weightedHelperNames.slice(0, 6),
          ancestorOnlyHelperSample: ancestorOnlyHelperNames.slice(0, 6),
          rigifyLike
        };
        plans.set(plan.key, plan);

        if (typeof onStage === "function") {
          const prefix = rigifyLike ? "rigify-bones" : "skin-bones";
          const meshName = mesh.name ? `${mesh.name}_${primitiveIndex}` : `mesh_${nodeIndex}_${primitiveIndex}`;
          onStage(
            `${prefix} mesh=${meshName} original=${plan.originalJointCount} weighted=${plan.weightedJointCount} required=${plan.requiredJointCount} deform=${plan.deformJointCount} helper=${plan.helperJointCount} helperWeighted=${plan.weightedHelperCount} helperAncestor=${plan.ancestorOnlyHelperCount} helperPruned=${plan.droppedHelperAncestorCount}`
          );
        }
      }
    }

    return plans;
  }

  // glTF material を ModelAsset 形式へ変換する
  buildMaterials() {
    const materials = this.data.materials ?? [];
    return materials.map((material, index) => {
      const pbr = material.pbrMetallicRoughness ?? {};
      const color = pbr.baseColorFactor ?? [1, 1, 1, 1];
      return {
        id: `material_${index}`,
        shaderParams: {
          color,
          ambient: 0.3,
          specular: 0.5,
          power: 30.0
        }
      };
    });
  }

  // glTF sampler を webg Texture の address mode へ反映する
  applySamplerToTexture(texture, samplerIndex) {
    const sampler = samplerIndex !== undefined ? this.data?.samplers?.[samplerIndex] : null;
    const wrapS = sampler?.wrapS ?? 10497;
    const wrapT = sampler?.wrapT ?? 10497;
    if (wrapS === 33071 && wrapT === 33071) {
      texture.setClamp();
      return;
    }
    texture.setRepeat();
  }

  // glTF texture を webg Texture へ変換し cache する
  async getRuntimeTexture(textureIndex, onStage = null) {
    if (this.runtimeTextures.has(textureIndex)) {
      return this.runtimeTextures.get(textureIndex);
    }
    const texDef = this.data?.textures?.[textureIndex];
    if (!texDef || texDef.source === undefined) {
      return null;
    }

    this.emitStage(onStage, `load-texture ${textureIndex + 1}/${this.data.textures.length}`);
    await this.yieldFrame();
    const blob = await this.gltf.getImageBlob(texDef.source);
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
    } catch (_) {
      bitmap = await createImageBitmap(blob);
    }

    let canvas;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("2D context is unavailable while decoding glTF texture");
    }
    ctx.drawImage(bitmap, 0, 0);
    const rgba = new Uint8Array(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);

    const texture = new Texture(this.gpu);
    await texture.initPromise;
    texture.setImage(rgba, bitmap.width, bitmap.height, 4);
    this.applySamplerToTexture(texture, texDef.sampler);
    this.runtimeTextures.set(textureIndex, texture);
    return texture;
  }

  // build 済み runtime Shape へ baseColorTexture を適用する
  async applyRuntimeMaterials(runtime, onStage = null) {
    const materials = this.data?.materials ?? [];
    if (!runtime || materials.length === 0) {
      return 0;
    }

    let applied = 0;
    for (let i = 0; i < runtime.nodes.length; i++) {
      const nodeInfo = runtime.nodes[i];
      const meshDef = nodeInfo?.meshId ? runtime.meshDefs.get(nodeInfo.meshId) : null;
      const materialIndex = meshDef?._gltfMaterialIndex;
      if (materialIndex === undefined || materialIndex === null) continue;
      const material = materials[materialIndex];
      const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (textureIndex === undefined || textureIndex === null) continue;
      const texture = await this.getRuntimeTexture(textureIndex, onStage);
      if (!texture || !nodeInfo.shape) continue;
      nodeInfo.shape.setTexture(texture);
      nodeInfo.shape.updateMaterial({
        use_texture: 1,
        texture
      });
      applied++;
    }
    return applied;
  }

  // glTF mesh primitive を ModelAsset mesh 配列へ変換する
  buildMeshDefs({ includeSkins = true, materials = [], skinPlans = new Map(), bakePlans = new Map() } = {}) {
    const nodes = this.data.nodes ?? [];
    const meshes = this.data.meshes ?? [];
    const meshDefs = [];

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const node = nodes[nodeIndex];
      if (node.mesh === undefined) continue;
      const mesh = meshes[node.mesh];
      const skinIndex = node.skin;

      for (let p = 0; p < mesh.primitives.length; p++) {
        const prim = mesh.primitives[p];
        const positionAcc = this.gltf.getAccessorData(prim.attributes.POSITION);
        const normalAcc = prim.attributes.NORMAL !== undefined ? this.gltf.getAccessorData(prim.attributes.NORMAL) : null;
        const texAcc = prim.attributes.TEXCOORD_0 !== undefined ? this.gltf.getAccessorData(prim.attributes.TEXCOORD_0) : null;

        let indices = null;
        if (prim.indices !== undefined) {
          const idxAcc = this.gltf.getAccessorData(prim.indices);
          indices = Array.from(idxAcc.data);
        } else {
          indices = [...Array(positionAcc.count).keys()];
        }

        const meshDef = {
          id: `mesh_${nodeIndex}_${p}`,
          name: mesh.name ? `${mesh.name}_${p}` : `mesh_${nodeIndex}_${p}`,
          geometry: {
            vertexCount: positionAcc.count,
            polygonCount: Math.floor(indices.length / 3),
            positions: Array.from(positionAcc.data),
            indices,
            uvs: texAcc ? Array.from(texAcc.data) : new Array(positionAcc.count * 2).fill(0)
          },
          _gltfNodeIndex: nodeIndex,
          _gltfPrimitiveIndex: p,
          _gltfSkinIndex: skinIndex,
          _gltfMaterialIndex: prim.material ?? null
        };

        const skinPlan = skinIndex !== undefined
          ? skinPlans.get(this.buildSkinPlanKey(nodeIndex, p)) ?? null
          : null;
        const skinBake = skinPlan ? bakePlans.get(skinPlan.key) ?? null : null;
        const staticBake = bakePlans.get(`static:${nodeIndex}`) ?? null;

        if (normalAcc) {
          meshDef.geometry.normals = Array.from(normalAcc.data);
        }

        if (skinBake?.apply) {
          this.bakeGeometryByMatrix(
            meshDef.geometry,
            skinBake.bakeMatrix,
            skinBake.rigidMatrix
          );
          meshDef.meta = {
            ...(meshDef.meta ?? {}),
            staticBake: "skinned-node-world",
            bakedNodeIndex: nodeIndex,
            bakedUniformScale: skinBake.uniformScale
          };
        } else if (staticBake?.apply) {
          this.bakeGeometryByMatrix(
            meshDef.geometry,
            this.makeUniformScaleMatrix(staticBake.uniformScale),
            new Matrix()
          );
          meshDef.meta = {
            ...(meshDef.meta ?? {}),
            staticBake: "static-uniform-scale",
            bakedNodeIndex: nodeIndex,
            bakedUniformScale: staticBake.uniformScale
          };
        }

        if (prim.material !== undefined && materials[prim.material]) {
          meshDef.material = materials[prim.material].id;
        }

        if (includeSkins && skinIndex !== undefined) {
          const jointAccIndex = prim.attributes.JOINTS_0;
          const weightAccIndex = prim.attributes.WEIGHTS_0;
          if (jointAccIndex !== undefined && weightAccIndex !== undefined) {
            const originalJointIndices = Array.from(this.gltf.getAccessorData(jointAccIndex).data);
            const jointWeights = Array.from(this.gltf.getAccessorData(weightAccIndex).data);
            meshDef.skin = {
              influencesPerVertex: 4,
              jointIndices: skinPlan
                ? originalJointIndices.map((jointIndex, influenceIndex) => {
                  const mapped = skinPlan.localRemap.get(jointIndex);
                  if (mapped !== undefined) return mapped;
                  return (jointWeights[influenceIndex] ?? 0) > 0 ? 0 : 0;
                })
                : originalJointIndices,
              jointWeights
            };
            if (skinPlan) {
              meshDef.skeleton = skinPlan.skeletonId;
            }
          }
        }

        meshDefs.push(meshDef);
      }
    }
    return meshDefs;
  }

  // 法線が無いメッシュの法線を補完する
  computeNormals(shape) {
    const normals = new Float32Array(shape.vertexCount * 3);
    const indices = shape.indicesArray;
    const pos = shape.positionArray;
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3;
      const i1 = indices[i + 1] * 3;
      const i2 = indices[i + 2] * 3;
      const ax = pos[i1] - pos[i0];
      const ay = pos[i1 + 1] - pos[i0 + 1];
      const az = pos[i1 + 2] - pos[i0 + 2];
      const bx = pos[i2] - pos[i0];
      const by = pos[i2 + 1] - pos[i0 + 1];
      const bz = pos[i2 + 2] - pos[i0 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
      normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
      normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
    }
    for (let i = 0; i < normals.length; i += 3) {
      const x = normals[i];
      const y = normals[i + 1];
      const z = normals[i + 2];
      const d = Math.sqrt(x * x + y * y + z * z) || 1;
      shape.normalArray[i] = x / d;
      shape.normalArray[i + 1] = y / d;
      shape.normalArray[i + 2] = z / d;
    }
  }

  // collapse 対象の local 行列列を 1 個の local 行列へ合成する
  // 例:
  //   helperA -> helperB -> keptJoint
  // の chain がある場合、
  //   keptJointLocal' = helperA * helperB * keptJoint
  // を作るために使う
  // subset skeleton へ helper ancestor を残さず移植するための基礎 helper である
  composeLocalMatrices(localMatrices) {
    if (!localMatrices.length) {
      return new Matrix();
    }
    const composed = localMatrices[localMatrices.length - 1].clone();
    for (let i = localMatrices.length - 2; i >= 0; i--) {
      composed.lmul(localMatrices[i]);
    }
    return composed;
  }

  // animation を考えない静的な default pose で、
  // dropped helper ancestor を child localMatrix へ焼き込んだ結果を返す
  // `buildSkeletonDefs()` で subset skeleton の rest/local pose を作るときに使う
  // 利用者視点では「prune 後 skeleton の初期姿勢が崩れないようにする helper」
  // と理解すればよい
  getCollapsedDefaultLocalMatrix(plan, localIndex) {
    const nodes = this.data.nodes ?? [];
    const skins = this.data.skins ?? [];
    const skin = skins[plan.skinIndex];
    const segment = plan.collapsedSegments.get(localIndex) ?? [localIndex];
    const localMatrices = segment.map((segmentLocalIndex) => {
      const nodeIndex = skin.joints[segmentLocalIndex];
      return this.getNodeLocalMatrix(nodes[nodeIndex]);
    });
    return this.composeLocalMatrices(localMatrices);
  }

  // 1 animation の channels から、今回の subset skeleton に関係する node だけを抜き出す
  // collapse 済み skeleton では helper ancestor 自体は骨として残らないが、
  // その helper の animation は child 側へ焼き込む必要がある
  // そのため「kept joint だけ」ではなく、
  // `collapsedSegments` に含まれる dropped helper も含めて track を収集する
  // AI / 利用者から見ると、
  // 「subset skeleton 用に animation 入力を前処理する helper」である
  buildAnimationNodeTrackMap(animDef, plan) {
    const samplers = animDef.samplers ?? [];
    const nodeTracks = new Map();
    const relevantNodeIndices = new Set();
    const skins = this.data.skins ?? [];
    const skin = skins[plan.skinIndex];
    for (const localIndex of plan.keptLocalIndices) {
      const segment = plan.collapsedSegments.get(localIndex) ?? [localIndex];
      for (const segmentLocalIndex of segment) {
        relevantNodeIndices.add(skin.joints[segmentLocalIndex]);
      }
    }

    for (const channel of animDef.channels ?? []) {
      const nodeIndex = channel.target.node;
      if (!relevantNodeIndices.has(nodeIndex)) continue;
      const sampler = samplers[channel.sampler];
      const input = this.gltf.getAccessorData(sampler.input);
      const output = this.gltf.getAccessorData(sampler.output);
      const normalized = this.normalizeAnimationSamplerTrack(sampler, input, output, channel.target.path);
      if (!nodeTracks.has(nodeIndex)) {
        nodeTracks.set(nodeIndex, { translation: null, rotation: null, scale: null });
      }
      const track = nodeTracks.get(nodeIndex);
      if (channel.target.path === "translation") {
        track.translation = normalized;
      } else if (channel.target.path === "rotation") {
        track.rotation = normalized;
      } else if (channel.target.path === "scale") {
        track.scale = normalized;
      }
    }

    return nodeTracks;
  }

  // 指定時刻における collapse 済み local 行列を返す
  // default pose 用の `getCollapsedDefaultLocalMatrix()` と違い、
  // こちらは animation channel が存在する node では補間値を使い、
  // channel が無い node では glTF の既定 TRS を使う
  // 結果として、
  // 「helper ancestor の animation も child joint 側へまとめて焼き込んだ local pose」
  // を 1 個の Matrix として得られる
  // `buildAnimationDefs()` はこの helper を使って、
  // pruned 後 skeleton 向けの pose 配列を直接生成する
  getCollapsedAnimatedLocalMatrix(plan, localIndex, nodeTracks, time) {
    const nodes = this.data.nodes ?? [];
    const skins = this.data.skins ?? [];
    const skin = skins[plan.skinIndex];
    const segment = plan.collapsedSegments.get(localIndex) ?? [localIndex];
    const localMatrices = segment.map((segmentLocalIndex) => {
      const nodeIndex = skin.joints[segmentLocalIndex];
      const node = nodes[nodeIndex] ?? {};
      const track = nodeTracks.get(nodeIndex) ?? {};
      const defaultT = node.translation ?? [0, 0, 0];
      const defaultR = node.rotation ?? [0, 0, 0, 1];
      const defaultS = node.scale ?? [1, 1, 1];
      const trans = track.translation ? this.sampleVec3(track.translation, time) : defaultT;
      const rot = track.rotation ? this.sampleQuat(track.rotation, time) : defaultR;
      const scl = track.scale ? this.sampleVec3(track.scale, time) : defaultS;
      return this.matrixFromTRS(trans, rot, scl);
    });
    return this.composeLocalMatrices(localMatrices);
  }

  // glTF skinから `Skeleton` を構築する
  buildSkeleton(skin) {
    // glTF skin.joints から Skeletonを構築し、必要なら inverseBindMatrix を適用する
    const skeleton = new Skeleton();
    const jointNodes = skin.joints ?? [];
    const parents = this.buildParents();
    const jointSet = new Set(jointNodes);
    const nodes = this.data.nodes ?? [];
    const boneMap = new Map();

    const buildBone = (nodeIndex) => {
      if (boneMap.has(nodeIndex)) return boneMap.get(nodeIndex);
      const parentIndex = parents[nodeIndex];
      let parentBone = null;
      if (parentIndex !== null && jointSet.has(parentIndex)) {
        parentBone = buildBone(parentIndex);
      }
      const node = nodes[nodeIndex];
      const bone = skeleton.addBone(parentBone, node.name ?? `joint_${nodeIndex}`);
      const localMat = this.getNodeLocalMatrix(node);
      bone.setByMatrix(localMat);
      bone.setRestByMatrix(localMat);
      bone.hasWeights = true;
      boneMap.set(nodeIndex, bone);
      return bone;
    };

    for (const jointIndex of jointNodes) {
      buildBone(jointIndex);
    }

    const jointNames = jointNodes.map((idx) => nodes[idx].name ?? `joint_${idx}`);
    skeleton.setBoneOrder(jointNames);
    skeleton.bindRestPose();

    if (skin.inverseBindMatrices !== undefined) {
      const ibmAcc = this.gltf.getAccessorData(skin.inverseBindMatrices);
      for (let i = 0; i < jointNodes.length; i++) {
        const nodeIndex = jointNodes[i];
        const bone = boneMap.get(nodeIndex);
        if (!bone) continue;
        const mat = new Matrix();
        mat.setBulkWithOffset(ibmAcc.data, i * 16);
        bone.bofMatrix.copyFrom(mat);
      }
    }

    return skeleton;
  }

  // glTF skin を ModelAsset skeleton 配列へ変換する
  buildSkeletonDefs(skinPlans = new Map(), bakePlans = new Map()) {
    const skins = this.data.skins ?? [];
    const nodes = this.data.nodes ?? [];
    const parents = this.buildParents();
    const defs = [];

    for (const plan of skinPlans.values()) {
      const skin = skins[plan.skinIndex];
      if (!skin) continue;
      const joints = [];
      const nodeToJoint = new Map();

      for (let i = 0; i < plan.keptLocalIndices.length; i++) {
        const localIndex = plan.keptLocalIndices[i];
        nodeToJoint.set(skin.joints[localIndex], i);
      }

      let inverseBind = null;
      if (skin.inverseBindMatrices !== undefined) {
        inverseBind = this.gltf.getAccessorData(skin.inverseBindMatrices).data;
      }

      for (let i = 0; i < plan.keptLocalIndices.length; i++) {
        const localIndex = plan.keptLocalIndices[i];
        const nodeIndex = skin.joints[localIndex];
        const node = nodes[nodeIndex] ?? {};
        // direct parent が dropped helper だった場合は、
        // 「次に残っている kept ancestor」を parent として採用する
        // localMatrix 側には dropped helper 分をすでに焼き込むため、
        // subset skeleton 上ではこの親子関係で整合が取れる
        const parentLocalIndex = plan.parentKeptLocalIndices.get(localIndex);
        const parentJoint = parentLocalIndex !== null && parentLocalIndex !== undefined
          ? nodeToJoint.get(skin.joints[parentLocalIndex]) ?? null
          : null;
        const localMatrixObj = this.getCollapsedDefaultLocalMatrix(plan, localIndex);
        const bake = bakePlans.get(plan.key) ?? null;
        if (bake?.apply && parentJoint === null) {
          localMatrixObj.lmul(bake.bakeMatrix);
        }
        const localMatrix = localMatrixObj.mat.slice();
        const joint = {
          name: node.name ?? `joint_${nodeIndex}`,
          parent: parentJoint,
          localMatrix
        };
        if (inverseBind) {
          const inverseBindMatrix = new Matrix();
          inverseBindMatrix.setBulkWithOffset(inverseBind, localIndex * 16);
          if (bake?.apply) {
            inverseBindMatrix.mul(bake.inverseBakeMatrix);
          }
          joint.inverseBindMatrix = inverseBindMatrix.mat.slice();
        }
        joints.push(joint);
      }

      defs.push({
        id: plan.skeletonId,
        joints,
        meta: {
          sourceSkin: plan.skinIndex,
          weightedJointCount: plan.weightedJointCount,
          requiredJointCount: plan.requiredJointCount,
          deformJointCount: plan.deformJointCount,
          originalJointCount: plan.originalJointCount,
          helperJointCount: plan.helperJointCount,
          weightedHelperCount: plan.weightedHelperCount,
          ancestorOnlyHelperCount: plan.ancestorOnlyHelperCount,
          droppedHelperAncestorCount: plan.droppedHelperAncestorCount,
          weightedHelperSample: plan.weightedHelperSample,
          ancestorOnlyHelperSample: plan.ancestorOnlyHelperSample,
          rigifyLike: plan.rigifyLike,
          keptLocalIndices: [...plan.keptLocalIndices],
          staticBake: (() => {
            const bake = bakePlans.get(plan.key) ?? null;
            if (!bake?.apply) {
              return null;
            }
            return {
              type: "skinned-node-world",
              sourceNode: bake.nodeIndex,
              uniformScale: bake.uniformScale
            };
          })()
        }
      });
    }

    return defs;
  }

  // animationチャンネルを `Animation` 群に変換する
  buildAnimations(skeleton) {
    const animations = this.data.animations ?? [];
    if (!animations.length) return [];
    const nodes = this.data.nodes ?? [];
    const jointNameToIndex = new Map();
    const nameToNode = new Map();
    nodes.forEach((node, idx) => {
      const name = node.name ?? `joint_${idx}`;
      nameToNode.set(name, node);
    });
    skeleton.boneOrder.forEach((bone, idx) => {
      jointNameToIndex.set(bone.name, idx);
    });

    const result = [];

    for (let a = 0; a < animations.length; a++) {
      const animDef = animations[a];
      const channels = animDef.channels ?? [];
      const samplers = animDef.samplers ?? [];

      const jointTracks = new Map();
      const timesSet = new Set();

      for (const channel of channels) {
        const sampler = samplers[channel.sampler];
        const input = this.gltf.getAccessorData(sampler.input);
        const output = this.gltf.getAccessorData(sampler.output);
        const normalized = this.normalizeAnimationSamplerTrack(sampler, input, output, channel.target.path);
        const nodeIndex = channel.target.node;
        const nodeName = nodes[nodeIndex]?.name ?? `joint_${nodeIndex}`;
        if (!jointNameToIndex.has(nodeName)) continue;
        if (!jointTracks.has(nodeName)) {
          jointTracks.set(nodeName, { translation: null, rotation: null, scale: null });
        }
        const track = jointTracks.get(nodeName);
        if (channel.target.path === "translation") {
          track.translation = normalized;
        } else if (channel.target.path === "rotation") {
          track.rotation = normalized;
        } else if (channel.target.path === "scale") {
          track.scale = normalized;
        }
        for (let i = 0; i < input.count; i++) {
          timesSet.add(input.data[i]);
        }
      }

      const times = Array.from(timesSet).sort((a, b) => a - b);
      if (times.length === 0) {
        continue;
      }
      const anim = new Animation(animDef.name ?? `anim_${a}`);
      anim.setTimes(times);

      for (const bone of skeleton.boneOrder) {
        const track = jointTracks.get(bone.name) ?? {};
        const defaultNode = nameToNode.get(bone.name) ?? {};
        const defaultT = defaultNode.translation ?? [0, 0, 0];
        const defaultR = defaultNode.rotation ?? [0, 0, 0, 1];
        const defaultS = defaultNode.scale ?? [1, 1, 1];

        const poses = [];
        for (const t of times) {
          const trans = track.translation ? this.sampleVec3(track.translation, t) : defaultT;
          const rot = track.rotation ? this.sampleQuat(track.rotation, t) : defaultR;
          const scl = track.scale ? this.sampleVec3(track.scale, t) : defaultS;
          const mat = this.matrixFromTRS(trans, rot, scl);
          poses.push(mat);
        }
        anim.addBoneName(bone.name);
        anim.setBonePoses(poses);
      }

      anim.setData(skeleton, new Matrix());
      result.push(anim);
    }

    return result;
  }

  // glTF animation を ModelAsset animation 配列へ変換する
  // skin 全体の joint 群ではなく、`buildSkinUsagePlans()` が作った
  // primitive 専用 subset skeleton ごとに animation を再構成する
  // helper ancestor を prune した場合でも見た目を保つため、
  // child pose に helper 側の変換を焼き込んだ pose 列をここで作る
  buildAnimationDefs(skeletons, skinPlans = new Map(), bakePlans = new Map()) {
    const animations = this.data.animations ?? [];
    if (!animations.length || !skeletons.length) return [];

    const nodes = this.data.nodes ?? [];
    const planBySkeletonId = new Map();
    for (const plan of skinPlans.values()) {
      planBySkeletonId.set(plan.skeletonId, plan);
    }

    const result = [];
    for (let s = 0; s < skeletons.length; s++) {
      const skeleton = skeletons[s];
      const plan = planBySkeletonId.get(skeleton.id);
      if (!plan) continue;

      for (let a = 0; a < animations.length; a++) {
        const animDef = animations[a];
        const nodeTracks = this.buildAnimationNodeTrackMap(animDef, plan);
        const timesSet = new Set();

        for (const track of nodeTracks.values()) {
          for (const channelTrack of [track.translation, track.rotation, track.scale]) {
            if (!channelTrack) continue;
            for (let i = 0; i < channelTrack.input.count; i++) {
              timesSet.add(channelTrack.input.data[i]);
            }
          }
        }

        const times = Array.from(timesSet).sort((x, y) => x - y);
        if (!times.length) continue;

        const tracks = [];
        for (let j = 0; j < skeleton.joints.length; j++) {
          const joint = skeleton.joints[j];
          const localIndex = plan.keptLocalIndices[j];
          const poses = [];
          const bake = bakePlans.get(plan.key) ?? null;

          for (let t = 0; t < times.length; t++) {
            const time = times[t];
            const pose = this.getCollapsedAnimatedLocalMatrix(plan, localIndex, nodeTracks, time);
            if (bake?.apply && joint.parent === null) {
              pose.lmul(bake.bakeMatrix);
            }
            poses.push(pose.mat.slice());
          }

          tracks.push({
            joint: joint.name,
            poses
          });
        }

        result.push({
          id: `${animDef.name ?? `anim_${a}`}_${skeleton.id}`,
          targetSkeleton: skeleton.id,
          interpolation: "step",
          times,
          tracks
        });
      }
    }

    return result;
  }

  // sampler の補間モード差を吸収し、sample 側が扱いやすい track に変換する
  // CUBICSPLINE は tangent を捨てて middle value だけ抜き出し、
  // 以後の処理では LINEAR と同じ入出力レイアウトにそろえる
  normalizeAnimationSamplerTrack(sampler, input, output, targetPath = "") {
    const interpolation = String(sampler?.interpolation ?? "LINEAR").toUpperCase();
    if (interpolation !== "CUBICSPLINE") {
      return {
        input,
        output,
        interpolation
      };
    }

    const keyCount = input?.count ?? 0;
    const componentCount = output?.numComponents ?? (targetPath === "rotation" ? 4 : 3);
    const source = output?.data;
    const TypedArrayCtor = source?.constructor ?? Float32Array;
    const valueData = new TypedArrayCtor(keyCount * componentCount);
    const cubicStride = componentCount * 3;

    for (let i = 0; i < keyCount; i++) {
      const sourceOffset = i * cubicStride + componentCount;
      const targetOffset = i * componentCount;
      valueData.set(source.subarray(sourceOffset, sourceOffset + componentCount), targetOffset);
    }

    return {
      input,
      output: {
        ...output,
        data: valueData,
        count: keyCount,
        numComponents: componentCount
      },
      interpolation: "LINEAR",
      sourceInterpolation: "CUBICSPLINE"
    };
  }

  // mesh defs と skeleton defs から node 定義を生成する
  buildNodeDefs(meshes, skeletons, animations, bakePlans = new Map()) {
    const nodes = this.data.nodes ?? [];
    const meshByNode = new Map();
    const parents = this.buildParents();
    const normalizedTransforms = this.buildNodeTransforms({ normalizeOrigin: true });
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (!meshByNode.has(mesh._gltfNodeIndex)) {
        meshByNode.set(mesh._gltfNodeIndex, []);
      }
      meshByNode.get(mesh._gltfNodeIndex).push(mesh);
    }

    const animationBySkeleton = new Map();
    for (let i = 0; i < animations.length; i++) {
      const anim = animations[i];
      if (!animationBySkeleton.has(anim.targetSkeleton)) {
        animationBySkeleton.set(anim.targetSkeleton, []);
      }
      animationBySkeleton.get(anim.targetSkeleton).push(anim.id);
    }

    const result = [];
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const node = nodes[nodeIndex];
      const nodeMeshes = meshByNode.get(nodeIndex) ?? [];
      const structuralNodeId = `node_${nodeIndex}`;
      const parentId = parents[nodeIndex] !== null ? `node_${parents[nodeIndex]}` : null;
      const nodeBake = bakePlans.get(`static:${nodeIndex}`) ?? null;
      const hasSkinnedBake = nodeMeshes.some((mesh) => {
        if (!mesh.skeleton) {
          return false;
        }
        const planKey = this.buildSkinPlanKey(nodeIndex, mesh._gltfPrimitiveIndex ?? 0);
        return !!bakePlans.get(planKey)?.apply;
      });
      const structuralMatrix = hasSkinnedBake
        ? new Matrix()
        : nodeBake?.apply
          ? nodeBake.rigidMatrix
          : normalizedTransforms[nodeIndex];

      result.push({
        id: structuralNodeId,
        name: node.name ?? `node_${nodeIndex}`,
        parent: parentId,
        mesh: null,
        skeleton: null,
        animationBindings: [],
        matrix: structuralMatrix.mat.slice(),
        gltfNodeIndex: nodeIndex,
        gltfSkinIndex: null,
        meta: hasSkinnedBake
          ? { staticBake: "skinned-node-world" }
          : nodeBake?.apply
            ? {
              staticBake: "static-uniform-scale",
              bakedUniformScale: nodeBake.uniformScale
            }
            : undefined
      });

      for (let m = 0; m < nodeMeshes.length; m++) {
        const mesh = nodeMeshes[m];
        const skeletonId = mesh.skeleton ?? undefined;
        result.push({
          id: `node_${nodeIndex}_mesh_${m}`,
          name: mesh.name ? `${mesh.name}` : `mesh_${nodeIndex}_${m}`,
          parent: structuralNodeId,
          mesh: mesh.id,
          skeleton: skeletonId,
          animationBindings: skeletonId ? (animationBySkeleton.get(skeletonId) ?? []) : [],
          matrix: undefined,
          transform: {
            translation: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1]
          },
          gltfNodeIndex: nodeIndex,
          gltfSkinIndex: mesh._gltfSkinIndex
        });
      }
    }
    return result;
  }

  // ベクトルトラックを時刻補間する
  sampleVec3(track, time) {
    const input = track.input.data;
    const output = track.output.data;
    const count = track.input.count;
    if (time <= input[0]) {
      return [output[0], output[1], output[2]];
    }
    if (time >= input[count - 1]) {
      const o = (count - 1) * 3;
      return [output[o], output[o + 1], output[o + 2]];
    }
    let idx = 0;
    for (let i = 0; i < count - 1; i++) {
      if (time >= input[i] && time <= input[i + 1]) {
        idx = i;
        break;
      }
    }
    const t0 = input[idx];
    const t1 = input[idx + 1];
    const f = (time - t0) / (t1 - t0);
    const o0 = idx * 3;
    const o1 = (idx + 1) * 3;
    return [
      output[o0] + (output[o1] - output[o0]) * f,
      output[o0 + 1] + (output[o1 + 1] - output[o0 + 1]) * f,
      output[o0 + 2] + (output[o1 + 2] - output[o0 + 2]) * f
    ];
  }

  // 回転トラックを時刻補間する
  sampleQuat(track, time) {
    const input = track.input.data;
    const output = track.output.data;
    const count = track.input.count;
    if (time <= input[0]) {
      return [output[0], output[1], output[2], output[3]];
    }
    if (time >= input[count - 1]) {
      const o = (count - 1) * 4;
      return [output[o], output[o + 1], output[o + 2], output[o + 3]];
    }
    let idx = 0;
    for (let i = 0; i < count - 1; i++) {
      if (time >= input[i] && time <= input[i + 1]) {
        idx = i;
        break;
      }
    }
    const t0 = input[idx];
    const t1 = input[idx + 1];
    const f = (time - t0) / (t1 - t0);
    const o0 = idx * 4;
    const o1 = (idx + 1) * 4;
    const q0 = new Quat();
    const q1 = new Quat();
    q0.q = [output[o0 + 3], output[o0], output[o0 + 1], output[o0 + 2]];
    q1.q = [output[o1 + 3], output[o1], output[o1 + 1], output[o1 + 2]];
    const q = new Quat();
    q.slerp(q0, q1, f);
    return [q.q[1], q.q[2], q.q[3], q.q[0]];
  }

  // TRSから行列を生成する
  matrixFromTRS(translation, rotation, scale) {
    const q = new Quat();
    q.q = [rotation[3], rotation[0], rotation[1], rotation[2]];
    const m = new Matrix();
    m.setByQuat(q);
    m.mat[0] *= scale[0];
    m.mat[1] *= scale[0];
    m.mat[2] *= scale[0];
    m.mat[4] *= scale[1];
    m.mat[5] *= scale[1];
    m.mat[6] *= scale[1];
    m.mat[8] *= scale[2];
    m.mat[9] *= scale[2];
    m.mat[10] *= scale[2];
    m.position(translation);
    return m;
  }
}
