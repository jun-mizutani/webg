# SceneYAML Studio

This sample edits 3D scenes while importing and exporting SceneYAML files. It combines WebgSceneApp PBR rendering, SceneDefinition validation, SceneYAML parsing and gzip compression. It reuses mmodeler's vertex/face representation and primitive generation while keeping document data separate from rendering.

## Start and basic editing

Serve the repository over HTTP and open edit_yaml.html in a WebGPU browser using localhost or HTTPS. The initial scene contains a floor and a box, independent of browser storage.

Select an object in the list or by clicking its geometry. Edit position, rotation in degrees, dimensions, color, metallic and roughness in the inspector. Drag to orbit and use the wheel to zoom. Add boxes, spheres and capsules; duplicate, delete, undo and redo edits. Use the object JSON or scene YAML fields for parenting, scale and advanced settings. Editing a shared material affects all its users. Duplicates share materials and meshes.

## Import and export

Open .yaml, .yml or .yaml.gz files. Save plain YAML or gzip locally; files are not uploaded. Unedited source text, including comments and indentation, is preserved. Form edits reformat the document while retaining comments at the top with their source line information and preserving extra data fields.

Apply the scene YAML or object JSON explicitly. Other edits and saving are blocked while text changes remain unapplied. The discard-input button restores both text fields to their last applied values. Invalid values and references produce an error while retaining the last successful scene. Replacing an unsaved scene requires confirmation.

## Mesh editing

Convert a box or sphere to an editable mesh. For a physics object, first specify a box, sphere or capsule in physics.shape using the object JSON field. Conversion and vertex edits change the display geometry while preserving the explicit collider. Select a vertex number and edit its XYZ coordinates, or click its displayed marker. Markers use through-selection, including vertices behind surfaces. The selected vertex is orange and the selected face has a translucent orange overlay. Select a face number to extrude along its normal, subdivide into triangles around a new center vertex, or delete it. Extrusion distance uses object-local units.

Meshes use triangles and quads with zero-based vertex indices. Quads are triangulated in vertex order; subdividing before twisting a face makes the result easier to understand. Zero-area faces, invalid indices and removing the final face are rejected. Each mesh allows up to 20000 vertices and 40000 faces. Shape generates normals; material.flatShading selects flat surface shading. Shape editing supports Box and Sphere mesh conversion, vertex positions, faces and material settings.

## Format and supported scope

SceneYAML officially supports the meshes array and objects[].mesh references. Each mesh contains id, vertices and faces. Saved files load directly through createWebgSceneApp({ project: './scene.yaml' }). Physics mesh objects require an explicit box, sphere or capsule in physics.shape. Physics uses the explicitly selected box, sphere, or capsule, while display meshes use vertex positions and faces. Generated objectSets use primitive shapes.

Inline objects/materials/physics are supported. Generated objectSets are edited in YAML. External SceneAsset, ModelAsset and material references are rejected with an explanation. Renderer settings, animations and application-specific fields are preserved. The preview uses editor studio lighting and does not execute physics, animations, emitters, goals or other application-specific logic. Verify final lighting and behavior in the application's runtime.

The inspector edits bodyType, mass, friction and restitution. Physics objects require physics.space. New scenes explicitly start with a 240Hz configuration and maxBodies: 128. Change capacity in YAML when needed; values and capacity are never automatically corrected.

## Implementation notes

main.js handles inputs and history; scene_document.js handles source and validation; mesh_edit.js handles vertex/face operations; scene_view.js handles PBR display. GPU initialization runs once; edits rebuild Nodes and Shapes. Mesh validation and Shape construction use the core SceneMesh.js and PrimitiveScene.js modules. Run node samples/edit_yaml/check_document.mjs for data checks without a GPU. Development details are in docs/edit_yaml.md.

## Collider display and editing

Use the collider section to select a box, sphere or capsule and edit its dimensions, radius, segment length and XYZ offset. Selecting a collider on an object without physics enables a static body. Switching types uses the initial dimensions shown in the menu while preserving display geometry and placement. Choose dynamic bodyType and set mass for a dynamic body.

The selected object's collider is drawn with yellow through-visible lines, including hidden edges. A checkbox toggles the overlay. Offset uses object-local coordinates and follows object and parent rotation. Curved outlines are visual approximations; physics retains the specified radius and length.

A primitive without physics.shape uses its display dimensions. The copy-display-shape button explicitly saves the current shape to physics.shape for independent editing, including before mesh conversion. Changes support Undo/Redo and YAML saving. Use the application runtime to verify the configured physics behavior.

## Numeric input

Press Enter or Tab to commit typed numbers. Arrow keys and spinner buttons change values in steps of 0.01 while retaining focus. Invalid values produce an error and restore the last accepted value.
