"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

const {
  _createBrowser,
  _disposeBrowser,
  harvestSessionParams
} = require("../src/session");

async function testBrowserURLConnection() {
  let receivedOptions;
  const fakeBrowser = { disconnect() {} };

  const puppeteer = {
    async connect(options) {
      receivedOptions = options;
      return fakeBrowser;
    }
  };

  const result = await _createBrowser(puppeteer, {
    browserURL: "http://127.0.0.1:9222"
  });

  assert.equal(result.browser, fakeBrowser);
  assert.equal(result.external, true);
  assert.deepEqual(receivedOptions, {
    browserURL: "http://127.0.0.1:9222"
  });
}

async function testWebSocketConnection() {
  let receivedOptions;
  const fakeBrowser = { disconnect() {} };

  const puppeteer = {
    async connect(options) {
      receivedOptions = options;
      return fakeBrowser;
    }
  };

  const result = await _createBrowser(puppeteer, {
    browserWSEndpoint: "ws://127.0.0.1:9222/devtools/browser/test"
  });

  assert.equal(result.browser, fakeBrowser);
  assert.equal(result.external, true);
  assert.deepEqual(receivedOptions, {
    browserWSEndpoint: "ws://127.0.0.1:9222/devtools/browser/test"
  });
}

async function testConflictingConnectionOptionsRejected() {
  let called = false;

  const puppeteer = {
    async connect() {
      called = true;
    },
    async launch() {
      called = true;
    }
  };

  await assert.rejects(
    () => _createBrowser(puppeteer, {
      browserURL: "http://127.0.0.1:9222",
      browserWSEndpoint: "ws://127.0.0.1/test"
    }),
    /either browserURL or browserWSEndpoint/i
  );

  assert.equal(called, false);
}

async function testLaunchModeRemainsSupported() {
  let receivedOptions;
  const fakeBrowser = { close() {} };

  const puppeteer = {
    async launch(options) {
      receivedOptions = options;
      return fakeBrowser;
    }
  };

  const result = await _createBrowser(puppeteer, {
    executablePath: "/fake/chromium",
    headless: true,
    args: ["--test-argument"]
  });

  assert.equal(result.browser, fakeBrowser);
  assert.equal(result.external, false);
  assert.equal(receivedOptions.executablePath, "/fake/chromium");
  assert.equal(receivedOptions.headless, true);
  assert.ok(receivedOptions.args.includes("--test-argument"));
}

async function testExternalBrowserDisconnectsWithoutClosing() {
  let disconnected = 0;
  let closed = 0;

  const browser = {
    disconnect() {
      disconnected += 1;
    },
    async close() {
      closed += 1;
    }
  };

  await _disposeBrowser(browser, true);

  assert.equal(disconnected, 1);
  assert.equal(closed, 0);
}

async function testLaunchedBrowserCloses() {
  let disconnected = 0;
  let closed = 0;

  const browser = {
    disconnect() {
      disconnected += 1;
    },
    async close() {
      closed += 1;
    }
  };

  await _disposeBrowser(browser, false);

  assert.equal(disconnected, 0);
  assert.equal(closed, 1);
}


async function testHarvestCleanupOrder() {
  const events = [];
  let requestHandler;
  let browserClosed = 0;

  const page = {
    async setUserAgent() {},
    async setCookie() {},
    on(event, handler) {
      assert.equal(event, "request");
      requestHandler = handler;
    },
    async goto(url, options) {
      assert.equal(url, "https://www.instagram.com/direct/inbox/");
      assert.equal(options.waitUntil, "domcontentloaded");
      assert.equal(options.timeout, 1000);
      requestHandler({
        url: () => "https://www.instagram.com/api/graphql",
        headers: () => ({
          "x-fb-friendly-name": "PolarisDirectInboxQuery"
        }),
        postData: () => "fb_dtsg=fake-token&lsd=fake-lsd"
      });
    },
    async close() {
      events.push("page.close");
    }
  };

  const browser = {
    async newPage() { return page; },
    disconnect() { events.push("browser.disconnect"); },
    async close() { browserClosed += 1; }
  };

  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "puppeteer-core") {
      return {
        async connect(options) {
          assert.equal(options.browserURL, "http://127.0.0.1:9222");
          return browser;
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const params = await harvestSessionParams({}, {
      browserURL: "http://127.0.0.1:9222",
      timeout: 1000,
      settleMs: 0
    });
    assert.deepEqual(params, {
      fb_dtsg: "fake-token",
      lsd: "fake-lsd"
    });
  } finally {
    Module._load = originalLoad;
  }

  assert.deepEqual(events, ["page.close", "browser.disconnect"]);
  assert.equal(browserClosed, 0);
}

async function testRefreshSessionForwardsOptions() {
  const InstaAPI = require("../src/api");
  const api = Object.create(InstaAPI.prototype);
  const apiPath = require.resolve("../src/api");
  const options = {
    browserURL: "http://127.0.0.1:9222",
    browserExecutablePath: "/fake/chromium",
    browserHeadless: false,
    browserArgs: ["--no-sandbox"],
    browserUserAgent: "HoonICA-Test-UA",
    sessionHarvestTimeout: 12345,
    sessionHarvestSettleMs: 321
  };

  api.options = options;
  api.http = { seed: { sessionid: "fake-session" } };

  let appliedParams;
  let receivedSeed;
  let receivedOptions;
  api.setSessionParams = (params) => { appliedParams = params; };

  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "./session" && parent && parent.filename === apiPath) {
      return {
        async harvestSessionParams(seed, harvestOptions) {
          receivedSeed = seed;
          receivedOptions = harvestOptions;
          return { fb_dtsg: "harvested-token" };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    assert.equal(await api.refreshSession(), true);
  } finally {
    Module._load = originalLoad;
  }

  assert.deepEqual(receivedSeed, { sessionid: "fake-session" });
  assert.deepEqual(receivedOptions, {
    browserURL: options.browserURL,
    browserWSEndpoint: undefined,
    executablePath: options.browserExecutablePath,
    headless: options.browserHeadless,
    args: options.browserArgs,
    userAgent: options.browserUserAgent,
    timeout: options.sessionHarvestTimeout,
    settleMs: options.sessionHarvestSettleMs
  });
  assert.deepEqual(appliedParams, { fb_dtsg: "harvested-token" });
}

async function testRefreshSessionAcceptsSuppliedParams() {
  const InstaAPI = require("../src/api");
  const api = Object.create(InstaAPI.prototype);
  let applied;
  api.setSessionParams = (params) => { applied = params; };

  const supplied = {
    fb_dtsg: "caller-token",
    lsd: "caller-lsd"
  };

  assert.equal(await api.refreshSession(supplied), true);
  assert.deepEqual(applied, supplied);
}

(async () => {
  await testBrowserURLConnection();
  await testWebSocketConnection();
  await testConflictingConnectionOptionsRejected();
  await testLaunchModeRemainsSupported();
  await testExternalBrowserDisconnectsWithoutClosing();
  await testLaunchedBrowserCloses();
  await testHarvestCleanupOrder();
  await testRefreshSessionForwardsOptions();
  await testRefreshSessionAcceptsSuppliedParams();

  process.stdout.write("session-browser.test.js: 9 tests passed\n");
})().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
