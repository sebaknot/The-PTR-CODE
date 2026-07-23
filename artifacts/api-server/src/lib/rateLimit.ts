import rateLimit from "express-rate-limit";

const json429 = { error: "Too many requests, please try again later." };

// Broad limit for the whole API surface — generous enough for normal app use,
// low enough to blunt scraping and abuse.
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: json429,
});

// Tight limit for requesting one-time codes — prevents SMS/email bombing.
export const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: json429,
});

// Tight limit for verifying codes — makes brute-forcing a 6-digit code infeasible
// (with a 10-minute code TTL, an attacker gets far too few guesses).
export const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: json429,
});

// Limit for federated sign-in attempts.
export const authProviderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: json429,
});
