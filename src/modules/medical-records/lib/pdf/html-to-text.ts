// ---------------------------------------------------------------------------
// Minimal Tiptap HTML to plain-text converter
// ---------------------------------------------------------------------------
//
// Converts Tiptap-generated HTML into plain text suitable for PDF rendering.
// Intentionally minimal: handles only the subset of HTML tags that Tiptap
// produces (paragraphs, lists, bold, italic, line breaks). Does NOT attempt
// to be a general-purpose HTML parser.
//
// Security: the output is consumed by pdfkit's `.text()` method, which treats
// input as literal text (no injection vector). No `dangerouslySetInnerHTML`.
// ---------------------------------------------------------------------------

/**
 * Converts Tiptap HTML content into plain text.
 *
 * Preserves semantic structure:
 * - `<p>` tags become double newlines (paragraph breaks)
 * - `<br>` / `<br/>` become single newlines
 * - `<li>` items become "- " prefixed lines
 * - `<strong>` and `<em>` are stripped (text-only; PDF uses pdfkit font calls)
 * - All other tags are stripped, preserving inner text
 *
 * Returns empty string for null, undefined, or empty input.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';

  let text = html;

  // Normalize self-closing br tags
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Convert list items to bullet lines before stripping tags
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner: string) => {
    const cleaned = stripTags(inner).trim();
    return `- ${cleaned}\n`;
  });

  // Convert closing </p> to double newline (paragraph break)
  text = text.replace(/<\/p>/gi, '\n\n');

  // Remove opening <p> tags (content already flows after previous </p>)
  text = text.replace(/<p[^>]*>/gi, '');

  // Strip remaining HTML tags (bold, italic, divs, spans, ul/ol, etc.)
  text = stripTags(text);

  // Decode common HTML entities
  text = decodeEntities(text);

  // Normalize whitespace: collapse multiple blank lines into at most two newlines,
  // trim trailing spaces per line, trim leading/trailing whitespace overall
  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strips all HTML tags from a string. */
function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

/** Decodes a small set of common HTML entities. */
function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
