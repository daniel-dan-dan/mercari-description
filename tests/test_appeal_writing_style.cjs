#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  URL,
  globalThis: null,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
context.globalThis = context;
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const source = [
  fs.readFileSync('catalog-data.js', 'utf8'),
  fs.readFileSync('app.js', 'utf8'),
].join('\n');
vm.runInContext(source, context, { filename: 'app.js' });

const hooks = context.MercariAppTestHooks;

assert.equal(
  hooks.polishAppealText_(
    '滑らかな肌触りが魅力\nまた幅広い装いに自然となじみます',
  ),
  '滑らかな肌触りが魅力。また、幅広い装いに自然となじみます。',
);
assert.equal(
  hooks.polishAppealText_(
    '軽やかな着心地のため長い季節に活躍します。端正なシルエットです。',
  ),
  '軽やかな着心地のため、長い季節に活躍します。端正なシルエットです。',
);
assert.equal(
  hooks.polishAppealText_(
    '型番3.5のモデルです。また、付属品は写真をご確認ください。',
  ),
  '型番3.5のモデルです。また、付属品は写真をご確認ください。',
);
assert.equal(
  hooks.polishAppealText_('  ・落ち着いた配色です。。  '),
  '落ち着いた配色です。',
);
assert.equal(hooks.polishAppealText_(''), '');
assert.equal(
  hooks.polishAppealText_('また、幅広く活躍します。'),
  'また、幅広く活躍します。',
);
assert.equal(
  hooks.polishAppealText_('-20℃対応のモデルです。S.H.Figuartsにも使用できます。'),
  '-20℃対応のモデルです。S.H.Figuartsにも使用できます。',
);
assert.equal(
  hooks.polishAppealText_('「魅力です。」'),
  '「魅力です。」',
);
assert.equal(
  hooks.polishAppealText_('またぎ切断に対応します。'),
  'またぎ切断に対応します。',
);
assert.equal(
  hooks.polishAppealText_('またたび入りの猫用おもちゃです。'),
  'またたび入りの猫用おもちゃです。',
);
assert.equal(
  hooks.polishAppealText_('またすぐに使えます。さらにお手入れも簡単です。'),
  'また、すぐに使えます。さらに、お手入れも簡単です。',
);
assert.equal(
  hooks.polishAppealText_('使いやすいです. また便利です.'),
  '使いやすいです。また、便利です。',
);
const idempotentAppeal = '上質な風合いが魅力。また、幅広く活躍します。';
assert.equal(
  hooks.polishAppealText_(hooks.polishAppealText_(idempotentAppeal)),
  idempotentAppeal,
);

assert.equal(
  hooks.cleanSeasonMarketingSentences(
    '冬向けの厚手素材です。端正なシルエットです。上質な風合い。軽やかです！',
    { disallowedPatterns: [/冬向け/g] },
  ),
  '端正なシルエットです。上質な風合い。軽やかです！',
);

const sanitized = hooks.sanitizeAiDataForSeason({
  appeal: '上質な風合いが魅力\nさらに端正な装いにまとまります',
  condition: '目立った傷や汚れなし',
  title_keywords: ['上質'],
}, 'men');
assert.equal(
  sanitized.appeal,
  '上質な風合いが魅力。さらに、端正な装いにまとまります。',
);
assert.equal(
  hooks.sanitizeAiDataForSeason({
    appeal: '上質な素材です。軽く羽織れます。',
  }, 'men').appeal,
  '上質な素材です。軽く羽織れます。',
);
assert.equal(
  hooks.sanitizeAiDataForSeason({
    appeal: 'また幅広い用途に使えます',
  }, 'other').appeal,
  'また、幅広い用途に使えます。',
);
assert.equal(
  hooks.sanitizeAiDataForSeason({
    appeal: '-20℃の環境に対応します。型番3.5のモデルです。',
  }, 'men').appeal,
  '-20℃の環境に対応します。型番3.5のモデルです。',
);

const prompt = hooks.buildDescriptionSystemPrompt(
  '過去の説明文では「です。」を連続して使います。',
  'men',
);
assert.match(prompt, /訴求文（appeal）の文体ルール（過去出品例より優先）/);
assert.match(prompt, /意味の切れ目には読点「、」を入れる/);
assert.match(prompt, /体言止めは多くても1文まで/);
assert.match(prompt, /残りは自然な「です・ます」調/);
assert.match(prompt, /読点不足、文末の重複、助詞の抜け/);
assert.match(prompt, /内容はコピーせず、今回の写真で確認できる事実だけを書く/);
assert.ok(
  prompt.lastIndexOf('訴求文（appeal）の文体ルール')
    > prompt.lastIndexOf('過去の説明文では'),
  '文体品質ルールは過去出品スタイルより後に置き、最優先にする',
);

const nonApparelPrompt = hooks.buildDescriptionSystemPrompt('', 'other');
assert.match(nonApparelPrompt, /日々の作業へすぐに取り入れられます/);
assert.doesNotMatch(nonApparelPrompt, /滑らかな肌触り|軽やかな着心地|幅広い装い/);

const description = hooks.buildDescription(
  {
    brand: 'バーバリー',
    item: 'シャツ',
    tag_size: 'M',
    color: 'ブルー 青色',
    material: '綿100%',
    condition: '目立った傷や汚れなし',
    appeal: '滑らかな肌触りが魅力\nまた長く活躍します',
  },
  '肩幅：45cm',
  'バーバリー シャツ',
  'men',
);
assert.match(
  description,
  /ご覧いただきありがとうございます✨\n\n滑らかな肌触りが魅力。また、長く活躍します。\n\n【商品名】/,
);

console.log(JSON.stringify({
  ok: true,
  punctuationFallback: true,
  promptPriority: 'appeal-rules-after-past-style',
  version: 'v20260906c',
}));
