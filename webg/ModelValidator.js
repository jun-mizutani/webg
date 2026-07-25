// ---------------------------------------------
//  ModelValidator.js  2026/03/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { DEFAULT_MAX_SKIN_BONES } from "./SkinningConfig.js";

export default class ModelValidator {

  // ModelAsset の妥当性検証器を初期化する
  constructor() {
    // errors は build を止める不整合を蓄積する
    // warnings は build 自体は続行できるが、設計方針とのズレや
    // 将来の不具合要因になりやすい点を補足する
    this.errors = [];
    this.warnings = [];
  }

  // Array であることを確認し、後続検証へ渡す
  ensureArray(value, path, label) {
    // この validator では配列前提の項目が多いため、
    // まず入口で型をそろえてから個別の長さや内容を確認する
    if (!Array.isArray(value)) {
      this.addError(path, `${label} must be an array`);
      return null;
    }
    return value;
  }

  // エラーを追加する
  addError(path, message) {
    this.errors.push({ path, message });
  }

  // 警告を追加する
  addWarning(path, message) {
    this.warnings.push({ path, message });
  }

  // 汎用の条件確認を行い、失敗時はエラーへ積む
  expect(condition, path, message) {
    if (!condition) {
      this.addError(path, message);
      return false;
    }
    return true;
  }

  // 数値配列として使えるかを確認する
  validateNumberArray(array, path, label) {
    // geometry や matrix はすべて数値配列として保存されるため、
    // 内容に NaN や文字列が混ざると後段の build が壊れる
    const list = this.ensureArray(array, path, label);
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] !== "number" || Number.isNaN(list[i])) {
        this.addError(`${path}[${i}]`, `${label} must contain only finite numbers`);
        return null;
      }
    }
    return list;
  }

  // id 一覧を集め、参照解決用の Set を作る
  buildIdSet(items, path, label) {
    // materials / meshes / skeletons / animations は相互参照するため、
    // 先に重複なし id 集合を作っておくと後段の存在確認が簡単になる
    const ids = new Set();
    if (!Array.isArray(items)) return ids;
    for (let i = 0; i < items.length; i++) {
      const id = items[i]?.id;
      if (typeof id !== "string" || id.length === 0) {
        this.addError(`${path}[${i}].id`, `${label} id must be a non-empty string`);
        continue;
      }
      if (ids.has(id)) {
        this.addError(`${path}[${i}].id`, `${label} id "${id}" is duplicated`);
        continue;
      }
      ids.add(id);
    }
    return ids;
  }

  // 1 mesh 分の geometry 定義を検証する
  validateGeometry(geometry, path) {
    // ModelAsset では geometry は
    //   positions: 頂点ごとに xyz の3要素
    //   normals:   頂点ごとに xyz の3要素
    //   uvs:       頂点ごとに uv の2要素
    //   indices:   3要素ごとに1三角形
    // という前提で扱う
    if (!geometry || typeof geometry !== "object") {
      this.addError(path, "geometry must be an object");
      return;
    }

    const positions = this.validateNumberArray(
      geometry.positions,
      `${path}.positions`,
      "positions"
    );
    const normals = geometry.normals === undefined ? null : this.validateNumberArray(
      geometry.normals,
      `${path}.normals`,
      "normals"
    );
    const uvs = geometry.uvs === undefined ? null : this.validateNumberArray(
      geometry.uvs,
      `${path}.uvs`,
      "uvs"
    );
    const indices = this.validateNumberArray(
      geometry.indices,
      `${path}.indices`,
      "indices"
    );

    // positions と indices は Shape 構築の最小必須情報なので、
    // どちらかが壊れている場合は以降の詳細検証を省略する
    if (!positions || !indices) return;

    // 頂点配列と面配列の基本単位を確認する
    this.expect(positions.length % 3 === 0, `${path}.positions`, "positions length must be a multiple of 3");
    this.expect(indices.length % 3 === 0, `${path}.indices`, "indices length must be a multiple of 3");

    const vertexCount = positions.length / 3;
    const polygonCount = indices.length / 3;

    if (geometry.vertexCount !== undefined) {
      // 補助カウントがある場合は実データ長と一致しているかを見る
      this.expect(
        geometry.vertexCount === vertexCount,
        `${path}.vertexCount`,
        `vertexCount must equal positions.length / 3 (${vertexCount})`
      );
    } else {
      this.addWarning(`${path}.vertexCount`, "vertexCount is recommended for readability and validation");
    }

    if (geometry.polygonCount !== undefined) {
      // polygonCount も三角形数として一致している必要がある
      this.expect(
        geometry.polygonCount === polygonCount,
        `${path}.polygonCount`,
        `polygonCount must equal indices.length / 3 (${polygonCount})`
      );
    } else {
      this.addWarning(`${path}.polygonCount`, "polygonCount is recommended for readability and validation");
    }

    if (normals) {
      // normals は positions と同じ頂点数ぶん必要になる
      this.expect(
        normals.length === vertexCount * 3,
        `${path}.normals`,
        `normals length must equal vertexCount * 3 (${vertexCount * 3})`
      );
    }

    if (uvs) {
      // uvs は1頂点あたり2要素なので、頂点数の2倍を期待する
      this.expect(
        uvs.length === vertexCount * 2,
        `${path}.uvs`,
        `uvs length must equal vertexCount * 2 (${vertexCount * 2})`
      );
    }

    // 各 index が整数であり、かつ positions の範囲内を指しているかを確認する
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (!Number.isInteger(index)) {
        this.addError(`${path}.indices[${i}]`, "indices must contain only integers");
        continue;
      }
      if (index < 0 || index >= vertexCount) {
        this.addError(`${path}.indices[${i}]`, `index must be in range 0..${vertexCount - 1}`);
      }
    }
  }

  // 1 mesh に付属する skin 定義を検証する
  validateSkin(skin, path, geometry) {
    // skin は任意項目なので、未指定はそのまま許可する
    if (!skin) return;
    if (typeof skin !== "object") {
      this.addError(path, "skin must be an object");
      return;
    }

    // geometry 側の頂点数を基準に、1頂点あたり influencesPerVertex 個の
    // jointIndices / jointWeights が並ぶ前提で長さを確認する
    const positions = Array.isArray(geometry?.positions) ? geometry.positions : [];
    const vertexCount = positions.length / 3;
    const influencesPerVertex = skin.influencesPerVertex ?? 4;
    const jointIndices = this.validateNumberArray(
      skin.jointIndices,
      `${path}.jointIndices`,
      "jointIndices"
    );
    const jointWeights = this.validateNumberArray(
      skin.jointWeights,
      `${path}.jointWeights`,
      "jointWeights"
    );

    if (!Number.isInteger(influencesPerVertex) || influencesPerVertex <= 0) {
      this.addError(`${path}.influencesPerVertex`, "influencesPerVertex must be a positive integer");
    }
    // 配列そのものが壊れている場合は個別要素の検証を進めない
    if (!jointIndices || !jointWeights) return;

    const expected = vertexCount * influencesPerVertex;
    this.expect(
      jointIndices.length === jointWeights.length,
      `${path}.jointWeights`,
      "jointWeights length must match jointIndices length"
    );
    this.expect(
      jointIndices.length === expected,
      `${path}.jointIndices`,
      `jointIndices length must equal vertexCount * influencesPerVertex (${expected})`
    );

    // shape.addVertexWeight() へ渡す joint index は整数である必要がある
    for (let i = 0; i < jointIndices.length; i++) {
      if (!Number.isInteger(jointIndices[i])) {
        this.addError(`${path}.jointIndices[${i}]`, "jointIndices must contain only integers");
      }
    }
  }

  // skeleton 定義を検証する
  validateSkeleton(skeleton, path) {
    // skeleton は joint 配列を持ち、各 joint は
    //   name
    //   parent index
    //   localMatrix
    //   inverseBindMatrix(optional)
    //   jointOrder(optional)
    // を持つ前提で扱う
    if (!skeleton || typeof skeleton !== "object") {
      this.addError(path, "skeleton must be an object");
      return;
    }
    const joints = this.ensureArray(skeleton.joints, `${path}.joints`, "joints");
    if (!joints) return;
    this.expect(
      joints.length <= DEFAULT_MAX_SKIN_BONES,
      `${path}.joints`,
      `joint count must be <= ${DEFAULT_MAX_SKIN_BONES} for current skinning shaders`
    );

    // 同名 joint があると animation track や boneOrder の解決が曖昧になる
    const names = new Set();
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];
      const jointPath = `${path}.joints[${i}]`;
      if (!joint || typeof joint !== "object") {
        this.addError(jointPath, "joint must be an object");
        continue;
      }
      if (typeof joint.name !== "string" || joint.name.length === 0) {
        this.addError(`${jointPath}.name`, "joint name must be a non-empty string");
      } else if (names.has(joint.name)) {
        this.addError(`${jointPath}.name`, `joint name "${joint.name}" is duplicated`);
      } else {
        names.add(joint.name);
      }

      // parent は joint 配列内 index を使うので、有効範囲である必要がある
      if (joint.parent !== null && joint.parent !== undefined) {
        if (!Number.isInteger(joint.parent)) {
          this.addError(`${jointPath}.parent`, "joint parent must be an integer index or null");
        } else if (joint.parent < 0 || joint.parent >= joints.length) {
          this.addError(`${jointPath}.parent`, `joint parent must be in range 0..${joints.length - 1}`);
        } else if (joint.parent === i) {
          this.addError(`${jointPath}.parent`, "joint parent must not reference itself");
        }
      }

      const localMatrix = this.validateNumberArray(
        joint.localMatrix,
        `${jointPath}.localMatrix`,
        "localMatrix"
      );
      if (localMatrix) {
        // localMatrix は 4x4 行列として 16 要素を要求する
        this.expect(localMatrix.length === 16, `${jointPath}.localMatrix`, "localMatrix must have 16 numbers");
      }

      if (joint.inverseBindMatrix !== undefined) {
        const ibm = this.validateNumberArray(
          joint.inverseBindMatrix,
          `${jointPath}.inverseBindMatrix`,
          "inverseBindMatrix"
        );
        if (ibm) {
          // inverseBindMatrix も同様に 4x4 行列長を要求する
          this.expect(ibm.length === 16, `${jointPath}.inverseBindMatrix`, "inverseBindMatrix must have 16 numbers");
        }
      }
    }

    if (skeleton.jointOrder !== undefined) {
      const jointOrder = this.ensureArray(skeleton.jointOrder, `${path}.jointOrder`, "jointOrder");
      if (jointOrder) {
        // jointOrder は skinning 用のパレット順を表す補助情報で、
        // ここに書かれた名前は joints 内に存在している必要がある
        for (let i = 0; i < jointOrder.length; i++) {
          const name = jointOrder[i];
          if (typeof name !== "string" || name.length === 0) {
            this.addError(`${path}.jointOrder[${i}]`, "jointOrder entries must be non-empty strings");
          } else if (!names.has(name)) {
            this.addError(`${path}.jointOrder[${i}]`, `jointOrder entry "${name}" does not exist in joints`);
          }
        }
      }
    }

    if (skeleton.bindShapeMatrix !== undefined) {
      const bindShapeMatrix = this.validateNumberArray(
        skeleton.bindShapeMatrix,
        `${path}.bindShapeMatrix`,
        "bindShapeMatrix"
      );
      if (bindShapeMatrix) {
        this.expect(
          bindShapeMatrix.length === 16,
          `${path}.bindShapeMatrix`,
          "bindShapeMatrix must have 16 numbers"
        );
      }
    }
  }

  // animation 定義を検証する
  validateAnimation(animation, path, skeletonMap) {
    // animation は targetSkeleton を前提に、
    // times 配列と joint ごとの poses 配列を持つ
    if (!animation || typeof animation !== "object") {
      this.addError(path, "animation must be an object");
      return;
    }

    // track が参照する joint 名を照合するため、まず対象 skeleton の存在を確認する
    if (!skeletonMap.has(animation.targetSkeleton)) {
      this.addError(`${path}.targetSkeleton`, `unknown skeleton "${animation.targetSkeleton}"`);
    }

    const skeleton = skeletonMap.get(animation.targetSkeleton);
    const jointNames = new Set((skeleton?.joints ?? []).map((joint) => joint.name));
    const times = this.validateNumberArray(animation.times, `${path}.times`, "times");
    const tracks = this.ensureArray(animation.tracks, `${path}.tracks`, "tracks");
    if (!times || !tracks) return;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const trackPath = `${path}.tracks[${i}]`;
      if (!track || typeof track !== "object") {
        this.addError(trackPath, "track must be an object");
        continue;
      }
      if (!jointNames.has(track.joint)) {
        this.addError(`${trackPath}.joint`, `joint "${track.joint}" does not exist in skeleton "${animation.targetSkeleton}"`);
      }
      const poses = this.ensureArray(track.poses, `${trackPath}.poses`, "poses");
      if (!poses) continue;
      // 各 track は全 keyframe 時刻に対応する pose を持つ必要がある
      this.expect(
        poses.length === times.length,
        `${trackPath}.poses`,
        `poses length must match times length (${times.length})`
      );
      for (let j = 0; j < poses.length; j++) {
        const pose = this.validateNumberArray(
          poses[j],
          `${trackPath}.poses[${j}]`,
          "pose"
        );
        if (pose) {
          // pose は runtime で matrixToQuat へ渡す 4x4 行列を期待する
          this.expect(pose.length === 16, `${trackPath}.poses[${j}]`, "pose must have 16 numbers");
        }
      }
    }
  }

  // node 定義を検証する
  validateNode(node, path, meshIds, skeletonIds, animationIds) {
    // node は mesh / skeleton / animationBindings と transform を束ね、
    // ModelAsset 内の配置単位として扱う
    if (!node || typeof node !== "object") {
      this.addError(path, "node must be an object");
      return;
    }
    // node には中間親ノードのような「mesh を持たない配置ノード」も許可する
    // mesh を持つ場合だけ既知 id であることを確認する
    if (node.mesh !== undefined && node.mesh !== null && !meshIds.has(node.mesh)) {
      this.addError(`${path}.mesh`, `unknown mesh "${node.mesh}"`);
    }
    // skeleton は未指定を許可するが、指定時は既知 id である必要がある
    if (node.skeleton !== undefined && node.skeleton !== null && !skeletonIds.has(node.skeleton)) {
      this.addError(`${path}.skeleton`, `unknown skeleton "${node.skeleton}"`);
    }

    if (node.animationBindings !== undefined) {
      const bindings = this.ensureArray(
        node.animationBindings,
        `${path}.animationBindings`,
        "animationBindings"
      );
      if (bindings) {
        // node にぶら下がる animation 名が存在するかだけをここで確認する
        for (let i = 0; i < bindings.length; i++) {
          if (!animationIds.has(bindings[i])) {
            this.addError(`${path}.animationBindings[${i}]`, `unknown animation "${bindings[i]}"`);
          }
        }
      }
    }

    const transform = node.transform;
    const matrix = node.matrix === undefined ? null : this.validateNumberArray(
      node.matrix,
      `${path}.matrix`,
      "matrix"
    );
    if (matrix) {
      this.expect(matrix.length === 16, `${path}.matrix`, "matrix must have 16 numbers");
    }
    if (transform !== undefined) {
      if (!transform || typeof transform !== "object") {
        this.addError(`${path}.transform`, "transform must be an object");
      } else {
        // transform は TRS 形式の簡易定義として扱う
        const translation = transform.translation === undefined ? null : this.validateNumberArray(
          transform.translation,
          `${path}.transform.translation`,
          "translation"
        );
        const rotation = transform.rotation === undefined ? null : this.validateNumberArray(
          transform.rotation,
          `${path}.transform.rotation`,
          "rotation"
        );
        const scale = transform.scale === undefined ? null : this.validateNumberArray(
          transform.scale,
          `${path}.transform.scale`,
          "scale"
        );
        if (translation) {
          this.expect(translation.length === 3, `${path}.transform.translation`, "translation must have 3 numbers");
        }
        if (rotation) {
          // quaternion は [x, y, z, w] の4要素を期待する
          this.expect(rotation.length === 4, `${path}.transform.rotation`, "rotation must have 4 numbers");
        }
        if (scale) {
          this.expect(scale.length === 3, `${path}.transform.scale`, "scale must have 3 numbers");
          if (scale[0] !== scale[1] || scale[1] !== scale[2]) {
            // 非等方スケールは現行仕様では animation の対象外なので warning 扱い
            this.addWarning(`${path}.transform.scale`, "non-uniform scale is outside the current ModelAsset animation scope");
          }
        }
      }
    }
  }

  // ModelAsset 全体を検証する
  validate(asset) {
    // validate() は毎回フルスキャンするため、前回の結果は破棄してから始める
    this.errors = [];
    this.warnings = [];

    if (!asset || typeof asset !== "object") {
      this.addError("asset", "ModelAsset must be an object");
      return this.result();
    }

    // まず最上位の識別情報を確認する
    this.expect(asset.type === "webg-model-asset", "type", 'type must be "webg-model-asset"');
    this.expect(typeof asset.version === "string" && asset.version.length > 0, "version", "version must be a non-empty string");

    const materials = Array.isArray(asset.materials) ? asset.materials : [];
    const meshes = this.ensureArray(asset.meshes, "meshes", "meshes");
    const skeletons = Array.isArray(asset.skeletons) ? asset.skeletons : [];
    const animations = Array.isArray(asset.animations) ? asset.animations : [];
    const nodes = this.ensureArray(asset.nodes, "nodes", "nodes");

    if (!meshes || !nodes) {
      return this.result();
    }

    // 参照整合に使う id 集合を先に作る
    const materialIds = this.buildIdSet(materials, "materials", "material");
    const meshIds = this.buildIdSet(meshes, "meshes", "mesh");
    const skeletonIds = this.buildIdSet(skeletons, "skeletons", "skeleton");
    const animationIds = this.buildIdSet(animations, "animations", "animation");
    const skeletonMap = new Map();

    // skeleton は animation 検証の前提になるので先に処理する
    for (let i = 0; i < skeletons.length; i++) {
      if (skeletons[i]?.id) {
        skeletonMap.set(skeletons[i].id, skeletons[i]);
      }
      this.validateSkeleton(skeletons[i], `skeletons[${i}]`);
    }

    // mesh は geometry / skin / material 参照をまとめて確認する
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const meshPath = `meshes[${i}]`;
      if (!mesh || typeof mesh !== "object") {
        this.addError(meshPath, "mesh must be an object");
        continue;
      }
      this.validateGeometry(mesh.geometry, `${meshPath}.geometry`);
      this.validateSkin(mesh.skin, `${meshPath}.skin`, mesh.geometry);
      if (mesh.material !== undefined && mesh.material !== null && !materialIds.has(mesh.material)) {
        this.addError(`${meshPath}.material`, `unknown material "${mesh.material}"`);
      }
    }

    // animation は skeletonMap を使って joint 名との整合を見る
    for (let i = 0; i < animations.length; i++) {
      this.validateAnimation(animations[i], `animations[${i}]`, skeletonMap);
    }

    // 最後に node の参照関係と transform を確認する
    for (let i = 0; i < nodes.length; i++) {
      this.validateNode(nodes[i], `nodes[${i}]`, meshIds, skeletonIds, animationIds);
    }

    return this.result();
  }

  // 現在の検証結果を返す
  result() {
    return {
      ok: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [...this.warnings]
    };
  }

  // 失敗時は例外にして build 側から扱いやすくする
  assertValid(asset) {
    const result = this.validate(asset);
    if (result.ok) {
      return result;
    }
    const lines = result.errors.map((item) => `${item.path}: ${item.message}`);
    throw new Error(`Invalid ModelAsset\n${lines.join("\n")}`);
  }
}
