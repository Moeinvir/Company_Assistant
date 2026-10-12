import { SecurityModule } from "../auth/security.module";

import { Module } from "@nestjs/common";
import { AssistantsController } from "./assistants.controller";
import { AssistantsService } from "./assistants.service";

@Module({
  imports: [SecurityModule],
  controllers: [AssistantsController],
  providers: [AssistantsService],
})
export class AssistantsModule {}
