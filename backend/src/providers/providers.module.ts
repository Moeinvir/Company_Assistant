import { SecurityModule } from "../auth/security.module";

import { Module } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";

@Module({
  imports: [SecurityModule],
  controllers: [ProvidersController],
  providers: [ProvidersService],
  // The server-side RAG services resolve workspace credentials and run
  // completions through this service, so they never re-implement key handling.
  exports: [ProvidersService],
})
export class ProvidersModule {}
