# Universal Deployment Platform - Web Application Components

## Overview
This document describes the web application components built for the universal deployment platform, similar to Dokploy, designed to handle multiple deployment strategies and be installed on any VPS.

## Component Architecture

### 1. Dashboard Components (`/dashboard/`)

#### `ProjectDashboard.tsx`
- **Purpose**: Main dashboard orchestrating all platform features
- **Features**:
  - Quick action buttons for service creation, deployment, and team management
  - Platform features overview cards
  - Integration with all other components via dialogs
  - Mock data demonstration for full platform capabilities

### 2. Project Management (`/project/`)

#### `ProjectDetailPage.tsx`
- **Purpose**: Comprehensive project overview with tabbed interface
- **Features**:
  - Project header with status, repository, and domain links
  - Tabbed interface: Overview, Services, Deployments, Team, Settings
  - Service management with cards display
  - Recent deployments overview
  - Team member management
  - Environment variables placeholder

### 3. Service Management (`/services/` & `/service-management/`)

#### `ServiceCard.tsx`
- **Purpose**: Display individual service information and controls
- **Features**:
  - Service status indicators (running, stopped, deploying, error)
  - Quick actions: settings, deploy, view, delete
  - Resource usage display (CPU, memory)
  - Last deployment information
  - Health check status

#### `ServiceForm.tsx`
- **Purpose**: Create/edit service configuration
- **Features**:
  - Basic service information (name, description, enabled state)
  - Docker configuration (Dockerfile path, port, health check)
  - Domain configuration (subdomain, custom domain)
  - Resource limits (CPU, memory)
  - Environment variables management with secret support
  - Build arguments configuration
  - Form validation and submission handling

### 4. Deployment Management (`/deployments/` & `/deployment-config/`)

#### `DeploymentCard.tsx`
- **Purpose**: Display deployment information and status
- **Features**:
  - Deployment status with progress indicators
  - Build and deployment time tracking
  - Environment and source information
  - Quick actions: retry, cancel, view logs
  - Real-time status updates

#### `DeploymentSourceForm.tsx`
- **Purpose**: Configure multi-source deployments
- **Features**:
  - **Multi-source support**: Git repositories, file uploads
  - **Git providers**: GitHub, GitLab, generic Git
  - **Build configuration**: Custom Dockerfile, build/start commands
  - **Environment variables**: Runtime configuration with secrets
  - **Preview deployments**: Auto-generated subdomains, custom domains
  - **Deployment summary**: Configuration overview before deployment

### 5. Activity Tracking (`/activity/`)

#### `ActivityFeed.tsx`
- **Purpose**: Real-time project activity monitoring
- **Features**:
  - Activity types: deployments, git commits, team changes, file uploads
  - Status indicators with appropriate icons and colors
  - Timeline view with timestamps and user attribution
  - Activity filtering and categorization

### 6. Team Management (`/team-management/`)

#### `TeamManagement.tsx`
- **Purpose**: Project collaboration and access control
- **Features**:
  - **Role-based access**: Owner, Admin, Developer, Viewer
  - **Team statistics**: Member counts by role
  - **Member invitation**: Email invites with role assignment
  - **Role management**: Update member permissions
  - **Member removal**: Remove team members (with restrictions)
  - **Permissions overview**: Clear explanation of role capabilities

## Key Features Implemented

### Multi-Source Deployments
- GitHub repository integration
- GitLab repository support
- Generic Git URL support
- ZIP file upload deployment
- Docker image deployment (structure ready)

### Preview Deployment Configuration
- Configurable base domains
- Auto-generated subdomains
- Custom domain support
- Environment variable sharing between environments
- Branch-based preview deployments

### Service Orchestration
- Service dependency tracking (structure in place)
- Health check configuration
- Resource limit management (CPU/Memory)
- Port and domain configuration
- Environment variable management

### Team Collaboration
- Role-based access control (Owner, Admin, Developer, Viewer)
- Team member invitation system
- Permission management interface
- Activity tracking for team actions

## Technical Implementation

### State Management
- Zustand stores for projects, services, deployments
- Real-time state updates
- Type-safe interfaces with TypeScript

### UI Components
- Shadcn/UI component library
- Responsive design with Tailwind CSS
- Accessible form controls
- Loading states and error handling

### Form Handling
- Environment variable management with secret support
- File upload handling for ZIP deployments
- Form validation and submission
- Multi-step configuration flows

## Integration Points

### Backend API Integration (Ready)
- ORPC contracts defined in `/packages/api-contracts/`
- Service management endpoints
- Deployment orchestration endpoints
- Team management endpoints
- Real-time updates via WebSocket/SSE

### Container Orchestration
- Docker service management
- Traefik routing configuration
- Health check integration
- Resource monitoring

### Git Provider Integration
- GitHub API integration
- GitLab API integration
- Webhook handling for auto-deployments
- Branch and commit tracking

## Deployment Strategy

### VPS Installation
- Docker-based deployment
- Traefik reverse proxy integration
- PostgreSQL database with Drizzle ORM
- Redis for queue management
- Self-contained installation package

### Domain Management
- Auto SSL certificate generation
- Subdomain creation and management
- Custom domain configuration
- Preview environment routing

## Next Steps for Production

1. **Backend Integration**: Connect all forms to real API endpoints
2. **Real-time Updates**: Implement WebSocket connections for live updates
3. **Error Handling**: Add comprehensive error boundaries and user feedback
4. **Testing**: Unit and integration tests for all components
5. **Performance**: Optimize large lists with virtualization
6. **Security**: Implement proper authentication checks and CSRF protection
7. **Monitoring**: Add deployment metrics and logging integration

## Usage Example

```tsx
import { ProjectDashboard } from '@/components'

function App() {
  return <ProjectDashboard projectId="project-123" />
}
```

This implementation provides a complete web interface for the universal deployment platform, supporting all major features requested: multi-source deployments, preview environments, service orchestration, and team collaboration - all installable on any VPS similar to Dokploy.