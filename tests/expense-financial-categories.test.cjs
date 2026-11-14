const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');

function extrairFunction(nome, proximaAssinatura) {
  const start = html.indexOf(`function ${nome}(`);
  const end = html.indexOf(proximaAssinatura, start);
  assert(start >= 0 && end > start, `a função ${nome} existe`);
  return html.slice(start, end);
}

const normalizarSource = extrairFunction('normalizarCategoriaFinanceira', '\nfunction ordenarCategoriasFinanceiras(');
const ordenarSource = extrairFunction('ordenarCategoriasFinanceiras', '\nfunction garantirCategoriaFinanceira(');
const resolverCategoriaSource = extrairFunction('resolverCategoriaFinanceiraPorTexto', '\nfunction garantirCategoriaFinanceira(');
const garantirSource = extrairFunction('garantirCategoriaFinanceira', '\nfunction categoriaLabelSelecionada(');

const normalizar = new Function(`${normalizarSource}; return normalizarCategoriaFinanceira;`)();
const ordenar = new Function(`${normalizarSource}\n${ordenarSource}; return ordenarCategoriasFinanceiras;`)();
const resolverCategoria = new Function(`${normalizarSource}\n${resolverCategoriaSource}; return resolverCategoriaFinanceiraPorTexto;`)();

assert.equal(normalizar('  🏷️ 12 - Distribuidóras  '), 'distribuidoras', 'normaliza rótulos sem alterar o texto exibido');
assert.equal(resolverCategoria('luz', [{ value: 'agua', text: '💧 Água' }, { value: 'luz', text: '💡 02 - Luz' }]), 'luz', 'texto exato resolve para o valor da categoria correspondente');
assert.equal(resolverCategoria('Lu', [{ value: 'agua', text: '💧 Água' }, { value: 'luz', text: '💡 02 - Luz' }]), '', 'texto parcial não troca a categoria sem confirmação');

const categorias = [
  { k: 'luz', n: '💡 02 - Luz' },
  { k: 'posto', n: '⛽ Abastecimento' },
  { k: 'agua', n: '💧 Água' },
  { k: 'manutencao', n: '🔧 08 - Manutenção' },
];
assert.deepEqual(
  ordenar(categorias).map((categoria) => categoria.k),
  ['posto', 'agua', 'luz', 'manutencao'],
  'ordena pelo nome em português ignorando emoji e número inicial'
);
assert.deepEqual(categorias.map((categoria) => categoria.k), ['luz', 'posto', 'agua', 'manutencao'], 'não altera o catálogo original');

const options = [
  { value: 'luz', textContent: '💡 Luz' },
  { value: 'outro', textContent: '🍴 Outro' },
];
const storage = new Map();
const calls = { sincronizar: 0, popular: 0, salvar: 0 };
const garantir = new Function(
  'document', 'localStorage', 'listaCategoriaCompraLocal', 'guardarCategoriaCompraLocal',
  'sincronizarCategoriasFinanceiras', 'popularCategoriasDespesaAvulsa', 'salvar',
  normalizarSource + '\n' + ordenarSource + '\n' + garantirSource + '\nreturn garantirCategoriaFinanceira;'
)(
  { getElementById(id) { return id === 'despCategoria' ? { options } : null; } },
  { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
  (key) => JSON.parse(storage.get(key) || '[]'),
  (key, value) => storage.set(key, JSON.stringify(value)),
  () => { calls.sincronizar += 1; },
  () => { calls.popular += 1; },
  () => { calls.salvar += 1; }
);

assert.equal(garantir('  LUZ ', '💡'), 'luz', 'reutiliza uma categoria existente sem duplicar por caixa/acentos');
assert.equal(storage.has('rei_chapa_cats_desp'), false, 'não grava duplicata no catálogo');

assert.equal(garantir('Combustível', '⛽'), 'c_combustivel', 'gera chave estável para a categoria nova');
assert.deepEqual(JSON.parse(storage.get('rei_chapa_cats_desp')), [{ k: 'c_combustivel', n: 'Combustível', e: '⛽' }], 'salva categoria nova no catálogo financeiro compartilhado');
assert.deepEqual(calls, { sincronizar: 1, popular: 1, salvar: 1 }, 'atualiza os dois formulários e persiste o estado');

options.push({ value: 'c_transporte', textContent: '🚗 Transporte', disabled: true });
storage.set('rei_chapa_cats_desp', JSON.stringify([{ k: 'c_transporte', n: 'Transporte', e: '🚗' }]));
storage.set('rei_chapa_hide_desp', JSON.stringify(['c_transporte']));
assert.equal(garantir('Transporte', '🚗'), 'c_transporte', 'reutiliza uma categoria antiga que estava oculta');
assert.deepEqual(JSON.parse(storage.get('rei_chapa_hide_desp')), [], 'reativar uma categoria remove o marcador de ocultação');
assert.deepEqual(calls, { sincronizar: 2, popular: 2, salvar: 2 }, 'reativar categoria oculta atualiza e persiste os seletores');

assert.match(html, /categoria-financeira-busca/, 'os seletores usam a interface escura de busca');
assert.match(html, /ArrowDown[\s\S]*ArrowUp/, 'a lista de categorias pode ser usada pelo teclado');
assert.match(extrairFunction('instalarCampoCategoriaFinanceira', '\nfunction atualizarCampoCategoriaFinanceira('), /input\.addEventListener\('change'[\s\S]*resolverCategoriaFinanceiraPorTexto/, 'ao sair do campo, texto exato seleciona categoria e texto parcial volta ao valor canônico');
for (const match of html.matchAll(/(?:document\.getElementById\('despCategoria'\)|\$\('#despCategoria'\))\.value=/g)) {
  assert.match(html.slice(match.index, match.index + 260), /atualizarCampoCategoriaFinanceira\('despCategoria'\)/, 'cada abertura de compra sincroniza o campo visível com o select canônico');
}
const popularDespesasSource = extrairFunction('popularCategoriasDespesaAvulsa', '\nfunction atualizarCamposAbastecimento(');
assert.match(popularDespesasSource, /op\.value===preservarCategoria/, 'categorias ocultadas continuam disponíveis ao editar um lançamento antigo');
assert.match(extrairFunction('abrirModalDespesaAvulsa', '\nfunction itemDespesaAvulsaTemConteudo('), /popularCategoriasDespesaAvulsa\(d&&d\.categoria/, 'a edição reabre a categoria já usada pela despesa');

console.log('Financial category search and catalog scenarios passed.');
