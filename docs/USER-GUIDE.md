# User Guide: Universal Deployment Platform

This comprehensive guide will help you effectively use the deployment platform to deploy, manage, and scale your applications.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Creating Your First Project](#creating-your-first-project)
3. [Connecting Git Sources](#connecting-git-sources)
4. [Configuring Services](#configuring-services)
5. [Deploying Applications](#deploying-applications)
6. [Managing Preview Environments](#managing-preview-environments)
7. [Team Collaboration](#team-collaboration)
8. [Monitoring and Logs](#monitoring-and-logs)
9. [Environment Variables](#environment-variables)
10. [Custom Domains](#custom-domains)
11. [Scaling and Performance](#scaling-and-performance)
12. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites

Before you begin, ensure you have:
- An account on the deployment platform
- A Git repository (GitHub, GitLab, or generic Git)
- Your application's source code
- Basic understanding of your application's requirements (ports, environment variables, dependencies)

### Initial Setup

1. **Sign Up/Log In**
   - Navigate to the platform URL
   - Sign up with your email or use OAuth (GitHub/GitLab)
   - Verify your email address
   - Complete your profile

2. **Dashboard Overview**

   Upon logging in, you'll see your dashboard with:
   - **Projects**: List of all your projects
   - **Recent Deployments**: Latest deployment activity
   - **Quick Actions**: Deploy, create project, invite team
   - **Resource Usage**: Current usage statistics

---

## Creating Your First Project

### Step-by-Step Project Creation

1. **Navigate to Projects**
   - Click **"New Project"** button on the dashboard

2. **Project Details**
   ```
   Project Name:        my-awesome-app
   Base Domain:         my-domain.com
   Description:         My application description
   Default Environment: production
   ```

3. **Configure Project Settings**
   - **Resource Quota**: Select resource allocation tier
     - Small: 0.5 CPU cores, 512 MB RAM
     - Medium: 1 CPU core, 1 GB RAM
     - Large: 2 CPU cores, 2 GB RAM
   
   - **Deployment Settings**:
     - Auto-deploy on push: ✓ (recommended)
     - Enable preview environments: ✓
     - SSL/HTTPS: ✓ (automatic via Let's Encrypt)

4. **Create Project**
   - Click **"Create Project"**
   - You'll be redirected to the project dashboard

### Project Structure

After creation, your project includes:
- **Services**: Container for your application components
- **Deployments**: History of all deployments
- **Settings**: Configuration and management
- **Collaborators**: Team member access control

---

## Connecting Git Sources

The platform supports multiple Git sources for deployments.

### Option 1: GitHub Integration

**Recommended for teams using GitHub**

1. **Install GitHub App**
   - Go to **Project Settings** → **Integrations**
   - Click **"Connect GitHub"**
   - Authorize the GitHub app
   - Select repositories to access

2. **Configure Repository**
   ```
   Repository:          your-org/your-repo
   Branch:              main
   Auto-deploy:         ✓ On push to main
   Preview PRs:         ✓ Create preview for each PR
   ```

3. **Webhook Setup** (Automatic)
   - Platform automatically configures webhook
   - Receives push events and PR events
   - Triggers deployments on code changes

**Features:**
- ✅ Automatic deployments on push
- ✅ PR preview environments
- ✅ Commit status checks
- ✅ PR comments with deployment URLs

---

### Option 2: GitLab Integration

**For teams using GitLab**

1. **Connect GitLab Account**
   - Go to **Project Settings** → **Integrations**
   - Click **"Connect GitLab"**
   - Enter GitLab URL (self-hosted or gitlab.com)
   - Provide personal access token

2. **Select Repository**
   ```
   Project:             your-group/your-project
   Branch:              main
   Trigger:             Push events, Merge requests
   ```

3. **Configure Webhook**
   - Platform generates webhook URL
   - Add to GitLab project settings
   - Test webhook delivery

---

### Option 3: Generic Git Repository

**For any Git hosting service**

1. **Add Git Repository**
   - Go to **Create Service** → **Source**
   - Select **"Git Repository"**
   
2. **Repository Details**
   ```
   Repository URL:      https://git.example.com/repo.git
   Branch:              main
   Authentication:      SSH Key or HTTP credentials
   ```

3. **Authentication Setup**
   
   **Option A: SSH Key (Recommended)**
   - Platform generates SSH key pair
   - Add public key to your Git server
   - Private key stored securely
   
   **Option B: HTTP Credentials**
   ```
   Username:            git-user
   Password/Token:      your-access-token
   ```

---

### Option 4: ZIP Upload

**For quick testing or small projects**

1. **Upload ZIP File**
   - Go to **Create Deployment** → **Source**
   - Select **"Upload ZIP"**
   - Drag and drop or browse for file

2. **File Requirements**
   - Maximum size: 100 MB
   - Must include source code root at top level
   - Build configuration (Dockerfile or package.json)

---

## Configuring Services

Services are the building blocks of your application (web server, API, database, cache, etc.).

### Creating a Service

1. **Navigate to Project**
   - Select your project from dashboard
   - Click **"Add Service"**

2. **Service Configuration**
   ```
   Service Name:        web-frontend
   Service Type:        Web Application
   Port:                3000
   Build Method:        Dockerfile (auto-detect)
   ```

3. **Advanced Settings**
   
   **Build Configuration:**
   ```dockerfile
   # Detected automatically if Dockerfile exists in repo
   # Or specify custom build command:
   Build Command:       npm run build
   Start Command:       npm start
   Working Directory:   ./frontend
   ```
   
   **Runtime Configuration:**
   ```
   Replicas:            2
   CPU Limit:           0.5 cores
   Memory Limit:        512 MB
   Health Check Path:   /health
   Health Check Port:   3000
   ```

4. **Service Dependencies**
   
   Configure dependencies between services:
   ```
   Service: web-frontend
   Depends On:
     - api-backend (waits for API to be healthy)
     - cache-redis (waits for cache to be ready)
   ```
   
   **Deployment Order (automatic):**
   1. cache-redis
   2. api-backend
   3. web-frontend

---

## Deploying Applications

### Manual Deployment

1. **Trigger Deployment**
   - Navigate to your service
   - Click **"Deploy"** button
   - Select source (branch, commit, or tag)

2. **Deployment Options**
   ```
   Source:              Branch: main (latest commit)
   Environment:         production
   Build Arguments:     NODE_ENV=production
   ```

3. **Monitor Progress**
   - Real-time build logs displayed
   - Progress indicator shows current step
   - Estimated time remaining

4. **Deployment Stages**
   ```
   ⏳ Queued          → Waiting in queue
   🔨 Building        → Building Docker image
   📦 Pushing         → Pushing to registry
   🚀 Deploying       → Deploying to Docker Swarm
   🔒 SSL Provisioning → Obtaining SSL certificate
   ✅ Success         → Deployment complete
   ```

---

### Automatic Deployment (Git Push)

**GitHub/GitLab Integration:**

1. **Push to Repository**
   ```bash
   git add .
   git commit -m "Add new feature"
   git push origin main
   ```

2. **Automatic Trigger**
   - Platform receives webhook
   - Validates commit signature
   - Queues deployment job

3. **Real-Time Notifications**
   - Dashboard updates automatically
   - Email notification (optional)
   - Slack/Discord webhook (if configured)

4. **Deployment URL**
   ```
   Production: https://web-frontend.my-domain.com
   ```

---

## Managing Preview Environments

Preview environments allow you to test changes before merging to production.

### Automatic PR Previews (GitHub)

1. **Create Pull Request**
   ```bash
   git checkout -b feature/new-design
   # Make changes
   git push origin feature/new-design
   # Open PR on GitHub
   ```

2. **Automatic Preview Creation**
   - Platform detects PR webhook
   - Creates isolated deployment
   - Generates unique subdomain:
     ```
     https://web-frontend-pr-42.my-domain.com
     ```

3. **PR Comment**
   - Platform posts comment on PR:
     ```
     🚀 Deployment Preview Ready!
     
     ✅ Preview URL: https://web-frontend-pr-42.my-domain.com
     📊 Build time: 2m 34s
     🔍 View logs: [link]
     
     Changes will be reflected automatically on new commits.
     ```

4. **Lifecycle**
   - Preview updated on new commits
   - Preview destroyed when PR is merged/closed
   - Automatic cleanup after 7 days

---

### Manual Preview Creation

1. **Create Preview**
   - Navigate to service
   - Click **"Create Preview"**
   
2. **Preview Configuration**
   ```
   Name:                staging-test
   Source Branch:       feature/redesign
   Subdomain:           staging-test.my-domain.com
   Environment:         staging
   Expiration:          7 days (auto-cleanup)
   ```

3. **Preview Features**
   - Isolated environment
   - Separate database (optional)
   - Custom environment variables
   - SSL certificate (automatic)

---

## Team Collaboration

### Adding Team Members

1. **Navigate to Project Settings**
   - Select project
   - Click **"Collaborators"** tab

2. **Invite Member**
   ```
   Email:               teammate@example.com
   Role:                Developer
   Permissions:         Deploy, View Logs, Create Previews
   ```

3. **Role Types**
   
   **Owner**
   - Full project control
   - Delete project
   - Manage billing
   - Manage all collaborators
   
   **Admin**
   - Deploy applications
   - Manage services
   - Manage environment variables
   - Add/remove developers and viewers
   
   **Developer**
   - Deploy applications
   - Create preview environments
   - View logs and metrics
   - Cannot modify project settings
   
   **Viewer**
   - View deployments
   - View logs
   - Cannot deploy or modify settings

---

### API Keys for CI/CD

**For GitHub Actions, GitLab CI, or other automation:**

1. **Generate API Key**
   - Go to **Project Settings** → **API Keys**
   - Click **"Create API Key"**
   
2. **Key Configuration**
   ```
   Name:                GitHub Actions Deploy
   Scopes:              deploy, view_logs
   Expiration:          90 days
   ```

3. **Use in CI/CD**
   
   **GitHub Actions Example:**
   ```yaml
   name: Deploy
   on:
     push:
       branches: [main]
   
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         
         - name: Deploy to platform
           run: |
             curl -X POST https://api.platform.com/deployments \
               -H "Authorization: Bearer ${{ secrets.DEPLOY_KEY }}" \
               -H "Content-Type: application/json" \
               -d '{
                 "projectId": "project-123",
                 "serviceId": "service-456",
                 "branch": "main"
               }'
   ```

---

## Monitoring and Logs

### Real-Time Deployment Logs

1. **Access Logs**
   - Navigate to deployment
   - Click **"View Logs"** tab

2. **Log Types**
   
   **Build Logs:**
   ```
   [2024-01-15 10:30:00] Cloning repository...
   [2024-01-15 10:30:05] Installing dependencies...
   [2024-01-15 10:31:20] Building application...
   [2024-01-15 10:33:45] Build completed successfully
   ```
   
   **Deployment Logs:**
   ```
   [2024-01-15 10:34:00] Creating Docker image...
   [2024-01-15 10:35:30] Pushing to registry...
   [2024-01-15 10:36:00] Deploying to Docker Swarm...
   [2024-01-15 10:36:45] Service healthy ✓
   ```
   
   **Runtime Logs:**
   ```
   [2024-01-15 10:37:00] Application started on port 3000
   [2024-01-15 10:37:05] Database connected
   [2024-01-15 10:37:10] Ready to accept requests
   ```

3. **Log Filters**
   - Filter by level (info, warning, error)
   - Search by keyword
   - Time range selection
   - Export logs to file

---

### Performance Metrics

1. **Service Metrics Dashboard**
   - Navigate to service
   - Click **"Metrics"** tab

2. **Available Metrics**
   
   **Resource Usage:**
   - CPU usage (%)
   - Memory usage (MB)
   - Network I/O (MB/s)
   - Disk I/O (MB/s)
   
   **Application Metrics:**
   - Request rate (req/s)
   - Response time (ms)
   - Error rate (%)
   - Active connections
   
   **Container Metrics:**
   - Replica count
   - Container restarts
   - Health check status

3. **Alerts (Coming Soon)**
   - CPU usage > 80%
   - Memory usage > 90%
   - Error rate > 5%
   - Service unhealthy

---

## Environment Variables

### Managing Environment Variables

1. **Access Environment Variables**
   - Navigate to service
   - Click **"Environment"** tab

2. **Add Variable**
   ```
   Key:                 DATABASE_URL
   Value:               postgresql://user:pass@db:5432/mydb
   Type:                Secret (encrypted in database)
   Scope:               All environments
   ```

3. **Variable Scopes**
   
   **Global (Project-level):**
   - Available to all services
   - Example: `PROJECT_NAME`, `REGION`
   
   **Service-level:**
   - Specific to one service
   - Example: `API_KEY`, `PORT`
   
   **Environment-specific:**
   - Different values per environment
   - Example: `DATABASE_URL` (production vs staging)
   
   **Preview-specific:**
   - Override for preview environments
   - Example: `API_URL` pointing to preview API

4. **Secret Management**
   - Secrets encrypted at rest
   - Masked in UI and logs
   - Access control per role
   - Audit log of changes

---

### Variable Hierarchy

**Inheritance Order (highest to lowest priority):**

```
1. Preview-specific      (highest priority)
2. Environment-specific
3. Service-level
4. Project-level (Global)  (lowest priority)
```

**Example:**

```
# Global
API_URL=https://api.production.com

# Service: web-frontend
API_URL=https://api.staging.com  (overrides global)

# Preview: pr-42
API_URL=https://api-pr-42.preview.com  (overrides service)

# Final value in preview: https://api-pr-42.preview.com
```

---

## Custom Domains

### Adding a Custom Domain

1. **Navigate to Project Settings**
   - Select project
   - Click **"Domains"** tab

2. **Add Domain**
   ```
   Domain:              app.mycompany.com
   Service:             web-frontend
   Environment:         production
   SSL:                 Automatic (Let's Encrypt)
   ```

3. **DNS Configuration**
   
   **Add DNS Record:**
   ```
   Type:    CNAME
   Name:    app
   Value:   web-frontend.my-domain.com
   TTL:     3600
   ```
   
   **Alternative (A Record):**
   ```
   Type:    A
   Name:    app
   Value:   123.45.67.89 (platform IP)
   TTL:     3600
   ```

4. **SSL Certificate**
   - Platform automatically provisions certificate
   - Let's Encrypt SSL (free)
   - Auto-renewal every 90 days
   - Certificate status visible in dashboard

5. **Verification**
   - Platform verifies DNS propagation
   - SSL certificate issued (< 5 minutes)
   - Domain becomes active
   - Notification sent when ready

---

## Scaling and Performance

### Manual Scaling

1. **Scale Service**
   - Navigate to service
   - Click **"Scale"** button

2. **Scaling Options**
   ```
   Replicas:            3 (current: 1)
   CPU per replica:     0.5 cores
   Memory per replica:  512 MB
   ```

3. **Zero-Downtime Scaling**
   - New replicas created first
   - Traffic distributed via load balancer
   - Old replicas removed after health check
   - No service interruption

---

### Auto-Scaling (Coming Soon)

**Planned Features:**

```yaml
auto_scaling:
  enabled: true
  min_replicas: 1
  max_replicas: 10
  
  metrics:
    - type: cpu
      threshold: 70%
    - type: memory
      threshold: 80%
    - type: requests_per_second
      threshold: 1000
  
  scale_up:
    cooldown: 300s  # 5 minutes
  
  scale_down:
    cooldown: 600s  # 10 minutes
```

---

## Troubleshooting

### Common Issues

#### 1. Deployment Fails During Build

**Symptoms:**
- Build logs show errors
- Deployment status: "failed" at build stage

**Solutions:**

1. **Check Build Logs**
   - Review error messages in build logs
   - Common issues:
     - Missing dependencies
     - Syntax errors
     - Insufficient resources

2. **Verify Dockerfile**
   ```dockerfile
   # Ensure base image is correct
   FROM node:18-alpine
   
   # Install dependencies before copying code
   COPY package*.json ./
   RUN npm ci
   
   # Then copy code
   COPY . .
   RUN npm run build
   ```

3. **Check Resource Limits**
   - Increase memory limit if build is memory-intensive
   - Consider build-time resources

---

#### 2. Service Unhealthy After Deployment

**Symptoms:**
- Deployment completes but service marked unhealthy
- Health check fails repeatedly

**Solutions:**

1. **Verify Health Check Endpoint**
   ```
   Service Settings:
   Health Check Path: /health
   Health Check Port: 3000
   
   Application:
   app.get('/health', (req, res) => {
     res.status(200).json({ status: 'ok' });
   });
   ```

2. **Check Application Logs**
   - View runtime logs for errors
   - Common issues:
     - Application not binding to correct port
     - Database connection failures
     - Missing environment variables

3. **Test Locally**
   ```bash
   docker build -t test-image .
   docker run -p 3000:3000 -e NODE_ENV=production test-image
   curl http://localhost:3000/health
   ```

---

#### 3. Preview Environment Not Created

**Symptoms:**
- PR opened but no preview environment
- No comment on PR with preview URL

**Solutions:**

1. **Verify Webhook Configuration**
   - Go to GitHub repository settings
   - Check webhook delivery status
   - Verify webhook URL is correct

2. **Check Integration Settings**
   - Project Settings → Integrations
   - Ensure "Create preview for PRs" is enabled
   - Verify GitHub App has repository access

3. **Manual Retry**
   - Navigate to PR in dashboard
   - Click **"Retry Preview Creation"**

---

#### 4. Custom Domain SSL Not Working

**Symptoms:**
- Custom domain returns SSL error
- Certificate status: "pending" or "failed"

**Solutions:**

1. **Verify DNS Configuration**
   ```bash
   # Check DNS propagation
   dig app.mycompany.com
   
   # Should return CNAME or A record pointing to platform
   ```

2. **Check Domain Ownership**
   - Platform may require domain verification
   - Add TXT record to verify ownership

3. **Manual Certificate Request**
   - Go to Domains → Custom Domain
   - Click **"Request Certificate"**
   - Monitor status in dashboard

---

#### 5. Deployment Stuck in "Queued" Status

**Symptoms:**
- Deployment doesn't progress
- Stays in "queued" status for > 5 minutes

**Solutions:**

1. **Check Job Queue Status**
   - Dashboard → System Status
   - View current queue length
   - Wait if queue is backed up

2. **Retry Deployment**
   - Click **"Cancel Deployment"**
   - Start new deployment

3. **Contact Support**
   - If issue persists, contact platform support
   - Provide deployment ID and project ID

---

## Getting Help

### Support Channels

1. **Documentation**
   - [Getting Started Guide](./guides/GETTING-STARTED.md)
   - [Architecture Overview](./architecture/ARCHITECTURE.md)
   - [API Reference](./reference/API-REFERENCE.md)

2. **Community**
   - GitHub Discussions
   - Discord Server
   - Stack Overflow (tag: universal-deployment)

3. **Direct Support**
   - Email: support@platform.com
   - In-app chat support (paid plans)

---

## Next Steps

Now that you understand how to use the platform:

1. **Deploy Your First Application**
   - Follow the quick start guide
   - Connect your Git repository
   - Configure your services
   - Deploy!

2. **Explore Advanced Features**
   - Multi-service orchestration
   - Service dependencies
   - Custom build configurations
   - Advanced networking

3. **Optimize Your Workflow**
   - Set up CI/CD integration
   - Configure auto-scaling (when available)
   - Implement monitoring and alerts
   - Establish deployment best practices

4. **Collaborate with Your Team**
   - Invite team members
   - Set up role-based access
   - Configure notifications
   - Establish deployment policies

**Happy Deploying! 🚀**
