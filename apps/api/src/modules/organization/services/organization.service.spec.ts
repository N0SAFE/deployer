import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationService } from './organization.service';

describe('OrganizationService', () => {
    let service: OrganizationService;
     
    let mockRepository: any;

    const now = new Date('2024-01-01T00:00:00.000Z');

    const mockOrg = {
        id: 'org-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        logo: null,
        metadata: null,
        createdAt: now,
    };

    const mockMember = {
        id: 'mem-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'admin',
        createdAt: now,
        user: { id: 'user-1', name: 'Alice', email: 'alice@example.com', image: null },
    };

    beforeEach(async () => {
        mockRepository = {
            listAll: vi.fn(),
            listMembers: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: OrganizationService,
                    useFactory: () => new OrganizationService(mockRepository),
                },
            ],
        }).compile();

        service = module.get<OrganizationService>(OrganizationService);
        vi.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('listAll', () => {
        it('should delegate to repository listAll', async () => {
            const input = { limit: 10, offset: 0 };
            const mockResponse = { data: [mockOrg], meta: { total: 1, limit: 10, offset: 0, hasMore: false } };
            mockRepository.listAll.mockResolvedValue(mockResponse);

            const result = await service.listAll(input as Parameters<typeof service.listAll>[0]);

            expect(result).toEqual(mockResponse);
            expect(mockRepository.listAll).toHaveBeenCalledWith(input);
        });

        it('should return empty list when no organizations', async () => {
            const input = { limit: 10, offset: 0 };
            const mockResponse = { data: [], meta: { total: 0, limit: 10, offset: 0, hasMore: false } };
            mockRepository.listAll.mockResolvedValue(mockResponse);

            const result = await service.listAll(input as Parameters<typeof service.listAll>[0]);

            expect(result.data).toHaveLength(0);
        });
    });

    describe('listMembers', () => {
        it('should delegate to repository listMembers', async () => {
            const input = { limit: 20, offset: 0 };
            const mockResponse = { data: [mockMember], meta: { total: 1, limit: 20, offset: 0, hasMore: false } };
            mockRepository.listMembers.mockResolvedValue(mockResponse);

            const result = await service.listMembers(input as Parameters<typeof service.listMembers>[0]);

            expect(result).toEqual(mockResponse);
            expect(mockRepository.listMembers).toHaveBeenCalledWith(input);
        });

        it('should return empty list when no members', async () => {
            const input = { limit: 20, offset: 0 };
            const mockResponse = { data: [], meta: { total: 0, limit: 20, offset: 0, hasMore: false } };
            mockRepository.listMembers.mockResolvedValue(mockResponse);

            const result = await service.listMembers(input as Parameters<typeof service.listMembers>[0]);

            expect(result.data).toHaveLength(0);
        });
    });
});
