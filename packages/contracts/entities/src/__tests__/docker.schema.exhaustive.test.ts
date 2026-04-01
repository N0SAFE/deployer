import { describe, expect, it } from 'vitest'
import {
  dockerPortBindingSchema,
  dockerContainerMetricPointSchema,
  dockerNetworkDiagnosticsSchema,
  dockerComposeDependencyEntrySchema,
  dockerContainerRuntimeConfigSchema,
  dockerOperationProgressItemSchema,
  dockerContainerInspectDetailSchema,
} from '../entities/docker.schema'

describe('docker schema exhaustive validation', () => {
  describe('dockerPortBindingSchema bounds', () => {
    it.each([
      [{ containerPort: 80, hostPort: 8080, protocol: 'tcp' }, true],
      [{ containerPort: 65535, hostPort: null, protocol: 'udp' }, true],
      [{ containerPort: 0, hostPort: 8080, protocol: 'tcp' }, false],
      [{ containerPort: 70000, hostPort: 8080, protocol: 'tcp' }, false],
    ])('validates port binding %#', (payload, expected) => {
      expect(dockerPortBindingSchema.safeParse(payload).success).toBe(expected)
    })
  })

  describe('dockerContainerMetricPointSchema bounds', () => {
    it.each([
      [{ at: '2026-03-27T10:00:00Z', cpu: 0, memory: 0, networkRxKb: 0, networkTxKb: 0, ioReadKb: 0, ioWriteKb: 0 }, true],
      [{ at: '2026-03-27T10:00:00Z', cpu: 100, memory: 100, networkRxKb: 1, networkTxKb: 1, ioReadKb: 1, ioWriteKb: 1 }, true],
      [{ at: '2026-03-27T10:00:00Z', cpu: 101, memory: 50, networkRxKb: 1, networkTxKb: 1, ioReadKb: 1, ioWriteKb: 1 }, false],
      [{ at: '2026-03-27T10:00:00Z', cpu: 50, memory: -1, networkRxKb: 1, networkTxKb: 1, ioReadKb: 1, ioWriteKb: 1 }, false],
    ])('validates metric point %#', (payload, expected) => {
      expect(dockerContainerMetricPointSchema.safeParse(payload).success).toBe(expected)
    })
  })

  it('enforces network diagnostics score range', () => {
    expect(dockerNetworkDiagnosticsSchema.safeParse({ dnsResolution: 'ok', connectivityScore: 100, notes: [] }).success).toBe(true)
    expect(dockerNetworkDiagnosticsSchema.safeParse({ dnsResolution: 'degraded', connectivityScore: -1, notes: [] }).success).toBe(false)
  })

  it('enforces compose dependency condition enum', () => {
    expect(
      dockerComposeDependencyEntrySchema.safeParse({ service: 'db', condition: 'service_healthy', required: true }).success,
    ).toBe(true)

    expect(
      dockerComposeDependencyEntrySchema.safeParse({ service: 'db', condition: 'invalid_condition', required: true }).success,
    ).toBe(false)
  })

  it('enforces runtime config positive healthcheck values when provided', () => {
    const valid = dockerContainerRuntimeConfigSchema.safeParse({
      user: null,
      workingDir: null,
      entrypoint: [],
      command: [],
      restartPolicy: 'always',
      restartMaxRetries: null,
      privileged: false,
      readOnlyRootFs: false,
      oomKillDisable: false,
      ipcMode: null,
      pidMode: null,
      networkMode: null,
      cgroupnsMode: null,
      watchMode: 'disabled',
      healthcheckCommand: null,
      healthcheckIntervalSec: 10,
      healthcheckTimeoutSec: 5,
      healthcheckRetries: 3,
    })
    expect(valid.success).toBe(true)

    const invalid = dockerContainerRuntimeConfigSchema.safeParse({
      user: null,
      workingDir: null,
      entrypoint: [],
      command: [],
      restartPolicy: 'always',
      restartMaxRetries: null,
      privileged: false,
      readOnlyRootFs: false,
      oomKillDisable: false,
      ipcMode: null,
      pidMode: null,
      networkMode: null,
      cgroupnsMode: null,
      watchMode: 'disabled',
      healthcheckCommand: null,
      healthcheckIntervalSec: 0,
      healthcheckTimeoutSec: 5,
      healthcheckRetries: 3,
    })
    expect(invalid.success).toBe(false)
  })

  it('enforces operation progress percent range', () => {
    expect(
      dockerOperationProgressItemSchema.safeParse({
        id: 'op_1',
        action: 'pull',
        resourceName: 'image:latest',
        resourceType: 'images',
        status: 'running',
        progress: 50,
        updatedAt: '2026-03-27T10:00:00Z',
      }).success,
    ).toBe(true)

    expect(
      dockerOperationProgressItemSchema.safeParse({
        id: 'op_1',
        action: 'pull',
        resourceName: 'image:latest',
        resourceType: 'images',
        status: 'running',
        progress: 120,
        updatedAt: '2026-03-27T10:00:00Z',
      }).success,
    ).toBe(false)
  })

  it('validates deep inspect payload shape', () => {
    const result = dockerContainerInspectDetailSchema.safeParse({
      containerId: 'ctr_1',
      generatedAt: '2026-03-27T10:00:00Z',
      layers: [{ id: 'layer_1', instruction: 'RUN bun install', size: '120MB', createdAt: '2026-03-27T09:00:00Z' }],
      processes: [
        {
          pid: 1,
          user: 'root',
          cpuPercent: 1,
          memoryPercent: 2,
          state: 'running',
          startedAt: '2026-03-27T10:00:00Z',
          command: 'bun start',
        },
      ],
      streamingLogsSupported: true,
      networkConfig: [
        {
          networkId: 'net_1',
          name: 'default',
          driver: 'bridge',
          scope: 'local',
          ipv4: null,
          ipv6: null,
          gateway: null,
          macAddress: null,
          aliases: [],
          dnsServers: [],
          dnsSearch: [],
          dnsOptions: [],
          extraHosts: [],
        },
      ],
      portMappings: [{ containerPort: 3000, hostIp: '127.0.0.1', hostPort: 3000, protocol: 'tcp', url: null }],
      mounts: [
        {
          type: 'bind',
          mountName: null,
          source: '/host/path',
          target: '/container/path',
          readOnly: false,
          propagation: null,
          mode: null,
          sizeBytes: null,
        },
      ],
      environment: [{ key: 'NODE_ENV', value: 'production', masked: false, source: 'runtime' }],
      runtimeConfig: {
        user: null,
        workingDir: null,
        entrypoint: [],
        command: [],
        restartPolicy: 'always',
        restartMaxRetries: null,
        privileged: false,
        readOnlyRootFs: false,
        oomKillDisable: false,
        ipcMode: null,
        pidMode: null,
        networkMode: null,
        cgroupnsMode: null,
        watchMode: 'disabled',
        healthcheckCommand: null,
        healthcheckIntervalSec: null,
        healthcheckTimeoutSec: null,
        healthcheckRetries: null,
      },
      composeConfig: null,
    })

    expect(result.success).toBe(true)
  })
})
