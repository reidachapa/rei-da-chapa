const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');

function carregarHelperEsc() {
  const start = html.indexOf('const esc=s=>');
  const end = html.indexOf('\n', start);
  assert(start >= 0 && end > start, 'o helper esc existe');
  const sandbox = {};
  vm.runInNewContext(`${html.slice(start, end)};globalThis.esc=esc;`, sandbox);
  return sandbox.esc;
}

function carregarEncoderReal() {
  const cpStart = html.indexOf('const cp850=');
  const cpEnd = html.indexOf(';', cpStart) + 1;
  const encodeStart = html.indexOf('function encode(str){');
  const encodeEnd = html.indexOf('\n', encodeStart);
  assert(cpStart >= 0 && cpEnd > cpStart, 'o mapa CP850 existe');
  assert(encodeStart >= 0 && encodeEnd > encodeStart, 'o encoder existe');
  const sandbox = {};
  vm.runInNewContext(`${html.slice(cpStart, cpEnd)}${html.slice(encodeStart, encodeEnd)};globalThis.encode=encode;`, sandbox);
  return (text) => Array.from(sandbox.encode(text));
}

test('esc transforma markup de ícone em texto inerte', () => {
  const esc = carregarHelperEsc();
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('renderers não interpolam ícones ou IDs brutos no HTML', () => {
  const rawIds = [...html.matchAll(/\$\{(?!esc\()[A-Za-z_$][\w$]*\.id\}/g)].map((match) => match[0]);
  assert.deepEqual(rawIds, [], `IDs sem escape: ${rawIds.join(', ')}`);

  const rawIdConcats = [...html.matchAll(/\+\s*((?:i|p|pao|d|c|e|m|b|ing))\.id\s*\+/g)]
    .map((match) => match[0]);
  assert.deepEqual(rawIdConcats, [], `IDs concatenados sem escape: ${rawIdConcats.join(', ')}`);

  const rawIcons = [...html.matchAll(/\$\{[^}]*\.icone[^}]*\}/g)]
    .map((match) => match[0])
    .filter((expression) => !expression.includes('esc('));
  assert.deepEqual(rawIcons, [], `ícones sem escape: ${rawIcons.join(', ')}`);
  assert.doesNotMatch(html, /\+\s*\([ip]\.icone\s*\|\|/i, 'listas auxiliares também escapam ícones');
  assert.doesNotMatch(html, /\$\{pgto\.txt\}/, 'rótulos de pagamento são escapados nos templates HTML');
});

test('encoder remove ESC, GS e controles sem perder newline nem caracteres suportados', () => {
  const encode = carregarEncoderReal();
  assert.deepEqual(encode('\x1B\x1D\x00A\ná🔒'), [32, 32, 32, 65, 10, 97, 63]);
  assert.deepEqual(encode('\x85\x9B\x7FZ'), [32, 32, 32, 90]);
  assert.deepEqual(encode('linha 1\r\nlinha 2\rlinha 3'), [108, 105, 110, 104, 97, 32, 49, 10, 108, 105, 110, 104, 97, 32, 50, 10, 108, 105, 110, 104, 97, 32, 51]);
});

test('migration revoga somente privilégios não usados sem alterar linhas', () => {
  const migrationPath = path.join('supabase', 'migrations', '20261113210000_restrict_unused_anon_privileges.sql');
  assert.equal(fs.existsSync(migrationPath), true, 'a migration local foi preparada');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /revoke\s+insert\s*,\s*delete\s*,\s*truncate\s*,\s*references\s*,\s*trigger\s+on\s+public\.estado\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+select\s*,\s*update\s+on\s+public\.estado\s+to\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /revoke\s+delete\s*,\s*truncate\s*,\s*references\s*,\s*trigger\s+on\s+public\.fila_impressao\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+public\.fila_impressao\s+to\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /revoke\s+delete\s*,\s*truncate\s*,\s*references\s*,\s*trigger\s+on\s+public\.fila_impressao_estacoes\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+public\.fila_impressao_estacoes\s+to\s+anon\s*,\s*authenticated/i);
  assert.doesNotMatch(sql, /delete\s+from|truncate\s+table|drop\s+table|update\s+public\./i, 'migration não altera conteúdo nem remove tabelas');
});

test('workflow de versão fixa a action externa em um commit imutável', () => {
  const workflow = fs.readFileSync('.github/workflows/atualizar-versao.yml', 'utf8');
  assert.match(workflow, /uses:\s*actions\/checkout@[0-9a-f]{40}\s+# v4\.4\.0/i);
});
