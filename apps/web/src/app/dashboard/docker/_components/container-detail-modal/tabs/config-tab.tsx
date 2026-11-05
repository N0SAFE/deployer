import { Badge } from '@deployer/ui/components/shadcn/badge'

interface RuntimeConfig {
    watchMode: string | null
    restartPolicy: string | null
    networkMode: string | null
    user: string | null
    workingDir: string | null
    entrypoint: string[]
    command: string[]
    privileged: boolean
    readOnlyRootFs: boolean
    oomKillDisable: boolean
    ipcMode: string | null
    pidMode: string | null
    cgroupnsMode: string | null
    healthcheckCommand: string | null
    healthcheckIntervalSec: number | null
    healthcheckTimeoutSec: number | null
    healthcheckRetries: number | null
}

interface DockerContainerConfigTabProps {
    runtimeConfig: RuntimeConfig | null
}

export function DockerContainerConfigTab({
    runtimeConfig,
}: DockerContainerConfigTabProps) {
    return (
        <div className="space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border p-3">
                    <p className="text-muted-foreground text-xs">Watch mode</p>
                    <p className="mt-1 font-medium">
                        {runtimeConfig?.watchMode ?? 'disabled'}
                    </p>
                </div>
                <div className="rounded border p-3">
                    <p className="text-muted-foreground text-xs">
                        Restart policy
                    </p>
                    <p className="mt-1 font-medium">
                        {runtimeConfig?.restartPolicy ?? 'n/a'}
                    </p>
                </div>
                <div className="rounded border p-3">
                    <p className="text-muted-foreground text-xs">
                        Network mode
                    </p>
                    <p className="mt-1 font-medium">
                        {runtimeConfig?.networkMode ?? 'bridge'}
                    </p>
                </div>
            </div>
            <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                    <tbody>
                        {[
                            {
                                key: 'User',
                                value: runtimeConfig?.user ?? 'default',
                            },
                            {
                                key: 'Working directory',
                                value: runtimeConfig?.workingDir ?? '/',
                            },
                            {
                                key: 'Entrypoint',
                                value:
                                    (runtimeConfig?.entrypoint ?? []).join(
                                        ' '
                                    ) || '—',
                            },
                            {
                                key: 'Command',
                                value:
                                    (runtimeConfig?.command ?? []).join(' ') ||
                                    '—',
                            },
                            {
                                key: 'Privileged',
                                value: runtimeConfig?.privileged
                                    ? 'true'
                                    : 'false',
                            },
                            {
                                key: 'Readonly rootfs',
                                value: runtimeConfig?.readOnlyRootFs
                                    ? 'true'
                                    : 'false',
                            },
                            {
                                key: 'OOM kill disable',
                                value: runtimeConfig?.oomKillDisable
                                    ? 'true'
                                    : 'false',
                            },
                            {
                                key: 'IPC mode',
                                value: runtimeConfig?.ipcMode ?? 'default',
                            },
                            {
                                key: 'PID mode',
                                value: runtimeConfig?.pidMode ?? 'default',
                            },
                            {
                                key: 'Cgroupns mode',
                                value: runtimeConfig?.cgroupnsMode ?? 'default',
                            },
                        ].map((row) => (
                            <tr
                                key={row.key}
                                className="border-b last:border-b-0"
                            >
                                <td className="bg-muted/30 text-muted-foreground px-3 py-2">
                                    {row.key}
                                </td>
                                <td className="px-3 py-2 font-medium break-all">
                                    {row.value}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="rounded border p-3">
                <p className="text-muted-foreground mb-2 text-xs">
                    Healthcheck
                </p>
                <div className="grid gap-2 text-xs md:grid-cols-2">
                    <div>
                        command:{' '}
                        <code className="font-mono">
                            {runtimeConfig?.healthcheckCommand ?? 'none'}
                        </code>
                    </div>
                    <div>
                        interval: {runtimeConfig?.healthcheckIntervalSec ?? '—'}
                        s
                    </div>
                    <div>
                        timeout: {runtimeConfig?.healthcheckTimeoutSec ?? '—'}s
                    </div>
                    <div>
                        retries: {runtimeConfig?.healthcheckRetries ?? '—'}
                    </div>
                </div>
            </div>

            <div className="flex gap-2 text-xs">
                <Badge
                    variant={
                        runtimeConfig?.privileged ? 'destructive' : 'outline'
                    }
                >
                    {runtimeConfig?.privileged
                        ? 'privileged'
                        : 'non-privileged'}
                </Badge>
                <Badge
                    variant={
                        runtimeConfig?.readOnlyRootFs ? 'default' : 'outline'
                    }
                >
                    {runtimeConfig?.readOnlyRootFs
                        ? 'readonly rootfs'
                        : 'writable rootfs'}
                </Badge>
            </div>
        </div>
    )
}
