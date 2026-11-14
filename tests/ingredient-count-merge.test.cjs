const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('function clonarDadosEstado(');
const end = html.indexOf('window.notaCompraIgual=', start);
assert(start >= 0 && end > start);
const merge = new Function(html.slice(start, end) + ';return mesclarEstadosConcorrentes;')();
const copy = value => structuredClone(value);

function fixture() {
  return { porLoja: { l1: {
    ingredientes: [
      { id: 'tomate', nome: 'Tomate', semEstoque: true, estoqueEstimado: 10, custo: 2,
        consumoMedia: true, contagemEstoqueId: 'inicio', inicioContagemKg: 10,
        comprasDesdeContagem: 0, perdasDesdeContagem: 0, pesoVendidoDesdeContagem: 0,
        pesoHistorico: 0, kgHistorico: 0, fatorConsumoMedia: 0 },
      { id: 'cebola', nome: 'Cebola', semEstoque: true, estoqueEstimado: 0, custo: 2 },
    ], despesas: [], pedidos: [], historico: [],
  } } };
}
const shop = state => state.porLoja.l1;
const ing = state => shop(state).ingredientes[0];
function compra(state, id, item = 'tomate', qtd = 3) {
  const alvo = shop(state).ingredientes.find(i => i.id === item);
  alvo.estoqueEstimado += qtd;
  if (alvo.consumoMedia) alvo.comprasDesdeContagem += qtd;
  shop(state).despesas.push({ id, tipoRegistro: 'compra', itens: [
    { nome: alvo.nome, qtd, valor: 2, vinc: 'ing:' + item,
      aplicado: { vinc: 'ing:' + item, qtdEst: qtd, custoUnitario: 2, semEstoque: true } },
  ] });
}
function venda(state, id, qtd = 1) {
  ing(state).estoqueEstimado -= qtd;
  ing(state).pesoVendidoDesdeContagem += qtd;
  shop(state).pedidos.push({ id, itens: [{ ingrediente: 'tomate', qtd }] });
}
function contagem(state, id, saldo = 3.4) {
  Object.assign(ing(state), { contagemEstoqueId: id, estoqueEstimado: saldo,
    inicioContagemKg: saldo, comprasDesdeContagem: 0, perdasDesdeContagem: 0,
    pesoVendidoDesdeContagem: 0 });
}

test('movimentos incrementais de compra e venda continuam somando entre aparelhos', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  compra(local, 'compra-local'); venda(remoto, 'pedido-remoto');
  const resultado = merge(base, local, remoto);
  assert.equal(ing(resultado).estoqueEstimado, 12);
  assert.equal(ing(resultado).comprasDesdeContagem, 3);
  assert.equal(ing(resultado).pesoVendidoDesdeContagem, 1);
  assert.deepEqual(shop(resultado).despesas, shop(local).despesas);
  assert.deepEqual(shop(resultado).pedidos, shop(remoto).pedidos);
});

test('contagem absoluta concorre com venda sem ser somada como delta de estoque', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'contagem-local');
  compra(local, 'compra-outro-item', 'cebola');
  venda(remoto, 'pedido-remoto');
  const antes = copy({ base, local, remoto });
  assert.throws(() => merge(base, local, remoto), /Conflito simultâneo.*contagem/i);
  assert.deepEqual({ base, local, remoto }, antes);
  assert.throws(() => merge(base, remoto, local), /Conflito simultâneo.*contagem/i);
});

test('duas contagens distintas não se tornam uma terceira quantidade', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'contagem-1', 4); contagem(remoto, 'contagem-2', 5);
  compra(local, 'compra-local', 'cebola'); compra(remoto, 'compra-remota', 'cebola');
  assert.throws(() => merge(base, local, remoto), /Conflito simultâneo.*contagem/i);
});

test('contagem preserva notas independentes e metadados alterados no outro aparelho', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'contagem-local');
  ing(remoto).marca = 'Marca nova';
  compra(remoto, 'nota-nova', 'cebola');
  const resultado = merge(base, local, remoto);
  assert.equal(ing(resultado).estoqueEstimado, 3.4);
  assert.equal(ing(resultado).contagemEstoqueId, 'contagem-local');
  assert.equal(ing(resultado).marca, 'Marca nova');
  assert.deepEqual(shop(resultado).despesas, shop(remoto).despesas);
});

test('replay da mesma contagem é idempotente mesmo havendo compras independentes', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'mesma-contagem'); contagem(remoto, 'mesma-contagem');
  compra(local, 'compra-local', 'cebola'); compra(remoto, 'compra-remota', 'cebola');
  const resultado = merge(base, local, remoto);
  assert.equal(ing(resultado).estoqueEstimado, 3.4);
  assert.equal(ing(resultado).inicioContagemKg, 3.4);
  assert.equal(shop(resultado).despesas.length, 2);
});

test('movimento de contador sem mudar saldo também conflita com contagem', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'contagem-local');
  ing(remoto).pesoVendidoDesdeContagem = 2;
  assert.throws(() => merge(base, local, remoto), /Conflito simultâneo.*contagem/i);
});

test('alteração somente de controle ou marca não é confundida com movimento', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'contagem-local');
  ing(remoto).semEstoque = false;
  const resultado = merge(base, local, remoto);
  assert.equal(ing(resultado).estoqueEstimado, 3.4);
  assert.equal(ing(resultado).semEstoque, false);
});

test('mesmo identificador com saldos diferentes exige revisão em vez de escolher um saldo', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'mesma-contagem', 3.4); contagem(remoto, 'mesma-contagem', 3.3);
  assert.throws(() => merge(base, local, remoto), /Conflito simultâneo.*contagem/i);
});

test('perda compensada por compra ainda conflita mesmo se o saldo não mudou', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'contagem-local');
  ing(remoto).comprasDesdeContagem = 1;
  ing(remoto).perdasDesdeContagem = 1;
  assert.throws(() => merge(base, local, remoto), /Conflito simultâneo.*contagem/i);
});

test('primeira contagem do cadastro legado preserva edição de marca no outro aparelho', () => {
  const base = fixture(); delete ing(base).contagemEstoqueId;
  const local = copy(base), remoto = copy(base);
  contagem(local, 'primeira-contagem', 0.2);
  ing(remoto).marca = 'Marca independente';
  const resultado = merge(base, local, remoto);
  assert.equal(ing(resultado).estoqueEstimado, 0.2);
  assert.equal(ing(resultado).marca, 'Marca independente');
});

test('mudar apenas a opção de média não simula um movimento físico', () => {
  const base = fixture(), local = copy(base), remoto = copy(base);
  contagem(local, 'contagem-local'); ing(remoto).consumoMedia = false;
  const resultado = merge(base, local, remoto);
  assert.equal(ing(resultado).estoqueEstimado, 3.4);
  assert.equal(ing(resultado).consumoMedia, false);
});
