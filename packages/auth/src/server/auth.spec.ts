import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { multiSession } from 'better-auth/plugins';
import { betterAuthFactory } from './auth';
import { loginAsPlugin, masterTokenPlugin } from './plugins';

// Mock better-auth
vi.mock('better-auth', () => ({
  betterAuth: vi.fn((options: unknown) => ({
    options,
    api: {
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
    },
    handler: vi.fn(),
  })),
}));

// Mock drizzle adapter
vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn((db: unknown, options: any) => ({
    db,
    ...options,
  })),
}));

// Mock better-auth/plugins
vi.mock('better-auth/plugins', () => ({
  openAPI: vi.fn(() => ({ id: 'openAPI' })),
  admin: vi.fn(() => ({ id: 'admin' })),
  multiSession: vi.fn(() => ({ id: 'multi-session' })),
}));

// Mock plugins - all server plugins are now exported from ./plugins
vi.mock('./plugins', () => ({
  useAdmin: vi.fn(() => ({ id: 'admin' })),
  useApiKey: vi.fn(() => ({ id: 'api-key' })),
  useInvite: vi.fn(() => ({ id: 'invite' })),
  usePasskey: vi.fn(() => ({ id: 'passkey' })),
  useTwoFactor: vi.fn(() => ({ id: 'two-factor' })),
  useDeviceAuthorization: vi.fn(() => ({ id: 'device-authorization' })),
  useLastLoginMethod: vi.fn(() => ({ id: 'last-login-method' })),
  masterTokenPlugin: vi.fn(() => ({ id: 'masterToken' })),
  loginAsPlugin: vi.fn(() => ({ id: 'loginAs' })),
  pushNotificationsPlugin: vi.fn(() => ({ id: 'pushNotifications' })),
}));

describe('betterAuthFactory', () => {
  let mockDb: ReturnType<typeof drizzle.mock>;
  let mockEnv: {
    DEV_AUTH_KEY: string | undefined;
    DEFAULT_ADMIN_EMAIL: string | undefined;
    NODE_ENV: string;
    ENABLE_MASTER_TOKEN?: boolean;
    BETTER_AUTH_SECRET?: string;
    BASE_URL?: string;
    APP_URL?: string;
    NEXT_PUBLIC_APP_URL?: string;
    TRUSTED_ORIGINS?: string;
    AUTH_BASE_DOMAIN?: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Shape-correct fake DB: `drizzle.mock()` returns the same NodePgDatabase
    // type the factory accepts, so the spec exercises the real signature
    // instead of silencing an `object`-vs-database mismatch at every call.
    mockDb = drizzle.mock();
    
    mockEnv = {
      DEV_AUTH_KEY: undefined,
      DEFAULT_ADMIN_EMAIL: undefined,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'test-better-auth-secret',
      BASE_URL: 'http://localhost:3001',
      APP_URL: 'http://localhost:3000',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    };
  });

  describe('Basic Factory Creation', () => {
    it('should create auth instance', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result).toBeDefined();
      expect(result.auth).toBeDefined();
    });

    it('should configure betterAuth with secret', () => {
      const result = betterAuthFactory(mockDb, mockEnv);
      
      expect(result.auth.config).toBeDefined();
      expect(result.auth.config.secret).toBe('test-better-auth-secret');
    });

    it('should configure betterAuth with baseURL', () => {
      const result = betterAuthFactory(mockDb, mockEnv);
      
      expect(result.auth.config.baseURL).toBe('http://localhost:3001');
    });
  });

  describe('Trusted Origins Configuration', () => {
    it('should include APP_URL in trusted origins', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.trustedOrigins).toContain('http://localhost:3000');
    });

    it('should include NEXT_PUBLIC_APP_URL in trusted origins', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.trustedOrigins).toContain('http://localhost:3000');
    });

    it('should add additional trusted origins when provided', () => {
      mockEnv.TRUSTED_ORIGINS = 'http://custom-origin.com,http://another.com';
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.trustedOrigins).toContain('http://custom-origin.com');
      expect(result.auth.config.trustedOrigins).toContain('http://another.com');
    });

    it('should handle comma-separated trusted origins with whitespace', () => {
      mockEnv.TRUSTED_ORIGINS = '  http://a.com  ,  http://b.com  ';
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.trustedOrigins).toContain('http://a.com');
      expect(result.auth.config.trustedOrigins).toContain('http://b.com');
    });
  });

  describe('Security Configuration', () => {
    it('should use secure cookies for HTTPS', () => {
      mockEnv.BASE_URL = 'https://api.example.com';
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.advanced.useSecureCookies).toBe(true);
    });

    it('should not use secure cookies for HTTP', () => {
      mockEnv.BASE_URL = 'http://localhost:3001';
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.advanced.useSecureCookies).toBe(false);
    });

    it('should enable cross-subdomain cookies with AUTH_BASE_DOMAIN (HTTP + HTTPS)', () => {
      // HTTPS
      mockEnv.BASE_URL = 'https://api.example.com';
      mockEnv.AUTH_BASE_DOMAIN = '.example.com';
      let result = betterAuthFactory(mockDb, mockEnv);
      expect(result.auth.config.advanced.crossSubDomainCookies.enabled).toBe(true);
      expect(result.auth.config.advanced.crossSubDomainCookies.domain).toBe('.example.com');

      // HTTP (dev: api.* + web.* share the session cookie over http)
      mockEnv.BASE_URL = 'http://api.deployer.localhost';
      mockEnv.AUTH_BASE_DOMAIN = '.deployer.localhost';
      result = betterAuthFactory(mockDb, mockEnv);
      expect(result.auth.config.advanced.crossSubDomainCookies.enabled).toBe(true);
      expect(result.auth.config.advanced.crossSubDomainCookies.domain).toBe('.deployer.localhost');
      // …but never Secure over HTTP
      expect(result.auth.config.advanced.useSecureCookies).toBe(false);
    });

    it('should not enable cross-subdomain cookies without AUTH_BASE_DOMAIN', () => {
      mockEnv.BASE_URL = 'https://api.example.com';
      delete mockEnv.AUTH_BASE_DOMAIN;
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.advanced.crossSubDomainCookies.enabled).toBe(false);
    });
  });

  describe('Development Mode', () => {
    it('should enable master token plugin in development with DEV_AUTH_KEY and DEFAULT_ADMIN_EMAIL', () => {
      mockEnv.NODE_ENV = 'development';
      mockEnv.DEV_AUTH_KEY = 'test-dev-key';
      mockEnv.DEFAULT_ADMIN_EMAIL = 'test@example.com';
      mockEnv.ENABLE_MASTER_TOKEN = true;
      
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.plugins).toBeDefined();
      expect(vi.mocked(masterTokenPlugin)).toHaveBeenCalledTimes(1);
    });

    it('should enable loginAs plugin in development with DEV_AUTH_KEY', () => {
      mockEnv.NODE_ENV = 'development';
      mockEnv.DEV_AUTH_KEY = 'test-dev-key';
      
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.plugins).toBeDefined();
      expect(vi.mocked(loginAsPlugin)).toHaveBeenCalledTimes(1);
    });

    it('does not register either dev plugin in production, even with a key and the flag', () => {
      // AUTH-003 / AUTH-004. Both plugins are a platform-wide auth bypass: the
      // master token authenticates as the master account from a static header,
      // login-as mints a session for ANY user id. Production must not have them
      // at all — not merely with `enabled: false`.
      mockEnv.NODE_ENV = 'production';
      mockEnv.DEV_AUTH_KEY = 'test-dev-key';
      mockEnv.DEFAULT_ADMIN_EMAIL = 'test@example.com';
      mockEnv.ENABLE_MASTER_TOKEN = true;

      const result = betterAuthFactory(mockDb, mockEnv);

      expect(vi.mocked(masterTokenPlugin)).not.toHaveBeenCalled();
      expect(vi.mocked(loginAsPlugin)).not.toHaveBeenCalled();
      const ids = (result.auth.config.plugins as { id: string }[]).map((plugin) => plugin.id);
      expect(ids).not.toContain('masterToken');
      expect(ids).not.toContain('loginAs');
    });

    it('does not register the master token without the explicit flag', () => {
      // AUTH-004. Presence of DEV_AUTH_KEY used to enable it on its own.
      mockEnv.NODE_ENV = 'development';
      mockEnv.DEV_AUTH_KEY = 'test-dev-key';
      mockEnv.DEFAULT_ADMIN_EMAIL = 'test@example.com';

      betterAuthFactory(mockDb, mockEnv);

      expect(vi.mocked(masterTokenPlugin)).not.toHaveBeenCalled();
    });
  });

  describe('Database Configuration', () => {
    it('should configure drizzle adapter', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.database).toBeDefined();
    });
  });

  describe('Email and Password Configuration', () => {
    it('should enable email and password by default', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.emailAndPassword).toBeDefined();
      expect(result.auth.config.emailAndPassword.enabled).toBe(true);
    });

    it('refuses public sign-up while keeping sign-in enabled', () => {
      // AUTH-001. Sign-IN must keep working; `POST /sign-up/email` must not be a
      // way to mint an account. Better Auth 1.7.7 checks
      // `emailAndPassword.disableSignUp` at the top of the sign-up endpoint.
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.emailAndPassword.disableSignUp).toBe(true);
      expect(result.auth.config.emailAndPassword.enabled).toBe(true);
    });

    it('does not accept `role` from a sign-up payload', () => {
      // AUTH-001. `input: true` let an anonymous caller name its own platform
      // role. Roles are written server-side (admin bootstrap, invite, `setRole`).
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.user.additionalFields.role.input).toBe(false);
    });
  });

  describe('Session Configuration', () => {
    it('should configure session with cookie cache', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.session).toBeDefined();
      expect(result.auth.config.session.cookieCache).toBeDefined();
    });

    it('should enable cookie cache', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.session.cookieCache.enabled).toBe(true);
    });

    it('should set cookie cache maxAge to 5 minutes', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.session.cookieCache.maxAge).toBe(300);
    });
  });

  describe('Plugin Configuration', () => {
    it('should include all required plugins', () => {
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result.auth.config.plugins).toBeDefined();
      expect(Array.isArray(result.auth.config.plugins)).toBe(true);
    });

    it('should register multi-session so one browser can hold several accounts', () => {
      betterAuthFactory(mockDb, mockEnv);

      expect(vi.mocked(multiSession)).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing BETTER_AUTH_SECRET', () => {
      delete mockEnv.BETTER_AUTH_SECRET;
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result).toBeDefined();
    });

    it('should handle missing BASE_URL', () => {
      delete mockEnv.BASE_URL;
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result).toBeDefined();
    });

    it('should handle missing APP_URL', () => {
      delete mockEnv.APP_URL;
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result).toBeDefined();
    });

    it('should handle empty TRUSTED_ORIGINS', () => {
      mockEnv.TRUSTED_ORIGINS = '';
      const result = betterAuthFactory(mockDb, mockEnv);

      expect(result).toBeDefined();
    });
  });
});
