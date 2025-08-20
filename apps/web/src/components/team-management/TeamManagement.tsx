'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { 
  Users,
  UserPlus,
  MoreHorizontal,
  Mail,
  Crown,
  Shield,
  Eye,
  Trash2,
  Send
} from 'lucide-react'

interface TeamMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'developer' | 'viewer'
  avatar?: string
  joinedAt: Date
  lastActive: Date
}

interface TeamManagementProps {
  projectId: string
  members: TeamMember[]
  currentUserId: string
  onInviteMember: (email: string, role: string) => Promise<void>
  onUpdateRole: (memberId: string, role: string) => Promise<void>
  onRemoveMember: (memberId: string) => Promise<void>
}

export default function TeamManagement({
  projectId: _projectId,
  members,
  currentUserId,
  onInviteMember,
  onUpdateRole,
  onRemoveMember
}: TeamManagementProps) {
  // TODO: Use projectId for API calls
  console.log('Managing team for project:', _projectId)
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'developer' | 'viewer'>('developer')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const currentUser = members.find(member => member.id === currentUserId)
  const isOwnerOrAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin'

  const handleInvite = async () => {
    if (!inviteEmail || !isOwnerOrAdmin) return
    
    setIsSubmitting(true)
    try {
      await onInviteMember(inviteEmail, inviteRole)
      setInviteEmail('')
      setInviteRole('developer')
      setIsInviteDialogOpen(false)
    } catch (error) {
      console.error('Failed to invite member:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRoleChange = async (memberId: string, newRole: string) => {
    if (!isOwnerOrAdmin || memberId === currentUserId) return
    
    try {
      await onUpdateRole(memberId, newRole)
    } catch (error) {
      console.error('Failed to update role:', error)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!isOwnerOrAdmin || memberId === currentUserId) return
    
    try {
      await onRemoveMember(memberId)
    } catch (error) {
      console.error('Failed to remove member:', error)
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-4 w-4 text-yellow-600" />
      case 'admin':
        return <Shield className="h-4 w-4 text-red-600" />
      case 'developer':
        return <Users className="h-4 w-4 text-blue-600" />
      case 'viewer':
        return <Eye className="h-4 w-4 text-gray-600" />
      default:
        return <Users className="h-4 w-4 text-gray-600" />
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-yellow-100 text-yellow-800'
      case 'admin':
        return 'bg-red-100 text-red-800'
      case 'developer':
        return 'bg-blue-100 text-blue-800'
      case 'viewer':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatTimeAgo = (date: Date) => {
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`
    return `${Math.floor(diffInHours / 168)}w ago`
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Team Management</h2>
          <p className="text-muted-foreground">
            Manage team members and their permissions for this project
          </p>
        </div>
        
        {isOwnerOrAdmin && (
          <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>
                  Send an invitation to join this project. They&apos;ll receive an email with access instructions.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                
                <div>
                  <Label htmlFor="role">Role</Label>
                  <Select value={inviteRole} onValueChange={(value: 'admin' | 'developer' | 'viewer') => setInviteRole(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">
                        <div className="flex items-center space-x-2">
                          <Eye className="h-4 w-4" />
                          <div>
                            <span>Viewer</span>
                            <p className="text-sm text-gray-500">Read-only access</p>
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="developer">
                        <div className="flex items-center space-x-2">
                          <Users className="h-4 w-4" />
                          <div>
                            <span>Developer</span>
                            <p className="text-sm text-gray-500">Can deploy and manage services</p>
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="admin">
                        <div className="flex items-center space-x-2">
                          <Shield className="h-4 w-4" />
                          <div>
                            <span>Admin</span>
                            <p className="text-sm text-gray-500">Full project access</p>
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex space-x-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setIsInviteDialogOpen(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleInvite}
                    disabled={!inviteEmail || isSubmitting}
                    className="flex-1"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {isSubmitting ? 'Sending...' : 'Send Invitation'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Team Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm text-muted-foreground">Total Members</p>
                <p className="text-2xl font-bold">{members.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Shield className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-sm text-muted-foreground">Admins</p>
                <p className="text-2xl font-bold">
                  {members.filter(m => m.role === 'admin' || m.role === 'owner').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm text-muted-foreground">Developers</p>
                <p className="text-2xl font-bold">
                  {members.filter(m => m.role === 'developer').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Eye className="h-5 w-5 text-gray-600" />
              <div>
                <p className="text-sm text-muted-foreground">Viewers</p>
                <p className="text-2xl font-bold">
                  {members.filter(m => m.role === 'viewer').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Members List */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            All members of this project and their current roles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <Avatar>
                    <AvatarImage src={member.avatar} alt={member.name} />
                    <AvatarFallback>
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div>
                    <div className="flex items-center space-x-2">
                      <p className="font-medium">{member.name}</p>
                      {member.id === currentUserId && (
                        <Badge variant="outline" className="text-xs">You</Badge>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      <span>{member.email}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Last active: {formatTimeAgo(member.lastActive)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1">
                    {getRoleIcon(member.role)}
                    <Badge className={getRoleColor(member.role)}>
                      {member.role}
                    </Badge>
                  </div>

                  {isOwnerOrAdmin && member.id !== currentUserId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {member.role !== 'owner' && (
                          <>
                            <DropdownMenuItem onClick={() => handleRoleChange(member.id, 'viewer')}>
                              <Eye className="h-4 w-4 mr-2" />
                              Make Viewer
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(member.id, 'developer')}>
                              <Users className="h-4 w-4 mr-2" />
                              Make Developer
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(member.id, 'admin')}>
                              <Shield className="h-4 w-4 mr-2" />
                              Make Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleRemoveMember(member.id)}
                              className="text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove Member
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}

            {members.length === 0 && (
              <div className="text-center py-8">
                <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No team members found</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Role Permissions Info */}
      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
          <CardDescription>
            Understanding what each role can do in this project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Crown className="h-4 w-4 text-yellow-600" />
                <span className="font-medium">Owner</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Full project control</li>
                <li>• Delete project</li>
                <li>• Transfer ownership</li>
                <li>• All admin permissions</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Shield className="h-4 w-4 text-red-600" />
                <span className="font-medium">Admin</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Manage team members</li>
                <li>• Configure project settings</li>
                <li>• All developer permissions</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4 text-blue-600" />
                <span className="font-medium">Developer</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Deploy services</li>
                <li>• Manage deployments</li>
                <li>• View logs and metrics</li>
                <li>• Create/edit services</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Eye className="h-4 w-4 text-gray-600" />
                <span className="font-medium">Viewer</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• View project overview</li>
                <li>• View deployment status</li>
                <li>• View activity feed</li>
                <li>• Read-only access</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}