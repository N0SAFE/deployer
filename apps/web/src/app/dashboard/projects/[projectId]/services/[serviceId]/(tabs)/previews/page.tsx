'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { 
  Globe,
  ExternalLink,
  GitBranch,
  Trash2,
  MoreHorizontal
} from 'lucide-react'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'

export default function ServicePreviewDeploymentsPage() {
  // Mock data for preview environments
  const previewEnvironments = [
    {
      id: '1',
      name: 'feature/auth-improvements',
      url: 'https://feature-auth-improvements-abc123.preview.example.com',
      status: 'active',
      branch: 'feature/auth-improvements',
      createdAt: new Date('2024-01-15T10:30:00Z'),
      lastDeployment: new Date('2024-01-15T14:20:00Z')
    },
    {
      id: '2',
      name: 'fix/api-validation',
      url: 'https://fix-api-validation-def456.preview.example.com',
      status: 'building',
      branch: 'fix/api-validation',
      createdAt: new Date('2024-01-14T16:45:00Z'),
      lastDeployment: new Date('2024-01-14T16:50:00Z')
    }
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return 'default'
      case 'building': return 'secondary'
      case 'failed': return 'destructive'
      default: return 'outline'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Preview Environments</h3>
          <p className="text-sm text-muted-foreground">
            Temporary environments for testing branches and pull requests
          </p>
        </div>
        <Button>
          <Globe className="h-4 w-4 mr-2" />
          Create Preview
        </Button>
      </div>

      {/* Preview Environments List */}
      <div className="space-y-4">
        {previewEnvironments.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No preview environments</h3>
                <p className="text-muted-foreground mb-6">
                  Create preview environments for testing branches and PRs
                </p>
                <Button>
                  <Globe className="h-4 w-4 mr-2" />
                  Create Preview
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {previewEnvironments.map((preview) => (
              <Card key={preview.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Globe className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {preview.name}
                          <Badge variant={getStatusBadge(preview.status)}>
                            {preview.status}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2">
                          <GitBranch className="h-3 w-3" />
                          {preview.branch}
                        </CardDescription>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open Preview
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Preview
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">URL:</span>
                      <a
                        href={preview.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline flex items-center gap-1 max-w-80 truncate"
                      >
                        {preview.url}
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Created:</span>
                      <span>{preview.createdAt.toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Last deployment:</span>
                      <span>{preview.lastDeployment.toLocaleString()}</span>
                    </div>
                    
                    <div className="flex space-x-2 pt-2">
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={preview.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open Preview
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}