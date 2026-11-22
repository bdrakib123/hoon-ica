/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const createCallback = require("../../utils/createCallback");

// fca.getThreadInfo(threadID, callback) - Instagram thread detail reshaped into
// the fca thread-info object commands expect. Commands iterate `userInfo` and
// `.some()`/ `.find()` `adminIDs`, so both are arrays here (GoatBot-Pro shape:
// userInfo [{ id, name, firstName, gender }], adminIDs [{ id }]).
module.exports = function (client) {
  return async function getThreadInfo(threadID, callback) {
    const cb = createCallback(callback);
    try {
      const thread = await client.api.getThreadInfo(String(threadID));
      client._learnThreads(thread);
      const users = (Array.isArray(thread?.users) ? thread.users : []).filter((u) => u && typeof u === "object");
      const viewer = thread?.viewer;
      const viewerID = viewer && (viewer.id || viewer.pk);
      // The thread-detail query lists only *other* participants; re-add the
      // viewer so participantIDs/name lookups are complete. Some response
      // shapes expose pk rather than id, so normalize both before comparing.
      const hasViewer = viewerID != null && users.some((u) => String(u.id || u.pk) === String(viewerID));
      if (viewer && viewerID != null && !hasViewer) {
        users.unshift({
          id: viewerID, pk: viewerID, username: viewer.username,
          interop_messaging_user_fbid: viewer.interop_messaging_user_fbid,
          profile_pic_url: viewer.profile_pic_url
        });
      }
      const userInfo = users.map((u) => ({
        id: String(u.pk || u.id),
        name: u.full_name || u.username || String(u.pk || u.id),
        firstName: (u.full_name || u.username || "").trim().split(/\s+/)[0] || "",
        username: u.username || null,
        gender: u.gender === undefined ? 0 : u.gender,
        type: "User",
        profileUrl: u.profile_pic_url || null,
        thumbSrc: u.profile_pic_url || null
      }));
      const userIds = new Set(userInfo.map((u) => u.id));
      const adminIDs = (Array.isArray(thread?.admin_user_ids) ? thread.admin_user_ids : [])
        .map(String)
        .filter((id) => userIds.has(id))
        .map((id) => ({ id }));
      const otherParticipant = users.find((u) =>
        !viewer || String(u.id || u.pk) !== String(viewer.id)
      );
      const info = {
        threadID: String(threadID),
        threadName: thread?.thread_title || otherParticipant?.username || users[0]?.username || null,
        participantIDs: userInfo.map((u) => u.id),
        userInfo,
        adminIDs,
        members: userInfo,
        nicknames: thread?.nicknames || {},
        isGroup: typeof thread?.is_group === "boolean" ? thread.is_group : users.length > 2,
        messageCount: thread?.slide_messages?.edges?.length ?? thread?.items?.length ?? 0,
        emoji: null,
        color: null
      };
      if (cb) await cb(null, info);
      return info;
    } catch (error) {
      if (cb?.called) throw error;
      if (cb) await cb(error, null);
      return null;
    }
  };
};
