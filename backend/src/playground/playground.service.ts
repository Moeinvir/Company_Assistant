import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RetrievalService, type QueryOverrides } from "../rag/retrieval.service";
import type { QueryResponse, RetrievalStrategy } from "../rag/rag.types";
import type { QueryDto, SearchDto } from "./playground.dto";

export interface SearchResponseBody {
  results: QueryResponse["retrieved"];
  latencyMs: number;
  strategy: RetrievalStrategy;
  scannedChunks: number;
  embeddingProvider: string;
  embeddingModel: string;
}

/**
 * The playground runs through the same retrieval service the widget does, so
 * "Test this assistant" measures the pipeline that will actually answer real
 * visitors — not a browser-side approximation of it.
 */
@Injectable()
export class PlaygroundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
  ) {}

  async query(userId: string, input: QueryDto): Promise<QueryResponse> {
    const assistant = await this.authorizedAssistant(userId, input.assistantId);
    const overrides: QueryOverrides = {
      topK: input.topKOverride,
      scoreThreshold: input.scoreThresholdOverride,
      temperature: input.temperatureOverride,
      strategy: input.strategyOverride,
    };

    const response = await this.retrieval.answer({
      assistant,
      question: input.question,
      history: input.history,
      overrides,
    });

    if (response.message.meta) {
      await this.retrieval.recordUsage(assistant, response.message.meta, "query", input.question);
    }
    return response;
  }

  async search(userId: string, input: SearchDto): Promise<SearchResponseBody> {
    const assistant = await this.authorizedAssistant(userId, input.assistantId);
    const outcome = await this.retrieval.retrieve(assistant, input.query, {
      topK: input.topK,
      strategy: input.strategy,
      scoreThreshold: 0,
    });
    return {
      results: outcome.results,
      latencyMs: outcome.latencyMs,
      strategy: input.strategy,
      scannedChunks: outcome.scanned,
      embeddingProvider: outcome.embeddingProvider,
      embeddingModel: outcome.embeddingModel,
    };
  }

  /**
   * Load an assistant and confirm the caller is a member of the workspace it
   * belongs to. A non-member gets a 404, not a 403: the existence of another
   * tenant's assistant is not something this endpoint should confirm.
   */
  private async authorizedAssistant(userId: string, assistantId: string) {
    const assistant = await this.retrieval.loadAssistant(assistantId);
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: assistant.workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new NotFoundException("Assistant not found");
    return assistant;
  }
}
