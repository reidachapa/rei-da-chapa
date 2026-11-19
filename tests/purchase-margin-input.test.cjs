const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const PrecosCompra = require('../purchase-pricing.js');

test('digitar margem decimal preserva a vírgula e recalcula a venda', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const extrair = (inicio, fim) => {
    const a = html.indexOf(inicio), b = html.indexOf(fim, a);
    assert(a >= 0 && b > a, `trecho não encontrado: ${inicio}`);
    return html.slice(a, b);
  };
  const preco = extrair('    function atualizarPrecosProjetados(){', '    window.__atualizarPrecosCompra=atualizarPrecosProjetados;');
  const margem = extrair('    function aplicarMargemDigitada(campo){', "    cont.querySelectorAll('.ic-margem')");
  const formatacao = extrair('function formatarDecimalCompra(', '\nfunction normalizarNomeCadastro');
  const campos = {
    margem: { value: '', dataset: { idx: '0' }, style: {}, setAttribute() {} },
    venda: { value: '', style: {}, setAttribute() {} },
    media: { textContent: '' },
  };
  const arr = [{ nome: 'Suco', tipoItem: 'prod', qtd: 1, valor: 10 }];
  const document = { activeElement: campos.margem };
  const window = { despItensTemp: arr };
  const cont = { querySelector(seletor) {
    return seletor.startsWith('.ic-margem') ? campos.margem : seletor.startsWith('.ic-pv') ? campos.venda : campos.media;
  } };
  const projetarPrecos = () => PrecosCompra.calcular({ itens: arr, produtos: [] });
  const construir = new Function('arr', 'window', 'document', 'cont', 'produtos', 'moeda', 'projetarPrecos', 'formatarDecimalCompra',
    preco + '\nwindow.__atualizarPrecosCompra=atualizarPrecosProjetados;\n' + margem + '\nreturn aplicarMargemDigitada;');
  const formatarDecimalCompra = new Function(formatacao + '\nreturn formatarDecimalCompra;')();
  const aplicar = construir(arr, window, document, cont, [], n => 'R$ ' + formatarDecimalCompra(n), projetarPrecos, formatarDecimalCompra);
  for (const texto of ['1', '1,', '1,5']) {
    campos.margem.value = texto;
    aplicar(campos.margem);
    assert.equal(campos.margem.value, texto);
  }
  assert.equal(arr[0].lucroPct, 1.5);
  assert.equal(campos.venda.value, '10,15');
  campos.margem.value = '';
  aplicar(campos.margem);
  assert.equal(campos.margem.value, '');
  assert.equal(campos.venda.value, '10,15');
  assert.equal(arr[0].modoPreco, 'manual');
  assert.equal(arr[0].pv, 10.15);
  campos.margem.value = '25';
  aplicar(campos.margem);
  assert.equal(arr[0].modoPreco, 'percentual');
  assert.equal(campos.venda.value, '12,50');
  document.activeElement = null;
  Object.assign(arr[0], { qtd: 4, valor: 13.33, desconto: 7, descontoTipo: 'percent', lucroPct: 37.5678, modoPreco: 'percentual', pv: null });
  window.__atualizarPrecosCompra();
  assert.equal(campos.margem.value, '37,57');
  assert.equal(campos.media.textContent, 'Custo médio com esta compra: R$ 12,40 por unidade');
  assert.equal(arr[0].lucroPct, 37.5678);
  assert.equal(campos.venda.value, '17,05');
});
