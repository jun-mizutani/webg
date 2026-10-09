# Physics Engine Internals

This chapter follows collision detection and contact response inside the physics engine: bounding-box tests find contacts, impulses change linear and angular velocity, and support checks determine when a body can sleep. Use it to diagnose or extend the engine after learning the public APIs in Chapters 27–28.

## How to read this chapter

### Prerequisites

Read Chapter 27 for the public physics workflow and Chapter 3 for coordinates and rotations.

### What to read first

Start with oriented bounding boxes (OBBs), the Separating Axis Theorem (SAT), inertia tensors, contact points, and the rotational contact solver.

### What to read when you need it

Refer to support contacts, contact construction, angular velocity, and sleep detection while investigating physical behavior.

### What you will learn

You will be able to trace how shape tests and contact resolution inside `PhysicsSpace` affect stability.

## How the Physics Engine Works Internally

Internal details are useful when changing rotated-box tests, contact velocity, pose integration, or sleep detection, and when an observed push direction looks unexpected. Read each stage from broad phase through solver so that missed candidates and unstable responses can be investigated separately.

### Oriented Box Collision (OBB)

An axis-aligned bounding box (AABB) is inexpensive, but it remains aligned to world axes even when its visible box rotates. `webg` treats `BoxCollider` as an OBB oriented by the body's quaternion, then uses a world-space AABB around that OBB to filter broad-phase candidates.

`webg/BoxCollider.js` implements the world-space information in `getWorldInfo()` and the enclosing bounds in `getAabb()`. The OBB data consists of its center, half extents, and three orientation axes. For each world axis, the AABB extent is the sum of the absolute axis projections multiplied by the corresponding half extents. The broad phase compares these inexpensive AABBs; candidate pairs continue to detailed OBB testing.

### OBB Contact with SAT

The narrow phase uses SAT. If the projections of two boxes have a gap along any candidate axis, the boxes are separated. The candidate axes are the three axes of each box and the nine cross products between them, for 15 axes total.

`BoxCollider.js` provides the center, half extents, orientation axes, and eight vertices. `PhysicsContactDispatcher.js` routes Box/Box pairs to the CPU box-contact path, where `BoxContact.js` performs the 15-axis SAT and computes support features. The simplified excerpt below shows the axis structure:

```js
for (let i = 0; i < 3; i++) {
  if (!testSatAxis(boxA.axes[i])) return null;
  if (!testSatAxis(boxB.axes[i])) return null;
}
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    const axis = cross(boxA.axes[i], boxB.axes[j]);
    if (!testSatAxis(axis)) return null;
  }
}
```

`testSatAxis()` projects both OBBs onto one axis and checks whether their intervals overlap. If all axes overlap, the pair intersects. The axis with the least overlap is a candidate for the contact normal and penetration depth.

The CPU Box contact path selects support features from the minimum-overlap axis and averages the centers of the two support features into a representative point. The standard `PhysicsSpace` uses this point as its contact-manifold input. The Compute path chooses contact count according to shape and body type. `ComputePhysicsShader.js` calls `computeBoxContactManifold()` for a dynamic Box against a static or kinematic Box; `ComputeBoxCollider.js` clips the contact face and selects up to four points. Other combinations, including dynamic Box against dynamic Box, use a representative point. Compare each path with its own contact-generation process.

Tune the fixed time step and solver iterations together with contact count. Keep object dimensions, mass ratios, friction, and drop speed controlled while checking resting orientation, stacking, and settling time.

### Approximate Inertia Tensor

Rotational response depends on both mass and the body's shape. A full inertia tensor is a 3×3 matrix that changes with orientation. To reduce cost, `webg` stores diagonal inertia values along local axes. For a box of dimensions `sx`, `sy`, and `sz`, `PhysicsNode.js` uses the rectangular-solid formula:

```js
return [
  this.mass * (sy * sy + sz * sz) / 12.0,
  this.mass * (sx * sx + sz * sz) / 12.0,
  this.mass * (sx * sx + sy * sy) / 12.0
];
```

Sphere and capsule colliders use corresponding diagonal approximations. The result captures the basic behavior that an elongated object rotates more easily around some axes than others.

### Rotational Contact Solver

Contact response evaluates velocity at the contact point, not only at the body center. A rotating body can have a moving contact point even when its center velocity is zero. The point velocity is `v + omega × r`, where `r` runs from the body center to the contact point.

The public `PhysicsSpace` step delegates contact solving to the CPU solver. The CPU equations are in `CpuPhysicsSolver.js`, and shared impulse calculations are in `PhysicsContactImpulseSolver.js`. The following shows the contact-point velocity and effective-mass denominator:

```js
export function getContactPointVelocity(space, state, r) {
  return space._addVec3(
    state.velocity,
    space._crossVec3(space._degVec3ToRad(state.angularVelocity), r)
  );
}

export function getImpulseDenominator(space, bodyA, stateA, rA, bodyB, stateB,
                                      rB, direction, invMassA, invMassB) {
  const angularA = space._crossVec3(
    space._applyWorldInverseInertia(bodyA, stateA.quat,
      space._crossVec3(rA, direction)), rA);
  const angularB = space._crossVec3(
    space._applyWorldInverseInertia(bodyB, stateB.quat,
      space._crossVec3(rB, direction)), rB);
  return invMassA + invMassB
    + space._dotVec3(direction, angularA)
    + space._dotVec3(direction, angularB);
}
```

`rA` and `rB` run from each center to the contact. An impulse farther from the center has a greater rotational effect. Stored angular velocity is in degrees per second, so the solver converts it to radians per second before calculating `omega × r`; using degrees directly would scale the point velocity by about 57 times.

The effective-mass denominator combines linear mobility with rotational mobility. `_applyWorldInverseInertia()` transforms a world-space torque or angular impulse through the body's current orientation and local diagonal inverse inertia. Its result is an angular velocity change in radians per second.

`applyContactImpulse()` applies linear velocity changes and, unless rotation is fixed, computes torque as `r × impulse`, applies world inverse inertia, then converts the angular change back to degrees per second. Friction impulses use the same framework, so sliding along a contact surface can produce rotation. `applyTorque()` follows the same unit convention: internal angular acceleration uses radians, while public angular velocity remains degrees per second.

### Support Contacts and Sleep Detection

The current contact solver computes contact positions, normals, penetration, and accumulated normal and tangent lambdas, then passes the result to sleep detection. Box orientation and angular velocity are updated from this contact resolution.

For Plane/Box contacts, `PlaneBoxContact.js` selects active support points from Box vertices along the contact normal. When the support points can hold the center-of-mass projection, the body center is projected onto the plane; otherwise their average is projected to create a representative contact point. The support arrangement therefore participates in the contact calculation.

CPU Box-contact sleep checks include Plane support count, Box/Box support, and upward friction support from a wall. The body sleeps when linear and angular velocity, contact-point velocity, and normal velocity remain below thresholds for `sleepStepsThreshold` steps. A condition outside the threshold resets the counter.

For a `Space` containing only Boxes and Planes, `CpuBoxPhysicsAdapter` connects `CpuBoxPhysicsSolver`. When Boxes are mixed with spheres, capsules, or other shapes, `CpuMixedPhysicsPipeline` uses the same state map and routes Box/Box and Plane/Box through CPU Box contacts while routing other shape pairs through general contact handling.

When every dynamic body sleeps, `PhysicsSpace` can use a space-wide fast path based on cached contacts and contact events. If an active body remains, the normal step continues. General-shape paths use contact-island sleep checks; the CPU Box-contact path uses body-level sleep checks.

## Summary

Stable physics depends on shape tests, representative contact construction, impulses for linear and angular velocity, pose integration, and sleep conditions working together. Inspect Box, Sphere, Capsule, and Plane pairs by processing stage, then check support contacts, point velocity, and sleep counters independently. Applications should use the `PhysicsSpace` API from Chapters 27 and 28 rather than assembling these internal stages themselves.
