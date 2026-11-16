const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const stock = require('../ingredient-stock.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const submitStart = html.indexOf(" $('#formIngrediente').addEventListener('submit',");
const helpersStart = html.lastIndexOf(' var salvandoIngrediente=', submitStart);
const submitEnd = html.indexOf('\n function iniciarEdicaoIng(', submitStart);
assert(submitStart >= 0 && submitEnd > submitStart);
const script = html.slice(helpersStart >= 0 ? helpersStart : submitStart, submitEnd);
const applyShop = html.slice(html.indexOf('function aplicarEstadoLoja('), html.indexOf('function salvarEstadoLojaAtivo('));
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(saveResult) {
  const original = { id: 'ovo', nome: 'Ovo', nomeBase: 'Ovo', marca: 'Granja', categoria: 'outro', semEstoque: true, estoque: 0, estoqueEstimado: 30, unidade: 'un', unidadeEstoque: 'un', modoCompra: 'pacote', rendimento: 0, custo: 0.54, precoExtra: 0.99, contagensEstoque: [{ id: 'contagem-1', saldo: 30 }], contagemEstoqueId: 'contagem-1' };
  const fields = Object.fromEntries(Object.entries({ ingNome: 'Ovo', ingMarca: 'Granja', ingIcone: '🥚', ingCategoria: 'outro', ingPrecoExtra: '0,99', ingCusto: '0,54', ingQtd: '30', ingMin: '5', ingEstoqueEstimado: '30', ingModoCompra: 'pacote', ingRendimento: '', ingUnidade: 'un' }).map(([id, value]) => [id, { value, disabled: false }]));
  fields.ingConsumoMedia = { checked: false, disabled: false };
  fields.btnSalvarIngrediente = { textContent: 'Salvar', disabled: false };
  fields.formIngrediente = { addEventListener(name, fn) { if (name === 'submit') submit = fn; }, querySelector() { return fields.btnSalvarIngrediente; } };
  let submit, calls = 0, reset = 0, server = copy(original), context;
  const messages = [];
  context = vm.createContext({
    console, window: { EstoqueIngredientes: stock }, document: { getElementById(id) { return fields[id] || null; }, querySelectorAll() { return Object.values(fields).filter(x => 'disabled' in x); } },
    $: selector => fields[selector.replace(/^#/, '')],
    ingredientes: [copy(original)], editandoIngId: 'ovo', tipoIngForm: 'com', imagemIngTemp: 'foto.png', CATEGORIA_EMOJI: {},
    estadoBaseSincronizado: { porLoja: { l1: { ingredientes: [copy(original)] } } }, lojaAtivaId: 'l1', estadoLocalSujo: false, salvandoRemoto: false,
    capturarEstado() { return { porLoja: { l1: { ingredientes: copy(context.ingredientes) } } }; },
    souGerente: () => true, mesAtual: () => '2026-11', normalizarNomeCadastro: value => String(value).trim().toLowerCase(),
    lerMoeda: value => Number(String(value).replace(',', '.')) || 0, lerQuantidade: value => Number(value) || 0,
    medidaParaQtdEstoque: value => Number(value),
    medidaIngredienteDoFormulario: () => ({ ...context.ingredientes[0], semEstoque: context.tipoIngForm === 'sem' }),
    dadosIguais: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    async salvar() {
      calls++;
      context.estadoLocalSujo = true;
      const submitted = copy(context.ingredientes[0]);
      const result = typeof saveResult === 'function' ? await saveResult(context) : saveResult;
      if (result?.ok || result?.persisted) {
        server = submitted;
        context.estadoBaseSincronizado.porLoja.l1.ingredientes = [copy(submitted)];
      }
      return result;
    },
    resetarFormIng() { reset++; context.editandoIngId = null; context.tipoIngForm = 'com'; fields.ingNome.value = ''; },
    renderIngredientes() {}, renderGridIngredientesProduto() {}, renderVendas() {}, renderEstoque() {}, atualizarCamposEstoqueIng() {},
    toast: message => messages.push(message), uid: () => 'novo',
  });
  vm.runInContext(script, context);
  vm.runInContext(applyShop, context);
  return {
    context, original, fields, messages,
    submit: () => submit({ preventDefault() {} }),
    get calls() { return calls; }, get resets() { return reset; },
    reload() { context.aplicarEstadoLoja({ ingredientes: [copy(server)] }); return copy(context.ingredientes[0]); },
  };
}

test('mudar para controle aguarda confirmação antes de anunciar sucesso ou limpar o formulário', async () => {
  let confirm;
  const app = fixture(() => new Promise(resolve => { confirm = resolve; }));
  const pending = app.submit();
  assert.equal(app.calls, 1);
  assert.equal(app.resets, 0);
  assert.equal(app.messages.some(text => /Atualizado|Cadastrado/.test(text)), false);
  assert.equal(app.fields.btnSalvarIngrediente.disabled, true);
  await app.submit();
  assert.equal(app.calls, 1, 'clique repetido não inicia outra gravação');
  confirm({ ok: true });
  await pending;
  const after = app.reload();
  assert.equal(after.semEstoque, false);
  assert.equal(after.estoque, 30);
  assert.equal(after.marca, 'Granja');
  assert.deepEqual(after.contagensEstoque, app.original.contagensEstoque);
  assert.equal(app.resets, 1);
  assert.match(app.messages.at(-1), /Atualizado|atualizado/);
});

test('falha ao salvar não anuncia sucesso e mantém o tipo escolhido e os campos para tentar novamente', async () => {
  const app = fixture({ ok: false, error: new Error('Sem conexão') });
  await app.submit();
  assert.equal(app.resets, 0);
  assert.equal(app.context.tipoIngForm, 'com');
  assert.equal(app.fields.ingNome.value, 'Ovo');
  assert.equal(app.fields.ingMarca.value, 'Granja');
  assert.equal(app.fields.ingQtd.value, '30');
  assert.equal(app.messages.some(text => /Atualizado|Cadastrado/.test(text)), false);
  assert.match(app.messages.at(-1), /não.*confirmar|não.*confirmado/i);
  assert.equal(app.context.ingredientes[0].semEstoque, true, 'somente o cadastro não confirmado volta ao estado anterior');
  assert.equal(app.context.estadoLocalSujo, false, 'a reversão completa não deixa uma alteração fantasma bloqueando outras operações');
  assert.equal(app.fields.btnSalvarIngrediente.disabled, false);
});

test('falha não desfaz outra alteração feita no ingrediente enquanto a confirmação estava pendente', async () => {
  let confirm;
  const app = fixture(() => new Promise(resolve => { confirm = resolve; }));
  const pending = app.submit();
  app.context.ingredientes[0].estoque += 3;
  app.context.ingredientes[0].marca = 'Atualizada em outra operação';
  confirm({ ok: false, error: new Error('Conflito') });
  await pending;
  assert.equal(app.context.ingredientes[0].estoque, 33);
  assert.equal(app.context.ingredientes[0].marca, 'Atualizada em outra operação');
  assert.equal(app.context.estadoLocalSujo, true, 'alterações posteriores continuam pendentes');
  assert.equal(app.resets, 0);
});

test('gravação já confirmada não é revertida por uma falha posterior da sincronização', async () => {
  const app = fixture({ ok: false, persisted: true, error: new Error('Falha posterior') });
  await app.submit();
  assert.equal(app.context.ingredientes[0].semEstoque, false);
  assert.equal(app.resets, 0);
  assert.equal(app.reload().semEstoque, false);
});

test('confirmação no estado base protege a gravação mesmo quando o resultado não informa persisted', async () => {
  const app = fixture(context => {
    context.estadoBaseSincronizado.porLoja.l1.ingredientes = copy(context.ingredientes);
    return { ok: false, error: new Error('Uma operação posterior falhou') };
  });
  await app.submit();
  assert.equal(app.context.ingredientes[0].semEstoque, false);
  assert.equal(app.context.estadoLocalSujo, true);
  assert.equal(app.resets, 0);
});

test('uma exceção de rede mantém o formulário e libera uma nova tentativa', async () => {
  const app = fixture(() => { throw new Error('Rede interrompida'); });
  await app.submit();
  assert.equal(app.resets, 0);
  assert.equal(app.fields.ingNome.value, 'Ovo');
  assert.equal(app.fields.btnSalvarIngrediente.disabled, false);
  await app.submit();
  assert.equal(app.calls, 2);
});

test('um cadastro novo usa a mesma identidade ao tentar novamente após uma falha', async () => {
  let attempt = 0;
  const sentIds = [];
  const app = fixture(context => {
    sentIds.push(context.ingredientes[0].id);
    return ++attempt === 1 ? { ok: false, error: new Error('Sem rede') } : { ok: true };
  });
  app.context.editandoIngId = null;
  app.context.ingredientes = [];
  await app.submit();
  assert.equal(app.context.ingredientes.length, 0);
  assert.equal(app.fields.ingNome.value, 'Ovo');
  await app.submit();
  assert.deepEqual(sentIds, ['novo', 'novo']);
  assert.equal(app.context.ingredientes.length, 1);
  assert.equal(app.reload().semEstoque, false);
});

test('trocar o perfil durante o envio não reabilita os campos reservados ao gerente', async () => {
  let confirm;
  const app = fixture(() => new Promise(resolve => { confirm = resolve; }));
  const pending = app.submit();
  app.context.souGerente = () => false;
  confirm({ ok: true });
  await pending;
  assert.equal(app.fields.ingNome.disabled, true);
  assert.equal(app.fields.ingCusto.disabled, true);
  assert.equal(app.fields.btnSalvarIngrediente.disabled, true);
});

test('o complemento do formulário também respeita a trava durante a confirmação', async () => {
  let confirm;
  const app = fixture(() => new Promise(resolve => { confirm = resolve; }));
  app.context.iniciarEdicaoIng = () => {};
  const wrapper = html.split(/\r?\n/).find(line => line.includes('var iniciarEdicaoIngBase=iniciarEdicaoIng;'));
  assert(wrapper, 'complemento real do formulário encontrado');
  vm.runInContext(wrapper, app.context);
  const pending = app.submit();
  app.context.iniciarEdicaoIng({ consumoMedia: true });
  assert.equal(app.fields.ingConsumoMedia.checked, false);
  confirm({ ok: true });
  await pending;
});
