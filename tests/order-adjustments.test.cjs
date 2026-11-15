const assert = require('node:assert/strict');
const test = require('node:test');
const { calcularFechamento, prepararRecebimento, simularRecebimento, resumo } = require('../order-adjustments.js');

const data = '2026-11-15T12:00:00.000Z';
function pedido(extra = {}) {
  return {
    id: 'pedido-fiado', subtotalBruto: 100, descontoPedido: 0, jurosPedido: 0,
    subtotal: 100, taxaEntrega: 5, total: 105, custoTotal: 40, lucro: 60,
    pago: false, pagamento: 'pendente', pagamentos: {}, saldoDevido: 105,
    itens: [{ nome: 'Lanche', preco: 50, qtd: 2 }], log: [],
    ...extra,
  };
}

test('fechamento soma juros e entrega ao valor dos itens', () => {
  const r = calcularFechamento({ subtotalBruto: 100, jurosPedido: 8.5, taxaEntrega: 5 });
  assert.equal(r.subtotalBruto, 100);
  assert.equal(r.descontoPedido, 0);
  assert.equal(r.jurosPedido, 8.5);
  assert.equal(r.subtotal, 108.5);
  assert.equal(r.total, 113.5);
});

test('desconto de fechamento não reduz a taxa repassada ao motoboy', () => {
  const r = calcularFechamento({ subtotalBruto: 20, descontoPedido: 40, taxaEntrega: 5 });
  assert.equal(r.descontoPedido, 20);
  assert.equal(r.subtotal, 0);
  assert.equal(r.total, 5);
});

test('cálculo usa centavos também com parcelas decimais e juros', () => {
  const r = calcularFechamento({ subtotalBruto: 0.1 + 0.2, descontoPedido: 0.1, jurosPedido: 0.2, taxaEntrega: 0.1 });
  assert.equal(r.subtotal, 0.4);
  assert.equal(r.total, 0.5);
});

test('juros ao receber uma dívida inteira ficam registrados no pedido e no pagamento', () => {
  const original = pedido();
  const antes = structuredClone(original);
  const r = prepararRecebimento(original, { tipo: 'juros', valor: 10, metodo: 'pix', data });
  assert.notEqual(r, original);
  assert.deepEqual(original, antes, 'calcular antes de confirmar/cancelar não altera o pedido original');
  assert.equal(r.jurosPedido, 10);
  assert.equal(r.subtotalBruto, 100);
  assert.equal(r.subtotal, 110);
  assert.equal(r.total, 115);
  assert.equal(r.lucro, 70);
  assert.deepEqual(r.pagamentos, { pix: 115 });
  assert.equal(r.pagamento, 'pix');
  assert.equal(r.pago, true);
  assert.equal(r.saldoDevido, 0);
  assert.equal(r.pagoEm, data);
  assert.equal(r.ajustesRecebimento.at(-1).tipo, 'juros');
  assert.equal(r.ajustesRecebimento.at(-1).valor, 10);
  assert.equal(r.ajustesRecebimento.at(-1).data, data);
  assert.deepEqual(r.itens, antes.itens);
});

test('juros existentes no fiado não são cobrados duas vezes no recebimento', () => {
  const original = pedido({ jurosPedido: 8, subtotal: 108, total: 113, saldoDevido: 113, lucro: 68 });
  const r = prepararRecebimento(original, { tipo: 'juros', valor: 2, metodo: 'dinheiro', data });
  assert.equal(r.jurosPedido, 10);
  assert.equal(r.total, 115);
  assert.deepEqual(r.pagamentos, { dinheiro: 115 });
  assert.equal(r.lucro, 70);
});

test('recebimento parcial acrescenta juros só ao saldo e preserva valores já pagos', () => {
  const original = pedido({ pagamento: 'pix', pagamentos: { pix: 65 }, saldoDevido: 40 });
  const r = prepararRecebimento(original, { tipo: 'juros', valor: 2.5, metodo: 'dinheiro', data });
  assert.equal(r.total, 107.5);
  assert.deepEqual(r.pagamentos, { pix: 65, dinheiro: 42.5 });
  assert.equal(r.pagamento, 'misto');
  assert.equal(r.saldoDevido, 0);
});

test('pagamento do saldo no mesmo método soma ao valor anterior', () => {
  const r = prepararRecebimento(pedido({ pagamento: 'pix', pagamentos: { pix: 65 }, saldoDevido: 40 }), { tipo: 'desconto', valor: 5, metodo: 'pix', data });
  assert.equal(r.total, 100);
  assert.equal(r.descontoPedido, 5);
  assert.equal(r.subtotal, 95);
  assert.equal(r.lucro, 55);
  assert.deepEqual(r.pagamentos, { pix: 100 });
  assert.equal(r.pagamento, 'pix');
});

test('desconto no recebimento reduz primeiro juros e preserva a taxa de entrega', () => {
  const original = pedido({ jurosPedido: 10, subtotal: 110, total: 115, saldoDevido: 115 });
  const r = prepararRecebimento(original, { tipo: 'desconto', valor: 110, metodo: 'pix', data });
  assert.equal(r.jurosPedido, 0);
  assert.equal(r.descontoPedido, 100);
  assert.equal(r.subtotal, 0);
  assert.equal(r.total, 5);
  assert.deepEqual(r.pagamentos, { pix: 5 });
  assert.equal(r.ajustesRecebimento.at(-1).tipo, 'desconto');
  assert.equal(r.ajustesRecebimento.at(-1).valor, 110);
});

test('desconto não pode exceder saldo devido nem apagar taxa de entrega', () => {
  assert.throws(() => prepararRecebimento(pedido(), { tipo: 'desconto', valor: 100.01, metodo: 'pix', data }));
  assert.throws(() => prepararRecebimento(pedido({ pagamento: 'pix', pagamentos: { pix: 65 }, saldoDevido: 40 }), { tipo: 'desconto', valor: 40.01, metodo: 'pix', data }));
});

test('pedido legado pendente ignora os valores de pagamento que não foram recebidos', () => {
  const r = prepararRecebimento(pedido({ pagamentos: { pix: 105 } }), { tipo: 'juros', valor: 5, metodo: 'dinheiro', data });
  assert.equal(r.total, 110);
  assert.deepEqual(r.pagamentos, { dinheiro: 110 });
});

test('sem ajuste quita exatamente o valor existente, inclusive pedido legado sem subtotalBruto', () => {
  const original = pedido({ subtotalBruto: undefined, subtotal: 98, descontoPedido: 2, total: 103, saldoDevido: 103 });
  const r = prepararRecebimento(original, { tipo: 'juros', valor: 0, metodo: 'credito', data });
  assert.equal(r.total, 103);
  assert.equal(r.subtotal, 98);
  assert.deepEqual(r.pagamentos, { credito: 103 });
});

test('novo recebimento é recusado em pedido já pago', () => {
  assert.throws(() => prepararRecebimento(pedido({ pago: true, saldoDevido: 0, pagamentos: { pix: 105 } }), { tipo: 'juros', valor: 5, metodo: 'pix', data }));
});

test('valor inválido não muda dívida nem pagamentos', () => {
  for (const valor of [-1, NaN, Infinity, -Infinity, 'invalido']) {
    const original = pedido();
    const antes = structuredClone(original);
    assert.throws(() => prepararRecebimento(original, { tipo: 'juros', valor, metodo: 'pix', data }));
    assert.deepEqual(original, antes);
  }
  assert.throws(() => prepararRecebimento(pedido(), { tipo: 'outro', valor: 1, metodo: 'pix', data }));
  assert.throws(() => prepararRecebimento(pedido(), { tipo: 'juros', valor: 1, metodo: 'outro', data }));
});

test('total manual menor que os juros salvos é recusado sem marcar quitação incompleta', () => {
  const original = pedido({ total: 5, subtotal: 5, subtotalBruto: 0, taxaEntrega: 0, jurosPedido: 10, saldoDevido: 5 });
  const antes = structuredClone(original);
  assert.throws(() => prepararRecebimento(original, { tipo: 'juros', valor: 0, metodo: 'pix', data }));
  assert.deepEqual(original, antes);
});

test('total manual menor que taxa salva é recusado antes de registrar o recebimento', () => {
  const original = pedido({ total: 3, subtotal: 0, subtotalBruto: 0, taxaEntrega: 5, saldoDevido: 3 });
  const antes = structuredClone(original);
  assert.throws(() => prepararRecebimento(original, { tipo: 'juros', valor: 0, metodo: 'dinheiro', data }));
  assert.deepEqual(original, antes);
});

test('desconto antigo não permite total menor que juros registrados após edição manual', () => {
  const original = pedido({ total: 5, subtotal: 5, subtotalBruto: 15, descontoPedido: 20, jurosPedido: 10, taxaEntrega: 0, saldoDevido: 5 });
  const antes = structuredClone(original);
  assert.throws(() => prepararRecebimento(original, { tipo: 'juros', valor: 0, metodo: 'pix', data }));
  assert.deepEqual(original, antes);
});

test('resumo legado reconstrói itens brutos retirando juros do subtotal líquido', () => {
  const original = pedido({ subtotalBruto: undefined, descontoPedido: 2, jurosPedido: 8, subtotal: 108, total: 113, saldoDevido: 113 });
  const financeiro = resumo(original);
  assert.equal(financeiro.subtotalBruto, 102);
  assert.equal(financeiro.descontoPedido, 2);
  assert.equal(financeiro.jurosPedido, 8);
  assert.equal(financeiro.subtotal, 108);
  assert.equal(financeiro.total, 113);
  const recebido = prepararRecebimento(original, { tipo: 'juros', valor: 0, metodo: 'pix', data });
  assert.equal(recebido.subtotalBruto, 102);
  assert.equal(recebido.total, 113);
  assert.deepEqual(recebido.pagamentos, { pix: 113 });
});

test('recebimento aplica desconto e juros separados ao mesmo saldo e registra os dois ajustes', () => {
  const original = pedido();
  const antes = structuredClone(original);
  const previa = simularRecebimento(original, { desconto: 10, juros: 5 });
  assert.equal(previa.desconto, 10);
  assert.equal(previa.juros, 5);
  assert.equal(previa.totalReceber, 100);
  assert.deepEqual(original, antes, 'simular e cancelar não alteram o pedido');
  const r = prepararRecebimento(original, { desconto: 10, juros: 5, metodo: 'pix', data });
  assert.equal(r.total, 100);
  assert.equal(r.subtotal, 95);
  assert.equal(r.descontoPedido, 10);
  assert.equal(r.jurosPedido, 5);
  assert.equal(r.lucro, 55);
  assert.deepEqual(r.pagamentos, { pix: 100 });
  assert.deepEqual(r.ajustesRecebimento.map(a => [a.tipo, a.valor]), [['desconto', 10], ['juros', 5]]);
  assert(r.ajustesRecebimento.every(a => a.data === data && a.valorRecebido === 100));
  assert.deepEqual(original, antes);
});

test('desconto e juros novos preservam os recebimentos parciais e quitam só o saldo ajustado', () => {
  const r = prepararRecebimento(pedido({ pagamento: 'pix', pagamentos: { pix: 65 }, saldoDevido: 40 }), { desconto: 5, juros: 2, metodo: 'dinheiro', data });
  assert.equal(r.total, 102);
  assert.equal(r.subtotal, 97);
  assert.equal(r.descontoPedido, 5);
  assert.equal(r.jurosPedido, 2);
  assert.deepEqual(r.pagamentos, { pix: 65, dinheiro: 37 });
  assert.equal(r.pago, true);
  assert.equal(r.saldoDevido, 0);
});

test('desconto separado reduz produtos antes de abater juros antigos e conserva os novos juros', () => {
  const original = pedido({ jurosPedido: 8, subtotal: 108, total: 113, saldoDevido: 113 });
  const r = prepararRecebimento(original, { desconto: 10, juros: 5, metodo: 'credito', data });
  assert.equal(r.descontoPedido, 10);
  assert.equal(r.jurosPedido, 13);
  assert.equal(r.total, 108);
  assert.deepEqual(r.pagamentos, { credito: 108 });
  const esgotado = prepararRecebimento(original, { desconto: 108, juros: 5, metodo: 'pix', data });
  assert.equal(esgotado.descontoPedido, 100);
  assert.equal(esgotado.jurosPedido, 5);
  assert.equal(esgotado.total, 10, 'mantém taxa de 5 e os juros novos de 5');
});

test('juros novos não ampliam limite de desconto nem permitem descontar a taxa', () => {
  const original = pedido();
  assert.throws(() => prepararRecebimento(original, { desconto: 100.01, juros: 50, metodo: 'pix', data }));
  const r = prepararRecebimento(original, { desconto: 100, juros: 5, metodo: 'pix', data });
  assert.equal(r.total, 10);
  assert.equal(r.taxaEntrega, 5);
  assert.equal(r.jurosPedido, 5);
});

test('ambos ajustes mantêm centavos exatos e zero permite receber sem novos ajustes', () => {
  const r = prepararRecebimento(pedido(), { desconto: 0.1 + 0.2, juros: 0.2, metodo: 'pix', data });
  assert.equal(r.descontoPedido, 0.3);
  assert.equal(r.jurosPedido, 0.2);
  assert.equal(r.total, 104.9);
  assert.deepEqual(r.pagamentos, { pix: 104.9 });
  const semAjuste = prepararRecebimento(pedido(), { desconto: 0, juros: 0, metodo: 'pix', data });
  assert.equal(semAjuste.total, 105);
  assert.deepEqual(semAjuste.ajustesRecebimento, []);
});

test('cada campo rejeita valores inválidos e o formato novo não se mistura ao legado', () => {
  for (const valor of [-1, NaN, Infinity, 'invalido']) {
    assert.throws(() => simularRecebimento(pedido(), { desconto: valor, juros: 0 }));
    assert.throws(() => simularRecebimento(pedido(), { desconto: 0, juros: valor }));
  }
  assert.throws(() => simularRecebimento(pedido(), { desconto: 2, juros: 3, tipo: 'desconto', valor: 2 }));
});
