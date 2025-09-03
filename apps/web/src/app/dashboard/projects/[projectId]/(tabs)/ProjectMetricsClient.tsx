'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { 
    Activity,
    CheckCircle2,
    Server,
    Container,
} from 'lucide-react'
import { useServices } from '@/hooks/useServices'
import { useDeployments } from '@/hooks/useDeployments'

interface ProjectMetricsClientProps {
    projectId: string
}

export default function ProjectMetricsClient({ projectId }: ProjectMetricsClientProps) {
    const { data: servicesData } = useServices(projectId, { limit: 50 })
    const { data: deploymentsData } = useDeployments()

    const services = servicesData?.services || []
    const deployments = deploymentsData?.deployments || []

    const activeServices = services.filter(s => s.isActive).length
    const activeDeployments = deployments.filter((d: { status?: string }) => 
        ['pending', 'queued', 'building', 'deploying'].includes(d.status || '')
    ).length
    const successfulDeployments = deployments.filter((d: { status?: string }) => d.status === 'success')
    const successRate = deployments.length > 0
        ? Math.round((successfulDeployments.length / deployments.length) * 100)
        : 0

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Services</CardTitle>
                    <Server className="text-muted-foreground h-4 w-4" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{services.length}</div>
                    <p className="text-muted-foreground text-xs">
                        {activeServices} active
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Deployments</CardTitle>
                    <Container className="text-muted-foreground h-4 w-4" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{deployments.length}</div>
                    <p className="text-muted-foreground text-xs">
                        {activeDeployments} active
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                    <CheckCircle2 className="text-muted-foreground h-4 w-4" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{successRate}%</div>
                    <p className="text-muted-foreground text-xs">Last 30 days</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                    <Activity className="text-muted-foreground h-4 w-4" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">99.9%</div>
                    <p className="text-muted-foreground text-xs">Last 7 days</p>
                </CardContent>
            </Card>
        </div>
    )
}