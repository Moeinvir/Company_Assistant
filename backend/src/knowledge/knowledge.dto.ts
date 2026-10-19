import { Type } from "class-transformer";
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CreateKnowledgeBaseDto {
  @IsString()
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  description!: string;
}

export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AddTextDocumentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MaxLength(5_000_000)
  content!: string;

  @IsObject()
  embedding!: Record<string, unknown>;
}

class FilePayloadDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  size!: number;

  @IsString()
  type!: string;

  @IsString()
  @MaxLength(5_000_000)
  text!: string;
}

export class AddFileDocumentDto {
  @ValidateNested()
  @Type(() => FilePayloadDto)
  file!: FilePayloadDto;

  @IsObject()
  embedding!: Record<string, unknown>;
}

export class AddUrlDocumentDto {
  @IsString()
  @MinLength(1)
  url!: string;

  @IsObject()
  embedding!: Record<string, unknown>;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000_000)
  content?: string;

  @IsOptional()
  @IsObject()
  embedding?: Record<string, unknown>;
}
