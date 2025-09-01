import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from '@rekog/mcp-nest';
import { RepositoryTool } from './tools/repository.tool';
import { CreationTool } from './tools/creation.tool';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'MCP Repository Manager',
      version: '1.0.0',
      transport: [McpTransportType.STDIO],
    }),
  ],
  providers: [RepositoryTool, CreationTool],
})
export class AppModule {}
