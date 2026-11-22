"use strict";

const EventEmitter = require("events");
const cron = require("node-cron");

const MAX_TIMEOUT_MS = 2147483647;

/**
 * Optional application-level scheduler. It is not started or attached to
 * InstaClient automatically.
 */
class Scheduler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = options.enabled !== false;
    this.tasks = new Map();
  }

  schedule(name, expression, task, options = {}) {
    this._validate(name, task);
    if (!this.enabled) return null;
    if (!cron.validate(expression)) throw new Error("Invalid cron expression");
    if (this.tasks.has(name)) throw new Error(`Task already exists: ${name}`);

    const callback = () => this._execute(name, task);
    // node-cron v4 removed the legacy "scheduled" option. createTask()
    // preserves the public start:false behavior without starting the job.
    const job = options.start === false
      ? cron.createTask(expression, callback, { timezone: options.timezone })
      : cron.schedule(expression, callback, { timezone: options.timezone });
    const entry = {
      type: "cron",
      job,
      expression,
      running: options.start !== false,
      timezone: options.timezone || null
    };
    this.tasks.set(name, entry);
    return job;
  }

  scheduleOnce(name, delayMs, task) {
    this._validate(name, task);
    if (!this.enabled) return null;
    if (this.tasks.has(name)) throw new Error(`Task already exists: ${name}`);
    const delay = Number(delayMs);
    if (!Number.isFinite(delay) || delay < 0) throw new TypeError("delayMs must be a non-negative number");
    if (delay > MAX_TIMEOUT_MS) throw new RangeError(`delayMs must not exceed ${MAX_TIMEOUT_MS}`);

    const entry = {
      type: "once",
      timer: null,
      running: false,
      expression: null,
      delayMs: delay,
      task
    };
    this.tasks.set(name, entry);
    this._startOnce(name, entry);
    return entry.timer;
  }

  _startOnce(name, entry) {
    entry.running = true;
    entry.timer = setTimeout(async () => {
      if (!this.tasks.has(name) || this.tasks.get(name) !== entry) return;
      this.tasks.delete(name);
      entry.running = false;
      await this._execute(name, entry.task);
    }, entry.delayMs);
    return entry.timer;
  }

  async _execute(name, task) {
    try {
      const result = await task();
      this.emit("taskComplete", { name, success: true, result });
      return result;
    } catch (error) {
      this.emit("taskError", { name, error });
      return undefined;
    }
  }

  _validate(name, task) {
    if (typeof name !== "string" || !name.trim()) throw new TypeError("Task name is required");
    if (typeof task !== "function") throw new TypeError("Task must be a function");
  }

  stop(name) {
    const entry = this.tasks.get(name);
    if (!entry || !entry.running) return false;
    if (entry.type === "cron") entry.job.stop();
    else clearTimeout(entry.timer);
    entry.running = false;
    return true;
  }

  start(name) {
    const entry = this.tasks.get(name);
    if (!entry || entry.running) return false;
    if (entry.type === "once") {
      this._startOnce(name, entry);
      return true;
    }
    entry.job.start();
    entry.running = true;
    return true;
  }

  remove(name) {
    const entry = this.tasks.get(name);
    if (!entry) return false;
    if (entry.type === "cron") {
      entry.job.stop();
      if (typeof entry.job.destroy === "function") entry.job.destroy();
    } else {
      clearTimeout(entry.timer);
    }
    this.tasks.delete(name);
    return true;
  }

  stopAll() {
    for (const name of this.tasks.keys()) this.stop(name);
  }

  startAll() {
    for (const name of this.tasks.keys()) this.start(name);
  }

  removeAll() {
    for (const name of Array.from(this.tasks.keys())) this.remove(name);
  }

  list() {
    return Array.from(this.tasks.entries()).map(([name, entry]) => ({
      name,
      expression: entry.expression,
      type: entry.type,
      running: entry.running,
      timezone: entry.timezone || undefined
    }));
  }

  everyMinute(name, task, options = {}) {
    return this.schedule(name, "* * * * *", task, options);
  }

  every5Minutes(name, task, options = {}) {
    return this.schedule(name, "*/5 * * * *", task, options);
  }

  every15Minutes(name, task, options = {}) {
    return this.schedule(name, "*/15 * * * *", task, options);
  }

  everyHour(name, task, options = {}) {
    return this.schedule(name, "0 * * * *", task, options);
  }

  daily(name, task, options = {}) {
    const hour = Number.isInteger(options.hour) ? options.hour : 0;
    const minute = Number.isInteger(options.minute) ? options.minute : 0;
    return this.schedule(name, `${minute} ${hour} * * *`, task, options);
  }

  weekly(name, task, options = {}) {
    const day = Number.isInteger(options.day) ? options.day : 0;
    const hour = Number.isInteger(options.hour) ? options.hour : 0;
    const minute = Number.isInteger(options.minute) ? options.minute : 0;
    return this.schedule(name, `${minute} ${hour} * * ${day}`, task, options);
  }
}

module.exports = Scheduler;
module.exports.MAX_TIMEOUT_MS = MAX_TIMEOUT_MS;
