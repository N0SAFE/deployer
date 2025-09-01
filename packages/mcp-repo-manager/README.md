# @repo/mcp-repo-manager

A Model Context Protocol (MCP) server for managing monorepo operations. This package provides a comprehensive MCP server built with NestJS that enables AI assistants to perform repository management tasks.

## Features

### Core Repository Operations
- **List Packages**: Enumerate all packages in the monorepo with metadata
- **List Apps**: Enumerate all applications in the monorepo with metadata
- **Show Dependencies**: Display package dependencies and dependency trees
- **Package Information**: Get detailed information about specific packages/apps

### Package/App Management
- **Create Packages**: Generate new packages with templates
- **Create Apps**: Generate new applications with CLI tools (create-next-app, create-react-app, etc.)
- **Modify Packages**: Update package configurations, dependencies, and scripts
- **Template Management**: Handle package templates and generation patterns

### Advanced Operations
- **Dependency Analysis**: Analyze dependency relationships across the monorepo
- **Workspace Management**: Manage workspace configurations and settings
- **Build Pipeline**: Interface with Turbo and build systems
- **Git Integration**: Handle git operations for package changes

## MCP Server Capabilities

This server exposes the following MCP capabilities:

### Tools
- `list-packages`: List all packages in the monorepo
- `list-apps`: List all applications in the monorepo
- `show-package-deps`: Show dependencies for a specific package
- `show-app-deps`: Show dependencies for a specific app
- `create-package`: Create a new package with template
- `create-app`: Create a new application using CLI generators
- `modify-package`: Modify package configuration
- `get-package-info`: Get detailed package information
- `analyze-dependencies`: Analyze dependency relationships

### Resources
- Package configurations and metadata
- Workspace structure information
- Dependency trees and analysis

## Usage

### As MCP Server
The server can be used as an MCP server by AI assistants:

```bash
bun run dev  # Start in development mode
bun run start  # Start in production mode
```

### Development
```bash
bun run build      # Build the server
bun run test       # Run tests
bun run lint       # Run linting
```

## Configuration

The server automatically detects the monorepo structure and available packages/apps. Configuration can be customized through environment variables:

- `REPO_ROOT`: Root directory of the monorepo (default: auto-detected)
- `PACKAGES_DIR`: Directory containing packages (default: 'packages')
- `APPS_DIR`: Directory containing apps (default: 'apps')

## Integration

This MCP server integrates with:
- **Turbo**: For build pipeline management
- **Package Managers**: Bun, npm, yarn for dependency management
- **CLI Generators**: create-next-app, create-react-app, and other generators
- **Git**: For version control operations
- **Workspace Tools**: For monorepo management

Built with ❤️ using NestJS and MCP-Nest.

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
