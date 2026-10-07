/**
 * Server plugin wrappers for the security-and-convenience plugin set.
 *
 * Each wrapper exists for the same reason `useAdmin`/`useInvite` do: it keeps
 * the platform's policy in ONE place, next to the other plugin configuration,
 * rather than scattered as inline option objects in the auth factory. A wrapper
 * also gives the plugin a stable name to reference and a single file to change
 * when the upstream options move.
 *
 * All four have a client counterpart registered in
 * `packages/auth/src/client/auth-client.ts`, and each one surfaces data
 * in the TanStack DevTools panels (`apps/web/src/components/devtools/plugins/`).
 */

import { twoFactor } from "better-auth/plugins";
import {
    deviceAuthorization,
    type TimeString,
} from "better-auth/plugins";
import { lastLoginMethod } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

// ============================================================================
// Passkey Plugin
// ============================================================================

export interface UsePasskeyOptions {
    /** Relying-party display name shown by the OS during enrolment. */
    rpName?: string;
    /** Restrict enrolment to specific origins. Defaults to inferring from the request. */
    origin?: string | string[];
}

/**
 * WebAuthn / passkey authentication.
 *
 * Two reasons this is not merely a convenience here:
 *
 * 1. **It is Agent Auth's proof-of-physical-presence factor.** Agent Auth maps
 *    mutating HTTP methods to `approvalStrength: "webauthn"`, which requires a
 *    registered passkey. Without this plugin, every mutation an agent requests
 *    fails with `WEBAUTHN_NOT_ENROLLED` — so this plugin is a hard prerequisite
 *    for the agent approval flow, not an optional extra.
 * 2. **Phishing resistance for operator accounts.** These sessions control
 *    production hosts; a passkey cannot be replayed by a phishing page the way
 *    a password or TOTP code can.
 *
 * @example
 * ```typescript
 * betterAuth({ plugins: [usePasskey({ rpName: 'Deployer' })] })
 * ```
 */
export function usePasskey(options: UsePasskeyOptions = {}) {
    return passkey({
        rpName: options.rpName ?? 'Deployer',
        ...(options.origin ? { origin: options.origin } : {}),
    });
}

export type PasskeyPlugin = ReturnType<typeof usePasskey>;

// ============================================================================
// Two-Factor Plugin
// ============================================================================

export interface UseTwoFactorOptions {
    /** Shown by authenticator apps as the account issuer. */
    issuer?: string;
    /** Number of single-use recovery codes to generate. */
    backupCodeCount?: number;
}

/**
 * TOTP two-factor authentication with backup codes.
 *
 * `issuer` is deliberately required rather than defaulted: an authenticator app
 * displays it verbatim, and a missing issuer produces entries the user cannot
 * identify among their other accounts.
 *
 * The email-OTP second factor is intentionally NOT enabled — it needs a mail
 * transport this platform does not have yet (see the auth plugin evaluation,
 * §1.5 Gap C). TOTP + backup codes cover the same threat without it.
 *
 * @example
 * ```typescript
 * betterAuth({ plugins: [useTwoFactor({ issuer: 'Deployer' })] })
 * ```
 */
export function useTwoFactor(options: UseTwoFactorOptions = {}) {
    return twoFactor({
        issuer: options.issuer ?? 'Deployer',
        backupCodeOptions: {
            amount: options.backupCodeCount ?? 10,
            length: 10,
        },
    });
}

export type TwoFactorPlugin = ReturnType<typeof useTwoFactor>;

// ============================================================================
// Device Authorization Plugin
// ============================================================================

export interface UseDeviceAuthorizationOptions {
    /** Web path a user visits to approve a device code. */
    verificationUri?: string;
    /** How long a device code stays valid. A duration the plugin parses (`'30m'`, `'1h'`). */
    expiresIn?: TimeString;
    /** Number of characters in the human-typed user code. */
    userCodeLength?: number;
}

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Gives the CLI a real login flow — print a code, approve in the browser —
 * instead of the master-token / seeded-credentials fallback chain in
 * `apps/api/src/cli/services/cli-auth.service.ts`.
 *
 * The approval page at `/device` is shared with Agent Auth's capability
 * approval (`deviceAuthorizationPage: '/device/capabilities'`), so one page
 * serves both flows rather than two near-identical ones.
 *
 * ## Why the options are read from the environment rather than passed in
 *
 * `deviceAuthorization` is generic over an optional token grant, and inferring
 * that generic through a wrapper parameter produces a union TypeScript refuses
 * to represent (TS2590 — "expression produces a union type that is too
 * complex"). Calling it with a literal options object in one place avoids the
 * inference entirely, which is why this wrapper reads its configuration
 * directly instead of accepting it.
 *
 * @example
 * ```typescript
 * betterAuth({ plugins: [useDeviceAuthorization()] })
 * ```
 */
export function useDeviceAuthorization(): ReturnType<typeof deviceAuthorization<undefined>> {
    return deviceAuthorization({
        verificationUri: '/device',
        // `TimeString` is a template-literal type (`'30m'`, `'1h'`), not a number.
        expiresIn: '30m',
        userCodeLength: 8,
    });
}

export type DeviceAuthorizationPlugin = ReturnType<
    typeof deviceAuthorization<undefined>
>;

// ============================================================================
// Last Login Method Plugin
// ============================================================================

/**
 * Records which method was used to sign in (email, github, passkey, …).
 *
 * Read client-side to annotate the sign-in page ("Last used") and shown in the
 * devtools Auth panel. Cheap: it stores a cookie, adds no table, and needs no
 * configuration.
 *
 * @example
 * ```typescript
 * betterAuth({ plugins: [useLastLoginMethod()] })
 * ```
 */
export function useLastLoginMethod() {
    return lastLoginMethod();
}

export type LastLoginMethodPlugin = ReturnType<typeof useLastLoginMethod>;
