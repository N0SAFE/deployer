/**
 * ANSI colors for CLI output.
 *
 * The builder is a user-facing dev tool; its progress lines are the product.
 * Kept dependency-free (no chalk/kleur) because every consuming package
 * executes this CLI from source.
 */
export const c = {
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}
