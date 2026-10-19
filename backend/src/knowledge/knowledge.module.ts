import { Module } from "@nestjs/common";
import { SecurityModule } from "../auth/security.module";
import { RagModule } from "../rag/rag.module";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";

@Module({
  imports: [SecurityModule, RagModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
