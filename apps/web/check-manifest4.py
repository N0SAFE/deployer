import json
import os

base = '.next/server/app/dashboard/projects'
for entry in sorted(os.listdir(base)):
    full = os.path.join(base, entry)
    if os.path.isdir(full):
        manifest = os.path.join(full, 'page_client-reference-manifest.js')
        if os.path.exists(manifest):
            with open(manifest) as f:
                content = f.read()
            start = content.find('"clientModules":')
            if start < 0:
                continue
            mods_str = content[start + len('"clientModules":'):]
            decoder = json.JSONDecoder()
            mods, _ = decoder.raw_decode(mods_str)
            paths = [p for p in mods.keys() if 'apps/web/src' in p or 'packages/utils' in p]
            print(f"=== {entry!r} ({len(paths)} app modules) ===")
            for p in paths[:50]:
                print(' ', p)
            print()