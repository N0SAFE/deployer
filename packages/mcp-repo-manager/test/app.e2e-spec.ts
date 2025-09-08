import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { RepositoryTool } from '../src/tools/repository.tool';
import { CreationTool } from '../src/tools/creation.tool';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AppModule (e2e)', () => {
  let app: INestApplication;
  let repositoryTool: RepositoryTool;
  let creationTool: CreationTool;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    repositoryTool = app.get<RepositoryTool>(RepositoryTool);
    creationTool = app.get<CreationTool>(CreationTool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('should create the app', () => {
    expect(app).toBeDefined();
  });

  it('should provide RepositoryTool', () => {
    expect(repositoryTool).toBeDefined();
  });

  it('should provide CreationTool', () => {
    expect(creationTool).toBeDefined();
  });
});
