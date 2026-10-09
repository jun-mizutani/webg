# Animation and Assets

This chapter uses samples to show how animation clips in a model asset connect to patterns, actions, and states, and how playback responds to input.
It also organizes where to look—asset keys, playback ranges, state selection, or interpolation—when a pose does not change as expected.
The goal is to apply the layers from Chapter 10 to real assets.

## How to read this chapter

### Prerequisites

The chapter is easier to follow if you know ModelAsset from Chapter 08 and AnimationState from Chapter 10.

### What to read first

Start with sample controls and display, the example selecting the N0 range, and the difference between condition evaluation and input events.

### What to read when you need it

Refer to `startFromTo`, `startTimeFromTo`, key ranges, and the mapping of poses in `hand.glb` when inspecting a particular asset.

### What you will learn

You will be able to inspect clips and key ranges in an asset and isolate issues with interpolation or playback position.

## Understand animation control through samples

Open the runnable application linked from `samples/animation_state/index.html` and choose a pose with keys 1–6. Compare the target state, current state, action, and pattern in the HUD, and check that the hand moves to the selected pose. Then run the application linked from `samples/janken/index.html` to see how an input event selects a pose.

This chapter uses `samples/animation_state` and `samples/janken` to demonstrate how to extract a portion of a GLB (the binary form of glTF) clip as an `Action` and play it from `AnimationState`.
Compare condition-based selection with restarting the same state from an input event, and connect key ranges in the asset to application controls.

* **`samples/animation_state`**: selection through per-frame condition evaluation; main entry point is `update(context)`; use it to choose a transition from the desired state.
* **`samples/janken`**: selection through input commands; main entry point is `setState(..., { force: true })`; use it for immediate actions, including restarting the same state.

First operate the samples to connect the layers from Chapter 10 to real examples. Compare selecting the N0 range and the two state-selection methods. Then inspect key ranges in `samples/gltf_loader/hand.glb` and `entryDurationMs` to isolate asset, selection, and interpolation issues.

## A concrete example: N0 in animation_state

`samples/animation_state` is a concise reference for connecting `Action` and `AnimationState`.
In `main.js`, pose ranges from `hand.glb` are registered as patterns and actions, and `AnimationState` starts `pose0`.

```js
const pattern = { id: "N0", fromKey: 12, toKey: 13, entryDurationMs: 250 };
action.addPattern(pattern);
action.addAction(pattern.id, [pattern.id]);
animationState.setState("pose0", {
  context: {
    desiredPoseId,
    nowMs: app.space.now()
  },
  force: true
});
```

Distinguish the key range from the playback duration here.
`12 -> 13` is the key range of the pattern.
`250 ms` is the entry transition duration: the time spent moving from the current pose to key 12.
`fromKey / toKey` select the range within the clip. Playback within that range uses the clip's timing, separately from `entryDurationMs`.

In `animation_state`, `AnimationState.update()` also advances playback with `action.play()` internally.
The sample only needs to update the desired state.

`samples/janken` and `samples/animation_state` use the same pattern definitions.
`AnimationState` selects the action to start; movement and rotation interpolation flow through `Action` → `Animation` → `Schedule` → `Task` → `CoordinateSystem`.

## `startFromTo()` and `startTimeFromTo()`

`webg` has similarly named methods `startFromTo()` and `startTimeFromTo()`, but their roles differ.
In short, `startFromTo()` plays a clip range directly; `startTimeFromTo()` also specifies a separate entry duration for transitioning from the current pose to `fromKey`.

The implementation of `Animation.startFromTo(keyFrom, keyTo)` is:

```js
// Play a key range directly
startFromTo(keyFrom, keyTo) {
  this.setPose(keyFrom);
  this.schedule.startFromTo(keyFrom * 2, keyTo * 2 - 1);
}
```

The behavior is direct. `setPose(keyFrom)` immediately applies the pose at `fromKey`, and `schedule.startFromTo(keyFrom * 2, keyTo * 2 - 1)` advances through the corresponding command range using the clip's time differences.
For example, `startFromTo(12, 13)` calls `setPose(12)` and then `schedule.startFromTo(24, 25)`.
It immediately applies key 12, then plays the 12 → 13 range using the clip's original timing. Interpolation takes place within that selected range; there is no timed transition from the previous pose to key 12.

By contrast, `Animation.startTimeFromTo(time, keyFrom, keyTo)` first creates a transition from the current pose to `fromKey` using the separately specified `entryDurationMs`:

```js
// Enter a key over the specified duration
startTimeFromTo(time, keyFrom, keyTo) {
  this.transitionTo(time, keyFrom, keyTo);
}
```

`transitionTo(250, 12, 13)` first gathers `this.poses[i][12]` for each bone.
It applies `putRotTransByMatrix` immediately, then runs `doRotTrans` over 250 ms.
The processing has two stages: moving from the current pose to key 12, then entering the clip range from key 12 to key 13.

Patterns such as `N0` give the transition from the current pose to the selected key a specified duration. With this form, adjust the motion toward a new pose from the moment of input using `entryDurationMs`.
Thus, `startFromTo()` is useful for inspecting a clip's own motion, while `startTimeFromTo()` fits state changes such as idle → walk or rock → scissors.

## Identify entry points in the samples

In `samples/animation_state/main.js`, the sample assembles `Action` patterns and actions, then changes only `desiredPoseId`, delegating control to `AnimationState`.
`AnimationState.update()` advances `Action.start()` and `action.play()` internally.

In `samples/janken/main.js`, the sample calls `AnimationState.setState(..., { force: true })` in response to user input and passes playback to `Action` in the same way.

These samples rarely need to call `startFromTo()` directly.
`startFromTo()` is a lower-level function used inside `Animation` to play an entire clip or process the command sequence created by `Action`.
For application code, focus on `Action.startPattern()`, `Action.start()`, and `AnimationState.setState()`, understanding that they eventually reach the `startTimeFromTo()` path.

## How to read animation_state and janken

`samples/animation_state` uses the glTF-format `hand.glb` to demonstrate condition-driven `AnimationState`.
The sample updates only the desired state and delegates the decision about which action to start to `AnimationState`.

If the sample called `Action.start()` directly, its code would explicitly contain the logic for choosing each pattern or action.
In `samples/animation_state`, the sample sets `desiredPoseId`, while `AnimationState` manages `pose0` through `pose5` and starts the corresponding `N0` through `N5` actions.
The difference is one of responsibility: the former makes the sample choose what to play; the latter lets the sample express only the desired state.
The latter is easier to organize when transition conditions expand.

Use keys `1`–`6` to change the target state, `/` to move to the next target, `P` for automatic cycling, and `@` to restart the current state.
The HUD shows the current state, target state, current action, pattern, and recent transition. This makes it easy to trace the relationship between the desired state and the action actually running.

`samples/janken`, in contrast, demonstrates command-driven use of `AnimationState`.
It suits actions such as showing a hand pose immediately when an input occurs. An input event chooses the next state; per-frame updates advance the selected motion.

`samples/animation_state` is condition-driven: it updates `desiredPoseId` each frame, and `update(context)` evaluates `transitions` to choose the next state.

`samples/janken` is command-driven: each input event calls `setState(choiceId, { force: true })`. `update()` advances the action and maintains state information.

The difference is when selection occurs. The first uses conditions evaluated each frame; the second responds to the input event itself.
For a game such as rock-paper-scissors, immediate response to `G`, `C`, or `P` matters more than checking every frame which gesture to select.
The same gesture may also need to be shown again, so the system needs to restart the current state with `force`.
`janken` demonstrates that `AnimationState` works beyond condition evaluation.

## Check the pose and playback time in sequence

When changing poses, check the desired state, selected action, actual key range, and interpolation duration in that order. `AnimationState` selects what to play, while `Action` and `Animation` handle key ranges and pose changes.

First play the clip directly to inspect its original motion. Then check the range selected by `fromKey / toKey` and the duration in `entryDurationMs`. When poses are far apart, allowing sufficient transition time makes the intermediate motion easier to see. Inspect state selection in the HUD or with `getDebugInfo()`, and check the update time and elapsed-time basis when playback resumes unexpectedly.

This sequence lets you inspect asset poses, range selection, state decisions, and time progression separately. Refer to the detailed internal flow later in this chapter when you need to trace a result from the public API down to the calculation applied to a bone.

## Runtime flow from AnimationState to Task

Following the flow from `AnimationState` to the actual movement and rotation clarifies each layer's responsibility.
`AnimationState` decides what to play; lower layers—`Animation`, `Schedule`, and `Task`—handle bone coordinates and interpolation.
The selected target, range selection, time interpolation, and execution of commands on individual bones proceed in sequence through these layers.

The processing flow is:

1. `AnimationState.update(context, deltaMs)` updates the current state and selects a transition when needed. If `resolveTransition()` returns true, `setState()` runs `onExit`, updates `currentState`, runs `onEnter`, and calls `playStateTarget()`.
2. `playStateTarget()` calls one of `start()`, `startAction()`, `startAnimation()`, or `restartAnimation()` based on the controller type. If an `Action` is the controller, it starts the named action here.
3. `Action.start(actionId, options)` gets the first pattern from the action, sets `currentPattern`, and calls `transitionToKey()`. `Action.play()` advances to the next pattern when the current one ends and loops as configured.
4. `transitionToKey(entryDurationMs, fromKey, toKey)` calls `startTimeFromTo()` in `Animation.js`, setting the pattern range and entry duration as the interpolation target.
5. `Animation.startTimeFromTo(time, keyFrom, keyTo)` calls `transitionTo()` and sends commands to `Schedule` using the poses at `keyFrom` and `keyTo`. `putRotTransByMatrix` sets the starting pose; `doRotTrans` advances interpolation over time.
6. `Animation.setData(skeleton, bind_shape_matrix)` creates a `Task` for each bone and registers command pairs for each key range: `[0, putRotTransByMatrix, ...]` and `[time, doRotTrans, [1.0]]`. This builds the commands used for interpolation.
7. `Schedule.directExecution()` sends the same command to each bone's `Task`; when `time > 0`, it inserts the command into the active queue through `insertCurrentCommand()`. `Schedule.doCommand()` calculates `delta_msec` and executes `Task.execute(delta_msec)` for each task.
8. `Task.execute(delta_msec)` runs commands while tracking `remaining_time`, calling `CoordinateSystem.prototype.putRotTransByMatrix` or `CoordinateSystem.prototype.doRotTrans` on the target bone through `execCommand()`. This is where movement and rotation are finally applied.

This layer separation keeps state-machine logic apart from interpolation. By limiting `AnimationState` to deciding what animation should be shown, changes to input conditions or game rules do not affect interpolation code.
`Task` focuses on advancing commands over time, so the same mechanism can also be reused for command sequences beyond animation.

In a command-driven sample such as `samples/janken`, input calls `setState()` to start an action, which then flows into the command sequence for `Animation` and `Task`.
In a condition-driven sample such as `samples/animation_state`, each frame's context selects a state, which starts the corresponding action below it.
In both cases, `Task` drives the actual bones.

For debugging, use `AnimationState.getDebugInfo()` to inspect state transitions and `Action.getActionInfo()` to inspect the current action and pattern.
Follow `Animation.getClipInfo()` and the `Task` command sequence to isolate the layer where unexpected behavior occurs.

## Follow how N0 reaches the bones

The internal call sequence for this example is:

1. `AnimationState.setState("pose0")` sets the `pose0` state as `currentState`.
2. `AnimationState.playStateTarget()` finds `state.action === "N0"` and calls `Action.start("N0")`.
3. `Action.start("N0")` selects `N0` as the first pattern and calls `transitionToKey(250, 12, 13)`.
4. `transitionToKey(250, 12, 13)` calls `anim.startTimeFromTo(250, 12, 13)`.
5. `Animation.startTimeFromTo(250, 12, 13)` calls `transitionTo(250, 12, 13)`.
6. `transitionTo()` stores `this.poses[i][12]` in `args` for each bone and sets `ones` to `1.0`.
7. `Schedule.directExecution(0, CoordinateSystem.prototype.putRotTransByMatrix, args)` passes the starting pose to each `Task`.
8. `Schedule.directExecution(250, CoordinateSystem.prototype.doRotTrans, ones, 24, 25)` runs `doRotTrans(1.0)` on each `Task` over 250 ms.
9. Each frame, `Task.execute(delta_msec)` runs, reducing `remaining_time` as it advances `doRotTrans(1.0)`.
10. `CoordinateSystem.doRotTrans(1.0)` calls `execRotation()` and `execTranslation()`, applying rotation with `slerp` and movement with linear interpolation.

## Pose mapping for key ranges in hand.glb

When inspecting a hand sample, it may be unclear which pose `fromKey / toKey` refers to or why the same pose continues across several frames.
The pose-hold ranges in the `hand.glb` used by this book are listed below. For another model, choose ranges that match its clip information.

| Key range | Pose | Pattern in `animation_state` / `janken` |
| :--- | :--- | :--- |
| 0 | Rest pose | None |
| 1 | Rock | None |
| 2–3 | One finger extended | `N1: 2 -> 3` |
| 4–5 | Scissors | `N2: 4 -> 5` |
| 6–7 | Three fingers extended | `N3: 6 -> 7` |
| 8–9 | Four fingers extended | `N4: 8 -> 9` |
| 10–11 | Paper | `N5: 10 -> 11` |
| 12–13 | Rock | `N0: 12 -> 13` |

The `fromKey / toKey` values define the playback range that `Action` uses to present each pose.
`entryDurationMs: 250` moves toward the pose over 0.25 seconds when entering that range.

Placing the same pose on consecutive keys creates a hold interval.
This keeps the pose visible for a duration and provides a buffer before the next pose, reducing sudden jumps and stabilizing transitions during playback.
For example, the scissors pose at keys 4–5 remains visible through that range and can be reused by a sample state.
Consecutive keys describe how long the pose stays in place.

These hold intervals make changes from input or target-state updates look natural and can be reused by other `Action` playback styles or future `AnimationState` extensions.
They also let the asset explicitly describe which pose to display and for how long.

When exporting glTF / GLB from Blender, consider the following.
For a keyframe-driven asset such as `samples/gltf_loader/hand.glb`, exporting with `LINEAR` interpolation matches the runtime's key-range interpolation.

When the current importer reads `CUBICSPLINE`, it skips the tangents before and after each key and extracts the center value as a `LINEAR` key.
`CUBICSPLINE` input is therefore treated as a `LINEAR` key sequence after loading. Check the asset at authoring time if the resulting motion differs from the original curve.
For the safest Blender export, disable `Sampling`, export the required keyframes, and set interpolation to `LINEAR`.
Also ensure that the required bones and actions in the armature have keys.

With these settings, glTF / GLB can be used while retaining the original keyframe sequence.
If `Sampling` is enabled or interpolation remains `CUBICSPLINE`, the `gltf_loader` path discards tangents and approximates the result with `LINEAR` interpolation. Check this conversion when exact curves matter.
For hand animations in the current `webg`, assume `LINEAR` interpolation.

## Identify the reference asset and clip information

Key numbers are specific to each model. If a file with the same name has been replaced, use `getClipInfo()` to check clip names and key counts.
Use this asset identity when comparing against the pose table in this book:

> **Reference asset:** The key-to-pose mapping for `samples/gltf_loader/hand.glb` corresponds to the asset with SHA-256 `8ae1ba4d9d5dcd170e2c009d8e55c7177ba80d38fcb8a2bdda88670550735c23`. If the file hash differs, retrieve clip names and key counts with the code below and review the table against the asset.

```js
const model = await app.loadModel("samples/gltf_loader/hand.glb", {
  format: "gltf",
  instantiate: false
});

for (const clipId of model.asset.getClipNames()) {
  console.log(model.asset.getClipInfo(clipId));
}
```

`getClipInfo()` returns `id`, `targetSkeleton`, `keyCount`, `trackCount`, and `durationMs`.
Compare the hash to confirm the same file. After replacing an asset, rebuild the table from this information and the pattern definitions in the sample.

## Summary

Operating the samples and connecting input, playback selection, key ranges, and interpolation duration in sequence provides a practical understanding of animation.
`animation_state` demonstrates condition-driven `AnimationState`; `janken` demonstrates input-driven `AnimationState`.

In either sample, application code decides what to play. The flow `Animation` → `Schedule` → `Task` → `CoordinateSystem` performs interpolation and applies it to bones.
This division lets input handling, state selection, and interpolation run independently.

This chapter also distinguished `startFromTo()` from `startTimeFromTo()`, explained the key ranges and hold intervals in `hand.glb`, and summarized glTF / GLB export settings.
These details help determine whether an animation issue comes from a key range, transition duration, or time reference.

Chapter 12 organizes HUDs, conversation displays, and panels from the perspective of UI (user interface) design.
