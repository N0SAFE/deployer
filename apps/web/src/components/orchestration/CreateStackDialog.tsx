'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Plus, X, Loader2 } from 'lucide-react'
import { orpc } from '@/lib/orpc'

interface CreateStackDialogProps {
  projectId: string
  trigger?: React.ReactNode
  onSuccess?: (stackId: string) => void
}

interface DomainMapping {
  service: string
  domains: string[]
}

type Environment = 'development' | 'staging' | 'production'
type SslProvider = 'letsencrypt' | 'cloudflare' | 'custom'

export default function CreateStackDialog({ 
  projectId,
  trigger, 
  onSuccess 
}: CreateStackDialogProps) {
  const [open, setOpen] = useState(false)
  const createStackMutation = useMutation(orpc.orchestration.createStack.mutationOptions({
    onSuccess: (result) => {
      simpleToast('Stack Created', `Stack "${formData.stackName}" created successfully`)
      setOpen(false)
      resetForm()
      onSuccess?.(result.stackId || '')
    },
    onError: (error) => {
      simpleToast('Failed to Create Stack', error instanceof Error ? error.message : 'Unknown error', 'destructive')
    }
  }))
  const [formData, setFormData] = useState({
    stackName: '',
    environment: 'development' as Environment,
    composeConfig: '',
    domainMappings: [] as DomainMapping[],
    cpuLimit: '',
    memoryLimit: '',
    storageLimit: '',
    maxReplicas: '',
    maxServices: '',
    sslEmail: '',
    sslProvider: 'letsencrypt' as SslProvider,
    sslStaging: true
  })

  const [newDomainMapping, setNewDomainMapping] = useState<DomainMapping>({
    service: '',
    domains: ['']
  })

  const simpleToast = (title: string, description: string, variant: 'default' | 'destructive' = 'default') => {
    // Simple toast implementation - in a real app you'd use a proper toast library
    console.log(`${variant === 'destructive' ? 'ERROR' : 'INFO'}: ${title} - ${description}`)
    alert(`${title}\n${description}`)
  }

  const resetForm = () => {
    setFormData({
      stackName: '',
      environment: 'development',
      composeConfig: '',
      domainMappings: [],
      cpuLimit: '',
      memoryLimit: '',
      storageLimit: '',
      maxReplicas: '',
      maxServices: '',
      sslEmail: '',
      sslProvider: 'letsencrypt',
      sslStaging: true
    })
    setNewDomainMapping({
      service: '',
      domains: ['']
    })
  }

  const addDomainMapping = () => {
    if (!newDomainMapping.service || !newDomainMapping.domains[0]) {
      simpleToast('Invalid Domain Mapping', 'Service name and domain are required', 'destructive')
      return
    }

    setFormData(prev => ({
      ...prev,
      domainMappings: [...prev.domainMappings, { ...newDomainMapping }]
    }))
    setNewDomainMapping({
      service: '',
      domains: ['']
    })
  }

  const removeDomainMapping = (index: number) => {
    setFormData(prev => ({
      ...prev,
      domainMappings: prev.domainMappings.filter((_, i) => i !== index)
    }))
  }

  const updateDomainMappingDomain = (mappingIndex: number, domainIndex: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      domainMappings: prev.domainMappings.map((mapping, i) => 
        i === mappingIndex 
          ? {
              ...mapping,
              domains: mapping.domains.map((domain, j) => j === domainIndex ? value : domain)
            }
          : mapping
      )
    }))
  }

  const addDomainToMapping = (mappingIndex: number) => {
    setFormData(prev => ({
      ...prev,
      domainMappings: prev.domainMappings.map((mapping, i) => 
        i === mappingIndex 
          ? { ...mapping, domains: [...mapping.domains, ''] }
          : mapping
      )
    }))
  }

  const handleSubmit = () => {
    if (!formData.stackName || !formData.composeConfig) {
      simpleToast('Missing Required Fields', 'Stack name and compose configuration are required', 'destructive')
      return
    }

    let composeConfig
    try {
      composeConfig = JSON.parse(formData.composeConfig)
    } catch {
      simpleToast('Invalid Compose Configuration', 'Please provide valid JSON for the compose configuration', 'destructive')
      return
    }

    // Build domain mappings in the format the API expects
    const domainMappings: Record<string, string[]> = {}
    formData.domainMappings.forEach(mapping => {
      if (mapping.service && mapping.domains.length > 0) {
        domainMappings[mapping.service] = mapping.domains.filter(domain => domain.trim() !== '')
      }
    })

    // Build resource quotas if provided
    const resourceQuotas: {
      cpuLimit?: string
      memoryLimit?: string
      storageLimit?: string
      maxReplicas?: number
      maxServices?: number
    } = {}
    if (formData.cpuLimit) resourceQuotas.cpuLimit = formData.cpuLimit
    if (formData.memoryLimit) resourceQuotas.memoryLimit = formData.memoryLimit
    if (formData.storageLimit) resourceQuotas.storageLimit = formData.storageLimit
    if (formData.maxReplicas) resourceQuotas.maxReplicas = parseInt(formData.maxReplicas)
    if (formData.maxServices) resourceQuotas.maxServices = parseInt(formData.maxServices)

    // Build SSL config if email provided
    const sslConfig = formData.sslEmail ? {
      email: formData.sslEmail,
      provider: formData.sslProvider,
      staging: formData.sslStaging
    } : undefined

    createStackMutation.mutate({
      projectId,
      stackName: formData.stackName,
      environment: formData.environment,
      composeConfig,
      domainMappings: Object.keys(domainMappings).length > 0 ? domainMappings : undefined,
      resourceQuotas: Object.keys(resourceQuotas).length > 0 ? resourceQuotas : undefined,
      sslConfig
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Create Stack
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Stack</DialogTitle>
          <DialogDescription>
            Create a new Docker Swarm stack for deployment orchestration
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Basic Configuration */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Basic Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="stackName">Stack Name *</Label>
                  <Input
                    id="stackName"
                    placeholder="my-app-stack"
                    value={formData.stackName}
                    onChange={(e) => setFormData(prev => ({ ...prev, stackName: e.target.value }))}
                  />
                </div>

                <div>
                  <Label htmlFor="environment">Environment *</Label>
                  <Select value={formData.environment} onValueChange={(value: Environment) => setFormData(prev => ({ ...prev, environment: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="development">Development</SelectItem>
                      <SelectItem value="staging">Staging</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="composeConfig">Docker Compose Configuration *</Label>
                  <Textarea
                    id="composeConfig"
                    placeholder="Paste your docker-compose.yml as JSON..."
                    className="h-32 font-mono text-sm"
                    value={formData.composeConfig}
                    onChange={(e) => setFormData(prev => ({ ...prev, composeConfig: e.target.value }))}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Resource Quotas */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Resource Quotas (Optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cpuLimit">CPU Limit</Label>
                    <Input
                      id="cpuLimit"
                      placeholder="1.0"
                      value={formData.cpuLimit}
                      onChange={(e) => setFormData(prev => ({ ...prev, cpuLimit: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="memoryLimit">Memory Limit</Label>
                    <Input
                      id="memoryLimit"
                      placeholder="512M"
                      value={formData.memoryLimit}
                      onChange={(e) => setFormData(prev => ({ ...prev, memoryLimit: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxReplicas">Max Replicas</Label>
                    <Input
                      id="maxReplicas"
                      type="number"
                      placeholder="5"
                      value={formData.maxReplicas}
                      onChange={(e) => setFormData(prev => ({ ...prev, maxReplicas: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxServices">Max Services</Label>
                    <Input
                      id="maxServices"
                      type="number"
                      placeholder="10"
                      value={formData.maxServices}
                      onChange={(e) => setFormData(prev => ({ ...prev, maxServices: e.target.value }))}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Domain Mappings & SSL */}
          <div className="space-y-4">
            {/* Domain Mappings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Domain Mappings (Optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Existing Mappings */}
                {formData.domainMappings.map((mapping, mappingIndex) => (
                  <div key={mappingIndex} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="outline" className="text-xs">
                        {mapping.service}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDomainMapping(mappingIndex)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    {mapping.domains.map((domain, domainIndex) => (
                      <div key={domainIndex} className="mb-2">
                        <Input
                          placeholder="example.com"
                          value={domain}
                          onChange={(e) => updateDomainMappingDomain(mappingIndex, domainIndex, e.target.value)}
                        />
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addDomainToMapping(mappingIndex)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Domain
                    </Button>
                  </div>
                ))}

                {/* Add New Mapping */}
                <div className="border-2 border-dashed rounded-lg p-3">
                  <div className="space-y-2">
                    <Input
                      placeholder="Service name"
                      value={newDomainMapping.service}
                      onChange={(e) => setNewDomainMapping(prev => ({ ...prev, service: e.target.value }))}
                    />
                    <Input
                      placeholder="Domain (e.g., example.com)"
                      value={newDomainMapping.domains[0]}
                      onChange={(e) => setNewDomainMapping(prev => ({ ...prev, domains: [e.target.value] }))}
                    />
                    <Button variant="outline" size="sm" onClick={addDomainMapping}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add Mapping
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* SSL Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">SSL Configuration (Optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="sslEmail">Email for Let&apos;s Encrypt</Label>
                  <Input
                    id="sslEmail"
                    type="email"
                    placeholder="admin@example.com"
                    value={formData.sslEmail}
                    onChange={(e) => setFormData(prev => ({ ...prev, sslEmail: e.target.value }))}
                  />
                </div>

                <div>
                  <Label htmlFor="sslProvider">SSL Provider</Label>
                  <Select value={formData.sslProvider} onValueChange={(value: SslProvider) => setFormData(prev => ({ ...prev, sslProvider: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="letsencrypt">Let&apos;s Encrypt</SelectItem>
                      <SelectItem value="cloudflare">Cloudflare</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="sslStaging"
                    checked={formData.sslStaging}
                    onChange={(e) => setFormData(prev => ({ ...prev, sslStaging: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="sslStaging">Use staging environment (recommended for testing)</Label>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={createStackMutation.isPending}
          >
            {createStackMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Create Stack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}