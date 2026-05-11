'use client'

import { type CSSProperties, type ReactNode, Fragment, useMemo } from 'react'
import { LogsViewer } from '@/components/atomics/organisms/logs'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Keyboard } from 'lucide-react'

export interface TerminalViewerProfile {
  id: string
  shell: string
  user: string
  workingDir: string
  recommended?: boolean
}

export interface TerminalViewerProps {
  profiles: TerminalViewerProfile[]
  outputChunks: string[]
  inputValue: string
  sessionId: string | null
  isSending: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  onClearOutput: () => void
  onSendControlInput?: (value: string) => void
  description?: ReactNode
  openingMessage?: ReactNode
}

interface TerminalSgrState {
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  inverse: boolean
}

interface TerminalStyledSegment {
  text: string
  style: CSSProperties
}

const DEFAULT_TERMINAL_FG = '#d1d5db'
const DEFAULT_TERMINAL_BG = '#070b14'

const ANSI_FG_PALETTE: string[] = [
  '#6b7280',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#3b82f6',
  '#d946ef',
  '#06b6d4',
  '#e5e7eb',
]

const ANSI_FG_BRIGHT_PALETTE: string[] = [
  '#9ca3af',
  '#f87171',
  '#4ade80',
  '#facc15',
  '#60a5fa',
  '#e879f9',
  '#22d3ee',
  '#ffffff',
]

function defaultSgrState(): TerminalSgrState {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strike: false,
    inverse: false,
  }
}

function toAnsi256Color(index: number): string {
  if (index < 0) {
    return '#000000'
  }

  if (index <= 7) {
    return ANSI_FG_PALETTE[index] ?? DEFAULT_TERMINAL_FG
  }

  if (index <= 15) {
    return ANSI_FG_BRIGHT_PALETTE[index - 8] ?? DEFAULT_TERMINAL_FG
  }

  if (index >= 232) {
    const gray = Math.max(0, Math.min(255, 8 + (index - 232) * 10))
    return `rgb(${String(gray)}, ${String(gray)}, ${String(gray)})`
  }

  const colorIndex = Math.max(16, Math.min(231, index)) - 16
  const redBand = Math.floor(colorIndex / 36)
  const greenBand = Math.floor((colorIndex % 36) / 6)
  const blueBand = colorIndex % 6

  const channel = (value: number) => (value === 0 ? 0 : 55 + value * 40)

  const red = channel(redBand)
  const green = channel(greenBand)
  const blue = channel(blueBand)

  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`
}

function parseAnsiColorSequence(params: number[], index: number): { color: string | null; consumed: number } {
  const mode = params[index + 1]

  if (mode === 5) {
    const paletteIndex = params[index + 2]
    if (typeof paletteIndex === 'number') {
      return { color: toAnsi256Color(paletteIndex), consumed: 2 }
    }
    return { color: null, consumed: 1 }
  }

  if (mode === 2) {
    const red = params[index + 2]
    const green = params[index + 3]
    const blue = params[index + 4]

    if (
      typeof red === 'number'
      && typeof green === 'number'
      && typeof blue === 'number'
    ) {
      const clamp = (value: number) => Math.max(0, Math.min(255, value))
      return {
        color: `rgb(${String(clamp(red))}, ${String(clamp(green))}, ${String(clamp(blue))})`,
        consumed: 4,
      }
    }

    return { color: null, consumed: 1 }
  }

  return { color: null, consumed: 0 }
}

function applySgrCodes(state: TerminalSgrState, paramsRaw: string): TerminalSgrState {
  const next = { ...state }
  const params = paramsRaw.length === 0
    ? [0]
    : paramsRaw
      .split(';')
      .map((value) => {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
      })

  for (let index = 0; index < params.length; index += 1) {
    const code = params[index] ?? 0

    switch (code) {
      case 0:
        Object.assign(next, defaultSgrState())
        break
      case 1:
        next.bold = true
        break
      case 2:
        next.dim = true
        break
      case 3:
        next.italic = true
        break
      case 4:
        next.underline = true
        break
      case 7:
        next.inverse = true
        break
      case 9:
        next.strike = true
        break
      case 22:
        next.bold = false
        next.dim = false
        break
      case 23:
        next.italic = false
        break
      case 24:
        next.underline = false
        break
      case 27:
        next.inverse = false
        break
      case 29:
        next.strike = false
        break
      case 39:
        next.fg = null
        break
      case 49:
        next.bg = null
        break
      default:
        if (code >= 30 && code <= 37) {
          next.fg = ANSI_FG_PALETTE[code - 30] ?? null
          break
        }

        if (code >= 90 && code <= 97) {
          next.fg = ANSI_FG_BRIGHT_PALETTE[code - 90] ?? null
          break
        }

        if (code >= 40 && code <= 47) {
          next.bg = ANSI_FG_PALETTE[code - 40] ?? null
          break
        }

        if (code >= 100 && code <= 107) {
          next.bg = ANSI_FG_BRIGHT_PALETTE[code - 100] ?? null
          break
        }

        if (code === 38 || code === 48) {
          const parsed = parseAnsiColorSequence(params, index)
          if (parsed.color) {
            if (code === 38) {
              next.fg = parsed.color
            } else {
              next.bg = parsed.color
            }
          }
          index += parsed.consumed
        }
        break
    }
  }

  return next
}

function computeSegmentStyle(state: TerminalSgrState): CSSProperties {
  const baseFg = state.fg ?? DEFAULT_TERMINAL_FG
  const baseBg = state.bg ?? 'transparent'
  const fg = state.inverse ? (state.bg ?? DEFAULT_TERMINAL_BG) : baseFg
  const bg = state.inverse ? (state.fg ?? DEFAULT_TERMINAL_FG) : baseBg

  return {
    color: fg,
    backgroundColor: bg,
    fontWeight: state.bold ? 700 : 400,
    opacity: state.dim ? 0.75 : 1,
    fontStyle: state.italic ? 'italic' : 'normal',
    textDecorationLine: [state.underline ? 'underline' : '', state.strike ? 'line-through' : '']
      .filter(Boolean)
      .join(' ') || 'none',
  }
}

function parseAnsiSegments(rawInput: string): TerminalStyledSegment[] {
  const text = rawInput
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '')

  const segments: TerminalStyledSegment[] = []
  const state = defaultSgrState()
  const ansiRegex = /\u001b\[([0-9;?]*)([A-Za-z])/gu

  let cursor = 0
  let match = ansiRegex.exec(text)

  while (match) {
    const start = match.index
    const end = ansiRegex.lastIndex
    const params = match[1] ?? ''
    const op = match[2] ?? ''

    if (start > cursor) {
      segments.push({
        text: text.slice(cursor, start),
        style: computeSegmentStyle(state),
      })
    }

    if (op === 'm') {
      Object.assign(state, applySgrCodes(state, params))
    }

    cursor = end
    match = ansiRegex.exec(text)
  }

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      style: computeSegmentStyle(state),
    })
  }

  return segments
}

function buildTerminalLinesFromOutput(outputChunks: string[]): Array<{ id: string; searchText: string; content: ReactNode }> {
  const combinedOutput = outputChunks.join('')
  const segments = parseAnsiSegments(combinedOutput)
  const lines: Array<{ id: string; searchText: string; content: ReactNode }> = []

  let lineIndex = 0
  let segmentIndex = 0
  let currentLineNodes: ReactNode[] = []
  let currentLineText = ''

  const pushCurrentLine = () => {
    lines.push({
      id: `line:${String(lineIndex)}`,
      searchText: currentLineText,
      content: <>{currentLineNodes.length > 0 ? currentLineNodes : <span> </span>}</>,
    })

    lineIndex += 1
    currentLineNodes = []
    currentLineText = ''
  }

  for (const segment of segments) {
    const parts = segment.text.split('\n')

    parts.forEach((part, partIndex) => {
      if (part.length > 0) {
        currentLineText += part
        currentLineNodes.push(
          <span key={`seg:${String(segmentIndex)}`} style={segment.style}>
            {part}
          </span>,
        )
        segmentIndex += 1
      }

      const isLineBreak = partIndex < parts.length - 1
      if (isLineBreak) {
        pushCurrentLine()
      }
    })
  }

  if (currentLineNodes.length > 0 || lines.length === 0) {
    pushCurrentLine()
  }

  return lines.map((line) => ({
    ...line,
    content: <Fragment key={line.id}>{line.content}</Fragment>,
  }))
}

export function TerminalViewer({
  profiles,
  outputChunks,
  inputValue,
  sessionId,
  isSending,
  onInputChange,
  onSend,
  onClearOutput,
  onSendControlInput,
  description,
  openingMessage,
}: TerminalViewerProps) {
  const primaryProfile = profiles.find((profile) => profile.recommended) ?? profiles[0] ?? null

  const lines = useMemo(() => buildTerminalLinesFromOutput(outputChunks), [outputChunks])

  const panelFooter = (
    <form
      className="flex items-center gap-2 px-2 py-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      <span className="font-mono text-xs text-slate-400">$</span>
      <Input
        value={inputValue}
        onChange={(event) => {
          onInputChange(event.target.value)
        }}
        className="h-9 flex-1 rounded border-slate-700 bg-[#070b14] px-3 text-xs font-mono text-green-300 placeholder:text-slate-500"
        placeholder="Type a command (e.g. ls, pwd, cat /etc/os-release)"
      />
      <Button type="submit" size="sm" disabled={!sessionId || isSending}>
        Send
      </Button>
    </form>
  )

  const shellBadge = primaryProfile ? `${primaryProfile.shell}` : 'shell'
  const userBadge = primaryProfile ? `user:${primaryProfile.user}` : 'user:unknown'
  const cwdBadge = primaryProfile ? `cwd:${primaryProfile.workingDir}` : 'cwd:/'

  return (
    <LogsViewer
      mode="write"
      showSearch={false}
      streamRegionLabel="Terminal stream"
      lines={lines}
      hasMoreHistory={false}
      isLoadingHistory={false}
      onLoadOlderLogs={() => {
        // Terminal mode does not paginate historical chunks yet.
      }}
      onReset={onClearOutput}
      badges={(
        <>
          <Badge variant="outline">stdin</Badge>
          <Badge variant="outline">stdout/stderr</Badge>
          <Badge variant="outline">{outputChunks.length} chunks</Badge>
          <Badge variant="outline">{shellBadge}</Badge>
          <Badge variant="outline">{userBadge}</Badge>
          <Badge variant="outline">{cwdBadge}</Badge>
        </>
      )}
      extraToolbarContent={typeof onSendControlInput === 'function' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!sessionId || isSending}
          onClick={() => {
            onSendControlInput('\u0003')
          }}
        >
          <Keyboard className="mr-1 h-3.5 w-3.5" />
          Ctrl+C
        </Button>
      ) : null}
      notice={<p className="text-muted-foreground">{description ?? 'Interactive terminal session.'}</p>}
      emptyMessage={openingMessage ?? 'Opening terminal session...'}
      panelFooter={panelFooter}
    />
  )
}
