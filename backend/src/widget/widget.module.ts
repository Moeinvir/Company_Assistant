import { Module } from "@nestjs/common";
import { RagModule } from "../rag/rag.module";
import { WidgetController } from "./widget.controller";
import { WidgetService } from "./widget.service";

@Module({
  imports: [RagModule],
  controllers: [WidgetController],
  providers: [WidgetService],
})
export class WidgetModule {}
