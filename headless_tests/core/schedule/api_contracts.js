import assert from "node:assert/strict";
import Schedule from "../../../webg/Schedule.js";

const target = {
  total: 0,
  add(value) {
    this.total += value;
  },
};
const schedule = new Schedule("timeline");
const task = schedule.addTask("movement");
task.setTargetObject(target);
task.setCommand([
  [100, target.add, [10]],
  [0, target.add, [5]],
]);

assert.equal(schedule.getNoOfTasks(), 1);
assert.equal(schedule.getTask(0), task);
assert.equal(schedule.getTaskByName("movement"), task);
assert.equal(schedule.getTask(99), null);

schedule.setSpeed(0.5);
assert.equal(task.time_scale, 0.5);
schedule.start();
assert.equal(schedule.doCommandFps(20), -1);
assert.equal(target.total, 15);

assert.equal(typeof Schedule.prototype.pause, "function");
if (typeof schedule.pause === "function") {
  throw new Error("XPASS Schedule.pause() is callable; remove the known-issue marker");
}
console.warn("XFAIL Schedule constructor state shadows pause() method");
assert.equal(schedule.doCommand(), -1);
schedule.delTask(task);
assert.equal(schedule.getTaskByName("movement"), null);

console.log("PASS schedule_api_contracts");
