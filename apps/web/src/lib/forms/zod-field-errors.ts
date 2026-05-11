import type { ZodError } from 'zod'

export function zodFieldErrors<T extends Record<string, unknown>>(
  error: ZodError<T>,
): Partial<Record<keyof T, string>> {
  const fieldErrors: Partial<Record<keyof T, string>> = {}

  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key !== 'string') {
      continue
    }

    const typedKey = key as keyof T
    if (!fieldErrors[typedKey]) {
      fieldErrors[typedKey] = issue.message
    }
  }

  return fieldErrors
}
