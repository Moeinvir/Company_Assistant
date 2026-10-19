import { Global, Module } from "@nestjs/common";
import { EventsService } from "./events.service";

/**
 * Global so any feature service can publish workspace change notifications
 * without threading the bus through every module's imports.
 */
@Global()
@Module({
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
