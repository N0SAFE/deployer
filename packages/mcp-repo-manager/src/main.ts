import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false // Disable logging for STDIO mode to avoid interfering with MCP protocol
    });
    
    // For STDIO mode, we don't need to start an HTTP server
    // The McpModule will handle STDIO transport automatically
    
    // Keep the application running
    process.on('SIGTERM', () => {
      app.close();
    });
    
    process.on('SIGINT', () => {
      app.close();
    });

  } catch (error) {
    Logger.error('Failed to start MCP server', error);
    process.exit(1);
  }
}

bootstrap();
