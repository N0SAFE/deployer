import type { WizardFormData } from './CreateService.schema'

/* ─── DEFAULT VALUES ──────────────────────────────────────────────── */

export const defaultWizardValues: WizardFormData = {
    basicInfo: {
        name: '',
        description: undefined,
        tags: undefined,
    },
    provider: {
        providerId: 'github',
        config: {
            providerAppId: '',
            sourceUrl: '',
            branch: 'main',
            autoSyncEnabled: true,
            webhookEnabled: false,
            authSecretRef: 'default',
        },
    },
    runner: {
        runnerId: 'manual',
        build: {
            method: 'auto',
            rootPath: '/',
            buildContext: '.',
            dockerfilePath: 'Dockerfile',
            composeFile: 'docker-compose.yml',
            buildCommand: '',
            runCommand: '',
        },
        config: {
            strategy: 'rolling',
            startCommand: 'npm start',
            args: [],
            ports: [],
            volumeMounts: [],
            secretRefs: [],
            networkMode: 'bridge',
            gracefulShutdownSeconds: 30,
        },
    },
    network: {
        port: undefined,
        visibility: 'public',
        tls: { enabled: false, httpRedirect: true },
        healthCheck: {
            type: 'http',
            path: '/health',
            method: 'GET',
            expectedStatus: 200,
            headers: {},
            interval: 30,
            timeout: 10,
            retries: 3,
            startPeriod: 0,
            successThreshold: 1,
            failureThreshold: 3,
        },
        customDomains: undefined,
        domainEntries: undefined,
    },
    advanced: { environmentVariables: undefined, resourceLimits: undefined },
}
