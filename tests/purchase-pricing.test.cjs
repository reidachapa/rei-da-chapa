const assert = require('node:assert/strict');
const test = require('node:test');
const { calcular, somarDescontosItens } = require('../purchase-pricing.js');

const pago = { nome: 'Suco Goiaba', tipoItem: 'prod', qtd: 6, valor: 3.24, lucroPct: 83 };
const gratis = { ...pago, desconto: 19.44, descontoTipo: 'valor' };
const produto = { id: 'suco', nome: 'Suco Goiaba', estoque: 0, custo: 0, preco: 5.93 };
function perto(valor, esperado) { assert(Math.abs(valor - esperado) < 1e-10, `${valor} deveria ser ${esperado}`); }

test('bonificação de outro fardo compõe uma média única e o preço de todas as linhas', () => {
  const r = calcular({ itens: [pago, gratis], produtos: [] });
  assert.equal(r.grupos.length, 1);
  assert.deepEqual(r.grupos[0].indices, [0, 1]);
  assert.equal(r.grupos[0].estoque, 12);
  perto(r.grupos[0].custoMedio, 1.62);
  assert.equal(r.grupos[0].preco, 2.96);
  assert.equal(r.grupos[0].lucroPct, 83);
  assert.equal(r.grupos[0].modoPreco, 'percentual');
  assert.equal(r.porIndice[0], r.porIndice[1]);
});

test('a ordem da linha bonificada não altera média ou preço', () => {
  const r = calcular({ itens: [gratis, pago], produtos: [] }).grupos[0];
  perto(r.custoMedio, 1.62);
  assert.equal(r.preco, 2.96);
});

test('desconto parcial em porcentagem reduz custo de todas as unidades do produto', () => {
  const r = calcular({ itens: [pago, { ...pago, desconto: 50, descontoTipo: 'percent' }], produtos: [] }).grupos[0];
  perto(r.custoMedio, 2.43);
  assert.equal(r.preco, 4.45);
});

test('desconto geral é rateado sobre o líquido das linhas incluindo ingredientes e pães', () => {
  const itens = [pago, gratis, { nome: 'Ingrediente', tipoItem: 'ing', qtd: 1, valor: 9.72 }, { nome: 'Pão', tipoItem: 'pao', qtd: 1, valor: 9.72 }];
  const r = calcular({ itens, produtos: [], descontoNota: 9.72 }).grupos[0];
  perto(r.custoMedio, 1.215);
  assert.equal(r.preco, 2.22);
  const soProduto = calcular({ itens: [pago, gratis], produtos: [], descontoNota: 50, descontoNotaTipo: 'percent' }).grupos[0];
  perto(soProduto.custoMedio, 0.81);
  assert.equal(soProduto.preco, 1.48);
});

test('saldo anterior participa da média projetada', () => {
  const r = calcular({ itens: [pago, gratis], produtos: [{ ...produto, estoque: 12, custo: 2 }] }).grupos[0];
  assert.equal(r.produtoId, 'suco');
  assert.equal(r.estoque, 24);
  perto(r.custoMedio, 1.81);
  assert.equal(r.preco, 3.31);
});

test('editar nota reverte aplicação anterior antes de projetar o novo estoque', () => {
  const anterior = { tipoRegistro: 'compra', itens: [{ ...pago, vinc: 'prod:suco', aplicado: { vinc: 'prod:suco', qtdEst: 6, custoAntes: 0, custoUnitario: 3.24 } }] };
  const r = calcular({ itens: [pago, gratis], produtos: [{ ...produto, estoque: 6, custo: 3.24 }], notaAnterior: anterior }).grupos[0];
  assert.equal(r.estoque, 12);
  perto(r.custoMedio, 1.62);
  assert.equal(r.preco, 2.96);
});

test('nota legada sem aplicado reverte desconto por item e rateio da nota', () => {
  const item = { nome: 'Suco Goiaba', tipoItem: 'prod', vinc: 'prod:suco', qtd: 2, valor: 10, desconto: 2, descontoOriginal: 2, descontoTipo: 'valor', lucroPct: 83 };
  const anterior = { tipoRegistro: 'compra', desconto: 6, itens: [item] };
  const r = calcular({ itens: [item], produtos: [{ ...produto, estoque: 10, custo: 3 }], notaAnterior: anterior, descontoNota: 6 }).grupos[0];
  assert.equal(r.estoque, 10);
  perto(r.custoMedio, 3);
  assert.equal(r.preco, 5.49);
});

test('edição de nota legada converte gramas para a unidade do estoque do ingrediente', () => {
  const linhaAntiga = {
    nome: 'Milho', tipoItem: 'ing', vinc: 'ing:milho', qtd: 2000, unid: 'g', valor: 0.01,
    modoCompra: 'flexivel', modoPreco: 'percentual', lucroPct: 50,
  };
  const catalogo = {
    id: 'milho', nome: 'Milho', modoCompra: 'flexivel', unidade: 'g', unidadeEstoque: 'kg',
    estoque: 12, custo: 40 / 12, precoExtra: 0,
  };
  const r = calcular({
    itens: [linhaAntiga], ingredientes: [catalogo],
    quantidadesEstoquePorIndice: [2],
    notaAnterior: { tipoRegistro: 'compra', itens: [linhaAntiga] },
  }).grupos[0];

  assert.equal(r.estoque, 12);
  perto(r.custoMedio, 40 / 12);
  assert.equal(r.preco, 5);
});

test('edição de nota legada reconhece nomes longos de unidades físicas', () => {
  const casos = [
    { nome: 'Água', unidade: 'ml', unidadeEstoque: 'l', qtd: 2000, unid: 'mililitros' },
    { nome: 'Farinha', unidade: 'mg', unidadeEstoque: 'kg', qtd: 2000000, unid: 'miligramas' },
  ];
  casos.forEach((caso, indice) => {
    const vinc = 'ing:medida-' + indice;
    const linha = { ...caso, tipoItem: 'ing', vinc, valor: 20 / caso.qtd, modoCompra: 'flexivel', modoPreco: 'percentual', lucroPct: 50 };
    const catalogo = { id: 'medida-' + indice, nome: caso.nome, modoCompra: 'flexivel', unidade: caso.unidade, unidadeEstoque: caso.unidadeEstoque, estoque: 12, custo: 40 / 12 };
    const resultado = calcular({ itens: [linha], ingredientes: [catalogo], quantidadesEstoquePorIndice: [2], notaAnterior: { tipoRegistro: 'compra', itens: [linha] } }).grupos[0];
    assert.equal(resultado.estoque, 12);
    perto(resultado.custoMedio, 40 / 12);
    assert.equal(resultado.preco, 5);
  });
});

test('edição não reverte uma compra flexível anterior à contagem física atual', () => {
  const anterior = {
    tipoRegistro: 'compra',
    itens: [{
      nome: 'Tomate', tipoItem: 'ing', vinc: 'ing:tomate', qtd: 2, unid: 'kg', valor: 5,
      modoCompra: 'flexivel',
      aplicado: { vinc: 'ing:tomate', qtdEst: 2, semEstoque: true, contagemEstoqueId: 'contagem-antiga', custoAntes: 3, custoUnitario: 5 },
    }],
  };
  const catalogo = [{ id: 'tomate', nome: 'Tomate', modoCompra: 'flexivel', unidade: 'kg', unidadeEstoque: 'kg', semEstoque: true, estoqueEstimado: 18, contagemEstoqueId: 'contagem-atual', custo: 3 }];
  const linhaNova = { nome: 'Tomate', tipoItem: 'ing', vinc: 'ing:tomate', qtd: 1, unid: 'kg', valor: 4, modoCompra: 'flexivel', modoPreco: 'percentual', lucroPct: 50 };
  const resultado = calcular({ itens: [linhaNova], ingredientes: catalogo, quantidadesEstoquePorIndice: [1], notaAnterior: anterior }).grupos[0];

  assert.equal(resultado.estoque, 19);
  perto(resultado.custoMedio, 58 / 19);
  assert.equal(resultado.preco, 4.58);
});

test('aplicado com custo zero é respeitado na reversão da bonificação', () => {
  const item = { ...gratis, vinc: 'prod:suco', aplicado: { vinc: 'prod:suco', qtdEst: 6, custoAntes: 3.24, custoUnitario: 0 } };
  const r = calcular({ itens: [item], produtos: [{ ...produto, estoque: 12, custo: 1.62 }], notaAnterior: { tipoRegistro: 'compra', itens: [item] } }).grupos[0];
  assert.equal(r.estoque, 12);
  perto(r.custoMedio, 1.62);
});

test('modo manual explícito preserva venda mesmo com percentual legado preenchido', () => {
  const r = calcular({ itens: [pago, { ...gratis, modoPreco: 'manual', pv: 4.50 }], produtos: [] }).grupos[0];
  assert.equal(r.preco, 4.50);
  assert.equal(r.modoPreco, 'manual');
  perto(r.lucroPct, (4.50 / 1.62 - 1) * 100);
});

test('último modo explícito do grupo vence e percentual zero é válido', () => {
  const r = calcular({ itens: [{ ...pago, modoPreco: 'manual', pv: 9 }, { ...gratis, modoPreco: 'percentual', lucroPct: 0 }], produtos: [] }).grupos[0];
  assert.equal(r.preco, 1.62);
  assert.equal(r.modoPreco, 'percentual');
});

test('preço legado sem percentual é manual e ausência de escolha preserva o preço do catálogo', () => {
  const manual = calcular({ itens: [{ nome: 'Suco Goiaba', qtd: 2, valor: 10, pv: 6 }], produtos: [produto] }).grupos[0];
  assert.equal(manual.modoPreco, 'manual');
  assert.equal(manual.preco, 6);
  const semEscolha = calcular({ itens: [{ nome: 'Suco Goiaba', qtd: 2, valor: 10 }], produtos: [produto] }).grupos[0];
  assert.equal(semEscolha.modoPreco, null);
  assert.equal(semEscolha.preco, null);
});

test('bonificação integral permite preço automático zero em vez de conservar valor antigo', () => {
  const r = calcular({ itens: [gratis], produtos: [produto] }).grupos[0];
  assert.equal(r.preco, 0);
  assert.equal(r.custoMedio, 0);
});

test('vínculos existentes prevalecem sobre nome e vínculo perdido reutiliza nome normalizado', () => {
  const itens = [{ ...pago, vinc: 'prod:suco', nome: 'Nome histórico' }, { ...gratis, vinc: 'prod:inexistente', nome: ' suco GOIÁBA ' }];
  const r = calcular({ itens, produtos: [produto] });
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].produtoId, 'suco');
  assert.equal(r.grupos[0].preco, 2.96);
});

test('produto, ingrediente e pão ficam em grupos separados; linhas incompletas não entram', () => {
  const r = calcular({
    itens: [pago, { ...pago, tipoItem: 'ing' }, { ...pago, tipoItem: 'pao', vinc: 'pao:brioche' }, { ...pago, qtd: 0 }, { ...pago, nome: '' }],
    paes: [{ id: 'brioche', nome: 'Pão Brioche' }],
  });
  assert.equal(r.grupos.length, 3);
  assert.deepEqual(r.grupos.map(g => [g.tipoItem, g.indices]), [['prod', [0]], ['ing', [1]], ['pao', [2]]]);
  assert.deepEqual(r.porIndice.slice(3), [null, null]);
});

test('prévia do pão usa o destino escolhido, inclusive antes de digitar a descrição', () => {
  const paes = [
    { id: 'brioche', nome: 'Pão Brioche', estoque: 10, custo: 3 },
    { id: 'australia', nome: 'Pão Australiano', estoque: 4, custo: 6 },
  ];
  const linha = { nome: '', tipoItem: 'pao', vinc: 'pao:australia', qtd: 2, valor: 3, lucroPct: 40 };
  const segunda = { ...linha, nome: 'Pão Brioche' };
  const { grupos, porIndice } = calcular({ itens: [linha, segunda], paes, incluirRascunhosSemNome: true });
  assert.equal(grupos.length, 1);
  assert.equal(porIndice[0], porIndice[1]);
  assert.equal(porIndice[0].catalogoId, 'australia');
  assert.equal(porIndice[0].custoMedio, 4.5);
  assert.equal(porIndice[0].preco, 6.3);
});

test('pão sem destino válido só participa do rateio geral da nota', () => {
  const paes = [{ id: 'brioche', nome: 'Pão Brioche', estoque: 10, custo: 3 }];
  for (const vinc of ['', 'pao:inexistente', 'prod:suco']) {
    const pao = { nome: 'Pão Brioche', tipoItem: 'pao', vinc, qtd: 1, valor: 9.72 };
    const { grupos, porIndice } = calcular({ itens: [pago, pao], produtos: [produto], paes, descontoNota: 9.72 });
    assert.equal(porIndice[1], null);
    assert.equal(grupos.length, 1);
    perto(porIndice[0].custoMedio, 2.16);
  }
});

test('prévia pode calcular a venda antes do nome sem reutilizar vínculo antigo', () => {
  const item = { nome: '  ', tipoItem: 'prod', vinc: 'prod:suco', qtd: 6, valor: 3.24, lucroPct: 83 };
  const catalogo = [{ ...produto, estoque: 12, custo: 1.62, preco: 2.96 }];
  const r = calcular({ itens: [item], produtos: catalogo, incluirRascunhosSemNome: true });
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].produtoId, null);
  assert.deepEqual(r.grupos[0].indices, [0]);
  assert.equal(r.grupos[0].estoque, 6);
  perto(r.grupos[0].custoMedio, 3.24);
  assert.equal(r.grupos[0].preco, 5.93);
});

test('linhas sem nome têm preços independentes na prévia e quantidade zero continua excluída', () => {
  const itens = [
    { nome: '', qtd: 6, valor: 3.24, lucroPct: 83 },
    { nome: ' ', qtd: 2, valor: 10, lucroPct: 50 },
    { nome: '', qtd: 0, valor: 5, lucroPct: 83 },
  ];
  const r = calcular({ itens, produtos: [], incluirRascunhosSemNome: true });
  assert.equal(r.grupos.length, 2);
  assert.deepEqual(r.grupos.map(g => g.indices), [[0], [1]]);
  assert.deepEqual(r.grupos.map(g => g.preco), [5.93, 15]);
  assert.equal(r.porIndice[2], null);
});

test('salvamento padrão continua descartando linhas sem nome mesmo com vínculo e preço', () => {
  const item = { nome: '', vinc: 'prod:suco', qtd: 6, valor: 3.24, lucroPct: 83 };
  const r = calcular({ itens: [item], produtos: [produto] });
  assert.deepEqual(r.grupos, []);
  assert.deepEqual(r.porIndice, [null]);
});

test('opção de prévia conserva agrupamento dos produtos nomeados e rateia só linhas válidas', () => {
  const itens = [pago, gratis, { nome: '', qtd: 2, valor: 9.72, lucroPct: 50 }, { nome: '', qtd: 0, valor: 100 }];
  const r = calcular({ itens, produtos: [], incluirRascunhosSemNome: true, descontoNota: 9.72 });
  assert.equal(r.grupos.length, 2);
  assert.deepEqual(r.grupos[0].indices, [0, 1]);
  perto(r.grupos[0].custoMedio, 1.215);
  assert.equal(r.grupos[0].preco, 2.22);
  assert.deepEqual(r.grupos[1].indices, [2]);
  perto(r.grupos[1].custoMedio, 7.29);
  assert.equal(r.grupos[1].preco, 10.94);
  assert.equal(r.porIndice[3], null);
});

test('entrada congelada permanece inalterada e grupos diferentes calculam preços independentes', () => {
  function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
  const entrada = freeze({ itens: [pago, gratis, { nome: 'Outro', qtd: 2, valor: 7, lucroPct: 10 }], produtos: [produto], notaAnterior: { tipoRegistro: 'compra', itens: [] } });
  const antes = JSON.stringify(entrada);
  const r = calcular(entrada);
  assert.equal(r.grupos.length, 2);
  assert.equal(r.grupos[1].preco, 7.70);
  assert.equal(JSON.stringify(entrada), antes);
});

test('projeção de edição coincide com reversão e aplicação reais do estoque', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
  function source(nome) {
    const ini = html.indexOf('function ' + nome + '(');
    const fim = html.indexOf('\n}\n', ini) + 2;
    assert(ini >= 0 && fim > ini);
    return html.slice(ini, fim);
  }
  const orig = [
    { ...pago, vinc: 'prod:suco', aplicado: { vinc: 'prod:suco', qtdEst: 6, custoAntes: 0, custoUnitario: 3.24 } },
    { ...gratis, vinc: 'prod:suco', aplicado: { vinc: 'prod:suco', qtdEst: 6, custoAntes: 3.24, custoUnitario: 0 } },
  ];
  const anterior = { tipoRegistro: 'compra', itens: orig };
  const produtos = [{ ...produto, estoque: 12, custo: 1.62 }];
  const novos = [pago, gratis];
  const prevista = calcular({ itens: novos, produtos, notaAnterior: anterior }).grupos[0];
  const real = structuredClone(produtos[0]);
  const run = new Function('alvoEstoque', 'ehNotaCompraSalva', source('reverterCompraEstoque') + '\n' + source('aplicarCompraEstoque') + '\nreturn {reverterCompraEstoque,aplicarCompraEstoque};')(
    v => String(v) === 'prod:suco' ? { tipo: 'prod', obj: real } : null,
    n => !!(n && n.tipoRegistro !== 'despesa' && Array.isArray(n.itens) && n.itens.length)
  );
  run.reverterCompraEstoque(structuredClone(orig), structuredClone(anterior));
  run.aplicarCompraEstoque(novos.map(it => ({ ...it, vinc: 'prod:suco' })));
  assert.equal(real.estoque, prevista.estoque);
  perto(real.custo, prevista.custoMedio);
});

test('desconto e margem de cada produto usam o custo médio da própria linha', () => {
  const itens = [
    { nome: 'Produto A', tipoItem: 'prod', qtd: 5, valor: 100, desconto: 10, descontoTipo: 'percent', lucroPct: 80, modoPreco: 'percentual' },
    { nome: 'Produto B', tipoItem: 'prod', qtd: 4, valor: 13.33, desconto: 7, descontoTipo: 'percent', lucroPct: 37.5678, modoPreco: 'percentual' },
  ];
  const resultado = calcular({ itens, produtos: [] });
  assert.equal(resultado.grupos.length, 2);
  perto(resultado.grupos[0].custoMedio, 90);
  assert.equal(resultado.grupos[0].lucroPct, 80);
  assert.equal(resultado.grupos[0].preco, 162);
  perto(resultado.grupos[1].custoMedio, 12.3969);
  assert.equal(resultado.grupos[1].lucroPct, 37.5678);
  assert.equal(resultado.grupos[1].preco, 17.05);
  perto(somarDescontosItens(itens), 53.7324);
});
