/**
 * Development-only conveniences: demo credentials, the sign-up link, devtools.
 *
 * There is no server-side "sign-up enabled" flag in the API or the contracts
 * (Better Auth is configured without one), so the gate is the build mode.
 * `NODE_ENV` is inlined by Next at build time, so this is a compile-time
 * constant in production bundles and the gated markup is dead-code eliminated.
 */
export function devConveniencesEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production'
}

/** Turn a raw auth failure into a sentence an operator can act on. */
export function signInErrorHint(message: string): string | null {
  const m = message.toLowerCase()
  if (/invalid|incorrect|credentials|password/.test(m)) {
    return 'Check the email and password, then try again. Passwords are case-sensitive.'
  }
  if (/too many|rate|limit/.test(m)) {
    return 'Too many attempts. Wait a minute before trying again.'
  }
  if (/network|fetch|unreachable|failed to/.test(m)) {
    return 'The platform API may be down or still starting. Try again in a moment.'
  }
  return null
}
