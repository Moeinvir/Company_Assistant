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
import { EventsModule } from "./events/events.module";
import { PlaygroundModule } from "./playground/playground.module";
import { RagModule } from "./rag/rag.module";
import { WidgetModule } from "./widget/widget.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EventsModule,
    AuthModule,
    WorkspacesModule,
    AssistantsModule,
    RagModule,
    KnowledgeModule,
    ProvidersModule,
    AnalyticsModule,
    ConversationsModule,
    PlaygroundModule,
    WidgetModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
