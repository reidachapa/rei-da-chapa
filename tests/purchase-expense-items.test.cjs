const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const precos = require('../purchase-pricing.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function renderizarItem(item) {
  const cartao = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const categoria = { value: 'limpeza', textContent: '🧹 Limpeza', disabled: false };
  const contexto = {
    window: { despItensTemp: [item], PrecosCompra: precos },
    document: { getElementById: id => ({ despItensLista: cartao, despCategoria: { options: [categoria] } })[id] },
    atualizarListaAutocomplete() {},
    getCatsParaItem: () => [],
    ordenarCategoriasFinanceiras: opcoes => opcoes,
    categoriaPDVOculta: () => false,
    buscarCatalogoCompra: () => null,
    quantidadeEstoqueProjetada: item => item.qtd,
    textoDescontoNotaCompra: () => '',
    lerDescontoNota: () => 0,
    produtos: [], ingredientes: [], paes: [], despesas: [], editandoDespesaId: null,
    esc: String, moeda: String, moedaSimple: String, formatarDecimalCompra: String,
  };
  const custoInicio = html.indexOf('function prepararCustoItemCompra(');
  const custoFim = html.indexOf('async function salvarCompraDaNota(', custoInicio);
  const renderInicio = html.lastIndexOf('  window.renderDespItens = function(){');
  const renderFim = html.indexOf('  function atualizarPrecoAoEditarCompra(', renderInicio);
  assert.ok(custoInicio >= 0 && custoFim > custoInicio && renderInicio >= 0 && renderFim > renderInicio);
  vm.runInNewContext(html.slice(custoInicio, custoFim) + html.slice(renderInicio, renderFim) + '\nwindow.renderDespItens();', contexto);

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
