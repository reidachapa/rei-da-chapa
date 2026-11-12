const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('(function instalarNavegacaoVoltarAndroid(){');
const marker = '\n})();\nlet senhaBuffer=';
const end = html.indexOf(marker, start);
assert(start >= 0 && end > start, 'o controle de voltar do Android existe');
const backHandler = html.slice(start, end + marker.indexOf('\nlet senhaBuffer'));

function criarAmbiente({ modalAberto = true } = {}) {
  const callbacks = {};
  const timers = [];
  let appFechado = false;
  let historicoVoltado = 0;
  const modal = {
    id: 'modalConfirmarSaida',
    aberto: modalAberto,
    classList: {
      contains(name) { return name === 'aberto' && modal.aberto; },
      add(name) { if (name === 'aberto') modal.aberto = true; },
      remove(name) { if (name === 'aberto') modal.aberto = false; },
    },
    addEventListener(name, fn) { callbacks['modal:' + name] = fn; },
  };
  const buttons = {
    btnFicarNoApp: { addEventListener(name, fn) { callbacks['btnFicarNoApp:' + name] = fn; } },
    btnSairDoApp: { addEventListener(name, fn) { callbacks['btnSairDoApp:' + name] = fn; } },
  };
  class CloseWatcherFake {
    constructor() { this.events = {}; window.__testeWatcher = this; }
    addEventListener(name, fn) { this.events[name] = fn; }
    destroy() { this.destroyed = true; }
  }
  const window = {
    CloseWatcher: CloseWatcherFake,
    addEventListener(name, fn) { callbacks['window:' + name] = fn; },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    close() { appFechado = true; },
    location: { href: 'https://example.test/' },
  };
  const document = {
    addEventListener(name, fn) { callbacks['document:' + name] = fn; },
    getElementById(id) { return id === modal.id ? modal : buttons[id] || null; },
    querySelectorAll(selector) { return selector === '.modal.aberto' && modal.aberto ? [modal] : []; },
    querySelector() { return null; },
  };
  const history = { pushState() {}, back() { historicoVoltado += 1; } };
  const run = new Function(
    'window', 'document', 'history', 'location', 'getComputedStyle', 'setTimeout', 'console', 'souGerente', '$', '$$',
    backHandler + '\nreturn window.__reiChapaVoltarInstalado;'
  );
  run(window, document, history, window.location, () => ({ display: 'block', visibility: 'visible', zIndex: '260' }), fn => fn(), { warn() {} }, () => false, () => null, () => []);
  const watcher = window.__testeWatcher;
  return { callbacks, modal, window, timers, appFechado: () => appFechado, historicoVoltado: () => historicoVoltado, watcher };
}

{
  const app = criarAmbiente();
  const watcher = app.window.__testeWatcher;
  assert(watcher, 'o CloseWatcher é armado');
  let cancelado = false;
  for (let toque = 0; toque < 4; toque += 1) {
    watcher.events.cancel({ preventDefault() { cancelado = true; } });
    assert.equal(app.modal.aberto, true, 'Voltar repetido mantém a confirmação aberta');
  }
  assert.equal(cancelado, true, 'o pedido nativo de fechar é interceptado');
}

{
  const app = criarAmbiente();
  app.callbacks['btnFicarNoApp:click']();
  assert.equal(app.modal.aberto, false, 'escolher continuar fecha só a confirmação');
  assert.equal(app.appFechado(), false, 'continuar mantém o aplicativo aberto');
}

{
  const app = criarAmbiente();
  app.callbacks['btnSairDoApp:click']();
  assert.equal(app.appFechado(), true, 'escolher sair fecha o aplicativo');
  assert.equal(app.modal.aberto, false, 'a confirmação some antes da tentativa de saída');
}

console.log('Android exit confirmation scenarios passed.');
