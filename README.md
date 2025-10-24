# Perplexity.ai Chat Downloader (pplxport)

This script allows for downloading threads and pages from Perplexity as Markdown with multiple citation styles. Although Perplexity has since added export in the client itself, this script provides a better experience with options, entire conversation export, no Perplexity html logo in the Markdown and more. This is under the MIT license. If anything breaks please let me know via a github issue!

Configure the following settings via the `Options` button menu:

## Citation Style

- **Inline**: `[1](url)` - Clean inline citations
- **Parenthesized** (default): `([1](url))` - Inline citations wrapped in parentheses
- **Endnotes**: `[1]` in text with sources listed at the end
- **Footnotes**: `[^1]` in text with footnote definitions at the end (standard markdown format)
- **Named**: `[source](url)` - Uses domain names like `[wikipedia](url)`
- **No Citations**: Removes all citations for answer text only.

## Output Style

### Layout

- **Full Format**: Includes User/Assistant labels and section dividers
- **Concise Format**: Just the content with minimal formatting (no user queries included in the content).

### Spacing

- **Standard**: By default, this script does not put newlines between paragraphs and elements as markdown renderers do this visually. This makes rendered files appear cleaner but raw files harder to read.
- **Extra Newlines**: This is the markdown spacing used by Perplexity with newlines before and after each element such as headers and paragraphs.

### Frontmatter

- **Include**: By default, this includes a Frontmatter section with title, date and url all dynamically inserted. 
- **Exclude**: Leaves out the Frontmatter YAML section.

### Title as H1

- **Include**: Adds in the title as a level 1 header element.
- **Exclude**: This is the default option.

## Export Options

### Output Method

- **Download File**: Downloads a .md file.
- **Copy to Clipboard**: Copies the entire conversation with this formatting to the clipboard, no file saved.
