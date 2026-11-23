"use strict";

const assert = require("node:assert/strict");

// Reporting-only summary for live diagnostics. This deliberately does not
// infer participant count from the users array.
function summarizeThreadDetail(detail) {
  const users = Array.isArray(detail?.users) ? detail.users : [];
  const connection = detail?.slide_messages || {};
  const edges = Array.isArray(connection.edges) ? connection.edges : [];

  return {
    usersRecords: users.length,
    viewerPresent: Boolean(detail?.viewer),
    participantsVerified: false,
    messagePreviewCount: edges.length,
    hasMoreMessages: connection.page_info?.has_next_page === true
  };
}

const sample = summarizeThreadDetail({
  users: [{ id: "user-1" }],
  viewer: { id: "viewer-1" },
  slide_messages: {
    edges: Array.from({ length: 20 }, (_, i) => ({ node: { id: String(i) } })),
    page_info: { has_next_page: true }
  }
});

assert.deepEqual(sample, {
  usersRecords: 1,
  viewerPresent: true,
  participantsVerified: false,
  messagePreviewCount: 20,
  hasMoreMessages: true
});

const withoutViewer = summarizeThreadDetail({
  users: [],
  slide_messages: { edges: [], page_info: { has_next_page: false } }
});

assert.deepEqual(withoutViewer, {
  usersRecords: 0,
  viewerPresent: false,
  participantsVerified: false,
  messagePreviewCount: 0,
  hasMoreMessages: false
});

process.stdout.write("thread-detail-report.test.js: 2 tests passed\\n");
