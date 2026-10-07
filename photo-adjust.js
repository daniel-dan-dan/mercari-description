/* Local photo tone correction. No uploads, dependencies or colour-temperature changes. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MercariPhotoAdjust = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function boundedNumber(value, min, max) {
    const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : 0;
  }

  function normalizeAdjust(adjust) {
    const value = adjust && typeof adjust === 'object' ? adjust : {};
    return {
      brightness: boundedNumber(value.brightness, -30, 30),
      contrast: boundedNumber(value.contrast, -20, 20),
      temp: 0,
    };
  }

  function validateImageData(imageData) {
    if (!imageData || !Number.isInteger(imageData.width) || !Number.isInteger(imageData.height)
        || imageData.width < 1 || imageData.height < 1 || !imageData.data
        || !ArrayBuffer.isView(imageData.data) || imageData.data.BYTES_PER_ELEMENT !== 1
        || imageData.data.length !== imageData.width * imageData.height * 4) {
      throw new TypeError('Photo adjustment requires complete RGBA ImageData.');
    }
    return imageData.data;
  }

  function percentile(histogram, count, fraction) {
    const target = Math.max(1, Math.ceil(count * fraction));
    let total = 0;
    for (let i = 0; i < histogram.length; i++) {
      total += histogram[i];
      if (total >= target) return i;
    }
    return 255;
  }

  function autoAdjust(imageData) {
    const data = validateImageData(imageData);
    const neutral = normalizeAdjust(null);
    const pixels = imageData.width * imageData.height;
    // Tiny/flat images do not provide enough evidence to infer exposure.
    if (imageData.width < 16 || imageData.height < 16 || pixels < 256) return neutral;

    const histogram = new Uint32Array(256);
    const channelHistogram = new Uint32Array(256);
    // The scan starts at the first pixel, continues at a bounded sampling stride,
    // and ends at the last pixel; translucent pixels do not vote on exposure.
    const stride = Math.max(1, Math.ceil(pixels / 65536));
    let count = 0;
    let sum = 0;
    let bright = 0;
    for (let pixel = 0; pixel < pixels; pixel += stride) {
      const i = pixel * 4;
      if (data[i + 3] < 240) continue;
      const luminance = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      histogram[luminance]++;
      channelHistogram[Math.max(data[i], data[i + 1], data[i + 2])]++;
      count++;
      sum += luminance;
      if (luminance >= 200) bright++;
    }
    if (count < 256) return neutral;

    const mean = sum / count;
    const p10 = percentile(histogram, count, 0.10);
    const p50 = percentile(histogram, count, 0.50);
    const p90 = percentile(histogram, count, 0.90);
    // A visible bright background or saturated colour is evidence against a
    // global exposure increase, even when most of the frame is a black garment.
    if (mean >= 112 || p50 >= 110 || p90 < 55 || p90 >= 185 || p90 - p10 < 18
        || bright / count >= 0.025 || percentile(histogram, count, 0.99) >= 225
        || percentile(channelHistogram, count, 0.95) >= 230) return neutral;

    const brightness = Math.round(Math.min(12, (115 - mean) / 3, (190 - p90) / 5));
    return normalizeAdjust({ brightness: brightness >= 2 ? brightness : 0, contrast: 0 });
  }

  function applyToImageData(imageData, adjust) {
    const data = validateImageData(imageData);
    const normalized = normalizeAdjust(adjust);
    if (normalized.brightness === 0 && normalized.contrast === 0) return imageData;
    const brightness = normalized.brightness / 100;
    const contrast = normalized.contrast / 100;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const red = data[i];
      const green = data[i + 1];
      const blue = data[i + 2];
      const maximum = Math.max(red, green, blue) / 255;
      const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
      // One common RGB multiplier keeps channel ratios (up to byte rounding).
      // The shoulder fades at the brightest channel so highlights never clip.
      // For grey pixels this curve is monotonic across the complete control
      // range; pure black/white stay fixed and alpha is never changed.
      const gain = 1 + (1.6 * brightness + 2 * contrast * (2 * luminance - 1)) * (1 - maximum);
      data[i] = Math.round(red * gain);
      data[i + 1] = Math.round(green * gain);
      data[i + 2] = Math.round(blue * gain);
    }
    return imageData;
  }

  return Object.freeze({ normalizeAdjust, autoAdjust, applyToImageData });
});
