'use client'

import { useMemo, useState } from 'react'
import { useOrganizations } from '@/domains/organization/hooks'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Input } from '@repo/ui/components/shadcn/input'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Building2 } from 'lucide-react'
import Image from 'next/image'
import { AuthDashboardAdminOrganizationsOrganizationId } from '@/routes'

export default function AdminOrganizationsPage() {
  const { data: organizations, isLoading, error } = useOrganizations({ pagination: { pageSize: 50 } })
  const [search, setSearch] = useState('')

  const organizationCount = organizations?.length ?? 0
  const query = search.trim().toLowerCase()

  const filteredOrganizations = useMemo(() => {
    if (!organizations) {
      return []
    }

    if (!query) {
      return organizations
    }

    return organizations.filter((org) => {
      const haystack = `${org.name} ${org.slug}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [organizations, query])

  const surfaceCardClass =
    'border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45'

  return (
    <div className="container mx-auto max-w-350 space-y-6 py-8">
      <div className="rounded-xl border border-slate-200/70 bg-linear-to-b from-white to-slate-50/70 p-5 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:to-slate-900/50">
        <h1 className="text-3xl font-bold tracking-tight">Organization Administration</h1>
        <p className="mt-1 text-muted-foreground">
          Review tenant accounts and jump into organization-level configuration quickly.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{organizationCount} total</Badge>
          <Badge variant="outline">{filteredOrganizations.length} visible</Badge>
          <Badge variant="outline">tenant + platform scoped</Badge>
        </div>
      </div>

      <Card className={surfaceCardClass}>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Organization registry</CardTitle>
              <CardDescription>
                {organizationCount} organization{organizationCount !== 1 ? 's' : ''} available for org-level admin management
              </CardDescription>
            </div>
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
              placeholder="Search by name or slug..."
              className="w-full md:w-72"
            />
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-md mb-4">
              <p className="font-medium">Error loading organizations</p>
              <p className="text-sm">{error instanceof Error ? error.message : 'Unknown error'}</p>
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredOrganizations.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrganizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {org.logo ? (
                          <Image src={org.logo} alt={org.name} width={24} height={24} className="h-6 w-6 rounded" />
                        ) : (
                          <Building2 className="h-6 w-6 text-muted-foreground" />
                        )}
                        {org.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">@{org.slug}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <AuthDashboardAdminOrganizationsOrganizationId.Link organizationId={org.id} className="text-sm text-primary hover:underline">
                        View details
                      </AuthDashboardAdminOrganizationsOrganizationId.Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              {query ? 'No organizations match your search.' : 'No organizations found in the system.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
