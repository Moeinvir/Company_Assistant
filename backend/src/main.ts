import "dotenv/config";
import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json as expressJson, urlencoded as expressUrlencoded } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(expressJson({ limit: "10mb" }));
  app.use(expressUrlencoded({ extended: true, limit: "10mb" }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",").map((origin) => origin.trim()) ?? false,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Some hosts/terminals export PORT=0 (or a non-numeric value), which tells
  // Node to bind a *random* free port. The browser then keeps calling the
  // default port and every request fails with "Failed to fetch", so only a
  // real, positive port wins.
  const configuredPort = Number(process.env.PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;

  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
