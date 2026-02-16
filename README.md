# pplxport

Userscript for exporting Perplexity.ai conversations as markdown with configurable citation styles and output options. Supports standard threads and Deep Research. While Perplexity has native export, this provides more control over formatting, citations, and the full conversation structure.

Install via a userscript manager like [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).

## Citation Styles
- **Inline** - `[1](url)`
- **Parenthesized** (default) - `([1](url))`
- **Endnotes** - `[1]` in text, sources listed at the end
- **Footnotes** - `[^1]` in text with footnote definitions at the end
- **Named** - `([wikipedia](url))` using domain names
- **No Citations** - strips all citation markers

Citations are globally numbered across the entire conversation. Duplicate URLs share the same citation number.

## Output Options
Configure via the Options button next to the export button.
### Layout
- **Full** (default) - includes User/Assistant labels and section dividers
- **Concise** - content only, no user queries or role labels
### Spacing
- **Standard** (default) - blank lines between elements for readable raw markdown
- **Compact** - minimal whitespace
### Frontmatter
- **Include** (default) - YAML block with title, date, and source URL
- **Exclude** - no frontmatter
### Title as H1
- **Exclude** (default) - title only in frontmatter
- **Include** - adds the title as a top-level heading

## Export
### Method
- **Download File** (default) - saves a `.md` file
- **Copy to Clipboard** - copies to clipboard with focus-aware queuing (prompts you to refocus the page if needed)
### Extraction
Three extraction strategies with automatic fallback:
- **Export** - intercepts Perplexity's native markdown download and reformats citations. Most reliable for complete citation capture.
- **Direct DOM** (default) - parses content directly from the page DOM, inspecting React internals for citation data. No clipboard access required.
- **Copy Buttons** - scrolls through the page clicking each response's copy button and reading from the clipboard. Requires clipboard permissions.

If the primary method returns insufficient content, it automatically falls back to the next strategy.

## Deep Research
Automatically detected. Triggers Perplexity's export download, intercepts it, and reformats citations to your selected style while preserving the full document structure and references section.
