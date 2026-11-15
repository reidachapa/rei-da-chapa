const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Patrimonio = require('../patrimonio.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');

test('gasto de aquisição inclui bens baixados e valor em uso mantém só os bens disponíveis', () => {
  const bens = [{valor:100,estado:'Ativo'}, {valor:10.10,estado:'Manutenção'}, {valor:20.20,estado:'Baixado'}];
  const antes = structuredClone(bens);
  assert.deepEqual(Patrimonio.resumir(bens), {quantidade:3,totalAquisicoes:130.30,valorEmUso:110.10});
  assert.deepEqual(bens, antes);
});

test('investimento por período usa a data da compra com início incluso e fim exclusivo', () => {
  const bens = [
    {valor:100,data:'2026-11-01'}, {valor:20.25,data:'2026-11-30',estado:'Baixado'},
    {valor:500,data:'2026-12-01'}, {valor:300,data:'2026-10-31'},
    {valor:1000,data:''}, {valor:2000,data:'2026-11-31'}, {valor:3000,data:'texto'},
  ];
  assert.equal(Patrimonio.investimentosNoPeriodo(bens, new Date(2026,10,1),new Date(2026,11,1)),120.25);
  assert.equal(Patrimonio.dataCompraValida('2026-02-30'),false);
  assert.equal(Patrimonio.dataCompraValida('2024-02-29'),true);
  assert.equal(Patrimonio.dataCompraValida('2026-11-01'),true);
});

test('resumo aceita catálogo vazio e ignora valores antigos inválidos sem gerar saldo negativo', () => {
  assert.deepEqual(Patrimonio.resumir([]),{quantidade:0,totalAquisicoes:0,valorEmUso:0});
  assert.equal(Patrimonio.resumir([{valor:0.1},{valor:0.2},{valor:-10},{valor:'inválido'}]).totalAquisicoes,0.3);
});

function node() {
  return {value:'',innerHTML:'',textContent:'',style:{},events:{},disabled:false,
    addEventListener(name,cb){this.events[name]=cb},scrollIntoView(){}};
}
function harness({bens=[],save=async()=>({ok:true}),dreRender=()=>{}}={}) {
  const nodes={};
  for(const id of ['formBemEmpresa','bemNome','bemCategoria','bemEstado','bemData','bemValor','bemIdentificacao','bemLocal','bemObs','bemFormTitulo','btnSalvarBem','btnCancelarBem','btnGerirCategoriasBem','listaBensEmpresa','bensResumo'])nodes[id]=node();
  const stats={saves:0,resets:0,dre:0,warnings:0},messages=[];
  nodes.formBemEmpresa.reset=()=>{stats.resets++;for(const id of ['bemNome','bemData','bemValor','bemIdentificacao','bemLocal','bemObs'])nodes[id].value='';nodes.bemCategoria.value='Equipamento';nodes.bemEstado.value='Ativo'};
  const document={getElementById:id=>nodes[id]||null,querySelectorAll:()=>Object.values(nodes)};
  const deps={nodes,stats,messages,document,bens:structuredClone(bens),save,dreRender,Patrimonio};
  const start=html.indexOf('  var editId=null',html.indexOf('id="scrollbars-cleanup-css"'));
  const end=html.indexOf('\n})();',start);
  assert(start>=0&&end>start,'real asset form source exists');
  const app=new Function('deps',`
    var document=deps.document,window={Patrimonio:deps.Patrimonio},bensEmpresa=deps.bens,categoriasBens=['Equipamento'],serial=0;
    function souGerente(){return true} function uid(){return 'test'+(++serial)}
    function normalizarNomeCadastro(v){return String(v||'').toLowerCase()} function esc(v){return String(v||'')}
    function moeda(v){return 'R$ '+Number(v).toFixed(2).replace('.',',')}
    function lerMoeda(v){return Number(String(v||'0').replace(/\\./g,'').replace(',','.'))}
    function dataHojeLocal(){return '2026-11-15'}
    function salvar(){deps.stats.saves++;return deps.save()}
    var console={warn(){deps.stats.warnings++}};
    function toast(v){deps.messages.push(v)} function renderDRE(){deps.stats.dre++;deps.dreRender()}
    function confirm(){return true}
    ${html.slice(start,end)}
    return {get bens(){return bensEmpresa},render:window.renderPatrimonio};
  `)(deps);
  function fill(extra={}){const fields={bemNome:'Freezer',bemCategoria:'Equipamento',bemEstado:'Ativo',bemData:'2026-11-15',bemValor:'1.000,50',bemIdentificacao:'Modelo A',bemLocal:'Cozinha',bemObs:'Compra de teste',...extra};for(const [id,v]of Object.entries(fields))nodes[id].value=v}
  const submit=()=>nodes.formBemEmpresa.events.submit({preventDefault(){}});
  const click=(acao,id)=>nodes.listaBensEmpresa.events.click({target:{closest(){return{dataset:{bem:acao,id}}}}});
  return{app,nodes,stats,messages,fill,submit,click};
}

test('salvar espera confirmação, bloqueia clique duplo e só limpa depois da gravação', async()=>{
  let finish;const h=harness({save:()=>new Promise(resolve=>{finish=resolve})});h.fill();const resets=h.stats.resets;
  const first=h.submit();await h.submit();
  assert.equal(h.stats.saves,1);assert.equal(h.stats.resets,resets);assert.equal(h.nodes.bemNome.value,'Freezer');
  finish({ok:true});await first;
  assert.equal(h.app.bens.length,1);assert.equal(h.app.bens[0].valor,1000.50);assert.equal(h.nodes.bemNome.value,'');
  assert.match(h.nodes.bensResumo.innerHTML,/Total gasto em aquisições/);assert.match(h.nodes.bensResumo.innerHTML,/1\.000,50|1000,50/);
});

test('falha ao cadastrar reverte somente o bem e conserva o formulário para tentar novamente',async()=>{
  const h=harness({bens:[{id:'anterior',nome:'Forno',valor:50}],save:async()=>({ok:false})});h.fill();await h.submit();
  assert.deepEqual(h.app.bens,[{id:'anterior',nome:'Forno',valor:50}]);assert.equal(h.nodes.bemNome.value,'Freezer');
  assert(!h.messages.some(x=>/cadastrado/.test(x)));assert(h.messages.some(x=>/confirmar/.test(x)));
});

test('editar preserva propriedades existentes e falha mantém os dados antigos e o formulário',async()=>{
  let ok=false;const old={id:'b1',nome:'Forno',valor:50,data:'2026-10-01',categoria:'Equipamento',estado:'Ativo',criadoEm:'2026-10-01T12:00:00Z',extra:{preservar:true}};
  const h=harness({bens:[old],save:async()=>({ok})});await h.click('editar','b1');h.fill({bemNome:'Forno novo',bemValor:'70,00'});await h.submit();
  assert.deepEqual(h.app.bens,[old]);assert.equal(h.nodes.bemNome.value,'Forno novo');
  ok=true;await h.submit();assert.equal(h.app.bens[0].nome,'Forno novo');assert.equal(h.app.bens[0].valor,70);assert.deepEqual(h.app.bens[0].extra,{preservar:true});assert.equal(h.app.bens[0].criadoEm,old.criadoEm);
});

test('excluir com falha mantém o bem e com sucesso remove sem alterar outras aquisições',async()=>{
  let ok=false;const old={id:'b1',nome:'Forno',valor:50,data:'2026-10-01'},other={id:'b2',nome:'Moto',valor:200};
  const h=harness({bens:[old,other],save:async()=>({ok})});await h.click('excluir','b1');assert.deepEqual(h.app.bens,[old,other]);
  ok=true;await h.click('excluir','b1');assert.deepEqual(h.app.bens,[other]);
});

test('edição recusa sobrescrever alterações de outro aparelho',async()=>{
  const h=harness({bens:[{id:'b1',nome:'Forno',valor:50,categoria:'Equipamento',estado:'Ativo'}]});
  await h.click('editar','b1');h.fill({bemNome:'Forno alterado'});h.app.bens[0].valor=75;await h.submit();
  assert.equal(h.stats.saves,0);assert.equal(h.app.bens[0].valor,75);assert.equal(h.nodes.bemNome.value,'Forno alterado');
});

test('repetir novo cadastro com falha não sobrescreve o mesmo ID alterado em outro aparelho',async()=>{
  let ok=false;const h=harness({save:async()=>({ok})});h.fill();await h.submit();
  h.app.bens.push({id:'bem_test1',nome:'Freezer revisado por outro funcionário',valor:2000,categoria:'Equipamento',estado:'Ativo',data:'2026-11-15'});
  const remoto=structuredClone(h.app.bens);ok=true;await h.submit();
  assert.equal(h.stats.saves,1);assert.deepEqual(h.app.bens,remoto);assert.equal(h.nodes.bemNome.value,'Freezer');
  assert(h.messages.some(x=>/outro aparelho/.test(x)));
});

test('repetir novo cadastro reconhece a própria tentativa confirmada remotamente sem duplicar',async()=>{
  let ok=false,tentativa,h;h=harness({save:async()=>{tentativa=structuredClone(h.app.bens[0]);return{ok}}});h.fill();await h.submit();
  assert.equal(h.app.bens.length,0);h.app.bens.push(structuredClone(tentativa));ok=true;await h.submit();
  assert.equal(h.stats.saves,2);assert.equal(h.app.bens.length,1);assert.equal(h.app.bens[0].id,'bem_test1');assert.equal(h.app.bens[0].valor,1000.50);
});

test('rascunho novo pode ser corrigido depois da falha quando o ID ainda não existe',async()=>{
  let ok=false;const h=harness({save:async()=>({ok})});h.fill();await h.submit();
  h.fill({bemNome:'Freezer corrigido',bemValor:'1.200,00'});ok=true;await h.submit();
  assert.equal(h.stats.saves,2);assert.equal(h.app.bens.length,1);assert.equal(h.app.bens[0].id,'bem_test1');assert.equal(h.app.bens[0].nome,'Freezer corrigido');assert.equal(h.app.bens[0].valor,1200);
});

test('erro ao redesenhar o DRE depois de salvar não desfaz um cadastro confirmado',async()=>{
  const h=harness({dreRender(){throw new Error('Falha visual de teste')}});h.fill();await h.submit();
  assert.equal(h.stats.saves,1);assert.equal(h.app.bens.length,1);assert.equal(h.app.bens[0].nome,'Freezer');assert.equal(h.nodes.bemNome.value,'');assert(h.messages.includes('Bem cadastrado'));assert(h.stats.warnings>0);
});

test('erro ao redesenhar o DRE depois de excluir não restaura uma exclusão confirmada',async()=>{
  const h=harness({bens:[{id:'b1',nome:'Forno',valor:50}],dreRender(){throw new Error('Falha visual de teste')}});await h.click('excluir','b1');
  assert.equal(h.stats.saves,1);assert.equal(h.app.bens.length,0);assert(h.messages.includes('Bem excluído'));assert(h.stats.warnings>0);
});

test('exclusão bloqueia clique repetido durante a confirmação no servidor',async()=>{
  let finish;const h=harness({bens:[{id:'b1',nome:'Forno',valor:50}],save:()=>new Promise(resolve=>{finish=resolve})});
  const first=h.click('excluir','b1');await h.click('excluir','b1');assert.equal(h.stats.saves,1);finish({ok:true});await first;assert.equal(h.app.bens.length,0);
});

test('DRE mostra aquisições separadas e preserva o lucro operacional',()=>{
  const start=html.indexOf('function renderDRE()');const end=html.indexOf("\ndocument.addEventListener('DOMContentLoaded'",start);
  assert(start>=0&&end>start,'real DRE function exists');
  const node={innerHTML:'',querySelectorAll(){return[]}};
  const deps={node,Patrimonio,PeriodosDRE:require('../dre-periods.js')};
  const run=new Function('deps',`
    var window={Patrimonio:deps.Patrimonio,perdas:[]},bensEmpresa=[{nome:'Forno',valor:50,data:'2026-11-10',estado:'Ativo'},{nome:'Geladeira antiga',valor:200,data:'2026-10-10',estado:'Baixado'}],dreFiltro='mes';
    var historico=[{total:105,subtotal:100,taxaEntrega:5,custoTotal:20,pago:true,pagamento:'pix',tipo:'retirada',data:'2026-11-15T12:00:00Z',itens:[{nome:'Produto',preco:100,qtd:1,custoUnit:20}]}];
    var despesas=[{categoria:'manutencao',descricao:'Conserto',valor:10,data:'2026-11-15'}],DESPESA_LABEL={manutencao:{txt:'Manutenção',e:'🔧'}},PAGAMENTO_LABEL={pix:{txt:'Pix',cls:'pix'}};
    function souGerente(){return true} function periodoDRE(){return{ini:new Date(2026,10,1),fim:new Date(2026,11,1),label:'Nov/2026'}}
    function popularMesesDRE(){} function dataRegistroDRE(v){return deps.PeriodosDRE.data(v)}
    function $(selector){return selector==='#dreConteudo'?deps.node:null}
    function moeda(v){return 'R$ '+Number(v).toFixed(2).replace('.',',')} function esc(v){return String(v)}
    function valorDevidoPedido(){return 0} function pagamentosDoPedido(p){return [['pix',p.total]]}
    function separarDespesasDRE(lista){return{comprasEstoque:[],despesasOperacionais:lista}} function totalizarDespesasOperacionais(lista){return lista.reduce((s,d)=>s+d.valor,0)} function totalizarAbastecimentosNoPeriodo(){return 0}
    function rotuloCategoriaFinanceira(){return 'Manutenção'} function formatarDetalhesFinanceirosDespesa(){return ''}
    ${html.slice(start,end)}
    renderDRE();
  `);
  run(deps);
  assert.match(node.innerHTML,/Investimentos em patrimônio no período<\/span><span[^>]*>R\$ 50,00/);
  assert.match(node.innerHTML,/LUCRO LÍQUIDO<\/b><\/span><span[^>]*>R\$ 70,00/);
  assert.match(node.innerHTML,/Despesas operacionais<\/span><span[^>]*>−R\$ 10,00/);
});
