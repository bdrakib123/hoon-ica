/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getThreadInfo(threadID, callback) - Instagram thread detail reshaped into
// the fca thread-info object commands expect. Commands iterate `userInfo` and
// `.some()`/ `.find()` `adminIDs`, so both are arrays here (GoatBot-Pro shape:
// userInfo [{ id, name, firstName, gender }], adminIDs [{ id }]).
module.exports = function (client) {
  return async function getThreadInfo(threadID, callback) {
    const cb = typeof callback === "function" ? callback : null;
    try {
      const thread = await client.api.getThreadInfo(String(threadID));
      client._learnThreads(thread);
      const users = (thread?.users || []).slice();
      const viewer = thread?.viewer;
      // The thread-detail query lists only *other* participants; re-add the
      // viewer so participantIDs/name lookups are complete.
      const hasViewer = viewer && users.some((u) => String(u.id || u.pk) === String(viewer.id));
      if (viewer && !hasViewer) {
        users.unshift({
          id: viewer.id, pk: viewer.id, username: viewer.username,
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
      const adminIDs = (thread?.admin_user_ids || [])
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
      if (cb) cb(null, info);
      return info;
    } catch (error) {
      if (cb) cb(error, null);
      return null;
    }
  };
};
