# Loading and instancing ModelYAML

[日本語](README.md) | [Run](model_yaml.html)

## What this sample demonstrates

The sample loads the commented [model.yaml](model.yaml) as a ModelAsset and displays three blue crystals on orange pedestals. ModelYAML stores an individual model's geometry, materials, and Node hierarchy. This file contains two meshes and three Nodes. The application builds the model once and instantiates it three times.

Rendering uses WebgApp's standard Forward path and orbit camera. Drag to orbit and use the wheel to zoom. **回転を開始** (Start Rotation) spins the crystals around their Y axes; **回転を停止** (Stop Rotation) pauses them. The pedestals stay still, showing how parent-child relationships let individual Nodes move independently.

## Running and saving

Serve the repository over HTTP and open [model_yaml.html](model_yaml.html) in a WebGPU browser on localhost or HTTPS. The status shows validation, mesh, Node, triangle, instance, and comment counts. Expand the source section to inspect the complete YAML, including comments.

**YAML保存** (Save YAML) downloads the model definition. **gzip YAML保存** (Save Gzip YAML) downloads a compressed copy of the same source. JavaScript creates the three placements and their rotations at runtime, so the saved file contains one model definition. Use SceneYAML to save a complete scene.

## Implementation

main.js calls ModelAsset.load("./model.yaml"), then assertValid() to validate references and geometry. After WebgApp.init(), it calls asset.build(app.getGPU()) once and runtime.instantiate(app.space) three times. Each instance's nodeMap provides root and gem for placement and rotation. Geometry buffers are shared while Node transforms are independent.

ModelYAML version is the string "1.0". positions is a flat XYZ array; each group of three indices defines one triangle. ModelAsset rotation uses Quaternion components in [x, y, z, w] order. Colors are stored in materials.shaderParams. ModelBuilder computes normals from geometry.

`getSourceDocument()` provides the source text and comments. Because the sample preserves Asset values, `toYAMLText()` and `downloadYAML()` reproduce the input with its comments and indentation. Rotating Nodes changes the displayed pose while leaving the Asset data intact. To edit a model with comments, update the YAML source and pass it to `fromYAML()` so the comments stay aligned with the saved values.

## Files and checks

`model.yaml` contains the model, `main.js` handles loading, building, and controls, and `model_yaml.html` runs the sample. The model has two meshes, three Nodes, and 20 triangles. Check that all three instances appear and only the crystals rotate. The YAML export reproduces the source text, and decompressing the gzip export returns the same text. Startup and save errors appear on the page.

When the page closes, the app stops updates and releases instances before shared model resources.
