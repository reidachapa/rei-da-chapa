const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const precos = require('../purchase-pricing.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function funcoes() {
  const inicio = html.indexOf('function prepararCustoItemCompra(');
  const fim = html.indexOf('async function salvarCompraDaNota(', inicio);
  assert.ok(inicio >= 0 && fim > inicio, 'os cálculos de custo da compra devem estar disponíveis');
  return vm.runInNewContext(html.slice(inicio, fim) + '\n({prepararCustoItemCompra, alterarModoCustoItemCompra})');
}

test('35 unidades a 1,75 mantêm total de 61,25 e desconto percentual', () => {
  const {prepararCustoItemCompra, alterarModoCustoItemCompra} = funcoes();
  const item = {nome:'Teste', tipoItem:'prod', qtd:35, valor:1.75, descontoTipo:'percent', desconto:10, custoModo:'unitario'};
  prepararCustoItemCompra(item);
  assert.equal(item.totalCusto, 61.25);
  assert.equal(precos.calcular({itens:[item], produtos:[]}).porIndice[0].custoMedio, 1.575);
  assert.equal(alterarModoCustoItemCompra(item, 'total'), true);
  assert.equal(item.totalCusto, 61.25);
  assert.equal(alterarModoCustoItemCompra(item, 'unitario'), true);
  assert.equal(item.valor, 1.75);
});

test('alternar total de 1 real por 3 unidades não arredonda nem altera o total salvo', () => {
  const {prepararCustoItemCompra, alterarModoCustoItemCompra} = funcoes();
  const item = {qtd:3, valor:1/3, totalCusto:1, custoModo:'total'};
  prepararCustoItemCompra(item);
  assert.equal(alterarModoCustoItemCompra(item, 'unitario'), true);
  assert.equal(alterarModoCustoItemCompra(item, 'total'), true);
  assert.ok(Math.abs(item.totalCusto - 1) < 1e-12);
});

test('nota antiga sem modo conserva o valor unitário e total calculado', () => {
  const {prepararCustoItemCompra} = funcoes();
  const item = {qtd:35, valor:1.75};
  prepararCustoItemCompra(item);
  assert.equal(item.valor, 1.75);
  assert.equal(item.totalCusto, 61.25);
});

test('total informado com quantidade zero não é apagado pela troca de modo', () => {
  const {alterarModoCustoItemCompra} = funcoes();
  const item = {qtd:0, valor:0, totalCusto:12, custoModo:'total'};
  assert.equal(alterarModoCustoItemCompra(item, 'unitario'), false);
  assert.equal(item.totalCusto, 12);
  assert.equal(item.custoModo, 'total');
});

test('formulário ativo exibe custo unitário de 35 unidades e permite escolher o total', () => {
  const inicio = html.lastIndexOf('  window.renderDespItens = function(){');
  const fim = html.indexOf('  function atualizarPrecoAoEditarCompra(', inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  const lista = { innerHTML: '', dataset:{}, querySelectorAll() { return []; }, querySelector() { return null; }, addEventListener(tipo,fn){if(tipo==='click')this.clicar=fn} };
  const item = {nome:'Teste', qtd:35, valor:1.75, tipoItem:'prod', custoModo:'unitario', desconto:0};
  const window = {despItensTemp:[item], PrecosCompra:precos, atualizarTotaisDesp(){}};
  const contexto = {window, document:{getElementById(id){return id==='despItensLista'?lista:null},addEventListener(){}},
    atualizarListaAutocomplete(){}, getCatsParaItem(){return []}, categoriaPDVOculta(){return false},
    produtos:[], ingredientes:[], paes:[], despesas:[], editandoDespesaId:null, quantidadeEstoqueProjetada:it=>Number(it&&it.qtd)||0, buscarCatalogoCompra:()=>null,
    ...funcoes(), lerMoeda(){return 0},
    lerDescontoNota(valor,tipo){return tipo==='percent'?precos.lerPercentualNota(valor):0},
    esc:v=>String(v), moeda:v=>String(v), moedaSimple:v=>v.toLocaleString('pt-BR',{minimumFractionDigits:2}),
    normalizarNomeCadastro:v=>String(v||'').toLowerCase(), buscarIngredienteCompra(){return null}};
  const formatacao = html.slice(html.indexOf('function formatarDecimalCompra('), html.indexOf('function normalizarNomeCadastro('));
  const desconto = html.slice(html.indexOf('function textoDescontoNotaCompra('), html.indexOf('function lerQuantidade('));
  vm.runInNewContext(formatacao+desconto+html.slice(inicio,fim)+'\nwindow.renderDespItens();',contexto);
  assert.match(lista.innerHTML, /data-modo="unitario"/);
  assert.match(lista.innerHTML, /data-modo="total"/);
  assert.match(lista.innerHTML, /placeholder="Custo unitário R\$"[^>]*value="1,75"/);
  assert.match(lista.innerHTML, /value="61,25"/);
  const inicioClique=html.indexOf('// Cliques delegados mantêm botões funcionais');
  const fimClique=html.indexOf('</script>',inicioClique);
  vm.runInNewContext(html.slice(inicioClique,fimClique),contexto);
  function clicar(modo){lista.clicar({target:{closest(){return {dataset:{idx:'0',modo},classList:{contains(nome){return nome==='ic-custo-modo'}}}}},preventDefault(){},stopImmediatePropagation(){}})}
  clicar('total');
  assert.equal(item.valor,1.75);
  assert.match(lista.innerHTML, /placeholder="Total do item R\$"[^>]*value="61,25"/);
  clicar('unitario');
  assert.match(lista.innerHTML, /placeholder="Custo unitário R\$"[^>]*value="1,75"/);
  Object.assign(item, { qtd: 12, valor: 88 / 12, desconto: 12.34567, descontoTipo: 'percent' });
  window.renderDespItens();
  assert.match(lista.innerHTML, /placeholder="Custo unitário R\$"[^>]*value="7,33"/);
  assert.match(lista.innerHTML, /class="ic-desc-item"[^>]*value="12,35"/);
  assert.equal(item.valor, 88 / 12);
  assert.equal(item.totalCusto, 88);
  assert.equal(item.desconto, 12.34567);
});
