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
import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

interface ServicePreviewsClientProps {
  projectId: string
}

export function ServicePreviewsClient({ projectId }: ServicePreviewsClientProps) {
  // Use projectId as that's what the API expects
  const { data: previewData, isLoading } = useQuery(
    orpc.environment.listPreviewEnvironments.queryOptions({
      input: { projectId }
    })
  )
  
  const previewEnvironments = previewData?.environments ?? []

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return 'default'
      case 'inactive': return 'secondary'
      case 'building': return 'secondary'
      case 'failed': return 'destructive'
      default: return 'outline'
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted rounded-md animate-pulse" />
        <div className="h-32 bg-muted rounded-md animate-pulse" />
      </div>
    )
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
                          <Badge variant={getStatusBadge(preview.isActive ? 'active' : 'inactive')}>
                            {preview.isActive ? 'active' : 'inactive'}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2">
                          <GitBranch className="h-3 w-3" />
                          {preview.type} environment
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
                        href={preview.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline flex items-center gap-1 max-w-80 truncate"
                      >
                        {preview.url || 'No URL available'}
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Created:</span>
                      <span>{new Date(preview.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Updated:</span>
                      <span>{new Date(preview.updatedAt).toLocaleString()}</span>
                    </div>
                    
                    <div className="flex space-x-2 pt-2">
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={preview.url || '#'}
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