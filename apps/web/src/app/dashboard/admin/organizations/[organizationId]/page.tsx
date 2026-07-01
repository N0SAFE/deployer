'use client'

import { useState } from 'react'
import { useParams } from '@/routes/hooks'
import { AuthDashboardAdminOrganizations, AuthDashboardAdminOrganizationsOrganizationId } from '@/routes'
import { useOrganization, useOrganizationMembers } from '@/domains/organization/hooks'
import {
  useCheckMyFleetAdmission,
  useCreateMyFleetAdmissionRequest,
  useMyFleetAdmissionRequests,
  useMyFleetAllocations,
} from '@/domains/fleet/hooks'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Button } from '@repo/ui/components/shadcn/button'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Input } from '@repo/ui/components/shadcn/input'
import { ArrowLeft, Mail, Settings, Users } from 'lucide-react'
import Link from 'next/link'

export default function AdminOrganizationDetailPage() {
  const params = useParams(AuthDashboardAdminOrganizationsOrganizationId)
  const organizationId = params.organizationId
  const [activeTab, setActiveTab] = useState('overview')

  // Organization data
  const { data: organization, isLoading: isLoadingOrg, error: orgError } = useOrganization(organizationId)
  const { data: membersData, isLoading: isLoadingMembers } = useOrganizationMembers(organizationId)
  const members = membersData?.members ?? []

  // Fleet admission data
  const { data: myFleetAllocationsData, isLoading: isLoadingFleetAllocations } = useMyFleetAllocations()
  const checkAdmission = useCheckMyFleetAdmission()
  const createAdmissionRequest = useCreateMyFleetAdmissionRequest()
  const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('all')
  const { data: myAdmissionRequestsData, isLoading: isLoadingMyAdmissionRequests } = useMyFleetAdmissionRequests(
    { status: requestStatusFilter === 'all' ? undefined : requestStatusFilter }
  )

  // Capacity form state
  const [requestedCpuMillicores, setRequestedCpuMillicores] = useState(500)
  const [requestedMemoryMb, setRequestedMemoryMb] = useState(512)
  const [requestedServices, setRequestedServices] = useState(1)
  const [requestedServerNodeId, setRequestedServerNodeId] = useState('')
  const [requesterNote, setRequesterNote] = useState('')

  const myFleetAllocations = myFleetAllocationsData?.items ?? []
  const myAdmissionRequests = myAdmissionRequestsData?.items ?? []
  const visibleFleetAllocations = myFleetAllocations.filter((allocation) => allocation.organizationId === organizationId)

  const surfaceCardClass = 'border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45'

  const handleCreateAdmissionRequest = async () => {
    const trimmedNote = requesterNote.trim()
    await createAdmissionRequest.mutateAsync({
      requestedCpuMillicores: Math.max(0, requestedCpuMillicores),
      requestedMemoryMb: Math.max(0, requestedMemoryMb),
      requestedServices: Math.max(0, requestedServices),
      requestedServerNodeId: requestedServerNodeId.trim() === '' ? undefined : requestedServerNodeId.trim(),
      requesterNote: trimmedNote.length > 0 ? trimmedNote : checkAdmission.data?.reason ?? null,
    })
    setRequesterNote('')
  }

  if (isLoadingOrg) {
    return (
      <div className="container mx-auto max-w-350 py-8 space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (orgError || !organization) {
    return (
      <div className="container mx-auto max-w-350 py-8 space-y-6">
        <AuthDashboardAdminOrganizations.Link>
          <Button variant="ghost" className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to organizations
          </Button>
        </AuthDashboardAdminOrganizations.Link>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load organization</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-350 py-8 space-y-6">
      {/* Header */}
      <AuthDashboardAdminOrganizations.Link>
        <Button variant="ghost" className="-ml-2 mb-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </AuthDashboardAdminOrganizations.Link>
      <div className="rounded-xl border border-slate-200/70 bg-linear-to-b from-white to-slate-50/70 p-5 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:to-slate-900/50">
        <h1 className="text-3xl font-bold tracking-tight">{organization.name}</h1>
        <p className="mt-1 text-muted-foreground">@{organization.slug}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{members.length} members</Badge>
          <Badge variant="outline">Created {new Date(organization.createdAt).toLocaleDateString()}</Badge>
        </div>
      </div>

      {/* Tabbed interface */}
      <Card className={surfaceCardClass}>
        <CardHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="members" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Members</span>
              </TabsTrigger>
              <TabsTrigger value="capacity">Capacity</TabsTrigger>
              <TabsTrigger value="settings" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Settings</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="pt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60 p-4">
                  <p className="text-sm font-medium text-muted-foreground">ID</p>
                  <p className="text-xs font-mono mt-2 break-all">{organizationId}</p>
                </div>
                <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60 p-4">
                  <p className="text-sm font-medium text-muted-foreground">Members</p>
                  <p className="text-2xl font-bold mt-2">{members.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60 p-4">
                  <p className="text-sm font-medium text-muted-foreground">Created</p>
                  <p className="text-sm font-semibold mt-2">{new Date(organization.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </TabsContent>

            {/* Members Tab */}
            <TabsContent value="members" className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Organization Members</h3>
                  <p className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</p>
                </div>
                <Link href={`/dashboard/admin/organizations/${organizationId}/members`}>
                  <Button size="sm">Manage</Button>
                </Link>
              </div>
              {isLoadingMembers ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : members.length > 0 ? (
                <div className="space-y-2">
                  {members.slice(0, 5).map((member) => (
                    <div key={member.id} className="flex items-center justify-between p-3 rounded border border-slate-200/50 dark:border-slate-800">
                      <div>
                        <p className="font-medium text-sm">{member.user.name}</p>
                        <p className="text-xs text-muted-foreground">{member.user.email}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {member.role}
                      </Badge>
                    </div>
                  ))}
                  {members.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center py-2">+{members.length - 5} more members</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">No members yet</p>
              )}
            </TabsContent>

            {/* Capacity Tab */}
            <TabsContent value="capacity" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Admission Requests</CardTitle>
                  <CardDescription>Submit and track capacity requests</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm border-slate-200/80 dark:border-slate-800"
                    value={requestStatusFilter}
                    onChange={(e) => setRequestStatusFilter(e.target.value as 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled')}
                  >
                    <option value="all">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="cancelled">Cancelled</option>
                  </select>

                  {isLoadingMyAdmissionRequests ? (
                    <div className="space-y-2">
                      {[1, 2].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : myAdmissionRequests.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No admission requests</p>
                  ) : (
                    <div className="space-y-2">
                      {myAdmissionRequests.slice(0, 5).map((request) => (
                        <div key={request.id} className="rounded border border-slate-200/50 dark:border-slate-800 p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <p className="font-medium">{request.status.toUpperCase()}</p>
                            <Badge variant="outline" className="text-xs">CPU {request.requestedCpuMillicores}m · RAM {request.requestedMemoryMb}MB</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {new Date(request.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Allocated Capacity</CardTitle>
                  <CardDescription>Current CPU/RAM limits across servers</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingFleetAllocations ? (
                    <div className="space-y-2">
                      {[1, 2].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : visibleFleetAllocations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No allocations assigned</p>
                  ) : (
                    <div className="space-y-2">
                      {visibleFleetAllocations.map((allocation) => (
                        <div key={allocation.id} className="rounded border border-slate-200/50 dark:border-slate-800 p-3">
                          <p className="font-medium text-sm">{allocation.serverUrl ?? allocation.serverNodeId}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            CPU: {allocation.cpuMillicores}m · RAM: {allocation.memoryMb}MB · Mode: {allocation.allocationMode}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Settings Tab */}
            <TabsContent value="settings" className="space-y-4">
              <Link href={`/dashboard/admin/organizations/${organizationId}/settings`}>
                <Button className="w-full" variant="outline">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage Settings
                </Button>
              </Link>
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60 p-4 text-center text-muted-foreground">
                <Settings className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Edit organization details, visibility, and danger zone actions</p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}