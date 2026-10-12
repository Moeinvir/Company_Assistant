import { Module } from "@nestjs/common";
import { SecurityModule } from "../auth/security.module";
import { AnalyticsController } from "./analytics.controller";

@Module({
  imports: [SecurityModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
