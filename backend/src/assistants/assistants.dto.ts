import { IsArray, IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class CreateAssistantDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  description!: string;

  @IsString()
  status!: string;

  @IsString()
  systemPrompt!: string;

  @IsObject()
  model!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsObject()
  embedding!: Record<string, unknown>;

  @IsObject()
  rag!: Record<string, unknown>;

  @IsObject()
  widget!: Record<string, unknown>;

  @IsArray()
  @IsString({ each: true })
  knowledgeBaseIds!: string[];
}

export class UpdateAssistantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsObject()
  model?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsObject()
  embedding?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rag?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  widget?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeBaseIds?: string[];
}
