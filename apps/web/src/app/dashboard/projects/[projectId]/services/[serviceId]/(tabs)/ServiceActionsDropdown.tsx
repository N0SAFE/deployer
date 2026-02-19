'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { Eye, MoreHorizontal, Network, RotateCcw, Square, Trash2, Zap, Play, ExternalLink, Settings } from 'lucide-react'
import ServiceDependencyView from '@/components/services/ServiceDependencyView'

export default function ServiceActionsDropdown({
    serviceId,
    serviceName,
}: {
    serviceId: string
    serviceName: string
}) {
    const [showDependencies, setShowDependencies] = useState(false)

    return (
        <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm">
                <Eye className="mr-2 h-4 w-4" />
                View Live
            </Button>
            <Button variant="outline" size="sm">
                <Zap className="mr-2 h-4 w-4" />
                Deploy
            </Button>
            <Button variant="outline" size="sm">
                <Settings className="mr-2 h-4 w-4" />
                Settings
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                        <Play className="mr-2 h-4 w-4" />
                        Start Service
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                        <Square className="mr-2 h-4 w-4" />
                        Stop Service
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Restart Service
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowDependencies(true)}>
                        <Network className="mr-2 h-4 w-4" />
                        Manage Dependencies
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View Logs
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Service
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Dependencies Dialog */}
            <ServiceDependencyView
                serviceId={serviceId}
                serviceName={serviceName}
                open={showDependencies}
                onOpenChange={setShowDependencies}
            />
        </div>
    )
}
