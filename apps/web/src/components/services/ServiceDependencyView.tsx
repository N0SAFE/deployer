'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Label } from '@repo/ui/components/shadcn/label'
import { 
  Network,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2
} from 'lucide-react'
import { 
  useServiceDependencies, 
  useServices,
  useAddServiceDependency, 
  useRemoveServiceDependency 
} from '@/hooks/useServices'

interface ServiceDependencyViewProps {
  serviceId: string
  serviceName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ServiceDependencyView({ 
  serviceId, 
  serviceName, 
  open, 
  onOpenChange 
}: ServiceDependencyViewProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [isRequired, setIsRequired] = useState(true)

  const { data: dependenciesData, isLoading: loadingDependencies } = useServiceDependencies(serviceId)
  const { data: servicesData } = useServices('', { limit: 100 }) // We need the project ID
  const addDependency = useAddServiceDependency()
  const removeDependency = useRemoveServiceDependency()

  const dependencies = dependenciesData?.dependencies || []
  const allServices = servicesData?.services || []
  const availableServices = allServices.filter(
    service => service.id !== serviceId && 
    !dependencies.find(dep => dep.dependsOnServiceId === service.id)
  )

  const handleAddDependency = async () => {
    if (!selectedServiceId) return

    try {
      await addDependency.mutateAsync({
        id: serviceId,
        dependsOnServiceId: selectedServiceId,
        isRequired,
      })
      setSelectedServiceId('')
      setIsRequired(true)
    } catch (error) {
      console.error('Failed to add dependency:', error)
    }
  }

  const handleRemoveDependency = async (dependencyId: string) => {
    try {
      await removeDependency.mutateAsync({
        id: serviceId,
        dependencyId,
      })
    } catch (error) {
      console.error('Failed to remove dependency:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Network className="h-5 w-5" />
            <span>Service Dependencies</span>
          </DialogTitle>
          <DialogDescription>
            Manage dependencies for &ldquo;{serviceName}&rdquo;. Dependencies define the order services are deployed and their relationships.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add New Dependency */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Add Dependency</h4>
            <div className="flex items-end space-x-4">
              <div className="flex-1">
                <Label htmlFor="service-select" className="text-sm">
                  Select Service
                </Label>
                <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                  <SelectTrigger id="service-select">
                    <SelectValue placeholder="Choose a service to depend on" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableServices.map(service => (
                      <SelectItem key={service.id} value={service.id}>
                        <div className="flex items-center space-x-2">
                          <span>{service.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {service.type}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is-required"
                  checked={isRequired}
                  onCheckedChange={setIsRequired}
                />
                <Label htmlFor="is-required" className="text-sm">
                  Required
                </Label>
              </div>

              <Button 
                onClick={handleAddDependency}
                disabled={!selectedServiceId || addDependency.isPending}
              >
                {addDependency.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add
              </Button>
            </div>

            {availableServices.length === 0 && (
              <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
                No available services to add as dependencies. All other services are already dependencies or this is the only service.
              </div>
            )}
          </div>

          <Separator />

          {/* Current Dependencies */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">
              Current Dependencies ({dependencies.length})
            </h4>

            {loadingDependencies ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : dependencies.length === 0 ? (
              <div className="text-center p-8">
                <Network className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="text-sm font-medium mb-2">No dependencies yet</h4>
                <p className="text-sm text-muted-foreground">
                  This service doesn&apos;t depend on any other services. Add dependencies above to define deployment order.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {dependencies.map(dependency => (
                  <Card key={dependency.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`h-2 w-2 rounded-full ${
                            dependency.isRequired ? 'bg-red-500' : 'bg-blue-500'
                          }`} />
                          <div>
                            <CardTitle className="text-base">
                              {dependency.dependsOnService.name}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              {dependency.dependsOnService.type}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Badge variant={dependency.isRequired ? 'destructive' : 'default'} className="text-xs">
                            {dependency.isRequired ? 'Required' : 'Optional'}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveDependency(dependency.id)}
                            disabled={removeDependency.isPending}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>Added {new Date(dependency.createdAt).toLocaleDateString()}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Dependency Info */}
          {dependencies.length > 0 && (
            <>
              <Separator />
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      Deployment Order
                    </h5>
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      Dependencies will be deployed before this service. Required dependencies must be successfully running before this service can start.
                    </p>
                    <div className="flex items-center space-x-1 text-xs">
                      <div className="h-2 w-2 rounded-full bg-red-500" />
                      <span className="text-blue-700 dark:text-blue-300">Required</span>
                      <div className="h-2 w-2 rounded-full bg-blue-500 ml-4" />
                      <span className="text-blue-700 dark:text-blue-300">Optional</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}