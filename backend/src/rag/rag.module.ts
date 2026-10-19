import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { IngestionService } from "./ingestion.service";
import { RetrievalService } from "./retrieval.service";

/**
 * The retrieval-augmented generation half of the platform: indexing documents
 * into searchable passages, and answering questions from them.
 *
 * It owns no controller of its own — the knowledge module triggers indexing,
 * and the playground and widget modules expose querying — which keeps the
 * pipeline in one place instead of re-implemented per surface.
 */
@Module({
  imports: [ProvidersModule],
  providers: [IngestionService, RetrievalService],
  exports: [IngestionService, RetrievalService],
})
export class RagModule {}
