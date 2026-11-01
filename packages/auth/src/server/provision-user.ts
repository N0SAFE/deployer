import type { BetterAuthFactoryResult } from "./auth";

export interface ProvisionUserInput {
    email: string;
    name: string;
    password: string;
    /** Platform role. Granted server-side only; never read from a request body. */
    role?: string;
}

/**
 * Create a VERIFIED user + credential account without the public sign-up
 * endpoint.
 *
 * Public sign-up is disabled (`emailAndPassword.disableSignUp`), so
 * `auth.api.signUpEmail` now refuses — including from server code, which goes
 * through the same endpoint handler. This is the replacement for the trusted
 * paths (admin bootstrap, setup wizard) that need an account nobody signed up
 * for:
 *
 * - Better Auth's internal adapter writes the `user` + `account` rows, so the
 *   password hash, the credential `accountId` and the ids stay exactly what
 *   `sign-in/email` expects (hand-writing those rows breaks sign-in with
 *   `INVALID_EMAIL_OR_PASSWORD`);
 * - `method: "admin"` marks the provisioning source, which is what the
 *   `validateUserInfo` gate is allowed to see;
 * - `emailVerified: true` and `role` are set at creation, so there is no
 *   follow-up `UPDATE` and no window where the account exists unprivileged.
 */
export async function provisionUserAccount(
    auth: BetterAuthFactoryResult["auth"],
    input: ProvisionUserInput,
): Promise<string> {
    const context = await auth.$context;
    const password = await context.password.hash(input.password);

    const created = await context.internalAdapter.createUser(
        {
            email: input.email.trim().toLowerCase(),
            name: input.name,
            emailVerified: true,
            ...(input.role === undefined ? {} : { role: input.role }),
        },
        { method: "admin" },
    );

    await context.internalAdapter.createAccount({
        userId: created.id,
        accountId: created.id,
        providerId: "credential",
        password,
    });

    return created.id;
}
