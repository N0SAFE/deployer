import type { z } from "zod/v4";

/**
 * Validate params against a Zod schema.
 * Throws if validation fails.
 */
export function validateParams<T extends z.ZodType>(
  params: unknown,
  schema: T,
): z.infer<T> {
  return schema.parse(params);
}

/**
 * Safely validate params, returning a result object.
 */
export function safeValidateParams<T extends z.ZodType>(
  params: unknown,
  schema: T,
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(params);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
