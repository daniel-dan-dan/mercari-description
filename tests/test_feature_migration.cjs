const fs=require('node:fs');const assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8'),sw=fs.readFileSync('sw.js','utf8');
assert.doesNotMatch(html,/id="(?:sale|markdown|research)-(?:panel|tab-btn)"|src="sale-comments/);
assert.doesNotMatch(app,/\/sale-comments\/|\/markdown\/(?:run|settings|snapshot)|function runMarkdownNow/);
assert.doesNotMatch(sw,/sale-comments/);
assert.match(html,/id="description-panel"/);assert.doesNotMatch(app,/\/research\/|function runResearchNow/);
console.log('PASS feature migration: sale and repricing absent; description retained; research removed');
