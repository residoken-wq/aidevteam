import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap";
import { loadConfig } from "./config";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp({ config });
  await app.listen(config.port, "0.0.0.0");
  new Logger("bootstrap").log(`api listening on port ${config.port}`);
}

main().catch((err: unknown) => {
  // Do not print stack traces with environment details in production logs.
  console.error("api failed to start:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
