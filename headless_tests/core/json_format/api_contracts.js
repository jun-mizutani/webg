import assert from "node:assert/strict";
import formatJSON from "../../../webg/JsonFormat.js";

const value = {
  vector: [1, 2, 3],
  nested: { enabled: true, omitted: undefined },
  mixed: [1, undefined, { value: "x" }],
};
const formatted = formatJSON(value, 2);
assert.match(formatted, /"vector": \[1, 2, 3\]/);
assert.doesNotMatch(formatted, /omitted/);
assert.deepEqual(JSON.parse(formatted), {
  vector: [1, 2, 3],
  nested: { enabled: true },
  mixed: [1, null, { value: "x" }],
});

const tabbed = formatJSON({ child: { value: 1 } }, "\t");
assert.match(tabbed, /\n\t"child"/);
assert.equal(formatJSON([], 2), "[]");
assert.equal(formatJSON({}, 2), "{}");
assert.equal(formatJSON(undefined, 2), "null");

console.log("PASS json_format_api_contracts");
