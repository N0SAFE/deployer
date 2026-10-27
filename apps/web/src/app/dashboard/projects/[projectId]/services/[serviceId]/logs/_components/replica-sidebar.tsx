import { Search } from 'lucide-react'
import { DockerSelectionToggle } from '@/app/dashboard/docker/_components/docker-page-utilities'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Input } from '@deployer/ui/components/shadcn/input'

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
    <aside className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
      <div className="border-b border-border/60 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => {
              onSearchTermChange(event.target.value)
            }}
            aria-label="Filter replicas"
            placeholder="Filter replicas..."
            className="h-9 border-border/70 bg-background/70 pl-9"
          />
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={onSelectAllVisible}
          >
            Select all
          </button>
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground"
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
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${isSelected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:border-border/50 hover:bg-muted/30'}`}
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
                <p className="truncate text-xs font-medium">{replicaName}</p>
                <p className="text-xs text-muted-foreground">service replica</p>
              </div>
            </div>
          )
        })}
        {visibleReplicaNames.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">No replicas match your filter.</p>
        ) : null}
      </div>

      <div className="border-t border-border/60 px-3 py-2">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
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
