# Combining SceneYAML and ModelYAML

[日本語](README.md) | [Run](scene_model_yaml.html)

## Overview

This sample references ModelYAML from SceneYAML, renders three blue boxes using PBR, and drops them onto a floor. ModelYAML stores model geometry and Nodes; SceneYAML stores the artwork's rendering and physics settings.

[model.yaml](model.yaml) defines a 1m cube mesh, an 8×0.3×6m floor mesh, material IDs, four Nodes, and initial transforms. Three Nodes share the cube mesh and start at center heights of 2m, 3m, and 4m. [scene.yaml](scene.yaml) references ./model.yaml through modelAssetUrl and specifies PBR surfaces, environment lighting, gravity, and collision shapes.

## Running and controls

Serve the repository over HTTP and open [scene_model_yaml.html](scene_model_yaml.html) in a WebGPU browser using localhost or HTTPS. Physics starts paused. Drag to orbit and use the wheel to zoom.

“開始” starts falling, “停止” pauses physics, and “初期位置へ” pauses and restores initial transforms. Rendering and camera controls remain active while physics is paused. The status shows four bodies, four bindings, a 240Hz fixed update, and comment counts for both documents.

## How the documents connect

SceneYAML objects[].node references ModelYAML nodes[].id. objects[].id identifies the object within the artwork: falling-box-1 maps to box-node-1. In the current external-model path, initial transforms belong to ModelYAML Nodes; SceneYAML objects bind those Nodes to physics settings.

SceneYAML materials[].assetMaterialId matches ModelYAML materials[].id. The sample applies a blue metallic surface to box-material and a rough surface to floor-material. All three boxes share the same material.

Display geometry and collision shapes are explicit. physics.shape defines Box dimensions. colliderRelation: match and spatialMatch: require-match check their correspondence with the model. The floor is static; the three boxes are dynamic. Each box has a mass of 1kg. Gravity is -9.8m/s² along Y, the fixed step is 1000/240ms, and solverIterations is 14.

## Loading and saving

main.js loads scene.yaml using SceneAsset.load, calls assertValid(), and passes the Asset to createWebgSceneApp. WebgSceneApp uses SceneDefinition to resolve the relative model URL and ModelAsset.load to read ModelYAML. Model construction, PBR application, Compute body registration, and Node synchronization use the core high-level API.

The loaded model is available through sceneApp.model.asset. Source inspection uses the loaded Asset. Expand the two document sections to view the original text, including comments.

“SceneYAML保存” and “ModelYAML保存” save the initial definitions as their original text. The saved content contains initial definitions, separately from runtime physics positions. Save scene.yaml and model.yaml in the same folder to preserve the relative reference. Save the external model separately with the ModelYAML save button.

## Files and implementation

scene_model_yaml.html is the executable page, main.js initializes the app and controls, scene.yaml contains artwork settings, and model.yaml contains the model. Japanese and English README files have corresponding HTML guides.

Asset values remain unchanged while physics updates runtime Nodes, preserving YAML comments during export. Startup and saving failures appear on screen. Runtime rendering or physics errors stop updates. WebgSceneApp.destroy() releases resources on page exit.

This sample demonstrates the external ModelYAML path. See [model_yaml](../model_yaml/index.en.html) for loading and instancing ModelYAML on its own.
