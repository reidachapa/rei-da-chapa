const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('a tela exibe custo médio e margem com até quatro casas sem alterar o preço em centavos', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inicio = html.indexOf('function formatarPrecisaoCompra(');
  const fim = html.indexOf('\nfunction normalizarNomeCadastro', inicio);
  assert(inicio >= 0 && fim > inicio, 'formatador de precisão de compras não encontrado');
  const formatador = new Function(html.slice(inicio, fim) + '\nreturn formatarPrecisaoCompra;')();
  assert.equal(formatador(12.3969), '12,3969');
  assert.equal(formatador(90), '90,00');
  assert.equal(formatador(37.5678), '37,5678');
  assert.equal(formatador(33.333333), '33,3333');
});
