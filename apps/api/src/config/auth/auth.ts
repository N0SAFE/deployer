import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "better-auth/plugins/passkey";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { EnvService } from "../env/env.service";
import { masterTokenPlugin } from "./plugins/masterTokenAuth";
import { loginAsPlugin } from "./plugins/loginAs";
import { useAdmin } from "./permissions/index";
import { openAPI, organization } from "better-auth/plugins";

export const betterAuthFactory = (...args: unknown[]) => {
  const [database, envService] = args as [unknown, EnvService];
  const dbInstance = database as NodePgDatabase<any>;

  const devAuthKey = envService.get("DEV_AUTH_KEY");

  return {
    auth: betterAuth({
      database: drizzleAdapter(dbInstance, {
        provider: "pg",
      }),
      emailAndPassword: {
        enabled: true,
      },
      plugins: [
        passkey({
          rpID: envService.get("PASSKEY_RPID"),
          rpName: envService.get("PASSKEY_RPNAME"),
          origin: envService.get("PASSKEY_ORIGIN"),
        }),
        useAdmin(),
        masterTokenPlugin({
          devAuthKey: devAuthKey || "",
          enabled: envService.get("NODE_ENV") === "development" && !!devAuthKey,
        }),
        // Dev-only loginAs plugin to support 'Login as' from DevTools
        loginAsPlugin({
          enabled: envService.get("NODE_ENV") === "development" && !!devAuthKey,
          devAuthKey: devAuthKey || "",
        }),
        openAPI(),
        organization({
          allowUserToCreateOrganization: true,
          organizationLimit: 10, // Max 10 organizations per user
          membershipLimit: 50, // Max 50 members per organization
          invitationExpiresIn: 60 * 60 * 24 * 7, // 7 days
          teams: {
            enabled: true,
            maximumTeams: 20, // Max 20 teams per organization
            maximumMembersPerTeam: 25, // Max 25 members per team
          },
          // We'll add email sending later when needed
          sendInvitationEmail: async (data) => {
            // TODO: Implement email sending
            console.log(
              `Invitation sent to ${data.email} for organization ${data.organization.name}`
            );
          },
        }),
      ],
    }),
  };
};
