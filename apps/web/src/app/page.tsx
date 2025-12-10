import React from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Authsignin, Dashboard, Deployments, Health } from '@/routes'
import {
    ArrowRight,
    Zap,
    Shield,
    Palette,
    Code,
    GitBranch,
    Layers,
    Activity,
    Rocket,
    LayoutDashboard,
} from 'lucide-react'

import type { JSX } from 'react'

function FeatureCard({
    icon: Icon,
    title,
    description,
    gradient,
}: {
    icon: React.ComponentType<{ className?: string }>
    title: string
    description: string
    gradient: string
}) {
    return (
        <Card className="from-background to-muted/20 relative overflow-hidden border-0 bg-linear-to-br">
            <div
                className={`absolute inset-0 bg-linear-to-br ${gradient} opacity-5`}
            />
            <CardHeader className="relative">
                <div className="flex items-center space-x-3">
                    <div
                        className={`rounded-lg bg-linear-to-br p-2 ${gradient}`}
                    >
                        <Icon className="h-5 w-5 text-white" />
                    </div>
                    <CardTitle className="text-lg">{title}</CardTitle>
                </div>
            </CardHeader>
            <CardContent className="relative">
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
            {/* Hero Section */}
            <section className="space-y-6 text-center">
                <div className="space-y-4">
                    <h1 className="from-primary to-primary/60 bg-linear-to-r bg-clip-text text-4xl font-bold text-transparent md:text-6xl">
                        Next.js NestJS Template
                    </h1>
                    <p className="text-muted-foreground mx-auto max-w-2xl text-xl">
                        A modern, full-stack monorepo template featuring
                        Next.js, NestJS API, Shadcn UI, and TypeScript with
                        authentication and declarative routing.
                    </p>
                </div>
                <div className="flex flex-col justify-center gap-4 sm:flex-row">
                    <Dashboard.Link>
                        <Button size="lg" className="flex items-center space-x-2">
                            <LayoutDashboard className="h-5 w-5" />
                            <span>Open Dashboard</span>
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </Dashboard.Link>
                    <Authsignin.Link search={{ callbackUrl: '/dashboard' }}>
                        <Button
                            variant="outline"
                            size="lg"
                            className="flex items-center space-x-2"
                        >
                            <Shield className="h-5 w-5" />
                            <span>Get Started</span>
                        </Button>
                    </Authsignin.Link>
                </div>
            </section>

            {/* Features Grid */}
            <section className="space-y-8">
                <div className="space-y-2 text-center">
                    <h2 className="text-3xl font-bold">Features</h2>
                    <p className="text-muted-foreground">
                        Everything you need to build modern web applications
                    </p>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <FeatureCard
                        icon={Zap}
                        title="Full-Stack Setup"
                        description="Complete Next.js frontend with NestJS API backend, ready for production deployment."
                        gradient="from-yellow-400 to-orange-500"
                    />
                    <FeatureCard
                        icon={Layers}
                        title="Monorepo Structure"
                        description="Organized with Turborepo for efficient development, shared packages, and optimized builds."
                        gradient="from-blue-500 to-purple-600"
                    />
                    <FeatureCard
                        icon={Palette}
                        title="Modern UI"
                        description="Beautiful Shadcn UI components with Tailwind CSS, dark mode support, and responsive design."
                        gradient="from-pink-500 to-rose-500"
                    />
                    <FeatureCard
                        icon={Shield}
                        title="Authentication"
                        description="Integrated Better Auth with NestJS authentication, secure session management, and role-based access."
                        gradient="from-green-500 to-teal-600"
                    />
                    <FeatureCard
                        icon={GitBranch}
                        title="Declarative Routing"
                        description="Type-safe routing system with automatic route generation and link validation."
                        gradient="from-indigo-500 to-blue-600"
                    />
                    <FeatureCard
                        icon={Code}
                        title="Type Safety"
                        description="Full TypeScript support across all packages with shared configurations and strict type checking."
                        gradient="from-purple-500 to-violet-600"
                    />
                </div>
            </section>

            {/* Quick Start Section */}
            <section className="space-y-8">
                <div className="space-y-2 text-center">
                    <h2 className="text-3xl font-bold">Quick Start</h2>
                    <p className="text-muted-foreground">
                        Explore different aspects of the application
                    </p>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <Card className="p-6">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <LayoutDashboard className="h-8 w-8 text-blue-500" />
                                <div>
                                    <h3 className="text-xl font-semibold">
                                        Dashboard Overview
                                    </h3>
                                    <p className="text-muted-foreground text-sm">
                                        Manage deployments and signals in one place
                                    </p>
                                </div>
                            </div>
                            <p className="text-muted-foreground">
                                Jump into the unified dashboard to access
                                deployments, projects, and live pipeline
                                status with sidebar navigation.
                            </p>
                            <Dashboard.Link>
                                <Button className="w-full">
                                    Go to Dashboard
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </Dashboard.Link>
                        </div>
                    </Card>
                    <Card className="p-6">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <Rocket className="h-8 w-8 text-green-500" />
                                <div>
                                    <h3 className="text-xl font-semibold">
                                        Deployments
                                    </h3>
                                    <p className="text-muted-foreground text-sm">
                                        Track releases and promotion status
                                    </p>
                                </div>
                            </div>
                            <p className="text-muted-foreground">
                                Review deployment health, versions, and
                                promotion state across environments with
                                consolidated release metadata.
                            </p>
                            <Deployments.Link>
                                <Button className="w-full">
                                    View Deployments
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </Deployments.Link>
                        </div>
                    </Card>
                    <Card className="p-6">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <Activity className="h-8 w-8 text-purple-500" />
                                <div>
                                    <h3 className="text-xl font-semibold">
                                        Status & Health
                                    </h3>
                                    <p className="text-muted-foreground text-sm">
                                        Live checks for systems and services
                                    </p>
                                </div>
                            </div>
                            <p className="text-muted-foreground">
                                Monitor overall service health, incident
                                status, and uptime signals to keep operations
                                stable.
                            </p>
                            <Health.Link>
                                <Button className="w-full">
                                    View Health
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </Health.Link>
                        </div>
                    </Card>
                </div>
            </section>
        </div>
    )
}
