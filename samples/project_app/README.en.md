# WebgSceneApp samples

`project_app` is an independent sample set for webg 3.0's `WebgSceneApp`: it demonstrates PBR presentation, Compute physics, Joints, and repeated object placement from a scene definition.

The HTML, JavaScript, SceneYAML projects, and scene assets in this folder are sufficient to run the samples. The high-level webg core is loaded from `../../webg/app/`.

## Suggested order

1. Open [project_app_sphere_plane.html](./project_app_sphere_plane.html) to inspect the minimal `objects[]`, material, Sphere, Plane, and Compute body setup
2. Open [project_app_joint.html](./project_app_joint.html) to specify Joint endpoints with object IDs
3. Open [project_app_joint_compute_node.html](./project_app_joint_compute_node.html) to inspect multiple SceneYAML Joints, GPU Compute physics, and Node rendering after readback
4. Open [project_app_object_set.html](./project_app_object_set.html) to generate 16 Boxes from a prototype and `grid3d`
5. Open [project_app_object_set_variants.html](./project_app_object_set_variants.html) to combine Sphere, Capsule, and Box variants
6. Open [project_app_physics.html](./project_app_physics.html) to connect a Blender-authored scene asset, a PBR manifest, and Compute physics
7. Open [domino_36_03.html](./domino_36_03.html) to inspect a project at artwork scale

Open each page in a WebGPU-enabled browser and try Start, Stop, and Reset. `project_app_physics.html` loads `assets/domino2_scene_asset.json.gz`.

`project_app_joint_compute_node.html` moves the rope, pendulum, and crossing Capsule from `joint_compute_node.html` into SceneYAML. The project YAML defines the physics bodies and 61 Distance Joints. The JavaScript entry only drives the kinematic Capsule, synchronizes the display-only pendulum connector, and provides Start, Stop, and Reset. Use `Q` for quasiStatic, `I` for impact, and `A` or `D` to change the Capsule direction.

## SceneYAML object animation

[scene_animation.html](./scene_animation.html) displays an independent floor and fixed post alongside a moving, rotating gate with Sphere and Capsule children. [scene_animation.yaml](./scene_animation.yaml) uses `format: webg-scene`, `version: 1`. The [JavaScript entry](./scene_animation_demo.js) uses the public animation APIs with `renderMode: "ondemand"` and `physics: false`. Serve the repository over HTTP and open the page in a WebGPU browser.

Play starts at the beginning with Loop off by default. Pause and Stop hold the current pose; Resume continues from paused. Seek moves to the requested time in seconds and pauses. Reset animations stops every clip and restores base transforms. Reset scene resets animations and physics (physics is disabled here). Start frames and Stop frames control only the frame loop; pose changes while frames are stopped appear after restarting frames.

The gate's base Euler orientation is 15 degrees around Y, while the first key is zero degrees, making Reset visibly different from Seek(0). Key rotations use `[w, x, y, z]` and positions are absolute local values. The parent's positive uniform scale stays constant. The open pose holds from 2 to 3 seconds, and one-shot playback finishes at 5 seconds.

Generate the compressed artifact with `gzip -n -9 -c samples/project_app/scene_animation.yaml > samples/project_app/scene_animation.yaml.gz` and open the [gzip page](./scene_animation.html?gzip=1). Once the page is ready, optionally run `await (await import('/tools/scene_animation/browser_probe.js')).runSceneAnimationProbe()` in the browser console. This [probe](../../tools/scene_animation/browser_probe.js) checks playback, holds, seek, looping, reset, and UI state, then restores base transforms. It does not verify pixels, parent/child world transforms, or physics.

## Editing units

- Object shape, placement, and physics values: `objects[]` in the SceneYAML project
- Shared definitions and repeated placement: `objectSets[]`
- Color, metallic, roughness, and specular: `materials`
- Object-to-material relationship: `objects[].material`
- Joint endpoints: `physics.joints[]`
- Blender mesh, UV, and Node data: `assets/*.scene.json.gz`

Every runnable sample uses a SceneYAML project manifest. JSON projects and external JSON manifests use the same validation path in `SceneDefinition`.

Each demo JavaScript file calls `createWebgSceneApp()`. WebgSceneApp handles scene-definition validation, Node and Shape creation, PBR preparation, Compute body registration, fixed steps, readback, and Reset. The application entry code describes the camera, buttons, artwork-specific input, and status display.

Import `WebgSceneApp`, `SceneDefinition`, and `ScenePhysics` from `../../webg/app/index.js` to build scene applications.
