import type { ComponentType, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'

/** A typed route builder as `@/routes` generates them. */
export interface SettingsRoute {
  (): string
  Link: ComponentType<{ className?: string; children?: ReactNode }>
}

/** One settings area (or pointer) on the hub: icon, what it does, and where it lives. */
export function SettingsCard({
  title,
  description,
  icon: Icon,
  route,
  why,
  cta = 'Open',
  status,
}: {
  title: string
  description: ReactNode
  icon: ComponentType<{ className?: string }>
  route: SettingsRoute
  /** For pointers only: why this setting lives outside Settings. */
  why?: string
  cta?: string
  /** One live fact about this area ("Strict mode on"), shown under the description. */
  status?: ReactNode
}) {
  const RouteLink = route.Link
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        {status ? <p role="status" className="text-sm font-medium">{status}</p> : null}
        {why ? <p className="text-sm text-muted-foreground">Lives there because: {why}</p> : null}
        <RouteLink className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {cta} <ArrowRight className="size-3.5" />
        </RouteLink>
      </CardContent>
    </Card>
  )
}
