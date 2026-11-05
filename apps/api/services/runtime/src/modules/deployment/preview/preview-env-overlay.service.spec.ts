import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { PreviewEnvOverlayService } from './preview-env-overlay.service'

describe('PreviewEnvOverlayService', () => {
    const base = { A: '1', B: '2' }
    const overlay = { B: 'x', C: '3' }
    const apply = (strategy: 'inherit' | 'merge' | 'replace') =>
        Effect.runPromise(
            PreviewEnvOverlayService.live.applyOverlay(base, overlay, strategy)
        )

    it('inherit keeps the base and ignores the overlay', async () => {
        expect(await apply('inherit')).toEqual(base)
    })

    it('merge lets the overlay win key by key', async () => {
        expect(await apply('merge')).toEqual({ A: '1', B: 'x', C: '3' })
    })

    it('replace drops the base', async () => {
        expect(await apply('replace')).toEqual(overlay)
    })
})
