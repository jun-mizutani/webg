// -------------------------------------------------
// tile_sim sample
//   alpha_actor.js 2026/04/23
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import SmoothShader from "../../webg/SmoothShader.js";
import ModelAsset from "../../webg/ModelAsset.js";
import ModelBuilder from "../../webg/ModelBuilder.js";
import ModelLoader from "../../webg/ModelLoader.js";

const HUMAN_GLTF_FILE = new URL("./human.glb", import.meta.url).href;
const HUMAN_IDLE_ENTRY_DURATION_MS = 500;
const HUMAN_IDLE_LOOP_DURATION_MS = HUMAN_IDLE_ENTRY_DURATION_MS * 2;
const HUMAN_MODEL_SCALE = 2.0;
const HUMAN_RUNTIME_SCALE = 0.70;
const HUMAN_TURN_DURATION_MS = 180;
const HUMAN_FORWARD_YAW_OFFSET = 180.0;
const sharedHumanModelCache = new WeakMap();
const sharedBoneShaderCache = new WeakMap();

// glTF runtime から親を持たない root node だけを取り出す
// - instantiate() 直後の root は Space 直下にあるため、その node だけを Alpha の anchor へ付け替える
// - child node は root にぶら下がったままでよいので、ここでは root のみを列挙する
const collectRuntimeRootNodes = (runtime, instantiated) => {
  const nodes = Array.isArray(runtime?.nodes) ? runtime.nodes : [];
  const nodeMap = instantiated?.nodeMap;
  const roots = [];
  for (let i = 0; i < nodes.length; i++) {
    const nodeInfo = nodes[i];
    if (nodeInfo?.parent !== null) {
      continue;
    }
    const rootNode = nodeMap?.get?.(nodeInfo.id) ?? null;
    if (rootNode) {
      roots.push({
        nodeInfo,
        node: rootNode
      });
    }
  }
  return roots;
};

// 読み込んだ skinned mesh のおおよその中心と足元位置を返す
// - TileMap の cell 中央へ素直に立たせたいので、x / z は bbox center、y は bbox min を使う
// - glTF 側の origin が完全に足元中央でなくても、sample ではこの補正で見やすい配置へ寄せる
const measureRuntimeShapeBounds = (app, shapes) => {
  const size = app.getShapeSize(shapes ?? []);
  const minY = Number.isFinite(size.miny) ? size.miny : 0.0;
  const maxY = Number.isFinite(size.maxy) ? size.maxy : minY;
  return {
    centerX: Number.isFinite(size.centerx) ? size.centerx : 0.0,
    centerZ: Number.isFinite(size.centerz) ? size.centerz : 0.0,
    minY,
    maxY,
    height: Math.max(0.0, maxY - minY)
  };
};

// glTF root node が持つ imported uniform scale を 1 つの係数へまとめる
// - tile_sim の human.glb は root ごとに極端に違う scale を持たない前提で、
//   root localMatrix の uniform scale を平均して model 全体の imported scale とみなす
// - runtime 側で root local scale を有効化したあとも、表示高さは bbox から論理的に決めたいので、
//   ここで「importer 済み model に対して追加で何倍されるか」を取り出す
const resolveImportedRootUniformScale = (roots) => {
  const scales = [];
  for (let i = 0; i < roots.length; i++) {
    const localMatrix = roots[i]?.nodeInfo?.localMatrix;
    const uniformScale = localMatrix?.getUniformScale?.() ?? null;
    if (Number.isFinite(uniformScale) && uniformScale > 1.0e-8) {
      scales.push(Number(uniformScale));
    }
  }
  if (scales.length <= 0) {
    return 1.0;
  }
  const total = scales.reduce((sum, value) => sum + value, 0.0);
  return total / scales.length;
};

// actor の見た目上の向きに対して、cell 内の相対配置を world offset へ変換する
// - positive right は actor の右側、positive back は actor の背後側とみなす
// - support unit は Alpha の向きを基準に left / right へずらし、同じ cell でも重なりにくくする
const getFormationWorldOffset = (yawDeg, formationOffset = {}) => {
  const yawRad = Number(yawDeg) * Math.PI / 180.0;
  const forwardX = Math.sin(yawRad);
  const forwardZ = Math.cos(yawRad);
  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);
  const right = Number.isFinite(formationOffset.right) ? Number(formationOffset.right) : 0.0;
  const back = Number.isFinite(formationOffset.back) ? Number(formationOffset.back) : 0.0;
  const up = Number.isFinite(formationOffset.up) ? Number(formationOffset.up) : 0.0;
  return [
    rightX * right - forwardX * back,
    up,
    rightZ * right - forwardZ * back
  ];
};

// XZ 平面の進行ベクトルから webg の yaw(deg) を計算する
// - CoordinateSystem の Y 回転は、pitch=roll=0 のとき local +Z を `[sin(yaw), 0, cos(yaw)]` へ向ける
// - そのため world の移動差分 `(dx, dz)` に対して `atan2(dx, dz)` を使うと、
//   Alpha が進行方向を素直に向く
const getYawFromDirection = (dx, dz) => {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
    return null;
  }
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1.0e-8) {
    return null;
  }
  return Math.atan2(dx, dz) * 180.0 / Math.PI;
};

const getSharedHumanModelKey = (scale) => {
  return Number.isFinite(scale)
    ? Number(scale).toFixed(4)
    : String(HUMAN_MODEL_SCALE.toFixed(4));
};

const getSharedHumanModelScaleCache = (app) => {
  let scaleCache = sharedHumanModelCache.get(app);
  if (!scaleCache) {
    scaleCache = new Map();
    sharedHumanModelCache.set(app, scaleCache);
  }
  return scaleCache;
};

const getSharedTileSimBoneShader = async (app) => {
  let shaderPromise = sharedBoneShaderCache.get(app);
  if (!shaderPromise) {
    shaderPromise = (async () => {
      const boneShader = new SmoothShader(app.getGL());
      await boneShader.init();
      boneShader.setLightPosition(app.light?.position ?? [10.0, 24.0, 18.0, 1.0]);
      return boneShader;
    })();
    sharedBoneShaderCache.set(app, shaderPromise);
  }
  return shaderPromise;
};

// human.glb を 1 回だけ build し、scale ごとの shared runtime を返す
// - Alpha / Bravo / Mule / Warden は同じ glb を使うため、
//   geometry / GPU buffer / importer 適用済み material はここで共有する
// - 各 actor は後段の instantiate() で fresh な shape / skeleton / animation runtime を作る
const loadSharedHumanModel = async (app, scale = 1.0) => {
  const scaleCache = getSharedHumanModelScaleCache(app);
  const scaleKey = getSharedHumanModelKey(scale);
  if (scaleCache.has(scaleKey)) {
    return scaleCache.get(scaleKey);
  }

  const loadPromise = (async () => {
    const boneShader = await getSharedTileSimBoneShader(app);
    const loader = new ModelLoader(app);
    const loaded = await loader.loadAsset(HUMAN_GLTF_FILE, {
      format: "gltf",
      gltf: {
        includeSkins: true
      }
    });
    const sourceAsset = loaded.asset;
    const asset = ModelAsset.fromData(
      sourceAsset.cloneJSONValue(sourceAsset.getData())
    ).scaleUniform(scale);
    asset.assertValid();

    const builder = new ModelBuilder(app.getGL());
    const runtime = typeof builder.buildAsync === "function"
      ? await builder.buildAsync(asset.getData())
      : builder.build(asset.getData());
    if (typeof loaded.importer?.applyRuntimeMaterials === "function") {
      await loaded.importer.applyRuntimeMaterials(runtime);
    }
    const shapeTemplates = [...(runtime.shapes ?? [])];
    applyExplicitTextureFlagsToRuntimeShapes({ shapes: shapeTemplates });
    for (let i = 0; i < shapeTemplates.length; i++) {
      shapeTemplates[i]?.setShader?.(boneShader);
    }
    const bounds = measureRuntimeShapeBounds(app, shapeTemplates);

    return {
      source: HUMAN_GLTF_FILE,
      format: loaded.format,
      importer: loaded.importer,
      asset,
      runtime,
      shapeTemplates,
      bounds,
      instantiate(space = app.space, instantiateOptions = {}) {
        return runtime.instantiate(space, {
          bindAnimations: instantiateOptions.bindAnimations !== false
        });
      },
      getClipNames() {
        return asset.getClipNames();
      },
      getClipInfo(id) {
        return asset.getClipInfo(id);
      }
    };
  })();

  scaleCache.set(scaleKey, loadPromise);
  try {
    return await loadPromise;
  } catch (error) {
    scaleCache.delete(scaleKey);
    throw error;
  }
};

const applyExplicitTextureFlagsToRuntimeShapes = (runtime) => {
  const shapes = runtime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape?.updateMaterial) continue;
    const material = shape.getMaterial?.() ?? { params: shape.materialParams ?? {} };
    const params = material?.params ?? {};
    const hasTexture = !!(params.texture ?? shape.texture);
    // human.glb は mesh ごとに texture の有無が混ざりうるため、
    // SmoothShader を使う sample 側で use_texture を各 shape へ確定させる
    shape.updateMaterial({
      use_texture: hasTexture ? 1 : 0
    });
  }
};

// human.glb の shape 群へ tint color を適用する
// - glTF material の `color` は元データの base color なので上書きしない
// - SmoothShader の `multiplyColor` で後段から色を掛け、元 material の差を保ったまま役割色を付ける
const applyTintColorToRuntimeShapes = (runtime, tintColor = null) => {
  if (!Array.isArray(tintColor) || tintColor.length < 4) {
    return;
  }
  const shapes = runtime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape?.updateMaterial) continue;
    shape.updateMaterial({
      multiplyColor: [...tintColor]
    });
  }
};

// Alpha / support unit の skinned mesh に bind 済みの animation を直接進める
// - glTF は material / primitive 単位で shape が分かれるため、同じ human.glb でも
//   頭・胴体・手足のような複数 shape がそれぞれ別 skeleton / animation を持つことがある
// - 最初の `shape.anim` だけを再生すると、material 境界で一部だけ動いて残りが静止する
// - そのため runtime shapes から重複しない animation を全て集め、同じタイミングで開始・更新する
// - 利用者によれば `key2 == key0` なので、clip 全体を loop すれば `0 -> 1 -> 0` に見える
const createRuntimeIdlePlayer = (shapes) => {
  const animations = [];
  const seenAnimations = new Set();
  for (let i = 0; i < (shapes ?? []).length; i++) {
    const animation = shapes[i]?.anim ?? null;
    if (!animation || seenAnimations.has(animation)) {
      continue;
    }
    seenAnimations.add(animation);
    animations.push(animation);
  }

  if (animations.length === 0) {
    return null;
  }

  const clipInfos = animations.map((animation) => (
    typeof animation.getClipInfo === "function"
      ? animation.getClipInfo()
      : null
  ));
  const durationMs = clipInfos.reduce((maxDuration, clipInfo) => {
    const clipDuration = Number.isFinite(clipInfo?.durationMs)
      ? Number(clipInfo.durationMs)
      : 0.0;
    return Math.max(maxDuration, clipDuration);
  }, 0.0);

  if (durationMs > 0.0) {
    const speed = HUMAN_IDLE_LOOP_DURATION_MS / durationMs;
    for (let i = 0; i < animations.length; i++) {
      animations[i].schedule?.setSpeed?.(speed);
    }
  }

  return {
    durationMs,
    start() {
      for (let i = 0; i < animations.length; i++) {
        const animation = animations[i];
        animation.start?.();
        if (animation.schedule) {
          animation.schedule.pause = false;
        }
      }
    },
    update() {
      let allStopped = true;
      for (let i = 0; i < animations.length; i++) {
        const animation = animations[i];
        const result = animation.play?.();
        if (result >= 0) {
          allStopped = false;
        }
      }
      if (allStopped) {
        for (let i = 0; i < animations.length; i++) {
          animations[i].start?.();
        }
      }
    },
    getDebugInfo() {
      return {
        clipNames: animations.map((animation) => (
          typeof animation.getName === "function" ? animation.getName() : null
        )),
        animationCount: animations.length,
        durationMs,
        paused: animations.every((animation) => animation.schedule?.pause === true),
        stopped: animations.every((animation) => animation.schedule?.stopped === true)
      };
    }
  };
};

// human.glb を読み込み、指定 anchor node の world 位置へ追従する actor を作る
// - TileMap 側の論理 node は従来どおり tween や配置の土台として残し、見た目だけを skinned mesh へ差し替える
// - actor ごとに tint color を変え、Alpha / Bravo / Mule を同じ model でも見分けられるようにする
export const createTileSimHumanActor = async (app, anchorNode, options = {}) => {
  const modelScale = Number.isFinite(options.scale)
    ? Number(options.scale)
    : HUMAN_MODEL_SCALE;
  const desiredDisplayScale = Number.isFinite(options.runtimeScale)
    ? Number(options.runtimeScale)
    : HUMAN_RUNTIME_SCALE;
  const boneShader = await getSharedTileSimBoneShader(app);
  const model = await loadSharedHumanModel(app, modelScale);
  const instantiated = model.instantiate(app.space, {
    bindAnimations: true
  });
  const runtime = model.runtime;
  applyTintColorToRuntimeShapes(instantiated, options.tintColor ?? null);
  const runtimeShapes = instantiated?.shapes ?? [];
  for (let i = 0; i < runtimeShapes.length; i++) {
    runtimeShapes[i]?.setShader?.(boneShader);
  }
  const roots = collectRuntimeRootNodes(runtime, instantiated);
  if (roots.length === 0) {
    throw new Error("tile_sim human.glb root node was not found");
  }
  const importedRootScale = resolveImportedRootUniformScale(roots);
  const runtimeNodeScale = desiredDisplayScale / importedRootScale;

  // 表示用 model は ballNode の子へ直接ぶら下げず、独立 placement node に載せる
  // - gltf_loader と近い構造を保ち、親ノードの移動 tween が animation に干渉する可能性を減らす
  // - placement node 自体は毎 frame ballNode の world 位置へ追従させる
  const placementName = options.placementNodeName ?? "human-placement";
  const offsetName = options.offsetNodeName ?? "human-offset";
  const placementNode = app.space.addNode(null, placementName);
  const offsetNode = app.space.addNode(placementNode, offsetName);
  const bounds = model.bounds;
  const formationHeight = Math.max(0.1, bounds.height * desiredDisplayScale);
  const formationOffset = {
    right: (
      (Number.isFinite(options.formationRight) ? Number(options.formationRight) : 0.0)
      + formationHeight * (Number.isFinite(options.formationRightRatio) ? Number(options.formationRightRatio) : 0.0)
    ),
    back: (
      (Number.isFinite(options.formationBack) ? Number(options.formationBack) : 0.0)
      + formationHeight * (Number.isFinite(options.formationBackRatio) ? Number(options.formationBackRatio) : 0.0)
    ),
    up: Number.isFinite(options.formationUp) ? Number(options.formationUp) : 0.0
  };
  let currentFacingYaw = Number.isFinite(options.initialFacingYaw)
    ? Number(options.initialFacingYaw)
    : 0.0;
  const footClearance = Number.isFinite(options.footClearance)
    ? Number(options.footClearance)
    : -0.06;
  const baseY = footClearance - (
    Number(options.ballRadius ?? 0.0) +
    Number(options.ballLift ?? 0.0) +
    bounds.minY * desiredDisplayScale
  );
  const localYaw = Number.isFinite(options.yaw) ? Number(options.yaw) : 0.0;
  offsetNode.setPosition(
    -bounds.centerX * desiredDisplayScale,
    baseY,
    -bounds.centerZ * desiredDisplayScale
  );
  offsetNode.setAttitude(localYaw, 0.0, 0.0);
  // desiredDisplayScale は「最終的に見せたい大きさ」
  // importedRootScale をそのまま復元したうえで、offsetNode 側は逆算した倍率だけを持つ
  // これにより glTF root local scale を捨てず、bbox と imported scale から必要倍率を論理的に決められる
  offsetNode.setScale(runtimeNodeScale);
  placementNode.setAttitude(currentFacingYaw + HUMAN_FORWARD_YAW_OFFSET, 0.0, 0.0);

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i].node;
    const rootInfo = roots[i].nodeInfo;
    root.attach(offsetNode);

    // attach() はワールド位置を保つ親変更なので、
    // Alpha の root 自体は glTF 本来の local transform へ戻し、
    // 位置合わせは offsetNode 側だけで受け持つ
    // root の local transform は glTF 本来の localMatrix へ戻す
    // local scale も含めて復元し、そのぶん offsetNode 側の scale を逆算して整える
    // こうしておくと imported root scale を捨てずに、表示高さは bbox から論理的に決められる
    if (rootInfo?.localMatrix) {
      root.setByMatrix(rootInfo.localMatrix);
    }
  }

  const idlePlayer = createRuntimeIdlePlayer(runtimeShapes);
  idlePlayer?.start?.();

  return {
    model,
    runtime,
    instantiated,
    boneShader,
    placementNode,
    offsetNode,
    roots,
    idlePlayer,
    hideProxyShapes(shapes = []) {
      for (let i = 0; i < shapes.length; i++) {
        shapes[i]?.hide?.(true);
      }
    },
    update(deltaMs = 0) {
      boneShader.setProjectionMatrix?.(app.projectionMatrix);
      boneShader.setLightPosition?.(app.light?.position ?? [10.0, 24.0, 18.0, 1.0]);
      const worldPos = typeof anchorNode?.getWorldPosition === "function"
        ? anchorNode.getWorldPosition()
        : null;
      if (worldPos) {
        const formationYaw = Number.isFinite(options.getFormationYaw?.())
          ? Number(options.getFormationYaw())
          : currentFacingYaw;
        const worldOffset = getFormationWorldOffset(formationYaw, formationOffset);
        placementNode.setPosition(
          worldPos[0] + worldOffset[0],
          worldPos[1] + worldOffset[1],
          worldPos[2] + worldOffset[2]
        );
      }
      idlePlayer?.update?.(deltaMs);
    },
    faceTowardCells(fromCell, toCell, options = {}) {
      const fromCenter = fromCell?.center ?? null;
      const toCenter = toCell?.center ?? null;
      if (!Array.isArray(fromCenter) || !Array.isArray(toCenter)) {
        return null;
      }
      const yaw = getYawFromDirection(
        Number(toCenter[0]) - Number(fromCenter[0]),
        Number(toCenter[2]) - Number(fromCenter[2])
      );
      if (!Number.isFinite(yaw)) {
        return null;
      }
      currentFacingYaw = yaw;
      return placementNode.animateRotation([yaw + HUMAN_FORWARD_YAW_OFFSET, 0.0, 0.0], {
        durationMs: Number.isFinite(options.durationMs)
          ? Number(options.durationMs)
          : HUMAN_TURN_DURATION_MS,
        easing: options.easing ?? "outCubic"
      });
    },
    getFacingYaw() {
      return currentFacingYaw;
    },
    getDebugInfo() {
      return {
        clipNames: typeof model.getClipNames === "function" ? model.getClipNames() : [],
        idle: idlePlayer?.getDebugInfo?.() ?? null,
        height: bounds.height,
        formationOffset,
        runtimeScale: desiredDisplayScale,
        importedRootScale,
        runtimeNodeScale
      };
    }
  };
};

// Alpha 用の human.glb actor を作る
// - 既存の sample 入口では Alpha が主役なので、呼び出し側は従来どおり Alpha 専用 helper を使えるように残す
export const createTileSimAlphaActor = async (app, ballNode, options = {}) => {
  return createTileSimHumanActor(app, ballNode, {
    placementNodeName: "alpha-human-placement",
    offsetNodeName: "alpha-human-offset",
    ...options
  });
};
