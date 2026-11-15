const assert = require('node:assert/strict');
const test = require('node:test');
const { calcularFechamento, prepararRecebimento, resumo } = require('../order-adjustments.js');

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
