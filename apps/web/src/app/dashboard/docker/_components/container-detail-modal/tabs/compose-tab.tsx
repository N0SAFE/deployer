import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'

interface ComposeConfig {
  serviceName: string | null
  projectName: string | null
  ports: unknown[]
  volumes: unknown[]
  dependsOn: Array<{
    service: string
    condition: string
    required: boolean
  }>
  rawYaml: string
}

interface DockerContainerComposeTabProps {
  composeConfig: ComposeConfig | null
  orchestrator: 'compose' | 'swarm' | 'kubernetes'
  composeRows: Array<{ key: string; value: string }>
  showRawCompose: boolean
  onToggleShowRawCompose: () => void
}

export function DockerContainerComposeTab({
  composeConfig,
  orchestrator,
  composeRows,
  showRawCompose,
  onToggleShowRawCompose,
}: DockerContainerComposeTabProps) {
  if (!composeConfig) {
    return <p className="text-sm text-muted-foreground">No compose configuration available.</p>
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 text-sm">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border p-3">
          <p className="text-xs text-muted-foreground">Runtime</p>
          <p className="mt-1 font-medium capitalize">{orchestrator}</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-xs text-muted-foreground">Ports</p>
          <p className="mt-1 font-medium">{composeConfig.ports.length}</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-xs text-muted-foreground">Volumes</p>
          <p className="mt-1 font-medium">{composeConfig.volumes.length}</p>
        </div>
      </div>

      <div className="rounded border overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            {composeRows.map((row) => (
              <tr key={row.key} className="border-b last:border-b-0">
                <td className="bg-muted/30 px-3 py-2 text-muted-foreground">{row.key}</td>
                <td className="px-3 py-2 font-medium break-all">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded border p-3">
        <p className="text-xs text-muted-foreground mb-2">depends_on</p>
        <div className="overflow-auto rounded border divide-y">
          {composeConfig.dependsOn.map((dep) => (
            <div key={`${dep.service}-${dep.condition}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-1.5 text-xs">
              <span className="font-medium">{dep.service}</span>
              <Badge variant="outline">{dep.condition}</Badge>
              <Badge variant={dep.required ? 'default' : 'secondary'}>{dep.required ? 'required' : 'optional'}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onToggleShowRawCompose}>
          {showRawCompose ? 'Hide raw manifest' : 'Show raw manifest'}
        </Button>
      </div>
      {showRawCompose ? (
        <pre className="flex-1 min-h-0 overflow-auto rounded border bg-muted/20 p-3 text-xs">{composeConfig.rawYaml}</pre>
      ) : null}
    </div>
  )
}