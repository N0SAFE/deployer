interface EnumLike<T extends string> {
  options: readonly T[] | T[]
}

export function zodEnumToPgEnumValues<T extends string>(schema: EnumLike<T>): [T, ...T[]] {
  const values = [...schema.options]
  if (values.length === 0) {
    throw new Error('zodEnumToPgEnumValues requires at least one enum value')
  }

  return values as [T, ...T[]]
}