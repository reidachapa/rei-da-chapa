const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const precos = require('../purchase-pricing.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('o formulário separa categoria da despesa dos campos de venda e do catálogo', () => {
  const cartao = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const categoria = { value: 'limpeza', textContent: '🧹 Limpeza', disabled: false };
  const despesa = { tipoItem: 'despesa', nome: 'Detergente', qtd: 2, valor: 5, categoriaFinanceira: 'limpeza' };
  const contexto = {
    window: { despItensTemp: [despesa], PrecosCompra: precos },
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

  assert.match(cartao.innerHTML, /data-tipo="despesa"/);
  assert.match(cartao.innerHTML, /placeholder="Descrição da despesa/);
  assert.match(cartao.innerHTML, /class="ic-cat-despesa"[\s\S]*value="limpeza"[^>]*selected/);
  assert.doesNotMatch(cartao.innerHTML, /class="ic-(pv|margem)"|list="listaSugestoesCompra"/);
  assert.match(cartao.innerHTML, /class="ic-desc-item"/);
});
