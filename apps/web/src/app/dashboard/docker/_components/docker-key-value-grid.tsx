'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { DockerCopyButton } from './docker-copy-button'

interface DockerKeyValueItem {
  key: string
  value: ReactNode
  /** Render the value in monospace (ids, paths, addresses). */
  mono?: boolean
  /** When set, a copy button copies this text. */
  copyValue?: string
}

interface DockerKeyValueGridProps {
  items: DockerKeyValueItem[]
  keyCellClassName?: string
  valueCellClassName?: string
}

export function DockerKeyValueGrid({ items, keyCellClassName, valueCellClassName }: DockerKeyValueGridProps) {
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-b last:border-b-0">
              <th scope="row" className={cn('w-2/5 bg-muted/30 px-3 py-2 text-left font-normal text-muted-foreground sm:w-1/3', keyCellClassName)}>{item.key}</th>
              <td className={cn('px-3 py-2 font-medium break-all', item.mono && 'font-mono text-xs', valueCellClassName)}>
                {item.copyValue ? (
                  <span className="inline-flex items-center gap-1">
                    {item.value}
                    <DockerCopyButton value={item.copyValue} label={item.key.toLowerCase()} />
                  </span>
                ) : item.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
