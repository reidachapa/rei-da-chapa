const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { valorDevido } = require('../order-adjustments.js');

function caixa() {
  const arquivo = path.join(__dirname, '../monthly-cash.js');
  assert.ok(fs.existsSync(arquivo), 'o cálculo do Caixa deve existir');
  return require(arquivo);
}

test('Caixa considera o mês de Brasília e separa compras pagas e a pagar', () => {
  const { calcular } = caixa();
  const pedidos = [
    { id: 'fora', status: 'finalizado', pago: true, data: '2026-11-01T02:59:59.999Z', total: 99 },
    { id: 'um', status: 'finalizado', pago: true, data: '2026-11-01T03:00:00Z', total: 106, taxaEntrega: 6, pagamentos: { pix: 53, credito: 53 } },
    { id: 'dois', status: 'entregue', pago: true, data: '2026-12-01T02:59:59.999Z', total: 0.1 },
    { id: 'seguinte', status: 'finalizado', pago: true, data: '2026-12-01T03:00:00Z', total: 99 },
    { id: 'cancelado', status: 'cancelado', pago: true, data: '2026-11-10', total: 99 },
    { id: 'pendente', status: 'preparando', pago: true, data: '2026-11-10', total: 99 },
    { id: 'a-receber', status: 'finalizado', pago: false, pagamento: 'pendente', data: '2026-11-10', total: 99 },
  ];
  const compras = [
    { id: '1', tipoRegistro: 'compra', status: 'pago', data: '2026-11-01', valor: 88 },
    { id: '2', tipoRegistro: 'compra', status: 'pago', data: '2026-11-30', valor: 15 },
    { id: '3', tipoRegistro: 'compra', status: 'pendente', data: '2026-11-04', valor: 5 },
    { id: '4', tipoRegistro: 'despesa', status: 'pago', data: '2026-11-04', valor: 100 },
  ];
  const dados = { historico: [...pedidos, pedidos[1]], despesas: compras };
  const mes = calcular(dados, '2026-11', valorDevido);
  assert.deepEqual([mes.recebido, mes.comprado, mes.comprasPagas, mes.comprasAPagar, mes.despesasPagas, mes.saldo], [10010, 10800, 10300, 500, 10000, -10290]);
  assert.deepEqual(mes.porPagamento, { pix: 5000, credito: 5000, semForma: 10 });
  assert.deepEqual(mes.porOrigem, {
    dinheiro: { recebido: 0, pago: 0, saldo: 0 },
    banco: { recebido: 10000, pago: 0, saldo: 10000 },
    semOrigem: { recebido: 10, pago: 20300, saldo: -20290 },
  });
  assert.equal(mes.quantidadeVendas, 2);
  assert.equal(mes.porDia[30].recebido, 10);
  assert.equal(calcular(dados, '2027-01', valorDevido).temMovimento, false);
  assert.equal(calcular(dados, '2026-11', valorDevido).saldo, -10290);
});

test('Caixa desconta despesas avulsas pela data e origem do pagamento', () => {
  const { calcular } = caixa();
  const dados = { historico: [], despesas: [
    { tipoRegistro: 'despesa', data: '2026-10-25', pagoEm: '2026-11-01', status: 'pago', origemPagamento: 'banco', valor: 30.05 },
    { tipoRegistro: 'despesa', data: '2026-11-03', status: 'pago', origemPagamento: 'dinheiro', valor: 20 },
    { categoria: 'luz', data: '2026-11-04', valor: 7 },
    { tipoRegistro: 'despesa', notaCompraId: 'mista', data: '2026-11-04', status: 'pago', valor: 5 },
    { id: 'mista', tipoRegistro: 'compra', data: '2026-11-04', status: 'pago', valor: 12 },
  ] };
  const mes = calcular(dados, '2026-11', valorDevido);
  assert.equal(calcular(dados, '2026-10', valorDevido).saldo, 0);
  assert.equal(mes.despesasPagas, 5705);
  assert.equal(mes.comprasPagas, 1200);
  assert.equal(mes.saldo, -6905);
  assert.equal(mes.porOrigem.banco.pago, 3005);
  assert.equal(mes.porOrigem.dinheiro.pago, 2000);
  assert.equal(mes.porOrigem.semOrigem.pago, 1900);
  assert.equal(mes.porDia[1].despesasPagas, 3005);
  assert.equal(mes.temMovimento, true);
});

test('despesa avulsa a pagar aparece no mês do lançamento sem baixar o saldo', () => {
  const { calcular } = caixa();
  const dados = { historico: [], despesas: [
    { tipoRegistro: 'despesa', data: '2026-11-24', status: 'pendente', valor: 60 },
  ] };
  const mes = calcular(dados, '2026-11', valorDevido);
  assert.equal(mes.temMovimento, true);
  assert.equal(mes.despesasAPagar, 6000);
  assert.equal(mes.despesasPagas, 0);
  assert.equal(mes.saldo, 0);
  assert.equal(calcular(dados, '2026-12', valorDevido).temMovimento, false);
});

test('Caixa separa pagamentos de meses distintos quando o histórico informa o valor recebido depois', () => {
  const { calcular } = caixa();
  const pedido = {
    id: 'venda', status: 'finalizado', pago: true, data: '2026-10-31T20:00:00-03:00', total: 100,
    pagoEm: '2026-11-01T15:00:00Z', pagamentos: { pix: 40, dinheiro: 60 },
    log: [{ status: 'pagamento_recebido', data: '2026-11-01T15:00:00Z', metodo: 'dinheiro', valor: 60 }],
  };
  const dados = { historico: [pedido], despesas: [] };
  const anterior = calcular(dados, '2026-10', valorDevido);
  const atual = calcular(dados, '2026-11', valorDevido);
  assert.equal(anterior.recebido, 4000);
  assert.deepEqual(anterior.porPagamento, { pix: 4000 });
  assert.equal(atual.recebido, 6000);
  assert.deepEqual(atual.porPagamento, { dinheiro: 6000 });
  assert.equal(anterior.porOrigem.banco.recebido, 4000);
  assert.equal(atual.porOrigem.dinheiro.recebido, 6000);
});

test('Caixa mantém os centavos de pagamento misto e reconcilia dinheiro, banco e sem origem', () => {
  const { calcular } = caixa();
  const venda = (id, total, pagamentos, taxaEntrega = 0) => ({
    id, total, pagamentos, taxaEntrega, status: 'finalizado', pago: true, data: '2026-11-10',
  });
  const compra = (id, valor, origemPagamento, status = 'pago') => ({
    id, valor, origemPagamento, status, tipoRegistro: 'compra', data: '2026-11-10',
  });
  const dados = {
    historico: [
      venda('mista', 106.01, { pix: 53.01, dinheiro: 53 }, 6),
      venda('cartoes', 10, { debito: 2, credito: 3, cartao: 5 }),
      venda('outra-forma', 4, { vale: 4 }),
    ],
    despesas: [
      compra('especie', 20, 'dinheiro'),
      compra('bancaria', 35, 'banco'),
      compra('legada', 11),
      compra('desconhecida', 1, 'boleto'),
      compra('pendente', 40, 'dinheiro', 'pendente'),
    ],
  };
  const mes = calcular(dados, '2026-11', valorDevido);
  assert.deepEqual(mes.porOrigem, {
    dinheiro: { recebido: 5000, pago: 2000, saldo: 3000 },
    banco: { recebido: 6001, pago: 3500, saldo: 2501 },
    semOrigem: { recebido: 400, pago: 1200, saldo: -800 },
  });
  assert.equal(mes.comprasAPagar, 4000);
  const origens = Object.values(mes.porOrigem);
  assert.equal(origens.reduce((soma, origem) => soma + origem.recebido, 0), mes.recebido);
  assert.equal(origens.reduce((soma, origem) => soma + origem.pago, 0), mes.comprasPagas);
  assert.equal(origens.reduce((soma, origem) => soma + origem.saldo, 0), mes.saldo);
  assert.equal(mes.saldo, 4701);
});

test('Caixa mantém o mês ao navegar entre dezembro e janeiro', () => {
  const { diaBrasil, outroMes } = caixa();
  assert.equal(diaBrasil('2026-12-01T02:00:00Z'), '2026-11-30');
  assert.equal(outroMes('2026-12', 1), '2027-01');
  assert.equal(outroMes('2026-01', -1), '2025-12');
});
