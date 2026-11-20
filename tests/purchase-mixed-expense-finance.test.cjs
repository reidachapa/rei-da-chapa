const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const PrecosCompra = require('../purchase-pricing.js');
const CaixaMensal = require('../monthly-cash.js');
const VencimentosCompras = require('../purchase-payables.js');

const notaMista = {
  id: 'nota-mista', tipoRegistro: 'compra', data: '2026-11-20',
  nf: '015', fornecedor: 'Fornecedor', status: 'pendente', vencimento: '2026-12-20',
  descontoTipo: 'percent', descontoOriginal: 10, desconto: 10, valor: 90,
  itens: [
    { tipoItem: 'prod', nome: 'Refrigerante', qtd: 2, valor: 30, vinc: 'prod:refri' },
    { tipoItem: 'ing', nome: 'Queijo', qtd: 2, valor: 10 },
    { tipoItem: 'despesa', nome: 'Limpeza', qtd: 1, valor: 25, descontoOriginal: 20, descontoTipo: 'percent', categoriaFinanceira: 'limpeza' },
  ],
};

test('projeção de estoque ignora a despesa e rateia o desconto sobre a nota inteira', () => {
  const projecao = PrecosCompra.calcular({
    itens: notaMista.itens.map(it => ({ ...it, desconto: it.descontoOriginal })),
    descontoNota: 10,
  });
  assert.equal(projecao.grupos.length, 2);
  assert.equal(projecao.porIndice[2], null);
  assert.equal(projecao.porIndice[0].custoMedio, 27);
  assert.equal(projecao.porIndice[1].custoMedio, 9);
});

test('valores efetivos da nota se dividem entre compras e despesas em centavos', () => {
  assert.deepEqual(PrecosCompra.separarValoresDaCompra(notaMista), {
    estoqueCentavos: 7200,
    despesas: [{ indice: 2, valorCentavos: 1800 }],
  });
});

test('rateio com frações de centavo fecha no total salvo', () => {
  const nota = { tipoRegistro: 'compra', desconto: 0.01, valor: 0.02, itens: [
    { tipoItem: 'prod', qtd: 1, valor: 0.01 },
    { tipoItem: 'despesa', qtd: 1, valor: 0.01 },
    { tipoItem: 'despesa', qtd: 1, valor: 0.01 },
  ] };
  assert.deepEqual(PrecosCompra.separarValoresDaCompra(nota), {
    estoqueCentavos: 1,
    despesas: [{ indice: 1, valorCentavos: 0 }, { indice: 2, valorCentavos: 1 }],
  });
});

test('o DRE lança só a parte da despesa na categoria financeira da compra', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const inicio = html.indexOf('function despesasVinculadasDeCompra(');
  const fim = html.indexOf('function totalizarDespesasOperacionais(', inicio);
  const separar = new Function('window', `${html.slice(inicio, fim)}\nreturn separarDespesasDRE;`)({ PrecosCompra });
  const nota = {
    ...notaMista,
    itens: notaMista.itens.map((it, indice) => indice === 0 ? { ...it, aplicado: { qtdEst: 2 } } : it),
  };
  const { comprasEstoque, despesasOperacionais } = separar([nota]);
  assert.equal(comprasEstoque[0].valor, 72);
  assert.deepEqual(despesasOperacionais.map(d => [d.notaCompraId, d.categoria, d.status, d.valor]), [
    ['nota-mista', 'limpeza', 'pendente', 18],
  ]);
});

test('o caixa e os boletos usam uma vez o valor integral da nota mista', () => {
  const calcular = nota => CaixaMensal.calcular({ historico: [], despesas: [nota] }, '2026-11', () => 0);
  const pendente = calcular(notaMista);
  assert.equal(pendente.quantidadeCompras, 1);
  assert.equal(pendente.comprasAPagar, 9000);
  assert.equal(pendente.saldo, 0);
  assert.equal(VencimentosCompras.listarPendentes([notaMista], '2026-12-16').length, 1);
  const pago = calcular({ ...notaMista, status: 'pago', origemPagamento: 'banco' });
  assert.equal(pago.comprasPagas, 9000);
  assert.equal(pago.porOrigem.banco.pago, 9000);
  assert.equal(pago.saldo, -9000);
});
