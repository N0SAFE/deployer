import { describe, it, expect } from 'vitest';
import { normalizeUrl, buildAllowedOrigins, isLocalhostOrigin, resolveCorsDecision } from './cors.utils';

describe('cors.utils', () => {
  describe('normalizeUrl', () => {
    it('should remove trailing slash from URLs', () => {
      expect(normalizeUrl('http://localhost:3000/')).toBe('http://localhost:3000');
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
      expect(normalizeUrl('http://api.example.com:3001/')).toBe('http://api.example.com:3001');
    });

    it('should leave URLs without trailing slash unchanged', () => {
      expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
      expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    });

    it('should handle empty strings', () => {
      expect(normalizeUrl('')).toBe('');
    });
  });

  describe('isLocalhostOrigin', () => {
    it('should identify localhost URLs', () => {
      expect(isLocalhostOrigin('http://localhost')).toBe(true);
      expect(isLocalhostOrigin('http://localhost:3000')).toBe(true);
      expect(isLocalhostOrigin('https://localhost:8080')).toBe(true);
    });

    it('should identify 127.0.0.1 URLs', () => {
      expect(isLocalhostOrigin('http://127.0.0.1')).toBe(true);
      expect(isLocalhostOrigin('http://127.0.0.1:3000')).toBe(true);
      expect(isLocalhostOrigin('https://127.0.0.1:8080')).toBe(true);
    });

    it('should reject non-localhost URLs', () => {
      expect(isLocalhostOrigin('http://example.com')).toBe(false);
      expect(isLocalhostOrigin('http://192.168.1.1')).toBe(false);
      expect(isLocalhostOrigin('https://api.production.com')).toBe(false);
    });
  });

  describe('buildAllowedOrigins', () => {
    it('should build origins from NEXT_PUBLIC_APP_URL', () => {
      const env = { NEXT_PUBLIC_APP_URL: 'http://localhost:3000/' };
      expect(buildAllowedOrigins(env)).toEqual(['http://localhost:3000']);
    });

    it('should include APP_URL if different from NEXT_PUBLIC_APP_URL', () => {
      const env = {
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        APP_URL: 'http://web-dev:3000'
      };
      expect(buildAllowedOrigins(env)).toEqual([
        'http://localhost:3000',
        'http://web-dev:3000'
      ]);
    });

    it('should not duplicate APP_URL if same as NEXT_PUBLIC_APP_URL', () => {
      const env = {
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        APP_URL: 'http://localhost:3000'
      };
      expect(buildAllowedOrigins(env)).toEqual(['http://localhost:3000']);
    });

    it('should parse TRUSTED_ORIGINS correctly', () => {
      const env = {
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        TRUSTED_ORIGINS: 'http://example.com, https://app.example.com/'
      };
      expect(buildAllowedOrigins(env)).toEqual([
        'http://localhost:3000',
        'http://example.com',
        'https://app.example.com'
      ]);
    });

    it('should handle empty TRUSTED_ORIGINS gracefully', () => {
      const env = {
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        TRUSTED_ORIGINS: '  ,  , '
      };
      expect(buildAllowedOrigins(env)).toEqual(['http://localhost:3000']);
    });

    it('should return default localhost:3000 if no origins configured', () => {
      expect(buildAllowedOrigins({})).toEqual(['http://localhost:3000']);
    });

    it('should normalize all origins', () => {
      const env = {
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000/',
        APP_URL: 'http://web-dev:3000/',
        TRUSTED_ORIGINS: 'http://example.com/, https://app.example.com/'
      };
      expect(buildAllowedOrigins(env)).toEqual([
        'http://localhost:3000',
        'http://web-dev:3000',
        'http://example.com',
        'https://app.example.com'
      ]);
    });
  });

  describe('resolveCorsDecision', () => {
    const allowedOrigins = ['http://localhost:3000', 'https://app.example.com'];

    it('skips CORS headers entirely for same-origin (no Origin header)', () => {
      expect(
        resolveCorsDecision({ origin: undefined, hasCookieHeader: true, allowedOrigins, isDevelopment: false })
      ).toEqual({ allowOrigin: false, allowCredentials: false });
    });

    it('reflects allowlisted origins with credentials', () => {
      expect(
        resolveCorsDecision({ origin: 'https://app.example.com', hasCookieHeader: true, allowedOrigins, isDevelopment: false })
      ).toEqual({ allowOrigin: true, allowCredentials: true });
    });

    it('treats localhost variants as allowlisted in development only', () => {
      const input = { origin: 'http://localhost:4200', hasCookieHeader: false, allowedOrigins };
      expect(resolveCorsDecision({ ...input, isDevelopment: true })).toEqual({ allowOrigin: true, allowCredentials: true });
      expect(resolveCorsDecision({ ...input, isDevelopment: false })).toEqual({ allowOrigin: true, allowCredentials: false });
    });

    it('BLOCKS untrusted cross-origin requests that carry cookies', () => {
      // The security boundary: ambient/stolen cookies can never read responses
      // from an unknown origin.
      expect(
        resolveCorsDecision({
          origin: 'https://evil.example.net',
          hasCookieHeader: true,
          allowedOrigins,
          isDevelopment: false,
        })
      ).toEqual({ allowOrigin: false, allowCredentials: false });
    });

    it('reflects cookie-free token-path requests from any origin WITHOUT credentials', () => {
      // This is the BYO web-app path: possession of the app-instance token
      // (a header) replaces origin configuration.
      expect(
        resolveCorsDecision({
          origin: 'https://consumer-machine.example.net',
          hasCookieHeader: false,
          allowedOrigins,
          isDevelopment: false,
        })
      ).toEqual({ allowOrigin: true, allowCredentials: false });
    });

    it('normalizes the incoming origin before matching', () => {
      expect(
        resolveCorsDecision({ origin: 'https://app.example.com/', hasCookieHeader: false, allowedOrigins, isDevelopment: false })
      ).toEqual({ allowOrigin: true, allowCredentials: true });
    });
  });
});
