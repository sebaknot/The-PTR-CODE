import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiRateLimiter } from "./lib/rateLimit";
import { WebhookHandlers } from "./webhookHandlers";

const app: Express = express();

// Trust the platform proxy (Railway/Vercel) so client IPs are accurate for rate limiting.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Security headers. API-only service, so a strict, minimal policy is appropriate.
app.use(
  helmet({
    contentSecurityPolicy: false, // no HTML is served from the API
    crossOriginResourcePolicy: { policy: "cross-origin" }, // photos are served to the app
  }),
);

// CORS: restrict to an explicit allowlist in production; reflect any origin in dev.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients (native app, curl) send no Origin — always allow.
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

// Stripe webhook needs the raw body and must be registered BEFORE express.json().
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: unknown) {
      logger.error({ err: error }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Global rate limit across the whole API surface.
app.use("/api", apiRateLimiter);

app.use("/api", router);

export default app;
