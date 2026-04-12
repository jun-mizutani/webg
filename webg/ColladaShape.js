// ---------------------------------------------
// ColladaShape.js  2026/03/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Collada from "./Collada.js";
import Shape from "./Shape.js";
import Skeleton from "./Skeleton.js";
import Animation from "./Animation.js";
import util from "./util.js";
import ModelAsset from "./ModelAsset.js";
import ModelBuilder from "./ModelBuilder.js";

export default class ColladaShape extends Collada {

  constructor (gl) {
    // Collada解析結果をwebg Shape/Skeletonへマッピングする
    super();
    this.gl = gl;
  }

  // 既存 Shape を ModelAsset mesh 定義へ変換する
  shapeToMeshDef(shape, meshIndex) {
    const geometry = {
      vertexCount: shape.vertexCount,
      polygonCount: shape.primitiveCount,
      positions: [...shape.positionArray],
      normals: [...shape.normalArray],
      uvs: [...shape.texCoordsArray],
      indices: [...shape.indicesArray]
    };
    const meshDef = {
      id: `mesh_${meshIndex}`,
      name: shape.getName?.() ?? `mesh_${meshIndex}`,
      geometry,
      colladaMeshIndex: meshIndex
    };

    if (shape.materialId) {
      meshDef.material = shape.materialId;
    }

    if (shape.hasSkeleton) {
      const jointIndices = [];
      const jointWeights = [];
      for (let i = 0; i < shape.vertexCount; i++) {
        const bones = shape.bindex[i] ?? [];
        const weights = shape.weight[i] ?? [];
        for (let j = 0; j < 4; j++) {
          jointIndices.push(bones[j] ?? 0);
          jointWeights.push(weights[j] ?? 0);
        }
      }
      meshDef.skin = {
        influencesPerVertex: 4,
        jointIndices,
        jointWeights
      };
    }

    return meshDef;
  }

  // 既存 Skeleton を ModelAsset skeleton 定義へ変換する
  skeletonToDef(skeleton, meshIndex, bindShapeMatrix) {
    // boneOrder だけを保存すると、ウェイト対象ではない中間親ボーンが落ちる
    // Collada ではその中間親の localMatrix に姿勢補正が入っていることがあり、
    // そこを失うと復元時にボーン全体が倒れるため、定義には全ボーンを残す
    const bones = skeleton.bones ?? [];
    const indexMap = new Map();
    for (let i = 0; i < bones.length; i++) {
      indexMap.set(bones[i], i);
    }
    return {
      id: `skeleton_${meshIndex}`,
      bindShapeMatrix: bindShapeMatrix ? bindShapeMatrix.mat.slice() : undefined,
      jointOrder: (skeleton.getBoneOrder?.() ?? []).map((bone) => bone.name),
      joints: bones.map((bone) => ({
        name: bone.name,
        parent: indexMap.has(bone.parent) ? indexMap.get(bone.parent) : null,
        localMatrix: bone.getRestMatrix().mat.slice(),
        inverseBindMatrix: bone.getBofMatrix().mat.slice()
      }))
    };
  }

  // 既存 Animation を ModelAsset animation 定義へ変換する
  animationToDef(anim, meshIndex, skeletonId) {
    return {
      id: `${anim.getName?.() ?? "animation"}_${meshIndex}`,
      targetSkeleton: skeletonId,
      interpolation: "step",
      times: [...anim.times],
      tracks: anim.boneNames.map((boneName, boneIndex) => ({
        joint: boneName,
        poses: anim.poses[boneIndex].map((mat) => mat.mat.slice())
      }))
    };
  }

  // setData() による破壊的変換前の animation を退避する
  cloneAnimationSource(anim) {
    if (!anim) return null;
    return {
      name: anim.getName?.() ?? "animation",
      times: [...anim.times],
      boneNames: [...anim.boneNames],
      poses: anim.poses.map((bonePoses) => bonePoses.map((mat) => mat.clone()))
    };
  }

  // Collada animation の track 名を skeleton の bone 名へ解決する
  resolveAnimationBoneName(rawBoneName, skeleton) {
    if (!rawBoneName || !skeleton) return null;

    const skeletonNames = new Set((skeleton.bones ?? []).map((bone) => bone.name));
    if (skeletonNames.size === 0) return null;

    const target = rawBoneName.split("/")[0];
    const candidates = [
      rawBoneName,
      target,
      target?.replace(/^#/, ""),
      target?.replace(/^.*?_/, ""),
      target?.replace(/^.*?[:-]/, ""),
      target?.replace(/\./g, "_")
    ].filter((name, index, self) => name && self.indexOf(name) === index);

    for (let i = 0; i < candidates.length; i++) {
      if (skeletonNames.has(candidates[i])) {
        return candidates[i];
      }
    }

    return null;
  }

  // animation を skeleton に合う track だけへ正規化する
  normalizeAnimationForSkeleton(anim, skeleton) {
    if (!anim || !skeleton) return null;

    const boneNames = [];
    const poses = [];
    for (let i = 0; i < anim.boneNames.length; i++) {
      const boneName = this.resolveAnimationBoneName(anim.boneNames[i], skeleton);
      if (!boneName) continue;
      boneNames.push(boneName);
      poses.push(anim.poses[i].map((mat) => mat.clone()));
    }

    if (boneNames.length === 0) {
      return null;
    }

    return {
      name: anim.name,
      times: [...anim.times],
      boneNames,
      poses
    };
  }

  // 正規化済み animation ソースから runtime Animation を組み立てる
  createRuntimeAnimation(animSource) {
    if (!animSource) return null;
    const anim = new Animation(animSource.name ?? "animation");
    anim.setTimes(animSource.times.slice());
    for (let i = 0; i < animSource.boneNames.length; i++) {
      anim.addBoneName(animSource.boneNames[i]);
      anim.setBonePoses(animSource.poses[i].map((mat) => mat.clone()));
    }
    return anim;
  }

  // skeleton に適用可能な animation track があるか確認する
  animationMatchesSkeleton(anim, skeleton) {
    return this.normalizeAnimationForSkeleton(anim, skeleton) !== null;
  }

  // skinned / non-skinned で異なる model origin policy を返す
  getModelOriginPolicy(hasSkeleton) {
    // skinned mesh は skeleton root を原点とし、
    // bind_shape_matrix 側で geometry を skeleton 空間へ寄せる
    // non-skinned mesh は mesh node を原点とし、
    // mesh node 自身の配置だけを geometry へ焼き込む
    return hasSkeleton ? "skeleton-root" : "mesh-node";
  }

  // geometry へ先に加える原点オフセットを返す
  getGeometryOriginOffset(mesh, hasSkeleton) {
    // bind_shape_matrix の平行移動は skin 用の補正としてだけ使う
    // non-skinned mesh では mesh node が原点なのでここでは使わない
    if (!hasSkeleton) {
      return [0, 0, 0];
    }

    const bindShapeMatrix = mesh.getBindShapeMatrix?.();
    if (!bindShapeMatrix) {
      return [0, 0, 0];
    }
    return bindShapeMatrix.getPosition();
  }

  // 頂点へ焼き込む mesh node 行列を返す
  getGeometryNodeMatrix(mesh, hasSkeleton) {
    const nodeMatrix = mesh.getNodeMatrix?.();
    if (!nodeMatrix) {
      return null;
    }

    const geometryMatrix = nodeMatrix.clone();
    if (hasSkeleton) {
      // skinned mesh は skeleton root を原点とするため、
      // mesh node やその上位 root 由来の平行移動は焼き込まない
      // 回転や拡大縮小だけを残し、向き補正だけを geometry へ反映する
      geometryMatrix.position([0, 0, 0]);
    }
    return geometryMatrix;
  }

  // Collada の内容を ModelAsset へ正規化する
  toModelAsset(bone_enable, tex_select) {
    const materials = [];
    const materialIds = new Set();
    const meshes = [];
    const skeletons = [];
    const animations = [];
    const nodes = [];
    const rawAnimation = this.cloneAnimationSource(this.anim);

    let texture_select = 0;
    if (tex_select !== undefined) {
      if ((tex_select > 0) && (tex_select <= 2)) {
        texture_select = tex_select;
      }
    }

    for (let k = 0; k < this.mesh_count; k++) {
      const sourceMesh = this.meshes[k];
      const shape = this.setShape(k, bone_enable, texture_select);
      const meshDef = this.shapeToMeshDef(shape, k);
      const skeleton = shape.getSkeleton();
      let skeletonId = null;
      let animationId = null;

      if (meshDef.material && !materialIds.has(meshDef.material)) {
        materialIds.add(meshDef.material);
        materials.push({
          id: meshDef.material,
          shaderParams: {
            ...(shape.shaderParam ?? {})
          }
        });
      }

      if (skeleton && skeleton.getBoneCount() > 0) {
        const skeletonDef = this.skeletonToDef(
          skeleton,
          k,
          sourceMesh.getBindShapeMatrix?.() ?? null
        );
        skeletonId = skeletonDef.id;
        skeletons.push(skeletonDef);
      }

      const normalizedAnimation = this.normalizeAnimationForSkeleton(rawAnimation, skeleton);
      if (normalizedAnimation && skeletonId) {
        const animDef = this.animationToDef(normalizedAnimation, k, skeletonId);
        animationId = animDef.id;
        animations.push(animDef);
      }

      meshes.push(meshDef);
      nodes.push({
        id: `node_${k}`,
        name: sourceMesh.getName?.() ?? `node_${k}`,
        parent: null,
        mesh: meshDef.id,
        skeleton: skeletonId,
        animationBindings: animationId ? [animationId] : [],
        transform: {
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1]
        },
        colladaMeshIndex: k
      });
    }

    return ModelAsset.fromData({
      version: "1.0",
      type: "webg-model-asset",
      meta: {
        name: "collada-model",
        generator: "ColladaShape.js",
        source: "Collada",
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

  // Meshのスキン情報をShape/Skeletonへ転写する
  setBones(mesh, shape, verts, newindex) {
    // COLLADAのjoint/weight情報をShape頂点へ登録する
    let joint_names = mesh.getJointNames();
    if (joint_names.length === 0) { return; }
    this.printf("bone count  = %d\n", joint_names.length);

    let skeleton = shape.getSkeleton();
    let skinweights = mesh.getSkinWeights();
    let ibp_matrices = mesh.getBindPoseMatrices();
    let bind_shape_matrix = mesh.getBindShapeMatrix();

    let found = false;
    let frame = this.rootFrame.findFrame(joint_names[0]); // バグ修正済み
    let bestFrame = this.rootFrame;
    let bestCount = this.rootFrame.getNoOfBones(joint_names);
    // 一部の Collada では探索開始点が意図どおり見つからない、または
    // 途中で親方向の探索が尽きる場合がある
    // そのときでも joint を最も多く含む frame を使うことで、
    // root からの復元へ安全にフォールバックする
    if (frame === null) {
      frame = this.rootFrame;
    }
    do {
      let count = frame.getNoOfBones(joint_names);
      if (count > bestCount) {
        bestCount = count;
        bestFrame = frame;
      }
      if (count < joint_names.length) {
        frame = frame.parent;
      } else {
        found = true;
      }
    } while (!found && (frame !== null));
    frame = found ? frame : bestFrame;
    this.printf("bone root = %s (ColladaShape.setBones)\n", frame.getName());
    frame.copyToBone(joint_names, bind_shape_matrix, skeleton,
                     null, 0, this.printflag);

    skeleton.setBoneOrder(joint_names);
    skeleton.bindRestPose();
    shape.shaderParameter("has_bone", 1);

    // register skin weights
    // skinweights = {
    //   {bone_idx, weight, bone_idx, weight, .. }
    //   {bone_idx, weight, bone_idx, weight, .. }
    //   ..
    // }
    // verts 配列には x, y, z の繰返しで頂点が登録されているため、
    // 頂点数は verts 配列の要素の3分の1となる
    let vert_count = verts.length / 3;
    // 頂点座標インデックス(頂点番号)1つが、複数の頂点になっている
    for (let i=0; i<vert_count; i++) {
      // 頂点座標インデックス(頂点番号)1つで繰り返し
      for (let n=0; n<newindex[i].length; n++) {
        // 頂点番号 i の頂点に対応する複数の頂点番号について処理
        let vindex = newindex[i][n];
        // this.printf("vindex:%3d,  i:%3d, n:%3d\n", vindex, i, n);
        let sw = skinweights[i];
        let weight_count = sw.length / 2;
        let tmp = [];
        let min = 1.0;
        let imin = 0;
        // １つの頂点に対する【ボーン:ウェイト】の組を4つ以内に
        // 限定するためにウェイトの大きい方から４つ選ぶ
        for (let j=0; j<weight_count; j++) {
          let bone = sw[j * 2];
          let weight = sw[j * 2 + 1];
          if (j < 4) {
            if (weight < min) { min = weight; imin = j; }
            tmp.push([bone, weight]);
          } else {
            if (weight > min) {
              tmp[imin] = [bone, weight];
              min = 1.0;
              imin = 0;
              for (let m=0; m<tmp.length; m++) {
                if (tmp[m][1] < min) {
                  min = tmp[m][1];
                  imin = m;
                }
              }
            }
          }
        }
        // 1つの頂点が属するすべてのボーンのウェイトの合計を求め、
        // ウェイトの合計が 1.0 になるように正規化する
        let total_weight = 0;
        for (let m=0; m<tmp.length; m++) {
          total_weight = total_weight + tmp[m][1];
        }
        // ある1つの頂点は、複数のボーンに対するウェイトを持っている
        // 1つの頂点(vindex) に対して、ボーン番号とウェイトの組を登録
        for (let m=0; m<tmp.length; m++) {
          shape.addVertexWeight(vindex, tmp[m][0], tmp[m][1] / total_weight);
        }
      }  // for n = 1, newindex[i].length do
    }    // for (let i=0; vert_count  do
  }

  // 1 Meshを1 Shapeへ変換する
  setShape(nmesh, bone_enable, texture_select) {
    // 1つのMeshから1つのShapeを生成し、必要ならSkeletonを付与する
    let mesh = this.meshes[nmesh];
    let verts = mesh.getVertices();
    const meshName = mesh.getName?.() ?? `mesh_${nmesh}`;
    const nameMatch = meshName.match(/(.*)-mesh$/);
    let name = nameMatch ? nameMatch[1] : meshName;
    let normals = mesh.getNormals();
    let tex_table = mesh.getTextureCoord();
    let polygons = mesh.getPolygons();
    let bind_shape_matrix = mesh.getBindShapeMatrix();
    let originx, originy, originz;
    // meshes[nmesh] の頂点情報を出力
    this.printf("[%d]---- %s ----\n",nmesh , name);
    this.printf("vertices    = %d\n", verts.length/3);
    this.printf("normals     = %d\n", normals.length/3);
    // テクスチャを選択
    let select;
    if (texture_select > tex_table.length) {
      select = tex_table.length;
    } else {
      select = texture_select;
    }

    for (let m=0; m<tex_table.length; m++) {
      let tex = tex_table[m];
      this.printf("texture     = %d\n", tex.length/2);
    }
    this.printf("polygons    = %d\n", polygons.length);

    // Shape を1つ生成
    let shape = new Shape(this.gl);
    // 法線の自動計算をさせない
    shape.setAutoCalcNormals(false);
    // テクスチャマッピングモードの指定
    shape.setTextureMappingMode(-1);
    shape.setName(name);

    const materialId = mesh.getMaterialId?.();
    const materialParams = this.getMaterialParams?.(materialId);
    if (materialId) {
      shape.materialId = materialId;
    }
    if (materialParams?.diffuse) {
      shape.shaderParameter("color", materialParams.diffuse);
    }
    if (materialParams?.ambient) {
      const a = materialParams.ambient;
      shape.shaderParameter("ambient", (a[0] + a[1] + a[2]) / 3.0);
    }
    if (materialParams?.specular) {
      const s = materialParams.specular;
      shape.shaderParameter("specular", (s[0] + s[1] + s[2]) / 3.0);
    }
    if (materialParams?.shininess !== undefined) {
      shape.shaderParameter("power", materialParams.shininess);
    }

    // ボーンの名称配列を joints 配列に設定
    let joints = mesh.getJointNames();
    const hasSkeleton = bone_enable && (joints.length > 0);
    const originPolicy = this.getModelOriginPolicy(hasSkeleton);
    const originOffset = this.getGeometryOriginOffset(mesh, hasSkeleton);
    originx = originOffset[0];
    originy = originOffset[1];
    originz = originOffset[2];
    mesh.printInfo();  // debug
    // ボーンが有効で、複数のボーンが存在すれば Skeleton を追加
    if (hasSkeleton) {
      let skeleton = new Skeleton();
      shape.setSkeleton(skeleton);
    }

    // conversion table from pos_index to final-vert-indices for weight
    // ex. newindex[pos_index] = [8, 10, 12]
    // newindex の初期化
    let newindex = [];
    for (let i=0; i<verts.length/3; i++) {
      newindex.push([]);
    }

    let pos_index, nrm_index, tex_index;
    let x, y, z, u, v, nx, ny, nz, h;

    // 法線べクトルの変換は平行移動成分のない行列（回転成分のみ）で
    // 行っているが、 拡大縮小のある変換行列で法線べクトルを変換するためには、
    // 逆転置行列（逆行列の転置行列） を使う必要があるBlenderの座標系で変換
    // を行い、最後にOpenGLの座標系に変換する
    // オブジェクト用のノードがない場合にも対応
    let w, ss, itm = null;
    let node_mat = this.getGeometryNodeMatrix(mesh, hasSkeleton);
    if (node_mat !== null) {
      itm = node_mat.clone();
      itm.position([0, 0, 0]);
      itm.inverse_strict();
      itm.transpose();
      if (this.printflag) {
        node_mat.print_verbose?.(true);
        itm.print_verbose?.(true);
      }
    }

    // COLLADAでは頂点座標、法線ベクトル、テクスチャ座標、
    // スキンウェイトなど、それぞれに 0 から始まるインデックス
    // 番号で実際の数値との対応をとっている数値が同じならば
    // インデックスを重複して使用することでデータの冗長化を
    // 防ぐことが可能となっている
    // 一方、OpenGLでは頂点情報を個々の頂点バッファに登録して、
    // 頂点インデックスをインデックスバッファに格納してから
    // 描画する多くの頂点情報がすべて一致すれば、頂点
    // インデックスを重複して使用できるが、COLLADAに比べて
    // チャンスは少ない

    // 例えばフラットシェイディング時の法線ベクトルのように
    // ポリゴンを構成する頂点の情報を隣接するポリゴンと共有
    // できない場合がある
    // ポリゴンを中心に見て、ポリゴンを構成する頂点を別々に
    // 管理して、頂点座標、法線ベクトル、テクスチャ座標、
    // スキンウェイト(ボーン番号とウェイトの配列) といった
    // 頂点情報を登録する必要がある
    // 元の頂点番号(頂点座標インデックス)からコピーされた
    // 頂点座標を持つ頂点に、法線ベクトル、テクスチャ座標、
    // スキンウェイトを登録する

    // COLLADAでの頂点座標インデックスから OpenGL の頂点バッファ
    // に対するインデックスへの変換表を作成する必要がある

    // ポリゴン配列の1つのポリゴン毎の処理
    for (let i=0; i<polygons.length; i++) {
      // ポリゴンを構成する頂点の頂点番号を記録する indices 配列
      let indices = [];
      // ポリゴンを構成する頂点毎の処理
      for (let j=0; j<polygons[i].length; j++) {
        // i 番目のポリゴンの j 番目の頂点のインデックス情報を取得する
        pos_index = polygons[i][j][0];
        nrm_index = polygons[i][j][1];
        tex_index = polygons[i][j][2];
        // i 番目のポリゴンの j 番目の頂点の頂点座標を取得
        // origin policy ごとに選んだ原点オフセットを先に加え、
        // その後 mesh node 行列のうち正規化で使う成分だけを適用する
        // skinned mesh では skeleton root を原点にしたいため、
        // mesh node の平行移動はここで使わない
        // non-skinned mesh では mesh node を原点とするため、
        // mesh node の配置を geometry 側へ焼き込む
        x =  verts[pos_index * 3 + 0] + originx;
        y =  verts[pos_index * 3 + 1] + originy;
        z =  verts[pos_index * 3 + 2] + originz;
        if (node_mat !== null) {
          w = node_mat.mulVector([x, y, z]);
          x = w[0];
          y = w[2];
          z = -w[1];
        } else {
          let w = y;
          y = z;
          z = -w;
        }
        // テクスチャを持っているなら
        if (tex_table.length > 0) {
          if ((tex_table[select].length > 0)) {
            // i 番目のポリゴンの j 番目の頂点のテクスチャ座標を取得
            u = tex_table[select][tex_index * 2 + 0];
            v = tex_table[select][tex_index * 2 + 1];
            // 頂点座標とテクスチャ座標を Shape に登録
            h = shape.addVertexPosUV([x, y, z], [u, v]);
          }
        } else {
          // テクスチャを持たない場合は頂点座標を Shape に登録
          // 登録済みの頂点数が返る
          h = shape.addVertex(x, y, z);
        }
        // i 番目のポリゴンの j 番目の頂点の法線ベクトルを取得
        nx = normals[nrm_index * 3 + 0];
        ny = normals[nrm_index * 3 + 1];
        nz = normals[nrm_index * 3 + 2];
        if (node_mat !== null) {
          w = itm.mulVector([nx, ny, nz]);
          ss = Math.sqrt(w[0]*w[0] + w[1]*w[1] + w[2]*w[2])
          shape.setVertNormal(h-1, w[0]/ss, w[2]/ss, -w[1]/ss)
        } else {
          shape.setVertNormal(h-1, nx, nz, -ny)
        }

        // ポリゴンの頂点となる頂点番号を indices に追加
        // hは次の頂点番号を示すため、いま登録した頂点番号は(h-1)である
        indices.push(h-1);
        // register h to conversion table
        // ! 「h」 なのか 「h-1」 なのか、よく検討すること 2016-08-08 !
        // newindex[pos_index] に登録
        newindex[pos_index].push(h-1);
      }
      shape.addPlane(indices);
    }
    // ボーンが有効で、複数のボーンが存在する場合
    if (hasSkeleton) {
      this.setBones(mesh, shape, verts, newindex);
      let skeleton = shape.getSkeleton();
      const normalizedAnimation = this.normalizeAnimationForSkeleton(this.anim, skeleton);
      if (normalizedAnimation) {
        const runtimeAnimation = this.createRuntimeAnimation(normalizedAnimation);
        shape.setAnimation(runtimeAnimation);
        runtimeAnimation.setData(skeleton, bind_shape_matrix);
      }
    }

    if (this.printflag) {
      this.printf("origin policy = %s\n", originPolicy);
    }

    return shape;
  }

  // ModelAsset 正規化後に ModelBuilder で Shape 化する
  makeShapes(bone_enable, tex_select) {
    if (this.mesh_count === 0) { return null; }
    const asset = this.toModelAsset(bone_enable, tex_select);
    const built = new ModelBuilder(this.gl).build(asset.getData());
    const shapes = [];
    for (let i = 0; i < built.nodes.length; i++) {
      const node = built.nodes[i];
      if (node.animationBindings.length > 0) {
        const anim = node.animations.get(node.animationBindings[0]);
        if (anim) {
          node.shape.setAnimation(anim);
        }
      }
      node.shape._colladaMeshIndex = node.colladaMeshIndex;
      shapes.push(node.shape);
    }
    return shapes;
  }

};
