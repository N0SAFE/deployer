'use client'

import { useState, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Label } from '@repo/ui/components/shadcn/label'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import {
  Upload,
  File,
  X,
  AlertCircle,
  Package,
  Code,
  Image as ImageIcon,
  FileText,
  Archive,
  RefreshCw,
  Eye,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'
import { cn } from '@repo/ui/lib/utils'

interface FileUploadProps {
  onUploadComplete?: (result: UploadResult) => void
  onDeploymentStart?: (deploymentId: string, jobId: string) => void
  maxFileSize?: number // in bytes
  acceptedTypes?: string[]
  projectId?: string
  serviceId?: string
}

interface UploadResult {
  uploadId: string
  fileName: string
  fileSize: number
  projectType: string
  fileCount: number
  extractedSize: number
  entryPoint?: string
  dependencies?: string[]
}

interface UploadedFile {
  file: File
  id: string
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error'
  progress: number
  result?: UploadResult
  error?: string
}

const ACCEPTED_EXTENSIONS = ['.zip', '.tar', '.tar.gz', '.tgz']
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB default

const getFileIcon = (type: string) => {
  if (type === 'node' || type === 'nodejs') return <Code className="h-4 w-4 text-green-600" />
  if (type === 'static' || type === 'html') return <ImageIcon className="h-4 w-4 text-blue-600" />
  if (type === 'docker' || type === 'dockerfile') return <Package className="h-4 w-4 text-blue-500" />
  if (type === 'archive' || type === 'compressed') return <Archive className="h-4 w-4 text-gray-600" />
  return <FileText className="h-4 w-4 text-gray-500" />
}

const getProjectTypeLabel = (type: string) => {
  const labels = {
    node: 'Node.js Project',
    static: 'Static Website',
    docker: 'Docker Project', 
    unknown: 'Unknown Type',
    nodejs: 'Node.js Application',
    html: 'HTML/Static Site',
    dockerfile: 'Dockerized Application',
    archive: 'Archive File',
    compressed: 'Compressed Archive'
  }
  return labels[type as keyof typeof labels] || type
}

export default function FileUploadComponent({
  onUploadComplete,
  onDeploymentStart,
  maxFileSize = MAX_FILE_SIZE,
  acceptedTypes = ACCEPTED_EXTENSIONS,
  projectId,
  serviceId,
}: FileUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedService, setSelectedService] = useState(serviceId || '')
  const [showPreview, setShowPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  // Upload file mutation
  const uploadMutation = useMutation(
    orpc.storage.upload.mutationOptions({
      onSuccess: (data, variables) => {
        const fileId = variables.fileName // Use fileName as ID
        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'completed', progress: 100, result: data }
              : f
          )
        )
        toast.success(`File uploaded successfully: ${data.fileName}`)
        onUploadComplete?.(data)
      },
      onError: (error, variables) => {
        const fileId = variables.fileName
        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'error', error: error.message }
              : f
          )
        )
        toast.error(`Upload failed: ${error.message}`)
      },
    })
  )

  // Deploy upload mutation
  const deployMutation = useMutation(
    orpc.storage.deployUpload.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Deployment started: ${data.deploymentId}`)
        queryClient.invalidateQueries({ queryKey: ['deployments'] })
        // Notify parent component about deployment start
        onDeploymentStart?.(data.deploymentId, data.jobId || `job_${data.deploymentId}`)
      },
      onError: (error) => {
        toast.error(`Deployment failed: ${error.message}`)
      },
    })
  )

  // Delete upload mutation
  const deleteMutation = useMutation(
    orpc.storage.deleteUpload.mutationOptions({
      onSuccess: (_, variables) => {
        setUploadedFiles(prev => prev.filter(f => f.result?.uploadId !== variables.uploadId))
        toast.success('Upload deleted successfully')
      },
      onError: (error) => {
        toast.error(`Failed to delete upload: ${error.message}`)
      },
    })
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    handleFiles(files)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    handleFiles(files)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const validateFile = (file: File): string | null => {
    if (file.size > maxFileSize) {
      return `File size exceeds limit of ${formatBytes(maxFileSize)}`
    }
    
    const hasValidExtension = acceptedTypes.some(type => 
      file.name.toLowerCase().endsWith(type.toLowerCase())
    )
    
    if (!hasValidExtension) {
      return `File type not supported. Accepted types: ${acceptedTypes.join(', ')}`
    }
    
    return null
  }

  const handleFiles = (files: File[]) => {
    const validFiles: UploadedFile[] = []
    
    files.forEach(file => {
      const error = validateFile(file)
      if (error) {
        toast.error(`${file.name}: ${error}`)
        return
      }
      
      const uploadFile: UploadedFile = {
        file,
        id: file.name,
        status: 'pending',
        progress: 0,
      }
      
      validFiles.push(uploadFile)
    })
    
    if (validFiles.length > 0) {
      setUploadedFiles(prev => [...prev, ...validFiles])
    }
  }

  const uploadFile = async (uploadedFile: UploadedFile) => {
    if (!uploadedFile.file) return

    setUploadedFiles(prev =>
      prev.map(f =>
        f.id === uploadedFile.id
          ? { ...f, status: 'uploading', progress: 0 }
          : f
      )
    )

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1]) // Remove data URL prefix
        }
        reader.onerror = reject
        reader.readAsDataURL(uploadedFile.file)
      })

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === uploadedFile.id
              ? { ...f, progress: Math.min(f.progress + 10, 90) }
              : f
          )
        )
      }, 200)

      // Upload file
      await uploadMutation.mutateAsync({
        fileName: uploadedFile.file.name,
        fileContent: base64,
        projectId,
        ...(selectedService && { serviceId: selectedService }),
        metadata: {
          originalSize: uploadedFile.file.size,
          uploadTime: new Date().toISOString(),
        },
      })

      clearInterval(progressInterval)
    } catch (error) {
      console.error('Upload error:', error)
    }
  }

  const deployUpload = (uploadId: string) => {
    if (!selectedService) {
      toast.error('Please select a service to deploy to')
      return
    }

    deployMutation.mutate({
      uploadId,
      serviceId: selectedService,
      environment: 'production',
    })
  }

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const deleteUpload = (uploadId: string) => {
    deleteMutation.mutate({ uploadId })
  }

  const formatBytes = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB']
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`
  }

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            File Upload
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Service Selection */}
          {!serviceId && (
            <div>
              <Label htmlFor="service-select">Target Service</Label>
              <Select value={selectedService} onValueChange={setSelectedService}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a service to deploy to" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service-1">My Web App</SelectItem>
                  <SelectItem value="service-2">API Service</SelectItem>
                  <SelectItem value="service-3">Static Site</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Upload Zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
              isDragOver 
                ? "border-blue-500 bg-blue-50" 
                : "border-gray-300 hover:border-gray-400"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold mb-2">
              Drop files here or click to browse
            </h3>
            <p className="text-gray-600 mb-2">
              Upload ZIP, TAR, or TAR.GZ files
            </p>
            <p className="text-sm text-gray-500">
              Maximum file size: {formatBytes(maxFileSize)}
            </p>
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={acceptedTypes.join(',')}
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Upload Info */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Supported formats: ZIP, TAR, TAR.GZ files containing web applications, Node.js projects, or static sites.
              Files will be analyzed and deployed based on their content.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <File className="h-5 w-5" />
                Uploaded Files ({uploadedFiles.length})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  uploadedFiles
                    .filter(f => f.status === 'pending')
                    .forEach(uploadFile)
                }}
                disabled={!uploadedFiles.some(f => f.status === 'pending')}
              >
                Upload All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {uploadedFiles.map((uploadedFile) => (
              <div key={uploadedFile.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="relative">
                      {uploadedFile.result && getFileIcon(uploadedFile.result.projectType)}
                      {!uploadedFile.result && <File className="h-4 w-4 text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium truncate">{uploadedFile.file.name}</h4>
                        <Badge 
                          variant={
                            uploadedFile.status === 'completed' ? 'default' :
                            uploadedFile.status === 'error' ? 'destructive' :
                            uploadedFile.status === 'uploading' ? 'secondary' : 'outline'
                          }
                        >
                          {uploadedFile.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">
                        {formatBytes(uploadedFile.file.size)}
                        {uploadedFile.result && (
                          <span className="ml-2">
                            • {getProjectTypeLabel(uploadedFile.result.projectType)}
                            • {uploadedFile.result.fileCount} files
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {uploadedFile.status === 'pending' && (
                      <Button
                        size="sm"
                        onClick={() => uploadFile(uploadedFile)}
                        disabled={uploadMutation.isPending}
                      >
                        Upload
                      </Button>
                    )}
                    
                    {uploadedFile.status === 'completed' && uploadedFile.result && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowPreview(uploadedFile.result!.uploadId)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => deployUpload(uploadedFile.result!.uploadId)}
                          disabled={deployMutation.isPending || !selectedService}
                        >
                          Deploy
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteUpload(uploadedFile.result!.uploadId)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    
                    {uploadedFile.status === 'error' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => uploadFile(uploadedFile)}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFile(uploadedFile.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Progress Bar */}
                {uploadedFile.status === 'uploading' && (
                  <Progress value={uploadedFile.progress} className="h-2" />
                )}

                {/* Error Message */}
                {uploadedFile.status === 'error' && uploadedFile.error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{uploadedFile.error}</AlertDescription>
                  </Alert>
                )}

                {/* File Details */}
                {uploadedFile.result && (
                  <div className="bg-gray-50 rounded p-3 text-sm">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>
                        <span className="font-medium">Type:</span> {getProjectTypeLabel(uploadedFile.result.projectType)}
                      </div>
                      <div>
                        <span className="font-medium">Files:</span> {uploadedFile.result.fileCount}
                      </div>
                      <div>
                        <span className="font-medium">Extracted Size:</span> {formatBytes(uploadedFile.result.extractedSize)}
                      </div>
                      <div>
                        <span className="font-medium">Upload ID:</span> {uploadedFile.result.uploadId.slice(0, 8)}...
                      </div>
                    </div>
                    
                    {uploadedFile.result.entryPoint && (
                      <div className="mt-2">
                        <span className="font-medium">Entry Point:</span> {uploadedFile.result.entryPoint}
                      </div>
                    )}
                    
                    {uploadedFile.result.dependencies && uploadedFile.result.dependencies.length > 0 && (
                      <div className="mt-2">
                        <span className="font-medium">Dependencies:</span> {uploadedFile.result.dependencies.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* File Preview Modal */}
      {showPreview && (
        <Dialog open={!!showPreview} onOpenChange={() => setShowPreview(null)}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>File Structure Preview</DialogTitle>
              <DialogDescription>
                Preview of uploaded and extracted files
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* File structure would go here - implement based on your needs */}
              <p className="text-sm text-gray-600">
                File structure preview for upload ID: {showPreview}
              </p>
              {/* You can implement a tree view or file list here */}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}