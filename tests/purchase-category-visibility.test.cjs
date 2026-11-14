const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function abrirGerenciadorCategorias(selId, tipo){');
const end = html.indexOf('\nfunction instalarBotao(selId, tipo){', start);
assert(start >= 0 && end > start, 'o gerenciador de categorias existe');

let modal = null;
const categorias = [
  { value: 'insumo', textContent: '📦 Insumos / Compras', disabled: true },
  { value: 'c_supermercados', textContent: '🏬 Supermercados', disabled: false },
];
const select = { options: categorias, querySelector: () => null };
const document = {
  body: { appendChild(element) { modal = element; } },
  createElement() {
    return {
      classList: { add() {} },
      querySelectorAll() { return []; },
      addEventListener() {},
      innerHTML: '',
    };
  },
  getElementById(id) {
    if (id === 'despCategoria') return select;
    if (id === 'modalGerenciadorCats') return modal;
    return null;
  },
};
const stored = { rei_chapa_hide_desp: JSON.stringify(['insumo']) };
const localStorage = {
  getItem(key) { return stored[key] ?? null; },
  setItem(key, value) { stored[key] = value; },
};
const abrir = new Function(
  'document', 'localStorage', 'confirm', 'toast', 'esc', 'sincronizarCategoriasFinanceiras', 'popularCategoriasDespesaAvulsa', 'atualizarCampoCategoriaFinanceira',
  html.slice(start, end) + '\nreturn abrirGerenciadorCategorias;'
)(document, localStorage, () => false, () => {}, (value) => String(value), () => {}, () => {}, () => {});

abrir('despCategoria', 'desp');
assert.match(modal.innerHTML, /Supermercados/, 'categorias ativas continuam gerenciáveis');
assert.doesNotMatch(modal.innerHTML, /Insumos \/ Compras/, 'categoria excluída não volta à lista do gerenciador');
assert.deepStrictEqual(JSON.parse(stored.rei_chapa_hide_desp), ['insumo'], 'a exclusão continua salva');
assert(categorias.some((item) => item.value === 'insumo'), 'a opção antiga continua disponível para preservar registros existentes');

console.log('Purchase category visibility scenarios passed.');

