const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'America/Sao_Paulo';
const modulePath = path.join(__dirname, '../dre-periods.js');
const periodos = fs.existsSync(modulePath) ? require(modulePath) : {};
const agora = new Date('2026-11-15T18:30:00-03:00');

function api() {
  assert.equal(typeof periodos.periodo, 'function', 'o módulo oferece os períodos do DRE');
  assert.equal(typeof periodos.data, 'function', 'o módulo interpreta datas financeiras');
  assert.equal(typeof periodos.mesesDisponiveis, 'function', 'o módulo reúne os meses dos registros');
  return periodos;
}

function limites(filtro, referencia = agora) {
  const periodo = api().periodo(filtro, referencia);
  return [periodo.ini.toISOString(), periodo.fim.toISOString(), periodo.label];
}

test('mês inclui o primeiro e o último dia, incluindo despesas futuras de novembro', () => {
  const p = api().periodo('mes', agora);
  assert.deepEqual(limites('mes'), ['2026-11-01T03:00:00.000Z', '2026-12-01T03:00:00.000Z', 'Este mês']);
  const despesas = ['2026-10-31', '2026-11-01', '2026-11-30', '2026-12-01'];
  assert.deepEqual(despesas.filter(valor => {
    const d = periodos.data(valor);
    return d >= p.ini && d < p.fim;
  }), ['2026-11-01', '2026-11-30']);
});

test('filtro ausente ou inválido volta ao mês atual', () => {
  for (const filtro of [undefined, null, '', 'inexistente', 'custom-2026-00', 'custom-2026-13', 'custom-2026-1', 'custom-2026-11-extra']) {
    assert.deepEqual(limites(filtro), ['2026-11-01T03:00:00.000Z', '2026-12-01T03:00:00.000Z', 'Este mês']);
  }
});

test('hoje e ontem usam os limites dos dias locais', () => {
  assert.deepEqual(limites('hoje'), ['2026-11-15T03:00:00.000Z', '2026-11-16T03:00:00.000Z', 'Hoje']);
  assert.deepEqual(limites('ontem'), ['2026-11-14T03:00:00.000Z', '2026-11-15T03:00:00.000Z', 'Ontem']);
});

test('sete dias incluem hoje e os seis dias anteriores através da virada do ano', () => {
  assert.deepEqual(limites('semana', new Date('2027-01-03T10:00:00-03:00')),
    ['2026-12-28T03:00:00.000Z', '2027-01-04T03:00:00.000Z', 'Últimos 7 dias']);
});

test('períodos diários seguem o calendário durante o início do horário de verão brasileiro', () => {
  const referencia = new Date('2018-11-04T12:00:00-02:00');
  const p = api().periodo('hoje', referencia);
  assert.equal(p.ini.getDate(), 4);
  assert.equal(p.fim.getDate(), 5);
  assert.equal(p.fim.getHours(), 0);
  assert.equal(p.fim.getTime() - p.ini.getTime(), 23 * 60 * 60 * 1000);
});

test('ano inclui janeiro até dezembro e exclui os anos vizinhos', () => {
  const p = api().periodo('ano', agora);
  assert.deepEqual(limites('ano'), ['2026-01-01T03:00:00.000Z', '2027-01-01T03:00:00.000Z', 'Este ano']);
  const datas = ['2025-12-31', '2026-01-01', '2026-12-31', '2027-01-01'];
  assert.deepEqual(datas.filter(valor => {
    const d = periodos.data(valor);
    return d >= p.ini && d < p.fim;
  }), ['2026-01-01', '2026-12-31']);
});

test('mês escolhido aceita fevereiro bissexto e vira dezembro para janeiro', () => {
  assert.deepEqual(limites('custom-2024-02'), ['2024-02-01T03:00:00.000Z', '2024-03-01T03:00:00.000Z', 'Fevereiro de 2024']);
  assert.deepEqual(limites('custom-2026-12'), ['2026-12-01T03:00:00.000Z', '2027-01-01T03:00:00.000Z', 'Dezembro de 2026']);
});

test('tudo inclui registros antigos e futuros sem aplicar o mês padrão', () => {
  const p = api().periodo('todos', agora);
  assert.equal(p.label, 'Todo o período');
  for (const valor of ['1900-01-01', '2026-11-30', '2300-12-31']) {
    const d = periodos.data(valor);
    assert(d >= p.ini && d < p.fim, valor);
  }
});

test('datas sem hora mantêm o dia local ao meio-dia', () => {
  const d = api().data('2026-11-01');
  assert.equal(d.toISOString(), '2026-11-01T15:00:00.000Z');
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 12);
  assert.equal(periodos.data('2024-02-29').getDate(), 29);
});

test('datas impossíveis e formatos ambíguos não viram lançamentos de outro dia', () => {
  for (const valor of ['', null, undefined, 0, '15/11/2026', '2026-2-01', '2026-02-29', '2026-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '2026-11-00', '2026-11-31', '2026-02-30T12:00:00Z', '2026-11-15T25:00:00Z', '2026-11-15T12:60:00Z']) {
    assert.equal(api().data(valor), null, String(valor));
  }
});

test('timestamps ISO preservam o instante do fuso informado', () => {
  assert.equal(api().data('2026-11-15T12:34:56.123Z').toISOString(), '2026-11-15T12:34:56.123Z');
  assert.equal(periodos.data('2026-11-15T12:34:56-03:00').toISOString(), '2026-11-15T15:34:56.000Z');
  assert.equal(periodos.data('2026-11-01T01:00:00Z').getMonth(), 9, 'o instante ainda pertence a outubro em São Paulo');
});

test('Date válida é copiada e Date inválida é rejeitada', () => {
  const original = new Date('2026-11-15T12:00:00Z');
  const copia = api().data(original);
  assert.notEqual(copia, original);
  assert.equal(copia.getTime(), original.getTime());
  assert.equal(periodos.data(new Date('inválida')), null);
});

test('meses disponíveis incluem despesas, perdas e patrimônio sem vendas', () => {
  assert.deepEqual(api().mesesDisponiveis({
    historico: [],
    despesas: [{ data: '2026-09-20' }, { data: '2026-09-30' }, { data: '2027-01-15' }],
    perdas: [{ data: '2026-08-25T12:00:00Z' }],
    bensEmpresa: [{ data: '2026-10-03' }, { data: '2026-07-03' }],
  }, agora), ['2027-01', '2026-11', '2026-10', '2026-09', '2026-08', '2026-07']);
});

test('meses de vendas usam a finalização e respeitam o mês local dos timestamps', () => {
  assert.deepEqual(api().mesesDisponiveis({ historico: [
    { finalizadoEm: '2026-10-01T01:00:00Z', data: '2026-08-31T12:00:00Z' },
    { data: '2026-06-12T12:00:00Z' },
  ] }, agora), ['2026-11', '2026-09', '2026-06']);
});

test('meses disponíveis ignoram dados inválidos e mantêm o mês atual sem registros', () => {
  assert.deepEqual(api().mesesDisponiveis(undefined, agora), ['2026-11']);
  assert.deepEqual(periodos.mesesDisponiveis({ historico: null, despesas: [null, {}, { data: '2026-02-30' }], perdas: {}, bensEmpresa: [{ data: '' }] }, agora), ['2026-11']);
});

test('carregamento no navegador publica a API PeriodosDRE', () => {
  const contexto = { Date };
  vm.runInNewContext(fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '', contexto);
  assert.equal(typeof contexto.PeriodosDRE, 'object');
  assert.equal(contexto.PeriodosDRE.data('2026-11-01').getDate(), 1);
});
