// ----------------------------------------------------------------------
// headless_tests/core/shape/material_parameters_separation_contracts.js  2026/08/05
//   MaterialParameters分離後の材質既定値・検証・Shape互換API契約
// ----------------------------------------------------------------------
import assert from "node:assert/strict";
import MaterialParameters from "../../../webg/MaterialParameters.js";
import Shape from "../../../webg/Shape.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

// 専用classがShapeなしで材質値を検証でき、Transmissionの既定値をShader辞書へ展開できることを確認する
{
  const material = {
    id: "glass",
    params: {
      alpha_mode: "BLEND",
      alpha: 0.35,
      transmission: 0.8,
      ior: 1.52,
      thickness: 0.7,
      attenuation_color: [0.72, 0.9, 1.0],
      attenuation_distance: 2.5,
      roughness: 0.24
    }
  };
  MaterialParameters.validateTransparency(material, 2);
  assert.equal(MaterialParameters.getAlphaMode(material, 2), "BLEND");
  assert.equal(MaterialParameters.getFrostRoughness(material, 2), 0.24);
  assert.deepEqual(
    MaterialParameters.applyTransmissionParameters({}, material, 2),
    {
      transmission: 0.8,
      ior: 1.52,
      thickness: 0.7,
      attenuation_color: [0.72, 0.9, 1.0],
      attenuation_distance: 2.5
    }
  );

  const defaults = { id: null, params: {} };
  assert.deepEqual(
    MaterialParameters.applyTransmissionParameters({}, defaults, 0),
    {
      transmission: 0.0,
      ior: 1.5,
      thickness: 0.0,
      attenuation_color: [1.0, 1.0, 1.0],
      attenuation_distance: Infinity
    }
  );

  assert.throws(
    () => MaterialParameters.validateTransparency({
      id: "invalid-color",
      params: { attenuation_color: [1.1, 0.5, 0.5] }
    }, 3),
    /attenuation_color\[0\]/
  );
  assert.throws(
    () => MaterialParameters.validateTransparency({
      id: "invalid-distance",
      params: { attenuation_distance: 0.0 }
    }, 4),
    /attenuation_distance/
  );
}

// Shapeからmaterial recordを取得し、材質値は専用classだけで解釈する新しい呼出契約を確認する
{
  const shape = new Shape(createMockGpu().gpu);
  shape.setMaterial("glass", {
    alpha: 0.4,
    transmission: 0.65,
    ior: 1.33,
    thickness: 0.5,
    roughness: 0.18
  });
  const material = shape.getMaterialAt(0);
  assert.equal(MaterialParameters.getTransmission(material, 0), 0.65);
  assert.equal(MaterialParameters.getIor(material, 0), 1.33);
  assert.equal(MaterialParameters.getThickness(material, 0), 0.5);
  assert.equal(MaterialParameters.getFrostRoughness(material, 0), 0.18);
  assert.equal(MaterialParameters.resolveShapeMaterial(shape, 0), shape.materials[0]);
}

console.log("PASS MaterialParameters separation contracts");
