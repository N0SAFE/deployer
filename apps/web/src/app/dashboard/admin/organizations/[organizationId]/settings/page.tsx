'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams } from '@/routes/hooks'
import { AuthDashboardAdminOrganizationsOrganizationId } from '@/routes'
import { useState } from 'react'
import {
  useOrganization,
  useUpdateOrganization,
  useDeleteOrganization,
} from '@/domains/organization/hooks'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

export default function AdminSettingsPage() {
  const params = useParams(AuthDashboardAdminOrganizationsOrganizationId)
  const organizationId = params.organizationId
  const router = useRouter()

  // Fetch organization data
  const { data: organization, isLoading } = useOrganization(organizationId)

  // Mutations
  const updateMutation = useUpdateOrganization()
  const deleteMutation = useDeleteOrganization()

  // Form state derived from organization data
  const [name, setName] = useState(organization?.name ?? '')
  const [slug, setSlug] = useState(organization?.slug ?? '')

  const handleSave = () => {
    updateMutation.mutate({
      organizationId,
      name,
      slug: slug || undefined,
    })
  }

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this organization? This action cannot be undone.')) {
      deleteMutation.mutate(
        { organizationId },
        {
          onSuccess: () => {
            router.push('/dashboard/admin/organizations')
          },
        }
      )
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-350 py-8 space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-350 py-8 space-y-6">
      {/* Back Button */}
      <Link href={`/dashboard/admin/organizations/${organizationId}`}>
        <Button variant="ghost" className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to organization
        </Button>
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage organization settings and configuration</p>
      </div>

      <div className="space-y-6">
        {/* Organization Details */}
        <Card className="border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45">
          <CardHeader>
            <CardTitle>Organization Details</CardTitle>
            <CardDescription>Basic information about your organization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Organization Name</label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value) }}
                placeholder="My Organization"
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Slug</label>
              <Input
                value={slug}
                onChange={(e) => { setSlug(e.target.value) }}
                placeholder="my-organization"
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">Used in URLs and API routes</p>
            </div>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>

        {/* Organization Visibility */}
        <Card className="border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45">
          <CardHeader>
            <CardTitle>Visibility</CardTitle>
            <CardDescription>Control who can discover this organization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <label className="flex items-center gap-3 p-3 border border-slate-200/50 rounded cursor-pointer hover:bg-slate-50/50 dark:border-slate-800 dark:hover:bg-slate-900/30">
                <input type="radio" name="visibility" value="private" defaultChecked className="w-4 h-4" />
                <div>
                  <div className="font-medium text-sm">Private</div>
                  <p className="text-xs text-muted-foreground">Only members can see</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 border border-slate-200/50 rounded cursor-pointer hover:bg-slate-50/50 dark:border-slate-800 dark:hover:bg-slate-900/30">
                <input type="radio" name="visibility" value="public" className="w-4 h-4" />
                <div>
                  <div className="font-medium text-sm">Public</div>
                  <p className="text-xs text-muted-foreground">Anyone can discover</p>
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-200/60 dark:border-red-900/40">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
            <CardDescription>Irreversible actions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Deleting your organization will permanently remove all data including members, invites, and projects.
            </p>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Organization'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
