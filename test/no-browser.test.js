/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// Simulate an installation where the optional browser peer is absent, even if
// the developer running this test happens to have puppeteer-core installed.
const originalLoad = Module._load;
let puppeteerLoadAttempts = 0;
Module._load = function (request, parent, isMain) {
  if (request === "puppeteer-core") {
    puppeteerLoadAttempts++;
    const error = new Error("Cannot find module 'puppeteer-core'");
    error.code = "MODULE_NOT_FOUND";
    throw error;
  }
  return originalLoad.call(this, request, parent, isMain);
};

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hoonica-no-browser-"));

  try {
    // Importing the public package must not load or require the optional browser.
    const login = require("../index.js");
    assert.equal(typeof login, "function");
    assert.equal(typeof login.harvestSessionParams, "function");
    assert.equal(typeof login.findChromium, "function");
    assert.equal(puppeteerLoadAttempts, 0, "package import must not load Puppeteer");

    // Browser harvesting is opt-in and must fail with an actionable message
    // when the optional peer dependency is absent.
    await assert.rejects(
      login.harvestSessionParams({ sessionid: "unit-test-session" }),
      (error) => {
        assert.match(error.message, /puppeteer-core is not installed/i);
        assert.match(error.message, /pre-harvested sessionParams/i);
        return true;
      }
    );
    assert.equal(puppeteerLoadAttempts, 1);

    // The core API constructor must accept supplied session params without
    // launching a browser or importing Puppeteer.
    const api = new login.InstaAPI("sessionid=unit-test-session", {
      sessionParams: { __dyn: "test-dyn", __hsi: "test-hsi" },
      deviceFile: path.join(tempDir, "device.json"),
      appStateFile: path.join(tempDir, "session-guard.json")
    });
    assert.equal(api.http.hasSessionParams(), true);
    assert.equal(puppeteerLoadAttempts, 1, "core API construction must not load Puppeteer");

    api.stopListening();
    api.realtimeDisconnect();

    process.stdout.write("no-browser.test.js: 3 checks passed\n");
  } finally {
    Module._load = originalLoad;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  Module._load = originalLoad;
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
