import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

/**
 * Real Better Auth, no database server: the memory adapter keeps the sample
 * self-contained while exercising the exact same `auth.api.getSession()` API
 * the session middleware uses in production.
 */
const data = {
  user: [],
  session: [],
  account: [],
  verification: [],
};

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET ?? "orpc-nest-showcase-dev-secret-please-change",
  trustedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3210",
    "http://127.0.0.1:3210",
  ],
  emailAndPassword: { enabled: true },
  database: memoryAdapter(data),
});

export type Auth = typeof auth;
export type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
