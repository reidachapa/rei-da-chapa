const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function source(start, end) {
  const first = html.indexOf(start);
  const last = html.indexOf(end, first + 1);
  assert.ok(first >= 0 && last > first, `código real disponível: ${start}`);
  return html.slice(first, last);
}

function aparelho(ingredientes = []) {
  const storage = new Map();
  const select = {
    value: 'carne',
    options: [],
    replaceChildren(fragment) { this.options = [...fragment.children]; },
  };
  const document = {
    getElementById(id) { return id === 'ingCategoria' ? select : null; },
    createDocumentFragment() { return { children: [], appendChild(item) { this.children.push(item); } }; },
    createElement() { return {}; },
  };
  const context = vm.createContext({
    document, ingredientes, lojas: [], estadoRemotoPorLoja: {}, salvarEstadoLojaAtivo() {},
    window: { __appMemoryStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    } },
  });
  vm.runInContext(source('const CATEGORIAS_INGREDIENTES_PADRAO =', '\nconst DESPESA_LABEL') + '\n' +
    source('function listaLocalPDV(', '\nasync function subirParaServidor(') + '\n' +
    source('function guardarCategoriaCompraLocal(', '\nfunction sincronizarCategoriasFinanceiras('), context);
  return { context, select, storage };
}

test('uma categoria criada aparece em outro aparelho com nome e emoji e mantém a escolha atual', () => {
  const primeiro = aparelho();
  primeiro.storage.set('rei_chapa_catedit_ing', JSON.stringify({ c_lacre: { n: 'Lacre', e: '📦' } }));
  const dados = copy(primeiro.context.capturarEstado());
  assert.deepEqual(dados.categoriasIngredientesEditadas, { c_lacre: { n: 'Lacre', e: '📦' } });

  const segundo = aparelho();
  segundo.context.sincronizarCategoriasIngredientes(dados);
  assert.equal(segundo.select.value, 'carne');
  assert.equal(segundo.select.options.find(o => o.value === 'c_lacre').textContent, '📦 Lacre');
  assert.equal(vm.runInContext('CATEGORIA_LABEL.c_lacre', segundo.context), 'Lacre');
  assert.equal(vm.runInContext('CATEGORIA_EMOJI.c_lacre', segundo.context), '📦');
});

test('categoria oculta permanece em ingrediente histórico, e estado antigo sem os campos preserva a seleção', () => {
  const atual = aparelho([{ id: 'ing_lacre', categoria: 'c_lacre' }]);
  atual.select.value = 'c_lacre';
  atual.context.sincronizarCategoriasIngredientes({
    categoriasIngredientes: [{ k: 'c_lacre', n: 'Lacre', e: '📦' }],
    categoriasIngredientesOcultas: ['c_lacre'],
  });
  atual.context.sincronizarCategoriasIngredientes({});
  assert.equal(atual.select.value, 'c_lacre');
  assert.equal(atual.select.options.find(o => o.value === 'c_lacre').disabled, true);
  assert.equal(vm.runInContext('CATEGORIA_LABEL.c_lacre', atual.context), 'Lacre');
});

test('dois aparelhos adicionam categorias diferentes ao mesmo estado antigo', () => {
  const context = vm.createContext({});
  vm.runInContext(source('function clonarDadosEstado(', '\nwindow.notaCompraIgual='), context);
  const base = { porLoja: {} };
  const lacre = { c_lacre: { n: 'Lacre', e: '📦' } };
  const caixa = { c_caixa: { n: 'Caixa', e: '🏷️' } };
  const local = { ...base, categoriasIngredientesEditadas: lacre };
  const remoto = { ...base, categoriasIngredientesEditadas: caixa };
  const mesclado = copy(context.mesclarEstadosConcorrentes(base, local, remoto));
  assert.deepEqual(mesclado.categoriasIngredientesEditadas, { ...lacre, ...caixa });
});

test('aparelho antigo que omite os campos novos não apaga a categoria ao mesclar', () => {
  const context = vm.createContext({});
  vm.runInContext(source('function clonarDadosEstado(', '\nwindow.notaCompraIgual='), context);
  const registrado = { porLoja: {}, categoriasIngredientesEditadas: { c_lacre: { n: 'Lacre', e: '📦' } } };
  const outro = { porLoja: { l1: { ingredientes: [] } } };
  const mesclado = copy(context.mesclarEstadosConcorrentes(registrado, registrado, outro));
  assert.deepEqual(mesclado.categoriasIngredientesEditadas, registrado.categoriasIngredientesEditadas);
  assert.deepEqual(mesclado.porLoja, outro.porLoja);
});
