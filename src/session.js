/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const fs = require("fs");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

// Instagram's web API requires browser-session params such as __dyn, __csr,
// __hs, __hsi, __s, __hsdp, __sjsp, __hblp, __spin_r, __spin_b, __spin_t,
// fb_dtsg, jazoest and lsd. The web JS bundle produces them. They are
// session-scoped, so one real browser page load can capture the app's own
// PolarisDirectInboxQuery request and reuse its params for later HTTP calls.
//
// Chromium is driven with puppeteer-core. An existing browser can be reused
// through browserURL or browserWSEndpoint; otherwise a local browser is launched.

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

function findChromium() {
  return CHROMIUM_CANDIDATES.find((p) => {
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });
}

async function createBrowser(puppeteer, options = {}) {
  const hasBrowserURL = Boolean(options.browserURL);
  const hasBrowserWSEndpoint = Boolean(options.browserWSEndpoint);

  if (hasBrowserURL && hasBrowserWSEndpoint) {
    throw new Error(
      "Specify either browserURL or browserWSEndpoint, not both."
    );
  }

  if (hasBrowserURL) {
    return {
      browser: await puppeteer.connect({
        browserURL: options.browserURL
      }),
      external: true
    };
  }

  if (hasBrowserWSEndpoint) {
    return {
      browser: await puppeteer.connect({
        browserWSEndpoint: options.browserWSEndpoint
      }),
      external: true
    };
  }

  const executablePath = options.executablePath || findChromium();

  if (!executablePath) {
    throw new Error(
      "No Chromium/Chrome binary found for session harvesting"
    );
  }

  return {
    browser: await puppeteer.launch({
      executablePath,
      headless: options.headless === undefined ? "new" : options.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        ...(options.args || [])
      ]
    }),
    external: false
  };
}

async function disposeBrowser(browser, external) {
  if (!browser) return;

  if (external) {
    browser.disconnect();
  } else {
    await browser.close();
  }
}

async function harvestSessionParams(cookieJar, options = {}) {
  let puppeteer;

  try {
    puppeteer = require("puppeteer-core");
  } catch (_) {
    throw new Error(
      "puppeteer-core is not installed. Install a Node-compatible version separately to use browser session harvesting, or pass pre-harvested sessionParams."
    );
  }

  const connection = await createBrowser(puppeteer, options);
  const { browser, external } = connection;
  let page;

  try {
    const cookies = Object.entries(cookieJar || {}).map(([name, value]) => ({
      name,
      value,
      domain: ".instagram.com",
      path: "/",
      secure: true,
      httpOnly: false
    }));

    page = await browser.newPage();

    await page.setUserAgent(options.userAgent || DEFAULT_UA);

    if (cookies.length > 0) {
      await page.setCookie(...cookies);
    }

    let captured = null;

    page.on("request", (req) => {
      if (captured || !req.url().includes("/api/graphql")) return;

      const headers = req.headers();

      if (headers["x-fb-friendly-name"] === "PolarisDirectInboxQuery") {
        captured = req.postData();
      }
    });

    await page.goto("https://www.instagram.com/direct/inbox/", {
      waitUntil: "networkidle2",
      timeout: options.timeout || 60000
    });

    if (!captured) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.settleMs || 6000)
      );
    }

    if (!captured) {
      throw new Error("Could not capture session params from Instagram");
    }

    const params = {};

    for (const [key, value] of new URLSearchParams(captured)) {
      params[key] = value;
    }

    return params;
  } finally {
    try {
      if (page) {
        try {
          await page.close();
        } catch (_) {
          // Continue browser cleanup even if the page is already closed.
        }
      }
    } finally {
      await disposeBrowser(browser, external);
    }
  }
}

module.exports = {
  harvestSessionParams,
  findChromium,
  _createBrowser: createBrowser,
  _disposeBrowser: disposeBrowser
};
