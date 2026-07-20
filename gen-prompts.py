#!/usr/bin/env python3
"""Generate subagent prompts for graphify semantic extraction chunks."""
import json
from pathlib import Path

chunks_raw = Path('graphify-out/.graphify_chunks.json').read_text()
chunks = json.loads(chunks_raw)
total = len(chunks['chunks'])

json_schema = '{"nodes":[{"id":"...","label":"Human Readable Name","file_type":"code|document|paper|image|rationale|concept","source_file":"<file path>","source_location":null,"source_url":null,"captured_at":null,"author":null,"contributor":null}],"edges":[{"source":"node_id","target":"node_id","relation":"calls|implements|references|cites|conceptually_related_to|shares_data_with|semantically_similar_to|rationale_for","confidence":"EXTRACTED|INFERRED|AMBIGUOUS","confidence_score":1.0,"source_file":"<file path>","source_location":null,"weight":1.0}],"hyperedges":[{"id":"snake_case_id","label":"Human Readable Label","nodes":["node_id1","node_id2","node_id3"],"relation":"participate_in|implement|form","confidence":"EXTRACTED|INFERRED","confidence_score":0.75,"source_file":"<file path>"}],"input_tokens":0,"output_tokens":0}'

node_id_format = "Format: {stem}_{entity} where stem is the full repo-relative path with the extension dropped, every path segment kept and joined with _."

for chunk_num in range(0, total):
    files = chunks['chunks'][chunk_num]
    file_list = '\n'.join(files)
    chunk_path = '/home/sebille/Bureau/projects/tests/deployer/v3/graphify-out/chunk-{0:02d}-extraction.json'.format(chunk_num)
    
    prompt_lines = []
    prompt_lines.append("You are a graphify extraction subagent. Read the files listed and extract a knowledge graph fragment.")
    prompt_lines.append("Output ONLY valid JSON matching the schema below - no explanation, no markdown fences, no preamble.")
    prompt_lines.append("")
    prompt_lines.append("Files (chunk {0} of {1}):".format(chunk_num, total))
    prompt_lines.append(file_list)
    prompt_lines.append("")
    prompt_lines.append("Rules:")
    prompt_lines.append("- EXTRACTED: relationship explicit in source (import, call, citation)")
    prompt_lines.append("- INFERRED: reasonable inference (shared data structure, implied dependency)")
    prompt_lines.append("- AMBIGUOUS: uncertain - flag for review, do not omit")
    prompt_lines.append("")
    prompt_lines.append("Code files: focus on semantic edges AST cannot find. Do not re-extract imports.")
    prompt_lines.append("Doc/paper files: extract named concepts, entities, citations.")
    prompt_lines.append("Image files: use vision to understand what the image IS.")
    prompt_lines.append("")
    prompt_lines.append("confidence_score is REQUIRED on every edge.")
    prompt_lines.append("- EXTRACTED edges: confidence_score = 1.0 always")
    prompt_lines.append("- INFERRED edges: pick exactly ONE value from: 0.95, 0.85, 0.75, 0.65, 0.55")
    prompt_lines.append("- AMBIGUOUS edges: 0.1-0.3")
    prompt_lines.append("")
    prompt_lines.append(node_id_format)
    prompt_lines.append("")
    prompt_lines.append("Generate the extraction JSON matching this schema exactly:")
    prompt_lines.append(json_schema)
    prompt_lines.append("")
    prompt_lines.append("source_file RULE: set source_file to the path of the originating file EXACTLY as it appears in FILE_LIST - verbatim and absolute.")
    prompt_lines.append("")
    prompt_lines.append("Return ONLY valid JSON. No markdown fences. No explanation.")
    
    prompt = '\n'.join(prompt_lines)
    
    out_path = '/home/sebille/Bureau/projects/tests/deployer/v3/graphify-out/chunk-{0:02d}-prompt.txt'.format(chunk_num)
    Path(out_path).write_text(prompt)
    print('Chunk {0:02d}: {1} files'.format(chunk_num, len(files)))

print('Done. Generated {0} prompts.'.format(total))
