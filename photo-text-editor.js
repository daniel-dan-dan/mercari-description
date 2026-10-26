'use strict';

(() => {
  function create({ getPhotos, getContextKey = () => '', isLocked = () => false, onApply }) {
    const dialog = document.getElementById('photo-text-dialog');
    const engine = globalThis.MercariPhotoText;
    if (!dialog || !engine || typeof getPhotos !== 'function' || typeof onApply !== 'function') {
      throw new Error('文字入れ画面を準備できませんでした');
    }
    const byId = name => document.getElementById(`photo-text-${name}`);
    const canvas = byId('preview');
    const text = byId('value');
    const photoSelect = byId('photo-select');
    const styleButtons = [...dialog.querySelectorAll('[data-text-style]')];
    let state = null;
    let composing = false;

    function owns(current) {
      if (!current || current !== state || getContextKey() !== current.contextKey) return false;
      const photos = getPhotos();
      return photos === current.photosArray && photos.length === current.photos.length
        && current.photos.every((photo, index) => photo === photos[index])
        && photos.includes(current.photo);
    }

    function status(message) { byId('status').textContent = message; }

    function controls() {
      const current = state;
      const ready = !!current?.image && owns(current);
      dialog.querySelectorAll('button, input, textarea, select').forEach(control => {
        control.disabled = !ready || !!current?.busy;
      });
      byId('close').disabled = !!current?.busy;
      byId('cancel').disabled = !!current?.busy;
      photoSelect.disabled = !!current?.busy || !current || current.photos.length < 2 || !owns(current);
      byId('clear').disabled = !ready || !!current?.busy || !text.value;
      byId('remove').disabled = !ready || !!current?.busy || !text.value;
    }

    function count() {
      byId('count').textContent = `${text.value.length}/100`;
    }

    function writeForm(overlay) {
      const normalized = engine.normalizeOverlay(overlay);
      text.value = normalized.text;
      byId('size').value = normalized.fontSize;
      byId('stroke').value = normalized.stroke;
      byId('italic').checked = normalized.italic;
      byId('x').value = normalized.x;
      byId('y').value = normalized.y;
      styleButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.textStyle === normalized.style)));
      count();
    }

    function readForm() {
      return engine.normalizeOverlay({
        ...state.overlay,
        text: text.value,
        fontSize: Number(byId('size').value),
        stroke: Number(byId('stroke').value),
        italic: byId('italic').checked,
        x: Number(byId('x').value),
        y: Number(byId('y').value),
      });
    }

    function render() {
      const current = state;
      if (!current?.image) return;
      if (!owns(current)) {
        status('商品または写真が変わりました。閉じて選び直してください。');
        controls();
        return;
      }
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(current.image, 0, 0, canvas.width, canvas.height);
      current.layout = engine.draw(canvas, current.overlay);
      // Persist the actual fitted origin so a drag starts without jumping.
      if (current.layout) {
        current.overlay.x = current.layout.x / canvas.width;
        current.overlay.y = current.layout.y / canvas.height;
      }
      byId('x').value = current.overlay.x;
      byId('y').value = current.overlay.y;
      byId('x-value').textContent = `${Math.round(current.overlay.x * 100)}%`;
      byId('y-value').textContent = `${Math.round(current.overlay.y * 100)}%`;
      byId('size-value').textContent = current.overlay.fontSize < .06 ? '小' : current.overlay.fontSize < .1 ? '標準' : '大';
      byId('stroke-value').textContent = current.overlay.stroke === 0 ? 'なし' : current.overlay.stroke < .005 ? '細い' : current.overlay.stroke < .009 ? '標準' : '太い';
      controls();
    }

    function inputChanged() {
      count();
      if (composing || !state?.image || state.busy) return;
      if (!owns(state)) { render(); return; }
      state.overlay = readForm();
      render();
    }

    function sourceFor(photo) {
      const mime = /^image\/(jpeg|png|webp)$/.test(String(photo.mediaType || '')) ? photo.mediaType : 'image/jpeg';
      const source = photo.base64HQ ? `data:${mime};base64,${photo.base64HQ}` : String(photo.dataUrl || '');
      if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(source)) throw new Error('写真のデータを読み込めませんでした');
      return source;
    }

    function loadImage(source) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        let finished = false;
        const finish = (error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          image.onload = null;
          image.onerror = null;
          if (error) reject(error);
          else if (!image.naturalWidth || !image.naturalHeight) reject(new Error('写真のサイズを読み込めませんでした'));
          else resolve(image);
        };
        const timer = setTimeout(() => finish(new Error('写真の読み込みに時間がかかっています。閉じてやり直してください。')), 15000);
        image.onload = () => finish();
        image.onerror = () => finish(new Error('写真を読み込めませんでした。閉じてやり直してください。'));
        image.src = source;
      });
    }

    async function selectPhoto(photo) {
      const current = state;
      if (!owns(current) || current.busy || !current.photos.includes(photo)) return;
      if (current.photo && current.image) current.edits.set(current.photo, readForm());
      current.photo = photo;
      current.image = null;
      current.layout = null;
      current.drag = null;
      current.overlay = engine.normalizeOverlay(current.edits.get(photo) || photo.textOverlay);
      const sequence = ++current.sequence;
      photoSelect.value = String(current.photos.indexOf(photo));
      writeForm(current.overlay);
      canvas.width = 1;
      canvas.height = 1;
      canvas.classList.remove('is-dragging');
      controls();
      status('写真を読み込んでいます…');
      try {
        const image = await loadImage(sourceFor(photo));
        if (document.fonts?.ready) await document.fonts.ready;
        if (!owns(current) || sequence !== current.sequence || current.photo !== photo) return;
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        current.image = image;
        render();
        status('');
      } catch (error) {
        if (state !== current || sequence !== current.sequence) return;
        status(error.message || '写真を読み込めませんでした。閉じてやり直してください。');
        controls();
      }
    }

    function cleanup() {
      const trigger = state?.trigger;
      if (state) state.sequence++;
      state = null;
      composing = false;
      canvas.classList.remove('is-dragging');
      if (trigger?.isConnected) trigger.focus();
    }

    function close() {
      if (state?.busy) return false;
      cleanup();
      if (dialog.open) dialog.close();
      return true;
    }

    function open(photo, trigger) {
      if (state || isLocked()) return false;
      const photosArray = getPhotos();
      if (!Array.isArray(photosArray) || !photosArray.length) return false;
      const selected = photo || photosArray[0];
      if (!photosArray.includes(selected)) return false;
      state = { photosArray, photos: photosArray.slice(), photo: selected, contextKey: getContextKey(),
        trigger: trigger || document.activeElement, image: null, layout: null, overlay: null,
        busy: false, sequence: 0, edits: new Map(), drag: null };
      photoSelect.replaceChildren();
      state.photos.forEach((_, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${index + 1}枚目の写真`;
        photoSelect.appendChild(option);
      });
      byId('details').open = false;
      status('写真を読み込んでいます…');
      controls();
      try { dialog.showModal(); }
      catch (error) { cleanup(); throw error; }
      void selectPhoto(selected);
      return true;
    }

    async function apply() {
      const current = state;
      if (!current?.image || current.busy || isLocked()) return;
      if (!owns(current)) { render(); return; }
      current.overlay = readForm();
      const photo = current.photo;
      const overlay = engine.normalizeOverlay(current.overlay);
      const isCurrent = () => owns(current) && current.photo === photo;
      current.busy = true;
      current.drag = null;
      canvas.classList.remove('is-dragging');
      controls();
      status('写真に反映しています…');
      try {
        if (!isCurrent()) throw new Error('商品または写真が変わりました。閉じて選び直してください。');
        await onApply(photo, overlay, isCurrent);
        // The parent replaces the photo object on successful commit. That is
        // expected to invalidate owns(); only the editor identity matters here.
        if (state === current) {
          current.busy = false;
          close();
        }
      } catch (error) {
        if (state === current) status(error.message || '反映できませんでした。写真は変更していません。');
      } finally {
        current.busy = false;
        if (state === current) controls();
      }
    }

    function canvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
      if (!Number.isFinite(scale) || scale <= 0) return null;
      const left = rect.left + (rect.width - canvas.width * scale) / 2;
      const top = rect.top + (rect.height - canvas.height * scale) / 2;
      const x = (event.clientX - left) / scale;
      const y = (event.clientY - top) / scale;
      if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;
      return { x, y };
    }

    byId('close').addEventListener('click', close);
    byId('cancel').addEventListener('click', close);
    byId('apply').addEventListener('click', apply);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (state) cleanup(); });
    photoSelect.addEventListener('change', () => {
      if (!state || state.busy || isLocked()) return;
      const photo = state.photos[Number(photoSelect.value)];
      if (photo) void selectPhoto(photo);
    });
    text.addEventListener('compositionstart', () => { composing = true; });
    text.addEventListener('compositionend', () => { composing = false; inputChanged(); });
    text.addEventListener('input', inputChanged);
    text.addEventListener('blur', () => {
      if (state?.image && !state.busy && !composing && owns(state)) {
        state.overlay = readForm();
        text.value = state.overlay.text;
        count();
        render();
      }
    });
    for (const name of ['size', 'stroke', 'italic', 'x', 'y']) byId(name).addEventListener('input', inputChanged);
    styleButtons.forEach(button => button.addEventListener('click', () => {
      if (!state?.image || state.busy || !owns(state)) return;
      state.overlay = { ...readForm(), style: button.dataset.textStyle };
      writeForm(state.overlay);
      render();
    }));
    function clearText() {
      if (!state?.image || state.busy || !owns(state)) return;
      text.value = '';
      inputChanged();
      text.focus();
    }
    byId('clear').addEventListener('click', clearText);
    byId('remove').addEventListener('click', clearText);
    byId('reset-position').addEventListener('click', () => {
      if (!state?.image || state.busy || !owns(state)) return;
      state.overlay = { ...readForm(), x: .04, y: .04 };
      writeForm(state.overlay);
      render();
    });
    canvas.addEventListener('pointerdown', event => {
      const current = state;
      if (!current?.image || current.busy || isLocked() || !owns(current) || !current.layout || event.isPrimary === false) return;
      const point = canvasPoint(event);
      const box = current.layout;
      if (!point || point.x < box.x - 12 || point.x > box.x + box.width + 12
          || point.y < box.y - 12 || point.y > box.y + box.height + 12) return;
      event.preventDefault();
      current.drag = { pointerId: event.pointerId, point, x: box.x / canvas.width, y: box.y / canvas.height };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', event => {
      const current = state;
      const drag = current?.drag;
      if (!drag || event.pointerId !== drag.pointerId || current.busy || !owns(current)) return;
      const point = canvasPoint(event);
      if (!point) return;
      event.preventDefault();
      current.overlay = engine.normalizeOverlay({ ...current.overlay,
        x: drag.x + (point.x - drag.point.x) / canvas.width,
        y: drag.y + (point.y - drag.point.y) / canvas.height });
      render();
    });
    function stopDrag(event) {
      if (!state?.drag || state.drag.pointerId !== event.pointerId) return;
      state.drag = null;
      canvas.classList.remove('is-dragging');
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, stopDrag);
    return Object.freeze({ open, close, isOpen: () => !!state });
  }

  globalThis.MercariPhotoTextEditor = Object.freeze({ create });
})();
