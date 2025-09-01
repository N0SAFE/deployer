'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import {
  Upload,
  Package,
  Clock,
  CheckCircle,
  History,
  Download,
  Eye,
  Cog,
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'
import FileUploadComponent from './FileUploadComponent'
import StaticFileBrowser from './StaticFileBrowser'
import DeploymentStatusTracker from './DeploymentStatusTracker'

interface ServiceUploadManagerProps {
  serviceId: string
  serviceName: string
  projectId: string
}

const formatBytes = (bytes: number) => {
  const sizes = ['B', 'KB', 'MB', 'GB']
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}

export default function ServiceUploadManager({ 
  serviceId, 
  serviceName, 
  projectId 
}: ServiceUploadManagerProps) {
  const [activeTab, setActiveTab] = useState('upload')
  const [currentDeployment, setCurrentDeployment] = useState<{ id: string; jobId: string } | null>(null)

  // Get upload statistics for this service
  const { data: uploadStats, refetch: refetchStats } = useQuery(
    orpc.storage.getUploadStats.queryOptions({
      input: {
        serviceId,
        projectId,
        days: 30,
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Get static serving stats
  const { data: staticStats } = useQuery(
    orpc.storage.getStaticServingStats.queryOptions({
      input: {
        serviceId,
      },
      staleTime: 60000, // 1 minute
    })
  )

  const handleUploadComplete = (result: { uploadId: string; fileName: string; fileSize: number }) => {
    toast.success(`Successfully uploaded: ${result.fileName}`)
    refetchStats()
    // Don't set deployment state here - it will be set by onDeploymentStart when user clicks deploy
  }

  return (
    <div className="space-y-6">
      {/* Service Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {serviceName} - File Management
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Upload, deploy, and manage files for this service
              </p>
            </div>
            <Badge variant="outline">{serviceId}</Badge>
          </div>
        </CardHeader>

        {/* Service Statistics */}
        {(uploadStats || staticStats) && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {uploadStats && (
                <>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{uploadStats.totalUploads}</p>
                    <p className="text-sm text-gray-600">Total Uploads</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{formatBytes(uploadStats.totalSize)}</p>
                    <p className="text-sm text-gray-600">Total Size</p>
                  </div>
                </>
              )}
              {staticStats && (
                <>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600">{staticStats.totalFiles}</p>
                    <p className="text-sm text-gray-600">Static Files</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-orange-600">{staticStats.requestCount || 0}</p>
                    <p className="text-sm text-gray-600">Request Count</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload Files
          </TabsTrigger>
          <TabsTrigger value="static" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Browse Files
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Upload History
          </TabsTrigger>
          <TabsTrigger value="deployments" className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Deployments
          </TabsTrigger>
          <TabsTrigger value="status" className="flex items-center gap-2">
            <Cog className="h-4 w-4" />
            Status
          </TabsTrigger>
        </TabsList>

        {/* Upload Tab */}
        <TabsContent value="upload" className="space-y-6">
          <FileUploadComponent 
            onUploadComplete={handleUploadComplete}
            onDeploymentStart={(deploymentId, jobId) => {
              setCurrentDeployment({ id: deploymentId, jobId })
              setActiveTab('status') // Switch to status tab
            }}
            projectId={projectId}
            serviceId={serviceId}
          />
        </TabsContent>

        {/* Static Files Browser Tab */}
        <TabsContent value="static" className="space-y-6">
          <StaticFileBrowser 
            serviceId={serviceId}
            serviceName={serviceName}
          />
        </TabsContent>

        {/* Upload History Tab */}
        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Recent Uploads
              </CardTitle>
            </CardHeader>
            <CardContent>
              {uploadStats?.recentUploads?.length ? (
                <div className="space-y-3">
                  {uploadStats.recentUploads.map((upload) => (
                    <div key={upload.uploadId} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Package className="h-5 w-5 text-blue-600" />
                        <div>
                          <h4 className="font-medium">{upload.fileName}</h4>
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span>{formatBytes(upload.size)}</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(upload.uploadTime)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="default">Completed</Badge>
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <History className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Upload History</h3>
                  <p className="text-gray-600 mb-4">
                    Upload files to see them appear here
                  </p>
                  <Button onClick={() => setActiveTab('upload')}>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Files
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upload Type Breakdown */}
          {uploadStats?.uploadsByType && Object.keys(uploadStats.uploadsByType).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Upload Types</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {Object.entries(uploadStats.uploadsByType).map(([type, count]) => (
                    <div key={type} className="text-center">
                      <p className="text-2xl font-bold text-blue-600">{count}</p>
                      <p className="text-sm text-gray-600 capitalize">{type}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Deployments Tab */}
        <TabsContent value="deployments" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Recent Deployments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* This would integrate with your deployment system */}
              <div className="text-center py-8">
                <CheckCircle className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-semibold mb-2">Deployment Integration</h3>
                <p className="text-gray-600 mb-4">
                  View and manage deployments created from uploaded files
                </p>
                <Button variant="outline">
                  View All Deployments
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deployment Status Tab */}
        <TabsContent value="status" className="space-y-6">
          {currentDeployment ? (
            <DeploymentStatusTracker
              deploymentId={currentDeployment.id}
              jobId={currentDeployment.jobId}
              onComplete={() => {
                toast.success('Deployment completed successfully!')
                setCurrentDeployment(null)
              }}
              onError={(error) => {
                toast.error(`Deployment failed: ${error}`)
                setCurrentDeployment(null)
              }}
            />
          ) : (
            <Card>
              <CardContent className="p-8">
                <div className="text-center">
                  <Cog className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Active Deployment</h3>
                  <p className="text-gray-600 mb-4">
                    Upload and deploy a file to see deployment status here
                  </p>
                  <Button 
                    variant="outline"
                    onClick={() => setActiveTab('upload')}
                  >
                    Upload Files
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}