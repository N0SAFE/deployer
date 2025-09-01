const { createNodeConfig } = require('@repo/vitest-config/vitest.config.node');

export default createNodeConfig({
  test: {
    name: 'mcp-repo-manager'
  }
});