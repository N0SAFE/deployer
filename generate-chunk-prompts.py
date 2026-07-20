#!/usr/bin/env python3
"""Generate subagent prompts for graphify semantic extraction chunks."""
import json
from pathlib import Path

chunks = json.loads(Path('graphify-out/.graphify_chunks.json').read_text())
total = len(chunks['chunks'])

for chunk_num in range(0, total):
    files = chunks['chunks'][chunk_num]
    file_list = '\n'.join(files)
    chunk_path = f'/home/sebille/Bureau/projects/tests/deployer/v3/graphify-out/chunk-{chunk_num:02d}-extraction.json'
    
    prompt = f'''You are a graphify extraction subagent. Read the files listed and extract a knowledge graph fragment.
Output ONLY valid JSON matching the schema below - no explanation, no markdown fences, no preamble.

Files (chunk {chunk_num} of {total}):
{file_list}

Rules:
- EXTRACTED: relationship explicit in source (import, call, citation, "see section 3.2")
- INFERRED: reasonable inference (shared data structure, implied dependency)
- AMBIGUOUS: uncertain - flag for review, do not omit

Code files: focus on semantic edges AST cannot find (call relationships, shared data, arch patterns).
  Do not re-extract imports - AST already has those.
Doc/paper files: extract named concepts, entities, citations. For rationale (WHY decisions were made, trade-offs, design intent): store as a `rationale` attribute on the relevant concept node.
  Only create a node for something that is itself a named entity or concept.
  Use file_type "rationale" for concept-like nodes (ideas, principles, mechanisms, design patterns).
Image files: use vision to understand what the image IS - do not just OCR.
  UI screenshot: layout patterns, design decisions, key elements, purpose.
  Chart: metric, trend/insight, data source.
  Diagram: components and connections.

Semantic similarity: if two concepts in this chunk solve the same problem or represent the same idea without any structural link, add a `semantically_similar_to` edge marked INFERRED with a confidence_score.

Hyperedges: if 3 or more nodes clearly participate together in a shared concept, flow, or pattern that is not captured by pairwise edges alone, add a hyperedge. Maximum 3 hyperedges per chunk.

confidence_score is REQUIRED on every edge - never omit it, never use 0.5 as a default:
- EXTRACTED edges: confidence_score = 1.0 always
- INFERRED edges: pick exactly ONE value from: 0.95, 0.85, 0.75, 0.65, 0.55
- AMBIGUOUS edges: 0.1-0.3

Node ID format: lowercase, only [a-z0-9_], no dots or slashes.
Format: {{stem}}_{{entity}} where stem is the full repo-relative path with the extension dropped, every path segment kept and joined with _.

Generate the extraction JSON matching this schema exactly:
{"nodes":[{"id":"...","label":"Human Readable Name","file_type":"code|document|paper|image|rationale|concept","source_file":"<file path from FILE_LIST>","source_location":null,"source_url":null,"captured_at":null,"author":null,"contributor":null}],"edges":[{"source":"node_id","target":"node_id","relation":"calls|implements|references|cites|conceptually_related_to|shares_data_with|semantically_similar_to|rationale_for","confidence":"EXTRACTED|INFERRED|AMBIGUOUS","confidence_score":1.0,"source_file":"<file path from FILE_LIST>","source_location":null,"weight":1.0}],"hyperedges":[{"id":"snake_case_id","label":"Human Readable Label","nodes":["node_id1","node_id2","node_id3"],"relation":"participate_in|implement|form","confidence":"EXTRACTED|INFERRED","confidence_score":0.75,"source_file":"<file path from FILE_LIST>"}],"input_tokens":0,"output_tokens":0}

source_file RULE (every node, edge, and hyperedge): set source_file to the path of the originating file EXACTLY as it appears in FILE_LIST - verbatim and absolute.

Return ONLY valid JSON. No markdown fences. No explanation.'''

    out_path = f'/home/sebille/Bureau/projects/tests/deployer/v3/graphify-out/chunk-{chunk_num:02d}-prompt.txt'
    Path(out_path).write_text(prompt)
    print(f'Chunk {chunk_num:02d}: {len(files)} files -> {out_path}')
