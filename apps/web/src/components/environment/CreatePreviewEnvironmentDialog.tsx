'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from '@repo/ui/components/shadcn/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import {
  GitBranch,
  Plus,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react'

interface PreviewEnvironmentData {
  name: string
  branch: string
  pullRequestId: string
  description: string
  autoDeleteAfterDays: number
  inheritFromEnvironment: string
  variableOverrides: Record<string, string>
  enableCustomDomain: boolean
  customDomain: string
}

interface CreatePreviewEnvironmentDialogProps {
  projectId: string
  triggerButton?: React.ReactNode
}

export function CreatePreviewEnvironmentDialog({ 
  projectId, 
  triggerButton 
}: CreatePreviewEnvironmentDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [formData, setFormData] = useState<PreviewEnvironmentData>({
    name: '',
    branch: '',
    pullRequestId: '',
    description: '',
    autoDeleteAfterDays: 7,
    inheritFromEnvironment: 'staging',
    variableOverrides: {},
    enableCustomDomain: false,
    customDomain: '',
  })

  // Mock existing environments
  const existingEnvironments = [
    { id: '1', name: 'Production', type: 'production' },
    { id: '2', name: 'Staging', type: 'staging' },
  ]

  // Auto-generate environment name from branch
  const handleBranchChange = (branch: string) => {
    const cleanBranch = branch.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
    const name = cleanBranch ? `preview-${cleanBranch}` : ''
    setFormData(prev => ({
      ...prev,
      branch,
      name: prev.name || name, // Only auto-set if name is empty
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)
    
    try {
      // TODO: Implement API call to create preview environment
      console.log('Creating preview environment:', { projectId, ...formData })
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      setIsOpen(false)
      
      // Reset form
      setFormData({
        name: '',
        branch: '',
        pullRequestId: '',
        description: '',
        autoDeleteAfterDays: 7,
        inheritFromEnvironment: 'staging',
        variableOverrides: {},
        enableCustomDomain: false,
        customDomain: '',
      })
    } catch (error) {
      console.error('Failed to create preview environment:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const DefaultTrigger = () => (
    <Button 
      variant="outline" 
      size="sm"
      className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
    >
      <GitBranch className="h-4 w-4 mr-2" />
      Create Preview
    </Button>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {triggerButton || <DefaultTrigger />}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-600" />
            Create Preview Environment
          </DialogTitle>
          <DialogDescription>
            Create a temporary environment for testing features or pull requests.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Configuration */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="branch">Git Branch *</Label>
                <Input
                  id="branch"
                  value={formData.branch}
                  onChange={(e) => handleBranchChange(e.target.value)}
                  placeholder="feature/new-auth"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  The branch this environment will track
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pullRequestId">Pull Request ID</Label>
                <Input
                  id="pullRequestId"
                  value={formData.pullRequestId}
                  onChange={(e) => setFormData(prev => ({ ...prev, pullRequestId: e.target.value }))}
                  placeholder="123"
                />
                <p className="text-xs text-muted-foreground">
                  Optional: Link to PR number
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Environment Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="preview-feature-auth"
                required
              />
              <p className="text-xs text-muted-foreground">
                Unique name for this preview environment
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Testing the new authentication system redesign"
                rows={2}
              />
            </div>
          </div>

          {/* Configuration Options */}
          <div className="space-y-4">
            <h4 className="font-medium">Configuration Options</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Inherit Configuration From</Label>
                <Select
                  value={formData.inheritFromEnvironment}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, inheritFromEnvironment: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {existingEnvironments.map(env => (
                      <SelectItem key={env.id} value={env.id}>
                        {env.name} ({env.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Copy variables and settings from existing environment
                </p>
              </div>

              <div className="space-y-2">
                <Label>Auto-delete After</Label>
                <Select
                  value={formData.autoDeleteAfterDays.toString()}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, autoDeleteAfterDays: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Automatically clean up after this period
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="customDomain"
                  checked={formData.enableCustomDomain}
                  onCheckedChange={(checked) => setFormData(prev => ({ 
                    ...prev, 
                    enableCustomDomain: checked,
                    customDomain: checked ? prev.customDomain : ''
                  }))}
                />
                <Label htmlFor="customDomain">Enable custom subdomain</Label>
              </div>

              {formData.enableCustomDomain && (
                <div className="space-y-2 ml-6">
                  <Label htmlFor="customDomain">Custom Subdomain</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="customDomain"
                      value={formData.customDomain}
                      onChange={(e) => setFormData(prev => ({ ...prev, customDomain: e.target.value }))}
                      placeholder="auth-redesign"
                    />
                    <span className="text-sm text-muted-foreground">.preview.myapp.com</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Preview Configuration */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Preview Configuration</CardTitle>
              <CardDescription>
                This environment will be created with the following settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">URL:</span>
                  <div className="font-mono text-xs mt-1 p-2 bg-gray-50 rounded">
                    {formData.enableCustomDomain && formData.customDomain
                      ? `https://${formData.customDomain}.preview.myapp.com`
                      : `https://${formData.name || 'preview-environment'}.preview.myapp.com`
                    }
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Lifecycle:</span>
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="h-3 w-3" />
                    <span className="text-xs">Auto-delete in {formData.autoDeleteAfterDays} days</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="text-muted-foreground text-sm">Variable inheritance:</span>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">
                    Inherits from {existingEnvironments.find(e => e.id === formData.inheritFromEnvironment)?.name}
                  </Badge>
                  {formData.pullRequestId && (
                    <Badge variant="outline" className="text-xs">
                      PR #{formData.pullRequestId}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Warning/Info */}
          <div className="p-3 rounded-md bg-amber-50 border border-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-amber-800">Preview Environment Guidelines</div>
                <ul className="text-amber-700 text-xs mt-1 space-y-1">
                  <li>• Preview environments are automatically deleted after the specified period</li>
                  <li>• They inherit configuration from the selected base environment</li>
                  <li>• Database data is not shared with production environments</li>
                  <li>• Use for testing features, not for storing permanent data</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isCreating || !formData.name || !formData.branch}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isCreating ? (
                <>
                  <CheckCircle className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Preview Environment
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default CreatePreviewEnvironmentDialog