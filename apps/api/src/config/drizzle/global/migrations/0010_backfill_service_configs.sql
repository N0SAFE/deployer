-- Data migration: Backfill null provider_config / builder_config with defaults.
-- New services will have defaults generated server-side; this fixes existing records.
-- Run after deploying the code change so default factories are available for new services.

-- Provider defaults (all providers): sourceUrl='', branch='main', rootPath='.', buildContext='.',
-- autoSyncEnabled=true, webhookEnabled=true, authSecretRef='default'
UPDATE services
SET provider_config = '{"sourceUrl":"","branch":"main","rootPath":".","buildContext":".","autoSyncEnabled":true,"webhookEnabled":true,"authSecretRef":"default"}'::jsonb
WHERE provider_config IS NULL;

-- Runner defaults: strategy='rolling', startCommand='', args=[], ports=[], volumeMounts=[],
-- secretRefs=[], networkMode='bridge', gracefulShutdownSeconds=30
UPDATE services
SET builder_config = '{"strategy":"rolling","startCommand":"","args":[],"ports":[],"volumeMounts":[],"secretRefs":[],"networkMode":"bridge","gracefulShutdownSeconds":30}'::jsonb
WHERE builder_config IS NULL;
