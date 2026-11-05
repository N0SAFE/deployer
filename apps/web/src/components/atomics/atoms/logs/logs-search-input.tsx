import { Search } from 'lucide-react'

import { Input } from '@deployer/ui/components/shadcn/input'

interface LogsSearchInputProps {
    value: string
    onChange: (value: string) => void
}

export function LogsSearchInput({ value, onChange }: LogsSearchInputProps) {
    return (
        <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
            <Input
                value={value}
                onChange={(event) => {
                    onChange(event.target.value)
                }}
                className="border-border/70 bg-background/70 h-9 pl-9"
                placeholder="Search logs"
            />
        </div>
    )
}
