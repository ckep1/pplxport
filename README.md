## Perplexity.ai Chat Downloader (pplxport)

This script allows for downloading threads and pages from Perplexity as Markdown with citations included linked inline. Perplexity has since added export in the client itself, but this allows for inline linked citations and doesn't include the logo for a better experience. 

This now uses the copy buttons on the page to get all of the citations. The previous method used the site content directly, but that results in citations with more than one source `[Reddit +2]` only capturing the first link. This method gets every link properly and can export entire conversations at once. This should also (hopefully) result in this breaking less frequently due to html changes. Though this does result in clipboard permissions being requested, this is only to get the content, there is no networking in this script and it stays private.

Fallback methods exist if the copy button mode stops working. 

### Citation Styles

Configure via the userscript menu (Tampermonkey/Greasemonkey icon):

- **Inline**: `[1](url)` - Clean inline citations
- **Parenthesized** (default): `([1](url))` - Inline citations wrapped in parentheses  
- **Endnotes**: `[1]` in text with sources listed at the end
- **Named**: `[source](url)` - Uses domain names like `[wikipedia](url)`

### Format Options

- **Full Format**: Includes User/Assistant labels and section dividers
- **Concise Format**: Just the content with minimal formatting (no user queries included in the content).
- **Enable/Disable Extra Newlines**: By default, this does not put newlines between paragraphs and elements as markdown renderers do this visually. The option to enable them exists.

Configure these options through the userscript menu commands after installation. 