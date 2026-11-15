const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');
const source = html.split(/\r?\n/).find(l=>l.startsWith('function renderTudo('));
function render(active) {
  const calls = {patrimonio:0,dre:0};
  const deps = {calls,active};
  new Function('deps',`
    var window={renderPatrimonio(){deps.calls.patrimonio++}};
    var document={getElementById(id){return id==='view-dre'?{classList:{contains(){return deps.active}}}:null}};
    function renderVendas(){} function renderCarrinho(){} function renderPedidos(){}
    function renderEstoque(){} function renderStats(){} function renderDRE(){deps.calls.dre++}
    ${source}
    renderTudo();
  `)(deps);
  return calls;
}
test('atualização conjunta redesenha patrimônio e o investimento do DRE que está aberto',()=>{
  assert.deepEqual(render(true),{patrimonio:1,dre:1});
});
test('atualização conjunta mantém o DRE inativo sem renderização desnecessária',()=>{
  assert.deepEqual(render(false),{patrimonio:1,dre:0});
});
