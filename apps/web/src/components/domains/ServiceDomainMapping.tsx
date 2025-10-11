'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Switch } from '@repo/ui/components/shadcn/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Globe, Plus, Trash2, Edit, Loader2, Star, ExternalLink, AlertCircle } from 'lucide-react'
import { orpc } from '@/lib/orpc'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import { DomainConflictWarning } from './DomainConflictWarning'

interface ServiceDomainMappingProps {
  serviceId: string
  projectId: string
}

export function ServiceDomainMapping({ serviceId, projectId }: ServiceDomainMappingProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<{ id: string; projectDomainId: string; subdomain?: string | null; basePath: string | null; sslEnabled: boolean; sslProvider: 'letsencrypt' | 'custom' | 'none'; isPrimary: boolean } | null>(null)
  
  const [formData, setFormData] = useState({
    projectDomainId: '',
    subdomain: '',
    basePath: '/',
    sslEnabled: true,
    sslProvider: 'letsencrypt' as 'letsencrypt' | 'custom' | 'none',
    isPrimary: false,
  })

  const queryClient = useQueryClient()

  // Fetch service domain mappings
  const { data: mappings, isLoading: loadingMappings } = useQuery(
    orpc.domain.listServiceDomains.queryOptions({
      input: { serviceId }
    })
  )

  // Fetch project domains
  const { data: projectDomains, isLoading: loadingDomains } = useQuery(
    orpc.domain.listProjectDomains.queryOptions({
      input: { projectId }
    })
  )

  // Create domain mapping
  const createMapping = useMutation({
    ...orpc.domain.addServiceDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listServiceDomains.queryKey({ input: { serviceId } })
      })
      setIsAddDialogOpen(false)
      resetForm()
    },
  })

  // Update domain mapping
  const updateMapping = useMutation({
    ...orpc.domain.updateServiceDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listServiceDomains.queryKey({ input: { serviceId } })
      })
      setIsEditDialogOpen(false)
      setEditingMapping(null)
      resetForm()
    },
  })

  // Delete domain mapping
  const deleteMapping = useMutation({
    ...orpc.domain.removeServiceDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listServiceDomains.queryKey({ input: { serviceId } })
      })
    },
  })

  // Set primary domain
  const setPrimary = useMutation({
    ...orpc.domain.setPrimaryServiceDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listServiceDomains.queryKey({ input: { serviceId } })
      })
    },
  })

  const resetForm = () => {
    setFormData({
      projectDomainId: '',
      subdomain: '',
      basePath: '/',
      sslEnabled: true,
      sslProvider: 'letsencrypt',
      isPrimary: false,
    })
  }

  const handleEdit = (mapping: { id: string; projectDomainId: string; subdomain?: string | null; basePath: string | null; sslEnabled: boolean; sslProvider: 'letsencrypt' | 'custom' | 'none'; isPrimary: boolean }) => {
    setEditingMapping(mapping)
    setFormData({
      projectDomainId: mapping.projectDomainId,
      subdomain: mapping.subdomain || '',
      basePath: mapping.basePath || '/',
      sslEnabled: mapping.sslEnabled,
      sslProvider: mapping.sslProvider as 'letsencrypt' | 'custom' | 'none',
      isPrimary: mapping.isPrimary,
    })
    setIsEditDialogOpen(true)
  }

  const handleCreate = async () => {
    await createMapping.mutateAsync({
      serviceId,
      projectDomainId: formData.projectDomainId,
      subdomain: formData.subdomain || null,
      basePath: formData.basePath,
      sslEnabled: formData.sslEnabled,
      sslProvider: formData.sslProvider,
      isPrimary: formData.isPrimary,
    })
  }

  const handleUpdate = async () => {
    if (!editingMapping) throw new Error('No mapping selected')
    await updateMapping.mutateAsync({
      serviceId,
      mappingId: editingMapping.id,
      subdomain: formData.subdomain || null,
      basePath: formData.basePath,
      sslEnabled: formData.sslEnabled,
      sslProvider: formData.sslProvider,
    })
  }

  const isLoading = loadingMappings || loadingDomains

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Service Domain Mappings
            </CardTitle>
            <CardDescription>
              Configure custom domains and subdomains for this service
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={!projectDomains || projectDomains.length === 0}>
                <Plus className="h-4 w-4 mr-2" />
                Add Mapping
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Domain Mapping</DialogTitle>
                <DialogDescription>
                  Configure how this service will be accessible via custom domains
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <DomainConflictWarning
                  projectDomainId={formData.projectDomainId}
                  subdomain={formData.subdomain}
                />
                
                <div>
                  <Label>Project Domain</Label>
                  <Select value={formData.projectDomainId} onValueChange={(value) => setFormData({ ...formData, projectDomainId: value })}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a domain" />
                    </SelectTrigger>
                    <SelectContent>
                      {projectDomains?.map((domain) => (
                        <SelectItem key={domain.id} value={domain.id}>
                          {domain.organizationDomain.domain}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="subdomain">Subdomain (optional)</Label>
                  <Input
                    id="subdomain"
                    placeholder="api"
                    value={formData.subdomain}
                    onChange={(e) => setFormData({ ...formData, subdomain: e.target.value })}
                    className="mt-1"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Leave empty to use the root domain
                  </p>
                </div>

                <div>
                  <Label htmlFor="basePath">Base Path</Label>
                  <Input
                    id="basePath"
                    placeholder="/api/v1"
                    value={formData.basePath}
                    onChange={(e) => setFormData({ ...formData, basePath: e.target.value })}
                    className="mt-1"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    URL path prefix for routing
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="sslEnabled">Enable SSL/TLS</Label>
                    <p className="text-sm text-muted-foreground">
                      Secure connections with HTTPS
                    </p>
                  </div>
                  <Switch
                    id="sslEnabled"
                    checked={formData.sslEnabled}
                    onCheckedChange={(checked) => setFormData({ ...formData, sslEnabled: checked })}
                  />
                </div>

                {formData.sslEnabled && (
                  <div>
                    <Label>SSL Provider</Label>
                    <Select 
                      value={formData.sslProvider} 
                      onValueChange={(value: 'letsencrypt' | 'custom' | 'none') => setFormData({ ...formData, sslProvider: value })}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="letsencrypt">Let&apos;s Encrypt (Auto)</SelectItem>
                        <SelectItem value="custom">Custom Certificate</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="isPrimary">Set as Primary Domain</Label>
                    <p className="text-sm text-muted-foreground">
                      Main domain for this service
                    </p>
                  </div>
                  <Switch
                    id="isPrimary"
                    checked={formData.isPrimary}
                    onCheckedChange={(checked) => setFormData({ ...formData, isPrimary: checked })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreate}
                  disabled={createMapping.isPending || !formData.projectDomainId}
                >
                  {createMapping.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Mapping
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
        ) : mappings && mappings.length > 0 ? (
          <div className="space-y-3">
            {mappings.map((mapping) => (
              <Card key={mapping.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <a 
                          href={mapping.fullUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline flex items-center gap-1"
                        >
                          {mapping.fullUrl}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {mapping.isPrimary && (
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                            <Star className="h-3 w-3 mr-1" />
                            Primary
                          </Badge>
                        )}
                        {mapping.sslEnabled && (
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            SSL
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p>Domain: {mapping.organizationDomain.domain}</p>
                        {mapping.subdomain && <p>Subdomain: {mapping.subdomain}</p>}
                        <p>Base Path: {mapping.basePath}</p>
                        {mapping.sslEnabled && <p>SSL Provider: {mapping.sslProvider}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!mapping.isPrimary && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPrimary.mutate({ serviceId, mappingId: mapping.id })}
                          disabled={setPrimary.isPending}
                        >
                          {setPrimary.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Star className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(mapping)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteMapping.mutate({ serviceId, mappingId: mapping.id })}
                        disabled={deleteMapping.isPending}
                      >
                        {deleteMapping.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">No domain mappings configured</p>
            {projectDomains && projectDomains.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Add project domains first before creating service mappings
                </AlertDescription>
              </Alert>
            ) : (
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Mapping
              </Button>
            )}
          </div>
        )}

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Domain Mapping</DialogTitle>
              <DialogDescription>
                Update the configuration for this domain mapping
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="edit-subdomain">Subdomain (optional)</Label>
                <Input
                  id="edit-subdomain"
                  placeholder="api"
                  value={formData.subdomain}
                  onChange={(e) => setFormData({ ...formData, subdomain: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="edit-basePath">Base Path</Label>
                <Input
                  id="edit-basePath"
                  placeholder="/api/v1"
                  value={formData.basePath}
                  onChange={(e) => setFormData({ ...formData, basePath: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="edit-sslEnabled">Enable SSL/TLS</Label>
                  <p className="text-sm text-muted-foreground">
                    Secure connections with HTTPS
                  </p>
                </div>
                <Switch
                  id="edit-sslEnabled"
                  checked={formData.sslEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, sslEnabled: checked })}
                />
              </div>

              {formData.sslEnabled && (
                <div>
                  <Label>SSL Provider</Label>
                  <Select 
                    value={formData.sslProvider} 
                    onValueChange={(value: 'letsencrypt' | 'custom' | 'none') => setFormData({ ...formData, sslProvider: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="letsencrypt">Let&apos;s Encrypt (Auto)</SelectItem>
                      <SelectItem value="custom">Custom Certificate</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleUpdate}
                disabled={updateMapping.isPending}
              >
                {updateMapping.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Update Mapping
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
