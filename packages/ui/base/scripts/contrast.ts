/**
 * WCAG contrast audit for the design tokens in `src/styles/globals.css`.
 *
 *   bun scripts/contrast.ts          # prints a table, exits 1 on any failure
 *
 * The same checks run in `__tests__/styles/contrast.test.ts`, so a token edit that
 * drops a pair below its threshold fails CI instead of shipping faint text.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export type Rgb = [number, number, number]

/** Parse `oklch(L C H)` (L as 0-1 or %, optional `/ alpha` ignored) to linear-free sRGB 0-1. */
export function oklchToSrgb(input: string): Rgb {
    const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(input)
    if (!m) throw new Error(`Not an oklch color: ${input}`)
    const L = Number(m[1]) / (m[2] ? 100 : 1)
    const C = Number(m[3])
    const h = (Number(m[4]) * Math.PI) / 180
    const a = C * Math.cos(h)
    const b = C * Math.sin(h)
    const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const lin = [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ]
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    // Return LINEAR rgb (already what luminance needs); gamut-clipped.
    return lin.map(clamp) as Rgb
}

export function luminance(linear: Rgb): number {
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function contrastRatio(a: Rgb, b: Rgb): number {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Composite `fg` at `alpha` over `bg` (both linear rgb). Close enough to sRGB blending for an audit. */
export function mix(fg: Rgb, bg: Rgb, alpha: number): Rgb {
    return fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb
}

export type Theme = 'light' | 'dark'
export type Tokens = Record<string, string>

/** Pull `--name: value;` declarations out of the `:root` (light) and `.dark` blocks. */
export function readTokens(css: string): Record<Theme, Tokens> {
    const block = (selector: RegExp): Tokens => {
        const m = selector.exec(css)
        if (!m) throw new Error(`Block not found: ${selector}`)
        const tokens: Tokens = {}
        for (const d of m[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[d[1]!] = d[2]!.trim()
        return tokens
    }
    return {
        light: block(/(?:^|\n):root\s*\{([\s\S]*?)\n\}/),
        dark: block(/(?:^|\n)\.dark\s*\{([\s\S]*?)\n\}/),
    }
}

export interface Check {
    name: string
    fg: string
    bg: string
    /** Alpha of the tint when `bg` is a status tint over `over`. */
    tint?: { token: string; alpha: number; over: string }
    min: number
}

const STATUSES = ['live', 'pending', 'danger', 'busy', 'idle'] as const

export const CHECKS: Check[] = [
    { name: 'body text', fg: '--foreground', bg: '--background', min: 7 },
    { name: 'card text', fg: '--card-foreground', bg: '--card', min: 7 },
    { name: 'muted text on background', fg: '--muted-foreground', bg: '--background', min: 4.5 },
    { name: 'muted text on card', fg: '--muted-foreground', bg: '--card', min: 4.5 },
    { name: 'muted text on muted surface', fg: '--muted-foreground', bg: '--muted', min: 4.5 },
    { name: 'primary button label', fg: '--primary-foreground', bg: '--primary', min: 4.5 },
    { name: 'primary as text on background', fg: '--primary', bg: '--background', min: 4.5 },
    { name: 'destructive button label', fg: '--destructive-foreground', bg: '--destructive', min: 4.5 },
    { name: 'sidebar text', fg: '--sidebar-foreground', bg: '--sidebar', min: 7 },
    { name: 'control border on background', fg: '--control-border', bg: '--background', min: 3 },
    { name: 'control border on card', fg: '--control-border', bg: '--card', min: 3 },
    { name: 'focus ring on background', fg: '--ring', bg: '--background', min: 3 },
    { name: 'focus ring on card', fg: '--ring', bg: '--card', min: 3 },
    ...STATUSES.flatMap((s): Check[] => [
        { name: `status-${s} text on background`, fg: `--status-${s}`, bg: '--background', min: 4.5 },
        { name: `status-${s} text on card`, fg: `--status-${s}`, bg: '--card', min: 4.5 },
        {
            name: `status-${s} text on its 12% tint (badge)`,
            fg: `--status-${s}`,
            bg: '--card',
            tint: { token: `--status-${s}`, alpha: 0.12, over: '--card' },
            min: 4.5,
        },
    ]),
]

export interface Result extends Check {
    theme: Theme
    ratio: number
    pass: boolean
}

export function runChecks(css: string): Result[] {
    const tokens = readTokens(css)
    const out: Result[] = []
    for (const theme of ['light', 'dark'] as const) {
        const t = tokens[theme]
        const get = (name: string): Rgb => {
            const v = t[name]
            if (!v) throw new Error(`Missing ${name} in ${theme}`)
            return oklchToSrgb(v)
        }
        for (const c of CHECKS) {
            const bg = c.tint ? mix(get(c.tint.token), get(c.tint.over), c.tint.alpha) : get(c.bg)
            const ratio = contrastRatio(get(c.fg), bg)
            out.push({ ...c, theme, ratio, pass: ratio >= c.min })
        }
    }
    return out
}

export function loadGlobalCss(): string {
    const here = dirname(fileURLToPath(import.meta.url))
    return readFileSync(resolve(here, '../src/styles/globals.css'), 'utf8')
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
    const results = runChecks(loadGlobalCss())
    for (const r of results) {
        console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.theme.padEnd(5)} ${r.ratio.toFixed(2).padStart(6)} (>=${r.min})  ${r.name}`)
    }
    if (results.some((r) => !r.pass)) process.exit(1)
}
