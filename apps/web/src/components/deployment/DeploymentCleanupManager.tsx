'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Trash2,
  Eye,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Archive,
  Calendar,
  GitBranch
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/shadcn/alert-dialog"

interface DeploymentCleanupManagerProps {
  serviceId: string
  onCleanupComplete?: () => void
}

export function DeploymentCleanupManager({ serviceId, onCleanupComplete }: DeploymentCleanupManagerProps) {
  const [showPreview, setShowPreview] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // Preview cleanup
  const { data: preview, isLoading: isLoadingPreview, refetch: refetchPreview } = useQuery(
    orpc.deployment.previewCleanup.queryOptions({
      input: { serviceId },
      enabled: showPreview,
    })
  )

  // Trigger cleanup mutation
  const triggerCleanupMutation = useMutation(orpc.deployment.triggerCleanup.mutationOptions({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (data: any) => {
      toast.success('Cleanup completed successfully', {
        description: `Deleted ${data.deletedCount} old deployments, kept ${data.keptCount}`
      })
      setShowPreview(false)
      setShowConfirmDialog(false)
      onCleanupComplete?.()
    },
    onError: (error: Error) => {
      toast.error('Cleanup failed', {
        description: error.message
      })
    }
  }))

  const handlePreviewCleanup = () => {
    setShowPreview(true)
    refetchPreview()
  }

  const handleTriggerCleanup = () => {
    setShowConfirmDialog(true)
  }

  const confirmCleanup = () => {
    triggerCleanupMutation.mutate({ serviceId })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            Deployment Cleanup
          </CardTitle>
          <CardDescription>
            Manually trigger cleanup of old deployments or preview what would be deleted
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Action buttons */}
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={handlePreviewCleanup}
              disabled={isLoadingPreview}
              className="gap-2"
            >
              {isLoadingPreview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              Preview Cleanup
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleTriggerCleanup}
              disabled={triggerCleanupMutation.isPending}
              className="gap-2"
            >
              {triggerCleanupMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Trigger Cleanup
            </Button>
          </div>

          {/* Preview Results */}
          {showPreview && preview && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Cleanup Preview</h4>
                <div className="flex gap-2">
                  <Badge variant="destructive" className="gap-1">
                    <Trash2 className="h-3 w-3" />
                    {preview.willDelete} to delete
                  </Badge>
                  <Badge variant="default" className="gap-1 bg-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {preview.willKeep} to keep
                  </Badge>
                </div>
              </div>

              {/* Deployments to delete */}
              {preview.deploymentsToDelete.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-medium text-destructive flex items-center gap-2">
                    <Trash2 className="h-4 w-4" />
                    Will be Deleted ({preview.deploymentsToDelete.length})
                  </h5>
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {preview.deploymentsToDelete.map((deployment: any) => (
                      <div 
                        key={deployment.id} 
                        className="p-3 border border-destructive/20 bg-destructive/5 rounded-lg"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm">
                                {deployment.version || 'No version'}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                ID: {deployment.id.substring(0, 8)}...
                              </Badge>
                            </div>
                            {deployment.branch && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <GitBranch className="h-3 w-3" />
                                <span>{deployment.branch}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>
                                {formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deployments to keep */}
              {preview.deploymentsToKeep.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-medium text-green-700 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Will be Kept ({preview.deploymentsToKeep.length})
                  </h5>
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {preview.deploymentsToKeep.map((deployment: any) => (
                      <div 
                        key={deployment.id} 
                        className="p-3 border border-green-200 bg-green-50 rounded-lg"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm">
                                {deployment.version || 'No version'}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                ID: {deployment.id.substring(0, 8)}...
                              </Badge>
                            </div>
                            {deployment.branch && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <GitBranch className="h-3 w-3" />
                                <span>{deployment.branch}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>
                                {formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No cleanup needed */}
              {preview.willDelete === 0 && (
                <div className="flex items-center justify-center p-6 border border-green-200 bg-green-50 rounded-lg">
                  <div className="text-center space-y-2">
                    <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
                    <p className="text-sm font-medium text-green-800">
                      No cleanup needed
                    </p>
                    <p className="text-sm text-green-700">
                      All deployments are within the retention policy
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Warning message */}
          <div className="flex items-start gap-3 p-4 border border-orange-200 bg-orange-50 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-orange-800">
                Manual Cleanup Warning
              </p>
              <p className="text-sm text-orange-700">
                Manual cleanup will delete old deployments according to your retention policy.
                This action cannot be undone. Make sure to preview before triggering cleanup.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Confirm Deployment Cleanup
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will permanently delete old deployments according to your retention policy.
              </p>
              {preview && (
                <div className="p-3 border rounded-lg bg-muted space-y-2">
                  <p className="font-medium text-sm text-foreground">Summary:</p>
                  <ul className="text-sm space-y-1">
                    <li>• {preview.willDelete} deployments will be deleted</li>
                    <li>• {preview.willKeep} deployments will be kept</li>
                    <li>• Docker images and files may be removed (based on policy)</li>
                  </ul>
                </div>
              )}
              <p className="text-sm font-medium text-destructive">
                This action cannot be undone!
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCleanup}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, Delete Old Deployments
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
