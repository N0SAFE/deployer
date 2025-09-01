'use client'

import { useState } from 'react'
import { useService } from '@/hooks/useServices'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { 
  Network,
  Globe,
  Lock,
  Shield,
  ExternalLink,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Zap
} from 'lucide-react'

interface ServiceNetworkConfigProps {
  params: {
    id: string
    serviceId: string
  }
}

export default function ServiceNetworkConfigPage({ params }: ServiceNetworkConfigProps) {
  const { data: service } = useService(params.serviceId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [httpsRedirect, setHttpsRedirect] = useState(true)
  const [corsEnabled, setCorsEnabled] = useState(true)
  const [rateLimitEnabled, setRateLimitEnabled] = useState(false)

  // Mock custom domains
  const [customDomains] = useState([
    { domain: 'api.myapp.com', status: 'active', ssl: true },
    { domain: 'app.example.com', status: 'pending', ssl: false },
  ])

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading network configuration...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Public Access */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Public Access
          </CardTitle>
          <CardDescription>
            Configure how your service is accessible from the internet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default Service URL</Label>
            <div className="flex items-center gap-2">
              <Input value="https://service-abc123.onrender.com" readOnly />
              <Button variant="outline" size="sm" asChild>
                <a href="https://service-abc123.onrender.com" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Automatically generated URL for your service
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="port">Service Port</Label>
              <Input 
                id="port" 
                type="number" 
                value={service.port || 3000} 
                onChange={() => setHasUnsavedChanges(true)}
                min="1"
                max="65535"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="protocol">Protocol</Label>
              <Select defaultValue="https">
                <SelectTrigger>
                  <SelectValue placeholder="Select protocol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="https">HTTPS</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="https-redirect">Force HTTPS</Label>
              <p className="text-sm text-muted-foreground">
                Automatically redirect HTTP traffic to HTTPS
              </p>
            </div>
            <Switch 
              id="https-redirect"
              checked={httpsRedirect}
              onCheckedChange={setHttpsRedirect}
            />
          </div>
        </CardContent>
      </Card>

      {/* Custom Domains */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Custom Domains
              </CardTitle>
              <CardDescription>
                Connect your own domains to this service
              </CardDescription>
            </div>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Domain
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {customDomains.length > 0 ? (
            <div className="space-y-3">
              {customDomains.map((domain, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">{domain.domain}</p>
                        {domain.ssl && (
                          <Lock className="h-3 w-3 text-green-600" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={domain.status === 'active' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {domain.status}
                        </Badge>
                        {domain.ssl ? (
                          <Badge variant="outline" className="text-xs text-green-600">
                            SSL Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-yellow-600">
                            SSL Pending
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`https://${domain.domain}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No custom domains</h3>
              <p className="text-muted-foreground mb-4">
                Add your own domain to make your service accessible at a custom URL
              </p>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Domain
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CORS Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            CORS Configuration
          </CardTitle>
          <CardDescription>
            Cross-Origin Resource Sharing settings for web applications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="cors-enabled">Enable CORS</Label>
              <p className="text-sm text-muted-foreground">
                Allow cross-origin requests from web applications
              </p>
            </div>
            <Switch 
              id="cors-enabled"
              checked={corsEnabled}
              onCheckedChange={setCorsEnabled}
            />
          </div>

          {corsEnabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="space-y-2">
                <Label htmlFor="cors-origins">Allowed Origins</Label>
                <Input 
                  id="cors-origins" 
                  value="https://myapp.com, https://www.myapp.com" 
                  onChange={() => setHasUnsavedChanges(true)}
                  placeholder="https://example.com, https://app.example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated list of allowed origins (* for all origins)
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cors-methods">Allowed Methods</Label>
                  <Input 
                    id="cors-methods" 
                    value="GET, POST, PUT, DELETE" 
                    onChange={() => setHasUnsavedChanges(true)}
                    placeholder="GET, POST, PUT, DELETE"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cors-headers">Allowed Headers</Label>
                  <Input 
                    id="cors-headers" 
                    value="Content-Type, Authorization" 
                    onChange={() => setHasUnsavedChanges(true)}
                    placeholder="Content-Type, Authorization"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cors-credentials">
                  <input
                    type="checkbox"
                    id="cors-credentials"
                    className="mr-2"
                    defaultChecked
                  />
                  Allow Credentials
                </Label>
                <p className="text-xs text-muted-foreground">
                  Allow cookies and authorization headers in cross-origin requests
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rate Limiting */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Rate Limiting
          </CardTitle>
          <CardDescription>
            Protect your service from abuse with request rate limiting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="rate-limit">Enable Rate Limiting</Label>
              <p className="text-sm text-muted-foreground">
                Limit the number of requests per time period
              </p>
            </div>
            <Switch 
              id="rate-limit"
              checked={rateLimitEnabled}
              onCheckedChange={setRateLimitEnabled}
            />
          </div>

          {rateLimitEnabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rate-limit-requests">Requests per Window</Label>
                  <Input 
                    id="rate-limit-requests" 
                    type="number" 
                    value="100" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="1"
                    max="10000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rate-limit-window">Window Duration</Label>
                  <Select defaultValue="1m">
                    <SelectTrigger>
                      <SelectValue placeholder="Select window" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1s">1 second</SelectItem>
                      <SelectItem value="1m">1 minute</SelectItem>
                      <SelectItem value="1h">1 hour</SelectItem>
                      <SelectItem value="1d">1 day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rate-limit-burst">Burst Limit</Label>
                <Input 
                  id="rate-limit-burst" 
                  type="number" 
                  value="20" 
                  onChange={() => setHasUnsavedChanges(true)}
                  min="1"
                  max="1000"
                />
                <p className="text-xs text-muted-foreground">
                  Allow brief bursts above the regular limit
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rate-limit-response">Rate Limit Response</Label>
                <Select defaultValue="429">
                  <SelectTrigger>
                    <SelectValue placeholder="Select response" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="429">429 Too Many Requests</SelectItem>
                    <SelectItem value="503">503 Service Unavailable</SelectItem>
                    <SelectItem value="custom">Custom Response</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Network Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Network Security
          </CardTitle>
          <CardDescription>
            Additional security settings for network access
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ip-whitelist">IP Whitelist</Label>
            <Input 
              id="ip-whitelist" 
              placeholder="192.168.1.0/24, 10.0.0.0/8" 
              onChange={() => setHasUnsavedChanges(true)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of allowed IP ranges (leave empty to allow all)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-agent-filter">User Agent Filtering</Label>
            <Input 
              id="user-agent-filter" 
              placeholder="Block specific user agents..." 
              onChange={() => setHasUnsavedChanges(true)}
            />
            <p className="text-xs text-muted-foreground">
              Block requests from specific user agents or bots
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ddos-protection">
                <input
                  type="checkbox"
                  id="ddos-protection"
                  className="mr-2"
                  defaultChecked
                />
                DDoS Protection
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatic protection against distributed denial of service attacks
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="geo-blocking">
                <input
                  type="checkbox"
                  id="geo-blocking"
                  className="mr-2"
                />
                Geo-blocking
              </Label>
              <p className="text-xs text-muted-foreground">
                Block requests from specific countries or regions
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Network Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Network Status
          </CardTitle>
          <CardDescription>
            Current network configuration and connectivity status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">SSL Certificate</span>
                </div>
                <p className="text-xs text-muted-foreground">Active, expires in 89 days</p>
              </div>

              <div className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">HTTPS Redirect</span>
                </div>
                <p className="text-xs text-muted-foreground">Enabled and working</p>
              </div>

              <div className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm font-medium">Rate Limiting</span>
                </div>
                <p className="text-xs text-muted-foreground">Disabled</p>
              </div>

              <div className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">CORS</span>
                </div>
                <p className="text-xs text-muted-foreground">Configured for 2 origins</p>
              </div>
            </div>

            <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-2">
                <Network className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800 mb-2">
                    Network Configuration Tips
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Always use HTTPS in production environments</li>
                    <li>• Configure CORS carefully to prevent security issues</li>
                    <li>• Enable rate limiting to protect against abuse</li>
                    <li>• Monitor SSL certificate expiration dates</li>
                    <li>• Use custom domains for professional branding</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}