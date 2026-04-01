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
  useOrganizationMembers,
  useInviteOrganizationMember,
  useRemoveOrganizationMember,
  type OrganizationRole,
} from '@/domains/organization/hooks'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

export default function AdminMembersPage() {
  const params = useParams(AuthDashboardAdminOrganizationsOrganizationId)
  const organizationId = params.organizationId
  const [inviteEmail, setInviteEmail] = useState('')
  const [selectedRole] = useState<OrganizationRole>('member')

  // Fetch members
  const { data: membersData, isLoading } = useOrganizationMembers(organizationId)
  const members = membersData?.members ?? []

  // Mutations
  const inviteMutation = useInviteOrganizationMember()
  const removeMutation = useRemoveOrganizationMember()

  const handleInvite = () => {
    if (!inviteEmail) return
    inviteMutation.mutate(
      { organizationId, email: inviteEmail, role: selectedRole },
      {
        onSuccess: () => {
          setInviteEmail('')
        },
      }
    )
  }

  const handleRemove = (memberId: string) => {
    if (confirm('Are you sure you want to remove this member?')) {
      removeMutation.mutate({ organizationId, memberIdOrEmail: memberId })
    }
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
        <h1 className="text-3xl font-bold tracking-tight">Members</h1>
        <p className="text-muted-foreground mt-2">Manage organization members and their roles</p>
      </div>

      {/* Invite Member Section */}
      <Card className="border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45">
        <CardHeader>
          <CardTitle>Invite Member</CardTitle>
          <CardDescription>Add new members to your organization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Input
              type="email"
              placeholder="member@example.com"
              value={inviteEmail}
              onChange={(e) => { setInviteEmail(e.target.value) }}
              className="flex-1"
            />
            <Button onClick={handleInvite} disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? 'Sending...' : 'Invite'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Members List */}
      <Card className="border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45">
        <CardHeader>
          <CardTitle>Organization Members</CardTitle>
          <CardDescription>
            {isLoading ? 'Loading...' : members.length === 0 ? 'No members' : `${String(members.length)} member(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-muted-foreground">No members yet</p>
                <p className="text-sm text-muted-foreground mt-1">Invite members to get started</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200/50 dark:border-slate-800">
                  <tr>
                    <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Role</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Joined</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className="border-b border-slate-200/50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                      <td className="p-3 font-medium">{member.user.name}</td>
                      <td className="p-3 text-muted-foreground">{member.user.email}</td>
                      <td className="p-3">
                        <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded dark:bg-blue-900/30 dark:text-blue-400">
                          {member.role}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            handleRemove(member.id)
                          }}
                          disabled={removeMutation.isPending}
                          className="text-destructive hover:text-destructive"
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
