"use strict";

// Wrap FCA callbacks so a callback that throws is still considered invoked.
// Callers can inspect .called in their catch block and rethrow the callback's
// own exception instead of calling it a second time with an API error.
module.exports = function createCallback(callback) {
  if (typeof callback !== "function") return null;
  let called = false;
  const invoke = (...args) => {
    if (called) return;
    called = true;
    return callback(...args);
  };
  Object.defineProperty(invoke, "called", { get: () => called });
  return invoke;
};
