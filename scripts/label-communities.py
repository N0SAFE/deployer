#!/usr/bin/env python3
"""Generate community labels based on node content analysis."""
import json
from pathlib import Path
from collections import Counter
import re

BASE = Path('/home/sebille/Bureau/projects/tests/deployer/v3')
graph = json.loads((BASE / 'graphify-out/graph.json').read_text(encoding='utf-8'))

# Build community -> node data
comm_data = {}
for n in graph['nodes']:
    cid = n.get('community', -1)
    if cid not in comm_data:
        comm_data[cid] = {'labels': [], 'file_types': [], 'source_files': [], 'norm_labels': []}
    comm_data[cid]['labels'].append(n.get('label', ''))
    comm_data[cid]['file_types'].append(n.get('file_type', ''))
    comm_data[cid]['source_files'].append(n.get('source_file', ''))
    comm_data[cid]['norm_labels'].append(n.get('norm_label', ''))

# Domain-specific keyword mappings for known patterns
DOMAIN_KEYWORDS = {
    'docker': ['docker', 'container', 'image', 'volume', 'network', 'compose'],
    'auth': ['auth', 'login', 'permission', 'role', 'user', 'session', 'token'],
    'mesh': ['mesh', 'peer', 'topology', 'fleet', 'discovery', 'relay'],
    'deployment': ['deploy', 'rollback', 'queue', 'phase', 'status', 'migration'],
    'orpc': ['orpc', 'contract', 'procedure', 'handler', 'implement'],
    'ui': ['component', 'dialog', 'button', 'accordion', 'calendar', 'popover', 'table'],
    'api': ['controller', 'service', 'repository', 'module', 'nestjs'],
    'db': ['schema', 'drizzle', 'postgres', 'sqlite', 'database', 'migration'],
    'test': ['test', 'spec', 'e2e', 'mock', 'vitest'],
    'config': ['config', 'eslint', 'prettier', 'typescript', 'tailwind'],
    'doc': ['doc', 'readme', 'mdx', 'documentation'],
    'error': ['error', 'exception', 'validation', 'notfound'],
    'stream': ['stream', 'sse', 'observable', 'event', 'rx'],
    'mesh-stream': ['streamstore', 'sharedstream', 'ownership', 'namespace'],
    'trust': ['trust', 'keyring', 'signing', 'certificate'],
}

def score_domain(label):
    """Score how well a label matches each domain."""
    if label is None:
        return {}
    label_lower = label.lower()
    scores = {}
    for domain, keywords in DOMAIN_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in label_lower)
        if score > 0:
            scores[domain] = score
    return scores

def generate_label(nodes, cid):
    """Generate a concise label for a community."""
    labels = nodes['labels']
    file_types = nodes['file_types']
    source_files = nodes['source_files']
    norm_labels = nodes['norm_labels']
    
    # Count domain scores across all labels
    domain_scores = Counter()
    for lbl in labels:
        scores = score_domain(lbl)
        for k, v in scores.items():
            domain_scores[k] += v
    
    # Count file types
    ft_counter = Counter(ft for ft in file_types if ft)
    
    # Count non-trivial labels (not empty, not just file paths)
    meaningful = [l for l in labels if l and l is not None and '/' not in l and len(l) > 3 and l != 'index.ts']
    label_counter = Counter(meaningful)
    
    # Try to find a distinctive common pattern
    # Look at source file paths for patterns
    path_patterns = Counter()
    for sf in source_files:
        if sf is None:
            continue
        parts = sf.split('/')
        # Take the last meaningful directory
        for i, p in enumerate(parts):
            if p in ['modules', 'packages', 'apps', 'src', 'components']:
                if i + 1 < len(parts):
                    path_patterns[parts[i+1]] += 1
    
    # Determine domain from source files
    source_counter = Counter()
    for sf in source_files:
        if sf is None:
            continue
        for domain, keywords in DOMAIN_KEYWORDS.items():
            if any(kw in sf.lower() for kw in keywords):
                source_counter[domain] += 1
    
    # Combine domain signals
    combined_domain = domain_scores + source_counter
    
    # Get the top domain
    top_domain = combined_domain.most_common(1)
    domain_name = top_domain[0][0] if top_domain else ''
    
    # Get top meaningful label
    top_label = label_counter.most_common(1)
    label_name = top_label[0][0] if top_label else ''
    
    # Build label from domain + label
    domain_map = {
        'docker': 'Docker',
        'auth': 'Auth & Permissions', 
        'mesh': 'Mesh Networking',
        'deployment': 'Deployment',
        'orpc': 'ORPC Contracts',
        'ui': 'UI Components',
        'api': 'API Layer',
        'db': 'Database Schema',
        'test': 'Tests',
        'config': 'Config',
        'doc': 'Documentation',
        'error': 'Error Handling',
        'stream': 'Streaming Events',
        'mesh-stream': 'Mesh Stream Store',
        'trust': 'Trust & Security',
    }
    
    if domain_name in domain_map:
        base = domain_map[domain_name]
    else:
        base = f'Community {cid}'
    
    # Add specific label if available
    if label_name and label_name != base:
        # Clean up label
        clean = re.sub(r'[(){}\[\]]', '', label_name)
        if clean and clean != base:
            return f'{base} — {clean}'
    
    # Fall back to file type based label
    ft = ft_counter.most_common(1)
    if ft:
        ft_name = ft[0][0]
        if ft_name == 'ts' or ft_name == 'tsx':
            return f'{base} — TypeScript'
        if ft_name == 'md':
            return f'{base} — Documentation'
        if ft_name == 'svg':
            return f'{base} — SVG Assets'
    
    return f'{base} ({len(labels)} nodes)'

# Generate labels for all communities
labels = {}
for cid in sorted(comm_data.keys()):
    labels[str(cid)] = generate_label(comm_data[cid], cid)

# Save labels
(BASE / 'graphify-out/.graphify_labels.json').write_text(
    json.dumps(labels, indent=2, ensure_ascii=False), encoding='utf-8')
print(f"Generated {len(labels)} community labels")

# Show sample of top communities
sorted_comms = sorted(comm_data.items(), key=lambda x: -len(x[1]['labels']))
print("\n=== Top 30 Community Labels ===")
for cid, data in sorted_comms[:30]:
    print(f"  Community {cid} ({len(data['labels'])} nodes): {labels[str(cid)]}")
