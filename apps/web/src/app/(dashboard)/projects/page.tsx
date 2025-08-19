'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { 
  FolderOpen, 
  Plus, 
  Search, 
  MoreHorizontal,
  Settings,
  Trash2,
  ExternalLink
} from 'lucide-react'
import { useProjectStore } from '@/state/projectStore'
import Link from 'next/link'

export default function ProjectsPage() {
  const projects = useProjectStore((state) => state.projects)
  const [searchTerm, setSearchTerm] = useState('')

  // Filter projects based on search term
  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage your deployment projects
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Project
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center space-x-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {project.description || 'No description provided'}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${project.id}`}>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View Project
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${project.id}/settings`}>
                          <Settings className="h-4 w-4 mr-2" />
                          Settings
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Services</span>
                    <Badge variant="outline">
                      {project.servicesCount || 0}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge 
                      variant={project.status === 'active' ? 'default' : 'secondary'}
                    >
                      {project.status || 'active'}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Last Deploy</span>
                    <span className="text-xs">
                      {project.lastDeploymentAt 
                        ? new Date(project.lastDeploymentAt).toLocaleDateString()
                        : 'Never'
                      }
                    </span>
                  </div>

                  <div className="pt-2 border-t flex space-x-2">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link href={`/projects/${project.id}`}>
                        View Project
                      </Link>
                    </Button>
                    <Button asChild size="sm" className="flex-1">
                      <Link href={`/projects/${project.id}/services`}>
                        Services
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">
            {searchTerm ? 'No projects found' : 'No projects yet'}
          </h3>
          <p className="text-muted-foreground mb-6">
            {searchTerm 
              ? `No projects match "${searchTerm}". Try adjusting your search.`
              : 'Get started by creating your first project.'
            }
          </p>
          {!searchTerm && (
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Project
            </Button>
          )}
        </div>
      )}
    </div>
  )
}