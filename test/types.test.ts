import login, {
  AdaptiveRateLimiter,
  CircuitBreaker,
  IdempotencyCache,
  Scheduler,
  utilities
} from "../index";

const limiter: AdaptiveRateLimiter = new login.AdaptiveRateLimiter({ globalMinDelayMs: 10 });
const breaker: CircuitBreaker = new login.CircuitBreaker({ failureThreshold: 3 });
const cache: IdempotencyCache = new login.IdempotencyCache({ ttlMs: 1000 });
const scheduler: Scheduler = new login.Scheduler({ enabled: false });
const namespacedScheduler: Scheduler = new utilities.Scheduler({ enabled: false });

void [limiter, breaker, cache, scheduler, namespacedScheduler];
