import type { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import type { Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { repoPath } from '../config';

@Injectable()
export class CreationTool {
  private getRepositoryRoot(): string {
    return repoPath;
  }

  @Tool({
    name: 'create-package',
    description: 'Create a new package in the monorepo with comprehensive configuration options',
    parameters: z.object({
      // Basic Information
      name: z.string().describe('Package name (without @repo/ prefix)'),
      description: z.string().describe('Package description'),
      version: z.string().default('0.0.0').describe('Initial version'),
      author: z.string().optional().describe('Author name'),
      license: z.string().default('MIT').describe('License type'),
      
      // Package Type and Structure
      type: z.enum(['library', 'ui-components', 'utilities', 'config', 'cli-tool', 'shared-types'])
        .describe('Type of package to create'),
      withTests: z.boolean().default(true).describe('Include test setup'),
      withDocs: z.boolean().default(false).describe('Include documentation setup'),
      withExamples: z.boolean().default(false).describe('Include examples directory'),
      
      // Build Configuration
      buildTool: z.enum(['tsc', 'rollup', 'webpack', 'unbuild']).default('tsc').describe('Build tool to use'),
      entryPoint: z.string().default('index.ts').describe('Main entry point file'),
      withCjs: z.boolean().default(true).describe('Generate CommonJS output'),
      withEsm: z.boolean().default(true).describe('Generate ES modules output'),
      withDeclarations: z.boolean().default(true).describe('Generate TypeScript declarations'),
      
      // Dependencies Configuration
      dependencies: z.array(z.string()).default([]).describe('Runtime dependencies to include'),
      devDependencies: z.array(z.string()).default([]).describe('Development dependencies to include'),
      peerDependencies: z.array(z.string()).default([]).describe('Peer dependencies to include'),
      
      // TypeScript Configuration
      tsConfigExtends: z.enum(['base', 'react-library', 'node']).default('base').describe('TypeScript config to extend'),
      strict: z.boolean().default(true).describe('Enable strict TypeScript checking'),
      
      // Linting and Formatting
      withEslint: z.boolean().default(true).describe('Include ESLint configuration'),
      withPrettier: z.boolean().default(true).describe('Include Prettier configuration'),
      eslintConfig: z.enum(['base', 'react', 'node']).default('base').describe('ESLint config to use'),
      
      // Publishing Configuration
      private: z.boolean().default(true).describe('Mark package as private'),
      publishConfig: z.object({
        registry: z.string().optional().describe('Custom registry URL'),
        access: z.enum(['public', 'restricted']).default('restricted').describe('Package access level'),
      }).optional().describe('NPM publishing configuration'),
      
      // Scripts Configuration
      scripts: z.object({
        build: z.string().optional().describe('Custom build script'),
        test: z.string().optional().describe('Custom test script'),
        lint: z.string().optional().describe('Custom lint script'),
        dev: z.string().optional().describe('Custom dev script'),
      }).default({}).describe('Custom package scripts'),
      
      // Advanced Options
      workspaces: z.array(z.string()).default([]).describe('Workspace patterns if this package contains workspaces'),
      exports: z.record(z.string(), z.string()).optional().describe('Custom package.json exports configuration'),
      sideEffects: z.union([z.boolean(), z.array(z.string())]).default(false).describe('Side effects configuration'),
    }) as any,
    annotations: {
      destructiveHint: true,
    },
  })
  async createPackage({
    name,
    description,
    version,
    author,
    license,
    type,
    withTests,
    withDocs,
    withExamples,
    buildTool,
    entryPoint,
    withCjs,
    withEsm,
    withDeclarations,
    dependencies,
    devDependencies,
    peerDependencies,
    tsConfigExtends,
    strict,
    withEslint,
    withPrettier,
    eslintConfig,
    private: isPrivate,
    publishConfig,
    scripts,
    workspaces,
    exports,
    sideEffects,
  }, context: Context, request: Request) {
    const repoRoot = this.getRepositoryRoot();
    const packagePath = path.join(repoRoot, 'packages', name);

    try {
      // Check if package already exists
      try {
        await fs.access(packagePath);
        return {
          content: [
            {
              type: 'text',
              text: `Package "${name}" already exists at ${packagePath}`,
            },
          ],
        };
      } catch {
        // Package doesn't exist, continue
      }

      await context.reportProgress({ progress: 10, total: 100 });

      // Create package directory structure
      await fs.mkdir(packagePath, { recursive: true });
      await fs.mkdir(path.join(packagePath, 'src'), { recursive: true });

      if (withTests) {
        await fs.mkdir(path.join(packagePath, 'src', '__tests__'), { recursive: true });
      }

      if (withDocs) {
        await fs.mkdir(path.join(packagePath, 'docs'), { recursive: true });
      }

      if (withExamples) {
        await fs.mkdir(path.join(packagePath, 'examples'), { recursive: true });
      }

      await context.reportProgress({ progress: 30, total: 100 });

      // Generate package.json
      const packageJson = await this.generatePackageJson({
        name: `@repo/${name}`,
        description,
        version,
        author,
        license,
        type,
        entryPoint,
        withCjs,
        withEsm,
        withDeclarations,
        dependencies,
        devDependencies,
        peerDependencies,
        isPrivate,
        publishConfig,
        scripts,
        workspaces,
        exports,
        sideEffects,
      });

      await fs.writeFile(
        path.join(packagePath, 'package.json'),
        JSON.stringify(packageJson, null, 2) + '\n'
      );

      await context.reportProgress({ progress: 50, total: 100 });

      // Generate TypeScript config
      if (buildTool === 'tsc') {
        const tsConfig = await this.generateTsConfig(tsConfigExtends, strict);
        await fs.writeFile(
          path.join(packagePath, 'tsconfig.json'),
          JSON.stringify(tsConfig, null, 2) + '\n'
        );
      }

      // Generate ESLint config
      if (withEslint) {
        const eslintConfigContent = await this.generateEslintConfig(eslintConfig);
        await fs.writeFile(
          path.join(packagePath, 'eslint.config.js'),
          eslintConfigContent
        );
      }

      // Generate Prettier config
      if (withPrettier) {
        const prettierConfig = {
          extends: '@repo/prettier-config',
        };
        await fs.writeFile(
          path.join(packagePath, '.prettierrc.json'),
          JSON.stringify(prettierConfig, null, 2) + '\n'
        );
      }

      await context.reportProgress({ progress: 70, total: 100 });

      // Generate main entry point
      const entryContent = await this.generateEntryPoint(type);
      await fs.writeFile(
        path.join(packagePath, 'src', entryPoint),
        entryContent
      );

      // Generate test file if needed
      if (withTests) {
        const testContent = await this.generateTestFile(name, type);
        await fs.writeFile(
          path.join(packagePath, 'src', '__tests__', `${entryPoint.replace('.ts', '.test.ts')}`),
          testContent
        );
      }

      // Generate README
      const readmeContent = await this.generateReadme(name, description, type);
      await fs.writeFile(
        path.join(packagePath, 'README.md'),
        readmeContent
      );

      if (withDocs) {
        await fs.writeFile(
          path.join(packagePath, 'docs', 'getting-started.md'),
          `# Getting Started with @repo/${name}\n\nDocumentation coming soon...\n`
        );
      }

      if (withExamples) {
        await fs.writeFile(
          path.join(packagePath, 'examples', 'basic.ts'),
          `// Basic usage example for @repo/${name}\n\nexport {};\n`
        );
      }

      await context.reportProgress({ progress: 100, total: 100 });

      const result = {
        packageName: `@repo/${name}`,
        path: packagePath,
        type,
        files: [
          'package.json',
          `src/${entryPoint}`,
          'README.md',
          ...(buildTool === 'tsc' ? ['tsconfig.json'] : []),
          ...(withEslint ? ['eslint.config.js'] : []),
          ...(withPrettier ? ['.prettierrc.json'] : []),
          ...(withTests ? [`src/__tests__/${entryPoint.replace('.ts', '.test.ts')}`] : []),
          ...(withDocs ? ['docs/getting-started.md'] : []),
          ...(withExamples ? ['examples/basic.ts'] : []),
        ],
      };

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created package "${name}"!\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create package "${name}": ${errorMessage}`,
          },
        ],
      };
    }
  }

  @Tool({
    name: 'create-app',
    description: 'Create a new application in the monorepo with comprehensive configuration options',
    parameters: z.object({
      // Basic Information
      name: z.string().describe('Application name'),
      description: z.string().describe('Application description'),
      version: z.string().default('0.0.0').describe('Initial version'),
      author: z.string().optional().describe('Author name'),
      
      // Application Type
      type: z.enum(['nextjs', 'nestjs', 'documentation', 'react-spa', 'node-cli', 'express-api'])
        .describe('Type of application to create'),
      
      // Framework-specific Options
      nextjs: z.object({
        useAppRouter: z.boolean().default(true).describe('Use App Router (Next.js 13+)'),
        withTailwind: z.boolean().default(true).describe('Include Tailwind CSS'),
        withAuth: z.boolean().default(false).describe('Include authentication setup'),
        withDatabase: z.boolean().default(false).describe('Include database integration'),
      }).optional().describe('Next.js specific configuration'),
      
      nestjs: z.object({
        withSwagger: z.boolean().default(true).describe('Include Swagger documentation'),
        withOrpc: z.boolean().default(false).describe('Include ORPC integration'),
        withDatabase: z.boolean().default(false).describe('Include database module'),
        withAuth: z.boolean().default(false).describe('Include authentication module'),
        withCors: z.boolean().default(true).describe('Enable CORS'),
      }).optional().describe('NestJS specific configuration'),
      
      // Build and Development
      port: z.number().default(3000).describe('Default development port'),
      buildTool: z.enum(['next', 'nest', 'vite', 'webpack']).optional().describe('Build tool (auto-detected from type)'),
      
      // Environment Configuration
      envVars: z.array(z.object({
        name: z.string().describe('Environment variable name'),
        description: z.string().describe('Description of the variable'),
        required: z.boolean().default(false).describe('Whether the variable is required'),
        defaultValue: z.string().optional().describe('Default value'),
      })).default([]).describe('Environment variables to include'),
      
      // Docker Configuration
      withDocker: z.boolean().default(true).describe('Include Docker configuration'),
      dockerBaseImage: z.string().optional().describe('Docker base image (auto-selected if not provided)'),
      dockerExpose: z.array(z.number()).default([]).describe('Additional ports to expose in Docker'),
      
      // Database Configuration
      database: z.object({
        type: z.enum(['postgresql', 'mysql', 'sqlite', 'mongodb']).optional().describe('Database type'),
        orm: z.enum(['drizzle', 'prisma', 'typeorm', 'mongoose']).optional().describe('ORM to use'),
        migrations: z.boolean().default(true).describe('Include migration setup'),
      }).optional().describe('Database configuration'),
      
      // Testing Configuration
      withTests: z.boolean().default(true).describe('Include test setup'),
      testFramework: z.enum(['vitest', 'jest', 'playwright']).default('vitest').describe('Testing framework'),
      withE2E: z.boolean().default(false).describe('Include E2E test setup'),
      
      // Additional Features
      withLinting: z.boolean().default(true).describe('Include linting setup'),
      withPrettier: z.boolean().default(true).describe('Include Prettier setup'),
      withHusky: z.boolean().default(false).describe('Include Husky git hooks'),
      withCI: z.boolean().default(false).describe('Include CI/CD configuration'),
      
      // Dependencies
      additionalDeps: z.array(z.string()).default([]).describe('Additional runtime dependencies'),
      additionalDevDeps: z.array(z.string()).default([]).describe('Additional development dependencies'),
    }) as any,
    annotations: {
      destructiveHint: true,
    },
  })
  async createApp({
    name,
    description,
    version,
    author,
    type,
    nextjs,
    nestjs,
    port,
    buildTool,
    envVars,
    withDocker,
    dockerBaseImage,
    dockerExpose,
    database,
    withTests,
    testFramework,
    withE2E,
    withLinting,
    withPrettier,
    withHusky,
    withCI,
    additionalDeps,
    additionalDevDeps,
  }, context: Context, request: Request) {
    const repoRoot = this.getRepositoryRoot();
    const appPath = path.join(repoRoot, 'apps', name);

    try {
      // Check if app already exists
      try {
        await fs.access(appPath);
        return {
          content: [
            {
              type: 'text',
              text: `Application "${name}" already exists at ${appPath}`,
            },
          ],
        };
      } catch {
        // App doesn't exist, continue
      }

      await context.reportProgress({ progress: 5, total: 100 });

      // Create app directory
      await fs.mkdir(appPath, { recursive: true });

      // Generate app based on type
      let result;
      switch (type) {
        case 'nextjs':
          result = await this.createNextJSApp(appPath, {
            name,
            description,
            version,
            author,
            port,
            nextjs: nextjs || {},
            envVars,
            withDocker,
            dockerBaseImage,
            dockerExpose,
            database,
            withTests,
            testFramework,
            withLinting,
            withPrettier,
            additionalDeps,
            additionalDevDeps,
          }, context);
          break;
        case 'nestjs':
          result = await this.createNestJSApp(appPath, {
            name,
            description,
            version,
            author,
            port,
            nestjs: nestjs || {},
            envVars,
            withDocker,
            dockerBaseImage,
            dockerExpose,
            database,
            withTests,
            testFramework,
            withLinting,
            withPrettier,
            additionalDeps,
            additionalDevDeps,
          }, context);
          break;
        default:
          throw new Error(`App type "${type}" is not implemented yet`);
      }

      await context.reportProgress({ progress: 100, total: 100 });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created ${type} application "${name}"!\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create application "${name}": ${errorMessage}`,
          },
        ],
      };
    }
  }

  // Helper methods for package creation
  private async generatePackageJson(options: any) {
    const {
      name,
      description,
      version,
      author,
      license,
      type,
      entryPoint,
      withCjs,
      withEsm,
      withDeclarations,
      dependencies,
      devDependencies,
      peerDependencies,
      isPrivate,
      publishConfig,
      scripts,
      workspaces,
      exports: customExports,
      sideEffects,
    } = options;

    const packageJson: any = {
      name,
      version,
      description,
      private: isPrivate,
      ...(author && { author }),
      license,
      ...(workspaces.length > 0 && { workspaces }),
      sideEffects,
    };

    // Add main/module/types based on build configuration
    if (withCjs) {
      packageJson.main = './dist/index.js';
    }
    if (withEsm) {
      packageJson.module = './dist/index.mjs';
    }
    if (withDeclarations) {
      packageJson.types = './dist/index.d.ts';
    }

    // Custom exports configuration
    if (customExports) {
      packageJson.exports = customExports;
    } else if (withCjs || withEsm) {
      packageJson.exports = {
        '.': {
          ...(withCjs && { require: './dist/index.js' }),
          ...(withEsm && { import: './dist/index.mjs' }),
          ...(withDeclarations && { types: './dist/index.d.ts' }),
        },
      };
    }

    // Scripts
    const defaultScripts: any = {
      build: 'tsc',
      clean: 'rimraf dist',
      dev: 'tsc --watch',
      lint: 'eslint src/**/*.ts',
      test: 'vitest run',
      'test:watch': 'vitest',
    };

    packageJson.scripts = { ...defaultScripts, ...scripts };

    // Dependencies
    if (dependencies.length > 0) {
      packageJson.dependencies = {};
      dependencies.forEach(dep => {
        packageJson.dependencies[dep] = 'latest';
      });
    }

    // Dev dependencies
    const defaultDevDeps = [
      '@repo/tsconfig',
      '@repo/eslint-config',
      '@repo/prettier-config',
      'typescript',
      'vitest',
      'rimraf',
    ];
    packageJson.devDependencies = {};
    [...defaultDevDeps, ...devDependencies].forEach(dep => {
      packageJson.devDependencies[dep] = dep.startsWith('@repo/') ? '*' : 'latest';
    });

    // Peer dependencies
    if (peerDependencies.length > 0) {
      packageJson.peerDependencies = {};
      peerDependencies.forEach(dep => {
        packageJson.peerDependencies[dep] = '*';
      });
    }

    if (publishConfig) {
      packageJson.publishConfig = publishConfig;
    }

    return packageJson;
  }

  private async generateTsConfig(extendsConfig: string, strict: boolean) {
    return {
      extends: `@repo/tsconfig/${extendsConfig}.json`,
      compilerOptions: {
        outDir: './dist',
        rootDir: './src',
        ...(strict && {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
        }),
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    };
  }

  private async generateEslintConfig(configType: string) {
    return `module.exports = {
  extends: ['@repo/eslint-config/${configType}'],
  parserOptions: {
    project: true,
  },
};
`;
  }

  private async generateEntryPoint(packageType: string) {
    switch (packageType) {
      case 'ui-components':
        return `export * from './components';
export * from './types';

// Re-export common utilities
export { cn } from './utils/cn';
`;
      case 'utilities':
        return `// Utility functions and helpers
export * from './utils';
export * from './types';

// Main utility export
export { createUtils } from './utils';
`;
      case 'config':
        return `// Configuration exports
export * from './config';
export type * from './types';

// Default configuration
export { default } from './config';
`;
      case 'cli-tool':
        return `#!/usr/bin/env node

export * from './cli';
export * from './commands';

// CLI entry point
if (require.main === module) {
  require('./cli').run();
}
`;
      case 'shared-types':
        return `// Shared type definitions
export * from './types';
export * from './interfaces';
export * from './enums';
`;
      default:
        return `// Package exports
export * from './lib';
export type * from './types';

// Main export
export { default } from './lib';
`;
    }
  }

  private async generateTestFile(packageName: string, packageType: string) {
    return `import { describe, it, expect } from 'vitest';
// Import your package exports here
// import { ... } from '../index';

describe('@repo/${packageName}', () => {
  it('should export main functionality', () => {
    // Add your tests here
    expect(true).toBe(true);
  });

  it('should handle edge cases', () => {
    // Add edge case tests
    expect(true).toBe(true);
  });
});
`;
  }

  private async generateReadme(packageName: string, description: string, packageType: string) {
    return `# @repo/${packageName}

${description}

## Installation

\`\`\`bash
# From the repository root
bun install
\`\`\`

## Usage

\`\`\`typescript
import { ... } from '@repo/${packageName}';

// Usage example here
\`\`\`

## API

### Main Functions

- \`function1()\`: Description
- \`function2()\`: Description

## Development

\`\`\`bash
# Run in development mode
bun run dev

# Build the package
bun run build

# Run tests
bun run test

# Lint code
bun run lint
\`\`\`

## License

MIT
`;
  }

  // Helper methods for app creation
  private async createNextJSApp(appPath: string, options: any, context: Context) {
    await context.reportProgress({ progress: 20, total: 100 });

    // Create basic Next.js structure
    const dirs = [
      'src/app',
      'src/components',
      'src/lib',
      'public',
      ...(options.withTests ? ['src/__tests__'] : []),
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(appPath, dir), { recursive: true });
    }

    await context.reportProgress({ progress: 40, total: 100 });

    // Generate package.json for Next.js app
    const packageJson = {
      name: options.name,
      version: options.version,
      description: options.description,
      private: true,
      scripts: {
        dev: `next dev -p ${options.port}`,
        build: 'next build',
        start: 'next start',
        lint: 'next lint',
        ...(options.withTests && { test: 'vitest run' }),
      },
      dependencies: {
        next: 'latest',
        react: 'latest',
        'react-dom': 'latest',
        ...(options.nextjs.withTailwind && { 'tailwindcss': 'latest' }),
        ...options.additionalDeps.reduce((acc, dep) => ({ ...acc, [dep]: 'latest' }), {}),
      },
      devDependencies: {
        '@types/node': 'latest',
        '@types/react': 'latest',
        '@types/react-dom': 'latest',
        typescript: 'latest',
        ...(options.withLinting && { eslint: 'latest', 'eslint-config-next': 'latest' }),
        ...(options.withTests && { vitest: 'latest' }),
        ...options.additionalDevDeps.reduce((acc, dep) => ({ ...acc, [dep]: 'latest' }), {}),
      },
    };

    await fs.writeFile(
      path.join(appPath, 'package.json'),
      JSON.stringify(packageJson, null, 2) + '\n'
    );

    await context.reportProgress({ progress: 60, total: 100 });

    // Generate basic app structure
    await fs.writeFile(
      path.join(appPath, 'src/app/layout.tsx'),
      `export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`
    );

    await fs.writeFile(
      path.join(appPath, 'src/app/page.tsx'),
      `export default function Home() {
  return (
    <div>
      <h1>Welcome to ${options.name}</h1>
      <p>${options.description}</p>
    </div>
  );
}
`
    );

    await context.reportProgress({ progress: 80, total: 100 });

    // Generate additional config files
    if (options.nextjs.withTailwind) {
      await fs.writeFile(
        path.join(appPath, 'tailwind.config.js'),
        `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`
      );
    }

    return {
      type: 'nextjs',
      path: appPath,
      port: options.port,
      features: {
        appRouter: options.nextjs.useAppRouter,
        tailwind: options.nextjs.withTailwind,
        tests: options.withTests,
      },
    };
  }

  private async createNestJSApp(appPath: string, options: any, context: Context) {
    await context.reportProgress({ progress: 20, total: 100 });

    // Create basic NestJS structure
    const dirs = [
      'src',
      'src/modules',
      'src/common',
      ...(options.withTests ? ['src/__tests__', 'test'] : []),
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(appPath, dir), { recursive: true });
    }

    await context.reportProgress({ progress: 40, total: 100 });

    // Generate package.json for NestJS app
    const packageJson = {
      name: options.name,
      version: options.version,
      description: options.description,
      private: true,
      scripts: {
        build: 'nest build',
        dev: 'nest start --watch',
        'dev:debug': 'nest start --debug --watch',
        start: 'nest start',
        'start:prod': 'node dist/main',
        lint: 'eslint "{src,apps,libs,test}/**/*.ts" --fix',
        test: 'jest',
        'test:watch': 'jest --watch',
        'test:cov': 'jest --coverage',
        'test:debug': 'node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand',
        'test:e2e': 'jest --config ./test/jest-e2e.json',
      },
      dependencies: {
        '@nestjs/common': 'latest',
        '@nestjs/core': 'latest',
        '@nestjs/platform-express': 'latest',
        'reflect-metadata': 'latest',
        'rxjs': 'latest',
        ...(options.nestjs.withSwagger && { '@nestjs/swagger': 'latest', 'swagger-ui-express': 'latest' }),
        ...(options.nestjs.withOrpc && { '@rekog/mcp-nest': 'latest' }),
        ...options.additionalDeps.reduce((acc, dep) => ({ ...acc, [dep]: 'latest' }), {}),
      },
      devDependencies: {
        '@nestjs/cli': 'latest',
        '@nestjs/schematics': 'latest',
        '@nestjs/testing': 'latest',
        '@types/express': 'latest',
        '@types/jest': 'latest',
        '@types/node': 'latest',
        '@types/supertest': 'latest',
        'jest': 'latest',
        'supertest': 'latest',
        'ts-jest': 'latest',
        'ts-loader': 'latest',
        'ts-node': 'latest',
        'tsconfig-paths': 'latest',
        'typescript': 'latest',
        ...options.additionalDevDeps.reduce((acc, dep) => ({ ...acc, [dep]: 'latest' }), {}),
      },
    };

    await fs.writeFile(
      path.join(appPath, 'package.json'),
      JSON.stringify(packageJson, null, 2) + '\n'
    );

    await context.reportProgress({ progress: 60, total: 100 });

    // Generate main.ts
    await fs.writeFile(
      path.join(appPath, 'src/main.ts'),
      `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  ${options.nestjs.withCors ? `app.enableCors();` : ''}
  await app.listen(${options.port});
}
bootstrap();
`
    );

    // Generate app.module.ts
    await fs.writeFile(
      path.join(appPath, 'src/app.module.ts'),
      `import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`
    );

    // Generate app.controller.ts
    await fs.writeFile(
      path.join(appPath, 'src/app.controller.ts'),
      `import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
`
    );

    // Generate app.service.ts
    await fs.writeFile(
      path.join(appPath, 'src/app.service.ts'),
      `import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello ${options.name}!';
  }
}
`
    );

    await context.reportProgress({ progress: 80, total: 100 });

    // Generate nest-cli.json
    await fs.writeFile(
      path.join(appPath, 'nest-cli.json'),
      JSON.stringify({
        collection: '@nestjs/schematics',
        sourceRoot: 'src',
      }, null, 2) + '\n'
    );

    return {
      type: 'nestjs',
      path: appPath,
      port: options.port,
      features: {
        swagger: options.nestjs.withSwagger,
        orpc: options.nestjs.withOrpc,
        cors: options.nestjs.withCors,
        tests: options.withTests,
      },
    };
  }
}