const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
const queue = fs.readFileSync(path.join(__dirname, '../print-queue.js'), 'utf8');
function source(name, end) {
  const start = html.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  const finish = html.indexOf(end, start);
  assert(finish > start, name + ' boundary');
  return html.slice(start, finish);
}
const pedido = () => ({id:'pedido', numero:1, data:'2026-11-15T12:00:00Z', tipo:'retirada', cliente:'Teste', jurosPedido:2.50, subtotalBruto:20, subtotal:22.50, total:22.50, pago:false, pagamento:'pendente', itens:[{qtd:1,nome:'Produto',preco:20}]});
const moeda = n => 'R$ ' + Number(n).toFixed(2).replace('.', ',');
function contexto(extras={}) {
  return {numeroPedidoExibicao:p=>p.numero, dinheiroImpressao:moeda, moedaSimple:moeda, esc:s=>String(s), pagamentosDoPedido:()=>[], PAGAMENTO_LABEL:{}, printerState:{larguraPapel:32}, pad:String, URL, setTimeout(){}, resumoFinanceiroPedidoImpressao:p=>({...p,descontoPedido:p.descontoPedido||0,taxaEntrega:p.taxaEntrega||0}), ...extras};
}

test('impressão no navegador discrimina juros e mantém total cobrado', () => {
  let papel='';
  const documentoPapel={open(){},write(texto){papel=texto},close(){},querySelector(){return null}};
  const ctx=contexto({document:{baseURI:'https://exemplo.test/',body:{appendChild(){}},createElement(){return{style:{},contentWindow:{document:documentoPapel}}}}});
  vm.createContext(ctx);
  vm.runInContext(source('imprimirViaNavegadorDirect', "\n$('#btnExportarCSV')"),ctx);
  ctx.imprimirViaNavegadorDirect(pedido());
  assert.match(papel, /Juros:<\/b> \+ R\$ 2,50/);
  assert.match(papel, /TOTAL: R\$ 22,50/);
});

test('cupom térmico discrimina juros sem depender da conexão física', async () => {
  const ctx=contexto({CMD:new Proxy({},{get(){return[]}}),encode:s=>Array.from(Buffer.from(s,'utf8')),gerarLogoCupomBytes:async()=>[]});
  vm.createContext(ctx);
  vm.runInContext('async '+source('gerarCupom','\nfunction gerarCupomAlteracao'),ctx);
  const texto=Buffer.from(await ctx.gerarCupom(pedido())).toString('utf8');
  assert.match(texto,/Juros: \+ R\$ 2,50/);
  assert.match(texto,/TOTAL: R\$ 22,50/);
});

test('ficha e mensagem pronta discriminam juros mesmo sem taxa ou desconto', () => {
  const p=pedido(),campos={fcNome:'Teste',fcValor:'22,50'};
  const ctx=contexto({pedidos:[p],pedidoFichaId:p.id,fichaDados:()=>({numero:1,geral:1,mensal:1}),fmt3:String,lerMoeda:()=>22.5,$:s=>({value:campos[s.slice(1)]||''}),$$:()=>[]});
  vm.createContext(ctx);
  vm.runInContext(source('gerarTextoFicha','\nfunction atualizarPreviewFicha'),ctx);
  const texto=ctx.gerarTextoFicha();
  assert.match(texto,/JUROS ➡️ R\$ 2,50/);
  assert.match(texto,/TOTAL DO PEDIDO ➡️ R\$ 22,50/);
});

test('snapshot enviado à fila compartilhada mantém juros e é uma cópia independente', () => {
  const start=queue.indexOf('function montarSnapshotPedido('),end=queue.indexOf('\n  function chaveOutboxEvento',start);
  const ctx={clonarJson:v=>JSON.parse(JSON.stringify(v))};
  vm.createContext(ctx);
  vm.runInContext(queue.slice(start,end),ctx);
  const p=pedido(),snap=ctx.montarSnapshotPedido(p,'pedido');
  assert.equal(snap.ticket.jurosPedido,2.5);
  assert.equal(snap.ticket.total,22.5);
  p.jurosPedido=8;
  assert.equal(snap.ticket.jurosPedido,2.5);
});
