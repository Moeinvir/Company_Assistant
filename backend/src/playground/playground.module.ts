import { Module } from "@nestjs/common";
import { SecurityModule } from "../auth/security.module";
import { RagModule } from "../rag/rag.module";
import { PlaygroundController } from "./playground.controller";
import { PlaygroundService } from "./playground.service";

@Module({
  imports: [SecurityModule, RagModule],
  controllers: [PlaygroundController],
  providers: [PlaygroundService],
})
export class PlaygroundModule {}
