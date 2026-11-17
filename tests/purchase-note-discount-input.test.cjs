const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { calcular, calcularDescontoItem, somarDescontosItens, normalizarPercentualDigitado, lerPercentualNota } = require('../purchase-pricing.js');

test('desconto percentual da nota preserva 10% e decimal sem formatação de moeda', () => {
  assert.equal(typeof normalizarPercentualDigitado, 'function');
  assert.equal(typeof lerPercentualNota, 'function');
  assert.equal(normalizarPercentualDigitado('10'), '10');
  assert.equal(normalizarPercentualDigitado('10.5'), '10,5');
  assert.equal(lerPercentualNota('10,5'), 10.5);

  const percent = lerPercentualNota(normalizarPercentualDigitado('10'));
  const resultado = calcular({
    itens: [{ nome: 'Produto', tipoItem: 'prod', qtd: 1, valor: 100, lucroPct: 20 }],
    produtos: [],
    descontoNota: percent,
    descontoNotaTipo: 'percent',
  }).grupos[0];

  assert.equal(resultado.custoMedio, 90);
  assert.equal(resultado.preco, 108);
});

test('campo da nota não formata desconto percentual como centavos', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inicio = html.indexOf("$('#despDesconto').addEventListener('input', function(e) {");
  const fim = html.indexOf('\n});', inicio) + 4;
  const formatarInicio = html.indexOf('function formatarMoedaDigitada(');
  const formatarFim = html.indexOf('\n}', formatarInicio) + 2;
  assert(inicio >= 0 && fim > inicio && formatarInicio >= 0 && formatarFim > formatarInicio);
  let listener;
  const campo = { value: '10', setSelectionRange() { throw new Error('percentual não deve usar cursor de moeda'); } };
  const escopo = {
    $: () => ({ addEventListener(_tipo, fn) { listener = fn; } }),
    window: { _descontoNotaTipo: 'percent', PrecosCompra: require('../purchase-pricing.js') },
    formatarMoedaDigitada: new Function('return (' + html.slice(formatarInicio, formatarFim) + ')')(),
    atualizarTotaisDesp() {},
  };
  new Function('$', 'window', 'formatarMoedaDigitada', 'atualizarTotaisDesp', html.slice(inicio, fim))(
    escopo.$, escopo.window, escopo.formatarMoedaDigitada, escopo.atualizarTotaisDesp,
  );
  listener({ target: campo });
  assert.equal(campo.value, '10');
  campo.value = '10.5';
  listener({ target: campo });
  assert.equal(campo.value, '10,5');
  assert.equal(lerPercentualNota(campo.value), 10.5);
});

test('desconto exibido por item nunca supera o bruto da própria linha', () => {
  assert.equal(typeof calcularDescontoItem, 'function');
  assert.equal(typeof somarDescontosItens, 'function');
  assert.equal(calcularDescontoItem({ qtd: 2, valor: 10, desconto: 30, descontoTipo: 'valor' }), 20);
  assert.equal(calcularDescontoItem({ qtd: 2, valor: 10, desconto: 150, descontoTipo: 'percent' }), 20);
  assert.equal(calcularDescontoItem({ qtd: 2, valor: 10, desconto: -5, descontoTipo: 'valor' }), 0);
  assert.equal(somarDescontosItens([
    { qtd: 2, valor: 10, desconto: 30, descontoTipo: 'valor' },
    { qtd: 1, valor: 10, desconto: 10, descontoTipo: 'percent' },
  ]), 21);
});

test('prévia do resumo soma descontos efetivos e aplica margem sobre o custo líquido', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inicio = html.indexOf('window.atualizarTotaisDesp = function(){');
  const fim = html.indexOf('\n  };', inicio) + 5;
  assert(inicio >= 0 && fim > inicio);
  const campos = {
    despDesconto: { value: '10,5' },
    despSubtotal: { textContent: '' },
    despTotalDescItens: { textContent: '' },
    despTotalFinal: { textContent: '' },
  };
  const escopo = {
    window: {
      despItensTemp: [
        { nome: 'Produto com limite', qtd: 2, valor: 10, desconto: 30, descontoTipo: 'valor' },
        { nome: 'Produto com margem', qtd: 1, valor: 100, desconto: 20, descontoTipo: 'percent' },
      ],
      _descontoNotaTipo: 'percent',
      PrecosCompra: require('../purchase-pricing.js'),
    },
    document: { getElementById(id) { return campos[id] || null; } },
    lerDescontoNota: lerPercentualNota,
    moeda: valor => 'R$ ' + Number(valor).toFixed(2),
  };
  const atualizar = new Function('window', 'document', 'lerDescontoNota', 'moeda', html.slice(inicio, fim) + '\nreturn window.atualizarTotaisDesp;')(
    escopo.window, escopo.document, escopo.lerDescontoNota, escopo.moeda,
  );
  atualizar();
  assert.equal(campos.despSubtotal.textContent, 'R$ 120.00');
  assert.equal(campos.despTotalDescItens.textContent, 'R$ 40.00');
  assert.equal(campos.despTotalFinal.textContent, 'R$ 71.60');

  const venda = calcular({
    itens: [{ nome: 'Produto com margem', tipoItem: 'prod', qtd: 1, valor: 100, desconto: 20, descontoTipo: 'percent', lucroPct: 20 }],
    produtos: [],
    descontoNota: lerPercentualNota('10,5'),
    descontoNotaTipo: 'percent',
  }).grupos[0].preco;
  assert.equal(venda, 85.92);
});
