# Collision Detection and Queries

This chapter explains raycasting to select a `Shape` from a screen position and collision queries to check whether objects in a scene overlap. The checks use world coordinates, first narrowing candidates with broad-phase tests and proceeding to detailed checks only when needed. You will learn to choose the precision and cost appropriate to selection or collision detection.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know coordinate transforms from Chapter 3 and `Space` and `Node` from Chapter 5.

### What to read first

Start with the distinction between raycasting and overlap checks, then read the basic examples for `Space.raycast()` and `checkCollisions()`.

### What to read when you need it

Refer to detailed collision checks, click-position conversion, result handling, and the difference from physical response when needed.

### What you will learn

You will be able to query objects along the view direction and overlaps in a scene with the appropriate API (Application Programming Interface).

## Choose Between Raycasting and Overlap Queries

Use raycasting to find a 3D object at a position selected on screen. Use collision queries to check whether `Shape` objects in the scene overlap. This chapter chooses APIs based on the query origin and required precision, then distinguishes broad-phase candidate checks from triangle-level detail.

The APIs here query rays and shape overlap. Physical response after contact—pushback, bounce, friction, and continuous body updates—is handled by the physics engine in Chapters 27–28.

After accepting user input, an application often needs to determine which object the input reached in 3D space or which scene objects overlap. The API depends on whether the task is selecting an object with a click or checking contact between objects. In `webg`, `Space.raycast()`, `Space.checkCollisions()`, and `Space.checkCollisionsDetailed()` divide these responsibilities.

Although all of these APIs perform checks, their query origins differ. `raycast()` sends one ray and finds what it hits. The `checkCollisions` APIs examine whether shapes in a scene overlap.

The goal is to choose the API for the kind of query you need, rather than simply memorizing API names.

The current implementations of `raycast()` and `checkCollisions()` begin with AABB (axis-aligned bounding box) checks. A thin rod or a diagonal cylinder can therefore produce a hit over a slightly larger area than its visible surface. Use `checkCollisionsDetailed()` to narrow broad-phase candidates at triangle level when you need a more precise result.

For every API, configure `filter` to remove the camera and helper shapes from the candidate set so the result matches the intended query.

## Connect a Click Position to `Space.raycast()`

`Space.raycast()` takes a ray origin and direction and returns the hit shape. Both values are in world space. Convert mouse or touch screen coordinates to NDC (Normalized Device Coordinates), then use the projection and view matrices to construct a world-space ray. `unittest/raycast` implements this complete flow and is a useful reference.

Map the canvas's screen-space X and Y coordinates to the range -1 to 1. WebGPU NDC depth uses the range 0 to 1. With the camera's Reverse-Z convention, the near plane has depth 1 and the far plane has depth 0. This differs from the OpenGL convention, where near depth is -1. Use the `CAMERA_REVERSE_Z` definition instead of hard-coding depth values so drawing and unprojection use the same convention.

```js
import Matrix from "./webg/Matrix.js";
import { CAMERA_REVERSE_Z } from "./webg/DepthConvention.js";

// Convert screen coordinates in CSS pixels to normalized device coordinates.
const cssToNdc = (canvas, clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
};

// Build a ray from a mouse position into 3D space.
const makeRayFromMouse = (canvas, clientX, clientY, eyeNode, proj, view) => {
  const [nx, ny] = cssToNdc(canvas, clientX, clientY);
  const invVp = proj.clone();

  // Projection includes perspective terms, so calculate the full 4x4 matrix.
  // Matrix.mul() is for rigid transforms containing rotation and translation.
  invVp.mul_(view);
  invVp.inverse_strict();

  // WebGPU depth is 0..1; Camera Reverse-Z maps near to 1 and far to 0.
  const near = invVp.mulVector([
    nx,
    ny,
    CAMERA_REVERSE_Z.nearDepth
  ]);
  const far = invVp.mulVector([
    nx,
    ny,
    CAMERA_REVERSE_Z.farDepth
  ]);
  const eyePos = eyeNode.getWorldPosition();
  const dir = [
    far[0] - eyePos[0],
    far[1] - eyePos[1],
    far[2] - eyePos[2]
  ];
  return { origin: eyePos, dir, near, far };
};

canvas.addEventListener("click", (ev) => {
  // Refresh the camera's world matrix before constructing the ray.
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);

  const ray = makeRayFromMouse(
    app.screen.canvas,
    ev.clientX,
    ev.clientY,
    app.eye,
    app.projectionMatrix,
    view
  );

  // Return the first hit and filter the camera and hidden shapes from the query.
  const hit = app.space.raycast(ray.origin, ray.dir, {
    firstHit: true,
    filter: ({ node, shape }) => node !== app.eye && !shape.isHidden
  });

  if (!hit) {
    return;
  }
  console.log(hit.node.name, hit.point, hit.t, hit.boundsOnly);
});
```

Pay particular attention to how the projection and view matrices are combined. `Matrix.mul()` and `Matrix.lmul()` efficiently combine rigid transforms made of rotation and translation. The inverse view-projection matrix includes all four rows of the perspective projection, so use `Matrix.mul_()` to calculate all 16 elements. Using `mul()` here can send a ray in a direction unrelated to the object under the pointer, even when the click event and NDC values are correct.

Next check the depths passed to unprojection. With Camera Reverse-Z, `CAMERA_REVERSE_Z.nearDepth` is 1 and `CAMERA_REVERSE_Z.farDepth` is 0. Unprojecting both values gives world positions on the same line through the view point and clicked position. For perspective projection, use the camera position as the ray origin and the vector from the camera toward the far-plane point as its direction.

Call `app.eye.setWorldMatrix()` and `view.makeView(app.eye.worldMatrix)` before `raycast()`. A stale view matrix makes the ray direction disagree with the click position. Use `filter` to exclude objects that do not belong in the query.

Internally, `raycast()` normalizes the direction and transforms each shape's local bounding box into a world-space AABB for intersection checks. The returned `point` is in world space. `boundsOnly: true` indicates that the hit is based on the bounding box rather than the mesh surface itself. This is useful for click selection and broad hit testing; it is not an exact surface test. In current `webg`, think of `raycast()` as an entry point for selection UI.

Reverse-Z is involved while restoring a world-space ray from screen coordinates and depth. Once passed to `Space.raycast()`, the direction normalization, world AABB construction, and ray-box intersection all use world coordinates. `checkCollisions()` and `checkCollisionsDetailed()` likewise compare world-space shapes and are independent of Reverse-Z.

## Check for Overlaps in a Scene

To check whether scene objects overlap, use collision-query APIs rather than raycasting. `samples/collisions` combines a moving object with several shapes so the differences can be observed.

The basic collision approach has two stages: first narrow candidates with a broad-phase check, then run a detailed check if needed.

### Broad-Phase Check with `checkCollisions()`

Start with `checkCollisions()`:

```js
const collisions = app.space.checkCollisions({
  firstHit: false,
  filter: ({ node, shape }) => {
    if (!shape || shape.isHidden) return false;
    // Exclude the ground from collision candidates.
    return node.name !== "ground";
  }
});

for (let i = 0; i < collisions.length; i++) {
  const pair = collisions[i];
  console.log(pair.nodeA.name, pair.nodeB.name, pair.boundsOnly);
}
```

This API builds a world-space AABB for each shape and lists the overlapping pairs. Set `firstHit: true` to return only the first pair. When learning or debugging, collecting the full array often makes the overall result easier to understand. Use `filter` to exclude the ground or hidden shapes so irrelevant candidates do not obscure the result.

### Detailed Check with `checkCollisionsDetailed()`

AABB checks are broad-phase checks, so diagonal or elongated shapes may produce more candidates than their visible geometry suggests. Use `checkCollisionsDetailed()` when you need greater precision:

```js
const detailed = app.space.checkCollisionsDetailed({
  firstHit: false,
  maxTrianglePairs: 80000,
  filter: ({ node, shape }) => {
    if (!shape || shape.isHidden) return false;
    return node.name !== "ground";
  }
});

for (let i = 0; i < detailed.length; i++) {
  const pair = detailed[i];
  console.log(
    pair.nodeA.name,
    pair.nodeB.name,
    pair.boundsOnly,
    pair.detailedSkipped === true
  );
}
```

`checkCollisionsDetailed()` adds triangle-triangle intersection tests to pairs that pass the broad phase. If the triangle count is very large, computation can increase rapidly. For pairs that exceed `maxTrianglePairs`, the detailed check is skipped; those results carry `boundsOnly: true` and `detailedSkipped: true`.

For efficient operation, first inspect candidate counts with `checkCollisions()` and use detailed checks only where their precision is needed.

## Summary of Query API Choices

Choose the API according to the operation:

- **Select an object with a mouse or tap** → `Space.raycast()`: Build a 3D ray from the pointer and return the first hit to implement a simple selection UI.
- **Check overlap between scene objects** → `checkCollisions()`: Use for basic game collision checks and gathering candidates.
- **AABB results are too broad** → `checkCollisionsDetailed()`: Narrow candidates with `checkCollisions()` and then test at triangle level.

## Notes

Use consistent vectors, coordinate spaces, and update timing for shapes to keep visible and query results aligned and avoid invalid directions. These requirements apply to both raycasting and collision queries:

- `Space.raycast()` normalizes the ray direction internally; provide a direction whose length is greater than zero.
- When constructing a ray from a pointer, check that the canvas CSS size, drawing size, and current projection and view matrices correspond to the current frame.
- Check hidden shapes and filter conditions so helper geometry is excluded from selection.
- Intersection queries report hits. Use the physics engine in Chapters 27–28 or an application-specific collision world for physical response such as pushing a moving body away.

All query APIs use the current world matrices. If you query immediately after moving or rotating objects, preserve the intended update order within the frame. In particular, omitting `app.eye.setWorldMatrix()` can leave the constructed ray pointed along an old camera pose.

If a click event arrives without a hit, display NDC coordinates and the ray direction in a HUD or log to distinguish input issues from unprojection issues. If NDC changes with the click, check that the projection and view matrices use `mul_()` and that Reverse-Z depths of near = 1 and far = 0 are applied.

Remember that current `raycast()` and `checkCollisions()` use AABBs. The returned `boundsOnly` flag identifies a bounding-box hit rather than an exact hit on the mesh surface. Thin rods, diagonal cylinders, and hollow geometry can therefore have a small difference between the visible shape and the query result. Understanding this helps explain hits that appear early or late relative to the visible surface.

Without a `filter`, the camera, helper shapes, and hidden objects can all be candidates. Add conditions such as `node !== app.eye`, `!shape.isHidden`, or excluding a specific ground object early in development. This makes sample code easier to extend into a working application.

## Related Examples

Use these samples and unit tests to explore the chapter's queries:

- Minimal raycast: `unittest/raycast`
- Collision comparison: `samples/collisions`

For interaction with user input, also see Chapter 14, “Touch Controls and Input,” which shows how taps and drags can coexist on one canvas.

## Connect Selection to Game Rules

In `samples/fantasy/main.js`, `makePointerRay()` and `pickTile()` create a ray from screen coordinates and select terrain and unit AABBs. The camera projection and view are also used by `updateLabels()` for labels above units. A drag release is kept distinct from a click, and the auxiliary board's buttons call the same `choose()` function.

Raycasting is a query for selecting visible objects. Movement rules and attack range are checked from tile coordinates in `rules.mjs`. To understand the separation between shape bounds and combat rules, see `PBRSceneToGame.md` and `samples/fantasy/README.md`.

## Summary

Use raycasting to select a `Shape` from the screen and collision queries to check overlap between objects. Narrow candidates with a broad-phase check and use detailed tests only as needed to choose suitable precision and cost.

Keep query data in world coordinates. Preserve it there and convert to camera-relative coordinates only for rendering. Current world matrices, filters, and query bounds are key to making the result match the visible scene.
