'use client'

import { useState } from 'react'
import { useService } from '@/hooks/useServices'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@repo/ui/components/shadcn/dialog'
import { 
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  FileText,
  Upload,
  Download,
  Lock,
  Unlock,
  AlertTriangle
} from 'lucide-react'

type EnvironmentType = 'production' | 'staging' | 'development'

interface EnvironmentVariable {
  id: string
  key: string
  value: string
  isSecret: boolean
  environment: EnvironmentType
  serviceId: string
}

interface EnvironmentConfigurationClientProps {
  serviceId: string
}

export function EnvironmentConfigurationClient({ serviceId }: EnvironmentConfigurationClientProps) {
  const { data: service } = useService(serviceId)
  
  // For now, use service environmentVariables from the database schema
  // The service.environmentVariables is a JSON object that we'll parse
  const environmentVariables: EnvironmentVariable[] = service?.environmentVariables 
    ? Object.entries(service.environmentVariables).map(([key, value], index) => ({
        id: `${serviceId}-${key}-${index}`,
        key,
        value: String(value),
        isSecret: key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('password'),
        environment: 'production' as EnvironmentType,
        serviceId
      }))
    : []

  const [activeEnvironment, setActiveEnvironment] = useState<EnvironmentType>('production')
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newVariable, setNewVariable] = useState({ key: '', value: '', isSecret: false })

  const toggleSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const addVariable = () => {
    if (newVariable.key && newVariable.value) {
      // TODO: Implement add variable mutation
      setNewVariable({ key: '', value: '', isSecret: false })
      setIsAddDialogOpen(false)
    }
  }

  const deleteVariable = (_key: string) => {
    // TODO: Implement delete variable mutation with ORPC
    // For now, just log the action
    console.log(`Would delete variable: ${_key}`)
  }

  const currentEnvironmentVars = environmentVariables.filter((v: EnvironmentVariable) => v.environment === activeEnvironment)

  const exportEnvironmentFile = () => {
    const envContent = currentEnvironmentVars
      .map((v: EnvironmentVariable) => `${v.key}=${v.value}`)
      .join('\n')
    
    const blob = new Blob([envContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `.env.${activeEnvironment}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading environment configuration...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Environment Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Environment Variables
          </CardTitle>
          <CardDescription>
            Manage environment variables across different deployment environments
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeEnvironment} onValueChange={(value) => setActiveEnvironment(value as EnvironmentType)}>
            <div className="flex items-center justify-between mb-4">
              <TabsList className="grid w-full max-w-md grid-cols-3">
                <TabsTrigger value="production" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Production
                </TabsTrigger>
                <TabsTrigger value="staging" className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Staging
                </TabsTrigger>
                <TabsTrigger value="development" className="flex items-center gap-2">
                  <Unlock className="h-4 w-4" />
                  Development
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportEnvironmentFile}>
                  <Download className="h-4 w-4 mr-2" />
                  Export .env
                </Button>
                <Button variant="outline" size="sm">
                  <Upload className="h-4 w-4 mr-2" />
                  Import .env
                </Button>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Variable
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Environment Variable</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="var-key">Key</Label>
                        <Input
                          id="var-key"
                          value={newVariable.key}
                          onChange={(e) => setNewVariable(prev => ({ ...prev, key: e.target.value }))}
                          placeholder="VARIABLE_NAME"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="var-value">Value</Label>
                        <Input
                          id="var-value"
                          value={newVariable.value}
                          onChange={(e) => setNewVariable(prev => ({ ...prev, value: e.target.value }))}
                          placeholder="variable value"
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="var-secret"
                          checked={newVariable.isSecret}
                          onChange={(e) => setNewVariable(prev => ({ ...prev, isSecret: e.target.checked }))}
                        />
                        <Label htmlFor="var-secret">This is a secret value</Label>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={addVariable}>
                          Add Variable
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <TabsContent value="production" className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <Lock className="h-4 w-4 text-red-600" />
                <p className="text-sm text-red-700">
                  Production environment variables are encrypted and only visible during deployment.
                </p>
              </div>
              {currentEnvironmentVars.length === 0 ? (
                <div className="text-center py-8">
                  <Key className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No variables in production</h3>
                  <p className="text-muted-foreground mb-4">
                    Add environment variables for your production environment
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {currentEnvironmentVars.map((variable: EnvironmentVariable, index: number) => (
                    <div key={`${variable.key}-${index}`} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium">{variable.key}</Label>
                          {variable.isSecret && (
                            <Badge variant="secondary" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Secret
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type={variable.isSecret && !showSecrets[variable.key] ? 'password' : 'text'}
                            value={variable.value}
                            readOnly
                            className="flex-1"
                          />
                          {variable.isSecret && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSecret(variable.key)}
                            >
                              {showSecrets[variable.key] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteVariable(variable.key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="staging" className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <p className="text-sm text-yellow-700">
                  Staging environment for testing before production deployment.
                </p>
              </div>
              {currentEnvironmentVars.length === 0 ? (
                <div className="text-center py-8">
                  <Key className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No variables in staging</h3>
                  <p className="text-muted-foreground mb-4">
                    Add environment variables for your staging environment
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {currentEnvironmentVars.map((variable: EnvironmentVariable, index: number) => (
                    <div key={`${variable.key}-${index}`} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium">{variable.key}</Label>
                          {variable.isSecret && (
                            <Badge variant="secondary" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Secret
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type={variable.isSecret && !showSecrets[variable.key] ? 'password' : 'text'}
                            value={variable.value}
                            className="flex-1"
                          />
                          {variable.isSecret && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSecret(variable.key)}
                            >
                              {showSecrets[variable.key] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteVariable(variable.key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="development" className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <Unlock className="h-4 w-4 text-blue-600" />
                <p className="text-sm text-blue-700">
                  Development environment variables for local testing and debugging.
                </p>
              </div>
              {currentEnvironmentVars.length === 0 ? (
                <div className="text-center py-8">
                  <Key className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No variables in development</h3>
                  <p className="text-muted-foreground mb-4">
                    Add environment variables for your development environment
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {currentEnvironmentVars.map((variable: EnvironmentVariable, index: number) => (
                    <div key={`${variable.key}-${index}`} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium">{variable.key}</Label>
                          {variable.isSecret && (
                            <Badge variant="secondary" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Secret
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type={variable.isSecret && !showSecrets[variable.key] ? 'password' : 'text'}
                            value={variable.value}
                            className="flex-1"
                          />
                          {variable.isSecret && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSecret(variable.key)}
                            >
                              {showSecrets[variable.key] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteVariable(variable.key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Environment Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Environment Management
          </CardTitle>
          <CardDescription>
            Import, export, and manage environment configurations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-medium">Import Configuration</h4>
              <p className="text-sm text-muted-foreground">
                Upload an .env file to import environment variables
              </p>
              <Button variant="outline" className="w-full">
                <Upload className="h-4 w-4 mr-2" />
                Choose .env File
              </Button>
            </div>
            
            <div className="space-y-3">
              <h4 className="font-medium">Export Configuration</h4>
              <p className="text-sm text-muted-foreground">
                Download current environment as an .env file
              </p>
              <Button variant="outline" className="w-full" onClick={exportEnvironmentFile}>
                <Download className="h-4 w-4 mr-2" />
                Download .env.{activeEnvironment}
              </Button>
            </div>
          </div>

          <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
            <div className="flex items-start gap-2">
              <Key className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-800 mb-2">
                  Environment Variable Best Practices
                </p>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Use UPPER_CASE for environment variable names</li>
                  <li>• Mark sensitive values (passwords, API keys) as secrets</li>
                  <li>• Use different values for each environment</li>
                  <li>• Test configuration changes in staging before production</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}