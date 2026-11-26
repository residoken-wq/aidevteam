import { Logger } from "@nestjs/common";
import { redact } from "@aidevteam/contracts";
import { createApp } from "./bootstrap";
import { loadConfig } from "./config";

// Last line of defence: never let Node print raw error objects (they can contain connection details);
// log a redacted message and exit so the container restarts cleanly.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (err: unknown) => {
    console.error(`api ${event}:`, err instanceof Error ? redact(err.message) : "unknown error");
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp({ config });
  await app.listen(config.port, "0.0.0.0");
  new Logger("bootstrap").log(`api listening on port ${config.port}`);
}

main().catch((err: unknown) => {
  // Do not print stack traces with environment details in production logs.
  console.error("api failed to start:", err instanceof Error ? redact(err.message) : "unknown error");
  process.exit(1);
});
