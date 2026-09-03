import React from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { AuthSignin, AuthDashboard } from '@/routes'
import {
    ArrowRight,
    Rocket,
    GitBranch,
    Layers,
    Shield,
    Server,
    Workflow,
} from 'lucide-react'
import { PageTimingLogger } from '@/lib/timing'

import type { JSX } from 'react'

import type { Metadata } from 'next'
function FeatureCard({
    icon: Icon,
    title,
    description,
    iconClassName,
}: {
    icon: React.ComponentType<{ className?: string }>
    title: string
    description: string
    iconClassName: string
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center space-x-3">
                    <div className="bg-primary/10 rounded-lg p-2">
                        <Icon className={`h-5 w-5 ${iconClassName}`} />
                    </div>
                    <CardTitle className="text-lg">{title}</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                    {description}
                </CardDescription>
            </CardContent>
        </Card>
    )
}

export default function Page(): JSX.Element {
    return (
        <div className="container mx-auto mt-8 space-y-12 px-4 py-12 md:py-16 lg:py-20">
            <section className="space-y-6 text-center">
                <div className="space-y-4">
                    <h1 className="from-primary to-primary/60 bg-linear-to-r bg-clip-text text-4xl font-bold text-transparent md:text-6xl">
                        Deployer Platform
                    </h1>
                    <p className="text-muted-foreground mx-auto max-w-2xl text-xl">
                        Self-hosted multi-service deployments with preview
                        environments, team collaboration, and production-grade
                        orchestration.
                    </p>
                </div>
                <div className="flex flex-col justify-center gap-4 sm:flex-row">
                    <AuthSignin.Link>
                        <Button
                            size="lg"
                            className="flex items-center space-x-2"
                        >
                            <Rocket className="h-5 w-5" />
                            <span>Start Deploying</span>
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </AuthSignin.Link>
                    <AuthDashboard.Link>
                        <Button
                            variant="outline"
                            size="lg"
                            className="flex items-center space-x-2"
                        >
                            <Server className="h-5 w-5" />
                            <span>Open Dashboard</span>
                        </Button>
                    </AuthDashboard.Link>
                </div>
            </section>

            <section className="space-y-8">
                <div className="space-y-2 text-center">
                    <h2 className="text-3xl font-bold">Features</h2>
                    <p className="text-muted-foreground">
                        Foundation capabilities for the v3 deployer rebuild
                    </p>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <FeatureCard
                        icon={GitBranch}
                        title="Git & Upload Sources"
                        description="Deploy from repositories or uploaded bundles, with typed source provider contracts."
                        iconClassName="text-emerald-500"
                    />
                    <FeatureCard
                        icon={Layers}
                        title="Multi-Service Projects"
                        description="Compose services with environment-aware workflows and mesh-wide deployments."
                        iconClassName="text-blue-500"
                    />
                    <FeatureCard
                        icon={Workflow}
                        title="Deployment Workflows"
                        description="Queue-driven build and runtime execution with lifecycle events and resilience controls."
                        iconClassName="text-violet-500"
                    />
                    <FeatureCard
                        icon={Shield}
                        title="Role-Based Access"
                        description="Platform and project-level permission boundaries for safe team collaboration."
                        iconClassName="text-amber-500"
                    />
                    <FeatureCard
                        icon={Server}
                        title="Self-Hosted Control"
                        description="Run the full platform on your own infrastructure with Docker + Traefik orchestration."
                        iconClassName="text-rose-500"
                    />
                </div>
            </section>

            {/* Timing Logger */}
            <PageTimingLogger pageName="Home" />
        </div>
    )
}

export const metadata: Metadata = {
    title: "Deployer",
    description: "Self-hosted deployment platform for containers, services and providers",
}
