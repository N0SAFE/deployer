import type { z } from 'zod/v4'

/** First validation message per field, from a zod parse — `{}` when the values are valid. */
export function fieldErrors<K extends string>(schema: z.ZodType, values: Record<K, string>): Partial<Record<K, string>> {
  const result = schema.safeParse(values)
  if (result.success) return {}
  const errors: Partial<Record<K, string>> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) errors[key as K] = issue.message
  }
  return errors
}
