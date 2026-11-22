"use strict";

const assert = require("node:assert/strict");
const Scheduler = require("../src/utils/scheduler");
const packageExports = require("../index");

async function run() {
  assert.equal(packageExports.Scheduler, Scheduler);
  assert.equal(packageExports.utilities.Scheduler, Scheduler);
  const scheduler = new Scheduler();
  let completed = 0;
  let failed = 0;
  scheduler.on("taskComplete", event => {
    assert.equal(event.success, true);
    completed += 1;
  });
  scheduler.on("taskError", event => {
    assert.equal(event.name, "failure");
    assert.ok(event.error instanceof Error);
    failed += 1;
  });

  const stoppedJob = scheduler.schedule("disabled-cron", "* * * * *", async () => {}, { start: false });
  assert.equal(typeof stoppedJob.start, "function");
  assert.equal(typeof stoppedJob.stop, "function");
  assert.equal(typeof stoppedJob.destroy, "function");
  assert.equal(scheduler.list()[0].running, false);
  assert.equal(scheduler.start("disabled-cron"), true);
  assert.equal(scheduler.stop("disabled-cron"), true);
  assert.equal(scheduler.remove("disabled-cron"), true);

  scheduler.schedule("active-cron", "* * * * *", async () => {});
  assert.equal(scheduler.list()[0].running, true);
  assert.equal(scheduler.stop("active-cron"), true);
  assert.equal(scheduler.start("active-cron"), true);
  assert.equal(scheduler.remove("active-cron"), true);

  await new Promise((resolve, reject) => {
    scheduler.scheduleOnce("success", 0, async () => "ok");
    const timeout = setTimeout(() => reject(new Error("scheduler task timed out")), 1000);
    scheduler.once("taskComplete", event => {
      if (event.name !== "success") return;
      clearTimeout(timeout);
      resolve();
    });
  });
  assert.equal(completed, 1);
  assert.equal(scheduler.list().length, 0);

  await new Promise((resolve, reject) => {
    scheduler.scheduleOnce("failure", 0, async () => {
      throw new Error("expected test error");
    });
    const timeout = setTimeout(() => reject(new Error("scheduler error event timed out")), 1000);
    scheduler.once("taskError", event => {
      if (event.name !== "failure") return;
      clearTimeout(timeout);
      resolve();
    });
  });
  assert.equal(failed, 1);

  let restarted = 0;
  const restartCompletion = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("restarted one-time task timed out")), 1000);
    scheduler.once("taskComplete", event => {
      if (event.name !== "restartable") return;
      clearTimeout(timeout);
      resolve();
    });
  });
  scheduler.scheduleOnce("restartable", 0, async () => {
    restarted += 1;
    return "restarted";
  });
  assert.equal(scheduler.stop("restartable"), true);
  assert.equal(scheduler.start("restartable"), true);
  await restartCompletion;
  assert.equal(restarted, 1);

  scheduler.scheduleOnce("cancelled", 1000, async () => {
    throw new Error("cancelled task should not run");
  });
  assert.equal(scheduler.stop("cancelled"), true);
  assert.equal(scheduler.remove("cancelled"), true);
  assert.equal(scheduler.list().length, 0);

  assert.throws(() => scheduler.schedule("bad", "not a cron", () => {}), /Invalid cron expression/);
  scheduler.removeAll();

  process.stdout.write("scheduler.test.js: all checks passed\n");
}

run().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
