import { Input } from '@repo/ui/components/shadcn/input'
import { Search } from 'lucide-react'

interface LogsSearchInputProps {
  value: string
  onChange: (value: string) => void
}

export function LogsSearchInput({ value, onChange }: LogsSearchInputProps) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="h-9 border-border/70 bg-background/70 pl-9"
        placeholder="Search logs"
      />
    </div>
  )
}