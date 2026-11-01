import { describe, it, expect } from 'vitest';
import { buildTrustedOrigins } from './origins';

describe('buildTrustedOrigins', () => {
    it('returns the public and private app URLs', () => {
        expect(
            buildTrustedOrigins({
                NEXT_PUBLIC_APP_URL: 'http://web.example.com',
                APP_URL: 'http://web-dev:3000',
            }),
        ).toEqual(['http://web.example.com', 'http://web-dev:3000']);
    });

    it('adds explicit TRUSTED_ORIGINS, trimmed and de-duplicated', () => {
        expect(
            buildTrustedOrigins({
                NEXT_PUBLIC_APP_URL: 'http://web.example.com',
                TRUSTED_ORIGINS: ' http://a.com/ , http://a.com, ,http://b.com ',
            }),
        ).toEqual(['http://web.example.com', 'http://a.com', 'http://b.com']);
    });

    // Regression: the API's CORS allowlist ignored AUTH_BASE_DOMAIN while Better
    // Auth derived every subdomain from it. The browser on
    // http://web.deployer.localhost got an allow-origin without
    // allow-credentials on its preflight → PreflightInvalidAllowCredential.
    it('derives every platform subdomain from AUTH_BASE_DOMAIN', () => {
        const origins = buildTrustedOrigins({
            AUTH_BASE_DOMAIN: '.deployer.localhost',
            NEXT_PUBLIC_APP_URL: 'http://web.deployer.localhost',
        });

        expect(origins).toContain('http://web.deployer.localhost');
        expect(origins).toContain('http://api.deployer.localhost');
        expect(origins).toContain('http://setup.deployer.localhost');
        expect(origins).toContain('http://docs.deployer.localhost');
        expect(origins).toContain('http://deployer.localhost');
    });

    it('accepts AUTH_BASE_DOMAIN without a leading dot', () => {
        expect(buildTrustedOrigins({ AUTH_BASE_DOMAIN: 'acme.test' })).toContain(
            'http://web.acme.test',
        );
    });

    it('uses https subdomains when BASE_URL is https', () => {
        const origins = buildTrustedOrigins({
            AUTH_BASE_DOMAIN: '.acme.test',
            BASE_URL: 'https://api.acme.test',
        });

        expect(origins).toContain('https://web.acme.test');
    });

    it('returns an empty list when nothing is configured', () => {
        expect(buildTrustedOrigins({})).toEqual([]);
    });
});
