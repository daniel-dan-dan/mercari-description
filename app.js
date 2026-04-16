'use strict';

/* ============================================================
 * メルカリ説明文AI生成 - Phase 1 MVP
 * ============================================================ */

const STORAGE_KEY = 'mercari_desc_api_key';
const MODEL = 'claude-sonnet-4-6';  // 最新のSonnet 4.6
const MAX_IMAGE_EDGE = 1024;         // 長辺を1024pxにリサイズ

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

// ----- 初期起動判定 -----
function init() {
  const key = localStorage.getItem(STORAGE_KEY);
  if (!key) {
    showScreen('setup-screen');
  } else {
    showScreen('main-screen');
  }

  // イベントバインド
  el('save-key').addEventListener('click', saveApiKey);
  el('settings-btn').addEventListener('click', openSettings);
  el('photo-input').addEventListener('change', handlePhotoSelect);
  el('category').addEventListener('change', renderMeasurements);
  el('generate-btn').addEventListener('click', generateDescription);
  el('copy-btn').addEventListener('click', copyResult);
  el('copy-title-btn').addEventListener('click', copyTitle);
  el('sell-btn').addEventListener('click', openMercariSell);
  el('retry-btn').addEventListener('click', retryGeneration);
}

// ----- APIキー設定 -----
function saveApiKey() {
  const key = el('api-key').value.trim();
  if (!key) { alert('APIキーを入力してください'); return; }
  if (!key.startsWith('sk-ant-')) {
    if (!confirm('APIキーの形式が標準的でないようです。このまま保存しますか？')) return;
  }
  localStorage.setItem(STORAGE_KEY, key);
  showScreen('main-screen');
}

function openSettings() {
  const current = localStorage.getItem(STORAGE_KEY) || '';
  el('api-key').value = current;
  showScreen('setup-screen');
}

// ----- 写真アップロード＆リサイズ -----
let uploadedImages = [];  // { dataUrl, mediaType, base64 }

async function handlePhotoSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  showStatus('status', '画像を処理中...', 'loading');
  for (const file of files) {
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
}

function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // リサイズ
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        resolve({ dataUrl, mediaType: 'image/jpeg', base64 });
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
    item.innerHTML = `
      <img src="${img.dataUrl}" alt="">
      <button class="remove" data-idx="${idx}">×</button>
    `;
    grid.appendChild(item);
  });
  grid.querySelectorAll('.remove').forEach(b => {
    b.addEventListener('click', () => {
      uploadedImages.splice(Number(b.dataset.idx), 1);
      renderPreviews();
      updateGenerateButton();
    });
  });
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
  outer: [
    { section: '採寸', fields: [
      { key: 'shoulder', label: '肩幅' },
      { key: 'chest', label: '身幅' },
      { key: 'sleeve', label: '袖丈' },
      { key: 'length', label: '着丈' },
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
};

function renderMeasurements() {
  const cat = el('category').value;
  const container = el('measurement-fields');
  container.innerHTML = '';
  if (!cat) { updateGenerateButton(); return; }

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
  if (cat === 'outer' || cat === 'tops') {
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
    });
  }

  updateGenerateButton();
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
  if (cat === 'outer' || cat === 'tops') {
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
  return '';
}

// ----- 生成ボタンの活性状態 -----
function updateGenerateButton() {
  const hasPhotos = uploadedImages.length > 0;
  const hasCategory = !!el('category').value;
  el('generate-btn').disabled = !(hasPhotos && hasCategory);
}

// ----- Claude APIコール -----
const SYSTEM_PROMPT = `あなたはメルカリ古着出品のプロです。
アップロードされた古着の写真を分析し、以下の情報をJSON形式で返してください。

抽出する情報:
1. brand — ブランド名（タグから読み取る。読み取れなければ "---"）
   - 必ず**カタカナ表記**で出力すること（メルカリの検索でカタカナがよく使われるため）
   - 例: BURBERRY → バーバリー / Paul Smith → ポールスミス / POLO RALPH LAUREN → ポロラルフローレン
   - 例: UNIQLO → ユニクロ / ZARA → ザラ / BEAMS → ビームス
   - 例: Burberry London → バーバリーロンドン / BLACK LABEL CRESTBRIDGE → ブラックレーベルクレストブリッジ
   - ライン名も含む場合はカタカナで連結（例: バーバリーブラックレーベル）
   - 日本語ブランド名（無印良品、ユナイテッドアローズ等）はそのまま日本語で
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
   - デザインや素材の特徴
   - 季節感（春夏向き、秋冬向き、3シーズンなど）
   - 使えるシーン（ビジネス、カジュアル、セレモニーなど）

ルール:
- 写真から読み取れない情報は "---" と記載する（推測で埋めない）
- 状態は正直に記載する（ダメージを隠さない）
- appealの文章は丁寧だが簡潔に
- 必ず以下のJSON形式のみで返す。前後に説明やバッククォートを付けない

{"brand":"...","item":"...","tag_size":"...","color":"...","material":"...","condition":"...","appeal":"..."}`;

async function callClaude(images) {
  const key = localStorage.getItem(STORAGE_KEY);
  if (!key) throw new Error('APIキーが設定されていません');

  const content = [
    ...images.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 }
    })),
    { type: 'text', text: 'この古着の出品情報を抽出してください。' },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = `APIエラー (${res.status})`;
    try {
      const j = JSON.parse(errText);
      errMsg += ': ' + (j.error?.message || errText);
    } catch { errMsg += ': ' + errText; }
    throw new Error(errMsg);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return text;
}

// ----- テンプレート組み立て -----
function buildDescription(aiData, measurementText) {
  const brand = aiData.brand || '---';
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

【商品名】${brand} ${item}

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
  showStatus('status', 'AIに画像を分析させています... (10〜20秒ほどかかります)', 'loading');
  el('result-section').hidden = true;

  try {
    const rawText = await callClaude(uploadedImages);
    let aiData;
    try {
      aiData = JSON.parse(rawText.trim());
    } catch (e) {
      // JSONパース失敗 → そのまま表示
      el('result-text').value = rawText;
      el('result-section').hidden = false;
      showStatus('status', '⚠️ AIの応答がJSON形式でなかったため、そのまま表示しました', 'error');
      el('generate-btn').disabled = false;
      return;
    }
    const measurementText = formatMeasurements(measurements);
    const description = buildDescription(aiData, measurementText);
    el('result-text').value = description;
    // 商品名（タイトル）をセット
    const brand = aiData.brand || '';
    const item = aiData.item || '';
    const title = [brand, item].filter(Boolean).join(' ').trim();
    el('title-text').value = title;
    el('result-section').hidden = false;
    hideStatus('status');
    // 結果までスクロール
    el('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    showStatus('status', '❌ 生成失敗: ' + err.message, 'error');
  } finally {
    el('generate-btn').disabled = false;
    updateGenerateButton();
  }
}

// ----- コピー -----
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // フォールバック（iOS Safari対策）
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

async function copyResult() {
  const text = el('result-text').value;
  const ok = await copyToClipboard(text);
  showStatus('copy-status', ok ? '✅ 説明文をコピーしました' : '❌ コピーに失敗しました', ok ? 'success' : 'error');
  setTimeout(() => hideStatus('copy-status'), 2000);
}

async function copyTitle() {
  const text = el('title-text').value;
  if (!text) { alert('商品名が空です'); return; }
  const ok = await copyToClipboard(text);
  showStatus('copy-status', ok ? '✅ 商品名をコピーしました' : '❌ コピーに失敗しました', ok ? 'success' : 'error');
  setTimeout(() => hideStatus('copy-status'), 2000);
}

// ----- メルカリで出品する -----
async function openMercariSell() {
  const desc = el('result-text').value;
  if (!desc) { alert('説明文が空です'); return; }
  // まず説明文をクリップボードにコピー
  const ok = await copyToClipboard(desc);
  showStatus('copy-status',
    ok ? '✅ 説明文をコピーしました。メルカリアプリで貼り付けてください' : '⚠️ コピーに失敗しましたが、メルカリを開きます',
    ok ? 'success' : 'error');
  // メルカリの出品画面を開く
  // ディープリンク: mercari://sell（iOS/Android共通、インストール済みならアプリ起動）
  // フォールバック: https://jp.mercari.com/sell（未インストールならWebで開く）
  const deepLink = 'mercari://sell';
  const webLink = 'https://jp.mercari.com/sell';
  // iOS Safariではmercari://を直接叩くと失敗時にエラーが出るため、hidden iframe経由で試行
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = deepLink;
  document.body.appendChild(iframe);
  // 500ms後、まだページにいればWebへ遷移
  setTimeout(() => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    window.location.href = webLink;
  }, 600);
}

// ----- 再生成 -----
function retryGeneration() {
  if (confirm('もう一度AI生成を実行しますか？（APIコールが発生します）')) {
    generateDescription();
  }
}

// ----- 起動 -----
init();
