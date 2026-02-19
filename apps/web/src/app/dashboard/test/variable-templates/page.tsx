'use client'

import { VariableTemplateEditor } from '@/components/environment/VariableTemplateEditor'

export default function VariableTemplateTestPage() {
  return (
    <div className="container max-w-6xl mx-auto py-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Variable Template Editor</h1>
          <p className="text-muted-foreground mt-2">
            Test the dynamic variable resolution system with live templates
          </p>
        </div>

        <VariableTemplateEditor
          initialTemplate=""
          onTemplateChange={(template) => console.log('Template changed:', template)}
          onResolutionChange={(result) => console.log('Resolution result:', result)}
        />
      </div>
    </div>
  )
}