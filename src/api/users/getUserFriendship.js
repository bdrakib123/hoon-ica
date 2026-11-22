/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const createCallback = require("../../utils/createCallback");

function firstUsableId(...values) {
  const value = values.find((entry) => entry != null && String(entry).trim() !== "");
  return value == null ? null : String(value);
}

// fca.getUserFriendship(userID, callback) -> { id, blocking, isRestricted,
// isFollowedBy, follows }.
//
// Instagram's DM GraphQL user records carry a `friendship_status` for every
// participant ({ blocking, is_restricted, ... }). This exposes that state from
// data the client already learned, so it needs no extra request and cannot look
// like a dead session. Returns null when the user has not been observed.
module.exports = function (client) {
  return async function getUserFriendship(userID, callback) {
    const cb = createCallback(callback);
    const key = String(userID == null ? "" : userID).replace(/^@/, "");
    try {
      const learned = client.api && typeof client.api._learnedUser === "function"
        ? client.api._learnedUser(key)
        : null;
      if (!learned) {
        if (cb) await cb(null, null);
        return null;
      }
      const fs = learned.friendship_status;
      const resolvedID = firstUsableId(learned.id, learned.pk, key);
      const out = {
        id: resolvedID,
        userID: resolvedID,
        username: learned.username || null,
        blocking: typeof fs?.blocking === "boolean" ? fs.blocking : null,
        isRestricted: typeof fs?.is_restricted === "boolean" ? fs.is_restricted : null,
        isFollowedBy: typeof fs?.is_followed_by === "boolean" ? fs.is_followed_by : null,
        follows: typeof fs?.following === "boolean" ? fs.following : null,
        incomingRequest: typeof fs?.incoming_request === "boolean" ? fs.incoming_request : null,
        outgoingRequest: typeof fs?.outgoing_request === "boolean" ? fs.outgoing_request : null
      };
      if (cb) await cb(null, out);
      return out;
    } catch (error) {
      if (cb?.called) throw error;
      if (cb) await cb(error, null);
      return null;
    }
  };
};
