const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const inicio = html.indexOf('  async function retomarRascunhoCompra() {');
const fim = html.indexOf('  function abrirRascunhoCompraAusente(', inicio);
assert(inicio >= 0 && fim > inicio);
const funcao = html.slice(inicio, fim);

test('retoma a compra nova pela mesma chave UUID e mantém o sinal de retomada', async () => {
  const chaveRascunho = 'rei_chapa_rascunho_compra_v1:l1:nova-abc';
  const registro = { editId: null, operacao: 'nova', retomarAoVoltar: true, campos: { despNF: '123' }, itens: [{ nome: 'Água' }] };
  let abertura = null;
  const context = {
    chaveNovaCompraSeparada: null,
    window: {
      __authPermitido: true,
      setTimeout(fn) { fn(); },
      abrirModalDespesa(nota) { abertura = { nota, chave: context.chaveNovaCompraSeparada }; },
    },
    document: { querySelector(selector) { return selector === '.view.ativo' ? { id: 'view-compras' } : null; } },
    souGerente: () => true, estaAberto: () => false,
    carregarRascunhosServidor: async () => ({ ok: true }),
    localizarRascunhoParaRetomar: () => ({ chave: chaveRascunho, registro }),
    ehCompraNovaRascunho: () => true, lojaAtual: () => 'l1',
    chave: (_, id) => id == null ? 'rei_chapa_rascunho_compra_v1:l1:nova' : id,
    salvarFlagRetomada() { throw new Error('O rascunho novo não deve perder a marca de retomada antes de abrir'); },
  };
  vm.createContext(context);
  vm.runInContext(funcao, context);
  await context.retomarRascunhoCompra();
  assert.deepEqual(abertura, { nota: null, chave: chaveRascunho });
  assert.equal(registro.retomarAoVoltar, true);
});

test('não cancela a gravação agendada de um rascunho anterior', async () => {
  const start = html.indexOf('  async function arquivarRascunhoSemBloquearNovaCompra(');
  const end = html.indexOf('  async function carregarRascunhosServidor(', start);
  assert(start >= 0 && end > start);
  const registro = { rascunhoAtualizadoEm: 42, campos: { despNF: '123' } };
  let chamadasServidor = 0;
  const contexto = {
    idDispositivo: 'aparelho', window: { __authPermitido: true },
    supa: { from() { chamadasServidor++; throw new Error('não deve consultar o servidor'); } },
    lerChave: () => registro, dadosIguais: (a, b) => a === b,
    temporizadoresRemotos: new Map([['chave', 1]]), gravacoesRemotas: new Map(), versoesConfirmadas: new Map(),
  };
  vm.createContext(contexto);
  vm.runInContext(html.slice(start, end), contexto);
  assert.equal(await contexto.arquivarRascunhoSemBloquearNovaCompra('chave', registro), false);
  assert.equal(contexto.temporizadoresRemotos.get('chave'), 1);
  assert.equal(chamadasServidor, 0);
});

test('não arquiva rascunho antigo cuja gravação não foi confirmada', async () => {
  const start = html.indexOf('  async function arquivarRascunhoSemBloquearNovaCompra(');
  const end = html.indexOf('  async function carregarRascunhosServidor(', start);
  const registro = { rascunhoAtualizadoEm: 42, campos: { despNF: '123' } };
  let chamadasServidor = 0;
  const contexto = {
    idDispositivo: 'aparelho', window: { __authPermitido: true },
    supa: { from() { chamadasServidor++; throw new Error('não deve consultar o servidor'); } },
    lerChave: () => registro, dadosIguais: (a, b) => a === b,
    temporizadoresRemotos: new Map(), gravacoesRemotas: new Map(), versoesConfirmadas: new Map([['chave', 41]]),
  };
  vm.createContext(contexto);
  vm.runInContext(html.slice(start, end), contexto);
  assert.equal(await contexto.arquivarRascunhoSemBloquearNovaCompra('chave', registro), false);
  assert.equal(chamadasServidor, 0);
});
