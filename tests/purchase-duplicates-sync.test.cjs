const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const PrecosCompra = require('../purchase-pricing.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const modulePath = path.join(__dirname, '../purchase-duplicates.js');
const ComprasDuplicadas = fs.existsSync(modulePath) ? require(modulePath) : undefined;
const helpersStart = html.indexOf('function clonarDadosEstado(');
const helpersEnd = html.indexOf('window.notaCompraIgual=', helpersStart);
const syncStart = html.indexOf('async function subirParaServidor(');
const syncEnd = html.indexOf('window.__subirSupabase=', syncStart);
const saveStart = html.indexOf('async function salvarCompraDaNota(');
const saveEnd = html.indexOf('// Um único ponto de gravação controla', saveStart);
assert(helpersStart >= 0 && helpersEnd > helpersStart && syncStart >= 0 && syncEnd > syncStart);
const helpers = html.slice(helpersStart, helpersEnd);
const syncScript = html.slice(syncStart, syncEnd);
const copy = value => JSON.parse(JSON.stringify(value));

function nota(id, extra = {}) {
  return {
    id, tipoRegistro: 'compra', data: '2026-11-15', nf: '123', fornecedor: 'Bora BB',
    categoria: 'compras', status: 'pago', obs: '', desconto: 0,
    descontoTipo: 'valor', descontoOriginal: 0, valor: 12,
    itens: [{ nome: 'Suco Goiaba', marca: 'Marca', tipoItem: 'prod', vinc: 'prod:p1',
      qtd: 6, unid: 'un', valor: 2, desconto: 0, descontoOriginal: 0, descontoTipo: 'valor',
      aplicado: { vinc: 'prod:p1', qtdEst: 6, custoUnitario: 2 } }],
    ...extra,
  };
}

function loja() {
  return { produtos: [{ id: 'p1', nome: 'Suco Goiaba', estoque: 0, custo: 2 }],
    despesas: [], ingredientes: [], paes: [], pedidos: [], historico: [], clientes: [] };
}
function estado() { return { porLoja: { l1: loja(), l2: loja() } }; }
function adicionar(dados, compra, lojaId = 'l1') {
  dados.porLoja[lojaId].despesas.push(copy(compra));
  dados.porLoja[lojaId].produtos[0].estoque += compra.itens[0].qtd;
}

function servidor(base) {
  const server = { dados: copy(base), versao: 'versao-inicial', gravacoes: [], tentativas: [], tick: 0 };
  server.supa = {
    from(table) {
      assert.equal(table, 'estado');
      return {
        update(payload) {
          const filtros = {};
          const query = {
            eq(chave, valor) { filtros[chave] = valor; return query; },
            async select(colunas) {
              assert.equal(colunas, 'id'); assert.equal(filtros.id, 'atual');
              server.tentativas.push({ versao: filtros.atualizado_em, dados: copy(payload.dados) });
              if (filtros.atualizado_em !== server.versao) return { data: [], error: null };
              server.dados = copy(payload.dados); server.versao = payload.atualizado_em;
              server.gravacoes.push(copy(server.dados));
              return { data: [{ id: 'atual' }], error: null };
            },
          };
          return query;
        },
        select(colunas) {
          assert.equal(colunas, '*');
          const query = {
            eq(chave, valor) { assert.equal(chave, 'id'); assert.equal(valor, 'atual'); return query; },
            async maybeSingle() { return { error: null, data: { id: 'atual', dados: copy(server.dados), atualizado_em: server.versao } }; },
          };
          return query;
        },
      };
    },
  };
  return server;
}

function aparelho(server, base, local, notaId = null) {
  let dadosLocal = copy(local);
  const avisos = [];
  const window = { __authPermitido: true, ComprasDuplicadas,
    __falharRascunhoCompraSincronizacao() {}, __confirmarRascunhoCompraSincronizado() {} };
  const context = vm.createContext({
    window, ComprasDuplicadas, supa: server.supa,
    estadoBaseSincronizado: copy(base), ultimaAtualizacao: 'versao-inicial',
    salvandoRemoto: false, salvarPendente: false, promessaSincronizacao: null,
    estadoLocalSujo: true, revisaoLocal: 1, notaCompraEmSincronizacaoId: notaId,
    atualizacoesProprias: new Set(),
    capturarEstado() { return copy(dadosLocal); },
    aplicarDadosEstadoAtual(dados) { dadosLocal = copy(dados); },
    toast(msg) { avisos.push(msg); },
    console: { warn() {} },
    setTimeout(fn, delay) { if (delay < 1000) queueMicrotask(fn); return 1; },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [1700000000000 + server.tick++])); } },
  });
  vm.runInContext(helpers + '\n' + syncScript, context);
  return { salvar: () => context.subirParaServidor(), avisos,
    semConferencia() { delete window.ComprasDuplicadas; },
    get dados() { return copy(dadosLocal); } };
}

test('dois aparelhos não gravam duas compras idênticas com IDs distintos nem somam estoque duas vezes', async () => {
  const base = estado(), localA = copy(base), localB = copy(base), server = servidor(base);
  adicionar(localA, nota('aparelho-a')); adicionar(localB, nota('aparelho-b'));
  const a = aparelho(server, base, localA, 'aparelho-a'), b = aparelho(server, base, localB, 'aparelho-b');
  const resultados = await Promise.all([a.salvar(), b.salvar()]);
  assert.equal(resultados.filter(r => r.ok).length, 1);
  const recusado = resultados.find(r => !r.ok);
  assert.equal(recusado.error.code, 'COMPRA_DUPLICADA');
  assert.equal(recusado.persisted, false);
  assert.equal(server.gravacoes.length, 1);
  assert.equal(server.dados.porLoja.l1.despesas.length, 1);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 6);
});

test('compras de números de nota diferentes continuam somando entre aparelhos', async () => {
  const base = estado(), localA = copy(base), localB = copy(base), server = servidor(base);
  adicionar(localA, nota('aparelho-a')); adicionar(localB, nota('aparelho-b', { nf: '124' }));
  const resultados = await Promise.all([
    aparelho(server, base, localA, 'aparelho-a').salvar(), aparelho(server, base, localB, 'aparelho-b').salvar(),
  ]);
  assert(resultados.every(r => r.ok));
  assert.equal(server.dados.porLoja.l1.despesas.length, 2);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 12);
});

test('a mesma nota criando produtos com IDs diferentes também é recusada no segundo aparelho', async () => {
  const base = estado(); base.porLoja.l1.produtos = [];
  const localA = copy(base), localB = copy(base), server = servidor(base);
  for (const [local, sufixo] of [[localA, 'a'], [localB, 'b']]) {
    const compra = nota('nota-' + sufixo);
    compra.itens[0].vinc = compra.itens[0].aplicado.vinc = 'prod:novo-' + sufixo;
    local.porLoja.l1.produtos.push({ id: 'novo-' + sufixo, nome: 'Suco Goiaba', estoque: 6, custo: 2 });
    local.porLoja.l1.despesas.push(compra);
  }
  const resultados = await Promise.all([
    aparelho(server, base, localA, 'nota-a').salvar(), aparelho(server, base, localB, 'nota-b').salvar(),
  ]);
  assert.equal(resultados.filter(r => r.ok).length, 1);
  assert.equal(resultados.find(r => !r.ok).error.code, 'COMPRA_DUPLICADA');
  assert.equal(server.dados.porLoja.l1.despesas.length, 1);
  assert.equal(server.dados.porLoja.l1.produtos.length, 1);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 6);
});

test('compras com quantidade diferente continuam independentes mesmo com NF e fornecedor iguais', async () => {
  const base = estado(), localA = copy(base), localB = copy(base), server = servidor(base);
  const diferente = nota('aparelho-b', { valor: 14 });
  diferente.itens[0].qtd = diferente.itens[0].aplicado.qtdEst = 7;
  adicionar(localA, nota('aparelho-a')); adicionar(localB, diferente);
  const resultados = await Promise.all([
    aparelho(server, base, localA, 'aparelho-a').salvar(), aparelho(server, base, localB, 'aparelho-b').salvar(),
  ]);
  assert(resultados.every(r => r.ok));
  assert.equal(server.dados.porLoja.l1.despesas.length, 2);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 13);
});

test('tentar novamente a mesma identidade já confirmada não duplica a nota ou o saldo', async () => {
  const base = estado(), local = copy(base), server = servidor(base);
  adicionar(local, nota('mesma-identidade'));
  const resultados = await Promise.all([
    aparelho(server, base, local, 'mesma-identidade').salvar(), aparelho(server, base, local, 'mesma-identidade').salvar(),
  ]);
  assert(resultados.every(r => r.ok));
  assert.equal(server.dados.porLoja.l1.despesas.length, 1);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 6);
});

test('duplicidades históricas não impedem salvar alteração de cliente nem apagam notas antigas', async () => {
  const base = estado(); adicionar(base, nota('antiga-a')); adicionar(base, nota('antiga-b'));
  const local = copy(base), server = servidor(base);
  local.porLoja.l1.clientes.push({ id: 'cliente-novo', nome: 'Cliente' });
  const resultado = await aparelho(server, base, local).salvar();
  assert.equal(resultado.ok, true);
  assert.deepEqual(server.dados.porLoja.l1.despesas, base.porLoja.l1.despesas);
  assert.equal(server.dados.porLoja.l1.clientes.length, 1);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 12);
});

test('uma segunda cópia local é recusada antes de tentar atualizar o servidor', async () => {
  const base = estado(); adicionar(base, nota('ja-salva'));
  const local = copy(base), server = servidor(base);
  adicionar(local, nota('nova-copia'));
  const resultado = await aparelho(server, base, local, 'nova-copia').salvar();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.error.code, 'COMPRA_DUPLICADA');
  assert.equal(server.tentativas.length, 0);
  assert.deepEqual(server.dados, base);
});

test('mudar só pagamento de uma nota antiga não bloqueia por duplicidade histórica', async () => {
  const base = estado(); adicionar(base, nota('antiga-a')); adicionar(base, nota('antiga-b'));
  const local = copy(base), server = servidor(base);
  local.porLoja.l1.despesas[0].status = 'pendente';
  const resultado = await aparelho(server, base, local, 'antiga-a').salvar();
  assert.equal(resultado.ok, true);
  assert.equal(server.dados.porLoja.l1.despesas[0].status, 'pendente');
  assert.equal(server.dados.porLoja.l1.despesas.length, 2);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 12);
});

test('notas idênticas em lojas diferentes são gravadas sem se bloquearem', async () => {
  const base = estado(), localA = copy(base), localB = copy(base), server = servidor(base);
  adicionar(localA, nota('loja-1'), 'l1'); adicionar(localB, nota('loja-2'), 'l2');
  const resultados = await Promise.all([
    aparelho(server, base, localA, 'loja-1').salvar(), aparelho(server, base, localB, 'loja-2').salvar(),
  ]);
  assert(resultados.every(r => r.ok));
  assert.equal(server.dados.porLoja.l1.despesas.length, 1);
  assert.equal(server.dados.porLoja.l2.despesas.length, 1);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 6);
  assert.equal(server.dados.porLoja.l2.produtos[0].estoque, 6);
});

test('editar uma nota para ficar igual a outra é recusado antes da gravação condicional', async () => {
  const base = estado(); adicionar(base, nota('nota-1')); adicionar(base, nota('nota-2', { nf: '124' }));
  const local = copy(base), server = servidor(base);
  local.porLoja.l1.despesas[0].nf = '124';
  const resultado = await aparelho(server, base, local, 'nota-1').salvar();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.error.code, 'COMPRA_DUPLICADA');
  assert.equal(server.tentativas.length, 0);
  assert.deepEqual(server.dados, base);
});

test('a atualização de uma nota com conteúdo diferente permanece permitida', async () => {
  const base = estado(); adicionar(base, nota('nota-1'));
  const local = copy(base), server = servidor(base), atualizada = local.porLoja.l1.despesas[0];
  atualizada.itens[0].qtd = atualizada.itens[0].aplicado.qtdEst = 8; atualizada.valor = 16;
  local.porLoja.l1.produtos[0].estoque = 8;
  const resultado = await aparelho(server, base, local, 'nota-1').salvar();
  assert.equal(resultado.ok, true);
  assert.equal(server.dados.porLoja.l1.despesas.length, 1);
  assert.equal(server.dados.porLoja.l1.produtos[0].estoque, 8);
});

test('falha ao carregar a conferência não permite uma gravação sem a proteção', async () => {
  const base = estado(), local = copy(base), server = servidor(base);
  adicionar(local, nota('rascunho-nao-enviado'));
  const app = aparelho(server, base, local, 'rascunho-nao-enviado');
  app.semConferencia();
  const resultado = await app.salvar();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.persisted, false);
  assert.match(resultado.error.message, /conferência.*não.*carregada/i);
  assert.equal(server.tentativas.length, 0);
  assert.deepEqual(server.dados, base);
  assert.deepEqual(app.dados, local, 'a falha não descarta a alteração local pendente');
});

function preflightLocal(itens) {
  const existente = nota('existente'), campos = {};
  for (const [id, value] of Object.entries({ despData: existente.data, despNF: existente.nf,
    despFornecedor: existente.fornecedor, despCategoria: existente.categoria, despSubcategoria: '',
    despObs: '', despStatus: 'pago', despDesconto: '0' })) campos[id] = { value };
  const mutacoes = [], mensagens = [];
  const context = vm.createContext({
    window: { ComprasDuplicadas, despItensTemp: copy(itens || existente.itens), editandoDespesaId: null,
      _descontoNotaTipo: 'valor', PrecosCompra: { calcular() { mutacoes.push('preço'); throw Error('preço não deveria ser calculado'); } } },
    document: { getElementById(id) { return campos[id] || null; } },
    despesas: [copy(existente)], despItensTemp: [], produtos: [], ingredientes: [], paes: [],
    editandoDespesaId: null, compraNotaEmAndamento: false, notaCompraEmSincronizacaoId: null,
    souGerente: () => true, buscarIngredienteCompra: () => null,
    lerMoeda: value => Number(value) || 0,
    lerDescontoNota: (value, tipo) => tipo === 'percent' ? PrecosCompra.lerPercentualNota(value) : Number(value) || 0,
    lojaAtivaId: 'l1', revisaoLocal: 0,
    toast(msg) { mensagens.push(msg); }, alert(msg) { mensagens.push(msg); }, console: { error() {} },
  });
  vm.runInContext(helpers + '\n' + html.slice(saveStart, saveEnd), context);
  return { context, mutacoes, mensagens };
}

test('o botão Salvar recusa cópia idêntica local antes de preço, estoque ou envio', async () => {
  const { context, mutacoes, mensagens } = preflightLocal();
  await context.salvarCompraDaNota();
  assert.deepEqual(mutacoes, []);
  assert.equal(context.despesas.length, 1);
  assert.equal(context.window.despItensTemp.length, 1, 'os itens digitados permanecem no formulário');
  assert(mensagens.some(msg => /igual|idêntica|já.*lançada|duplicad/i.test(msg)), 'a recusa explica a duplicidade');
});

test('a conferência local usa o desconto atualmente digitado, mesmo com descontoOriginal antigo', async () => {
  const itens = nota('copia').itens;
  itens[0].desconto = 2; itens[0].descontoOriginal = 0;
  const { context, mutacoes, mensagens } = preflightLocal(itens);
  await context.salvarCompraDaNota();
  assert.deepEqual(mutacoes, ['preço'], 'um desconto diferente segue para o cálculo normal');
  assert(!mensagens.some(msg => /já foi lançada/.test(msg)));
  assert.equal(context.window.despItensTemp[0].desconto, 2);
  assert.equal(context.window.despItensTemp[0].descontoOriginal, 0, 'conferir não modifica o objeto do rascunho');
});

test('desconto antigo removido não permite lançar uma cópia igual pelo valor atual', async () => {
  const itens = nota('copia').itens;
  itens[0].desconto = 0; itens[0].descontoOriginal = 2;
  const { context, mutacoes, mensagens } = preflightLocal(itens);
  await context.salvarCompraDaNota();
  assert.deepEqual(mutacoes, [], 'o desconto atual zero coincide com a nota existente');
  assert(mensagens.some(msg => /já foi lançada/.test(msg)));
  assert.equal(context.window.despItensTemp[0].descontoOriginal, 2, 'o bloqueio mantém o rascunho intacto');
});
