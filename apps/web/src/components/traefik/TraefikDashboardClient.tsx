'use client'

import React from 'react'
import {
    Globe,
} from 'lucide-react'
import TraefikFileSystemViewer from './TraefikFileSystemViewer'

export const TraefikDashboardClient: React.FC = () => {
    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Globe className="h-6 w-6" />
                        Traefik Configuration
                    </h1>
                    <p className="text-muted-foreground">
                        Browse and manage Traefik configuration files across all instances
                    </p>
                </div>
            </div>

            {/* Traefik File System */}
            <TraefikFileSystemViewer />
        </div>
    )
}