import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoginLimiter } from "./loginLimiter";

test("blocks after max failures, then allows again when the window passes", () => {
  let clock = 0;
  const limiter = createLoginLimiter({ maxFailures: 3, windowMs: 60_000, now: () => clock });
  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.retryAfter("k"), 0);
    limiter.recordFailure("k");
    clock += 1_000;
  }
  assert.equal(limiter.retryAfter("k"), 57); // oldest failure (t=0) expires at 60s; now is 3s
  assert.equal(limiter.retryAfter("other"), 0, "keys are independent");
  clock = 60_001;
  assert.equal(limiter.retryAfter("k"), 0);
});

test("a successful login resets the count", () => {
  const limiter = createLoginLimiter({ maxFailures: 2, now: () => 0 });
  limiter.recordFailure("k");
  limiter.reset("k");
  limiter.recordFailure("k");
  assert.equal(limiter.retryAfter("k"), 0);
});
