/**
 * Step-up policy (`AUTH-062`).
 *
 * A step-up is a FRESH, phishing-resistant proof of the person behind a session — not "the session is young". Better
 * Auth's `session.freshAge` is a property of the cookie (24 h here, for its own sensitive endpoints), so reusing it
 * would call a session that has been open all day "fresh". This window is shorter and is measured against the
 * verification itself.
 *
 * The value is policy, so it lives here (dependency-free) where the web can show the same countdown the API enforces.
 */
export const STEP_UP_WINDOW_SECONDS = 300

/** The factor that produced a step-up. `passkey` is AAL3 (phishing-resistant); `totp` is AAL2 (possession only). */
export type StepUpMethod = 'passkey' | 'totp'

/**
 * Whether a proof may authorise a CRITICAL action.
 *
 * Only AAL3 does: a TOTP code can be phished in real time, which is the whole reason the design asks for a passkey tap.
 * The row is still recorded for TOTP so an operator can see the attempt, but it never satisfies this.
 */
export function isCriticalStepUp(
    method: StepUpMethod | null | undefined
): boolean {
    return method === 'passkey'
}
