## Perplexity.ai Chat Downloader (pplxport)

This script allows for downloading threads and pages from Perplexity as Markdown with citations included linked inline. Perplexity has since added export in the client itself, but this allows for inline linked citations and doesn't include the logo for a better experience. This doesn't include newlines after paragraphs as markdown renderers tend to add these visually.

There are options for including User queries or only results, as well as the citation style.

Inline is `[1](url)`, Parenthesis is inline but `([1](url))` while Endnotes appears as:
```
[1] 

Sources:
[1](url)
```
Let me know if this breaks or if you have issues!
