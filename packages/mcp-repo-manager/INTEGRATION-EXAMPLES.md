# MCP Repo Manager Integration Examples

This document provides examples of how to integrate the MCP Repo Manager with various AI tools and MCP clients.

## Claude Desktop Integration

Add the following to your Claude Desktop MCP configuration file:

### macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "repo-manager": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/path/to/your/monorepo/root"
    }
  }
}
```

### Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "repo-manager": {
      "command": "bun.exe",
      "args": ["run", "mcp"],
      "cwd": "C:\\path\\to\\your\\monorepo\\root"
    }
  }
}
```

## Using with MCP Inspector

Test your server with the MCP Inspector:

```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Test HTTP endpoint
npx @modelcontextprotocol/inspector http://localhost:3002/mcp

# Test with CLI
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/list

# Call a tool
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name list-packages
```

## Python Client Example

```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    server_params = StdioServerParameters(
        command="bun",
        args=["run", "mcp"],
        cwd="/path/to/your/monorepo"
    )
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # List available tools
            tools = await session.list_tools()
            print("Available tools:", [tool.name for tool in tools.tools])
            
            # List packages
            result = await session.call_tool("list-packages", {})
            print("Packages:", result.content[0].text)
            
            # Create a new package
            result = await session.call_tool("create-package", {
                "name": "my-new-package",
                "description": "A new utility package",
                "template": "basic"
            })
            print("Created package:", result.content[0].text)

if __name__ == "__main__":
    asyncio.run(main())
```

## Node.js Client Example

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', 'mcp'],
    cwd: '/path/to/your/monorepo'
  });

  const client = new Client(
    { name: "repo-manager-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  try {
    // List tools
    const tools = await client.listTools();
    console.log('Available tools:', tools.tools.map(t => t.name));

    // Get workspace structure
    const result = await client.callTool({
      name: 'get-workspace-structure',
      arguments: {}
    });
    
    console.log('Workspace structure:', result.content);

    // Create a new React app
    const createResult = await client.callTool({
      name: 'create-app',
      arguments: {
        name: 'my-new-app',
        type: 'nextjs',
        template: 'typescript'
      }
    });
    
    console.log('Created app:', createResult.content);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
```

## Example Tool Usage

### List all packages and apps
```bash
# Using MCP Inspector CLI
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name list-packages

npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name list-apps
```

### Create a new utility package
```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name create-package \
  --tool-arg name=date-utils \
  --tool-arg description="Date utility functions" \
  --tool-arg template=utils
```

### Create a new Next.js application
```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name create-app \
  --tool-arg name=admin-dashboard \
  --tool-arg type=nextjs \
  --tool-arg template=typescript
```

### Show package dependencies
```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name show-package-deps \
  --tool-arg name="@repo/ui"
```

### Modify package (add dependency)
```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name modify-package \
  --tool-arg name="@repo/ui" \
  --tool-arg operation=add-dep \
  --tool-arg key=lodash \
  --tool-arg value="catalog:utils" \
  --tool-arg section=dependencies
```

### Get workspace analysis
```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp \
  --transport http \
  --method tools/call \
  --tool-name analyze-dependencies
```

## Configuration Options

The MCP server can be configured through environment variables:

```bash
# Set custom port
export PORT=3003

# Set custom repository root (if different from cwd)
export REPO_ROOT=/path/to/monorepo

# Set custom packages directory
export PACKAGES_DIR=packages

# Set custom apps directory  
export APPS_DIR=apps
```

## Troubleshooting

### Common Issues

1. **Server not starting**: Ensure all dependencies are installed with `bun install`
2. **Tools not found**: Check that the server is properly detecting the monorepo structure
3. **Permission errors**: Ensure the server has write permissions for package creation
4. **Port conflicts**: Use a different port with the `PORT` environment variable

### Debug Mode

Enable detailed logging:

```bash
# Set debug environment
export DEBUG=mcp:*
bun run mcp:dev
```

### Logs

Check server logs for detailed information:

```bash
# View server logs
bun run mcp:dev

# Or check specific package logs
bun run @repo/mcp-repo-manager dev
```