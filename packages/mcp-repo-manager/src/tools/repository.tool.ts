import type { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import type { Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { repoPath } from '../config';

@Injectable()
export class RepositoryTool {
  private getRepositoryRoot(): string {
    return repoPath;
  }

  @Tool({
    name: 'list-packages',
    description: 'List all packages in the monorepo with their basic information',
    parameters: z.object({
      detailed: z.boolean().optional().describe('Include detailed package information like dependencies, scripts, etc.'),
    }),
    annotations: {
      readOnlyHint: true,
    },
  })
  async listPackages({ detailed = false }, context: Context, request: Request) {
    const repoRoot = this.getRepositoryRoot();
    const packagesDir = path.join(repoRoot, 'packages');
    
    try {
      const packageDirs = await fs.readdir(packagesDir, { withFileTypes: true });
      const packages: any[] = [];

      for (const dir of packageDirs) {
        if (!dir.isDirectory()) continue;

        const packagePath = path.join(packagesDir, dir.name);
        const packageJsonPath = path.join(packagePath, 'package.json');

        try {
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);

          const packageInfo: any = {
            name: packageJson.name || dir.name,
            path: packagePath,
            version: packageJson.version || '0.0.0',
            description: packageJson.description,
          };

          if (detailed) {
            packageInfo.dependencies = packageJson.dependencies || {};
            packageInfo.devDependencies = packageJson.devDependencies || {};
            packageInfo.scripts = packageJson.scripts || {};
          }

          packages.push(packageInfo);
        } catch (error) {
          // Skip directories without package.json or with invalid JSON
          continue;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(packages, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list packages: ${errorMessage}`,
          },
        ],
      };
    }
  }

  @Tool({
    name: 'list-apps',
    description: 'List all applications in the monorepo with their basic information',
    parameters: z.object({
      detailed: z.boolean().optional().describe('Include detailed app information like dependencies, scripts, etc.'),
    }),
    annotations: {
      readOnlyHint: true,
    },
  })
  async listApps({ detailed = false }, context: Context, request: Request) {
    const repoRoot = this.getRepositoryRoot();
    const appsDir = path.join(repoRoot, 'apps');
    
    try {
      const appDirs = await fs.readdir(appsDir, { withFileTypes: true });
      const apps: any[] = [];

      for (const dir of appDirs) {
        if (!dir.isDirectory()) continue;

        const appPath = path.join(appsDir, dir.name);
        const packageJsonPath = path.join(appPath, 'package.json');

        try {
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);

          const appInfo: any = {
            name: packageJson.name || dir.name,
            path: appPath,
            version: packageJson.version || '0.0.0',
            description: packageJson.description,
            type: this.detectAppType(dir.name, packageJson),
          };

          if (detailed) {
            appInfo.dependencies = packageJson.dependencies || {};
            appInfo.devDependencies = packageJson.devDependencies || {};
            appInfo.scripts = packageJson.scripts || {};
          }

          apps.push(appInfo);
        } catch (error) {
          // Skip directories without package.json or with invalid JSON
          continue;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(apps, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list apps: ${errorMessage}`,
          },
        ],
      };
    }
  }

  @Tool({
    name: 'get-package-info',
    description: 'Get detailed information about a specific package using its package.json name (e.g., @repo/ui)',
    parameters: z.object({
      packageName: z.string().describe('Full package name from package.json (e.g., @repo/ui, @repo/api-contracts)'),
    }) ,
    annotations: {
      readOnlyHint: true,
    },
  })
  async getPackageInfo({ packageName }, context: Context, request: Request) {
    try {
      // Find the package by searching through packages directory
      const packagePath = await this.findPackageByName(packageName, 'packages');
      
      if (!packagePath) {
        return {
          content: [
            {
              type: 'text',
              text: `Package with name "${packageName}" not found in packages directory`,
            },
          ],
        };
      }

      const packageJsonPath = path.join(packagePath, 'package.json');
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      // List files in the package directory
      const files = await this.getDirectoryStructure(packagePath);
      
      // Check if package has tests
      const hasTests = files.some(file => 
        file.includes('test') || 
        file.includes('spec') || 
        file.includes('__tests__')
      );

      const result = {
        name: packageJson.name,
        directoryName: path.basename(packagePath),
        path: packagePath,
        version: packageJson.version || '0.0.0',
        description: packageJson.description,
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {},
        scripts: packageJson.scripts || {},
        files,
        hasTests,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get package info for ${packageName}: ${errorMessage}`,
          },
        ],
      };
    }
  }

  @Tool({
    name: 'get-app-info',
    description: 'Get detailed information about a specific application using its package.json name (e.g., api, web)',
    parameters: z.object({
      appName: z.string().describe('Full app name from package.json (e.g., api, web, doc)'),
    }),
    annotations: {
      readOnlyHint: true,
    },
  })
  async getAppInfo({ appName }, context: Context, request: Request) {
    try {
      // Find the app by searching through apps directory
      const appPath = await this.findPackageByName(appName, 'apps');
      
      if (!appPath) {
        return {
          content: [
            {
              type: 'text',
              text: `App with name "${appName}" not found in apps directory`,
            },
          ],
        };
      }

      const packageJsonPath = path.join(appPath, 'package.json');
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      // List files in the app directory
      const files = await this.getDirectoryStructure(appPath);
      
      // Check if app has tests
      const hasTests = files.some(file => 
        file.includes('test') || 
        file.includes('spec') || 
        file.includes('__tests__')
      );

      const result = {
        name: packageJson.name,
        directoryName: path.basename(appPath),
        path: appPath,
        version: packageJson.version || '0.0.0',
        description: packageJson.description,
        type: this.detectAppType(path.basename(appPath), packageJson),
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {},
        scripts: packageJson.scripts || {},
        files,
        hasTests,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get app info for ${appName}: ${errorMessage}`,
          },
        ],
      };
    }
  }

  @Tool({
    name: 'show-dependencies',
    description: 'Show dependency relationships between packages and apps',
    parameters: z.object({
      target: z.string().optional().describe('Specific package or app to show dependencies for'),
      type: z.enum(['dependencies', 'devDependencies', 'both']).default('dependencies').describe('Type of dependencies to show'),
    }),
    annotations: {
      readOnlyHint: true,
    },
  })
  async showDependencies({ target, type }, context: Context, request: Request) {
    try {
      const packagesResult = await this.listPackages({ detailed: true }, context, request);
      const appsResult = await this.listApps({ detailed: true }, context, request);
      
      // Parse JSON from the content results
      const packages = JSON.parse(packagesResult.content[0].text);
      const apps = JSON.parse(appsResult.content[0].text);
      const allItems = [...packages, ...apps];

      const graph: Record<string, string[]> = {};
      let internalDependencies = 0;
      let externalDependencies = 0;

      for (const item of allItems) {
        if (target && item.name !== target) continue;

        const deps: string[] = [];
        
        if (type === 'dependencies' || type === 'both') {
          Object.keys(item.dependencies || {}).forEach(dep => {
            deps.push(dep);
            if (dep.startsWith('@repo/') || allItems.some(i => i.name === dep)) {
              internalDependencies++;
            } else {
              externalDependencies++;
            }
          });
        }

        if (type === 'devDependencies' || type === 'both') {
          Object.keys(item.devDependencies || {}).forEach(dep => {
            deps.push(dep);
            if (dep.startsWith('@repo/') || allItems.some(i => i.name === dep)) {
              internalDependencies++;
            } else {
              externalDependencies++;
            }
          });
        }

        graph[item.name] = [...new Set(deps)]; // Remove duplicates
      }

      const result = {
        graph,
        summary: {
          totalPackages: packages.length,
          totalApps: apps.length,
          internalDependencies,
          externalDependencies,
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to analyze dependencies: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private detectAppType(dirName: string, packageJson: any): string {
    if (dirName === 'web' || packageJson.dependencies?.next) {
      return 'Next.js Web App';
    }
    if (dirName === 'api' || packageJson.dependencies?.[`@nestjs/core`]) {
      return 'NestJS API';
    }
    if (dirName === 'doc' || packageJson.dependencies?.fumadocs) {
      return 'Documentation';
    }
    return 'Unknown';
  }

  private async getDirectoryStructure(dirPath: string, prefix = ''): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const result: string[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = prefix + entry.name;

        if (entry.isDirectory()) {
          result.push(relativePath + '/');
          // Recursively get subdirectories but limit depth to avoid huge outputs
          if (prefix.split('/').length < 3) {
            const subItems = await this.getDirectoryStructure(fullPath, relativePath + '/');
            result.push(...subItems);
          }
        } else {
          result.push(relativePath);
        }
      }

      return result;
    } catch (error) {
      return [];
    }
  }

  private async findPackageByName(packageName: string, directory: 'packages' | 'apps'): Promise<string | null> {
    const repoRoot = this.getRepositoryRoot();
    const searchDir = path.join(repoRoot, directory);
    
    try {
      const dirs = await fs.readdir(searchDir, { withFileTypes: true });
      
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        
        const dirPath = path.join(searchDir, dir.name);
        const packageJsonPath = path.join(dirPath, 'package.json');
        
        try {
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);
          
          if (packageJson.name === packageName) {
            return dirPath;
          }
        } catch (error) {
          // Skip directories without package.json or with invalid JSON
          continue;
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
}