import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import {
  AddFileDocumentDto,
  AddTextDocumentDto,
  AddUrlDocumentDto,
  CreateKnowledgeBaseDto,
  UpdateDocumentDto,
  UpdateKnowledgeBaseDto,
} from "./knowledge.dto";
import { KnowledgeService } from "./knowledge.service";

@Controller()
@UseGuards(AuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get("knowledge-bases")
  list(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
  ) {
    return this.knowledge.list(auth.userId, workspaceId);
  }

  @Post("knowledge-bases")
  create(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Body() input: CreateKnowledgeBaseDto,
  ) {
    return this.knowledge.create(auth.userId, input.workspaceId, input);
  }

  @Patch("knowledge-bases/:knowledgeBaseId")
  update(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Body() patch: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledge.update(auth.userId, knowledgeBaseId, patch);
  }

  @Delete("knowledge-bases/:knowledgeBaseId")
  remove(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
  ) {
    return this.knowledge.remove(auth.userId, knowledgeBaseId);
  }

  @Get("knowledge-bases/:knowledgeBaseId/documents")
  documents(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
  ) {
    return this.knowledge.documents(auth.userId, knowledgeBaseId);
  }

  @Post("knowledge-bases/:knowledgeBaseId/documents/text")
  addText(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Body() input: AddTextDocumentDto,
  ) {
    return this.knowledge.addText(auth.userId, knowledgeBaseId, input);
  }

  @Post("knowledge-bases/:knowledgeBaseId/documents/file")
  addFile(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Body() input: AddFileDocumentDto,
  ) {
    return this.knowledge.addFile(auth.userId, knowledgeBaseId, input);
  }

  @Post("knowledge-bases/:knowledgeBaseId/documents/url")
  addUrl(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Body() input: AddUrlDocumentDto,
  ) {
    return this.knowledge.addUrl(auth.userId, knowledgeBaseId, input);
  }

  @Patch("documents/:documentId")
  updateDocument(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("documentId") documentId: string,
    @Body() patch: UpdateDocumentDto,
  ) {
    return this.knowledge.updateDocument(auth.userId, documentId, patch);
  }

  @Get("documents/:documentId/content")
  content(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("documentId") documentId: string,
  ) {
    return this.knowledge.content(auth.userId, documentId);
  }

  @Delete("documents/:documentId")
  removeDocument(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("documentId") documentId: string,
  ) {
    return this.knowledge.removeDocument(auth.userId, documentId);
  }

  @Delete("knowledge-bases/:knowledgeBaseId/documents")
  removeAllDocuments(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
  ) {
    return this.knowledge.removeAllDocuments(auth.userId, knowledgeBaseId);
  }

  @Post("knowledge-bases/:knowledgeBaseId/reindex")
  reindex(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Body() embedding: Record<string, unknown>,
  ) {
    return this.knowledge.reindex(auth.userId, knowledgeBaseId, embedding);
  }
}
