interface DockerContainerLabelsTabProps {
  labels: Array<{
    key: string
    value: string
  }>
}

export function DockerContainerLabelsTab({ labels }: DockerContainerLabelsTabProps) {
  return (
    <div className="space-y-2 text-sm">
      {labels.map((label) => (
        <div key={label.key} className="rounded border p-3 flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{label.key}</span>
          <code className="font-mono text-xs break-all">{label.value}</code>
        </div>
      ))}
    </div>
  )
}