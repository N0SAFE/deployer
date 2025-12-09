import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserController } from '@/modules/user/controllers/user.controller';
import { UserService } from '@/modules/user/services/user.service';
import { UserAdapter } from '@/modules/user/adapters/user-adapter.service';

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
vi.mock('@orpc/nest', () => ({
  implement: vi.fn(() => createImplementMock()),
  Implement: vi.fn(() => () => {}),
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
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        updatedAt: new Date('2023-01-01T00:00:00.000Z'),
        role: null,
        banned: null,
        banReason: null,
        banExpires: null,
    };
    
    beforeEach(async () => {
        const mockUserService = {
            findMany: vi.fn(),
            findById: vi.fn(),
            findByEmail: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            checkEmailExists: vi.fn(),
            getCount: vi.fn(),
        };
        
        const mockUserAdapter = {
            adaptUserListToContract: vi.fn(),
            adaptUserToContract: vi.fn(),
            adaptUserCreateToContract: vi.fn(),
            adaptUserUpdateToContract: vi.fn(),
            adaptUserDeleteToContract: vi.fn(),
            adaptUserCheckEmailToContract: vi.fn(),
            adaptUserCountToContract: vi.fn(),
        };
        
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UserController],
            providers: [
                {
                    provide: UserService,
                    useFactory: () => mockUserService,
                },
                {
                    provide: UserAdapter,
                    useFactory: () => mockUserAdapter,
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
            const implementation = controller.list();
            expect(implementation).toBeDefined();
        });
        
        it('should have findById method that returns implementation', () => {
            const implementation = controller.findById();
            expect(implementation).toBeDefined();
        });
        
        it('should have create method that returns implementation', () => {
            const implementation = controller.create();
            expect(implementation).toBeDefined();
        });
        
        it('should have update method that returns implementation', () => {
            const implementation = controller.update();
            expect(implementation).toBeDefined();
        });
        
        it('should have delete method that returns implementation', () => {
            const implementation = controller.delete();
            expect(implementation).toBeDefined();
        });
        
        it('should have checkEmail method that returns implementation', () => {
            const implementation = controller.checkEmail();
            expect(implementation).toBeDefined();
        });
        
        it('should have count method that returns implementation', () => {
            const implementation = controller.count();
            expect(implementation).toBeDefined();
        });
    });
    
    describe('Service integration', () => {
        it('should have service injected properly', () => {
            expect(service).toBeDefined();
            expect(service.findMany).toBeDefined();
            expect(service.findById).toBeDefined();
            expect(service.create).toBeDefined();
            expect(service.update).toBeDefined();
            expect(service.delete).toBeDefined();
            expect(service.checkEmailExists).toBeDefined();
            expect(service.getCount).toBeDefined();
        });
        
        it('should be able to call service methods directly', async () => {
            const mockResponse = {
                users: [mockUser],
                meta: { pagination: { total: 1, limit: 10, offset: 0, hasMore: false } },
            };
            vi.mocked(service.findMany).mockResolvedValue(mockResponse);
            const result = await service.findMany({ 
                pagination: { limit: 10, offset: 0 },
                sort: { field: 'name', direction: 'asc' },
            });
            expect(result).toEqual(mockResponse);
            expect(service.findMany).toHaveBeenCalledWith({ 
                pagination: { limit: 10, offset: 0 },
                sort: { field: 'name', direction: 'asc' },
            });
        });
    });
});
