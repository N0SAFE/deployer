import re
import os

file_path = '/home/sebille/.config/Code - Insiders/User/workspaceStorage/add790fd5578a8247690cd9d3f191f20/GitHub.copilot-chat/chat-session-resources/4fe75cb0-d001-4189-9e73-0ac046f0a527/call_MHxGbkplMUxpNGRTZTRtMHoyTTY__vscode-1775855704839/content.txt'

with open(file_path, 'r') as f:
    content = f.read()

# Pattern for file:line:col - error TSXXXX: message
errors_by_file = {}
current_file = None
current_line = None
current_message = []

for line in content.split('\n'):
    match = re.match(r'^([^\s]+?):(\d+):\d+ - (error TS\d+: .*)$', line)
    if match:
        full_msg = " ".join(current_message)
        if current_file and ("string" in full_msg and "Date" in full_msg):
             if current_file not in errors_by_file:
                 errors_by_file[current_file] = []
             errors_by_file[current_file].append((current_line, full_msg))
        
        current_file = match.group(1)
        current_line = match.group(2)
        current_message = [match.group(3)]
    elif line.startswith(' '):
        if current_file:
            current_message.append(line.strip())

# Last error
full_msg = " ".join(current_message)
if current_file and ("string" in full_msg and "Date" in full_msg):
     if current_file not in errors_by_file:
         errors_by_file[current_file] = []
     errors_by_file[current_file].append((current_line, full_msg))

for file, errors in errors_by_file.items():
    print(f"File: {file} ({len(errors)} Date-related errors)")
    for line, msg in errors[:2]:
        display_msg = " ".join(msg.split())
        print(f"  Line {line}: {display_msg[:120]}...")
    print("-" * 20)
