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
                        <Icon className={`h-5 w-5 ${iconClassName}`} aria-hidden />
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
        <div className="container mx-auto space-y-12 px-4 py-12 md:py-16 lg:py-20">
            <section className="space-y-6 text-center">
                <div className="space-y-4">
                    <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
                        Deploy to your own servers
                    </h1>
                    <p className="text-muted-foreground mx-auto max-w-2xl text-lg md:text-xl">
                        Deployer is a self-hosted platform: connect a Git repository or upload a
                        build, and it runs your services in containers on machines you control,
                        with automatic HTTPS, preview URLs per branch, and one dashboard for
                        your team.
                    </p>
                </div>
                <div className="flex flex-col justify-center gap-3 sm:flex-row">
                    <Button asChild size="lg">
                        <AuthDashboard.Link>
                            <Server className="h-5 w-5" aria-hidden />
                            Open dashboard
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </AuthDashboard.Link>
                    </Button>
                    <Button asChild variant="outline" size="lg">
                        <AuthSignin.Link>Sign in</AuthSignin.Link>
                    </Button>
                </div>
                <p className="text-muted-foreground text-sm">
                    The dashboard asks you to sign in if you have not already.
                </p>
            </section>

            <section className="space-y-8">
                <div className="space-y-2 text-center">
                    <h2 className="text-3xl font-bold">What you get</h2>
                    <p className="text-muted-foreground">From a commit to a running, monitored service</p>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <FeatureCard
                        icon={GitBranch}
                        title="Deploy from Git or an upload"
                        description="Point at a GitHub, GitLab or any Git repository, or upload a zip. Every push can build and ship."
                        iconClassName="text-emerald-500"
                    />
                    <FeatureCard
                        icon={Layers}
                        title="Multi-service projects"
                        description="Group services that depend on each other, with separate environments and ordered, cascading deploys."
                        iconClassName="text-blue-500"
                    />
                    <FeatureCard
                        icon={Workflow}
                        title="Previews and live logs"
                        description="A preview URL per branch or pull request, deployment history, and logs streamed as they happen."
                        iconClassName="text-violet-500"
                    />
                    <FeatureCard
                        icon={Shield}
                        title="Roles for your team"
                        description="Owners, admins, developers and viewers each see and change only what their role allows."
                        iconClassName="text-amber-500"
                    />
                    <FeatureCard
                        icon={Server}
                        title="Your infrastructure"
                        description="Runs on your own machines with Docker and an automatic reverse proxy. Nodes join a private mesh; nothing depends on a hosted control plane."
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
    // `absolute` opts out of the root template (`%s · Deployer`). Without it
    // the landing page renders the product name twice — "Deployer · Deployer".
    title: { absolute: "Deployer" },
    description: "Self-hosted deployment platform for containers, services and providers",
}
