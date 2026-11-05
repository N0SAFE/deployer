/**
 * The filtering, sorting and paging every docker list endpoint shares. Pure functions over the contract's
 * `{ filter: { key: { operator, value } }, sortBy, limit, offset }` input, tested without an engine.
 */
export type ParsedFilterEntry = { operator: string; value: unknown }

export type ContractFilterKeys<TInput> = Extract<
    keyof NonNullable<
        TInput extends { filter?: infer TFilter } ? TFilter : never
    >,
    string
>

export type PaginatedListInput = {
    limit: number
    offset: number
}

export type SortableListInput = {
    sortBy?: string
    sortDirection?: 'asc' | 'desc'
}

export function getFilterEntry<
    TInput extends { filter?: unknown },
    TKey extends ContractFilterKeys<TInput>,
>(input: TInput, key: TKey): ParsedFilterEntry | undefined {
    const filter = input.filter
    if (!filter || typeof filter !== 'object') {
        return undefined
    }

    const rawEntry = Reflect.get(filter, key)
    if (!rawEntry || typeof rawEntry !== 'object') {
        return undefined
    }

    const operator = (rawEntry as { operator?: unknown }).operator
    if (typeof operator !== 'string') {
        return undefined
    }

    return {
        operator,
        value: (rawEntry as { value?: unknown }).value,
    }
}

export function matchString(
    value: string,
    entry: ParsedFilterEntry | undefined
): boolean {
    if (!entry) return true
    const target = String(entry.value ?? '')

    switch (entry.operator) {
        case 'eq':
            return value === target
        case 'like':
        case 'ilike':
            return value.toLowerCase().includes(target.toLowerCase())
        default:
            return true
    }
}

export function matchEq(
    value: string | boolean,
    entry: ParsedFilterEntry | undefined
): boolean {
    if (!entry) return true
    if (entry.operator !== 'eq') return true

    if (typeof value === 'boolean') {
        const expected =
            typeof entry.value === 'boolean'
                ? entry.value
                : String(entry.value).toLowerCase() === 'true'
        return value === expected
    }

    return value === String(entry.value ?? '')
}

export function matchNullableStringEq(
    value: string | null,
    entry: ParsedFilterEntry | undefined
): boolean {
    if (!entry) return true
    if (entry.operator !== 'eq') return true
    return value === String(entry.value ?? '')
}

export function sortItems<T>(
    items: T[],
    input: SortableListInput,
    getComparableValue: (item: T, sortBy: string) => string | number
): T[] {
    const sortBy = input.sortBy ?? 'updatedAt'
    const direction = input.sortDirection === 'asc' ? 1 : -1

    return [...items].sort((a, b) => {
        const av = getComparableValue(a, sortBy)
        const bv = getComparableValue(b, sortBy)

        if (av < bv) return -1 * direction
        if (av > bv) return 1 * direction
        return 0
    })
}

export function paginate<T>(items: T[], input: PaginatedListInput) {
    const total = items.length
    const data = items.slice(input.offset, input.offset + input.limit)
    return {
        data,
        meta: {
            total,
            limit: input.limit,
            offset: input.offset,
            hasMore: input.offset + input.limit < total,
        },
    }
}
