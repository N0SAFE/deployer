import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "better-auth/plugins/passkey";
import { organization } from "better-auth/plugins/organization";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Auth } from "better-auth";
export const betterAuthFactory = (database: unknown) => {
    return {
        auth: betterAuth({
            database: drizzleAdapter(database as NodePgDatabase, {
                provider: "pg"
            }),
            emailAndPassword: {
                enabled: true
            },
            plugins: [
                passkey({
                    rpID: process.env.PASSKEY_RPID || "localhost",
                    rpName: process.env.PASSKEY_RPNAME || "NestJS Directus Turborepo Template",
                    origin: process.env.PASSKEY_ORIGIN || "http://localhost:3000"
                }),
                organization({
                    allowUserToCreateOrganization: true,
                    organizationLimit: 10, // Max 10 organizations per user
                    membershipLimit: 50, // Max 50 members per organization
                    invitationExpiresIn: 60 * 60 * 24 * 7, // 7 days
                    teams: {
                        enabled: true,
                        maximumTeams: 20, // Max 20 teams per organization
                        maximumMembersPerTeam: 25 // Max 25 members per team
                    },
                    // We'll add email sending later when needed
                    sendInvitationEmail: async (data) => {
                        // TODO: Implement email sending
                        console.log(`Invitation sent to ${data.email} for organization ${data.organization.name}`);
                    }
                })
            ]
        }) as unknown as Auth
    };
};
export const { auth } = betterAuthFactory(null);
