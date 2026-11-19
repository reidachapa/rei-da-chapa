const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function vencimentos() {
  const modulo = path.join(__dirname, '../purchase-payables.js');
  assert.ok(fs.existsSync(modulo), 'as regras de vencimento devem existir');
  return require(modulo);
}

test('o atalho conta 30 dias corridos a partir da compra', () => {
  const { somarDias } = vencimentos();
  assert.equal(somarDias('2026-11-19', 30), '2026-12-19');
  assert.equal(somarDias('2024-01-30', 30), '2024-02-29');
  assert.equal(somarDias('2026-12-20', 30), '2027-01-19');
  assert.equal(somarDias('2026-02-30', 30), '');
});

test('pendências de qualquer mês aparecem em ordem de vencimento, com as sem data no fim', () => {
  const { listarPendentes } = vencimentos();
  const notas = [
    { id: 'sem-data', tipoRegistro: 'compra', data: '2026-08-01', status: 'pendente' },
    { id: 'longe', tipoRegistro: 'compra', data: '2026-11-10', status: 'pendente', vencimento: '2027-01-07' },
    { id: 'paga', tipoRegistro: 'compra', status: 'pago', vencimento: '2026-11-19' },
    { id: 'proxima', tipoRegistro: 'compra', data: '2026-10-26', status: 'pendente', vencimento: '2026-11-26' },
    { id: 'vencida', tipoRegistro: 'compra', data: '2026-09-10', status: 'pendente', vencimento: '2026-11-18' },
    { id: 'hoje', tipoRegistro: 'compra', status: 'pendente', vencimento: '2026-11-19' },
    { id: 'despesa', tipoRegistro: 'despesa', status: 'pendente', vencimento: '2026-11-19' },
  ];
  assert.deepEqual(listarPendentes(notas, '2026-11-19').map(item => [item.nota.id, item.situacao, item.dias]), [
    ['vencida', 'vencido', -1], ['hoje', 'hoje', 0], ['proxima', 'proximo', 7],
    ['longe', 'futuro', 49], ['sem-data', 'semData', null],
  ]);
});
