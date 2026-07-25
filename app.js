'use strict';

/* ============================================================
 * メルカリ説明文AI生成 - Phase 1 MVP
 * ============================================================ */

const LEGACY_API_KEY_STORAGE_KEY = 'mercari_desc_api_key';
const SERVICE_URL_KEY = 'gasUrl';
const API_AUTH_TOKEN_KEY = 'mercari_api_auth_token';
const LEGACY_SHARED_API_AUTH_TOKEN_KEY = 'daniel_api_auth_token';
const MAC_SERVICE_URL_CACHE_KEY = 'mercari_mac_service_url_cache';
const FALLBACK_GAS_URL = 'https://script.google.com/macros/s/AKfycbwYfwDG7Kqplk2oVeX7kF_gsAKTlK087ToE4LGp5R7PglTFMARP2lrA6ZV9m3MD0LEs/exec';
const GAS_DISCOVERY_MAX_ATTEMPTS = 3;
const GAS_DISCOVERY_RETRY_DELAYS_MS = [700, 1400];
const MAX_IMAGE_EDGE = 1024;         // 長辺を1024pxにリサイズ（AI分析用・コスト節約）
const MAX_MERCARI_EDGE = 1080;       // Mercariアップロード用（1:1撮影前提で1080×1080）
const MAX_SELECT_PHOTOS = 30;        // 編集素材として選べる写真枚数
const MAX_DRAFT_PHOTOS = 20;         // メルカリ下書き保存に送れる写真枚数
const MAX_AI_PHOTOS = 12;            // AI分析に送る写真枚数。通信安定のため下書き枚数より少なくする
const MAX_AI_PAYLOAD_BYTES = 12 * 1024 * 1024;
const MAX_MERCARI_TITLE_LENGTH = 40; // メルカリの商品名上限
const MERCARI_TITLE_EXCLUDED_MARKETING_PATTERNS = [
  /(?:オールシーズン|通年|春夏|秋冬|春物|夏物|秋物|冬物|春先|初夏|盛夏|秋口|冬場|真冬|3シーズン|３シーズン|三シーズン)(?:向け|用|物|シーズン|対応)?/gi,
  /(?:^|[\s・、,／/｜|])(?:春|夏|秋|冬)(?:向け|用|物|シーズン)?(?=$|[\s・、,／/｜|])/g,
  /\b(?:S\/S|SS|A\/W|AW|F\/W|FW|SPRING|SUMMER|AUTUMN|FALL|WINTER)\b/gi,
  /(?:大人|スマート|きれいめ)?カジュアル(?:向け|用|スタイル|コーデ|シーン|系|ウェア)?/gi,
  /(?:ビジネス|フォーマル|セレモニー)(?:向け|用|スタイル|コーデ|シーン|系|ウェア)?/g,
  /\b(?:CASUAL|BUSINESS|FORMAL|CEREMONY)\b/gi,
];
const PRODUCT_GENDER_STORAGE_KEY = 'mercari_product_gender';
const PRODUCT_GENDER_LABELS = { men: 'メンズ', women: 'レディース' };
const LISTING_STYLE_SUMMARY_STORAGE_KEY = 'mercari_listing_style_summary';
const LISTING_STYLE_PROMPT_STORAGE_KEY = 'mercari_listing_style_prompt';
const SEASON_MARKETING_RULES = {
  spring_summer: {
    label: '春夏',
    allowedWords: ['春夏', '春物', '夏物', '春先', '初夏', '薄手', '軽やか', '涼しげ'],
    disallowedWords: ['秋冬', '秋物', '冬物', '秋口', '冬場', '真冬', '防寒', '寒い季節', 'オータム', 'ウィンター', 'AW', 'A/W', 'FW', 'F/W'],
    disallowedPatterns: [
      /(?:A\/W|AW|F\/W|FW)(?:らしい|向きの?|用|シーズン)?/gi,
      /(?:秋冬|秋物|冬物)(?:向きの?|物|用|シーズン|にも|まで|に|の)?/g,
      /(?:秋口|冬場|真冬|寒い季節|防寒|オータム|ウィンター)/g,
      /(?:秋|冬)(?:らしい|向きの?|用|物|にも|まで|に|の)/g,
    ],
  },
  autumn_winter: {
    label: '秋冬',
    allowedWords: ['秋冬', '秋物', '冬物', '秋口', '冬場', '暖かみ', '防寒'],
    disallowedWords: ['春夏', '春物', '夏物', '春先', '初夏', '盛夏', '涼感', '涼しげ', '暑い季節', 'サマー', 'SS', 'S/S'],
    disallowedPatterns: [
      /(?:S\/S|SS)(?:らしい|向きの?|用|シーズン)?/gi,
      /(?:春夏|春物|夏物)(?:向きの?|物|用|シーズン|にも|まで|に|の)?/g,
      /(?:春先|初夏|盛夏|暑い季節|涼感|涼しげ|サマー)/g,
      /(?:春|夏)(?:らしい|向きの?|用|物|にも|まで|に|の)/g,
    ],
  },
};

const DB_NAME = 'mercari_desc_state';
const DB_VERSION = 2;
const DB_STORE = 'session';
const DB_TEMPORARY_DRAFT_STORE = 'inputDrafts';
const DB_TEMPORARY_DRAFT_SUMMARY_STORE = 'inputDraftSummaries';
const TEMPORARY_DRAFT_GENERATION_STALE_MS = 5 * 60 * 1000;
const TEMPORARY_DRAFT_GENERATION_HEARTBEAT_MS = 60 * 1000;
const TEMPORARY_DRAFT_STATUS = {
  incomplete: { label: '入力途中', className: 'incomplete' },
  saved: { label: 'AI生成待ち', className: 'saved' },
  generating: { label: 'AI生成中', className: 'generating' },
  failed: { label: 'AI生成失敗', className: 'failed' },
  generated: { label: 'AI生成済み', className: 'generated' },
};
const CATEGORY_JP = { suit: 'スーツ', tops: 'アウター/トップス', bottoms: 'ボトムス', bag: 'バッグ', tie: 'ネクタイ', other: 'その他' };
// カテゴリとサイズの固定データは catalog-data.js で読み込みます。
const GENDERED_CATEGORY_FALLBACKS = {
  men: {
    suit: 'men_suit',
    tops: 'men_mc_016',
    bottoms: 'men_slacks',
    shirt: 'men_shirt',
    tshirt: 'men_tshirt',
    polo: 'men_polo',
    knit: 'men_knit',
    cardigan: 'men_cardigan',
    tailored: 'men_tailored_jacket',
    trench: 'men_trench_coat',
    outer: 'men_other_outer',
    denim: 'men_denim',
    shorts: 'men_shorts',
  },
  women: {
    suit: 'women_suit',
    tops: 'women_mc_157',
    bottoms: 'women_slacks',
    shirt: 'women_shirt_blouse',
    tshirt: 'women_tshirt',
    polo: 'women_mc_153',
    knit: 'women_knit',
    cardigan: 'women_cardigan',
    tailored: 'women_tailored_jacket',
    trench: 'women_trench_coat',
    outer: 'women_other_outer',
    denim: 'women_mc_184',
    shorts: 'women_mc_185',
  },
};
const RESEARCH_REQUESTS_KEY = 'mercari_research_requests';
const RESEARCH_RESULTS_KEY = 'mercari_research_results';
const MARKDOWN_ROWS_KEY = 'mercari_markdown_rows';
const MARKDOWN_SORT_KEY = 'mercari_markdown_sort';
const MARKDOWN_FILTER_KEY = 'mercari_markdown_filter';
const MARKDOWN_FILTER_MODES = new Set(['all', 'enabled-only', 'disabled-only']);
const MARKDOWN_RECOMMENDATION_META = Object.freeze({
  collecting: { label: '判定材料を収集中', icon: '…', className: 'collecting' },
  keep: { label: '価格維持・様子見', icon: '＝', className: 'keep' },
  markdown100: { label: '100円値下げ', icon: '−100', className: 'markdown100' },
  largeMarkdown: { label: '大幅値下げ候補', icon: '↓', className: 'large' },
  reviewListing: { label: '出品内容を見直す', icon: '見直し', className: 'review' },
});
const RESEARCH_EMPTY_VALUES = new Set(['', '指定なし', 'すべて']);
const RESEARCH_WIZARD_STEPS = {
  1: '検索対象',
  2: '絞り込み',
  3: '確認・保存',
};
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
let markdownRows = [];
let markdownFilterMode = 'all';
let researchWizardStep = 1;
let temporaryDrafts = [];
let activeTemporaryDraftId = null;
let descriptionGenerationInProgress = false;
let photoProcessingInProgress = false;
let photoProcessingOperationId = 0;
let macServiceDiscoveryPromise = null;

// ----- 画面制御 -----
const el = (id) => document.getElementById(id);

function normalizeProductGender(value) {
  return value === 'women' ? 'women' : 'men';
}

function getSelectedProductGender() {
  const checked = document.querySelector('input[name="product-gender"]:checked');
  return normalizeProductGender(checked ? checked.value : localStorage.getItem(PRODUCT_GENDER_STORAGE_KEY));
}

function getSelectedProductGenderLabel() {
  return PRODUCT_GENDER_LABELS[getSelectedProductGender()] || PRODUCT_GENDER_LABELS.men;
}

function setSelectedProductGender(value, { persist = true } = {}) {
  const gender = normalizeProductGender(value);
  document.querySelectorAll('input[name="product-gender"]').forEach(input => {
    input.checked = input.value === gender;
  });
  if (persist) localStorage.setItem(PRODUCT_GENDER_STORAGE_KEY, gender);
}

function getSeasonMarketingRule(date = new Date()) {
  const month = date.getMonth() + 1;
  return month >= 3 && month <= 8
    ? SEASON_MARKETING_RULES.spring_summer
    : SEASON_MARKETING_RULES.autumn_winter;
}

function formatSeasonRuleDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isDisallowedSeasonMarketingText(value, rule = getSeasonMarketingRule()) {
  const text = String(value || '');
  return rule.disallowedPatterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function cleanSeasonMarketingText(value, rule = getSeasonMarketingRule()) {
  let text = String(value || '');
  rule.disallowedPatterns.forEach(pattern => {
    pattern.lastIndex = 0;
    text = text.replace(pattern, '');
  });
  return text
    .replace(/\s+([、。,.])/g, '$1')
    .replace(/([、。,.]){2,}/g, '$1')
    .replace(/^[\s、。,.・/／|｜-]+|[\s、。,.・/／|｜-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanSeasonMarketingSentences(value, rule = getSeasonMarketingRule()) {
  const text = String(value || '').trim();
  if (!text) return '';
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
  const kept = sentences
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .filter(sentence => !isDisallowedSeasonMarketingText(sentence, rule))
    .map(sentence => cleanSeasonMarketingText(sentence, rule))
    .filter(Boolean);
  return kept.length ? kept.join('') : cleanSeasonMarketingText(text, rule);
}

function sanitizeAiDataForSeason(aiData = {}) {
  const rule = getSeasonMarketingRule();
  const sanitized = { ...aiData };
  sanitized.appeal = cleanSeasonMarketingSentences(aiData.appeal, rule);
  sanitized.condition = cleanSeasonMarketingText(aiData.condition, rule);
  sanitized.title_keywords = getAiTitleKeywordList(aiData)
    .map(word => cleanSeasonMarketingText(word, rule))
    .map(word => cleanMercariTitleMarketingWords(word))
    .filter(Boolean)
    .filter(word => !isDisallowedSeasonMarketingText(word, rule))
    .filter(word => !isExcludedMercariTitleMarketingText(word));
  return sanitized;
}

function normalizeMercariCategoryKey(key) {
  return MERCARI_CATEGORY_OPTION_MAP[key] ? key : 'unknown';
}

function getMercariCategoryOption(key) {
  return MERCARI_CATEGORY_OPTION_MAP[normalizeMercariCategoryKey(key)];
}

function pathsMatch(path, targetPath) {
  return Array.isArray(path)
    && Array.isArray(targetPath)
    && path.length === targetPath.length
    && path.every((part, index) => part === targetPath[index]);
}

function pathStartsWith(path, prefix) {
  return Array.isArray(path)
    && Array.isArray(prefix)
    && prefix.every((part, index) => path[index] === part);
}

function getMercariCategoryChildren(prefix = []) {
  const seen = new Set();
  const children = [];
  MERCARI_CATEGORY_OPTIONS.forEach(option => {
    if (!option.path.length || option.path.length <= prefix.length) return;
    if (!pathStartsWith(option.path, prefix)) return;
    const child = option.path[prefix.length];
    if (!child || seen.has(child)) return;
    seen.add(child);
    children.push(child);
  });
  return children;
}

function findMercariCategoryByPath(path = []) {
  return MERCARI_CATEGORY_OPTIONS.find(option => pathsMatch(option.path, path)) || null;
}

function getMercariCategoryPathByKey(key) {
  return [...getMercariCategoryOption(key).path];
}

function getMercariCategoryGender(categoryKey) {
  const option = getMercariCategoryOption(categoryKey);
  const text = [...(option.path || []), option.label || ''].join(' ');
  if (/レディース/.test(text) || /^women_/.test(option.key)) return 'women';
  if (/メンズ/.test(text) || /^men_/.test(option.key)) return 'men';
  return '';
}

function validMercariCategoryKeyOrFallback(key, fallback) {
  const normalized = normalizeMercariCategoryKey(key);
  return normalized === 'unknown' ? fallback : normalized;
}

function pickGenderedCategoryFallback(categoryKey, targetGender, broadCat = el('category')?.value) {
  const fallbackMap = GENDERED_CATEGORY_FALLBACKS[targetGender] || GENDERED_CATEGORY_FALLBACKS.men;
  const option = getMercariCategoryOption(categoryKey);
  const text = [...(option.path || []), option.label || ''].join(' ');
  let fallback = '';

  if (broadCat === 'suit' || /スーツ|フォーマル/.test(text)) {
    fallback = fallbackMap.suit;
  } else if (broadCat === 'bottoms' || /パンツ|スラックス|デニム|ジーンズ|ショートパンツ|ハーフパンツ|チノ/.test(text)) {
    if (/ショートパンツ|ハーフパンツ/.test(text)) fallback = fallbackMap.shorts;
    else if (/デニム|ジーンズ/.test(text)) fallback = fallbackMap.denim;
    else fallback = fallbackMap.bottoms;
  } else if (broadCat === 'tops' || /トップス|ジャケット|アウター|コート|シャツ|ブラウス|ニット|カーディガン|ポロ|Tシャツ|カットソー/.test(text)) {
    if (/テーラード|スーツジャケット|ノーカラージャケット/.test(text)) fallback = fallbackMap.tailored;
    else if (/トレンチ/.test(text)) fallback = fallbackMap.trench;
    else if (/コート|ジャケット|アウター|ブルゾン|ジャンパー|ダウン/.test(text)) fallback = fallbackMap.outer;
    else if (/ニット|セーター/.test(text)) fallback = fallbackMap.knit;
    else if (/カーディガン/.test(text)) fallback = fallbackMap.cardigan;
    else if (/ポロ/.test(text)) fallback = fallbackMap.polo;
    else if (/Tシャツ|カットソー/.test(text)) fallback = fallbackMap.tshirt;
    else if (/シャツ|ブラウス/.test(text)) fallback = fallbackMap.shirt;
    else fallback = fallbackMap.tops;
  }

  return fallback ? validMercariCategoryKeyOrFallback(fallback, categoryKey) : categoryKey;
}

function coerceMercariCategoryForProductGender(categoryKey, broadCat = el('category')?.value) {
  const normalized = normalizeMercariCategoryKey(categoryKey);
  const categoryGender = getMercariCategoryGender(normalized);
  const selectedGender = getSelectedProductGender();
  if (!categoryGender || categoryGender === selectedGender) return normalized;
  return pickGenderedCategoryFallback(normalized, selectedGender, broadCat);
}

function syncMercariCategoryForProductGender() {
  const select = el('m-category');
  if (!select) return;
  const current = getSelectedMercariCategoryKey();
  const next = coerceMercariCategoryForProductGender(current);
  if (next !== current) {
    setSelectedMercariCategoryKey(next);
  }
}

function syncProductGenderFromMercariCategory(categoryKey) {
  const gender = getMercariCategoryGender(categoryKey);
  if (gender) setSelectedProductGender(gender);
}

function getSelectedMercariCategoryKey() {
  const node = el('m-category');
  return normalizeMercariCategoryKey(node ? node.value : 'unknown');
}

function getSelectedMercariCategoryPath() {
  return getMercariCategoryPathByKey(getSelectedMercariCategoryKey());
}

function renderMercariCategoryOptions() {
  const select = el('m-category');
  if (!select) return;
  select.innerHTML = MERCARI_CATEGORY_OPTIONS.map(option =>
    `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`
  ).join('');
  renderMercariCategoryLevelSelects();
  updateMercariCategoryPath();
}

function renderMercariCategoryLevelSelects(selectedKey = getSelectedMercariCategoryKey(), pendingPath = null) {
  const root = el('m-category-levels');
  if (!root) return;
  const selectedPath = Array.isArray(pendingPath) ? pendingPath : getMercariCategoryPathByKey(selectedKey);
  const levels = [];
  let prefix = [];

  for (let depth = 0; depth < 8; depth += 1) {
    const children = getMercariCategoryChildren(prefix);
    if (!children.length) break;
    const selectedValue = children.includes(selectedPath[depth]) ? selectedPath[depth] : '';
    levels.push({
      depth,
      children,
      selectedValue,
      label: MERCARI_CATEGORY_LEVEL_LABELS[depth] || `階層${depth + 1}`,
    });
    if (!selectedValue) break;
    prefix = [...prefix, selectedValue];
  }

  root.innerHTML = levels.map(level => `
    <label class="mercari-category-level">
      <span>${escapeHtml(level.label)}</span>
      <select data-category-level="${level.depth}" id="m-category-level-${level.depth}">
        <option value="">選択してください</option>
        ${level.children.map(child =>
          `<option value="${escapeHtml(child)}" ${child === level.selectedValue ? 'selected' : ''}>${escapeHtml(child)}</option>`
        ).join('')}
      </select>
    </label>
  `).join('');

  root.querySelectorAll('select[data-category-level]').forEach(node => {
    node.addEventListener('change', () => {
      const changedLevel = Number(node.dataset.categoryLevel || 0);
      const nextPath = [];
      root.querySelectorAll('select[data-category-level]').forEach(levelSelect => {
        const level = Number(levelSelect.dataset.categoryLevel || 0);
        if (level > changedLevel) return;
        const value = levelSelect.value;
        if (value && nextPath.length === level) nextPath.push(value);
      });

      const exact = findMercariCategoryByPath(nextPath);
      const finalSelect = el('m-category');
      if (exact) {
        setSelectedMercariCategoryKey(exact.key, { notify: true });
        return;
      }

      if (finalSelect) finalSelect.value = 'unknown';
      renderMercariCategoryLevelSelects('unknown', nextPath);
      updateMercariCategoryPath(nextPath);
      const pathGender = nextPath.includes('レディース') ? 'women' : (nextPath.includes('メンズ') ? 'men' : '');
      if (pathGender) setSelectedProductGender(pathGender);
      scheduleSave();
      updateDraftChecklist();
    });
  });
}

function setSelectedMercariCategoryKey(key, { notify = false, pendingPath = null } = {}) {
  const select = el('m-category');
  if (!select) return;
  select.value = normalizeMercariCategoryKey(key);
  renderMercariCategoryLevelSelects(select.value, pendingPath);
  updateMercariCategoryPath(pendingPath);
  if (notify) select.dispatchEvent(new Event('change', { bubbles: true }));
}

function updateMercariCategoryPath(pendingPath = null) {
  const path = el('m-category-path');
  if (!path) return;
  const option = getMercariCategoryOption(getSelectedMercariCategoryKey());
  if (Array.isArray(pendingPath) && pendingPath.length && !option.path.length) {
    path.textContent = `選択中: ${pendingPath.join(' > ')}`;
    path.classList.add('unknown');
    return;
  }
  path.textContent = option.path.length ? option.path.join(' > ') : '未判定';
  path.classList.toggle('unknown', !option.path.length);
}

function formatMercariCategoryPrompt() {
  return MERCARI_CATEGORY_OPTIONS
    .map(option => `- ${option.key}: ${option.label}`)
    .join('\n');
}

function cleanAiText(value) {
  const text = String(value || '').trim();
  if (!text || text === '---' || text === '不明') return '';
  return text;
}

function getPreferredMercariBrand(aiData) {
  const en = cleanAiText(aiData?.brand_en);
  const jp = cleanAiText(aiData?.brand);
  return en || jp || '';
}

function renderMercariSizeOptions() {
  const select = el('m-size');
  if (!select) return;
  select.innerHTML = MERCARI_SIZE_OPTIONS.map(option =>
    `<option value="${option.value}">${option.label}</option>`
  ).join('');
}

function getSelectedMercariSize() {
  const node = el('m-size');
  return node ? node.value : '';
}

function isShoeCategoryKey(categoryKey) {
  const option = getMercariCategoryOption(categoryKey);
  return option.path.includes('靴');
}

function isMercariSizeRequiredForCategoryKey(categoryKey) {
  const option = getMercariCategoryOption(categoryKey);
  if (!option.path.length) return false;
  if (option.path.some(part => part.includes('バッグ') || part.includes('小物'))) return false;
  return true;
}

function normalizeMercariSizeLabel(raw, categoryKey) {
  if (!raw) return '';
  const text = String(raw).trim();
  if (!text || text === '---') return '';
  const upper = text.toUpperCase().replace(/\s+/g, '');
  if (/^(FREE|ONESIZE|FREESIZE|フリー|フリーサイズ)$/.test(upper)) return 'FREE SIZE';

  if (isShoeCategoryKey(categoryKey)) {
    const cm = upper.match(/(\d{2}(?:\.\d)?)(?:CM|センチ)?/);
    if (cm) {
      const value = `${String(Number(cm[1])).replace(/\.0$/, '')}cm`;
      if (MERCARI_SIZE_OPTION_VALUES.has(value)) return value;
    }
  }

  const normalized = normalizeTagSize(text);
  if (!normalized) return '';
  const map = { XXL: '2XL', XXXL: '3XL' };
  const mercari = map[normalized] || normalized;
  return MERCARI_SIZE_OPTION_VALUES.has(mercari) ? mercari : '';
}

function deriveMercariSize(aiData, categoryKey = getSelectedMercariCategoryKey()) {
  const tagRaw = aiData?.tag_size || '';
  const tagSize = normalizeMercariSizeLabel(tagRaw, categoryKey);
  const measurement = computeMeasurementSize();
  const measuredSize = normalizeMercariSizeLabel(measurement?.size || '', categoryKey);

  if (tagSize && measurement) {
    const measuredForDiff = normalizeTagSize(measurement.size);
    const tagForDiff = normalizeTagSize(tagRaw) || normalizeTagSize(tagSize);
    const tagIndex = tagForDiff ? SIZE_LABELS.indexOf(tagForDiff) : -1;
    const measuredIndex = measuredForDiff ? SIZE_LABELS.indexOf(measuredForDiff) : -1;
    const diff = (tagIndex >= 0 && measuredIndex >= 0)
      ? Math.abs(tagIndex - measuredIndex)
      : 0;
    return {
      value: tagSize,
      source: 'tag',
      note: diff >= 2
        ? `タグ「${tagRaw}」を優先。採寸推定は${measurement.size}で差があります`
        : `タグ「${tagRaw}」を優先。採寸推定は${measurement.size}`,
    };
  }
  if (tagSize) {
    return { value: tagSize, source: 'tag', note: `タグ「${tagRaw}」から自動判定` };
  }
  if (measuredSize) {
    return { value: measuredSize, source: 'measurement', note: `採寸から自動判定: ${measurement.detail}` };
  }
  return { value: '', source: 'none', note: 'サイズを自動判定できませんでした' };
}

function updateMercariSizeNote(result) {
  const note = el('m-size-note');
  if (!note) return;
  const selected = getSelectedMercariSize();
  if (selected) {
    note.textContent = result?.note || `選択サイズ: ${selected}`;
    note.classList.remove('unknown');
  } else {
    note.textContent = result?.note || 'サイズなし、または手動で選んでください';
    note.classList.add('unknown');
  }
}

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

function hasTemporarySaveMinimum_() {
  return uploadedImages.length > 0 && !!el('category')?.value;
}

function updateTemporarySaveButton_() {
  const button = el('temporary-save-btn');
  const note = el('temporary-save-note');
  if (!button || !note) return;
  const hasPhotos = uploadedImages.length > 0;
  const hasCategory = !!el('category')?.value;
  const ready = hasPhotos && hasCategory;
  button.disabled = !ready || descriptionGenerationInProgress || photoProcessingInProgress;
  button.textContent = activeTemporaryDraftId
    ? '変更を保存して次の商品へ'
    : '一時保存して次の商品へ';
  if (!hasPhotos && !hasCategory) {
    note.textContent = '写真を追加し、カテゴリを選ぶと一時保存できます。';
  } else if (!hasPhotos) {
    note.textContent = '写真を1枚以上追加してください。';
  } else if (!hasCategory) {
    note.textContent = 'カテゴリを選択してください。';
  } else {
    note.textContent = '保存が完了してから入力欄を空にするため、失敗しても写真と採寸は消えません。';
  }
  note.classList.toggle('ready', ready);
}

function setDescriptionGenerationLock_(locked) {
  const controls = document.querySelectorAll(
    '#description-panel button, #description-panel input, #description-panel select, #description-panel textarea, #reset-btn, #settings-btn'
  );
  controls.forEach(control => {
    if (locked) {
      if (control.dataset.generationWasDisabled === undefined) {
        control.dataset.generationWasDisabled = control.disabled ? '1' : '0';
      }
      control.disabled = true;
      return;
    }
    if (control.dataset.generationWasDisabled !== undefined) {
      control.disabled = control.dataset.generationWasDisabled === '1';
      delete control.dataset.generationWasDisabled;
    }
  });
  el('description-panel')?.classList.toggle('generation-locked', locked);
  if (!locked) {
    updateGenerateButton();
    updateTemporarySaveButton_();
  }
}

function setPhotoProcessingLock_(locked) {
  const controls = document.querySelectorAll(
    '#description-panel button, #description-panel input, #description-panel select, #description-panel textarea, #reset-btn, #settings-btn'
  );
  controls.forEach(control => {
    if (locked) {
      if (control.dataset.photoProcessingWasDisabled === undefined) {
        control.dataset.photoProcessingWasDisabled = control.disabled ? '1' : '0';
      }
      control.disabled = true;
      return;
    }
    if (control.dataset.photoProcessingWasDisabled !== undefined) {
      control.disabled = control.dataset.photoProcessingWasDisabled === '1';
      delete control.dataset.photoProcessingWasDisabled;
    }
  });
  el('description-panel')?.classList.toggle('photo-processing-locked', locked);
  if (!locked) {
    updateGenerateButton();
    updateTemporarySaveButton_();
  }
}

// ----- 初期起動判定 -----
async function init() {
  const serviceUrl = getPreferredGasUrl();
  const authToken = getApiAuthToken();
  if (localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY)) {
    localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  }
  if (!serviceUrl || !authToken) {
    showScreen('setup-screen');
  } else {
    showScreen('main-screen');
  }

  // イベントバインド
  el('save-key').addEventListener('click', saveSettings);
  el('settings-btn').addEventListener('click', openSettings);
  el('reset-btn').addEventListener('click', resetAll);
  el('photo-input').addEventListener('change', handlePhotoSelect);
  renderMercariCategoryOptions();
  renderMercariSizeOptions();
  setSelectedProductGender(localStorage.getItem(PRODUCT_GENDER_STORAGE_KEY));
  document.querySelectorAll('input[name="product-gender"]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setSelectedProductGender(input.value);
      syncMercariCategoryForProductGender();
      updateSizeSuggestion();
      if (lastAiData && el('final-size-badge') && !el('final-size-badge').hidden) {
        renderFinalSize(lastAiData);
      }
      const sizeResult = deriveMercariSize(lastAiData, getSelectedMercariCategoryKey());
      if (el('m-size') && !el('m-size').dataset.userEdited) {
        el('m-size').value = sizeResult.value;
      }
      updateMercariSizeNote(sizeResult);
      scheduleSave();
      updateDraftChecklist();
    });
  });
  el('category').addEventListener('change', () => {
    renderMeasurements();
    syncMercariCategoryForProductGender();
    scheduleSave();
  });
  el('temporary-save-btn').addEventListener('click', () => {
    saveCurrentAsTemporaryDraft_({ resetAfter: true }).catch(error => {
      console.error('一時保存失敗:', error);
      showTemporaryDraftError_(error);
    });
  });
  el('temporary-draft-list').addEventListener('click', handleTemporaryDraftAction_);
  el('generate-btn').addEventListener('click', generateDescription);
  el('retry-btn').addEventListener('click', retryGeneration);
  const listingStyleRefreshBtn = el('listing-style-refresh-btn');
  if (listingStyleRefreshBtn) listingStyleRefreshBtn.addEventListener('click', refreshListingStyleFromMac);
  el('title-text').addEventListener('input', () => {
    const titleInput = el('title-text');
    const cappedTitle = capMercariTitleInput(titleInput.value);
    if (titleInput.value !== cappedTitle) titleInput.value = cappedTitle;
    syncDescriptionProductNameFromTitle_();
    if (lastAiData) lastAiData.title = normalizeMercariTitle(titleInput.value);
    scheduleSave();
    updateDraftChecklist();
  });
  el('result-text').addEventListener('input', () => {
    if (lastAiData) lastAiData.description = el('result-text').value;
    scheduleSave();
    updateDraftChecklist();
  });
  el('m-category').addEventListener('change', () => {
    syncProductGenderFromMercariCategory(getSelectedMercariCategoryKey());
    renderMercariCategoryLevelSelects();
    updateMercariCategoryPath();
    const sizeResult = deriveMercariSize(lastAiData, getSelectedMercariCategoryKey());
    if (el('m-size') && !el('m-size').dataset.userEdited) {
      el('m-size').value = sizeResult.value;
    }
    updateMercariSizeNote(sizeResult);
    scheduleSave();
    updateDraftChecklist();
  });
  el('m-brand').addEventListener('input', () => {
    scheduleSave();
    updateDraftChecklist();
  });
  el('m-size').addEventListener('change', () => {
    el('m-size').dataset.userEdited = '1';
    updateMercariSizeNote({ note: getSelectedMercariSize() ? `手動選択: ${getSelectedMercariSize()}` : 'サイズなし、または手動で選んでください' });
    scheduleSave();
    updateDraftChecklist();
  });
  el('m-condition').addEventListener('change', () => {
    scheduleSave();
    updateDraftChecklist();
  });
  el('compose-open-btn').addEventListener('click', openImageCompose);
  el('grid2-btn').addEventListener('click', () => openGridCompose(2));
  el('grid4-btn').addEventListener('click', () => openGridCompose(4));
  el('compose-close').addEventListener('click', closeImageCompose);
  el('draft-btn').addEventListener('click', saveDraft);
  el('price-input').addEventListener('input', () => {
    scheduleSave();
    updateDraftChecklist();
  });
  el('description-tab-btn').addEventListener('click', () => switchMainTab('description'));
  el('research-tab-btn').addEventListener('click', () => switchMainTab('research'));
  el('markdown-tab-btn').addEventListener('click', () => switchMainTab('markdown'));
  el('research-save-btn').addEventListener('click', saveResearchRequest);
  el('research-copy-btn').addEventListener('click', copyResearchRequestForNightWork);
  el('research-refresh-btn').addEventListener('click', () => refreshResearchResultsFromMac({ silent: false }));
  el('research-run-btn').addEventListener('click', runResearchNow);
  el('research-result-save-btn').addEventListener('click', saveResearchResultNote);
  el('research-wizard').addEventListener('click', handleResearchWizardAction);
  el('research-request-list').addEventListener('click', handleResearchRequestAction);
  el('research-result-list').addEventListener('click', handleResearchResultAction);
  el('markdown-load-btn').addEventListener('click', () => loadMarkdownSnapshot({ silent: false }));
  el('markdown-save-btn').addEventListener('click', saveMarkdownSettings);
  el('markdown-dry-run-btn').addEventListener('click', () => runMarkdownNow({ dryRun: true }));
  el('markdown-run-btn').addEventListener('click', () => runMarkdownNow({ dryRun: false }));
  el('markdown-list').addEventListener('input', handleMarkdownFieldChange);
  el('markdown-list').addEventListener('change', handleMarkdownFieldChange);
  el('markdown-list').addEventListener('error', handleMarkdownImageError, true);
  el('markdown-filter-control').addEventListener('click', handleMarkdownFilterChange);
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
  const gasUrlInput = el('gas-url-input');
  if (gasUrlInput) gasUrlInput.value = serviceUrl || '';
  const authTokenInput = el('auth-token-input');
  if (authTokenInput) authTokenInput.value = authToken || '';
  renderListingStyleStatus(readListingStyleSummary());

  // 前回のセッションを復元
  if (serviceUrl && authToken) {
    try {
      const saved = await loadSession();
      if (saved) restoreState(saved);
    } catch (e) {
      console.warn('セッション復元失敗:', e);
    }
  }
  try {
    await refreshTemporaryDrafts_({ recoverInterrupted: true });
  } catch (e) {
    console.warn('一時保存一覧の読込失敗:', e);
    showTemporaryDraftError_(e);
  }
  markdownFilterMode = readMarkdownFilterMode();
  markdownRows = readJsonList(MARKDOWN_ROWS_KEY);
  renderResearchData();
  renderMarkdownRows();
  setResearchWizardStep(1, { scroll: false });
  if (serviceUrl && authToken) refreshResearchResultsFromMac({ silent: true }).catch(() => {});
  if (serviceUrl && authToken) refreshListingStyleStatusFromMac({ silent: true }).catch(() => {});
  if (serviceUrl && authToken) loadMarkdownSnapshot({ silent: true }).catch(() => {});
  updateGenerateButton();
  updateTemporarySaveButton_();
  updateResearchPreview();
}

// ----- 設定 -----
function saveSettings() {
  const gasUrlInput = el('gas-url-input');
  const gasUrl = normalizeGasUrl(gasUrlInput ? gasUrlInput.value : '');
  const authToken = String(el('auth-token-input')?.value || '').trim();
  if (!gasUrl) { alert('GAS URLを入力してください'); return; }
  if (authToken.length < 24) { alert('端末接続コードが正しくありません'); return; }
  localStorage.setItem(SERVICE_URL_KEY, gasUrl);
  localStorage.setItem(API_AUTH_TOKEN_KEY, authToken);
  if (localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY)) {
    localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  }
  showScreen('main-screen');
}

function openSettings() {
  const gasUrlInput = el('gas-url-input');
  if (gasUrlInput) gasUrlInput.value = getPreferredGasUrl();
  const authTokenInput = el('auth-token-input');
  if (authTokenInput) authTokenInput.value = getApiAuthToken();
  showScreen('setup-screen');
}

// ----- 写真アップロード＆リサイズ -----
let uploadedImages = [];  // { dataUrl, mediaType, base64 }

async function handlePhotoSelect(e) {
  if (descriptionGenerationInProgress || photoProcessingInProgress) {
    e.target.value = '';
    showStatus(
      'status',
      descriptionGenerationInProgress
        ? 'AI生成中は写真を変更できません。完了後に操作してください。'
        : '選択した写真を処理中です。完了後に追加してください。',
      'warn',
    );
    return;
  }
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
  const operationId = ++photoProcessingOperationId;
  const startingDraftId = activeTemporaryDraftId;
  const processedImages = [];
  photoProcessingInProgress = true;
  setPhotoProcessingLock_(true);
  showStatus('status', '画像を処理中...', 'loading');
  try {
    for (const file of toAdd) {
      try {
        const processed = await processImage(file);
        if (operationId !== photoProcessingOperationId || startingDraftId !== activeTemporaryDraftId) {
          break;
        }
        processedImages.push(processed);
      } catch (err) {
        console.error(err);
        alert('画像処理に失敗しました: ' + file.name);
      }
    }
  } finally {
    photoProcessingInProgress = false;
    setPhotoProcessingLock_(false);
    e.target.value = '';  // 同じファイル再選択可能に
  }
  if (operationId !== photoProcessingOperationId || startingDraftId !== activeTemporaryDraftId) {
    showStatus('status', '商品が切り替わったため、処理中だった写真は追加しませんでした。', 'warn');
    return;
  }
  uploadedImages.push(...processedImages);
  renderPreviews();
  updateGenerateButton();
  hideStatus('status');
  scheduleSave();
  updateDraftChecklist();
}

function createThumbnailBase64FromCanvas_(sourceCanvas, maxEdge = 180) {
  const longest = Math.max(sourceCanvas.width, sourceCanvas.height);
  if (!longest) return '';
  const scale = Math.min(1, maxEdge / longest);
  const width = Math.max(1, Math.round(sourceCanvas.width * scale));
  const height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const thumbnail = document.createElement('canvas');
  thumbnail.width = width;
  thumbnail.height = height;
  thumbnail.getContext('2d').drawImage(sourceCanvas, 0, 0, width, height);
  return thumbnail.toDataURL('image/jpeg', 0.72).split(',')[1] || '';
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
        const thumbnailBase64 = createThumbnailBase64FromCanvas_(canvas);
        resolve({
          dataUrl, mediaType: 'image/jpeg', base64, base64HQ, thumbnailBase64,
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
    item.draggable = !(descriptionGenerationInProgress || photoProcessingInProgress);
    item.dataset.idx = idx;
    item.innerHTML = `
      <img src="${img.dataUrl}" alt="">
      <button class="remove" data-idx="${idx}" title="削除">×</button>
      <span class="preview-num">${idx + 1}</span>
    `;
    grid.appendChild(item);
  });
  grid.querySelectorAll('.remove').forEach(b => {
    b.disabled = descriptionGenerationInProgress || photoProcessingInProgress;
    b.addEventListener('click', () => {
      if (descriptionGenerationInProgress || photoProcessingInProgress) return;
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
  if (descriptionGenerationInProgress || photoProcessingInProgress) return false;
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
    if (descriptionGenerationInProgress || photoProcessingInProgress) return false;
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
  tie: [
    { section: '採寸', fields: [
      { key: 'tie_length', label: '長さ' },
      { key: 'tie_blade_width', label: '大剣幅' },
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
  const voiceHint = cat === 'tie'
    ? '例:「長さ 145」「大剣幅 8」… 続けて話せます'
    : '例:「肩幅 45」「袖丈 60.5」… 続けて話せます';
  voiceBar.innerHTML = `
    <button type="button" id="multi-voice-btn" class="multi-voice-btn">🎤 まとめて音声入力</button>
    <div id="multi-voice-status" class="multi-voice-status"></div>
    <div class="multi-voice-hint">${voiceHint}</div>
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
  if (cat === 'tie') {
    return [
      line('長さ', v.tie_length),
      line('大剣幅', v.tie_blade_width),
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
  el('generate-btn').disabled = !ready || descriptionGenerationInProgress || photoProcessingInProgress;
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
  updateTemporarySaveButton_();
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
   - デザインや素材の特徴
   - 季節感は、現在の販売時期に合う言葉だけを使う
   - 使えるシーン（ビジネス、カジュアル、セレモニーなど）
   - 商品の事実（素材・シルエット・カラー・シーン）を軸にしながら、「手に取った瞬間から違いがわかる」「着るだけで雰囲気が変わる」「なかなか出回らない」など感情に訴える一言を自然に散りばめる
   - ウール・カシミヤ・リネン・シルク・コーデュロイ・綿100％などアピールできる素材であれば、その質感や着心地にも触れる。素材の訴求力はアイテムや文脈で判断すること（例：綿100％はトレンチコートでは高品質の証として積極的に触れる）。ポリエステルが主体など訴求力の低い素材は触れなくてよい
   - ただし「ぜひ」「いかがでしょうか」「手放せない」「激レア」「一着」のような過剰なセールストーク・定型文は使わない
   - 「なかなか出回らない」は商品・モデルの希少性に使う場合のみ。雰囲気・質感など抽象的なものにかけない
   - ブランド名・アイテム名は含めない（直後の【商品名】欄に記載されるため）
   - トレンチコートにライナー（取り外し可能な裏地）が付いている場合は必ず触れる（着回しの幅が広がる重要な訴求ポイントのため）
8. mercari_condition — 商品の状態（メルカリUI用）。以下の6択から1つ選ぶ: "新品、未使用" / "未使用に近い" / "目立った傷や汚れなし" / "やや傷や汚れあり" / "傷や汚れあり" / "全体的に状態が悪い"
9. mercari_category_key — メルカリ詳細カテゴリ。写真・タグ・商品種別から最も近いキーを1つだけ選ぶ。性別やアイテムが判断できない場合は "unknown" を選ぶ。
   候補:
${formatMercariCategoryPrompt()}
10. title_keywords — 商品名に入れる候補の短い単語を配列で2〜5個。メルカリ上限40文字に収めやすいよう、1語は12文字以内を目安にする。
   - 季節を表す言葉（春夏、秋冬、春物、夏物、秋物、冬物、3シーズン、SS、AWなど）は一切入れない
   - 着用場面・雰囲気だけを表す言葉（カジュアル、ビジネス、フォーマル、セレモニーなど）は一切入れない
   - ブランド、アイテム、素材、柄、付属品、状態など、商品そのものを検索できる事実だけを候補にする
   - 過去出品例がある場合は、過去のタイトルでよく使う訴求語・語順・強調の癖を参考にする
   - ただし、過去出品例の商品情報（ブランド、サイズ、色、状態、素材）は今回の商品へコピーしない

ルール:
- 写真から読み取れない情報は "---" と記載する（推測で埋めない）
- 状態は正直に記載する（ダメージを隠さない）
- appealの文章は丁寧だが簡潔に
- 過去出品例がある場合、タイトル・説明文の文体、言い回し、訴求語の選び方だけを参考にする。商品事実は今回の写真・タグ・採寸を最優先する
- **出力は JSON オブジェクト1つのみ**。前置きの文章・後置きの説明・「以下の通りです」のような挨拶・\`\`\`json などのコードフェンス・改行のみの行を一切含めない。最初の文字は { で、最後の文字は } とすること
- JSON 内の文字列は二重引用符 " で囲む（' は使わない）。文字列中の改行は \\n でエスケープする

{"brand":"...","brand_en":"...","item":"...","tag_size":"...","color":"...","material":"...","condition":"...","appeal":"...","mercari_category_key":"men_shirt","mercari_condition":"目立った傷や汚れなし","title_keywords":["美品","上質"]}`;

function buildPastListingStylePrompt(stylePrompt) {
  const prompt = String(stylePrompt || '').trim();
  return prompt ? `\n\n${prompt}` : '';
}

function buildDescriptionSystemPrompt(stylePrompt = '') {
  const genderLabel = getSelectedProductGenderLabel();
  const seasonRule = getSeasonMarketingRule();
  return `${SYSTEM_PROMPT}

今回の商品対象:
- 対象は「${genderLabel}」として扱う
- mercari_category_key は、明らかに写真と矛盾しない限り「${genderLabel}」側のカテゴリから選ぶ
- サイズ推定やタグサイズの解釈も「${genderLabel}」向けとして扱う

今回の季節ワードルール:
- 現在日付: ${formatSeasonRuleDate()}。販売訴求では「${seasonRule.label}」に合う季節ワードだけを使う
- 使ってよい季節ワード例: ${seasonRule.allowedWords.join('、')}
- 使わない季節外れワード: ${seasonRule.disallowedWords.join('、')}
- appeal には季節外れワードを入れない
- title_keywords には、販売時期に合うかどうかに関係なく季節ワードを一切入れない
- title_keywords には、カジュアル、ビジネス、フォーマル、セレモニーなどの着用場面・雰囲気語も一切入れない${buildPastListingStylePrompt(stylePrompt)}`;
}

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
  const headers = new Headers(opts.headers || {});
  let target;
  try { target = new URL(url, location.href); } catch (_) { target = null; }
  const isGas = target && target.hostname === 'script.google.com';
  const token = getApiAuthToken();
  if (!isGas && token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const method = String(opts.method || 'GET').toUpperCase();
  if (!isGas && method === 'POST' && !headers.has('X-Operation-Id')) {
    headers.set('X-Operation-Id', createOperationId_(target?.pathname || 'request'));
  }
  return fetch(url, { ...opts, headers, signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

function getApiAuthToken() {
  const currentToken = String(localStorage.getItem(API_AUTH_TOKEN_KEY) || '').trim();
  if (currentToken) return currentToken;

  // GitHub Pages配下の別PWAと共有していた旧キーから一度だけ移行する。
  // 旧キーは店舗巡回アプリが引き続き使うため、削除しない。
  const legacyToken = String(localStorage.getItem(LEGACY_SHARED_API_AUTH_TOKEN_KEY) || '').trim();
  if (legacyToken) {
    localStorage.setItem(API_AUTH_TOKEN_KEY, legacyToken);
  }
  return legacyToken;
}

function createOperationId_(label = 'operation') {
  const suffix = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${String(label).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 30)}-${suffix}`;
}

function estimateJsonBytes(value) {
  const text = JSON.stringify(value);
  if (window.TextEncoder) return new TextEncoder().encode(text).length;
  return text.length;
}

function formatNetworkError(err, label) {
  const raw = (err && err.message) ? err.message : String(err || '');
  if (err && err.name === 'AbortError') {
    return `${label}がタイムアウトしました。写真枚数を減らすか、少し時間を置いて再実行してください。`;
  }
  if (/load failed|failed to fetch|networkerror/i.test(raw)) {
    return `${label}に失敗しました。Macサービスまたはトンネルの通信が切れた可能性があります。写真が多い場合は、先頭12枚までに減らして再実行してください。`;
  }
  return `${label}に失敗しました: ${raw}`;
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    const preview = text.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`${label}の応答をJSONとして読めませんでした (${response.status}): ${preview}`);
  }
}

function normalizeGasUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function normalizeMacServiceUrl_(url) {
  const normalized = normalizeGasUrl(url);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const localHttp = parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) return '';
    return normalized;
  } catch (_) {
    return '';
  }
}

function getCachedMacServiceUrl_() {
  try {
    return normalizeMacServiceUrl_(localStorage.getItem(MAC_SERVICE_URL_CACHE_KEY));
  } catch (_) {
    return '';
  }
}

function cacheMacServiceUrl_(url) {
  const normalized = normalizeMacServiceUrl_(url);
  if (!normalized) return '';
  try {
    localStorage.setItem(MAC_SERVICE_URL_CACHE_KEY, normalized);
  } catch (_) {}
  return normalized;
}

function clearCachedMacServiceUrl_() {
  try { localStorage.removeItem(MAC_SERVICE_URL_CACHE_KEY); } catch (_) {}
}

function getPreferredGasUrl() {
  return normalizeGasUrl(localStorage.getItem(SERVICE_URL_KEY)) || FALLBACK_GAS_URL;
}

function getGasUrlCandidates() {
  const urls = [
    normalizeGasUrl(localStorage.getItem(SERVICE_URL_KEY)),
    FALLBACK_GAS_URL,
  ].filter(Boolean);
  return Array.from(new Set(urls));
}

function isTransientServiceDiscoveryError_(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'AbortError'
    || /load failed|failed to fetch|networkerror|network request failed|timed? ?out/i.test(message)
    || /GAS URLエラー \(5\d\d\)/i.test(message);
}

async function fetchTunnelUrlFromGasOnce_(gasUrl) {
  const authToken = getApiAuthToken();
  if (!authToken) throw new Error('端末接続コードが未設定です。設定画面で接続してください。');
  const gasResp = await fetchWithTimeout(
    gasUrl,
    {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getTunnelUrl', auth_token: authToken }),
    },
    10000
  );
  const text = await gasResp.text();
  let gasData;
  try {
    gasData = JSON.parse(text);
  } catch (_) {
    const preview = text.replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(`GAS URLの応答がJSONではありません（古いURLの可能性）: ${preview}`);
  }
  if (!gasResp.ok || gasData.success === false) {
    throw new Error(gasData.error || `GAS URLエラー (${gasResp.status})`);
  }
  let tunnelUrl = (gasData.data && gasData.data.url) || gasData.url || '';
  if (!tunnelUrl) throw new Error('Macのメルカリ自動入力サービスが起動していません。Macでstart.pyを確認してください。');
  tunnelUrl = normalizeMacServiceUrl_(tunnelUrl);
  if (!tunnelUrl) throw new Error('GASに登録されたMacサービスURLが正しくありません。');
  return tunnelUrl;
}

async function fetchTunnelUrlFromGas(gasUrl, { onRetry } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= GAS_DISCOVERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchTunnelUrlFromGasOnce_(gasUrl);
    } catch (error) {
      lastError = error;
      if (!isTransientServiceDiscoveryError_(error) || attempt >= GAS_DISCOVERY_MAX_ATTEMPTS) {
        break;
      }
      onRetry?.(attempt + 1, GAS_DISCOVERY_MAX_ATTEMPTS);
      const delay = GAS_DISCOVERY_RETRY_DELAYS_MS[attempt - 1] || 1400;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  if (isTransientServiceDiscoveryError_(lastError)) {
    const error = new Error(`GASとの通信が一時的に失敗しました（${GAS_DISCOVERY_MAX_ATTEMPTS}回自動再試行済み）。`);
    error.cause = lastError;
    throw error;
  }
  throw lastError || new Error('GASからMacサービスURLを取得できませんでした。');
}

async function pingMacService(url) {
  let resp;
  try {
    resp = await fetchWithTimeout(`${url}/ping`, {}, 8000);
  } catch (err) {
    throw new Error(formatNetworkError(err, 'Macサービス接続確認'));
  }
  const json = await readJsonResponse(resp, 'Macサービス接続確認');
  return !!json.ok;
}

async function discoverMercariServiceUrl_(statusCallback) {
  const gasUrls = getGasUrlCandidates();
  if (!gasUrls.length) throw new Error('設定画面でGAS URLを入力してください');

  const cachedUrl = getCachedMacServiceUrl_();
  if (cachedUrl) {
    statusCallback?.('前回のMac接続先を確認中...');
    try {
      if (await pingMacService(cachedUrl)) return cachedUrl;
    } catch (_) {}
  }

  const errors = [];
  for (let i = 0; i < gasUrls.length; i += 1) {
    const gasUrl = gasUrls[i];
    const label = i === 0 ? 'MacサービスURLを取得中...' : '予備GAS URLでMacサービスURLを取得中...';
    try {
      statusCallback?.(label);
      let tunnelUrl = await fetchTunnelUrlFromGas(gasUrl, {
        onRetry: (attempt, maxAttempts) => {
          statusCallback?.(`接続先の取得を再試行中... (${attempt}/${maxAttempts})`);
        },
      });

      statusCallback?.('Macサービスに接続確認中...');
      let passed = false;
      try { passed = await pingMacService(tunnelUrl); } catch (_) {}
      if (!passed) {
        statusCallback?.('トンネル再接続中... (3秒後に再試行)');
        await new Promise(resolve => setTimeout(resolve, 3000));
        tunnelUrl = await fetchTunnelUrlFromGas(gasUrl, {
          onRetry: (attempt, maxAttempts) => {
            statusCallback?.(`接続先の再取得中... (${attempt}/${maxAttempts})`);
          },
        });
        statusCallback?.('再接続確認中...');
        try { passed = await pingMacService(tunnelUrl); } catch (_) {}
      }

      if (!passed) throw new Error('Macサービスに接続できません。Cloudflare tunnelの再起動が必要です。');
      cacheMacServiceUrl_(tunnelUrl);
      if (normalizeGasUrl(localStorage.getItem(SERVICE_URL_KEY)) !== gasUrl) {
        localStorage.setItem(SERVICE_URL_KEY, gasUrl);
        const gasUrlInput = el('gas-url-input');
        if (gasUrlInput) gasUrlInput.value = gasUrl;
      }
      return tunnelUrl;
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  if (cachedUrl) {
    statusCallback?.('前回のMac接続先を再確認中...');
    await new Promise(resolve => setTimeout(resolve, 1200));
    try {
      if (await pingMacService(cachedUrl)) return cachedUrl;
    } catch (_) {}
    clearCachedMacServiceUrl_();
  }

  throw new Error(`MacサービスURLを取得できませんでした。${errors.join(' / ')}`);
}

async function getMercariServiceUrl(statusCallback) {
  if (macServiceDiscoveryPromise) {
    statusCallback?.('Macサービス接続の確認待ち...');
    return macServiceDiscoveryPromise;
  }
  const discovery = discoverMercariServiceUrl_(statusCallback);
  macServiceDiscoveryPromise = discovery;
  try {
    return await discovery;
  } finally {
    if (macServiceDiscoveryPromise === discovery) {
      macServiceDiscoveryPromise = null;
    }
  }
}

function readListingStyleSummary() {
  try {
    return JSON.parse(localStorage.getItem(LISTING_STYLE_SUMMARY_STORAGE_KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function readListingStylePrompt() {
  return String(localStorage.getItem(LISTING_STYLE_PROMPT_STORAGE_KEY) || '').trim();
}

function saveListingStyleSummary(style) {
  const summary = {
    hasStyle: !!style?.hasStyle,
    itemCount: Number(style?.itemCount || 0),
    updatedAt: style?.updatedAt || '',
    titleWordHints: Array.isArray(style?.titleWordHints) ? style.titleWordHints.slice(0, 12) : [],
  };
  localStorage.setItem(LISTING_STYLE_SUMMARY_STORAGE_KEY, JSON.stringify(summary));
  const stylePrompt = String(style?.prompt || '').trim();
  if (summary.hasStyle && stylePrompt) {
    localStorage.setItem(LISTING_STYLE_PROMPT_STORAGE_KEY, stylePrompt);
  } else if (!summary.hasStyle) {
    localStorage.removeItem(LISTING_STYLE_PROMPT_STORAGE_KEY);
  }
  renderListingStyleStatus(summary);
  return summary;
}

function formatListingStyleDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderListingStyleStatus(summary = {}) {
  const node = el('listing-style-status');
  if (!node) return;
  if (summary.hasStyle && summary.itemCount) {
    const updated = formatListingStyleDate(summary.updatedAt);
    const hints = (summary.titleWordHints || []).slice(0, 6).join('、');
    node.textContent = `過去出品${summary.itemCount}件を参考にします${updated ? `（更新: ${updated}）` : ''}${hints ? `。よく使う語: ${hints}` : ''}`;
    node.classList.remove('unknown');
  } else {
    node.textContent = 'まだ過去出品の文体を取得していません。生成はできますが、文体は通常のAI文になります。';
    node.classList.add('unknown');
  }
}

async function fetchListingStyleFromMac(tunnelUrl, { silent = false, statusCallback } = {}) {
  if (!silent) statusCallback?.('過去出品の文体を読み込み中...');
  const cachedPrompt = readListingStylePrompt();
  let resp;
  try {
    resp = await fetchWithTimeout(`${tunnelUrl}/listing-style`, {}, 12000);
  } catch (err) {
    if (cachedPrompt) {
      if (!silent) statusCallback?.('保存済みの過去出品文体を反映します...');
      return cachedPrompt;
    }
    if (!silent) statusCallback?.('過去出品の文体は読み込めませんでした。通常生成で続けます。');
    return '';
  }
  const data = await readJsonResponse(resp, '過去出品文体');
  if (!resp.ok || data.ok === false) {
    if (cachedPrompt) {
      if (!silent) statusCallback?.('保存済みの過去出品文体を反映します...');
      return cachedPrompt;
    }
    if (!silent) statusCallback?.('過去出品の文体は読み込めませんでした。通常生成で続けます。');
    return '';
  }
  saveListingStyleSummary(data);
  if (data.hasStyle && data.prompt) {
    if (!silent) statusCallback?.(`過去出品${data.itemCount || 0}件の文体を反映します...`);
    return String(data.prompt || '');
  }
  if (cachedPrompt) {
    if (!silent) statusCallback?.('保存済みの過去出品文体を反映します...');
    return cachedPrompt;
  }
  if (!silent) statusCallback?.('過去出品の文体は未取得です。通常生成で続けます。');
  return '';
}

async function refreshListingStyleStatusFromMac({ silent = false } = {}) {
  const tunnelUrl = await getMercariServiceUrl((message) => {
    if (!silent) renderListingStyleStatus({ hasStyle: false, itemCount: 0, updatedAt: '', titleWordHints: [message] });
  });
  await fetchListingStyleFromMac(tunnelUrl, { silent });
}

function attachJobWaitCancel_(statusNode) {
  const controller = new AbortController();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small job-wait-cancel';
  button.textContent = '待機をやめる';
  button.addEventListener('click', () => controller.abort());
  statusNode?.insertAdjacentElement('afterend', button);
  return {
    signal: controller.signal,
    cleanup: () => button.remove(),
  };
}

function waitForPoll_(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('待機を中止しました。処理自体はMacで継続しています。'));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      reject(new Error('待機を中止しました。処理自体はMacで継続しています。'));
    }
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

async function pollMacJob(tunnelUrl, jobId, { intervalMs = 3000, timeoutMs = 240000, onStatus, signal } = {}) {
  const started = Date.now();
  while (true) {
    if (Date.now() - started > timeoutMs) throw new Error('処理がタイムアウトしました');
    await waitForPoll_(intervalMs, signal);
    const statusResp = await fetchWithTimeout(`${tunnelUrl}/status/${jobId}`, {}, 12000);
    const statusData = await readJsonResponse(statusResp, '処理状況');
    onStatus?.(statusData);
    if (statusData.status === 'done') return statusData;
    if (statusData.status === 'error') throw new Error(statusData.message || 'Mac側処理でエラーが発生しました');
  }
}

async function refreshListingStyleFromMac() {
  const btn = el('listing-style-refresh-btn');
  const status = el('listing-style-status');
  if (btn) btn.disabled = true;
  if (status) {
    status.classList.remove('unknown');
    status.textContent = 'MacサービスURLを取得中...';
  }
  let waitControl = null;
  try {
    const tunnelUrl = await getMercariServiceUrl((message) => {
      if (status) status.textContent = message;
    });
    if (status) status.textContent = 'メルカリの過去出品を全件読み込み中...';
    const resp = await fetchWithTimeout(
      `${tunnelUrl}/listing-style/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, limit: 0 }),
      },
      20000
    );
    const data = await readJsonResponse(resp, '過去出品文体更新');
    if (!resp.ok || data.ok === false || !data.job_id) {
      throw new Error(data.error || `過去出品文体更新エラー (${resp.status})`);
    }
    waitControl = attachJobWaitCancel_(status);
    const job = await pollMacJob(tunnelUrl, data.job_id, {
      intervalMs: 5000,
      timeoutMs: 1200000,
      onStatus: (statusData) => {
        if (status) status.textContent = statusData.message || '処理中...';
      },
      signal: waitControl.signal,
    });
    const style = job.style || {};
    saveListingStyleSummary(style);
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = `過去出品の文体取得に失敗しました: ${err.message}`;
      status.classList.add('unknown');
    }
  } finally {
    waitControl?.cleanup();
    if (btn) btn.disabled = false;
  }
}

async function callDescriptionAi(images, onChunk) {
  const tunnelUrl = await getMercariServiceUrl((message) => {
    if (onChunk) onChunk(message);
  });
  const listingStylePrompt = await fetchListingStyleFromMac(tunnelUrl, {
    statusCallback: onChunk,
  });

  const aiImages = images.slice(0, MAX_AI_PHOTOS).map(img => ({
    mediaType: img.mediaType,
    base64: img.base64,
  }));
  const omittedCount = Math.max(0, images.length - aiImages.length);
  const payload = {
    images: aiImages,
    systemPrompt: buildDescriptionSystemPrompt(listingStylePrompt),
  };
  const payloadBytes = estimateJsonBytes(payload);
  if (payloadBytes > MAX_AI_PAYLOAD_BYTES) {
    throw new Error(`写真データが大きすぎます。現在約${Math.ceil(payloadBytes / 1024 / 1024)}MBです。写真を減らすか、合成してから再実行してください。`);
  }

  if (onChunk) {
    const suffix = omittedCount ? `（AI分析は先頭${MAX_AI_PHOTOS}枚まで。残り${omittedCount}枚は下書き保存には残ります）` : '';
    onChunk(`AIが画像を分析中...${suffix}`);
  }

  let res;
  try {
    res = await fetchWithTimeout(
      `${tunnelUrl}/describe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      120000
    );
  } catch (err) {
    throw new Error(formatNetworkError(err, 'AI生成通信'));
  }

  const data = await readJsonResponse(res, 'AI生成');
  if (!res.ok) {
    const requestId = data.requestId ? `（管理ID: ${String(data.requestId).slice(0, 8)}）` : '';
    throw new Error((data.error || `AI APIエラー (${res.status})`) + requestId);
  }
  if (!data.text) {
    throw new Error('AI応答が空でした');
  }
  if (data.attempts > 1 && onChunk) {
    onChunk(`AI生成が一時失敗したため、自動再試行して成功しました（${data.attempts}回目）。`);
  }
  if (onChunk) onChunk(data.text);
  return data.text;
}

// ----- テンプレート組み立て -----
function isMissingProductValue(value, { removeCondition = false } = {}) {
  const cleaned = cleanProductNamePart(value, { removeCondition });
  return !cleaned || cleaned === '---';
}

function cleanProductNamePart(value, { removeCondition = false } = {}) {
  let cleaned = cleanTitleSegment(value)
    .replace(/[✨★☆]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (removeCondition) {
    cleaned = cleaned
      .replace(/(極美品|超美品|美品|良品)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return cleaned;
}

function addUniqueProductNamePart(parts, value, { removeCondition = false } = {}) {
  const rawCleaned = cleanProductNamePart(value);
  if (isMissingProductValue(rawCleaned)) return;
  const rawComparable = normalizeTitleComparable(rawCleaned);
  if (rawComparable && parts.some(part => normalizeTitleComparable(part) === rawComparable)) return;

  const cleaned = cleanProductNamePart(value, { removeCondition });
  if (isMissingProductValue(cleaned, { removeCondition })) return;
  const comparable = normalizeTitleComparable(cleaned);
  if (!comparable) return;
  if (parts.some(part => normalizeTitleComparable(part) === comparable)) return;
  parts.push(cleaned);
}

function buildDescriptionProductName(aiData, mercariTitle = '') {
  const parts = [];
  addUniqueProductNamePart(parts, aiData.brand);
  addUniqueProductNamePart(parts, aiData.brand_en);
  addUniqueProductNamePart(parts, aiData.item);

  String(mercariTitle || '')
    .split(/\s+/)
    .forEach(word => addUniqueProductNamePart(parts, word, { removeCondition: true }));

  return parts.length ? parts.join(' ') : '---';
}

function buildDescription(aiData, measurementText, mercariTitle = '') {
  const productName = buildDescriptionProductName(aiData, mercariTitle);
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

【商品名】${productName}

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

function syncDescriptionProductNameFromTitle_() {
  const title = normalizeMercariTitle(el('title-text')?.value || '');
  const textarea = el('result-text');
  if (!title || !textarea?.value) return;
  const productName = buildDescriptionProductName(lastAiData || {}, title);
  const next = textarea.value.replace(/^【商品名】.*$/m, `【商品名】${productName}`);
  if (next !== textarea.value) textarea.value = next;
  if (lastAiData) lastAiData.description = textarea.value;
}

function renderResultMetadata_(data = {}) {
  const node = el('result-meta');
  if (!node) return;
  const generated = data.generated_at ? formatListingStyleDate(data.generated_at) : '復元データ';
  const photoCount = Number(data.photo_count || uploadedImages.length || 0);
  node.hidden = false;
  node.innerHTML = `<strong>この商品の結果</strong><span>生成: ${escapeHtml(generated)}</span><span>写真: ${photoCount}枚</span>`;
}

function missingTitleWordsInDescription_() {
  const titleWords = String(el('title-text')?.value || '')
    .split(/\s+/)
    .map(cleanProductNamePart)
    .filter(word => word && !/^(?:極美品|超美品|美品|良品)$/.test(word));
  const description = String(el('result-text')?.value || '');
  const productLine = (description.match(/^【商品名】(.*)$/m) || [])[1] || '';
  const comparable = normalizeTitleComparable(productLine);
  return titleWords.filter(word => !comparable.includes(normalizeTitleComparable(word)));
}

function mercariTitleLength(value) {
  return Array.from(String(value || '').trim()).length;
}

function isExcludedMercariTitleMarketingText(value) {
  const text = String(value || '');
  return MERCARI_TITLE_EXCLUDED_MARKETING_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function cleanMercariTitleMarketingWords(value) {
  let cleaned = String(value || '');
  MERCARI_TITLE_EXCLUDED_MARKETING_PATTERNS.forEach(pattern => {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, ' ');
  });
  return cleaned
    .replace(/\s+([・、。,.／/｜|])/g, '$1')
    .replace(/([・、。,.／/｜|]){2,}/g, '$1')
    .replace(/^[\s・、。,.／/｜|_-]+|[\s・、。,.／/｜|_-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeMercariTitle(value) {
  const cleaned = cleanMercariTitleMarketingWords(value)
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, MAX_MERCARI_TITLE_LENGTH).join('').trim();
}

function capMercariTitleInput(value) {
  return normalizeMercariTitle(value);
}

function cleanTitleSegment(value) {
  const cleaned = String(value || '')
    .replace(/---/g, '')
    .replace(/[【】「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function normalizeTitleComparable(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[✨★☆・.,、。／/\\\s]/g, '')
    .trim();
}

function addUniqueTitleToken(tokens, token, existingTitle) {
  const cleaned = cleanTitleSegment(token).replace(/[、。,.].*$/, '').trim();
  if (!cleaned) return;
  if (isDisallowedSeasonMarketingText(cleaned)) return;
  if (isExcludedMercariTitleMarketingText(cleaned)) return;
  if (mercariTitleLength(cleaned) > 12) return;

  const comparable = normalizeTitleComparable(cleaned);
  if (!comparable) return;
  const titleComparable = normalizeTitleComparable(existingTitle);
  if (titleComparable.includes(comparable)) return;
  if (cleaned === 'チェック柄' && tokens.some(t => String(t).includes('チェック'))) return;
  if (tokens.some(t => normalizeTitleComparable(t) === comparable)) return;
  tokens.push(cleaned);
}

function getAiTitleKeywordList(aiData = {}) {
  const raw = aiData.title_keywords || aiData.mercari_title_keywords || [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return raw.split(/[,\n、，/／|｜]+/).map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function extractTitleAppealWords(aiData) {
  const source = [
    aiData.appeal,
    aiData.material,
    aiData.condition,
    aiData.mercari_condition,
    aiData.color,
    aiData.tag_size,
  ].filter(Boolean).join(' ');
  const baseTitle = [aiData.brand, aiData.brand_en, aiData.item].filter(Boolean).join(' ');
  const tokens = [];

  getAiTitleKeywordList(aiData).forEach(word => {
    const cleaned = cleanTitleSegment(word);
    if (/^(美品|良品|極美品)$/.test(cleaned)) {
      addUniqueTitleToken(tokens, '✨美品✨', baseTitle);
      return;
    }
    addUniqueTitleToken(tokens, cleaned, baseTitle);
  });

  if (/目立った傷や汚れ(のない|なし|無し)|未使用に近い|新品、未使用|新品|未使用|美品/.test(source)) {
    addUniqueTitleToken(tokens, '✨美品✨', baseTitle);
  }

  const patterns = [
    [/ノバチェック/i, 'ノバチェック'],
    [/ホース(ロゴ|マーク)|騎士ロゴ/i, 'ホースロゴ'],
    [/ロゴ刺繍|刺繍ロゴ/i, 'ロゴ刺繍'],
    [/ワンポイント/i, 'ワンポイント'],
    [/総柄/i, '総柄'],
    [/チェック柄|チェック/i, 'チェック柄'],
    [/ストライプ/i, 'ストライプ'],
    [/(取り外し|取外し|着脱|着脱可能).*ライナー|ライナー.*(付き|付属|取り外し|取外し|着脱)/, 'ライナー付き'],
    [/ベルト.*(付き|付属)|付属.*ベルト/, 'ベルト付き'],
    [/フード.*(付き|付属|収納|取り外し|取外し)/, 'フード付き'],
    [/裏地付き|裏地.*付き/, '裏地付き'],
    [/リバーシブル/i, 'リバーシブル'],
    [/2way|2WAY|２way|２WAY|二通り/, '2way'],
    [/3way|3WAY|３way|３WAY|三通り/, '3way'],
    [/カシミ[ヤア]/, 'カシミヤ'],
    [/ウール|毛\s*[0-9０-９]/, 'ウール'],
    [/リネン|麻/, 'リネン'],
    [/シルク|絹/, 'シルク'],
    [/レザー|本革/, 'レザー'],
    [/コーデュロイ/i, 'コーデュロイ'],
    [/ツイード/i, 'ツイード'],
    [/デニム/i, 'デニム'],
    [/綿\s*100\s*[%％]|コットン\s*100\s*[%％]/, '綿100%'],
    [/希少|なかなか出回らない/, '希少'],
    [/上質|高級感|高級/, '上質'],
    [/美シルエット|きれいなシルエット|綺麗なシルエット/, '美シルエット'],
    [/オーバーサイズ|ゆったり/, 'オーバーサイズ'],
    [/大きいサイズ|ビッグサイズ/, '大きいサイズ'],
  ];

  patterns.forEach(([pattern, word]) => {
    if (pattern.test(source)) addUniqueTitleToken(tokens, word, baseTitle);
  });

  return tokens;
}

function buildMercariTitle(aiData = {}) {
  const brand = cleanTitleSegment(aiData.brand || aiData.brand_en || '');
  const item = cleanTitleSegment(aiData.item || '');
  const appealWords = extractTitleAppealWords(aiData);
  const hasGoodCondition = appealWords.includes('✨美品✨');
  const coreParts = [hasGoodCondition ? '✨美品✨' : '', brand, item].filter(Boolean);
  const coreTitle = coreParts.join(' ').trim();
  let title = coreTitle;

  if (mercariTitleLength(title) > MAX_MERCARI_TITLE_LENGTH) {
    const titleWithoutCondition = [brand, item].filter(Boolean).join(' ').trim();
    title = mercariTitleLength(titleWithoutCondition) <= MAX_MERCARI_TITLE_LENGTH
      ? titleWithoutCondition
      : normalizeMercariTitle(titleWithoutCondition);
  }

  appealWords
    .filter(word => word !== '✨美品✨')
    .forEach(word => {
      if (!title) {
        title = normalizeMercariTitle(word);
        return;
      }
      if (normalizeTitleComparable(title).includes(normalizeTitleComparable(word))) return;
      const candidate = `${title} ${word}`.trim();
      if (mercariTitleLength(candidate) <= MAX_MERCARI_TITLE_LENGTH) {
        title = candidate;
      }
    });

  return normalizeMercariTitle(title);
}

function captureGenerationUiState_() {
  return {
    title: el('title-text').value,
    result: el('result-text').value,
    resultSectionHidden: el('result-section').hidden,
    mercariSettingsHidden: el('mercari-settings').hidden,
    mercariCondition: el('m-condition').value,
    mercariCategoryKey: getSelectedMercariCategoryKey(),
    mercariBrand: el('m-brand').value,
    mercariSize: getSelectedMercariSize(),
    mercariSizeUserEdited: el('m-size').dataset.userEdited === '1',
    finalSizeBadgeHidden: el('final-size-badge')?.hidden ?? true,
    resultMetaHidden: el('result-meta')?.hidden ?? true,
    lastAiData,
  };
}

function restoreGenerationUiState_(state) {
  if (!state) return;
  const textarea = el('result-text');
  textarea.classList.remove('streaming');
  textarea.value = state.result || '';
  el('title-text').value = normalizeMercariTitle(state.title || '');
  el('result-section').hidden = !!state.resultSectionHidden;
  el('mercari-settings').hidden = !!state.mercariSettingsHidden;
  el('m-condition').value = state.mercariCondition || '目立った傷や汚れなし';
  setSelectedMercariCategoryKey(state.mercariCategoryKey || 'unknown');
  el('m-brand').value = state.mercariBrand || '';
  el('m-size').value = state.mercariSize || '';
  el('m-size').dataset.userEdited = state.mercariSizeUserEdited ? '1' : '';
  const finalSizeBadge = el('final-size-badge');
  if (finalSizeBadge) finalSizeBadge.hidden = !!state.finalSizeBadgeHidden;
  const resultMeta = el('result-meta');
  if (resultMeta) resultMeta.hidden = !!state.resultMetaHidden;
  lastAiData = state.lastAiData || null;
  updateDraftChecklist();
}

// ----- 生成実行 -----
async function generateDescription() {
  const measurements = collectMeasurements();
  if (!measurements) { alert('カテゴリを選んでください'); return; }
  if (!uploadedImages.length) { alert('写真を選んでください'); return; }
  if (photoProcessingInProgress) {
    showStatus('status', '写真の処理が完了してからAI生成を実行してください。', 'warn');
    return;
  }
  if (descriptionGenerationInProgress) {
    showStatus('status', 'AI生成はすでに実行中です。完了するまでお待ちください。', 'warn');
    return;
  }

  descriptionGenerationInProgress = true;
  setDescriptionGenerationLock_(true);
  try {
    await saveCurrentSessionNow_();
  } catch (error) {
    console.warn('AI生成前の入力状態を端末へ保存できませんでした:', error);
  }
  const temporaryDraftId = activeTemporaryDraftId;
  let temporaryDraftGenerationToken = '';
  let temporaryDraftHeartbeatTimer = null;
  if (temporaryDraftId) {
    try {
      const claim = await claimTemporaryDraftGeneration_(
        temporaryDraftId,
        compactTemporaryDraftState_({
          ...collectState(),
          temporaryDraftId,
        }),
      );
      if (!claim.claimed) {
        await refreshTemporaryDrafts_({ recoverInterrupted: true });
        showStatus(
          'status',
          claim.reason === 'active'
            ? 'この商品は別の画面でAI生成中です。完了するまでお待ちください。'
            : '一時保存した商品が見つかりません。もう一度開き直してください。',
          'warn',
        );
        descriptionGenerationInProgress = false;
        setDescriptionGenerationLock_(false);
        return;
      }
      temporaryDraftGenerationToken = claim.token;
      await refreshTemporaryDrafts_();
      setDescriptionGenerationLock_(true);
      temporaryDraftHeartbeatTimer = window.setInterval(() => {
        touchTemporaryDraftGeneration_(temporaryDraftId, temporaryDraftGenerationToken)
          .catch(error => console.warn('AI生成中の一時保存更新に失敗:', error));
      }, TEMPORARY_DRAFT_GENERATION_HEARTBEAT_MS);
    } catch (error) {
      console.error('AI生成前の一時保存更新に失敗:', error);
      showTemporaryDraftError_(error);
      descriptionGenerationInProgress = false;
      setDescriptionGenerationLock_(false);
      return;
    }
  }

  const generationUiState = captureGenerationUiState_();
  el('generate-btn').disabled = true;
  lastAiData = null;

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
      aiData = sanitizeAiDataForSeason(parseAiJson(rawText));
    } catch (e) {
      console.error('AI応答パース失敗:', e, 'rawText:', rawText);
      showStatus('status', '⚠️ AIの応答がJSON形式でなかったため、そのまま表示しました。ブラウザのコンソールで詳細を確認できます。', 'error');
      if (temporaryDraftId) {
        await finalizeTemporaryDraftGeneration_(
          temporaryDraftId,
          temporaryDraftGenerationToken,
          { status: 'failed', errorMessage: 'AIの応答を読み取れませんでした' },
        ).then(() => refreshTemporaryDrafts_()).catch(error => {
          console.warn('一時保存の失敗状態を更新できませんでした:', error);
        });
      }
      el('generate-btn').disabled = false;
      return;
    }
    const measurementText = formatMeasurements(measurements);
    const title = buildMercariTitle(aiData);
    const description = buildDescription(aiData, measurementText, title);
    const mercariCategoryKey = coerceMercariCategoryForProductGender(
      aiData.mercari_category_key,
      measurements.category,
    );
    const mercariBrand = getPreferredMercariBrand(aiData);
    const mercariSizeResult = deriveMercariSize(aiData, mercariCategoryKey);
    textarea.value = description;
    // 商品名（タイトル）をセット
    el('title-text').value = title;
    // 下書き機能用にAIデータを保存
    lastAiData = {
      product_id: createOperationId_('product'),
      generated_at: new Date().toISOString(),
      photo_count: uploadedImages.length,
      title: title,
      description: description,
      category: measurements.category,
      product_gender: getSelectedProductGender(),
      mercari_category_key: mercariCategoryKey,
      brand: aiData.brand || '',
      brand_en: aiData.brand_en || '',
      tag_size: aiData.tag_size || '',
      title_keywords: getAiTitleKeywordList(aiData),
      mercari_brand: mercariBrand,
      mercari_size: mercariSizeResult.value,
      measurements: measurements,
      images: uploadedImages,
    };
    renderResultMetadata_(lastAiData);
    renderFinalSize(aiData);
    // メルカリ設定をAIデータで自動入力
    el('mercari-settings').hidden = false;
    if (aiData.mercari_condition) el('m-condition').value = aiData.mercari_condition;
    setSelectedMercariCategoryKey(mercariCategoryKey);
    el('m-brand').value = mercariBrand;
    el('m-size').dataset.userEdited = '';
    el('m-size').value = mercariSizeResult.value;
    updateMercariSizeNote(mercariSizeResult);
    updateDraftChecklist();
    const inputStage = el('product-input-stage'); if (inputStage) inputStage.open = false;
    scheduleSave();
    if (temporaryDraftId) {
      try {
        const finalized = await finalizeTemporaryDraftGeneration_(
          temporaryDraftId,
          temporaryDraftGenerationToken,
          {
            status: 'generated',
            snapshot: compactTemporaryDraftState_({
              ...collectState(),
              temporaryDraftId,
            }),
          },
        );
        await refreshTemporaryDrafts_();
        if (finalized) {
          hideStatus('status');
        } else {
          showStatus('status', '説明文は生成できましたが、別の画面で同じ商品が更新されたため一時保存一覧には反映していません。', 'warn');
        }
      } catch (error) {
        console.error('生成結果の一時保存更新に失敗:', error);
        showStatus('status', '説明文は生成できましたが、一時保存一覧の更新に失敗しました。現在の画面は消さずに残しています。', 'warn');
      }
    } else {
      hideStatus('status');
    }
  } catch (err) {
    restoreGenerationUiState_(generationUiState);
    console.error(err);
    showStatus('status', '❌ 生成失敗: ' + err.message, 'error');
    if (temporaryDraftId) {
      await finalizeTemporaryDraftGeneration_(
        temporaryDraftId,
        temporaryDraftGenerationToken,
        { status: 'failed', errorMessage: err.message },
      ).then(() => refreshTemporaryDrafts_()).catch(error => {
        console.warn('一時保存の失敗状態を更新できませんでした:', error);
      });
    }
  } finally {
    if (temporaryDraftHeartbeatTimer) window.clearInterval(temporaryDraftHeartbeatTimer);
    descriptionGenerationInProgress = false;
    setDescriptionGenerationLock_(false);
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
    let rejectedBecauseBlocked = false;
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        d.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(DB_TEMPORARY_DRAFT_STORE)) {
        d.createObjectStore(DB_TEMPORARY_DRAFT_STORE, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(DB_TEMPORARY_DRAFT_SUMMARY_STORE)) {
        d.createObjectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      db.onversionchange = () => db.close();
      if (rejectedBecauseBlocked) {
        db.close();
        return;
      }
      resolve(db);
    };
    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => {
      rejectedBecauseBlocked = true;
      reject(new Error('別の画面で古いアプリが開いています。ほかのメルカリアプリ画面を閉じて、もう一度お試しください。'));
    };
  });
}

async function saveSession(state) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ id: 'current', ...state, _savedAt: Date.now() });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('入力内容の自動保存が中断されました'));
    };
  });
}

async function loadSession() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('current');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('入力内容の復元が中断されました'));
    };
  });
}

async function clearSessionDb() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete('current');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('入力内容のリセットが中断されました'));
    };
  });
}

function compactTemporaryDraftPhoto_(photo = {}) {
  const mediaType = String(photo.mediaType || 'image/jpeg');
  const dataUrlBase64 = String(photo.dataUrl || '').split(',')[1] || '';
  const base64 = String(photo.base64 || dataUrlBase64 || photo.base64HQ || '');
  const base64HQ = String(photo.base64HQ || '');
  return {
    mediaType,
    base64,
    base64HQ: base64HQ && base64HQ !== base64 ? base64HQ : '',
    thumbnailBase64: String(photo.thumbnailBase64 || ''),
    adjust: photo.adjust || { brightness: 0, temp: 0, contrast: 0 },
  };
}

function hydrateTemporaryDraftPhoto_(photo = {}) {
  if (photo.dataUrl) {
    return {
      ...photo,
      base64: photo.base64 || String(photo.dataUrl).split(',')[1] || '',
      base64HQ: photo.base64HQ || photo.base64 || String(photo.dataUrl).split(',')[1] || '',
      thumbnailBase64: photo.thumbnailBase64 || '',
      originalDataUrl: photo.originalDataUrl || photo.dataUrl,
      adjust: photo.adjust || { brightness: 0, temp: 0, contrast: 0 },
    };
  }
  const mediaType = String(photo.mediaType || 'image/jpeg');
  const base64 = String(photo.base64 || photo.base64HQ || '');
  const base64HQ = String(photo.base64HQ || base64);
  const dataUrl = base64 ? `data:${mediaType};base64,${base64}` : '';
  return {
    mediaType,
    base64,
    base64HQ,
    thumbnailBase64: String(photo.thumbnailBase64 || ''),
    dataUrl,
    originalDataUrl: dataUrl,
    adjust: photo.adjust || { brightness: 0, temp: 0, contrast: 0 },
  };
}

function compactTemporaryDraftState_(state = {}) {
  return {
    ...state,
    photos: Array.isArray(state.photos)
      ? state.photos.map(compactTemporaryDraftPhoto_)
      : [],
  };
}

function hydrateTemporaryDraftState_(state = {}) {
  return {
    ...state,
    photos: Array.isArray(state.photos)
      ? state.photos.map(hydrateTemporaryDraftPhoto_)
      : [],
  };
}

function safeTemporaryThumbnailBase64_(value) {
  const base64 = String(value || '');
  return base64 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64) ? base64 : '';
}

function temporaryDraftSummaryFromRecord_(record = {}) {
  const snapshot = record.snapshot || {};
  const photos = Array.isArray(snapshot.photos) ? snapshot.photos : [];
  const firstPhoto = photos[0] || {};
  const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(firstPhoto.mediaType)
    ? firstPhoto.mediaType
    : 'image/jpeg';
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    errorMessage: String(record.errorMessage || ''),
    displayName: temporaryDraftDisplayName_(record),
    photoCount: photos.length,
    measurementCount: temporaryDraftMeasurementCount_(snapshot),
    category: snapshot.category || '',
    canGenerate: photos.length > 0 && !!snapshot.category,
    thumbnailMediaType: mediaType,
    thumbnailBase64: safeTemporaryThumbnailBase64_(
      firstPhoto.thumbnailBase64 || firstPhoto.base64 || firstPhoto.base64HQ || ''
    ),
  };
}

async function putTemporaryDraft_(record, expectedUpdatedAt = null) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [DB_TEMPORARY_DRAFT_STORE, DB_TEMPORARY_DRAFT_SUMMARY_STORE],
      'readwrite'
    );
    const store = tx.objectStore(DB_TEMPORARY_DRAFT_STORE);
    const request = store.get(record.id);
    let result = { saved: false, reason: 'conflict', record: null };
    request.onsuccess = () => {
      const current = request.result;
      if (expectedUpdatedAt !== null
          && (!current || Number(current.updatedAt || 0) !== Number(expectedUpdatedAt))) {
        return;
      }
      if (current?.status === 'generating'
          && Number(current.updatedAt || 0) > Date.now() - TEMPORARY_DRAFT_GENERATION_STALE_MS) {
        result = { saved: false, reason: 'active', record: current };
        return;
      }
      const next = {
        ...record,
        createdAt: current?.createdAt || record.createdAt,
      };
      store.put(next);
      tx.objectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE).put(temporaryDraftSummaryFromRecord_(next));
      result = { saved: true, reason: '', record: next };
    };
    request.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('一時保存が中断されました'));
    };
  });
}

async function claimTemporaryDraftGeneration_(id, snapshot) {
  const db = await openDb();
  const token = createOperationId_('draft-generation');
  const now = Date.now();
  const cutoff = now - TEMPORARY_DRAFT_GENERATION_STALE_MS;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [DB_TEMPORARY_DRAFT_STORE, DB_TEMPORARY_DRAFT_SUMMARY_STORE],
      'readwrite'
    );
    const store = tx.objectStore(DB_TEMPORARY_DRAFT_STORE);
    const request = store.get(id);
    let result = { claimed: false, token: '', reason: 'missing' };
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      if (current.status === 'generating' && Number(current.updatedAt || 0) > cutoff) {
        result = { claimed: false, token: '', reason: 'active' };
        return;
      }
      const next = {
        ...current,
        updatedAt: now,
        status: 'generating',
        errorMessage: '',
        generationToken: token,
        generationStartedAt: now,
        snapshot,
      };
      store.put(next);
      tx.objectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE).put(temporaryDraftSummaryFromRecord_(next));
      result = { claimed: true, token, reason: '', record: next };
    };
    request.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('AI生成の開始状態を保存できませんでした'));
    };
  });
}

async function touchTemporaryDraftGeneration_(id, token) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [DB_TEMPORARY_DRAFT_STORE, DB_TEMPORARY_DRAFT_SUMMARY_STORE],
      'readwrite'
    );
    const store = tx.objectStore(DB_TEMPORARY_DRAFT_STORE);
    const request = store.get(id);
    let touched = false;
    request.onsuccess = () => {
      const current = request.result;
      if (!current
          || current.status !== 'generating'
          || current.generationToken !== token) {
        return;
      }
      const next = { ...current, updatedAt: Date.now() };
      store.put(next);
      tx.objectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE).put(temporaryDraftSummaryFromRecord_(next));
      touched = true;
    };
    request.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => {
      db.close();
      resolve(touched);
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('AI生成中の状態を更新できませんでした'));
    };
  });
}

async function finalizeTemporaryDraftGeneration_(id, token, {
  status,
  errorMessage = '',
  snapshot = null,
} = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [DB_TEMPORARY_DRAFT_STORE, DB_TEMPORARY_DRAFT_SUMMARY_STORE],
      'readwrite'
    );
    const store = tx.objectStore(DB_TEMPORARY_DRAFT_STORE);
    const request = store.get(id);
    let finalized = false;
    request.onsuccess = () => {
      const current = request.result;
      if (!current
          || current.status !== 'generating'
          || current.generationToken !== token) {
        return;
      }
      const next = {
        ...current,
        updatedAt: Date.now(),
        status,
        errorMessage: String(errorMessage || ''),
        generationToken: '',
        generationStartedAt: 0,
        snapshot: snapshot || current.snapshot,
      };
      store.put(next);
      tx.objectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE).put(temporaryDraftSummaryFromRecord_(next));
      finalized = true;
    };
    request.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => {
      db.close();
      resolve(finalized);
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('AI生成結果を一時保存へ反映できませんでした'));
    };
  });
}

async function getTemporaryDraft_(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TEMPORARY_DRAFT_STORE, 'readonly');
    const req = tx.objectStore(DB_TEMPORARY_DRAFT_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('一時保存を読み込めませんでした'));
    };
  });
}

async function listTemporaryDrafts_() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TEMPORARY_DRAFT_SUMMARY_STORE, 'readonly');
    const req = tx.objectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE).getAll();
    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? req.result : [];
      resolve(rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
    };
    req.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('一時保存一覧を読み込めませんでした'));
    };
  });
}

async function deleteTemporaryDraft_(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [DB_TEMPORARY_DRAFT_STORE, DB_TEMPORARY_DRAFT_SUMMARY_STORE],
      'readwrite'
    );
    const store = tx.objectStore(DB_TEMPORARY_DRAFT_STORE);
    const request = store.get(id);
    let deleted = false;
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      if (current.status === 'generating'
          && Number(current.updatedAt || 0) > Date.now() - TEMPORARY_DRAFT_GENERATION_STALE_MS) {
        return;
      }
      store.delete(id);
      tx.objectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE).delete(id);
      deleted = true;
    };
    request.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => {
      db.close();
      resolve(deleted);
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('一時保存を削除できませんでした'));
    };
  });
}

async function recoverInterruptedTemporaryDraft_(id, cutoff) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [DB_TEMPORARY_DRAFT_STORE, DB_TEMPORARY_DRAFT_SUMMARY_STORE],
      'readwrite'
    );
    const store = tx.objectStore(DB_TEMPORARY_DRAFT_STORE);
    const request = store.get(id);
    let recovered = false;
    request.onsuccess = () => {
      const current = request.result;
      if (!current
          || current.status !== 'generating'
          || Number(current.updatedAt || 0) > cutoff) {
        return;
      }
      const next = {
        ...current,
        status: 'failed',
        errorMessage: '前回のAI生成が途中で止まりました。もう一度実行できます。',
        generationToken: '',
        generationStartedAt: 0,
        updatedAt: Date.now(),
      };
      store.put(next);
      tx.objectStore(DB_TEMPORARY_DRAFT_SUMMARY_STORE).put(temporaryDraftSummaryFromRecord_(next));
      recovered = true;
    };
    request.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => {
      db.close();
      resolve(recovered);
    };
    tx.onerror = (e) => {
      db.close();
      reject(e.target.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('中断したAI生成の状態を確認できませんでした'));
    };
  });
}

function temporaryDraftMeasurementCount_(snapshot = {}) {
  return Object.values(snapshot.measurements || {})
    .filter(value => String(value ?? '').trim() !== '')
    .length;
}

function temporaryDraftDisplayName_(record = {}) {
  if (record.displayName) return String(record.displayName);
  const snapshot = record.snapshot || {};
  const title = normalizeMercariTitle(snapshot.title || snapshot.lastAiData?.title || '');
  if (title) return title;
  const gender = PRODUCT_GENDER_LABELS[normalizeProductGender(snapshot.productGender)] || '';
  const category = CATEGORY_JP[snapshot.category] || 'カテゴリ未選択';
  return `${gender} ${category}`.trim();
}

function formatTemporaryDraftDate_(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) return '保存日時不明';
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function renderTemporaryDrafts_() {
  const list = el('temporary-draft-list');
  const count = el('temporary-draft-count');
  const summary = el('temporary-draft-summary');
  if (!list || !count || !summary) return;
  count.textContent = `${temporaryDrafts.length}件`;
  summary.textContent = temporaryDrafts.length
    ? `${temporaryDrafts.length}商品を端末内に保存しています`
    : '写真と採寸を保存して、次の商品へ進めます';

  if (!temporaryDrafts.length) {
    list.innerHTML = '<div class="temporary-draft-empty">一時保存した商品はまだありません</div>';
    return;
  }

  list.innerHTML = temporaryDrafts.map(record => {
    const photoBase64 = safeTemporaryThumbnailBase64_(record.thumbnailBase64);
    const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(record.thumbnailMediaType)
      ? record.thumbnailMediaType
      : 'image/jpeg';
    const imageMarkup = photoBase64
      ? `<img src="data:${escapeHtml(mediaType)};base64,${photoBase64}" alt="">`
      : '<span class="temporary-draft-thumb-empty">写真なし</span>';
    const status = TEMPORARY_DRAFT_STATUS[record.status] || TEMPORARY_DRAFT_STATUS.saved;
    const photoCount = Number(record.photoCount || 0);
    const measurementCount = Number(record.measurementCount || 0);
    const canGenerate = !!record.canGenerate;
    const generated = record.status === 'generated';
    const active = record.id === activeTemporaryDraftId;
    const errorMarkup = record.errorMessage
      ? `<p class="temporary-draft-error">${escapeHtml(record.errorMessage)}</p>`
      : '';
    return `
      <article class="temporary-draft-card ${status.className} ${active ? 'active' : ''}" data-temporary-draft-id="${escapeHtml(record.id)}">
        <div class="temporary-draft-thumb">
          ${imageMarkup}
          <span class="temporary-draft-badge ${status.className}">${escapeHtml(status.label)}</span>
        </div>
        <div class="temporary-draft-card-body">
          <h3>${escapeHtml(temporaryDraftDisplayName_(record))}</h3>
          <p>${photoCount}枚・採寸${measurementCount}項目・${escapeHtml(formatTemporaryDraftDate_(record.updatedAt))}</p>
          ${errorMarkup}
          <div class="temporary-draft-actions">
            <button class="btn small" type="button" data-temporary-action="open" ${active ? 'disabled' : ''}>${active ? '編集中' : (generated ? '結果を開く' : '編集')}</button>
            ${generated ? '' : `<button class="btn small temporary-generate-btn" type="button" data-temporary-action="generate" ${canGenerate ? '' : 'disabled'}>AI生成</button>`}
            <button class="btn small temporary-delete-btn" type="button" data-temporary-action="delete" aria-label="${escapeHtml(temporaryDraftDisplayName_(record))}を削除">削除</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function refreshTemporaryDrafts_({ recoverInterrupted = false } = {}) {
  let rows = await listTemporaryDrafts_();
  if (recoverInterrupted) {
    const cutoff = Date.now() - TEMPORARY_DRAFT_GENERATION_STALE_MS;
    const interrupted = rows.filter(row =>
      row.status === 'generating' && Number(row.updatedAt || 0) <= cutoff
    );
    let recoveredAny = false;
    for (const row of interrupted) {
      recoveredAny = await recoverInterruptedTemporaryDraft_(row.id, cutoff) || recoveredAny;
    }
    if (recoveredAny) rows = await listTemporaryDrafts_();
  }
  temporaryDrafts = rows;
  if (activeTemporaryDraftId && !rows.some(row => row.id === activeTemporaryDraftId)) {
    activeTemporaryDraftId = null;
  }
  renderTemporaryDrafts_();
  updateTemporarySaveButton_();
  return rows;
}

function showTemporaryDraftError_(error) {
  const message = error?.name === 'QuotaExceededError'
    ? '一時保存できませんでした。端末の保存容量が不足しています。不要な一時保存を削除してください。現在の写真と採寸は消していません。'
    : `一時保存できませんでした。${error?.message || '現在の写真と採寸は消していません。'}`;
  showStatus('temporary-draft-status', message, 'error');
}

function hasMeaningfulCurrentInput_() {
  if (uploadedImages.length || el('category')?.value) return true;
  if (el('title-text')?.value.trim() || el('result-text')?.value.trim() || el('price-input')?.value) return true;
  return [...document.querySelectorAll('#measurement-fields input[type="number"]')]
    .some(input => String(input.value || '').trim() !== '');
}

function inferTemporaryDraftStatus_(state = {}) {
  if (String(state.title || '').trim() && String(state.result || '').trim()) return 'generated';
  if ((state.photos || []).length && state.category) return 'saved';
  return 'incomplete';
}

async function requestPersistentStorage_() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch (error) {
    console.warn('永続ストレージ要求に失敗:', error);
    return false;
  }
}

async function saveCurrentAsTemporaryDraft_({
  resetAfter = true,
  allowIncomplete = false,
  announce = true,
} = {}) {
  if (photoProcessingInProgress) {
    showStatus('temporary-draft-status', '写真の処理が完了してから一時保存してください。', 'warn');
    return null;
  }
  if (descriptionGenerationInProgress) {
    showStatus('temporary-draft-status', 'AI生成中は商品を切り替えられません。生成完了後に一時保存してください。', 'warn');
    return null;
  }
  if (!hasMeaningfulCurrentInput_()) return null;
  if (!allowIncomplete && !hasTemporarySaveMinimum_()) {
    showStatus('temporary-draft-status', '写真を1枚以上追加し、カテゴリを選択してください。', 'error');
    return null;
  }

  await requestPersistentStorage_();
  const now = Date.now();
  let existing = activeTemporaryDraftId
    ? await getTemporaryDraft_(activeTemporaryDraftId)
    : null;
  if (existing?.status === 'generating') {
    const recovered = await recoverInterruptedTemporaryDraft_(
      existing.id,
      now - TEMPORARY_DRAFT_GENERATION_STALE_MS,
    );
    if (!recovered) {
      await refreshTemporaryDrafts_();
      showStatus('temporary-draft-status', 'この商品は別の画面でAI生成中です。完了するまでお待ちください。', 'warn');
      return null;
    }
    existing = await getTemporaryDraft_(existing.id);
  }
  const id = activeTemporaryDraftId || createOperationId_('input-draft');
  const state = {
    ...collectState(),
    temporaryDraftId: id,
  };
  const record = {
    id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    status: inferTemporaryDraftStatus_(state),
    errorMessage: '',
    snapshot: compactTemporaryDraftState_(state),
  };

  const putResult = await putTemporaryDraft_(record, existing?.updatedAt ?? null);
  if (!putResult.saved) {
    await refreshTemporaryDrafts_();
    showStatus(
      'temporary-draft-status',
      putResult.reason === 'active'
        ? '別の画面でAI生成が始まったため、一時保存は上書きしませんでした。現在の写真と採寸はこの画面に残しています。'
        : '別の画面で同じ商品が更新されたため、一時保存は上書きしませんでした。現在の写真と採寸はこの画面に残しています。',
      'warn',
    );
    return null;
  }
  activeTemporaryDraftId = id;
  await refreshTemporaryDrafts_();

  if (resetAfter) {
    await clearCurrentProduct_({ clearSession: true, scroll: true });
    renderTemporaryDrafts_();
    const tray = el('temporary-draft-stage');
    if (tray) tray.open = false;
  } else {
    scheduleSave();
  }

  if (announce) {
    showStatus(
      'temporary-draft-status',
      resetAfter
        ? '一時保存しました。続けて次の商品の写真と採寸を入力できます。'
        : '現在の入力も一時保存しました。',
      'success',
    );
  }
  return record;
}

async function openTemporaryDraft_(id) {
  if (photoProcessingInProgress) {
    throw new Error('写真を処理中のため、商品を切り替えられません');
  }
  const record = await getTemporaryDraft_(id);
  if (!record) throw new Error('選択した一時保存が見つかりません');
  await clearCurrentProduct_({ clearSession: true, scroll: false });
  activeTemporaryDraftId = id;
  restoreState(hydrateTemporaryDraftState_({
    ...(record.snapshot || {}),
    temporaryDraftId: id,
  }));
  const inputStage = el('product-input-stage');
  if (inputStage) inputStage.open = record.status !== 'generated';
  scheduleSave();
  renderTemporaryDrafts_();
  const tray = el('temporary-draft-stage');
  if (tray) tray.open = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return record;
}

async function handleTemporaryDraftAction_(event) {
  const button = event.target.closest('[data-temporary-action]');
  if (!button) return;
  if (photoProcessingInProgress) {
    showStatus('temporary-draft-status', '写真の処理が完了してから商品を切り替えてください。', 'warn');
    return;
  }
  if (descriptionGenerationInProgress) {
    showStatus('temporary-draft-status', 'AI生成中は商品を切り替えられません。完了後に操作してください。', 'warn');
    return;
  }
  const card = button.closest('[data-temporary-draft-id]');
  const id = card?.dataset.temporaryDraftId;
  const action = button.dataset.temporaryAction;
  if (!id || !action) return;
  button.disabled = true;

  try {
    let record = await getTemporaryDraft_(id);
    if (!record) throw new Error('選択した一時保存が見つかりません');
    if (record.status === 'generating') {
      const recovered = await recoverInterruptedTemporaryDraft_(
        id,
        Date.now() - TEMPORARY_DRAFT_GENERATION_STALE_MS,
      );
      await refreshTemporaryDrafts_();
      if (!recovered) {
        showStatus('temporary-draft-status', 'この商品は別の画面でAI生成中です。完了するまでお待ちください。', 'warn');
        return;
      }
      record = await getTemporaryDraft_(id);
      if (!record) throw new Error('選択した一時保存が見つかりません');
      showStatus('temporary-draft-status', '途中で止まったAI生成を解除しました。もう一度実行できます。', 'warn');
    }

    if (action === 'delete') {
      if (!confirm(`「${temporaryDraftDisplayName_(record)}」を一時保存から削除しますか？`)) return;
      const deleted = await deleteTemporaryDraft_(id);
      if (!deleted) {
        await refreshTemporaryDrafts_();
        showStatus('temporary-draft-status', '別の画面でAI生成が始まったため、この商品は削除しませんでした。', 'warn');
        return;
      }
      if (activeTemporaryDraftId === id) {
        activeTemporaryDraftId = null;
        scheduleSave();
      }
      await refreshTemporaryDrafts_();
      showStatus('temporary-draft-status', '選択した一時保存を削除しました。', 'success');
      return;
    }

    if (activeTemporaryDraftId === id) {
      if (action === 'generate') {
        await generateDescription();
      } else {
        showStatus('temporary-draft-status', 'この商品は現在編集中です。入力内容はそのまま残しています。', 'success');
      }
      return;
    }

    if (hasMeaningfulCurrentInput_() && activeTemporaryDraftId !== id) {
      const saved = await saveCurrentAsTemporaryDraft_({
        resetAfter: false,
        allowIncomplete: true,
        announce: false,
      });
      if (!saved) throw new Error('現在の入力を一時保存できませんでした');
    }

    await openTemporaryDraft_(id);
    if (action === 'generate') {
      await generateDescription();
    } else {
      showStatus('temporary-draft-status', '一時保存した商品を開きました。編集を続けられます。', 'success');
    }
  } catch (error) {
    console.error('一時保存操作に失敗:', error);
    showTemporaryDraftError_(error);
  } finally {
    button.disabled = false;
  }
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
    productGender: getSelectedProductGender(),
    raglanChecked: raglanToggle ? raglanToggle.checked : false,
    measurements,
    title: normalizeMercariTitle(el('title-text').value),
    result: el('result-text').value,
    resultVisible: !el('result-section').hidden,
    mercariSettingsVisible: !el('mercari-settings').hidden,
    mercariCondition: el('m-condition').value,
    mercariCategoryKey: getSelectedMercariCategoryKey(),
    mercariBrand: el('m-brand').value,
    mercariSize: getSelectedMercariSize(),
    mercariSizeUserEdited: el('m-size').dataset.userEdited === '1',
    price: el('price-input').value,
    temporaryDraftId: activeTemporaryDraftId,
    lastAiData: lastAiData ? {
      ...lastAiData,
      images: undefined,
      description: el('result-text').value,
      title: normalizeMercariTitle(el('title-text').value),
    } : null,
  };
}

let _saveTimer = null;
let _sessionWriteChain = Promise.resolve();
async function saveCurrentSessionNow_() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  const state = collectState();
  _sessionWriteChain = _sessionWriteChain
    .catch(() => {})
    .then(() => saveSession(state));
  await _sessionWriteChain;
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const state = collectState();
    _sessionWriteChain = _sessionWriteChain
      .catch(() => {})
      .then(() => saveSession(state));
    _sessionWriteChain.catch(e => console.warn('保存失敗:', e));
  }, 400);
}

function restoreState(s) {
  if (!s) return;
  activeTemporaryDraftId = s.temporaryDraftId || null;
  setSelectedProductGender(s.productGender || localStorage.getItem(PRODUCT_GENDER_STORAGE_KEY));
  if (Array.isArray(s.photos) && s.photos.length) {
    uploadedImages = s.photos.map(hydrateTemporaryDraftPhoto_);
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
  if (s.title) el('title-text').value = normalizeMercariTitle(s.title);
  if (s.result) el('result-text').value = s.result;
  if (s.resultVisible && s.result) {
    el('result-section').hidden = false;
  }
  if (s.price) el('price-input').value = s.price;
  if (s.lastAiData || (s.result && s.title)) {
    lastAiData = {
      ...(s.lastAiData || {}),
      title: normalizeMercariTitle(s.title || s.lastAiData?.title || ''),
      description: s.result || s.lastAiData?.description || '',
      category: s.lastAiData?.category || s.category || '',
      product_gender: s.lastAiData?.product_gender || s.productGender || getSelectedProductGender(),
      measurements: s.lastAiData?.measurements || s.measurements || {},
      images: uploadedImages,
    };
    renderResultMetadata_(lastAiData);
  }
  // メルカリ設定の復元
  if (s.mercariSettingsVisible) {
    el('mercari-settings').hidden = false;
    if (s.mercariCondition) el('m-condition').value = s.mercariCondition;
    if (s.mercariCategoryKey) setSelectedMercariCategoryKey(s.mercariCategoryKey);
    if (s.mercariBrand) el('m-brand').value = s.mercariBrand;
    if (s.mercariSize) el('m-size').value = s.mercariSize;
    el('m-size').dataset.userEdited = s.mercariSizeUserEdited ? '1' : '';
    updateMercariSizeNote({ note: s.mercariSize ? `保存済み: ${s.mercariSize}` : 'サイズなし、または手動で選んでください' });
  }
  updateGenerateButton();
  updatePhotoSummary();
  updateDraftChecklist();
  renderTemporaryDrafts_();
}

// ----- メインタブ / 相場リサーチ -----
function switchMainTab(tab) {
  const description = tab === 'description';
  const research = tab === 'research';
  const markdown = tab === 'markdown';
  el('description-panel').hidden = !description;
  el('research-panel').hidden = !research;
  el('markdown-panel').hidden = !markdown;
  el('description-panel').classList.toggle('active', description);
  el('research-panel').classList.toggle('active', research);
  el('markdown-panel').classList.toggle('active', markdown);
  el('description-tab-btn').classList.toggle('active', description);
  el('research-tab-btn').classList.toggle('active', research);
  el('markdown-tab-btn').classList.toggle('active', markdown);
  el('description-tab-btn').setAttribute('aria-selected', String(description));
  el('research-tab-btn').setAttribute('aria-selected', String(research));
  el('markdown-tab-btn').setAttribute('aria-selected', String(markdown));
}

function normalizeResearchWizardStep(value) {
  const step = Number(value);
  return Number.isInteger(step) && RESEARCH_WIZARD_STEPS[step] ? step : 1;
}

function isResearchPriceRangeValid(minPrice, maxPrice) {
  const min = Number(minPrice || 0);
  const max = Number(maxPrice || 0);
  return !min || !max || min <= max;
}

function validateResearchWizardStep(step) {
  if (step === 1 && !hasResearchSearchAxis(collectResearchForm())) {
    alert('カテゴリー、ブランド、検索キーワードのいずれかを指定してください');
    return false;
  }
  if (step === 2 && !isResearchPriceRangeValid(
    el('research-min-price')?.value,
    el('research-max-price')?.value
  )) {
    alert('最低価格は最高価格以下にしてください');
    return false;
  }
  return true;
}

function canMoveToResearchWizardStep(targetStep) {
  const target = normalizeResearchWizardStep(targetStep);
  if (target <= researchWizardStep) return true;
  for (let step = researchWizardStep; step < target; step += 1) {
    if (!validateResearchWizardStep(step)) return false;
  }
  return true;
}

function setResearchWizardStep(value, { scroll = true } = {}) {
  const step = normalizeResearchWizardStep(value);
  researchWizardStep = step;
  document.querySelectorAll('[data-research-step-panel]').forEach(panel => {
    const selected = Number(panel.dataset.researchStepPanel) === step;
    panel.hidden = !selected;
    panel.classList.toggle('active', selected);
  });
  document.querySelectorAll('#research-wizard-progress [data-research-step]').forEach(button => {
    const selected = Number(button.dataset.researchStep) === step;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  const heading = el('research-wizard-heading');
  const count = el('research-wizard-count');
  if (heading) heading.textContent = RESEARCH_WIZARD_STEPS[step];
  if (count) count.textContent = `${step}/3`;
  if (scroll) {
    el('research-wizard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function handleResearchWizardAction(event) {
  const button = event.target.closest?.('[data-research-wizard-action]');
  if (!button) return;
  const action = button.dataset.researchWizardAction;
  if (action === 'show-saved') {
    el('research-saved-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const nextStep = normalizeResearchWizardStep(button.dataset.researchStep);
  if ((action === 'next' || action === 'goto') && !canMoveToResearchWizardStep(nextStep)) return;
  if (action === 'next' || action === 'back' || action === 'goto') {
    setResearchWizardStep(nextStep);
  }
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
  const reviewNode = el('research-review-summary');
  if (!node && !reviewNode) return;
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
  const categoryLabel = getSelectedOptionLabel('research-category');
  const quickValues = [
    request.brand,
    categoryLabel,
    request.saleStatus,
  ];
  const quickDescription = request.saleStatus === '販売中'
    ? '上記の条件で、現在の販売価格を調べます。'
    : request.saleStatus === '売り切れ'
      ? '上記の条件で、直近の売り切れ情報を調べます。'
      : '上記の条件で、販売中・売り切れ情報を調べます。';
  if (node) node.innerHTML = `
    <span>現在の条件</span>
    ${renderResearchChipRow(quickValues)}
    <small>${escapeHtml(condition ? quickDescription : '検索条件を入力してください')}</small>
  `;
  if (reviewNode) reviewNode.innerHTML = `
    <span>調査する条件</span>
    <strong>${escapeHtml(condition || '検索条件を入力してください')}</strong>
    ${renderResearchChipRow([
      categoryLabel,
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
  if (!validateResearchWizardStep(1)) {
    setResearchWizardStep(1);
    return;
  }
  if (!validateResearchWizardStep(2)) {
    setResearchWizardStep(2);
    return;
  }
  const request = collectResearchForm();
  const list = readJsonList(RESEARCH_REQUESTS_KEY);
  list.unshift(request);
  writeJsonList(RESEARCH_REQUESTS_KEY, list.slice(0, 50));
  clearResearchForm(false);
  setResearchWizardStep(1, { scroll: false });
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
  let waitControl = null;
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
    waitControl = attachJobWaitCancel_(el('research-sync-status'));
    await pollMacJob(tunnelUrl, data.job_id, {
      intervalMs: 10000,
      timeoutMs: 20 * 60 * 1000,
      onStatus: statusData => setResearchStatus(statusData.message || '処理中...'),
      signal: waitControl.signal,
    });
    await refreshResearchResultsFromMac({ silent: true });
    setResearchStatus('相場リサーチが完了しました。結果メモを更新しました。', 'success');
  } catch (e) {
    console.warn(e);
    setResearchStatus(`リサーチ実行に失敗しました: ${e.message}`, 'warn');
  } finally {
    waitControl?.cleanup();
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

// ----- 100円値下げ -----
function setMarkdownStatus(message, kind = '') {
  const node = el('markdown-status');
  if (!node) return;
  node.hidden = !message;
  node.className = 'status ' + kind;
  node.textContent = message || '';
}

function normalizeMarkdownItemId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.includes('/item/')) {
    return text.split('/item/')[1].split(/[?#/]/)[0];
  }
  return text;
}

function markdownFloor(row) {
  const minPrice = Number(row.minPrice || 0);
  return Math.max(300, minPrice);
}

function markdownNextPrice(row) {
  return Math.max(0, Number(row.currentPrice || 0) - 100);
}

function markdownCanEnable(row) {
  return Number(row.minPrice || 0) >= 300 && markdownNextPrice(row) >= markdownFloor(row);
}

function markdownIsActive(row) {
  return Boolean(row.autoEnabled) && markdownCanEnable(row);
}

function markdownAtFloor(row) {
  const current = Number(row.currentPrice || 0);
  if (!current || Number(row.minPrice || 0) < 300) return false;
  return current <= markdownFloor(row) || markdownNextPrice(row) < markdownFloor(row);
}

function markdownRecommendation(row) {
  const currentPrice = Number(row?.currentPrice || 0);
  const raw = row?.recommendation && typeof row.recommendation === 'object'
    ? row.recommendation
    : null;
  const type = raw && MARKDOWN_RECOMMENDATION_META[raw.type] ? raw.type : 'collecting';
  const meta = MARKDOWN_RECOMMENDATION_META[type];
  const suggestedPrice = Number.isFinite(Number(raw?.suggestedPrice))
    ? Number(raw.suggestedPrice)
    : currentPrice;
  const reasons = Array.isArray(raw?.reasons) && raw.reasons.length
    ? raw.reasons.map(value => String(value))
    : [row?.reactionError
        ? 'いいね数の取得に失敗したため、次回の21時取得を待ちます'
        : 'いいね履歴を取得すると判定を開始します'];
  const warnings = Array.isArray(raw?.warnings)
    ? raw.warnings
      .filter(warning => warning?.code !== 'BELOW_MIN_PRICE')
      .map(warning => String(warning?.message || ''))
      .filter(Boolean)
    : [];
  const minPrice = Number(row?.minPrice || 0);
  if (minPrice >= 300 && suggestedPrice < minPrice) {
    warnings.push(`設定下限${formatYen(minPrice)}を${formatYen(minPrice - suggestedPrice)}下回る案です。利益を確認してください`);
  }
  return {
    type,
    meta,
    suggestedPrice,
    reasons,
    warnings,
    displayOnly: raw?.displayOnly !== false,
  };
}

function markdownLikeMetrics(row) {
  const raw = row?.likeMetrics && typeof row.likeMetrics === 'object' ? row.likeMetrics : {};
  const numberOrNull = value => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    total: numberOrNull(raw.total ?? row?.likeCount),
    delta24h: numberOrNull(raw.delta24h),
    delta72h: numberOrNull(raw.delta72h),
    delta7d: numberOrNull(raw.delta7d),
    observedDays: Math.max(0, Number(raw.observedDays || 0)),
    lastIncreaseObservedAt: String(raw.lastIncreaseObservedAt || row?.lastLikeAt || ''),
  };
}

function formatMarkdownLikeDelta(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `+${Math.max(0, Number(value))}`;
}

function mergeMarkdownRows(listings, settings) {
  const saved = new Map(markdownRows.map(row => [normalizeMarkdownItemId(row.itemId || row.url), row]));
  const settingMap = new Map((settings || []).map(row => [normalizeMarkdownItemId(row.itemId || row.url), row]));
  return (listings || []).map(item => {
    const itemId = normalizeMarkdownItemId(item.itemId || item.url);
    const old = saved.get(itemId) || {};
    const setting = settingMap.get(itemId) || {};
    const settingHasMinPrice = Object.prototype.hasOwnProperty.call(setting, 'minPrice');
    const itemHasMinPrice = Object.prototype.hasOwnProperty.call(item, 'minPrice');
    const settingHasAuto = Object.prototype.hasOwnProperty.call(setting, 'autoEnabled');
    const itemHasAuto = Object.prototype.hasOwnProperty.call(item, 'autoEnabled');
    return {
      ...old,
      ...setting,
      ...item,
      itemId,
      imageUrl: markdownImageUrl(item) || markdownImageUrl(setting) || markdownImageUrl(old),
      minPrice: Number(
        settingHasMinPrice ? setting.minPrice : (itemHasMinPrice ? item.minPrice : (old.minPrice || 0))
      ),
      autoEnabled: settingHasAuto
        ? Boolean(setting.autoEnabled)
        : (itemHasAuto ? Boolean(item.autoEnabled) : Boolean(old.autoEnabled)),
      recommendation: item?.recommendation && typeof item.recommendation === 'object'
        ? item.recommendation
        : null,
      likeMetrics: item?.likeMetrics && typeof item.likeMetrics === 'object'
        ? item.likeMetrics
        : null,
    };
  });
}

function readMarkdownFilterMode() {
  try {
    const value = localStorage.getItem(MARKDOWN_FILTER_KEY);
    if (MARKDOWN_FILTER_MODES.has(value)) return value;

    const legacySortMode = localStorage.getItem(MARKDOWN_SORT_KEY);
    const migratedMode = legacySortMode === 'enabled-first'
      ? 'enabled-only'
      : (legacySortMode === 'disabled-first' ? 'disabled-only' : 'all');
    localStorage.setItem(MARKDOWN_FILTER_KEY, migratedMode);
    return migratedMode;
  } catch {
    return 'all';
  }
}

function handleMarkdownFilterChange(event) {
  const button = event.target.closest?.('[data-markdown-filter]');
  if (!button) return;
  const value = button.dataset.markdownFilter;
  markdownFilterMode = MARKDOWN_FILTER_MODES.has(value) ? value : 'all';
  try {
    localStorage.setItem(MARKDOWN_FILTER_KEY, markdownFilterMode);
  } catch {
    // Filtering still works for this session when storage is unavailable.
  }
  renderMarkdownRows();
}

function filteredMarkdownRows(rows) {
  if (markdownFilterMode === 'enabled-only') return rows.filter(markdownIsActive);
  if (markdownFilterMode === 'disabled-only') return rows.filter(row => !markdownIsActive(row));
  return [...rows];
}

function markdownImageUrl(row) {
  const value = String(row?.imageUrl || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (host !== 'static.mercdn.net') return '';
    return url.href;
  } catch {
    return '';
  }
}

function markdownItemUrl(row) {
  const itemId = normalizeMarkdownItemId(row?.itemId || row?.url);
  const fallback = itemId ? `https://jp.mercari.com/item/${encodeURIComponent(itemId)}` : '#';
  try {
    const url = new URL(String(row?.url || fallback));
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'jp.mercari.com' ||
      !url.pathname.startsWith('/item/') ||
      url.username ||
      url.password
    ) {
      return fallback;
    }
    return url.href;
  } catch {
    return fallback;
  }
}

function persistMarkdownRows() {
  writeJsonList(MARKDOWN_ROWS_KEY, markdownRows.slice(0, 300));
}

async function loadMarkdownSnapshot({ silent = false } = {}) {
  const btn = el('markdown-load-btn');
  btn.disabled = true;
  if (!silent) setMarkdownStatus('21時に取得した最新の商品情報を読み込んでいます...');
  try {
    const tunnelUrl = await getMercariServiceUrl((message) => {
      if (!silent) setMarkdownStatus(message);
    });
    const resp = await fetchWithTimeout(`${tunnelUrl}/markdown/snapshot`, {}, 20000);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '保存済み商品の取得に失敗しました');
    markdownRows = mergeMarkdownRows(data.listings || [], data.settings || []);
    renderMarkdownOverview_(data);
    persistMarkdownRows();
    renderMarkdownRows();
    if (!silent) {
      const syncedAt = data.syncedAt ? ` / 取得: ${formatListingStyleDate(data.syncedAt)}` : '';
      setMarkdownStatus(`保存済み商品を表示しました（${markdownRows.length}件）${syncedAt}`, 'success');
    }
  } catch (e) {
    console.warn(e);
    if (!silent) setMarkdownStatus(`取得に失敗しました: ${e.message}`, 'warn');
  } finally {
    btn.disabled = false;
  }
}

function renderMarkdownOverview_(data = {}) {
  const node = el('markdown-overview');
  if (!node) return;
  const syncAt = data.syncedAt ? formatListingStyleDate(data.syncedAt) : '未取得';
  const markdownRun = data.lastMarkdown || {};
  const markdownAt = markdownRun.createdAt ? formatListingStyleDate(markdownRun.createdAt) : '未実行';
  const summary = markdownRun.summary || {};
  const resultText = markdownRun.createdAt
    ? `更新${Number(summary.updated || 0)} / 失敗${Number(summary.error || 0)}`
    : '結果なし';
  node.innerHTML = `
    <div><span>商品取得</span><strong>${escapeHtml(syncAt)}</strong></div>
    <div><span>値下げ結果</span><strong title="${escapeHtml(markdownAt)}">${escapeHtml(resultText)}</strong></div>
    <div><span>Mac接続</span><strong class="connected">接続済み</strong></div>`;
}

function collectMarkdownRowsFromDom() {
  const next = markdownRows.map(row => ({ ...row }));
  next.forEach(row => {
    const id = CSS.escape(row.itemId);
    const minInput = document.querySelector(`[data-markdown-min="${id}"]`);
    const autoInput = document.querySelector(`[data-markdown-auto="${id}"]`);
    if (minInput) row.minPrice = Number(minInput.value || 0);
    row.autoEnabled = Boolean(autoInput?.checked) && markdownCanEnable(row);
  });
  markdownRows = next;
  persistMarkdownRows();
  return markdownRows;
}

async function saveMarkdownSettings({ silent = false } = {}) {
  const rows = collectMarkdownRowsFromDom();
  if (!silent) setMarkdownStatus('100円値下げ設定をMacへ保存しています...');
  try {
    const tunnelUrl = await getMercariServiceUrl((message) => {
      if (!silent) setMarkdownStatus(message);
    });
    const resp = await fetchWithTimeout(`${tunnelUrl}/markdown/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: rows }),
    }, 30000);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '設定保存に失敗しました');
    if (!silent) setMarkdownStatus('100円値下げ設定を保存しました', 'success');
    renderMarkdownRows();
    return true;
  } catch (e) {
    console.warn(e);
    if (!silent) setMarkdownStatus(`設定保存に失敗しました: ${e.message}`, 'warn');
    return false;
  }
}

async function runMarkdownNow({ dryRun }) {
  collectMarkdownRowsFromDom();
  const targets = markdownRows.filter(markdownIsActive);
  if (!targets.length) {
    setMarkdownStatus('実行対象がありません。下限価格を入力して自動ONにしてください。', 'warn');
    return;
  }
  if (!dryRun) {
    const ok = confirm(`${targets.length}件を今すぐ100円値下げします。実行しますか？`);
    if (!ok) return;
  }
  const btn = dryRun ? el('markdown-dry-run-btn') : el('markdown-run-btn');
  let waitControl = null;
  btn.disabled = true;
  setMarkdownStatus(dryRun ? '値下げ対象だけ確認しています。価格は変更しません...' : 'Macで100円値下げを実行しています...');
  try {
    const saved = await saveMarkdownSettings({ silent: true });
    if (!saved) throw new Error('設定保存に失敗したため実行を止めました');
    const tunnelUrl = await getMercariServiceUrl((message) => setMarkdownStatus(message));
    const resp = await fetchWithTimeout(`${tunnelUrl}/markdown/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: targets, dryRun, limit: 100 }),
    }, 30000);
    const data = await resp.json();
    if (!data.ok || !data.job_id) throw new Error(data.error || '実行開始に失敗しました');
    waitControl = attachJobWaitCancel_(el('markdown-status'));
    await pollMacJob(tunnelUrl, data.job_id, {
      intervalMs: 10000,
      timeoutMs: 20 * 60 * 1000,
      onStatus: statusData => {
      setMarkdownStatus(statusData.message || '処理中...');
      },
      signal: waitControl.signal,
    }).then(async statusData => {
        const summary = statusData.run?.summary || {};
        const finalStatus = buildMarkdownRunStatus({ dryRun, summary, run: statusData.run });
        await loadMarkdownSnapshot({ silent: true });
        setMarkdownStatus(finalStatus.message, finalStatus.kind);
    });
  } catch (e) {
    console.warn(e);
    setMarkdownStatus(`実行に失敗しました: ${e.message}`, 'warn');
  } finally {
    waitControl?.cleanup();
    btn.disabled = false;
  }
}

function buildMarkdownRunStatus({ dryRun, summary = {}, run = {} }) {
  const updated = Number(summary.updated || 0);
  const checked = Number(summary.dryRun || 0);
  const skipped = Number(summary.skipped || 0);
  const error = Number(summary.error || 0);
  const hasProblem = skipped > 0 || error > 0;
  const issueText = summarizeMarkdownIssues(run);

  if (dryRun) {
    if (!hasProblem) {
      return {
        kind: 'success',
        message: `確認結果: 問題なし。${checked}件が100円値下げ可能です。価格は変更していません。`,
      };
    }
    return {
      kind: 'warn',
      message: `確認結果: 要確認あり。値下げ可能${checked}件、スキップ${skipped}件、エラー${error}件。価格は変更していません。${issueText}`,
    };
  }

  if (!hasProblem) {
    return {
      kind: 'success',
      message: `100円値下げ完了: 問題なし。${updated}件を値下げしました。`,
    };
  }
  return {
    kind: 'warn',
    message: `100円値下げ完了: 要確認あり。更新${updated}件、スキップ${skipped}件、エラー${error}件。${issueText}`,
  };
}

function summarizeMarkdownIssues(run = {}) {
  const issues = (run.results || [])
    .filter(row => row.status === 'skipped' || row.status === 'error')
    .slice(0, 3)
    .map(row => {
      const title = String(row.title || row.itemId || '対象不明').slice(0, 24);
      const reason = row.message || (row.status === 'error' ? 'エラー' : 'スキップ');
      return `${title}: ${reason}`;
    });
  return issues.length ? ` 主な理由: ${issues.join(' / ')}` : '';
}

function handleMarkdownFieldChange(event) {
  const target = event.target;
  const itemId = normalizeMarkdownItemId(target.dataset.markdownMin || target.dataset.markdownAuto || '');
  if (!itemId) return;
  const row = markdownRows.find(item => item.itemId === itemId);
  if (!row) return;
  if (target.dataset.markdownMin) {
    row.minPrice = Number(target.value || 0);
    if (!markdownCanEnable(row)) row.autoEnabled = false;
  }
  if (target.dataset.markdownAuto) {
    row.autoEnabled = Boolean(target.checked) && markdownCanEnable(row);
  }
  persistMarkdownRows();
  if (event.type === 'input' && target.dataset.markdownMin) {
    const count = el('markdown-enabled-count');
    if (count) {
      count.textContent = `${markdownRows.filter(markdownIsActive).length}件`;
    }
    return;
  }
  renderMarkdownRows();
}

function renderMarkdownRows() {
  const list = el('markdown-list');
  const count = el('markdown-enabled-count');
  const summary = el('markdown-filter-summary');
  const recommendationSummary = el('markdown-recommendation-summary');
  if (!list) return;
  const enabledCount = markdownRows.filter(markdownIsActive).length;
  const disabledCount = Math.max(0, markdownRows.length - enabledCount);
  const visibleRows = filteredMarkdownRows(markdownRows);
  if (count) count.textContent = `${enabledCount}件`;
  document.querySelectorAll('[data-markdown-filter]').forEach(button => {
    const selected = button.dataset.markdownFilter === markdownFilterMode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (summary) {
    summary.textContent = `値下げ中 ${enabledCount}件 / 値下げなし ${disabledCount}件`;
  }
  if (recommendationSummary) {
    const recommendationCounts = markdownRows.reduce((counts, row) => {
      const type = markdownRecommendation(row).type;
      if (type === 'largeMarkdown') counts.large += 1;
      else if (type === 'markdown100') counts.small += 1;
      else counts.wait += 1;
      return counts;
    }, { large: 0, small: 0, wait: 0 });
    recommendationSummary.innerHTML = `
      <div class="large"><span>大幅候補</span><strong>${recommendationCounts.large}件</strong></div>
      <div class="small"><span>100円</span><strong>${recommendationCounts.small}件</strong></div>
      <div class="wait"><span>維持・確認</span><strong>${recommendationCounts.wait}件</strong></div>`;
  }
  if (!markdownRows.length) {
    list.innerHTML = '<div class="research-empty">まだ取得していません</div>';
    return;
  }
  if (!visibleRows.length) {
    const emptyText = markdownFilterMode === 'enabled-only'
      ? '100円値下げ中の商品はありません'
      : '値下げしていない商品はありません';
    list.innerHTML = `<div class="research-empty">${emptyText}</div>`;
    return;
  }
  list.innerHTML = visibleRows.map(row => renderMarkdownCard(row)).join('');
}

function renderMarkdownCard(row) {
  const itemId = row.itemId;
  const title = row.title || 'タイトル未取得';
  const minPrice = Number(row.minPrice || 0);
  const canEnable = markdownCanEnable(row);
  const atFloor = markdownAtFloor(row);
  const autoChecked = markdownIsActive(row);
  const imageUrl = markdownImageUrl(row);
  const itemUrl = markdownItemUrl(row);
  const stateClass = autoChecked ? 'active' : (atFloor ? 'floor' : 'inactive');
  const stateText = autoChecked ? '100円値下げ中' : (atFloor ? '下限到達' : '値下げなし');
  const recommendation = markdownRecommendation(row);
  const metrics = markdownLikeMetrics(row);
  const suggestionText = ['keep', 'collecting', 'reviewListing'].includes(recommendation.type)
    ? '現在価格を維持'
    : formatYen(recommendation.suggestedPrice);
  const reasonMarkup = recommendation.reasons
    .map(reasonText => `<li>${escapeHtml(reasonText)}</li>`)
    .join('');
  const warningMarkup = recommendation.warnings
    .map(warningText => `<p class="markdown-recommendation-warning"><span aria-hidden="true">⚠</span>${escapeHtml(warningText)}</p>`)
    .join('');
  const lastIncreaseText = metrics.lastIncreaseObservedAt
    ? `最終増加確認 ${formatListingStyleDate(metrics.lastIncreaseObservedAt)}`
    : '最終増加確認 まだなし';
  const imageMarkup = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}の1枚目の写真" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '<span class="markdown-card-image-empty" aria-hidden="true">写真なし</span>';
  const reason = minPrice < 300
    ? '下限価格を入力してください'
    : (atFloor
        ? '下限価格に到達しました'
        : (!canEnable
            ? '次回値下げで下限を下回ります'
            : (autoChecked ? '20時の自動値下げ対象です' : '自動値下げはOFFです')));
  return `
    <article class="markdown-card recommendation-${recommendation.meta.className} ${atFloor ? 'at-floor' : (autoChecked ? 'enabled' : '')} ${canEnable ? '' : 'disabled'}" data-markdown-id="${escapeHtml(itemId)}">
      <div class="markdown-card-layout">
        <a class="markdown-card-media" href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener" aria-label="${escapeHtml(title)}の商品ページを開く">
          ${imageMarkup}
          <span class="markdown-card-state ${stateClass}">${stateText}</span>
        </a>
        <div class="markdown-card-body">
          <div class="markdown-card-header">
            <div>
              <h3>${escapeHtml(title)}</h3>
              <a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener">${escapeHtml(itemId)}</a>
            </div>
            <label class="markdown-toggle">
              <input type="checkbox" data-markdown-auto="${escapeHtml(itemId)}" ${autoChecked ? 'checked' : ''} ${canEnable ? '' : 'disabled'}>
              <span>自動ON</span>
            </label>
          </div>
          <div class="markdown-price-grid">
            <div><span>現在</span><strong>${formatYen(row.currentPrice)}</strong></div>
            <label>下限
              <input type="number" min="300" step="1" inputmode="numeric" value="${minPrice || ''}" placeholder="例: 1200" data-markdown-min="${escapeHtml(itemId)}">
            </label>
          </div>
          <section class="markdown-recommendation-card" aria-label="価格改定おすすめ">
            <div class="markdown-recommendation-card-head">
              <span class="markdown-recommendation-badge">
                <span aria-hidden="true">${escapeHtml(recommendation.meta.icon)}</span>
                ${escapeHtml(recommendation.meta.label)}
              </span>
              <span class="markdown-suggested-price">
                <small>おすすめ</small>
                <strong>${escapeHtml(suggestionText)}</strong>
              </span>
            </div>
            <ul class="markdown-recommendation-reasons">${reasonMarkup}</ul>
            <div class="markdown-like-signals" aria-label="いいね頻度">
              <span>累計 <strong>${metrics.total === null ? '—' : escapeHtml(metrics.total)}</strong></span>
              <span>24時間 <strong>${escapeHtml(formatMarkdownLikeDelta(metrics.delta24h))}</strong></span>
              <span>72時間 <strong>${escapeHtml(formatMarkdownLikeDelta(metrics.delta72h))}</strong></span>
              <span>7日 <strong>${escapeHtml(formatMarkdownLikeDelta(metrics.delta7d))}</strong></span>
            </div>
            <p class="markdown-like-history-note">履歴 ${metrics.observedDays}日分 / ${escapeHtml(lastIncreaseText)}</p>
            ${warningMarkup}
            <p class="markdown-display-note">表示のみ・このおすすめから価格は変更しません</p>
          </section>
          <p class="markdown-card-note">${escapeHtml(reason)}</p>
        </div>
      </div>
    </article>
  `;
}

function handleMarkdownImageError(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.closest('.markdown-card-media')) return;
  const placeholder = document.createElement('span');
  placeholder.className = 'markdown-card-image-empty';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.textContent = '写真なし';
  image.replaceWith(placeholder);
}

// ----- リセット -----
async function clearCurrentProduct_({ clearSession = true, scroll = false } = {}) {
  photoProcessingOperationId += 1;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  try {
    await _sessionWriteChain.catch(() => {});
  } catch (_) {}
  stopActiveMultiVoiceInput({ clearStatus: true });
  uploadedImages = [];
  lastAiData = null;
  activeTemporaryDraftId = null;
  renderPreviews();
  const photoInput = el('photo-input'); if (photoInput) photoInput.value = '';
  el('category').value = '';
  renderMeasurements();
  el('title-text').value = '';
  el('result-text').value = '';
  el('price-input').value = '';
  el('result-section').hidden = true;
  el('mercari-settings').hidden = true;
  el('m-condition').value = '目立った傷や汚れなし';
  setSelectedMercariCategoryKey('unknown');
  el('m-brand').value = '';
  el('m-size').value = '';
  el('m-size').dataset.userEdited = '';
  updateMercariSizeNote({ note: 'サイズなし、または手動で選んでください' });
  const fsb = el('final-size-badge'); if (fsb) fsb.hidden = true;
  const resultMeta = el('result-meta'); if (resultMeta) resultMeta.hidden = true;
  const inputStage = el('product-input-stage'); if (inputStage) inputStage.open = true;
  hideStatus('status');
  const draftStatus = el('draft-status'); if (draftStatus) draftStatus.hidden = true;
  if (clearSession) {
    try { await clearSessionDb(); } catch (e) { console.warn(e); }
  }
  updateGenerateButton();
  updateDraftChecklist();
  updateSizeSuggestion();
  updatePhotoSummary();
  updateTemporarySaveButton_();
  renderTemporaryDrafts_();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function resetAll() {
  if (photoProcessingInProgress) {
    showStatus('status', '写真の処理が完了してからリセットしてください。', 'warn');
    return;
  }
  if (descriptionGenerationInProgress) {
    showStatus('status', 'AI生成中はリセットできません。完了後に操作してください。', 'warn');
    return;
  }
  if (!confirm('現在入力中の写真・採寸・説明文をリセットしますか？（一時保存トレイの商品は残ります）')) return;
  await clearCurrentProduct_({ clearSession: true, scroll: true });
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
  if (cat === 'tie') {
    return [
      { keys: ['長さ','ながさ','全長','ぜんちょう'], field: 'tie_length', label: '長さ' },
      { keys: ['大剣幅','大剣巾','大剣','だいけん幅','だいけんはば'], field: 'tie_blade_width', label: '大剣幅' },
    ];
  }
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
const SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

const SIZE_SOURCE_REFERENCES = {
  mercari: {
    label: 'メルカリ公式ヘルプ',
    url: 'https://help.jp.mercari.com/guide/categories/4/',
    role: '下書きに入れるカテゴリ名・サイズ選択肢の最終合わせ先',
  },
  uniqloShirt: {
    label: 'UNIQLO公式: シャツ代表商品',
    url: 'https://www.uniqlo.com/jp/ja/products/E489138-000/00',
    role: 'トップスの実商品ページとサイズ表リンク',
  },
  uniqloJacket: {
    label: 'UNIQLO公式: ジャケット代表商品',
    url: 'https://www.uniqlo.com/jp/ja/products/E448036-000/00',
    role: 'ジャケット・アウターの実商品ページとサイズ表リンク',
  },
  uniqloPants: {
    label: 'UNIQLO公式: パンツ代表商品',
    url: 'https://www.uniqlo.com/jp/ja/products/E447780-000/00',
    role: 'パンツの実商品ページとサイズ表リンク',
  },
  gu: {
    label: 'GU公式',
    url: 'https://www.gu-global.com/jp/ja/',
    role: '普段着系カテゴリの補助基準',
  },
  aoki: {
    label: 'AOKI公式',
    url: 'https://www.aoki-style.com/',
    role: 'スーツ・セットアップ系のサイズ感',
  },
  suitSelect: {
    label: 'SUIT SELECT公式',
    url: 'https://www.suit-select.com/',
    role: 'スーツ・セットアップ系の補助基準',
  },
  zozo: {
    label: 'ZOZOTOWN',
    url: 'https://zozo.jp/',
    role: '身幅・肩幅・着丈など採寸項目の呼び方',
  },
};

const SIZE_PROFILES = {
  tops: {
    name: 'メンズ標準トップス基準',
    summary: 'シャツ・カットソー用',
    sourceIds: ['mercari', 'uniqloShirt', 'gu', 'zozo'],
    sourceNote: '公式商品ページのサイズ表リンクとメルカリのサイズ選択肢に合わせた実測目安です。タグ表記が読める場合はタグを優先します。',
    fields: {
      chest:    { w: 0.50, label: '身幅', centers: [47, 50, 53, 56, 59, 62, 65] },
      shoulder: { w: 0.25, label: '肩幅', centers: [40, 42, 44, 46, 48, 50, 52] },
      sleeve:   { w: 0.10, label: '袖丈', centers: [56, 58, 60, 62, 64, 66, 68] },
      length:   { w: 0.15, label: '着丈', centers: [64, 67, 70, 73, 76, 79, 82] },
    },
    bias: 0.10,
    liftFromLargeDimension: { gap: 1.2, rate: 0.25, max: 0.35 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['XS', 'S / 46', 'M / 48', 'L / 50', 'XL / 52', '2XL / 54', '3XL'],
  },
  menShirt: {
    name: 'メンズシャツ基準',
    summary: 'ワイシャツ・ドレスシャツ・長袖シャツ用',
    sourceIds: ['mercari', 'uniqloShirt', 'zozo'],
    sourceNote: 'シャツは身幅と肩幅を重視し、着丈だけで大きいサイズへ倒れすぎないように補正します。',
    fields: {
      chest:    { w: 0.50, label: '身幅', centers: [47, 50, 53, 56, 59, 62, 65] },
      shoulder: { w: 0.28, label: '肩幅', centers: [40, 42, 44, 46, 48, 50, 52] },
      sleeve:   { w: 0.10, label: '袖丈', centers: [56, 58, 60, 62, 64, 66, 68] },
      length:   { w: 0.12, label: '着丈', centers: [66, 69, 72, 75, 78, 81, 84] },
    },
    bias: 0.10,
    liftFromLargeDimension: { gap: 1.2, rate: 0.25, max: 0.35 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['XS', 'S / 46', 'M / 48', 'L / 50', 'XL / 52', '2XL / 54', '3XL'],
  },
  menRelaxedTop: {
    name: 'メンズ ニット・スウェット基準',
    summary: 'ニット・パーカー・スウェット用',
    sourceIds: ['mercari', 'uniqloShirt', 'gu', 'zozo'],
    sourceNote: 'ニット・スウェット系は元々ゆとりが出やすいため、標準トップスより身幅を少し大きめに見ます。',
    fields: {
      chest:    { w: 0.52, label: '身幅', centers: [49, 52, 55, 58, 61, 64, 67] },
      shoulder: { w: 0.20, label: '肩幅', centers: [41, 43, 45, 47, 49, 51, 53] },
      sleeve:   { w: 0.10, label: '袖丈', centers: [56, 58, 60, 62, 64, 66, 68] },
      length:   { w: 0.18, label: '着丈', centers: [62, 65, 68, 71, 74, 77, 80] },
    },
    bias: 0.05,
    liftFromLargeDimension: { gap: 1.3, rate: 0.20, max: 0.30 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
  womenTops: {
    name: 'レディーストップス基準',
    summary: 'ブラウス・カットソー・ニット用',
    sourceIds: ['mercari', 'uniqloShirt', 'gu', 'zozo'],
    sourceNote: 'レディースはメンズより小さめの実測レンジで判定します。ゆったりシルエットはタグ表記も併用してください。',
    fields: {
      chest:    { w: 0.52, label: '身幅', centers: [40, 43, 46, 49, 52, 55, 58] },
      shoulder: { w: 0.22, label: '肩幅', centers: [34, 36, 38, 40, 42, 44, 46] },
      sleeve:   { w: 0.08, label: '袖丈', centers: [53, 55, 57, 59, 61, 63, 65] },
      length:   { w: 0.18, label: '着丈', centers: [54, 57, 60, 63, 66, 69, 72] },
    },
    bias: 0.05,
    liftFromLargeDimension: { gap: 1.2, rate: 0.25, max: 0.35 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
  outer: {
    name: 'メンズ通常アウター基準',
    summary: 'ブルゾン・ジャケット用',
    sourceIds: ['mercari', 'uniqloJacket', 'gu', 'zozo'],
    sourceNote: 'アウターは中に着込む前提でトップスより少し大きめに見ます。丈だけで過大判定しないよう身幅を主軸にします。',
    fields: {
      chest:    { w: 0.46, label: '身幅', centers: [50, 53, 56, 59, 62, 65, 68] },
      shoulder: { w: 0.20, label: '肩幅', centers: [41, 43, 45, 47, 49, 51, 53] },
      sleeve:   { w: 0.14, label: '袖丈', centers: [57, 59, 61, 63, 65, 67, 69] },
      length:   { w: 0.20, label: '着丈', centers: [65, 69, 73, 77, 81, 85, 89] },
    },
    bias: 0.20,
    liftFromLargeDimension: { gap: 1.0, rate: 0.30, max: 0.50 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
  menTailoredOuter: {
    name: 'メンズテーラードジャケット基準',
    summary: '単品ジャケット用',
    sourceIds: ['mercari', 'uniqloJacket', 'aoki', 'suitSelect', 'zozo'],
    sourceNote: '単品ジャケットはスーツ寄りの基準で見ます。身幅だけで小さく倒れないよう、肩幅と着丈も強めに反映します。',
    fields: {
      chest:    { w: 0.42, label: '身幅', centers: [46, 49, 52, 55, 58, 61, 64] },
      shoulder: { w: 0.24, label: '肩幅', centers: [39, 41, 43, 45, 47, 49, 51] },
      sleeve:   { w: 0.10, label: '袖丈', centers: [56, 58, 60, 62, 64, 66, 68] },
      length:   { w: 0.24, label: '着丈', centers: [66, 69, 72, 75, 78, 81, 84] },
    },
    bias: 0.40,
    liftFromLargeDimension: { gap: 0.85, rate: 0.45, max: 0.75 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['42 / XS', '44-46 / S', '48 / M', '50 / L', '52 / XL', '54 / 2XL', '56 / 3XL'],
  },
  menCoat: {
    name: 'メンズコート基準',
    summary: 'トレンチ・ステンカラー・チェスター用',
    sourceIds: ['mercari', 'uniqloJacket', 'aoki', 'zozo'],
    sourceNote: 'コートは着丈が長い前提のため、着丈の比重を下げ、身幅・肩幅を中心に判定します。',
    fields: {
      chest:    { w: 0.50, label: '身幅', centers: [49, 52, 55, 58, 61, 64, 67] },
      shoulder: { w: 0.24, label: '肩幅', centers: [40, 42, 44, 46, 48, 50, 52] },
      sleeve:   { w: 0.12, label: '袖丈', centers: [57, 59, 61, 63, 65, 67, 69] },
      length:   { w: 0.14, label: '着丈', centers: [82, 90, 98, 106, 114, 122, 130] },
    },
    bias: 0.20,
    liftFromLargeDimension: { gap: 1.1, rate: 0.25, max: 0.40 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
  womenOuter: {
    name: 'レディースアウター基準',
    summary: 'ジャケット・コート用',
    sourceIds: ['mercari', 'uniqloJacket', 'gu', 'zozo'],
    sourceNote: 'レディースアウターはメンズより小さめの実測レンジで判定し、コート丈は過大判定しすぎないよう補正します。',
    fields: {
      chest:    { w: 0.48, label: '身幅', centers: [43, 46, 49, 52, 55, 58, 61] },
      shoulder: { w: 0.22, label: '肩幅', centers: [36, 38, 40, 42, 44, 46, 48] },
      sleeve:   { w: 0.10, label: '袖丈', centers: [54, 56, 58, 60, 62, 64, 66] },
      length:   { w: 0.20, label: '着丈', centers: [58, 63, 68, 73, 78, 83, 88] },
    },
    bias: 0.10,
    liftFromLargeDimension: { gap: 1.1, rate: 0.25, max: 0.40 },
    tableFields: ['chest', 'shoulder', 'length'],
    tagExamples: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
  suit: {
    name: 'メンズスーツ基準',
    summary: 'スーツ・テーラード・セットアップ用',
    sourceIds: ['mercari', 'aoki', 'suitSelect', 'zozo'],
    sourceNote: 'スーツはトップス基準ではなく、ジャケット寸法とパンツ寸法を合わせます。細身スーツで小さく出すぎないよう着丈・肩幅の上振れも反映します。',
    fields: {
      j_chest:    { w: 0.34, label: 'J身幅', centers: [45, 48, 51, 54, 57, 60, 63] },
      j_shoulder: { w: 0.22, label: 'J肩幅', centers: [38.5, 40.5, 42.5, 44.5, 46.5, 48.5, 50.5] },
      j_sleeve:   { w: 0.10, label: '袖丈', centers: [56, 58, 60, 62, 64, 66, 68] },
      j_length:   { w: 0.16, label: 'J着丈', centers: [66, 69, 72, 75, 78, 81, 84] },
      p_waist:    { w: 0.16, label: 'Pウエスト', centers: [70, 74, 78, 82, 86, 90, 94] },
      p_inseam:   { w: 0.05, label: '股下', centers: [70, 72, 74, 76, 78, 80, 82] },
    },
    bias: 0.55,
    liftFromLargeDimension: { gap: 0.85, rate: 0.45, max: 0.85 },
    tableFields: ['j_chest', 'j_shoulder', 'j_length', 'p_waist'],
    tagExamples: ['42 / XS', '44-46 / S', '48 / M', '50 / L', '52 / XL', '54 / 2XL', '56 / 3XL'],
  },
  womenSuit: {
    name: 'レディーススーツ基準',
    summary: 'レディーススーツ・フォーマル用',
    sourceIds: ['mercari', 'aoki', 'suitSelect', 'zozo'],
    sourceNote: 'レディーススーツはメンズスーツとは別の小さめレンジで見ます。パンツが未入力ならジャケット寸法中心で判定します。',
    fields: {
      j_chest:    { w: 0.36, label: 'J身幅', centers: [42, 44, 46, 48, 50, 52, 54] },
      j_shoulder: { w: 0.22, label: 'J肩幅', centers: [35.5, 37, 38.5, 40, 41.5, 43, 44.5] },
      j_sleeve:   { w: 0.08, label: '袖丈', centers: [54, 56, 58, 60, 62, 64, 66] },
      j_length:   { w: 0.18, label: 'J着丈', centers: [55, 58, 61, 64, 67, 70, 73] },
      p_waist:    { w: 0.14, label: 'Pウエスト', centers: [60, 64, 68, 72, 76, 80, 84] },
      p_inseam:   { w: 0.04, label: '股下', centers: [62, 65, 68, 71, 74, 77, 80] },
    },
    bias: 0.25,
    liftFromLargeDimension: { gap: 1.0, rate: 0.35, max: 0.55 },
    tableFields: ['j_chest', 'j_shoulder', 'j_length', 'p_waist'],
    tagExamples: ['XS / 5号', 'S / 7号', 'M / 9号', 'L / 11号', 'XL / 13号', '2XL / 15号', '3XL'],
  },
  bottoms: {
    name: 'メンズボトムス基準',
    summary: 'パンツ・スラックス用',
    sourceIds: ['mercari', 'uniqloPants', 'gu', 'zozo'],
    sourceNote: 'ボトムスはウエストを主軸にし、股下は補助に留めます。Wインチやcmタグが読める場合はタグを優先します。',
    fields: {
      waist:  { w: 0.85, label: 'ウエスト', centers: [68, 72, 76, 80, 84, 88, 92] },
      inseam: { w: 0.15, label: '股下', centers: [70, 72, 74, 76, 78, 80, 82] },
    },
    tableFields: ['waist', 'inseam'],
    tagExamples: ['W26 / XS', 'W28 / S', 'W30 / M', 'W32 / L', 'W34 / XL', 'W36 / 2XL', 'W38 / 3XL'],
  },
  womenBottoms: {
    name: 'レディースボトムス基準',
    summary: 'レディースパンツ・スラックス用',
    sourceIds: ['mercari', 'uniqloPants', 'gu', 'zozo'],
    sourceNote: 'レディースボトムスはメンズより小さめのウエストレンジで判定します。',
    fields: {
      waist:  { w: 0.86, label: 'ウエスト', centers: [58, 62, 66, 70, 74, 78, 82] },
      inseam: { w: 0.14, label: '股下', centers: [64, 66, 68, 70, 72, 74, 76] },
    },
    tableFields: ['waist', 'inseam'],
    tagExamples: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
};

function clampScore(s) {
  return Math.max(0, Math.min(6, s));
}

function scoreByCenters(value, centers) {
  const v = Number(value);
  if (!Number.isFinite(v) || !centers?.length) return 0;
  if (v <= centers[0]) {
    const step = Math.max(1, centers[1] - centers[0]);
    return clampScore((v - centers[0]) / step);
  }
  for (let i = 0; i < centers.length - 1; i += 1) {
    const current = centers[i];
    const next = centers[i + 1];
    if (v <= next) {
      const span = Math.max(1, next - current);
      return clampScore(i + (v - current) / span);
    }
  }
  const last = centers.length - 1;
  const step = Math.max(1, centers[last] - centers[last - 1]);
  return clampScore(last + (v - centers[last]) / step);
}

function scoreChest(v)    { return scoreByCenters(v, SIZE_PROFILES.tops.fields.chest.centers); }
function scoreShoulder(v) { return scoreByCenters(v, SIZE_PROFILES.tops.fields.shoulder.centers); }
function scoreLength(v)   { return scoreByCenters(v, SIZE_PROFILES.tops.fields.length.centers); }
function scoreWaist(v)    { return scoreByCenters(v, SIZE_PROFILES.bottoms.fields.waist.centers); }
function scoreInseam(v)   { return scoreByCenters(v, SIZE_PROFILES.bottoms.fields.inseam.centers); }

function getSizeProfileKey(categoryKey = getSelectedMercariCategoryKey(), broadCat = el('category')?.value) {
  if (!broadCat) return '';
  const option = getMercariCategoryOption(categoryKey);
  const pathText = [...(option.path || []), option.label || ''].join(' ');
  const isWomen = getSelectedProductGender() === 'women';
  if (broadCat === 'suit') return isWomen ? 'womenSuit' : 'suit';
  if (broadCat === 'bottoms') return isWomen ? 'womenBottoms' : 'bottoms';
  if (broadCat !== 'tops') return '';

  const isOuter = /ジャケット|アウター|コート|ブルゾン|ダウン|ライダース|スタジャン|ジャンパー|カバーオール|MA-1|フライトジャケット|ポンチョ|ケープ/.test(pathText);
  const isCoat = /コート|トレンチ|ステンカラー|チェスター|ダッフル|ピーコート|モッズ|ロングコート|スプリングコート/.test(pathText);
  const isTailored = /テーラードジャケット|スーツジャケット|ノーカラージャケット/.test(pathText);
  if (isWomen) {
    if (isOuter) return 'womenOuter';
    return 'womenTops';
  }
  if (isTailored) return 'menTailoredOuter';
  if (isCoat) return 'menCoat';
  if (isOuter) {
    return 'outer';
  }
  if (/ニット|セーター|カーディガン|パーカー|トレーナー|スウェット|ジャージ|ベスト|フリース/.test(pathText)) {
    return 'menRelaxedTop';
  }
  if (/シャツ|ポロシャツ|Tシャツ|カットソー|タンクトップ|ノースリーブ/.test(pathText)) {
    return 'menShirt';
  }
  return 'tops';
}

function readMeasurementValue(key) {
  const value = parseFloat((el('m-' + key) || {}).value);
  return value > 0 ? value : null;
}

// 採寸値のみからサイズを推定（Step2のリアルタイム表示用）
function computeMeasurementSize() {
  const cat = el('category').value;
  if (!cat) return null;
  if (cat === 'other' || cat === 'bag' || cat === 'tie') return null;  // その他・バッグ・ネクタイはサイズ推定対象外
  const profileKey = getSizeProfileKey(getSelectedMercariCategoryKey(), cat);
  if (!profileKey) return null;
  return estimateBySizeProfile(profileKey);
}

function updateSizeSuggestion() {
  const panel = el('size-suggestion');
  if (!panel) return;
  const cat = el('category').value;
  if (!cat) { panel.hidden = true; return; }

  const result = computeMeasurementSize();
  if (!result) { panel.hidden = true; return; }

  const profileKey = result.profileKey || getSizeProfileKey(getSelectedMercariCategoryKey(), cat);
  const profile = SIZE_PROFILES[profileKey] || SIZE_PROFILES.tops;
  const table = sizeReferenceTable(profileKey);
  panel.innerHTML = `
    <div class="size-main">📏 採寸からの推定: <strong>${result.size}サイズ相当</strong></div>
    <div class="size-hint">${result.detail}</div>
    <details class="size-ref">
      <summary>サイズ目安表（${profile.name}）</summary>
      ${table}
      <p class="note small">※ブランドにより±2〜3cm程度の差があります。タグ表記との併用をおすすめします。</p>
    </details>
  `;
  panel.hidden = false;
  syncMercariSizeFromMeasurements();
}

function syncMercariSizeFromMeasurements() {
  const settings = el('mercari-settings');
  const sizeSelect = el('m-size');
  if (!settings || settings.hidden || !sizeSelect || sizeSelect.dataset.userEdited) return;
  const sizeResult = deriveMercariSize(lastAiData, getSelectedMercariCategoryKey());
  sizeSelect.value = sizeResult.value;
  updateMercariSizeNote(sizeResult);
  updateDraftChecklist();
}

function estimateBySizeProfile(profileKey) {
  const profile = SIZE_PROFILES[profileKey];
  if (!profile) return null;
  const parts = [];
  Object.entries(profile.fields).forEach(([key, def]) => {
    const value = readMeasurementValue(key);
    if (value == null) return;
    parts.push({
      w: def.w,
      s: scoreByCenters(value, def.centers),
      label: `${def.label}${value}`,
    });
  });
  if (parts.length === 0) return null;
  return combineScores(parts, profile, profileKey);
}

function combineScores(parts, profile = {}, profileKey = '') {
  const totalW = parts.reduce((a, p) => a + p.w, 0);
  const rawAvg = parts.reduce((a, p) => a + p.w * p.s, 0) / totalW;
  let avg = rawAvg + (profile.bias || 0);
  const maxScore = Math.max(...parts.map(p => p.s));
  if (profile.liftFromLargeDimension && maxScore - avg >= profile.liftFromLargeDimension.gap) {
    const lift = Math.min(
      profile.liftFromLargeDimension.max,
      (maxScore - avg) * profile.liftFromLargeDimension.rate,
    );
    avg += lift;
  }
  avg = clampScore(avg);
  const idx = Math.max(0, Math.min(6, Math.round(avg)));
  const size = SIZE_LABELS[idx];
  const adjusted = Math.abs(avg - rawAvg) >= 0.05 ? ` / 補正後 ${avg.toFixed(2)}` : '';
  const profileName = profile.name ? `${profile.name}: ` : '';
  const detail = `${profileName}${parts.map(p => p.label).join(' / ')} → 加重平均 ${rawAvg.toFixed(2)}${adjusted}`;
  return { size, detail, score: avg, rawScore: rawAvg, index: idx, profileKey };
}

// タグ表記をS/M/L/XL/XXL/XXXLへ正規化
function normalizeTagSize(raw) {
  if (!raw) return null;
  const t = String(raw).toUpperCase().trim();
  if (t === '---' || t === '') return null;

  // 文字表記
  if (/^(FREE|FREE SIZE|ONE SIZE|ONESIZE|フリー|フリーサイズ)$/.test(t)) return 'FREE SIZE';
  if (/^(XXXL|3XL|LLL|3L)$/.test(t)) return 'XXXL';
  if (/^(XXL|2XL|2L)$/.test(t))      return 'XXL';
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
    const tagIndex = SIZE_LABELS.indexOf(tagNorm);
    const diff = tagIndex >= 0 ? Math.abs(tagIndex - measurement.index) : 0;
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
  const mercariFinalSize = normalizeMercariSizeLabel(finalSize, getSelectedMercariCategoryKey()) || finalSize;

  badge.className = 'final-size-badge' + (warn ? ' warn' : '');
  badge.innerHTML = `
    <div class="fs-head">🏷 メルカリのサイズ選択推奨</div>
    <div class="fs-size">${mercariFinalSize}</div>
    <div class="fs-note">${note}</div>
  `;
  badge.hidden = false;
}

function sizeReferenceTable(profileKey) {
  const profile = SIZE_PROFILES[profileKey] || SIZE_PROFILES.tops;
  const fields = (profile.tableFields || Object.keys(profile.fields || {}))
    .map(key => [key, profile.fields[key]])
    .filter(([, def]) => def?.centers?.length);
  if (!fields.length) return '';
  const header = [
    '<th>サイズ</th>',
    ...fields.map(([, def]) => `<th>${escapeHtml(def.label)}(cm)</th>`),
    '<th>タグ例</th>',
  ].join('');
  const rows = SIZE_LABELS.map((label, idx) => {
    const cells = fields
      .map(([, def]) => `<td>${formatSizeRange(def.centers, idx)}</td>`)
      .join('');
    const tag = profile.tagExamples?.[idx] || label;
    return `<tr><td>${label}</td>${cells}<td>${escapeHtml(tag)}</td></tr>`;
  }).join('');
  return `<table class="size-table"><tr>${header}</tr>${rows}</table>`;
}

function formatSizeRange(centers, index) {
  if (!Array.isArray(centers) || !centers.length) return '';
  if (index <= 0) {
    const upper = midpoint(centers[0], centers[1] ?? centers[0] + 2);
    return `〜${formatCm(upper)}`;
  }
  if (index >= centers.length - 1) {
    const lower = midpoint(centers[index - 1], centers[index]);
    return `${formatCm(lower)}〜`;
  }
  const lower = midpoint(centers[index - 1], centers[index]);
  const upper = midpoint(centers[index], centers[index + 1]);
  return `${formatCm(lower)}〜${formatCm(upper)}`;
}

function midpoint(a, b) {
  return (Number(a) + Number(b)) / 2;
}

function formatCm(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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
  const thumbnailBase64 = createThumbnailBase64FromCanvas_(c);

  const composedImage = {
    dataUrl: smallDataUrl, mediaType: 'image/jpeg',
    base64: smallDataUrl.split(',')[1], base64HQ, thumbnailBase64,
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
  if (!resultVisible) { checklist.hidden = true; return { ok: false, items: [] }; }
  const photoCount = uploadedImages.length;
  const hasPhotos = photoCount > 0;
  const hasDraftPhotoCount = hasPhotos && photoCount <= MAX_DRAFT_PHOTOS;
  const hasTitle = !!el('title-text').value.trim();
  const hasDesc = !!el('result-text').value.trim();
  const price = Number(el('price-input').value || 0);
  const hasPrice = Number.isInteger(price) && price >= 300 && price <= 9999999;
  const hasCondition = !el('mercari-settings').hidden && !!el('m-condition').value;
  const categoryOption = getMercariCategoryOption(getSelectedMercariCategoryKey());
  const hasMercariCategory = !el('mercari-settings').hidden && categoryOption.path.length > 0;
  const mercariBrand = el('m-brand').value.trim();
  const mercariSize = getSelectedMercariSize();
  const sizeRequired = isMercariSizeRequiredForCategoryKey(getSelectedMercariCategoryKey());
  const hasRequiredSize = !sizeRequired || !!mercariSize;
  const missingTitleWords = missingTitleWordsInDescription_();
  const titleSynced = missingTitleWords.length === 0;
  const photoLabel = !hasPhotos
    ? '写真を選んでください'
    : photoCount <= MAX_DRAFT_PHOTOS
      ? `写真 ${photoCount}枚`
      : `写真 ${photoCount}枚：下書き保存は${MAX_DRAFT_PHOTOS}枚までです`;
  const items = [
    { ok: hasDraftPhotoCount, label: photoLabel },
    { ok: hasTitle, label: hasTitle ? '商品名があります' : '商品名を確認してください' },
    { ok: titleSynced, label: titleSynced ? '商品名の言葉を説明文にも反映済みです' : `説明文の商品名に不足: ${missingTitleWords.join('、')}` },
    { ok: hasDesc, label: hasDesc ? '説明文があります' : '先に説明文を生成してください' },
    { ok: hasPrice, label: hasPrice ? '価格が入力されています' : '販売価格は300〜9,999,999円で入力してください' },
    { ok: hasCondition, label: hasCondition ? '状態が選択されています' : '商品の状態を確認してください' },
    { ok: hasMercariCategory, label: hasMercariCategory ? `カテゴリ: ${categoryOption.label}` : 'メルカリ詳細カテゴリを確認してください' },
    { ok: true, label: mercariBrand ? `ブランド: ${mercariBrand}` : 'ブランド: 空欄（見つからない場合はOK）' },
    { ok: hasRequiredSize, label: mercariSize ? `サイズ: ${mercariSize}` : (sizeRequired ? 'サイズを確認してください' : 'サイズ: 不要/手動') },
  ];
  checklist.hidden = false;
  checklist.innerHTML = items.map(item =>
    `<div class="draft-check-item ${item.ok ? 'ok' : 'ng'}">
      <span class="draft-check-mark">${item.ok ? '✓' : '○'}</span>
      <span>${item.label}</span>
    </div>`
  ).join('');
  return { ok: items.every(item => item.ok), items };
}

// ----- 下書き保存（Cloudflare tunnel経由でMac自動入力） -----
function buildDraftPayload_(input) {
  return {
    title: normalizeMercariTitle(input.title),
    description: String(input.description || '').trim(),
    price: String(input.price || ''),
    category: input.category,
    mercari_category_key: input.mercariCategoryKey,
    mercari_category_label: input.mercariCategoryLabel,
    mercari_category: [...(input.mercariCategoryPath || [])],
    mercari_brand: String(input.mercariBrand || '').trim(),
    mercari_size: input.mercariSize || '',
    photos: (input.photos || []).map(img => ({
      base64: img.base64HQ || img.base64,
      mediaType: img.mediaType,
    })),
    mercari_condition: input.mercariCondition,
    mercari_shipping: 'らくらくメルカリ便',
  };
}

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
  syncDescriptionProductNameFromTitle_();
  const validation = updateDraftChecklist();
  if (!validation?.ok) {
    const firstMissing = validation?.items?.find(item => !item.ok)?.label || '入力内容を確認してください';
    alert(`下書き保存前チェックを完了してください。\n${firstMissing}`);
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
  let waitControl = null;
  draftBtn.disabled = true;
  draftStatus.hidden = false;
  draftStatus.textContent = 'MacサービスURLを取得中...';

  try {
    const tunnelUrl = await getMercariServiceUrl((message) => {
      draftStatus.textContent = message;
    });

    // 下書きリクエスト送信
    draftStatus.textContent = '下書き情報を送信中...';
    const mercariCategoryKey = getSelectedMercariCategoryKey();
    const mercariCategoryOption = getMercariCategoryOption(mercariCategoryKey);
    const payload = buildDraftPayload_({
      title: el('title-text').value || lastAiData.title,
      description: el('result-text').value.trim() || lastAiData.description,
      price,
      category: CATEGORY_JP[lastAiData.category] || lastAiData.category,
      mercariCategoryKey,
      mercariCategoryLabel: mercariCategoryOption.label,
      mercariCategoryPath: mercariCategoryOption.path,
      mercariBrand: el('m-brand').value,
      mercariSize: getSelectedMercariSize(),
      photos: uploadedImages,
      mercariCondition: el('m-condition').value,
    });
    const draftResp = await fetchWithTimeout(`${tunnelUrl}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 30000);  // 写真あり→30秒に延長
    const draftData = await readJsonResponse(draftResp, '下書き保存開始');
    if (!draftResp.ok || !draftData.ok || !draftData.job_id) {
      throw new Error(draftData.error || '下書き保存を開始できませんでした');
    }
    const jobId = draftData.job_id;

    // ポーリング
    draftStatus.textContent = 'Macが下書きを入力中... (しばらくお待ちください)';
    waitControl = attachJobWaitCancel_(draftStatus);
    await pollMacJob(tunnelUrl, jobId, {
      intervalMs: 10000,
      timeoutMs: 10 * 60 * 1000,
      onStatus: statusData => {
      draftStatus.textContent = statusData.message || '処理中...';
      },
      signal: waitControl.signal,
    });
    draftStatus.textContent = '下書き保存が完了しました。メルカリアプリで確認してください。';
  } catch (e) {
    draftStatus.textContent = `❌ エラー: ${e.message}`;
  } finally {
    waitControl?.cleanup();
    draftBtn.disabled = false;
  }
}

// ----- 起動 -----
globalThis.MercariAppTestHooks = {
  buildDraftPayload_,
  buildDescriptionProductName,
  buildMercariTitle,
  cleanMercariTitleMarketingWords,
  isExcludedMercariTitleMarketingText,
  normalizeMercariTitle,
  defaultNewMinPrice: price => Math.max(300, Math.floor(Number(price || 0) * 0.7)),
  normalizeResearchWizardStep,
  isResearchPriceRangeValid,
  setResearchWizardStep,
  compactTemporaryDraftPhoto_,
  hydrateTemporaryDraftPhoto_,
  compactTemporaryDraftState_,
  hydrateTemporaryDraftState_,
  temporaryDraftMeasurementCount_,
  inferTemporaryDraftStatus_,
  temporaryDraftSummaryFromRecord_,
  safeTemporaryThumbnailBase64_,
  normalizeMacServiceUrl_,
  getCachedMacServiceUrl_,
  cacheMacServiceUrl_,
  clearCachedMacServiceUrl_,
  isTransientServiceDiscoveryError_,
};
if (!globalThis.__MERCARI_TEST__) init();
