const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const precos = require('../purchase-pricing.js');
const estoque = require('../ingredient-stock.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function renderizarItem(item, unidadeDigitada) {
  const eventosUnidade = {};
  const campoUnidade = { dataset: { idx: '0' }, addEventListener(tipo, handler) { eventosUnidade[tipo] = handler; } };
  const campoRendimento = {};
  const cartao = {
    innerHTML: '',
    querySelectorAll: seletor => unidadeDigitada && seletor === '.ic-unid-estoque' ? [campoUnidade] : [],
    querySelector: seletor => seletor === '.ic-rend[data-idx="0"]' ? campoRendimento : null
  };
  const categoria = { value: 'limpeza', textContent: '🧹 Limpeza', disabled: false };
  const contexto = {
    window: { despItensTemp: [item], PrecosCompra: precos, EstoqueIngredientes: estoque },
    document: { getElementById: id => ({ despItensLista: cartao, despCategoria: { options: [categoria] } })[id] },
    atualizarListaAutocomplete() {},
    getCatsParaItem: () => [],
    getCatsIngredienteCompra: () => [{ v: 'outro', t: 'Outros' }],
    ordenarCategoriasFinanceiras: opcoes => opcoes,
    categoriaPDVOculta: () => false,
    buscarCatalogoCompra: () => null,
    buscarIngredienteCompra: () => null,
    converterQuantidadeUnidade: estoque.converter,
    textoDescontoNotaCompra: () => '',
    lerDescontoNota: () => 0,
    produtos: [], ingredientes: [], paes: [], despesas: [], editandoDespesaId: null,
    esc: String, moeda: String, moedaSimple: String, formatarDecimalCompra: String,
  };
  const custoInicio = html.indexOf('function prepararCustoItemCompra(');
  const custoFim = html.indexOf('async function salvarCompraDaNota(', custoInicio);
  const renderInicio = html.lastIndexOf('  window.renderDespItens = function(){');
  const renderFim = html.indexOf('  function atualizarPrecoAoEditarCompra(', renderInicio);
  const medidaInicio = html.indexOf('function formatarQtdEstoque(');
  const medidaFim = html.indexOf('function baseMedidaCompra(', medidaInicio);
  const projecaoInicio = html.indexOf('  function rendimentoPorPesoDaLinha(');
  assert.ok(custoInicio >= 0 && custoFim > custoInicio && renderInicio >= 0 && renderFim > renderInicio);
  const codigo = html.slice(medidaInicio, medidaFim) + html.slice(custoInicio, custoFim) + html.slice(projecaoInicio, renderFim);
  vm.runInNewContext(codigo + '\nwindow.renderDespItens();', contexto);
  if (unidadeDigitada) {
    campoUnidade.value = unidadeDigitada;
    eventosUnidade.input();
    eventosUnidade.change?.();
    eventosUnidade.blur();
    contexto.window.renderDespItens();
  }

  return cartao.innerHTML;
}

test('um novo item da compra oferece Produto, Ingrediente e Pão', () => {
  const cartao = renderizarItem({ tipoItem: 'prod', nome: '', qtd: 1, valor: 0 });
  for (const tipo of ['prod', 'ing', 'pao']) {
    assert.match(cartao, new RegExp(`data-tipo="${tipo}"`));
  }
  assert.doesNotMatch(cartao, /data-tipo="despesa"/);
});

test('o formulário mantém a categoria e os valores de uma despesa existente', () => {
  const cartao = renderizarItem({ tipoItem: 'despesa', nome: 'Detergente', qtd: 2, valor: 5, categoriaFinanceira: 'limpeza' });
  assert.match(cartao, /data-tipo="despesa"/);
  assert.match(cartao, /placeholder="Descrição da despesa/);
  assert.match(cartao, /class="ic-cat-despesa"[\s\S]*value="limpeza"[^>]*selected/);
  assert.doesNotMatch(cartao, /class="ic-(pv|margem)"|list="listaSugestoesCompra"/);
  assert.match(cartao, /class="ic-desc-item"/);
});

test('a nota mostra gramas quando o saldo escolhido em gr tem rendimento em porções', () => {
  const item = {
    tipoItem: 'ing', nome: 'Ketchup', qtd: 2, valor: 50, unid: 'kilo', modoCompra: 'flexivel',
    gramasPorUnidade: 50, unidadeEstoque: 'und'
  };
  const cartao = renderizarItem(item, 'gr');
  assert.match(cartao, /class="ic-unid-estoque"[^>]*value="g"/);
  assert.match(cartao, /Estoque: \+2\.000 g/);
  assert.equal(item.unidadeEstoque, 'und');
  assert.equal(item.unidadeExibicaoEstoque, 'g');
});

test('escolher unidades em uma nota antiga não preenche os gramas por porção', () => {
  const item = {
    tipoItem: 'ing', nome: 'Ketchup', qtd: 2, valor: 50, unid: 'kg', modoCompra: 'flexivel',
    rend: 20, unidadeEstoque: 'un', _indiceOriginalNota: 0
  };
  const cartao = renderizarItem(item, 'und');
  assert.match(cartao, /class="ic-unid-estoque"[^>]*value="un"/);
  assert.equal(item.gramasPorUnidade, undefined);
  assert.equal(item.rend, 20);
});
