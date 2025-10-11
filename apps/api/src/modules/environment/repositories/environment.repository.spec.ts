import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnvironmentRepository } from './environment.repository';
describe('EnvironmentRepository', () => {
    let repository: EnvironmentRepository;
    let mockDb: any;
    let createMockQueryBuilder: (resolveValue?: any[]) => any;
    const mockEnvironment = {
        id: '1',
        name: 'production',
        slug: 'production',
        description: 'Production environment',
        type: 'production',
        status: 'healthy',
        projectId: 'project-1',
        templateId: null,
        domainConfig: null,
        networkConfig: null,
        deploymentConfig: null,
        resourceLimits: null,
        previewSettings: null,
        metadata: null,
        isActive: true,
        createdBy: 'user-1',
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        updatedAt: new Date('2023-01-01T00:00:00.000Z'),
    };
    const mockVariable = {
        id: '1',
        environmentId: '1',
        key: 'DATABASE_URL',
        value: 'postgresql://localhost/db',
        isSecret: false,
        description: 'Database connection URL',
        category: 'database',
        isDynamic: false,
        template: null,
        resolutionStatus: 'resolved',
        resolvedValue: 'postgresql://localhost/db',
        resolutionError: null,
        lastResolved: new Date('2023-01-01T00:00:00.000Z'),
        references: [],
        createdBy: 'user-1',
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        updatedAt: new Date('2023-01-01T00:00:00.000Z'),
    };
    beforeEach(async () => {
        // Create a proper thenable mock for query builders
        createMockQueryBuilder = (resolveValue = [mockEnvironment]) => {
            const builder = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                offset: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                then: vi.fn((resolve) => Promise.resolve(resolve(resolveValue))),
            };
            // Make it awaitable by adding Promise methods
            builder.from.mockReturnValue(builder);
            builder.where.mockReturnValue(builder);
            builder.orderBy.mockReturnValue(builder);
            builder.limit.mockReturnValue(builder);
            builder.offset.mockReturnValue(builder);
            return builder;
        };
        const mockInsertQueryBuilder = {
            values: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([mockEnvironment]),
        };
        const mockUpdateQueryBuilder = {
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([mockEnvironment]),
        };
        const mockDeleteQueryBuilder = {
            where: vi.fn().mockResolvedValue({ rowCount: 1 }),
            returning: vi.fn().mockResolvedValue([mockEnvironment]),
            then: vi.fn((resolve) => Promise.resolve(resolve({ rowCount: 1 }))),
        };
        mockDb = {
            select: vi.fn(() => createMockQueryBuilder()),
            insert: vi.fn(() => mockInsertQueryBuilder),
            update: vi.fn(() => mockUpdateQueryBuilder),
            delete: vi.fn(() => mockDeleteQueryBuilder),
        };
        const mockDatabaseService = {
            db: mockDb,
        };
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: EnvironmentRepository,
                    useFactory: () => new EnvironmentRepository(mockDatabaseService as any),
                },
            ],
        }).compile();
        repository = module.get<EnvironmentRepository>(EnvironmentRepository);
        vi.clearAllMocks();
    });
    it('should be defined', () => {
        expect(repository).toBeDefined();
    });
    describe('listEnvironments', () => {
        it('should find environments with pagination', async () => {
            const input = {
                projectId: 'project-1',
                type: 'production' as const,
                status: 'healthy' as const,
                limit: 10,
                offset: 0,
            };
            const environments = [mockEnvironment];
            const countResult = [{ count: 1 }];
            const mainQueryBuilder = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                offset: vi.fn().mockResolvedValue(environments),
            };
            const countQueryBuilder = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue(countResult),
            };
            mockDb.select
                .mockReturnValueOnce(mainQueryBuilder)
                .mockReturnValueOnce(countQueryBuilder);
            const result = await repository.listEnvironments(input);
            expect(result).toEqual({
                environments: [mockEnvironment],
                total: 1,
            });
            expect(mainQueryBuilder.where).toHaveBeenCalled();
            expect(mainQueryBuilder.limit).toHaveBeenCalledWith(10);
            expect(mainQueryBuilder.offset).toHaveBeenCalledWith(0);
        });
        it('should handle search filtering', async () => {
            const input = {
                search: 'prod',
                limit: 10,
                offset: 0,
            };
            const mainQueryBuilder = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                offset: vi.fn().mockResolvedValue([]),
            };
            const countQueryBuilder = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 0 }]),
            };
            mockDb.select
                .mockReturnValueOnce(mainQueryBuilder)
                .mockReturnValueOnce(countQueryBuilder);
            await repository.listEnvironments(input);
            expect(mainQueryBuilder.where).toHaveBeenCalled();
        });
        it('should handle sorting', async () => {
            const input = {
                sortBy: 'name' as const,
                sortOrder: 'desc' as const,
                limit: 10,
                offset: 0,
            };
            // Mock the select calls for this test
            mockDb.select
                .mockReturnValueOnce(createMockQueryBuilder([]))
                .mockReturnValueOnce(createMockQueryBuilder([{ count: 0 }]));
            await repository.listEnvironments(input);
            expect(mockDb.select).toHaveBeenCalledTimes(2);
        });
    });
    describe('findEnvironmentById', () => {
        it('should find environment by id', async () => {
            // Reset the mock to return specific data for this test
            mockDb.select.mockReturnValueOnce(createMockQueryBuilder([mockEnvironment]));
            const result = await repository.findEnvironmentById('1');
            expect(result).toEqual(mockEnvironment);
            expect(mockDb.select).toHaveBeenCalled();
        });
        it('should return null when environment not found', async () => {
            // Reset the mock to return empty array for this test  
            mockDb.select.mockReturnValueOnce(createMockQueryBuilder([]));
            const result = await repository.findEnvironmentById('nonexistent');
            expect(result).toBeNull();
        });
    });
    describe('createEnvironment', () => {
        it('should create a new environment', async () => {
            const input = {
                name: 'staging',
                slug: 'staging',
                type: 'staging' as const,
                createdBy: 'user-1',
            };
            const mockInsertBuilder = mockDb.insert();
            mockInsertBuilder.returning.mockResolvedValue([mockEnvironment]);
            const result = await repository.createEnvironment(input);
            expect(result).toEqual(mockEnvironment);
            expect(mockDb.insert).toHaveBeenCalled();
            expect(mockInsertBuilder.values).toHaveBeenCalledWith(input);
        });
    });
    describe('updateEnvironment', () => {
        it('should update environment', async () => {
            const input = { name: 'production-v2' };
            const updatedEnvironment = { ...mockEnvironment, name: 'production-v2' };
            const mockUpdateBuilder = mockDb.update();
            mockUpdateBuilder.returning.mockResolvedValue([updatedEnvironment]);
            const result = await repository.updateEnvironment('1', input);
            expect(result).toEqual(updatedEnvironment);
            expect(mockUpdateBuilder.set).toHaveBeenCalledWith(expect.objectContaining({
                ...input,
                updatedAt: expect.any(Date),
            }));
        });
        it('should return null when update fails', async () => {
            const mockUpdateBuilder = mockDb.update();
            mockUpdateBuilder.returning.mockResolvedValue([]);
            const result = await repository.updateEnvironment('nonexistent', { name: 'new-name' });
            expect(result).toBeNull();
        });
    });
    describe('deleteEnvironment', () => {
        it('should delete environment', async () => {
            // deleteEnvironment actually does an update (soft delete), not a delete
            const mockUpdateBuilder = mockDb.update();
            mockUpdateBuilder.returning.mockResolvedValue([mockEnvironment]);
            const result = await repository.deleteEnvironment('1');
            expect(result).toBe(true);
            expect(mockUpdateBuilder.set).toHaveBeenCalled();
            expect(mockUpdateBuilder.where).toHaveBeenCalled();
        });
        it('should return false when delete fails', async () => {
            const mockUpdateBuilder = mockDb.update();
            mockUpdateBuilder.returning.mockResolvedValue([]);
            const result = await repository.deleteEnvironment('nonexistent');
            expect(result).toBe(false);
        });
    });
    describe('Environment Variables', () => {
        describe('findEnvironmentVariables', () => {
            it('should find variables by environment id', async () => {
                // Mock to return variables instead of environments for this test
                mockDb.select.mockReturnValueOnce(createMockQueryBuilder([mockVariable]));
                const result = await repository.findEnvironmentVariables('1');
                expect(result).toEqual([mockVariable]);
                expect(mockDb.select).toHaveBeenCalled();
            });
        });
        describe('createEnvironmentVariable', () => {
            it('should create a variable', async () => {
                const variableData = {
                    environmentId: '1',
                    key: 'API_KEY',
                    value: 'secret',
                    isSecret: true,
                    createdBy: 'user-1',
                };
                const mockInsertBuilder = mockDb.insert();
                mockInsertBuilder.returning.mockResolvedValue([mockVariable]);
                const result = await repository.createEnvironmentVariable(variableData);
                expect(result).toEqual(mockVariable);
                expect(mockInsertBuilder.values).toHaveBeenCalledWith(variableData);
            });
        });
        describe('updateEnvironmentVariable', () => {
            it('should update a variable', async () => {
                const input = { value: 'new-value' };
                const updatedVariable = { ...mockVariable, value: 'new-value' };
                const mockUpdateBuilder = mockDb.update();
                mockUpdateBuilder.returning.mockResolvedValue([updatedVariable]);
                const result = await repository.updateEnvironmentVariable('1', input);
                expect(result).toEqual(updatedVariable);
                expect(mockUpdateBuilder.set).toHaveBeenCalled();
            });
        });
        describe('deleteEnvironmentVariable', () => {
            it('should delete a variable', async () => {
                const mockDeleteBuilder = mockDb.delete();
                mockDeleteBuilder.returning.mockResolvedValue([mockVariable]);
                const result = await repository.deleteEnvironmentVariable('1');
                expect(result).toBe(true);
                expect(mockDeleteBuilder.where).toHaveBeenCalled();
            });
        });
        describe('bulkUpdateVariables', () => {
            it('should bulk update variables', async () => {
                const variables = [
                    {
                        key: 'API_KEY',
                        value: 'secret',
                        isSecret: true,
                    },
                ];
                const mockDeleteBuilder = mockDb.delete();
                mockDeleteBuilder.where.mockResolvedValue([]);
                const mockInsertBuilder = mockDb.insert();
                mockInsertBuilder.returning.mockResolvedValue([mockVariable]);
                const result = await repository.bulkUpdateVariables('1', variables, 'user-1');
                expect(result).toEqual([mockVariable]);
                expect(mockDeleteBuilder.where).toHaveBeenCalled();
                expect(mockInsertBuilder.values).toHaveBeenCalled();
            });
        });
    });
    describe('Access Logging', () => {
        describe('logEnvironmentAccess', () => {
            it('should log access to environment', async () => {
                const mockInsertBuilder = mockDb.insert();
                mockInsertBuilder.returning.mockResolvedValue([{
                        id: '1',
                        environmentId: '1',
                        userId: 'user-1',
                        action: 'read',
                        createdAt: new Date(),
                    }]);
                const accessData = {
                    environmentId: '1',
                    userId: 'user-1',
                    action: 'read' as const,
                };
                await repository.logEnvironmentAccess(accessData);
                expect(mockInsertBuilder.values).toHaveBeenCalledWith(expect.objectContaining({
                    environmentId: '1',
                    userId: 'user-1',
                    action: 'read',
                }));
            });
        });
    });
    describe('Status Management', () => {
        describe('updateEnvironmentStatus', () => {
            it('should update environment status', async () => {
                const updatedEnvironment = { ...mockEnvironment, status: 'error' };
                const mockUpdateBuilder = mockDb.update();
                mockUpdateBuilder.returning.mockResolvedValue([updatedEnvironment]);
                const result = await repository.updateEnvironmentStatus('1', 'error', { error: 'Deploy failed' });
                expect(result).toEqual(updatedEnvironment);
                expect(mockUpdateBuilder.set).toHaveBeenCalledWith(expect.objectContaining({
                    status: 'error',
                    metadata: { error: 'Deploy failed' },
                    updatedAt: expect.any(Date),
                }));
            });
        });
    });
});
