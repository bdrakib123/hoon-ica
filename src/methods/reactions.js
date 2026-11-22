/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const { DOC_ID } = require("../constants");
const { globalAntiSuspension } = require("../utils/antiSuspension");

class ReactionMethods {
  constructor(http) {
    this.http = http;
  }

  // Confirmed from the live web bundle (CometDirectPageWeb): reactions go
  // through the IGDirectReactionMutation Relay operation with a flat `input`.
  // The legacy /api/v1/direct_v2/.../reaction/ REST endpoint now 404s.
  async _mutate(threadID, itemID, reactionStatus, emoji) {
    return this.http.postGraphQL(
      "IGDirectReactionMutation",
      DOC_ID.REACTION_SEND,
      {
        input: {
          emoji: emoji || "",
          item_id: String(itemID),
          message_id: String(itemID),
          reaction_status: reactionStatus,
          thread_id: String(threadID)
        }
      },
      `https://www.instagram.com/direct/t/${threadID}/`,
      { throwOnError: true }
    );
  }

  async send(threadID, itemID, emoji) {
    await globalAntiSuspension.waitForTurn(threadID);
    try {
      return await this._mutate(threadID, itemID, "created", emoji || "❤️");
    } catch (error) {
      globalAntiSuspension.noteSendError(error);
      throw error;
    }
  }

  async remove(threadID, itemID) {
    await globalAntiSuspension.waitForTurn(threadID);
    try {
      return await this._mutate(threadID, itemID, "deleted", "");
    } catch (error) {
      globalAntiSuspension.noteSendError(error);
      throw error;
    }
  }
}

module.exports = ReactionMethods;
