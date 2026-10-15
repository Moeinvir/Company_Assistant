import "dotenv/config";
import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json as expressJson, urlencoded as expressUrlencoded } from "express";
import { AppModule } from "./app.module";
import { parseCorsOrigins } from "./cors";

/** Fallback used whenever the configured port is missing or nonsensical. */
const DEFAULT_PORT = 3000;

async function bootstrap() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(expressJson({ limit: "10mb" }));
  app.use(expressUrlencoded({ extended: true, limit: "10mb" }));
  const allowedOrigins = parseCorsOrigins(process.env.WEB_ORIGIN);
  if (allowedOrigins) Logger.log(`CORS enabled for ${allowedOrigins.join(", ")}`, "Bootstrap");
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // The host environment wins over `.env`: dotenv never overrides a variable
  // that is already exported, and some launchers export PORT=0. Node would
  // then bind a *random* free port while the browser keeps calling the port it
  // was built with, so every request fails with "Failed to fetch". Only a
  // real, positive port is honored, and `API_PORT` always wins so the port can
  // be pinned in `.env` even when the host exports PORT.
  const rawPort = process.env.API_PORT ?? process.env.PORT;
  const parsedPort = Number(rawPort);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
  if (rawPort !== undefined && parsedPort !== port) {
    Logger.warn(
      `Ignoring defined port ${JSON.stringify(rawPort)} (not a positive integer); using ${port}. ` +
        "Set API_PORT in backend/.env to pin a port, and keep VITE_PYRE_API_URL on the same one.",
      "Bootstrap",
    );
  }

  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
