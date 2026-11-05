import { ChevronDown, ChevronRight } from 'lucide-react'

import { Badge } from '@deployer/ui/components/shadcn/badge'

interface LayerItem {
    id: string
    instruction: string
    size: string
    createdAt: string
}

interface DockerContainerLayersTabProps {
    containerLayers: LayerItem[]
    expandedLayerId: string | null
    securityVulnerabilitiesCount: number
    onToggleLayer: (layerId: string) => void
    layerStatus: (
        layerId: string
    ) => 'verified' | 'cached' | 'warning' | 'pending'
    layerStatusVariant: (
        status: 'verified' | 'cached' | 'warning' | 'pending'
    ) => 'default' | 'secondary' | 'destructive' | 'outline'
}

export function DockerContainerLayersTab({
    containerLayers,
    expandedLayerId,
    securityVulnerabilitiesCount,
    onToggleLayer,
    layerStatus,
    layerStatusVariant,
}: DockerContainerLayersTabProps) {
    return (
        <div className="flex min-h-0 flex-col gap-3 text-sm">
            <p className="text-muted-foreground text-xs">
                Image layer history for this container image (with verification
                status).
            </p>
            <div className="min-h-0 flex-1 divide-y overflow-auto rounded border">
                {containerLayers.length === 0 ? (
                    <div className="text-muted-foreground p-3 text-xs">
                        No image layer metadata is available for this container.
                    </div>
                ) : (
                    containerLayers.map((layer) => (
                        <div key={layer.id} className="p-2">
                            <button
                                type="button"
                                className="hover:bg-muted/60 w-full rounded-sm px-2 py-1.5 transition-colors"
                                onClick={() => {
                                    onToggleLayer(layer.id)
                                }}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        {expandedLayerId === layer.id ? (
                                            <ChevronDown className="text-muted-foreground h-4 w-4" />
                                        ) : (
                                            <ChevronRight className="text-muted-foreground h-4 w-4" />
                                        )}
                                        <p className="text-left font-mono text-xs break-all">
                                            {layer.instruction}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Badge
                                            variant={layerStatusVariant(
                                                layerStatus(layer.id)
                                            )}
                                        >
                                            {layerStatus(layer.id)}
                                        </Badge>
                                        <Badge variant="outline">
                                            {layer.size}
                                        </Badge>
                                    </div>
                                </div>
                            </button>
                            {expandedLayerId === layer.id ? (
                                <div className="bg-muted/20 mt-2 rounded border p-2 text-xs">
                                    <div className="grid gap-2 md:grid-cols-2">
                                        <div>
                                            <p className="text-muted-foreground">
                                                Layer ID
                                            </p>
                                            <code className="break-all">
                                                {layer.id}
                                            </code>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">
                                                Created
                                            </p>
                                            <p>{layer.createdAt}</p>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">
                                                Status
                                            </p>
                                            <Badge
                                                variant={layerStatusVariant(
                                                    layerStatus(layer.id)
                                                )}
                                            >
                                                {layerStatus(layer.id)}
                                            </Badge>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">
                                                Risk context
                                            </p>
                                            <p>
                                                {securityVulnerabilitiesCount}{' '}
                                                known vulnerability entries in
                                                image
                                            </p>
                                        </div>
                                        <div className="md:col-span-2">
                                            <p className="text-muted-foreground">
                                                Instruction
                                            </p>
                                            <p className="font-mono break-all">
                                                {layer.instruction}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
