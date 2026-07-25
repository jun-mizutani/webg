import assert from "node:assert/strict";
import InputController from "../../../webg/InputController.js";

const input = new InputController({});

assert.equal(input.normalizeKey(" "), "space");
assert.equal(input.normalizeKey("Spacebar"), "space");
assert.equal(input.normalizeKey("Esc"), "escape");
assert.equal(input.normalizeKey("  A  "), "a");
assert.equal(input.normalizeKey(null), "");

assert.deepEqual(input.registerActionMap({
  jump: ["Space", "Enter"],
  cancel: ["Esc", "Escape"],
  move_left: ["ArrowLeft", "A"],
}), {
  jump: ["space", "enter"],
  cancel: ["escape"],
  move_left: ["arrowleft", "a"],
});

assert.equal(input.press("Space"), true);
assert.equal(input.press("Space"), false);
assert.equal(input.getAction("jump"), true);
assert.equal(input.wasActionPressed("jump"), true);
assert.equal(input.release("Space"), true);
assert.equal(input.release("Space"), false);
assert.equal(input.getAction("jump"), false);
assert.equal(input.wasActionReleased("jump"), true);

input.beginFrame();
assert.equal(input.wasActionPressed("jump"), false);
assert.equal(input.wasActionReleased("jump"), false);

assert.equal(input.pulseAction("cancel"), true);
assert.equal(input.getAction("cancel"), true);
assert.equal(input.wasActionPressed("cancel"), true);
const captured = input.captureFrameState({ frame: 4, timeMs: 64, label: "probe" });
assert.equal(captured.frame, 4);
assert.equal(captured.actions.cancel.pulse, true);

input.beginFrame();
assert.equal(input.getAction("cancel"), false);
input.applyFrameState(captured, { replaceActionMap: true });
assert.equal(input.getAction("cancel"), true);
assert.equal(input.wasActionPressed("cancel"), true);

assert.equal(input.shouldPreventDefaultForKeyboardEvent({ ctrlKey: true }, "a"), false);
assert.equal(input.shouldPreventDefaultForKeyboardEvent({}, "a"), true);

const surface = { contains: (target) => target?.inside === true };
assert.equal(input.shouldPreventDefaultForPointerEvent({ target: surface }, true, surface), true);
assert.equal(input.shouldPreventDefaultForPointerEvent({ target: { inside: true } }, true, surface), true);
assert.equal(input.shouldPreventDefaultForPointerEvent({ target: {} }, true, surface), false);

console.log("PASS input_controller_api_contracts");
