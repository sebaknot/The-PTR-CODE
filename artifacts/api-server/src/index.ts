import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db";

const PORT = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  try {
    await runMigrations();
    logger.info("Database migrations applied");
  } catch (err) {
    logger.error({ err }, "Failed to run database migrations");
    process.exit(1);
  }

  app.listen(PORT, () => {
    logger.info(`Porter API server listening on port ${PORT}`);
  });
}

void start();
