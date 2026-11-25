import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

/** Create the HTTP app with baseline hardening. Shared by main.ts and tests. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });
  app.disable("x-powered-by");
  app.enableShutdownHooks();
  return app;
}
