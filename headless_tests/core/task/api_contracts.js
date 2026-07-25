import assert from "node:assert/strict";
import Task from "../../../webg/Task.js";

const target = {
  total: 0,
  add(value) {
    this.total += value;
  },
};
const task = new Task("movement", 1);
task.setTargetObject(target);
task.setCommand([
  [100, target.add, [10]],
  [0, target.add, [5]],
]);

assert.equal(task.getName(), "movement");
assert.equal(task.getNoOfCommands(), 2);
assert.equal(task.getTime(0), 100);
assert.equal(task.getTime(99), -1);
assert.deepEqual(task.partial_arg([10, 20], 100, 25), [2.5, 5]);

task.start();
assert.equal(task.execute(50), 0);
assert.equal(target.total, 5);
assert.equal(task.execute(50), -1);
assert.equal(target.total, 15);

task.directExecution(target.add, [2]);
assert.equal(target.total, 17);
task.executeOneCommand(0, 0.5);
assert.equal(target.total, 22);

console.log("PASS task_api_contracts");
