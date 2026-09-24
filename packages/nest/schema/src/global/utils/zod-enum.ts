import { AppError } from "@repo/errors";
interface EnumLike<T extends string> {
  options: readonly T[] | T[]
}

export function zodEnumToPgEnumValues<T extends string>(schema: EnumLike<T>): [T, ...T[]] {
  const values = [...schema.options]
  if (values.length === 0) {
    throw new AppError('zodEnumToPgEnumValues requires at least one enum value', 'INTERNAL_ERROR')
  }

  return values as [T, ...T[]]
}