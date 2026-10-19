import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export enum ProviderId {
  openai = "openai",
  anthropic = "anthropic",
  google = "google",
  mistral = "mistral",
  groq = "groq",
  openrouter = "openrouter",
  ollama = "ollama",
  cohere = "cohere",
  voyage = "voyage",
  local = "local",
  /** Any self-hosted, OpenAI-compatible gateway the workspace configures. */
  custom = "custom",
}

export class SetProviderKeyDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsEnum(ProviderId)
  provider!: ProviderId;

  /**
   * The secret. Optional so keyless runtimes (Ollama, the local embedder) can
   * be configured with just a base URL; providers that need a key are rejected
   * with an explicit message instead of a generic validation error.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;
}

export class VerifyProviderKeyDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsBoolean()
  ok!: boolean;

  @IsString()
  @MaxLength(1000)
  message!: string;
}

/**
 * A connection check. The key may be supplied directly so the UI can test a key
 * that has not been stored yet; when it is omitted the stored credential is
 * used. Either way the key never leaves the server after this request.
 */
export class ProviderCheckDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;
}

export class ChatMessageDto {
  @IsIn(["system", "user", "assistant"])
  role!: "system" | "user" | "assistant";

  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  content!: string;
}

export class ProviderChatRequestDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  /** Optional endpoint override; falls back to the stored base URL. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32_000)
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  topP?: number;
}
