'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  AuthDashboard,
  AuthDashboardAdminSystem,
  AuthDashboardDeployments,
  AuthDashboardDocker,
  AuthDashboardProfile,
  AuthDashboardProjects,
  AuthDashboardServices,
} from '@/routes'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { openCommandPalette } from './command-palette-store'

/** go-to bindings: press `g`, then a letter within the window. */
const GO_TO_BINDINGS: Record<string, { label: string; href: string }> = {
  o: { label: 'Command center', href: AuthDashboard() },
  p: { label: 'Projects', href: AuthDashboardProjects() },
  d: { label: 'Deployments', href: AuthDashboardDeployments() },
  s: { label: 'Services', href: AuthDashboardServices() },
  c: { label: 'Docker', href: AuthDashboardDocker() },
  a: { label: 'Admin · System', href: AuthDashboardAdminSystem() },
  u: { label: 'Profile', href: AuthDashboardProfile() },
}

const SHORTCUT_ROWS: Array<{ keys: string; action: string }> = [
  { keys: '⌘K / Ctrl K', action: 'Open command palette' },
  { keys: 'g, then o', action: 'Go to command center' },
  { keys: 'g, then p', action: 'Go to projects' },
  { keys: 'g, then d', action: 'Go to deployments' },
  { keys: 'g, then s', action: 'Go to services' },
  { keys: 'g, then c', action: 'Go to docker' },
  { keys: 'g, then d', action: 'Go to deployments' },
  { keys: 'g, then a', action: 'Go to admin system' },
  { keys: 'g, then u', action: 'Go to profile' },
  { keys: '?', action: 'Show this help' },
  { keys: 'esc', action: 'Close dialogs / palette' },
]

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  )
}

/**
 * KeyboardShortcutsProvider — global keyboard layer for the operator console.
 *   ⌘K / Ctrl+K → open the command palette
 *   g <letter>  → jump straight to a section (Linear-style)
 *   ?           → toggle shortcuts help
 *
 * Mounted once in the dashboard layout. All bindings are ignored while the
 * user is typing in a field.
 */
export function KeyboardShortcutsProvider() {
  const router = useRouter()
  const [helpOpen, setHelpOpen] = useState(false)
  const pendingG = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelG = useCallback(() => {
    pendingG.current = false
    if (gTimer.current) {
      clearTimeout(gTimer.current)
      gTimer.current = null
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey

      // ⌘K / Ctrl+K — palette
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openCommandPalette()
        return
      }

      if (isTypingTarget(event.target) || mod || event.altKey) return

      // ? — help
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault()
        setHelpOpen((prev) => !prev)
        return
      }

      // g <letter> — go-to
      if (event.key.toLowerCase() === 'g' && !pendingG.current) {
        pendingG.current = true
        gTimer.current = setTimeout(() => {
          pendingG.current = false
          gTimer.current = null
        }, 600)
        return
      }

      if (pendingG.current) {
        const binding = GO_TO_BINDINGS[event.key.toLowerCase()]
        cancelG()
        if (binding) {
          event.preventDefault()
          router.push(binding.href)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelG()
    }
  }, [router, cancelG])

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs">Move through the console without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 py-1">
          {SHORTCUT_ROWS.map((row) => (
            <div key={row.keys} className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 odd:bg-muted/30">
              <span className="text-sm text-muted-foreground">{row.action}</span>
              <kbd className="rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-[11px] tabular-nums">
                {row.keys}
              </kbd>
            </div>
          ))}
        </div>
        <p className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          Tip: press <kbd className="rounded-sm border border-border/60 bg-background px-1">⌘K</kbd> from anywhere to search pages, projects, and services.
        </p>
      </DialogContent>
    </Dialog>
  )
}
