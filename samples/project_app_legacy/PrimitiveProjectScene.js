// ---------------------------------------------
//  PrimitiveProjectScene.js  2026/09/08
//   Project manifestからprimitive sceneを構築するProjectApp sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// webg core modules
import Primitive from "../../webg/Primitive.js";
import Quat from "../../webg/Quat.js";
import Shape from "../../webg/Shape.js";
import util from "../../webg/util.js";

// objectのキーを確認し、設定の読み間違いを別の処理へ渡さずに通知します
function requireKnownKeys(value, label, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${label}.${key} is not supported`);
  }
}

// vec3とquaternionを同じ数値検証へ通し、Nodeとphysicsの初期値へ再利用します
function readVector(value, label, defaults, options = {}) {
  const source = value === undefined ? defaults : value;
  if (!Array.isArray(source) || source.length !== defaults.length) {
    throw new Error(`${label} must contain ${defaults.length} numbers`);
  }
  return source.map((entry, index) => util.readFiniteNumber(entry, `${label}[${index}]`, options));
}

// Box、Sphere、Capsuleの寸法を検証し、表示と衝突で共有できる形状定義へ変換します
function readPrimitiveShape(value, label) {
  const shape = util.readPlainObject(value, label, {});
  requireKnownKeys(shape, label, new Set(["type", "size", "radius", "segmentLength", "offset"]));
  const type = util.readOptionalEnum(shape.type, `${label}.type`, undefined, ["box", "sphere", "capsule"]);
  if (type === "box") {
    if (!Array.isArray(shape.size) || shape.size.length !== 3) {
      throw new Error(`${label}.size must contain three positive numbers`);
    }
    return {
      type,
      size: shape.size.map((entry, index) => util.readFiniteNumber(
        entry,
        `${label}.size[${index}]`,
        { minExclusive: 0.0 }
      )),
      ...(shape.offset === undefined ? {} : {
        offset: readVector(shape.offset, `${label}.offset`, [0.0, 0.0, 0.0])
      })
    };
  }
  const radius = util.readFiniteNumber(shape.radius, `${label}.radius`, { minExclusive: 0.0 });
  if (type === "sphere") {
    return {
      type,
      radius,
      ...(shape.offset === undefined ? {} : {
        offset: readVector(shape.offset, `${label}.offset`, [0.0, 0.0, 0.0])
      })
    };
  }
  return {
    type,
    radius,
    segmentLength: util.readFiniteNumber(shape.segmentLength, `${label}.segmentLength`, { min: 0.0 }),
    ...(shape.offset === undefined ? {} : {
      offset: readVector(shape.offset, `${label}.offset`, [0.0, 0.0, 0.0])
    })
  };
}

// 作品の見た目に必要なPBR値を検証し、Shape.setMaterial()用の値へ変換します
// 材質manifestの定義とprimitive objectからの参照を同じ変換結果へそろえます
function readPrimitiveMaterial(value, label) {
  const source = util.readPlainObject(value, label, {});
  requireKnownKeys(source, label, new Set([
    "id", "color", "alpha", "alphaMode", "alphaCutoff", "ambient", "specular", "power",
    "metallic", "roughness", "occlusion", "emissive", "emissiveFactor", "flatShading", "doubleSided"
  ]));
  const color = readVector(source.color, `${label}.color`, [0.8, 0.8, 0.8, 1.0], { min: 0.0, max: 1.0 });
  const alphaMode = util.readOptionalEnum(source.alphaMode, `${label}.alphaMode`, "OPAQUE", ["OPAQUE", "MASK", "BLEND"]);
  const readRange = (key, defaultValue, min = 0.0, max = 1.0) => util.readFiniteNumber(
    source[key] ?? defaultValue,
    `${label}.${key}`,
    { min, max }
  );
  const emissiveFactor = readVector(
    source.emissiveFactor,
    `${label}.emissiveFactor`,
    [0.0, 0.0, 0.0],
    { min: 0.0 }
  );
  const id = util.readOptionalString(source.id, `${label}.id`, label.replace(/[^A-Za-z0-9_-]/g, "-"), {
    trim: true,
    allowEmpty: false
  });
  return {
    id,
    params: {
      has_bone: 0,
      use_texture: 0,
      color,
      alpha: readRange("alpha", alphaMode === "BLEND" ? color[3] : 1.0),
      alpha_mode: alphaMode,
      alpha_cutoff: readRange("alphaCutoff", 0.5),
      ambient: readRange("ambient", 0.0),
      specular: readRange("specular", 1.0),
      power: util.readFiniteNumber(source.power ?? 34.0, `${label}.power`, { min: 0.0 }),
      metallic: readRange("metallic", 0.0),
      roughness: readRange("roughness", 0.5),
      occlusion: readRange("occlusion", 1.0),
      emissive: util.readFiniteNumber(source.emissive ?? 0.0, `${label}.emissive`, { min: 0.0 }),
      emissive_factor: emissiveFactor,
      flat_shading: util.readOptionalBoolean(source.flatShading, `${label}.flatShading`, false) ? 1 : 0,
      double_sided: util.readOptionalBoolean(source.doubleSided, `${label}.doubleSided`, false) ? 1 : 0
    }
  };
}

// primitive用の材質manifestをID表へ変換し、objectから一意に参照できる状態を作ります
// 材質値の編集場所をmanifestへ集め、複数objectで同じ材質を共有できる構成にします
export function readPrimitiveMaterialManifest(value, label = "SceneProject materials") {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const definitions = new Map();
  value.forEach((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const source = util.readPlainObject(entry, itemLabel, {});
    requireKnownKeys(source, itemLabel, new Set([
      "id", "color", "alpha", "alphaMode", "alphaCutoff", "ambient", "specular", "power",
      "metallic", "roughness", "occlusion", "emissive", "emissiveFactor", "flatShading", "doubleSided"
    ]));
    const id = util.readOptionalString(source.id, `${itemLabel}.id`, undefined, {
      trim: true,
      allowEmpty: false
    });
    if (definitions.has(id)) throw new Error(`${label} has duplicated id: ${id}`);
    const material = readPrimitiveMaterial(source, itemLabel);
    definitions.set(id, Object.freeze({ ...material, id }));
  });
  return definitions;
}

// 物理surfaceとbodyの入力を検証し、ProjectRuntimeへ渡すbody設定へ変換します
// collider shapeを省略した場合は表示shapeを使い、同じ物体の寸法重複を減らします
function readPrimitivePhysics(value, objectShape, label) {
  if (value === undefined) return null;
  const source = util.readPlainObject(value, label, {});
  requireKnownKeys(source, label, new Set([
    "bodyType", "mass", "initialState", "linearVelocity", "angularVelocity", "shape", "colliderRelation", "transformSpace",
    "linearDamping", "angularDamping", "gravityScale", "allowSleep", "isSleeping", "isTrigger",
    "fixedRotation", "collisionLayer", "collisionMask", "material", "anchors"
  ]));
  const bodyType = util.readOptionalEnum(source.bodyType, `${label}.bodyType`, undefined, ["static", "kinematic", "dynamic"]);
  if (bodyType === undefined) throw new Error(`${label}.bodyType is required`);
  if (bodyType === "dynamic" && source.mass === undefined) throw new Error(`${label}.mass is required for dynamic body`);
  const material = source.material === undefined ? undefined : util.readPlainObject(source.material, `${label}.material`, {});
  if (material) {
    requireKnownKeys(material, `${label}.material`, new Set(["friction", "restitution", "linearDamping", "angularDamping"]));
    if (material.friction !== undefined) util.readFiniteNumber(material.friction, `${label}.material.friction`, { min: 0.0 });
    if (material.restitution !== undefined) util.readFiniteNumber(material.restitution, `${label}.material.restitution`, { min: 0.0, max: 1.0 });
    for (const key of ["linearDamping", "angularDamping"]) {
      if (material[key] !== undefined) util.readFiniteNumber(material[key], `${label}.material.${key}`, { min: 0.0 });
    }
  }
  const result = {
    bodyType,
    ...(source.mass === undefined ? {} : { mass: util.readFiniteNumber(source.mass, `${label}.mass`, { minExclusive: 0.0 }) }),
    ...(source.linearVelocity === undefined ? {} : {
      linearVelocity: readVector(source.linearVelocity, `${label}.linearVelocity`, [0.0, 0.0, 0.0])
    }),
    ...(source.angularVelocity === undefined ? {} : {
      angularVelocity: readVector(source.angularVelocity, `${label}.angularVelocity`, [0.0, 0.0, 0.0])
    }),
    shape: readPrimitiveShape(source.shape ?? objectShape, `${label}.shape`),
    ...(material === undefined ? {} : { material: { ...material } })
  };
  for (const key of [
    "initialState", "colliderRelation", "transformSpace", "gravityScale", "allowSleep", "isSleeping",
    "isTrigger", "fixedRotation", "collisionLayer", "collisionMask", "linearDamping", "angularDamping", "anchors"
  ]) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

// project.objectsを検証し、表示・材質・物理を同じ物体IDで追跡できる定義へ変換します
export function readPrimitiveObjectDefinitions(value, label = "SceneProject objects", options = {}) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const sourceOptions = util.readPlainObject(options, `${label} options`, {});
  requireKnownKeys(sourceOptions, `${label} options`, new Set([
    "materialDefinitions", "allowMaterialReference"
  ]));
  const materialDefinitions = sourceOptions.materialDefinitions ?? null;
  const allowMaterialReference = util.readOptionalBoolean(
    sourceOptions.allowMaterialReference,
    `${label} options.allowMaterialReference`,
    false
  );
  const ids = new Set();
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const source = util.readPlainObject(entry, itemLabel, {});
    requireKnownKeys(source, itemLabel, new Set(["id", "shape", "transform", "material", "physics"]));
    const id = util.readOptionalString(source.id, `${itemLabel}.id`, undefined, {
      trim: true,
      allowEmpty: false
    });
    if (ids.has(id)) throw new Error(`${label} has duplicated id: ${id}`);
    ids.add(id);
    const shape = readPrimitiveShape(source.shape, `${itemLabel}.shape`);
    const transform = util.readPlainObject(source.transform, `${itemLabel}.transform`, {});
    requireKnownKeys(transform, `${itemLabel}.transform`, new Set(["position", "orientation"]));
    let material;
    if (typeof source.material === "string") {
      const materialId = util.readOptionalString(
        source.material,
        `${itemLabel}.material`,
        undefined,
        { trim: true, allowEmpty: false }
      );
      if (materialDefinitions) {
        material = materialDefinitions.get(materialId);
        if (!material) {
          throw new Error(
            `${itemLabel}.material references ${materialId}, `
            + "but materials manifest has no matching id"
          );
        }
      } else if (allowMaterialReference) {
        material = Object.freeze({ id: materialId, params: null });
      } else {
        throw new Error(`${itemLabel}.material must reference a materials manifest id`);
      }
    } else {
      if (materialDefinitions) {
        throw new Error(`${itemLabel}.material must reference a materials manifest id`);
      }
      material = readPrimitiveMaterial(source.material, `${itemLabel}.material`);
    }
    return {
      id,
      shape,
      transform: {
        position: readVector(transform.position, `${itemLabel}.transform.position`, [0.0, 0.0, 0.0]),
        orientation: readVector(transform.orientation, `${itemLabel}.transform.orientation`, [0.0, 0.0, 0.0, 1.0])
      },
      material,
      physics: readPrimitivePhysics(source.physics, shape, `${itemLabel}.physics`)
    };
  });
}

// plain object同士を再帰的に結合し、prototypeと個体差を一つのobject定義へ展開します
// 物体のIDは配置規則側で生成し、overrideから表示・物理の意味を変更できるようにします
function mergePrimitiveDefinition(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return structuredClone(overrideValue === undefined ? baseValue : overrideValue);
  }
  const base = baseValue && typeof baseValue === "object" ? baseValue : {};
  const override = overrideValue && typeof overrideValue === "object" ? overrideValue : {};
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const baseEntry = result[key];
    if (value && typeof value === "object" && !Array.isArray(value)
      && baseEntry && typeof baseEntry === "object" && !Array.isArray(baseEntry)) {
      result[key] = mergePrimitiveDefinition(baseEntry, value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

// grid3dの個数・原点・間隔を検証し、各個体の配置座標を生成します
// 同じ入力から同じstable IDと座標を得られるため、再読込みとResetで個体の対応を保てます
function readPrimitiveObjectSetPlacement(value, label) {
  const placement = util.readPlainObject(value, label, {});
  requireKnownKeys(placement, label, new Set([
    "type", "count", "origin", "spacing", "seed", "jitter"
  ]));
  const type = util.readOptionalEnum(placement.type, `${label}.type`, "grid3d", ["grid3d"]);
  const count = readVector(placement.count, `${label}.count`, [1, 1, 1], { integer: true, min: 1 });
  const origin = readVector(placement.origin, `${label}.origin`, [0.0, 0.0, 0.0]);
  const spacing = readVector(placement.spacing, `${label}.spacing`, [0.0, 0.0, 0.0]);
  const seed = placement.seed === undefined
    ? 0
    : util.readFiniteNumber(placement.seed, `${label}.seed`, { integer: true, min: 0 });
  const jitter = readVector(placement.jitter, `${label}.jitter`, [0.0, 0.0, 0.0], { min: 0.0 });
  return { type, count, origin, spacing, seed, jitter };
}

// objectSetの個体差へ適用できる数値patternを検証し、cycleとrangeを共通形式へ変換します
// 値の種類と配列長を呼出側で固定し、任意の式を実行せずに設定内容を追跡できる形にします
function readPrimitiveObjectSetValuePattern(value, label, valueLength = null) {
  const pattern = util.readPlainObject(value, label, {});
  requireKnownKeys(pattern, label, new Set(["type", "values", "start", "step"]));
  const type = util.readOptionalEnum(pattern.type, `${label}.type`, undefined, ["cycle", "range"]);
  if (type === "cycle") {
    if (!Array.isArray(pattern.values) || pattern.values.length === 0) {
      throw new Error(`${label}.values must contain at least one value`);
    }
    const values = pattern.values.map((entry, index) => valueLength === null
      ? util.readFiniteNumber(entry, `${label}.values[${index}]`)
      : readVector(
        entry,
        `${label}.values[${index}]`,
        new Array(valueLength).fill(0.0)
      ));
    return { type, values };
  }
  if (type !== "range") throw new Error(`${label}.type is required`);
  if (valueLength !== null) {
    throw new Error(`${label}.range supports scalar values only`);
  }
  return {
    type,
    start: util.readFiniteNumber(pattern.start, `${label}.start`),
    step: util.readFiniteNumber(pattern.step, `${label}.step`)
  };
}

// transformとphysicsの初期値patternを読み、許可した編集項目だけへ限定します
// pattern項目を明示的な構造に置くため、設定pathと生成値の対応をdiagnosticsから追跡できます
function readPrimitiveObjectSetInstancePattern(value, label) {
  if (value === undefined) return null;
  const source = util.readPlainObject(value, label, {});
  requireKnownKeys(source, label, new Set(["transform", "physics"]));
  const result = {};
  if (source.transform !== undefined) {
    const transform = util.readPlainObject(source.transform, `${label}.transform`, {});
    requireKnownKeys(transform, `${label}.transform`, new Set(["orientation"]));
    if (transform.orientation !== undefined) {
      result.transform = {
        orientation: readPrimitiveObjectSetValuePattern(
          transform.orientation,
          `${label}.transform.orientation`,
          4
        )
      };
    }
  }
  if (source.physics !== undefined) {
    const physics = util.readPlainObject(source.physics, `${label}.physics`, {});
    requireKnownKeys(physics, `${label}.physics`, new Set([
      "linearVelocity", "angularVelocity", "mass"
    ]));
    result.physics = {};
    if (physics.linearVelocity !== undefined) {
      result.physics.linearVelocity = readPrimitiveObjectSetValuePattern(
        physics.linearVelocity,
        `${label}.physics.linearVelocity`,
        3
      );
    }
    if (physics.angularVelocity !== undefined) {
      result.physics.angularVelocity = readPrimitiveObjectSetValuePattern(
        physics.angularVelocity,
        `${label}.physics.angularVelocity`,
        3
      );
    }
    if (physics.mass !== undefined) {
      result.physics.mass = readPrimitiveObjectSetValuePattern(
        physics.mass,
        `${label}.physics.mass`
      );
    }
  }
  return result;
}

// 一つのpatternからindexに対応する値を取り出し、object定義へ明示的に書き込みます
// cycleは登録順、rangeはstartとstepから算出し、overrideを適用する前の共通初期値を作ります
function resolvePrimitiveObjectSetValuePattern(pattern, index) {
  if (pattern.type === "cycle") return structuredClone(pattern.values[index % pattern.values.length]);
  return pattern.start + pattern.step * index;
}

// objectSetのinstancePatternをtransformとphysicsへ適用します
// 物体ごとの差分はこの段階で明示値へ展開され、後続の通常検証とbody登録へ渡されます
function applyPrimitiveObjectSetInstancePattern(value, pattern, index) {
  if (pattern === null) return value;
  const result = structuredClone(value);
  if (pattern.transform?.orientation) {
    result.transform ??= {};
    result.transform.orientation = resolvePrimitiveObjectSetValuePattern(
      pattern.transform.orientation,
      index
    );
  }
  if (pattern.physics) {
    result.physics ??= {};
    for (const field of ["linearVelocity", "angularVelocity", "mass"]) {
      const fieldPattern = pattern.physics[field];
      if (fieldPattern) {
        result.physics[field] = resolvePrimitiveObjectSetValuePattern(fieldPattern, index);
      }
    }
  }
  return result;
}

// 小さな決定的乱数を使い、objectSetsのseed付きjitterを再現可能な座標へ変換します
// Math.randomを使わず、ブラウザ再読込みとdiagnosticsの再生成で同じ配置を保ちます
function primitiveSetHash01(value) {
  const raw = Math.sin(value * 91.3458 + 17.123) * 47453.5453;
  return raw - Math.floor(raw);
}

// prototype、placement、個体overrideから明示object配列を生成します
// 生成後は通常のobjects[]と同じ検証・Shape生成・physics body生成へ渡します
export function expandPrimitiveObjectSet(value, label = "SceneProject.objectSet") {
  const source = util.readPlainObject(value, label, {});
  requireKnownKeys(source, label, new Set([
    "id", "prototype", "variants", "variantPattern", "placement", "instancePattern", "overrides"
  ]));
  const id = util.readOptionalString(source.id, `${label}.id`, undefined, {
    trim: true,
    allowEmpty: false
  });
  const hasPrototype = source.prototype !== undefined;
  const hasVariants = source.variants !== undefined;
  if (hasPrototype === hasVariants) {
    throw new Error(`${label} requires exactly one of prototype or variants`);
  }
  const definitionKeys = new Set(["shape", "transform", "material", "physics"]);
  const validateDefinition = (definition, definitionLabel) => {
    const result = util.readPlainObject(definition, definitionLabel, {});
    requireKnownKeys(result, definitionLabel, definitionKeys);
    if (result.shape === undefined) throw new Error(`${definitionLabel}.shape is required`);
    if (result.material === undefined) throw new Error(`${definitionLabel}.material is required`);
    return result;
  };
  let prototype;
  let variantById = null;
  let variantValues = null;
  if (hasPrototype) {
    prototype = validateDefinition(source.prototype, `${label}.prototype`);
    if (source.variantPattern !== undefined) {
      throw new Error(`${label}.variantPattern requires variants`);
    }
  } else {
    if (!Array.isArray(source.variants) || source.variants.length === 0) {
      throw new Error(`${label}.variants must contain at least one definition`);
    }
    variantById = new Map();
    source.variants.forEach((entry, index) => {
      const variantLabel = `${label}.variants[${index}]`;
      const variant = util.readPlainObject(entry, variantLabel, {});
      requireKnownKeys(variant, variantLabel, new Set(["id", ...definitionKeys]));
      const variantId = util.readOptionalString(variant.id, `${variantLabel}.id`, undefined, {
        trim: true,
        allowEmpty: false
      });
      if (variantById.has(variantId)) throw new Error(`${label}.variants has duplicated id: ${variantId}`);
      const { id: ignoredId, ...definition } = variant;
      variantById.set(variantId, validateDefinition(definition, variantLabel));
    });
    const pattern = util.readPlainObject(source.variantPattern, `${label}.variantPattern`, {});
    requireKnownKeys(pattern, `${label}.variantPattern`, new Set(["type", "values"]));
    const patternType = util.readOptionalEnum(
      pattern.type,
      `${label}.variantPattern.type`,
      "cycle",
      ["cycle"]
    );
    if (!Array.isArray(pattern.values) || pattern.values.length === 0) {
      throw new Error(`${label}.variantPattern.values must contain at least one variant id`);
    }
    variantValues = pattern.values.map((entry, index) => {
      const variantId = util.readOptionalString(
        entry,
        `${label}.variantPattern.values[${index}]`,
        undefined,
        { trim: true, allowEmpty: false }
      );
      if (!variantById.has(variantId)) {
        throw new Error(`${label}.variantPattern.values[${index}] references ${variantId}, but variants has no matching id`);
      }
      return variantId;
    });
    prototype = null;
    if (patternType !== "cycle") throw new Error(`${label}.variantPattern.type is not supported: ${patternType}`);
  }
  const placement = readPrimitiveObjectSetPlacement(source.placement, `${label}.placement`);
  const instancePattern = readPrimitiveObjectSetInstancePattern(
    source.instancePattern,
    `${label}.instancePattern`
  );
  const [countX, countY, countZ] = placement.count;
  const totalCount = countX * countY * countZ;
  const overrides = Array.isArray(source.overrides) ? source.overrides : [];
  if (!Array.isArray(source.overrides) && source.overrides !== undefined) {
    throw new Error(`${label}.overrides must be an array`);
  }
  const overrideByIndex = new Map();
  overrides.forEach((entry, overrideIndex) => {
    const overrideLabel = `${label}.overrides[${overrideIndex}]`;
    const override = util.readPlainObject(entry, overrideLabel, {});
    requireKnownKeys(override, overrideLabel, new Set([
      "index", "shape", "transform", "material", "physics"
    ]));
    const index = util.readFiniteNumber(override.index, `${overrideLabel}.index`, {
      integer: true,
      min: 0,
      max: totalCount - 1
    });
    if (overrideByIndex.has(index)) throw new Error(`${label}.overrides has duplicated index: ${index}`);
    const { index: ignoredIndex, ...values } = override;
    overrideByIndex.set(index, values);
  });

  const entries = [];
  const entryVariantIds = [];
  for (let y = 0; y < countY; y += 1) {
    for (let z = 0; z < countZ; z += 1) {
      for (let x = 0; x < countX; x += 1) {
        const index = (y * countZ + z) * countX + x;
        const jitter = placement.jitter.map((amount, axis) => {
          if (amount === 0.0) return 0.0;
          const random = primitiveSetHash01(placement.seed + index * 17.0 + axis * 31.0);
          return (random * 2.0 - 1.0) * amount;
        });
        const variantId = variantValues === null
          ? null
          : variantValues[index % variantValues.length];
        const variant = variantValues === null ? prototype : variantById.get(variantId);
        const variantTransform = variant.transform;
        const prototypeTransform = variantTransform === undefined
          ? {}
          : util.readPlainObject(
            variantTransform,
            `${label}.${variantId === null ? "prototype" : `variants.${variantId}`}.transform`,
            {}
          );
        const prototypePosition = readVector(
          prototypeTransform.position,
          `${label}.prototype.transform.position`,
          [0.0, 0.0, 0.0]
        );
        const generated = mergePrimitiveDefinition(variant, {
          transform: {
            ...prototypeTransform,
            position: placement.origin.map((originValue, axis) => (
              originValue + [x, y, z][axis] * placement.spacing[axis]
              + prototypePosition[axis] + jitter[axis]
            ))
          }
        });
        const patterned = applyPrimitiveObjectSetInstancePattern(generated, instancePattern, index);
        const resolved = mergePrimitiveDefinition(patterned, overrideByIndex.get(index));
        resolved.id = `${id}_${String(index).padStart(3, "0")}`;
        entries.push(resolved);
        entryVariantIds.push(variantId);
      }
    }
  }
  return Object.freeze({
    id,
    placement,
    variantIds: Object.freeze(entryVariantIds),
    entries: Object.freeze(entries)
  });
}

// 明示objectsとobjectSetsを一つのresolved object列へまとめます
// どちらの記述方式でもShape、physics body、Joint、diagnosticsが同じID規則を使えるようにします
export function readPrimitiveProjectObjectDefinitions(
  objectValue,
  objectSetsValue,
  label = "SceneProject",
  options = {}
) {
  const definitions = [];
  const ids = new Set();
  if (objectValue !== undefined) {
    const explicit = readPrimitiveObjectDefinitions(objectValue, `${label}.objects`, options);
    explicit.forEach((definition, index) => {
      if (ids.has(definition.id)) throw new Error(`${label} has duplicated id: ${definition.id}`);
      ids.add(definition.id);
      definitions.push({
        ...definition,
        source: Object.freeze({ type: "object", index })
      });
    });
  }
  if (objectSetsValue !== undefined) {
    if (!Array.isArray(objectSetsValue)) throw new Error(`${label}.objectSets must be an array`);
    objectSetsValue.forEach((set, setIndex) => {
      const setLabel = `${label}.objectSets[${setIndex}]`;
      const expanded = expandPrimitiveObjectSet(set, setLabel);
      const setDefinitions = readPrimitiveObjectDefinitions(
        expanded.entries,
        `${setLabel}.generated`,
        options
      );
      setDefinitions.forEach((definition, index) => {
        if (ids.has(definition.id)) throw new Error(`${label} has duplicated id: ${definition.id}`);
        ids.add(definition.id);
        definitions.push({
          ...definition,
          source: Object.freeze({
            type: "objectSet",
            setId: expanded.id,
            setIndex,
            index,
            ...(expanded.variantIds[index] === null ? {} : {
              variantId: expanded.variantIds[index]
            })
          })
        });
      });
    });
  }
  if (definitions.length === 0) throw new Error(`${label} requires objects or objectSets`);
  return definitions;
}

// primitive geometryをShapeへ変換し、物体定義に記述したPBR値を適用します
function createPrimitiveShape(gpu, definition) {
  const shape = new Shape(gpu);
  const options = shape.getPrimitiveOptions();
  const geometry = definition.shape;
  if (geometry.type === "box") shape.applyPrimitiveAsset(Primitive.cuboid(...geometry.size, options));
  if (geometry.type === "sphere") shape.applyPrimitiveAsset(Primitive.sphere(geometry.radius, 32, 24, options));
  if (geometry.type === "capsule") shape.applyPrimitiveAsset(
    Primitive.capsule(geometry.radius, geometry.segmentLength, 10, 20, options)
  );
  shape.endShape();
  shape.setMaterial(definition.material.id, definition.material.params);
  return shape;
}

// 物体定義からNodeを生成し、ProjectRuntimeが同じIDでbodyを取得できるsceneを返します
// callbackへShape生成を残さず、利用者はproject JSONの物体定義だけを変更できます
export function createPrimitiveScene(
  app,
  value,
  label = "SceneProject objects",
  materialDefinitions = null,
  objectSetsValue = undefined
) {
  const definitions = readPrimitiveProjectObjectDefinitions(value, objectSetsValue, label, {
    materialDefinitions,
    allowMaterialReference: materialDefinitions === null
  });
  const nodes = new Map();
  const entries = definitions.map((definition) => {
    const node = app.space.addNode(null, definition.id);
    node.setPosition(...definition.transform.position);
    const orientation = new Quat();
    // project JSONはModelAssetと同じ[x, y, z, w]で保持し、webg内部の[w, x, y, z]へ変換します
    const [x, y, z, w] = definition.transform.orientation;
    orientation.q = [w, x, y, z];
    node.setQuat(orientation);
    node.addShape(createPrimitiveShape(app.getGPU(), definition));
    nodes.set(definition.id, node);
    return Object.freeze({ ...definition, node });
  });
  return Object.freeze({
    kind: "primitive",
    entries: Object.freeze(entries),
    nodes,
    getNode: (reference) => {
      const node = nodes.get(String(reference));
      if (!node) throw new Error(`${label} scene node is unavailable: ${reference}`);
      return node;
    }
  });
}

// 物体定義からphysics body配列を作り、同じID・shape・初期姿勢をProjectRuntimeへ渡します
// space設定と物体定義を分けながら、個別bodyの寸法記述を一つへ集約します
export function createPrimitivePhysicsManifest(
  spaceValue,
  objectValue,
  objectSetsValue = undefined,
  label = "SceneProject"
) {
  const source = util.readPlainObject(spaceValue, `${label}.physics`, {});
  const definitions = readPrimitiveProjectObjectDefinitions(objectValue, objectSetsValue, label, {
    allowMaterialReference: true
  });
  const bodies = definitions
    .filter((definition) => definition.physics !== null)
    .map((definition) => ({
      id: definition.id,
      node: definition.id,
      ...definition.physics
    }));
  return {
    ...source,
    bodies,
    joints: source.joints ?? []
  };
}
