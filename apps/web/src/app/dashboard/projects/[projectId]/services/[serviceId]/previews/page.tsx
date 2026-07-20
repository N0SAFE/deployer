'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowLeft } from 'lucide-react'
import { ServiceSectionNav } from '../_components/service-section-nav'

export default function DashboardServicePreviewsPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? null, [serviceId, services])

  const previewRows = useMemo(() => {
    return [
      { id: `${serviceId}-preview-main`, branch: 'main', url: `https://${serviceId}-main.preview.local`, status: 'active' },
      { id: `${serviceId}-preview-feature`, branch: 'feature/new-ui', url: `https://${serviceId}-feature.preview.local`, status: 'sleeping' },
    ]
  }, [serviceId])

  if (!project) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>This project does not exist in the mock entities dataset.</AlertDescription>
      </Alert>
    )
  }

  if (!service) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>This service does not exist in the selected project mock dataset.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={`/dashboard/projects/${projectId}/services/${serviceId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to service
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service previews</h1>
          <p className="text-sm text-muted-foreground">Preview environments for branch and PR validation.</p>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="previews" />

      <div className="rounded-xl border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{previewRows.length} preview slots</Badge>
          <Badge variant="default">{previewRows.filter((row) => row.status === 'active').length} active</Badge>
          <Badge variant="secondary">{previewRows.filter((row) => row.status !== 'active').length} idle/sleeping</Badge>
          <Badge variant="outline">branch-aware routing</Badge>
        </div>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Preview environments</CardTitle>
          <CardDescription>{previewRows.length} preview slots with branch and replica-aware routing context.</CardDescription>
        </CardHeader>
        <CardContent className="p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((preview) => (
                <TableRow key={preview.id}>
                  <TableCell>{preview.branch}</TableCell>
                  <TableCell className="font-mono text-xs">{preview.url}</TableCell>
                  <TableCell>
                    <Badge variant={preview.status === 'active' ? 'default' : 'secondary'}>{preview.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
