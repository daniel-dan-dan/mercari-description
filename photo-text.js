/* Device-local editable photo text. This module never reads or changes photo sources. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MercariPhotoText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FONT_FAMILY = 'Arial, "Hiragino Sans", "Yu Gothic", sans-serif';
  const MAX_TEXT_LENGTH = 100;
  const MAX_LINES = 4;
  const textSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const STYLES = Object.freeze({
    'white-black': Object.freeze({ fill: '#ffffff', stroke: '#161616' }),
    'black-white': Object.freeze({ fill: '#161616', stroke: '#ffffff' }),
    'red-white': Object.freeze({ fill: '#ed2639', stroke: '#ffffff' }),
    'white-gold': Object.freeze({ fill: '#ffffff', stroke: '#a87927', metallic: true }),
  });

  function bounded(value, min, max, fallback) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function graphemes(text) {
    if (textSegmenter) return Array.from(textSegmenter.segment(text), part => part.segment);
    return Array.from(text);
  }

  function normalizeOverlay(overlay) {
    const value = overlay && typeof overlay === 'object' ? overlay : {};
    let text = typeof value.text === 'string' ? value.text : '';
    text = text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n')
      .replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
    text = graphemes(text).slice(0, MAX_TEXT_LENGTH).join('').trim();
    const explicitLines = text.split('\n');
    if (explicitLines.length > MAX_LINES) {
      text = explicitLines.slice(0, MAX_LINES - 1).concat(explicitLines.slice(MAX_LINES - 1).join(' ')).join('\n');
    }
    return {
      version: 1,
      text,
      style: typeof value.style === 'string' && Object.prototype.hasOwnProperty.call(STYLES, value.style) ? value.style : 'white-black',
      fontSize: bounded(value.fontSize, .025, .18, .075),
      x: bounded(value.x, 0, 1, .04),
      y: bounded(value.y, 0, 1, .04),
      stroke: bounded(value.stroke, 0, .025, .006),
      italic: typeof value.italic === 'boolean' ? value.italic : true,
    };
  }

  function canvasContext(canvas) {
    if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)
        || canvas.width <= 0 || canvas.height <= 0) return null;
    const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!context || typeof context.measureText !== 'function' || typeof context.save !== 'function'
        || typeof context.restore !== 'function') throw new TypeError('Photo text requires a 2D canvas.');
    return context;
  }

  function fontValue(size, italic) {
    return `${italic ? 'italic ' : ''}900 ${size}px ${FONT_FAMILY}`;
  }

  function measureLine(context, line, size, italic) {
    const measured = context.measureText(line);
    const advance = Number.isFinite(measured.width)
      ? bounded(measured.width, 0, 1e9, 0) : graphemes(line).length * size;
    const hasInkBounds = Number.isFinite(measured.actualBoundingBoxLeft)
      && Number.isFinite(measured.actualBoundingBoxRight);
    const left = hasInkBounds ? -measured.actualBoundingBoxLeft : -(italic ? size * .15 : 0);
    const right = hasInkBounds ? measured.actualBoundingBoxRight : advance + (italic ? size * .15 : 0);
    // Older canvas implementations lack ink bounds. Leave room for the complete
    // font cell and italic overhang rather than trusting advance width alone.
    const ascent = Number.isFinite(measured.actualBoundingBoxAscent)
      ? Math.max(0, measured.actualBoundingBoxAscent) : size;
    const descent = Number.isFinite(measured.actualBoundingBoxDescent)
      ? Math.max(0, measured.actualBoundingBoxDescent) : size * .30;
    return { left: Math.min(0, left), right: Math.max(advance, right), ascent, descent };
  }

  function wrapText(context, text, availableWidth, size, italic) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let current = '';
      for (const character of graphemes(paragraph)) {
        const next = current + character;
        const measured = measureLine(context, next, size, italic);
        if (current && measured.right - measured.left > availableWidth) {
          lines.push(current.trimEnd());
          current = character.trimStart();
        } else current = next;
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }

  function measureBlock(context, lines, size, italic) {
    const lineHeight = size * 1.22;
    let left = 0, right = 0, top = Infinity, bottom = -Infinity;
    lines.forEach((line, index) => {
      const measured = measureLine(context, line, size, italic);
      left = Math.min(left, measured.left);
      right = Math.max(right, measured.right);
      const blank = !line;
      top = Math.min(top, index * lineHeight - (blank ? size * .8 : measured.ascent));
      bottom = Math.max(bottom, index * lineHeight + (blank ? size * .2 : measured.descent));
    });
    return { left, right, top, bottom, lineHeight };
  }

  function buildLayout(context, canvas, requested) {
    const overlay = normalizeOverlay(requested);
    if (!overlay.text) return null;
    const padding = Math.min(canvas.width, canvas.height) * .02;
    const availableWidth = canvas.width - padding * 2;
    const availableHeight = canvas.height - padding * 2;
    const requestedSize = canvas.width * overlay.fontSize;
    let size = requestedSize;
    let result = null;
    // Start at the requested size, continue only while the complete text is too
    // large, and finish with a fully fitting block or no drawing; never crop it.
    for (let attempt = 0; attempt < 32; attempt++) {
      const strokeWidth = Math.min(canvas.width * overlay.stroke * size / requestedSize, size * .30);
      context.font = fontValue(size, overlay.italic);
      const lines = wrapText(context, overlay.text, Math.max(.0001, availableWidth - strokeWidth * 2), size, overlay.italic);
      const block = measureBlock(context, lines, size, overlay.italic);
      const width = block.right - block.left + strokeWidth * 2;
      const height = block.bottom - block.top + strokeWidth * 2;
      if (width <= availableWidth + 1e-7 && height <= availableHeight + 1e-7 && lines.length <= MAX_LINES) {
        const x = bounded(canvas.width * overlay.x, padding, canvas.width - padding - width, padding);
        const y = bounded(canvas.height * overlay.y, padding, canvas.height - padding - height, padding);
        result = { x, y, width, height, fontSize: size, lines, strokeWidth,
          drawX: x + strokeWidth - block.left,
          baseline: y + strokeWidth - block.top,
          lineHeight: block.lineHeight, font: context.font, style: overlay.style };
        break;
      }
      const factor = Math.min(.9, availableWidth / Math.max(width, .0001),
        availableHeight / Math.max(height, .0001), MAX_LINES / lines.length) * .98;
      size *= Math.max(.01, factor);
      if (!Number.isFinite(size) || size <= 0) break;
    }
    return result;
  }

  function publicLayout(result) {
    if (!result) return null;
    const { x, y, width, height, fontSize, lines, strokeWidth } = result;
    return { x, y, width, height, fontSize, lines: lines.slice(), strokeWidth };
  }

  function layout(canvas, overlay) {
    const context = canvasContext(canvas);
    if (!context) return null;
    context.save();
    try {
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      if ('direction' in context) context.direction = 'ltr';
      return publicLayout(buildLayout(context, canvas, overlay));
    } finally { context.restore(); }
  }

  function draw(canvas, overlay) {
    const context = canvasContext(canvas);
    if (!context) return null;
    context.save();
    try {
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      if ('direction' in context) context.direction = 'ltr';
      const result = buildLayout(context, canvas, overlay);
      if (!result) return null;
      if (typeof context.strokeText !== 'function' || typeof context.fillText !== 'function') {
        throw new TypeError('Photo text requires canvas text drawing.');
      }
      const colours = STYLES[result.style];
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = 0;
      if ('filter' in context) context.filter = 'none';
      context.lineJoin = 'round';
      context.miterLimit = 2;
      context.lineWidth = result.strokeWidth * 2;
      context.strokeStyle = colours.stroke;
      context.fillStyle = colours.fill;
      if (result.strokeWidth) result.lines.forEach((line, index) => {
        const baseline = result.baseline + index * result.lineHeight;
        context.lineWidth = result.strokeWidth * 2;
        context.strokeStyle = colours.stroke;
        if (colours.metallic && typeof context.createLinearGradient === 'function') {
          // Keep a quiet dark-gold edge, with the same satin sheen on each line
          // at every preview/export size. The white interior is painted last.
          context.strokeText(line, result.drawX, baseline);
          const gold = context.createLinearGradient(0, baseline - result.fontSize, 0, baseline + result.fontSize * .1);
          [[0, '#b17b24'], [.28, '#d6ad56'], [.42, '#e8c574'], [.62, '#c19134'], [.85, '#d8ac51'], [1, '#b47d23']]
            .forEach(([offset, colour]) => gold.addColorStop(offset, colour));
          context.strokeStyle = gold;
          context.lineWidth = result.strokeWidth * 1.76;
        }
        context.strokeText(line, result.drawX, baseline);
      });
      // Paint every outline behind every fill, so thick outlines never cover
      // the interiors of adjacent text or subsequent lines.
      result.lines.forEach((line, index) => {
        context.fillText(line, result.drawX, result.baseline + index * result.lineHeight);
      });
      return publicLayout(result);
    } finally { context.restore(); }
  }

  return Object.freeze({ normalizeOverlay, layout, draw, FONT_FAMILY, MAX_TEXT_LENGTH, MAX_LINES, STYLES });
});
