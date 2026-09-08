import { beforeAll, beforeEach, afterAll, vi } from 'vitest';
import 'reflect-metadata';

// Set up test environment variables BEFORE any other imports to ensure they're available
// when modules are loaded and the env schema is validated.
// ConfigModule.forRoot({ validate }) runs envSchema.parse(process.env) during module init.
// In test mode, process.env may lack many MANAGED_* vars. We override the EnvModule
// at the NestJS level to skip validation — see the mock below.
process.env.NODE_ENV = 'test';
process.env.API_PORT = '3001';
process.env.AUTH_SECRET = 'mock-auth-secret-key-for-development-only-change-in-production';
process.env.BETTER_AUTH_SECRET = 'mock-auth-secret-key-for-development-only-change-in-production';
process.env.DEV_AUTH_KEY = 'mock-dev-auth-key-for-development-only';
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3005';
process.env.DEFAULT_ADMIN_EMAIL = 'admin@admin.com';
process.env.DEFAULT_ADMIN_PASSWORD = 'adminadmin';
process.env.SETUP_AUTO = 'false';
process.env.ADMIN_BOOTSTRAP = 'auto';
process.env.ENABLE_SEEDING = 'false';
process.env.ENABLE_DEV_BOOTSTRAP = 'true';
process.env.SKIP_MIGRATIONS = 'false';
process.env.DISABLE_AUTO_SCAN = 'false';
process.env.SETUP_DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.NODE_LOCAL_DB_PATH = process.env.NODE_LOCAL_DB_PATH ?? '/tmp/deployer-api-unit-local.db';

// Managed services — nested object fields require explicit env vars because
// ConfigModule.forRoot({ validate }) → envSchema.parse(process.env) and
// splitManagedEnv() construct nested objects from flat MANAGED_* env strings.
process.env.MANAGED_WEB_APP_EXTERNAL = 'false';
process.env.MANAGED_WEB_APP_ENABLED = 'true';
process.env.MANAGED_GLOBAL_DB_ENABLED = 'false';
process.env.MANAGED_REDIS_ENABLED = 'false';
process.env.MANAGED_LOCAL_DB_ENABLED = 'false';
process.env.MANAGED_TRAEFIK_ENABLED = 'false';
process.env.MANAGED_WIREGUARD_ENABLED = 'false';
process.env.MANAGED_DATABASE_ENABLED = 'false';
process.env.DOCKER_PORT = '2375';
process.env.APP_URL = 'http://localhost:3000';
process.env.APP_DOCKER_IMAGE_SCAN_PARALLELISM = '1';
process.env.APP_DOCKER_IMAGE_SCAN_IMAGE_PARALLELISM = '1';
process.env.DEPLOYER_TRAEFIK_HTTP_PORT = '80';
process.env.DEPLOYER_TRAEFIK_TLS_ENABLED = 'false';
process.env.MANAGED_TRAEFIK_HTTP_PORT = '80';
process.env.MANAGED_TRAEFIK_TLS_ENABLED = 'false';

// Global test setup for NestJS API
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
});

// Mock environment variables for testing
beforeAll(() => {
  // Mock console methods for cleaner test output
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Mock external dependencies
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({
    api: {
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
    },
    handler: vi.fn(),
  })),
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

// Mock database connection
vi.mock('./src/db/database-connection', () => ({
  DATABASE_CONNECTION: 'DATABASE_CONNECTION',
}));

// Mock OS hostname for logger middleware
vi.mock('os', () => ({
  hostname: vi.fn(() => 'test-hostname'),
}));

// Mock @orpc/nest for controller testing
vi.mock('@orpc/nest', () => ({
  Implement: vi.fn(() => (target: any, propertyKey: string) => {}),
  implement: vi.fn((contract: any) => ({
    handler: vi.fn((handlerFn: Function) => {
      // Return a handler that preserves the original function context
      return {
        handler: handlerFn,
      };
    }),
  })),
}));