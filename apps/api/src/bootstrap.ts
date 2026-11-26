import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule, type AppOptions } from "./app.module";

/** Create the HTTP app with baseline hardening. Shared by main.ts and tests. */
export async function createApp(options: AppOptions): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(options), { logger: ["error", "warn", "log"] });
  app.disable("x-powered-by");
  // Only listed proxies (e.g. the NPM server) may supply X-Forwarded-*; default trusts nobody.
  app.set("trust proxy", options.config.trustedProxies.length ? options.config.trustedProxies : false);
  app.enableShutdownHooks();
  return app;
}
