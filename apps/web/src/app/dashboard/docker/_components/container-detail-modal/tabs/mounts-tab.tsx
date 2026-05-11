import { Badge } from '@repo/ui/components/shadcn/badge'

interface MountItem {
  source: string
  target: string
  type: string
  readOnly: boolean
}

interface DockerContainerMountsTabProps {
  mounts: MountItem[]
}

export function DockerContainerMountsTab({ mounts }: DockerContainerMountsTabProps) {
  return (
    <div className="flex min-h-0 flex-col gap-3 text-sm">
      <div className="flex-1 min-h-0 overflow-auto rounded border divide-y">
        {mounts.map((mount) => (
          <div key={`${mount.source}-${mount.target}`} className="p-3 grid gap-2 md:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Source</p>
              <code className="text-xs break-all">{mount.source}</code>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Destination</p>
              <code className="text-xs break-all">{mount.target}</code>
            </div>
            <div className="flex items-center gap-2 justify-start md:justify-end">
              <Badge variant="outline">{mount.type}</Badge>
              <Badge variant={mount.readOnly ? 'secondary' : 'default'}>{mount.readOnly ? 'ro' : 'rw'}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}