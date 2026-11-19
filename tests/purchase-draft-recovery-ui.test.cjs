const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const RecuperacaoCompra = require('../purchase-draft-recovery.js');
const PrecosCompra = require('../purchase-pricing.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const mergeStart = html.indexOf('function clonarDadosEstado(');
const mergeEnd = html.indexOf('window.notaCompraIgual=', mergeStart);
const notaCompraIgual = new Function(html.slice(mergeStart, mergeEnd) + ';return notaCompraIgual;')();
const draftStart = html.indexOf('<script>', html.indexOf('<style id="rascunho-compra-proteger-atualizacao">')) + '<script>'.length;
const draftEnd = html.indexOf('</script>', draftStart);
assert(draftStart > 0 && draftEnd > draftStart, 'o módulo real de rascunho existe');
const draftScript = html.slice(draftStart, draftEnd);
const applyShopScript = html.slice(html.indexOf('function aplicarEstadoLoja('), html.indexOf('function salvarEstadoLojaAtivo('));
const applyStateScript = html.slice(html.indexOf('function aplicarDadosEstadoAtual('), html.indexOf('function hexToRgba('));
const saveScript = html.slice(html.indexOf('async function salvarCompraDaNota('), html.indexOf('// Um único ponto de gravação controla'));
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const key = id => 'rei_chapa_rascunho_compra_v1:l1:' + (id == null ? 'nova' : encodeURIComponent(id));

function nota(overrides = {}) {
  return {
    id: 'nota-1', tipoRegistro: 'compra', data: '2026-11-15', nf: '123',
    categoria: 'insumo', fornecedor: 'Fornecedor', status: 'pago', obs: '', valor: 100,
    itens: [{ nome: 'BORA BB', marca: 'BORA BB', qtd: 10, valor: 10, vinc: 'prod:p1' }],
    ...overrides,
  };
}

function classList() {
  const values = new Set();
  return {
    contains(name) { return values.has(name); },
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : !!force;
      if (enabled) values.add(name); else values.delete(name);
      return enabled;
    },
  };
}

function criarAmbiente({ notas = [], confirmadas = [], storage = new Map() } = {}) {
  const events = {};
  const windowEvents = {};
  const fields = Object.fromEntries([
    'despData', 'despNF', 'despCategoria', 'despSubcategoria', 'despFornecedor',
    'despStatus', 'despDesconto', 'despObs', 'despesaTitulo', 'btnSalvarDespesa',
  ].map(id => [id, { value: '', textContent: '', disabled: false }]));
  function element(tag) {
    const handlers = {};
    const node = {
      tagName: tag, children: [], style: {}, classList: classList(), scrollTop: 0,
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      querySelector() { return null; }, setAttribute(name, value) { this[name] = value; },
      addEventListener(name, fn) { handlers[name] = fn; },
      async click() { if (handlers.click) await handlers.click({ target: this }); if (this.onclick) await this.onclick({ target: this }); },
    };
    Object.defineProperty(node, 'innerHTML', { set() { this.children = []; } });
    return node;
  }
  const modal = element('div');
  fields.btnRetomarRascunhoCompra = element('button');
  function findNode(predicate, node = modal) {
    if (predicate(node)) return node;
    for (const child of node.children) { const found = findNode(predicate, child); if (found) return found; }
    return null;
  }
  const document = {
    hidden: false, body: { scrollTop: 0 },
    documentElement: { classList: classList(), scrollTop: 0 },
    getElementById(id) { return id === 'modalDespesa' ? modal : fields[id] || findNode(node => node.id === id); },
    createElement: element,
    querySelector(selector) { return selector === '.view.ativo' ? { id: 'view-compras' } : null; },
    addEventListener(name, fn) { (events[name] ||= []).push(fn); },
  };
  let serverNotes = copy(confirmadas);
  let freshServerNotes = copy(confirmadas);
  let readError = null;
  let beforeRead = null;
  const reads = [];
  const reviewRequests = [];
  const mutations = [];
  let context;
  const window = {
    __authPermitido: true, notaCompraIgual, RecuperacaoCompra, ComprasDuplicadas: require('../purchase-duplicates.js'), _descontoNotaTipo: 'valor',
    crypto: { randomUUID: () => 'dispositivo-de-teste' },
    __notaCompraConfirmadaNoServidor(id) {
      return copy(serverNotes.find(note => String(note.id) === String(id)) || null);
    },
    abrirModalDespesa(note) {
      const names = { despData: 'data', despNF: 'nf', despCategoria: 'categoria', despSubcategoria: 'subcategoria', despFornecedor: 'fornecedor', despStatus: 'status', despObs: 'obs' };
      for (const [id, prop] of Object.entries(names)) fields[id].value = note?.[prop] || '';
      if (!note) fields.despData.value = '2026-11-15';
      window.despItensTemp = copy(note?.itens || []);
      context.despItensTemp = window.despItensTemp;
      window.editandoDespesaId = context.editandoDespesaId = note?.id || null;
      modal.classList.add('aberto');
    },
    renderDespItens() {}, atualizarTotaisDesp() {}, toast() {},
    scrollY: 0, scrollTo() {},
    requestAnimationFrame(fn) { fn(); return 1; },
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
    addEventListener(name, fn) { (windowEvents[name] ||= []).push(fn); },
    sessionStorage: { getItem() { return null; }, removeItem() {} },
  };
  const localStorage = {
    get length() { return storage.size; },
    key(index) { return [...storage.keys()][index] || null; },
    getItem(name) { return storage.get(name) || null; },
    setItem(name, value) { storage.set(name, value); },
    removeItem(name) { storage.delete(name); },
  };
  // The real browser exposes both storage objects on window. These cases
  // exercise draft reconciliation after the initial server load, whose
  // separate behaviour is covered by the server-draft scenarios.
  window.localStorage = localStorage;
  window.__appMemoryStorage = localStorage;
  const render = () => {};
  const forbiddenMutation = name => () => { mutations.push(name); throw new Error('A revisão deve ocorrer antes de ' + name); };
  window.PrecosCompra = { calcular: forbiddenMutation('calcular preço') };
  const supa = {
    from(table) {
      const read = { table, columns: null, filters: [] };
      const query = {
        select(columns) { read.columns = columns; return query; },
        eq(column, value) { read.filters.push([column, value]); return query; },
        async maybeSingle() {
          reads.push(read);
          if (beforeRead) await beforeRead();
          return {
            error: readError,
            data: readError ? null : {
              atualizado_em: 'versao-conferida',
              dados: {
                lojas: [{ id: 'l1', nome: 'Loja de teste' }],
                porLoja: { l1: {
                  despesas: copy(freshServerNotes), produtos: [{ id: 'p1', estoque: 42, custo: 10 }],
                  ingredientes: [], paes: [], pedidos: [], historico: [], clientes: [],
                } },
              },
            },
          };
        },
      };
      return query;
    },
  };
  context = vm.createContext({
    window, document, localStorage, navigator: {}, console, supa,
    despesas: copy(notas), despItensTemp: [], editandoDespesaId: null, lojaAtivaId: 'l1',
    estadoLocalSujo: false, salvandoRemoto: false, compraNotaEmAndamento: false, revisaoLocal: 0,
    estadoBaseSincronizado: null, ultimaAtualizacao: 'versao-anterior',
    produtos: [{ id: 'p1', estoque: 10, custo: 8 }], estadoRemotoPorLoja: {}, lojas: [],
    sincronizarCategoriasPDV: render, sincronizarCategoriasFinanceiras: render,
    renderTudo: render, renderClientes: render, renderPaes: render,
    renderIngredientes: render, renderCompras: render, renderDRE: render,
    atualizarBotaoMotoboy: render, aplicarCorDaLoja: render, mesAtual: () => '2026-11',
    buscarIngredienteCompra: () => null, lerMoeda: value => Number(String(value || '').replace(',', '.')) || 0,
    lerDescontoNota: (value, tipo) => tipo === 'percent' ? PrecosCompra.lerPercentualNota(value) : Number(String(value || '').replace(',', '.')) || 0,
    toast: window.toast,
    reverterCompraEstoque: forbiddenMutation('reverter estoque'),
    aplicarCompraEstoque: forbiddenMutation('aplicar estoque'), salvar: forbiddenMutation('gravar compra'),
    souGerente: () => true, MutationObserver: class { observe() {} },
  });
  vm.runInContext(applyShopScript + '\n' + applyStateScript, context);
  vm.runInContext(saveScript, context);
  vm.runInContext(draftScript.replace('var rascunhosCarregados = false;', 'var rascunhosCarregados = true;'), context);
  return {
    window, fields, modal, storage, reads, reviewRequests, mutations,
    open(note) { window.abrirModalDespesa(copy(note)); },
    close() { modal.classList.remove('aberto'); },
    input() { for (const fn of events.input || []) fn({ type: 'input', target: {} }); },
    setNotes(notes) { context.despesas = copy(notes); },
    setConfirmed(notes) { serverNotes = copy(notes); },
    setServer(notes) { freshServerNotes = copy(notes); },
    setReadError(error) { readError = error; },
    onRead(fn) { beforeRead = fn; },
    setDirty(value) { context.estadoLocalSujo = value; },
    finishOtherSave({ revision = true, version = true } = {}) {
      if (revision) context.revisaoLocal++;
      if (version) context.ultimaAtualizacao = 'versao-do-outro-envio';
      context.produtos[0].estoque = 33;
      context.estadoLocalSujo = context.salvandoRemoto = false;
    },
    captureReviewPanel() { window.__mostrarRevisaoRascunhoCompra = id => { reviewRequests.push(id); }; },
    async authorize() { await Promise.all((windowEvents.reiChapaGerenteAutorizado || []).map(fn => fn())); },
    async resume() { await fields.btnRetomarRascunhoCompra.click(); },
    save() { return context.salvarCompraDaNota(); },
    button(text) { return findNode(node => node.tagName === 'button' && node.textContent === text); },
    get notes() { return copy(context.despesas); },
    get products() { return copy(context.produtos); },
    get version() { return context.ultimaAtualizacao; },
    get editId() { return context.editandoDespesaId; },
    get synchronizedBase() { return copy(context.estadoBaseSincronizado); },
    readDraft(id) { return copy(JSON.parse(storage.get(key(id)) || 'null')); },
    base() { return copy(window.__obterBaseNotaRascunho()); },
  };
}

function prepararSalvamentoParcial({ confirmado = true, outroLocal = null, outraConfirmada = null } = {}) {
  const anterior = nota();
  const salva = nota({ valor: 120, itens: [{ ...anterior.itens[0], valor: 12 }] });
  const app = criarAmbiente({ notas: [anterior], confirmadas: [anterior] });
  app.open(anterior);
  app.fields.despObs.value = 'Rascunho deste aparelho';
  app.input();
  app.setNotes([salva]);
  app.window.marcarRascunhoCompraPendente(anterior.id, salva.id);
  app.setNotes([outroLocal || salva]);
  app.setConfirmed(confirmado ? [outraConfirmada || salva] : [anterior]);
  app.window.__falharRascunhoCompraSincronizacao();
  return { app, anterior, salva };
}

function prepararRascunhoParaRevisao() {
  const anterior = nota();
  anterior.itens[0].aplicado = { vinc: 'prod:p1', qtdEst: 10, custoUnitario: 10 };
  anterior.itens[0]._indiceOriginalNota = 0;
  anterior.itens[0].preservarSaldoContado = true;
  const app = criarAmbiente({ notas: [anterior], confirmadas: [anterior] });
  app.open(anterior);
  app.fields.despObs.value = 'Alteração ainda não enviada';
  app.window.despItensTemp[0].qtd = 11;
  app.input();
  app.window.marcarRascunhoCompraPendente(anterior.id, anterior.id);
  app.window.__falharRascunhoCompraSincronizacao();
  return { app, anterior };
}

test('uma gravação própria confirmada libera a nova tentativa após falha posterior de sincronização', () => {
  const { app } = prepararSalvamentoParcial();
  assert.equal(app.base().valor, 120, 'a versão que este aparelho já confirmou passa a ser a base');
  assert.equal(app.readDraft('nota-1').baseNota.valor, 120, 'a correção persiste ao recarregar');
  assert.equal(app.fields.despObs.value, 'Rascunho deste aparelho');
  assert.equal(app.readDraft('nota-1').campos.despObs, 'Rascunho deste aparelho');
  assert.equal(app.readDraft('nota-1').itens[0].marca, 'BORA BB');
});

test('reabrir um rascunho existente conserva a correção da base sem apagar os campos locais', () => {
  const { app, salva } = prepararSalvamentoParcial();
  app.base();
  app.close();
  app.open(salva);
  assert.equal(app.base().valor, 120);
  assert.equal(app.fields.despObs.value, 'Rascunho deste aparelho');
  assert.equal(app.window.__obterIdRascunhoCompra(), 'nota-1');
});

test('recarregar o módulo recupera a gravação própria mesmo sem o acompanhamento pendente em memória', () => {
  const { app, salva } = prepararSalvamentoParcial();
  const recarregado = criarAmbiente({ notas: [salva], confirmadas: [salva], storage: app.storage });
  recarregado.open(salva);
  assert.equal(recarregado.base().valor, 120);
  assert.equal(recarregado.readDraft('nota-1').baseNota.valor, 120);
  assert.equal(recarregado.fields.despObs.value, 'Rascunho deste aparelho');
});

test('o rascunho de compra nova não passa a editar a nota enviada', () => {
  const app = criarAmbiente();
  const salva = nota();
  app.open(null);
  app.window.despItensTemp = copy(salva.itens);
  app.fields.despObs.value = 'Continuar esta compra';
  app.input();
  app.setNotes([salva]);
  app.window.marcarRascunhoCompraPendente(null, salva.id);
  app.setConfirmed([salva]);
  app.window.__falharRascunhoCompraSincronizacao();
  assert.equal(app.base()?.id, 'nota-1');
  assert.equal(app.window.__obterIdRascunhoCompra(), null);
  assert.equal(app.readDraft(null).campos.despObs, 'Continuar esta compra');
  assert.equal(app.readDraft('nota-1'), null, 'a recuperação mantém o rascunho ativo da compra nova');
});

test('uma alteração local diferente da nota enviada conserva a proteção contra sobrescrita', () => {
  const { app } = prepararSalvamentoParcial({ outroLocal: nota({ valor: 150 }) });
  assert.equal(app.base().valor, 100);
  assert.equal(app.readDraft('nota-1').baseNota.valor, 100);
  assert.equal(app.fields.despObs.value, 'Rascunho deste aparelho');
});

test('uma nota enviada sem confirmação do servidor não altera a base', () => {
  const { app } = prepararSalvamentoParcial({ confirmado: false });
  assert.equal(app.base().valor, 100);
  assert.equal(app.readDraft('nota-1').savedNote.valor, 120);
  assert.equal(app.readDraft('nota-1').baseNota.valor, 100);
});

test('uma versão diferente no servidor não é reconhecida como gravação própria', () => {
  const { app } = prepararSalvamentoParcial({ outraConfirmada: nota({ valor: 150 }) });
  assert.equal(app.base().valor, 100);
  assert.equal(app.readDraft('nota-1').baseNota.valor, 100);
});

test('abrir outra compra nova não herda a base nem a identidade do rascunho de edição', () => {
  const anterior = nota();
  const app = criarAmbiente({ notas: [anterior], confirmadas: [anterior] });
  app.open(anterior);
  app.input();
  app.close();
  app.open(null);
  assert.equal(app.base(), null);
  assert.equal(app.window.__obterIdRascunhoCompra(), null);
  assert.equal(app.readDraft('nota-1').baseNota.id, 'nota-1');
});

test('a comparação ignora somente metadados técnicos e continua distinguindo a marca', () => {
  const original = nota();
  const metadados = copy(original);
  metadados.criadoEm = '2026-11-15T10:00:00.000Z';
  metadados.itens[0].aplicado = { vinc: 'prod:p1', qtdEst: 10, custoUnitario: 10 };
  metadados.itens[0]._indiceOriginalNota = 0;
  assert.equal(notaCompraIgual(original, metadados), true);
  metadados.itens[0].marca = 'Outra marca';
  assert.equal(notaCompraIgual(original, metadados), false);
});

test('preparar explicitamente uma nota excluída como nova conserva o formulário e remove a identidade antiga', async () => {
  const { app } = prepararRascunhoParaRevisao();
  app.setServer([]);
  const resultado = await app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.nova, true);
  assert.equal(resultado.editId, null);
  assert.equal(app.editId, null);
  assert.equal(app.window.editandoDespesaId, null);
  assert.equal(app.window.__obterIdRascunhoCompra(), null);
  assert.equal(app.base(), null);
  const novo = app.readDraft(null);
  assert.equal(novo.editId, null);
  assert.equal(novo.savedRecordId, undefined);
  assert.equal(novo.savedNote, undefined);
  assert.equal(novo.syncPendente, undefined);
  assert.equal(novo.campos.despObs, 'Alteração ainda não enviada');
  assert.equal(novo.campos.despNF, '123');
  assert.equal(novo.itens[0].marca, 'BORA BB');
  assert.equal(novo.itens[0].qtd, 11);
  assert.equal(novo.itens[0].aplicado, undefined);
  assert.equal(novo.itens[0]._indiceOriginalNota, undefined);
  assert.equal(novo.itens[0].preservarSaldoContado, undefined);
  assert.equal(app.readDraft('nota-1').retomarAoVoltar, false, 'a cópia antiga continua guardada sem retomar automaticamente');
  assert.deepEqual(app.notes, [], 'preparar não lança uma compra no estado');
  assert.equal(app.products[0].estoque, 42, 'o saldo confirmado substitui a cópia local antes da próxima gravação');
  assert.equal(app.version, 'versao-conferida');
  assert.deepEqual(app.reads, [{ table: 'estado', columns: 'dados,atualizado_em', filters: [['id', 'atual']] }]);
});

test('preparar a atualização da nota refeita usa a versão atual e mantém os itens locais para revisão', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const refeita = nota({ id: 'nota-refeita', valor: 200 });
  app.setServer([refeita]);
  const resultado = await app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: refeita });
  assert.equal(resultado.nova, false);
  assert.equal(app.editId, 'nota-refeita');
  assert.equal(app.window.editandoDespesaId, 'nota-refeita');
  assert.equal(app.base().id, 'nota-refeita');
  assert.equal(app.base().valor, 200);
  assert.equal(app.readDraft('nota-refeita').baseNota.valor, 200);
  assert.equal(app.readDraft('nota-refeita').savedRecordId, undefined);
  assert.equal(app.readDraft('nota-refeita').itens[0].qtd, 11);
  assert.equal(app.window.despItensTemp[0].aplicado, undefined);
  assert.equal(app.fields.despObs.value, 'Alteração ainda não enviada');
  assert.equal(app.notes.length, 1);
  assert.equal(app.notes[0].valor, 200, 'a preparação não sobrescreve a nota salva');
  assert.equal(app.synchronizedBase.porLoja.l1.despesas[0].id, 'nota-refeita');
  assert.equal(app.reads.length, 1);
});

test('atualizar uma nota consulta a versão mais recente pelo mesmo ID e mantém as alterações do rascunho', async () => {
  const { app } = prepararRascunhoParaRevisao();
  app.setServer([nota({ valor: 150, obs: 'Alteração feita em outro aparelho' })]);
  const resultado = await app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', atualizarExistente: true });
  assert.equal(resultado.nova, false);
  assert.equal(resultado.editId, 'nota-1');
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.base().valor, 150);
  assert.equal(app.base().obs, 'Alteração feita em outro aparelho');
  assert.equal(app.readDraft('nota-1').baseNota.valor, 150);
  assert.equal(app.readDraft('nota-1').itens[0].qtd, 11);
  assert.equal(app.fields.despObs.value, 'Alteração ainda não enviada');
  assert.equal(app.notes[0].valor, 150, 'a consulta não grava nem duplica a nota');
  assert.equal(app.reads.length, 1);
});

test('atualizar uma nota apagada no servidor não converte o rascunho em compra nova', async () => {
  const { app } = prepararRascunhoParaRevisao();
  app.setServer([]);
  await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', atualizarExistente: true }), /não existe mais no servidor/);
  assert.equal(app.readDraft('nota-1').campos.despObs, 'Alteração ainda não enviada');
  assert.equal(app.readDraft('nota-1').itens[0].qtd, 11);
  assert.equal(app.readDraft(null), null);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.products[0].estoque, 10);
  assert.equal(app.window.__recuperacaoCompraEmAndamento, false);
});

test('uma nota refeita com o mesmo fornecedor, número e data impede preparar outra compra nova', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const antes = app.readDraft('nota-1');
  app.setServer([nota({ id: 'nota-refeita' })]);
  await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null }), /Já existe uma nota/);
  assert.deepEqual(app.readDraft('nota-1'), antes);
  assert.equal(app.readDraft(null), null);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.version, 'versao-anterior');
  assert.equal(app.window.__recuperacaoCompraEmAndamento, false);
});

test('a presença confirmada da nota original impede converter seu rascunho em compra nova', async () => {
  const { app, anterior } = prepararRascunhoParaRevisao();
  const antes = app.readDraft('nota-1');
  app.setServer([anterior]);
  await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null }), /nota original ainda existe/);
  assert.deepEqual(app.readDraft('nota-1'), antes);
  assert.equal(app.readDraft(null), null);
});

test('alterações locais aguardando confirmação impedem a leitura e preservam o rascunho', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const antes = app.readDraft('nota-1');
  app.setDirty(true);
  await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null }), /outras alterações/);
  assert.deepEqual(app.readDraft('nota-1'), antes);
  assert.equal(app.reads.length, 0);
  assert.equal(app.products[0].estoque, 10);
  assert.equal(app.window.__recuperacaoCompraEmAndamento, false);
});

test('uma alteração local durante a leitura cancela a revisão sem trocar a base ou perder o rascunho', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const antes = app.readDraft('nota-1');
  app.setServer([]);
  app.onRead(() => app.setDirty(true));
  await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null }), /mudaram durante a consulta/);
  assert.deepEqual(app.readDraft('nota-1'), antes);
  assert.equal(app.version, 'versao-anterior');
  assert.equal(app.products[0].estoque, 10);
});

test('um erro de leitura do servidor conserva a identidade, o rascunho e o estado locais', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const antes = app.readDraft('nota-1');
  app.setReadError(new Error('Sem conexão de teste'));
  await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null }), /Sem conexão de teste/);
  assert.deepEqual(app.readDraft('nota-1'), antes);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.version, 'versao-anterior');
  assert.equal(app.products[0].estoque, 10);
  assert.equal(app.window.__recuperacaoCompraEmAndamento, false);
});

test('uma nota que muda entre a exibição e a confirmação exige nova revisão', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const antes = app.readDraft('nota-1');
  const exibida = nota({ id: 'nota-refeita', valor: 200 });
  app.setServer([nota({ id: 'nota-refeita', valor: 250 })]);
  await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: exibida }), /mudou novamente/);
  assert.deepEqual(app.readDraft('nota-1'), antes);
  assert.equal(app.readDraft('nota-refeita'), null);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.products[0].estoque, 10);
});

test('trocar de nota enquanto a leitura está pendente não prepara nem limpa nenhum dos rascunhos', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const antes = app.readDraft('nota-1');
  app.setServer([]);
  let liberar;
  let iniciou;
  const pendente = new Promise(resolve => { liberar = resolve; });
  const leituraIniciada = new Promise(resolve => { iniciou = resolve; });
  app.onRead(() => { iniciou(); return pendente; });
  const preparacao = app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null });
  await leituraIniciada;
  app.open(nota({ id: 'outra-nota', nf: '456' }));
  app.fields.despObs.value = 'Rascunho da outra nota';
  app.input();
  const outro = app.readDraft('outra-nota');
  liberar();
  await assert.rejects(preparacao, /mudou de nota/);
  assert.deepEqual(app.readDraft('nota-1'), antes);
  assert.deepEqual(app.readDraft('outra-nota'), outro);
  assert.equal(app.readDraft(null), null);
  assert.equal(app.editId, 'outra-nota');
  assert.equal(app.fields.despObs.value, 'Rascunho da outra nota');
  assert.equal(app.products[0].estoque, 10);
});

test('retomar uma edição cuja nota sumiu reabre os campos sem abrir o painel de revisão', async () => {
  const { app } = prepararRascunhoParaRevisao();
  app.close();
  app.setNotes([]);
  app.setServer([]);
  app.captureReviewPanel();
  await app.authorize();
  assert.equal(app.modal.classList.contains('aberto'), false);
  await app.resume();
  assert.equal(app.modal.classList.contains('aberto'), true);
  assert.equal(app.fields.despObs.value, 'Alteração ainda não enviada');
  assert.equal(app.window.despItensTemp[0].qtd, 11);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.fields.btnSalvarDespesa.textContent, '🔄 Atualizar nota');
  assert.deepEqual(app.reviewRequests, []);
  await app.save();
  assert.deepEqual(app.reviewRequests, []);
  assert.equal(app.reads.length, 1);
  assert.deepEqual(app.mutations, []);
  assert.equal(app.readDraft('nota-1').itens[0].qtd, 11);
  assert.equal(app.readDraft(null), null);
});

test('retomar um rascunho antigo de compra nova preserva os campos sem editar outra nota', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const registro = app.readDraft('nota-1');
  const storage = new Map([[key(null), JSON.stringify(registro)]]);
  const recarregado = criarAmbiente({ storage });
  recarregado.captureReviewPanel();
  await recarregado.authorize();
  assert.equal(recarregado.modal.classList.contains('aberto'), false);
  await recarregado.resume();
  assert.equal(recarregado.modal.classList.contains('aberto'), true);
  for (const [id, value] of Object.entries(registro.campos)) assert.equal(recarregado.fields[id].value, value);
  assert.deepEqual(copy(recarregado.window.despItensTemp), registro.itens);
  assert.equal(recarregado.editId, null);
  assert.equal(recarregado.window.__obterIdRascunhoCompra(), null);
  assert.deepEqual(recarregado.reviewRequests, []);
  assert.equal(recarregado.readDraft('nota-1'), null);
  assert.deepEqual(recarregado.readDraft(null).itens, registro.itens);
});

test('Salvar com a nota original ausente consulta o servidor sem abrir revisão e preserva o rascunho', async () => {
  const { app } = prepararRascunhoParaRevisao();
  app.setNotes([]);
  app.setServer([]);
  app.captureReviewPanel();
  await app.save();
  assert.deepEqual(app.reviewRequests, []);
  assert.deepEqual(app.mutations, []);
  assert.equal(app.reads.length, 1);
  assert.equal(app.readDraft('nota-1').campos.despObs, 'Alteração ainda não enviada');
  assert.equal(app.readDraft('nota-1').itens[0].qtd, 11);
  assert.equal(app.readDraft(null), null);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.products[0].estoque, 10);
  assert.equal(app.window.__recuperacaoCompraEmAndamento, false);
});

test('falha de conexão ao atualizar não abre revisão nem altera nota ou estoque', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const notaLocal = app.notes[0];
  app.setReadError(new Error('Supabase fora do ar'));
  app.captureReviewPanel();
  await app.save();
  assert.deepEqual(app.reviewRequests, []);
  assert.equal(app.reads.length, 1);
  assert.deepEqual(app.notes, [notaLocal]);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.fields.btnSalvarDespesa.textContent, '🔄 Atualizar nota');
  assert.equal(app.readDraft('nota-1').campos.despObs, 'Alteração ainda não enviada');
  assert.equal(app.readDraft('nota-1').itens[0].qtd, 11);
  assert.equal(app.products[0].estoque, 10);
  assert.deepEqual(app.mutations, []);
});

test('Salvar com uma versão diferente atualiza a base automaticamente antes de validar a compra', async () => {
  const { app } = prepararRascunhoParaRevisao();
  const alterada = nota({ valor: 150, obs: 'Atualizada em outro aparelho' });
  app.setServer([alterada]);
  app.captureReviewPanel();
  app.window.ComprasDuplicadas.validarEstado = () => { throw new Error('parar após conferir o servidor'); };
  await app.save();
  assert.deepEqual(app.reviewRequests, []);
  assert.equal(app.reads.length, 1);
  assert.equal(app.base().valor, 150);
  assert.equal(app.base().obs, 'Atualizada em outro aparelho');
  assert.equal(app.readDraft('nota-1').baseNota.valor, 150);
  assert.equal(app.readDraft('nota-1').itens[0].qtd, 11);
  assert.equal(app.fields.despObs.value, 'Alteração ainda não enviada');
  assert.equal(app.notes[0].valor, 150);
  assert.deepEqual(app.mutations, []);
});

for (const [name, change] of [
  ['a revisão local', { revision: true, version: false }],
  ['a versão confirmada', { revision: false, version: true }],
]) {
  test('um envio concluído durante a consulta invalida a resposta quando muda ' + name, async () => {
    const { app } = prepararRascunhoParaRevisao();
    const antes = app.readDraft('nota-1');
    app.setServer([]);
    app.onRead(() => app.finishOtherSave(change));
    await assert.rejects(app.window.__prepararRevisaoRascunhoCompra({ idOriginal: 'nota-1', notaEsperada: null }), /mudaram durante a consulta/);
    assert.deepEqual(app.readDraft('nota-1'), antes);
    assert.equal(app.readDraft(null), null);
    assert.equal(app.products[0].estoque, 33, 'a resposta antiga não pode apagar o saldo confirmado durante a consulta');
    assert.equal(app.editId, 'nota-1');
    assert.equal(app.window.__recuperacaoCompraEmAndamento, false);
  });
}

test('o painel confere o servidor e prepara o rascunho somente depois da escolha explícita', async () => {
  const { app } = prepararRascunhoParaRevisao();
  app.setServer([]);
  app.window.__mostrarRevisaoRascunhoCompra('nota-1');
  assert.equal(app.reads.length, 0);
  assert.equal(app.button('Preparar rascunho como nova compra'), null);
  await app.button('🔄 Conferir no servidor').click();
  assert.equal(app.reads.length, 1);
  assert.equal(app.readDraft(null), null);
  assert.equal(app.editId, 'nota-1');
  assert.equal(app.products[0].estoque, 10);
  await app.button('Preparar rascunho como nova compra').click();
  assert.equal(app.reads.length, 2, 'a escolha relê o servidor antes de preparar');
  assert.equal(app.editId, null);
  assert.equal(app.readDraft(null).itens[0].qtd, 11);
  assert.deepEqual(app.notes, []);
  assert.deepEqual(app.mutations, [], 'o painel prepara a revisão e aguarda o botão Salvar compra');
});
