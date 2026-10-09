# Loading and instancing ModelYAML

[日本語](README.md) | [Run](model_yaml.html)

## What this sample demonstrates

The sample loads the commented [model.yaml](model.yaml) as a ModelAsset and displays three blue crystals on orange pedestals. ModelYAML stores an individual model's geometry, materials, and Node hierarchy. This file contains two meshes and three Nodes. The application builds the model once and instantiates it three times.

Rendering uses WebgApp's standard Forward path and orbit camera. Drag to orbit and use the wheel to zoom. “回転を開始” starts rotation of the crystals around their Y axes; “回転を停止” stops it. The pedestals remain stationary, demonstrating parent-child relationships and individual Node control.

## Running and saving

Serve the repository over HTTP and open [model_yaml.html](model_yaml.html) in a WebGPU browser on localhost or HTTPS. The status shows validation, mesh, Node, triangle, instance, and comment counts. Expand the source section to inspect the complete YAML, including comments.

“YAML保存” downloads the original model definition. “gzip YAML保存” compresses the same source. The three placements and their rotations are runtime state created by JavaScript. The saved file contains one model definition; use SceneYAML to save an entire scene.

## Implementation

main.js calls ModelAsset.load("./model.yaml"), then assertValid() to validate references and geometry. After WebgApp.init(), it calls asset.build(app.getGPU()) once and runtime.instantiate(app.space) three times. Each instance's nodeMap provides root and gem for placement and rotation. Geometry buffers are shared while Node transforms are independent.

ModelYAML version is the string "1.0". positions is a flat XYZ array; each group of three indices defines one triangle. ModelAsset rotation uses Quaternion components in [x, y, z, w] order. Colors are stored in materials.shaderParams. ModelBuilder computes normals from geometry.

getSourceDocument() provides the original text and comments. The sample preserves Asset values, so toYAMLText() and downloadYAML() return the original text with comments and indentation. Rotating Nodes changes the displayed pose while preserving Asset data. If commented Asset data is changed directly, the core stops YAML export with an error to protect comments. To edit such a model, pass the updated YAML source to fromYAML().

## Files and checks

model.yaml contains the model, main.js handles loading, building, and controls, and model_yaml.html is the executable page. Each model has two meshes, three Nodes, and 20 triangles. Verify that three instances appear and only the crystals rotate. Saved YAML matches the original source, and decompressing its gzip export returns the same text. Startup and saving errors are displayed on the page.

When the page closes, the app stops updates and releases instances before shared model resources.
