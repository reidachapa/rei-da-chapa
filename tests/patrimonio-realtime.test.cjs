const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');
const start = html.indexOf('function renderTudo(');
const source = html.slice(start, html.indexOf("\n$('#busca')", start));
function render(activeView) {
  const calls = {patrimonio:0,dre:0,despesas:0};
  const deps = {calls,activeView};
  new Function('deps',`
    var window={renderPatrimonio(){deps.calls.patrimonio++}};
    var document={getElementById(id){return {classList:{contains(){return id===deps.activeView}}}}};
    function renderVendas(){} function renderCarrinho(){} function renderPedidos(){}
    function renderEstoque(){} function renderStats(){} function renderDRE(){deps.calls.dre++}
    function renderDespesasAvulsas(){deps.calls.despesas++}
    ${source}
    renderTudo();
  `)(deps);
  return calls;
}
test('atualização conjunta redesenha patrimônio e o investimento do DRE que está aberto',()=>{
  assert.deepEqual(render('view-dre'),{patrimonio:1,dre:1,despesas:0});
});
test('atualização conjunta mantém o DRE inativo sem renderização desnecessária',()=>{
  assert.deepEqual(render('view-vendas'),{patrimonio:1,dre:0,despesas:0});
});
test('atualização conjunta redesenha as despesas vinculadas de outros aparelhos',()=>{
  assert.deepEqual(render('view-despesas'),{patrimonio:1,dre:0,despesas:1});
});
