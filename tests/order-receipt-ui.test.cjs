const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const AjustesPedido = require('../order-adjustments.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('var recebimentoEmAndamento=false');
const end = html.indexOf("$('#listaClientes').addEventListener", start);
assert(start >= 0 && end > start, 'real receipt UI source exists');
const code = html.slice(start, end);
const due = html.split('\n').find(line => line.startsWith('function valorDevidoPedido('));
const currencyStart = html.indexOf('function lerMoeda(');
const currencyEnd = html.indexOf('\n}', currencyStart) + 2;
const currencyCode = html.slice(currencyStart, currencyEnd);

function node(dataset = {}) {
  const classes = new Set();
  return {
    value: '', textContent: '', dataset, disabled: false,
    classList: { add(x) { classes.add(x); }, remove(x) { classes.delete(x); }, contains(x) { return classes.has(x); }, toggle(x, force) { if (force) classes.add(x); else classes.delete(x); } },
    addEventListener() {}, setAttribute() {},
  };
}
function original(extra = {}) {
  return {
    id: 'fiado', numero: 4, cliente: 'Cliente teste', total: 105, taxaEntrega: 5,
    subtotal: 100, custoTotal: 40, lucro: 60, pago: false, pagamento: 'pendente',
    pagamentos: {}, saldoDevido: 105, itens: [{ nome: 'Lanche', preco: 50, qtd: 2 }],
    ...extra,
  };
}
function harness(pedido = original(), save = async () => ({ ok: true })) {
  const records = [structuredClone(pedido), structuredClone(pedido)];
  const nodes = {};
  for (const id of ['modalReceberPagamento', 'inpAjusteReceber', 'labelAjusteReceber', 'receberSaldoAnterior', 'receberAjusteLabel', 'receberValorAjuste', 'receberTotal', 'receberErro', 'receberResumo', 'btnFecharReceber']) nodes['#' + id] = node();
  const types = [node({ ajuste: 'juros' }), node({ ajuste: 'desconto' })];
  const methods = ['pix', 'dinheiro', 'debito', 'credito'].map(metodo => node({ metodoRecebimento: metodo }));
  const $ = selector => { assert(nodes[selector], 'known test UI node: ' + selector); return nodes[selector]; };
  const $$ = selector => {
    if (selector === '#opcoesAjusteReceber [data-ajuste]') return types;
    if (selector === '#modalReceberPagamento [data-metodo-recebimento]') return methods;
    if (selector === '#modalReceberPagamento button, #modalReceberPagamento input') return [...types, ...methods, nodes['#btnFecharReceber'], nodes['#inpAjusteReceber']];
    throw new Error('Unexpected selector: ' + selector);
  };
  const messages = [];
  const stats = { saves: 0, renders: 0 };
  const deps = { $, $$, records, messages, stats, save, AjustesPedido };
  const app = new Function('deps', `
    var $=deps.$,$$=deps.$$,window={AjustesPedido:deps.AjustesPedido};
    var console={error(){}};
    var PAGAMENTO_LABEL={pix:{txt:'Pix'}};
    function registrosPedidoPorId(id){return deps.records.filter(p=>String(p.id)===String(id))}
    function numeroPedidoExibicao(p){return p.numero}
    function moeda(v){return 'R$ '+Number(v).toFixed(2).replace('.',',')}
    function formatarMoedaDigitada(v){return v}
    function toast(msg){deps.messages.push(msg)}
    function salvar(){deps.stats.saves++;return deps.save()}
    function renderTudo(){deps.stats.renders++}
    function renderClientes(){} function renderHistorico(){} function renderDRE(){}
    ${currencyCode}
    ${due}
    ${code}
    return {abrirModalReceberPedido,fecharModalReceber,definirTipoAjusteReceber,atualizarCalculoRecebimento,confirmarRecebimentoPedido};
  `)(deps);
  function adjust(tipo, valor) { app.definirTipoAjusteReceber(tipo); nodes['#inpAjusteReceber'].value = valor; app.atualizarCalculoRecebimento(); }
  return { app, records, nodes, methods, stats, messages, adjust };
}

test('prévia de recebimento calcula juros e cancelamento mantém pedidos intactos', () => {
  const h = harness();
  const antes = structuredClone(h.records);
  h.app.abrirModalReceberPedido('fiado');
  h.adjust('juros', '10,00');
  assert.equal(h.nodes['#receberTotal'].textContent, 'R$ 115,00');
  assert.equal(h.stats.saves, 0);
  assert.deepEqual(h.records, antes);
  h.app.fecharModalReceber();
  assert(!h.nodes['#modalReceberPagamento'].classList.contains('aberto'));
  assert.deepEqual(h.records, antes);
});

test('desconto inválido mostra erro e bloqueia confirmação sem salvar', async () => {
  const h = harness();
  h.app.abrirModalReceberPedido('fiado');
  h.adjust('desconto', '100,01');
  assert.match(h.nodes['#receberErro'].textContent, /desconto máximo/);
  assert(h.methods.every(b => b.disabled));
  await h.app.confirmarRecebimentoPedido('pix');
  assert.equal(h.stats.saves, 0);
  assert.equal(h.records[0].total, 105);
});

test('recebimento confirmado atualiza todas as cópias do pedido com valores e auditoria', async () => {
  const h = harness();
  h.app.abrirModalReceberPedido('fiado');
  h.adjust('juros', '10,00');
  await h.app.confirmarRecebimentoPedido('pix');
  assert.equal(h.stats.saves, 1);
  assert.equal(h.stats.renders, 1);
  assert(!h.nodes['#modalReceberPagamento'].classList.contains('aberto'));
  for (const p of h.records) {
    assert.equal(p.total, 115);
    assert.equal(p.subtotal, 110);
    assert.equal(p.lucro, 70);
    assert.equal(p.jurosPedido, 10);
    assert.equal(p.pago, true);
    assert.equal(p.saldoDevido, 0);
    assert.deepEqual(p.pagamentos, { pix: 115 });
    assert.equal(p.ajustesRecebimento.at(-1).valor, 10);
    assert.equal(p.log.at(-1).status, 'pagamento_recebido');
    assert.equal(p.itens[0].nome, 'Lanche');
  }
});

test('cliques repetidos durante gravação confirmam somente um recebimento', async () => {
  let confirmar;
  const h = harness(original(), () => new Promise(resolve => { confirmar = resolve; }));
  h.app.abrirModalReceberPedido('fiado');
  h.adjust('juros', '10,00');
  const primeiro = h.app.confirmarRecebimentoPedido('pix');
  const segundo = h.app.confirmarRecebimentoPedido('dinheiro');
  assert.equal(h.stats.saves, 1);
  assert(h.methods.every(b => b.disabled));
  h.app.fecharModalReceber();
  assert(h.nodes['#modalReceberPagamento'].classList.contains('aberto'), 'não fecha no meio da gravação');
  confirmar({ ok: true });
  await Promise.all([primeiro, segundo]);
  assert.equal(h.stats.saves, 1);
  assert.deepEqual(h.records[0].pagamentos, { pix: 115 });
});

for (const mode of ['retorno sem confirmação', 'exceção de rede']) {
  test('falha em ' + mode + ' restaura valores e remove campos que antes não existiam', async () => {
    const h = harness(original(), mode === 'exceção de rede' ? async () => { throw new Error('offline'); } : async () => ({ ok: false }));
    const antes = structuredClone(h.records);
    assert(!Object.hasOwn(h.records[0], 'jurosPedido'));
    h.app.abrirModalReceberPedido('fiado');
    h.adjust('juros', '10,00');
    await h.app.confirmarRecebimentoPedido('pix');
    assert.deepEqual(h.records, antes);
    assert(h.nodes['#modalReceberPagamento'].classList.contains('aberto'));
    assert.equal(h.stats.saves, 1);
    assert(h.messages.some(m => /Não consegui confirmar/.test(m)));
    assert(!h.methods.some(b => b.disabled));
  });
}

test('mudança de saldo desde a abertura exige conferir valores antes de salvar', async () => {
  const h = harness();
  h.app.abrirModalReceberPedido('fiado');
  h.adjust('juros', '10,00');
  for (const p of h.records) { p.total = 125; p.subtotal = 120; p.saldoDevido = 125; }
  const atualizado = structuredClone(h.records);
  await h.app.confirmarRecebimentoPedido('pix');
  assert.equal(h.stats.saves, 0);
  assert.deepEqual(h.records, atualizado);
  assert(h.messages.some(m => /mudou em outro aparelho/.test(m)));
  assert.equal(h.nodes['#inpAjusteReceber'].value, '');
  assert.equal(h.nodes['#receberTotal'].textContent, 'R$ 125,00');
});

const mergeStart = html.indexOf('function clonarDadosEstado(');
const mergeEnd = html.indexOf('window.notaCompraIgual=', mergeStart);
assert(mergeStart >= 0 && mergeEnd > mergeStart, 'real concurrent merge source exists');
const merge = new Function(html.slice(mergeStart, mergeEnd) + ';return mesclarEstadosConcorrentes;')();
function state(p = original()) { return { porLoja: { loja: { pedidos: [], historico: [p], despesas: [], produtos: [], ingredientes: [], paes: [] } } }; }
const stored = s => s.porLoja.loja.historico[0];

test('dois aparelhos recebendo a mesma dívida em métodos distintos geram conflito, não dois pagamentos', () => {
  const base = state(), local = structuredClone(base), remoto = structuredClone(base);
  Object.assign(stored(local), AjustesPedido.prepararRecebimento(stored(local), { tipo: 'juros', valor: 5, metodo: 'pix', data: '2026-11-15T12:00:00Z' }));
  Object.assign(stored(remoto), AjustesPedido.prepararRecebimento(stored(remoto), { tipo: 'juros', valor: 5, metodo: 'dinheiro', data: '2026-11-15T12:00:01Z' }));
  const antes = structuredClone({ base, local, remoto });
  assert.throws(() => merge(base, local, remoto), /Conflito simultâneo/);
  assert.throws(() => merge(base, remoto, local), /Conflito simultâneo/);
  assert.deepEqual({ base, local, remoto }, antes);
});

test('replay da mesma confirmação de recebimento é idempotente', () => {
  const base = state(), local = structuredClone(base);
  Object.assign(stored(local), AjustesPedido.prepararRecebimento(stored(local), { tipo: 'juros', valor: 5, metodo: 'pix', data: '2026-11-15T12:00:00Z' }));
  const remoto = structuredClone(local);
  const result = merge(base, local, remoto);
  assert.deepEqual(stored(result), stored(local));
  assert.equal(stored(result).jurosPedido, 5);
  assert.deepEqual(stored(result).pagamentos, { pix: 110 });
  assert.equal(stored(result).ajustesRecebimento.length, 1);
  assert.equal(stored(result).log.length, 1);
});
