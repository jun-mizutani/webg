// ---------------------------------------------
//  PhysicsMaterialPairs.js  2026/09/11
//   Shared physical material and contact-pair resolution for CPU and Compute
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// CPU solverとCompute shaderが同じ物理材質を参照できるよう、材質値と組み合わせ規則をまとめます
// GPU側の材質IDは登録時に解決し、接触計算では検証済みの数値を使います
const modes = new Set(["geometricMean", "average", "min", "max", "multiply"]);
const finite = (value, name, max = Infinity) => {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${name} must be finite in [0, ${max}]`);
  return value;
};
const key = (a, b) => JSON.stringify([a, b].sort());
export function mixContactValue(a, b, mode = "geometricMean") {
  if (mode === "min") return Math.min(a, b);
  if (mode === "max") return Math.max(a, b);
  if (mode === "average") return (a + b) / 2;
  if (mode === "multiply") return a * b;
  if (mode !== "geometricMean") throw new Error(`Unknown contact mixing: ${mode}`);
  return Math.sqrt(a * b);
}
export default class PhysicsMaterialPairs {
  constructor(options = {}) {
    this.defaults = { restitution: options.defaultRestitution ?? 0.24, friction: options.defaultFriction ?? 0.4 };
    this.mode = options.contactMixing?.restitution ?? "geometricMean";
    if (!modes.has(this.mode)) throw new Error(`Unknown restitution mixing: ${this.mode}`);
    this.materials = new Map();
    this.ids = new Map();
    this.pairs = new Map();
    for (const source of options.materials ?? []) {
      if (typeof source.id !== "string" || !source.id.trim() || this.materials.has(source.id)) throw new Error("Physical material requires a unique id");
      this.ids.set(source.id, this.ids.size + 1);
      this.materials.set(source.id, Object.freeze({ ...this.material(source), materialId: source.id }));
    }
    for (const source of options.contactPairs ?? []) {
      if (!Array.isArray(source.materials) || source.materials.length !== 2 || source.materials.some(id => !this.materials.has(id))) throw new Error("contactPairs.materials must reference two physical materials");
      const pairKey = key(...source.materials);
      if (this.pairs.has(pairKey)) throw new Error("Duplicate physical material pair");
      const fallback = this.resolve(...source.materials.map(id => this.materials.get(id)));
      const result = { ...fallback };
      for (const name of ["restitution", "staticFriction", "dynamicFriction", "rollingResistanceLength"]) {
        if (source[name] !== undefined) result[name] = finite(source[name], name, name === "restitution" ? 1 : Infinity);
      }
      if (result.staticFriction < result.dynamicFriction) throw new Error("staticFriction must be at least dynamicFriction");
      if (source.restitutionCurve !== undefined) {
        if (source.restitution !== undefined || !Array.isArray(source.restitutionCurve) || !source.restitutionCurve.length) throw new Error("Specify restitution or a nonempty restitutionCurve");
        result.restitutionCurve = source.restitutionCurve.map((point, i) => {
          if (!Array.isArray(point) || point.length !== 2) throw new Error("restitutionCurve points are [speed, restitution]");
          const p = [finite(point[0], "curve speed"), finite(point[1], "curve restitution", 1)];
          if (i && p[0] <= source.restitutionCurve[i - 1][0]) throw new Error("Curve speeds must increase");
          return Object.freeze(p);
        });
      }
      this.pairs.set(pairKey, Object.freeze({ ...result, materials: [...source.materials] }));
    }
  }

  // Spaceの既定材質値をsetterから更新します
  // 明示材質と材質ペアを保持し、省略値だけを次回解決から新しい値へ切り替えます
  setDefaults({ restitution = this.defaults.restitution, friction = this.defaults.friction } = {}) {
    this.defaults = {
      restitution: finite(restitution, "default restitution", 1),
      friction: finite(friction, "default friction")
    };
    return this;
  }
  material(value = {}, materialId = undefined) {
    if (materialId !== undefined) {
      if (Object.keys(value).length) throw new Error("Specify materialId or inline physics material");
      if (!this.materials.has(materialId)) throw new Error(`Unknown physical material: ${materialId}`);
      return this.materials.get(materialId);
    }
    const dynamicFriction = finite(value.dynamicFriction ?? value.friction ?? this.defaults.friction, "dynamicFriction");
    const staticFriction = finite(value.staticFriction ?? value.friction ?? dynamicFriction, "staticFriction");
    if (staticFriction < dynamicFriction) throw new Error("staticFriction must be at least dynamicFriction");
    return { ...value, restitution: finite(value.restitution ?? this.defaults.restitution, "restitution", 1), friction: dynamicFriction, dynamicFriction, staticFriction,
      rollingResistanceLength: finite(value.rollingResistanceLength ?? 0, "rollingResistanceLength") };
  }
  numericId(id) {
    if (id === undefined) return 0;
    if (!this.ids.has(id)) throw new Error(`Unknown physical material: ${id}`);
    return this.ids.get(id);
  }
  resolve(a, b, speed = 0) {
    a = this.material(a); b = this.material(b);
    const pair = this.pairs.get(key(a.materialId, b.materialId));
    const result = pair ? { ...pair } : {
      restitution: mixContactValue(a.restitution, b.restitution, this.mode),
      staticFriction: Math.sqrt(a.staticFriction * b.staticFriction),
      dynamicFriction: Math.sqrt(a.dynamicFriction * b.dynamicFriction),
      rollingResistanceLength: Math.max(a.rollingResistanceLength, b.rollingResistanceLength)
    };
    if (pair?.restitutionCurve) {
      const curve = pair.restitutionCurve;
      result.restitution = curve.at(-1)[1];
      if (speed <= curve[0][0]) result.restitution = curve[0][1];
      else for (let i = 1; i < curve.length; i++) if (speed <= curve[i][0]) {
        const [x, y] = curve[i - 1]; const [xx, yy] = curve[i];
        result.restitution = y + (yy - y) * (speed - x) / (xx - x); break;
      }
    }
    return result;
  }
  // vec4 = restitution, dynamic friction, static friction, rolling length.
  createWGSL() {
    const f = n => `${Number(n).toExponential(9)}`;
    const mix = { geometricMean: "sqrt(a.x * b.x)", average: "(a.x+b.x)*0.5", min: "min(a.x,b.x)", max: "max(a.x,b.x)", multiply: "a.x*b.x" }[this.mode];
    let code = `fn physicsContactMaterial(a: vec4f, b: vec4f, idA: f32, idB: f32, speed: f32) -> vec4f {\n`;
    for (const pair of this.pairs.values()) {
      const [a, b] = pair.materials.map(id => f(this.numericId(id)));
      code += `if ((idA == ${a} && idB == ${b}) || (idA == ${b} && idB == ${a})) {\nvar e = ${f(pair.restitution)};\n`;
      if (pair.restitutionCurve) {
        const curve = pair.restitutionCurve;
        code += `e = ${f(curve.at(-1)[1])};\nif (speed <= ${f(curve[0][0])}) { e = ${f(curve[0][1])}; }\n`;
        for (let i = 1; i < curve.length; i++) {
          const [x,y] = curve[i-1]; const [xx,yy] = curve[i];
          code += `else if (speed <= ${f(xx)}) { e = mix(${f(y)}, ${f(yy)}, (speed-${f(x)})/${f(xx-x)}); }\n`;
        }
      }
      code += `return vec4f(e, ${f(pair.dynamicFriction)}, ${f(pair.staticFriction)}, ${f(pair.rollingResistanceLength)});\n}\n`;
    }
    return code + `return vec4f(${mix}, sqrt(a.y*b.y), sqrt(a.z*b.z), max(a.w,b.w));\n}\n`;
  }
}
