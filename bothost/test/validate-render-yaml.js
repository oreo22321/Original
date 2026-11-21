'use strict';
// render.yaml が Render の公式のスキーマ (https://render.com/schema/render.yaml.json) に合っているか確かめる。
//   NODE_PATH=<ajv・ajv-formats・yaml を入れた node_modules> node test/validate-render-yaml.js schema.json ../render.yaml
const fs = require('fs');
const YAML = require('yaml');

const [schemaFile, yamlFile] = process.argv.slice(2);
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
const data = YAML.parse(fs.readFileSync(yamlFile, 'utf8'));

const draft = String(schema.$schema || '');
const Ajv = draft.includes('2020-12') ? require('ajv/dist/2020').default
  : draft.includes('2019-09') ? require('ajv/dist/2019').default
    : require('ajv').default;
const ajv = new Ajv({ strict: false, allErrors: true });
try { require('ajv-formats')(ajv); } catch { /* 形式のチェックはなくてもよい */ }

const validate = ajv.compile(schema);
if (!validate(data)) {
  console.error(`✗ ${yamlFile} は Render のスキーマに合っていません:`);
  for (const e of validate.errors) console.error(`  ${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`);
  process.exit(1);
}
// スキーマに合っていても、BotHost に要るものが入っているか
const svc = (data.services || []).find((s) => s.name === 'bothost');
if (!svc) { console.error('✗ bothost のサービスがありません'); process.exit(1); }
for (const [k, v] of Object.entries({ runtime: 'docker', healthCheckPath: '/api/health' })) {
  if (svc[k] !== v) { console.error(`✗ ${k} が ${v} ではありません`); process.exit(1); }
}
for (const f of ['dockerfilePath', 'dockerContext']) {
  if (!fs.existsSync(require('path').resolve(require('path').dirname(yamlFile), svc[f]))) {
    console.error(`✗ ${f} (${svc[f]}) がありません`); process.exit(1);
  }
}
console.log(`✓ ${yamlFile} は Render のスキーマ (${draft || 'draft 不明'}) に合っています`);
