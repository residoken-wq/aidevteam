import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap";
import { parsePort } from "./config";

async function main(): Promise<void> {
  const port = parsePort(process.env.PORT);
  const app = await createApp();
  await app.listen(port, "0.0.0.0");
  new Logger("bootstrap").log(`api listening on port ${port}`);
}

main().catch((err: unknown) => {
  // Do not print stack traces with environment details in production logs.
  console.error("api failed to start:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
