import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from "class-validator";

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
}

export class SetProviderKeyDto {
  @IsString()
  workspaceId!: string;

  @IsEnum(ProviderId)
  provider!: ProviderId;

  @IsString()
  @MinLength(1)
  apiKey!: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;
}

export class VerifyProviderKeyDto {
  @IsString()
  workspaceId!: string;

  @IsBoolean()
  ok!: boolean;

  @IsString()
  message!: string;
}
