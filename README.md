# screenshot-organizer
AI tool to help organize screenshots

# Feature Set:
Static Categories:

code, design, social, documents, errors, misc
AI can create new categories if needed (e.g., "receipts", "tutorials", "memes")

Filename Format:

{app}_{content}_{date}.png
Example: vscode_react_hook_2024-07-18.png

Batch Size:

10 images max per batch

User Flow:

1. Upload up to 10 screenshots
2. AI processes each one (show progress)
3. Preview page shows:
    Each file's analysis
    Suggested new filename
    Folder it will go into
    Extracted text snippet
    User can edit suggestions before download
4. Click "Download Organized ZIP"
