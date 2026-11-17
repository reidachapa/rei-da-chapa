const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
function source(name, next) {
  const start = html.indexOf('function ' + name + '(');
  const end = next ? html.indexOf('\nfunction ' + next + '(', start) : html.indexOf('\n}\n', start) + 2;
  assert(start >= 0 && end > start, 'função real disponível: ' + name);
  return html.slice(start, end);
}

function garantir(initial) {
  return new Function('initial', `
    var paes=initial;
    function salvar(){} function renderPaes(){} function popularSelectPaes(){} function renderVendas(){}
    ${source('garantirPaesMinimos', 'injetarBotaoNovoPao')}
    garantirPaesMinimos();return paes;
  `)(initial);
}

test('catálogo de pães vazio nasce com saldos zero', () => {
  const defaults = garantir([]);
  assert.deepEqual(defaults.map(p => [p.id, p.estoque]), [['brioche', 0], ['australia', 0]]);
  assert(defaults.every(p => p.nome && p.icone), 'os cadastros continuam disponíveis para compras e receitas');
});

test('reabrir pães preserva os cadastros existentes e não repõe estoque automaticamente', () => {
  const paes = [
    { id: 'brioche', nome: 'Pão Brioche', estoque: 41, custo: 1.5 },
    { id: 'australia', nome: 'Pão Austrália', estoque: 30, custo: 2 },
    { id: 'bonfa', nome: 'Pão Bonfa', estoque: 0, custo: 1 },
  ];
  const antes = structuredClone(paes);
  assert.equal(garantir(paes), paes);
  assert.equal(garantir(paes), paes);
  assert.deepEqual(paes, antes);
});

function abrirPao(id, catalogo) {
  const campos = Object.fromEntries(['paoTituloModal', 'paoNomeModal', 'paoEstoqueModal', 'paoMinModal', 'paoCustoModal', 'paoPrecoModal'].map(k => [k, { value: '', textContent: '', focus() {} }]));
  campos.modalPao = { dataset: {}, classList: { add() {} }, querySelectorAll() { return []; } };
  const abrir = new Function('document', 'souGerente', 'criarModalPao', 'toast', 'setTimeout', 'paes', `
    var paoEditandoId=null;${source('abrirModalPao', 'fecharModalPao')};return abrirModalPao;
  `)(
    { getElementById(key) { return campos[key]; } },
    () => true, () => {}, () => {}, () => {}, catalogo
  );
  abrir(id);
  return campos;
}

test('formulário de novo pão começa com zero e editar conserva o saldo registrado', () => {
  const novo = abrirPao(null, []);
  assert.equal(novo.paoEstoqueModal.value, '0');
  assert.equal(novo.paoPrecoModal.value, '', 'preço pode ficar em branco até haver compras de pão');
  const pao = { id: 'real', nome: 'Pão existente', estoque: 17, custo: 2, preco: 4.5 };
  const editado = abrirPao('real', [pao]);
  assert.equal(editado.paoEstoqueModal.value, 17);
  assert.equal(editado.paoPrecoModal.value, '4,50');
  assert.equal(pao.estoque, 17);
});

test('limpar dados não recria saldos artificiais de pão', () => {
  const start = html.indexOf("$('#btnLimparTudo').addEventListener('click'");
  const end = html.indexOf('\n', start);
  assert(start >= 0 && end > start);
  const action = html.slice(start, end);
  const executar = new Function('actionSource', `
    var callback,paes=[{id:'anterior',estoque:3}],produtos=[],carrinho={},pedidos=[],historico=[],clientes=[],bensEmpresa=[],categoriasBens=[],motoboys=[],proximoNumeroCliente=1,contadores={},ingredientes=[],despesas=[];
    var window={};function souGerente(){return true}function confirm(){return true}function aplicarMotivosPerda(){}function salvarPerdas(){}function salvar(){}function renderTudo(){}function renderClientes(){}function renderPaes(){}function renderIngredientes(){}function toast(){}function mesAtual(){return '2026-11'}
    function $(id){return id==='#btnLimparTudo'?{addEventListener(type,fn){callback=fn}}:{classList:{remove(){}}};}
    eval(actionSource);callback();return paes;
  `);
  assert.deepEqual(executar(action).map(p => [p.id, p.estoque]), [['brioche', 0], ['australia', 0]]);
});

function movimentos(catalogo) {
  return new Function('alvoEstoque', 'ehNotaCompraSalva',
    source('reverterCompraEstoque', 'vincularItemCompra') + '\n' + source('aplicarCompraEstoque') + '\nreturn {aplicarCompraEstoque,reverterCompraEstoque};'
  )(
    vinc => { const p = catalogo.find(x => vinc === 'pao:' + x.id); return p ? { tipo: 'pao', obj: p } : null; },
    n => !!(n && n.tipoRegistro !== 'despesa' && Array.isArray(n.itens) && n.itens.length)
  );
}

test('compra de pão soma a quantidade sem alterar outros pães ou os dados lançados', () => {
  const paes = [{ id: 'brioche', nome: 'Brioche', estoque: 0, custo: 0 }, { id: 'australia', nome: 'Austrália', estoque: 0, custo: 2 }];
  const linha = { nome: 'Nome histórico do pão', vinc: 'pao:brioche', qtd: 10, valor: 2, desconto: 0 };
  const antes = structuredClone(linha);
  movimentos(paes).aplicarCompraEstoque([linha]);
  assert.equal(paes[0].estoque, 10);
  assert.equal(paes[0].custo, 2);
  assert.equal(paes[1].estoque, 0);
  assert.equal(linha.aplicado.qtdEst, 10);
  const { aplicado, ...dadosLancados } = linha;
  assert.deepEqual(dadosLancados, antes);
});

test('editar a compra de dez para quinze não duplica saldo e excluir volta a zero sem apagar cadastros', () => {
  const paes = [{ id: 'brioche', nome: 'Brioche', estoque: 0, custo: 0 }];
  const fn = movimentos(paes);
  const primeira = { nome: 'Brioche', vinc: 'pao:brioche', qtd: 10, valor: 2, desconto: 0 };
  const nota = { id: 'nota-real', nf: '000.010', tipoRegistro: 'compra', fornecedor: 'Fornecedor original', itens: [primeira] };
  fn.aplicarCompraEstoque(nota.itens);
  const cabecalhoAntes = { id: nota.id, nf: nota.nf, fornecedor: nota.fornecedor };
  fn.reverterCompraEstoque(nota.itens, nota);
  const editada = { ...primeira, qtd: 15 };
  fn.aplicarCompraEstoque([editada]);
  assert.equal(paes[0].estoque, 15);
  fn.reverterCompraEstoque([editada], { ...nota, itens: [editada] });
  assert.equal(paes[0].estoque, 0);
  assert.deepEqual(paes.map(p => [p.id, p.nome]), [['brioche', 'Brioche']]);
  assert.deepEqual({ id: nota.id, nf: nota.nf, fornecedor: nota.fornecedor }, cabecalhoAntes);
  assert.equal(primeira.qtd, 10);
});
