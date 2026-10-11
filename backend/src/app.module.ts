import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AssistantsModule } from "./assistants/assistants.module";
import { AuthModule } from "./auth/auth.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { PrismaModule } from "./prisma/prisma.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { HealthController } from "./health.controller";
import { ProvidersModule } from "./providers/providers.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { ConversationsModule } from "./conversations/conversations.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    WorkspacesModule,
    AssistantsModule,
    KnowledgeModule,
    ProvidersModule,
    AnalyticsModule,
    ConversationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
