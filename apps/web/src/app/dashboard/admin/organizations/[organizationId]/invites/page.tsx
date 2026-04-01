'use client'

import { useParams } from '@/routes/hooks'
import { AuthDashboardAdminOrganizationsOrganizationId } from '@/routes'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function AdminInvitesPage() {
  const params = useParams(AuthDashboardAdminOrganizationsOrganizationId)
  const organizationId = params.organizationId

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
        <h1 className="text-3xl font-bold tracking-tight">Pending Invitations</h1>
        <p className="text-muted-foreground mt-2">Manage pending member invitations</p>
      </div>

      {/* Invitations List */}
      <Card className="border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45">
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>Members who have been invited but haven't accepted yet</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">No pending invitations</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
