import login, {
  AdaptiveRateLimiter,
  CircuitBreaker,
  IdempotencyCache,
  Scheduler,
  InstaClient,
  IncomingEvent,
  SendOptions,
  PartialSendError,
  utilities
} from "../index";

const limiter: AdaptiveRateLimiter = new login.AdaptiveRateLimiter({ globalMinDelayMs: 10 });
const breaker: CircuitBreaker = new login.CircuitBreaker({ failureThreshold: 3 });
const cache: IdempotencyCache = new login.IdempotencyCache({ ttlMs: 1000 });
const scheduler: Scheduler = new login.Scheduler({ enabled: false });
const namespacedScheduler: Scheduler = new utilities.Scheduler({ enabled: false });

void [limiter, breaker, cache, scheduler, namespacedScheduler];


declare const fcaClient: InstaClient;
void fcaClient.getThreadHistory("thread-1", (error, items) => {
  void error;
  void items;
});
void fcaClient.getThreadHistory("thread-1", 10, (error, items) => {
  void error;
  void items;
});
void fcaClient.getThreadHistory("thread-1", 10, Date.now(), (error, items) => {
  void error;
  void items;
});

declare const incomingEvent: IncomingEvent;
if (incomingEvent.type === "message_reply") {
  void incomingEvent.messageReply?.itemType;
}
if (incomingEvent.type === "event") {
  void incomingEvent.logMessageType;
}

void fcaClient.lastShareContactError;
void fcaClient.lastEditError;

const mediaOptions: SendOptions = {
  maxDownloadBytes: 20 * 1024 * 1024,
  downloadTimeoutMs: 45000
};
void fcaClient.sendPhotoFromUrl("thread-1", "https://cdn.example/photo.jpg", mediaOptions);

const partialSendError: PartialSendError = Object.assign(new Error("partial"), {
  partialSend: { captionSent: true, mediaSent: false }
});
void partialSendError.partialSend;
