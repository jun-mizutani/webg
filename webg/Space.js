// ---------------------------------------------
//  Space.js      2026/03/07
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Node from "./Node.js";
import Matrix from "./Matrix.js";

export default class Space {

  // ノード群・タイマ・ライト状態を初期化する
  constructor() {
    // シーン全体の管理クラス
    // Node集合の更新/描画、skeleton一覧、時間計測を担う
    this.nodes = [];
    this.roots = [];
    this.skeletons = [];
    this.light = null;
    this.lightType = 1.0;
    this.time = 0;
    this.elapsedTime = 0;
    this.drawCount = 0;
    this.startTime = util.now();
    this._collisionPrevMap = new Map();
    this._collisionBodyPrevMap = new Map();
    this.collisionBodies = new Map();
    this._collisionIdSeed = 1;
  }

  // ノードを作成して登録する
  addNode(parent_node, name) {
    // Nodeを生成してSpace管理下へ追加する
    let node = new Node(parent_node, name);
    this.nodes.push(node);
    if (parent_node !== null) {
      parent_node.addChild(node);
    }
    return node;
  }

  // 名前一致ノードを削除する
  delNode(name) {
    // 指定名のNodeを管理配列から無効化する
    // （実体はnull化）
    let node = this.findNode(name);
    if (node) {
      for (let i=0; this.nodes.length; i++) {
        if (this.nodes[i] === node) {
          //table.remove(this.nodes, i);
          this.nodes[i] = null;
        }
      }
    }
  }

  // シーンから描画対象スケルトンを再収集する
  scanSkeletons() {
    // 表示対象/attach可能なSkeletonを走査して、
    // drawBones() 用リストを更新する
    let shapes;
    this.skeletons = [];
    for (let i=0; i<this.nodes.length; i++) {
      shapes = this.nodes[i].shapes;
      if (shapes.length > 0) {
        for (let j=0; j<shapes.length; j++) {
          let skeleton = shapes[j].skeleton;
          if (skeleton !== null) {
            if (skeleton.isAttachable() || skeleton.isShown()) {
              this.skeletons.push(skeleton);
            }
          }
        }
      }
    }
  }

  // 名前でノードを検索する
  findNode(name) {
    // 名前一致でNodeを検索し、
    // 見つからなければnullを返す
    for (let i=0; i<this.nodes.length; i++) {
      if (this.nodes[i].name === name) {
        return this.nodes[i];
      }
    }
    util.printf("%s not found!\n", name);
    return null;
  }

  // ノード一覧を出力する
  listNode() {
    // ルート配下のNode名を階層風に標準出力へ表示する
    function listChildNodes(children, level) {
      if (children.length === 0) { return }
      for (let j=0; j<children.length; j++) {
        let fmt = '%' + level*4  + 's%s';
        util.printf(fmt, ' ', children[j].name);
        //listChildNodes(children[j].children, level + 1);
      }
    }

    for (let i=0; i<this.nodes.length; i++) {
      if (this.nodes[i].parent === null) {
        util.printf("%s\n", this.nodes[i].name);
        listChildNodes(this.nodes[i].children, 1);
      }
    }
  }

  // 現在時刻(ms)を返す
  now() {
    // 現在時刻（ミリ秒）を返す
    return util.now(); // return msec
  }

  // 計測開始時刻をセットする
  timerStart() {
    // 稼働時間計測の開始時刻を更新する
    this.startTime = this.now();
  }

  // 起動経過時間(ms)を返す
  uptime() {
    // timerStart() からの経過時間（ミリ秒）を返す
    return this.now() - this.startTime;
  }

  // 前回からの差分時間(ms)を返す
  deltaTime() {
    // 直近フレームの経過時間（ミリ秒）を返す
    return this.elapsedTime;
  }

  // フレームカウントを進めて返す
  count() {
    // draw() の累積実行回数を返す
    return this.drawCount;
  }

  // ライトノードを設定する
  setLight(node) {
    // 描画時に参照するライトNodeを設定する
    this.light = node;
  }

  // ライト種別を設定する
  setLightType(type) {
    // type = 0:spot, 1:parallel
    this.lightType = type;
  }

  // ライト種別を返す
  getLightType() {
    // type = 0:spot, 1:parallel
    return this.lightType;
  }

  // 視点ノードを設定する
  setEye(node) {
    // 既定のカメラNodeを設定する
    // draw引数省略時に使用する
    this.eye = node;
  }

  // 視点からシーン全体を描画する
  draw(eye_node) {
    // 描画ステップ:
    // 1) カメラ(world)確定
    // 2) view行列作成
    // 3) ルートNodeから再帰描画
    let node;
    let oldTime = this.time;
    this.time = this.now();
    this.elapsedTime = this.time - oldTime;

    if ((eye_node === undefined) && (this.eye !== undefined)) {
      eye_node = this.eye;
    }
    eye_node.setWorldMatrix();
    let view_matrix = new Matrix();
    view_matrix.makeView(eye_node.worldMatrix);
    
    let lightVec;
    if (this.light !== null) {
      if (this.lightType === 1.0) {  // point light
        lightVec = view_matrix.mul3x3Vector(this.light.getWorldPosition());
      } else {                       // parallel light
        let lightInEye = view_matrix.clone();
        lightInEye.mul(this.light.worldMatrix);
        lightVec = lightInEye.mul3x3Vector( [0.0, 0.0, 1.0] );
      }
      lightVec.push(this.lightType);
    }

    for (let i=0; i<this.nodes.length; i++) {
      node = this.nodes[i];
      if (node.parent === null) {
        node.draw(view_matrix, lightVec, this.drawCount);
      }
    }
    this.drawCount++;
  }

  // 収集済みスケルトンの骨を描画する
  drawBones() {
    // メッシュ描画とは別に、
    // Skeleton側のボーン可視化を描く
    if (this.skeletons.length === 0) { return }
    for (let i=0; i<this.skeletons.length; i++) {
      this.skeletons[i].drawBones();
    }
  }

  // Node 配下の Shape にある parameter animation を 1 frame 進める
  // draw() より前に呼べば、補間済みの値をその frame の描画へ反映できる
  updateShapeAnimations(deltaMs = 0) {
    if (this.nodes.length === 0) {
      return 0;
    }
    let updatedCount = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node || !node.shapes || node.shapes.length === 0) continue;
      for (let j = 0; j < node.shapes.length; j++) {
        const shape = node.shapes[j];
        if (!shape || typeof shape.updateAnimatedParameters !== "function") continue;
        updatedCount += shape.updateAnimatedParameters(deltaMs) > 0 ? 1 : 0;
      }
    }
    return updatedCount;
  }

  // Node の position animation を 1 frame 進める
  // ball 移動のような node 単位の移動演出を、Shape 側と同じ流れで更新できる
  updateNodeAnimations(deltaMs = 0) {
    if (this.nodes.length === 0) {
      return 0;
    }
    let updatedCount = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node) continue;
      let nodeUpdated = 0;
      if (typeof node.updateAnimatedPosition === "function") {
        nodeUpdated += node.updateAnimatedPosition(deltaMs);
      }
      if (typeof node.updateAnimatedRotation === "function") {
        nodeUpdated += node.updateAnimatedRotation(deltaMs);
      }
      if (nodeUpdated > 0) {
        updatedCount += 1;
      }
    }
    return updatedCount;
  }

  // Node と Shape の補間をまとめて進める
  // unit test や sample 側はこれを 1 回呼ぶだけで、位置と material の両方を反映しやすい
  update(deltaMs = 0) {
    const nodeCount = this.updateNodeAnimations(deltaMs);
    const shapeCount = this.updateShapeAnimations(deltaMs);
    return {
      nodeCount,
      shapeCount
    };
  }

  // レイとShapeの軸平行境界ボックス(AABB)の交差判定を行う
  raycast(origin, dir, { firstHit = true, filter } = {}) {
    if (!Array.isArray(origin) || origin.length < 3) {
      return firstHit ? null : [];
    }
    if (!Array.isArray(dir) || dir.length < 3) {
      return firstHit ? null : [];
    }

    const rayDir = this._normalizeVec3(dir);
    if (!rayDir) {
      return firstHit ? null : [];
    }

    // draw() と同様に、判定前にワールド行列を確定させる
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node && node.parent === null) {
        node.setWorldMatrix();
      }
    }

    let nearestHit = null;
    const hits = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node || !node.shapes || node.shapes.length === 0) continue;

      for (let j = 0; j < node.shapes.length; j++) {
        const shape = node.shapes[j];
        if (!shape || shape.isHidden) continue;
        if (typeof filter === "function" && !filter({ node, shape })) continue;

        const localBox = shape.getBoundingBox?.();
        const worldAabb = this._getWorldAabbFromLocalBox(
          localBox, node.worldMatrix
        );
        if (!worldAabb) continue;

        const isect = this._intersectRayAabb(origin, rayDir, worldAabb);
        if (!isect) continue;

        const t = isect.tNear < 0 ? 0 : isect.tNear;
        const point = [
          origin[0] + rayDir[0] * t,
          origin[1] + rayDir[1] * t,
          origin[2] + rayDir[2] * t
        ];
        const hit = {
          t,
          point,
          node,
          shape,
          boundsOnly: true
        };

        if (firstHit) {
          if (nearestHit === null || hit.t < nearestHit.t) {
            nearestHit = hit;
          }
        } else {
          hits.push(hit);
        }
      }
    }

    if (firstHit) {
      return nearestHit;
    }
    hits.sort((leftHit, rightHit) => leftHit.t - rightHit.t);
    return hits;
  }

  // レイキャストの全ヒット版を返す
  raycastAll(origin, dir, options = {}) {
    return this.raycast(origin, dir, {
      ...options,
      firstHit: false
    });
  }

  // Shape同士の軸平行境界ボックス重なり判定を行う
  // ここは広域判定のみを扱うため、形状が細い/斜め配置のケースでは
  // 実際には接触していなくても重なり候補として返る場合がある
  checkCollisions({ firstHit = false, filter, includeHidden = false } = {}) {
    // draw() と同様に、判定前にワールド行列を確定させる
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node && node.parent === null) {
        node.setWorldMatrix();
      }
    }

    const entries = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node || !node.shapes || node.shapes.length === 0) continue;
      for (let j = 0; j < node.shapes.length; j++) {
        const shape = node.shapes[j];
        if (!shape) continue;
        if (!includeHidden && shape.isHidden) continue;
        if (typeof filter === "function" && !filter({ node, shape })) continue;
        const localBox = shape.getBoundingBox?.();
        const worldAabb = this._getWorldAabbFromLocalBox(
          localBox, node.worldMatrix
        );
        if (!worldAabb) continue;
        entries.push({ node, shape, aabb: worldAabb });
      }
    }

    const collisions = [];
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (!this._overlapAabb(a.aabb, b.aabb)) continue;
        const collision = {
          nodeA: a.node,
          shapeA: a.shape,
          nodeB: b.node,
          shapeB: b.shape,
          aabbA: a.aabb,
          aabbB: b.aabb,
          boundsOnly: true
        };
        if (firstHit) return collision;
        collisions.push(collision);
      }
    }

    if (firstHit) return null;
    return collisions;
  }

  // 広域判定(軸平行境界ボックス重なり)の通過ペアに対し、
  // 三角形同士の交差判定で接触を絞り込む詳細版
  //
  // checkCollisionsDetailed の流れ:
  // 1) すべての候補Shapeを収集し、ワールド座標へ変換した
  //    境界ボックス/三角形インデックス/頂点配列を前計算する
  // 2) Shapeペアごとに境界ボックス重なりを判定し、
  //    重ならないペアを早期スキップする
  // 3) 重なりペアの三角形組み合わせ数が maxTrianglePairs を超える場合は
  //    計算量暴走を避けるため境界ボックス結果のみ返す
  //    (boundsOnly=true, detailedSkipped=true)
  // 4) 許容範囲内のペアは _intersectShapeTriangles で
  //    三角形交差を探索し、命中時だけ詳細結果(detail)を付けて返す
  //
  // firstHit=true の場合は最初に確定した1件を返し、
  // false の場合は全件配列を返す
  checkCollisionsDetailed({
    firstHit = false,
    filter,
    includeHidden = false,
    maxTrianglePairs = 200000
  } = {}) {
    // draw() と同様に、判定前にワールド行列を確定させる
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node && node.parent === null) {
        node.setWorldMatrix();
      }
    }

    const entries = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node || !node.shapes || node.shapes.length === 0) continue;
      for (let j = 0; j < node.shapes.length; j++) {
        const shape = node.shapes[j];
        if (!shape) continue;
        if (!includeHidden && shape.isHidden) continue;
        if (typeof filter === "function" && !filter({ node, shape })) continue;
        const localBox = shape.getBoundingBox?.();
        const worldAabb = this._getWorldAabbFromLocalBox(
          localBox, node.worldMatrix
        );
        if (!worldAabb) continue;

        const triIndices = this._getShapeTriangleIndices(shape);
        if (triIndices.length < 3) continue;
        const worldVerts = this._getWorldVertices(shape, node.worldMatrix);
        if (worldVerts.length < 9) continue;
        entries.push({ node, shape, aabb: worldAabb, triIndices, worldVerts });
      }
    }

    const collisions = [];
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (!this._overlapAabb(a.aabb, b.aabb)) continue;

        const nTriA = Math.floor(a.triIndices.length / 3);
        const nTriB = Math.floor(b.triIndices.length / 3);
        const triPairCount = nTriA * nTriB;
        if (triPairCount > maxTrianglePairs) {
          // 三角形組み合わせが大きすぎる場合は
          // 詳細判定をスキップし、広域判定結果のみ返す
          const collision = {
            nodeA: a.node,
            shapeA: a.shape,
            nodeB: b.node,
            shapeB: b.shape,
            aabbA: a.aabb,
            aabbB: b.aabb,
            boundsOnly: true,
            detailedSkipped: true
          };
          if (firstHit) return collision;
          collisions.push(collision);
          continue;
        }

        const detail = this._intersectShapeTriangles(a, b);
        if (!detail.hit) continue;

        const collision = {
          nodeA: a.node,
          shapeA: a.shape,
          nodeB: b.node,
          shapeB: b.shape,
          aabbA: a.aabb,
          aabbB: b.aabb,
          boundsOnly: false,
          detail
        };
        if (firstHit) return collision;
        collisions.push(collision);
      }
    }
    if (firstHit) return null;
    return collisions;
  }

  // 連続フレームの衝突状態から enter/stay/exit を生成する
  updateCollisionEvents({
    detailed = false,
    filter,
    includeHidden = false,
    maxTrianglePairs = 200000
  } = {}) {
    const all = detailed
      ? this.checkCollisionsDetailed({
        firstHit: false, filter, includeHidden, maxTrianglePairs
      })
      : this.checkCollisions({ firstHit: false, filter, includeHidden });
    const currMap = new Map();
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      const key = this._makeCollisionKey(c.shapeA, c.shapeB);
      currMap.set(key, c);
    }

    const enter = [];
    const stay = [];
    const exit = [];
    for (const [key, c] of currMap.entries()) {
      if (this._collisionPrevMap.has(key)) stay.push(c);
      else enter.push(c);
    }
    for (const [key, c] of this._collisionPrevMap.entries()) {
      if (!currMap.has(key)) exit.push(c);
    }
    this._collisionPrevMap = currMap;
    return { enter, stay, exit, all };
  }

  // ゲーム向けの軽量 collision body を登録する
  addCollisionBody(target, options = {}) {
    const node = this._resolveCollisionNode(target);
    if (!node) return null;

    const id = String(options.id ?? options.name ?? options.tag ?? node.name ?? `collision_${this._collisionIdSeed++}`);
    const shapeRef = this._resolveCollisionShapeRef(node, options);
    const body = {
      id,
      node,
      shapeRef,
      enabled: options.enabled !== false,
      type: String(options.type ?? "solid"),
      group: options.group ?? null,
      mask: options.mask ?? null,
      tag: String(options.tag ?? id),
      offset: this._copyVec3(options.offset ?? [0, 0, 0]) ?? [0, 0, 0],
      shape: this._normalizeCollisionBodyShape(options, shapeRef),
      debugName: String(options.debugName ?? node.name ?? id)
    };
    this.collisionBodies.set(body.id, body);
    return this._cloneCollisionBody(body);
  }

  // 登録済み collision body を返す
  getCollisionBody(idOrTarget) {
    if (!idOrTarget) return null;
    if (typeof idOrTarget === "string") {
      const body = this.collisionBodies.get(idOrTarget);
      return body ? this._cloneCollisionBody(body) : null;
    }
    for (const body of this.collisionBodies.values()) {
      if (body === idOrTarget || body.node === idOrTarget || body.shapeRef === idOrTarget) {
        return this._cloneCollisionBody(body);
      }
    }
    return null;
  }

  // collision body を一覧で返す
  getCollisionBodies() {
    return [...this.collisionBodies.values()].map((body) => this._cloneCollisionBody(body));
  }

  // collision body を削除する
  removeCollisionBody(idOrTarget) {
    const body = this._resolveCollisionBody(idOrTarget);
    if (!body) return false;
    return this.collisionBodies.delete(body.id);
  }

  // collision body を全削除する
  clearCollisionBodies() {
    this.collisionBodies.clear();
    this._collisionBodyPrevMap.clear();
  }

  // ゲーム向け collision body の enter/stay/exit を返す
  stepCollisions(deltaMs = 0, options = {}) {
    return this.updateCollisionBodyEvents({ ...options, deltaMs });
  }

  // collision body 同士の状態遷移を生成する
  updateCollisionBodyEvents({
    firstHit = false,
    filter,
    includeHidden = false
  } = {}) {
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node && node.parent === null) {
        node.setWorldMatrix();
      }
    }

    const bodies = [];
    for (const body of this.collisionBodies.values()) {
      if (!body || body.enabled === false) continue;
      const worldShape = this._getCollisionBodyWorldShape(body, includeHidden);
      if (!worldShape) continue;
      const entry = {
        ...this._cloneCollisionBody(body),
        worldShape
      };
      if (typeof filter === "function" && !filter(entry)) continue;
      bodies.push(entry);
    }

    const collisions = [];
    const currMap = new Map();
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const detail = this._overlapCollisionWorldShapes(a.worldShape, b.worldShape);
        if (!detail) continue;
        const collision = {
          idA: a.id,
          idB: b.id,
          bodyA: a,
          bodyB: b,
          nodeA: a.node,
          nodeB: b.node,
          tagA: a.tag,
          tagB: b.tag,
          kindA: a.worldShape.kind,
          kindB: b.worldShape.kind,
          boundsOnly: true,
          detail
        };
        const key = this._makeCollisionBodyKey(a, b);
        currMap.set(key, collision);
        if (firstHit) {
          this._collisionBodyPrevMap = currMap;
          return collision;
        }
        collisions.push(collision);
      }
    }

    const enter = [];
    const stay = [];
    const exit = [];
    for (const [key, collision] of currMap.entries()) {
      if (this._collisionBodyPrevMap.has(key)) stay.push(collision);
      else enter.push(collision);
    }
    for (const [key, collision] of this._collisionBodyPrevMap.entries()) {
      if (!currMap.has(key)) exit.push(collision);
    }
    this._collisionBodyPrevMap = currMap;
    return { enter, stay, exit, all: collisions };
  }

  // collision body同士の重なりを 1 件だけ判定する
  overlap(bodyA, bodyB) {
    const a = this._resolveCollisionBody(bodyA);
    const b = this._resolveCollisionBody(bodyB);
    if (!a || !b) return false;
    const worldA = this._getCollisionBodyWorldShape(a, false);
    const worldB = this._getCollisionBodyWorldShape(b, false);
    if (!worldA || !worldB) return false;
    return this._overlapCollisionWorldShapes(worldA, worldB) !== null;
  }

  _normalizeVec3(vec) {
    // 任意ベクトルを正規化し、無効値ならnullを返す
    const x = Number(vec[0]);
    const y = Number(vec[1]);
    const z = Number(vec[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    const len = Math.sqrt(x * x + y * y + z * z);
    if (!(len > 0.0)) return null;
    return [x / len, y / len, z / len];
  }

  _copyVec3(vec) {
    const x = Number(vec[0]);
    const y = Number(vec[1]);
    const z = Number(vec[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    return [x, y, z];
  }

  _resolveCollisionNode(target) {
    if (typeof target === "string") {
      return this.findNode(target);
    }
    return target ?? null;
  }

  _resolveCollisionShapeRef(node, options = {}) {
    if (options.shapeRef) return options.shapeRef;
    if (Number.isInteger(options.shapeIndex) && node?.shapes?.[options.shapeIndex]) {
      return node.shapes[options.shapeIndex];
    }
    if (typeof options.shapeName === "string" && node?.shapes) {
      const name = options.shapeName;
      for (let i = 0; i < node.shapes.length; i++) {
        const shape = node.shapes[i];
        if (shape?.getName?.() === name || shape?.name === name) {
          return shape;
        }
      }
    }
    return node?.shapes?.[0] ?? null;
  }

  _normalizeCollisionBodyShape(options = {}, shapeRef = null) {
    const raw = options.shape ?? options.collisionShape ?? shapeRef?.getCollisionShape?.() ?? null;
    const shape = raw ? { ...raw } : {};
    if (!shape.type) {
      shape.type = "aabb";
    }
    if (shape.type === "sphere") {
      if (Number.isFinite(shape.radius)) {
        shape.radius = Math.max(0.0, Number(shape.radius));
      } else if (Number.isFinite(options.radius)) {
        shape.radius = Math.max(0.0, Number(options.radius));
      } else if (shapeRef?.getBoundingBox) {
        const box = shapeRef.getBoundingBox();
        shape.radius = Math.max(
          Math.abs(box.maxx - box.minx),
          Math.abs(box.maxy - box.miny),
          Math.abs(box.maxz - box.minz)
        ) * 0.5;
      } else {
        shape.radius = 0.5;
      }
      shape.center = this._copyVec3(shape.center ?? [0, 0, 0]) ?? [0, 0, 0];
      return shape;
    }

    if (shape.box) {
      shape.box = { ...shape.box };
      return shape;
    }
    if (Array.isArray(shape.size) && shape.size.length >= 3) {
      const sx = Math.max(0.0, Number(shape.size[0]) || 0.0);
      const sy = Math.max(0.0, Number(shape.size[1]) || 0.0);
      const sz = Math.max(0.0, Number(shape.size[2]) || 0.0);
      shape.box = {
        minx: -sx * 0.5,
        maxx: sx * 0.5,
        miny: -sy * 0.5,
        maxy: sy * 0.5,
        minz: -sz * 0.5,
        maxz: sz * 0.5
      };
      return shape;
    }
    if (shapeRef?.getBoundingBox) {
      shape.box = { ...shapeRef.getBoundingBox() };
      return shape;
    }
    const sx = Number.isFinite(options.sizeX) ? Math.max(0.0, Number(options.sizeX)) : 1.0;
    const sy = Number.isFinite(options.sizeY) ? Math.max(0.0, Number(options.sizeY)) : 1.0;
    const sz = Number.isFinite(options.sizeZ) ? Math.max(0.0, Number(options.sizeZ)) : 1.0;
    shape.box = {
      minx: -sx * 0.5,
      maxx: sx * 0.5,
      miny: -sy * 0.5,
      maxy: sy * 0.5,
      minz: -sz * 0.5,
      maxz: sz * 0.5
    };
    return shape;
  }

  _cloneCollisionBody(body) {
    const shape = body.shape ? { ...body.shape } : null;
    if (shape?.box) {
      shape.box = { ...shape.box };
    }
    if (Array.isArray(shape?.center)) {
      shape.center = [...shape.center];
    }
    return {
      id: body.id,
      node: body.node,
      shapeRef: body.shapeRef,
      enabled: body.enabled,
      type: body.type,
      group: body.group,
      mask: body.mask,
      tag: body.tag,
      offset: [...(body.offset ?? [0, 0, 0])],
      shape,
      debugName: body.debugName
    };
  }

  _resolveCollisionBody(idOrTarget) {
    if (!idOrTarget) return null;
    if (typeof idOrTarget === "string") {
      return this.collisionBodies.get(idOrTarget) ?? null;
    }
    if (typeof idOrTarget === "object" && typeof idOrTarget.id === "string") {
      const body = this.collisionBodies.get(idOrTarget.id);
      if (body) return body;
    }
    for (const body of this.collisionBodies.values()) {
      if (body === idOrTarget || body.node === idOrTarget || body.shapeRef === idOrTarget) {
        return body;
      }
    }
    return null;
  }

  _getCollisionBodyWorldShape(body, includeHidden = false) {
    const node = body?.node ?? null;
    if (!node || !node.worldMatrix?.mulVector) {
      return null;
    }
    const shapeRef = body.shapeRef ?? null;
    if (!includeHidden && shapeRef?.isHidden) {
      return null;
    }
    const shape = body.shape ?? { type: "aabb" };
    const offset = body.offset ?? [0, 0, 0];
    const worldMatrix = node.worldMatrix;
    if (shape.type === "sphere") {
      const localCenter = [
        offset[0] + Number(shape.center?.[0] ?? 0),
        offset[1] + Number(shape.center?.[1] ?? 0),
        offset[2] + Number(shape.center?.[2] ?? 0)
      ];
      const center = worldMatrix.mulVector(localCenter);
      const scale = this._getWorldScaleFactor(worldMatrix);
      return {
        kind: "sphere",
        center,
        radius: Math.max(0.0, Number(shape.radius ?? 0.5)) * scale,
        body
      };
    }

    const localBox = this._resolveCollisionLocalBox(shape, shapeRef, offset);
    const aabb = this._getWorldAabbFromLocalBox(localBox, worldMatrix);
    if (!aabb) return null;
    return {
      kind: "aabb",
      aabb,
      body
    };
  }

  _resolveCollisionLocalBox(shape, shapeRef, offset = [0, 0, 0]) {
    if (shape?.box) {
      return this._offsetAabb(shape.box, offset);
    }
    if (shapeRef?.getBoundingBox) {
      return this._offsetAabb(shapeRef.getBoundingBox(), offset);
    }
    return this._offsetAabb({
      minx: -0.5,
      maxx: 0.5,
      miny: -0.5,
      maxy: 0.5,
      minz: -0.5,
      maxz: 0.5
    }, offset);
  }

  _offsetAabb(box, offset = [0, 0, 0]) {
    if (!box) return null;
    return {
      minx: box.minx + offset[0],
      maxx: box.maxx + offset[0],
      miny: box.miny + offset[1],
      maxy: box.maxy + offset[1],
      minz: box.minz + offset[2],
      maxz: box.maxz + offset[2]
    };
  }

  _getWorldScaleFactor(worldMatrix) {
    if (!worldMatrix?.mat) return 1.0;
    const m = worldMatrix.mat;
    const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    const sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
    const sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
    return Math.max(sx, sy, sz, 1.0);
  }

  _overlapCollisionWorldShapes(shapeA, shapeB) {
    if (!shapeA || !shapeB) return null;
    if (shapeA.kind === "sphere" && shapeB.kind === "sphere") {
      const dx = shapeA.center[0] - shapeB.center[0];
      const dy = shapeA.center[1] - shapeB.center[1];
      const dz = shapeA.center[2] - shapeB.center[2];
      const dist2 = dx * dx + dy * dy + dz * dz;
      const radius = shapeA.radius + shapeB.radius;
      return dist2 <= radius * radius ? {
        kind: "sphere-sphere",
        distance: Math.sqrt(dist2),
        radius
      } : null;
    }
    if (shapeA.kind === "sphere" && shapeB.kind === "aabb") {
      return this._sphereAabbOverlap(shapeA, shapeB.aabb)
        ? { kind: "sphere-aabb" }
        : null;
    }
    if (shapeA.kind === "aabb" && shapeB.kind === "sphere") {
      return this._sphereAabbOverlap(shapeB, shapeA.aabb)
        ? { kind: "sphere-aabb" }
        : null;
    }
    if (shapeA.kind === "aabb" && shapeB.kind === "aabb") {
      return this._overlapAabb(shapeA.aabb, shapeB.aabb)
        ? { kind: "aabb-aabb" }
        : null;
    }
    return null;
  }

  _sphereAabbOverlap(sphereShape, aabb) {
    const c = sphereShape.center;
    const r = sphereShape.radius;
    const x = Math.max(aabb.minx, Math.min(c[0], aabb.maxx));
    const y = Math.max(aabb.miny, Math.min(c[1], aabb.maxy));
    const z = Math.max(aabb.minz, Math.min(c[2], aabb.maxz));
    const dx = c[0] - x;
    const dy = c[1] - y;
    const dz = c[2] - z;
    return (dx * dx + dy * dy + dz * dz) <= r * r;
  }

  _makeCollisionBodyKey(bodyA, bodyB) {
    const idA = this._getObjectId(bodyA);
    const idB = this._getObjectId(bodyB);
    if (idA < idB) return `${idA}:${idB}`;
    return `${idB}:${idA}`;
  }

  _getWorldAabbFromLocalBox(localBox, worldMatrix) {
    // ローカルAABBの8頂点をワールド座標へ変換し、
    // それらを包含するワールドAABBを再構築する
    if (!localBox || !worldMatrix?.mulVector) return null;
    const minx = localBox.minx;
    const miny = localBox.miny;
    const minz = localBox.minz;
    const maxx = localBox.maxx;
    const maxy = localBox.maxy;
    const maxz = localBox.maxz;
    if (minx > maxx || miny > maxy || minz > maxz) return null;

    const corners = [
      [minx, miny, minz], [maxx, miny, minz],
      [minx, maxy, minz], [maxx, maxy, minz],
      [minx, miny, maxz], [maxx, miny, maxz],
      [minx, maxy, maxz], [maxx, maxy, maxz]
    ];

    const out = {
      minx: Number.POSITIVE_INFINITY,
      miny: Number.POSITIVE_INFINITY,
      minz: Number.POSITIVE_INFINITY,
      maxx: Number.NEGATIVE_INFINITY,
      maxy: Number.NEGATIVE_INFINITY,
      maxz: Number.NEGATIVE_INFINITY
    };

    for (let i = 0; i < corners.length; i++) {
      const p = worldMatrix.mulVector(corners[i]);
      if (p[0] < out.minx) out.minx = p[0];
      if (p[1] < out.miny) out.miny = p[1];
      if (p[2] < out.minz) out.minz = p[2];
      if (p[0] > out.maxx) out.maxx = p[0];
      if (p[1] > out.maxy) out.maxy = p[1];
      if (p[2] > out.maxz) out.maxz = p[2];
    }
    return out;
  }

  _intersectRayAabb(origin, dir, box) {
    // Slab法でレイとAABBの交差区間 [tNear, tFar] を求める
    let tMin = Number.NEGATIVE_INFINITY;
    let tMax = Number.POSITIVE_INFINITY;
    const eps = 1.0e-8;
    const axes = [
      [origin[0], dir[0], box.minx, box.maxx],
      [origin[1], dir[1], box.miny, box.maxy],
      [origin[2], dir[2], box.minz, box.maxz]
    ];

    for (let i = 0; i < 3; i++) {
      const o = axes[i][0];
      const d = axes[i][1];
      const minv = axes[i][2];
      const maxv = axes[i][3];

      if (Math.abs(d) < eps) {
        if (o < minv || o > maxv) return null;
        continue;
      }

      let t1 = (minv - o) / d;
      let t2 = (maxv - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }

    if (tMax < 0) return null;
    return { tNear: tMin, tFar: tMax };
  }

  _overlapAabb(aabbA, aabbB) {
    // 2つのAABBが各軸で重なっているかを判定する
    // x/y/z のいずれか1軸でも分離していれば非衝突とみなす
    if (aabbA.maxx < aabbB.minx || aabbB.maxx < aabbA.minx) return false;
    if (aabbA.maxy < aabbB.miny || aabbB.maxy < aabbA.miny) return false;
    if (aabbA.maxz < aabbB.minz || aabbB.maxz < aabbA.minz) return false;
    return true;
  }

  _getShapeTriangleIndices(shape) {
    // Shapeから三角形インデックス列を取得し、
    // 無ければ連番で補完する
    if (Array.isArray(shape.indicesArray) && shape.indicesArray.length > 0) {
      return shape.indicesArray;
    }
    if (shape.iObj && shape.iObj.length > 0) {
      return Array.from(shape.iObj);
    }
    const vcount = Math.floor((shape.positionArray?.length ?? 0) / 3);
    const out = [];
    for (let i = 0; i + 2 < vcount; i += 3) {
      out.push(i, i + 1, i + 2);
    }
    return out;
  }

  _getWorldVertices(shape, worldMatrix) {
    // Shape頂点配列をワールド座標へ一括変換して返す
    const src = shape.positionArray ?? [];
    const out = new Array(src.length);
    for (let i = 0; i + 2 < src.length; i += 3) {
      const p = worldMatrix.mulVector([src[i], src[i + 1], src[i + 2]]);
      out[i] = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
    }
    return out;
  }

  _getTri(worldVerts, triIndices, triNo) {
    // triNo番目の三角形を [v0, v1, v2] 形式で取り出す
    const i0 = triIndices[triNo * 3] * 3;
    const i1 = triIndices[triNo * 3 + 1] * 3;
    const i2 = triIndices[triNo * 3 + 2] * 3;
    return [
      [worldVerts[i0], worldVerts[i0 + 1], worldVerts[i0 + 2]],
      [worldVerts[i1], worldVerts[i1 + 1], worldVerts[i1 + 2]],
      [worldVerts[i2], worldVerts[i2 + 1], worldVerts[i2 + 2]]
    ];
  }

  _intersectShapeTriangles(shapeAData, shapeBData) {
    // 2つのShape三角形集合の交差を総当たりで探索する
    const triCountA = Math.floor(shapeAData.triIndices.length / 3);
    const triCountB = Math.floor(shapeBData.triIndices.length / 3);
    for (let ia = 0; ia < triCountA; ia++) {
      const triA = this._getTri(
        shapeAData.worldVerts, shapeAData.triIndices, ia
      );
      for (let ib = 0; ib < triCountB; ib++) {
        const triB = this._getTri(
          shapeBData.worldVerts, shapeBData.triIndices, ib
        );
        if (!this._triangleAabbOverlap(triA, triB)) continue;
        if (this._triangleTriangleIntersect3D(triA, triB)) {
          return { hit: true, triA: ia, triB: ib };
        }
      }
    }
    return { hit: false };
  }

  _triangleAabbOverlap(triangleA, triangleB) {
    // 三角形ごとのAABBを作って粗い重なり判定を行う
    // ここで不一致なら厳密な三角形交差計算を省略できる
    const boundsA = this._triangleBounds(triangleA);
    const boundsB = this._triangleBounds(triangleB);
    return this._overlapAabb(boundsA, boundsB);
  }

  _triangleBounds(triangle) {
    // 三角形3頂点から最小包含AABBを作る
    return {
      minx: Math.min(triangle[0][0], triangle[1][0], triangle[2][0]),
      miny: Math.min(triangle[0][1], triangle[1][1], triangle[2][1]),
      minz: Math.min(triangle[0][2], triangle[1][2], triangle[2][2]),
      maxx: Math.max(triangle[0][0], triangle[1][0], triangle[2][0]),
      maxy: Math.max(triangle[0][1], triangle[1][1], triangle[2][1]),
      maxz: Math.max(triangle[0][2], triangle[1][2], triangle[2][2])
    };
  }

  _triangleTriangleIntersect3D(triangleA, triangleB) {
    // 3D三角形同士の交差判定
    // 共面時は2D投影判定へ分岐する
    const a0 = triangleA[0], a1 = triangleA[1], a2 = triangleA[2];
    const b0 = triangleB[0], b1 = triangleB[1], b2 = triangleB[2];
    const nA = this._cross(this._sub(a1, a0), this._sub(a2, a0));
    const nB = this._cross(this._sub(b1, b0), this._sub(b2, b0));
    const lenA = this._length(nA);
    const lenB = this._length(nB);
    const eps = 1.0e-8;
    if (lenA < eps || lenB < eps) return false;

    const coplanar = this._length(this._cross(nA, nB)) < eps
      && Math.abs(this._dot(nA, this._sub(b0, a0))) < eps
      && Math.abs(this._dot(nA, this._sub(b1, a0))) < eps
      && Math.abs(this._dot(nA, this._sub(b2, a0))) < eps;
    if (coplanar) {
      return this._coplanarTriIntersect(triangleA, triangleB, nA);
    }

    const edgesA = [[a0, a1], [a1, a2], [a2, a0]];
    const edgesB = [[b0, b1], [b1, b2], [b2, b0]];
    for (let i = 0; i < 3; i++) {
      if (this._segmentTriangleIntersect(
        edgesA[i][0], edgesA[i][1], b0, b1, b2
      )) return true;
    }
    for (let i = 0; i < 3; i++) {
      if (this._segmentTriangleIntersect(
        edgesB[i][0], edgesB[i][1], a0, a1, a2
      )) return true;
    }
    return false;
  }

  _segmentTriangleIntersect(segmentStart, segmentEnd, triV0, triV1, triV2) {
    // 線分と三角形の交差をMoller-Trumbore系の式で判定する
    const dir = this._sub(segmentEnd, segmentStart);
    const e1 = this._sub(triV1, triV0);
    const e2 = this._sub(triV2, triV0);
    const h = this._cross(dir, e2);
    const det = this._dot(e1, h);
    const eps = 1.0e-8;
    if (Math.abs(det) < eps) return false;
    const invDet = 1.0 / det;
    const s = this._sub(segmentStart, triV0);
    const u = invDet * this._dot(s, h);
    if (u < -eps || u > 1.0 + eps) return false;
    const q = this._cross(s, e1);
    const v = invDet * this._dot(dir, q);
    if (v < -eps || u + v > 1.0 + eps) return false;
    const t = invDet * this._dot(e2, q);
    if (t < -eps || t > 1.0 + eps) return false;
    return true;
  }

  _coplanarTriIntersect(triangleA, triangleB, planeNormal) {
    // 共面三角形を2Dへ射影して包含/辺交差で判定する
    const axis = this._dominantAxis(planeNormal);
    const triA2D = [
      this._project2(triangleA[0], axis),
      this._project2(triangleA[1], axis),
      this._project2(triangleA[2], axis)
    ];
    const triB2D = [
      this._project2(triangleB[0], axis),
      this._project2(triangleB[1], axis),
      this._project2(triangleB[2], axis)
    ];

    for (let i = 0; i < 3; i++) {
      if (this._pointInTri2D(
        triA2D[i], triB2D[0], triB2D[1], triB2D[2]
      )) return true;
      if (this._pointInTri2D(
        triB2D[i], triA2D[0], triA2D[1], triA2D[2]
      )) return true;
    }

    const edgesA2D = [
      [triA2D[0], triA2D[1]],
      [triA2D[1], triA2D[2]],
      [triA2D[2], triA2D[0]]
    ];
    const edgesB2D = [
      [triB2D[0], triB2D[1]],
      [triB2D[1], triB2D[2]],
      [triB2D[2], triB2D[0]]
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (this._segmentIntersect2D(
          edgesA2D[i][0], edgesA2D[i][1], edgesB2D[j][0], edgesB2D[j][1]
        )) return true;
      }
    }
    return false;
  }

  _dominantAxis(normal) {
    // 法線の絶対値最大成分軸を返す
    // 投影先の平面選択に使う
    const ax = Math.abs(normal[0]);
    const ay = Math.abs(normal[1]);
    const az = Math.abs(normal[2]);
    if (ax > ay && ax > az) return 0;
    if (ay > az) return 1;
    return 2;
  }

  _project2(point3, axis) {
    // 3D点を指定軸に応じて2D座標へ射影する
    if (axis === 0) return [point3[1], point3[2]];
    if (axis === 1) return [point3[0], point3[2]];
    return [point3[0], point3[1]];
  }

  _pointInTri2D(point, triA2D, triB2D, triC2D) {
    // 2D点が三角形内（境界含む）にあるかを、
    // 向き符号で判定する
    const s1 = this._orient2D(point, triA2D, triB2D);
    const s2 = this._orient2D(point, triB2D, triC2D);
    const s3 = this._orient2D(point, triC2D, triA2D);
    const hasNeg = (s1 < 0) || (s2 < 0) || (s3 < 0);
    const hasPos = (s1 > 0) || (s2 > 0) || (s3 > 0);
    return !(hasNeg && hasPos);
  }

  _orient2D(pointA, pointB, pointC) {
    // 2D3点の外積符号（向き）を返す
    return (pointB[0] - pointA[0]) * (pointC[1] - pointA[1])
      - (pointB[1] - pointA[1]) * (pointC[0] - pointA[0]);
  }

  _segmentIntersect2D(segAStart, segAEnd, segBStart, segBEnd) {
    // 2D線分同士の交差を一般形/共線上判定で求める
    const o1 = this._orient2D(segAStart, segAEnd, segBStart);
    const o2 = this._orient2D(segAStart, segAEnd, segBEnd);
    const o3 = this._orient2D(segBStart, segBEnd, segAStart);
    const o4 = this._orient2D(segBStart, segBEnd, segAEnd);
    const eps = 1.0e-8;

    if (Math.abs(o1) < eps
      && this._onSegment2D(segAStart, segBStart, segAEnd)) return true;
    if (Math.abs(o2) < eps
      && this._onSegment2D(segAStart, segBEnd, segAEnd)) return true;
    if (Math.abs(o3) < eps
      && this._onSegment2D(segBStart, segAStart, segBEnd)) return true;
    if (Math.abs(o4) < eps
      && this._onSegment2D(segBStart, segAEnd, segBEnd)) return true;

    return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))
      && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
  }

  _onSegment2D(segStart, point, segEnd) {
    // 点が線分の軸平行バウンディング内にあるかを
    // 調べる
    return point[0] <= Math.max(segStart[0], segEnd[0])
      && point[0] >= Math.min(segStart[0], segEnd[0])
      && point[1] <= Math.max(segStart[1], segEnd[1])
      && point[1] >= Math.min(segStart[1], segEnd[1]);
  }

  _sub(vecA, vecB) {
    // 3Dベクトル差 vecA - vecB を返す
    return [vecA[0] - vecB[0], vecA[1] - vecB[1], vecA[2] - vecB[2]];
  }

  _dot(vecA, vecB) {
    // 3Dベクトルの内積を返す
    return vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];
  }

  _cross(vecA, vecB) {
    // 3Dベクトルの外積を返す
    return [
      vecA[1] * vecB[2] - vecA[2] * vecB[1],
      vecA[2] * vecB[0] - vecA[0] * vecB[2],
      vecA[0] * vecB[1] - vecA[1] * vecB[0]
    ];
  }

  _length(vec) {
    // ベクトル長を返す
    return Math.sqrt(this._dot(vec, vec));
  }

  _getObjectId(obj) {
    // オブジェクトへ一意IDを遅延付与して返す
    const key = "__webgCollisionId";
    if (obj[key] === undefined) {
      obj[key] = this._collisionIdSeed++;
    }
    return obj[key];
  }

  _makeCollisionKey(shapeA, shapeB) {
    // Shapeペアを順序非依存な文字列キーへ正規化する
    const idA = this._getObjectId(shapeA);
    const idB = this._getObjectId(shapeB);
    if (idA < idB) return idA + ":" + idB;
    return idB + ":" + idA;
  }
};    // class Space
