/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const fs = require("fs");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

// Instagram's web API requires the browser-session params (__dyn, __csr, __hs,
// __hsi, __s, __hsdp, __sjsp, __hblp, __spin_r, __spin_b, __spin_t, fb_dtsg,
// jazoest, lsd). They are produced by the web JS bundle, but they are
// session-scoped rather than per-request, so a single real browser page load is
// enough: we capture the app's own PolarisDirectInboxQuery request and reuse its
// params for every later API call (GraphQL, upload) from plain HTTP.
//
// Chromium is driven with puppeteer-core against a system browser, so no
// browser download is required.

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

async function harvestSessionParams(cookieJar, options = {}) {
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch (_) {
    throw new Error("puppeteer-core is not installed. Install a Node-compatible version separately to use browser session harvesting, or pass pre-harvested sessionParams.");
  }

  const executablePath = options.executablePath || findChromium();
  if (!executablePath) throw new Error("No Chromium/Chrome binary found for session harvesting");

  const cookies = Object.entries(cookieJar).map(([name, value]) => ({
    name,
    value,
    domain: ".instagram.com",
    path: "/",
    secure: true,
    httpOnly: false
  }));

  const browser = await puppeteer.launch({
    executablePath,
    headless: options.headless === undefined ? "new" : options.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", ...(options.args || [])]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(options.userAgent || DEFAULT_UA);
    await browser.setCookie(...cookies);

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
      await new Promise((resolve) => setTimeout(resolve, options.settleMs || 6000));
    }
    if (!captured) throw new Error("Could not capture session params from Instagram");

    const params = {};
    for (const [k, v] of new URLSearchParams(captured)) params[k] = v;
    return params;
  } finally {
    await browser.close();
  }
}

module.exports = { harvestSessionParams, findChromium };
