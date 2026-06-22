"""Fix MDX math in doc content files.
- Replace $$...$$ blocks with ```latex ... ``` fenced code blocks
- Replace inline $...$ with `...` backtick code spans
- Fix YAML frontmatter issues
"""
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent / 'apps/doc/content/docs'

def fix_file(filepath: Path) -> bool:
    """Returns True if file was modified."""
    text = filepath.read_text()
    original = text
    lines = text.split('\n')

    # Phase 1: Multi-line $$...$$ blocks → ```latex ... ```
    # Process at file level to match across lines
    def _replace_block(m):
        inner = m.group(1).strip()
        return f'```latex\n{inner}\n```'

    text = re.sub(r'\$\$\n?(.*?)\n?\$\$', _replace_block, text, flags=re.DOTALL)

    # Phase 2: Inline $...$ → `...`
    # Process line by line, respecting backtick code spans
    new_lines = text.split('\n')
    in_fenced = False
    for i, line in enumerate(new_lines):
        stripped = line.lstrip()
        if stripped.startswith('```'):
            in_fenced = not in_fenced
            continue
        if in_fenced:
            continue

        # Split on backticks: even indices are outside code spans, odd indices are inside
        parts = line.split('`')
        for j, part in enumerate(parts):
            if j % 2 == 0:
                # Outside backticks: replace $...$ with `...`
                def _replace_inline(m):
                    inner = m.group(1)
                    return f'`{inner}`'
                parts[j] = re.sub(r'\$([^$\n]+)\$', _replace_inline, part)
        new_line = ''.join(parts)
        if new_line != line:
            new_lines[i] = new_line

    result = '\n'.join(new_lines)

    # Phase 3: Fix YAML frontmatter with unquoted colons
    # docker-standalone-first-roadmap.mdx specific
    if 'docker-standalone-first-roadmap' in str(filepath):
        result = re.sub(
            r'description: Canonical two-phase plan: deliver full Docker operator capabilities first, then add deployment/project/service linkage as optional enrichment\.',
            'description: "Canonical two-phase plan: deliver full Docker operator capabilities first, then add deployment/project/service linkage as optional enrichment."',
            result
        )

    if result != original:
        filepath.write_text(result)
        return True
    return False

# Fix all MDX files
fixed = []
for p in sorted(BASE.rglob('*.mdx')):
    if fix_file(p):
        fixed.append(p.relative_to(BASE))

print(f'Fixed {len(fixed)} files:')
for f in fixed:
    print(f'  {f}')
