const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const AjustesPedido = require('../order-adjustments.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g,'\n');
function source(name, end) {
  const start = html.indexOf('function ' + name + '(');
  const finish = html.indexOf(end, start);
  assert(start >= 0 && finish > start, name + ' source exists');
  return html.slice(start, finish);
}
const currency = source('lerMoeda', '\nfunction lerQuantidade');
const pricing = source('calcularTotalCarrinho', '\nfunction chaveTentativaCheckout');
const opening = source('abrirModalFinalizar', '\nfunction atualizarResumoPgto');
const paymentSummary = source('atualizarResumoPgto', '\nlet checkoutPago');
const fillPayment = source('preencherPagamentoAoSelecionar', "\n$$('#pgtoMultiplo .pgto-linha')");
function element(dataset={}) {
  const classes = new Set();
  return { value:'', dataset, textContent:'', style:{}, setAttribute(){},
    classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k),toggle(k,force){if(force)classes.add(k);else classes.delete(k)}} };
}
function app(cart={produto:2}) {
  const nodes={};
  const $ = selector => nodes[selector] || (nodes[selector]=element());
  const payments=['pix','dinheiro','debito','credito'].map(pgto=>element({pgto}));
  const rows=payments.map(p=>element({pgto:p.dataset.pgto}));
  const types=['retirada','entrega'].map(tipo=>element({tipo}));
  const $$ = selector => {
    if(selector==='#pgtoMultiplo .pgto-input')return payments;
    if(selector==='#pgtoMultiplo .pgto-linha')return rows;
    if(selector==='#opcoesTipo .opcao')return types;
    throw new Error('unexpected collection selector '+selector);
  };
  const deps={$, $$, cart, AjustesPedido};
  const functions=new Function('deps', `
    var $=deps.$,$$=deps.$$,carrinho=deps.cart,window={AjustesPedido:deps.AjustesPedido};
    var document={querySelectorAll:deps.$$};
    var tipoSelecionado='entrega',pgtoSelecionado='pix',pagamentosAtuais={},clienteSelecionadoId=null,TAXA_ENTREGA_PADRAO=5;
    function getItemCarrinho(){return {produto:{preco:20},ings:{}}}
    function precoExtraItem(){return 0}
    function moeda(n){return 'R$ '+Number(n).toFixed(2).replace('.',',')}
    function prepararNovoEnderecoCheckout(){}
    ${currency}
    ${pricing}
    ${opening}
    ${paymentSummary}
    ${fillPayment}
    return {abrirModalFinalizar,valoresModalPedido,atualizarTotalModal,preencherPagamentoAoSelecionar,tipo(tipo){tipoSelecionado=tipo}};
  `)(deps);
  return {functions,nodes,$,payments,types};
}

test('abrir fechamento com carrinho limpa juros anteriores e todos os pagamentos sem erro', () => {
  const h=app();
  h.$('#inpDescontoPedido').value='7,00';
  h.$('#inpJurosPedido').value='4,00';
  h.payments.forEach(p=>{p.value='10,00';p.dataset.autoPreenchido='1'});
  assert.doesNotThrow(()=>h.functions.abrirModalFinalizar());
  assert(h.$('#modalFinalizar').classList.contains('aberto'));
  assert.equal(h.$('#inpDescontoPedido').value,'');
  assert.equal(h.$('#inpJurosPedido').value,'');
  assert.equal(h.$('#modalTotal').textContent,'R$ 40,00');
  assert(h.payments.every(p=>p.value===''&&!p.dataset.autoPreenchido));
  assert.equal(h.$('#campoTaxa').style.display,'none');
});

test('carrinho vazio não abre fechamento',()=>{
  const h=app({});
  h.functions.abrirModalFinalizar();
  assert(!h.$('#modalFinalizar').classList.contains('aberto'));
});

test('desconto e juros independentes são aplicados juntos com entrega e sinal correto',()=>{
  const h=app();h.functions.abrirModalFinalizar();
  h.functions.tipo('entrega');h.$('#inpTaxaEntrega').value='5,00';h.$('#inpDescontoPedido').value='3,00';
  h.$('#inpJurosPedido').value='5,00';h.functions.atualizarTotalModal();
  assert.equal(h.$('#modalTotal').textContent,'R$ 47,00');
  assert.equal(h.functions.valoresModalPedido().jurosPedido,5);
  assert.equal(h.functions.valoresModalPedido().descontoPedido,3);
  h.$('#inpDescontoPedido').value='7,00';h.functions.atualizarTotalModal();
  assert.equal(h.$('#modalTotal').textContent,'R$ 43,00');
  assert.equal(h.$('#inpJurosPedido').value,'5,00');
  assert.equal(h.functions.valoresModalPedido().jurosPedido,5);
});

test('pagamento automático acompanha juros e conserva divisão digitada em outro método',()=>{
  const h=app();h.functions.abrirModalFinalizar();
  h.functions.tipo('entrega');h.$('#inpTaxaEntrega').value='5,00';h.functions.atualizarTotalModal();
  const pix=h.payments.find(p=>p.dataset.pgto==='pix'),debito=h.payments.find(p=>p.dataset.pgto==='debito');
  h.functions.preencherPagamentoAoSelecionar(pix);
  assert.equal(pix.value,'45,00');
  h.$('#inpJurosPedido').value='3,00';h.functions.atualizarTotalModal();
  assert.equal(pix.value,'48,00');
  assert.match(h.$('#pgtoResumo').textContent,/Total pago: R\$ 48,00/);
  debito.value='10,00';h.functions.atualizarTotalModal();
  assert.equal(pix.value,'38,00');
  h.$('#inpDescontoPedido').value='3,00';h.functions.atualizarTotalModal();
  assert.equal(pix.value,'35,00');assert.equal(debito.value,'10,00');
  assert.equal(h.$('#inpJurosPedido').value,'3,00');
  assert.match(h.$('#pgtoResumo').textContent,/Total pago: R\$ 45,00/);
});
