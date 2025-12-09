#!/usr/bin/env bun
/**
 * NestJS Module Dependency Diagram Generator
 *
 * This script analyzes all NestJS modules by statically parsing TypeScript files
 * and extracting @Module decorator metadata to generate a Mermaid diagram.
 *
 * It uses TypeScript's compiler API to parse files without executing them,
 * avoiding circular dependency issues.
 *
 * Usage:
 *   bun run scripts/generate-module-diagram.ts
 *   bun run scripts/generate-module-diagram.ts --output diagram.md
 *   bun run scripts/generate-module-diagram.ts --format mermaid|json
 *   bun run scripts/generate-module-diagram.ts --direction LR
 */

import * as ts from "typescript";
import { glob } from "fs/promises";
import * as path from "path";
import * as fs from "fs/promises";

interface ModuleInfo {
  name: string;
  filePath: string;
  imports: string[];
  exports: string[];
  controllers: string[];
  providers: string[];
  isGlobal: boolean;
  isDynamicModule: boolean;
  dynamicMethods: string[]; // forRoot, forRootAsync, etc.
}

interface ModuleGraph {
  modules: Map<string, ModuleInfo>;
  edges: Array<{ from: string; to: string; isDynamic: boolean }>;
}

interface ImportMapping {
  [localName: string]: {
    moduleName: string;
    importPath: string;
  };
}

/**
 * Parse a TypeScript file and extract module information
 */
function parseModuleFile(filePath: string, content: string): ModuleInfo | null {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  let moduleInfo: ModuleInfo | null = null;
  const importMappings: ImportMapping = {};

  // First pass: collect all imports
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      const importPath = (node.moduleSpecifier as ts.StringLiteral).text;
      const importClause = node.importClause;

      if (importClause) {
        // Named imports: import { A, B } from 'module'
        if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
          for (const element of importClause.namedBindings.elements) {
            const localName = element.name.text;
            const originalName = element.propertyName?.text || localName;
            importMappings[localName] = {
              moduleName: originalName,
              importPath,
            };
          }
        }
        // Default import: import A from 'module'
        if (importClause.name) {
          importMappings[importClause.name.text] = {
            moduleName: importClause.name.text,
            importPath,
          };
        }
        // Namespace import: import * as A from 'module'
        if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
          importMappings[importClause.namedBindings.name.text] = {
            moduleName: "*",
            importPath,
          };
        }
      }
    }
  });

  // Second pass: find the class with @Module decorator
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const decorators = ts.getDecorators(node);

      if (!decorators) return;

      let isGlobal = false;
      let moduleDecoratorArgs: ts.ObjectLiteralExpression | null = null;

      for (const decorator of decorators) {
        if (ts.isCallExpression(decorator.expression)) {
          const decoratorName = getDecoratorName(decorator.expression);

          if (decoratorName === "Global") {
            isGlobal = true;
          }

          if (decoratorName === "Module") {
            const args = decorator.expression.arguments;
            if (args.length > 0 && ts.isObjectLiteralExpression(args[0])) {
              moduleDecoratorArgs = args[0];
            }
          }
        }
      }

      if (moduleDecoratorArgs) {
        const imports = extractArrayProperty(moduleDecoratorArgs, "imports", importMappings);
        const exports = extractArrayProperty(moduleDecoratorArgs, "exports", importMappings);
        const controllers = extractArrayProperty(moduleDecoratorArgs, "controllers", importMappings);
        const providers = extractArrayProperty(moduleDecoratorArgs, "providers", importMappings);

        // Check for dynamic module methods (forRoot, forRootAsync, etc.)
        const dynamicMethods = findDynamicModuleMethods(node);

        moduleInfo = {
          name: className,
          filePath,
          imports: imports.map((i) => i.name),
          exports: exports.map((e) => e.name),
          controllers: controllers.map((c) => c.name),
          providers: providers.map((p) => p.name),
          isGlobal,
          isDynamicModule: dynamicMethods.length > 0,
          dynamicMethods,
        };
      }
    }
  });

  return moduleInfo;
}

/**
 * Get the name of a decorator
 */
function getDecoratorName(callExpr: ts.CallExpression): string | null {
  const expression = callExpr.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

interface ExtractedItem {
  name: string;
  isDynamic: boolean;
  dynamicMethod?: string;
}

/**
 * Extract array property from @Module decorator (imports, exports, controllers, providers)
 */
function extractArrayProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
  _importMappings: ImportMapping
): ExtractedItem[] {
  const items: ExtractedItem[] = [];

  for (const property of objectLiteral.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === propertyName
    ) {
      if (ts.isArrayLiteralExpression(property.initializer)) {
        for (const element of property.initializer.elements) {
          const extracted = extractModuleReference(element);
          if (extracted) {
            items.push(extracted);
          }
        }
      }
    }
  }

  return items;
}

/**
 * Extract a module reference from an array element
 * Handles: ModuleName, ModuleName.forRoot(), ModuleName.forRootAsync({...})
 */
function extractModuleReference(node: ts.Expression): ExtractedItem | null {
  // Simple identifier: ModuleName
  if (ts.isIdentifier(node)) {
    return { name: node.text, isDynamic: false };
  }

  // Call expression: ModuleName.forRoot() or ModuleName.forRootAsync({...})
  if (ts.isCallExpression(node)) {
    const callExpr = node;

    // Check if it's a method call on a class: ModuleName.forRoot()
    if (ts.isPropertyAccessExpression(callExpr.expression)) {
      const propAccess = callExpr.expression;
      const methodName = propAccess.name.text;

      // Get the class name
      if (ts.isIdentifier(propAccess.expression)) {
        return {
          name: propAccess.expression.text,
          isDynamic: true,
          dynamicMethod: methodName,
        };
      }
    }

    // Direct call expression - might be a function that returns a module
    if (ts.isIdentifier(callExpr.expression)) {
      return {
        name: callExpr.expression.text,
        isDynamic: true,
        dynamicMethod: "call",
      };
    }
  }

  // Spread element: ...modules
  if (ts.isSpreadElement(node)) {
    // Can't statically resolve spread elements
    return null;
  }

  return null;
}

/**
 * Find dynamic module methods (forRoot, forRootAsync, register, etc.)
 */
function findDynamicModuleMethods(classNode: ts.ClassDeclaration): string[] {
  const methods: string[] = [];
  const dynamicMethodNames = [
    "forRoot",
    "forRootAsync",
    "forFeature",
    "forFeatureAsync",
    "register",
    "registerAsync",
  ];

  for (const member of classNode.members) {
    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const methodName = member.name.text;
      if (dynamicMethodNames.includes(methodName)) {
        // Check if it's static
        const isStatic = member.modifiers?.some(
          (mod) => mod.kind === ts.SyntaxKind.StaticKeyword
        );
        if (isStatic) {
          methods.push(methodName);
        }
      }
    }
  }

  return methods;
}

/**
 * Find and parse all module files
 */
async function analyzeAllModules(srcDir: string): Promise<ModuleGraph> {
  const modules = new Map<string, ModuleInfo>();
  const edges: Array<{ from: string; to: string; isDynamic: boolean }> = [];

  // Find all .module.ts files
  const pattern = path.join(srcDir, "**/*.module.ts");
  const files: string[] = [];

  for await (const file of glob(pattern)) {
    files.push(file);
  }

  console.error(`Found ${files.length} module files`);

  // Parse each module file
  for (const filePath of files) {
    try {
      // Skip spec/test files
      if (filePath.includes(".spec.") || filePath.includes(".test.")) {
        continue;
      }

      const content = await fs.readFile(filePath, "utf-8");
      const moduleInfo = parseModuleFile(filePath, content);

      if (moduleInfo) {
        // Use relative path for cleaner display
        moduleInfo.filePath = path.relative(srcDir, filePath);

        // Handle duplicate module names (prefer the one with more imports)
        const existing = modules.get(moduleInfo.name);
        if (!existing || moduleInfo.imports.length > existing.imports.length) {
          modules.set(moduleInfo.name, moduleInfo);
          console.error(`  ✓ ${moduleInfo.name} (${moduleInfo.imports.length} imports)`);
        }
      }
    } catch (error) {
      console.error(`  ✗ Could not parse ${filePath}:`, (error as Error).message);
    }
  }

  // Build edges from imports
  for (const [moduleName, moduleInfo] of modules) {
    for (const importName of moduleInfo.imports) {
      // Add edge even if the imported module isn't in our graph (external module)
      const targetExists = modules.has(importName);
      edges.push({
        from: moduleName,
        to: importName,
        isDynamic: false, // Will be updated if needed
      });

      if (!targetExists) {
        // Create a placeholder for external/dynamic modules
        modules.set(importName, {
          name: importName,
          filePath: "external",
          imports: [],
          exports: [],
          controllers: [],
          providers: [],
          isGlobal: false,
          isDynamicModule: false,
          dynamicMethods: [],
        });
      }
    }
  }

  return { modules, edges };
}

/**
 * Categorize a module based on its file path
 */
function categorizeModule(info: ModuleInfo): "core" | "feature" | "config" | "external" | "app" {
  if (info.filePath === "external") return "external";
  if (info.filePath.includes("/core/") || info.filePath.includes("core/")) return "core";
  if (info.filePath.includes("/modules/") || info.filePath.includes("modules/")) return "feature";
  if (info.filePath.includes("/config/") || info.filePath.includes("config/")) return "config";
  return "app";
}

/**
 * Generate Mermaid diagram from module graph
 */
function generateMermaidDiagram(
  graph: ModuleGraph,
  options: {
    direction?: "TB" | "LR" | "BT" | "RL";
    includeExternal?: boolean;
    groupByCategory?: boolean;
  } = {}
): string {
  const { direction = "TB", includeExternal = true, groupByCategory = true } = options;

  const lines: string[] = [];
  lines.push(`flowchart ${direction}`);
  lines.push("");

  // Categorize modules
  const categories = {
    core: [] as string[],
    feature: [] as string[],
    config: [] as string[],
    external: [] as string[],
    app: [] as string[],
  };

  for (const [name, info] of graph.modules) {
    if (!includeExternal && info.filePath === "external") continue;
    const category = categorizeModule(info);
    categories[category].push(name);
  }

  // Helper to get node label
  const getNodeLabel = (name: string): string => {
    const info = graph.modules.get(name)!;
    const prefix = info.isGlobal ? "🌐 " : "";
    const suffix = info.isDynamicModule ? " ⚡" : "";
    return `${prefix}${name}${suffix}`;
  };

  // Define nodes with grouping
  if (groupByCategory) {
    if (categories.app.length > 0) {
      lines.push('  subgraph App["📦 App"]');
      for (const name of categories.app) {
        lines.push(`    ${sanitizeName(name)}["${getNodeLabel(name)}"]`);
      }
      lines.push("  end");
      lines.push("");
    }

    if (categories.config.length > 0) {
      lines.push('  subgraph Config["⚙️ Config"]');
      for (const name of categories.config) {
        lines.push(`    ${sanitizeName(name)}["${getNodeLabel(name)}"]`);
      }
      lines.push("  end");
      lines.push("");
    }

    if (categories.core.length > 0) {
      lines.push('  subgraph Core["🔧 Core"]');
      for (const name of categories.core) {
        lines.push(`    ${sanitizeName(name)}["${getNodeLabel(name)}"]`);
      }
      lines.push("  end");
      lines.push("");
    }

    if (categories.feature.length > 0) {
      lines.push('  subgraph Features["⭐ Features"]');
      for (const name of categories.feature) {
        lines.push(`    ${sanitizeName(name)}["${getNodeLabel(name)}"]`);
      }
      lines.push("  end");
      lines.push("");
    }

    if (includeExternal && categories.external.length > 0) {
      lines.push('  subgraph External["📚 External/NestJS"]');
      for (const name of categories.external) {
        lines.push(`    ${sanitizeName(name)}["${getNodeLabel(name)}"]`);
      }
      lines.push("  end");
      lines.push("");
    }
  } else {
    // No grouping - just define all nodes
    for (const [name] of graph.modules) {
      if (!includeExternal && graph.modules.get(name)!.filePath === "external") continue;
      lines.push(`  ${sanitizeName(name)}["${getNodeLabel(name)}"]`);
    }
    lines.push("");
  }

  // Add edges
  lines.push("  %% Dependencies (A --> B means A imports B)");
  const addedEdges = new Set<string>();

  for (const edge of graph.edges) {
    if (!includeExternal && graph.modules.get(edge.to)?.filePath === "external") continue;

    const edgeKey = `${edge.from}->${edge.to}`;
    if (!addedEdges.has(edgeKey)) {
      addedEdges.add(edgeKey);
      lines.push(`  ${sanitizeName(edge.from)} --> ${sanitizeName(edge.to)}`);
    }
  }

  // Add styling
  lines.push("");
  lines.push("  %% Styling");
  lines.push("  classDef global fill:#e1f5fe,stroke:#01579b,stroke-width:2px");
  lines.push("  classDef dynamic fill:#fff3e0,stroke:#ff6f00,stroke-width:2px");
  lines.push("  classDef external fill:#f5f5f5,stroke:#9e9e9e,stroke-dasharray:5 5");

  // Apply global style
  const globalModules = Array.from(graph.modules.values())
    .filter((m) => m.isGlobal)
    .map((m) => sanitizeName(m.name));
  if (globalModules.length > 0) {
    lines.push(`  class ${globalModules.join(",")} global`);
  }

  // Apply dynamic style
  const dynamicModules = Array.from(graph.modules.values())
    .filter((m) => m.isDynamicModule)
    .map((m) => sanitizeName(m.name));
  if (dynamicModules.length > 0) {
    lines.push(`  class ${dynamicModules.join(",")} dynamic`);
  }

  // Apply external style
  const externalModules = Array.from(graph.modules.values())
    .filter((m) => m.filePath === "external")
    .map((m) => sanitizeName(m.name));
  if (includeExternal && externalModules.length > 0) {
    lines.push(`  class ${externalModules.join(",")} external`);
  }

  return lines.join("\n");
}

/**
 * Sanitize module name for Mermaid
 */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Generate JSON output
 */
function generateJsonOutput(graph: ModuleGraph): string {
  const modules = Array.from(graph.modules.values()).map((m) => ({
    name: m.name,
    filePath: m.filePath,
    category: categorizeModule(m),
    imports: m.imports,
    exports: m.exports,
    controllers: m.controllers,
    providers: m.providers,
    isGlobal: m.isGlobal,
    isDynamicModule: m.isDynamicModule,
    dynamicMethods: m.dynamicMethods,
  }));

  return JSON.stringify(
    {
      modules,
      edges: graph.edges,
      stats: {
        totalModules: graph.modules.size,
        totalDependencies: graph.edges.length,
        globalModules: modules.filter((m) => m.isGlobal).length,
        dynamicModules: modules.filter((m) => m.isDynamicModule).length,
        byCategory: {
          core: modules.filter((m) => m.category === "core").length,
          feature: modules.filter((m) => m.category === "feature").length,
          config: modules.filter((m) => m.category === "config").length,
          external: modules.filter((m) => m.category === "external").length,
          app: modules.filter((m) => m.category === "app").length,
        },
      },
    },
    null,
    2
  );
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  output?: string;
  format: "mermaid" | "json";
  direction: "TB" | "LR" | "BT" | "RL";
  includeExternal: boolean;
  noGroup: boolean;
} {
  const args = process.argv.slice(2);
  const result = {
    format: "mermaid" as const,
    direction: "TB" as const,
    includeExternal: true,
    noGroup: false,
    output: undefined as string | undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--output":
      case "-o":
        result.output = args[++i];
        break;
      case "--format":
      case "-f":
        result.format = args[++i] as "mermaid" | "json";
        break;
      case "--direction":
      case "-d":
        result.direction = args[++i] as "TB" | "LR" | "BT" | "RL";
        break;
      case "--no-external":
        result.includeExternal = false;
        break;
      case "--no-group":
        result.noGroup = true;
        break;
      case "--help":
      case "-h":
        console.log(`
NestJS Module Dependency Diagram Generator

Analyzes @Module decorators statically (no runtime execution) to generate
accurate dependency diagrams.

Usage:
  bun run scripts/generate-module-diagram.ts [options]

Options:
  -o, --output <file>     Output file path (default: stdout)
  -f, --format <format>   Output format: mermaid or json (default: mermaid)
  -d, --direction <dir>   Diagram direction: TB, LR, BT, RL (default: TB)
  --no-external           Exclude external/NestJS modules from diagram
  --no-group              Don't group modules by category
  -h, --help              Show this help message

Examples:
  bun run scripts/generate-module-diagram.ts
  bun run scripts/generate-module-diagram.ts -o docs/module-diagram.md
  bun run scripts/generate-module-diagram.ts -f json -o module-graph.json
  bun run scripts/generate-module-diagram.ts -d LR --no-external

Legend:
  🌐 Global module (available everywhere)
  ⚡ Dynamic module (has forRoot/forRootAsync methods)
`);
        process.exit(0);
    }
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();
  const srcDir = path.resolve(process.cwd(), "src");

  console.error("🔍 Analyzing NestJS modules (static analysis)...\n");

  const graph = await analyzeAllModules(srcDir);

  // Filter out external modules for stats
  const internalModules = Array.from(graph.modules.values()).filter(
    (m) => m.filePath !== "external"
  );
  const externalModules = Array.from(graph.modules.values()).filter(
    (m) => m.filePath === "external"
  );

  console.error(`\n📊 Analysis complete:`);
  console.error(`   - Internal modules: ${internalModules.length}`);
  console.error(`   - External dependencies: ${externalModules.length}`);
  console.error(`   - Total edges: ${graph.edges.length}\n`);

  let output: string;

  if (args.format === "json") {
    output = generateJsonOutput(graph);
  } else {
    output = generateMermaidDiagram(graph, {
      direction: args.direction,
      includeExternal: args.includeExternal,
      groupByCategory: !args.noGroup,
    });

    // Wrap in markdown if outputting to file
    if (args.output) {
      const stats = {
        internal: internalModules.length,
        external: externalModules.length,
        global: internalModules.filter((m) => m.isGlobal).length,
        dynamic: internalModules.filter((m) => m.isDynamicModule).length,
      };

      output = `# NestJS Module Dependencies

> Generated on ${new Date().toISOString()}
> 
> This diagram shows the module dependencies in the NestJS application.
> - 🌐 indicates global modules
> - ⚡ indicates dynamic modules (forRoot/forRootAsync)
> - Arrows show import relationships (A → B means A imports B)

\`\`\`mermaid
${output}
\`\`\`

## Statistics

| Metric | Count |
|--------|-------|
| Internal Modules | ${stats.internal} |
| External Dependencies | ${stats.external} |
| Global Modules | ${stats.global} |
| Dynamic Modules | ${stats.dynamic} |
| Total Dependencies | ${graph.edges.length} |

## Module Details

### Internal Modules

| Module | Category | Global | Dynamic | Imports | Exports |
|--------|----------|--------|---------|---------|---------|
${internalModules
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(
    (m) =>
      `| ${m.name} | ${categorizeModule(m)} | ${m.isGlobal ? "✓" : ""} | ${m.isDynamicModule ? "✓" : ""} | ${m.imports.length} | ${m.exports.length} |`
  )
  .join("\n")}

### External Dependencies

${externalModules.map((m) => `- ${m.name}`).join("\n") || "None detected"}
`;
    }
  }

  if (args.output) {
    await fs.writeFile(args.output, output, "utf-8");
    console.error(`✅ Output written to ${args.output}`);
  } else {
    console.log(output);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
