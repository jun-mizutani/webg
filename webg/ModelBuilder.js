// ---------------------------------------------
//  ModelBuilder.js  2026/04/20
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shape from "./Shape.js";
import Skeleton from "./Skeleton.js";
import Matrix from "./Matrix.js";
import Quat from "./Quat.js";
import Animation from "./Animation.js";
import ModelValidator from "./ModelValidator.js";

function destroyShapeList(shapes, options = {}) {
  let destroyedCount = 0;
  if (!Array.isArray(shapes)) {
    return destroyedCount;
  }
  for (let i = 0; i < shapes.length; i++) {
    if (shapes[i]?.destroy?.(options)) {
      destroyedCount++;
    }
  }
  return destroyedCount;
}

function destroyShapeResourceList(shapeResources) {
  let destroyedCount = 0;
  if (!Array.isArray(shapeResources)) {
    return destroyedCount;
  }
  for (let i = 0; i < shapeResources.length; i++) {
    if (shapeResources[i]?.destroy?.({ force: true })) {
      destroyedCount++;
    }
  }
  return destroyedCount;
}

export default class ModelBuilder {

  // ModelAsset から runtime オブジェクトを組み立てる
  constructor(gpu) {
    // Shape / Skeleton / Animation 生成を 1 箇所にまとめる
    this.gpu = gpu;
    this.validator = new ModelValidator();
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

  // 4x4 数値配列を Matrix に変換する
  matrixFromArray(values) {
    const mat = new Matrix();
    mat.setBulk(values);
    return mat;
  }

  // TRS 定義を Matrix に変換する
  matrixFromTransform(transform = {}) {
    const translation = transform.translation ?? [0, 0, 0];
    const rotation = transform.rotation ?? [0, 0, 0, 1];
    const scale = transform.scale ?? [1, 1, 1];
    const quat = new Quat();
    const mat = new Matrix();

    quat.q = [rotation[3], rotation[0], rotation[1], rotation[2]];
    mat.setByQuat(quat);
    mat.mat[0] *= scale[0];
    mat.mat[1] *= scale[0];
    mat.mat[2] *= scale[0];
    mat.mat[4] *= scale[1];
    mat.mat[5] *= scale[1];
    mat.mat[6] *= scale[1];
    mat.mat[8] *= scale[2];
    mat.mat[9] *= scale[2];
    mat.mat[10] *= scale[2];
    mat.position(translation);
    return mat;
  }

  // geometry から Shape の CPU 側配列を組み立てる
  createBaseShape(mesh, material) {
    const geometry = mesh.geometry;
    const shape = new Shape(this.gpu);
    const positions = geometry.positions;
    const normals = geometry.normals ?? null;
    const uvs = geometry.uvs ?? null;
    const indices = geometry.indices;

    shape.setName(mesh.name ?? mesh.id ?? "mesh");
    shape.vertexCount = geometry.vertexCount ?? (positions.length / 3);
    shape.primitiveCount = geometry.polygonCount ?? Math.floor(indices.length / 3);
    shape.positionArray = positions.slice();
    shape.indicesArray = indices.slice();
    shape.normalArray = normals ? normals.slice() : new Array(shape.vertexCount * 3).fill(0);
    shape.texCoordsArray = uvs ? uvs.slice() : new Array(shape.vertexCount * 2).fill(0);
    shape.altVertices = geometry.altVertices ? geometry.altVertices.slice() : [];
    shape.setAutoCalcNormals(!normals);

    if (material) {
      shape.setMaterial(material.id, material.shaderParams ?? {});
    }

    for (let i = 0; i < positions.length; i += 3) {
      shape.updateBoundingBox(positions[i], positions[i + 1], positions[i + 2]);
    }

    if (!normals) {
      this.computeNormals(shape);
    }

    return shape;
  }

  // 同じ mesh resource を共有できる key を返す
  getSharedShapeKey(mesh) {
    if (!mesh) {
      return null;
    }
    const base = mesh.id ?? mesh.name ?? null;
    if (!base) {
      return null;
    }
    return `${base}|skin=${mesh.skin ? 1 : 0}`;
  }

  // 面法線を加算し、共有頂点の法線を平均化する
  computeNormals(shape) {
    const normals = new Float32Array(shape.vertexCount * 3);
    const indices = shape.indicesArray;
    const positions = shape.positionArray;

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3;
      const i1 = indices[i + 1] * 3;
      const i2 = indices[i + 2] * 3;
      const ax = positions[i1] - positions[i0];
      const ay = positions[i1 + 1] - positions[i0 + 1];
      const az = positions[i1 + 2] - positions[i0 + 2];
      const bx = positions[i2] - positions[i0];
      const by = positions[i2 + 1] - positions[i0 + 1];
      const bz = positions[i2 + 2] - positions[i0 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;

      normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
      normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
      normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
    }

    // UV seam やドーナツ断面の閉じ目では、同一点が複数頂点へ分かれている
    // 1 組ずつではなく altVertices で連結した頂点群全体をまとめて合算し、
    // その後で正規化すると継ぎ目の陰影が揃いやすい
    if (shape.altVertices.length > 0) {
      const parent = new Map();
      const touch = (index) => {
        if (!parent.has(index)) {
          parent.set(index, index);
        }
      };
      const find = (index) => {
        let root = parent.get(index);
        while (root !== parent.get(root)) {
          root = parent.get(root);
        }
        let current = index;
        while (current !== root) {
          const next = parent.get(current);
          parent.set(current, root);
          current = next;
        }
        return root;
      };
      const unite = (a, b) => {
        touch(a);
        touch(b);
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) {
          parent.set(rb, ra);
        }
      };

      for (let i = 0; i < shape.altVertices.length; i += 2) {
        unite(shape.altVertices[i], shape.altVertices[i + 1]);
      }

      const sums = new Map();
      for (const index of parent.keys()) {
        const root = find(index);
        const base = index * 3;
        const current = sums.get(root) ?? [0.0, 0.0, 0.0];
        current[0] += normals[base];
        current[1] += normals[base + 1];
        current[2] += normals[base + 2];
        sums.set(root, current);
      }

      for (const index of parent.keys()) {
        const root = find(index);
        const base = index * 3;
        const sum = sums.get(root);
        normals[base] = sum[0];
        normals[base + 1] = sum[1];
        normals[base + 2] = sum[2];
      }
    }

    for (let i = 0; i < normals.length; i += 3) {
      const x = normals[i];
      const y = normals[i + 1];
      const z = normals[i + 2];
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      shape.normalArray[i] = x / len;
      shape.normalArray[i + 1] = y / len;
      shape.normalArray[i + 2] = z / len;
    }
  }

  // skeleton 定義から Skeleton を生成する
  buildSkeleton(skeletonDef) {
    const skeleton = new Skeleton();
    const bones = [];

    for (let i = 0; i < skeletonDef.joints.length; i++) {
      const joint = skeletonDef.joints[i];
      const parent = joint.parent === null || joint.parent === undefined
        ? null
        : bones[joint.parent];
      const bone = skeleton.addBone(parent, joint.name);
      const localMatrix = this.matrixFromArray(joint.localMatrix);
      bone.setByMatrix(localMatrix);
      bone.setRestByMatrix(localMatrix);
      bone.hasWeights = true;
      bones.push(bone);
    }

    // jointOrder がある場合は、スキニング用パレット順をそちらで固定する
    // Collada では全ボーン階層とウェイト参照順が一致しないことがある
    const jointOrder = skeletonDef.jointOrder ?? skeletonDef.joints.map((joint) => joint.name);
    skeleton.setBoneOrder(jointOrder);
    skeleton.bindRestPose();

    for (let i = 0; i < skeletonDef.joints.length; i++) {
      const joint = skeletonDef.joints[i];
      if (joint.inverseBindMatrix) {
        bones[i].bofMatrix.copyFrom(this.matrixFromArray(joint.inverseBindMatrix));
      }
    }

    return skeleton;
  }

  // shape に skin weight を転写する
  applySkin(shape, skin) {
    if (!skin) return;
    const influencesPerVertex = skin.influencesPerVertex ?? 4;
    shape.bindex = Array.from({ length: shape.vertexCount }, () => []);
    shape.weight = Array.from({ length: shape.vertexCount }, () => []);

    for (let vertex = 0; vertex < shape.vertexCount; vertex++) {
      const base = vertex * influencesPerVertex;
      let total = 0;
      for (let j = 0; j < influencesPerVertex; j++) {
        total += skin.jointWeights[base + j];
      }
      if (total <= 0) {
        total = 1;
      }
      for (let j = 0; j < influencesPerVertex; j++) {
        const jointIndex = skin.jointIndices[base + j];
        const weight = skin.jointWeights[base + j] / total;
        if (weight > 0) {
          shape.addVertexWeight(vertex, jointIndex, weight);
        }
      }
    }
    shape.shaderParameter("has_bone", 1);
  }

  // skeleton に対応する animation 群を生成する
  buildAnimations(asset, skeletonId, skeleton, skeletonDef = null) {
    const animations = new Map();
    const bindShapeMatrix = skeletonDef?.bindShapeMatrix
      ? this.matrixFromArray(skeletonDef.bindShapeMatrix)
      : new Matrix();

    for (let i = 0; i < (asset.animations ?? []).length; i++) {
      const animationDef = asset.animations[i];
      if (animationDef.targetSkeleton !== skeletonId) continue;

      const animation = new Animation(animationDef.id ?? `animation_${i}`);
      animation.setTimes(animationDef.times.slice());

      for (let j = 0; j < animationDef.tracks.length; j++) {
        const track = animationDef.tracks[j];
        animation.addBoneName(track.joint);
        animation.setBonePoses(
          track.poses.map((pose) => this.matrixFromArray(pose))
        );
      }

      animation.setData(skeleton, bindShapeMatrix.clone());
      animations.set(animationDef.id, animation);
    }

    return animations;
  }

  // mesh を 1 node 用の Shape に変換する
  buildNodeShape(mesh, material, skeletonDef, options = {}) {
    if (!mesh) {
      return { shape: null, skeleton: null, animations: new Map() };
    }
    const label = options.label ?? mesh.name ?? mesh.id ?? "mesh";
    const resourceCache = options.resourceCache ?? null;
    const sharedShapeKey = this.getSharedShapeKey(mesh);
    const sharedResource = sharedShapeKey ? resourceCache?.get(sharedShapeKey) ?? null : null;
    this.emitStage(options.onStage, `shape-prepare ${label}`);
    const shape = sharedResource
      ? new Shape(sharedResource)
      : this.createBaseShape(mesh, material);
    if (sharedResource && material) {
      shape.setMaterial(material.id, material.shaderParams ?? {});
    }
    shape.debugStageLabel = label;
    shape.debugStageHandler = options.onStage ?? null;
    let skeleton = null;
    let animations = new Map();

    if (mesh.skin && skeletonDef) {
      skeleton = this.buildSkeleton(skeletonDef);
      shape.setSkeleton(skeleton);
      if (!sharedResource) {
        this.applySkin(shape, mesh.skin);
      }
    }

    if (!sharedResource) {
      this.emitStage(options.onStage, `shape-upload ${label} vertices=${shape.vertexCount} triangles=${shape.primitiveCount}`);
      shape.endShape();
      if (sharedShapeKey && resourceCache) {
        resourceCache.set(sharedShapeKey, shape.getResource());
      }
    } else {
      this.emitStage(options.onStage, `shape-share-hit ${label} vertices=${shape.vertexCount} triangles=${shape.primitiveCount}`);
    }
    return { shape, skeleton, animations };
  }

  // ModelAsset 全体を runtime で扱いやすい構造へ変換する
  build(asset) {
    this.validator.assertValid(asset);
    const builder = this;

    const materialDefs = new Map((asset.materials ?? []).map((item) => [item.id, item]));
    const meshDefs = new Map((asset.meshes ?? []).map((item) => [item.id, item]));
    const skeletonDefs = new Map((asset.skeletons ?? []).map((item) => [item.id, item]));
    const builtNodes = [];
    const builtShapes = [];
    const nodeMap = new Map();
    const resourceCache = new Map();
    const clipNames = [...new Set((asset.animations ?? []).map((item) => item.id))];

    for (let i = 0; i < asset.nodes.length; i++) {
      const nodeDef = asset.nodes[i];
      const mesh = nodeDef.mesh ? meshDefs.get(nodeDef.mesh) : null;
      const material = mesh?.material ? materialDefs.get(mesh.material) : null;
      const skeletonDef = nodeDef.skeleton ? skeletonDefs.get(nodeDef.skeleton) : null;
      const built = this.buildNodeShape(mesh, material, skeletonDef, {
        resourceCache
      });
      const localMatrix = nodeDef.matrix
        ? this.matrixFromArray(nodeDef.matrix)
        : this.matrixFromTransform(nodeDef.transform ?? {});

      const nodeInfo = {
        id: nodeDef.id,
        name: nodeDef.name ?? nodeDef.id,
        parent: nodeDef.parent ?? null,
        meshId: mesh?.id ?? null,
        gltfNodeIndex: nodeDef.gltfNodeIndex,
        gltfSkinIndex: nodeDef.gltfSkinIndex,
        colladaMeshIndex: nodeDef.colladaMeshIndex,
        shape: built.shape,
        shapeTemplate: built.shape,
        skeleton: null,
        skeletonId: nodeDef.skeleton ?? null,
        skeletonDef,
        animations: new Map(),
        animationBindings: (nodeDef.animationBindings ?? []).slice(),
        transform: {
          translation: [...(nodeDef.transform?.translation ?? [0, 0, 0])],
          rotation: [...(nodeDef.transform?.rotation ?? [0, 0, 0, 1])],
          scale: [...(nodeDef.transform?.scale ?? [1, 1, 1])]
        },
        localMatrix
      };

      builtNodes.push(nodeInfo);
      if (built.shape) {
        builtShapes.push(built.shape);
      }
      nodeMap.set(nodeInfo.id, nodeInfo);
    }

    for (let i = 0; i < builtNodes.length; i++) {
      const node = builtNodes[i];
      node.children = builtNodes.filter((child) => child.parent === node.id);
    }

    const shapeResources = [...resourceCache.values()];
    let activeInstantiation = null;
    const liveInstantiations = new Set();
    let runtime = null;

    const createInstantiationFacade = (
      space,
      createdNodeMap,
      shapes,
      animationMap,
      bindingEntries,
      rootNodes
    ) => {
      const instantiation = {
        nodeMap: createdNodeMap,
        shapes,
        shapeInstances: shapes,
        animationMap,
        space,
        rootNodes,
        isDestroyed: false,
        getAnimation(id) {
          return animationMap.get(String(id ?? "")) ?? null;
        },
        getAnimationNames() {
          return [...animationMap.keys()];
        },
        bindAnimationBindings() {
          let boundCount = 0;
          for (let i = 0; i < bindingEntries.length; i++) {
            const entry = bindingEntries[i];
            if (!entry?.shape || entry.animationBindings.length === 0) {
              continue;
            }
            const animation = entry.animationMap.get(entry.animationBindings[0]);
            if (!animation) {
              continue;
            }
            entry.shape.setAnimation(animation);
            boundCount++;
          }
          return boundCount;
        },
        startAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return null;
          animation.start();
          return animation;
        },
        restartAnimation(id) {
          return this.startAnimation(id);
        },
        playAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return -1;
          return animation.play();
        },
        startAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].start();
          }
          return list.length;
        },
        restartAllAnimations() {
          return this.startAllAnimations();
        },
        playAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].play();
          }
          return list.length;
        },
        pauseAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return null;
          animation.schedule.pause = true;
          return animation;
        },
        resumeAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return null;
          animation.schedule.pause = false;
          return animation;
        },
        pauseAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].schedule.pause = true;
          }
          return list.length;
        },
        resumeAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].schedule.pause = false;
          }
          return list.length;
        },
        setAnimationsPaused(paused) {
          return paused ? this.pauseAllAnimations() : this.resumeAllAnimations();
        },
        destroy(options = {}) {
          if (this.isDestroyed) {
            return 0;
          }
          this.setAnimationsPaused(true);
          const destroyShapes = options.destroyShapes === true;
          if (this.space && Array.isArray(this.rootNodes)) {
            for (let i = 0; i < this.rootNodes.length; i++) {
              this.space.removeNodeTree(this.rootNodes[i], {
                destroyShapes: false
              });
            }
          }
          const destroyedShapeCount = destroyShapeList(this.shapes, {
            destroyResource: destroyShapes
          });
          this.rootNodes = [];
          this.nodeMap.clear();
          this.animationMap.clear();
          this.shapes.length = 0;
          this.shapeInstances = this.shapes;
          this.isDestroyed = true;
          liveInstantiations.delete(this);
          if (activeInstantiation === this) {
            activeInstantiation = null;
            if (runtime) {
              runtime.shapes = builtShapes;
            }
          }
          return destroyedShapeCount;
        }
      };
      liveInstantiations.add(instantiation);
      return instantiation;
    };

    const instantiateRuntime = (space, options = {}) => {
      const { bindAnimations = true, setActive = true } = options;
      const createdNodeMap = new Map();
      const instantiatedShapes = [];
      const instantiatedAnimationMap = new Map();
      const bindingEntries = [];

      const makeNode = (nodeInfo) => {
        if (createdNodeMap.has(nodeInfo.id)) {
          return createdNodeMap.get(nodeInfo.id);
        }
        const parentInfo = nodeInfo.parent ? nodeMap.get(nodeInfo.parent) : null;
        const parentNode = parentInfo ? makeNode(parentInfo) : null;
        const node = space.addNode(parentNode, nodeInfo.name);
        node.setByMatrix(nodeInfo.localMatrix);

        if (nodeInfo.shapeTemplate) {
          const shapeInstance = nodeInfo.shapeTemplate.createInstance();
          let nodeAnimations = new Map();
          if (nodeInfo.skeletonId && nodeInfo.skeletonDef) {
            const skeleton = builder.buildSkeleton(nodeInfo.skeletonDef);
            shapeInstance.setSkeleton(skeleton);
            nodeAnimations = builder.buildAnimations(
              asset,
              nodeInfo.skeletonId,
              skeleton,
              nodeInfo.skeletonDef
            );
            for (const [animationId, animation] of nodeAnimations.entries()) {
              if (!instantiatedAnimationMap.has(animationId)) {
                instantiatedAnimationMap.set(animationId, animation);
              }
            }
          }
          node.addShape(shapeInstance);
          instantiatedShapes.push(shapeInstance);
          bindingEntries.push({
            shape: shapeInstance,
            animationMap: nodeAnimations,
            animationBindings: [...nodeInfo.animationBindings]
          });
        }

        createdNodeMap.set(nodeInfo.id, node);
        return node;
      };

      for (let i = 0; i < builtNodes.length; i++) {
        makeNode(builtNodes[i]);
      }

      const rootNodes = builtNodes
        .filter((nodeInfo) => nodeInfo.parent === null)
        .map((nodeInfo) => createdNodeMap.get(nodeInfo.id))
        .filter((node) => !!node);
      const instantiated = createInstantiationFacade(
        space,
        createdNodeMap,
        instantiatedShapes,
        instantiatedAnimationMap,
        bindingEntries,
        rootNodes
      );
      instantiated.boundAnimations = bindAnimations
        ? instantiated.bindAnimationBindings()
        : 0;

      if (setActive) {
        activeInstantiation = instantiated;
        runtime.shapes = instantiated.shapes;
      }
      return instantiated;
    };

    runtime = {
      materialDefs,
      meshDefs,
      skeletonDefs,
      animationMap: new Map(),
      nodes: builtNodes,
      nodeMap,
      templateShapes: builtShapes,
      shapes: builtShapes,
      shapeResources,
      instantiations: liveInstantiations,
      isDestroyed: false,
      // runtime node 定義を Space / Node ツリーへ復元する
      createNodeTree(space) {
        // loader sample ごとに重複していた node 再構築処理を
        // build() 結果側へ集約し、asset 種別差を sample から隠す
        console.assert(!this.isDestroyed, "runtime.createNodeTree() requires a live runtime");
        if (this.isDestroyed) {
          return null;
        }
        return instantiateRuntime(space, {
          bindAnimations: false,
          setActive: true
        }).nodeMap;
      },
      // node 側の animation binding 情報を shape へ関連付ける
      bindAnimationBindings() {
        return activeInstantiation?.bindAnimationBindings?.() ?? 0;
      },
      // Space への配置と animation binding をまとめて行う
      instantiate(space, options = {}) {
        // loader sample 側では「配置して使える状態へする」ことが多いため、
        // createNodeTree と bindAnimationBindings を 1 手で呼べる入口を用意する
        console.assert(!this.isDestroyed, "runtime.instantiate() requires a live runtime");
        if (this.isDestroyed) {
          return null;
        }
        return instantiateRuntime(space, {
          bindAnimations: options.bindAnimations !== false,
          setActive: true
        });
      },
      // clip id から runtime Animation を引く高レベル helper
      getAnimation(id) {
        return activeInstantiation?.getAnimation?.(id) ?? null;
      },
      // build 結果に含まれる clip id 一覧を返す
      getAnimationNames() {
        return activeInstantiation?.getAnimationNames?.() ?? [...clipNames];
      },
      // 指定 clip の runtime Animation を開始する
      startAnimation(id) {
        return activeInstantiation?.startAnimation?.(id) ?? null;
      },
      // 指定 clip の runtime Animation を先頭から再始動する
      restartAnimation(id) {
        return this.startAnimation(id);
      },
      // 指定 clip の runtime Animation を 1 ステップ進める
      playAnimation(id) {
        return activeInstantiation?.playAnimation?.(id) ?? -1;
      },
      // すべての runtime Animation を開始する
      startAllAnimations() {
        return activeInstantiation?.startAllAnimations?.() ?? 0;
      },
      // すべての runtime Animation を先頭から再始動する
      restartAllAnimations() {
        return this.startAllAnimations();
      },
      // すべての runtime Animation を 1 ステップ進める
      playAllAnimations() {
        return activeInstantiation?.playAllAnimations?.() ?? 0;
      },
      // 指定 clip の runtime Animation を一時停止する
      pauseAnimation(id) {
        return activeInstantiation?.pauseAnimation?.(id) ?? null;
      },
      // 指定 clip の runtime Animation を再開する
      resumeAnimation(id) {
        return activeInstantiation?.resumeAnimation?.(id) ?? null;
      },
      // すべての runtime Animation を一時停止する
      pauseAllAnimations() {
        return activeInstantiation?.pauseAllAnimations?.() ?? 0;
      },
      // すべての runtime Animation を再開する
      resumeAllAnimations() {
        return activeInstantiation?.resumeAllAnimations?.() ?? 0;
      },
      // 全 animation の pause 状態を一括設定する
      setAnimationsPaused(paused) {
        return paused ? this.pauseAllAnimations() : this.resumeAllAnimations();
      },
      // runtime が保持している template shape / instantiation / GPUBuffer をまとめて破棄する
      destroy() {
        if (this.isDestroyed) {
          return 0;
        }
        const instantiations = [...liveInstantiations];
        let destroyedCount = 0;
        for (let i = 0; i < instantiations.length; i++) {
          destroyedCount += instantiations[i].destroy({
            destroyShapes: false
          });
        }
        destroyedCount += destroyShapeList(this.templateShapes, {
          destroyResource: false
        });
        destroyShapeResourceList(shapeResources);
        this.templateShapes.length = 0;
        this.shapes = [];
        this.animationMap.clear();
        activeInstantiation = null;
        this.isDestroyed = true;
        return destroyedCount;
      }
    };
    return runtime;
  }

  async buildAsync(asset, options = {}) {
    this.validator.assertValid(asset);
    const builder = this;

    const onStage = options.onStage ?? null;
    const yieldEvery = Number.isInteger(options.yieldEvery)
      ? Math.max(1, options.yieldEvery)
      : 1;

    const materialDefs = new Map((asset.materials ?? []).map((item) => [item.id, item]));
    const meshDefs = new Map((asset.meshes ?? []).map((item) => [item.id, item]));
    const skeletonDefs = new Map((asset.skeletons ?? []).map((item) => [item.id, item]));
    const builtNodes = [];
    const builtShapes = [];
    const nodeMap = new Map();
    const resourceCache = new Map();
    const clipNames = [...new Set((asset.animations ?? []).map((item) => item.id))];
    const totalNodes = asset.nodes.length;

    this.emitStage(onStage, `build-nodes total=${totalNodes}`);
    await this.yieldFrame();

    for (let i = 0; i < asset.nodes.length; i++) {
      const nodeDef = asset.nodes[i];
      const mesh = nodeDef.mesh ? meshDefs.get(nodeDef.mesh) : null;
      const material = mesh?.material ? materialDefs.get(mesh.material) : null;
      const skeletonDef = nodeDef.skeleton ? skeletonDefs.get(nodeDef.skeleton) : null;
      const nodeLabel = nodeDef.name ?? nodeDef.id ?? `node_${i}`;
      this.emitStage(onStage, `build-node ${i + 1}/${totalNodes} ${nodeLabel}`);
      if (i % yieldEvery === 0) {
        await this.yieldFrame();
      }
      const built = this.buildNodeShape(mesh, material, skeletonDef, {
        onStage,
        label: nodeLabel,
        resourceCache
      });
      const localMatrix = nodeDef.matrix
        ? this.matrixFromArray(nodeDef.matrix)
        : this.matrixFromTransform(nodeDef.transform ?? {});

      const nodeInfo = {
        id: nodeDef.id,
        name: nodeDef.name ?? nodeDef.id,
        parent: nodeDef.parent ?? null,
        meshId: mesh?.id ?? null,
        gltfNodeIndex: nodeDef.gltfNodeIndex,
        gltfSkinIndex: nodeDef.gltfSkinIndex,
        colladaMeshIndex: nodeDef.colladaMeshIndex,
        shape: built.shape,
        shapeTemplate: built.shape,
        skeleton: null,
        skeletonId: nodeDef.skeleton ?? null,
        skeletonDef,
        animations: new Map(),
        animationBindings: (nodeDef.animationBindings ?? []).slice(),
        transform: {
          translation: [...(nodeDef.transform?.translation ?? [0, 0, 0])],
          rotation: [...(nodeDef.transform?.rotation ?? [0, 0, 0, 1])],
          scale: [...(nodeDef.transform?.scale ?? [1, 1, 1])]
        },
        localMatrix
      };

      builtNodes.push(nodeInfo);
      if (built.shape) {
        builtShapes.push(built.shape);
      }
      nodeMap.set(nodeInfo.id, nodeInfo);
    }

    this.emitStage(onStage, "link-node-children");
    await this.yieldFrame();
    for (let i = 0; i < builtNodes.length; i++) {
      const node = builtNodes[i];
      node.children = builtNodes.filter((child) => child.parent === node.id);
    }

    const shapeResources = [...resourceCache.values()];
    let activeInstantiation = null;
    const liveInstantiations = new Set();
    let runtime = null;

    const createInstantiationFacade = (
      space,
      createdNodeMap,
      shapes,
      animationMap,
      bindingEntries,
      rootNodes
    ) => {
      const instantiation = {
        nodeMap: createdNodeMap,
        shapes,
        shapeInstances: shapes,
        animationMap,
        space,
        rootNodes,
        isDestroyed: false,
        getAnimation(id) {
          return animationMap.get(String(id ?? "")) ?? null;
        },
        getAnimationNames() {
          return [...animationMap.keys()];
        },
        bindAnimationBindings() {
          let boundCount = 0;
          for (let i = 0; i < bindingEntries.length; i++) {
            const entry = bindingEntries[i];
            if (!entry?.shape || entry.animationBindings.length === 0) {
              continue;
            }
            const animation = entry.animationMap.get(entry.animationBindings[0]);
            if (!animation) {
              continue;
            }
            entry.shape.setAnimation(animation);
            boundCount++;
          }
          return boundCount;
        },
        startAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return null;
          animation.start();
          return animation;
        },
        restartAnimation(id) {
          return this.startAnimation(id);
        },
        playAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return -1;
          return animation.play();
        },
        startAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].start();
          }
          return list.length;
        },
        restartAllAnimations() {
          return this.startAllAnimations();
        },
        playAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].play();
          }
          return list.length;
        },
        pauseAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return null;
          animation.schedule.pause = true;
          return animation;
        },
        resumeAnimation(id) {
          const animation = animationMap.get(String(id ?? ""));
          if (!animation) return null;
          animation.schedule.pause = false;
          return animation;
        },
        pauseAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].schedule.pause = true;
          }
          return list.length;
        },
        resumeAllAnimations() {
          const list = [...animationMap.values()];
          for (let i = 0; i < list.length; i++) {
            list[i].schedule.pause = false;
          }
          return list.length;
        },
        setAnimationsPaused(paused) {
          return paused ? this.pauseAllAnimations() : this.resumeAllAnimations();
        },
        destroy(options = {}) {
          if (this.isDestroyed) {
            return 0;
          }
          this.setAnimationsPaused(true);
          const destroyShapes = options.destroyShapes === true;
          if (this.space && Array.isArray(this.rootNodes)) {
            for (let i = 0; i < this.rootNodes.length; i++) {
              this.space.removeNodeTree(this.rootNodes[i], {
                destroyShapes: false
              });
            }
          }
          const destroyedShapeCount = destroyShapeList(this.shapes, {
            destroyResource: destroyShapes
          });
          this.rootNodes = [];
          this.nodeMap.clear();
          this.animationMap.clear();
          this.shapes.length = 0;
          this.shapeInstances = this.shapes;
          this.isDestroyed = true;
          liveInstantiations.delete(this);
          if (activeInstantiation === this) {
            activeInstantiation = null;
            if (runtime) {
              runtime.shapes = builtShapes;
            }
          }
          return destroyedShapeCount;
        }
      };
      liveInstantiations.add(instantiation);
      return instantiation;
    };

    const instantiateRuntime = (space, instantiateOptions = {}) => {
      const { bindAnimations = true, setActive = true } = instantiateOptions;
      const createdNodeMap = new Map();
      const instantiatedShapes = [];
      const instantiatedAnimationMap = new Map();
      const bindingEntries = [];

      const makeNode = (nodeInfo) => {
        if (createdNodeMap.has(nodeInfo.id)) {
          return createdNodeMap.get(nodeInfo.id);
        }
        const parentInfo = nodeInfo.parent ? nodeMap.get(nodeInfo.parent) : null;
        const parentNode = parentInfo ? makeNode(parentInfo) : null;
        const node = space.addNode(parentNode, nodeInfo.name);
        node.setByMatrix(nodeInfo.localMatrix);

        if (nodeInfo.shapeTemplate) {
          const shapeInstance = nodeInfo.shapeTemplate.createInstance();
          let nodeAnimations = new Map();
          if (nodeInfo.skeletonId && nodeInfo.skeletonDef) {
            const skeleton = builder.buildSkeleton(nodeInfo.skeletonDef);
            shapeInstance.setSkeleton(skeleton);
            nodeAnimations = builder.buildAnimations(
              asset,
              nodeInfo.skeletonId,
              skeleton,
              nodeInfo.skeletonDef
            );
            for (const [animationId, animation] of nodeAnimations.entries()) {
              if (!instantiatedAnimationMap.has(animationId)) {
                instantiatedAnimationMap.set(animationId, animation);
              }
            }
          }
          node.addShape(shapeInstance);
          instantiatedShapes.push(shapeInstance);
          bindingEntries.push({
            shape: shapeInstance,
            animationMap: nodeAnimations,
            animationBindings: [...nodeInfo.animationBindings]
          });
        }

        createdNodeMap.set(nodeInfo.id, node);
        return node;
      };

      for (let i = 0; i < builtNodes.length; i++) {
        makeNode(builtNodes[i]);
      }

      const rootNodes = builtNodes
        .filter((nodeInfo) => nodeInfo.parent === null)
        .map((nodeInfo) => createdNodeMap.get(nodeInfo.id))
        .filter((node) => !!node);
      const instantiated = createInstantiationFacade(
        space,
        createdNodeMap,
        instantiatedShapes,
        instantiatedAnimationMap,
        bindingEntries,
        rootNodes
      );
      instantiated.boundAnimations = bindAnimations
        ? instantiated.bindAnimationBindings()
        : 0;

      if (setActive) {
        activeInstantiation = instantiated;
        runtime.shapes = instantiated.shapes;
      }
      return instantiated;
    };

    this.emitStage(
      onStage,
      `build-complete nodes=${builtNodes.length} shapes=${builtShapes.length} resources=${shapeResources.length}`
    );
    runtime = {
      materialDefs,
      meshDefs,
      skeletonDefs,
      animationMap: new Map(),
      nodes: builtNodes,
      nodeMap,
      templateShapes: builtShapes,
      shapes: builtShapes,
      shapeResources,
      instantiations: liveInstantiations,
      isDestroyed: false,
      createNodeTree(space) {
        console.assert(!this.isDestroyed, "runtime.createNodeTree() requires a live runtime");
        if (this.isDestroyed) {
          return null;
        }
        return instantiateRuntime(space, {
          bindAnimations: false,
          setActive: true
        }).nodeMap;
      },
      bindAnimationBindings() {
        return activeInstantiation?.bindAnimationBindings?.() ?? 0;
      },
      instantiate(space, instantiateOptions = {}) {
        console.assert(!this.isDestroyed, "runtime.instantiate() requires a live runtime");
        if (this.isDestroyed) {
          return null;
        }
        return instantiateRuntime(space, {
          bindAnimations: instantiateOptions.bindAnimations !== false,
          setActive: true
        });
      },
      getAnimation(id) {
        return activeInstantiation?.getAnimation?.(id) ?? null;
      },
      getAnimationNames() {
        return activeInstantiation?.getAnimationNames?.() ?? [...clipNames];
      },
      startAnimation(id) {
        return activeInstantiation?.startAnimation?.(id) ?? null;
      },
      restartAnimation(id) {
        return this.startAnimation(id);
      },
      playAnimation(id) {
        return activeInstantiation?.playAnimation?.(id) ?? -1;
      },
      startAllAnimations() {
        return activeInstantiation?.startAllAnimations?.() ?? 0;
      },
      restartAllAnimations() {
        return this.startAllAnimations();
      },
      playAllAnimations() {
        return activeInstantiation?.playAllAnimations?.() ?? 0;
      },
      pauseAnimation(id) {
        return activeInstantiation?.pauseAnimation?.(id) ?? null;
      },
      resumeAnimation(id) {
        return activeInstantiation?.resumeAnimation?.(id) ?? null;
      },
      pauseAllAnimations() {
        return activeInstantiation?.pauseAllAnimations?.() ?? 0;
      },
      resumeAllAnimations() {
        return activeInstantiation?.resumeAllAnimations?.() ?? 0;
      },
      setAnimationsPaused(paused) {
        return paused ? this.pauseAllAnimations() : this.resumeAllAnimations();
      },
      destroy() {
        if (this.isDestroyed) {
          return 0;
        }
        const instantiations = [...liveInstantiations];
        let destroyedCount = 0;
        for (let i = 0; i < instantiations.length; i++) {
          destroyedCount += instantiations[i].destroy({
            destroyShapes: false
          });
        }
        destroyedCount += destroyShapeList(this.templateShapes, {
          destroyResource: false
        });
        destroyShapeResourceList(shapeResources);
        this.templateShapes.length = 0;
        this.shapes = [];
        this.animationMap.clear();
        activeInstantiation = null;
        this.isDestroyed = true;
        return destroyedCount;
      }
    };
    return runtime;
  }
}
