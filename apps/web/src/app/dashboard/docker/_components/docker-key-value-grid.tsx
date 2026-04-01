'use client'

interface DockerKeyValueItem {
  key: string
  value: string
}

interface DockerKeyValueGridProps {
  items: DockerKeyValueItem[]
  keyCellClassName?: string
  valueCellClassName?: string
}

export function DockerKeyValueGrid({ items, keyCellClassName, valueCellClassName }: DockerKeyValueGridProps) {
  return (
    <div className="rounded border overflow-hidden">
      <table className="w-full text-xs">
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-b last:border-b-0">
              <td className={`bg-muted/30 px-3 py-2 text-muted-foreground ${keyCellClassName ?? ''}`.trim()}>{item.key}</td>
              <td className={`px-3 py-2 font-medium break-all ${valueCellClassName ?? ''}`.trim()}>{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}