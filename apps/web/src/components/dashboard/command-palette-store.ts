/**
 * Command palette store — a tiny module-level event channel so any component
 * (header trigger, keyboard shortcuts, sidebar) can open the palette without
 * prop drilling or global state libs.
 */
type PaletteListener = () => void

let openListener: PaletteListener | null = null

export function openCommandPalette(): void {
  openListener?.()
}

export function subscribeCommandPalette(listener: PaletteListener): () => void {
  openListener = listener
  return () => {
    if (openListener === listener) {
      openListener = null
    }
  }
}
