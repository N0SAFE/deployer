# Frontend Specification - Deployer Application

> Comprehensive specification for the Next.js frontend dashboard using shadcn UI components and awesome-shadcn-ui extensions for a modern deployment platform interface.

## Overview

The deployer application frontend is a Next.js 15.4 application that provides a comprehensive dashboard for managing deployment projects, services, and monitoring deployments. It leverages shadcn UI components extensively and integrates with awesome-shadcn-ui for enhanced functionality.

## Architecture & Tech Stack

### Core Technologies
- **Next.js 15.4** - React framework with App Router
- **React 19** - Latest React features and concurrent rendering
- **TypeScript** - Full type safety
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Core component library
- **awesome-shadcn-ui** - Extended component collection
- **ORPC Client** - Type-safe API communication
- **Zustand** - State management
- **React Query** - Data fetching and caching

### UI Component Strategy
- **Primary**: Use existing shadcn UI components from `packages/ui/components/shadcn/`
- **Extensions**: Integrate awesome-shadcn-ui components for specialized features:
  - Advanced data tables
  - Enhanced forms and inputs
  - Complex navigation components
  - Data visualization components
  - File upload components
  - Code editors and syntax highlighting

## Application Structure

### Main Navigation (Sidebar)

Using **shadcn UI Sidebar** component as the primary navigation:

```
┌─────────────────┐
│ 🚀 Deployer     │
├─────────────────┤
│ 📊 Dashboard    │
│ 📁 Projects     │
│ ⚡ Deployments  │
│ 🌐 Traefik      │
│ ⚙️ Settings     │
│ 👤 User         │
└─────────────────┘
```

### Page Structure Hierarchy

```
app/
├── (dashboard)/
│   ├── page.tsx                    # Dashboard overview
│   ├── projects/
│   │   ├── page.tsx               # Projects list
│   │   ├── new/page.tsx           # Create project
│   │   └── [projectId]/
│   │       ├── page.tsx           # Project overview
│   │       ├── settings/page.tsx  # Project settings
│   │       └── services/
│   │           ├── page.tsx       # Services list
│   │           ├── new/page.tsx   # Create service
│   │           └── [serviceId]/
│   │               ├── page.tsx           # Service overview
│   │               ├── deployments/
│   │               │   ├── page.tsx      # Deployment history
│   │               │   └── [deploymentId]/page.tsx
│   │               ├── logs/page.tsx     # Service logs
│   │               ├── preview/page.tsx  # Preview deployments
│   │               └── settings/page.tsx # Service settings
│   ├── deployments/
│   │   ├── page.tsx               # Global deployments view
│   │   └── [deploymentId]/page.tsx
│   ├── traefik/
│   │   ├── page.tsx               # Traefik dashboard
│   │   ├── instances/page.tsx     # Traefik instances
│   │   └── routes/page.tsx        # Route management
│   ├── settings/
│   │   ├── page.tsx               # General settings
│   │   ├── user/page.tsx          # User preferences
│   │   └── global/page.tsx        # Global app settings
│   └── layout.tsx                 # Dashboard layout with sidebar
└── layout.tsx                     # Root layout
```

## Detailed Feature Specifications

### 1. Dashboard Overview (`/dashboard`)

**Components to use:**
- `Card` - Metrics cards for deployment stats
- `Chart` components from awesome-shadcn-ui - Deployment trends
- `Badge` - Status indicators
- `Progress` - Deployment progress indicators
- `Alert` - System notifications

**Features:**
- **Deployment Metrics**: Active deployments, success rate, failed deployments
- **Recent Activity Feed**: Latest deployments with status updates
- **Quick Actions**: Deploy buttons for recent services
- **System Health**: Traefik status, queue health, database status
- **Resource Usage**: Memory, CPU, storage usage charts

### 2. Projects Management (`/projects`)

#### Projects List Page
**Components:**
- `DataTable` from awesome-shadcn-ui - Projects table with sorting/filtering
- `Button` - Create project, actions
- `Dialog` - Delete confirmation
- `DropdownMenu` - Project actions
- `Badge` - Project status, service count

**Features:**
- **Projects Table**: Name, description, services count, last deployment, status
- **Search & Filter**: By name, status, creation date
- **Bulk Actions**: Archive, delete multiple projects
- **Project Stats**: Deployment frequency, success rate per project

#### Project Detail Page (`/projects/[projectId]`)
**Components:**
- `Tabs` - Services, Deployments, Settings navigation
- `Card` - Project info, recent deployments
- `Chart` components - Deployment history visualization
- `Button` - Quick deploy, settings access

**Features:**
- **Project Overview**: Description, statistics, recent activity
- **Services Grid**: Visual cards for each service with status
- **Deployment Timeline**: Recent deployments with statuses
- **Project Health**: Overall project status and alerts

#### Project Settings (`/projects/[projectId]/settings`)
**Components:**
- `Form` components - Project configuration
- `Switch` - Feature toggles
- `Select` - Environment configurations
- `Separator` - Section divisions
- `AlertDialog` - Destructive actions

**Features:**
- **General Settings**: Name, description, default branch
- **Environment Variables**: Global project environment configuration
- **Collaborators**: User access management with role-based permissions
- **Integrations**: Git providers, notification webhooks
- **Danger Zone**: Archive/delete project with confirmations

### 3. Services Management (`/projects/[projectId]/services`)

#### Services List
**Components:**
- `Card` - Service cards with deployment status
- `Badge` - Service status, environment indicators
- `Button` - Deploy, settings, logs access
- `DropdownMenu` - Service actions menu

**Features:**
- **Service Cards Grid**: Visual representation with quick actions
- **Service Status**: Running, stopped, deploying, error states
- **Quick Deploy**: One-click deployment for each environment
- **Resource Usage**: CPU, memory indicators per service

#### Service Detail (`/projects/[projectId]/services/[serviceId]`)
**Components:**
- `Tabs` - Navigation between deployments, logs, preview, settings
- `Badge` - Status indicators
- `Button` - Deployment actions
- `Card` - Service information

**Tabs Structure:**
1. **Overview**: Service stats, current deployment info
2. **Deployments**: Deployment history and management
3. **Logs**: Real-time and historical logs
4. **Preview**: Preview deployment management
5. **Settings**: Service configuration

#### Service Deployments Tab
**Components:**
- `DataTable` from awesome-shadcn-ui - Deployment history
- `Badge` - Deployment status (success, failed, running, cancelled)
- `Progress` - Deployment progress indicators
- `Button` - Rollback, redeploy, cancel actions
- `Dialog` - Deployment details modal

**Features:**
- **Deployment History**: Chronological list with status, duration, commit info
- **Deployment Details**: Logs, configuration, resources used
- **Actions**: Rollback to previous deployment, cancel running deployment
- **Comparison**: Compare configurations between deployments

#### Service Logs Tab
**Components:**
- `ScrollArea` - Log viewer with virtual scrolling
- `Select` - Log level filtering
- `Input` - Search within logs
- `Button` - Download logs, clear, refresh
- Code syntax highlighting from awesome-shadcn-ui

**Features:**
- **Real-time Logs**: WebSocket connection for live log streaming
- **Log Filtering**: By level (error, warn, info, debug), time range, search terms
- **Download**: Export logs for external analysis
- **Auto-scroll**: Toggle auto-scroll for live logs

#### Service Preview Tab
**Components:**
- `Card` - Preview deployment cards
- `Badge` - Preview status indicators
- `Button` - Create, delete, promote preview
- `Dialog` - Preview deployment configuration

**Features:**
- **Preview Deployments**: Create temporary deployments for testing
- **Branch Deployments**: Deploy specific branches/commits for review
- **URL Generation**: Automatic preview URL creation
- **Promotion**: Promote preview to production

#### Service Settings Tab
**Components:**
- `Form` components - Service configuration
- `Tabs` - General, Build, Environment, Advanced settings
- `Switch` - Feature toggles
- `Slider` - Resource allocations
- `Select` - Deployment strategies

**Features:**
- **Build Configuration**: Dockerfile path, build args, context
- **Environment Variables**: Service-specific environment configuration
- **Resource Limits**: CPU, memory, storage allocations
- **Health Checks**: Configure health check endpoints and intervals
- **Deployment Strategy**: Rolling, blue-green, canary deployments

### 4. Global Deployments View (`/deployments`)

**Components:**
- `DataTable` from awesome-shadcn-ui - All deployments across projects
- `Select` - Filter by project, service, status
- `DatePicker` from awesome-shadcn-ui - Date range filtering
- `Badge` - Status and environment indicators
- `Button` - Deployment actions

**Features:**
- **Global Overview**: All deployments across all projects and services
- **Advanced Filtering**: By project, service, environment, status, date range
- **Bulk Actions**: Cancel multiple deployments, bulk rollback
- **Export**: Export deployment data for reporting

### 5. Traefik Management (`/traefik`)

#### Traefik Dashboard
**Components:**
- `Card` - Traefik instance metrics
- `Chart` components - Traffic and performance metrics
- `Table` - Route listing
- `Badge` - Health status indicators

**Features:**
- **Instance Overview**: Running Traefik instances and their health
- **Route Management**: View and manage all routes
- **SSL Certificates**: Certificate status and renewal management
- **Traffic Metrics**: Request rates, response times, error rates

#### Traefik Routes
**Components:**
- `DataTable` - Routes with detailed information
- `Badge` - Route status, SSL status
- `Button` - Enable/disable routes
- `Dialog` - Route configuration details

**Features:**
- **Route Listing**: All routes with hosts, paths, services
- **Route Configuration**: Edit routing rules and middleware
- **SSL Management**: Certificate assignment and Let's Encrypt integration
- **Health Monitoring**: Route health checks and status

### 6. Settings Pages

#### Global Settings (`/settings`)
**Components:**
- `Tabs` - Settings categories
- `Card` - Setting sections
- `Form` components - Configuration forms
- `Switch` - Feature toggles

**Tabs:**
- **General**: Application name, theme, default configurations
- **Security**: Authentication settings, API keys, webhook secrets
- **Notifications**: Email, Slack, webhook notification configurations
- **Storage**: Database settings, backup configuration
- **Advanced**: Debug settings, experimental features

#### User Settings (`/settings/user`)
**Components:**
- `Form` components - User profile
- `Switch` - Notification preferences
- `Select` - Theme, timezone preferences
- `Button` - Save, reset, logout actions

**Features:**
- **Profile Management**: Name, email, avatar, timezone
- **Notification Preferences**: Email notifications, dashboard alerts
- **Security**: Password change, API key management
- **Preferences**: Theme, language, default project settings

## Component Integration Strategy

### shadcn UI Base Components
Already available in `packages/ui/components/shadcn/`:
- ✅ `Button`, `Card`, `Dialog`, `Form`, `Input`, `Label`
- ✅ `Select`, `Switch`, `Tabs`, `Table`, `Badge`
- ✅ `Progress`, `ScrollArea`, `Separator`, `Sidebar`
- ✅ `Alert`, `DropdownMenu`, `Sheet`, `Skeleton`
- ✅ `Slider`, `Tooltip`

### awesome-shadcn-ui Extensions to Add
Required components from [awesome-shadcn-ui](https://github.com/birobirobiro/awesome-shadcn-ui):

1. **Data Display**
   - Advanced DataTable with sorting, filtering, pagination
   - Charts and visualization components
   - Code syntax highlighter
   - File upload components

2. **Navigation & Layout**
   - Enhanced sidebar components
   - Breadcrumb navigation
   - Multi-step forms

3. **Input & Forms**
   - Date/time pickers
   - Rich text editors
   - File upload dropzones
   - Multi-select components

4. **Feedback & Status**
   - Toast notifications
   - Loading skeletons
   - Status indicators
   - Progress tracking components

## State Management

### Zustand Stores Structure
```typescript
// stores/
├── projectStore.ts     # Projects state and actions
├── serviceStore.ts     # Services state and actions
├── deploymentStore.ts  # Deployments state and real-time updates
├── traefikStore.ts     # Traefik routes and instances
├── settingsStore.ts    # User and app settings
├── uiStore.ts          # UI state (sidebar, modals, notifications)
└── websocketStore.ts   # WebSocket connection and event handling
```

### Real-time Updates
- **WebSocket Integration**: Connect to NestJS WebSocket gateway
- **Deployment Status**: Real-time deployment progress updates
- **Log Streaming**: Live log streaming for services
- **Notifications**: Real-time alerts and status changes

## API Integration

### ORPC Client Usage
```typescript
// All API calls use type-safe ORPC contracts
import { api } from '@/lib/api';

// Projects
const { data: projects } = api.projects.list.useQuery();
const createProject = api.projects.create.useMutation();

// Services
const { data: services } = api.services.list.useQuery({ projectId });
const deployService = api.deployments.trigger.useMutation();

// Real-time subscriptions
const { data: deploymentStatus } = api.deployments.subscribe.useSubscription({
  deploymentId
});
```

## Responsive Design

### Breakpoint Strategy
- **Mobile (sm)**: Collapsible sidebar, stacked layouts
- **Tablet (md)**: Condensed sidebar, grid layouts
- **Desktop (lg+)**: Full sidebar, multi-column layouts

### Mobile-First Components
- **Sidebar**: Converts to drawer/sheet on mobile
- **Tables**: Horizontal scroll on mobile, card view option
- **Forms**: Single column on mobile, multi-column on desktop
- **Navigation**: Bottom tab bar for mobile primary actions

## Performance Optimization

### Code Splitting
- Route-based code splitting using Next.js App Router
- Component-level lazy loading for heavy components
- Dynamic imports for awesome-shadcn-ui components

### Data Fetching
- React Query for caching and background updates
- Optimistic updates for user actions
- Prefetching for predictable navigation patterns

### Bundle Optimization
- Tree shaking for unused shadcn components
- Dynamic imports for feature-specific components
- Optimized image loading and lazy loading

## Accessibility

### shadcn UI Accessibility
- All shadcn components come with built-in accessibility
- ARIA labels and roles properly configured
- Keyboard navigation support
- Screen reader compatibility

### Custom Accessibility
- Focus management for modals and drawers
- High contrast mode support
- Keyboard shortcuts for common actions
- Alt text for all images and icons

## Development Workflow

### Component Development
1. **Design System**: Follow shadcn UI patterns and Tailwind conventions
2. **Testing**: Component testing with React Testing Library
3. **Documentation**: Storybook for component documentation
4. **Type Safety**: Full TypeScript coverage with ORPC integration

### Integration Testing
- **API Integration**: Test ORPC client integration
- **WebSocket**: Test real-time updates and reconnection
- **State Management**: Test store state synchronization
- **Navigation**: Test route transitions and data loading

## Security Considerations

### Authentication Integration
- Better Auth integration for session management
- Role-based access control for project collaborators
- API key management for external integrations

### Data Protection
- Input sanitization and validation
- XSS protection through React's built-in safeguards
- CSRF protection for state-changing operations
- Secure handling of sensitive configuration data

## Deployment Integration

### Environment Configuration
- **Development**: Local API connection, hot reloading
- **Staging**: Staging API integration, feature flags
- **Production**: Optimized builds, CDN integration, monitoring

### Performance Monitoring
- Core Web Vitals tracking
- Error boundary implementation
- Performance metrics collection
- User interaction analytics

This comprehensive specification provides the foundation for building a modern, user-friendly deployment platform frontend that leverages the full power of shadcn UI and its ecosystem while providing a seamless experience for managing deployments, services, and projects.