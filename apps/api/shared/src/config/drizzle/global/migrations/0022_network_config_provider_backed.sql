-- 0022_network_config_provider_backed.sql
-- Provider-backed network configuration for projects and services.
-- projects.network: { dnsProviderId, zoneId, zoneName, autoProvisionRecords, proxiedDefault, wildcardSubdomains, recordType, recordContent }
-- services.network: { dnsProviderId, zoneId, zoneName, recordType, recordContent, proxied, autoProvision, expose, tls }

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "network" jsonb;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "network" jsonb;
