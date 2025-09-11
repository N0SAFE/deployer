'use client'

import React, { useState, useEffect } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@repo/ui/components/shadcn/dialog'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@repo/ui/components/shadcn/tabs'
import {
    Save,
    X,
    Eye,
    Code,
    Settings,
    CheckCircle,
    AlertCircle,
    Loader2,
    Upload,
} from 'lucide-react'
import { orpc } from '@/lib/orpc/index'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

interface TraefikConfigEditorProps {
    serviceId: string
    serviceName: string
    filePath?: string
    isOpen: boolean
    onClose: () => void
}

interface TraefikMiddleware {
    headers?: {
        customHeaders?: Record<string, string>
    }
}

interface TraefikHealthCheck {
    enabled: boolean
    path: string
    interval: number
    timeout: number
}

interface TraefikConfig {
    id: string
    serviceId: string
    domain: string
    subdomain?: string
    fullDomain: string
    sslEnabled: boolean
    sslProvider?: string
    pathPrefix: string
    port: number
    middleware?: TraefikMiddleware
    healthCheck?: TraefikHealthCheck
    isActive: boolean
    configContent: string
    lastSyncedAt?: string
    createdAt: string
    updatedAt: string
}

export const TraefikConfigEditor: React.FC<TraefikConfigEditorProps> = ({
    serviceId,
    serviceName,
    filePath,
    isOpen,
    onClose,
}) => {
    const [config, setConfig] = useState<TraefikConfig | null>(null)
    const [configContent, setConfigContent] = useState('')
    const [domain, setDomain] = useState('')
    const [subdomain, setSubdomain] = useState('')
    const [pathPrefix, setPathPrefix] = useState('/')
    const [port, setPort] = useState(80)
    const [sslEnabled, setSslEnabled] = useState(false)
    const [sslProvider, setSslProvider] = useState('')
    const [isActive, setIsActive] = useState(true)
    const [activeTab, setActiveTab] = useState('visual')
    const [isLoading, setIsLoading] = useState(false)
    const [validationError, setValidationError] = useState<string | null>(null)

    const queryClient = useQueryClient()

    // File content mutation for loading existing files
    const getFileContentMutation = useMutation(
        orpc.traefik.getFileContent.mutationOptions({
            onSuccess: (response) => {
                if (response.content) {
                    setConfigContent(response.content)
                    // Try to parse YAML and extract configuration values
                    parseYamlConfig(response.content)
                    console.log('Loaded existing config content')
                } else {
                    resetToDefaults()
                }
                setIsLoading(false)
            },
            onError: (error) => {
                console.log('Error loading config, using defaults:', error)
                resetToDefaults()
                setIsLoading(false)
            }
        })
    )

    // Load existing config when dialog opens
    useEffect(() => {
        if (isOpen && serviceId) {
            loadConfig()
        }
    }, [isOpen, serviceId, filePath])

    const loadConfig = async () => {
        setIsLoading(true)
        
        if (filePath) {
            // Load existing file content
            console.log('Loading existing Traefik config from:', filePath)
            await getFileContentMutation.mutateAsync({ filePath })
        } else {
            // Creating new config, use defaults
            console.log('Creating new Traefik config for service:', serviceId)
            resetToDefaults()
            setIsLoading(false)
        }
    }

    const parseYamlConfig = (yamlContent: string) => {
        try {
            // Basic YAML parsing to extract common values
            // This is a simple regex-based approach - in production you might want to use a YAML parser
            
            // Extract domain from Host rule
            const hostMatch = yamlContent.match(/Host\(\`([^\`]+)\`\)/)
            if (hostMatch) {
                const fullHost = hostMatch[1]
                const parts = fullHost.split('.')
                if (parts.length >= 2) {
                    if (parts.length > 2) {
                        setSubdomain(parts[0])
                        setDomain(parts.slice(1).join('.'))
                    } else {
                        setDomain(fullHost)
                        setSubdomain('')
                    }
                }
            }
            
            // Extract port from service URL
            const portMatch = yamlContent.match(/url: "http:\/\/[^:]+:(\d+)"/)
            if (portMatch) {
                setPort(parseInt(portMatch[1], 10))
            }
            
            // Extract path prefix
            const pathMatch = yamlContent.match(/PathPrefix\(\`([^\`]+)\`\)/)
            if (pathMatch) {
                setPathPrefix(pathMatch[1])
            } else {
                setPathPrefix('/')
            }
            
            // Check for SSL configuration
            const sslEnabled = yamlContent.includes('tls:') || yamlContent.includes('websecure')
            setSslEnabled(sslEnabled)
            
            // Extract SSL provider
            const providerMatch = yamlContent.match(/certResolver: "([^"]+)"/)
            if (providerMatch) {
                setSslProvider(providerMatch[1])
            }
            
            setIsActive(true) // Assume active if file exists
            
        } catch (error) {
            console.warn('Error parsing YAML config:', error)
            // If parsing fails, keep the raw content but use defaults for visual editor
            resetToDefaults()
        }
    }

    const resetToDefaults = () => {
        setConfig(null)
        setConfigContent(`# Traefik configuration for ${serviceName}
http:
  services:
    ${serviceName.toLowerCase()}-service:
      loadBalancer:
        servers:
          - url: "http://${serviceName.toLowerCase()}:${port}"
        healthCheck:
          path: "/"
          interval: "60s"
          timeout: "15s"

  routers:
    ${serviceName.toLowerCase()}-router:
      rule: "Host(\`\${subdomain ? subdomain + '.' : ''}${domain}\`)"
      service: "${serviceName.toLowerCase()}-service"
      entryPoints:
        - "web"${sslEnabled ? '\n        - "websecure"' : ''}
      ${sslEnabled ? 'tls:\n        certResolver: "' + (sslProvider || 'letsencrypt') + '"' : ''}

  middlewares:
    ${serviceName.toLowerCase()}-headers:
      headers:
        customRequestHeaders:
          X-Frame-Options: "SAMEORIGIN"
          X-Content-Type-Options: "nosniff"`)
        setDomain('localhost')
        setSubdomain(serviceName.toLowerCase())
        setPathPrefix('/')
        setPort(80)
        setSslEnabled(false)
        setSslProvider('letsencrypt')
        setIsActive(true)
    }

    const updateTraefikConfigMutation = useMutation(
        orpc.service.updateTraefikConfig.mutationOptions({
            onSuccess: () => {
                toast.success('Traefik configuration saved successfully')
                queryClient.invalidateQueries({ queryKey: ['service', 'traefik-config', serviceId] })
                onClose()
            },
            onError: (error: Error) => {
                toast.error(`Failed to save configuration: ${error.message}`)
            },
        })
    )

    const syncConfigMutation = useMutation(
        orpc.service.syncTraefikConfig.mutationOptions({
            onSuccess: () => {
                toast.success('Configuration synced with Traefik')
                queryClient.invalidateQueries({ queryKey: ['service', 'traefik-config', serviceId] })
            },
            onError: (error: Error) => {
                toast.error(`Failed to sync configuration: ${error.message}`)
            },
        })
    )

    const handleSave = async () => {
        try {
            setValidationError(null)
            
            // Basic validation
            if (!domain) {
                setValidationError('Domain is required')
                return
            }
            if (port < 1 || port > 65535) {
                setValidationError('Port must be between 1 and 65535')
                return
            }
            
            await updateTraefikConfigMutation.mutateAsync({
                id: serviceId,
                domain,
                subdomain: subdomain || undefined,
                pathPrefix,
                port,
                sslEnabled,
                sslProvider: sslProvider || undefined,
                isActive,
                configContent,
            })
        } catch (error) {
            console.error('Save error:', error)
        }
    }

    const handleSync = async () => {
        await syncConfigMutation.mutateAsync({ id: serviceId })
    }

    const generateConfigFromSettings = () => {
        const newConfigContent = `# Traefik configuration for ${serviceName}
http:
  services:
    ${serviceName.toLowerCase()}-service:
      loadBalancer:
        servers:
          - url: "http://${serviceName.toLowerCase()}:${port}"
        healthCheck:
          path: "${pathPrefix === '/' ? '/' : pathPrefix + '/'}"
          interval: "60s"
          timeout: "15s"

  routers:
    ${serviceName.toLowerCase()}-router:
      rule: "Host(\`${subdomain ? subdomain + '.' : ''}${domain}\`)"
      service: "${serviceName.toLowerCase()}-service"
      entryPoints:
        - "web"${sslEnabled ? '\n        - "websecure"' : ''}
      ${sslEnabled && sslProvider ? `tls:\n        certResolver: "${sslProvider}"` : ''}
      ${pathPrefix !== '/' ? `rule: "Host(\`${subdomain ? subdomain + '.' : ''}${domain}\`) && PathPrefix(\`${pathPrefix}\`)"` : ''}

  middlewares:
    ${serviceName.toLowerCase()}-headers:
      headers:
        customRequestHeaders:
          X-Frame-Options: "SAMEORIGIN"
          X-Content-Type-Options: "nosniff"
          ${sslEnabled ? 'X-XSS-Protection: "1; mode=block"' : ''}`

        setConfigContent(newConfigContent)
        setActiveTab('code')
        toast.success('Configuration regenerated from settings')
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        Traefik Configuration - {serviceName}
                    </DialogTitle>
                    <DialogDescription>
                        Configure routing, SSL, and middleware settings for this service.
                        Changes will be applied to the Traefik instance when saved and synced.
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                        Loading configuration...
                    </div>
                ) : (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="visual" className="flex items-center gap-2">
                                <Eye className="h-4 w-4" />
                                Visual Editor
                            </TabsTrigger>
                            <TabsTrigger value="code" className="flex items-center gap-2">
                                <Code className="h-4 w-4" />
                                YAML Editor
                            </TabsTrigger>
                            <TabsTrigger value="preview" className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4" />
                                Preview
                            </TabsTrigger>
                        </TabsList>

                        <div className="mt-4 max-h-[60vh] overflow-y-auto">
                            <TabsContent value="visual" className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="domain">Domain</Label>
                                        <Input
                                            id="domain"
                                            value={domain}
                                            onChange={(e) => setDomain(e.target.value)}
                                            placeholder="example.com"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="subdomain">Subdomain (Optional)</Label>
                                        <Input
                                            id="subdomain"
                                            value={subdomain}
                                            onChange={(e) => setSubdomain(e.target.value)}
                                            placeholder="api, www, app..."
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="pathPrefix">Path Prefix</Label>
                                        <Input
                                            id="pathPrefix"
                                            value={pathPrefix}
                                            onChange={(e) => setPathPrefix(e.target.value)}
                                            placeholder="/api, /app, /"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="port">Service Port</Label>
                                        <Input
                                            id="port"
                                            type="number"
                                            value={port}
                                            onChange={(e) => setPort(parseInt(e.target.value) || 80)}
                                            min={1}
                                            max={65535}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="ssl">Enable SSL/TLS</Label>
                                            <p className="text-sm text-gray-600">
                                                Automatically provision SSL certificates
                                            </p>
                                        </div>
                                        <Switch
                                            id="ssl"
                                            checked={sslEnabled}
                                            onCheckedChange={setSslEnabled}
                                        />
                                    </div>

                                    {sslEnabled && (
                                        <div className="space-y-2">
                                            <Label htmlFor="sslProvider">SSL Provider</Label>
                                            <Input
                                                id="sslProvider"
                                                value={sslProvider}
                                                onChange={(e) => setSslProvider(e.target.value)}
                                                placeholder="letsencrypt, cloudflare..."
                                            />
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="active">Configuration Active</Label>
                                            <p className="text-sm text-gray-600">
                                                Enable or disable this configuration
                                            </p>
                                        </div>
                                        <Switch
                                            id="active"
                                            checked={isActive}
                                            onCheckedChange={setIsActive}
                                        />
                                    </div>
                                </div>

                                <div className="pt-4 border-t">
                                    <Button
                                        onClick={generateConfigFromSettings}
                                        variant="outline"
                                        className="w-full"
                                    >
                                        <Code className="h-4 w-4 mr-2" />
                                        Generate YAML from Settings
                                    </Button>
                                </div>
                            </TabsContent>

                            <TabsContent value="code" className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="config">YAML Configuration</Label>
                                    <Textarea
                                        id="config"
                                        value={configContent}
                                        onChange={(e) => setConfigContent(e.target.value)}
                                        className="font-mono text-sm min-h-[400px]"
                                        placeholder="# Traefik YAML configuration..."
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="preview" className="space-y-4">
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 bg-gray-50 rounded-lg">
                                            <h4 className="font-semibold mb-2">Service URL</h4>
                                            <p className="text-sm font-mono">
                                                {sslEnabled ? 'https://' : 'http://'}
                                                {subdomain ? `${subdomain}.` : ''}{domain}
                                                {pathPrefix !== '/' ? pathPrefix : ''}
                                            </p>
                                        </div>
                                        <div className="p-4 bg-gray-50 rounded-lg">
                                            <h4 className="font-semibold mb-2">Backend Target</h4>
                                            <p className="text-sm font-mono">
                                                http://{serviceName.toLowerCase()}:{port}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-gray-50 rounded-lg">
                                        <h4 className="font-semibold mb-2">Configuration Status</h4>
                                        <div className="flex items-center gap-2">
                                            <Badge variant={isActive ? 'default' : 'secondary'}>
                                                {isActive ? 'Active' : 'Inactive'}
                                            </Badge>
                                            <Badge variant={sslEnabled ? 'default' : 'outline'}>
                                                {sslEnabled ? 'SSL Enabled' : 'HTTP Only'}
                                            </Badge>
                                            {config && (
                                                <Badge variant="outline">
                                                    Last synced: {config.lastSyncedAt ? 
                                                        new Date(config.lastSyncedAt).toLocaleString() : 
                                                        'Never'
                                                    }
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>
                        </div>
                    </Tabs>
                )}

                {validationError && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{validationError}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter className="flex items-center gap-2">
                    <Button variant="outline" onClick={onClose}>
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                    </Button>
                    
                    {config && (
                        <Button
                            variant="outline"
                            onClick={handleSync}
                            disabled={syncConfigMutation.isPending}
                        >
                            {syncConfigMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Upload className="h-4 w-4 mr-2" />
                            )}
                            Sync to Traefik
                        </Button>
                    )}
                    
                    <Button
                        onClick={handleSave}
                        disabled={updateTraefikConfigMutation.isPending}
                    >
                        {updateTraefikConfigMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4 mr-2" />
                        )}
                        Save Configuration
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}