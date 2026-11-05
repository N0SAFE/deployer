import { Search } from 'lucide-react'

import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Input } from '@deployer/ui/components/shadcn/input'

import { DockerSelectionToggle } from '@/app/dashboard/docker/_components/docker-page-utilities'

interface ReplicaSidebarProps {
    searchTerm: string
    onSearchTermChange: (value: string) => void
    visibleReplicaNames: readonly string[]
    totalReplicaCount: number
    selectedReplicaNames: ReadonlySet<string>
    allVisibleSelected: boolean
    someVisibleSelected: boolean
    onSelectAllVisible: () => void
    onClearSelection: () => void
    onToggleReplica: (replicaName: string, pressed: boolean) => void
}

export function ReplicaSidebar({
    searchTerm,
    onSearchTermChange,
    visibleReplicaNames,
    totalReplicaCount,
    selectedReplicaNames,
    allVisibleSelected,
    someVisibleSelected,
    onSelectAllVisible,
    onClearSelection,
    onToggleReplica,
}: ReplicaSidebarProps) {
    return (
        <aside className="border-border/60 bg-card/50 overflow-hidden rounded-2xl border backdrop-blur-xl">
            <div className="border-border/60 border-b px-3 py-3">
                <div className="relative">
                    <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
                    <Input
                        value={searchTerm}
                        onChange={(event) => {
                            onSearchTermChange(event.target.value)
                        }}
                        aria-label="Filter replicas"
                        placeholder="Filter replicas..."
                        className="border-border/70 bg-background/70 h-9 pl-9"
                    />
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={onSelectAllVisible}
                    >
                        Select all
                    </button>
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={onClearSelection}
                    >
                        Clear
                    </button>
                </div>
            </div>

            <div className="max-h-[60vh] space-y-1 overflow-auto px-2 py-2">
                {visibleReplicaNames.map((replicaName) => {
                    const isSelected = selectedReplicaNames.has(replicaName)
                    return (
                        <div
                            key={replicaName}
                            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${isSelected ? 'border-primary/40 bg-primary/10' : 'hover:border-border/50 hover:bg-muted/30 border-transparent'}`}
                        >
                            <DockerSelectionToggle
                                ariaLabel={`Select logs for ${replicaName}`}
                                shape="round"
                                pressed={isSelected}
                                onPressedChange={(pressed: boolean) => {
                                    onToggleReplica(replicaName, pressed)
                                }}
                            />
                            <div className="min-w-0">
                                <p className="truncate text-xs font-medium">
                                    {replicaName}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                    service replica
                                </p>
                            </div>
                        </div>
                    )
                })}
                {visibleReplicaNames.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-4 text-xs">
                        No replicas match your filter.
                    </p>
                ) : null}
            </div>

            <div className="border-border/60 border-t px-3 py-2">
                <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs">
                    <span>{selectedReplicaNames.size} selected</span>
                    <span>{totalReplicaCount} replicas</span>
                </div>
                <Badge variant="outline" className="text-xs">
                    {allVisibleSelected
                        ? 'All visible selected'
                        : someVisibleSelected
                          ? 'Partial visible selected'
                          : 'None visible selected'}
                </Badge>
            </div>
        </aside>
    )
}
