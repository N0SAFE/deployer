import { Badge } from '@repo/ui/components/shadcn/badge'

interface EnvironmentEntry {
  key: string
  value: string
  masked: boolean
  source: string
}

interface DockerContainerEnvTabProps {
  environment: EnvironmentEntry[]
}

export function DockerContainerEnvTab({ environment }: DockerContainerEnvTabProps) {
  return (
    <div className="flex min-h-0 flex-col gap-2 text-sm">
      <div className="flex-1 min-h-0 overflow-auto rounded border divide-y">
        {environment.map((entry) => (
          <div key={entry.key} className="p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs break-all">{entry.key}</p>
              <p className="text-xs text-muted-foreground break-all">{entry.masked ? '********' : entry.value}</p>
            </div>
            <Badge variant="outline">{entry.source}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}