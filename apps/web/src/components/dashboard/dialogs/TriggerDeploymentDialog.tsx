'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Rocket, Loader2, GitBranch } from 'lucide-react'

interface TriggerDeploymentDialogProps {
  trigger?: React.ReactNode
  projectId?: string
  projectName?: string
  serviceId?: string
  serviceName?: string
}

export function TriggerDeploymentDialog({
  trigger,
  projectId,
  projectName,
  serviceId,
  serviceName,
}: TriggerDeploymentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    environment: 'staging' as string,
    branch: 'main',
    commitRef: '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate API call - replace with actual ORPC call
    setTimeout(() => {
      console.log('Triggering deployment:', {
        projectId,
        serviceId,
        ...formData,
      })

      setIsSubmitting(false)
      setOpen(false)
      setFormData({ environment: 'staging', branch: 'main', commitRef: '' })

      // Refresh the deployments list
      router.refresh()
    }, 1500)
  }

  const defaultTrigger = (
    <Button>
      <Rocket className="mr-2 h-4 w-4" />
      Trigger Deployment
    </Button>
  )

  const title = serviceName
    ? `Deploy ${serviceName}`
    : projectName
      ? `Deploy ${projectName}`
      : 'Trigger Deployment'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Start a new deployment to the selected environment.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="environment">Environment</Label>
              <Select
                value={formData.environment}
                onValueChange={(value) => {
                  setFormData((prev) => ({ ...prev, environment: value }))
                }}
              >
                <SelectTrigger id="environment" className="w-full">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="development">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="branch">Branch</Label>
              <div className="relative">
                <GitBranch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="branch"
                  className="pl-10"
                  placeholder="main"
                  value={formData.branch}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setFormData((prev) => ({ ...prev, branch: e.target.value }))
                  }}
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="commitRef">
                Commit SHA <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="commitRef"
                placeholder="a1b2c3d... (leave empty for latest)"
                value={formData.commitRef}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData((prev) => ({ ...prev, commitRef: e.target.value }))
                }}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to deploy the latest commit on the branch.
              </p>
            </div>

            {formData.environment === 'production' && (
              <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  ⚠️ You are about to deploy to <strong>production</strong>. This will
                  affect live users.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !formData.branch}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Deploy
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
