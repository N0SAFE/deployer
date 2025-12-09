# Auth Module

> **Status**: ✅ Stable  
> **Type**: Core Infrastructure Module  
> **Last Updated**: 2025-11-30

## Overview

The Auth module provides authentication infrastructure for the deployer platform by integrating **Better Auth** with NestJS. It handles JWT-based authentication, session management, OAuth integrations, and role-based access control.

## Architecture

```
auth/
├── auth.module.ts              # Module definition with Better Auth integration
├── decorators/
│   └── decorators.ts           # @Public(), @Roles(), @CurrentUser()
├── definitions/
│   └── auth-module-definition.ts  # Configurable module options
├── filters/
│   └── auth-exception.filter.ts   # Better Auth exception handling
├── guards/
│   ├── auth.guard.ts           # Global authentication guard
│   └── role.guard.ts           # Role-based authorization guard
├── middlewares/
│   └── middlewares.ts          # Body parsing middleware for auth routes
├── services/
│   └── auth.service.ts         # Better Auth service wrapper
├── types/
│   └── symbols.ts              # Hook symbols for Better Auth
└── utils/
    └── auth.utils.ts           # Authentication utilities
```

## Module Configuration

### Registration

```typescript
// In app.module.ts
import { auth } from '@/auth';
import { AuthModule } from './core/modules/auth/auth.module';

@Module({
  imports: [
    AuthModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        auth,
        disableGlobalAuthGuard: false,
        disableBodyParser: false,
        disableTrustedOriginsCors: false,
      }),
    }),
  ],
})
export class AppModule {}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `auth` | `BetterAuth` | Required | Better Auth instance |
| `disableGlobalAuthGuard` | `boolean` | `false` | Disable automatic guard |
| `disableBodyParser` | `boolean` | `false` | Skip body parsing middleware |
| `disableTrustedOriginsCors` | `boolean` | `false` | Disable CORS from trustedOrigins |

## Services

### AuthService

Generic wrapper around Better Auth providing type-safe access:

```typescript
@Injectable()
export class AuthService<TAuth extends BetterAuth = BetterAuth> {
  constructor(@Inject(MODULE_OPTIONS_TOKEN) options: AuthModuleOptions) {
    this.auth = options.auth as TAuth;
  }

  get auth(): TAuth {
    return this._auth;
  }
}
```

**Usage**:
```typescript
import { AuthService } from '@/core/modules/auth/services/auth.service';
import type { Auth } from '@/auth';

@Injectable()
export class MyService {
  constructor(private readonly authService: AuthService<Auth>) {}

  async getCurrentUser(headers: Headers): Promise<User> {
    const session = await this.authService.auth.api.getSession({ headers });
    return session?.user;
  }
}
```

## Guards

### AuthGuard (Global)

Applied globally when `disableGlobalAuthGuard: false`. Validates JWT tokens on every request.

```typescript
// Routes are protected by default
@Controller('projects')
export class ProjectController {
  @Get()  // Protected - requires valid JWT
  findAll() {}
  
  @Public()  // Opt-out - no authentication required
  @Get('public')
  getPublicData() {}
}
```

### RoleGuard

Optional guard for role-based access control:

```typescript
@Controller('admin')
@Roles('admin', 'super-admin')  // Apply to all routes
export class AdminController {
  @Get('users')  // Requires 'admin' or 'super-admin' role
  getUsers() {}
  
  @Roles('super-admin')  // Override: requires 'super-admin' only
  @Delete(':id')
  deleteUser() {}
}
```

## Decorators

### @Public()

Marks a route as public (no authentication required):

```typescript
@Public()
@Get('health')
healthCheck() {
  return { status: 'ok' };
}
```

### @Roles(...roles)

Specifies required roles for a route:

```typescript
@Roles('admin')
@Delete(':id')
delete(@Param('id') id: string) {}
```

### @CurrentUser()

Extracts the authenticated user from the request:

```typescript
@Get('profile')
getProfile(@CurrentUser() user: User) {
  return user;
}
```

## Hooks System

The module supports Better Auth hooks via decorators:

```typescript
import { Hook, BeforeHook, AfterHook } from '@/core/modules/auth/decorators';

@Hook()
@Injectable()
export class AuthHooksService {
  @BeforeHook('/sign-in/email')
  async beforeSignIn(ctx: MiddlewareContext) {
    console.log('Sign-in attempt:', ctx.body);
  }

  @AfterHook('/sign-in/email')
  async afterSignIn(ctx: MiddlewareContext) {
    console.log('Sign-in successful:', ctx.returned);
  }
}
```

## Exception Handling

The `AuthExceptionFilter` catches Better Auth errors and converts them to proper HTTP responses:

```typescript
// Automatically applied to all auth routes
// Converts BetterAuth errors → NestJS HTTP exceptions
```

## Middleware

### SkipBodyParsingMiddleware

Ensures auth routes receive raw request body for Better Auth processing:

```typescript
// Applied automatically for /api/auth/* routes
// Prevents NestJS from parsing JSON body before Better Auth
```

## API Routes

Better Auth registers these routes automatically at `/api/auth/*`:

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/sign-in/email` | POST | Email/password sign in |
| `/api/auth/sign-up/email` | POST | Email/password registration |
| `/api/auth/sign-out` | POST | Sign out (invalidate session) |
| `/api/auth/session` | GET | Get current session |
| `/api/auth/oauth/:provider` | GET | OAuth initiation |
| `/api/auth/callback/:provider` | GET | OAuth callback |

## Testing

```typescript
import { Test } from '@nestjs/testing';
import { AuthModule } from '@/core/modules/auth/auth.module';
import { mockAuth } from '@/test/mocks/auth.mock';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        AuthModule.forRoot({
          auth: mockAuth,
          disableGlobalAuthGuard: true,
        }),
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should provide auth instance', () => {
    expect(service.auth).toBeDefined();
  });
});
```

## Integration Points

| Module | Relationship |
|--------|-------------|
| `better-auth` | External - Authentication library |
| All Feature Modules | Consumer - Uses guards and decorators |
| `ConstantsModule` | Optional - Config for auth settings |

## Related Documentation

- [Better Auth Documentation](https://better-auth.com/docs)
- [NestJS Guards](https://docs.nestjs.com/guards)
- [Project AGENTS.md](../../../../AGENTS.md)
