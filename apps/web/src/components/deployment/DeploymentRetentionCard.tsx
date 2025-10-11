'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Archive,
  Save,
  Info,
  AlertCircle,
  HardDrive,
  History
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'

interface DeploymentRetentionCardProps {
  serviceId: string
  initialRetentionPolicy?: {
    maxSuccessfulDeployments: number
    keepArtifacts: boolean
    autoCleanup: boolean
  }
}

export function DeploymentRetentionCard({ 
  serviceId,
  initialRetentionPolicy = {
    maxSuccessfulDeployments: 5,
    keepArtifacts: true,
    autoCleanup: true
  }
}: DeploymentRetentionCardProps) {
  const [maxDeployments, setMaxDeployments] = useState(initialRetentionPolicy.maxSuccessfulDeployments)
  const [keepArtifacts, setKeepArtifacts] = useState(initialRetentionPolicy.keepArtifacts)
  const [autoCleanup, setAutoCleanup] = useState(initialRetentionPolicy.autoCleanup)
  const [hasChanges, setHasChanges] = useState(false)

    // Update retention policy mutation
  const updateRetentionPolicyMutation = useMutation(orpc.deployment.updateRetentionPolicy.mutationOptions({
    onSuccess: () => {
      setHasChanges(false)
      // Show success message
      toast.success('Retention policy updated successfully')
    },
    onError: (error: Error) => {
      console.error('Failed to update retention policy:', error)
      toast.error('Failed to update retention policy', {
        description: error.message
      })
    },
  }))

  const handleSave = () => {
    updateRetentionPolicyMutation.mutate({
      serviceId,
      maxSuccessfulDeployments: maxDeployments,
      keepArtifacts,
      autoCleanup
    })
  }

  const handleMaxDeploymentsChange = (value: string) => {
    const num = parseInt(value)
    if (!isNaN(num) && num > 0 && num <= 100) {
      setMaxDeployments(num)
      setHasChanges(true)
    }
  }

  const handleKeepArtifactsChange = (checked: boolean) => {
    setKeepArtifacts(checked)
    setHasChanges(true)
  }

  const handleAutoCleanupChange = (checked: boolean) => {
    setAutoCleanup(checked)
    setHasChanges(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-5 w-5" />
          Deployment Retention Policy
        </CardTitle>
        <CardDescription>
          Configure how many successful deployments to keep for rollback purposes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Max Successful Deployments */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="max-deployments" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Maximum Successful Deployments
            </Label>
            <Badge variant="secondary">
              Current: {maxDeployments}
            </Badge>
          </div>
          <Input 
            id="max-deployments"
            type="number"
            min={1}
            max={100}
            value={maxDeployments}
            onChange={(e) => handleMaxDeploymentsChange(e.target.value)}
            className="w-full"
          />
          <p className="text-sm text-muted-foreground flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              Number of successful deployments to keep. Older deployments will be automatically removed.
              Recommended: 5-10 for production, 3-5 for staging.
            </span>
          </p>
        </div>

        {/* Keep Artifacts */}
        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
          <div className="space-y-1 flex-1">
            <Label htmlFor="keep-artifacts" className="flex items-center gap-2 cursor-pointer">
              <HardDrive className="h-4 w-4" />
              Keep Docker Images & Static Files
            </Label>
            <p className="text-sm text-muted-foreground">
              Preserve Docker images and static files for old deployments. Disable to free up disk space.
            </p>
          </div>
          <Switch 
            id="keep-artifacts"
            checked={keepArtifacts}
            onCheckedChange={handleKeepArtifactsChange}
          />
        </div>

        {/* Auto Cleanup */}
        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
          <div className="space-y-1 flex-1">
            <Label htmlFor="auto-cleanup" className="flex items-center gap-2 cursor-pointer">
              <Archive className="h-4 w-4" />
              Automatic Cleanup
            </Label>
            <p className="text-sm text-muted-foreground">
              Automatically cleanup old deployments after each successful deployment. 
              Disable to manually control cleanup timing.
            </p>
          </div>
          <Switch 
            id="auto-cleanup"
            checked={autoCleanup}
            onCheckedChange={handleAutoCleanupChange}
          />
        </div>

        {/* Warning about keepArtifacts = false */}
        {!keepArtifacts && (
          <div className="flex items-start gap-3 p-4 border border-orange-200 bg-orange-50 rounded-lg">
            <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-orange-800">
                Warning: Artifacts Will Be Deleted
              </p>
              <p className="text-sm text-orange-700">
                When artifacts are not kept, Docker images and static files will be permanently deleted.
                This frees up disk space but means you cannot inspect old deployments or use them for quick rollback.
              </p>
            </div>
          </div>
        )}

        {/* Info about auto cleanup */}
        {!autoCleanup && (
          <div className="flex items-start gap-3 p-4 border border-blue-200 bg-blue-50 rounded-lg">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-800">
                Manual Cleanup Mode
              </p>
              <p className="text-sm text-blue-700">
                With automatic cleanup disabled, you&apos;ll need to manually trigger cleanup from the deployments page.
                Old deployments will accumulate until you clean them up.
              </p>
            </div>
          </div>
        )}

        {/* Storage Impact Estimate */}
        <div className="p-4 border rounded-lg space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Estimated Storage Impact
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Deployments stored:</p>
              <p className="font-medium">{maxDeployments} versions</p>
            </div>
            <div>
              <p className="text-muted-foreground">Artifacts policy:</p>
              <p className="font-medium">
                {keepArtifacts ? 'Preserved' : 'Deleted after cleanup'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Cleanup mode:</p>
              <p className="font-medium">
                {autoCleanup ? 'Automatic' : 'Manual'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Estimated size:</p>
              <p className="font-medium">
                {keepArtifacts ? `~${maxDeployments * 200}MB` : '~50MB'}
              </p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {hasChanges && (
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                You have unsaved changes
              </span>
            )}
          </div>
          <Button 
            onClick={handleSave}
            disabled={!hasChanges || updateRetentionPolicyMutation.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {updateRetentionPolicyMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
