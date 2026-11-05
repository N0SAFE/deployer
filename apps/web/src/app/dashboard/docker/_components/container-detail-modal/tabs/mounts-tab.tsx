import { Badge } from '@deployer/ui/components/shadcn/badge'

interface MountItem {
    source: string
    target: string
    type: string
    readOnly: boolean
}

interface DockerContainerMountsTabProps {
    mounts: MountItem[]
}

export function DockerContainerMountsTab({
    mounts,
}: DockerContainerMountsTabProps) {
    return (
        <div className="flex min-h-0 flex-col gap-3 text-sm">
            <div className="min-h-0 flex-1 divide-y overflow-auto rounded border">
                {mounts.map((mount) => (
                    <div
                        key={`${mount.source}-${mount.target}`}
                        className="grid gap-2 p-3 md:grid-cols-3"
                    >
                        <div>
                            <p className="text-muted-foreground text-xs">
                                Source
                            </p>
                            <code className="text-xs break-all">
                                {mount.source}
                            </code>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-xs">
                                Destination
                            </p>
                            <code className="text-xs break-all">
                                {mount.target}
                            </code>
                        </div>
                        <div className="flex items-center justify-start gap-2 md:justify-end">
                            <Badge variant="outline">{mount.type}</Badge>
                            <Badge
                                variant={
                                    mount.readOnly ? 'secondary' : 'default'
                                }
                            >
                                {mount.readOnly ? 'ro' : 'rw'}
                            </Badge>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
