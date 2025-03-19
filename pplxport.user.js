// ==UserScript==
// @name         Perplexity.ai Chat Exporter
// @namespace    https://github.com/ckep1/pplxport
// @version      1.0.9
// @description  Export Perplexity.ai conversations as markdown with configurable citation styles
// @author       Chris Kephart
// @match        https://www.perplexity.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // Style options
  const CITATION_STYLES = {
    ENDNOTES: "endnotes",
    INLINE: "inline",
  };

  const FORMAT_STYLES = {
    FULL: "full", // Include User/Assistant tags and all dividers
    CONCISE: "concise", // Just content, minimal dividers
  };

  // Get user preferences
  function getPreferences() {
    return {
      citationStyle: GM_getValue("citationStyle", CITATION_STYLES.ENDNOTES),
      formatStyle: GM_getValue("formatStyle", FORMAT_STYLES.FULL),
    };
  }

  // Register menu commands
  GM_registerMenuCommand("Use Endnotes Citation Style", () => {
    GM_setValue("citationStyle", CITATION_STYLES.ENDNOTES);
    alert("Citation style set to endnotes. Format: [1] with sources listed at end.");
  });

  GM_registerMenuCommand("Use Inline Citation Style", () => {
    GM_setValue("citationStyle", CITATION_STYLES.INLINE);
    alert("Citation style set to inline. Format: [1](url)");
  });

  GM_registerMenuCommand("Full Format (with User/Assistant)", () => {
    GM_setValue("formatStyle", FORMAT_STYLES.FULL);
    alert("Format set to full with User/Assistant tags.");
  });

  GM_registerMenuCommand("Concise Format (content only)", () => {
    GM_setValue("formatStyle", FORMAT_STYLES.CONCISE);
    alert("Format set to concise content only.");
  });

  // Convert HTML content to markdown
  function htmlToMarkdown(html, citationStyle = CITATION_STYLES.ENDNOTES) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;

    tempDiv.querySelectorAll("code").forEach((codeElem) => {
      if (codeElem.style.whiteSpace && codeElem.style.whiteSpace.includes("pre-wrap")) {
        if (codeElem.parentElement.tagName.toLowerCase() !== "pre") {
          const pre = document.createElement("pre");
          let language = "";
          const prevDiv = codeElem.closest("div.pr-lg")?.previousElementSibling;
          if (prevDiv) {
            const langDiv = prevDiv.querySelector(".text-text-200");
            if (langDiv) {
              language = langDiv.textContent.trim().toLowerCase();
              langDiv.remove();
            }
          }
          pre.dataset.language = language;
          pre.innerHTML = "<code>" + codeElem.innerHTML + "</code>";
          codeElem.parentNode.replaceChild(pre, codeElem);
        }
      }
    });

    // Process citations
    const citations = [...tempDiv.querySelectorAll("a.citation")];
    const citationRefs = new Map();
    citations.forEach((citation) => {
      // Find the inner <span> holding the citation number
      const numberSpan = citation.querySelector("span span");
      const number = numberSpan ? numberSpan.textContent.trim() : null;
      const href = citation.getAttribute("href");
      if (number && href) {
        citationRefs.set(number, { href });
      }
    });

    // Clean up citations based on style
    tempDiv.querySelectorAll(".citation").forEach((el) => {
      const numberSpan = el.querySelector("span span");
      const number = numberSpan ? numberSpan.textContent.trim() : null;
      const href = el.getAttribute("href");

      if (citationStyle === CITATION_STYLES.INLINE) {
        el.replaceWith(` [${number}](${href}) `);
      } else {
        el.replaceWith(` [${number}] `);
      }
    });

    // Convert strong sections to headers and clean up content
    let text = tempDiv.innerHTML;

    //  Basic HTML conversion
    text = text
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, "# $1")
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, "## $1")
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, "### $1")
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/g, "#### $1")
      .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/g, "##### $1")
      .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/g, "###### $1")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, "$1\n")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**")
      .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
      .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/g, "$1\n")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, " - $1\n");

    // Handle tables before removing remaining HTML
    text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (match) => {
      const tableDiv = document.createElement("div");
      tableDiv.innerHTML = match;
      const rows = [];

      // Process header rows
      const headerRows = tableDiv.querySelectorAll("thead tr");
      if (headerRows.length > 0) {
        headerRows.forEach((row) => {
          const cells = [...row.querySelectorAll("th, td")].map((cell) => cell.textContent.trim() || " ");
          if (cells.length > 0) {
            rows.push(`| ${cells.join(" | ")} |`);
            // Add separator row after headers
            rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
          }
        });
      }

      // Process body rows
      const bodyRows = tableDiv.querySelectorAll("tbody tr");
      bodyRows.forEach((row) => {
        const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim() || " ");
        if (cells.length > 0) {
          rows.push(`| ${cells.join(" | ")} |`);
        }
      });

      // Return markdown table with proper spacing
      return rows.length > 0 ? `\n\n${rows.join("\n")}\n\n` : "";
    });

    // Continue with remaining HTML conversion
    text = text
      .replace(/<pre[^>]*data-language="([^"]*)"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g, "```$1\n$2\n```")
      .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, "```\n$1\n```")
      .replace(/<code>(.*?)<\/code>/g, "`$1`")
      .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/g, "[$2]($1)")
      .replace(/<[^>]+>/g, ""); // Remove any remaining HTML tags

    // Clean up whitespace
    // Convert bold text at start of line to h3 headers, but not if inside a list item
    text = text.replace(/^(\s*)\*\*([^*\n]+)\*\*(?!.*\n\s*-)/gm, "$1### $2");
    
    // This fixes list items where the entire text was incorrectly converted to headers
    // We need to preserve both partial bold items and fully bold items
    text = text.replace(/^(\s*-\s+)###\s+([^\n]+)/gm, function(match, listPrefix, content) {
      // Check if the content contains bold markers
      if (content.includes("**")) {
        // If it already has bold markers, just remove the ### and keep the rest intact
        return `${listPrefix}${content}`;
      } else {
        // If it doesn't have bold markers (because it was fully bold before), 
        // add them back (this was incorrectly converted to a header)
        return `${listPrefix}**${content}**`;
      }
    });

    // Fix list spacing (no extra newlines between items)
    text = text.replace(/\n\s*-\s+/g, "\n- ");

    // Ensure headers have proper spacing
    text = text.replace(/([^\n])(\n#{1,3} )/g, "$1\n\n$2");
    
    // Fix unbalanced or misplaced bold markers in list items
    text = text.replace(/^(\s*-\s+.*?)(\s\*\*\s*)$/gm, "$1"); // Remove trailing ** with space before
    
    // Fix citation and bold issues - make sure citations aren't wrapped in bold
    text = text.replace(/\*\*([^*]+)(\[[0-9]+\]\([^)]+\))\s*\*\*/g, "**$1**$2");
    
    // Fix cases where a line ends with an extra bold marker after a citation
    text = text.replace(/(\[[0-9]+\]\([^)]+\))\s*\*\*/g, "$1");

    // Clean up whitespace
    text = text
      .replace(/^[\s\n]+|[\s\n]+$/g, "") // Trim start and end
      .replace(/\n{3,}/g, "\n\n") // Max two consecutive newlines
      .replace(/^\s+/gm, "") // Remove leading spaces on each line
      .replace(/[ \t]+$/gm, "") // Remove trailing spaces
      .trim();

    if (citationStyle === CITATION_STYLES.INLINE) {
      // Remove extraneous space before a period: e.g. " [1](url) ." -> " [1](url)."
      text = text.replace(/\s+\./g, ".");
    }

    // Add citations at the bottom for endnotes style
    if (citationStyle === CITATION_STYLES.ENDNOTES && citationRefs.size > 0) {
      text += "\n\n### Sources\n";
      for (const [number, { href }] of citationRefs) {
        text += `[${number}] ${href}\n`;
      }
    }

    return text;
  }

  // Format the complete markdown document
  function formatMarkdown(conversations) {
    const title = document.title.replace(" | Perplexity", "").trim();
    const timestamp = new Date().toISOString().split("T")[0];
    const prefs = getPreferences();

    let markdown = "---\n";
    markdown += `title: ${title}\n`;
    markdown += `date: ${timestamp}\n`;
    markdown += `source: ${window.location.href}\n`;
    markdown += "---\n\n"; // Add newline after properties

    conversations.forEach((conv, index) => {
      if (conv.role === "Assistant") {
        if (prefs.formatStyle === FORMAT_STYLES.FULL) {
          markdown += `**${conv.role}:** ${conv.content}\n\n`; // Add newline after content
        } else {
          markdown += `${conv.content}\n\n`; // Add newline after content
        }

        // Add divider only between assistant responses, not after the last one
        const nextAssistant = conversations.slice(index + 1).find((c) => c.role === "Assistant");
        if (nextAssistant) {
          markdown += "---\n\n"; // Add newline after divider
        }
      } else if (conv.role === "User" && prefs.formatStyle === FORMAT_STYLES.FULL) {
        markdown += `**${conv.role}:** ${conv.content}\n\n`; // Add newline after content
        markdown += "---\n\n"; // Add newline after divider
      }
    });

    return markdown.trim(); // Trim any trailing whitespace at the very end
  }

  // Extract conversation content
  function extractConversation(citationStyle) {
    const conversation = [];
    console.log("Using updated selectors for Perplexity");
    
    // Check for user query
    const userQueries = document.querySelectorAll(".whitespace-pre-line.text-pretty.break-words");
    userQueries.forEach(query => {
      conversation.push({
        role: "User",
        content: query.textContent.trim(),
      });
    });

    // Check for assistant responses
    const assistantResponses = document.querySelectorAll(".prose.text-pretty.dark\\:prose-invert");
    assistantResponses.forEach(response => {
      const answerContent = response.cloneNode(true);
      conversation.push({
        role: "Assistant",
        content: htmlToMarkdown(answerContent.innerHTML, citationStyle),
      });
    });

    // Fallback to more generic selectors if needed
    if (conversation.length === 0) {
      console.log("Attempting to use fallback selectors");
      
      // Try more generic selectors that might match Perplexity's structure
      const queryElements = document.querySelectorAll("[class*='whitespace-pre-line'][class*='break-words']");
      queryElements.forEach(query => {
        conversation.push({
          role: "User",
          content: query.textContent.trim(),
        });
      });

      const responseElements = document.querySelectorAll("[class*='prose'][class*='prose-invert']");
      responseElements.forEach(response => {
        const answerContent = response.cloneNode(true);
        conversation.push({
          role: "Assistant",
          content: htmlToMarkdown(answerContent.innerHTML, citationStyle),
        });
      });
    }

    return conversation;
  }

  // Download markdown file
  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Create and add export button
  function addExportButton() {
    const existingButton = document.getElementById("perplexity-export-btn");
    if (existingButton) {
      existingButton.remove();
    }

    const button = document.createElement("button");
    button.id = "perplexity-export-btn";
    button.textContent = "Export as Markdown";
    button.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 80px;
            padding: 8px 16px;
            background-color: #6366f1;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            z-index: 99999;
            font-family: system-ui, -apple-system, sans-serif;
            transition: background-color 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;

    button.addEventListener("mouseenter", () => {
      button.style.backgroundColor = "#4f46e5";
    });

    button.addEventListener("mouseleave", () => {
      button.style.backgroundColor = "#6366f1";
    });

    button.addEventListener("click", () => {
      const prefs = getPreferences();
      const conversation = extractConversation(prefs.citationStyle);
      if (conversation.length === 0) {
        alert("No conversation content found to export.");
        return;
      }

      const title = document.title.replace(" | Perplexity", "").trim();
      const safeTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/^-+|-+$/g, "");
      const filename = `${safeTitle}.md`;

      const markdown = formatMarkdown(conversation);
      downloadMarkdown(markdown, filename);
    });

    document.body.appendChild(button);
  }

  // Initialize the script
  function init() {
    const observer = new MutationObserver(() => {
      if ((document.querySelector(".prose.text-pretty.dark\\:prose-invert") ||
           document.querySelector("[class*='prose'][class*='prose-invert']")) && 
          !document.getElementById("perplexity-export-btn")) {
        addExportButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    if (document.querySelector(".prose.text-pretty.dark\\:prose-invert") ||
        document.querySelector("[class*='prose'][class*='prose-invert']")) {
      addExportButton();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
