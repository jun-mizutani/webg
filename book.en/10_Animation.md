# Animation

This chapter builds from clip interpolation and time updates to playback ranges, action names, and choosing clips based on application state.
Use the lower-level API when playing a single clip. Combine higher-level layers when playback needs to respond to input or state.
The goal is to choose a structure that matches the playback conditions and keeps playback selection separate from bone-pose calculations.

## How to read this chapter

### Prerequisites

The chapter is easier to follow if you know model assets from Chapter 08 and JavaScript time and event handling.

### What to read first

Read basic playback of one clip, reuse of ranges through `Action`, and selection through `AnimationState`, in that order.

### What to read when you need it

Refer to `Schedule`, `Task`, interpolation, state switching, and asset requirements when controlling playback in more detail.

### What you will learn

You will be able to choose between playing a clip directly and selecting playback through ranges or states.

## Start by playing one clip

A clip is a continuous motion saved with a model. If the model loaded in Chapter 08 contains clips, choose one by name and play it. First inspect the complete motion, then name the ranges you want to use and add input- or state-based selection.

### Connect basic playback to an application

`Animation.js` is the lowest-level object for playing one `clip`.
Despite its broad-sounding name, it specializes in applying and advancing one clip on a skeleton.
It retains key information through `setTimes(times)` and `setBonePoses(bonePoses)`, creates the runtime tasks it needs with `setData(skeleton, bindShapeMatrix)`, and advances playback with `start()` or `play()`.
In other words, `Animation` controls how one animation sequence moves along its timeline.

Use this layer directly when you want to check the complete clip, for example in a loader sample.

```js
// Basic loader-sample flow for inspecting a complete clip
const model = await app.loadModel("model.dae", {
  format: "collada",
  instantiate: true,
  startAnimations: false
});

const clipId = model.asset.getClipNames()[0];
const runtime = model.runtime;

runtime.restartAnimation(clipId);

app.start({
  onUpdate: () => {
    // Advance the clip's internal time and bone poses every frame
    runtime.playAnimation(clipId);
  }
});
```

`restartAnimation()` begins playback from the start, and `playAnimation()` is called every frame from `WebgApp`'s update process.
In this example, `playAnimation()` advances by the runtime's internal time, so the caller does not manage `deltaSec` for the clip.

This approach is suited to checking whether an asset's animation was authored correctly or inspecting an importer's result before adding `Action` or `AnimationState` control.
It is the direct entry point for answering the question, “Is the clip itself correct?”

The `app` in this example is an initialized `WebgApp`. Provide a model containing animation as `model.dae` and adjust the URL to its location. First inspect the names returned by `getClipNames()`, then assign the desired name to `clipId` so the target remains clear even when a model has several clips.

Use one update call to advance playback during a frame. The direct clip example calls `runtime.playAnimation()`; the state-management example below connects `AnimationState.update()` to the update process.

## Separate animation into layers by responsibility

`webg` divides animation into `Animation`, which holds keyframes; `Action`, which groups playback ranges; `AnimationState`, which selects what to play; and `Schedule` and `Task`, which manage execution over time.
This chapter distinguishes selection—what to play—from execution—when and how the selected motion applies to Nodes or bones.

There are two flows in this chapter.
`clip -> pattern -> action -> state` is the control layer that selects what to play. `Animation -> Schedule -> Task -> CoordinateSystem` is the execution layer that applies the selected motion over time to the appropriate Nodes or bones.
Keep these flows distinct as you read.

## Understand the role of each layer

The purpose of dividing animation into layers is to change bone interpolation, naming a portion of a clip, and selecting playback from current state independently.
Use only the layers you need: this avoids adding a state machine to a simple loop or duplicating low-level interpolation code for complex transitions.

![Clip, action, state, and task layers](../book/img/fig12_01_animation_layers.jpg)

*Clip, action, state, and task may look similar, but each has a distinct role. When investigating an animation issue, first identify which layer it belongs to.*

A `clip` is one continuous animation sequence.
At runtime, it corresponds to an `Animation.js` object.
It retains the data for which pose each bone takes at each time for a particular skeleton.
If a DCC tool exports `Idle`, `Walk`, and `Jump` separately, each is usually a separate clip.
As the lowest-level data, a clip supports operations such as play, stop, and move to a key range. Higher-level `Action` or application logic decides whether to use `Walk` for a game state.
The clip focuses on the animation data itself.

A `pattern` is a particular range within a clip.
`Action.js` can register a key range in this form:

```js
// Define a key range and the runtime entry duration
{
  id: "step_left",
  fromKey: 2,
  toKey: 5,
  entryDurationMs: 120
}
```

A `pattern` declares a portion of an existing clip.
`fromKey` is the first key, `toKey` is the last, and `entryDurationMs` sets how many milliseconds the runtime takes to transition from the current pose to the start of that range.
Thus, a pattern defines the selected range and its entry transition; the original clip retains the keyframe sequence.

An `action` groups patterns into a unit that is convenient for the application or sample to use.
For example, combine “left step” and “right step” under `walk_loop` so the sample can control a motion by that action name without depending on the individual range names.

```js
// Group patterns into an action and configure looping
{
  id: "walk_loop",
  patterns: ["step_left", "step_right"],
  loop: true
}
```

`Action.js` plays the action, manages the current pattern, and determines whether to continue to the next range, return to the start, or stop when a range ends.
The action layer defines which ranges are shown and in what order.

`state` is the high-level control layer that decides which `action` or `clip` to use now.
`AnimationState.js` manages states by name, along with their transition conditions:

```js
// Define a state name, action, and transition conditions
{
  id: "walk",
  action: "walk_loop",
  transitions: [
    { to: "idle", test: (ctx) => ctx.moveSpeed <= 0.1 },
    { to: "jump", test: (ctx) => ctx.jumpPressed }
  ]
}
```

A state refers to animation data and manages what to play while in that state and the conditions for transitioning to another one.
An `action` is a group of playback ranges; a `state` is a decision unit for selecting what to play.

## Action.js makes clip ranges reusable

`Action.js` is a runtime controller that refers to one `Animation` and makes its ranges easier to reuse as patterns and actions.
It gives clear names to portions of a clip so they can be selected again.
This is especially useful for assets that store several poses in one clip, such as hand poses.

```js
// Initialize Action and define patterns and an action
const action = new Action(animation);

action.addPattern({
  id: "step_left",
  fromKey: 2,
  toKey: 5,
  entryDurationMs: 120
});

action.addPattern({
  id: "step_right",
  fromKey: 6,
  toKey: 9,
  entryDurationMs: 120
});

// Define and start an action
action.addAction("walk_loop", ["step_left", "step_right"]);
action.start("walk_loop");
```

Call `play()` each frame to advance playback:

```js
// Advance playback once per frame
action.play();
```

`Action` refers to the original clip and manages the playback ranges and their order.
It simply extracts ranges such as “left foot,” “right foot,” “rock,” or “scissors” and names them for convenient use.
This keeps sample code from having to refer to keyframe numbers repeatedly.

## AnimationState.js separates playback selection

`AnimationState.js` is the higher-level control layer that decides which `action` or `clip` should play now.
Its purpose is to separate playback-selection logic from the sample's main processing.
As conditions grow, mixing “what should play in this state?” with “advance the current playback” makes the sample harder to read.
`AnimationState` lets you isolate the decision of what to play.

A minimal state definition looks like this:

```js
// Basic state definition: ID, action, and transition condition
{
  id: "idle",
  action: "idle",
  transitions: [
    { to: "walk", test: (ctx) => ctx.moveSpeed > 0.1 }
  ]
}
```

Transitions can also specify priority and a cooldown:

```js
// Transition details: priority and cooldown duration
{
  to: "jump",
  test: (ctx) => ctx.jumpPressed,
  priority: 10,
  cooldownMs: 80
}
```

A state describes rules for selecting playback; the referenced clip holds the animation data.
Several states can refer to the same action, and a state can refer directly to a clip.

A standard setup first prepares clip playback or `Action`, then builds `AnimationState` on top:

```js
// Define ranges through Action and refer to them from states
const clipId = model.asset.getClipNames()[0];
const animation = model.runtime.getAnimation(clipId);
const action = new Action(animation);

action.addPattern({ id: "pose0", fromKey: 2, toKey: 3, entryDurationMs: 220 });
action.addPattern({ id: "pose1", fromKey: 4, toKey: 5, entryDurationMs: 220 });
action.addAction("pose0", ["pose0"]);
action.addAction("pose1", ["pose1"]);

const sm = new AnimationState(action, {
  initialState: "pose0"
});

sm.addState({ id: "pose0", action: "pose0" });
sm.addState({ id: "pose1", action: "pose1" });
```

Call `update(context)` every frame:

```js
// Update with the current application context each frame
sm.update({
  moveSpeed,
  jumpPressed,
  grounded,
  nowMs
});
```

`AnimationState` has two main usage styles.
One evaluates conditions and decides transitions by calling `update(context)` every frame, as above.
The other calls `setState()` directly when an input or game event occurs; it is command-driven.
`samples/animation_state` demonstrates the first style, and `samples/janken` demonstrates the second.

For an application such as `janken`, where a specific pose should appear immediately after user input, an event handler can be direct:

```js
// Switch state in response to an input event
function onJankenInput(choiceId) {
  handState.setState(choiceId, {
    startOptions: {
      entryDurationMs: 250
    },
    force: true
  });
}
```

This style treats an input event as a high-level command, so state selection happens in the event handler. Keep calling `update()` each frame to advance the selected motion.
Setting `force: true` restarts the state even when it matches the current state.
This is the main difference from condition-driven selection.

## Schedule.js and Task.js execute interpolation

After `AnimationState` or `Action` selects what to play, lower layers perform the actual position and rotation updates.
`Schedule.js` and `Task.js` handle that work.
Structurally, `AnimationState` decides what to play; `Schedule.js` and `Task.js` process interpolation formulas and bone coordinates.
The selected range becomes a sequence of timed commands that are executed for each bone.

The processing flow is:

1. `AnimationState.update()` decides on a transition.
2. `Action.start()` selects the current pattern.
3. `transitionToKey(entryDurationMs, fromKey, toKey)` calls `Animation.startTimeFromTo()`.
4. `Animation.setData()` assembles a `Task` for each bone.
5. `Schedule.directExecution()` passes the assembled command sequence to each `Task`.
6. `Task.execute(delta_msec)` applies `putRotTransByMatrix` or `doRotTrans` to the target bone.

The lowest-level `Task` actually moves the bones.

This separation keeps state-machine decisions apart from interpolation and pose calculations.
`AnimationState` manages the intent—what motion should be shown now—while `Task` executes how that instruction advances over time.
Changing input conditions or game rules can then leave interpolation code intact.

## Choose which layers to use

Use these criteria to decide how far up the animation layers to go:

* **`Animation` alone:** sufficient when one complete clip is all you need. Loader samples use this to inspect the clip as restored by an importer.
* **Through `Action`:** use when you want to reuse named ranges within a clip. This works for finger poses or walking steps, and for samples where directly controlling actions remains simple.
* **Through `AnimationState`:** use when you want named states, or want to separate input and gameplay conditions from playback logic. It also provides a common way to show the current state in a HUD or diagnostic display and to treat input events as high-level commands.

As a guide, consider how many conditional branches have accumulated and whether extracting playback selection would improve readability.

## Tune playback selection separately from smoothness

`AnimationState` selects the playback target based on conditions or input. Tune motion smoothness through asset key placement, `fromKey / toKey` in `Action`, `entryDurationMs`, and the interpolation settings in `Animation`. Checking the selected motion separately from how it moves makes it easier to identify which values to change.

For a small setup, start an `Action` directly. When conditions grow, move selection into `AnimationState` so input and playback ranges can be managed independently. An `action` is an ordered set of ranges; a `state` is a decision unit that chooses one. Several states can select the same action.

State selection can evaluate conditions each frame or call `setState()` at the moment of input. Chapter 11 demonstrates the first style in `animation_state` and the second in `janken`.

## Check asset requirements

Loader samples play a complete clip to inspect the keyframes restored by the importer.
Pose-switching samples such as `hand`, `janken`, and `animation_state` use `Action` to select portions of a clip, so they depend closely on `fromKey / toKey` and the asset's key layout.
Chapter 11 examines specific key ranges.

Match the coordinate axes and interpolation mode in the asset to the runtime's supported range.
Assets exported from Blender are expected to use Y-up, which `webg` loads as-is.
For keyframe-based Collada, increase the `Sampling` interval and enable `Keep Keyframes`.

For glTF (GL Transmission Format) and GLB (its binary form), it is safer to disable `Sampling` and export with `LINEAR` interpolation.
The current `webg/GltfShape.js` omits the tangents before and after a `CUBICSPLINE` key and approximates the remaining values as a `LINEAR` key sequence. Keep this behavior in mind when exact curve playback is required.

## Summary

This chapter starts with basic clip playback and introduces the hierarchy `clip -> pattern -> action -> state`:

* `clip`: keyframe sequence imported from an asset
* `Action`: layer that extracts and names reusable ranges
* `AnimationState`: high-level layer that chooses an `action` or `clip`
* `Animation` → `Schedule` → `Task`: low-level layers that interpolate and apply poses to bones

This structure helps identify whether an issue belongs to the asset, the action range, or state-transition logic.

We have compared loader samples with pose-switching samples, explained `fromKey / toKey` and `entryDurationMs`, summarized export settings, and described the two `AnimationState` usage styles.
Chapter 11 demonstrates these layers in `animation_state` and `janken` and shows how to choose asset key ranges.
