import { z } from "zod/v4";

export const envSchema = z.object({
  // Database
  DATABASE_URL: z.url("DATABASE_URL must be a valid URL"),
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be exactly 64 characters (32 bytes in hex)")
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be a valid hex string")
    .optional(),

  // API
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  // Authentication
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  DEV_AUTH_KEY: z.string().optional(),
  MASTER_USER: z
    .string()
    .optional()
    .refine((arg) => {
      // arg should be an email or an email/usernamewithspace
      if (!arg) return true; // optional
      const parts = arg.split("/");
      const emailSchema = z.email();
      if (parts.length > 2) return false;
      if (parts.length > 1) {
        const [email, password] = parts;
        if (emailSchema.safeParse(email).success && password.trim().length > 0) {
          return true;
        }
        return false;
      }
      return emailSchema.safeParse(arg).success;
    })
    .transform((arg) => {
      if (!arg) return null;
      const parts = arg.split("/");
      if (parts.length > 1) {
        const [email, password] = parts;
        return { email, password };
      }
      return { email: arg, password: null };
    }),

  // Passkey
  PASSKEY_RPID: z.string().default("localhost"),
  PASSKEY_RPNAME: z.string().default("NestJS Directus Turborepo Template"),
  PASSKEY_ORIGIN: z.url().default("http://localhost:3000"),

  // Environment
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // GitHub App Configuration
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),

  BACKUP_PATH: z.string().optional().default("/tmp/backups"),
  STORAGE_PATH: z.string().optional().default("/tmp/storage"),

  TRAEFIK_CONFIG_BASE_PATH: z.string().optional().default("/app/traefik-configs"),
  TRAEFIK_BACKUP_PATH: z.string().optional().default("/app/traefik-configs/backups"),
  TRAEFIK_STARTUP_SYNC_ENABLED: z.boolean().optional().default(true),
  TRAEFIK_FAIL_ON_STARTUP_ERROR: z.boolean().optional().default(false),
  TRAEFIK_CLEANUP_ON_STARTUP: z.boolean().optional().default(false),
});

export type Env = z.infer<typeof envSchema>;
