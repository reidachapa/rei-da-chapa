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
  const construir = new Function('arr', 'window', 'document', 'cont', 'produtos', 'moeda', 'projetarPrecos',
    preco + '\nwindow.__atualizarPrecosCompra=atualizarPrecosProjetados;\n' + margem + '\nreturn aplicarMargemDigitada;');
  const aplicar = construir(arr, window, document, cont, [], n => String(n), projetarPrecos);
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
});
