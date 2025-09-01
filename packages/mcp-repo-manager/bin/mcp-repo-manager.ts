#!/usr/bin/env bun
/**
 * CLI wrapper for the MCP Repo Manager server
 * 
 * Usage:
 *   bun run mcp-repo-manager           # Start server
 *   bun run mcp-repo-manager --help    # Show help
 */

import { spawn } from 'child_process';
import { join } from 'path';

const packageDir = join(__dirname, '..');
const args = process.argv.slice(2);

// Default to start command if no args provided
const command = args.length === 0 ? ['start'] : args;

// Help message
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
MCP Repo Manager - Model Context Protocol Server for Monorepo Management

USAGE:
  bun run mcp-repo-manager [COMMAND] [OPTIONS]

COMMANDS:
  start       Start the MCP server (default)
  dev         Start in development mode with watch
  build       Build the server
  test        Run tests
  
OPTIONS:
  --help, -h  Show this help message
  --port      Set the server port (default: 3002)

EXAMPLES:
  bun run mcp-repo-manager                    # Start server on port 3002
  bun run mcp-repo-manager dev                # Development mode
  bun run mcp-repo-manager --port 3003       # Custom port

MCP ENDPOINTS:
  HTTP:  http://localhost:[PORT]/mcp
  SSE:   http://localhost:[PORT]/mcp/sse

The server provides tools for:
  - Listing packages and apps
  - Creating new packages/apps
  - Managing dependencies
  - Analyzing workspace structure
  - Package template management
`);
  process.exit(0);
}

// Start the appropriate command
const child = spawn('bun', ['run', ...command], {
  cwd: packageDir,
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Failed to start MCP Repo Manager:', err);
  process.exit(1);
});