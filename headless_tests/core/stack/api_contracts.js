import assert from "node:assert/strict";
import Stack from "../../../webg/Stack.js";

const stack = new Stack();
assert.equal(stack.count(), 0);
assert.equal(stack.top(), undefined);
assert.equal(stack.pop(), null);

const first = { id: 1 };
const second = { id: 2 };
stack.push(first);
stack.push(second);
assert.equal(stack.count(), 2);
assert.equal(stack.top(), second);
assert.equal(stack.count(), 2);
assert.equal(stack.pop(), second);
assert.equal(stack.pop(), first);
assert.equal(stack.pop(), null);
assert.equal(stack.count(), 0);

console.log("PASS stack_api_contracts");
