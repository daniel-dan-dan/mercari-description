/* Local photo tone correction. No uploads or dependencies. Colour correction is explicitly selected by the user. */
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
      temp: 0, // Legacy placeholder remains ignored.
      warmth: boundedNumber(value.warmth, -50, 50),
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
    if (mode === 'none') return neutral;
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

    // White is also user-confirmed. Restrain only surviving bright detail,
    // without exposure lift, colour whitening or invented clipped texture.
    if (mode === 'white') {
      if (garmentCount < 64 || garmentCount / Math.max(1, centreCount) < 0.35) return neutral;
      const median = percentile(garmentHistogram, garmentCount, 0.50);
      const upper = percentile(garmentHistogram, garmentCount, 0.90);
      const lower = percentile(garmentHistogram, garmentCount, 0.10);
      if (upper - lower < 8 || median < 185 || upper < 225 || detailedHighlights / count < 0.08) return neutral;
      return normalizeAdjust({ highlights: Math.min(24, Math.max(6, Math.round((upper - 215) / 2))) });
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

  function exposureProfile(imageData) {
    const data = validateImageData(imageData);
    const pixels = imageData.width * imageData.height;
    const stride = Math.max(1, Math.ceil(pixels / 16384));
    const centre = new Uint32Array(256), whole = new Uint32Array(256);
    let count = 0, centreCount = 0, redGreen = 0, blueGreen = 0, neutral = 0, bright = 0;
    for (let pixel = 0; pixel < pixels; pixel += stride) {
      const i = pixel * 4;
      if (data[i + 3] < 240) continue;
      const red = data[i], green = data[i + 1], blue = data[i + 2];
      const luma = Math.round(.2126 * red + .7152 * green + .0722 * blue);
      whole[luma]++; count++;
      if (luma >= 220) bright++;
      const x = pixel % imageData.width / imageData.width;
      const y = Math.floor(pixel / imageData.width) / imageData.height;
      if (x < .25 || x > .75 || y < .30 || y > .85) continue;
      centre[luma]++; centreCount++;
      redGreen += red - green; blueGreen += blue - green;
      const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue);
      if (maximum - minimum <= Math.max(12, maximum * .20)) neutral++;
    }
    if (count < 256 || centreCount < 64 || imageData.width < 16 || imageData.height < 16) return null;
    const low = percentile(centre, centreCount, .10), high = percentile(centre, centreCount, .90);
    return { low, high, median: percentile(centre, centreCount, .50),
      wholeMedian: percentile(whole, count, .50), spread: high - low,
      redGreen: redGreen / centreCount, blueGreen: blueGreen / centreCount,
      neutral: neutral / centreCount, bright: bright / count,
      aspect: imageData.width / imageData.height };
  }

  function similarExposure(reference, candidate) {
    // Compare exposure and colour statistics, not garment identity or real colour.
    // Flat/clipped sources offer insufficient evidence. Suggestions still require
    // user review; labels, close-ups and different lighting may need separate edits.
    if (!reference || !candidate || reference.spread < 12 || candidate.spread < 12) return false;
    const aspect = candidate.aspect / reference.aspect;
    return aspect >= .75 && aspect <= 1.33
      && Math.abs(reference.median - candidate.median) <= 18
      && Math.abs(reference.low - candidate.low) <= 24
      && Math.abs(reference.high - candidate.high) <= 24
      && Math.abs(reference.wholeMedian - candidate.wholeMedian) <= 24
      && Math.abs(reference.redGreen - candidate.redGreen) <= 10
      && Math.abs(reference.blueGreen - candidate.blueGreen) <= 10
      && Math.abs(reference.neutral - candidate.neutral) <= .20
      && Math.abs(reference.bright - candidate.bright) <= .15;
  }

  function applyToImageData(imageData, adjust) {
    const data = validateImageData(imageData);
    const normalized = normalizeAdjust(adjust);
    if (!normalized.brightness && !normalized.contrast && !normalized.shadows && !normalized.highlights && !normalized.warmth) return imageData;
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
    if (normalized.warmth) {
      // Smooth bounded channel curves preserve endpoints, alpha and tonal order.
      // No scene-based white guess: real beige and stains cannot be distinguished
      // from warm lighting reliably. Positive warms, negative cools.
      const strength = normalized.warmth * 0.012;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const red = data[i], blue = data[i + 2];
        data[i] = Math.round(red + strength * red * (1 - red / 255));
        data[i + 2] = Math.round(blue - strength * blue * (1 - blue / 255));
      }
    }
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

  return Object.freeze({ normalizeAdjust, autoAdjust, exposureProfile, similarExposure, applyToImageData });
});
