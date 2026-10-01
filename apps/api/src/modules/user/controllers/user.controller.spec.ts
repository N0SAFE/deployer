import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserController } from '@/modules/user/controllers/user.controller';
import { UserService } from '@/modules/user/services/user.service';

/**
 * Resolve a built procedure's handler.
 *
 * oRPC v2 keeps it on the `~orpc` descriptor; v1 exposed it as a top-level
 * property. Reading both keeps this assertion about the CONTRACT ("the
 * controller exposes a callable handler") rather than about the internal layout
 * of whichever oRPC version is installed.
 */
function procedureHandler(procedure: unknown): (...args: never[]) => unknown {
    const p = procedure as { handler?: unknown; "~orpc"?: { handler?: unknown } };
    const handler = p?.handler ?? p?.["~orpc"]?.handler;
    if (typeof handler !== "function") {
        throw new TypeError("procedure does not expose a handler");
    }
    return handler as (...args: never[]) => unknown;
}


// Mock user for context
const mockAuthUser = {
  id: 'auth-user-1',
  name: 'Auth User',
  email: 'auth@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2023-01-01T00:00:00.000Z'),
  updatedAt: new Date('2023-01-01T00:00:00.000Z'),
};

// Create a chainable mock for implement().use().handler()
function createImplementMock() {
  type HandlerFn = (opts: { input: unknown; context: { auth: { user: typeof mockAuthUser } } }) => unknown;
  let handlerFn: HandlerFn | null = null;
  
  const chainable = {
    use: vi.fn().mockReturnThis(),
    handler: vi.fn((fn: HandlerFn) => {
      handlerFn = fn;
      return {
        handler: fn,
        // Allow calling the handler with mock context
        __testHandler: (input: unknown) => {
          if (handlerFn) {
            return handlerFn({ input, context: { auth: { user: mockAuthUser } } });
          }
        },
      };
    }),
  };
  
  return chainable;
}

// Mock @orpc/nest
// oRPC v2 split these across packages: the `Implement` DECORATOR stays
// in `@orpc/nest`, lowercase `implement` lives in `@orpc/server`.
vi.mock("@orpc/nest", () => ({
    Implement: vi.fn(() => () => {}),
}));
vi.mock("@orpc/server", async (importOriginal) => ({
    // Spread the REAL module: these specs also import `ORPCError` from
    // here, and replacing the module wholesale would make it undefined.
    ...(await importOriginal<typeof import("@orpc/server")>()),
    implement: vi.fn(() => createImplementMock()),
}));

// Mock requireAuth middleware - do nothing, just pass through
vi.mock('@/core/modules/auth/orpc/middlewares', () => ({
  requireAuth: vi.fn(() => ({})),
}));

describe('UserController', () => {
  let controller: UserController;
  let service: UserService;

  const mockUser = {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    image: null,
    emailVerified: false,
    createdAt: new Date('2023-01-01T00:00:00.000Z') as Date & string,
    updatedAt: new Date('2023-01-01T00:00:00.000Z') as Date & string,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    twoFactorEnabled: false,
  } satisfies Awaited<ReturnType<typeof service.getUsers>>['data'][number]

  beforeEach(async () => {
    const mockUserService = {
      getUsers: vi.fn(),
      findUserById: vi.fn(),
      createUser: vi.fn(),
      updateUser: vi.fn(),
      deleteUser: vi.fn(),
      checkUserExistsByEmail: vi.fn(),
      getUserCount: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useFactory: () => mockUserService,
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('ORPC implementation methods', () => {
    it('should have list method that returns implementation', () => {
      const implementation = controller.list() as any;
      expect(implementation).toBeDefined();
      expect(typeof procedureHandler(implementation)).toBe('function');
    });

    it('should have findById method that returns implementation', () => {
      const implementation = controller.findById() as any;
      expect(implementation).toBeDefined();
      expect(typeof procedureHandler(implementation)).toBe('function');
    });

    it('should have create method that returns implementation', () => {
      const implementation = controller.create() as any;
      expect(implementation).toBeDefined();
      expect(typeof procedureHandler(implementation)).toBe('function');
    });

    it('should have update method that returns implementation', () => {
      const implementation = controller.update() as any;
      expect(implementation).toBeDefined();
      expect(typeof procedureHandler(implementation)).toBe('function');
    });

    it('should have delete method that returns implementation', () => {
      const implementation = controller.delete() as any;
      expect(implementation).toBeDefined();
      expect(typeof procedureHandler(implementation)).toBe('function');
    });

    it('should have checkEmail method that returns implementation', () => {
      const implementation = controller.checkEmail() as any;
      expect(implementation).toBeDefined();
      expect(typeof procedureHandler(implementation)).toBe('function');
    });

    it('should have count method that returns implementation', () => {
      const implementation = controller.count() as any;
      expect(implementation).toBeDefined();
      expect(typeof procedureHandler(implementation)).toBe('function');
    });
  });

  describe('Service integration', () => {
    it('should have service injected properly', () => {
      expect(service).toBeDefined();
      expect(service.getUsers).toBeDefined();
      expect(service.findUserById).toBeDefined();
      expect(service.createUser).toBeDefined();
      expect(service.updateUser).toBeDefined();
      expect(service.deleteUser).toBeDefined();
      expect(service.checkUserExistsByEmail).toBeDefined();
      expect(service.getUserCount).toBeDefined();
    });

    it('should be able to call service methods directly', async () => {
      const mockResponse = {
        data: [mockUser],
        meta: { total: 1, limit: 10, offset: 0, hasMore: false },
      };
      vi.mocked(service.getUsers).mockResolvedValue(mockResponse);

      const result = await service.getUsers({ limit: 10, offset: 0 });
      expect(result).toEqual(mockResponse);
      expect(service.getUsers).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });
  });
});