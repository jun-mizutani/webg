// ---------------------------------------------
// unittest/animation_state_contracts/main.js  2026/05/06
//   AnimationState contract checks
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import AnimationState from "../../webg/AnimationState.js";

const statusEl = document.getElementById("status");
const lines = [];
let passCount = 0;
let failCount = 0;

const log = (line) => {
  lines.push(line);
};

const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

const checkThrows = (label, fn, pattern) => {
  try {
    fn();
    check(label, false, "did not throw");
  } catch (err) {
    const message = err?.message ?? String(err);
    const matches = pattern ? pattern.test(message) : true;
    check(label, matches, matches ? "" : message);
  }
};

class MockActionController {
  constructor() {
    this.calls = [];
    this.actionId = null;
    this.playing = false;
    this.paused = false;
  }

  start(actionId, options = {}) {
    this.actionId = actionId;
    this.playing = true;
    this.paused = false;
    this.calls.push({ type: "start", actionId, options });
    return this.calls.length;
  }

  play(deltaMs) {
    this.calls.push({ type: "play", actionId: this.actionId, deltaMs });
    return this.calls.length;
  }

  getActionInfo() {
    return {
      actionId: this.actionId,
      playing: this.playing,
      paused: this.paused
    };
  }

  count(type) {
    return this.calls.filter((call) => call.type === type).length;
  }

  last(type) {
    const filtered = this.calls.filter((call) => call.type === type);
    return filtered[filtered.length - 1] ?? null;
  }
}

const runFailureChecks = () => {
  log("[definition failures]");
  const machine = new AnimationState(new MockActionController());
  checkThrows(
    "addState rejects non-object state",
    () => machine.addState(null),
    /state definition must be an object/
  );
  checkThrows(
    "addState rejects missing id",
    () => machine.addState({ action: "idle" }),
    /state id is required/
  );
  checkThrows(
    "addState rejects state without action or clip",
    () => machine.addState({ id: "empty" }),
    /requires action or clip/
  );
  checkThrows(
    "addState rejects transition without to",
    () => machine.addState({ id: "idle", action: "idle", transitions: [{ test: () => false }] }),
    /requires "to"/
  );
  checkThrows(
    "addState rejects transition without test",
    () => machine.addState({ id: "idle", action: "idle", transitions: [{ to: "run" }] }),
    /requires test/
  );

  const missingTime = new AnimationState(new MockActionController(), { initialState: "idle" });
  missingTime.addState({ id: "idle", action: "idle" });
  checkThrows(
    "update requires finite context.nowMs",
    () => missingTime.update({}),
    /requires finite context\.nowMs/
  );
};

const runTransitionChecks = () => {
  log("");
  log("[state transitions]");
  const controller = new MockActionController();
  const machine = new AnimationState(controller, { initialState: "idle" });
  const events = [];

  machine.addState({
    id: "idle",
    action: "idle",
    onEnter: ({ stateId }) => events.push(`enter:${stateId}`),
    onExit: ({ stateId, nextStateId }) => events.push(`exit:${stateId}->${nextStateId}`),
    transitions: [
      {
        to: "run",
        label: "idle->run",
        priority: 1,
        test: (ctx) => ctx.speed > 0
      },
      {
        to: "jump",
        label: "idle->jump",
        priority: 10,
        test: (ctx) => ctx.jump === true
      }
    ]
  });
  machine.addState({
    id: "run",
    action: "run",
    transitions: [
      {
        to: "idle",
        label: "run->idle",
        test: (ctx) => ctx.speed <= 0
      }
    ]
  });
  machine.addState({
    id: "jump",
    action: "jump",
    transitions: [
      {
        to: "idle",
        label: "jump->idle",
        test: (ctx) => ctx.grounded === true
      }
    ]
  });

  const first = machine.update({ nowMs: 0, speed: 0, jump: false }, 16);
  check("initial update starts initial state", first.state?.id === "idle", first.state?.id ?? "null");
  check("initial update calls start once", controller.count("start") === 1, String(controller.count("start")));
  check("initial update does not play on state-start frame", controller.count("play") === 0, String(controller.count("play")));

  const priorityTransition = machine.update({
    nowMs: 16,
    speed: 1,
    jump: true,
    entryDurationMs: 80
  }, 16);
  check("higher priority transition wins", priorityTransition.state?.id === "jump", priorityTransition.state?.id ?? "null");
  check("transition label is preserved", priorityTransition.transition?.label === "idle->jump", priorityTransition.transition?.label ?? "null");
  check("transition start receives entryDurationMs", controller.last("start")?.options?.entryDurationMs === 80, JSON.stringify(controller.last("start")?.options));
  check("transition frame does not call play", controller.count("play") === 0, String(controller.count("play")));

  const steady = machine.update({ nowMs: 32, grounded: false }, 16);
  check("steady frame keeps current state", steady.state?.id === "jump", steady.state?.id ?? "null");
  check("steady frame calls play", controller.count("play") === 1, String(controller.count("play")));

  const backToIdle = machine.update({ nowMs: 48, grounded: true }, 16);
  check("transition can return to idle", backToIdle.state?.id === "idle", backToIdle.state?.id ?? "null");
  check("last transition is available", machine.getCurrentTransition()?.label === "jump->idle", machine.getCurrentTransition()?.label ?? "null");
  check("debug info exposes state and action", machine.getDebugInfo().stateId === "idle" && machine.getDebugInfo().actionId === "idle", JSON.stringify(machine.getDebugInfo()));
  check("onEnter/onExit callbacks run", events.includes("enter:idle") && events.includes("exit:idle->jump"), events.join(","));

  checkThrows(
    "setState rejects unknown state",
    () => machine.setState("missing"),
    /unknown state/
  );
};

runFailureChecks();
runTransitionChecks();

const summary = failCount === 0
  ? `PASS animation_state_contracts (${passCount} checks)`
  : `FAIL animation_state_contracts (${failCount} failed / ${passCount} passed)`;
statusEl.textContent = `${summary}\n\n${lines.join("\n")}`;
