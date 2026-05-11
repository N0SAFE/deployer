import { DockerRuntimeEventsProviderClient } from './_components/docker-runtime-events-provider'

export default function DashboardDockerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Docker workspace</p>
        <h1 className="text-2xl font-semibold tracking-tight">Container Operations</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Monitor containers, inspect runtime health, and manage orchestration resources.
        </p>
      </header>

      <DockerRuntimeEventsProviderClient>
        <div>{children}</div>
      </DockerRuntimeEventsProviderClient>
    </div>
  )
}
