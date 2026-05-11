import type { ZodType } from "zod";

export interface MeshOperation<
  TRequestSchema extends ZodType,
  TResponseSchema extends ZodType,
> {
  readonly requestSchema: TRequestSchema;
  readonly responseSchema: TResponseSchema;
}

export function meshOperation<
  TRequestSchema extends ZodType,
  TResponseSchema extends ZodType,
>(
  requestSchema: TRequestSchema,
  responseSchema: TResponseSchema,
): MeshOperation<TRequestSchema, TResponseSchema> {
    return {
        requestSchema,
        responseSchema,
    };
}
