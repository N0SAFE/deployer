/**
 * Pure ANSI SGR parser. Turns a raw log line into styled text segments that the UI
 * renders as React spans. Nothing here produces HTML: colours are validated numbers
 * mapped to CSS colour strings, and any other escape sequence is dropped, so
 * hostile container output can never inject markup or styles.
 */

export interface AnsiStyle {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export interface AnsiSegment {
  text: string
  style: AnsiStyle
}

// Palette tuned for the dark terminal surface (WCAG AA on #070b14).
const BASIC_COLORS = [
  '#6b7280', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#22d3ee', '#e5e7eb',
] as const
const BRIGHT_COLORS = [
  '#9ca3af', '#fca5a5', '#86efac', '#fde047', '#93c5fd', '#d8b4fe', '#67e8f9', '#ffffff',
] as const

const ESC = String.fromCharCode(27)
// CSI: ESC [ params intermediates final. OSC: ESC ] ... (BEL | ESC \). Other two-byte escapes.
const ANSI_TOKEN = new RegExp(
  `${ESC}\\[([0-9;:]*)([ -/]*)([@-~])|${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?|${ESC}[@-Z\\\\-_]`,
  'gu',
)

const CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.trunc(value)))
}

/** xterm 256-colour index -> CSS colour. */
export function color256(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined
  if (index < 8) return BASIC_COLORS[index]
  if (index < 16) return BRIGHT_COLORS[index - 8]
  if (index < 232) {
    const n = index - 16
    const r = CUBE_STEPS[Math.floor(n / 36)] ?? 0
    const g = CUBE_STEPS[Math.floor((n % 36) / 6)] ?? 0
    const b = CUBE_STEPS[n % 6] ?? 0
    return `rgb(${String(r)}, ${String(g)}, ${String(b)})`
  }
  const level = 8 + (index - 232) * 10
  return `rgb(${String(level)}, ${String(level)}, ${String(level)})`
}

function applySgr(previous: AnsiStyle, rawParams: string): AnsiStyle {
  const codes = rawParams === '' ? [0] : rawParams.split(/[;:]/u).map((part) => (part === '' ? 0 : Number(part)))
  let style: AnsiStyle = { ...previous }

  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0
    if (!Number.isFinite(code)) continue

    if (code === 0) style = {}
    else if (code === 1) style.bold = true
    else if (code === 2) style.dim = true
    else if (code === 3) style.italic = true
    else if (code === 4) style.underline = true
    else if (code === 22) { delete style.bold; delete style.dim }
    else if (code === 23) delete style.italic
    else if (code === 24) delete style.underline
    else if (code >= 30 && code <= 37) style.fg = BASIC_COLORS[code - 30]
    else if (code >= 90 && code <= 97) style.fg = BRIGHT_COLORS[code - 90]
    else if (code >= 40 && code <= 47) style.bg = BASIC_COLORS[code - 40]
    else if (code >= 100 && code <= 107) style.bg = BRIGHT_COLORS[code - 100]
    else if (code === 39) delete style.fg
    else if (code === 49) delete style.bg
    else if (code === 38 || code === 48) {
      const target = code === 38 ? 'fg' : 'bg'
      const mode = codes[i + 1]
      if (mode === 5) {
        const color = color256(codes[i + 2] ?? -1)
        if (color) style[target] = color
        i += 2
      } else if (mode === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]]
        if (r !== undefined && g !== undefined && b !== undefined) {
          style[target] = `rgb(${String(clampByte(r))}, ${String(clampByte(g))}, ${String(clampByte(b))})`
        }
        i += 4
      }
    }
  }
  return style
}

function styleEquals(a: AnsiStyle, b: AnsiStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && !a.bold === !b.bold && !a.dim === !b.dim
    && !a.italic === !b.italic && !a.underline === !b.underline
}

/** Remove C0 control characters other than tab (e.g. stray BEL / backspace / NUL). */
function stripControls(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
}

/** Parse a line into styled segments. Adjacent segments with equal style are merged. */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let style: AnsiStyle = {}
  let cursor = 0

  const push = (raw: string) => {
    const text = stripControls(raw)
    if (text === '') return
    const last = segments[segments.length - 1]
    if (last && styleEquals(last.style, style)) last.text += text
    else segments.push({ text, style: { ...style } })
  }

  for (const match of input.matchAll(ANSI_TOKEN)) {
    push(input.slice(cursor, match.index))
    cursor = match.index + match[0].length
    // Only `ESC [ ... m` changes style; every other sequence is discarded.
    if (match[3] === 'm' && match[2] === '') style = applySgr(style, match[1] ?? '')
  }
  push(input.slice(cursor))
  return segments
}

/** Visible text of a line with every escape sequence removed. */
export function stripAnsi(input: string): string {
  return parseAnsi(input).map((segment) => segment.text).join('')
}
