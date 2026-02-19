'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { Globe, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { orpc } from '@/lib/orpc'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DomainVerificationStatus } from './DomainVerificationStatus'
import { toast } from 'sonner'

interface ProjectDomainSelectorProps {
  projectId: string
  organizationId: string
}

export function ProjectDomainSelector({ projectId, organizationId }: ProjectDomainSelectorProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [isAddingNewDomain, setIsAddingNewDomain] = useState(false)
  const queryClient = useQueryClient()

  // Fetch project domains
  const { data: projectDomains, isLoading: loadingProjectDomains } = useQuery(
    orpc.domain.listProjectDomains.queryOptions({
      input: { projectId }
    })
  )

  // Fetch available organization domains
  const { data: availableDomains, isLoading: loadingAvailable } = useQuery(
    orpc.domain.getAvailableDomains.queryOptions({
      input: { projectId, organizationId }
    })
  )

  // Add new domain to organization
  const addOrgDomain = useMutation({
    ...orpc.domain.addOrganizationDomain.mutationOptions(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.getAvailableDomains.queryKey({ input: { projectId, organizationId } })
      })
      // Automatically select the newly added domain
      setSelectedDomainIds(prev => [...prev, data.id])
      setNewDomain('')
      setIsAddingNewDomain(false)
      toast.success('Domain added to organization')
    },
    onError: (error) => {
      toast.error(`Failed to add domain: ${error.message}`)
    }
  })

  // Add domains to project (batch operation)
  const addDomainsToProject = useMutation({
    mutationFn: async (domainIds: string[]) => {
      const results = await Promise.allSettled(
        domainIds.map(domainId =>
          orpc.domain.addProjectDomain.call({
            projectId,
            organizationDomainId: domainId,
          })
        )
      )
      return results
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const failCount = results.filter(r => r.status === 'rejected').length
      
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listProjectDomains.queryKey({ input: { projectId } })
      })
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.getAvailableDomains.queryKey({ input: { projectId, organizationId } })
      })
      
      setIsAddDialogOpen(false)
      setSelectedDomainIds([])
      
      if (failCount === 0) {
        toast.success(`${successCount} domain(s) added successfully`)
      } else {
        toast.warning(`${successCount} succeeded, ${failCount} failed`)
      }
    },
  })

  // Remove domain from project
  const removeDomain = useMutation({
    ...orpc.domain.removeProjectDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listProjectDomains.queryKey({ input: { projectId } })
      })
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.getAvailableDomains.queryKey({ input: { projectId, organizationId } })
      })
      toast.success('Domain removed from project')
    },
  })

  const handleToggleDomain = (domainId: string) => {
    setSelectedDomainIds(prev =>
      prev.includes(domainId)
        ? prev.filter(id => id !== domainId)
        : [...prev, domainId]
    )
  }

  const handleAddNewDomain = async () => {
    if (!newDomain.trim()) return
    
    await addOrgDomain.mutateAsync({
      organizationId,
      domain: newDomain.trim(),
    })
  }

  const handleAddSelectedDomains = async () => {
    if (selectedDomainIds.length === 0) return
    await addDomainsToProject.mutateAsync(selectedDomainIds)
  }

  const isLoading = loadingProjectDomains || loadingAvailable

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Project Domains
            </CardTitle>
            <CardDescription>
              Select or add domains for this project
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Manage Domains
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Domains to Project</DialogTitle>
                <DialogDescription>
                  Select existing domains or add new ones to your organization
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6 py-4">
                {/* Add New Domain Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Add New Domain</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAddingNewDomain(!isAddingNewDomain)}
                    >
                      {isAddingNewDomain ? 'Cancel' : '+ New Domain'}
                    </Button>
                  </div>
                  
                  {isAddingNewDomain && (
                    <div className="flex gap-2">
                      <Input
                        placeholder="example.com"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddNewDomain()
                          }
                        }}
                      />
                      <Button
                        onClick={handleAddNewDomain}
                        disabled={addOrgDomain.isPending || !newDomain.trim()}
                      >
                        {addOrgDomain.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Add
                      </Button>
                    </div>
                  )}
                </div>

                {/* Available Domains List */}
                <div className="space-y-3">
                  <Label>Available Domains</Label>
                  {loadingAvailable ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : availableDomains && availableDomains.length > 0 ? (
                    <div className="space-y-2">
                      {availableDomains.map((domain) => (
                        <div
                          key={domain.id}
                          className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                          onClick={() => handleToggleDomain(domain.id)}
                        >
                          <Checkbox
                            checked={selectedDomainIds.includes(domain.id)}
                            onCheckedChange={() => handleToggleDomain(domain.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{domain.domain}</span>
                              <DomainVerificationStatus 
                                status={domain.verificationStatus as 'verified' | 'pending' | 'failed'}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Added {new Date(domain.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 border rounded-lg border-dashed">
                      <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No available domains. Add a new domain above.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setIsAddDialogOpen(false)
                  setSelectedDomainIds([])
                  setIsAddingNewDomain(false)
                  setNewDomain('')
                }}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleAddSelectedDomains}
                  disabled={addDomainsToProject.isPending || selectedDomainIds.length === 0}
                >
                  {addDomainsToProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add {selectedDomainIds.length > 0 && `(${selectedDomainIds.length})`} Domain{selectedDomainIds.length !== 1 ? 's' : ''}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : projectDomains && projectDomains.length > 0 ? (
          <div className="space-y-3">
            {projectDomains.map((projectDomain) => (
              <div 
                key={projectDomain.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{projectDomain.organizationDomain.domain}</h4>
                    <DomainVerificationStatus 
                      status={projectDomain.organizationDomain.verificationStatus as 'verified' | 'pending' | 'failed'}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Added {new Date(projectDomain.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => removeDomain.mutate({ projectId, domainId: projectDomain.id })}
                  disabled={removeDomain.isPending}
                >
                  {removeDomain.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">No domains assigned to this project</p>
            <Button 
              onClick={() => setIsAddDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Domains
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
