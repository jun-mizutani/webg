# Model Assets and Runtime Instances

Saving a model in a file lets you edit its shape and materials separately from application logic and reuse the same model in several places. This chapter starts by loading ModelYAML, building renderable data, and placing two instances in a scene.

The model data is a `ModelAsset`. Calling `build()` creates a runtime that owns shared rendering resources; calling the runtime's `instantiate()` method creates an instance in a scene. First follow this asset → runtime → instance workflow, then explore document preservation, external formats, and procedurally generated geometry.

## How to read this chapter

### Prerequisites

Review `WebgApp` in Chapters 04–05, parent-child coordinates in Chapter 03, and materials in Chapter 07. Read the following ModelYAML alongside JavaScript arrays and objects.

### What to read first

Read about loading ModelYAML and placing two models, the relationship among model data, built results, and placements, and the ModelYAML structure, in that order.

### What to read when you need it

Refer to the sections on loading glTF and other formats, generating from `Primitive`, individual placement and shared-resource cleanup, and internal build processing when you use those features. Chapter 29 explains physical-scale UVs and procedural materials in detail.

### What you will learn

You will be able to display a model from ModelYAML and create multiple placements that share the built result. You will also be able to distinguish a saved document from each instance displayed in a scene.

## Load ModelYAML and place two instances

Begin with a triangle that has no animation. Save the YAML in the next section as `user/model_intro/triangle.model.yaml`, replace the module script in the HTML from Chapter 04 with the following code, and save it as `user/model_intro/model_intro.html`. Both files are two directories below the repository root, so the relative library path is `../../webg/`.

This example reads the document once, calls `build()` once, and calls `instantiate()` twice. The screen shows two triangles of the same shape and color side by side.

```js
import WebgApp from "../../webg/WebgApp.js";
import ModelAsset from "../../webg/ModelAsset.js";

const app = new WebgApp({ document, useMessage: false });
await app.init();
app.createOrbitEyeRig({
  target: [0, 0, 0], distance: 7, yaw: 0, pitch: 0,
  minDistance: 3, maxDistance: 15, wheelZoomStep: 0.5
});

// Load the saved model and validate its references and arrays
const asset = await ModelAsset.load("./triangle.model.yaml");
asset.assertValid();

// Build GPU render data once and create two placements from the same result
const runtime = asset.build(app.getGPU());
const left = runtime.instantiate(app.space);
const right = runtime.instantiate(app.space);

// Get each placement's Node by YAML ID and set their positions independently
left.nodeMap.get("node0").setPosition(-1.5, 0, 0);
right.nodeMap.get("node0").setPosition(1.5, 0, 0);
app.start();
```

`asset` contains vertex, face, material, and Node definitions. `runtime` contains shared resources built from those definitions; `left` and `right` each have their own Nodes. Moving one placement leaves the other in place. The `"node0"` key in `nodeMap` is the Node `id` in the YAML below. Use the IDs present in a model when switching assets.

`samples/model_yaml/index.html` uses the same pattern to place several crystal models and lets you inspect their rotation and save YAML with comments.

## Why keep data, build results, and placements separate?

`ModelAsset` is the shared data format for saved shapes, materials, hierarchies, and animations. ModelYAML and Model JSON are two notations for saving the same data. Use ModelYAML when people will edit the model and add explanatory comments.

`build()` creates GPU resources and placement definitions from the shared data. `instantiate()` uses that build result to place Nodes in a `Space`. Building a shape once lets any number of instances reuse its shared mesh render data.

`ModelAsset` extends `DocumentAsset` and retains its source, original text, and comments. `ModelValidator` checks references within a model, and `ModelBuilder` constructs renderable data. For normal display, start with `asset.assertValid()` and `asset.build()`; follow the individual classes when you need implementation details.

![Building and instantiating a ModelAsset](../book/img/fig10_01_modelasset_build_instantiate.jpg)

## Save a model in ModelYAML

ModelYAML is the YAML notation for the model data retained by `ModelAsset`. It represents the same fields as Model JSON—`type`, `version`, `materials`, `meshes`, `skeletons`, `animations`, and `nodes`—using YAML syntax. After loading, ModelYAML and Model JSON are handled as the same `ModelAsset` for validation, building, and placement.

When checking a model hierarchy or face information for editing, you can add comments to ModelYAML as shown here:

```yaml
# A minimal triangle model for ModelAsset
type: webg-model-asset
version: "1.0"
meta:
  name: triangle

materials:
  - id: mat0
    shaderParams:
      color: [0.4, 0.8, 1.0, 1.0]
      ambient: 0.3
      specular: 0.4
      power: 24.0

meshes:
  - id: mesh0
    name: triangle
    material: mat0
    geometry:
      vertexCount: 3
      polygonCount: 1
      positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0]
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1]
      uvs: [0, 0, 1, 0, 0.5, 1]
      indices: [0, 1, 2]

nodes:
  - id: node0
    name: triangleNode
    parent: null
    mesh: mesh0
    transform:
      translation: [0, 0, 0]
      rotation: [0, 0, 0, 1]
      scale: [1, 1, 1]
```

`ModelAsset.fromYAML(text)` parses a document. `ModelAsset.load(url)` selects `.yaml`, `.yml`, `.json`, and their gzip forms from the extension. The steps for rendering are the same as when loading JSON.

```js
const asset = await ModelAsset.load("./triangle.model.yaml");
asset.assertValid();

const source = asset.getSourceDocument();
console.log(source.format, source.comments.length);

const runtime = asset.build(app.getGPU());
runtime.instantiate(app.space);
```

A `ModelAsset` loaded from YAML also retains the original text, comments, and source URL. If its values have not changed, `toYAMLText()` returns the original text unchanged, preserving comments, whitespace, and key order. If you change values in JavaScript and then try to regenerate commented YAML, the relationship between comments and values cannot be determined safely, so the operation raises an exception. Conversion to JSON, which loses comments, requires an explicit `allowCommentLoss: true` option.

```js
const yamlText = asset.toYAMLText();
asset.downloadYAML("triangle.model.yaml");
await asset.downloadYAMLGz("triangle.model.yaml.gz");

// JSON cannot represent comments, so allow their loss explicitly
const jsonText = asset.toJSONText(2, { allowCommentLoss: true });
```

When saving a commented model from an editing tool, treat the updated YAML document as the editing source; a value-only reserialization removes the comments. ModelYAML comments preserve production information such as material intent, coordinate systems, and the purpose of face data.

## Understand where Primitive, ModelAsset, and Shape fit

`Primitive`, `ModelAsset`, and `Shape` are objects for successive stages of working with geometry. `Primitive` generates vertices and faces on the CPU. `ModelAsset` holds that geometry in the same data format as models loaded from files. `Shape` connects GPU buffers with a material and supplies the result for rendering.

Between these stages, `ModelValidator` checks shared data, `ModelBuilder` creates shared render resources and a runtime, and `ModelLoader` combines format detection, external-file loading, and building. The six classes line up as follows:

| Name | Main responsibility | Output to the next stage |
| --- | --- | --- |
| `Primitive` | Generate basic geometry | `ModelAsset` with one mesh |
| `ModelAsset` | Define the complete model | Data shared by YAML and JSON |
| `ModelValidator` | Check array lengths, finite numbers, indices, and ID references | Validation report or exception |
| `ModelBuilder` | Build from a validated model and GPU | Model runtime and shared resources |
| `ModelLoader` | Resolve URL and format, import, and build | Asset, runtime, and optional instance |
| `Shape` | Manage geometry, materials, and GPU buffers | A renderable shape to attach to a Node |

`ShapeResource` is also important to this relationship. GPU buffers created from positions, normals, UVs, and indices are grouped in a `ShapeResource`. `Shape.createInstance()` creates another `Shape` that references the same `ShapeResource` instead of copying its GPU buffers. Each Node has its own position and orientation, and material values and animation state can also be managed by each instance.

## Inspect what Primitive returns

The `asset` in the following code is a `ModelAsset` containing shared model data before rendering. Connect it to GPU resources and a renderable runtime through `asset.build(gpu)`.

```js
const asset = Primitive.cube(2.0);
```

`Primitive.cube()` uses `Primitive.cuboid()` to generate positions, UVs, indices, and `polygonLoops` for a cube with 2 m sides. It wraps them in a small `ModelAsset` with one mesh and one Node. Conceptually, it has this structure:

```text
ModelAsset
├─ materials: []
├─ meshes
│  └─ cuboid_mesh
│     └─ geometry
│        ├─ positions
│        ├─ uvs
│        ├─ indices
│        └─ polygonLoops
├─ nodes
│  └─ cuboid_node -> cuboid_mesh
├─ skeletons: []
└─ animations: []
```

A cuboid has separate vertices for its six faces: four vertices per face, for 24 vertices and 12 triangles in total. Vertices at the same corner are duplicated across faces so each face can have its own normal and UVs.

Returning a `ModelAsset` lets procedurally generated shapes and file-loaded shapes use the same validation, GPU-resource construction, and instance-generation flow. For a simple Primitive that will be imported into a single `Shape`, the shorter path described below is also available.

## Choose between two geometry paths

A `ModelAsset` returned by a Primitive has two paths. The general path calls `build()` on the whole asset and then `instantiate()`. The other path uses `Shape.applyPrimitiveAsset()` to copy only the geometry of the first mesh into an existing `Shape`.

![Two paths from Primitive to runtime or Shape](../book/img/fig10_02_primitive_modelasset_shape_paths.jpg)

The general path handles ModelAsset validation, Node hierarchies, multiple meshes, skeletons, animations, and shared GPU resources together. The Shape path is suited to a simple Primitive when the caller wants to set its material and attach it to a Node directly. It imports geometry from the first mesh and leaves material and placement to the caller. Models with hierarchies or animations use the build-and-instantiate path.

| Use case | Choose | Reason |
| --- | --- | --- |
| Load an external model | `ModelLoader.load()` | Combines loading and building |
| Use hierarchies or multiple meshes | `build()` and `instantiate()` | Recreates the complete model |
| Place many copies of one model | Multiple `instantiate()` calls after building | Shares GPU geometry |
| Place one simple shape | `applyPrimitiveAsset()` | Set material and Node directly |
| Use a physical-scale procedural material | Apply it, then call `endShape()` | Convert UVs before GPU upload |

## Use the whole model with build and instantiate

To use a Primitive like a general `ModelAsset`, follow this sequence:

```js
const asset = Primitive.cube(2.0);

// Inspect validation results before building when the application needs error details
const report = asset.validate();
if (!report.ok) {
  throw new Error(JSON.stringify(report.errors, null, 2));
}

// Build shared GPU resources and a runtime from the complete ModelAsset
const runtime = asset.build(app.getGPU());

// Create Nodes and Shape instances in the Space
const first = runtime.instantiate(app.space);
const second = runtime.instantiate(app.space);
```

`asset.build(gpu)` calls `ModelBuilder.build()` internally and first validates the data with `ModelValidator.assertValid()`. Call `validate()` beforehand when you want to display an error list or review warnings before building.

The implementation connection between ModelAsset and ModelBuilder is concise:

```js
// ModelAsset.js
build(gpu) {
  const builder = new ModelBuilder(gpu);
  return builder.build(this.data);
}

// ModelBuilder.js
build(asset) {
  this.validator.assertValid(asset);
  // Assemble Shape templates and runtime from meshes, materials, and Nodes
}
```

After validation, ModelBuilder creates a Shape template for each mesh, sets required normals and materials, and finalizes GPU buffers with `Shape.endShape()`. If multiple Nodes refer to the same geometry, it builds them so they can share a `ShapeResource`.

The model runtime returned by `build()` retains Node definitions, Shape templates, shared `ShapeResource` objects, skeleton definitions, and animation definitions. Call `instantiate(space)` to place this built result in a `Space`.

`runtime.instantiate(space)` creates a Node hierarchy from the Node definitions and adds Shape instances from the templates to each Node. When skeletons and animations are present, each placement has its own pose and playback position. Therefore, build once and call `instantiate()` as many times as needed to place multiple copies of a model.

## Bring external formats into the same flow with ModelLoader

`ModelLoader` is a high-level entry point for loading external formats such as glTF, GLB, Collada, and ModelAsset JSON from a URL. Use `ModelAsset.load()` to load ModelYAML directly. After ModelLoader normalizes an external model into a ModelAsset, it can be saved as YAML or JSON. The processing sequence is approximately:

```text
detect format -> fetch/import -> create ModelAsset -> validate
              -> buildAsync -> apply importer-specific materials -> instantiate
```

Use this flow through `WebgApp.loadModel()` or `ModelLoader.load()`. Retain the returned runtime to create more instances without fetching the model again.

`Primitive.cube()` is already an in-memory ModelAsset. Since it needs no file-format detection or fetch, it normally calls `asset.build(gpu)` directly rather than going through ModelLoader.

## Import only Primitive geometry into a Shape

When setting a material directly on one Primitive, first create a `Shape`, then import geometry with `applyPrimitiveAsset()`.

```js
const shape = new Shape(app.getGPU());
shape.setShader(app.shader);

const asset = Primitive.cube(2.0);
shape.applyPrimitiveAsset(asset);

shape.setMaterial("smooth-shader", {
  color: [0.8, 0.2, 0.1, 1.0],
  roughness: 0.45,
  metallic: 0.0
});

shape.endShape();

const node = app.space.addNode(null, "cube");
node.addShape(shape);
```

`Shape.applyPrimitiveAsset(asset)` copies positions, indices, UVs, normals, `polygonLoops`, `altVertices`, and other data from `asset.getData().meshes[0].geometry` into new arrays. If normals are absent, it adds triangle face normals to vertices so they can be normalized by the later `endShape()`. It also calculates the bounding box from the copied vertices.

The implementation explicitly selects the first mesh:

```js
// Shape.js
const data = asset.getData();
const mesh = data?.meshes?.[0];
const geometry = mesh?.geometry;
if (!geometry) {
  throw new Error("Primitive asset does not contain geometry");
}
```

This method imports the first mesh's geometry. The ModelLoader, ModelBuilder, and `instantiate()` path handles the rest of a complete ModelAsset:

* Validating the complete ModelAsset
* Importing the second and later meshes
* Restoring Node hierarchies and transforms
* Applying material definitions from ModelAsset
* Building skeletons and animations
* Creating GPU buffers
* Adding Nodes to a Space

Use `applyPrimitiveAsset()` when you want to import only the geometry from a simple ModelAsset returned by a Primitive and set its material, GPU upload, and placement yourself. General models with multiple meshes or hierarchies use ModelLoader's build-and-instantiate path.

## Add physical-scale UVs and procedural materials

To match an image pattern to real dimensions, add a UV-registration step for the shape. UVs are coordinates within an image. Generate meter-based UVs with `Primitive.mapRealCuboid()`, register the material with `ProceduralMaterial.applyTo()`, and then finalize render data with `endShape()`.

This workflow is easy to follow through the existing-`Shape` path, which makes the order of UV and material setup explicit. Chapter 29 explains preset selection, pattern size, the roles of Color, Height, and Normal, and code for applying the material to geometry.

## Manage runtime and instance lifetimes

After building a `ModelAsset` and placing it in a `Space` with `runtime.instantiate()`, manage the lifetime of its resources. Model loading is straightforward, but unused Nodes and GPU resources can accumulate across scene changes or model replacements and cause memory leaks if they are not cleaned up.

`runtime` and the result of `instantiate()` have different roles:

* **`runtime`:** the foundation that holds built shared resources. It retains reusable meshes, shared `ShapeResource` objects, Node definitions, skeleton definitions, and animation definitions.
* **Result of `instantiate()`:** the scene objects created from `runtime` in the current `Space`, including individual Nodes, Shape instances, Skeletons, and Animations.

This distinction defines the unit of lifetime management:

```js
const result = await app.loadModel("./robot.glb", {
  instantiate: false
});

const runtime = result.runtime;
const instantiated = runtime.instantiate(app.space);

runtime.startAllAnimations();

// Remove only this instance from the scene
instantiated.destroy();

// Also release the runtime when the model will no longer be used
runtime.destroy();
```

`instantiated.destroy()` destroys the Nodes and Shape instances placed in the current `Space`.
Even if several objects came from one `runtime`, this API removes only the selected instance.

`runtime.destroy()` ends the runtime and releases its shared resources as well.
Call it when the model definition will not be used again, such as when replacing models in a viewer or releasing all resources from an old stage.

GPU resources such as buffers are not necessarily released immediately by JavaScript garbage collection, so `webg` uses explicit lifetime management with `destroy()`.

## Practical examples

The following examples show how to build a ModelAsset once and reuse it, validate external data, and scale an entire model safely. Each connects shared GPU resources, format validation, or scaling that includes animation to a concrete use case.

### Load glTF and place several copies

When placing several copies of one glTF model, load it once with `loadModel()` and call `runtime.instantiate()` for each placement.

```js
const result = await app.loadModel("./hand.glb", {
  instantiate: false,
  validate: true
});

const player = result.runtime.instantiate(app.space);
const cpu = result.runtime.instantiate(app.space);

const playerNode = player.nodeMap.get("HandRoot");
const cpuNode = cpu.nodeMap.get("HandRoot");

playerNode.setPosition(-1.2, 0.0, 0.0);
cpuNode.setPosition( 1.2, 0.0, 0.0);

player.startAllAnimations();
cpu.startAllAnimations();
```

Geometry and GPU buffers are shared by the build result.
`player` and `cpu` remain separate instances with independent runtime state, such as animation playback positions and pause states.

### Validate a model asset before building

When using hand-written ModelYAML or Model JSON, or exporter output, call `validate()` before rendering to catch inconsistencies before they become runtime errors.

```js
const asset = await ModelAsset.load("./modelasset.yaml");
const report = asset.validate();

if (!report.ok) {
  console.error(report.errors);
  throw new Error("Invalid ModelAsset");
}

const runtime = asset.build(app.getGPU());
runtime.instantiate(app.space);
```

`validate()` returns a report in the form `{ ok, errors, warnings }`. Stop before `build()` when errors are present to catch incorrect ID references or missing matrix data early.

### Apply a uniform scale to an imported model

To change the size of an entire asset, scale its skin and animation data using the same rule as its geometry.
`scaleUniform()` is designed for this operation.

```js
const asset = await ModelAsset.load("./human.json");
asset.assertValid();

const scaledAsset = ModelAsset.fromData(
  asset.cloneJSONValue(asset.getData())
);

scaledAsset.scaleUniform(0.70);

const runtime = scaledAsset.build(app.getGPU());
runtime.instantiate(app.space);
```

`scaleUniform(0.70)` scales mesh vertices, Node translations, skeleton joint matrices, and animation pose translations together by 0.70. Scaling only the geometry of a skinned model distorts its poses, so applying the same scale to the entire asset is the safe approach.

### Inspect clip names and summary information

When working with a model that contains several animations, check the clip names and lengths first to make implementation smoother.

```js
const result = await app.loadModel("./robot.glb", {
  instantiate: false
});

for (const clipName of result.getClipNames()) {
  const info = result.getClipInfo(clipName);
  console.log(clipName, info.durationMs, info.trackCount);
}
```

`getClipInfo()` returns `id`, `targetSkeleton`, `keyCount`, `trackCount`, and `durationMs`.
You can inspect these values before placing the runtime in a scene, for example to show them in a UI (user interface) or include them in documentation.

### Save an imported model

To inspect how a glTF or Collada importer processed data internally, save the `ModelAsset` to a file with `downloadYAML()` or `downloadJSON()`.
Choose YAML to review the data with comments and JSON for exchange with existing tools.

```js
const result = await app.loadModel("./vehicle.glb", {
  instantiate: false
});

result.asset.downloadYAML("vehicle.modelasset.yaml");
```

The `asset` on the result of `app.loadModel()` provides the `DocumentAsset` YAML-saving API. Inspect the saved ModelYAML to see how meshes, skeletons, animations, and Nodes were normalized after import. Comparing models before and after conversion helps locate differences in materials, hierarchy, or animation.

Use `downloadYAMLGz()` to reduce file size while preserving YAML comments, or `downloadJSONGz()` to compress JSON for exchange.

```js
const result = await app.loadModel("./vehicle.glb", {
  instantiate: false
});

await result.asset.downloadYAMLGz("vehicle.modelasset.yaml.gz");
```

`.yaml.gz` is the original ModelYAML compressed with gzip and can be restored with comments intact. `.json.gz` is a gzip-compressed JSON string and has no comments.

There is an important difference from GLB/glTF here.
Polygonal meshes exported to GLB/glTF are triangulated, so the original quadrilateral face boundaries are not retained as editable face loops.
ModelYAML and Model JSON can keep editing face loops in `geometry.polygonLoops` alongside the render triangles in `indices`.
This lets webg exchange editable geometry with digital content creation (DCC) tools such as Blender while retaining quadrilateral faces.

Therefore, use GLB when working with external viewers or standard glTF toolchains. Use `.yaml` or `.yaml.gz` to round-trip webg editing information and comments, and `.json` or `.json.gz` for machine exchange that people will not edit.

### Exchange ModelAsset data with Blender

Blender and webg `ModelAsset` data can be converted in both directions with a dedicated Blender add-on. The current add-on primarily reads and writes JSON; in webg, a loaded ModelAsset can also be saved as ModelYAML.
The add-on adds entries such as `Webg ModelAsset JSON` under File > Import / Export and reads and writes `.json` and `.json.gz` files.

The add-on is primarily for exchanging mesh geometry.
On import, it reads `positions`, `indices`, `polygonLoops`, `uvs`, and other data to create a Blender Mesh object.
Transforms from the `nodes` hierarchy are baked into vertex positions so the result is a single mesh that is easy to edit in Blender.

On export, selected meshes are written as a `ModelAsset`; world transforms are baked into vertex positions as well.
For complete preservation of complex rigs and animation, load glTF / GLB with `ModelLoader`.

Blender uses Z-up and ModelAsset uses Y-up, so the add-on converts coordinate axes automatically:

```text
Import : ModelAsset (X, Y, Z) -> Blender    (X, -Z, Y)
Export : Blender    (X, Y, Z) -> ModelAsset (X,  Z, -Y)
```

### Share geometry with `Shape.createInstance()`

Even in a low-level setup that does not use `ModelAsset`, create geometry once and place several instances that vary only in color, position, or scale to avoid duplicate GPU buffers.

The `samples/dof` sample creates a unit sphere of radius 1.0 once, then uses `Shape.createInstance()` with `node.setScale(radius)` to display spheres of different sizes.

```js
const sphereSource = new Shape(app.getGPU());
sphereSource.applyPrimitiveAsset(
  Primitive.sphere(1.0, 28, 20, sphereSource.getPrimitiveOptions())
);
sphereSource.endShape();

function addSphere(name, options) {
  const shape = sphereSource.createInstance();
  shape.setMaterial("smooth-shader", {
    use_texture: 0,
    color: options.color,
    ambient: 0.70,
    specular: 1.10,
    power: 58.0
  });

  const node = app.space.addNode(null, name);
  node.setPosition(options.x, options.y, options.z);
  node.setScale(options.radius);
  node.addShape(shape);
  return node;
}
```

This approach keeps material and scale differences on each instance while consolidating expensive mesh construction and GPU buffers in the shared resource. Multiple instances refer to the same geometry, reducing duplicate CPU construction and GPU memory use.
Each instance is still rendered with its own transform, so vertex processing and draw calls occur for every visible instance.

## The build result and internal ModelAsset structure

The `runtime` object returned by `ModelAsset.build(gpu)` has three layers:

1. **Asset-derived definitions:** Node definitions converted from the asset and stored in `runtime.nodes` and `runtime.nodeMap`.
2. **Built shared resources:** rendering resources shared by multiple Nodes and stored in `runtime.shapeResources`.
3. **Runtime instances after `instantiate()`:** individual `Node` and `Shape` instances, `Skeleton` objects, and `Animation` objects created by `runtime.instantiate(space)`.

This structure lets you cache the result of `build()` and call `instantiate()` when needed.

The shared `ModelAsset` data has these main fields, which are saved as ModelYAML or Model JSON:

```json
{
  "version": "1.0",
  "type": "webg-model-asset",
  "meta": {},
  "materials": [],
  "meshes": [],
  "skeletons": [],
  "animations": [],
  "nodes": []
}
```

* `materials`: material definitions referenced by meshes. `shaderParams` holds color, gloss, and other values.
* `meshes`: geometry, material references, and skin data. `positions` and `indices` are required.
* `skeletons`: joint hierarchy, rest pose, and inverse bind matrices for skinned meshes.
* `animations`: clip definitions that animate a skeleton.
* `nodes`: placement units within the model, including mesh references, skeleton links, local transforms, and parent-child relationships.

`validate()` checks the data structure for duplicate IDs, reference consistency, and array lengths, then returns `{ ok, errors, warnings }`.
`errors` are critical inconsistencies that prevent `build()`; `warnings` identify items worth reviewing.

`Space.addNode()` first runs when `instantiate()` is called; this is also when individual `Skeleton` and `Animation` objects are created.
As a result, multiple instances created from the same build result retain independent animation playback states.

## Learn from the examples

These samples and tests are useful for understanding the role of `ModelAsset`:

* `samples/gltf_loader`: import glTF, inspect clip information, and save JSON.
* `samples/collada_loader`: normalize Collada data to `ModelAsset`.
* `samples/json_loader`: load Model JSON directly as a `ModelAsset`.
* `samples/mmodeler`: read and write ModelAsset JSON / `.json.gz` and save editing geometry with `polygonLoops`. Use the `ModelAsset` API for ModelYAML input and output.
* `samples/janken`: instantiate several times from one built runtime and control each animation independently.
* `unittest/primitive_modelasset`: minimal `Primitive` → `ModelAsset` → `validate` → `build` pipeline.
* `unittest/compression`: gzip compression and restoration through the Compression Streams API, including loading `.json.gz`. YAML gzip uses the same compression path while retaining the commented source text.

## What to check when extending a model format

When adding custom mesh attributes or animation data to ModelAsset, align the saved fields, validation of shared data, GPU-resource construction, and generation of per-instance state as one specification. Every stage needs to handle the field with the same meaning for it to reach rendering correctly.

* **Schema changes:** update `ModelValidator` and `ModelBuilder`.
* **Mesh or skin changes:** check geometry processing and skinning application.
* **Skeleton changes:** check rest poses, inverse bind matrices, and animation links.
* **Animation changes:** check track validation and runtime clip generation.
* **High-level API changes:** check effects on `ModelLoader` and sample implementations.
* **File-format changes:** check `ModelAsset.load()`, `downloadYAML()`, `downloadYAMLGz()`, `downloadJSON()`, `downloadJSONGz()`, and `unittest/compression` across `.yaml`, `.yaml.gz`, `.json`, and `.json.gz`. Check ModelLoader's format detection separately for external ModelAsset JSON.

In particular, maintain the distinction between resources shared by the result of `build()` and state that must be independent for each `instantiate()`. Keep GPU buffers and geometry in shared resources; keep animation playback, current skeleton poses, and per-instance material overrides independent.

## Related documents and the connection to Chapter 09

This chapter is closely related to:

* Chapters 01, 03, 04, 10, 11, and 29
* `book.en/Appendix_D_API.md` (a reference distributed separately from the book)
* `samples/index.html` and `unittest/index.html`
* `webg/ModelAsset.js`, `webg/ModelValidator.js`, `webg/ModelBuilder.js`, and `webg/ModelLoader.js`
* `unittest/compression`

`ModelAsset`, described in this chapter, provides a common format for individual models.
Real applications also need to define the initial state of an entire scene, including the camera, HUD, input settings, primitives, and tile maps.
Chapter 09 introduces `SceneAsset` and SceneYAML for this purpose. SceneYAML describes a complete application; ModelYAML describes an individual model.

## Summary

Use `ModelAsset` to normalize different input formats into shared data.
Build GPU resources once and share them across multiple instances.
Separating the asset, runtime, and instances avoids duplicated geometry while keeping placement and animation independent.

Begin by validating a minimal model, build it, then instantiate as many copies as needed.
Destroy individual instances and shared resources through the objects that own them when they are no longer needed.
This flow keeps format-specific processing separate from scene control.
