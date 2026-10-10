# Scene Structure and SceneYAML

This chapter explains how `SceneYAML`, the `SceneAsset` used after loading, the `SceneDefinition` that validates and builds a scene, and `WebgSceneApp`, which connects the scene to PBR rendering and compute physics, fit together.
Bring object placement, inline meshes, materials, physics space, animation, particle-emitter settings, and renderer settings into one document, while keeping input and application-specific updates in JavaScript.

SceneYAML and Scene JSON are two notations for saving the same scene data. SceneYAML supports comments, allowing people to record intent and physics conditions while editing. JSON is useful for exchanging data with existing tools and generating it programmatically. Either format is handled as the same `SceneAsset` at runtime.

## How to read this chapter

### Prerequisites

The chapter is easier to follow if you know `ModelAsset` from Chapter 08, Nodes, `Space`, and `WebgApp` from Chapter 05, and JavaScript arrays and objects.

### What to read first

Start with the scope of `SceneYAML`, the difference between `SceneAsset` and `SceneDefinition`, and a startup example using `WebgSceneApp`.

### What to read when you need it

Refer to inline meshes, physics settings, object animation, saving while retaining comments, and external ModelAsset references when editing or saving a scene.

### What you will learn

You will be able to validate and start a scene from SceneYAML or equivalent Scene JSON, including primitives, inline meshes, ModelAsset references, materials, physics, and renderer settings. You will also be able to read the source text while retaining YAML comments and save it as YAML or JSON when appropriate.

## Declare a complete application in SceneYAML

SceneYAML is a readable declarative document for the complete application state to reproduce at startup. It groups model placements, physics conditions, and rendering settings. ModelYAML describes the shape and hierarchy of an individual model.

Use `objects` for scene objects, `materials` for surface appearance, `physics` for gravity, fixed-step timing, and other physics conditions, and `renderer` for PBR and screen effects. Meshes used directly inside SceneYAML go under `meshes`. For an external model with multiple meshes, a Node hierarchy, or a skeleton, refer to a `ModelAsset` through `modelAsset` or `modelAssetUrl`.

Describing the initial layout in SceneYAML means that changing a scene value does not require rewriting JavaScript initialization code each time. Put the values and declarations needed to reproduce the initial state in SceneYAML. Keep game rules, input responses, and application-specific per-frame behavior in JavaScript; this separates editing the initial scene from implementing its behavior.

## Relationship among SceneYAML, SceneAsset, and SceneDefinition

Their roles become clear when the scene is viewed in three stages:

```text
SceneYAML / Scene JSON
        │ parse
        ▼
SceneAsset
  retains values, source text, comments, and source URL
        │ toSceneDefinition()
        ▼
SceneDefinition
  validates fields, references, and numbers; determines build operations
        │ build
        ▼
WebgSceneApp / Scene runtime
  creates runtime Nodes, Shapes, physics bodies, and renderer
```

`SceneAsset` extends `DocumentAsset` and holds current values together with the source document for saving. It uses the same loading, source-preservation, and saving features as ModelAsset. `SceneDefinition` validates high-level SceneYAML fields and passes inline objects, object sets, ModelAsset references, materials, physics, and animation to the build process. `WebgSceneApp` connects the result to WebGPU, PBR, compute physics, and frame updates.

Load SceneYAML into `SceneAsset`, validate it, and pass it to a high-level definition like this:

```js
import SceneAsset from "../../webg/SceneAsset.js";

const asset = await SceneAsset.load("./scene.webg.yaml");
asset.assertValid();

const source = asset.getSourceDocument();
console.log(source.format, source.comments.length);

const definition = asset.toSceneDefinition();
definition.validate();
```

For a regular application, pass the document URL to `WebgSceneApp`:

```js
import { createWebgSceneApp } from "../../webg/app/index.js";

const app = await createWebgSceneApp({
  project: "./scene.webg.yaml",
  physics: { enabled: true, paused: true }
});

app.start();
```

`project` accepts a URL for SceneYAML or equivalent JSON, a `SceneAsset`, a `SceneDefinition`, or a manifest object. Use `WebgSceneApp` to start an application through the high-level API; use `SceneAsset` directly where editing, saving, or diagnostics are needed.

## SceneYAML document structure

Here is a minimal setup that displays a sphere and floor, with only the sphere falling as a dynamic body. Comments record the floor's top-surface position and the physics conditions.

```yaml
# Minimal SceneYAML project displaying a sphere and floor
name: sphere-plane-project-app
version: 1

materials:
  # Set the appearance of the floor and sphere separately
  - id: floor-material
    color: [0.22, 0.28, 0.38, 1.0]
    metallic: 0.0
    roughness: 0.42
    specular: 0.72
  - id: ball-material
    color: [0.94, 0.30, 0.08, 1.0]
    metallic: 0.15
    roughness: 0.20
    specular: 1.0

physics:
  space:
    gravity: [0.0, -9.8, 0.0]
    fixedTimeStepMs: 8.3333333333
    solverIterations: 10
    maxBodies: 1
    planes:
      - normal: [0.0, 1.0, 0.0]
        planeDistance: 0.0

objects:
  - id: floor
    shape: { type: box, size: [12.0, 0.3, 8.0] }
    transform: { position: [0.0, -0.15, 0.0] }
    material: floor-material
  - id: ball
    shape: { type: sphere, radius: 0.5 }
    transform: { position: [0.0, 3.2, 0.0] }
    material: ball-material
    physics:
      bodyType: dynamic
      mass: 1.0

renderer:
  profile: studio
  width: 960
  height: 640
  clearColor: [0.012, 0.018, 0.028, 1.0]
  environment:
    preset: dark-studio
    resolution: { width: 128, height: 64 }
```

In this example, `objects[].shape` selects an existing primitive for display. An object with `physics` receives a corresponding physics body from its display shape. Objects can share an appearance by referring to a material ID from `materials`.

The main SceneYAML fields are:

| Field | Purpose |
| --- | --- |
| `objects[]` | Scene objects, placement, parent, primitive or mesh reference, material, and physics body |
| `objectSets[]` | Generate groups of primitives using prototypes, variants, and placement rules |
| `meshes[]` | Display geometry defined directly in SceneYAML |
| `materials[]` | PBR values such as color, metallic, roughness, and specular |
| `physics.space` | Space settings such as gravity, fixed step, solver, capacity, and planes |
| `physics.joints[]` | Physics joints connected by object IDs |
| `animations[]` | Position and quaternion keyframes targeting object IDs |
| `renderer` | PBR profile, environment lighting, display size, and screen effects |
| `modelAsset` / `modelAssetUrl` | Reference a ModelAsset in the application |
| `materialsUrl` / `physicsUrl` | Move settings into a separate YAML or JSON document |

## Keep inline meshes and physics shapes separate

`meshes` in SceneYAML directly defines geometry to display in the application. `objects[].mesh` references it. Several objects can refer to the same mesh while using different positions, orientations, and materials.

```yaml
format: webg-scene
version: 1

physics:
  space:
    gravity: [0.0, -9.8, 0.0]
    maxBodies: 1

renderer:
  profile: studio

meshes:
  - id: panel-mesh
    vertices:
      - [-0.5, -0.5, 0.0]
      - [0.5, -0.5, 0.0]
      - [0.5, 0.5, 0.0]
      - [-0.5, 0.5, 0.0]
    faces:
      - [0, 1, 2, 3]

objects:
  - id: panel
    mesh: panel-mesh
    transform: { position: [0.0, 1.0, 0.0] }
    material: { color: [0.2, 0.6, 0.8, 1.0] }
    physics:
      bodyType: dynamic
      mass: 1.0
      # Align the surface and center; use a 0.1 m Box as the collision shape
      shape: { type: box, size: [1.0, 1.0, 0.1] }
      colliderRelation: proxy
```

The display panel is centered at its local origin, and a Box with thickness is explicitly selected as its proxy collision shape with `colliderRelation: proxy`. Separating display geometry from the physics shape allows detailed display meshes while using supported Box, Sphere, or Capsule shapes for physics. Automatic generation of complex collision shapes from a display mesh is outside the current basic SceneYAML path. Edit `physics.shape` to change the physics conditions.

## Place a ModelAsset in a scene

`ModelAsset` describes one model. It can contain multiple meshes, a Node hierarchy, asset materials, a skeleton, and animation. SceneYAML holds the application's overall physics, renderer settings, object IDs, and placement policies; ModelAsset holds geometry and hierarchy inside each model.

```yaml
modelAssetUrl: ./robot.model.yaml

objects:
  - id: robot-body
    node: body
    material: robot-material
    transform: { position: [0.0, 1.0, 0.0] }
    physics:
      bodyType: dynamic
      mass: 5.0
      shape: { type: box, size: [1.0, 2.0, 1.0] }
```

Here `body` is a Node ID inside ModelAsset, and `robot-body` is the object ID used by the application. Application-level operations such as joints, input, and contact notifications refer to `robot-body`; keep it distinct from IDs inside the model. When using a ModelAsset's display geometry with physics, explicitly specify the corresponding collision shape in SceneYAML.

## Validate and build SceneYAML

The SceneYAML workflow is to load the document, validate it, build the scene, and then update the scene each frame. Validation checks top-level fields, object IDs, mesh references, materials, physics, renderer settings, and animation structure. `SceneAsset.validate()` returns a report that you can inspect, as below; `assertValid()` raises an exception if validation fails. `SceneDefinition.validate()` checks the high-level scene declarations and rejects invalid settings or references. Invalid values are reported rather than silently adjusted.

```js
const asset = await SceneAsset.load("./scene.webg.yaml");
const report = asset.validate();

if (!report.ok) {
  console.error(report.errors);
  throw new Error("Invalid SceneYAML");
}

const app = await createWebgSceneApp({
  project: asset.toSceneDefinition(),
  physics: { enabled: true, paused: true }
});
```

For high-level startup, you can let `createWebgSceneApp({ project: "./scene.webg.yaml" })` handle the flow. Call `SceneAsset.build(target)` directly when the caller needs to manage the build target, as in an editing tool or a small GPU-backed validation program.

```js
const asset = await SceneAsset.load("./scene.webg.yaml");
asset.assertValid();

// WebgApp is a low-level build target with getGPU() and space
const runtime = await asset.build(webgApp);
```

When a `SceneAsset` contains a high-level project, `build()` uses `SceneDefinition` to build the primitive scene, ModelAsset runtimes, materials, and physics settings. Call `validate()` first in an editor or loading flow so value errors are found before only part of the GPU or Node structure has been created.

## WebgSceneApp frame processing

`WebgSceneApp` connects SceneYAML renderer, physics, and animation settings to per-frame processing. In a regular sample, application code calls `start()` and adds only the callbacks needed for input or application-specific updates.

```js
const app = await createWebgSceneApp({
  project: "./scene_animation.yaml",
  physics: false,
  onUpdate({ deltaSec }) {
    // Update application-specific behavior in seconds, as in WebgApp
    updateGameRule(deltaSec);
  }
});

app.start();
```

The high-level API provides `setPaused()` for compute physics, `reset()` to restore initial placements and physics state, and `playAnimation()` / `pauseAnimation()` to control object animation from SceneYAML. `setTimeScale()` changes the time scale for physics and animation. It is separate from changing physics values such as gravity or mass.

## Save particle-emitter settings

Describe continuous particle effects or bursts together with scene placement in `particleEmitters`. Put the preset, capacity, color, and size in the document; use JavaScript to decide when collision or input triggers emission. The following is a fragment to add at the scene root:

```yaml
particleEmitters:
  - id: collision-sparks
    preset: spark
    capacity: 480
    seed: 42
    overflow: replace-oldest
    appearance:
      colors: [[8, 3.2, 0.45], [1.2, 5, 8]]
      size: [0.22, 0.44]
```

`WebgSceneApp` creates and registers the emitter with PBR during initialization. Use it after startup when an event occurs:

```js
const sparks = sceneApp.getComputeParticleEmitter("collision-sparks");
sparks.emit(32, {
  position: [0, 1, 0],
  velocity: [0, 12, 0],
  velocitySpread: [22, 9, 22],
  lifetime: [0.858, 1.32]
});
```

For continuous emission, set `rate` and the emission position, velocity, and lifetime under each emitter's `emission` field. Runtime particle state is separate from the saved initial settings, so moving particles leave the original SceneYAML text and comments intact. Chapter 26 explains stopping and clearing emitters and capacity notifications; Chapter 36 explains GPU processing and compositing order with PBR.

## Separate input from game logic

Keep the action performed by a key press in JavaScript. Even when input settings are saved in SceneYAML, put key and action names in the document and implement the handler as application behavior. With `WebgSceneApp`, add a small event handler that calls the application API directly.

```js
let paused = true;

window.addEventListener("keydown", event => {
  if (event.key === "r") {
    app.reset();
    return;
  }
  if (event.key === "p") {
    paused = !paused;
    app.setPaused(paused);
  }
});
```

This separation lets another application load the same SceneYAML but replace only the input behavior. Keep per-frame conditional logic out of the scene document so it can focus on the initial state and values required to reproduce it.

## Save SceneYAML while retaining comments

SceneYAML loaded through `SceneAsset.fromYAML()` or `SceneAsset.load()` retains parsed values, original text, comment locations, and the source URL.

While the values remain unchanged, `toYAMLText()` returns the original YAML unchanged. It preserves whitespace, key order, and comments, making it suitable for inspecting and saving the loaded document as-is.

```js
const asset = SceneAsset.fromYAML(yamlText);
asset.assertValid();

const sameText = asset.toYAMLText();
asset.downloadYAML("scene.webg.yaml");
await asset.downloadYAMLGz("scene.webg.yaml.gz");
```

If JavaScript values are changed and then serialized to commented YAML, `SceneAsset` cannot safely determine how the old comments correspond to the new values, so it does not silently remove comments. Supply the updated YAML source document or use an editing process that manages comments.

JSON cannot represent comments. When producing JSON from commented YAML, explicitly acknowledge their loss:

```js
const jsonText = asset.toJSONText(2, { allowCommentLoss: true });
asset.downloadJSON("scene.webg.json", 2, { allowCommentLoss: true });
```

This explicit option makes accidental loss of YAML explanations visible. When saving a SceneAsset loaded from JSON as YAML, `stringifySceneYAML()` writes the same values in the supported YAML subset. It does not generate new comments during conversion.

## External settings and source documents

If SceneYAML refers to `materialsUrl` or `physicsUrl`, `SceneDefinition` also loads the referenced YAML or JSON according to its extension. Inspect the source documents for those files with `getSourceDocuments()`.

```js
import SceneDefinition from "../../webg/app/SceneDefinition.js";

const definition = await SceneDefinition.load("./project.webg.yaml");
definition.validate();

for (const document of definition.getSourceDocuments()) {
  console.log(document.sourceUrl, document.format, document.comments.length);
}
```

`.yaml` and `.yml` are parsed as SceneYAML; `.json` is parsed as Scene JSON. The `.yaml.gz`, `.yml.gz`, and `.json.gz` forms are decompressed and then parsed by the same path. To retain YAML comments, use the YAML source-document path.

## Supported SceneYAML syntax and scope

The current SceneYAML parser is a limited YAML parser for the syntax used in webg project manifests. It handles comments, indentation-based maps and sequences, basic scalars, and short flow arrays and maps. Write documents using this supported syntax. Expand data that uses anchors, tags, or complex types into basic values, arrays, and maps.

When extending SceneYAML, check in this order:

1. Validate fields, numbers, and ID references through `SceneDefinition.validate()`.
2. Update the build code that consumes the values, such as `PrimitiveScene`, `SceneMesh`, or `ScenePhysics`.
3. Check its connections to PBR, physics, and frame processing in `WebgSceneApp`.
4. Check SceneAsset YAML/JSON input and output, and the comment-preserving editing flow.
5. Align related samples, unit tests, and book examples with the same data structure.

Adding an inline display mesh does not automatically change its physics shape. Specify the physics shape in `physics.shape` and confirm the intended relationship between display and collision dimensions. Treat ModelAsset meshes, SceneYAML meshes, and physics shapes as separate references.

## References for checking behavior

These samples demonstrate the current SceneYAML and SceneApp structure:

* `samples/project_app/project_app_sphere_plane.html`: minimal SceneYAML, Sphere, Plane, PBR, and compute body
* `samples/project_app/project_app_object_set.html`: multiple placements through prototypes and `objectSets`
* `samples/project_app/project_app_object_set_variants.html`: Sphere, Capsule, and Box variants
* `samples/project_app/project_app_physics.html`: external materials, compute physics, and SceneYAML
* `samples/project_app/scene_animation.html`: position and quaternion animation targeting object IDs
* `samples/edit_yaml/edit_yaml.html`: editor for SceneYAML placement, materials, physics, and inline meshes

## Grow a PBR scene into a small game

`samples/fantasy/` is a small integration example that adds manually created Shapes and Nodes to declared terrain, then connects movement, attacks, selection, and GPU particles.
Start at `start()` in `main.js`, then follow initialization in `scene.js` and visual creation in `visuals.js`.
Connect custom updates through `onUpdate` and avoid running standard particle updates or drawing twice.

`PBRSceneToGame.md` maps direct Shape materials, Node updates, selection, resize, restart, and cleanup ownership to functions in this sample.
Game HP and turn ownership belong to application state, so restore them separately from the core `reset()`.

## Summary

SceneYAML is a project document for an entire application, including object placement, inline meshes, materials, physics, animation, renderer settings, and ModelAsset references. ModelYAML saves one model; SceneYAML saves several objects and application-wide conditions.

Loading SceneYAML or equivalent Scene JSON creates a `SceneAsset` that retains data, source text, comments, and origin. `SceneDefinition` validates its contents, and `WebgSceneApp` connects it to PBR, compute physics, Nodes, and frame processing.

As long as values are unchanged, a document with YAML comments can be saved with its original text intact. When value edits make comment correspondence unclear, the operation stops rather than deleting comments automatically. Converting to JSON also requires an explicit option to discard them. This keeps SceneYAML useful as a document that people can read and edit.

Chapter 10 moves from basic playback of model clips to naming clip ranges and selecting them based on input or state. For controls on object animation declared in SceneYAML, refer to the `WebgSceneApp` update and control sections in this chapter.
