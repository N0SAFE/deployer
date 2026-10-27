import { describe, expect, it } from 'vitest'
import {
  buildPayload,
  createInitialState,
  formatPortBinding,
  slugify,
  type ContainerFormState,
  type PullScanSummary,
} from './container-form.model'
import { describeErrorField, validateForm } from './container-form.validation'

const summary: PullScanSummary = {
  pullStatus: 'complete',
  scanStatus: 'idle',
  vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 },
}

function valid(patch: Partial<ContainerFormState> = {}): ContainerFormState {
  return { ...createInitialState(), name: 'web-1', image: 'nginx:latest', ...patch }
}

describe('createInitialState', () => {
  it('derives a container name from the prefilled image', () => {
    const state = createInitialState('ghcr.io/org/My_App:1.0')
    expect(state.image).toBe('ghcr.io/org/My_App:1.0')
    expect(state.name).toBe('my-app-1-0-run')
  })
})

describe('slugify', () => {
  it('lowercases and collapses separators', () => {
    expect(slugify('  Hello World! ')).toBe('hello-world')
  })
})

describe('validateForm', () => {
  it('accepts a minimal valid form', () => {
    expect(validateForm(valid())).toEqual({})
  })

  it('requires a name and an image', () => {
    const errors = validateForm(createInitialState())
    expect(errors.name).toBeDefined()
    expect(errors.image).toBeDefined()
  })

  it('rejects an invalid container name and an image with spaces', () => {
    const errors = validateForm(valid({ name: '-bad name', image: 'nginx latest' }))
    expect(errors.name).toBeDefined()
    expect(errors.image).toBeDefined()
  })

  it('validates port numbers per field', () => {
    const errors = validateForm(valid({ ports: [
      { hostPort: '0', containerPort: '70000', protocol: 'tcp' },
      { hostPort: 'abc', containerPort: '80', protocol: 'tcp' },
    ] }))
    expect(errors['ports.0.hostPort']).toBeDefined()
    expect(errors['ports.0.containerPort']).toBeDefined()
    expect(errors['ports.1.hostPort']).toBeDefined()
    expect(errors['ports.1.containerPort']).toBeUndefined()
  })

  it('ignores fully blank rows but flags half-filled ones', () => {
    const blank = validateForm(valid())
    expect(Object.keys(blank)).toHaveLength(0)
    const half = validateForm(valid({ ports: [{ hostPort: '8080', containerPort: '', protocol: 'tcp' }] }))
    expect(half['ports.0.containerPort']).toBeDefined()
    expect(half['ports.0.hostPort']).toBeUndefined()
  })

  it('flags a host port published twice on the same protocol only', () => {
    const dup = validateForm(valid({ ports: [
      { hostPort: '80', containerPort: '80', protocol: 'tcp' },
      { hostPort: '80', containerPort: '81', protocol: 'tcp' },
    ] }))
    expect(dup['ports.1.hostPort']).toMatch(/already published/)
    const udp = validateForm(valid({ ports: [
      { hostPort: '53', containerPort: '53', protocol: 'tcp' },
      { hostPort: '53', containerPort: '53', protocol: 'udp' },
    ] }))
    expect(udp).toEqual({})
  })

  it('validates environment variable keys and duplicates', () => {
    const errors = validateForm(valid({ envVars: [
      { key: '1BAD', value: 'x' },
      { key: 'GOOD_KEY', value: '1' },
      { key: 'GOOD_KEY', value: '2' },
      { key: '', value: 'orphan' },
    ] }))
    expect(errors['envVars.0.key']).toBeDefined()
    expect(errors['envVars.1.key']).toBeUndefined()
    expect(errors['envVars.2.key']).toMatch(/already set/)
    expect(errors['envVars.3.key']).toBeDefined()
  })

  it('requires absolute container paths for volumes and accepts named volumes as source', () => {
    const errors = validateForm(valid({ volumes: [
      { hostPath: 'data', containerPath: '/var/lib/data', mode: 'rw' },
      { hostPath: '/srv/x', containerPath: 'relative', mode: 'ro' },
      { hostPath: '/srv/y', containerPath: '/var/lib/data', mode: 'ro' },
    ] }))
    expect(errors['volumes.0.hostPath']).toBeUndefined()
    expect(errors['volumes.1.containerPath']).toBeDefined()
    expect(errors['volumes.2.containerPath']).toMatch(/already a mount target/)
  })

  it('validates resources and the reservation/limit relation', () => {
    const errors = validateForm(valid({ memoryLimitMb: '256', memoryReservationMb: '512', cpuLimit: '0', cpuShares: '1' }))
    expect(errors.memoryReservationMb).toBeDefined()
    expect(errors.cpuLimit).toBeDefined()
    expect(errors.cpuShares).toBeDefined()
  })

  it('validates healthcheck, cron and max retries only when relevant', () => {
    expect(validateForm(valid({ healthcheckCommand: '', restartMaxRetries: 'x' }))).toEqual({})
    const errors = validateForm(valid({
      healthcheckEnabled: true,
      healthcheckCommand: ' ',
      healthcheckIntervalSec: '0',
      autoUpdateEnabled: true,
      autoUpdateCron: '* *',
      restartPolicy: 'on-failure',
      restartMaxRetries: '-1',
    }))
    expect(errors.healthcheckCommand).toBeDefined()
    expect(errors.healthcheckIntervalSec).toBeDefined()
    expect(errors.autoUpdateCron).toBeDefined()
    expect(errors.restartMaxRetries).toBeDefined()
  })

  it('checks ulimit ordering', () => {
    const errors = validateForm(valid({ ulimits: [{ name: 'nofile', soft: '2000', hard: '1000' }] }))
    expect(errors['ulimits.0.soft']).toMatch(/cannot exceed/)
  })
})

describe('buildPayload', () => {
  it('drops blank rows, trims text and parses numbers', () => {
    const payload = buildPayload(valid({
      name: ' web-1 ',
      ports: [{ hostPort: '8080', containerPort: '80', protocol: 'tcp' }, { hostPort: '', containerPort: '', protocol: 'tcp' }],
      envVars: [{ key: 'A', value: '1' }, { key: '', value: '' }],
      memoryLimitMb: '512',
      cpuLimit: '',
      restartPolicy: 'on-failure',
      restartMaxRetries: '3',
    }), summary)
    expect(payload.name).toBe('web-1')
    expect(payload.ports).toHaveLength(1)
    expect(payload.envVars).toEqual([{ key: 'A', value: '1' }])
    expect(payload.memoryLimitMb).toBe(512)
    expect(payload.cpuLimit).toBeNull()
    expect(payload.restartMaxRetries).toBe(3)
    expect(payload.pullScanSummary).toBe(summary)
  })

  it('only keeps max retries for the on-failure policy', () => {
    expect(buildPayload(valid({ restartPolicy: 'always', restartMaxRetries: '3' }), summary).restartMaxRetries).toBeNull()
  })
})

describe('describeErrorField / formatPortBinding', () => {
  it('names the row in one-based form', () => {
    expect(describeErrorField('ports.1.hostPort')).toBe('Port 2 (hostPort)')
    expect(describeErrorField('envVars.0.key')).toBe('Environment variable 1')
    expect(describeErrorField('name')).toBe('Container name')
  })

  it('formats a binding', () => {
    expect(formatPortBinding({ hostPort: ' 8080', containerPort: '80 ', protocol: 'udp' })).toBe('8080:80/udp')
  })
})
