# NestJS API - Deployment Platform

This is the NestJS API backend for the Universal Deployment Platform, featuring ORPC for type-safe APIs, Better Auth for authentication, Bull Queue for job processing, and Drizzle ORM for database operations.

## 🐳 Docker-First Development

This API is designed to run within Docker containers for development and production. **Always use Docker commands** rather than running commands directly on your host machine.

## 📊 Database Operations

### ⚠️ **IMPORTANT: Database Context**

**NEVER run database commands outside of Docker context!** The database connection is only available within the Docker environment.

❌ **Don't do this:**
```bash
# This will FAIL - database not accessible from host
bun run db:seed
bun run db:push
bun run db:studio
```

✅ **Do this instead:**
```bash
# Run seeding within Docker (database accessible)
docker exec -it deployer-api-dev bun run db:seed

# Or run full development environment
bun run dev  # Starts API with database access
```

### Database Commands

```bash
# Generate database migrations
docker exec -it deployer-api-dev bun run db:generate

# Push schema changes to database
docker exec -it deployer-api-dev bun run db:push  

# Seed database with test data
docker exec -it deployer-api-dev bun run db:seed

# Open Drizzle Studio (database admin UI)
docker exec -it deployer-api-dev bun run db:studio

# Reset database (⚠️ destructive)
docker exec -it deployer-api-dev bun run db:reset
```

## 🚀 Development

### Starting Development Environment

```bash
# Start full stack (API + Database + Web)
bun run dev

# Start only API services
bun run dev:api

# View API logs
bun run dev:api:logs
```

### API Endpoints

The API runs on port `3005` within Docker containers and provides:

- **Health Check**: `GET /health`
- **User Management**: `/user/*` (ORPC routes)
- **Authentication**: `/api/auth/*` (Better Auth)
- **Deployment Operations**: `/deployment/*` (ORPC routes)
  - `GET /status/:deploymentId` - Get deployment status
  - `POST /trigger` - Trigger new deployment
  - `POST /cancel` - Cancel deployment
  - `POST /rollback` - Rollback deployment  
  - `GET /logs` - Get deployment logs
  - `GET /list` - List deployments

### WebSocket Events

Real-time deployment updates via WebSocket:
- Subscribe to project updates
- Subscribe to deployment status changes
- Subscribe to service events
- Real-time log streaming

## 🧪 Testing

```bash
# Run API tests within Docker
docker exec -it deployer-api-dev bun test

# Run tests with coverage
docker exec -it deployer-api-dev bun run test:coverage
```

## 🔧 Architecture

### Core Technologies
- **NestJS 10.x**: Scalable Node.js framework
- **ORPC**: Type-safe RPC with automatic TypeScript inference
- **Better Auth**: Modern authentication with session management
- **Drizzle ORM**: Type-safe database operations with PostgreSQL
- **Bull Queue + Redis**: Background job processing
- **WebSocket Gateway**: Real-time updates

### Project Structure
```
src/
├── auth/              # Better Auth configuration
├── db/                # Database module and schemas
│   ├── drizzle/       
│   │   ├── migrations/    # Database migrations
│   │   ├── schema/        # Database schema definitions
│   │   └── seed.ts        # Test data seeding
├── health/            # Health check endpoints
├── jobs/              # Bull Queue job processors
├── user/              # User management (ORPC)
├── websocket/         # WebSocket gateway and controllers
│   ├── controllers/       # ORPC HTTP controllers
│   ├── gateways/          # WebSocket gateways
│   └── services/          # WebSocket event services
└── main.ts            # Application bootstrap
```

### Database Schema

The deployment platform uses these main tables:
- `projects` - Deployment projects
- `services` - Individual services within projects
- `deployments` - Deployment instances
- `deployment_logs` - Structured deployment logs
- `preview_environments` - Temporary preview deployments
- `service_dependencies` - Service dependency relationships
- `project_collaborators` - Team access management

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Ensure you're running commands within Docker context
   - Check that PostgreSQL container is running: `docker ps`

2. **TypeScript Compilation Errors** 
   - Check that all ORPC contracts have proper `method` and `path` definitions
   - Ensure database schema matches API contract types

3. **WebSocket Connection Issues**
   - Verify WebSocket gateway is properly initialized in logs
   - Check that all event subscriptions are working

### Logs and Debugging

```bash
# View real-time API logs
docker logs -f deployer-api-dev

# Access API container shell
docker exec -it deployer-api-dev sh

# Check API health
curl http://localhost:3001/health
```

## 🚀 Production Deployment

For production deployment, see the main project documentation in `docs/PRODUCTION-DEPLOYMENT.md`.

The API can be deployed separately from the web application for better scalability.