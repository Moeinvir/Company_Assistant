import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * A visitor's message. This is an unauthenticated endpoint, so the payload is
 * validated tightly and the question length is bounded before it reaches the
 * model or the embedding call.
 */
export class WidgetQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  question!: string;

  /** Continue an existing widget conversation owned by the same assistant. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;
}
