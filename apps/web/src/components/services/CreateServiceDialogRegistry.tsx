/**
 * Create Service Dialog - Registry-Based Version
 * 
 * Implements the provider-builder registry pattern for dynamic service creation.
 * Fetches providers and builders from registry API and renders dynamic configuration forms.
 */

'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@repo/ui/components/shadcn/form';
import { Input } from '@repo/ui/components/shadcn/input';
import { Button } from '@repo/ui/components/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card';
import { Loader2, Server, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert';
import { Badge } from '@repo/ui/components/shadcn/badge';
import { useCreateService } from '@/hooks/useServices';
import {
  useProviders,
  useBuilders,
  useCompatibleBuilders,
  useProviderSchema,
  useBuilderSchema,
} from '@/hooks/useProviderBuilder';
import DynamicConfigForm from './DynamicConfigForm';

const serviceSchema = z.object({
  name: z
    .string()
    .min(1, 'Service name is required')
    .max(100, 'Service name must be less than 100 characters')
    .regex(/^[a-z0-9-]+$/, 'Service name must be lowercase alphanumeric with hyphens only'),
  type: z.string().min(1, 'Service type is required'),
  provider: z.string().min(1, 'Provider is required'),
  builder: z.string().min(1, 'Builder is required'),
  port: z.number().int().positive().optional(),
  healthCheckPath: z.string().min(1, 'Health check path is required'),
  providerConfig: z.record(z.string(), z.unknown()).optional(),
  builderConfig: z.record(z.string(), z.unknown()).optional(),
});

type ServiceFormData = z.infer<typeof serviceSchema>;

const SERVICE_TYPES = [
  { value: 'web', label: 'Web Application' },
  { value: 'api', label: 'API Service' },
  { value: 'worker', label: 'Background Worker' },
  { value: 'database', label: 'Database' },
  { value: 'cache', label: 'Cache Service' },
  { value: 'queue', label: 'Message Queue' },
  { value: 'cron', label: 'Scheduled Tasks' },
  { value: 'static', label: 'Static Files' },
];

interface CreateServiceDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateServiceDialog({
  projectId,
  open,
  onOpenChange,
}: CreateServiceDialogProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>();
  const [selectedBuilder, setSelectedBuilder] = useState<string | undefined>();

  const createService = useCreateService();
  const { data: providersData, isLoading: providersLoading, error: providersError } = useProviders();
  const { data: buildersData, isLoading: buildersLoading, error: buildersError } = useBuilders();
  const { data: compatibleBuilders, isLoading: compatibleBuildersLoading } = useCompatibleBuilders(selectedProvider);
  const { data: providerSchema, isLoading: providerSchemaLoading, error: providerSchemaError } = useProviderSchema(selectedProvider);
  const { data: builderSchema, isLoading: builderSchemaLoading, error: builderSchemaError } = useBuilderSchema(selectedBuilder);

  const form = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: '',
      type: '',
      provider: '',
      builder: '',
      port: undefined,
      healthCheckPath: '/health',
      providerConfig: {},
      builderConfig: {},
    },
  });

  // Watch provider selection to filter builders
  const watchedProvider = form.watch('provider');
  useEffect(() => {
    setSelectedProvider(watchedProvider || undefined);
    // Reset builder when provider changes
    if (watchedProvider && form.getValues('builder')) {
      form.setValue('builder', '');
      setSelectedBuilder(undefined);
    }
  }, [watchedProvider, form]);

  // Watch builder selection
  const watchedBuilder = form.watch('builder');
  useEffect(() => {
    setSelectedBuilder(watchedBuilder || undefined);
  }, [watchedBuilder]);

  const onSubmit = async (data: ServiceFormData) => {
    try {
      await createService.mutateAsync({
        projectId,
        name: data.name,
        type: data.type,
        providerId: data.provider, // Use providerId instead of provider enum
        builderId: data.builder, // Use builderId instead of builder enum
        port: data.port || undefined,
        healthCheckPath: data.healthCheckPath,
        providerConfig: data.providerConfig && Object.keys(data.providerConfig).length > 0 ? data.providerConfig : undefined,
        builderConfig: data.builderConfig && Object.keys(data.builderConfig).length > 0 ? data.builderConfig : undefined,
      });

      // Reset form and close dialog
      form.reset();
      setSelectedProvider(undefined);
      setSelectedBuilder(undefined);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create service:', error);
    }
  };

  // Get available builders based on selected provider
  const availableBuilders = selectedProvider
    ? compatibleBuilders?.builders || []
    : buildersData?.builders || [];

  const selectedProviderData = providersData?.providers.find((p) => p.id === selectedProvider);
  const selectedBuilderData = availableBuilders.find((b) => b.id === selectedBuilder);

  // Show error state if critical data fails to load
  if (providersError || buildersError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Error Loading Registry</DialogTitle>
            <DialogDescription>
              Failed to load provider/builder registry data. Please try again later.
            </DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertDescription>
              {providersError?.message || buildersError?.message || 'Unknown error occurred'}
            </AlertDescription>
          </Alert>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Server className="h-5 w-5" />
            <span>Create New Service</span>
          </DialogTitle>
          <DialogDescription>
            Configure a new deployable service using providers and builders from the registry.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Basic Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Name</FormLabel>
                        <FormControl>
                          <Input placeholder="my-service" {...field} />
                        </FormControl>
                        <FormDescription>Lowercase, alphanumeric with hyphens only</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select service type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SERVICE_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="port"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Port (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="3000"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                          />
                        </FormControl>
                        <FormDescription>Main port for the service</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="healthCheckPath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Health Check Path</FormLabel>
                        <FormControl>
                          <Input placeholder="/health" {...field} />
                        </FormControl>
                        <FormDescription>Endpoint for health checks</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Provider Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source Provider</CardTitle>
                <CardDescription>Select where your code or deployment artifacts come from</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Provider</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''} disabled={providersLoading}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={providersLoading ? 'Loading providers...' : 'Select provider'} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {providersData?.providers.map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              <div className="flex items-center space-x-2">
                                <span>{provider.name}</span>
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {provider.category}
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                          {(!providersData?.providers || providersData.providers.length === 0) && (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                              No providers available
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {selectedProviderData && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      <strong>{selectedProviderData.name}</strong>: {selectedProviderData.description}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedProviderData.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Builder Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Build System</CardTitle>
                <CardDescription>Select how your service will be built and deployed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="builder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Builder</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || ''}
                        disabled={buildersLoading || compatibleBuildersLoading || !selectedProvider}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                !selectedProvider
                                  ? 'Select a provider first'
                                  : compatibleBuildersLoading
                                    ? 'Loading compatible builders...'
                                    : 'Select builder'
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {availableBuilders.map((builder) => (
                            <SelectItem key={builder.id} value={builder.id}>
                              <div className="flex items-center space-x-2">
                                <span>{builder.name}</span>
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {builder.category}
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                          {availableBuilders.length === 0 && (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                              {selectedProvider ? 'No compatible builders available' : 'Select a provider first'}
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {selectedBuilderData && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      <strong>{selectedBuilderData.name}</strong>: {selectedBuilderData.description}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedBuilderData.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Provider Configuration - Dynamic Form */}
            {selectedProvider && providerSchema && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{selectedProviderData?.name} Configuration</span>
                    <Badge variant="outline">{providerSchema.version}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {providerSchema.fields.length} configuration field{providerSchema.fields.length !== 1 ? 's' : ''} available
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {providerSchemaLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : providerSchemaError ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        Failed to load provider configuration schema: {providerSchemaError.message}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <DynamicConfigForm schema={providerSchema} form={form} fieldPrefix="providerConfig" />
                  )}
                </CardContent>
              </Card>
            )}

            {/* Builder Configuration - Dynamic Form */}
            {selectedBuilder && builderSchema && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{selectedBuilderData?.name} Configuration</span>
                    <Badge variant="outline">{builderSchema.version}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {builderSchema.fields.length} configuration field{builderSchema.fields.length !== 1 ? 's' : ''} available
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {builderSchemaLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : builderSchemaError ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        Failed to load builder configuration schema: {builderSchemaError.message}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <DynamicConfigForm schema={builderSchema} form={form} fieldPrefix="builderConfig" />
                  )}
                </CardContent>
              </Card>
            )}

            {/* Form Actions */}
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createService.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={createService.isPending}>
                {createService.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Server className="h-4 w-4 mr-2" />
                    Create Service
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
