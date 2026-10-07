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
      brightness: boundedNumber(value.brightness, -60, 60),
      contrast: boundedNumber(value.contrast, -40, 40),
      shadows: boundedNumber(value.shadows, 0, 100),
      highlights: boundedNumber(value.highlights, 0, 100),
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

  function autoAdjust(imageData, mode = 'standard') {
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
    let midtones = 0;
    let detailedHighlights = 0;
    const garmentHistogram = new Uint32Array(256);
    let garmentCount = 0;
    let centreCount = 0;
    for (let pixel = 0; pixel < pixels; pixel += stride) {
      const i = pixel * 4;
      if (data[i + 3] < 240) continue;
      const luminance = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      histogram[luminance]++;
      channelHistogram[Math.max(data[i], data[i + 1], data[i + 2])]++;
      count++;
      sum += luminance;
      const x = (pixel % imageData.width) / imageData.width;
      const y = Math.floor(pixel / imageData.width) / imageData.height;
      if (x >= 0.25 && x <= 0.75 && y >= 0.30 && y <= 0.85) {
        centreCount++;
        const maximum = Math.max(data[i], data[i + 1], data[i + 2]);
        const minimum = Math.min(data[i], data[i + 1], data[i + 2]);
        if (maximum - minimum <= Math.max(12, maximum * 0.20)) {
          garmentHistogram[luminance]++;
          garmentCount++;
        }
      }
      if (luminance >= 200) bright++;
      if (luminance >= 65 && luminance <= 210) midtones++;
      if (luminance >= 220 && luminance <= 252) detailedHighlights++;
    }
    if (count < 256) return neutral;

    // Black is a user-supplied fact, never inferred from a grey-looking photo.
    // Central neutral tones estimate strength, reducing the influence of
    // peripheral background and saturated props. Insufficient evidence leaves
    // the source unchanged. This is a tone curve, not garment segmentation.
    if (mode === 'black') {
      if (garmentCount < 64 || garmentCount / Math.max(1, centreCount) < 0.35) return neutral;
      const garmentMedian = percentile(garmentHistogram, garmentCount, 0.50);
      if (garmentMedian < 55 || garmentMedian > 185) return neutral;
      // Calibrated to the user's black puffer reference: median ~130 maps to
      // brightness 0 / contrast -20 / shadows 0 / highlights 50. Darker fabric
      // receives proportionally less correction, avoiding a crushed black.
      const strength = Math.max(0, Math.min(1, (garmentMedian - 75) / 55));
      return normalizeAdjust({ brightness: 0, contrast: -Math.round(20 * strength),
        shadows: 0, highlights: Math.round(50 * strength) });
    }

    const mean = sum / count;
    const p10 = percentile(histogram, count, 0.10);
    const p50 = percentile(histogram, count, 0.50);
    const p90 = percentile(histogram, count, 0.90);
    // A visible bright background or saturated colour is evidence against a
    // global exposure increase, even when most of the frame is a black garment.
    const skipExposure = mean >= 112 || p50 >= 110 || p90 < 55 || p90 >= 185 || p90 - p10 < 18
        || bright / count >= 0.025 || percentile(histogram, count, 0.99) >= 225
        || percentile(channelHistogram, count, 0.95) >= 230;

    const brightness = skipExposure ? 0 : Math.round(Math.min(12, (115 - mean) / 3, (190 - p90) / 5));
    // Mixed dark/bright scenes with substantial midtones can benefit from local
    // tone ranges. Dominantly black garments and high-key white photos stay as-is.
    // Clipped endpoints are never treated as recoverable texture.
    const hasMidtones = midtones / count >= 0.20;
    const shadows = hasMidtones && p50 >= 80 && p50 <= 190 && p10 >= 2 && p10 <= 40
        && p90 >= 170 && p90 - p10 >= 145
      ? Math.min(12, Math.round((45 - p10) / 4) + 2) : 0;
    const highlights = hasMidtones && p50 >= 75 && p50 <= 200 && p90 >= 225
        && detailedHighlights / count >= 0.08
      ? Math.min(12, Math.round((p90 - 220) / 3)) : 0;
    return normalizeAdjust({ brightness: brightness >= 2 ? brightness : 0, contrast: 0, shadows, highlights });
  }

  function applyToImageData(imageData, adjust) {
    const data = validateImageData(imageData);
    const normalized = normalizeAdjust(adjust);
    if (!normalized.brightness && !normalized.contrast && !normalized.shadows && !normalized.highlights) return imageData;
    // Keep the original range byte-compatible. Apply only the extra range as
    // a second bounded pass; directly doubling coefficients can invert the
    // highlight curve when brightness and contrast are both at their limits.
    const first = {
      brightness: boundedNumber(normalized.brightness, -30, 30),
      contrast: boundedNumber(normalized.contrast, -20, 20),
      shadows: boundedNumber(normalized.shadows, 0, 50),
      highlights: boundedNumber(normalized.highlights, 0, 50),
    };
    const extra = {};
    for (const key of ['brightness', 'contrast', 'shadows', 'highlights']) {
      extra[key] = normalized[key] - first[key];
    }
    applyTonePass_(data, first);
    if (Object.values(extra).some(value => value !== 0)) applyTonePass_(data, extra);
    return imageData;
  }

  function applyTonePass_(data, normalized) {
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
      let gain = 1 + (1.6 * brightness + 2 * contrast * (2 * luminance - 1)) * (1 - maximum);
      let adjustedMaximum = maximum * gain;
      // Monotonic curves preserve ordering and colour ratios: lift low values
      // with a smooth shoulder, then spread the remaining near-white detail.
      // At maximum controls the shadow derivative stays positive (>0.64),
      // as does the highlight derivative (>=0.70). Pure black/white are fixed.
      if (normalized.shadows) {
        const shadowGain = Math.exp(normalized.shadows * 0.016 * Math.pow(1 - adjustedMaximum, 3));
        gain *= shadowGain;
        adjustedMaximum *= shadowGain;
      }
      if (normalized.highlights) {
        gain *= 1 - normalized.highlights * 0.024 * adjustedMaximum * adjustedMaximum * (1 - adjustedMaximum);
      }
      data[i] = Math.round(red * gain);
      data[i + 1] = Math.round(green * gain);
      data[i + 2] = Math.round(blue * gain);
    }
  }

  return Object.freeze({ normalizeAdjust, autoAdjust, applyToImageData });
});
