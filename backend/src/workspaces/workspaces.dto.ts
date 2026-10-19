import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { WorkspacePlan } from "@prisma/client";

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsEnum(WorkspacePlan)
  plan?: WorkspacePlan;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(WorkspacePlan)
  plan?: WorkspacePlan;
}
