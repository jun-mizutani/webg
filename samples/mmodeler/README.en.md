# How to Use mmodeler

[日本語](README.md) | English

## Overview
mmodeler is a Blender-inspired 3D modeling tool optimized for touch operations on smartphones and tablets. Built with WebGPU and JavaScript, it allows intuitive camera control, object editing, primitive addition, and local file saving/loading via gestures. No external server is required for mmodeler to function.

## Mobile Interaction System
The following gestures are assigned to the canvas. These operations can also be performed using a mouse on a PC.

- **Double Tap**: Primary command selection
    - **On a geometry**: Opens the command palette while maintaining current selection.
    - **On empty area**: Prepares Box Selection (opens the command palette if no vertices exist in the scene).
- **Long Press**: Toggles between Object Mode and Edit Mode if an object is present. Displays current state if pressed on an empty area.
- **Single-finger Drag**: Orbit camera
- **Two-finger Drag**: Pan camera
- **Pinch**: Zoom camera
- **Short Tap**: Select (Selects an object in Object Mode; selects a vertex or face in Edit Mode)
- **↑ Button**: Shift-equivalent toggle (top-left). When ON, tapping adds to the current selection. Tapping a selected element again deselects it.

## Command Palette
A 4x4 grid menu activated by double-tapping. Use the `Next` button to cycle through 4 pages of commands. The palette is automatically positioned relative to the screen center to avoid obscuring the operation point.

### Page 1: Basic Editing & Axis Constraints
Basic transformation commands and axis restriction options.

![Page 1: Basic Editing & Axis Constraints](./mm01.jpg)

| Button | Description |
| --- | --- |
| `G` | **Grab**: Moves the selected object, face, or vertex. After pressing, drag the canvas to preview the position and tap to confirm. |
| `E` | **Extrude**: Extrudes selected faces or vertices in Edit Mode. Adjust distance via dragging. |
| `Vert` | **Vertex Select**: Switches selection mode to vertices. Used for vertex-level movement, deletion, addition, and loop selection. |
| `X` | **X-Axis Lock**: Restricts the next transform operation (G/R/S/E/GG) to the world X-axis. Press again to return to Free. |
| `R` | **Rotate**: Rotates the selected object, face, or vertex. Preview angle via dragging and tap to confirm. |
| `GG` | **Edge Slide**: If the selected vertex is the midpoint between two adjacent vertices, it slides along that edge. |
| `Face` | **Face Select**: Switches selection mode to faces. Used for extruding, deleting, or performing loop cuts. |
| `Y` | **Y-Axis Lock**: Restricts the next transform operation (G/R/S/E/GG) to the world Y-axis. Press again to return to Free. |
| `S` | **Scale**: Scales the selected object, face, or vertex. Preview scale via dragging and tap to confirm. |
| `Cut` | **Loop Cut**: Splits selected quad faces in Edit Mode. If a single face is selected, choose the direction using the preview line. |
| `Undo` | **Undo**: Reverts the last edit operation (transform, primitive addition, deletion, etc.). |
| `Z` | **Z-Axis Lock**: Restricts the next transform operation (G/R/S/E/GG) to the world Z-axis. Press again to return to Free. |
| `Next` | Switches to the next command palette page. |
| `Chain` | **Chain Select**: From a selected vertex, choose an adjacent edge direction to select a chain of vertices connected only by quad faces. |
| `Redo` | **Redo**: Re-applies the operation reverted by Undo. |
| `N` | **Normal Lock**: Restricts transform to the average normal direction of selected faces or surrounding vertices. Press again to return to Free. |

### Page 2: Selection, Scene Ops & Display

![Page 2: Selection, Subdivision & Display](./mm02.jpg)

| Button | Description |
| --- | --- |
| `Catm` | **Catmull-Clark**: Subdivides the active mesh to create a smoother, rounded shape. |
| `A` | **Select All**: Selects all objects in Object Mode, or all vertices/faces in Edit Mode. |
| `Add` | **Add Vertex / Make Face**: Creates a face if 3 or 4 vertices are selected; otherwise, switches to the vertex addition tool. |
| `Pr` | **Projection**: Toggles between Perspective and Orthographic views. |
| `Subd` | **Subdivide**: Subdivides quad-only meshes by one level, increasing polygon density while maintaining structure. |
| `Inv` | **Invert Selection**: Inverts the current selection. |
| `Del` | **Delete**: Deletes the selected object, vertex, or face. |
| `Wire` | **Wireframe**: Toggles wireframe view. When ON in Edit Mode, vertices on the backside are also selectable. |
| `M` | **X Mirror**: Toggles mirrored editing relative to X=0. |
| `Half` | **Half Select**: Selects elements with X coordinates less than 0. Useful for mirroring or half-deletion. |
| `Smth` | **Smooth Shading**: Toggles smooth shading without altering the mesh geometry. |
| `Lens` | **Lens Presets**: Switches camera focal length (Wide, Standard, Telephoto). |
| `Next` | Switches to the next command palette page. |
| `Loop` | **Select Loop**: Selects a series of midpoint vertices created by a loop cut, following the cut line. |

### Page 3: File Ops & Object Management

![Page 3: File Ops & Object Management](./mm03.jpg)

| Button | Description |
| --- | --- |
| `Load` | **Load**: Opens the local file picker to load model files or ModelAsset JSONs. |
| `O` | **Origin Reset**: Resets the selected object's origin to the world origin. |
| `Cood` | **Coordinates**: Displays selected vertex coordinates in Edit Mode. Allows direct numeric input for single vertices. |
| `Info` | **Info**: Displays bounding box size, vertex count, polygon count, and origin of the active object. |
| `Json` | **Save JSON**: Saves the scene as a gzip-compressed ModelAsset JSON (`.json.gz`). |
| `Shot` | **Screenshot**: Saves the current canvas view as an image. |
| `Glb` | **Save GLB**: Exports the scene as a GLB file for use in other 3D tools/viewers. |
| `Join` | **Join**: Merges two or more selected objects into one in Object Mode. |
| `Next` | Switches to the next command palette page. |
| `New` | **New Scene**: Discards the current scene and starts a new empty one. |

### Page 4: Primitives & Segments

![Page 4: Primitives & Segments](./mm04.jpg)

| Button | Description |
| --- | --- |
| `Cube` | **Cube**: Adds a cube centered at the local origin. |
| `Torus` | **Torus**: Adds a torus. Segment settings affect the ring/tube density. |
| `Ball` | **Sphere**: Adds a sphere. Segment settings affect longitude/latitude density. |
| `DCone` | **Double Cone**: Adds a double cone with apexes at top and bottom. |
| `Cyl` | **Cylinder**: Adds a cylinder. Segment settings affect the circumference density. |
| `Cone` | **Cone**: Adds a cone. The origin is placed halfway between the base and apex. |
| `Plane` | **Plane**: Adds a plane on the XZ plane. |
| `3` to `32` | **Segment Count**: Sets the density for the next primitive. Higher numbers result in smoother shapes but increase vertex count (Default: 12). |
| `Next` | Returns to Page 1. |

## Detailed Specifications

### Transformation
After selecting `G/R/S/E/GG`, use a single-finger drag to preview the change.
- **Confirm**: Short tap to apply.
- **Continuous Adjustment**: The operation is not finalized upon releasing the finger (pointerup), allowing you to drag again for fine-tuning.
- **Edge Slide (GG)**: Only works if the selected vertex is the midpoint between two adjacent vertices; it slides along that specific edge.

### Loop Cut
Execute `Cut` while selecting a quad face in Edit Mode.
- **Propagation**: The cut propagates from the selected face to adjacent quad faces.
- **Direction**: If only one face is selected, a green preview line appears. Drag toward the desired edge and tap to confirm.
- **X Mirror**: When ON, the cut direction is mirrored to the corresponding edge on the opposite side.

### Select Loop
`Loop` is designed to select midpoint vertex chains created by a Loop Cut.
- **Starting Point**: Select a midpoint vertex in Vertex Select mode and execute `Loop`.
- **Direction**: The tool detects the midpoint and expands the selection to the corresponding midpoint on the opposite side of the polygon.

### Chain Select
`Chain` selects a sequence of vertices connected via quad faces starting from a selected vertex.
- **Starting Point**: Select a vertex in Vertex Select mode and execute `Chain`.
- **Direction**: Choose a direction (Vertical/Horizontal etc.) via the preview line and tap to confirm.
- **Stop Conditions**: Selection stops upon hitting a 90-degree corner, a triangle, or a pentagon.

### Box Select
Double-tap an empty area while geometry exists in the scene.
- **Operation**: Drag to preview the selection area.
- **Confirm**: Release and tap to finalize the selection.
- **Modify**: Drag again before confirming to redraw the area.
- **Cancel**: Double-tap again during preparation or preview.

### Subdivision
- **Subd**: Subdivides quad-only meshes by one level (1 quad $\rightarrow$ 4 quads). Does not execute on meshes containing triangles.
- **Catmull-Clark**: A smoothing subdivision that rebuilds the mesh using face and edge points. Does not execute on non-manifold edges or ambiguous boundaries.

### Selection & Display
- **Markers**: Selected vertices are marked in red. Edges with both endpoints selected are also red, making loop selections visible as lines.
- **Backside Selection**: In Edit Mode with `Wire` ON, vertices obscured by other geometry are selectable.
- **Smooth Shading**: `Smth` toggles the shading smoothness without altering vertex positions.
- **Additive Selection**: When the `↑` button is active, tapping acts as "Add to Selection" (Shift-click equivalent).

### View Dock
Quick-switch camera views using the buttons at the edge of the screen:
- `X` / `-X`: Side / Opposite Side
- `Y` / `-Y`: Top / Bottom
- `Z` / `-Z`: Front / Back

## Blender Integration
Use the dedicated Blender add-on (`blender_modelasset_io.py`) to exchange data.

### Installation
1. In Blender: `Edit > Preferences > Add-ons > Install...` $\rightarrow$ select `blender_modelasset_io.py`.
2. Enable `Webg ModelAsset JSON I/O`.

### Data Exchange
- **mmodeler $\rightarrow$ Blender**: Save as `Json` (gzip JSON) in mmodeler $\rightarrow$ `File > Import > Webg ModelAsset JSON` in Blender.
- **Blender $\rightarrow$ mmodeler**: Select mesh in Blender $\rightarrow$ `File > Export > Webg ModelAsset JSON` $\rightarrow$ `Load` in mmodeler.
- **Axis Conversion**: Automatically converts between Blender (Z-up) and mmodeler (Y-up) by default (can be disabled in options).

## Loading Status
When loading `.json.gz` files, the following stages are displayed:
`decompressing` $\rightarrow$ `parsing` $\rightarrow$ `importing`
This allows users to track progress when loading large files.
