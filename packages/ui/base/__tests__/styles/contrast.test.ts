import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrastRatio, loadGlobalCss, oklchToSrgb, runChecks } from '../../scripts/contrast'

describe('contrast helper', () => {
    it('black on white is 21:1', () => {
        expect(contrastRatio(oklchToSrgb('oklch(0 0 0)'), oklchToSrgb('oklch(1 0 0)'))).toBeCloseTo(21, 0)
    })
    it('identical colours are 1:1', () => {
        const c = oklchToSrgb('oklch(0.5 0.1 200)')
        expect(contrastRatio(c, c)).toBeCloseTo(1, 5)
    })
})

describe('design token contrast (light + dark)', () => {
    const results = runChecks(loadGlobalCss())
    it.each(results.map((r) => [`${r.theme}: ${r.name}`, r] as const))('%s', (_n, r) => {
        expect(r.ratio, `${r.ratio.toFixed(2)} < ${r.min}`).toBeGreaterThanOrEqual(r.min)
    })
})

describe('theme exposure', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles/globals.css'), 'utf8')
    it.each(['success', 'warning', 'danger', 'info', 'neutral'])('%s role is in the Tailwind theme', (n) => {
        for (const suffix of ['', '-bg', '-border']) {
            expect(css).toContain(`--color-${n}${suffix}: var(--${n}${suffix})`)
        }
    })
    it('honours prefers-reduced-motion', () => {
        expect(css).toContain('prefers-reduced-motion: reduce')
    })
})
