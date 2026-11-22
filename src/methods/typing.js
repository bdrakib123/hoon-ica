/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const { EP } = require("../constants");
const { classify } = require("../utils/errors");

const FALLBACK_PATHS = [
  (t) => `https://www.instagram.com/api/v1/direct_v2/threads/${t}/indicate_activity/`,
  (t) => `https://www.instagram.com/api/v1/direct_v2/typing/`
];

class TypingMethods {
  constructor(http) {
    this.http = http;
  }

  async _try(threadID, isActive) {
    const form = { thread_id: threadID, activity_status: isActive ? "1" : "0" };

    for (const build of [() => EP.TYPING(threadID), ...FALLBACK_PATHS.map((f) => () => f(threadID))]) {
      try {
        await this.http.postForm(build(), form);
        return true;
      } catch (error) {
        // Only try another legacy route for an endpoint-specific/unknown
        // rejection. Repeating typing writes after auth, challenge, rate-limit,
        // or transport failures adds requests without improving delivery.
        if (classify(error).kind !== "unknown") return false;
      }
    }
    return false;
  }

  async start(threadID) {
    return this._try(threadID, true);
  }

  async stop(threadID) {
    return this._try(threadID, false);
  }
}

module.exports = TypingMethods;
