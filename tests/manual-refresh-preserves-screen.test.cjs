const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf("  var modalAtualizacao = document.getElementById('modalConfirmarAtualizacao');");
const end = html.indexOf('\n})();\n</script>', start);
assert(start >= 0 && end > start, 'o fluxo de atualização manual existe');
const refreshHandler = html.slice(start, end);

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const shouldAdd = force === undefined ? !values.has(name) : !!force;
      if (shouldAdd) values.add(name); else values.delete(name);
      return shouldAdd;
    },
  };
}

function criarAmbiente({ storage = new Map(), telaInicial = 'pedidos', scrollY = 0, scrollView = 0, scrollLista = 0 } = {}) {
  const eventsWindow = {};
  const eventsDocument = {};
  const views = {};
  let telaAtiva = telaInicial;
  let reloads = 0;
  let guardadas = 0;
  const lista = { id: 'listaPedidos', scrollTop: scrollLista, parentElement: null, nodeType: 1 };
  for (const nome of ['vendas', 'pedidos', 'clientes']) {
    views[nome] = {
      id: 'view-' + nome,
      scrollTop: nome === telaInicial ? scrollView : 0,
      contains(el) { return el === lista && nome === 'pedidos'; },
      querySelectorAll(selector) { return selector === '[id]' && nome === 'pedidos' ? [lista] : []; },
    };
  }
  const tabs = {};
  for (const nome of Object.keys(views)) {
    tabs[nome] = { click() { telaAtiva = nome; } };
  }
  const modal = { id: 'modalConfirmarAtualizacao', classList: classList(), addEventListener(name, fn) { this['on' + name] = fn; } };
  const button = { disabled: false, attrs: {}, classList: classList(), addEventListener(name, fn) { this['on' + name] = fn; }, setAttribute(name, value) { this.attrs[name] = value; } };
  const continueButton = { disabled: false, addEventListener(name, fn) { this['on' + name] = fn; } };
  const updateButton = { disabled: false, textContent: '🔄 Atualizar agora', addEventListener(name, fn) { this['on' + name] = fn; } };
  const status = { textContent: '', style: { display: 'none' } };
  const document = {
    body: { scrollTop: 0 },
    documentElement: { scrollTop: 0 },
    getElementById(id) {
      if (id === modal.id) return modal;
      if (id === 'btnAtualizarApp') return button;
      if (id === 'btnContinuarLancando') return continueButton;
      if (id === 'btnAtualizarSite') return updateButton;
      if (id === 'statusAtualizacaoSite') return status;
      if (id.startsWith('view-')) return views[id.slice(5)] || null;
      if (id === 'listaPedidos') return lista;
      return null;
    },
    querySelector(selector) {
      if (selector === '.view.ativo') return views[telaAtiva];
      const match = selector.match(/data-tab="([a-z]+)"/);
      return match ? tabs[match[1]] || null : null;
    },
    addEventListener(name, fn) { eventsDocument[name] = fn; },
  };
  const window = {
    scrollY,
    sessionStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    location: { reload() { reloads += 1; } },
    addEventListener(name, fn) { eventsWindow[name] = fn; },
    requestAnimationFrame(fn) { fn(); },
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    scrollTo(_x, y) { this.scrollY = y; },
  };
  const run = new Function('window', 'document', 'navigator', 'guardarRetomadaAoSair', 'souGerente', 'abrirModalSenha', 'console', refreshHandler);
  run(window, document, {}, () => { guardadas += 1; }, () => false, () => {}, { warn() {} });
  return {
    window, document, modal, button, continueButton, updateButton, status,
    eventsWindow, eventsDocument, views, tabs, lista,
    get telaAtiva() { return telaAtiva; },
    get reloads() { return reloads; },
    get guardadas() { return guardadas; },
  };
}

async function main() {
  const storage = new Map();
  const app = criarAmbiente({ storage, telaInicial: 'pedidos', scrollY: 0, scrollView: 0, scrollLista: 136 });
  let pullPrevented = false;
  app.eventsDocument.touchstart({ touches: [{ clientX: 50, clientY: 20 }] });
  app.eventsDocument.touchmove({
    touches: [{ clientX: 51, clientY: 150 }],
    target: { nodeType: 1, scrollTop: 0, parentElement: null },
    cancelable: true,
    preventDefault() { pullPrevented = true; },
  });
  assert.equal(pullPrevented, true, 'puxar para baixo no topo não dispara atualização do navegador');
  assert.equal(app.modal.classList.contains('aberto'), false, 'o gesto não abre a confirmação de atualização');

  app.window.scrollY = 248;
  app.button.onclick();
  assert.equal(app.modal.classList.contains('aberto'), true, 'o botão pequeno abre a confirmação');
  app.updateButton.onclick();
  await Promise.resolve();
  assert.equal(app.guardadas, 1, 'o rascunho de compra é protegido antes de atualizar');
  assert.equal(app.reloads, 1, 'a página só recarrega após confirmar no botão da mensagem');
  assert.equal(app.modal.classList.contains('atualizando'), true, 'o estado de atualização fica visível');

  const context = JSON.parse(storage.get('rei_chapa_contexto_tela_atualizacao_v1'));
  assert.equal(context.tela, 'pedidos');
  assert.equal(context.scrollY, 248);
  assert.deepEqual(context.rolagens, [{ id: 'listaPedidos', top: 136 }]);

  const restored = criarAmbiente({ storage, telaInicial: 'vendas' });
  restored.eventsWindow.reiChapaDadosCarregados();
  assert.equal(restored.telaAtiva, 'pedidos', 'a tela anterior volta depois de carregar os dados');
  assert.equal(restored.window.scrollY, 248, 'a posição da página é restaurada');
  assert.equal(restored.lista.scrollTop, 136, 'a rolagem interna da lista é restaurada');
  assert.equal(storage.has('rei_chapa_contexto_tela_atualizacao_v1'), false, 'o contexto de tela é consumido após restaurar');
}

main().then(() => console.log('Manual refresh and screen restoration scenarios passed.'));
