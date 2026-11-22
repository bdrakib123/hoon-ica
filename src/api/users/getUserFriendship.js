/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const createCallback = require("../../utils/createCallback");

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
        if (cb) cb(null, null);
        return null;
      }
      const fs = learned.friendship_status;
      const out = {
        id: String(learned.id || learned.pk || key),
        userID: String(learned.id || learned.pk || key),
        username: learned.username || null,
        blocking: fs ? fs.blocking === true : null,
        isRestricted: fs ? fs.is_restricted === true : null,
        isFollowedBy: fs ? fs.is_followed_by === true : null,
        follows: fs ? fs.following === true : null,
        incomingRequest: fs ? fs.incoming_request === true : null,
        outgoingRequest: fs ? fs.outgoing_request === true : null
      };
      if (cb) cb(null, out);
      return out;
    } catch (error) {
      if (cb?.called) throw error;
      if (cb) cb(error, null);
      return null;
    }
  };
};
