import os

base = '.next/server/app'
results = []
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith(('.meta', '.segments')):
            p = os.path.join(root, f)
            size = os.path.getsize(p)
            results.append((size, p.replace(base, '')))

for size, p in sorted(results):
    print(f"{size:>8}  {p}")