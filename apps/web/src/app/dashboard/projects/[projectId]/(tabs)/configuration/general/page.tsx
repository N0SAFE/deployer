'use client'

import { useState } from 'react'
import { useProject } from '@/hooks/useProjects'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Switch } from '@repo/ui/components/shadcn/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  Settings,
  GitBranch,
  Zap,
  AlertCircle,
  Info,
} from 'lucide-react'
import React from 'react'

interface ProjectGeneralConfigPageProps {
  params: {
    projectId: string
  }
}

export default function ProjectGeneralConfigPage({ params }: ProjectGeneralConfigPageProps) {
  const { data: project } = useProject(params.projectId)
  const [hasChanges, setHasChanges] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    baseDomain: '',
    defaultBranch: 'main',
    autoDeployEnabled: true,
    enablePreviewEnvironments: true,
  })

  // Initialize form data when project loads
  React.useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        description: project.description || '',
        baseDomain: project.baseDomain || '',
        defaultBranch: 'main', // This would come from config API
        autoDeployEnabled: true, // This would come from config API
        enablePreviewEnvironments: true, // This would come from config API
      })
    }
  }, [project])

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    // TODO: Implement save logic using project config API
    console.log('Saving general config:', formData)
    setHasChanges(false)
  }

  const handleReset = () => {
    if (project) {
      setFormData({
        name: project.name || '',
        description: project.description || '',
        baseDomain: project.baseDomain || '',
        defaultBranch: 'main',
        autoDeployEnabled: true,
        enablePreviewEnvironments: true,
      })
      setHasChanges(false)
    }
  }

  if (!project) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading project configuration...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Save/Reset Actions */}
      {hasChanges && (
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm font-medium">You have unsaved changes</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleReset}>
                  Reset
                </Button>
                <Button size="sm" onClick={handleSave}>
                  Save Changes
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Basic Information
          </CardTitle>
          <CardDescription>
            Update your project&apos;s basic information and settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="My Awesome Project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baseDomain">Base Domain</Label>
              <Input
                id="baseDomain"
                value={formData.baseDomain}
                onChange={(e) => handleInputChange('baseDomain', e.target.value)}
                placeholder="myapp.com"
              />
              <p className="text-xs text-muted-foreground">
                Services will be deployed to subdomains of this domain
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="A brief description of your project..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Git Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Git Configuration
          </CardTitle>
          <CardDescription>
            Default Git settings for new services in this project
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="defaultBranch">Default Branch</Label>
            <Select
              value={formData.defaultBranch}
              onValueChange={(value) => handleInputChange('defaultBranch', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select default branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">main</SelectItem>
                <SelectItem value="master">master</SelectItem>
                <SelectItem value="develop">develop</SelectItem>
                <SelectItem value="production">production</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              New services will use this branch for automatic deployments
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Deployment Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Deployment Settings
          </CardTitle>
          <CardDescription>
            Configure how deployments work for this project
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Auto-Deploy</Label>
              <p className="text-sm text-muted-foreground">
                Automatically deploy when code is pushed to the default branch
              </p>
            </div>
            <Switch
              checked={formData.autoDeployEnabled}
              onCheckedChange={(checked) => handleInputChange('autoDeployEnabled', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Preview Environments</Label>
              <p className="text-sm text-muted-foreground">
                Create preview deployments for pull requests
              </p>
            </div>
            <Switch
              checked={formData.enablePreviewEnvironments}
              onCheckedChange={(checked) => handleInputChange('enablePreviewEnvironments', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Project Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Project Information
          </CardTitle>
          <CardDescription>
            Current project status and metadata
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-sm text-muted-foreground">Project ID</Label>
              <p className="text-sm font-mono">{project.id.slice(0, 8)}...</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Created</Label>
              <p className="text-sm">{new Date(project.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Services</Label>
              <p className="text-sm">{project._count?.services || 0}</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Deployments</Label>
              <p className="text-sm">{project._count?.deployments || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}