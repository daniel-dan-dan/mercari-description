#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbiddenPath = /(^|\/)(?:backups?|output|\.playwright-cli)(\/|$)|\.before-|\.bundle$|(^|\/)\.env(?:\.|$)/;
const forbiddenTracked = tracked.filter(file => forbiddenPath.test(file));
assert.deepEqual(forbiddenTracked, [], 'バックアップ・実行データ・.envをGit管理しない');

const sourceExtensions = /\.(?:html|js|cjs|json|md|yml|yaml|css)$/;
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/,
];
const secretFindings = [];
tracked.filter(file => sourceExtensions.test(file) && !file.startsWith('vendor/')).forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  secretPatterns.forEach(pattern => {
    if (pattern.test(content)) secretFindings.push(`${file}: ${pattern}`);
  });
});
assert.deepEqual(secretFindings, [], '秘密値らしい文字列をソースに直書きしない');

const ignore = fs.readFileSync('.gitignore', 'utf8');
[
  /^\.env\.\*$/m,
  /^backups\/$/m,
  /^\*\.before-\*$/m,
  /^\*\.bundle$/m,
  /^output\/playwright\/$/m,
].forEach(pattern => assert.match(ignore, pattern));

console.log(JSON.stringify({
  ok: true,
  trackedFiles: tracked.length,
  forbiddenTrackedFiles: 0,
  secretLiteralFindings: 0,
}));
