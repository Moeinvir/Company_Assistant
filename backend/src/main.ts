import "dotenv/config";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
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

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
