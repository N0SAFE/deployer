import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, extname, resolve, basename, relative } from 'path';
import type { Plugin, ResolverContext, ImportInfo } from '../lib/types';
import { resolveWithExtensions } from '../lib/file-resolver';
import { extractImportsDefault } from '../lib/import-extractor';

/**
 * Next.js Plugin for Import Analyzer
 * 
 * This plugin handles Next.js-specific routing and import resolution:
 * - Detects Next.js App Router (app directory)
 * - Detects Next.js Pages Router (pages directory)
 * - For page/layout files, extracts route-specific imports
 * - Resolves Next.js special files (page.tsx, layout.tsx, loading.tsx, error.tsx, etc.)
 * - Falls back to TypeScript import resolver for non-routing files
 */

interface NextJsFileInfo {
  isAppRouter: boolean;
  isPagesRouter: boolean;
  isPageFile: boolean;
  isLayoutFile: boolean;
  route?: string;
}

/**
 * Detect if file is part of Next.js App Router
 */
const detectAppRouter = (filePath: string): boolean => {
  return filePath.includes('/app/') && (
    filePath.includes('/page.') ||
    filePath.includes('/layout.') ||
    filePath.includes('/loading.') ||
    filePath.includes('/error.') ||
    filePath.includes('/template.') ||
    filePath.includes('/not-found.') ||
    filePath.includes('/route.')
  );
};

/**
 * Detect if file is part of Next.js Pages Router
 */
const detectPagesRouter = (filePath: string): boolean => {
  return filePath.includes('/pages/') && (
    filePath.endsWith('.tsx') ||
    filePath.endsWith('.jsx') ||
    filePath.endsWith('.ts') ||
    filePath.endsWith('.js')
  );
};

/**
 * Extract route from file path
 */
const extractRoute = (filePath: string): string | undefined => {
  const appMatch = filePath.match(/\/app\/(.+?)\/(page|layout|loading|error|template|not-found|route)\./);
  if (appMatch) {
    return `/${appMatch[1]}`;
  }
  
  const pagesMatch = filePath.match(/\/pages\/(.+)\.(tsx|jsx|ts|js)$/);
  if (pagesMatch) {
    let route = pagesMatch[1];
    if (route === 'index') return '/';
    if (route.endsWith('/index')) route = route.slice(0, -6);
    return `/${route}`;
  }
  
  return undefined;
};

/**
 * Analyze Next.js file
 */
const analyzeNextJsFile = (filePath: string): NextJsFileInfo => {
  const isAppRouter = detectAppRouter(filePath);
  const isPagesRouter = detectPagesRouter(filePath);
  const isPageFile = filePath.includes('/page.') || (isPagesRouter && !filePath.includes('/_'));
  const isLayoutFile = filePath.includes('/layout.');
  const route = extractRoute(filePath);
  
  return {
    isAppRouter,
    isPagesRouter,
    isPageFile,
    isLayoutFile,
    route,
  };
};

/**
 * Find all route files in a Next.js app/pages directory
 */
const findRouteFiles = (dirPath: string, isAppRouter: boolean): string[] => {
  const files: string[] = [];
  
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    return files;
  }
  
  const entries = readdirSync(dirPath);
  
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Recurse into subdirectories
      files.push(...findRouteFiles(fullPath, isAppRouter));
    } else if (stat.isFile()) {
      if (isAppRouter) {
        // App Router: page.tsx, layout.tsx, etc.
        if (/\/(page|layout|loading|error|template|not-found|route)\.(tsx|jsx|ts|js)$/.test(fullPath)) {
          files.push(fullPath);
        }
      } else {
        // Pages Router: any .tsx/.jsx file
        if (/\.(tsx|jsx|ts|js)$/.test(fullPath) && !entry.startsWith('_')) {
          files.push(fullPath);
        }
      }
    }
  }
  
  return files;
};

/**
 * Next.js Plugin
 */
export const nextjsPlugin: Plugin = {
  name: 'nextjs',
  
  /**
   * Check if file is a Next.js route file
   */
  shouldHandle: (filePath: string): boolean => {
    const info = analyzeNextJsFile(filePath);
    return info.isAppRouter || info.isPagesRouter;
  },
  
  /**
   * Extract imports from Next.js route files
   */
  extractImports: (filePath: string): string[] | null => {
    const info = analyzeNextJsFile(filePath);
    
    if (!info.isAppRouter && !info.isPagesRouter) {
      return null; // Let default handle non-Next.js files
    }
    
    // For page/layout files, extract only component imports (not data fetching)
    if (info.isPageFile || info.isLayoutFile) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const imports: string[] = [];
        
        // Extract all import statements
        const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        
        while ((match = importRegex.exec(content)) !== null) {
          const importPath = match[1];
          
          // Skip Next.js internal imports
          if (importPath.startsWith('next/') || importPath.startsWith('next-')) {
            continue;
          }
          
          imports.push(importPath);
        }
        
        // For App Router, also detect sibling route files
        if (info.isAppRouter) {
          const dir = dirname(filePath);
          const siblingFiles = findRouteFiles(dir, true)
            .filter(f => f !== filePath)
            .map(f => relative(dirname(filePath), f));
          
          // Add as pseudo-imports for visualization
          siblingFiles.forEach(f => {
            if (f.startsWith('.')) {
              imports.push(f);
            } else {
              imports.push(`./${f}`);
            }
          });
        }
        
        return [...new Set(imports)];
      } catch (error) {
        console.error(`Failed to extract Next.js imports from ${filePath}:`, error);
        return extractImportsDefault(filePath);
      }
    }
    
    // For non-page files, use default extraction
    return extractImportsDefault(filePath);
  },
  
  /**
   * Resolve Next.js imports
   */
  resolveImport: (context: ResolverContext): string | null => {
    const { currentFilePath, importPath } = context;
    const info = analyzeNextJsFile(currentFilePath);
    
    // Only handle if current file is a Next.js route
    if (!info.isAppRouter && !info.isPagesRouter) {
      return null;
    }
    
    // Skip external packages
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }
    
    // Resolve relative import
    const currentDir = dirname(currentFilePath);
    const absolutePath = resolve(currentDir, importPath);
    
    return resolveWithExtensions(absolutePath);
  },
  
  /**
   * Add metadata about Next.js routes
   */
  transformImportInfo: (info: ImportInfo): ImportInfo => {
    const fileInfo = analyzeNextJsFile(info.path);
    
    if (fileInfo.isAppRouter || fileInfo.isPagesRouter) {
      return {
        ...info,
        metadata: {
          ...info.metadata,
          type: fileInfo.isAppRouter ? 'nextjs-app-router' : 'nextjs-pages-router',
          route: fileInfo.route,
          isPage: fileInfo.isPageFile,
          isLayout: fileInfo.isLayoutFile,
        },
      };
    }
    
    return info;
  },
  
  /**
   * Control traversal for Next.js routes
   */
  shouldTraverse: (filePath: string, depth: number): boolean => {
    const info = analyzeNextJsFile(filePath);
    
    // Always traverse page and layout files to see their dependencies
    if (info.isPageFile || info.isLayoutFile) {
      return true;
    }
    
    // For other files imported by routes, use default behavior
    return true;
  },
};

/**
 * Factory function to create Next.js plugin with custom options
 */
export const createNextJSPlugin = (options?: {
  /** Only show route files (pages/layouts) */
  routesOnly?: boolean;
  /** Include sibling route files in app router */
  includeSiblings?: boolean;
}): Plugin => {
  const routesOnly = options?.routesOnly ?? false;
  const includeSiblings = options?.includeSiblings ?? true;
  
  return {
    ...nextjsPlugin,
    name: 'nextjs-custom',
    
    extractImports: (filePath: string): string[] | null => {
      const info = analyzeNextJsFile(filePath);
      
      if (!info.isAppRouter && !info.isPagesRouter) {
        return null;
      }
      
      const imports = nextjsPlugin.extractImports!(filePath);
      
      if (!includeSiblings && info.isAppRouter && imports) {
        // Filter out sibling files
        const dir = dirname(filePath);
        return imports.filter(imp => {
          if (!imp.startsWith('.')) return true;
          const resolved = resolve(dirname(filePath), imp);
          return !resolved.startsWith(dir) || resolved === filePath;
        });
      }
      
      return imports;
    },
    
    shouldTraverse: (filePath: string, depth: number): boolean => {
      if (routesOnly) {
        const info = analyzeNextJsFile(filePath);
        return info.isPageFile || info.isLayoutFile;
      }
      return true;
    },
  };
};

export default nextjsPlugin;
