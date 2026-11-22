const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH"
]);

const RATE_RE = /too many requests|too_many_requests|rate.?limit|please wait a few minutes/i;
const SUSPENDED_RE = /account (has been )?(suspended|disabled|banned|locked)|account_locked|has been (temporarily )?(suspended|disabled)/i;
const CHALLENGE_RE = /challenge_required|checkpoint_required|checkpoint|challenge/i;
const AUTH_RE = /login_required|require_login|not_logged_in|please log in/i;
const BLOCK_RE = /feedback_required|action_blocked|action blocked|automated behavior|automated_behavior|temporarily blocked|bot detected|bot_detected|unusual activity|suspicious activity|spam/i;
const TRANSIENT_RE = /timeout|timed out|socket hang up|network error|getaddrinfo/i;

const CODE_BY_KIND = {
  auth: "IG_SESSION_INVALID",
  challenge: "IG_CHALLENGE",
  suspended: "IG_SUSPENDED",
  blocked: "IG_BLOCKED",
  rate_limited: "IG_RATE_LIMITED"
};

function statusOf(err) {
  if (!err || typeof err !== "object") return null;
  const raw = err.response && err.response.status != null ? err.response.status : err.status;
  if (raw == null || raw === "") return null;
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
}

function locationOf(err) {
  const headers = err && err.response && err.response.headers;
  if (!headers) return "";
  return String(headers.location || headers.Location || "");
}

function textOf(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  const parts = [err.message, err.code];
  const data = err.response && err.response.data;
  if (data !== undefined && data !== null) {
    try {
      parts.push((typeof data === "string" ? data : JSON.stringify(data)).slice(0, 2000));
    } catch (_) {}
  }
  if (err.errors) {
    try {
      parts.push(JSON.stringify(err.errors).slice(0, 1000));
    } catch (_) {}
  }
  return parts.filter(Boolean).join(" ");
}

function classify(err) {
  const status = statusOf(err);
  const text = textOf(err);
  const location = locationOf(err);

  if (status === 429 || RATE_RE.test(text)) return { kind: "rate_limited", status };
  if (SUSPENDED_RE.test(text)) return { kind: "suspended", status };
  if (/challenge|checkpoint/i.test(location) || CHALLENGE_RE.test(text)) return { kind: "challenge", status };
  if ((status >= 300 && status < 400) || /maximum number of redirects/i.test(text)) return { kind: "auth", status };
  if (status === 401 || AUTH_RE.test(text)) return { kind: "auth", status };
  if (BLOCK_RE.test(text)) return { kind: "blocked", status };
  const code = err && typeof err === "object" ? err.code : null;
  if ((status && status >= 500) || TRANSIENT_CODES.has(code) || TRANSIENT_RE.test(text)) {
    return { kind: "transient", status };
  }
  return { kind: "unknown", status };
}

function inspectBody(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const failed =
    data.status === "fail" ||
    data.require_login === true ||
    Boolean(data.checkpoint_url) ||
    Boolean(data.challenge);
  if (!failed) return null;
  let message = String(data.message || data.error_type || data.error_title || "");
  if (!message) {
    if (data.require_login === true) message = "login_required";
    else if (data.checkpoint_url || data.challenge) message = "challenge_required";
    else message = "Instagram returned status=fail without an error message";
  }
  const info = classify({ message, response: { status: 200, data, headers: {} } });
  // An explicit failure envelope is still a failure when its message is
  // missing or unfamiliar. Preserve the unknown/transient classification so
  // callers can report it without mistaking the response for success.
  return { ...info, message };
}

function toIgError(err, info) {
  const error = err instanceof Error ? err : new Error(String(err));
  const kind = (info && info.kind) || "unknown";
  error.igKind = kind;
  if (info && info.status) error.igStatus = info.status;
  if (CODE_BY_KIND[kind]) error.code = CODE_BY_KIND[kind];
  return error;
}

function hasGraphQLPartialData(err) {
  const data = err && (
    err.graphQLData !== undefined
      ? err.graphQLData
      : err.response && err.response.data && err.response.data.data
  );
  if (!data || typeof data !== "object") return false;
  const values = Array.isArray(data) ? data : Object.values(data);
  return values.some((value) => value !== null && value !== undefined);
}

function retryAfterMs(err) {
  const headers = err && err.response && err.response.headers;
  const raw = headers && (headers["retry-after"] || headers["Retry-After"]);
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 30 * 60 * 1000);
  }
  const date = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(date) && date > Date.now()) {
    return Math.min(date - Date.now(), 30 * 60 * 1000);
  }
  return 0;
}

module.exports = { classify, inspectBody, toIgError, retryAfterMs, hasGraphQLPartialData };
