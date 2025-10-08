'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useService, useUpdateService } from '@/hooks/useServices'
import { useTraefikConfig, useUpdateTraefikConfig, useSyncTraefikConfig, useValidateTraefikConfig } from '@/hooks/useTraefikConfig'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@repo/ui/components/shadcn/form'
import {
    Network,
    Globe,
    Lock,
    CheckCircle,
    AlertCircle,
    Save,
    RefreshCw,
    FileCode,
    Loader2,
    AlertTriangle,
    ExternalLink,
} from 'lucide-react'

const networkConfigSchema = z.object({
    port: z.number().min(1).max(65535),
    customDomains: z.array(z.string()).optional(),
    traefikConfigContent: z.string().optional(),
})

type NetworkConfigFormData = z.infer<typeof networkConfigSchema>

interface NetworkConfigurationClientProps {
    projectId: string
    serviceId: string
}

export function NetworkConfigurationClient({
    serviceId,
}: NetworkConfigurationClientProps) {
    const { data: service } = useService(serviceId)
    const { data: traefikConfig } = useTraefikConfig(serviceId)
    const updateService = useUpdateService()
    const updateTraefikConfig = useUpdateTraefikConfig()
    const syncTraefikConfig = useSyncTraefikConfig()
    const validateConfig = useValidateTraefikConfig()

    const [isValidating, setIsValidating] = useState(false)
    const [validationResult, setValidationResult] = useState<{
        isValid: boolean
        errors?: Array<{ path: string; message: string; code: string }>
        warnings?: Array<{ path: string; message: string }>
        variables?: Array<{ name: string; resolved: boolean; value?: unknown; error?: string }>
    } | null>(null)

    const form = useForm<NetworkConfigFormData>({
        resolver: zodResolver(networkConfigSchema),
        defaultValues: {
            port: 3000,
            customDomains: [],
            traefikConfigContent: '',
        },
    })

    // Load service data into form
    useEffect(() => {
        if (service && traefikConfig) {
            const configContent = (traefikConfig as { configContent?: string })?.configContent || ''
            
            console.log('Loading Traefik config:', {
                serviceId: service.id,
                serviceName: service.name,
                traefikConfig,
                configContent,
                configContentLength: configContent.length,
                hasConfigContent: !!configContent
            })
            
            form.reset({
                port: service.port || 3000,
                customDomains: service.customDomains || [],
                traefikConfigContent: configContent,
            })
        }
    }, [service, traefikConfig, form])

    const onSubmit = async (data: NetworkConfigFormData) => {
        try {
            // Update service port and custom domains
            await updateService.mutateAsync({
                id: serviceId,
                port: data.port,
                customDomains: data.customDomains,
            })

            // Update Traefik config if changed
            if (data.traefikConfigContent) {
                await updateTraefikConfig.mutateAsync({
                    id: serviceId,
                    configContent: data.traefikConfigContent,
                })
            }
        } catch {
            console.error('Error updating network config')
        }
    }

    const handleValidateConfig = async () => {
        const configContent = form.getValues('traefikConfigContent')
        if (!configContent) {
            setValidationResult({
                isValid: false,
                errors: [{ path: 'config', message: 'Config content is empty', code: 'EMPTY_CONFIG' }],
            })
            return
        }

        setIsValidating(true)
        try {
            const result = await validateConfig.mutateAsync({
                serviceId,
                configContent,
            })
            setValidationResult(result)
        } catch {
            setValidationResult({
                isValid: false,
                errors: [{ path: 'validation', message: 'Validation failed', code: 'VALIDATION_ERROR' }],
            })
        } finally {
            setIsValidating(false)
        }
    }

    const handleSyncConfig = async () => {
        try {
            await syncTraefikConfig.mutateAsync({ id: serviceId })
        } catch (error) {
            console.error('Error syncing config:', error)
        }
    }

    if (!service) {
        return (
            <div className="flex h-96 items-center justify-center">
                <p className="text-muted-foreground">
                    Loading network configuration...
                </p>
            </div>
        )
    }

    const isFormDisabled = updateService.isPending || updateTraefikConfig.isPending
    const hasValidationErrors = validationResult ? !validationResult.isValid : false

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Basic Network Configuration */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Network className="h-5 w-5" />
                            Network Configuration
                        </CardTitle>
                        <CardDescription>
                            Configure service network settings and ports
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <FormField
                            control={form.control}
                            name="port"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Service Port</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                            min={1}
                                            max={65535}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        The port your service listens on
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="space-y-2">
                            <Label>Service URL</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={traefikConfig?.fullDomain || 'Not configured'}
                                    readOnly
                                    className="flex-1"
                                />
                                {traefikConfig?.fullDomain && (
                                    <Button variant="outline" size="sm" asChild>
                                        <a
                                            href={`https://${traefikConfig.fullDomain}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    </Button>
                                )}
                            </div>
                        </div>

                        {traefikConfig?.sslEnabled && (
                            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                <Lock className="h-4 w-4 text-green-600" />
                                <span className="text-sm text-green-700">
                                    SSL/TLS enabled
                                    {traefikConfig.sslProvider && ` (${traefikConfig.sslProvider})`}
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Custom Domains */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Globe className="h-5 w-5" />
                            Custom Domains
                        </CardTitle>
                        <CardDescription>
                            Additional domains for this service
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <FormField
                            control={form.control}
                            name="customDomains"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Domain List (one per line)</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            {...field}
                                            value={field.value?.join('\n') || ''}
                                            onChange={(e) =>
                                                field.onChange(
                                                    e.target.value
                                                        .split('\n')
                                                        .map((d) => d.trim())
                                                        .filter(Boolean)
                                                )
                                            }
                                            placeholder="api.example.com&#10;app.example.com"
                                            rows={4}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Each domain on a new line
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {form.watch('customDomains') && form.watch('customDomains')!.length > 0 && (
                            <div className="space-y-2">
                                <Label>Configured Domains</Label>
                                <div className="flex flex-wrap gap-2">
                                    {form.watch('customDomains')!.map((domain, idx) => (
                                        <Badge key={idx} variant="outline">
                                            {domain}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Traefik Configuration Editor */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <FileCode className="h-5 w-5" />
                                    Traefik Configuration
                                </CardTitle>
                                <CardDescription>
                                    Advanced Traefik routing configuration with variable support
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleValidateConfig}
                                    disabled={isValidating}
                                >
                                    {isValidating ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                        <CheckCircle className="h-4 w-4 mr-2" />
                                    )}
                                    Validate
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleSyncConfig}
                                    disabled={syncTraefikConfig.isPending}
                                >
                                    {syncTraefikConfig.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                    )}
                                    Sync
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <FormField
                            control={form.control}
                            name="traefikConfigContent"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Configuration (YAML)</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            {...field}
                                            className="font-mono text-sm"
                                            placeholder={`http:
  routers:
    ~##serviceName##~-router:
      rule: "Host(\`~##domain##~\`)"
      service: ~##serviceName##~-service
      
  services:
    ~##serviceName##~-service:
      loadBalancer:
        servers:
          - url: "http://~##containerName##~:~##port##~"`}
                                            rows={15}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Use variables: ~##domain##~, ~##containerName##~, ~##port##~, ~##serviceName##~
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Validation Result */}
                        {validationResult && (
                            <div className="space-y-3">
                                {/* Validation Status */}
                                <div
                                    className={`p-4 rounded-lg border ${
                                        validationResult.isValid
                                            ? 'bg-green-50 border-green-200'
                                            : 'bg-red-50 border-red-200'
                                    }`}
                                >
                                    <div className="flex items-start gap-2">
                                        {validationResult.isValid ? (
                                            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                                        ) : (
                                            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                                        )}
                                        <div className="flex-1">
                                            <p
                                                className={`text-sm font-medium ${
                                                    validationResult.isValid
                                                        ? 'text-green-800'
                                                        : 'text-red-800'
                                                }`}
                                            >
                                                {validationResult.isValid
                                                    ? 'Configuration is valid'
                                                    : 'Configuration has errors'}
                                            </p>
                                            
                                            {/* Errors */}
                                            {validationResult.errors && validationResult.errors.length > 0 && (
                                                <ul className="mt-2 space-y-1">
                                                    {validationResult.errors.map((error, idx) => (
                                                        <li
                                                            key={idx}
                                                            className="text-sm text-red-700 flex items-start gap-2"
                                                        >
                                                            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                                            <div className="flex-1">
                                                                {error.path && (
                                                                    <span className="font-mono text-xs bg-red-100 px-1 py-0.5 rounded mr-2">
                                                                        {error.path}
                                                                    </span>
                                                                )}
                                                                <span>{error.message}</span>
                                                                {error.code && (
                                                                    <span className="ml-2 text-xs text-red-600 font-mono">
                                                                        ({error.code})
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Warnings */}
                                {validationResult.warnings && validationResult.warnings.length > 0 && (
                                    <div className="p-4 rounded-lg border bg-yellow-50 border-yellow-200">
                                        <div className="flex items-start gap-2">
                                            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-yellow-800 mb-2">
                                                    Warnings
                                                </p>
                                                <ul className="space-y-1">
                                                    {validationResult.warnings.map((warning, idx) => (
                                                        <li
                                                            key={idx}
                                                            className="text-sm text-yellow-700 flex items-start gap-2"
                                                        >
                                                            <span className="text-yellow-600">•</span>
                                                            <div className="flex-1">
                                                                {warning.path && (
                                                                    <span className="font-mono text-xs bg-yellow-100 px-1 py-0.5 rounded mr-2">
                                                                        {warning.path}
                                                                    </span>
                                                                )}
                                                                <span>{warning.message}</span>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Variables */}
                                {validationResult.variables && validationResult.variables.length > 0 && (
                                    <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
                                        <div className="flex items-start gap-2">
                                            <FileCode className="h-5 w-5 text-blue-600 mt-0.5" />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-blue-800 mb-2">
                                                    Variables Detected ({validationResult.variables.length})
                                                </p>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    {validationResult.variables.map((variable, idx) => (
                                                        <div
                                                            key={idx}
                                                            className={`flex items-center gap-2 p-2 rounded ${
                                                                variable.resolved
                                                                    ? 'bg-green-100 border border-green-300'
                                                                    : 'bg-blue-100 border border-blue-300'
                                                            }`}
                                                        >
                                                            <code className="text-xs font-mono text-blue-900">
                                                                ~##{variable.name}##~
                                                            </code>
                                                            {variable.resolved === true ? (
                                                                <Badge variant="outline" className="text-xs bg-green-200 text-green-800 border-green-400">
                                                                    ✓ Resolved
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-xs bg-blue-200 text-blue-800 border-blue-400">
                                                                    Unresolved
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
                            <div className="flex items-start gap-2">
                                <FileCode className="h-5 w-5 text-blue-600 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-blue-800 mb-2">
                                        Configuration Tips
                                    </p>
                                    <ul className="text-sm text-blue-700 space-y-1">
                                        <li>• Use ~##variable##~ syntax for dynamic values</li>
                                        <li>• Validate configuration before saving</li>
                                        <li>• Sync after changes to apply to Traefik</li>
                                        <li>• Check validation errors carefully</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Save Buttons */}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline">
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={isFormDisabled || hasValidationErrors}
                    >
                        <Save className="h-4 w-4 mr-2" />
                        {isFormDisabled ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>

                {/* Block submission if validation errors */}
                {hasValidationErrors && (
                    <div className="p-4 border border-red-200 bg-red-50 rounded-lg">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-red-800">
                                    Cannot save configuration
                                </p>
                                <p className="text-sm text-red-700">
                                    Please fix the validation errors in your Traefik configuration before saving.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </form>
        </Form>
    )
}
