import type { BetterAuthPlugin } from "better-auth";
import {
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import type { UserWithRole } from "better-auth/plugins";
import * as z from "zod/v4";

/**
 * Role schema type that accepts any valid role schema output from createSchemas
 * Can be ZodNever (0 roles), ZodLiteral (1 role), or ZodUnion (2+ roles)
 */
export type RoleSchemaType<TRoles extends string = string> =
  | z.ZodNever
  | z.ZodLiteral<TRoles>
  | z.ZodUnion<[z.ZodLiteral<TRoles>, ...z.ZodLiteral<TRoles>[]]>;

/**
 * Invitation options with type-safe role configuration
 */
export interface InvitePluginOptions<TRoles extends string = string> {
  /**
   * Duration in days for which an invite token is valid
   * @example 7 // 7 days
   * @default 7
   */
  inviteDurationDays?: number;

  /**
   * Zod schema for role validation
   * Use the roleNames schema from your permission builder schemas
   * Accepts ZodNever (0 roles), ZodLiteral (1 role), or ZodUnion (2+ roles)
   */
  roleSchema: RoleSchemaType<TRoles>;

  /**
   * Optional function to generate custom invite tokens
   * @default () => generateRandomString(32, "a-z", "A-Z", "0-9")
   */
  generateToken?: () => string;

  /**
   * Optional function to determine if a user can create invites
   * If not provided, any authenticated user can create invites
   */
  canCreateInvite?: (user: UserWithRole) => boolean;

  /**
   * Optional cap on the role an invite may carry.
   *
   * `roleSchema` says which roles EXIST; this says which ones the INVITER may hand out. Without it, any session that
   * passes `canCreateInvite` can invite a `superAdmin` — the escalation this option exists to close. Return `false`
   * to refuse; the endpoint answers 403.
   */
  canInviteRole?: (user: UserWithRole, role: TRoles) => boolean;

  /**
   * Optional function for getting the current date (useful for testing)
   * @default () => new Date()
   */
  getDate?: () => Date;
}

export interface Invite {
  id: string;
  token: string;
  email?: string;
  expiresAt: Date;
  role: string;
  usedAt?: Date;
  invitedUserId: string;
};

const ERROR_CODES = {
  USER_NOT_LOGGED_IN: {
    code: "USER_NOT_LOGGED_IN",
    message: "User must be logged in to create an invite",
  },
  INSUFFICIENT_PERMISSIONS: {
    code: "INSUFFICIENT_PERMISSIONS",
    message: "User does not have sufficient permissions to create invite",
  },
  NO_SUCH_USER: {
    code: "NO_SUCH_USER",
    message: "No such user",
  },
  INVALID_OR_EXPIRED_INVITE: {
    code: "INVALID_OR_EXPIRED_INVITE",
    message: "Invalid or expired invite token",
  },
} as const;

/**
 * Better Auth plugin for invitation-based user registration with role management
 * 
 * @example
 * ```typescript
 * import { invitePlugin } from '@deployer/auth/server/plugins/invite'
 * import { ac, roles } from '@deployer/auth/permissions/index'
 * 
 * betterAuth({
 *   plugins: [
 *     admin({ ac, roles, defaultRole: 'guest' }),
 *     invitePlugin({
 *       inviteDurationDays: 7,
 *       roleSchema: roleNames,
 *     })
 *   ]
 * })
 * ```
 */
export const invitePlugin = <TRoles extends string>(
  options: InvitePluginOptions<TRoles>
) => {
  const opts = {
    generateToken:
      options.generateToken ?? (() => generateRandomString(32, "a-z", "A-Z", "0-9")),
    getDate: options.getDate ?? (() => new Date()),
    ...options,
  };

  return {
    id: "invite",
    endpoints: {
      /**
       * Create a new invite with email and role
       */
      create: createAuthEndpoint(
        "/invite/create",
        {
          body: z.object({
            email: z.email(),
            role: options.roleSchema,
          }),
          method: "POST",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const userId = ctx.context.session.user.id;
          if (!userId) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.USER_NOT_LOGGED_IN.message,
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(userId);

          if (!user) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.NO_SUCH_USER.message,
            });
          }

          // Check if user can create invites
          if (options.canCreateInvite !== undefined) {
            // @ts-expect-error UserWithRole type assertion
            const canCreateInvite = options.canCreateInvite(user);
            if (!canCreateInvite) {
              throw ctx.error("BAD_REQUEST", {
                message: ERROR_CODES.INSUFFICIENT_PERMISSIONS.message,
              });
            }
          }

          // The role cap, before anything is written: an inviter may only hand out a role it could grant directly
          // (`refuseRoleGrant` in the hierarchy), so inviting is never a way around the admin hierarchy.
          if (options.canInviteRole !== undefined) {
            // @ts-expect-error UserWithRole type assertion
            const mayInviteRole = options.canInviteRole(user, ctx.body.role);
            if (!mayInviteRole) {
              throw ctx.error("FORBIDDEN", {
                message: `You may not invite a user with the ${String(ctx.body.role)} role`,
              });
            }
          }

          const token = opts.generateToken();
          const now = opts.getDate();
          const expiresAt = new Date(now);
          expiresAt.setDate(expiresAt.getDate() + (options.inviteDurationDays ?? 7));

          // Check if user with this email already exists
          const existingUser = await ctx.context.adapter.findOne<{ id: string }>({
            model: "user",
            where: [{ field: "email", value: ctx.body.email }],
          });

          let invitedUserId: string;

          if (existingUser?.id !== undefined) {
            invitedUserId = existingUser.id;
          } else {
            // Create user if not exists
            const newUser = await ctx.context.internalAdapter.createUser(
              {
                email: ctx.body.email,
                name: ctx.body.email.split("@")[0] ?? ctx.body.email, // Default name from email
                emailVerified: false,
                role: ctx.body.role,
              },
              // better-auth >=1.7 provisioning gate: admin-initiated invite.
              { method: "admin" },
            );

            if (!newUser.id) {
              throw ctx.error("INTERNAL_SERVER_ERROR", {
                message: "Failed to create invited user",
              });
            }
            invitedUserId = newUser.id;
          }

          await ctx.context.adapter.create({
            model: "platformInvite",
            data: {
              token,
              email: ctx.body.email,
              invitedUserId,
              createdAt: now,
              expiresAt,
              role: ctx.body.role,
            },
          });

          return ctx.json({ token, email: ctx.body.email, role: ctx.body.role, expiresAt: expiresAt.toISOString(), invitedUserId }, { status: 201 });
        }
      ),

      /**
       * List platform invitations with optional status filter
       */
      list: createAuthEndpoint(
        "/invite/list",
        {
          query: z.object({
            status: z.enum(["pending", "used", "expired"]).optional(),
          }),
          method: "GET",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const userId = ctx.context.session.user.id;
          if (!userId) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.USER_NOT_LOGGED_IN.message,
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(userId);

          if (!user) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.NO_SUCH_USER.message,
            });
          }

          // Check if user can list invites
          if (options.canCreateInvite !== undefined) {
            // @ts-expect-error UserWithRole type assertion
            const canListInvites = options.canCreateInvite(user);
            if (!canListInvites) {
              throw ctx.error("BAD_REQUEST", {
                message: ERROR_CODES.INSUFFICIENT_PERMISSIONS.message,
              });
            }
          }

          // Query all platformInvite records and filter in memory
          // Better Auth adapter has limited WHERE clause support
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          const allInvitations = await ctx.context.adapter.findMany({
            model: "platformInvite",
            limit: 1000,
            sortBy: { field: "createdAt", direction: "desc" },
          }) as Invite[];

          // Filter based on status
          let invitations = allInvitations;
          if (ctx.query.status) {
            const now = opts.getDate();
            // `usedAt` comes back as `null` from the database, never `undefined`: comparing against
            // `undefined` made "pending" return nothing and "used" return every row.
            const unused = (invite: Invite): boolean => invite.usedAt === null || invite.usedAt === undefined;
            const expired = (invite: Invite): boolean => new Date(invite.expiresAt).getTime() <= now.getTime();

            if (ctx.query.status === "pending") {
              invitations = allInvitations.filter((invite) => unused(invite) && !expired(invite));
            } else if (ctx.query.status === "used") {
              invitations = allInvitations.filter((invite) => !unused(invite));
            } else {
              invitations = allInvitations.filter((invite) => unused(invite) && expired(invite));
            }
          }

          return ctx.json({ invitations }, { status: 200 });
        }
      ),

      /**
       * Check if an invite token is valid
       */
      check: createAuthEndpoint(
        "/invite/check",
        {
          method: "POST",
          body: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          const token = ctx.body.token;

          const invite = await ctx.context.adapter.findOne<Invite>({
            model: "platformInvite",
            where: [{ field: "token", value: token }],
          });

          if (!invite?.email) {
            return ctx.json({ valid: false, message: "Invitation not found" });
          }

          // Check if already used
          if (invite.usedAt) {
            return ctx.json({ valid: false, message: "Invitation has already been used" });
          }

          // Check if expired. The adapter may hand the timestamp back as a string.
          if (opts.getDate().getTime() > new Date(invite.expiresAt).getTime()) {
            return ctx.json({ valid: false, message: "Invitation has expired" });
          }

          return ctx.json({ valid: true, email: invite.email, role: invite.role });
        }
      ),
      /**
       * Validate invitation and set up user account (user already created at invite time)
       */
      validate: createAuthEndpoint(
        "/invite/validate",
        {
          method: "POST",
          body: z.object({
            token: z.string(),
            password: z.string().min(8),
            name: z.string().min(1),
          }),
        },
        async (ctx) => {
          const { token, password, name } = ctx.body;

          const invite = await ctx.context.adapter.findOne<Invite>({
            model: "platformInvite",
            where: [{ field: "token", value: token }],
          });

          if (!invite?.email) {
            throw ctx.error("BAD_REQUEST", {
              message: "Invitation not found",
            });
          }

          // Check if already used
          if (invite.usedAt) {
            throw ctx.error("BAD_REQUEST", {
              message: "Invitation has already been used",
            });
          }

          // Check if expired. The adapter may hand the timestamp back as a string.
          if (opts.getDate().getTime() > new Date(invite.expiresAt).getTime()) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.INVALID_OR_EXPIRED_INVITE.message,
            });
          }

          // ── CLAIM BEFORE ANY SIDE EFFECT ────────────────────────────────
          // Setting `usedAt` after the account write left a race: two concurrent validates both passed the checks
          // above and both set a password, so one invite could provision two sessions. The claim is one write that
          // consumes the token, and a read-back proves this caller is the one whose write survived.
          const spentToken = `${token}.spent.${generateRandomString(16, "a-z", "0-9")}`;
          await ctx.context.adapter.update({
            model: "platformInvite",
            where: [{ field: "token", value: token }],
            update: { token: spentToken, usedAt: opts.getDate() },
          });
          const claimed = await ctx.context.adapter.findOne<Invite>({
            model: "platformInvite",
            where: [{ field: "token", value: spentToken }],
          });
          if (claimed === null || claimed === undefined) {
            throw ctx.error("BAD_REQUEST", {
              message: "Invitation has already been used",
            });
          }

          // User was already created at invite time, update their info
          await ctx.context.adapter.update({
            model: "user",
            where: [{ field: "id", value: invite.invitedUserId }],
            update: {
              name,
              emailVerified: true,
            },
          });

          // Check if account already exists for this user
          const existingAccount = await ctx.context.adapter.findOne({
            model: "account",
            where: [
              { field: "userId", value: invite.invitedUserId },
              { field: "providerId", value: "credential" },
            ],
          });

          if (existingAccount) {
            throw ctx.error("BAD_REQUEST", {
              message: "User account already set up",
            });
          }

          // Create account with password
          await ctx.context.adapter.create({
            model: "account",
            data: {
              userId: invite.invitedUserId,
              accountId: invite.invitedUserId,
              providerId: "credential",
              password: await ctx.context.password.hash(password),
            },
          });


          return ctx.json({ userId: invite.invitedUserId }, { status: 201 });
        }
      ),
    },
    $ERROR_CODES: ERROR_CODES,
    schema: {
      platformInvite: {
        fields: {
          token: { type: "string", unique: true, required: true },
          email: { type: "string", required: true },
          role: { type: "string", required: true },
          createdAt: { type: "date", defaultValue: () => new Date() },
          expiresAt: { type: "date", required: true },
          usedAt: { type: "date", required: false },
          invitedUserId: {
            type: "string",
            required: true,
            references: { model: "user", field: "id", onDelete: "cascade" },
          },
        },
      },
    },
  } satisfies BetterAuthPlugin;
};

/**
 * Consume an invitation exactly once.
 *
 * The adapter cannot express `WHERE used_at IS NULL`, so the claim rotates the unique `token` to an attempt-specific
 * value instead: two racers both write, exactly one row keeps its marker, and the read-back names the winner. The loser
 * is reported as "already used" — not as a 500, and never as a second provisioning.
 *
 * Rotation also makes the spent token unresolvable, so `/invite/check` reports "not found" afterwards instead of
 * "already used": the same answer for a token that never existed.
 */
async function claimInvite(
  ctx: {
    context: {
      adapter: {
        update: (args: Record<string, unknown>) => Promise<unknown>;
        findOne: (args: Record<string, unknown>) => Promise<unknown>;
      };
    };
  },
  token: string,
  now: Date,
): Promise<boolean> {
  const spentToken = `${token}.spent.${generateRandomString(16, "a-z", "0-9")}`;

  await ctx.context.adapter.update({
    model: "platformInvite",
    where: [{ field: "token", value: token }],
    update: { token: spentToken, usedAt: now.toISOString() },
  });

  const claimed = (await ctx.context.adapter.findOne({
    model: "platformInvite",
    where: [{ field: "token", value: spentToken }],
  })) as { id: string } | null | undefined;

  return claimed !== null && claimed !== undefined;
}
