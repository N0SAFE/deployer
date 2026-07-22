'use client'

import Link from 'next/link'
import { AuthDashboardDeployments, AuthDashboardProjects } from '@/routes'
import { useMemo, useState } from 'react'
import { useServiceList } from '@/domains/service/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowRight, RefreshCw, Server, Siren } from 'lucide-react'
import { toast } from 'sonner'

type HealthFilter = 'all' | 'passing' | 'warning' | 'failing' | 'unknown'

export default function DashboardServicesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')

  const { data: servicesData, isLoading, error } = useServiceList(undefined)
  const services: any[] = useMemo(() => { const d = servicesData as { data?: any[] } | undefined; return d?.data ?? [] }, [servicesData])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return services.filter((row: Record<string, unknown>) => {
      if (healthFilter !== 'all' && row.health !== healthFilter) return false
      if (!query) return true
      const name = ((row.name as string) ?? '').toLowerCase()
      const id = ((row.id as string) ?? '').toLowerCase()
      return name.includes(query) || id.includes(query)
    })
  }, [healthFilter, searchQuery, services])

  const summary = useMemo(() => {
    const total = services.length
    const passing = services.filter((s: Record<string, unknown>) => s.status === 'running' || s.status === 'active').length
    const others = services.filter((s: Record<string, unknown>) => s.status !== 'running' && s.status !== 'active').length
    return { total, passing, warning: Math.round(others * 0.3), failing: others - Math.round(others * 0.3) }
  }, [services])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Siren className="mb-4 size-12 text-destructive" />
        <h2 className="text-xl font-semibold">Failed to load services</h2>
        <p className="mt-2 text-muted-foreground">{(error as Error).message ?? 'An unexpected error occurred'}</p>
        <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 size-8 animate-spin rounded-full border-4 border-border border-t-primary" />
        <p className="text-muted-foreground">Loading services...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Services</h1>
          <p className="mt-2 text-muted-foreground">
            Service inventory with health and lifecycle status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              toast.success('Service dashboard refreshed')
            }}
          >
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
          <Button asChild variant="outline">
            <AuthDashboardProjects.Link>
              Open projects
              <ArrowRight className="ml-2 size-4" />
            </AuthDashboardProjects.Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Total services</CardDescription><CardTitle>{summary.total}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Active</CardDescription><CardTitle>{summary.passing}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Issues detected</CardDescription><CardTitle>{summary.warning + summary.failing}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Service inventory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={searchQuery}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
            placeholder="Search services..."
          />

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline"><Server className="mr-1 size-3" /> {filteredRows.length} visible</Badge>
            <Badge variant={summary.warning + summary.failing > 0 ? 'destructive' : 'secondary'}>
              <Siren className="mr-1 size-3" /> {summary.warning + summary.failing} with issues
            </Badge>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string}>
                    <TableCell>
                      <p className="font-medium">{(row.name as string) ?? row.id as string}</p>
                      <p className="text-xs text-muted-foreground">{row.id as string}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={(row.status as string) === 'active' || (row.status as string) === 'running' ? 'default' : 'secondary'}>
                        {(row.status as string) ?? 'unknown'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">No services match current filters.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
