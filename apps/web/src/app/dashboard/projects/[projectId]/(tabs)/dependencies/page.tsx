'use client'

import { Network } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'

export default function ProjectDependenciesPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Network className="h-5 w-5" />
          <span>Service Dependencies Graph</span>
        </CardTitle>
        <CardDescription>
          Visualize the relationships and dependencies between all services in this project
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12">
          <Network className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Dependencies Graph</h3>
          <p className="text-muted-foreground mb-6">
            Interactive service dependency visualization will be shown here
          </p>
          <div className="grid gap-4 max-w-md mx-auto text-sm text-muted-foreground">
            <div className="flex items-center space-x-2">
              <div className="h-3 w-3 rounded-full bg-green-500"></div>
              <span>Healthy Services</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-3 w-3 rounded-full bg-red-500"></div>
              <span>Failed Dependencies</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-3 w-3 rounded-full bg-blue-500"></div>
              <span>Deploying Services</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}