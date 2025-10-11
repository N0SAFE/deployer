import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Import the actual component
import { VariableTemplateEditor } from './VariableTemplateEditor'

// Mock the variable template parser
vi.mock('./variable-template-parser', () => ({
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
  })),
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
        initialTemplate=""
        onTemplateChange={() => {}}
        context={mockResolutionContext}
      />
    )

    expect(screen.getByLabelText('Variable Template')).toBeInTheDocument()
    expect(screen.getByText('Variable Template Editor')).toBeInTheDocument()
  })

  it('should display template value in editor', () => {
    const template = '${services.api.url}/api/v1'
    
    render(
      <VariableTemplateEditor
        initialTemplate={template}
        onTemplateChange={() => {}}
        context={mockResolutionContext}
      />
    )

    const textarea = screen.getByLabelText('Variable Template')
    expect(textarea).toHaveValue(template)
  })

  it('should call onChange when template changes', async () => {
    const handleChange = vi.fn()

    render(
      <VariableTemplateEditor
        initialTemplate=""
        onTemplateChange={handleChange}
        context={mockResolutionContext}
      />
    )

    const textarea = screen.getByLabelText('Variable Template')
    await user.click(textarea)
    await user.paste('${services.api.url}')

    expect(handleChange).toHaveBeenCalled()
  })

  it('should show validation status', async () => {
    render(
      <VariableTemplateEditor
        initialTemplate="${services.api.url}"
        onTemplateChange={() => {}}
        context={mockResolutionContext}
      />
    )

    // Should show valid syntax badge
    expect(screen.getByText('Valid Syntax')).toBeInTheDocument()
    expect(screen.getByText('1 Reference')).toBeInTheDocument()
  })

  it('should handle template resolution', async () => {
    render(
      <VariableTemplateEditor
        initialTemplate="${services.api.url}"
        onTemplateChange={() => {}}
        context={mockResolutionContext}
      />
    )

    // Click the resolve button
    const resolveButton = screen.getByText('Resolve')
    await user.click(resolveButton)

    // Click on preview tab to see resolved value
    const previewTab = screen.getByText('Preview')
    await user.click(previewTab)

    await waitFor(() => {
      expect(screen.getByText('Resolved Successfully')).toBeInTheDocument()
    })
  })

  it('should show references in references tab', async () => {
    render(
      <VariableTemplateEditor
        initialTemplate="${services.api.url}"
        onTemplateChange={() => {}}
        context={mockResolutionContext}
      />
    )

    // Click on references tab
    const referencesTab = screen.getByText('References')
    await user.click(referencesTab)

    await waitFor(() => {
      expect(screen.getByText('services.api.url')).toBeInTheDocument()
    })
  })

  it('should show examples in examples tab', async () => {
    render(
      <VariableTemplateEditor
        initialTemplate=""
        onTemplateChange={() => {}}
        context={mockResolutionContext}
      />
    )

    // Click on examples tab
    const examplesTab = screen.getByText('Examples')
    await user.click(examplesTab)

    await waitFor(() => {
      expect(screen.getByText('Simple Project Reference')).toBeInTheDocument()
    })
  })

  it('should use example template when clicked', async () => {
    const handleChange = vi.fn()

    render(
      <VariableTemplateEditor
        initialTemplate=""
        onTemplateChange={handleChange}
        context={mockResolutionContext}
      />
    )

    // Click on examples tab
    const examplesTab = screen.getByText('Examples')
    await user.click(examplesTab)

    // Find and click a "Use Example" button
    const useExampleButtons = await screen.findAllByText('Use Example')
    await user.click(useExampleButtons[0])

    // Should switch back to editor tab and set template
    expect(handleChange).toHaveBeenCalled()
  })
})