import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import parseSceneYAML from "../../../webg/SceneYaml.js";
import SceneDefinition from "../../../webg/app/SceneDefinition.js";
import {
  readPrimitiveDefinitions,
  readPrimitiveMaterialManifest,
  readPrimitiveObjectDefinitions
} from "../../../webg/app/PrimitiveScene.js";

const jsonText = readFileSync(new URL(
  "../../../samples/project_app/domino_36_03_project.json",
  import.meta.url
), "utf8");
const yamlText = readFileSync(new URL(
  "../../../samples/project_app/domino_36_03_project.yaml",
  import.meta.url
), "utf8");
const jsonManifest = JSON.parse(jsonText);
const yamlManifest = parseSceneYAML(yamlText);

const jsonMaterials = readPrimitiveMaterialManifest(jsonManifest.materials, "json materials");
const yamlMaterials = readPrimitiveMaterialManifest(yamlManifest.materials, "yaml materials");
const jsonDefinitions = readPrimitiveDefinitions(
  jsonManifest.objects,
  jsonManifest.objectSets,
  "json project",
  { materialDefinitions: jsonMaterials, orientationFormat: "legacy-quaternion" }
);
const yamlDefinitions = readPrimitiveDefinitions(
  yamlManifest.objects,
  yamlManifest.objectSets,
  "yaml project",
  { materialDefinitions: yamlMaterials }
);

assert.equal(yamlDefinitions.length, jsonDefinitions.length);
const withoutOrientation = (definition) => {
  const { transform, ...rest } = definition;
  return {
    ...rest,
    transform: { position: [...transform.position] }
  };
};
assert.deepEqual(
  yamlDefinitions.map(withoutOrientation),
  jsonDefinitions.map(withoutOrientation)
);
jsonDefinitions.forEach((jsonDefinition, index) => {
  const yamlOrientation = yamlDefinitions[index].transform.orientation;
  const jsonOrientation = jsonDefinition.transform.orientation;
  const dot = yamlOrientation.reduce(
    (sum, value, component) => sum + value * jsonOrientation[component],
    0.0
  );
  const yamlLength = Math.hypot(...yamlOrientation);
  const jsonLength = Math.hypot(...jsonOrientation);
  assert.ok(
    Math.abs(dot / (yamlLength * jsonLength)) > 0.99999999,
    `${jsonDefinition.id} orientation changed`
  );
});

const yamlProjectNames = [
  "domino_36_03_project.yaml",
  "project_app_joint_project.yaml",
  "project_app_object_set_project.yaml",
  "project_app_object_set_variants_project.yaml",
  "project_app_physics_project.yaml",
  "project_app_sphere_plane_project.yaml"
];
for (const projectName of yamlProjectNames) {
  const projectText = readFileSync(new URL(
    `../../../samples/project_app/${projectName}`,
    import.meta.url
  ), "utf8");
  const projectDefinition = SceneDefinition.fromYAML(projectText, {
    baseUrl: "http://localhost/samples/project_app/"
  });
  assert.equal(projectDefinition.validate(), true, `${projectName} validation`);
  projectDefinition.destroy();
}

const primitiveProjectPairs = [
  ["domino_36_03_project.json", "domino_36_03_project.yaml"],
  ["project_app_joint_project.json", "project_app_joint_project.yaml"],
  ["project_app_object_set_project.json", "project_app_object_set_project.yaml"],
  ["project_app_object_set_variants_project.json", "project_app_object_set_variants_project.yaml"],
  ["project_app_sphere_plane_project.json", "project_app_sphere_plane_project.yaml"]
];
for (const [jsonName, yamlName] of primitiveProjectPairs) {
  const jsonProject = JSON.parse(readFileSync(new URL(
    `../../../samples/project_app/${jsonName}`,
    import.meta.url
  ), "utf8"));
  const yamlProject = parseSceneYAML(readFileSync(new URL(
    `../../../samples/project_app/${yamlName}`,
    import.meta.url
  ), "utf8"));
  const jsonProjectMaterials = readPrimitiveMaterialManifest(
    jsonProject.materials,
    `${jsonName} materials`
  );
  const yamlProjectMaterials = readPrimitiveMaterialManifest(
    yamlProject.materials,
    `${yamlName} materials`
  );
  const jsonProjectDefinitions = readPrimitiveDefinitions(
    jsonProject.objects,
    jsonProject.objectSets,
    jsonName,
    { materialDefinitions: jsonProjectMaterials, orientationFormat: "legacy-quaternion" }
  );
  const yamlProjectDefinitions = readPrimitiveDefinitions(
    yamlProject.objects,
    yamlProject.objectSets,
    yamlName,
    { materialDefinitions: yamlProjectMaterials }
  );
  assert.deepEqual(
    yamlProjectDefinitions.map(withoutOrientation),
    jsonProjectDefinitions.map(withoutOrientation),
    `${yamlName} primitive values changed`
  );
  jsonProjectDefinitions.forEach((jsonDefinition, index) => {
    const yamlOrientation = yamlProjectDefinitions[index].transform.orientation;
    const jsonOrientation = jsonDefinition.transform.orientation;
    const dot = yamlOrientation.reduce(
      (sum, value, component) => sum + value * jsonOrientation[component],
      0.0
    );
    assert.ok(
      Math.abs(dot / (Math.hypot(...yamlOrientation) * Math.hypot(...jsonOrientation))) > 0.99999999,
      `${yamlName} ${jsonDefinition.id} orientation changed`
    );
  });
}

const jsonPhysicsProject = JSON.parse(readFileSync(new URL(
  "../../../samples/project_app/project_app_physics_project.json",
  import.meta.url
), "utf8"));
const yamlPhysicsProject = parseSceneYAML(readFileSync(new URL(
  "../../../samples/project_app/project_app_physics_project.yaml",
  import.meta.url
), "utf8"));
const normalizeExternalMaterialsUrl = (project) => ({
  ...project,
  materialsUrl: "external-materials"
});
assert.deepEqual(
  normalizeExternalMaterialsUrl(yamlPhysicsProject),
  normalizeExternalMaterialsUrl(jsonPhysicsProject)
);

const jsonPhysicsMaterials = JSON.parse(readFileSync(new URL(
  "../../../samples/project_app/project_app_physics_materials.json",
  import.meta.url
), "utf8"));
const yamlPhysicsMaterials = parseSceneYAML(readFileSync(new URL(
  "../../../samples/project_app/project_app_physics_materials.yaml",
  import.meta.url
), "utf8"));
assert.deepEqual(yamlPhysicsMaterials, jsonPhysicsMaterials);

const physicsProjectText = readFileSync(new URL(
  "../../../samples/project_app/project_app_physics_project.yaml",
  import.meta.url
), "utf8");
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  assert.match(String(url), /project_app_physics_materials\.yaml/);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => readFileSync(new URL(
      "../../../samples/project_app/project_app_physics_materials.yaml",
      import.meta.url
    ), "utf8")
  };
};
const physicsDefinition = SceneDefinition.fromYAML(physicsProjectText, {
  sourceUrl: "http://localhost/samples/project_app/project_app_physics_project.yaml"
});
try {
  assert.deepEqual(await physicsDefinition.loadMaterials(), yamlPhysicsMaterials);
} finally {
  physicsDefinition.destroy();
  globalThis.fetch = previousFetch;
}

const eulerDefinitions = readPrimitiveObjectDefinitions([
  {
    id: "yaw-box",
    shape: { type: "box", size: [1, 1, 1] },
    transform: { orientation: { yaw: 90 } },
    material: { color: [1, 1, 1, 1] }
  },
  {
    id: "array-yaw-box",
    shape: { type: "box", size: [1, 1, 1] },
    transform: { orientation: [0, 90, 0] },
    material: { color: [1, 1, 1, 1] }
  },
  {
    id: "identity-box",
    shape: { type: "box", size: [1, 1, 1] },
    material: { color: [1, 1, 1, 1] }
  }
], "euler objects");
assert.ok(Math.abs(eulerDefinitions[0].transform.orientation[1] - Math.SQRT1_2) < 1.0e-12);
assert.ok(Math.abs(eulerDefinitions[0].transform.orientation[3] - Math.SQRT1_2) < 1.0e-12);
assert.ok(Math.abs(eulerDefinitions[1].transform.orientation[1] - Math.SQRT1_2) < 1.0e-12);
assert.ok(Math.abs(eulerDefinitions[1].transform.orientation[3] - Math.SQRT1_2) < 1.0e-12);
assert.deepEqual(eulerDefinitions[2].transform.orientation, [0, 0, 0, 1]);

const eulerPatternDefinitions = readPrimitiveDefinitions(undefined, [{
  id: "euler-pattern",
  prototype: {
    shape: { type: "box", size: [1, 1, 1] },
    material: { color: [1, 1, 1, 1] }
  },
  placement: { count: [2, 1, 1], spacing: [1, 0, 0] },
  instancePattern: {
    transform: {
      orientation: {
        type: "cycle",
        values: [{ yaw: 0 }, { yaw: 90 }]
      }
    }
  }
}], "euler pattern");
assert.deepEqual(eulerPatternDefinitions[0].transform.orientation, [0, 0, 0, 1]);
assert.ok(Math.abs(eulerPatternDefinitions[1].transform.orientation[1] - Math.SQRT1_2) < 1.0e-12);

assert.throws(
  () => readPrimitiveObjectDefinitions([{
    id: "invalid-orientation",
    shape: { type: "box", size: [1, 1, 1] },
    transform: { orientation: { heading: 90 } },
    material: { color: [1, 1, 1, 1] }
  }], "invalid orientation"),
  /heading is not supported/
);

assert.throws(
  () => readPrimitiveObjectDefinitions([{
    id: "quaternion-orientation",
    shape: { type: "box", size: [1, 1, 1] },
    transform: { orientation: [0, 0, 0, 1] },
    material: { color: [1, 1, 1, 1] }
  }], "SceneYAML orientation"),
  /must contain 3 numbers/
);

const definition = SceneDefinition.fromYAML(yamlText, {
  baseUrl: "http://localhost/samples/project_app/"
});
assert.equal(definition.validate(), true);
definition.destroy();

assert.throws(
  () => parseSceneYAML("name: first\nname: second\n"),
  /duplicate key/
);
assert.throws(
  () => parseSceneYAML("name:\n\tvalue\n"),
  /tabs are not supported/
);

console.log("PASS scene_yaml_contracts");
