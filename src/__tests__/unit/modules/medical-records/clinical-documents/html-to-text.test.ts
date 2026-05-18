import { describe, expect, it } from 'vitest';

import { htmlToText } from '@/modules/medical-records/lib/pdf/html-to-text';

// ---------------------------------------------------------------------------
// htmlToText — Tiptap HTML to plain text converter
// ---------------------------------------------------------------------------

describe('htmlToText', () => {
  // ---- Null / undefined / empty input ----

  it('returns empty string for null input', () => {
    expect(htmlToText(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(htmlToText(undefined)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(htmlToText('')).toBe('');
  });

  // ---- Paragraph handling ----

  it('strips <p> tags and converts them to newlines', () => {
    const html = '<p>First paragraph</p><p>Second paragraph</p>';
    expect(htmlToText(html)).toBe('First paragraph\n\nSecond paragraph');
  });

  it('handles <p> tags with attributes', () => {
    const html = '<p class="text-left">Hello world</p>';
    expect(htmlToText(html)).toBe('Hello world');
  });

  it('handles single paragraph without trailing newlines', () => {
    const html = '<p>Single paragraph</p>';
    expect(htmlToText(html)).toBe('Single paragraph');
  });

  // ---- Line break handling ----

  it('converts <br> to newline', () => {
    const html = 'Line one<br>Line two';
    expect(htmlToText(html)).toBe('Line one\nLine two');
  });

  it('converts self-closing <br/> to newline', () => {
    const html = 'Line one<br/>Line two';
    expect(htmlToText(html)).toBe('Line one\nLine two');
  });

  it('converts <br /> with space to newline', () => {
    const html = 'Line one<br />Line two';
    expect(htmlToText(html)).toBe('Line one\nLine two');
  });

  // ---- List item handling ----

  it('converts <li> to "- " prefixed lines', () => {
    const html = '<ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>';
    expect(htmlToText(html)).toBe('- Item one\n- Item two\n- Item three');
  });

  it('handles <li> items with nested tags', () => {
    const html = '<ol><li><strong>Bold item</strong></li><li><em>Italic item</em></li></ol>';
    expect(htmlToText(html)).toBe('- Bold item\n- Italic item');
  });

  // ---- Nested tag handling ----

  it('strips <strong> tags preserving inner text', () => {
    const html = '<p>This is <strong>bold</strong> text</p>';
    expect(htmlToText(html)).toBe('This is bold text');
  });

  it('strips <em> tags preserving inner text', () => {
    const html = '<p>This is <em>italic</em> text</p>';
    expect(htmlToText(html)).toBe('This is italic text');
  });

  it('handles deeply nested tags', () => {
    const html = '<p><strong><em>Bold and italic</em></strong> then normal</p>';
    expect(htmlToText(html)).toBe('Bold and italic then normal');
  });

  it('handles <span> tags', () => {
    const html = '<p><span style="color: red">Colored text</span></p>';
    expect(htmlToText(html)).toBe('Colored text');
  });

  // ---- HTML entity handling ----

  it('decodes common HTML entities', () => {
    const html = '<p>A &amp; B &lt; C &gt; D &quot;E&quot; F&#39;s</p>';
    expect(htmlToText(html)).toBe('A & B < C > D "E" F\'s');
  });

  it('decodes &nbsp; to regular space', () => {
    const html = '<p>Word&nbsp;word</p>';
    expect(htmlToText(html)).toBe('Word word');
  });

  // ---- Whitespace normalization ----

  it('collapses multiple blank lines into at most two newlines', () => {
    const html = '<p>First</p><p></p><p></p><p>Second</p>';
    const result = htmlToText(html);
    // Should not have more than two consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('First');
    expect(result).toContain('Second');
  });

  it('trims leading and trailing whitespace', () => {
    const html = '  <p>  Content  </p>  ';
    expect(htmlToText(html)).toBe('Content');
  });

  // ---- Complex realistic Tiptap content ----

  it('handles a realistic Tiptap document', () => {
    const html =
      '<p>O paciente apresenta sintomas de <strong>ansiedade generalizada</strong>.</p>' +
      '<p>Os procedimentos realizados incluem:</p>' +
      '<ul><li>Entrevista clinica</li><li>Aplicacao do <em>BAI</em></li></ul>' +
      '<p>Conclusao: tratamento indicado.</p>';

    const expected = [
      'O paciente apresenta sintomas de ansiedade generalizada.',
      '',
      'Os procedimentos realizados incluem:',
      '',
      '- Entrevista clinica',
      '- Aplicacao do BAI',
      'Conclusao: tratamento indicado.',
    ].join('\n');

    expect(htmlToText(html)).toBe(expected);
  });

  // ---- Plain text passthrough ----

  it('passes through plain text without tags', () => {
    const text = 'This is just plain text';
    expect(htmlToText(text)).toBe('This is just plain text');
  });
});
