import type { DependencyPolicyOverrideMap } from '../types'

function key(serviceId: string, dependsOnServiceId: string) {
  return `${serviceId}:${dependsOnServiceId}`
}

export const MOCK_POLICY_OVERRIDES_BY_PROJECT: Record<string, DependencyPolicyOverrideMap> = {
  'proj-orion-control-plane': {
    [key('svc-edge-proxy', 'svc-gateway-api')]: {
      production: { requirement: 'required', healthGate: 'must-pass', startup: 'before', timeoutSeconds: 40 },
      staging: { requirement: 'required', healthGate: 'must-pass', startup: 'before', timeoutSeconds: 35 },
    },
    [key('svc-gateway-api', 'svc-redis')]: {
      production: { requirement: 'optional', healthGate: 'warn', startup: 'parallel', maxRetries: 1 },
      staging: { requirement: 'disabled', startup: 'parallel' },
      preview: { requirement: 'disabled', startup: 'after', timeoutSeconds: 10 },
    },
    [key('svc-checkout', 'svc-payment-adapter')]: {
      production: {
        requirement: 'required',
        healthGate: 'must-pass',
        startup: 'before',
        maxRetries: 6,
        timeoutSeconds: 90,
      },
      staging: {
        requirement: 'optional',
        healthGate: 'warn',
        startup: 'before',
        maxRetries: 4,
        timeoutSeconds: 70,
      },
    },
  },

  'proj-phoenix-stream': {
    [key('svc-phx-api', 'svc-phx-transcoder')]: {
      production: { requirement: 'disabled', healthGate: 'ignore' },
      staging: { requirement: 'optional', healthGate: 'warn', startup: 'parallel' },
      preview: { requirement: 'optional', healthGate: 'warn', startup: 'parallel' },
    },
    [key('svc-phx-ingest', 'svc-phx-storage')]: {
      production: { requirement: 'required', healthGate: 'must-pass', startup: 'before' },
    },
  },

  'proj-atlas-billing': {
    [key('svc-atlas-dunning', 'svc-atlas-ledger')]: {
      production: { requirement: 'required', healthGate: 'must-pass', startup: 'before' },
      staging: { requirement: 'optional', healthGate: 'warn', startup: 'parallel' },
      development: { requirement: 'disabled', healthGate: 'ignore' },
    },
  },

  'proj-nebula-mlops': {
    [key('svc-nebula-serving', 'svc-nebula-artifacts')]: {
      production: { requirement: 'required', healthGate: 'must-pass', startup: 'before' },
      preview: { requirement: 'optional', healthGate: 'warn', startup: 'parallel' },
    },
  },
}

export function getDependencyPolicyKey(input: { serviceId: string; dependsOnServiceId: string }) {
  return key(input.serviceId, input.dependsOnServiceId)
}