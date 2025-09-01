'use client'

import { useState } from 'react'
import { useService } from '@/hooks/useServices'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Slider } from '@repo/ui/components/shadcn/slider'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { 
  HardDrive,
  Cpu,
  MemoryStick,
  Activity,
  TrendingUp,
  Gauge,
  AlertTriangle,
  CheckCircle,
  Zap
} from 'lucide-react'

interface ServiceResourceConfigProps {
  params: {
    id: string
    serviceId: string
  }
}

export default function ServiceResourceConfigPage({ params }: ServiceResourceConfigProps) {
  const { data: service } = useService(params.serviceId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [autoScalingEnabled, setAutoScalingEnabled] = useState(false)
  const [monitoringEnabled, setMonitoringEnabled] = useState(true)
  const [cpuLimit, setCpuLimit] = useState([1])
  const [memoryLimit, setMemoryLimit] = useState([512])
  
  // Mock current resource usage
  const resourceUsage = {
    cpu: 45,
    memory: 68,
    storage: 32,
    network: 12
  }

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading resource configuration...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Resource Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Current Resource Usage
          </CardTitle>
          <CardDescription>
            Real-time resource utilization for this service
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  CPU
                </Label>
                <span className="text-sm font-medium">{resourceUsage.cpu}%</span>
              </div>
              <Progress value={resourceUsage.cpu} className="h-2" />
              <p className="text-xs text-muted-foreground">0.45 / 1.0 vCPU</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <MemoryStick className="h-4 w-4" />
                  Memory
                </Label>
                <span className="text-sm font-medium">{resourceUsage.memory}%</span>
              </div>
              <Progress value={resourceUsage.memory} className="h-2" />
              <p className="text-xs text-muted-foreground">348 MB / 512 MB</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Storage
                </Label>
                <span className="text-sm font-medium">{resourceUsage.storage}%</span>
              </div>
              <Progress value={resourceUsage.storage} className="h-2" />
              <p className="text-xs text-muted-foreground">3.2 GB / 10 GB</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Network
                </Label>
                <span className="text-sm font-medium">{resourceUsage.network}%</span>
              </div>
              <Progress value={resourceUsage.network} className="h-2" />
              <p className="text-xs text-muted-foreground">12 MB/s</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resource Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Resource Limits
          </CardTitle>
          <CardDescription>
            Set maximum resource allocation for this service
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                CPU Limit: {cpuLimit[0]} vCPU
              </Label>
              <Slider
                value={cpuLimit}
                onValueChange={setCpuLimit}
                max={4}
                min={0.25}
                step={0.25}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0.25 vCPU</span>
                <span>4 vCPU</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <MemoryStick className="h-4 w-4" />
                Memory Limit: {memoryLimit[0]} MB
              </Label>
              <Slider
                value={memoryLimit}
                onValueChange={setMemoryLimit}
                max={8192}
                min={128}
                step={128}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>128 MB</span>
                <span>8 GB</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="storage-limit">Storage Limit</Label>
              <Input 
                id="storage-limit" 
                value="10 GB" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="e.g., 10 GB, 50 GB, 100 GB"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bandwidth-limit">Bandwidth Limit</Label>
              <Input 
                id="bandwidth-limit" 
                value="100 GB/month" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="e.g., 100 GB/month, 1 TB/month"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto Scaling */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Auto Scaling
          </CardTitle>
          <CardDescription>
            Automatically scale resources based on demand
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-scaling">Enable Auto Scaling</Label>
              <p className="text-sm text-muted-foreground">
                Automatically adjust resources based on load
              </p>
            </div>
            <Switch 
              id="auto-scaling"
              checked={autoScalingEnabled}
              onCheckedChange={setAutoScalingEnabled}
            />
          </div>

          {autoScalingEnabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium">Scaling Configuration</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-instances">Minimum Instances</Label>
                  <Input 
                    id="min-instances" 
                    type="number" 
                    value="1" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="1"
                    max="10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-instances">Maximum Instances</Label>
                  <Input 
                    id="max-instances" 
                    type="number" 
                    value="5" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="1"
                    max="20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scale-up-threshold">Scale Up at CPU %</Label>
                  <Input 
                    id="scale-up-threshold" 
                    type="number" 
                    value="80" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="50"
                    max="95"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scale-down-threshold">Scale Down at CPU %</Label>
                  <Input 
                    id="scale-down-threshold" 
                    type="number" 
                    value="30" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="10"
                    max="50"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Monitoring */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Performance Monitoring
          </CardTitle>
          <CardDescription>
            Monitor and alert on resource usage patterns
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="monitoring">Resource Monitoring</Label>
              <p className="text-sm text-muted-foreground">
                Collect and store resource usage metrics
              </p>
            </div>
            <Switch 
              id="monitoring"
              checked={monitoringEnabled}
              onCheckedChange={setMonitoringEnabled}
            />
          </div>

          {monitoringEnabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium">Alert Thresholds</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cpu-alert">CPU Alert at %</Label>
                  <Input 
                    id="cpu-alert" 
                    type="number" 
                    value="85" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="50"
                    max="95"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="memory-alert">Memory Alert at %</Label>
                  <Input 
                    id="memory-alert" 
                    type="number" 
                    value="90" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="50"
                    max="95"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="storage-alert">Storage Alert at %</Label>
                  <Input 
                    id="storage-alert" 
                    type="number" 
                    value="85" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="50"
                    max="95"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="response-time-alert">Response Time Alert (ms)</Label>
                  <Input 
                    id="response-time-alert" 
                    type="number" 
                    value="1000" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="100"
                    max="5000"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resource Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Resource Recommendations
          </CardTitle>
          <CardDescription>
            Optimization suggestions based on usage patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 border border-green-200 bg-green-50 rounded-lg">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-800 mb-2">
                    Resource Usage is Optimal
                  </p>
                  <p className="text-sm text-green-700 mb-3">
                    Your current resource allocation appears well-matched to your usage patterns.
                  </p>
                  <ul className="text-sm text-green-700 space-y-1">
                    <li>• CPU usage is consistently under 60%</li>
                    <li>• Memory usage is stable around 65-70%</li>
                    <li>• Storage growth is predictable</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-2">
                <Zap className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800 mb-2">
                    Performance Tips
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Consider enabling auto-scaling for traffic spikes</li>
                    <li>• Monitor response times during peak hours</li>
                    <li>• Set up alerts before resources reach capacity</li>
                    <li>• Review resource usage monthly for optimization</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800 mb-2">
                    Cost Optimization
                  </p>
                  <p className="text-sm text-yellow-700">
                    Based on your usage patterns, you might be able to reduce memory allocation by 25% 
                    without impacting performance, potentially saving $12/month.
                  </p>
                  <Button variant="outline" size="sm" className="mt-2">
                    Apply Recommendation
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}