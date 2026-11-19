const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('a tela exibe custo médio e margem com duas casas', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inicio = html.indexOf('function formatarDecimalCompra(');
  const fim = html.indexOf('\nfunction normalizarNomeCadastro', inicio);
  assert(inicio >= 0 && fim > inicio, 'formatador de precisão de compras não encontrado');
  const formatador = new Function(html.slice(inicio, fim) + '\nreturn formatarDecimalCompra;')();
  assert.equal(formatador(12.3969), '12,40');
  assert.equal(formatador(90), '90,00');
  assert.equal(formatador(37.5678), '37,57');
  assert.equal(formatador(33.333333), '33,33');
});
