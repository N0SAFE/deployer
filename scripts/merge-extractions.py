#!/usr/bin/env python3
"""Merge existing graph.json AST data with all chunk extraction files."""
import json
import glob
from pathlib import Path

BASE = Path('/home/sebille/Bureau/projects/tests/deployer/v3')

# 1. Read existing graph.json
graph = json.loads((BASE / 'graphify-out/graph.json').read_text(encoding='utf-8'))

ast_nodes = graph.get('nodes', [])
ast_edges = graph.get('links', [])

print(f"AST data from graph.json: {len(ast_nodes)} nodes, {len(ast_edges)} edges")

# 2. Merge all chunk extraction files
chunk_files = sorted(glob.glob(str(BASE / 'graphify-out/chunk-*-extraction.json')))
all_sem_nodes, all_sem_edges, all_sem_hyperedges = [], [], []
total_in, total_out = 0, 0

for cf in chunk_files:
    d = json.loads(Path(cf).read_text(encoding='utf-8'))
    all_sem_nodes += d.get('nodes', [])
    all_sem_edges += d.get('edges', [])
    all_sem_hyperedges += d.get('hyperedges', [])
    total_in += d.get('input_tokens', 0)
    total_out += d.get('output_tokens', 0)

print(f"Semantic from {len(chunk_files)} chunks: {len(all_sem_nodes)} nodes, {len(all_sem_edges)} edges, {len(all_sem_hyperedges)} hyperedges")
print(f"Token usage: {total_in:,} in / {total_out:,} out")

# 3. Deduplicate semantic nodes by ID
seen = set()
deduped_sem = []
for n in all_sem_nodes:
    nid = n.get('id', '')
    if nid not in seen:
        seen.add(nid)
        deduped_sem.append(n)

# 4. Write semantic JSON
semantic = {
    'nodes': deduped_sem,
    'edges': all_sem_edges,
    'hyperedges': all_sem_hyperedges,
    'input_tokens': total_in,
    'output_tokens': total_out,
}
(BASE / 'graphify-out/.graphify_semantic.json').write_text(
    json.dumps(semantic, indent=2, ensure_ascii=False), encoding='utf-8')
print(f"Semantic saved: {len(deduped_sem)} nodes (after dedup)")

# 5. Merge AST + semantic into final extraction
seen_ast = {n.get('id', '') for n in ast_nodes}
merged_nodes = list(ast_nodes)
for n in deduped_sem:
    nid = n.get('id', '')
    if nid not in seen_ast:
        merged_nodes.append(n)
        seen_ast.add(nid)

merged_edges = ast_edges + all_sem_edges
merged_hyperedges = all_sem_hyperedges

extraction = {
    'nodes': merged_nodes,
    'edges': merged_edges,
    'hyperedges': merged_hyperedges,
    'input_tokens': total_in,
    'output_tokens': total_out,
}
(BASE / 'graphify-out/.graphify_extract.json').write_text(
    json.dumps(extraction, indent=2, ensure_ascii=False), encoding='utf-8')
print(f"Extraction merged: {len(merged_nodes)} nodes, {len(merged_edges)} edges ({len(ast_nodes)} AST + {len(deduped_sem)} semantic)")

# 6. Write detect file for Step 4
all_files_seen = set()
for cf in chunk_files:
    d = json.loads(Path(cf).read_text(encoding='utf-8'))
    for n in d.get('nodes', []):
        sf = n.get('source_file', '')
        if sf:
            all_files_seen.add(sf)

detect_data = {
    'total_files': len(all_files_seen),
    'total_words': 0,
    'files': {'code': [], 'document': [], 'paper': [], 'image': []},
    'scan_root': str(BASE),
    'skipped_sensitive': []
}
(BASE / 'graphify-out/.graphify_detect.json').write_text(
    json.dumps(detect_data, ensure_ascii=False), encoding='utf-8')
print(f"Detect file written: {detect_data['total_files']} unique source files")
print("Done!")
