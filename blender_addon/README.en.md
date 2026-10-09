# Webg SceneYAML I/O

Webg SceneYAML I/O is a Blender add-on for importing and exporting SceneYAML
project files. It targets Blender 4.5 and later. Comments and docstrings in
the add-on source are written in English. Comments contained in an imported
SceneYAML file are retained in their original language.

## Installation and use

Build the distributable archive from the repository root:

```sh
python3 blender_addon/build_scene_yaml_addon.py
```

In Blender, open **Edit > Preferences > Add-ons**, choose **Install...**, and
select `blender_addon/blender_scene_yaml.zip`. Enable **Webg SceneYAML I/O**.

1. Choose **File > Import > Webg SceneYAML** and open a project file.
2. Move, rotate, or scale the imported objects. Common PBR properties can be
   edited through Principled BSDF.
3. Choose **File > Export > Webg SceneYAML** and select the output path.

The add-on reads and writes `.yaml` and `.yml` as UTF-8 text. The `.yaml.gz`
and `.yml.gz` forms contain gzip-compressed UTF-8 text. The export format is
selected from the output filename, so a new path can also change the
compression format.

## Role of each file

The add-on separates the repository-side archive builder from the modules that
run inside Blender.

| File | Role |
|---|---|
| `build_scene_yaml_addon.py` | Repository-side build script. It packages the four modules in `blender_scene_yaml/` into `blender_scene_yaml.zip`. Blender does not run this file as the add-on |
| `blender_scene_yaml/__init__.py` | Blender-side entry point. It registers the Import and Export menus and operators, then coordinates the complete YAML import/export process |
| `blender_scene_yaml/scene_yaml.py` | Blender-independent SceneYAML parsing and source-preserving value updates. It retains comments, line breaks, and key order around edited values |
| `blender_scene_yaml/animation.py` | Blender-independent validation and interpolation for the SceneYAML animation definition |
| `blender_scene_yaml/blender_animation.py` | Converts Blender Actions/F-Curves and SceneYAML `animations[]` in both directions. Import creates Actions from YAML keyframes; export compares current Actions with YAML keyframes and writes the changes |

`build_scene_yaml_addon.py` does not execute `blender_animation.py`. During the
build, it includes `blender_animation.py` in the distributable ZIP. After the
add-on is enabled in Blender, `__init__.py` calls `blender_animation.py` for
Action and F-Curve conversion. This separates archive creation from the
runtime work that edits and converts SceneYAML data.

## Supported features

| Feature | Current behavior |
|---|---|
| Box, Sphere, Capsule | Import and export of position, rotation, and dimensions |
| `objectSet` | Expands `grid3d`, variant cycles, and instance cycles/ranges; writes individual edits as overrides |
| PBR | Edits color, metallic, roughness, and specular values in inline and external materials |
| Object animation | Converts Actions/F-Curves and SceneYAML position/quaternion keys in both directions; scale must be positive, uniform, and constant |
| Physics | Stores the imported physics definition in `webg_physics_json` and writes edited JSON back to YAML |
| Joint and renderer settings | Preserves the original YAML definitions |
| Comments and formatting | An unchanged export matches the source; an edited export changes only the affected value ranges |
| `.blend` persistence | Stores the raw source YAML in a dedicated Blender Text block so editing can continue after reopening the blend file |
| Concurrent editing | Performs a three-way merge and reports a conflict before saving when the same field changed in both places |
| Saving | Writes through a temporary file and creates a generation-stamped `.bak` backup of the previous file |

Primitive round-trip examples include `project_app_sphere_plane`,
`project_app_joint`, `project_app_object_set`,
`project_app_object_set_variants`, and `domino_36_03`. Object animation is
demonstrated by [scene_animation.yaml](../samples/project_app/scene_animation.yaml)
and its [player](../samples/project_app/scene_animation.html). After import,
edit objects in the associated collection. A new work can start from a minimal
SceneYAML file. When no source-document session exists, direct export can also
create a scene from unmodified Box meshes with unique `webg_id` properties;
parents must also be exported boxes.

Animation targets are display-only objects. Playback uses linear position
interpolation and quaternion spherical interpolation. Exporting edited Bezier
curves requires selecting `Allow curve approximation`; authored key times are
sampled, so intermediate motion can differ from Blender. Check intermediate
poses as well as keys. Joint targets, animated physical bodies or their
ancestors, and changing scale remain future extensions. Delete keys or perform
partial retiming in the YAML source and reimport.

The current implementation focuses on primitive objects and generated
`objectSet` instances. Arbitrary mesh or asset import, vertex editing, and
modifier round trips remain outside the supported range. New Box objects and
PBR edits in an external material manifest are written to the corresponding
YAML documents. Sphere and Capsule dimensions use uniform scale; Box
dimensions support per-axis scale.

## How comments are retained

`__init__.py` connects the add-on to Blender, while `scene_yaml.py` contains a
dependency-free, deliberately limited SceneYAML parser and source-preserving
writer. The writer keeps the original document and associates each supported
value with its source range. Updating a value therefore retains comments,
line endings, quoting, and key order around the edited value.

The add-on stores the original YAML verbatim in a
`WebgSceneYAML_Document_...` Blender Text data block. A separate
`WebgSceneYAML_State_...` block contains only connection information such as
the source path and collection name. Object baselines and Action snapshots are
not used as semantic source data; export compares the source YAML with the
current Blender objects and Actions. Regular text editing should be performed
in the original SceneYAML file. The raw YAML Text block is included when the
`.blend` file is saved.

Existing object transforms, physics values, and PBR values update only the
corresponding YAML fields. To add a Blender box, set a unique `webg_id` custom
property and place the object in the imported SceneYAML collection before
exporting. Box geometry is inferred from the mesh. New Sphere or Capsule
objects and new physics definitions require explicit `webg_shape_json` and
`webg_physics_json` properties. Deletion is performed by editing the YAML and
reimporting so comments attached to list items remain explicit.

## Verification

From the repository root:

```sh
python3 tools/blender_scene_yaml/test_codec.py
blender --background --factory-startup --python-exit-code 1 \
  --python tools/blender_scene_yaml/test_roundtrip.py
node --experimental-default-type=module \
  headless_tests/core/webg_scene_app/scene_gzip_contracts.js
```

The Blender test writes YAML, gzip, and `.blend` artifacts to a temporary
directory. It checks unchanged round trips, movement, object-set overrides,
comment retention, operator registration, and export after reopening a blend
file. WebGPU rendering and Compute Shader physics require a separate browser
verification step.
