export interface ImportInfo {
  path: string;
  displayPath: string;
  exists: boolean;
  imports: string[];
  isExternal: boolean;
  metadata?: Record<string, any>;
}

export interface TSConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

export interface ResolverContext {
  currentFilePath: string;
  importPath: string;
  tsConfig: TSConfig | null;
  projectRoot: string;
}

export interface Plugin {
  name: string;
  
  /**
   * Check if this plugin should handle the given file
   */
  shouldHandle?: (filePath: string) => boolean;
  
  /**
   * Resolve import path using plugin-specific logic
   * Return null to pass to next plugin
   */
  resolveImport?: (context: ResolverContext) => string | null;
  
  /**
   * Extract imports using plugin-specific logic
   * Return null to use default extraction
   */
  extractImports?: (filePath: string) => string[] | null;
  
  /**
   * Modify import info before adding to result
   */
  transformImportInfo?: (info: ImportInfo) => ImportInfo;
  
  /**
   * Determine if further traversal should continue for this file
   */
  shouldTraverse?: (filePath: string, depth: number) => boolean;
}

export interface AnalyzerOptions {
  file: string;
  depth: number;
  verbose?: boolean;
  diagram?: boolean;
  plugins?: Plugin[];
}
