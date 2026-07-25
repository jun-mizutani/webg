import assert from "node:assert/strict";
import Action from "../../../webg/Action.js";

class MockAnimation {
  constructor() {
    this.started = [];
    this.playResults = [];
    this.schedule = { pause: false, stopped: false };
  }

  isValidKeyRange(fromKey, toKey) {
    return Number.isInteger(fromKey) && Number.isInteger(toKey)
      && fromKey >= 0 && toKey < 6 && fromKey < toKey;
  }

  getKeyCount() {
    return 6;
  }

  startTimeFromTo(entryDurationMs, fromKey, toKey) {
    this.started.push({ entryDurationMs, fromKey, toKey });
  }

  play() {
    return this.playResults.shift() ?? -1;
  }
}

const animation = new MockAnimation();
const actions = new Action(animation, { loop: false });
const idle = actions.addPattern({
  id: "idle",
  fromKey: 0,
  toKey: 1,
  entryDurationMs: 50,
});
const run = actions.addPattern({
  id: "run",
  fromKey: 2,
  toKey: 5,
  entryDurationMs: 80,
});
assert.deepEqual(actions.getPatternInfo("idle"), idle);
assert.equal(actions.getPatterns().length, 2);
assert.throws(() => actions.addPattern({ id: "bad", fromKey: 4, toKey: 2 }), /invalid key range/);

actions.addActionDef({ id: "move", patterns: ["idle", "run"] });
assert.deepEqual(actions.getAction("move").patterns, ["idle", "run"]);
assert.throws(() => actions.addActionDef({ id: "bad", patterns: ["missing"] }), /unknown pattern/);

assert.equal(actions.start("move"), 0);
assert.deepEqual(animation.started[0], { entryDurationMs: 50, fromKey: 0, toKey: 1 });
assert.equal(actions.isPlaying(), true);
assert.equal(actions.getActionInfo().patternId, "idle");

actions.pause();
assert.equal(actions.isPlaying(), false);
assert.equal(animation.schedule.pause, true);
assert.equal(actions.play(), 0);
actions.resume();
assert.equal(actions.isPlaying(), true);

animation.playResults.push(-1);
assert.equal(actions.play(), 4);
assert.equal(actions.getActionInfo().patternId, "run");
assert.deepEqual(animation.started[1], { entryDurationMs: 80, fromKey: 2, toKey: 5 });
animation.playResults.push(-1);
assert.equal(actions.play(), -1);
assert.equal(actions.isPlaying(), false);

actions.stop();
assert.equal(actions.getCurrentAction(), null);
assert.equal(actions.getCurrentPattern(), null);
assert.equal(actions.removeAction("move"), true);
assert.equal(actions.removeAction("missing"), false);
assert.equal(actions.removePattern("idle"), true);

console.log("PASS action_api_contracts");
