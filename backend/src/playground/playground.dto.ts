import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
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

const STRATEGIES = ["hybrid", "vector", "keyword"] as const;

export class HistoryMessageDto {
  @IsIn(["system", "user", "assistant"])
  role!: "system" | "user" | "assistant";

  @IsString()
  @MaxLength(200_000)
  content!: string;
}

/**
 * Mirrors `QueryRequest` in the web client. Every override is optional: the
 * saved assistant configuration is the default, and the playground only sends
 * the knobs the operator moved.
 */
export class QueryDto {
  @IsString()
  @MinLength(1)
  assistantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  question!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HistoryMessageDto)
  history?: HistoryMessageDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topKOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  scoreThresholdOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperatureOverride?: number;

  @IsOptional()
  @IsIn(STRATEGIES)
  strategyOverride?: (typeof STRATEGIES)[number];
}

/** Mirrors `SearchRequest`: retrieval only, no model call. */
export class SearchDto {
  @IsString()
  @MinLength(1)
  assistantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  query!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  topK!: number;

  @IsIn(STRATEGIES)
  strategy!: (typeof STRATEGIES)[number];
}
