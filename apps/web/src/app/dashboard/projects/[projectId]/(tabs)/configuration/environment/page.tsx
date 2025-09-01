'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui/components/shadcn/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  KeyRound,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  AlertTriangle,
  Upload,
  Download,
} from 'lucide-react'

interface ProjectEnvironmentConfigPageProps {
  params: {
    projectId: string
  }
}

type EnvironmentType = 'all' | 'production' | 'staging' | 'development'

interface EnvironmentVariable {
  key: string
  value: string
  isSecret: boolean
  environment: EnvironmentType
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ProjectEnvironmentConfigPage(_: ProjectEnvironmentConfigPageProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [variables, setVariables] = useState<EnvironmentVariable[]>([
    {
      key: 'DATABASE_URL',
      value: 'postgresql://user:pass@localhost:5432/db',
      isSecret: true,
      environment: 'all',
    },
    {
      key: 'API_BASE_URL',
      value: 'https://api.myapp.com',
      isSecret: false,
      environment: 'production',
    },
    {
      key: 'DEBUG',
      value: 'true',
      isSecret: false,
      environment: 'development',
    },
  ])
  const [showSecrets, setShowSecrets] = useState<Record<number, boolean>>({})
  const [newVariable, setNewVariable] = useState<EnvironmentVariable>({
    key: '',
    value: '',
    isSecret: false,
    environment: 'all',
  })
  const [isAddingVariable, setIsAddingVariable] = useState(false)

  const toggleSecret = (index: number) => {
    setShowSecrets(prev => ({ ...prev, [index]: !prev[index] }))
  }

  const addVariable = () => {
    if (newVariable.key && newVariable.value) {
      setVariables(prev => [...prev, { ...newVariable }])
      setNewVariable({ key: '', value: '', isSecret: false, environment: 'all' })
      setIsAddingVariable(false)
      setHasChanges(true)
    }
  }

  const removeVariable = (index: number) => {
    setVariables(prev => prev.filter((_, i) => i !== index))
    setHasChanges(true)
  }

  const updateVariable = (index: number, field: keyof EnvironmentVariable, value: string | boolean) => {
    setVariables(prev => prev.map((variable, i) => 
      i === index ? { ...variable, [field]: value } : variable
    ))
    setHasChanges(true)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const getVariablesByEnvironment = (environment: string) => {
    return variables.filter(variable => 
      variable.environment === 'all' || variable.environment === environment
    )
  }

  const getEnvironmentBadgeColor = (environment: string) => {
    switch (environment) {
      case 'production': return 'destructive'
      case 'staging': return 'secondary'
      case 'development': return 'outline'
      default: return 'default'
    }
  }

  const handleSave = async () => {
    // TODO: Implement save logic using project config API
    console.log('Saving environment config:', variables)
    setHasChanges(false)
  }

  const handleImportEnv = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'))
        const newVars: EnvironmentVariable[] = lines.map(line => {
          const [key, ...valueParts] = line.split('=')
          const value = valueParts.join('=')
          return {
            key: key.trim(),
            value: value.trim(),
            isSecret: key.toLowerCase().includes('secret') || key.toLowerCase().includes('key') || key.toLowerCase().includes('password'),
            environment: 'all' as const,
          }
        })
        setVariables(prev => [...prev, ...newVars])
        setHasChanges(true)
      }
      reader.readAsText(file)
    }
  }

  const handleExportEnv = () => {
    const envContent = variables
      .map(variable => `${variable.key}=${variable.value}`)
      .join('\n')
    
    const blob = new Blob([envContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '.env'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Save Action */}
      {hasChanges && (
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">You have unsaved changes</span>
              </div>
              <Button size="sm" onClick={handleSave}>
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Environment Variables
              </CardTitle>
              <CardDescription>
                Manage environment variables for all environments in this project
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".env"
                onChange={handleImportEnv}
                className="hidden"
                id="env-import"
              />
              <Label htmlFor="env-import" className="cursor-pointer">
                <Button variant="outline" size="sm" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    Import .env
                  </span>
                </Button>
              </Label>
              <Button variant="outline" size="sm" onClick={handleExportEnv}>
                <Download className="h-4 w-4 mr-2" />
                Export .env
              </Button>
              <Dialog open={isAddingVariable} onOpenChange={setIsAddingVariable}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Variable
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Environment Variable</DialogTitle>
                    <DialogDescription>
                      Add a new environment variable to your project
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-key">Variable Name</Label>
                      <Input
                        id="new-key"
                        value={newVariable.key}
                        onChange={(e) => setNewVariable(prev => ({ ...prev, key: e.target.value.toUpperCase() }))}
                        placeholder="DATABASE_URL"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-value">Value</Label>
                      <Input
                        id="new-value"
                        type={newVariable.isSecret ? 'password' : 'text'}
                        value={newVariable.value}
                        onChange={(e) => setNewVariable(prev => ({ ...prev, value: e.target.value }))}
                        placeholder="Enter value..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-environment">Environment</Label>
                      <Select
                        value={newVariable.environment}
                        onValueChange={(value) => setNewVariable(prev => ({ ...prev, environment: value as EnvironmentType }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Environments</SelectItem>
                          <SelectItem value="production">Production Only</SelectItem>
                          <SelectItem value="staging">Staging Only</SelectItem>
                          <SelectItem value="development">Development Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="new-secret"
                        checked={newVariable.isSecret}
                        onChange={(e) => setNewVariable(prev => ({ ...prev, isSecret: e.target.checked }))}
                        className="rounded"
                      />
                      <Label htmlFor="new-secret">This is a secret value</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddingVariable(false)}>
                      Cancel
                    </Button>
                    <Button onClick={addVariable} disabled={!newVariable.key || !newVariable.value}>
                      Add Variable
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Environment Tabs */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Variables</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="staging">Staging</TabsTrigger>
          <TabsTrigger value="development">Development</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {variables.length > 0 ? (
            variables.map((variable, index) => (
              <Card key={index}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={variable.key}
                          onChange={(e) => updateVariable(index, 'key', e.target.value)}
                          className="font-mono text-sm"
                          placeholder="VARIABLE_NAME"
                        />
                        <Badge variant={getEnvironmentBadgeColor(variable.environment)}>
                          {variable.environment === 'all' ? 'All' : variable.environment}
                        </Badge>
                        {variable.isSecret && (
                          <Badge variant="secondary">Secret</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type={variable.isSecret && !showSecrets[index] ? 'password' : 'text'}
                          value={variable.value}
                          onChange={(e) => updateVariable(index, 'value', e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSecret(index)}
                        >
                          {showSecrets[index] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(variable.value)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeVariable(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <KeyRound className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No environment variables</h3>
                  <p className="text-muted-foreground mb-4">
                    Add environment variables to configure your project services
                  </p>
                  <Button onClick={() => setIsAddingVariable(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Variable
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {['production', 'staging', 'development'].map((environment) => (
          <TabsContent key={environment} value={environment} className="space-y-4">
            {getVariablesByEnvironment(environment).length > 0 ? (
              getVariablesByEnvironment(environment).map((variable) => {
                const index = variables.findIndex(v => v === variable)
                return (
                  <Card key={index}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-2">
                            <Label className="font-mono text-sm">{variable.key}</Label>
                            {variable.isSecret && <Badge variant="secondary">Secret</Badge>}
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type={variable.isSecret && !showSecrets[index] ? 'password' : 'text'}
                              value={variable.value}
                              onChange={(e) => updateVariable(index, 'value', e.target.value)}
                              className="flex-1"
                              readOnly={variable.environment !== environment && variable.environment !== 'all'}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSecret(index)}
                            >
                              {showSecrets[index] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(variable.value)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <KeyRound className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No {environment} variables</h3>
                    <p className="text-muted-foreground mb-4">
                      Add environment-specific variables for {environment}
                    </p>
                    <Button onClick={() => setIsAddingVariable(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Variable
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}