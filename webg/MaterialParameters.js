// ---------------------------------------------
//  MaterialParameters.js  2026/08/05
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

// Shapeが保持するplain object形式のmaterialから、透明描画とTransmissionに必要な値を検証して返す
// geometryを管理するShapeへPBR固有の既定値や制約を増やさず、このclassを材質規則の集約点とする
export default class MaterialParameters {

  // Shape互換objectから指定slotのmaterial recordを取得し、各Render Passが材質規則を直接利用できるようにする
  // 標準Shapeでは内部recordを割り当てずに参照し、独自ShapeはgetMaterialAt()で同じ構造を提供できる
  static resolveShapeMaterial(shape, materialIndex = 0) {
    if (!shape || typeof shape !== "object") {
      throw new Error("MaterialParameters.resolveShapeMaterial requires a Shape-like object");
    }
    if (Array.isArray(shape.materials) && shape.materials[materialIndex]) {
      return shape.materials[materialIndex];
    }
    if (typeof shape.getMaterialAt === "function") {
      return shape.getMaterialAt(materialIndex);
    }
    // GeometryBufferPassへ直接登録する低レベルShapeはmaterial slotを持たない場合がある
    // その場合も材質規則はこのclassで解釈し、Shapeへ専用getterを戻さず既存parameter辞書をrecord化する
    return {
      id: shape.materialId ?? null,
      params: shape.materialParams ?? shape.shaderParam ?? {}
    };
  }

  // 呼び出し側が渡したmaterial slotを検証し、以後のgetterが参照できるparamsと表示名を返す
  // material object自体の生成とslot範囲検証はShapeが担当し、ここでは材質内容だけを扱う
  static requireMaterial(material, materialIndex = 0) {
    if (!material || typeof material !== "object" || !material.params
        || typeof material.params !== "object" || Array.isArray(material.params)) {
      throw new Error(`Shape material[${materialIndex}] must contain a params object`);
    }
    return {
      params: material.params,
      label: `Shape material[${materialIndex}]`
    };
  }

  // surface全体へ掛けるAlphaを0から1で返し、未指定の既存材質は不透明な1.0として扱う
  static getAlpha(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    return util.readOptionalFiniteNumber(
      params.alpha,
      `${label}.alpha`,
      1.0,
      { min: 0.0, max: 1.0 }
    );
  }

  // glTF由来のalpha_modeを返し、明示値がないlegacy材質だけAlpha値から分類する
  // Alpha 1.0でもtexture alphaを使うBLEND材質があるため、明示modeをAlpha値より優先する
  static getAlphaMode(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    if (params.alpha_mode !== undefined) {
      return util.readOptionalEnum(
        params.alpha_mode,
        `${label}.alpha_mode`,
        "OPAQUE",
        ["OPAQUE", "MASK", "BLEND"],
        { trim: false }
      );
    }
    return this.getAlpha(material, materialIndex) < 1.0 ? "BLEND" : "OPAQUE";
  }

  // MASK材質がfragmentを破棄するAlpha閾値を返し、未指定時はglTF既定値0.5を使う
  static getAlphaCutoff(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    return util.readOptionalFiniteNumber(
      params.alpha_cutoff,
      `${label}.alpha_cutoff`,
      0.5,
      { min: 0.0, max: 1.0 }
    );
  }

  // 両面描画指定を0または1として検証し、描画pipelineが直接使えるbooleanへ変換する
  static getDoubleSided(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    const value = util.readOptionalFiniteNumber(
      params.double_sided,
      `${label}.double_sided`,
      0,
      { integer: true, min: 0, max: 1 }
    );
    return value === 1;
  }

  // Frost背景へ使うroughnessを返し、未指定材質はroughness mask shaderと同じ0.04を使う
  // 通常PBR surfaceの既定roughnessとは異なり、既存透明材質へ意図しないぼかしを加えない
  static getFrostRoughness(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    return util.readOptionalFiniteNumber(
      params.roughness,
      `${label}.roughness`,
      0.04,
      { min: 0.04, max: 1.0 }
    );
  }

  // 背景透過と屈折を適用する材質固有の割合を0から1で返す
  // 未指定値0により、PipelineでTransmissionを有効にしても既存材質の表示は変化しない
  static getTransmission(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    return util.readOptionalFiniteNumber(
      params.transmission,
      `${label}.transmission`,
      0.0,
      { min: 0.0, max: 1.0 }
    );
  }

  // 空気から材質へ入るときの屈折率を返し、未指定時は一般的なガラス相当の1.5を使う
  // 現在のscreen-space近似で過大なoffsetを防ぐためsampleと同じ1.0から2.5へ限定する
  static getIor(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    return util.readOptionalFiniteNumber(
      params.ior,
      `${label}.ior`,
      1.5,
      { min: 1.0, max: 2.5 }
    );
  }

  // screen-space屈折へ使う材質固有の相対Thicknessを返す
  // 未指定値0では裏面距離を推測せず、屈折offsetなしとして安全に既存表示を維持する
  static getThickness(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    return util.readOptionalFiniteNumber(
      params.thickness,
      `${label}.thickness`,
      0.0,
      { min: 0.0, max: 4.0 }
    );
  }

  // 単位距離を通過した後に残る線形RGB比率を返し、未指定時は吸収なしの白を使う
  // Beer-Lambert計算で対数を取るため0も入力として許可し、Shader側で安全な最小値へ制限する
  static getAttenuationColor(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    return util.readColor(
      params.attenuation_color ?? [1.0, 1.0, 1.0],
      `${label}.attenuation_color`,
      undefined,
      3
    ).map((value, component) => util.readFiniteNumber(
      value,
      `${label}.attenuation_color[${component}]`,
      { min: 0.0, max: 1.0 }
    ));
  }

  // attenuation colorに到達する正の距離を返し、未指定またはInfinityは吸収なしとして保持する
  // 0以下を許すとBeer-Lambertの指数が未定義になるため、有限値は必ず0より大きくする
  static getAttenuationDistance(material, materialIndex = 0) {
    const { params, label } = this.requireMaterial(material, materialIndex);
    if (params.attenuation_distance === undefined || params.attenuation_distance === Infinity) {
      return Infinity;
    }
    return util.readFiniteNumber(
      params.attenuation_distance,
      `${label}.attenuation_distance`,
      { minExclusive: 0.0 }
    );
  }

  // material設定時に透明分類とTransmission関連値をまとめて検証し、描画開始後の失敗を避ける
  // 現在の屈折背景は透明Forward pass内で合成するため、Transmission材質はBLENDに限定する
  static validateTransparency(material, materialIndex = 0) {
    this.getAlpha(material, materialIndex);
    const alphaMode = this.getAlphaMode(material, materialIndex);
    this.getAlphaCutoff(material, materialIndex);
    this.getDoubleSided(material, materialIndex);
    const transmission = this.getTransmission(material, materialIndex);
    this.getIor(material, materialIndex);
    this.getThickness(material, materialIndex);
    this.getAttenuationColor(material, materialIndex);
    this.getAttenuationDistance(material, materialIndex);
    if (transmission > 0.0 && alphaMode !== "BLEND") {
      throw new Error(
        `Shape material[${materialIndex}].transmission requires alpha_mode BLEND or alpha below 1.0`
      );
    }
  }

  // Shaderへ渡す辞書へTransmissionの確定値を毎draw上書きし、前のmaterial値が残ることを防ぐ
  // targetはShapeが色やtextureなどを組み立てた辞書であり、この関数はPBR屈折値だけを追加する
  static applyTransmissionParameters(target, material, materialIndex = 0) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new Error("MaterialParameters.applyTransmissionParameters target must be an object");
    }
    target.transmission = this.getTransmission(material, materialIndex);
    target.ior = this.getIor(material, materialIndex);
    target.thickness = this.getThickness(material, materialIndex);
    target.attenuation_color = this.getAttenuationColor(material, materialIndex);
    target.attenuation_distance = this.getAttenuationDistance(material, materialIndex);
    return target;
  }
}
