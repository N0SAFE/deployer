import type { ComponentType, ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { buttonVariants } from '@repo/ui/components/shadcn/button'
import { PageHeader } from '@/components/dashboard'
import { cn } from '@/lib/utils'

interface RouteLike {
  (): string
  Link: ComponentType<{ className?: string; children?: ReactNode }>
}

/**
 * A listed integration the API cannot connect yet. The page used to offer a form
 * whose submit always failed (or, for Docker Hub, kept credentials only in the
 * browser tab and lost them on reload) — a control that looks real and is not.
 */
export function UnavailableIntegration({
  name,
  description,
  reason,
  instead,
}: {
  name: string
  description: string
  reason: ReactNode
  /** Where to go for what does work today. */
  instead: { title: string; text: ReactNode; route: RouteLike; label: string }
}) {
  const InsteadLink = instead.route.Link
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Settings › Integrations" title={name} description={description} />
      <Alert>
        <Info className="size-4" />
        <AlertTitle>{name} cannot be connected yet</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{instead.title}</CardTitle>
          <CardDescription>{instead.text}</CardDescription>
        </CardHeader>
        <CardContent>
          <InsteadLink className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}>{instead.label}</InsteadLink>
        </CardContent>
      </Card>
    </div>
  )
}
