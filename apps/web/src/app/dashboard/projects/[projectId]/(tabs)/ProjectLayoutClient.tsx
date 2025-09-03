'use client'

import { Loader2 } from 'lucide-react'
import { useProject } from '@/hooks/useProjects'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabs } from '@/routes/index'

interface ProjectLayoutClientProps {
    children: React.ReactNode
}

export default function ProjectLayoutClient({ children }: ProjectLayoutClientProps) {
    const { projectId } = useParams(DashboardProjectsProjectIdTabs)
    const { data: project, isLoading, error } = useProject(projectId)

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="text-center">
                    <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
                    <p className="text-muted-foreground">Loading content...</p>
                </div>
            </div>
        )
    }

    if (error || !project) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="text-center">
                    <p className="text-destructive mb-4">
                        Failed to load project content
                    </p>
                    <p className="text-muted-foreground text-sm">
                        {error?.message || 'Project not found'}
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {children}
        </div>
    )
}
