/**
 * Mock environment variables for local development and testing
 * These are safe defaults that work out of the box without configuration
 */

import type zod from "zod/v4";
import type {
    apiEnvSchema,
    docEnvSchema,
    webEnvSchema,
} from "./index";

type SchemaInputRecord<TSchema extends zod.ZodTypeAny> =
    zod.input<TSchema> extends Record<string, unknown>
        ? zod.input<TSchema>
        : never;

type RequiredInputKeys<TSchema extends zod.ZodTypeAny> = {
    [K in keyof SchemaInputRecord<TSchema>]-?: undefined extends SchemaInputRecord<TSchema>[K]
        ? never
        : K;
}[keyof SchemaInputRecord<TSchema>];

type EnvMockForSchema<TSchema extends zod.ZodTypeAny> = {
    [K in Extract<RequiredInputKeys<TSchema>, string>]-?: string;
} & Partial<Record<Extract<keyof SchemaInputRecord<TSchema>, string>, string>>;

const apiMockEnv: EnvMockForSchema<typeof apiEnvSchema> = {
    API_PORT: "3001",
    AUTH_SECRET: "mock-auth-secret-key-for-development-only-change-in-production",
    BETTER_AUTH_SECRET:
        "mock-auth-secret-key-for-development-only-change-in-production",
    DEV_AUTH_KEY: "mock-dev-auth-key-for-development-only",
    NEXT_PUBLIC_API_URL: "http://localhost:3001",
    NEXT_PUBLIC_APP_URL: "http://localhost:3005",
    DEFAULT_ADMIN_EMAIL: "admin@admin.com",
    DEFAULT_ADMIN_PASSWORD: "adminadmin",
    DISABLE_AUTO_SCAN: "false",
    SETUP_AUTO: "false",
    ADMIN_BOOTSTRAP: "auto",
    ENABLE_SEEDING: "false",
    ENABLE_DEV_BOOTSTRAP: "true",
    SKIP_MIGRATIONS: "false",
};

const webMockEnv: EnvMockForSchema<typeof webEnvSchema> = {
    NEXT_PUBLIC_APP_URL: "http://localhost:3005",
    API_URL: "http://localhost:3001",
    NEXT_PUBLIC_API_URL: "http://localhost:3001",
    NEXT_PUBLIC_API_PORT: "3001",
    NEXT_PUBLIC_APP_PORT: "3005",
    AUTH_SECRET: "mock-auth-secret-key-for-development-only-change-in-production",
    BETTER_AUTH_SECRET:
        "mock-auth-secret-key-for-development-only-change-in-production",
    NEXT_PUBLIC_SHOW_AUTH_LOGS: "false",
    NEXT_PUBLIC_DEBUG: "",
    NEXT_PUBLIC_APP_DEBUG_CONTEXT_FILTER: "",
    NEXT_PUBLIC_DOC_URL: "http://localhost:3020",
    NEXT_PUBLIC_DOC_PORT: "3020",
    REACT_SCAN: "false",
    MILLION_LINT: "false",
    // React Scan (optional)
    REACT_SCAN_GIT_COMMIT_HASH: "",
    REACT_SCAN_GIT_BRANCH: "",
    REACT_SCAN_TOKEN: "",
};

const docMockEnv: EnvMockForSchema<typeof docEnvSchema> = {};

export const mockEnv = {
    // ============================================================================
    // API Mock Environment
    // ============================================================================
    api: apiMockEnv,

    // ============================================================================
    // Web Mock Environment
    // ============================================================================
    web: webMockEnv,

    // ============================================================================
    // Doc Mock Environment
    // ============================================================================
    doc: docMockEnv,
} as const;

export type MockEnvAppName = keyof typeof mockEnv;
export type MockEnvByApp = typeof mockEnv;

/**
 * Get mock environment for a specific app
 */
export function getMockEnv<TAppName extends MockEnvAppName>(
    appName: TAppName
): MockEnvByApp[TAppName] {
    return mockEnv[appName];
}

/**
 * Get all mock environments merged
 */
export function getAllMockEnv(): Record<string, string> {
    return {
        ...mockEnv.api,
        ...mockEnv.web,
        ...mockEnv.doc,
    }
}

/**
 * Merge mock environment with existing environment
 */
export function mergeMockEnv(
    existing: Record<string, string>,
    appName?: MockEnvAppName
): Record<string, string> {
    if (appName) {
        return { ...mockEnv[appName], ...existing }
    }
    return { ...getAllMockEnv(), ...existing }
}
