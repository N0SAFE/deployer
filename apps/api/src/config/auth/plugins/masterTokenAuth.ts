// plugins/master-token/index.ts
import type { BetterAuthPlugin, User } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

interface MasterTokenOptions {
  devAuthKey: string;
  masterUserEmail: string,
  enabled: boolean
}

export const masterTokenPlugin = (
  options: MasterTokenOptions
): BetterAuthPlugin => {
  const {
    devAuthKey,
    masterUserEmail,
    enabled
  } = options;

  return {
    id: "masterToken",

    hooks: {
      after: [
        {
          matcher: (context) => {
            // Hook into all API calls
            return (
              context.path === "/get-session" ||
              context.path === "/session" ||
              context.path.includes("/session")
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            if (!enabled) return;
            
            console.log("Master token middleware triggered");

            // Check for master token
            const authHeader = ctx.headers?.get("authorization");

            if (authHeader?.startsWith("Bearer ")) {
              const token = authHeader?.substring(7);

              if (token === devAuthKey) {
                // If the response is null/empty (no session found), inject our master session
                if (
                  !ctx.body ||
                  (ctx.body && Object.keys(ctx.body).length === 0)
                ) {
                  const user = await ctx.context.adapter.findOne<User>({
                    model: "user",
                    where: [{ field: "email", value: masterUserEmail, operator: "eq" }],
                  });

                  if (!user) {
                    return ctx.json(
                      { error: "User not found" },
                      { status: 404 }
                    );
                  }

                  // Create session for the user
                  const session =
                    await ctx.context.internalAdapter.createSession(
                      user.id,
                      ctx
                    );

                  await setSessionCookie(ctx, {
                    session,
                    user,
                  });

                  return ctx.json({
                    session,
                    user
                  });
                }
              }
            }
          }),
        },
      ],
    },
  };
};
