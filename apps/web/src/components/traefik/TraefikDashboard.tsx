'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { 
  Globe, 
  Server, 
  Activity,
  Plus,
  Settings,
  Shield,
  Route as RouteIcon,
  Power,
  PowerOff,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  FileCheck,
  Trash2,
  Database,
  File,
  CheckCircle2,
  AlertTriangle,
  Loader2
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'

export default function TraefikDashboard() {
  const [activeTab, setActiveTab] = useState('instances')
  const [createInstanceOpen, setCreateInstanceOpen] = useState(false)
  const [createDomainOpen, setCreateDomainOpen] = useState(false)
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('')
  const [selectedDomainConfigId] = useState<string>('')
  const [configInstanceId, setConfigInstanceId] = useState<string>('')
  const queryClient = useQueryClient()

  // Traefik Instances
  const { data: instances = [], isLoading: instancesLoading } = useQuery(
    orpc.traefik.listInstances.queryOptions({
      input: {},
      staleTime: 30000, // 30 seconds
    })
  )

  // Domain Configurations - only load if instance is selected
  const { data: domainConfigs = [], isLoading: domainsLoading } = useQuery(
    orpc.traefik.listDomainConfigs.queryOptions({
      input: { instanceId: selectedInstanceId },
      enabled: !!selectedInstanceId,
      staleTime: 30000, // 30 seconds
    })
  )

  // Route Configurations - only load if domain is selected
  const { data: routeConfigs = [], isLoading: routesLoading } = useQuery(
    orpc.traefik.listRouteConfigs.queryOptions({
      input: { domainConfigId: selectedDomainConfigId },
      enabled: !!selectedDomainConfigId,
      staleTime: 30000, // 30 seconds
    })
  )

  // Create Instance Mutation
  const createInstanceMutation = useMutation(
    orpc.traefik.createInstance.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.traefik.listInstances.queryKey({ input: {} }) })
        toast.success('Traefik instance created successfully')
        setCreateInstanceOpen(false)
      },
      onError: (error: Error) => {
        toast.error(`Failed to create instance: ${error.message}`)
      },
    })
  )

  // Start/Stop Instance Mutations
  const startInstanceMutation = useMutation(
    orpc.traefik.startInstance.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.traefik.listInstances.queryKey({ input: {} }) })
        toast.success('Traefik instance started successfully')
      },
      onError: (error: Error) => {
        toast.error(`Failed to start instance: ${error.message}`)
      },
    })
  )

  const stopInstanceMutation = useMutation(
    orpc.traefik.stopInstance.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.traefik.listInstances.queryKey({ input: {} }) })
        toast.success('Traefik instance stopped successfully')
      },
      onError: (error: Error) => {
        toast.error(`Failed to stop instance: ${error.message}`)
      },
    })
  )

  // Create Domain Mutation
  const createDomainMutation = useMutation(
    orpc.traefik.createDomainConfig.mutationOptions({
      onSuccess: (_, variables) => {
        queryClient.invalidateQueries({ 
          queryKey: orpc.traefik.listDomainConfigs.queryKey({ 
            input: { instanceId: variables.instanceId } 
          }) 
        })
        toast.success('Domain configuration created successfully')
        setCreateDomainOpen(false)
      },
      onError: (error: Error) => {
        toast.error(`Failed to create domain configuration: ${error.message}`)
      },
    })
  )

  // Create Route Mutation
  const createRouteMutation = useMutation(
    orpc.traefik.createRouteConfig.mutationOptions({
      onSuccess: (_, variables) => {
        queryClient.invalidateQueries({ 
          queryKey: orpc.traefik.listRouteConfigs.queryKey({ 
            input: { domainConfigId: variables.domainConfigId } 
          }) 
        })
        toast.success('Route configuration created successfully')
        setCreateRouteOpen(false)
      },
      onError: (error: Error) => {
        toast.error(`Failed to create route configuration: ${error.message}`)
      },
    })
  )

  // Delete Route Mutation
  const deleteRouteMutation = useMutation(
    orpc.traefik.deleteRouteConfig.mutationOptions({
      onSuccess: () => {
        // Invalidate all route queries since we don't have domainConfigId context
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'listRouteConfigs'
        })
        toast.success('Route configuration deleted successfully')
      },
      onError: (error: Error) => {
        toast.error(`Failed to delete route configuration: ${error.message}`)
      },
    })
  )

  // DNS checking mutations
  const checkDNSMutation = useMutation(
    orpc.traefik.checkDNS.mutationOptions({
      onSuccess: (result) => {
        toast.success(`DNS check completed: ${result.status}`)
      },
      onError: (error: Error) => {
        toast.error(`DNS check failed: ${error.message}`)
      },
    })
  )

  const validateDomainDNSMutation = useMutation(
    orpc.traefik.validateDomainDNS.mutationOptions({
      onSuccess: () => {
        // Invalidate domain configs to refresh DNS status
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'listDomainConfigs'
        })
        toast.success('Domain DNS validation completed')
      },
      onError: (error: Error) => {
        toast.error(`DNS validation failed: ${error.message}`)
      },
    })
  )

  // Configuration management queries and mutations
  const { data: instanceConfigs = [], isLoading: configsLoading } = useQuery(
    orpc.traefik.getInstanceConfigs.queryOptions({
      input: { instanceId: configInstanceId },
      enabled: !!configInstanceId,
      staleTime: 15000, // 15 seconds
    })
  )

  const { data: configSyncStatus, isLoading: syncStatusLoading } = useQuery(
    orpc.traefik.getConfigSyncStatus.queryOptions({
      input: { instanceId: configInstanceId },
      enabled: !!configInstanceId,
      staleTime: 10000, // 10 seconds
    })
  )

  const { data: instanceStatus, isLoading: instanceStatusLoading } = useQuery(
    orpc.traefik.getInstanceStatus.queryOptions({
      input: { instanceId: configInstanceId },
      enabled: !!configInstanceId,
      staleTime: 15000, // 15 seconds
    })
  )

  const forceSyncMutation = useMutation(
    orpc.traefik.forceSyncConfigs.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'getConfigSyncStatus'
        })
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'getInstanceConfigs'
        })
        toast.success(`Configuration sync completed: ${result.successful}/${result.total} successful`)
      },
      onError: (error: Error) => {
        toast.error(`Configuration sync failed: ${error.message}`)
      },
    })
  )

  const cleanupFilesMutation = useMutation(
    orpc.traefik.cleanupOrphanedFiles.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'getInstanceStatus'
        })
        toast.success(`Cleaned up ${result.count} orphaned files`)
      },
      onError: (error: Error) => {
        toast.error(`File cleanup failed: ${error.message}`)
      },
    })
  )

  const validateConfigsMutation = useMutation(
    orpc.traefik.validateConfigFiles.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'getInstanceConfigs'
        })
        toast.success(`Configuration validation completed: ${result.valid}/${result.valid + result.invalid} valid`)
      },
      onError: (error: Error) => {
        toast.error(`Configuration validation failed: ${error.message}`)
      },
    })
  )

  const syncSingleConfigMutation = useMutation(
    orpc.traefik.syncSingleConfig.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'getInstanceConfigs'
        })
        queryClient.invalidateQueries({ 
          predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'getConfigSyncStatus'
        })
        toast.success(`Configuration ${result.action}: ${result.filePath}`)
      },
      onError: (error: Error) => {
        toast.error(`Configuration sync failed: ${error.message}`)
      },
    })
  )

  const handleCreateInstance = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    
    createInstanceMutation.mutate({
      name: formData.get('name') as string,
      dashboardPort: parseInt(formData.get('dashboardPort') as string) || undefined,
      httpPort: parseInt(formData.get('httpPort') as string) || undefined,
      httpsPort: parseInt(formData.get('httpsPort') as string) || undefined,
      acmeEmail: (formData.get('acmeEmail') as string) || undefined,
      logLevel: (formData.get('logLevel') as string) as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' || 'INFO',
      insecureApi: (formData.get('insecureApi') as string) === 'true',
    })
  }

  const handleCreateDomain = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    
    createDomainMutation.mutate({
      instanceId: formData.get('instanceId') as string,
      domain: formData.get('domain') as string,
      subdomain: (formData.get('subdomain') as string) || undefined,
      sslEnabled: (formData.get('sslEnabled') as string) === 'true',
      sslProvider: (formData.get('sslProvider') as string) as 'letsencrypt' | 'selfsigned' | 'custom' || undefined,
      isActive: true,
    })
  }

  const handleCreateRoute = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    
    createRouteMutation.mutate({
      domainConfigId: formData.get('domainConfigId') as string,
      routeName: formData.get('routeName') as string,
      serviceName: formData.get('serviceName') as string,
      targetPort: parseInt(formData.get('targetPort') as string),
      deploymentId: (formData.get('deploymentId') as string) || undefined,
      containerName: (formData.get('containerName') as string) || undefined,
      pathPrefix: (formData.get('pathPrefix') as string) || '/',
      priority: parseInt(formData.get('priority') as string) || undefined,
      middleware: (formData.get('middleware') as string)?.split(',').map(m => m.trim()).filter(Boolean) || [],
      isActive: true,
    })
  }

  const runningInstances = instances.filter(instance => instance.status === 'running')
  const totalDomains = domainConfigs.length
  const activeRoutes = routeConfigs.filter(route => route.isActive === true)

  // DNS status helpers
  const getDNSStatusIcon = (status: string | null) => {
    switch (status) {
      case 'valid':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'invalid':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-orange-600" />
      case 'pending':
      default:
        return <Clock className="h-4 w-4 text-gray-600" />
    }
  }

  const getDNSStatusColor = (status: string | null) => {
    switch (status) {
      case 'valid':
        return 'default'
      case 'invalid':
        return 'destructive'
      case 'error':
        return 'secondary'
      case 'pending':
      default:
        return 'outline'
    }
  }

  // Configuration status helpers
  const getConfigSyncStatusIcon = (status: string) => {
    switch (status) {
      case 'synced':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'pending':
        return <Clock className="h-4 w-4 text-orange-600" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'outdated':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />
      default:
        return <Clock className="h-4 w-4 text-gray-600" />
    }
  }

  const getConfigSyncStatusColor = (status: string) => {
    switch (status) {
      case 'synced':
        return 'default'
      case 'pending':
        return 'secondary'
      case 'failed':
        return 'destructive'
      case 'outdated':
        return 'outline'
      default:
        return 'outline'
    }
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Globe className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Traefik Management Dashboard
              </h1>
              <p className="text-gray-600">
                Manage your Traefik instances, domains, and routing configurations
              </p>
            </div>
          </div>
          <Button onClick={() => window.location.reload()} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Server className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-sm text-gray-600">Running Instances</p>
                  <p className="text-2xl font-bold">{runningInstances.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Globe className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-gray-600">Configured Domains</p>
                  <p className="text-2xl font-bold">{totalDomains}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <RouteIcon className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-sm text-gray-600">Active Routes</p>
                  <p className="text-2xl font-bold">{activeRoutes.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Database className="h-8 w-8 text-indigo-600" />
                <div>
                  <p className="text-sm text-gray-600">Configuration Files</p>
                  <p className="text-2xl font-bold">{configInstanceId && instanceConfigs ? instanceConfigs.length : '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-sm text-gray-600">Total Configs</p>
                  <p className="text-2xl font-bold">{instances.length + domainConfigs.length + routeConfigs.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="instances" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Instances
          </TabsTrigger>
          <TabsTrigger value="domains" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Domains
          </TabsTrigger>
          <TabsTrigger value="routes" className="flex items-center gap-2">
            <RouteIcon className="h-4 w-4" />
            Routes
          </TabsTrigger>
          <TabsTrigger value="configuration" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="dns" className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            DNS Check
          </TabsTrigger>
        </TabsList>

        {/* Instances Tab */}
        <TabsContent value="instances" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Traefik Instances</h2>
            <Dialog open={createInstanceOpen} onOpenChange={setCreateInstanceOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Instance
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Traefik Instance</DialogTitle>
                  <DialogDescription>
                    Configure a new Traefik instance for load balancing and routing
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateInstance} className="space-y-4">
                  <div>
                    <Label htmlFor="name">Instance Name</Label>
                    <Input id="name" name="name" placeholder="e.g., main-traefik" required />
                  </div>
                  <div>
                    <Label htmlFor="configPath">Configuration Path</Label>
                    <Input id="configPath" name="configPath" placeholder="/etc/traefik/traefik.yml" required />
                  </div>
                  <div>
                    <Label htmlFor="port">Port</Label>
                    <Input id="port" name="port" type="number" placeholder="8080" required />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setCreateInstanceOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createInstanceMutation.isPending}>
                      {createInstanceMutation.isPending ? 'Creating...' : 'Create Instance'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {instancesLoading ? (
              <div className="text-center py-8">Loading instances...</div>
            ) : instances.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Server className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Traefik Instances</h3>
                  <p className="text-gray-600 mb-4">Create your first Traefik instance to get started</p>
                  <Button onClick={() => setCreateInstanceOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Instance
                  </Button>
                </CardContent>
              </Card>
            ) : (
              instances.map(instance => (
                <Card key={instance.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold">{instance.name}</h3>
                          <Badge variant={instance.status === 'running' ? 'default' : 'secondary'}>
                            {instance.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {instance.status === 'running' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => stopInstanceMutation.mutate({ instanceId: instance.id })}
                            disabled={stopInstanceMutation.isPending}
                          >
                            <PowerOff className="h-4 w-4 mr-2" />
                            Stop
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => startInstanceMutation.mutate({ instanceId: instance.id })}
                            disabled={startInstanceMutation.isPending}
                          >
                            <Power className="h-4 w-4 mr-2" />
                            Start
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => {
                            setConfigInstanceId(instance.id)
                            setActiveTab('configuration')
                          }}
                        >
                          <Database className="h-4 w-4 mr-2" />
                          View Configs
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => {
                            setSelectedInstanceId(instance.id)
                            setActiveTab('domains')
                          }}
                        >
                          <Globe className="h-4 w-4 mr-2" />
                          View Domains
                        </Button>
                        <Button size="sm" variant="outline">
                          <Settings className="h-4 w-4 mr-2" />
                          Configure
                        </Button>
                      </div>
                    </div>
                    <CardDescription>
                      Status: {instance.status} • Dashboard Port: {instance.dashboardPort || 'N/A'} • HTTP Port: {instance.httpPort || 'N/A'}
                    </CardDescription>
                  </CardHeader>
                  {instance.status === 'running' && (
                    <CardContent>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>Dashboard Port: {instance.dashboardPort || 'Not configured'}</span>
                        <span>Created: {instance.createdAt.toLocaleDateString()}</span>
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Domains Tab */}
        <TabsContent value="domains" className="space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-semibold">Domain Configurations</h2>
              {selectedInstanceId && (
                <Badge variant="outline">
                  Instance: {instances.find(i => i.id === selectedInstanceId)?.name || 'Unknown'}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <select 
                value={selectedInstanceId} 
                onChange={(e) => setSelectedInstanceId(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-md"
              >
                <option value="">All instances</option>
                {instances.map(instance => (
                  <option key={instance.id} value={instance.id}>{instance.name}</option>
                ))}
              </select>
              <Dialog open={createDomainOpen} onOpenChange={setCreateDomainOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Domain
                  </Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Domain Configuration</DialogTitle>
                  <DialogDescription>
                    Configure a new domain for your Traefik instance
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateDomain} className="space-y-4">
                  <div>
                    <Label htmlFor="domain">Domain Name</Label>
                    <Input id="domain" name="domain" placeholder="example.com" required />
                  </div>
                  <div>
                    <Label htmlFor="subdomain">Subdomain (optional)</Label>
                    <Input id="subdomain" name="subdomain" placeholder="api, app, www" />
                  </div>
                  <div>
                    <Label htmlFor="instanceId">Traefik Instance</Label>
                    <select id="instanceId" name="instanceId" required className="w-full px-3 py-2 border border-gray-200 rounded-md">
                      <option value="">Select an instance</option>
                      {instances.map(instance => (
                        <option key={instance.id} value={instance.id}>{instance.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      id="sslEnabled" 
                      name="sslEnabled" 
                      className="h-4 w-4"
                    />
                    <Label htmlFor="sslEnabled">Enable SSL/HTTPS</Label>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setCreateDomainOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createDomainMutation.isPending}>
                      {createDomainMutation.isPending ? 'Adding...' : 'Add Domain'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
            </div>
          </div>

          <div className="grid gap-4">
            {domainsLoading ? (
              <div className="text-center py-8">Loading domains...</div>
            ) : domainConfigs.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Globe className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Domain Configurations</h3>
                  <p className="text-gray-600 mb-4">Add your first domain configuration to get started</p>
                  <Button onClick={() => setCreateDomainOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Domain
                  </Button>
                </CardContent>
              </Card>
            ) : (
              domainConfigs.map(domain => (
                <Card key={domain.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Globe className="h-5 w-5 text-blue-600" />
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{domain.fullDomain}</h3>
                            {domain.subdomain && (
                              <Badge variant="outline" className="text-xs">
                                {domain.subdomain}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            Instance: {instances.find(i => i.id === domain.traefikInstanceId)?.name || domain.traefikInstanceId}
                          </p>
                          {domain.dnsLastChecked && (
                            <p className="text-xs text-gray-500">
                              DNS checked: {new Date(domain.dnsLastChecked).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={domain.isActive ? 'default' : 'secondary'}>
                          {domain.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        {domain.sslEnabled && (
                          <Badge variant="outline">
                            <Shield className="h-3 w-3 mr-1" />
                            SSL
                          </Badge>
                        )}
                        {/* DNS Status Badge */}
                        <Badge 
                          variant={getDNSStatusColor(domain.dnsStatus)} 
                          className="flex items-center gap-1"
                        >
                          {getDNSStatusIcon(domain.dnsStatus)}
                          DNS: {domain.dnsStatus || 'pending'}
                        </Badge>
                        {/* DNS Validation Button */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => validateDomainDNSMutation.mutate({ domainConfigId: domain.id })}
                          disabled={validateDomainDNSMutation.isPending}
                        >
                          <RefreshCw className={`h-3 w-3 mr-1 ${validateDomainDNSMutation.isPending ? 'animate-spin' : ''}`} />
                          Check DNS
                        </Button>
                      </div>
                    </div>
                    {/* DNS Error Message */}
                    {domain.dnsStatus === 'error' && domain.dnsErrorMessage && (
                      <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        <div className="flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          DNS Error: {domain.dnsErrorMessage}
                        </div>
                      </div>
                    )}
                    {/* DNS Records Display */}
                    {domain.dnsStatus === 'valid' && domain.dnsRecords && Array.isArray(domain.dnsRecords) && domain.dnsRecords.length > 0 && (
                      <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-sm">
                        <div className="flex items-center gap-1 text-green-700 font-medium mb-1">
                          <CheckCircle className="h-4 w-4" />
                          DNS Records Found:
                        </div>
                        <div className="space-y-1">
                          {domain.dnsRecords.map((record, index) => (
                            <div key={index} className="text-green-600 font-mono text-xs">
                              {record.type}: {record.value}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Routes Tab */}
        <TabsContent value="routes" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Route Configurations</h2>
            <Dialog open={createRouteOpen} onOpenChange={setCreateRouteOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Route
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Route Configuration</DialogTitle>
                  <DialogDescription>
                    Configure a new routing rule for your Traefik instance
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateRoute} className="space-y-4">
                  <div>
                    <Label htmlFor="name">Route Name</Label>
                    <Input id="name" name="name" placeholder="api-route" required />
                  </div>
                  <div>
                    <Label htmlFor="rule">Routing Rule</Label>
                    <Input id="rule" name="rule" placeholder="Host(`api.example.com`)" required />
                  </div>
                  <div>
                    <Label htmlFor="service">Service</Label>
                    <Input id="service" name="service" placeholder="http://backend:8080" required />
                  </div>
                  <div>
                    <Label htmlFor="instanceId">Traefik Instance</Label>
                    <select id="instanceId" name="instanceId" required className="w-full px-3 py-2 border border-gray-200 rounded-md">
                      <option value="">Select an instance</option>
                      {instances.map(instance => (
                        <option key={instance.id} value={instance.id}>{instance.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="priority">Priority (optional)</Label>
                    <Input id="priority" name="priority" type="number" placeholder="100" />
                  </div>
                  <div>
                    <Label htmlFor="middlewares">Middlewares (comma-separated, optional)</Label>
                    <Input id="middlewares" name="middlewares" placeholder="auth, compress" />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setCreateRouteOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createRouteMutation.isPending}>
                      {createRouteMutation.isPending ? 'Creating...' : 'Create Route'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {routesLoading ? (
              <div className="text-center py-8">Loading routes...</div>
            ) : routeConfigs.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <RouteIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Route Configurations</h3>
                  <p className="text-gray-600 mb-4">Create your first route configuration to get started</p>
                  <Button onClick={() => setCreateRouteOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Route
                  </Button>
                </CardContent>
              </Card>
            ) : (
              routeConfigs.map(route => (
                <Card key={route.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <RouteIcon className="h-5 w-5 text-purple-600" />
                        <div>
                          <h3 className="font-semibold">{route.routeName}</h3>
                          <p className="text-sm text-gray-600 font-mono">Path: {route.pathPrefix} → {route.serviceName}:{route.targetPort}</p>
                          <p className="text-sm text-gray-500">
                            Service: {route.serviceName} • Domain: {domainConfigs.find(d => d.id === route.domainConfigId)?.fullDomain || 'N/A'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={route.isActive ? 'default' : 'secondary'}>
                          {route.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        {route.priority && (
                          <Badge variant="outline">
                            Priority: {route.priority}
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteRouteMutation.mutate({ routeConfigId: route.id })}
                          disabled={deleteRouteMutation.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    {Array.isArray(route.middleware) && route.middleware.length > 0 && (
                      <div className="mt-2 flex gap-1">
                        {(route.middleware as string[]).map((middlewareItem: string) => (
                          <Badge key={middlewareItem} variant="outline" className="text-xs">
                            {middlewareItem}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Configuration Tab */}
        <TabsContent value="configuration" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Configuration Management</h2>
            <div className="flex gap-2">
              <select 
                value={configInstanceId} 
                onChange={(e) => setConfigInstanceId(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-md"
              >
                <option value="">Select instance to manage</option>
                {instances.map(instance => (
                  <option key={instance.id} value={instance.id}>{instance.name}</option>
                ))}
              </select>
              {configInstanceId && (
                <Button
                  onClick={() => window.location.reload()}
                  variant="outline"
                  size="sm"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              )}
            </div>
          </div>

          {!configInstanceId ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Settings className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-semibold mb-2">Select Instance</h3>
                <p className="text-gray-600">Choose a Traefik instance to manage its configuration</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Instance Status Overview */}
              {instanceStatus && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Database className="h-5 w-5 text-blue-600" />
                        Configurations
                      </h3>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Total:</span>
                          <span className="font-medium">{instanceStatus.configurations.total}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Static:</span>
                          <span className="font-medium">{instanceStatus.configurations.static}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Dynamic:</span>
                          <span className="font-medium">{instanceStatus.configurations.dynamic}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>RefreshCwed:</span>
                          <span className="font-medium text-green-600">{instanceStatus.configurations.synced}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Pending:</span>
                          <span className="font-medium text-orange-600">{instanceStatus.configurations.pending}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Failed:</span>
                          <span className="font-medium text-red-600">{instanceStatus.configurations.failed}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <File className="h-5 w-5 text-green-600" />
                        Files
                      </h3>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Total:</span>
                          <span className="font-medium">{instanceStatus.files.total}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Exists:</span>
                          <span className="font-medium text-green-600">{instanceStatus.files.exists}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Writable:</span>
                          <span className="font-medium text-blue-600">{instanceStatus.files.writable}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Orphaned:</span>
                          <span className="font-medium text-orange-600">{instanceStatus.files.orphaned}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Activity className="h-5 w-5 text-purple-600" />
                        Instance Status
                      </h3>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Status:</span>
                          <Badge variant={instanceStatus.instance.status === 'running' ? 'default' : 'secondary'}>
                            {instanceStatus.instance.status}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Dashboard:</span>
                          <span className="font-medium">{instanceStatus.instance.dashboardPort || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>HTTP:</span>
                          <span className="font-medium">{instanceStatus.instance.httpPort || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>HTTPS:</span>
                          <span className="font-medium">{instanceStatus.instance.httpsPort || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Last Update:</span>
                          <span className="font-medium text-xs">{new Date(instanceStatus.lastUpdate).toLocaleString()}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Configuration Actions */}
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold">Configuration Actions</h3>
                  <CardDescription>
                    Manage configuration synchronization and validation
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Button
                      onClick={() => forceSyncMutation.mutate({ instanceId: configInstanceId })}
                      disabled={forceSyncMutation.isPending}
                      className="flex items-center gap-2"
                    >
                      {forceSyncMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Force RefreshCw All
                    </Button>
                    
                    <Button
                      onClick={() => validateConfigsMutation.mutate({ instanceId: configInstanceId })}
                      disabled={validateConfigsMutation.isPending}
                      variant="outline"
                      className="flex items-center gap-2"
                    >
                      {validateConfigsMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileCheck className="h-4 w-4" />
                      )}
                      Validate All
                    </Button>
                    
                    <Button
                      onClick={() => cleanupFilesMutation.mutate({ instanceId: configInstanceId })}
                      disabled={cleanupFilesMutation.isPending}
                      variant="destructive"
                      className="flex items-center gap-2"
                    >
                      {cleanupFilesMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Cleanup Files
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Configuration RefreshCw Status */}
              {configSyncStatus && (
                <Card>
                  <CardHeader>
                    <h3 className="text-lg font-semibold">RefreshCw Status Summary</h3>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{configSyncStatus.total}</div>
                        <div className="text-sm text-gray-600">Total</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{configSyncStatus.synced}</div>
                        <div className="text-sm text-gray-600">RefreshCwed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">{configSyncStatus.pending}</div>
                        <div className="text-sm text-gray-600">Pending</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{configSyncStatus.failed}</div>
                        <div className="text-sm text-gray-600">Failed</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Individual Configurations */}
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold">Configuration Files</h3>
                  <CardDescription>
                    Individual configuration management and sync status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {configsLoading ? (
                    <div className="text-center py-8">Loading configurations...</div>
                  ) : instanceConfigs.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      No configurations found for this instance
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {instanceConfigs.map(config => (
                        <div key={config.id} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                {getConfigSyncStatusIcon(config.syncStatus || 'pending')}
                                <div>
                                  <h4 className="font-medium">{config.configName}</h4>
                                  <p className="text-sm text-gray-600">
                                    Type: {config.configType} • Version: {config.configVersion || 'N/A'}
                                  </p>
                                  {config.lastSyncedAt && (
                                    <p className="text-xs text-gray-500">
                                      Last synced: {new Date(config.lastSyncedAt).toLocaleString()}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={getConfigSyncStatusColor(config.syncStatus || 'pending')}>
                                {config.syncStatus || 'pending'}
                              </Badge>
                              {config.requiresFile && (
                                <Badge variant="outline" className="text-xs">
                                  <File className="h-3 w-3 mr-1" />
                                  File Required
                                </Badge>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => syncSingleConfigMutation.mutate({ 
                                  configId: config.id,
                                  forceSync: true 
                                })}
                                disabled={syncSingleConfigMutation.isPending}
                              >
                                {syncSingleConfigMutation.isPending ? (
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3 w-3 mr-1" />
                                )}
                                RefreshCw
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* DNS Check Tab */}
        <TabsContent value="dns" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">DNS Testing & Validation</h2>
          </div>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Check DNS Records</h3>
              <CardDescription>
                Test DNS resolution for any domain to verify configuration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form 
                onSubmit={(e) => {
                  e.preventDefault()
                  const formData = new FormData(e.currentTarget)
                  checkDNSMutation.mutate({
                    domain: formData.get('testDomain') as string,
                    recordType: (formData.get('recordType') as string) as 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS'
                  })
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="testDomain">Domain to Test</Label>
                    <Input id="testDomain" name="testDomain" placeholder="example.com or subdomain.example.com" required />
                  </div>
                  <div>
                    <Label htmlFor="recordType">Record Type</Label>
                    <select id="recordType" name="recordType" className="w-full px-3 py-2 border border-gray-200 rounded-md">
                      <option value="A">A (IPv4)</option>
                      <option value="AAAA">AAAA (IPv6)</option>
                      <option value="CNAME">CNAME</option>
                      <option value="MX">MX (Mail)</option>
                      <option value="TXT">TXT</option>
                      <option value="NS">NS (Nameserver)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" disabled={checkDNSMutation.isPending} className="w-full">
                      {checkDNSMutation.isPending ? (
                        <>
                          <Clock className="h-4 w-4 mr-2 animate-spin" />
                          Checking...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Check DNS
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>

              {/* DNS Test Results */}
              {checkDNSMutation.data && (
                <div className="mt-6 p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    {getDNSStatusIcon(checkDNSMutation.data.status)}
                    <h4 className="font-semibold">
                      DNS Check Results: {checkDNSMutation.data.domain}
                    </h4>
                    <Badge variant={getDNSStatusColor(checkDNSMutation.data.status)}>
                      {checkDNSMutation.data.status}
                    </Badge>
                  </div>
                  
                  {checkDNSMutation.data.status === 'valid' && checkDNSMutation.data.records.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-green-700">Records Found:</p>
                      {checkDNSMutation.data.records.map((record, index) => (
                        <div key={index} className="bg-green-50 p-2 rounded text-sm font-mono">
                          <span className="font-bold text-green-800">{record.type}:</span> {record.value}
                          {record.ttl && <span className="text-green-600 ml-2">(TTL: {record.ttl})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {checkDNSMutation.data.status === 'error' && checkDNSMutation.data.errorMessage && (
                    <div className="bg-red-50 p-3 rounded text-sm text-red-700">
                      <div className="flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        <strong>Error:</strong> {checkDNSMutation.data.errorMessage}
                      </div>
                    </div>
                  )}
                  
                  {checkDNSMutation.data.status === 'invalid' && (
                    <div className="bg-yellow-50 p-3 rounded text-sm text-yellow-700">
                      <div className="flex items-center gap-1">
                        <XCircle className="h-4 w-4" />
                        <strong>No records found</strong> for the specified domain and record type.
                      </div>
                    </div>
                  )}
                  
                  <p className="text-xs text-gray-500 mt-2">
                    Checked at: {new Date(checkDNSMutation.data.checkedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Domain DNS Status Overview */}
          {domainConfigs.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">Domain DNS Status Overview</h3>
                <CardDescription>
                  Current DNS validation status for all configured domains
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {domainConfigs.map(domain => (
                    <div key={domain.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Globe className="h-4 w-4 text-blue-600" />
                        <div>
                          <p className="font-medium">{domain.fullDomain}</p>
                          <p className="text-sm text-gray-600">
                            {domain.dnsLastChecked 
                              ? `Last checked: ${new Date(domain.dnsLastChecked).toLocaleString()}`
                              : 'Never checked'
                            }
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getDNSStatusColor(domain.dnsStatus)} className="flex items-center gap-1">
                          {getDNSStatusIcon(domain.dnsStatus)}
                          {domain.dnsStatus || 'pending'}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => validateDomainDNSMutation.mutate({ domainConfigId: domain.id })}
                          disabled={validateDomainDNSMutation.isPending}
                        >
                          <RefreshCw className={`h-3 w-3 mr-1 ${validateDomainDNSMutation.isPending ? 'animate-spin' : ''}`} />
                          Recheck
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}