/**
 * `Ada Lovelace` / `ada@example.com` → `AL`.
 *
 * Pure display helper. Blank entries and extra whitespace are ignored
 * wholesale, so callers can pass every candidate they have without
 * pre-cleaning them.
 *
 * Splitting accepts name *and* email punctuation (`ada.lovelace@example.com` →
 * `AL`), which keeps one rule for both instead of a name path plus a
 * special-cased email path. A one-word candidate still yields one letter.
 */
export function getInitials(...candidates: string[]): string {
    for (const candidate of candidates) {
        const parts = candidate
            .trim()
            .split(/[\s._@-]+/)
            .filter(Boolean)
        const initials = `${parts.at(0)?.at(0) ?? ''}${parts.at(1)?.at(0) ?? ''}`
        if (initials) {
            return initials.toUpperCase()
        }
    }
    return '?'
}
