'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Slider } from '@repo/ui/components/shadcn/slider'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/shadcn/tooltip'
import { 
  Scale, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  AlertTriangle, 
  CheckCircle2,
  Minus,
  Plus,
  Loader2,
  Info
} from 'lucide-react'
import { orpc } from '@/lib/orpc'

interface ServiceInfo {
  name: string
  replicas: {
    desired: number
    current: number
    updated: number
  }
  status: string
  ports?: number[]
  endpoints?: string[]
}

interface ServiceScalingCardProps {
  stackId: string
  service: ServiceInfo
  onScaled?: (serviceName: string, newReplicas: number) => void
}

export default function ServiceScalingCard({ 
  stackId, 
  service, 
  onScaled 
}: ServiceScalingCardProps) {
  const [open, setOpen] = useState(false)
  const [desiredReplicas, setDesiredReplicas] = useState(service.replicas.desired)
  const [sliderValue, setSliderValue] = useState([service.replicas.desired])

  const simpleToast = (title: string, description: string, variant: 'default' | 'destructive' = 'default') => {
    console.log(`${variant === 'destructive' ? 'ERROR' : 'INFO'}: ${title} - ${description}`)
    alert(`${title}\n${description}`)
  }

  const scaleServiceMutation = useMutation(orpc.orchestration.scaleServices.mutationOptions({
    onSuccess: () => {
      simpleToast('Service Scaled', `${service.name} scaled to ${desiredReplicas} replicas`)
      setOpen(false)
      onScaled?.(service.name, desiredReplicas)
    },
    onError: (error) => {
      simpleToast('Failed to Scale Service', error instanceof Error ? error.message : 'Unknown error', 'destructive')
    }
  }))

  const getStatusIcon = () => {
    const { current, desired, updated } = service.replicas
    
    if (current === desired && updated === desired) {
      return <CheckCircle2 className="h-4 w-4 text-green-600" />
    } else if (current < desired) {
      return <TrendingUp className="h-4 w-4 text-blue-600 animate-pulse" />
    } else if (current > desired) {
      return <TrendingDown className="h-4 w-4 text-orange-600 animate-pulse" />
    } else {
      return <Activity className="h-4 w-4 text-yellow-600" />
    }
  }

  const getStatusBadge = () => {
    const { current, desired, updated } = service.replicas
    
    if (current === desired && updated === desired) {
      return <Badge variant="default" className="bg-green-100 text-green-800">Stable</Badge>
    } else if (current !== desired) {
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Scaling</Badge>
    } else {
      return <Badge variant="outline">Updating</Badge>
    }
  }

  const calculateResourceImpact = () => {
    const change = desiredReplicas - service.replicas.current
    const changePercent = service.replicas.current > 0 
      ? Math.round((change / service.replicas.current) * 100)
      : 100

    return {
      change,
      changePercent,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'none'
    }
  }

  const handleQuickScale = (newReplicas: number) => {
    if (newReplicas < 0) return
    
    scaleServiceMutation.mutate({
      stackId,
      services: {
        [service.name]: newReplicas
      }
    })
  }

  const handleSliderChange = (values: number[]) => {
    setSliderValue(values)
    setDesiredReplicas(values[0])
  }

  const handleScale = () => {
    scaleServiceMutation.mutate({
      stackId,
      services: {
        [service.name]: desiredReplicas
      }
    })
  }

  const resetForm = () => {
    setDesiredReplicas(service.replicas.desired)
    setSliderValue([service.replicas.desired])
  }

  const resourceImpact = calculateResourceImpact()

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <CardTitle className="text-base font-medium">{service.name}</CardTitle>
            {getStatusBadge()}
          </div>
          
          <div className="flex items-center gap-1">
            {/* Quick Scale Down */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickScale(service.replicas.current - 1)}
                    disabled={service.replicas.current <= 0 || scaleServiceMutation.isPending}
                    className="h-7 w-7 p-0"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Scale down by 1</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Quick Scale Up */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickScale(service.replicas.current + 1)}
                    disabled={scaleServiceMutation.isPending}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Scale up by 1</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Advanced Scaling Dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Scale className="h-3 w-3 mr-1" />
                  Scale
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Scale Service: {service.name}</DialogTitle>
                  <DialogDescription>
                    Adjust the number of replicas for this service
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                  {/* Current Status */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium text-sm mb-3">Current Status</h4>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div className="text-center">
                        <p className="text-gray-600">Desired</p>
                        <p className="font-bold text-lg">{service.replicas.desired}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-600">Current</p>
                        <p className="font-bold text-lg">{service.replicas.current}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-600">Updated</p>
                        <p className="font-bold text-lg">{service.replicas.updated}</p>
                      </div>
                    </div>
                  </div>

                  {/* Replica Configuration */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="replicas">New Replica Count</Label>
                      <div className="flex items-center gap-3">
                        <Input
                          id="replicas"
                          type="number"
                          min="0"
                          max="20"
                          value={desiredReplicas}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0
                            setDesiredReplicas(value)
                            setSliderValue([value])
                          }}
                          className="w-20"
                        />
                        <div className="flex-1">
                          <Slider
                            value={sliderValue}
                            onValueChange={handleSliderChange}
                            max={20}
                            min={0}
                            step={1}
                            className="flex-1"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">Range: 0-20 replicas</p>
                    </div>

                    {/* Resource Impact Preview */}
                    {resourceImpact.direction !== 'none' && (
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Info className="h-4 w-4 text-blue-600" />
                          <h5 className="font-medium text-sm">Resource Impact</h5>
                        </div>
                        <div className="text-sm space-y-1">
                          <p>
                            <span className="font-medium">Replica Change:</span> 
                            {resourceImpact.change > 0 ? '+' : ''}{resourceImpact.change}
                            {resourceImpact.changePercent !== Infinity && (
                              <span className="text-gray-600"> ({resourceImpact.changePercent > 0 ? '+' : ''}{resourceImpact.changePercent}%)</span>
                            )}
                          </p>
                          {resourceImpact.direction === 'up' && (
                            <p className="text-green-600">
                              ↗ Increased capacity and resource usage
                            </p>
                          )}
                          {resourceImpact.direction === 'down' && (
                            <p className="text-orange-600">
                              ↘ Reduced capacity and resource usage
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Service Info */}
                    <div className="space-y-2">
                      <h5 className="font-medium text-sm">Service Information</h5>
                      <div className="text-sm space-y-1">
                        <p><span className="font-medium">Status:</span> {service.status}</p>
                        {service.ports && service.ports.length > 0 && (
                          <p><span className="font-medium">Ports:</span> {service.ports.join(', ')}</p>
                        )}
                        {service.endpoints && service.endpoints.length > 0 && (
                          <p><span className="font-medium">Endpoints:</span> {service.endpoints.length} active</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => {
                    setOpen(false)
                    resetForm()
                  }}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleScale}
                    disabled={scaleServiceMutation.isPending || desiredReplicas === service.replicas.desired}
                  >
                    {scaleServiceMutation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Scale to {desiredReplicas}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {/* Replica Status Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-600">
              <span>Replicas</span>
              <span>{service.replicas.current}/{service.replicas.desired}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${service.replicas.desired > 0 ? (service.replicas.current / service.replicas.desired) * 100 : 0}%`
                }}
              />
            </div>
          </div>

          {/* Service Details */}
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Status: {service.status}</span>
            {service.ports && service.ports.length > 0 && (
              <span>Ports: {service.ports.slice(0, 2).join(', ')}{service.ports.length > 2 ? '...' : ''}</span>
            )}
          </div>

          {/* Scaling Status */}
          {service.replicas.current !== service.replicas.desired && (
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <span className="text-yellow-600">
                Scaling in progress ({service.replicas.current} → {service.replicas.desired})
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}