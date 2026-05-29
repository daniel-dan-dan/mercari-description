'use strict';

/* ============================================================
 * メルカリ説明文AI生成 - Phase 1 MVP
 * ============================================================ */

const LEGACY_API_KEY_STORAGE_KEY = 'mercari_desc_api_key';
const SERVICE_URL_KEY = 'gasUrl';
const MAX_IMAGE_EDGE = 1024;         // 長辺を1024pxにリサイズ（AI分析用・コスト節約）
const MAX_MERCARI_EDGE = 1080;       // Mercariアップロード用（1:1撮影前提で1080×1080）
const MAX_SELECT_PHOTOS = 30;        // 編集素材として選べる写真枚数
const MAX_DRAFT_PHOTOS = 20;         // メルカリ下書き保存に送れる写真枚数

const DB_NAME = 'mercari_desc_state';
const DB_VERSION = 1;
const DB_STORE = 'session';
const CATEGORY_JP = { suit: 'スーツ', tops: 'アウター/トップス', bottoms: 'ボトムス', bag: 'バッグ', other: 'その他' };
const RESEARCH_REQUESTS_KEY = 'mercari_research_requests';
const RESEARCH_RESULTS_KEY = 'mercari_research_results';
const RESEARCH_EMPTY_VALUES = new Set(['', '指定なし', 'すべて']);
const RESEARCH_BRAND_ALIASES = [
  ['BURBERRY BLACK LABEL', ['burberry black label', 'black label crestbridge', 'ブラックレーベル']],
  ['BURBERRY', ['burberry', 'burberrys', 'バーバリー', 'バーバリーズ']],
  ['RALPH LAUREN', ['polo ralph lauren', 'ralph lauren', 'ラルフローレン', 'ポロラルフローレン']],
  ['FRED PERRY', ['fred perry', 'フレッドペリー']],
  ['TENDERLOIN', ['tenderloin', 'テンダーロイン']],
  ['WTAPS', ['wtaps', 'ダブルタップス']],
  ['SUPREME', ['supreme', 'シュプリーム']],
  ['BRIEFING', ['briefing', 'ブリーフィング']],
  ['DIESEL', ['diesel', 'ディーゼル']],
  ['LANVIN', ['lanvin', 'ランバン']],
  ['KENZO', ['kenzo', 'ケンゾー']],
  ['MADISONBLUE', ['madisonblue', 'madison blue', 'マディソンブルー']],
  ['BLUMARINE', ['blumarine', 'ブルマリン']],
  ['SNIDEL', ['snidel', 'スナイデル']],
  ['HELLY HANSEN', ['helly hansen', 'ヘリーハンセン']],
  ['LEVI\'S', ['levi\'s', 'levis', 'リーバイス']],
  ['COMME DES GARCONS', ['comme des garcons', 'コムデギャルソン', 'コム デ ギャルソン']],
  ['YOHJI YAMAMOTO', ['yohji yamamoto', 'ヨウジヤマモト']],
  ['ISSEY MIYAKE', ['issey miyake', 'イッセイミヤケ']],
  ['PLEATS PLEASE', ['pleats please', 'プリーツプリーズ']],
  ['AURALEE', ['auralee', 'オーラリー']],
  ['COMOLI', ['comoli', 'コモリ']],
  ['NEEDLES', ['needles', 'ニードルス']],
  ['THE NORTH FACE', ['the north face', 'ノースフェイス']],
  ['PATAGONIA', ['patagonia', 'パタゴニア']],
  ['ARC\'TERYX', ['arc\'teryx', 'arcteryx', 'アークテリクス']],
  ['MONCLER', ['moncler', 'モンクレール']],
  ['STONE ISLAND', ['stone island', 'ストーンアイランド']],
  ['GUCCI', ['gucci', 'グッチ']],
  ['PRADA', ['prada', 'プラダ']],
  ['LOUIS VUITTON', ['louis vuitton', 'ルイヴィトン']],
  ['CHANEL', ['chanel', 'シャネル']],
  ['HERMES', ['hermes', 'エルメス']],
  ['CELINE', ['celine', 'セリーヌ']],
  ['DIOR', ['dior', 'ディオール']],
  ['FENDI', ['fendi', 'フェンディ']],
  ['BALENCIAGA', ['balenciaga', 'バレンシアガ']],
  ['BOTTEGA VENETA', ['bottega veneta', 'ボッテガ']],
  ['COACH', ['coach', 'コーチ']],
  ['PORTER', ['porter', 'ポーター']],
  ['MARGARET HOWELL', ['margaret howell', 'マーガレットハウエル']],
  ['MACKINTOSH', ['mackintosh', 'マッキントッシュ']],
  ['A.P.C.', ['a.p.c', 'apc', 'アーペーセー']],
  ['UNITED ARROWS', ['united arrows', 'ユナイテッドアローズ']],
  ['BEAMS', ['beams', 'ビームス']],
  ['SHIPS', ['ships', 'シップス']],
  ['JOURNAL STANDARD', ['journal standard', 'ジャーナルスタンダード']],
  ['NANO UNIVERSE', ['nano universe', 'ナノユニバース']],
  ['URBAN RESEARCH', ['urban research', 'アーバンリサーチ']],
  ['UNIQLO', ['uniqlo', 'ユニクロ']],
  ['GU', [' gu ', 'ジーユー']],
];
const RESEARCH_BRAND_NOISE = new Set([
  '新品', '未使用', '美品', '極美品', '希少', 'レア', '古着', 'メンズ', 'レディース',
  'まとめ', 'まとめ商品', 'リクエスト', '専用', '販売中', '様', 'トップス', 'シャツ',
  'ブラウス', 'ポロシャツ', '半袖', '長袖', '大きいサイズ',
]);
const MULTI_VOICE_IDLE_STOP_MS = 45000;
const MULTI_VOICE_RESTART_DELAY_MS = 250;
const MULTI_VOICE_COMPLETE_STOP_MS = 900;

let lastAiData = null;
let activeMultiVoiceSession = null;

// ----- 画面制御 -----
const el = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.hidden = true);
  el(id).hidden = false;
}

function showStatus(target, msg, kind) {
  const node = el(target);
  node.hidden = false;
  node.className = 'status ' + (kind || '');
  node.textContent = msg;
}

function hideStatus(target) {
  el(target).hidden = true;
}

function updatePhotoSummary() {
  const pill = el('photo-count-pill');
  if (!pill) return;
  pill.textContent = `${uploadedImages.length}/${MAX_SELECT_PHOTOS}`;
  pill.classList.toggle('ready', uploadedImages.length >= 2);
  pill.classList.toggle('over-limit', uploadedImages.length > MAX_DRAFT_PHOTOS);
}

// ----- 初期起動判定 -----
async function init() {
  const serviceUrl = localStorage.getItem(SERVICE_URL_KEY);
  if (localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY)) {
    localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  }
  if (!serviceUrl) {
    showScreen('setup-screen');
  } else {
    showScreen('main-screen');
  }

  // イベントバインド
  el('save-key').addEventListener('click', saveSettings);
  el('settings-btn').addEventListener('click', openSettings);
  el('reset-btn').addEventListener('click', resetAll);
  el('photo-input').addEventListener('change', handlePhotoSelect);
  el('category').addEventListener('change', () => {
    renderMeasurements();
    scheduleSave();
  });
  el('generate-btn').addEventListener('click', generateDescription);
  el('retry-btn').addEventListener('click', retryGeneration);
  el('title-text').addEventListener('input', () => { scheduleSave(); updateDraftChecklist(); });
  el('result-text').addEventListener('input', () => { scheduleSave(); updateDraftChecklist(); });
  el('compose-open-btn').addEventListener('click', openImageCompose);
  el('grid2-btn').addEventListener('click', () => openGridCompose(2));
  el('grid4-btn').addEventListener('click', () => openGridCompose(4));
  el('compose-close').addEventListener('click', closeImageCompose);
  el('draft-btn').addEventListener('click', saveDraft);
  el('price-input').addEventListener('input', updateDraftChecklist);
  el('description-tab-btn').addEventListener('click', () => switchMainTab('description'));
  el('research-tab-btn').addEventListener('click', () => switchMainTab('research'));
  el('research-save-btn').addEventListener('click', saveResearchRequest);
  el('research-copy-btn').addEventListener('click', copyResearchRequestForNightWork);
  el('research-refresh-btn').addEventListener('click', () => refreshResearchResultsFromMac({ silent: false }));
  el('research-run-btn').addEventListener('click', runResearchNow);
  el('research-result-save-btn').addEventListener('click', saveResearchResultNote);
  el('research-request-list').addEventListener('click', handleResearchRequestAction);
  el('research-result-list').addEventListener('click', handleResearchResultAction);
  ['research-title', 'research-keyword', 'research-category', 'research-brand', 'research-size', 'research-condition', 'research-gender', 'research-sale-status', 'research-min-price', 'research-max-price', 'research-sample-size', 'research-sort', 'research-period-months', 'research-excludes', 'research-note']
    .forEach(id => {
      const node = el(id);
      if (!node) return;
      node.addEventListener('input', updateResearchPreview);
      node.addEventListener('change', updateResearchPreview);
    });
  window.addEventListener('pagehide', () => stopActiveMultiVoiceInput({ clearStatus: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopActiveMultiVoiceInput({ clearStatus: true });
  });

  // 写真並び替え（一度だけ登録）
  setupDragSort(el('photo-preview'));

  // GAS URL読み込み
  const savedGasUrl = localStorage.getItem(SERVICE_URL_KEY);
  if (savedGasUrl) {
    const gasUrlInput = el('gas-url-input');
    if (gasUrlInput) gasUrlInput.value = savedGasUrl;
  }

  // 前回のセッションを復元
  if (serviceUrl) {
    try {
      const saved = await loadSession();
      if (saved) restoreState(saved);
    } catch (e) {
      console.warn('セッション復元失敗:', e);
    }
  }
  renderResearchData();
  if (serviceUrl) refreshResearchResultsFromMac({ silent: true }).catch(() => {});
  updateGenerateButton();
  updateResearchPreview();
}

// ----- 設定 -----
function saveSettings() {
  const gasUrlInput = el('gas-url-input');
  const gasUrl = gasUrlInput ? gasUrlInput.value.trim() : '';
  if (!gasUrl) { alert('GAS URLを入力してください'); return; }
  localStorage.setItem(SERVICE_URL_KEY, gasUrl);
  if (localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY)) {
    localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  }
  showScreen('main-screen');
}

function openSettings() {
  const gasUrlInput = el('gas-url-input');
  if (gasUrlInput) gasUrlInput.value = localStorage.getItem(SERVICE_URL_KEY) || '';
  showScreen('setup-screen');
}

// ----- 写真アップロード＆リサイズ -----
let uploadedImages = [];  // { dataUrl, mediaType, base64 }

async function handlePhotoSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const remaining = MAX_SELECT_PHOTOS - uploadedImages.length;
  if (remaining <= 0) {
    alert(`写真選択は最大${MAX_SELECT_PHOTOS}枚までです`);
    e.target.value = '';
    return;
  }
  const toAdd = files.slice(0, remaining);
  if (files.length > remaining) {
    alert(`最大${MAX_SELECT_PHOTOS}枚までなので、先頭の${remaining}枚のみ追加します`);
  }
  showStatus('status', '画像を処理中...', 'loading');
  for (const file of toAdd) {
    try {
      const processed = await processImage(file);
      uploadedImages.push(processed);
    } catch (err) {
      console.error(err);
      alert('画像処理に失敗しました: ' + file.name);
    }
  }
  renderPreviews();
  updateGenerateButton();
  hideStatus('status');
  e.target.value = '';  // 同じファイル再選択可能に
  scheduleSave();
  updateDraftChecklist();
}

function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // AI分析用（1024px）
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        // Mercariアップロード用（1600px・高画質）
        const scaleHQ = Math.min(1, MAX_MERCARI_EDGE / Math.max(img.width, img.height));
        const wHQ = Math.round(img.width * scaleHQ);
        const hHQ = Math.round(img.height * scaleHQ);
        const canvasHQ = document.createElement('canvas');
        canvasHQ.width = wHQ; canvasHQ.height = hHQ;
        canvasHQ.getContext('2d').drawImage(img, 0, 0, wHQ, hHQ);
        const base64HQ = canvasHQ.toDataURL('image/jpeg', 0.92).split(',')[1];
        resolve({
          dataUrl, mediaType: 'image/jpeg', base64, base64HQ,
          originalDataUrl: dataUrl,
          adjust: { brightness: 0, temp: 0, contrast: 0 },
        });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderPreviews() {
  const grid = el('photo-preview');
  grid.innerHTML = '';
  uploadedImages.forEach((img, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.draggable = true;
    item.dataset.idx = idx;
    item.innerHTML = `
      <img src="${img.dataUrl}" alt="">
      <button class="remove" data-idx="${idx}" title="削除">×</button>
      <span class="preview-num">${idx + 1}</span>
    `;
    grid.appendChild(item);
  });
  grid.querySelectorAll('.remove').forEach(b => {
    b.addEventListener('click', () => {
      uploadedImages.splice(Number(b.dataset.idx), 1);
      renderPreviews();
      updateGenerateButton();
      scheduleSave();
      updateDraftChecklist();
    });
  });
  const composeBtnRow = el('compose-btn-row');
  if (composeBtnRow) composeBtnRow.hidden = uploadedImages.length < 2;
  updatePhotoSummary();
}

function removeUploadedImagesByIndices(indices) {
  const targets = [...new Set(indices)]
    .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < uploadedImages.length)
    .sort((a, b) => b - a);
  if (!targets.length) return false;
  targets.forEach(idx => uploadedImages.splice(idx, 1));
  renderPreviews();
  updateGenerateButton();
  scheduleSave();
  updateDraftChecklist();
  return true;
}

function setupDragSort(grid) {
  let dragIdx = null;
  let autoScrollFrame = null;
  let autoScrollSpeed = 0;

  const stopAutoScroll = () => {
    autoScrollSpeed = 0;
    if (autoScrollFrame) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
  };

  const runAutoScroll = () => {
    if (!autoScrollSpeed) {
      autoScrollFrame = null;
      return;
    }
    const maxScroll = grid.scrollWidth - grid.clientWidth;
    if (maxScroll <= 0) {
      stopAutoScroll();
      return;
    }
    const nextScroll = Math.max(0, Math.min(maxScroll, grid.scrollLeft + autoScrollSpeed));
    if (nextScroll === grid.scrollLeft) {
      stopAutoScroll();
      return;
    }
    grid.scrollLeft = nextScroll;
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  };

  const updateAutoScroll = (clientX) => {
    const rect = grid.getBoundingClientRect();
    const edgeWidth = Math.min(72, Math.max(36, rect.width * 0.18));
    let nextSpeed = 0;

    if (clientX < rect.left + edgeWidth) {
      const ratio = Math.min(1, (rect.left + edgeWidth - clientX) / edgeWidth);
      nextSpeed = -Math.ceil(4 + ratio * 14);
    } else if (clientX > rect.right - edgeWidth) {
      const ratio = Math.min(1, (clientX - (rect.right - edgeWidth)) / edgeWidth);
      nextSpeed = Math.ceil(4 + ratio * 14);
    }

    if (!nextSpeed || grid.scrollWidth <= grid.clientWidth) {
      stopAutoScroll();
      return;
    }

    autoScrollSpeed = nextSpeed;
    if (!autoScrollFrame) autoScrollFrame = requestAnimationFrame(runAutoScroll);
  };

  const clearDragHighlight = () => {
    grid.classList.remove('drag-sorting');
    grid.querySelectorAll('.preview-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
  };

  const getDropIndex = (clientX, overItem) => {
    if (overItem) return Number(overItem.dataset.idx);
    const rect = grid.getBoundingClientRect();
    if (clientX < rect.left + 40) return 0;
    if (clientX > rect.right - 40) return uploadedImages.length;
    return null;
  };

  const movePreviewItem = (fromIdx, toIdx) => {
    if (fromIdx === null || toIdx === null) return false;
    if (fromIdx === toIdx || (fromIdx === uploadedImages.length - 1 && toIdx >= uploadedImages.length)) {
      return false;
    }
    const moved = uploadedImages.splice(fromIdx, 1)[0];
    uploadedImages.splice(Math.max(0, Math.min(toIdx, uploadedImages.length)), 0, moved);
    renderPreviews();
    scheduleSave();
    return true;
  };

  // --- デスクトップ: HTML5 drag API ---
  grid.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.preview-item');
    if (!item) return;
    dragIdx = Number(item.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
    grid.classList.add('drag-sorting');
    setTimeout(() => item.classList.add('dragging'), 0);
  });
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    updateAutoScroll(e.clientX);
    const item = e.target.closest('.preview-item');
    grid.querySelectorAll('.preview-item').forEach(el => el.classList.remove('drag-over'));
    if (item) item.classList.add('drag-over');
  });
  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    const item = e.target.closest('.preview-item');
    const dropIdx = getDropIndex(e.clientX, item);
    movePreviewItem(dragIdx, dropIdx);
    stopAutoScroll();
    dragIdx = null;
    clearDragHighlight();
  });
  grid.addEventListener('dragend', () => {
    stopAutoScroll();
    dragIdx = null;
    clearDragHighlight();
  });

  // --- iOS タッチ: 長押し300msでドラッグ開始 ---
  grid.addEventListener('touchstart', (e) => {
    const item = e.target.closest('.preview-item');
    if (!item || e.target.closest('.remove')) return;

    const t0 = e.touches[0];
    const startX = t0.clientX, startY = t0.clientY;
    let ghost = null;
    let ghostHalfW = 0, ghostHalfH = 0;
    let overItem = null;   // 現在ハイライト中のドロップ先

    // リスナーを外すだけ（状態リセットは cancel でまとめて行う）
    const detach = () => {
      document.removeEventListener('touchmove', onMove, false);
      document.removeEventListener('touchend',   onEnd,    false);
      document.removeEventListener('touchcancel', onCancel, false);
    };

    // ドラッグを中止してすべての状態を初期化
    const cancel = () => {
      clearTimeout(timer);
      detach();
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      ghost = null;
      item.classList.remove('dragging');
      grid.classList.remove('drag-sorting');
      if (overItem) { overItem.classList.remove('drag-over'); overItem = null; }
      stopAutoScroll();
      dragIdx = null;
    };

    // 300ms 長押しでドラッグ開始
    const timer = setTimeout(() => {
      dragIdx = Number(item.dataset.idx);
      item.classList.add('dragging');
      grid.classList.add('drag-sorting');
      if (navigator.vibrate) navigator.vibrate(30);
      const rect = item.getBoundingClientRect();
      ghostHalfW = rect.width / 2;   // 以降 offsetWidth を叩かない（強制リフロー回避）
      ghostHalfH = rect.height / 2;
      ghost = item.cloneNode(true);
      ghost.classList.remove('dragging');
      const gi = ghost.querySelector('img');
      if (gi) Object.assign(gi.style, {
        width: '100%', height: rect.height + 'px', objectFit: 'cover', display: 'block',
      });
      Object.assign(ghost.style, {
        position: 'fixed', pointerEvents: 'none', opacity: '0.85',
        zIndex: '9999', overflow: 'hidden',
        width: rect.width + 'px', height: rect.height + 'px',
        left: (startX - ghostHalfW) + 'px', top: (startY - ghostHalfH) + 'px',
        transform: 'scale(1.08)', borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
      });
      document.body.appendChild(ghost);
    }, 300);

    const onMove = (e) => {
      if (!ghost) {
        // タイマー前 → 大きく動いたらスクロール判定でキャンセル
        const t = e.touches[0];
        if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) cancel();
        return;
      }
      e.preventDefault();
      const t = e.touches[0];
      // display:none 不要: ghost は pointerEvents:none なので elementFromPoint が素通りする
      ghost.style.left = (t.clientX - ghostHalfW) + 'px';
      ghost.style.top  = (t.clientY - ghostHalfH) + 'px';
      updateAutoScroll(t.clientX);
      const below = document.elementFromPoint(t.clientX, t.clientY);
      const newOver = (below && below.closest('.preview-item'));
      const target = (newOver && newOver !== item) ? newOver : null;
      // 変化したときだけ DOM を触る（毎フレーム querySelectorAll 不要）
      if (target !== overItem) {
        if (overItem) overItem.classList.remove('drag-over');
        overItem = target;
        if (overItem) overItem.classList.add('drag-over');
      }
    };

    const onEnd = (e) => {
      const savedDragIdx = dragIdx;   // cancel() が dragIdx をリセットする前に保存
      const hadGhost = !!ghost;
      const t = e.changedTouches[0];
      cancel();                       // ghost 削除 + リスナー解除 + 状態リセット
      if (hadGhost && t && savedDragIdx !== null) {
        // ghost 削除済みなので elementFromPoint で下の要素を確実に取得できる
        const below = document.elementFromPoint(t.clientX, t.clientY);
        const over = below && below.closest('.preview-item');
        const dropIdx = getDropIndex(t.clientX, (over && over !== item) ? over : null);
        movePreviewItem(savedDragIdx, dropIdx);
      }
    };

    const onCancel = () => cancel();

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend',   onEnd,    false);
    document.addEventListener('touchcancel', onCancel, false);
  }, { passive: true });
}

async function saveBlobToDevice(blob, filename) {
  const file = new File([blob], filename, { type: 'image/jpeg' });
  // iOS Safari は navigator.share でシステム共有シート → 「画像を保存」で写真アプリへ
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('share失敗→ダウンロードにフォールバック', e);
    }
  }
  // フォールバック: aタグでダウンロード
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----- カテゴリ別採寸フォーム -----
const MEASUREMENT_SCHEMA = {
  suit: [
    { section: 'ジャケット', fields: [
      { key: 'j_shoulder', label: '肩幅' },
      { key: 'j_chest', label: '身幅' },
      { key: 'j_sleeve', label: '袖丈' },
      { key: 'j_length', label: '着丈' },
    ]},
    { section: 'パンツ', fields: [
      { key: 'p_waist', label: 'ウエスト' },
      { key: 'p_inseam', label: '股下' },
      { key: 'p_rise', label: '股上' },
      { key: 'p_hem', label: '裾幅' },
    ]},
    { section: 'ベスト', fields: [
      { key: 'v_shoulder', label: '肩幅' },
      { key: 'v_chest', label: '身幅' },
      { key: 'v_length', label: '着丈' },
    ]},
  ],
  tops: [
    { section: '採寸', fields: [
      { key: 'shoulder', label: '肩幅' },
      { key: 'chest', label: '身幅' },
      { key: 'sleeve', label: '袖丈' },
      { key: 'length', label: '着丈' },
    ]},
  ],
  bottoms: [
    { section: '採寸', fields: [
      { key: 'waist', label: 'ウエスト' },
      { key: 'inseam', label: '股下' },
      { key: 'rise', label: '股上' },
      { key: 'hem', label: '裾幅' },
    ]},
  ],
  bag: [
    { section: '採寸', fields: [
      { key: 'bag_height', label: '縦' },
      { key: 'bag_width',  label: '横' },
      { key: 'bag_depth',  label: 'マチ' },
      { key: 'bag_handle', label: '持ち手' },
    ]},
  ],
  other: [
    { section: '採寸', fields: [
      { key: 'other_height', label: '縦' },
      { key: 'other_width',  label: '横' },
      { key: 'other_depth',  label: '高さ' },
    ]},
  ],
};

function renderMeasurements() {
  const cat = el('category').value;
  const container = el('measurement-fields');
  stopActiveMultiVoiceInput({ clearStatus: true });
  container.innerHTML = '';
  if (!cat) {
    updateGenerateButton();
    updateSizeSuggestion();
    return;
  }

  // 連続音声入力バー
  const voiceBar = document.createElement('div');
  voiceBar.className = 'multi-voice-bar';
  voiceBar.innerHTML = `
    <button type="button" id="multi-voice-btn" class="multi-voice-btn">🎤 まとめて音声入力</button>
    <div id="multi-voice-status" class="multi-voice-status"></div>
    <div class="multi-voice-hint">例:「肩幅 45」「袖丈 60.5」… 続けて話せます</div>
  `;
  container.appendChild(voiceBar);

  const schema = MEASUREMENT_SCHEMA[cat];
  schema.forEach((section, si) => {
    const div = document.createElement('div');
    div.className = 'measurement-section';
    div.innerHTML = `<h3>${section.section}</h3>`;
    section.fields.forEach(f => {
      const row = document.createElement('div');
      row.className = 'measurement-row';
      row.innerHTML = `
        <label for="m-${f.key}">${f.label}</label>
        <input type="number" id="m-${f.key}" inputmode="decimal" step="0.5" min="0">
        <span class="unit">cm</span>
      `;
      div.appendChild(row);
    });
    container.appendChild(div);
  });

  // ラグランスリーブトグル（アウター・トップス）
  if (cat === 'tops') {
    const raglanDiv = document.createElement('div');
    raglanDiv.className = 'measurement-section';
    raglanDiv.innerHTML = `
      <label><input type="checkbox" id="raglan-toggle"> ラグランスリーブ（ゆき丈を追加）</label>
      <div id="raglan-field" hidden>
        <div class="measurement-row">
          <label for="m-yuki">ゆき丈</label>
          <input type="number" id="m-yuki" inputmode="decimal" step="0.5" min="0">
          <span class="unit">cm</span>
        </div>
      </div>
    `;
    container.appendChild(raglanDiv);
    el('raglan-toggle').addEventListener('change', (e) => {
      el('raglan-field').hidden = !e.target.checked;
      scheduleSave();
    });
  }

  // 採寸値入力イベント（サイズ推定＋保存）
  container.querySelectorAll('input[type="number"]').forEach(inp => {
    inp.addEventListener('input', () => {
      updateSizeSuggestion();
      scheduleSave();
    });
  });

  // 連続音声入力
  const mvBtn = el('multi-voice-btn');
  if (mvBtn) {
    mvBtn.addEventListener('click', () => {
      if (mvBtn._stopFn) mvBtn._stopFn();
      else startMultiVoiceInput(mvBtn);
    });
  }

  updateGenerateButton();
  updateSizeSuggestion();
}

function collectMeasurements() {
  const cat = el('category').value;
  if (!cat) return null;
  const schema = MEASUREMENT_SCHEMA[cat];
  const values = {};
  schema.forEach(section => {
    section.fields.forEach(f => {
      const input = el('m-' + f.key);
      values[f.key] = input ? input.value : '';
    });
  });
  // ラグラン
  const raglanToggle = el('raglan-toggle');
  if (raglanToggle && raglanToggle.checked) {
    values.yuki = el('m-yuki') ? el('m-yuki').value : '';
  }
  return { category: cat, values };
}

// ----- 採寸値テキスト整形 -----
function formatMeasurements(m) {
  if (!m) return '';
  const cat = m.category;
  const v = m.values;
  const line = (label, val) => `${label}：${val || '---'}cm`;
  if (cat === 'suit') {
    return [
      'ジャケット',
      line('肩幅', v.j_shoulder),
      line('身幅', v.j_chest),
      line('袖丈', v.j_sleeve),
      line('着丈', v.j_length),
      'パンツ',
      line('ウエスト', v.p_waist),
      line('股下', v.p_inseam),
      line('股上', v.p_rise),
      line('裾幅', v.p_hem),
      'ベスト',
      line('肩幅', v.v_shoulder),
      line('身幅', v.v_chest),
      line('着丈', v.v_length),
    ].join('\n');
  }
  if (cat === 'tops') {
    const lines = [
      line('肩幅', v.shoulder),
      line('身幅', v.chest),
      line('袖丈', v.sleeve),
      line('着丈', v.length),
    ];
    if (v.yuki !== undefined) lines.push(line('ゆき丈', v.yuki));
    return lines.join('\n');
  }
  if (cat === 'bottoms') {
    return [
      line('ウエスト', v.waist),
      line('股下', v.inseam),
      line('股上', v.rise),
      line('裾幅', v.hem),
    ].join('\n');
  }
  if (cat === 'bag') {
    return [
      line('縦', v.bag_height),
      line('横', v.bag_width),
      line('マチ', v.bag_depth),
      line('持ち手', v.bag_handle),
    ].join('\n');
  }
  if (cat === 'other') {
    return [
      line('縦', v.other_height),
      line('横', v.other_width),
      line('高さ', v.other_depth),
    ].join('\n');
  }
  return '';
}

// ----- 生成ボタンの活性状態 -----
function updateGenerateButton() {
  const hasPhotos = uploadedImages.length > 0;
  const hasCategory = !!el('category').value;
  const ready = hasPhotos && hasCategory;
  el('generate-btn').disabled = !ready;
  const note = el('generate-note');
  if (note) {
    note.classList.toggle('ready', ready);
    if (!hasPhotos && !hasCategory) {
      note.textContent = '写真を追加して、カテゴリを選ぶと生成できます。';
    } else if (!hasPhotos) {
      note.textContent = '写真を1枚以上追加してください。タグ写真もあると精度が上がります。';
    } else if (!hasCategory) {
      note.textContent = 'カテゴリを選択してください。採寸欄が出ます。';
    } else {
      note.textContent = '生成できます。採寸も入れると説明文の精度が上がります。';
    }
  }
  updatePhotoSummary();
}

// ----- AIコール -----
const SYSTEM_PROMPT = `あなたはメルカリ古着出品のプロです。
アップロードされた古着の写真を分析し、以下の情報をJSON形式で返してください。

抽出する情報:
1. brand — ブランド名のカタカナ表記（タグから読み取る。読み取れなければ "---"）
   - 必ず**カタカナ表記**で出力すること（メルカリの検索でカタカナがよく使われるため）
   - 例: BURBERRY → バーバリー / Paul Smith → ポールスミス / POLO RALPH LAUREN → ポロラルフローレン
   - 例: UNIQLO → ユニクロ / ZARA → ザラ / BEAMS → ビームス
   - 例: Burberry London → バーバリーロンドン / BLACK LABEL CRESTBRIDGE → ブラックレーベルクレストブリッジ
   - ライン名も含む場合はカタカナで連結（例: バーバリーブラックレーベル）
   - 日本語ブランド名（無印良品、ユナイテッドアローズ等）はそのまま日本語で
1a. brand_en — ブランド名の英語（アルファベット）表記（タグに記載の原文をそのまま出力。読み取れなければ "---"）
   - 例: BURBERRY / Paul Smith / POLO RALPH LAUREN / UNIQLO / BEAMS
   - 日本語ブランドでアルファベット表記がない場合は "---"
2. item — アイテム名（テーラードジャケット、トレンチコート、チノパンなど）
3. tag_size — タグ表記のサイズ（S/M/L/XL/46/48等。読み取れなければ "---"）
4. color — カラー。カタカナ＋漢字のペアで（例: "ネイビー 紺色"）
   - 暗い色は特に慎重に判断すること:
     * 黒に見えても、わずかに青みがあれば「ネイビー 紺色」
     * 黒に見えても、わずかに緑みがあれば「カーキ 深緑色」
     * 黒に見えても、わずかに茶みがあれば「ダークブラウン こげ茶色」
     * 完全な黒（青・緑・茶の色味が全くない）のみ「ブラック 黒」
   - 複数枚の写真があれば、光の加減で色が変わるため全体の印象で判断
   - 迷ったら「黒っぽい」より「ネイビー 紺色」を優先（メルカリでは紺色の方がクリック率が高い傾向）
5. material — 素材（タグから読み取る。表地/裏地がある場合は分ける。読み取れなければ "---"）
6. condition — 状態。ダメージがなければ "目立った傷や汚れのない美品です。詳細は写真をご確認ください"。ダメージがあれば具体的に記載
7. appeal — 商品の特徴・訴求ポイント2〜3文。以下を自然に含める:
8. mercari_condition — 商品の状態（メルカリUI用）。以下の6択から1つ選ぶ: "新品、未使用" / "未使用に近い" / "目立った傷や汚れなし" / "やや傷や汚れあり" / "傷や汚れあり" / "全体的に状態が悪い"
   - デザインや素材の特徴
   - 季節感（春夏向き、秋冬向き、3シーズンなど）
   - 使えるシーン（ビジネス、カジュアル、セレモニーなど）
   - 商品の事実（素材・シルエット・カラー・シーン）を軸にしながら、「手に取った瞬間から違いがわかる」「着るだけで雰囲気が変わる」「なかなか出回らない」など感情に訴える一言を自然に散りばめる
   - ウール・カシミヤ・リネン・シルク・コーデュロイ・綿100％などアピールできる素材であれば、その質感や着心地にも触れる。素材の訴求力はアイテムや文脈で判断すること（例：綿100％はトレンチコートでは高品質の証として積極的に触れる）。ポリエステルが主体など訴求力の低い素材は触れなくてよい
   - ただし「ぜひ」「いかがでしょうか」「手放せない」「激レア」「一着」のような過剰なセールストーク・定型文は使わない
   - 「なかなか出回らない」は商品・モデルの希少性に使う場合のみ。雰囲気・質感など抽象的なものにかけない
   - ブランド名・アイテム名は含めない（直後の【商品名】欄に記載されるため）
   - トレンチコートにライナー（取り外し可能な裏地）が付いている場合は必ず触れる（着回しの幅が広がる重要な訴求ポイントのため）

ルール:
- 写真から読み取れない情報は "---" と記載する（推測で埋めない）
- 状態は正直に記載する（ダメージを隠さない）
- appealの文章は丁寧だが簡潔に
- **出力は JSON オブジェクト1つのみ**。前置きの文章・後置きの説明・「以下の通りです」のような挨拶・\`\`\`json などのコードフェンス・改行のみの行を一切含めない。最初の文字は { で、最後の文字は } とすること
- JSON 内の文字列は二重引用符 " で囲む（' は使わない）。文字列中の改行は \\n でエスケープする

{"brand":"...","brand_en":"...","item":"...","tag_size":"...","color":"...","material":"...","condition":"...","appeal":"...","mercari_condition":"目立った傷や汚れなし"}`;

/**
 * AI応答からJSONオブジェクトを取り出す。
 * - 素直にパースできればそれを返す
 * - ```json ... ``` のmarkdownを剥がす
 * - 最初の { から最後の } までを抜き出して再試行
 * - 末尾のカンマやコードフェンス残骸も除去
 * 失敗時は例外を投げる
 */
function parseAiJson(rawText) {
  if (!rawText) throw new Error('empty response');
  let text = String(rawText).trim();

  // そのまま試す
  try { return JSON.parse(text); } catch (_) {}

  // ```json ... ``` または ``` ... ``` を剥がす
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try { return JSON.parse(inner); } catch (_) {}
    text = inner;
  }

  // 先頭 { と末尾 } の範囲を取り出す
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    let candidate = text.slice(first, last + 1);
    // 末尾の余分なカンマ ( "key": "val", } ) を消す
    candidate = candidate.replace(/,(\s*[}\]])/g, '$1');
    // smart quotes を ASCII に正規化
    candidate = candidate
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    try { return JSON.parse(candidate); } catch (_) {}
  }

  throw new Error('not a parseable JSON');
}

function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

async function getMercariServiceUrl(statusCallback) {
  const gasUrl = localStorage.getItem(SERVICE_URL_KEY);
  if (!gasUrl) throw new Error('設定画面でGAS URLを入力してください');

  statusCallback?.('MacサービスURLを取得中...');
  const gasResp = await fetchWithTimeout(
    gasUrl,
    {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getTunnelUrl' }),
    },
    15000
  );
  const gasData = await gasResp.json();
  let tunnelUrl = (gasData.data && gasData.data.url) || '';
  if (!tunnelUrl) throw new Error('Macのメルカリ自動入力サービスが起動していません。Macでstart.pyを確認してください。');
  tunnelUrl = tunnelUrl.replace(/\/+$/, '');

  statusCallback?.('Macサービスに接続確認中...');
  const pingOk = async (url) => {
    const resp = await fetchWithTimeout(`${url}/ping`, {}, 8000);
    const json = await resp.json();
    return !!json.ok;
  };

  let passed = false;
  try { passed = await pingOk(tunnelUrl); } catch (_) {}
  if (!passed) {
    statusCallback?.('トンネル再接続中... (3秒後に再試行)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const retryResp = await fetchWithTimeout(
      gasUrl,
      {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'getTunnelUrl' }),
      },
      15000
    );
    const retryData = await retryResp.json();
    tunnelUrl = ((retryData.data && retryData.data.url) || tunnelUrl).replace(/\/+$/, '');
    statusCallback?.('再接続確認中...');
    try { passed = await pingOk(tunnelUrl); } catch (_) {}
  }

  if (!passed) throw new Error('Macサービスに接続できません。Cloudflare tunnelの再起動が必要です。');
  return tunnelUrl;
}

async function callDescriptionAi(images, onChunk) {
  const tunnelUrl = await getMercariServiceUrl((message) => {
    if (onChunk) onChunk(message);
  });

  if (onChunk) onChunk('AIが画像を分析中...');
  const res = await fetchWithTimeout(
    `${tunnelUrl}/describe`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: images.map(img => ({ mediaType: img.mediaType, base64: img.base64 })),
        systemPrompt: SYSTEM_PROMPT,
      }),
    },
    120000
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `AI APIエラー (${res.status})`);
  }
  if (!data.text) {
    throw new Error('AI応答が空でした');
  }
  if (onChunk) onChunk(data.text);
  return data.text;
}

// ----- テンプレート組み立て -----
function buildDescription(aiData, measurementText) {
  const brand = aiData.brand || '---';
  const brandEn = (aiData.brand_en && aiData.brand_en !== '---') ? aiData.brand_en : '';
  const item = aiData.item || '---';
  const tagSize = aiData.tag_size || '---';
  const color = aiData.color || '---';
  const material = aiData.material || '---';
  const condition = aiData.condition || '---';
  const appeal = aiData.appeal || '';

  return `〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜
✨フォロー割あり✨
3000円以上 → 200円引き
5000円以上 → 300円引き
10000円以上 → 500円引き
15000円以上 → 800円引き
ご購入前に「フォローしました」とコメントお願いします
※購入後は割引不可です
〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜

ご覧いただきありがとうございます✨

${appeal}

【商品名】${brand}${brandEn ? ' ' + brandEn : ''} ${item}

【サイズ】${tagSize}（平置き採寸）
${measurementText}
※多少の誤差はご了承ください。

【カラー】${color}

【素材】${material}

【状態】${condition}

✅即購入OKです！
✅丁寧に梱包して発送いたします。
※あくまで自宅保管の中古品ですので、ご理解のある方のご購入をお願いいたします。

【購入元】
大手リユースストア
日本流通自主管理協会加盟店（AACD）
質屋・古物市場`;
}

// ----- 生成実行 -----
async function generateDescription() {
  const measurements = collectMeasurements();
  if (!measurements) { alert('カテゴリを選んでください'); return; }
  if (!uploadedImages.length) { alert('写真を選んでください'); return; }

  el('generate-btn').disabled = true;

  // 結果セクションをすぐに表示してストリーミング状態に
  const textarea = el('result-text');
  textarea.value = '';
  textarea.classList.add('streaming');
  el('title-text').value = '';
  el('mercari-settings').hidden = true;
  const fsb = el('final-size-badge'); if (fsb) fsb.hidden = true;
  el('result-section').hidden = false;
  showStatus('status', 'AIが画像を分析中...', 'loading');
  setTimeout(() => el('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  try {
    const rawText = await callDescriptionAi(uploadedImages, (chunk) => {
      textarea.value = chunk;
      textarea.scrollTop = textarea.scrollHeight;
    });

    textarea.classList.remove('streaming');

    let aiData;
    try {
      aiData = parseAiJson(rawText);
    } catch (e) {
      console.error('AI応答パース失敗:', e, 'rawText:', rawText);
      showStatus('status', '⚠️ AIの応答がJSON形式でなかったため、そのまま表示しました。ブラウザのコンソールで詳細を確認できます。', 'error');
      el('generate-btn').disabled = false;
      return;
    }
    const measurementText = formatMeasurements(measurements);
    const description = buildDescription(aiData, measurementText);
    textarea.value = description;
    // 商品名（タイトル）をセット
    const brand = aiData.brand || '';
    const item = aiData.item || '';
    const titleCore = [brand, item].filter(Boolean).join(' ').trim();
    const title = titleCore ? '✨美品✨ ' + titleCore : '';
    el('title-text').value = title;
    // 下書き機能用にAIデータを保存
    lastAiData = {
      title: title,
      description: description,
      category: measurements.category,
      measurements: measurements,
      images: uploadedImages,
    };
    renderFinalSize(aiData);
    // メルカリ設定をAIデータで自動入力
    el('mercari-settings').hidden = false;
    if (aiData.mercari_condition) el('m-condition').value = aiData.mercari_condition;
    updateDraftChecklist();
    hideStatus('status');
  } catch (err) {
    textarea.classList.remove('streaming');
    console.error(err);
    showStatus('status', '❌ 生成失敗: ' + err.message, 'error');
  } finally {
    el('generate-btn').disabled = false;
    updateGenerateButton();
  }
}

// ----- 再生成 -----
function retryGeneration() {
  if (confirm('もう一度AI生成を実行しますか？（APIコールが発生します）')) {
    generateDescription();
  }
}

// ----- IndexedDB 状態永続化 -----
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        d.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveSession(state) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ id: 'current', ...state, _savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function loadSession() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('current');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function clearSessionDb() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete('current');
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function collectState() {
  const category = el('category').value;
  const measurements = {};
  document.querySelectorAll('#measurement-fields input[type="number"]').forEach(inp => {
    measurements[inp.id] = inp.value;
  });
  const raglanToggle = el('raglan-toggle');
  return {
    photos: uploadedImages,
    category,
    raglanChecked: raglanToggle ? raglanToggle.checked : false,
    measurements,
    title: el('title-text').value,
    result: el('result-text').value,
    resultVisible: !el('result-section').hidden,
    mercariSettingsVisible: !el('mercari-settings').hidden,
    mercariCondition: el('m-condition').value,
  };
}

let _saveTimer = null;
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveSession(collectState()).catch(e => console.warn('保存失敗:', e));
  }, 400);
}

function restoreState(s) {
  if (!s) return;
  if (Array.isArray(s.photos) && s.photos.length) {
    uploadedImages = s.photos.map(p => ({
      ...p,
      originalDataUrl: p.originalDataUrl || p.dataUrl,
      adjust: p.adjust || { brightness: 0, temp: 0, contrast: 0 },
    }));
    renderPreviews();
  }
  if (s.category) {
    el('category').value = s.category;
    renderMeasurements();
    if (s.raglanChecked && el('raglan-toggle')) {
      el('raglan-toggle').checked = true;
      el('raglan-field').hidden = false;
    }
    if (s.measurements) {
      for (const [id, val] of Object.entries(s.measurements)) {
        const inp = document.getElementById(id);
        if (inp) inp.value = val;
      }
    }
    updateSizeSuggestion();
  }
  if (s.title) el('title-text').value = s.title;
  if (s.result) el('result-text').value = s.result;
  if (s.resultVisible && s.result) {
    el('result-section').hidden = false;
  }
  // メルカリ設定の復元
  if (s.mercariSettingsVisible) {
    el('mercari-settings').hidden = false;
    if (s.mercariCondition) el('m-condition').value = s.mercariCondition;
  }
  updateGenerateButton();
  updatePhotoSummary();
}

// ----- メインタブ / 相場リサーチ -----
function switchMainTab(tab) {
  const description = tab === 'description';
  el('description-panel').hidden = !description;
  el('research-panel').hidden = description;
  el('description-panel').classList.toggle('active', description);
  el('research-panel').classList.toggle('active', !description);
  el('description-tab-btn').classList.toggle('active', description);
  el('research-tab-btn').classList.toggle('active', !description);
  el('description-tab-btn').setAttribute('aria-selected', String(description));
  el('research-tab-btn').setAttribute('aria-selected', String(!description));
}

function readJsonList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeJsonList(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getResearchBrand(request) {
  return String(request?.brand || '').trim();
}

function normalizeResearchValue(value) {
  const text = String(value || '').trim();
  return RESEARCH_EMPTY_VALUES.has(text) ? '' : text;
}

function getSelectedOptionLabel(id) {
  const node = el(id);
  const option = node?.selectedOptions?.[0];
  return String(option?.dataset?.label || option?.textContent || node?.value || '').trim();
}

function getResearchCategoryLabel(request) {
  return normalizeResearchValue(request?.categoryLabel)
    || normalizeResearchValue(request?.category)
    || normalizeResearchValue(request?.genre);
}

function getResearchCategoryKeyword(request) {
  return normalizeResearchValue(request?.category)
    || normalizeResearchValue(request?.genre);
}

function buildResearchKeyword(request) {
  const keywordInput = normalizeResearchValue(request?.keywordInput);
  const brand = normalizeResearchValue(request?.brand);
  const category = getResearchCategoryKeyword(request);
  const gender = normalizeResearchValue(request?.gender);
  const size = normalizeResearchValue(request?.size);
  return [brand, keywordInput, category, gender, size].filter(Boolean).join(' ');
}

function buildResearchCondition(request) {
  const brand = getResearchBrand(request);
  const keywordInput = normalizeResearchValue(request?.keywordInput);
  const category = getResearchCategoryLabel(request);
  const gender = normalizeResearchValue(request?.gender);
  const size = normalizeResearchValue(request?.size);
  const condition = normalizeResearchValue(request?.condition);
  const saleStatus = normalizeResearchValue(request?.saleStatus);
  return [keywordInput, brand, category, gender, size, condition, saleStatus].filter(Boolean).join(' / ');
}

function hasResearchSearchAxis(request) {
  return Boolean(
    getResearchBrand(request)
    || normalizeResearchValue(request?.keywordInput)
    || getResearchCategoryKeyword(request)
    || getResearchCategoryLabel(request)
    || normalizeResearchValue(request?.keyword)
  );
}

function formatResearchDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatResearchPriceRange(request) {
  const min = Number(request?.minPrice || 0);
  const max = Number(request?.maxPrice || 0);
  if (min && max) return `${min.toLocaleString()}〜${max.toLocaleString()}円`;
  if (min) return `${min.toLocaleString()}円〜`;
  if (max) return `〜${max.toLocaleString()}円`;
  return '価格指定なし';
}

function formatResearchPeriod(value) {
  const months = Number(value || 0);
  if (!months) return '期間指定なし';
  return months === 1 ? '直近1ヶ月' : `直近${months}ヶ月`;
}

function getResearchStatusClass(status) {
  const text = String(status || '');
  if (/完了|調査済み|done|completed/i.test(text)) return 'done';
  if (/失敗|エラー|error/i.test(text)) return 'error';
  if (/実行|処理|running/i.test(text)) return 'running';
  return 'waiting';
}

function renderResearchChipRow(values) {
  const chips = values
    .map(value => normalizeResearchValue(value))
    .filter(Boolean)
    .map(value => `<span class="research-chip">${escapeHtml(value)}</span>`)
    .join('');
  return chips ? `<div class="research-chip-row">${chips}</div>` : '';
}

function updateResearchPreview() {
  const node = el('research-condition-preview');
  if (!node) return;
  const request = {
    keywordInput: el('research-keyword')?.value || '',
    category: el('research-category')?.value || '',
    categoryLabel: getSelectedOptionLabel('research-category'),
    brand: el('research-brand')?.value || '',
    size: el('research-size')?.value || '',
    condition: el('research-condition')?.value || '',
    gender: el('research-gender')?.value || '',
    saleStatus: el('research-sale-status')?.value || '',
  };
  const condition = buildResearchCondition(request);
  const minPrice = Number(el('research-min-price')?.value || 0);
  const maxPrice = Number(el('research-max-price')?.value || 0);
  const sampleSize = Number(el('research-sample-size')?.value || 200);
  const sort = el('research-sort')?.value || '新しい順';
  const periodMonths = Number(el('research-period-months')?.value || 0);
  const priceText = formatResearchPriceRange({ minPrice, maxPrice });
  node.innerHTML = `
    <span>現在の条件</span>
    <strong>${escapeHtml(condition || '検索条件を入力してください')}</strong>
    ${renderResearchChipRow([
      getSelectedOptionLabel('research-category'),
      request.gender,
      request.size,
      request.condition,
      request.saleStatus,
      priceText,
      `${sampleSize.toLocaleString()}件`,
      sort,
      formatResearchPeriod(periodMonths),
    ])}
  `;
}

function collectResearchForm() {
  const title = el('research-title').value.trim();
  const keywordInput = el('research-keyword').value.trim();
  const category = el('research-category').value;
  const categoryLabel = getSelectedOptionLabel('research-category');
  const brand = el('research-brand').value.trim();
  const size = el('research-size').value;
  const condition = el('research-condition').value;
  const gender = el('research-gender').value;
  const saleStatus = el('research-sale-status').value;
  const minPrice = Number(el('research-min-price').value || 0);
  const maxPrice = Number(el('research-max-price').value || 0);
  const sampleSize = Number(el('research-sample-size').value || 200);
  const sort = el('research-sort').value;
  const periodMonths = Number(el('research-period-months').value || 0);
  const excludes = el('research-excludes').value.trim();
  const note = el('research-note').value.trim();
  const requestBase = { keywordInput, category, categoryLabel, brand, size, condition, gender, saleStatus };
  const keyword = buildResearchKeyword(requestBase);
  const fallbackTitle = [brand, keywordInput, categoryLabel || category, normalizeResearchValue(gender)]
    .filter(Boolean)
    .join(' ');
  return {
    id: `research-${Date.now()}`,
    createdAt: new Date().toISOString(),
    title: title || fallbackTitle || '相場リサーチ',
    brand,
    keyword,
    keywordInput,
    category,
    categoryLabel,
    genre: category,
    size,
    condition,
    gender,
    saleStatus,
    minPrice,
    maxPrice,
    sampleSize,
    sort,
    periodMonths,
    excludes,
    note,
    status: '未調査',
  };
}

async function saveResearchRequest() {
  const request = collectResearchForm();
  if (!hasResearchSearchAxis(request)) {
    alert('カテゴリー、ブランド、検索キーワードのいずれかを指定してください');
    return;
  }
  const list = readJsonList(RESEARCH_REQUESTS_KEY);
  list.unshift(request);
  writeJsonList(RESEARCH_REQUESTS_KEY, list.slice(0, 50));
  clearResearchForm(false);
  renderResearchData();
  await syncResearchRequestToMac(request);
}

function clearResearchForm(keepBrand) {
  el('research-title').value = '';
  el('research-keyword').value = '';
  if (!keepBrand) el('research-brand').value = '';
  el('research-note').value = '';
  el('research-period-months').value = '0';
  updateResearchPreview();
}

function buildResearchPrompt(requests) {
  const targets = requests.length ? requests : [collectResearchForm()].filter(hasResearchSearchAxis);
  if (!targets.length) return '';
  const lines = [
    '# メルカリ相場リサーチ依頼',
    '',
    '共通条件:',
    '- メルカリの売り切れ商品を対象',
    '- 個人出品寄りを優先',
    '- 業者風、専用、公式/ショップ、明らかな別ジャンルは除外',
    '- メルカリの絞り込み順に近い条件で確認',
    '- カテゴリー・ブランド・サイズ・状態・販売状況を別項目として絞り込む',
    '- 出力はブランド別、状態別、高単価サンプル、仕入れ目線の所感でまとめる',
    '',
    '調査対象:',
  ];
  targets.forEach((r, idx) => {
    const brand = getResearchBrand(r);
    lines.push('');
    lines.push(`## ${idx + 1}. ${r.title}`);
    if (r.keywordInput) lines.push(`- 検索キーワード: ${r.keywordInput}`);
    lines.push(`- カテゴリー: ${getResearchCategoryLabel(r) || r.genre || '指定なし'}`);
    lines.push(`- ブランド: ${brand || '指定なし'}`);
    lines.push(`- サイズ: ${r.size || '指定なし'}`);
    lines.push(`- 商品の状態: ${r.condition || 'すべて'}`);
    lines.push(`- 対象: ${r.gender || '指定なし'}`);
    lines.push(`- 販売状況: ${r.saleStatus || '売り切れ'}`);
    lines.push(`- 調査条件: ${buildResearchCondition(r)}`);
    lines.push(`- 価格帯: ${r.minPrice.toLocaleString()}〜${r.maxPrice.toLocaleString()}円`);
    lines.push(`- サンプル数: ${r.sampleSize}件`);
    lines.push(`- 並び順: ${r.sort}`);
    lines.push(`- 対象期間: ${formatResearchPeriod(r.periodMonths)}`);
    lines.push(`- 除外ワード: ${r.excludes || 'なし'}`);
    if (r.note) lines.push(`- 補足: ${r.note}`);
  });
  return lines.join('\n');
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  return ok;
}

async function copyResearchRequestForNightWork() {
  const requests = readJsonList(RESEARCH_REQUESTS_KEY);
  const text = buildResearchPrompt(requests);
  if (!text) {
    alert('先に調査依頼を保存するか、カテゴリーなどの条件を入力してください');
    return;
  }
  try {
    await copyText(text);
    alert('相場リサーチ依頼文をコピーしました');
  } catch (e) {
    console.warn(e);
    alert('コピーに失敗しました');
  }
}

function setResearchStatus(message, kind = '') {
  const node = el('research-sync-status');
  if (!node) return;
  node.hidden = !message;
  node.className = 'status ' + kind;
  node.textContent = message || '';
}

function upsertLocalResearchRequest(request) {
  const list = readJsonList(RESEARCH_REQUESTS_KEY);
  const next = [request, ...list.filter(item => item.id !== request.id)];
  writeJsonList(RESEARCH_REQUESTS_KEY, next.slice(0, 50));
  renderResearchRequests();
}

async function syncResearchRequestToMac(request) {
  setResearchStatus('Macへ調査依頼を送信中...');
  try {
    const tunnelUrl = await getMercariServiceUrl((message) => setResearchStatus(message));
    const resp = await fetchWithTimeout(`${tunnelUrl}/research/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }, 20000);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '送信に失敗しました');
    if (data.request) upsertLocalResearchRequest(data.request);
    setResearchStatus('Macへ保存しました。夜間に自動リサーチされます。', 'success');
  } catch (e) {
    console.warn(e);
    setResearchStatus(`アプリ内には保存しました。Mac同期は未完了: ${e.message}`, 'warn');
  }
}

function mergeResearchResults(incoming) {
  const local = readJsonList(RESEARCH_RESULTS_KEY);
  const byId = new Map();
  [...incoming, ...local].forEach(item => {
    if (!item) return;
    const id = item.id || `${item.requestId || 'manual'}-${item.createdAt || Date.now()}`;
    byId.set(id, { ...item, id });
  });
  const merged = Array.from(byId.values())
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 60);
  writeJsonList(RESEARCH_RESULTS_KEY, merged);
  renderResearchResults();
}

async function refreshResearchResultsFromMac({ silent = false } = {}) {
  if (!silent) setResearchStatus('Macから相場リサーチ結果を取得中...');
  try {
    const tunnelUrl = await getMercariServiceUrl((message) => {
      if (!silent) setResearchStatus(message);
    });
    const resp = await fetchWithTimeout(`${tunnelUrl}/research/results`, {}, 20000);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '結果取得に失敗しました');
    mergeResearchResults(data.results || []);
    if (!silent) setResearchStatus(`結果を更新しました（${(data.results || []).length}件）`, 'success');
  } catch (e) {
    console.warn(e);
    if (!silent) setResearchStatus(`結果更新に失敗しました: ${e.message}`, 'warn');
  }
}

async function runResearchNow() {
  if (!confirm('待機中の相場リサーチを今すぐMacで実行しますか？')) return;
  const btn = el('research-run-btn');
  btn.disabled = true;
  setResearchStatus('Macで相場リサーチを開始しています...');
  try {
    const tunnelUrl = await getMercariServiceUrl((message) => setResearchStatus(message));
    const resp = await fetchWithTimeout(`${tunnelUrl}/research/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5 }),
    }, 20000);
    const data = await resp.json();
    if (!data.ok || !data.job_id) throw new Error(data.error || '実行開始に失敗しました');
    setResearchStatus('Macがリサーチ中です。完了まで待っています...');
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      const statusResp = await fetchWithTimeout(`${tunnelUrl}/status/${data.job_id}`, {}, 10000);
      const statusData = await statusResp.json();
      setResearchStatus(statusData.message || '処理中...');
      if (statusData.status === 'done') break;
      if (statusData.status === 'error') throw new Error(statusData.message || 'リサーチに失敗しました');
    }
    await refreshResearchResultsFromMac({ silent: true });
    setResearchStatus('相場リサーチが完了しました。結果メモを更新しました。', 'success');
  } catch (e) {
    console.warn(e);
    setResearchStatus(`リサーチ実行に失敗しました: ${e.message}`, 'warn');
  } finally {
    btn.disabled = false;
  }
}

async function handleResearchRequestAction(event) {
  const button = event.target.closest('[data-research-action]');
  if (!button) return;
  const action = button.dataset.researchAction;
  const id = button.dataset.researchId;
  const list = readJsonList(RESEARCH_REQUESTS_KEY);
  const item = list.find((request) => request.id === id);
  if (!item) return;

  if (action === 'copy') {
    try {
      await copyText(buildResearchPrompt([item]));
      alert('この調査依頼をコピーしました');
    } catch (e) {
      console.warn(e);
      alert('コピーに失敗しました');
    }
    return;
  }

  if (action === 'toggle') {
    item.status = item.status === '調査済み' ? '未調査' : '調査済み';
    writeJsonList(RESEARCH_REQUESTS_KEY, list);
    renderResearchRequests();
    return;
  }

  if (action === 'delete') {
    if (!confirm('この調査依頼を削除しますか？')) return;
    writeJsonList(RESEARCH_REQUESTS_KEY, list.filter((request) => request.id !== id));
    renderResearchRequests();
  }
}

function saveResearchResultNote() {
  const text = el('research-result-input').value.trim();
  if (!text) {
    alert('保存する結果メモを入力してください');
    return;
  }
  const list = readJsonList(RESEARCH_RESULTS_KEY);
  list.unshift({
    id: `result-${Date.now()}`,
    createdAt: new Date().toISOString(),
    title: '手動メモ',
    status: '保存済み',
    text,
  });
  writeJsonList(RESEARCH_RESULTS_KEY, list.slice(0, 30));
  el('research-result-input').value = '';
  renderResearchData();
}

function handleResearchResultAction(event) {
  const button = event.target.closest('[data-result-action]');
  if (!button) return;
  const id = button.dataset.resultId;
  if (button.dataset.resultAction !== 'delete') return;
  if (!confirm('この結果メモを削除しますか？')) return;
  const list = readJsonList(RESEARCH_RESULTS_KEY).filter((result) => result.id !== id);
  writeJsonList(RESEARCH_RESULTS_KEY, list);
  renderResearchResults();
}

function renderResearchData() {
  renderResearchRequests();
  renderResearchResults();
}

function renderResearchRequests() {
  const node = el('research-request-list');
  if (!node) return;
  const list = readJsonList(RESEARCH_REQUESTS_KEY);
  if (!list.length) {
    node.innerHTML = '<div class="research-empty">保存済みの調査依頼はまだありません</div>';
    return;
  }
  node.innerHTML = list.map((r) => `
    <article class="research-card research-request-card">
      <div class="research-card-header">
        <h3>${escapeHtml(r.title)}</h3>
        <span class="research-status ${getResearchStatusClass(r.status)}">${escapeHtml(r.status || '未調査')}</span>
      </div>
      <p class="research-card-primary">${escapeHtml(buildResearchCondition(r) || '条件未設定')}</p>
      ${renderResearchChipRow([
        getResearchCategoryLabel(r),
        r.gender,
        r.size,
        r.condition,
        r.saleStatus || '売り切れ',
        formatResearchPriceRange(r),
        `${Number(r.sampleSize || 200).toLocaleString()}件`,
        r.sort || '新しい順',
        formatResearchPeriod(r.periodMonths),
      ])}
      ${r.note ? `<p>${escapeHtml(r.note)}</p>` : ''}
      <div class="research-card-meta research-card-footer">
        <span>${escapeHtml(formatResearchDate(r.createdAt) || '日時未取得')}</span>
        <span>Mac保存後に自動調査</span>
      </div>
      <div class="research-mini-actions">
        <button type="button" data-research-action="copy" data-research-id="${escapeHtml(r.id)}">依頼文コピー</button>
        <button type="button" data-research-action="toggle" data-research-id="${escapeHtml(r.id)}">${r.status === '調査済み' ? '未調査へ戻す' : '調査済みにする'}</button>
        <button class="danger" type="button" data-research-action="delete" data-research-id="${escapeHtml(r.id)}">削除</button>
      </div>
    </article>
  `).join('');
}

function renderResearchResults() {
  const node = el('research-result-list');
  if (!node) return;
  const list = readJsonList(RESEARCH_RESULTS_KEY);
  if (!list.length) {
    node.innerHTML = '<div class="research-empty">保存済みの調査結果メモはまだありません</div>';
    return;
  }
  node.innerHTML = list.map((r) => `
    <article class="research-card research-result-card">
      <div class="research-card-header">
        <h3>${escapeHtml(r.title || '調査結果')}</h3>
        ${r.status ? `<span class="research-status ${getResearchStatusClass(r.status)}">${escapeHtml(r.status)}</span>` : ''}
      </div>
      <div class="research-card-meta">
        <span>${escapeHtml(formatResearchDate(r.createdAt) || '日時未取得')}</span>
        ${Number.isFinite(Number(r.itemCount)) ? `<span class="research-pill">${Number(r.itemCount).toLocaleString()}件</span>` : ''}
      </div>
      ${renderResearchResultBody(r)}
      <div class="research-mini-actions">
        <button class="danger" type="button" data-result-action="delete" data-result-id="${escapeHtml(r.id)}">削除</button>
      </div>
    </article>
  `).join('');
}

function renderResearchResultBody(result) {
  const stats = result.stats && typeof result.stats === 'object' ? result.stats : {};
  const samples = Array.isArray(result.samples) ? result.samples : [];
  const brandStats = getResearchBrandStats(result, samples);
  const conditionCounts = result.conditionCounts && typeof result.conditionCounts === 'object'
    ? result.conditionCounts
    : {};
  const hasStructuredData = Object.keys(stats).length || brandStats.length || samples.length || Object.keys(conditionCounts).length;

  if (!hasStructuredData) {
    return `<p class="research-result-text">${escapeHtml(result.text || '').replace(/\n/g, '<br>')}</p>`;
  }

  const sortedSamples = samples
    .filter(sample => Number(sample.price) > 0)
    .sort((a, b) => Number(b.price) - Number(a.price))
    .slice(0, 6);
  const conditionEntries = Object.entries(conditionCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const maxConditionCount = Math.max(1, ...conditionEntries.map(([, count]) => Number(count) || 0));
  const buyingNote = extractBuyingNote(result.text);
  const itemCount = Number(result.itemCount || stats.count || stats.sampleCount || 0);

  return `
    ${brandStats.length ? renderResearchBrandRanking(brandStats) : ''}
    <div class="research-summary-grid">
      ${renderResearchMetric('中央値', formatYen(stats.median), 'main')}
      ${renderResearchMetric('取得件数', itemCount > 0 ? `${Math.round(itemCount).toLocaleString()}件` : '-')}
      ${renderResearchMetric('最高', formatYen(stats.max))}
      ${renderResearchMetric('最安', formatYen(stats.min))}
      ${renderResearchMetric('平均', formatYen(stats.average))}
    </div>
    ${buyingNote ? `<div class="research-insight"><span>仕入れ目線</span>${escapeHtml(buyingNote)}</div>` : ''}
    ${conditionEntries.length ? `
      <div class="research-section">
        <div class="research-section-title">状態別</div>
        <div class="research-condition-list">
          ${conditionEntries.map(([condition, count]) => {
            const width = Math.max(10, Math.round((Number(count) / maxConditionCount) * 100));
            return `
              <div class="research-condition-row">
                <div class="research-condition-label">${escapeHtml(condition)}</div>
                <div class="research-condition-track"><span style="width:${width}%"></span></div>
                <div class="research-condition-count">${Number(count).toLocaleString()}件</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}
    ${sortedSamples.length ? `
      <div class="research-section">
        <div class="research-section-title">高単価サンプル</div>
        <div class="research-sample-list">
          ${sortedSamples.map(sample => `
            <a class="research-sample" href="${escapeHtml(sample.url || '#')}" target="_blank" rel="noopener">
              <span class="research-sample-price">${formatYen(sample.price)}</span>
              <span class="research-sample-main">
                <span class="research-sample-title">${escapeHtml(sample.title || 'タイトル未取得')}</span>
                ${sample.condition ? `<span class="research-sample-condition">${escapeHtml(sample.condition)}</span>` : ''}
              </span>
            </a>
          `).join('')}
        </div>
      </div>
    ` : ''}
    <details class="research-raw-details">
      <summary>詳細テキストを見る</summary>
      <p class="research-result-text">${escapeHtml(result.text || '').replace(/\n/g, '<br>')}</p>
      ${result.searchUrl ? `<a class="research-search-link" href="${escapeHtml(result.searchUrl)}" target="_blank" rel="noopener">検索結果を開く</a>` : ''}
    </details>
  `;
}

function renderResearchBrandRanking(brandStats) {
  const rows = brandStats.slice(0, 8);
  return `
    <div class="research-brand-ranking">
      <div class="research-section-title">ブランド別 高値ランキング</div>
      <div class="research-brand-list">
        ${rows.map((row, index) => `
          <article class="research-brand-row">
            <div class="research-brand-rank">${index + 1}</div>
            <div class="research-brand-main">
              <div class="research-brand-name">${escapeHtml(row.brand || 'ブランド未判定')}</div>
              <div class="research-brand-meta">
                <span>中央値 ${formatYen(row.median)}</span>
                <span>最高 ${formatYen(row.max)}</span>
                <span>${Number(row.count || 0).toLocaleString()}件</span>
              </div>
              ${renderResearchBrandSamples(row.samples)}
            </div>
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

function renderResearchBrandSamples(samples) {
  const rows = Array.isArray(samples) ? samples.slice(0, 2) : [];
  if (!rows.length) return '';
  return `
    <div class="research-brand-samples">
      ${rows.map(sample => `
        <a href="${escapeHtml(sample.url || '#')}" target="_blank" rel="noopener">
          <span>${formatYen(sample.price)}</span>
          <small>${escapeHtml(sample.title || 'タイトル未取得')}</small>
        </a>
      `).join('')}
    </div>
  `;
}

function renderResearchMetric(label, value, tone = '') {
  return `
    <div class="research-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function formatYen(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n).toLocaleString()}円` : '-';
}

function getResearchBrandStats(result, samples) {
  const rows = Array.isArray(result.brandStats) ? result.brandStats : [];
  if (rows.length) return rows.filter(row => row?.brand);
  return buildClientBrandStats(samples);
}

function buildClientBrandStats(samples) {
  const grouped = new Map();
  (samples || []).forEach(sample => {
    const brand = sample.brand || inferResearchSampleBrand(sample.title || '');
    if (!brand || brand === 'ブランド未判定') return;
    const rows = grouped.get(brand) || [];
    rows.push({ ...sample, brand });
    grouped.set(brand, rows);
  });
  return Array.from(grouped.entries()).map(([brand, rows]) => {
    const prices = rows.map(row => Number(row.price)).filter(price => Number.isFinite(price) && price > 0).sort((a, b) => a - b);
    if (!prices.length) return null;
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
    return {
      brand,
      count: rows.length,
      min: prices[0],
      median,
      max: prices[prices.length - 1],
      average: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
      samples: rows.sort((a, b) => Number(b.price || 0) - Number(a.price || 0)).slice(0, 3),
    };
  }).filter(Boolean).sort((a, b) => {
    const aReliable = a.count >= 2 ? 1 : 0;
    const bReliable = b.count >= 2 ? 1 : 0;
    return (bReliable - aReliable)
      || (Number(b.median) - Number(a.median))
      || (Number(b.max) - Number(a.max))
      || (Number(b.count) - Number(a.count))
      || String(a.brand).localeCompare(String(b.brand), 'ja');
  });
}

function inferResearchSampleBrand(title) {
  const normalized = normalizeResearchBrandText(title);
  for (const [brand, aliases] of RESEARCH_BRAND_ALIASES) {
    for (const alias of aliases) {
      const aliasKey = normalizeResearchBrandText(alias);
      if (!aliasKey) continue;
      if (aliasKey.length <= 2 && !hasResearchShortBrandToken(title, alias)) continue;
      if (normalized.includes(aliasKey)) return brand;
    }
  }
  return leadingResearchBrandCandidate(title) || 'ブランド未判定';
}

function normalizeResearchBrandText(value) {
  return String(value || '').toLowerCase().replace(/[\s　'’.\-]+/g, '');
}

function hasResearchShortBrandToken(title, alias) {
  const escaped = String(alias || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`(^|[\\s　/／|｜【】\\[\\]（）()])${escaped}($|[\\s　/／|｜【】\\[\\]（）()])`, 'i').test(String(title || ''));
}

function leadingResearchBrandCandidate(title) {
  const cleaned = String(title || '').replace(/^[【\[][^\]】]{1,12}[\]】]/, '').trim();
  const tokens = cleaned.split(/[\s　]+/).map(token => token.replace(/^[\s\-・:：/／|｜【】[\]（）()「」『』,、.]+|[\s\-・:：/／|｜【】[\]（）()「」『』,、.]+$/g, ''));
  if (tokens.slice(0, 4).some(token => token.endsWith('様') || token.includes('リクエスト'))) return '';
  for (const [index, token] of tokens.slice(0, 5).entries()) {
    if (!token || shouldSkipResearchBrandCandidate(token)) continue;
    if (/[A-Za-z]/.test(token) && token.replace(/[^A-Za-z0-9]/g, '').length >= 3) return combineResearchAlphaBrandTokens(tokens, index);
    if (/^[ァ-ヴーA-Za-z0-9&'.-]{2,24}$/.test(token)) return token;
  }
  return '';
}

function combineResearchAlphaBrandTokens(tokens, startIndex) {
  const parts = [];
  for (const token of tokens.slice(startIndex, startIndex + 3)) {
    const cleaned = token.replace(/^[\s\-・:：/／|｜【】[\]（）()「」『』,、.]+|[\s\-・:：/／|｜【】[\]（）()「」『』,、.]+$/g, '');
    if (!cleaned || shouldSkipResearchBrandCandidate(cleaned)) break;
    if (!/^[A-Za-z][A-Za-z0-9&'.-]*$/.test(cleaned)) break;
    parts.push(cleaned.toUpperCase());
  }
  return parts.join(' ') || String(tokens[startIndex] || '').toUpperCase();
}

function shouldSkipResearchBrandCandidate(token) {
  if (!normalizeResearchBrandText(token)) return true;
  if ([...RESEARCH_BRAND_NOISE].some(noise => token.includes(noise))) return true;
  if (token.endsWith('様') || token.includes('リクエスト')) return true;
  return /^\d+[A-Za-z]*$/.test(token);
}

function extractBuyingNote(text) {
  const match = String(text || '').match(/仕入れ目線:\s*([\s\S]+)/);
  if (!match) return '';
  return match[1].split('\n').map(line => line.trim()).filter(Boolean).join(' ');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[c]));
}

// ----- リセット -----
async function resetAll() {
  if (!confirm('写真・採寸・説明文をすべてリセットしますか？（この操作は取り消せません）')) return;
  uploadedImages = [];
  renderPreviews();
  el('category').value = '';
  renderMeasurements();
  el('title-text').value = '';
  el('result-text').value = '';
  el('result-section').hidden = true;
  el('mercari-settings').hidden = true;
  el('m-condition').value = '目立った傷や汚れなし';
  const fsb = el('final-size-badge'); if (fsb) fsb.hidden = true;
  hideStatus('status');
  try { await clearSessionDb(); } catch (e) { console.warn(e); }
  updateGenerateButton();
  updateDraftChecklist();
  updateSizeSuggestion();
  updatePhotoSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function stopActiveMultiVoiceInput(options = {}) {
  const session = activeMultiVoiceSession;
  if (!session) return;

  activeMultiVoiceSession = null;
  session.active = false;
  clearTimeout(session.idleTimer);
  clearTimeout(session.restartTimer);
  clearTimeout(session.statusTimer);

  const { btn, rec, statusEl } = session;
  if (btn) {
    btn.classList.remove('listening');
    btn.textContent = '🎤 まとめて音声入力';
    btn._stopFn = null;
  }

  try { rec.stop(); } catch {}
  try { rec.abort(); } catch {}

  if (statusEl) {
    if (options.clearStatus) {
      statusEl.textContent = '';
    } else {
      statusEl.textContent = options.message || '音声入力を終了しました';
      session.statusTimer = setTimeout(() => {
        if (statusEl.textContent === (options.message || '音声入力を終了しました')) {
          statusEl.textContent = '';
        }
      }, 1800);
    }
  }
}

// ----- 連続音声入力（ラベル＋数値を1度のマイク押下で複数入力） -----
function startMultiVoiceInput(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('このブラウザは音声入力に対応していません');
    return;
  }
  stopActiveMultiVoiceInput({ clearStatus: true });
  const statusEl = el('multi-voice-status');
  const rec = new SR();
  rec.lang = 'ja-JP';
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 3;

  const session = {
    active: true,
    btn,
    rec,
    statusEl,
    idleTimer: null,
    restartTimer: null,
    statusTimer: null,
  };
  activeMultiVoiceSession = session;
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
  const scheduleIdleStop = (delay = MULTI_VOICE_IDLE_STOP_MS) => {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (activeMultiVoiceSession === session) {
        stopActiveMultiVoiceInput({ message: 'しばらく入力がなかったため音声入力を終了しました' });
      }
    }, delay);
  };
  const restartRecognition = () => {
    clearTimeout(session.restartTimer);
    session.restartTimer = setTimeout(() => {
      if (activeMultiVoiceSession !== session || !session.active) return;
      try {
        rec.start();
      } catch (e) {
        const name = String(e?.name || '');
        const message = String(e?.message || e || '');
        if (!/InvalidState|already started|recognition has already started/i.test(`${name} ${message}`)) {
          console.warn('音声認識の再開に失敗:', e);
          setStatus('マイクが一時停止しました。もう一度「まとめて音声入力」を押してください');
          stopActiveMultiVoiceInput({ message: '音声入力を終了しました' });
        }
      }
    }, MULTI_VOICE_RESTART_DELAY_MS);
  };

  btn._stopFn = () => stopActiveMultiVoiceInput({ clearStatus: true });
  btn.classList.add('listening');
  btn.textContent = '⏹ 停止（録音中…）';
  setStatus('続けて話してください。終える時は停止を押します');
  scheduleIdleStop();

  rec.onresult = (e) => {
    if (activeMultiVoiceSession !== session) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result.isFinal) continue;
      let matches = [];
      for (let a = 0; a < result.length; a++) {
        const t = result[a]?.transcript || '';
        const parsed = parseMeasurementUtterances(t);
        if (parsed.length) { matches = parsed; break; }
      }
      if (matches.length) {
        const applied = [];
        const missing = [];
        matches.forEach(matched => {
          const target = el(matched.fieldId);
          if (target) {
            target.value = String(matched.value);
            target.dispatchEvent(new Event('input', { bubbles: true }));
            applied.push(`${matched.label}: ${matched.value}cm`);
          } else {
            missing.push(matched.label);
          }
        });
        const progress = getVisibleMeasurementProgress();
        if (applied.length) {
          setStatus(`✅ ${applied.join(' / ')}（${progress.filled}/${progress.total}）`);
        }
        if (missing.length) {
          setStatus(`⚠️ ${missing.join('、')} の入力欄が見つかりません（ラグランONを確認）`);
        }
        if (progress.complete) {
          clearTimeout(session.idleTimer);
          setStatus(`✅ 採寸がすべて入りました（${progress.filled}/${progress.total}）`);
          setTimeout(() => {
            if (activeMultiVoiceSession === session) {
              stopActiveMultiVoiceInput({ message: '採寸がすべて入りました' });
            }
          }, MULTI_VOICE_COMPLETE_STOP_MS);
          return;
        }
      } else {
        const first = result[0]?.transcript || '';
        setStatus(`⚠️ 認識できませんでした: "${first}"`);
      }
      scheduleIdleStop();
    }
  };
  rec.onend = () => {
    if (activeMultiVoiceSession === session && session.active) {
      restartRecognition();
    }
  };
  rec.onerror = (e) => {
    if (activeMultiVoiceSession !== session) return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      alert('マイクのアクセスが許可されていません');
      stopActiveMultiVoiceInput({ clearStatus: true });
    } else if (e.error === 'no-speech') {
      setStatus('待機中です。続けて採寸を話してください（終了は停止）');
      scheduleIdleStop();
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      console.warn('音声認識エラー:', e.error);
      stopActiveMultiVoiceInput({ message: '音声入力を終了しました' });
    }
  };
  try { rec.start(); } catch (e) { stopActiveMultiVoiceInput({ clearStatus: true }); console.warn(e); }
}

function normalizeMeasurementSpeech(text) {
  return String(text || '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[,，、]/g, '')
    .replace(/\s+/g, '');
}

function getMeasurementDict(cat) {
  const suitPrefixed = [
    { keys: ['ジャケット肩幅','ジャケ肩幅'], field: 'j_shoulder', label: 'ジャケット肩幅' },
    { keys: ['ジャケット身幅','ジャケ身幅'], field: 'j_chest',    label: 'ジャケット身幅' },
    { keys: ['ジャケット袖丈','ジャケ袖丈'], field: 'j_sleeve',   label: 'ジャケット袖丈' },
    { keys: ['ジャケット着丈','ジャケ着丈'], field: 'j_length',   label: 'ジャケット着丈' },
    { keys: ['ベスト肩幅'],                  field: 'v_shoulder', label: 'ベスト肩幅' },
    { keys: ['ベスト身幅'],                  field: 'v_chest',    label: 'ベスト身幅' },
    { keys: ['ベスト着丈'],                  field: 'v_length',   label: 'ベスト着丈' },
    { keys: ['パンツウエスト','ズボンウエスト','パンツウェスト','ズボンウェスト'], field: 'p_waist', label: 'パンツウエスト' },
    { keys: ['パンツ股下','ズボン股下'],      field: 'p_inseam',   label: 'パンツ股下' },
    { keys: ['パンツ股上','ズボン股上'],      field: 'p_rise',     label: 'パンツ股上' },
    { keys: ['パンツ裾幅','ズボン裾幅','パンツ裾','ズボン裾'], field: 'p_hem', label: 'パンツ裾幅' },
  ];
  const common = [
    { keys: ['ゆき丈','裄丈','ユキ丈','ユキタケ','ユキたけ'], field: 'yuki',     label: 'ゆき丈' },
    { keys: ['肩幅','かたはば'],                              field: 'shoulder', label: '肩幅' },
    { keys: ['身幅','みはば'],                                field: 'chest',    label: '身幅' },
    { keys: ['袖丈','そでたけ','そで丈'],                      field: 'sleeve',   label: '袖丈' },
    { keys: ['着丈','きたけ','き丈'],                          field: 'length',   label: '着丈' },
    { keys: ['ウエスト','ウェスト','胴回り','どうまわり'],      field: 'waist',    label: 'ウエスト' },
    { keys: ['股下','またした'],                              field: 'inseam',   label: '股下' },
    { keys: ['股上','またがみ'],                              field: 'rise',     label: '股上' },
    { keys: ['裾幅','すそはば','裾','すそ'],                   field: 'hem',      label: '裾幅' },
    { keys: ['縦','たて'],                                    field: 'height',   label: '縦' },
    { keys: ['横','よこ'],                                    field: 'width',    label: '横' },
    { keys: ['マチ','まち'],                                  field: 'depth',    label: 'マチ' },
    { keys: ['持ち手','もちて'],                              field: 'handle',   label: '持ち手' },
    { keys: ['高さ','たかさ'],                                field: 'depth',    label: '高さ' },
  ];
  return cat === 'suit' ? [...suitPrefixed, ...common] : common;
}

function getVisibleMeasurementInputs() {
  const container = el('measurement-fields');
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="number"]'))
    .filter(input => !input.disabled && !input.closest('[hidden]'));
}

function getVisibleMeasurementProgress() {
  const inputs = getVisibleMeasurementInputs();
  const filled = inputs.filter(input => String(input.value || '').trim() !== '').length;
  return { filled, total: inputs.length, complete: inputs.length > 0 && filled >= inputs.length };
}

// 「ラベル 数値」を複数含む発話を解析して対象フィールドIDと値を返す
function parseMeasurementUtterances(text) {
  if (!text) return [];
  const cat = el('category').value;
  if (!cat) return [];

  const normalized = normalizeMeasurementSpeech(text);
  const labels = [];
  getMeasurementDict(cat).forEach(entry => {
    entry.keys.forEach(key => {
      let idx = normalized.indexOf(key);
      while (idx >= 0) {
        labels.push({ entry, key, idx, end: idx + key.length });
        idx = normalized.indexOf(key, idx + key.length);
      }
    });
  });

  const orderedLabels = [];
  labels
    .sort((a, b) => a.idx - b.idx || b.key.length - a.key.length)
    .forEach(label => {
      const prev = orderedLabels[orderedLabels.length - 1];
      if (prev && label.idx < prev.end) return;
      orderedLabels.push(label);
    });

  const parsed = [];
  const usedFields = new Set();
  orderedLabels.forEach((label, index) => {
    const next = orderedLabels[index + 1];
    const segment = normalized.slice(label.end, next ? next.idx : normalized.length);
    const fallbackSegment = orderedLabels.length === 1
      ? `${segment} ${normalized.slice(0, label.idx)}`
      : segment;
    const n = parseSpokenNumber(fallbackSegment);
    if (n === null) return;
    const fieldId = 'm-' + resolveFieldKey(label.entry.field, cat);
    if (usedFields.has(fieldId)) return;
    usedFields.add(fieldId);
    parsed.push({ fieldId, value: n, label: label.entry.label });
  });

  return parsed;
}

// 「ラベル 数値」発話を解析して対象フィールドIDと値を返す
function parseMeasurementUtterance(text) {
  return parseMeasurementUtterances(text)[0] || null;
}

function resolveGenericMeasurementKey(baseKey, cat) {
  const prefixByCategory = {
    bag: 'bag_',
    other: 'other_',
  };
  if (baseKey === 'height') return (prefixByCategory[cat] || '') + 'height';
  if (baseKey === 'width') return (prefixByCategory[cat] || '') + 'width';
  if (baseKey === 'depth') return (prefixByCategory[cat] || '') + 'depth';
  if (baseKey === 'handle') return (prefixByCategory[cat] || '') + 'handle';
  return baseKey;
}

function resolveFieldKey(baseKey, cat) {
  if (/^[jpv]_/.test(baseKey)) return baseKey;
  if (baseKey === 'yuki') return 'yuki';
  const genericKey = resolveGenericMeasurementKey(baseKey, cat);
  if (genericKey !== baseKey) return genericKey;
  if (cat === 'suit') {
    const bottomKeys = ['waist','inseam','rise','hem'];
    const jacketKeys = ['shoulder','chest','sleeve','length'];
    if (bottomKeys.includes(baseKey)) return 'p_' + baseKey;
    if (jacketKeys.includes(baseKey)) return 'j_' + baseKey;
  }
  return baseKey;
}

// 日本語音声から数値を抽出（整数・小数対応）
function parseSpokenNumber(text) {
  if (!text) return null;
  // 全角→半角、読点除去
  const normalized = text
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[,，、]/g, '')
    .replace(/てん|[・．]/g, '.');
  // 通常数字: 48 / 48.5
  const m = normalized.match(/(\d+(?:\.\d+)?)/);
  if (m) return parseFloat(m[1]);
  // 簡易漢数字（2桁まで）
  const digits = { 〇:0,零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };
  let s = text.replace(/\s/g, '');
  // 「百」対応
  let hundreds = 0;
  const hm = s.match(/([一二三四五六七八九])?百/);
  if (hm) { hundreds = (hm[1] ? digits[hm[1]] : 1) * 100; s = s.replace(hm[0], ''); }
  // 「十」対応
  let tens = 0;
  const tm = s.match(/([一二三四五六七八九])?十/);
  if (tm) { tens = (tm[1] ? digits[tm[1]] : 1) * 10; s = s.replace(tm[0], ''); }
  // 一の位
  let ones = 0;
  const om = s.match(/[一二三四五六七八九〇零]/);
  if (om) { ones = digits[om[0]]; s = s.replace(om[0], ''); }
  // 小数部（点以降の漢数字）
  let frac = '';
  const fm = s.match(/[点．.]([一二三四五六七八九〇零]+)/);
  if (fm) {
    frac = fm[1].split('').map(c => digits[c] ?? '').join('');
  }
  const intPart = hundreds + tens + ones;
  if (intPart === 0 && !om && !tm && !hm) return null;
  const out = parseFloat(frac ? `${intPart}.${frac}` : String(intPart));
  return isNaN(out) ? null : out;
}

// ----- サイズ推定（S/M/L相当） -----
// スコア: XS=0, S=1, M=2, L=3, XL=4, XXL=5, XXXL=6
// 閾値はユニクロメンズ公式サイズ表を基準: M=身幅52/肩幅45/着丈69/ウエスト75/股下75
const SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

function scoreChest(v)    { return clampScore((v - 46) / 3); }     // M中心=52
function scoreShoulder(v) { return clampScore((v - 40) / 2.5); }   // M中心=45
function scoreLength(v)   { return clampScore((v - 63) / 3); }     // M中心=69
function scoreWaist(v)    { return clampScore((v - 67) / 4); }     // M中心=75
function scoreInseam(v)   { return clampScore((v - 71) / 2); }     // M中心=75
function clampScore(s)    { return Math.max(0, Math.min(6, s)); }

// 採寸値のみからサイズを推定（Step2のリアルタイム表示用）
function computeMeasurementSize() {
  const cat = el('category').value;
  if (!cat) return null;
  if (cat === 'other' || cat === 'bag') return null;  // その他・バッグはサイズ推定対象外
  const prefix = cat === 'suit' ? 'j_' : '';
  const isBottom = cat === 'bottoms';
  const read = (k) => {
    const v = parseFloat((el('m-' + k) || {}).value);
    return v > 0 ? v : null;
  };
  if (isBottom) {
    return estimateBottomWeighted({ waist: read('waist'), inseam: read('inseam') });
  }
  return estimateTopWeighted({
    chest:    read(prefix + 'chest'),
    shoulder: read(prefix + 'shoulder'),
    length:   read(prefix + 'length'),
  });
}

function updateSizeSuggestion() {
  const panel = el('size-suggestion');
  if (!panel) return;
  const cat = el('category').value;
  if (!cat) { panel.hidden = true; return; }

  const result = computeMeasurementSize();
  if (!result) { panel.hidden = true; return; }

  const isBottom = cat === 'bottoms';
  const table = isBottom ? sizeReferenceBottoms() : sizeReferenceTops();
  panel.innerHTML = `
    <div class="size-main">📏 採寸からの推定: <strong>${result.size}サイズ相当</strong></div>
    <div class="size-hint">${result.detail}</div>
    <details class="size-ref">
      <summary>サイズ目安表（ユニクロメンズ基準）</summary>
      ${table}
      <p class="note small">※ブランドにより±2〜3cm程度の差があります。タグ表記との併用をおすすめします。</p>
    </details>
  `;
  panel.hidden = false;
}

// 加重スコアリング: 身幅60% + 肩幅30% + 着丈10%（入力された寸法だけで再正規化）
function estimateTopWeighted({ chest, shoulder, length }) {
  const parts = [];
  if (chest    != null) parts.push({ w: 0.60, s: scoreChest(chest),       label: `身幅${chest}`    });
  if (shoulder != null) parts.push({ w: 0.30, s: scoreShoulder(shoulder), label: `肩幅${shoulder}` });
  if (length   != null) parts.push({ w: 0.10, s: scoreLength(length),     label: `着丈${length}`   });
  if (parts.length === 0) return null;
  return combineScores(parts);
}

// 加重スコアリング: ウエスト80% + 股下20%
function estimateBottomWeighted({ waist, inseam }) {
  const parts = [];
  if (waist  != null) parts.push({ w: 0.80, s: scoreWaist(waist),   label: `ウエスト${waist}` });
  if (inseam != null) parts.push({ w: 0.20, s: scoreInseam(inseam), label: `股下${inseam}`    });
  if (parts.length === 0) return null;
  return combineScores(parts);
}

function combineScores(parts) {
  const totalW = parts.reduce((a, p) => a + p.w, 0);
  const avg = parts.reduce((a, p) => a + p.w * p.s, 0) / totalW;
  const idx = Math.max(0, Math.min(6, Math.round(avg)));
  const size = SIZE_LABELS[idx];
  const detail = `${parts.map(p => p.label).join(' / ')} → 加重平均 ${avg.toFixed(2)}`;
  return { size, detail, score: avg, index: idx };
}

// タグ表記をS/M/L/XL/XXL/XXXLへ正規化
function normalizeTagSize(raw) {
  if (!raw) return null;
  const t = String(raw).toUpperCase().trim();
  if (t === '---' || t === '' || t === 'FREE' || t === 'ONE SIZE') return null;

  // 文字表記
  if (/^(XXXL|LLL|3L)$/.test(t)) return 'XXXL';
  if (/^(XXL|2L)$/.test(t))      return 'XXL';
  if (/^(XL|LL)$/.test(t))       return 'XL';
  if (/^L$/.test(t))             return 'L';
  if (/^M$/.test(t))             return 'M';
  if (/^S$/.test(t))             return 'S';
  if (/^(XS|SS)$/.test(t))       return 'XS';

  // W28等のインチ表記ウエスト
  const wInch = t.match(/^W\s*(\d{2})/);
  if (wInch) {
    const cm = parseFloat(wInch[1]) * 2.54;
    return SIZE_LABELS[Math.round(scoreWaist(cm))];
  }

  // 数字のみ（欧州メンズ表記を基準）: 46=S, 48=M, 50=L, 52=XL, 54=XXL
  const nm = t.match(/(\d{2,3})/);
  if (nm) {
    const num = parseFloat(nm[1]);
    if (num >= 60 && num <= 110) {
      // ウエスト(cm)表記
      return SIZE_LABELS[Math.round(scoreWaist(num))];
    }
    if (num >= 34 && num <= 58) {
      // 欧州メンズスーツ/ジャケット表記
      if (num <= 42) return 'XS';
      if (num <= 46) return 'S';
      if (num <= 48) return 'M';
      if (num <= 50) return 'L';
      if (num <= 52) return 'XL';
      if (num <= 54) return 'XXL';
      return 'XXXL';
    }
  }
  return null;
}

// 最終サイズ（タグ+採寸）を生成結果画面に表示
function renderFinalSize(aiData) {
  const badge = el('final-size-badge');
  if (!badge) return;
  const measurement = computeMeasurementSize();
  const tagRaw = aiData?.tag_size || '';
  const tagNorm = normalizeTagSize(tagRaw);

  if (!measurement && !tagNorm) {
    badge.hidden = true;
    return;
  }

  // タグが読めればタグを最終回答、採寸は整合チェック用
  let finalSize, note, warn = false;
  if (tagNorm && measurement) {
    const diff = Math.abs(SIZE_LABELS.indexOf(tagNorm) - measurement.index);
    finalSize = tagNorm;
    if (diff >= 2) {
      warn = true;
      note = `⚠️ タグ「${tagRaw}」→${tagNorm} と 採寸推定 ${measurement.size}（${measurement.detail}）が${diff}段階ズレています。オーバー/スリムシルエットの可能性。`;
    } else if (diff === 1) {
      note = `タグ「${tagRaw}」→${tagNorm}・採寸推定 ${measurement.size} （1段階差・許容範囲）`;
    } else {
      note = `タグ「${tagRaw}」→${tagNorm}・採寸推定 ${measurement.size} が一致`;
    }
  } else if (tagNorm) {
    finalSize = tagNorm;
    note = `タグ「${tagRaw}」→${tagNorm}（採寸未入力）`;
  } else {
    finalSize = measurement.size;
    note = `採寸推定: ${measurement.detail}（タグ読取不可）`;
  }

  badge.className = 'final-size-badge' + (warn ? ' warn' : '');
  badge.innerHTML = `
    <div class="fs-head">🏷 メルカリのサイズ選択推奨</div>
    <div class="fs-size">${finalSize}</div>
    <div class="fs-note">${note}</div>
  `;
  badge.hidden = false;
}

function sizeReferenceTops() {
  return `<table class="size-table">
    <tr><th>サイズ</th><th>身幅(cm)</th><th>肩幅(cm)</th><th>着丈(cm)</th><th>タグ例</th></tr>
    <tr><td>XS</td><td>〜47</td><td>〜41</td><td>〜65</td><td>44 / XS</td></tr>
    <tr><td>S</td><td>48〜50</td><td>42〜43</td><td>66〜67</td><td>46 / S</td></tr>
    <tr><td>M</td><td>51〜53</td><td>44〜46</td><td>68〜70</td><td>48 / M</td></tr>
    <tr><td>L</td><td>54〜56</td><td>47〜48</td><td>71〜73</td><td>50 / L</td></tr>
    <tr><td>XL</td><td>57〜59</td><td>49〜50</td><td>74〜76</td><td>52 / XL</td></tr>
    <tr><td>XXL</td><td>60〜62</td><td>51〜53</td><td>77〜79</td><td>54 / XXL</td></tr>
  </table>`;
}

function sizeReferenceBottoms() {
  return `<table class="size-table">
    <tr><th>サイズ</th><th>ウエスト(cm)</th><th>股下(cm)</th><th>タグ例</th></tr>
    <tr><td>XS</td><td>〜68</td><td>〜72</td><td>W26 / 62</td></tr>
    <tr><td>S</td><td>69〜72</td><td>73〜74</td><td>W28 / 70</td></tr>
    <tr><td>M</td><td>73〜76</td><td>75〜76</td><td>W30 / 75</td></tr>
    <tr><td>L</td><td>77〜80</td><td>77〜78</td><td>W32 / 79</td></tr>
    <tr><td>XL</td><td>81〜84</td><td>79〜80</td><td>W34 / 83</td></tr>
    <tr><td>XXL</td><td>85〜88</td><td>81〜82</td><td>W36 / 87</td></tr>
  </table>`;
}

// ----- 画像合成（✂️ 画像合成） -----
// 2ステップ:
//   step 1: 「切り抜き元」サムネ選択 → キャンバス上で矩形ドラッグ → 次へ
//   step 2: 「ベース」サムネ選択 → 位置(四隅)・サイズ(小中大) → 適用
const composeState = {
  step: 1,
  sourceIdx: null,    // 切り抜き元の uploadedImages インデックス
  baseIdx: null,      // ベース画像の uploadedImages インデックス
  sourceImg: null,    // Image オブジェクト
  baseImg: null,
  cropRect: null,     // { x, y, w, h } source画像の自然座標
  croppedCanvas: null,
  corner: 'br',       // tl/tr/bl/br
  sizeKey: 'medium',  // small/medium/large
  shape: 'rect',      // 'rect' | 'circle'
  replaceBase: false,
  _drawSelection: null, // 形状切替時の再描画フック
};

const SIZE_RATIO = { small: 0.22, medium: 0.30, large: 0.40 };
const BORDER_RATIO = 0.009; // ベース画像長辺に対する枠太さ
const MARGIN_RATIO = 0.035; // 角からのマージン

function openImageCompose() {
  if (uploadedImages.length < 2) {
    alert('画像合成には2枚以上の写真が必要です');
    return;
  }
  composeState.step = 1;
  composeState.sourceIdx = null;
  composeState.baseIdx = null;
  composeState.sourceImg = null;
  composeState.baseImg = null;
  composeState.cropRect = null;
  composeState.croppedCanvas = null;
  composeState.corner = 'br';
  composeState.sizeKey = 'medium';
  composeState.shape = 'rect';
  composeState.replaceBase = false;
  composeState._drawSelection = null;
  el('compose-title').innerHTML = `✂️ 切り抜き合成 <span class="ver-tag">v0429d</span>`;
  el('compose-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  renderComposeStep();
}

function closeImageCompose() {
  el('compose-modal').hidden = true;
  document.body.style.overflow = '';
  // タイトルを既定に戻す（グリッド合成から閉じた場合も対応）
  el('compose-title').innerHTML = `✂️ 画像合成 <span class="ver-tag">v0429d</span>`;
}

function renderComposeStep() {
  const body = el('compose-body');
  const actions = el('compose-actions');
  const label = el('compose-step-label');
  body.innerHTML = '';
  actions.innerHTML = '';

  if (composeState.step === 1) {
    label.textContent = 'ステップ1: 切り抜く写真（タグなど）を選んでください';
    body.appendChild(buildThumbGrid(null, (idx) => {
      composeState.sourceIdx = idx;
      loadImage(uploadedImages[idx].dataUrl).then(img => {
        composeState.sourceImg = img;
        composeState.step = 2;
        renderComposeStep();
      });
    }));
    return;
  }

  if (composeState.step === 2) {
    label.textContent = 'ステップ2: 切り抜く範囲を指定';

    const shapeRow = document.createElement('div');
    shapeRow.className = 'shape-row';
    [['rect','⬜ 四角'],['circle','◯ 丸']].forEach(([k, l]) => {
      const b = document.createElement('button');
      b.className = 'shape-btn' + (composeState.shape === k ? ' active' : '');
      b.textContent = l;
      b.addEventListener('click', () => {
        composeState.shape = k;
        shapeRow.querySelectorAll('.shape-btn').forEach((bb, ix) => {
          bb.classList.toggle('active', ['rect','circle'][ix] === k);
        });
        // 丸に切替えた時点で既存rectを正方形化（短辺に合わせて中心保持）
        if (k === 'circle' && composeState.cropRect && composeState.cropRect.w >= 1 && composeState.cropRect.h >= 1) {
          const r = composeState.cropRect;
          const side = Math.min(r.w, r.h);
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h / 2;
          composeState.cropRect = { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
        }
        if (composeState._drawSelection) composeState._drawSelection(composeState.cropRect);
      });
      shapeRow.appendChild(b);
    });
    body.appendChild(shapeRow);

    const wrap = document.createElement('div');
    wrap.className = 'crop-container';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    body.appendChild(wrap);

    const hintRow = document.createElement('div');
    hintRow.className = 'crop-hint-row';
    const hint = document.createElement('p');
    hint.className = 'crop-hint';
    hint.textContent = '新規: ドラッグ／移動: 1本指スワイプ／サイズ変更: 2本指ピンチ';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn crop-reset-btn';
    resetBtn.textContent = '🔄 範囲をクリア';
    hintRow.appendChild(hint);
    hintRow.appendChild(resetBtn);
    body.appendChild(hintRow);

    const cropApi = setupCropCanvas(canvas);
    resetBtn.addEventListener('click', () => cropApi.clearRect());

    const backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.textContent = '← 戻る';
    backBtn.addEventListener('click', () => { composeState.step = 1; renderComposeStep(); });
    actions.appendChild(backBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn primary';
    nextBtn.textContent = '次へ →';
    nextBtn.addEventListener('click', () => {
      if (!composeState.cropRect || composeState.cropRect.w < 20 || composeState.cropRect.h < 20) {
        alert('切り抜く範囲をドラッグで指定してください');
        return;
      }
      composeState.croppedCanvas = extractCrop(composeState.sourceImg, composeState.cropRect, composeState.shape);
      composeState.step = 3;
      renderComposeStep();
    });
    actions.appendChild(nextBtn);
    return;
  }

  if (composeState.step === 3) {
    label.textContent = 'ステップ3: 貼り付け先の写真を選んでください';
    body.appendChild(buildThumbGrid(composeState.sourceIdx, (idx) => {
      composeState.baseIdx = idx;
      loadImage(uploadedImages[idx].dataUrl).then(img => {
        composeState.baseImg = img;
        composeState.step = 4;
        renderComposeStep();
      });
    }));

    const backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.textContent = '← 戻る';
    backBtn.addEventListener('click', () => { composeState.step = 2; renderComposeStep(); });
    actions.appendChild(backBtn);
    return;
  }

  if (composeState.step === 4) {
    label.textContent = 'ステップ4: 位置とサイズを選んで適用';

    const wrap = document.createElement('div');
    wrap.className = 'compose-preview-wrap';
    const canvas = document.createElement('canvas');
    canvas.id = 'compose-preview-canvas';
    wrap.appendChild(canvas);
    body.appendChild(wrap);

    const posLabel = document.createElement('p');
    posLabel.className = 'compose-section-label';
    posLabel.textContent = '位置';
    body.appendChild(posLabel);

    const cornerGrid = document.createElement('div');
    cornerGrid.className = 'corner-grid';
    const corners = [
      { k: 'tl', l: '◤ 左上' },
      { k: 'tr', l: '◥ 右上' },
      { k: 'bl', l: '◣ 左下' },
      { k: 'br', l: '◢ 右下' },
    ];
    corners.forEach(c => {
      const b = document.createElement('button');
      b.className = 'corner-btn' + (composeState.corner === c.k ? ' active' : '');
      b.textContent = c.l;
      b.addEventListener('click', () => {
        composeState.corner = c.k;
        renderComposeStep();
      });
      cornerGrid.appendChild(b);
    });
    body.appendChild(cornerGrid);

    const sizeLabel = document.createElement('p');
    sizeLabel.className = 'compose-section-label';
    sizeLabel.textContent = 'サイズ';
    body.appendChild(sizeLabel);

    const sizeRow = document.createElement('div');
    sizeRow.className = 'size-row';
    [['small','小'],['medium','中'],['large','大']].forEach(([k, l]) => {
      const b = document.createElement('button');
      b.className = 'size-btn' + (composeState.sizeKey === k ? ' active' : '');
      b.textContent = l;
      b.addEventListener('click', () => {
        composeState.sizeKey = k;
        renderComposeStep();
      });
      sizeRow.appendChild(b);
    });
    body.appendChild(sizeRow);

    const toggle = document.createElement('label');
    toggle.className = 'compose-toggle';
    toggle.innerHTML = `
      <input type="checkbox" id="replace-base-chk" ${composeState.replaceBase ? 'checked' : ''}>
      ベース画像を差し替える（オフなら合成画像を追加）
    `;
    body.appendChild(toggle);
    toggle.querySelector('input').addEventListener('change', (e) => {
      composeState.replaceBase = e.target.checked;
    });

    // プレビュー描画
    renderComposePreview(canvas);

    const backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.textContent = '← 戻る';
    backBtn.addEventListener('click', () => { composeState.step = 3; renderComposeStep(); });
    actions.appendChild(backBtn);

    const saveDevBtn = document.createElement('button');
    saveDevBtn.className = 'btn';
    saveDevBtn.textContent = '📥 保存のみ';
    saveDevBtn.addEventListener('click', async () => {
      const cv = el('compose-preview-canvas');
      if (!cv) return;
      const blob = await (await fetch(cv.toDataURL('image/jpeg', 0.9))).blob();
      await saveBlobToDevice(blob, `mercari-compose-${Date.now()}.jpg`);
    });
    actions.appendChild(saveDevBtn);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn primary';
    applyBtn.textContent = '➕ アプリに追加';
    applyBtn.addEventListener('click', applyCompose);
    actions.appendChild(applyBtn);
  }
}

function buildThumbGrid(excludeIdx, onPick) {
  const grid = document.createElement('div');
  grid.className = 'compose-thumbs';
  uploadedImages.forEach((img, idx) => {
    if (idx === excludeIdx) return;
    const cell = document.createElement('div');
    cell.className = 'compose-thumb';
    cell.innerHTML = `<img src="${img.dataUrl}" alt=""><span class="thumb-badge">${idx + 1}</span>`;
    cell.addEventListener('click', () => onPick(idx));
    grid.appendChild(cell);
  });
  return grid;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// 切り抜きキャンバス: 1本指=範囲指定、2本指ピンチ=範囲のサイズ変更、形状=矩形/円
// iOS多指の安定性のため TouchEvent ベース、デスクトップは MouseEvent でフォールバック
function setupCropCanvas(canvas) {
  const img = composeState.sourceImg;
  const ctx = canvas.getContext('2d');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const drawBase = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };

  const drawSelection = (rect) => {
    drawBase();
    if (!rect || rect.w < 1 || rect.h < 1) return;
    const lw = Math.max(2, canvas.width / 240);

    if (composeState.shape === 'circle') {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const rx = rect.w / 2, ry = rect.h / 2;
      // 楕円外を暗転（evenodd塗り）
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      // 楕円ストローク
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4757';
      ctx.lineWidth = lw;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, rect.y);
      ctx.fillRect(0, rect.y + rect.h, canvas.width, canvas.height - rect.y - rect.h);
      ctx.fillRect(0, rect.y, rect.x, rect.h);
      ctx.fillRect(rect.x + rect.w, rect.y, canvas.width - rect.x - rect.w, rect.h);
      ctx.strokeStyle = '#ff4757';
      ctx.lineWidth = lw;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  };
  composeState._drawSelection = drawSelection;
  drawBase();
  if (composeState.cropRect) drawSelection(composeState.cropRect);

  let dragMode = null;        // 'select' | 'move' | 'pinch' | null
  let startX = 0, startY = 0;
  let moveStart = null;       // { rectX, rectY, pointerX, pointerY }
  let pinchStart = null;

  const toCanvasCoords = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const clampRect = (r) => {
    const x = Math.max(0, Math.min(canvas.width - 1, r.x));
    const y = Math.max(0, Math.min(canvas.height - 1, r.y));
    const w = Math.max(1, Math.min(canvas.width - x, r.w));
    const h = Math.max(1, Math.min(canvas.height - y, r.h));
    return { x, y, w, h };
  };

  const clampMove = (r) => {
    const w = r.w, h = r.h;
    return {
      x: Math.max(0, Math.min(canvas.width - w, r.x)),
      y: Math.max(0, Math.min(canvas.height - h, r.y)),
      w, h,
    };
  };

  // 丸の場合は常に正円に揃える（中心保持、短辺を一辺に）
  const squarifyIfCircle = (r) => {
    if (composeState.shape !== 'circle' || !r) return r;
    const side = Math.min(r.w, r.h);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return clampRect({ x: cx - side / 2, y: cy - side / 2, w: side, h: side });
  };

  const isInsideRect = (p, rect) => {
    if (!rect) return false;
    return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  };

  const startPinch = (touches) => {
    if (!composeState.cropRect || composeState.cropRect.w < 1 || composeState.cropRect.h < 1) {
      dragMode = null;
      return;
    }
    // 丸なら開始時点で正方形化
    composeState.cropRect = squarifyIfCircle(composeState.cropRect);
    drawSelection(composeState.cropRect);
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    const c1 = toCanvasCoords(touches[0].clientX, touches[0].clientY);
    const c2 = toCanvasCoords(touches[1].clientX, touches[1].clientY);
    pinchStart = {
      dist: Math.hypot(dx, dy) || 1,
      cx: (c1.x + c2.x) / 2,
      cy: (c1.y + c2.y) / 2,
      rect: { ...composeState.cropRect },
    };
    dragMode = 'pinch';
  };

  const startSingle = (touch) => {
    const p = toCanvasCoords(touch.clientX, touch.clientY);
    const hasExistingRect = composeState.cropRect && composeState.cropRect.w >= 1 && composeState.cropRect.h >= 1;
    if (hasExistingRect) {
      // 既存範囲がある場合は内外問わず1本指スワイプで移動
      moveStart = {
        rectX: composeState.cropRect.x,
        rectY: composeState.cropRect.y,
        pointerX: p.x,
        pointerY: p.y,
      };
      dragMode = 'move';
    } else {
      // 範囲未指定 → 新規範囲指定
      startX = p.x; startY = p.y;
      composeState.cropRect = { x: startX, y: startY, w: 0, h: 0 };
      drawSelection(composeState.cropRect);
      dragMode = 'select';
    }
  };

  // ===== TouchEvent ハンドラ =====
  const onTouchStart = (ev) => {
    ev.preventDefault();
    if (ev.touches.length >= 2) {
      startPinch(ev.touches);
    } else if (ev.touches.length === 1) {
      startSingle(ev.touches[0]);
    }
  };

  const onTouchMove = (ev) => {
    ev.preventDefault();
    if (dragMode === 'pinch' && ev.touches.length >= 2 && pinchStart) {
      const dx = ev.touches[1].clientX - ev.touches[0].clientX;
      const dy = ev.touches[1].clientY - ev.touches[0].clientY;
      const dist = Math.hypot(dx, dy) || 1;
      const c1 = toCanvasCoords(ev.touches[0].clientX, ev.touches[0].clientY);
      const c2 = toCanvasCoords(ev.touches[1].clientX, ev.touches[1].clientY);
      const cx = (c1.x + c2.x) / 2;
      const cy = (c1.y + c2.y) / 2;
      const ratio = dist / pinchStart.dist;
      const s = pinchStart.rect;
      const sCx = s.x + s.w / 2;
      const sCy = s.y + s.h / 2;
      const newW = s.w * ratio;
      const newH = s.h * ratio;
      const newCx = sCx + (cx - pinchStart.cx);
      const newCy = sCy + (cy - pinchStart.cy);
      composeState.cropRect = squarifyIfCircle(clampRect({
        x: newCx - newW / 2, y: newCy - newH / 2, w: newW, h: newH,
      }));
      drawSelection(composeState.cropRect);
    } else if (dragMode === 'move' && ev.touches.length === 1 && moveStart) {
      const p = toCanvasCoords(ev.touches[0].clientX, ev.touches[0].clientY);
      composeState.cropRect = clampMove({
        x: moveStart.rectX + (p.x - moveStart.pointerX),
        y: moveStart.rectY + (p.y - moveStart.pointerY),
        w: composeState.cropRect.w,
        h: composeState.cropRect.h,
      });
      drawSelection(composeState.cropRect);
    } else if (dragMode === 'select' && ev.touches.length === 1) {
      const p = toCanvasCoords(ev.touches[0].clientX, ev.touches[0].clientY);
      if (composeState.shape === 'circle') {
        // 丸: 最大辺に揃えた正方形。ドラッグ方向に伸ばす
        const side = Math.max(Math.abs(p.x - startX), Math.abs(p.y - startY));
        const xDir = p.x >= startX ? 1 : -1;
        const yDir = p.y >= startY ? 1 : -1;
        const x0 = xDir === 1 ? startX : startX - side;
        const y0 = yDir === 1 ? startY : startY - side;
        composeState.cropRect = clampRect({ x: x0, y: y0, w: side, h: side });
      } else {
        const x = Math.min(startX, p.x);
        const y = Math.min(startY, p.y);
        composeState.cropRect = {
          x: Math.max(0, x),
          y: Math.max(0, y),
          w: Math.min(canvas.width - Math.max(0, x), Math.abs(p.x - startX)),
          h: Math.min(canvas.height - Math.max(0, y), Math.abs(p.y - startY)),
        };
      }
      drawSelection(composeState.cropRect);
    }
  };

  const onTouchEnd = (ev) => {
    ev.preventDefault();
    if (ev.touches.length === 0) {
      dragMode = null;
      pinchStart = null;
      moveStart = null;
    } else if (ev.touches.length === 1 && dragMode === 'pinch') {
      // ピンチから1本指へ移行: そのまま単指の move or select に切替
      dragMode = null;
      pinchStart = null;
      startSingle(ev.touches[0]);
    }
  };

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

  // ===== MouseEvent フォールバック（PC用） =====
  canvas.addEventListener('mousedown', (ev) => {
    if ('ontouchstart' in window) return;
    startSingle(ev);
  });
  canvas.addEventListener('mousemove', (ev) => {
    if ('ontouchstart' in window) return;
    if (dragMode === 'move' && moveStart) {
      const p = toCanvasCoords(ev.clientX, ev.clientY);
      composeState.cropRect = clampMove({
        x: moveStart.rectX + (p.x - moveStart.pointerX),
        y: moveStart.rectY + (p.y - moveStart.pointerY),
        w: composeState.cropRect.w, h: composeState.cropRect.h,
      });
      drawSelection(composeState.cropRect);
    } else if (dragMode === 'select') {
      const p = toCanvasCoords(ev.clientX, ev.clientY);
      if (composeState.shape === 'circle') {
        const side = Math.max(Math.abs(p.x - startX), Math.abs(p.y - startY));
        const xDir = p.x >= startX ? 1 : -1;
        const yDir = p.y >= startY ? 1 : -1;
        composeState.cropRect = clampRect({
          x: xDir === 1 ? startX : startX - side,
          y: yDir === 1 ? startY : startY - side,
          w: side, h: side,
        });
      } else {
        const x = Math.min(startX, p.x), y = Math.min(startY, p.y);
        composeState.cropRect = {
          x: Math.max(0, x), y: Math.max(0, y),
          w: Math.min(canvas.width - Math.max(0, x), Math.abs(p.x - startX)),
          h: Math.min(canvas.height - Math.max(0, y), Math.abs(p.y - startY)),
        };
      }
      drawSelection(composeState.cropRect);
    }
  });
  window.addEventListener('mouseup', () => { dragMode = null; moveStart = null; });

  return {
    clearRect() {
      composeState.cropRect = null;
      dragMode = null;
      drawBase();
    },
  };
}

function extractCrop(img, rect, shape) {
  const c = document.createElement('canvas');
  c.width = Math.round(rect.w);
  c.height = Math.round(rect.h);
  const ctx = c.getContext('2d');
  if (shape === 'circle') {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(c.width / 2, c.height / 2, c.width / 2, c.height / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    ctx.restore();
  } else {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  }
  return c;
}

function renderComposePreview(canvas) {
  const base = composeState.baseImg;
  const crop = composeState.croppedCanvas;
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);

  const baseLong = Math.max(base.naturalWidth, base.naturalHeight);
  const overlayLong = baseLong * SIZE_RATIO[composeState.sizeKey];
  const cropRatio = crop.height / crop.width;
  let ow, oh;
  if (crop.width >= crop.height) {
    ow = overlayLong;
    oh = ow * cropRatio;
  } else {
    oh = overlayLong;
    ow = oh / cropRatio;
  }

  const margin = baseLong * MARGIN_RATIO;
  const border = Math.max(4, baseLong * BORDER_RATIO);

  let ox, oy;
  switch (composeState.corner) {
    case 'tl': ox = margin; oy = margin; break;
    case 'tr': ox = canvas.width - ow - margin; oy = margin; break;
    case 'bl': ox = margin; oy = canvas.height - oh - margin; break;
    case 'br':
    default:   ox = canvas.width - ow - margin; oy = canvas.height - oh - margin; break;
  }

  // 金属光沢のあるビビッドなゴールド枠（サムネでも目立つよう彩度強め＋細い暗縁）
  const gold = ctx.createLinearGradient(ox, oy, ox, oy + oh);
  gold.addColorStop(0.00, '#fff3a0');  // ハイライト
  gold.addColorStop(0.35, '#ffcc1f');  // 鮮やかなゴールド
  gold.addColorStop(0.65, '#e59e0a');  // 深めのゴールド
  gold.addColorStop(1.00, '#8b5e00');  // ブロンズの影
  const outline = border * 0.25;        // 暗い縁（輪郭強調）

  if (composeState.shape === 'circle') {
    const ccx = ox + ow / 2;
    const ccy = oy + oh / 2;
    const crxOut = ow / 2 + border + outline;
    const cryOut = oh / 2 + border + outline;
    const crx = ow / 2 + border;
    const cry = oh / 2 + border;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = border * 2.8;
    ctx.shadowOffsetY = border * 1.0;
    ctx.fillStyle = '#4a2e00'; // 外側の暗い縁
    ctx.beginPath();
    ctx.ellipse(ccx, ccy, crxOut, cryOut, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.ellipse(ccx, ccy, crx, cry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(crop, ox, oy, ow, oh);
  } else {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = border * 2.8;
    ctx.shadowOffsetY = border * 1.0;
    ctx.fillStyle = '#4a2e00';
    ctx.fillRect(ox - border - outline, oy - border - outline,
                 ow + (border + outline) * 2, oh + (border + outline) * 2);
    ctx.restore();
    ctx.fillStyle = gold;
    ctx.fillRect(ox - border, oy - border, ow + border * 2, oh + border * 2);
    ctx.drawImage(crop, ox, oy, ow, oh);
  }
}

async function addComposedImageToApp(dataUrl, options = {}) {
  if (uploadedImages.length >= MAX_SELECT_PHOTOS) {
    alert(`写真選択は最大${MAX_SELECT_PHOTOS}枚までです`); return false;
  }
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const smallDataUrl = c.toDataURL('image/jpeg', 0.85);

  const scaleHQ = Math.min(1, MAX_MERCARI_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const wHQ = Math.round(img.naturalWidth * scaleHQ), hHQ = Math.round(img.naturalHeight * scaleHQ);
  const cHQ = document.createElement('canvas'); cHQ.width = wHQ; cHQ.height = hHQ;
  cHQ.getContext('2d').drawImage(img, 0, 0, wHQ, hHQ);
  const base64HQ = cHQ.toDataURL('image/jpeg', 0.92).split(',')[1];

  const composedImage = {
    dataUrl: smallDataUrl, mediaType: 'image/jpeg',
    base64: smallDataUrl.split(',')[1], base64HQ,
    originalDataUrl: smallDataUrl, adjust: { brightness: 0, temp: 0, contrast: 0 },
  };
  if (options.insertAt === 'front') {
    uploadedImages.unshift(composedImage);
  } else {
    uploadedImages.push(composedImage);
  }
  renderPreviews(); updateGenerateButton(); scheduleSave(); updateDraftChecklist();
  return true;
}

async function applyCompose() {
  const canvas = el('compose-preview-canvas');
  if (!canvas) return;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  let deletedBaseBeforeAdd = false;
  if (uploadedImages.length >= MAX_SELECT_PHOTOS) {
    const canDeleteBase = Number.isInteger(composeState.baseIdx);
    if (!canDeleteBase || !confirm('写真が30枚あるため、このままでは合成画像を追加できません。貼り付け先の写真を削除して合成画像を追加しますか？')) {
      alert(`写真選択は最大${MAX_SELECT_PHOTOS}枚までです`);
      return;
    }
    deletedBaseBeforeAdd = removeUploadedImagesByIndices([composeState.baseIdx]);
  }
  let shouldDeleteBaseAfterAdd = false;
  if (!deletedBaseBeforeAdd && Number.isInteger(composeState.baseIdx)) {
    const baseNumber = composeState.baseIdx + 1;
    shouldDeleteBaseAfterAdd = confirm(`合成前の貼り付け先写真（${baseNumber}枚目）を一覧から削除しますか？`);
  }
  if (await addComposedImageToApp(dataUrl, { insertAt: 'front' })) {
    if (shouldDeleteBaseAfterAdd) {
      removeUploadedImagesByIndices([composeState.baseIdx + 1]);
    }
    closeImageCompose();
  }
}

// ----- グリッド合成（2枚: 2160×2160 / 4枚: 2160×2160） -----
//   ・2枚: 各セル 1080×2160px（縦長）、4枚: 各セル 1080×1080px（正方形）、object-fit:cover 相当の中央クロップ
//   ・合成後は uploadedImages に追加し、既存プレビューに表示
const GRID_CELL = 1080;  // 各セルのピクセルサイズ

const gridComposeState = {
  mode: 2,          // 2 or 4
  selected: [],     // 選択済み uploadedImages インデックス（順番通り）
};

function openGridCompose(mode) {
  if (uploadedImages.length < mode) {
    alert(`${mode}枚合成には写真が${mode}枚以上必要です`);
    return;
  }
  gridComposeState.mode = mode;
  gridComposeState.selected = [];
  // モーダルを合成モード用タイトルにして開く
  el('compose-title').innerHTML = `📐 ${mode}枚合成 <span class="ver-tag">v0429d</span>`;
  el('compose-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  renderGridSelectStep();
}

function renderGridSelectStep() {
  const mode = gridComposeState.mode;
  const sel = gridComposeState.selected;
  const body = el('compose-body');
  const actions = el('compose-actions');
  const label = el('compose-step-label');
  body.innerHTML = '';
  actions.innerHTML = '';

  label.textContent = `使う写真を${mode}枚タップして選んでください（${sel.length}/${mode}枚選択中）`;

  const grid = document.createElement('div');
  grid.className = 'grid-compose-select';
  uploadedImages.forEach((img, idx) => {
    const cell = document.createElement('div');
    cell.className = 'grid-compose-thumb';
    const orderIdx = sel.indexOf(idx);
    const isSelected = orderIdx >= 0;
    if (isSelected) cell.classList.add('selected');

    cell.innerHTML = `<img src="${img.dataUrl}" alt=""><span class="gc-badge">${idx + 1}</span>`;
    if (isSelected) {
      const orderEl = document.createElement('div');
      orderEl.className = 'gc-order';
      orderEl.textContent = orderIdx + 1;
      cell.appendChild(orderEl);
    }
    cell.addEventListener('click', () => {
      const existIdx = gridComposeState.selected.indexOf(idx);
      if (existIdx >= 0) {
        // 選択解除
        gridComposeState.selected.splice(existIdx, 1);
      } else {
        if (gridComposeState.selected.length >= mode) {
          // すでに最大枚数 → 先頭を外して末尾追加
          gridComposeState.selected.shift();
        }
        gridComposeState.selected.push(idx);
      }
      renderGridSelectStep();
    });
    grid.appendChild(cell);
  });
  body.appendChild(grid);

  const hint = document.createElement('p');
  hint.className = 'crop-hint';
  hint.style.marginTop = '8px';
  hint.textContent = mode === 2
    ? '左から順に配置されます（1枚目→左、2枚目→右）'
    : '左上→右上→左下→右下の順に配置されます';
  body.appendChild(hint);

  // 閉じる
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = '← キャンセル';
  cancelBtn.addEventListener('click', () => {
    el('compose-title').innerHTML = `✂️ 画像合成 <span class="ver-tag">v0429d</span>`;
    closeImageCompose();
  });
  actions.appendChild(cancelBtn);

  // プレビューへ
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn primary';
  nextBtn.textContent = `プレビュー →`;
  nextBtn.disabled = sel.length < mode;
  nextBtn.addEventListener('click', () => {
    if (gridComposeState.selected.length < mode) return;
    renderGridPreviewStep();
  });
  actions.appendChild(nextBtn);
}

function renderGridPreviewStep() {
  const mode = gridComposeState.mode;
  const body = el('compose-body');
  const actions = el('compose-actions');
  const label = el('compose-step-label');
  body.innerHTML = '';
  actions.innerHTML = '';

  label.textContent = '合成プレビュー。問題なければ「追加」を押してください。';

  const wrap = document.createElement('div');
  wrap.className = 'grid-preview-wrap';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  body.appendChild(wrap);

  // Canvas に合成描画
  renderGridCanvas(canvas, mode, gridComposeState.selected).then(() => {});

  // 戻る
  const backBtn = document.createElement('button');
  backBtn.className = 'btn';
  backBtn.textContent = '← 戻る';
  backBtn.addEventListener('click', () => renderGridSelectStep());
  actions.appendChild(backBtn);

  const saveDevBtn2 = document.createElement('button');
  saveDevBtn2.className = 'btn';
  saveDevBtn2.textContent = '📥 保存のみ';
  saveDevBtn2.addEventListener('click', async () => {
    const blob = await (await fetch(canvas.toDataURL('image/jpeg', 0.90))).blob();
    await saveBlobToDevice(blob, `mercari-grid${mode}-${Date.now()}.jpg`);
  });
  actions.appendChild(saveDevBtn2);

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn primary';
  applyBtn.textContent = '➕ アプリに追加';
  applyBtn.addEventListener('click', async () => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
    const sourceIndices = [...gridComposeState.selected];
    let deletedSourcesBeforeAdd = false;
    if (uploadedImages.length >= MAX_SELECT_PHOTOS) {
      if (!confirm(`写真が30枚あるため、このままでは合成画像を追加できません。合成前の${mode}枚を削除して合成画像を追加しますか？`)) {
        alert(`写真選択は最大${MAX_SELECT_PHOTOS}枚までです`);
        return;
      }
      deletedSourcesBeforeAdd = removeUploadedImagesByIndices(sourceIndices);
    }
    if (await addComposedImageToApp(dataUrl)) {
      if (!deletedSourcesBeforeAdd && confirm(`合成前の${mode}枚の写真を一覧から削除しますか？`)) {
        removeUploadedImagesByIndices(sourceIndices);
      }
      el('compose-title').innerHTML = `✂️ 画像合成 <span class="ver-tag">v0429d</span>`;
      closeImageCompose();
    }
  });
  actions.appendChild(applyBtn);
}

// 各セルに画像を中央クロップして描画（object-fit: cover 相当）
function drawCellCover(ctx, img, dx, dy, dw, dh) {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const dAspect = dw / dh;
  const sAspect = sw / sh;
  let sx, sy, sWidth, sHeight;
  if (sAspect > dAspect) {
    // 画像の方が横長 → 横をトリム
    sHeight = sh;
    sWidth = sh * dAspect;
    sx = (sw - sWidth) / 2;
    sy = 0;
  } else {
    // 画像の方が縦長 → 縦をトリム
    sWidth = sw;
    sHeight = sw / dAspect;
    sx = 0;
    sy = (sh - sHeight) / 2;
  }
  ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
}

async function renderGridCanvas(canvas, mode, selectedIndices) {
  const cell = GRID_CELL;
  if (mode === 2) {
    canvas.width = cell * 2;  // 2160
    canvas.height = cell * 2; // 2160（正方形、4枚合成と同じ）
  } else {
    canvas.width = cell * 2;  // 2160
    canvas.height = cell * 2; // 2160
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 配置座標リスト
  let cells;
  if (mode === 2) {
    cells = [
      { dx: 0,    dy: 0, dw: cell, dh: cell * 2 },  // 左半分: 1080×2160px
      { dx: cell, dy: 0, dw: cell, dh: cell * 2 },  // 右半分: 1080×2160px
    ];
  } else {
    cells = [
      { dx: 0,    dy: 0,    dw: cell, dh: cell },
      { dx: cell, dy: 0,    dw: cell, dh: cell },
      { dx: 0,    dy: cell, dw: cell, dh: cell },
      { dx: cell, dy: cell, dw: cell, dh: cell },
    ];
  }

  for (let i = 0; i < mode; i++) {
    const imgData = uploadedImages[selectedIndices[i]];
    const img = await loadImage(imgData.dataUrl);
    drawCellCover(ctx, img, cells[i].dx, cells[i].dy, cells[i].dw, cells[i].dh);
  }
}

// ----- 下書きチェックリスト -----
function updateDraftChecklist() {
  const checklist = el('draft-checklist');
  if (!checklist) return;
  const resultVisible = el('result-section') && !el('result-section').hidden;
  if (!resultVisible) { checklist.hidden = true; return; }
  const photoCount = uploadedImages.length;
  const hasPhotos = photoCount > 0;
  const hasDraftPhotoCount = hasPhotos && photoCount <= MAX_DRAFT_PHOTOS;
  const hasTitle = !!el('title-text').value.trim();
  const hasDesc = !!el('result-text').value.trim();
  const hasPrice = !!el('price-input').value.trim();
  const hasCondition = !el('mercari-settings').hidden && !!el('m-condition').value;
  const photoLabel = !hasPhotos
    ? '写真を選んでください'
    : photoCount <= MAX_DRAFT_PHOTOS
      ? `写真 ${photoCount}枚`
      : `写真 ${photoCount}枚：下書き保存は${MAX_DRAFT_PHOTOS}枚までです`;
  const items = [
    { ok: hasDraftPhotoCount, label: photoLabel },
    { ok: hasTitle, label: hasTitle ? '商品名があります' : '商品名を確認してください' },
    { ok: hasDesc, label: hasDesc ? '説明文があります' : '先に説明文を生成してください' },
    { ok: hasPrice, label: hasPrice ? '価格が入力されています' : '販売価格を入力してください' },
    { ok: hasCondition, label: hasCondition ? '状態が選択されています' : '商品の状態を確認してください' },
  ];
  checklist.hidden = false;
  checklist.innerHTML = items.map(item =>
    `<div class="draft-check-item ${item.ok ? 'ok' : 'ng'}">
      <span class="draft-check-mark">${item.ok ? '✓' : '○'}</span>
      <span>${item.label}</span>
    </div>`
  ).join('');
}

// ----- 下書き保存（Cloudflare tunnel経由でMac自動入力） -----
async function saveDraft() {
  const gasUrl = localStorage.getItem(SERVICE_URL_KEY);
  if (!gasUrl) {
    alert('設定画面でGAS URLを入力してください');
    return;
  }
  if (!lastAiData) {
    alert('先に説明文を生成してください');
    return;
  }
  if (uploadedImages.length > MAX_DRAFT_PHOTOS) {
    const message = `メルカリ下書き保存は写真${MAX_DRAFT_PHOTOS}枚までです。現在${uploadedImages.length}枚あるため、画像合成や削除で${MAX_DRAFT_PHOTOS}枚以下にしてください。`;
    alert(message);
    const draftStatus = el('draft-status');
    if (draftStatus) {
      draftStatus.hidden = false;
      draftStatus.textContent = '❌ ' + message;
    }
    updateDraftChecklist();
    return;
  }
  const price = el('price-input').value;
  if (!price) {
    alert('販売価格を入力してください');
    return;
  }

  const draftStatus = el('draft-status');
  const draftBtn = el('draft-btn');
  draftBtn.disabled = true;
  draftStatus.hidden = false;
  draftStatus.textContent = 'MacサービスURLを取得中...';

  try {
    const tunnelUrl = await getMercariServiceUrl((message) => {
      draftStatus.textContent = message;
    });

    // 下書きリクエスト送信
    draftStatus.textContent = '下書き情報を送信中...';
    const payload = {
      title: lastAiData.title || el('title-text').value,
      description: lastAiData.description || el('result-text').value,
      price: price,
      category: CATEGORY_JP[lastAiData.category] || lastAiData.category,
      photos: uploadedImages.map(img => ({ base64: img.base64HQ || img.base64, mediaType: img.mediaType })),
      mercari_condition: el('m-condition').value,
      mercari_shipping: 'らくらくメルカリ便',
    };
    const draftResp = await fetchWithTimeout(`${tunnelUrl}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 30000);  // 写真あり→30秒に延長
    const draftData = await draftResp.json();
    const jobId = draftData.job_id;

    // ポーリング
    draftStatus.textContent = 'Macが下書きを入力中... (しばらくお待ちください)';
    while (true) {
      await new Promise(r => setTimeout(r, 10000));
      const statusResp = await fetchWithTimeout(`${tunnelUrl}/status/${jobId}`, {}, 10000);
      const statusData = await statusResp.json();
      draftStatus.textContent = statusData.message || '処理中...';
      if (statusData.status === 'done') {
        draftStatus.textContent = '✅ 下書き保存が完了しました！メルカリアプリで確認してください。';
        break;
      }
      if (statusData.status === 'error') {
        throw new Error(statusData.message);
      }
    }
  } catch (e) {
    draftStatus.textContent = `❌ エラー: ${e.message}`;
  } finally {
    draftBtn.disabled = false;
  }
}

// ----- 起動 -----
init();
