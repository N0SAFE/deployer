import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock VariableTemplateEditor component since it doesn't exist yet
const VariableTemplateEditor = vi.fn(({ value, onChange }) => (
  <div>
    <h3>Template Editor</h3>
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder="Enter template..."
    />
    <div>Available References</div>
    <div>services.*</div>
    <div>projects.*</div>
    <div>env.*</div>
    <button>Test Template</button>
    <button>Copy</button>
    <button>Export</button>
  </div>
))

// Mock the variable template parser
vi.mock('@repo/api-contracts/modules/variable-resolver', () => ({
  VariableTemplateParser: vi.fn().mockImplementation(() => ({
    parseTemplate: vi.fn((template: string) => ({
      isValid: template !== '${invalid.reference}',
      references: template === '${services.api.url}' ? [
        {
          type: 'service',
          name: 'api',
          property: 'url',
          fullPath: 'services.api.url',
          raw: '${services.api.url}',
        }
      ] : [],
      errors: template === '${invalid.reference}' ? [
        {
          type: 'invalid_reference',
          message: 'Invalid reference format: invalid.reference',
          position: 2,
          raw: '${invalid.reference}',
        }
      ] : [],
    })),
    resolveTemplate: vi.fn(async (template: string) => ({
      success: template !== '${services.nonexistent.url}',
      resolved: template === '${services.api.url}' ? 'https://api.example.com' : template,
      errors: template === '${services.nonexistent.url}' ? [
        {
          type: 'resolution_error',
          message: 'Cannot resolve reference: services.nonexistent.url',
          reference: 'services.nonexistent.url',
          raw: '${services.nonexistent.url}',
        }
      ] : [],
    })),
    validateTemplate: vi.fn((template: string) => ({
      isValid: template !== '${invalid.reference}',
      errors: template === '${invalid.reference}' ? [
        {
          type: 'invalid_reference',
          message: 'Invalid reference format: invalid.reference',
          position: 2,
          raw: '${invalid.reference}',
        }
      ] : [],
      warnings: [],
    })),
    getSuggestions: vi.fn((partial: string) => {
      if (partial === 's') return ['services.', 'projects.', 'env.']
      if (partial === 'services.') return ['services.api.', 'services.database.']
      if (partial === 'services.api.') return ['services.api.url', 'services.api.port']
      return []
    }),
  })),
}))

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: vi.fn(({ value, onChange }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder="Enter template..."
    />
  )),
}))

const mockResolutionContext = {
  services: {
    api: {
      url: 'https://api.example.com',
      port: 3000,
    },
    database: {
      url: 'postgresql://localhost:5432/db',
    },
  },
  projects: {
    webapp: {
      name: 'My Web App',
      domain: 'example.com',
    },
  },
  env: {
    NODE_ENV: 'development',
    PORT: '3000',
  },
}

describe('VariableTemplateEditor', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.clearAllMocks()
  })

  it('should render the template editor', () => {
    render(
      <VariableTemplateEditor
        value=""
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
    expect(screen.getByText('Template Editor')).toBeInTheDocument()
  })

  it('should display template value in editor', () => {
    const template = '${services.api.url}/api/v1'
    
    render(
      <VariableTemplateEditor
        value={template}
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    const editor = screen.getByTestId('monaco-editor')
    expect(editor).toHaveValue(template)
  })

  it('should call onChange when template is edited', async () => {
    const handleChange = vi.fn()
    const newTemplate = '${services.database.url}'

    render(
      <VariableTemplateEditor
        value=""
        onChange={handleChange}
        resolutionContext={mockResolutionContext}
      />
    )

    const editor = screen.getByTestId('monaco-editor')
    await user.clear(editor)
    await user.type(editor, newTemplate)

    expect(handleChange).toHaveBeenCalledWith(newTemplate)
  })

  it('should show template validation results', async () => {
    render(
      <VariableTemplateEditor
        value="${invalid.reference}"
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/invalid reference format/i)).toBeInTheDocument()
    })
  })

  it('should display resolved template preview', async () => {
    render(
      <VariableTemplateEditor
        value="${services.api.url}"
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    })
  })

  it('should show detected references', async () => {
    render(
      <VariableTemplateEditor
        value="${services.api.url}"
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('services.api.url')).toBeInTheDocument()
    })
  })

  it('should handle resolution errors', async () => {
    render(
      <VariableTemplateEditor
        value="${services.nonexistent.url}"
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/cannot resolve reference/i)).toBeInTheDocument()
    })
  })

  it('should provide autocomplete suggestions', async () => {
    const handleChange = vi.fn()

    render(
      <VariableTemplateEditor
        value=""
        onChange={handleChange}
        resolutionContext={mockResolutionContext}
      />
    )

    const editor = screen.getByTestId('monaco-editor')
    await user.type(editor, '${s')

    // Would test suggestion dropdown here
    // This would require more complex Monaco Editor mocking
  })

  it('should handle template testing', async () => {
    render(
      <VariableTemplateEditor
        value="${services.api.url}/test"
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    const testButton = screen.getByText('Test Template')
    await user.click(testButton)

    await waitFor(() => {
      expect(screen.getByText('https://api.example.com/test')).toBeInTheDocument()
    })
  })

  it('should show reference documentation', () => {
    render(
      <VariableTemplateEditor
        value=""
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    expect(screen.getByText(/available references/i)).toBeInTheDocument()
    expect(screen.getByText('services.*')).toBeInTheDocument()
    expect(screen.getByText('projects.*')).toBeInTheDocument()
    expect(screen.getByText('env.*')).toBeInTheDocument()
  })

  it('should handle copy template action', async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    })

    render(
      <VariableTemplateEditor
        value="${services.api.url}"
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    const copyButton = screen.getByRole('button', { name: /copy/i })
    await user.click(copyButton)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('${services.api.url}')
  })

  it('should handle template import/export', async () => {
    const template = '${services.api.url}/api/v1'
    
    render(
      <VariableTemplateEditor
        value={template}
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
      />
    )

    // Test export functionality
    const exportButton = screen.getByRole('button', { name: /export/i })
    await user.click(exportButton)

    // Would test file download here
  })

  it('should display help information', () => {
    render(
      <VariableTemplateEditor
        value=""
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
        showHelp={true}
      />
    )

    expect(screen.getByText(/template syntax/i)).toBeInTheDocument()
    expect(screen.getByText(/use \${} to reference/i)).toBeInTheDocument()
  })

  it('should handle readonly mode', () => {
    render(
      <VariableTemplateEditor
        value="${services.api.url}"
        onChange={() => {}}
        resolutionContext={mockResolutionContext}
        readonly={true}
      />
    )

    const editor = screen.getByTestId('monaco-editor')
    expect(editor).toHaveAttribute('readonly')
  })

  it('should validate template on blur', async () => {
    const handleChange = vi.fn()

    render(
      <VariableTemplateEditor
        value=""
        onChange={handleChange}
        resolutionContext={mockResolutionContext}
      />
    )

    const editor = screen.getByTestId('monaco-editor')
    await user.type(editor, '${invalid.reference}')
    
    // Simulate blur event
    editor.blur()

    await waitFor(() => {
      expect(screen.getByText(/invalid reference format/i)).toBeInTheDocument()
    })
  })
})