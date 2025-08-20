'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { 
  MoreHorizontal,
  Settings,
  Zap,
  ExternalLink,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Globe
} from 'lucide-react'
import { type Service } from '@/state/serviceStore'
import Link from 'next/link'

interface ServiceCardProps {
  service: Service
}

export default function ServiceCard({ service }: ServiceCardProps) {
  const getStatusIcon = () => {
    switch (service.status) {
      case 'running':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'deploying':
      case 'starting':
        return <Clock className="h-4 w-4 text-yellow-600 animate-pulse" />
      case 'stopped':
        return <AlertCircle className="h-4 w-4 text-gray-400" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusColor = () => {
    switch (service.status) {
      case 'running':
        return 'default'
      case 'error':
        return 'destructive'
      case 'deploying':
      case 'starting':
        return 'secondary'
      case 'stopped':
        return 'outline'
      default:
        return 'outline'
    }
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              <CardTitle className="text-lg">{service.name}</CardTitle>
            </div>
            <CardDescription className="line-clamp-2">
              {service.description || 'No description provided'}
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
                <Link href={`/projects/${service.projectId}/services/${service.id}`}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Service
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Zap className="h-4 w-4 mr-2" />
                Deploy
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/projects/${service.projectId}/services/${service.id}/settings`}>
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
            <span className="text-muted-foreground">Status</span>
            <Badge variant={getStatusColor() as "default" | "destructive" | "outline" | "secondary"}>
              {service.status || 'stopped'}
            </Badge>
          </div>
          
          {service.port && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Port</span>
              <span className="font-mono text-xs">{service.port}</span>
            </div>
          )}

          {service.customDomain && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Domain</span>
              <div className="flex items-center space-x-1">
                <Globe className="h-3 w-3" />
                <span className="text-xs font-mono">{service.customDomain}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Last Deploy</span>
            <span className="text-xs">
              {service.lastDeploymentAt 
                ? new Date(service.lastDeploymentAt).toLocaleDateString()
                : 'Never'
              }
            </span>
          </div>

          <div className="pt-2 border-t flex space-x-2">
            <Button size="sm" className="flex-1">
              <Zap className="h-3 w-3 mr-1" />
              Deploy
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${service.projectId}/services/${service.id}`}>
                View
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}