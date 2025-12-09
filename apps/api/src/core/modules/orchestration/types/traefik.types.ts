/**
 * Traefik Orchestration Types
 * 
 * These types are used by the TraefikOrchestrationService for Docker Compose
 * generation and domain mapping.
 * 
 * @deprecated Consider using TraefikCoreModule types when migrating
 */

export interface TraefikConfig {
    projectId: string;
    environment: string;
    stackName: string;
    services: Record<string, {
        image: string;
        domains: string[];
        port: number;
        healthCheck?: string;
        middleware?: string[];
    }>;
    sslConfig?: {
        email: string;
        provider: 'letsencrypt' | 'cloudflare' | 'custom';
        staging?: boolean;
    };
}

export interface DomainMapping {
    domain: string;
    service: string;
    port: number;
    path?: string;
    middleware?: string[];
}
