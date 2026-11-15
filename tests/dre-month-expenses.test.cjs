const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Patrimonio = require('../patrimonio.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
const filtroMarkup = html.slice(html.indexOf('id="dreFiltros"'), html.indexOf('<select id="selMesDre"'));

function trecho(inicio, fim) {
  const start = html.indexOf(inicio);
  const end = html.indexOf(fim, start);
  assert(start >= 0 && end > start, `o código real de ${inicio} existe`);
  return html.slice(start, end);
}

function funcao(nome) {
  return trecho(`function ${nome}(`, '\nfunction ');
}

class DataFixa extends Date {
  constructor(...args) {
    super(...(args.length ? args : [2026, 10, 15, 10, 30]));
  }
  static now() { return new Date(2026, 10, 15, 10, 30).getTime(); }
}

function no() {
  const classes = new Set();
  return {
    innerHTML: '', value: '', dataset: {}, events: {},
    classList: {
      contains: classe => classes.has(classe),
      remove: classe => classes.delete(classe),
      add: classe => classes.add(classe),
      toggle(classe, ativo) {
        if (ativo === undefined) ativo = !classes.has(classe);
        if (ativo) classes.add(classe); else classes.delete(classe);
        return ativo;
      },
    },
    addEventListener(evento, callback) { this.events[evento] = callback; },
    querySelectorAll() { return []; },
  };
}

function harness({filtro = 'mes', despesas = [], historico = [], perdas = [], bens = []} = {}) {
  const contextoPeriodos = {Date: DataFixa};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dre-periods.js'), 'utf8'), contextoPeriodos);
  const nodes = {dreConteudo: no(), dreFiltros: no(), selMesDre: no(), btnAddDespesa: no()};
  const aberturas = {despesas: [], compras: []};
  const botoes = Array.from(filtroMarkup.matchAll(/<button\b([^>]*)>/g), match => {
    const botao = no();
    botao.dataset.filtro = /data-filtro="([^"]+)"/.exec(match[1])[1];
    if (/class="[^"]*\bativo\b/.test(match[1])) botao.classList.add('ativo');
    return botao;
  });
  let opcoes = [], valorSelecionado = '', markupOpcoes = '';
  Object.defineProperties(nodes.selMesDre, {
    innerHTML: {
      get() { return markupOpcoes; },
      set(markup) {
        markupOpcoes = markup;
        opcoes = Array.from(markup.matchAll(/<option\b([^>]*)>/g), match => ({
          value: /value="([^"]*)"/.exec(match[1])[1],
          selected: /\bselected\b/.test(match[1]),
        }));
        valorSelecionado = (opcoes.find(opcao => opcao.selected) || opcoes[0] || {value: ''}).value;
      },
    },
    value: {
      get() { return valorSelecionado; },
      set(valor) { valorSelecionado = opcoes.some(opcao => opcao.value === valor) ? valor : ''; },
    },
    options: {get() { return opcoes; }},
  });
  const eventosDocumento = {};
  const document = {
    getElementById: id => nodes[id] || null,
    querySelectorAll: seletor => seletor === '#dreFiltros .dre-filtro' ? botoes : [],
    addEventListener(evento, callback) { eventosDocumento[evento] = callback; },
  };
  const deps = {nodes, document, botoes, aberturas, filtro, despesas: structuredClone(despesas), historico,
    perdas, bens, PeriodosDRE: contextoPeriodos.PeriodosDRE, Patrimonio, Date: DataFixa};
  assert(deps.PeriodosDRE, 'o módulo publica o mesmo global PeriodosDRE usado no navegador');
  const app = new Function('deps', `
    var Date=deps.Date,document=deps.document;
    var window={PeriodosDRE:deps.PeriodosDRE,Patrimonio:deps.Patrimonio,perdas:deps.perdas};
    var dreFiltro=deps.filtro,despesas=deps.despesas,historico=deps.historico,bensEmpresa=deps.bens;
    var ingredientes=[{id:'i1',nome:'Ingrediente com estoque',semEstoque:false}],paes=[],produtos=[];
    var DESPESA_LABEL={manutencao:{txt:'Manutenção',e:'🔧'},outro:{txt:'Outros',e:'💸'}},PAGAMENTO_LABEL={pix:{txt:'Pix'}};
    function souGerente(){return true}
    function $(seletor){return deps.nodes[seletor.slice(1)]||null}
    function $$(seletor){return document.querySelectorAll(seletor)}
    function moeda(valor){return 'R$ '+Number(valor).toFixed(2).replace('.',',')}
    function esc(valor){return String(valor||'')}
    function valorDevidoPedido(pedido){return pedido.pago?0:Number(pedido.total)||0}
    function pagamentosDoPedido(pedido){return pedido.pago?[['pix',Number(pedido.total)||0]]:[]}
    function abrirModalDespesaAvulsa(id){deps.aberturas.despesas.push(id)}
    function abrirModalDespesa(compra){deps.aberturas.compras.push(compra)}
    ${trecho('function periodoDRE(', '\nwindow.renderDespItens')}
    ${funcao('alvoEstoque')}
    ${funcao('normalizarCategoriaFinanceira')}
    ${funcao('rotuloCategoriaFinanceira')}
    ${trecho('function interpretarNumeroFinanceiroBR(', "\ndocument.addEventListener('DOMContentLoaded'")}
    ${trecho("$('#dreFiltros').addEventListener('click'", "\n$('#fabBackup').addEventListener")}
    return {
      render:renderDRE,
      popular:popularMesesDRE,
      get filtro(){return dreFiltro},
      get despesas(){return despesas},
    };
  `)(deps);
  return {
    app, nodes, botoes, aberturas,
    render() { app.render(); return nodes.dreConteudo.innerHTML; },
    selecionar(valor) {
      nodes.selMesDre.value = valor;
      eventosDocumento.change({target: {...nodes.selMesDre, id: 'selMesDre'}});
    },
    clicar(filtroBotao) {
      const botao = botoes.find(item => item.dataset.filtro === filtroBotao);
      assert(botao, `o filtro rápido ${filtroBotao} existe`);
      nodes.dreFiltros.events.click({target: {closest() { return botao; }}});
    },
  };
}

function despesa(id, data, valor, extra = {}) {
  return {id, data, valor, descricao: id, categoria: 'manutencao', categoriaNome: 'Manutenção',
    tipoRegistro: 'despesa', status: 'pago', ...extra};
}

test('DRE abre no mês atual com o botão mensal ativo e oferece o ano', () => {
  assert.match(html, /\blet\s+dreFiltro\s*=\s*['"]mes['"]/);
  const ativo = Array.from(filtroMarkup.matchAll(/<button\b([^>]*)>/g))
    .filter(match => /class="[^"]*\bativo\b/.test(match[1]));
  assert.equal(ativo.length, 1);
  assert.match(ativo[0][1], /data-filtro="mes"/);
  assert.match(filtroMarkup, /data-filtro="ano"/);
  assert.match(html, /<script\s+src="dre-periods\.js"/);
});

test('Nova despesa do DRE abre o formulário de despesa avulsa', () => {
  const h = harness();
  const output = h.render();
  assert.match(output, /id="btnAddDespesa"[^>]*>[^<]*Nova despesa/);
  assert.equal(typeof h.nodes.btnAddDespesa.events.click, 'function');
  h.nodes.btnAddDespesa.events.click();
  assert.deepEqual(h.aberturas.despesas, [null]);
  assert.deepEqual(h.aberturas.compras, [], 'a ação de despesa não abre Registrar Compra');
});

test('renderDRE soma despesas pagas, pendentes, zero e itemizadas no mês inteiro sem duplicar compras', () => {
  const despesas = [
    despesa('Paga no primeiro dia', '2026-11-01', 10),
    despesa('Pendente no último dia', '2026-11-30', 20, {status: 'pendente'}),
    despesa('Despesa sem valor', '2026-11-30', 0),
    despesa('Serviço itemizado', '2026-11-12', 15, {itens: [{nome: 'Serviço', qtd: 3, valor: 5, vinc: ''}]}),
    despesa('Registro ISO no último dia', '2026-11-30T12:30:00-03:00', 30),
    despesa('Despesa com vínculo antigo', '2026-11-05', 40, {itens: [{vinc: 'ing:i1', aplicado: {qtdEst: 2}}]}),
    despesa('Compra explícita', '2026-11-10', 70, {tipoRegistro: 'compra', itens: [{vinc: 'ing:i1'}]}),
    despesa('Compra legada', '2026-11-10', 80, {tipoRegistro: undefined, itens: [{aplicado: {qtdEst: 4}}]}),
    despesa('Despesa de outubro', '2026-10-31', 1000),
    despesa('Despesa de dezembro', '2026-12-01', 2000),
    despesa('Data civil inválida', '2026-11-31', 3000),
    despesa('Sem data', '', 4000),
  ];
  const h = harness({despesas, bens: [{nome: 'Forno', data: '2026-11-30', valor: 900}],
    perdas: [{data: '2026-11-30', valorTotal: 5}]});
  const output = h.render();
  for (const registro of despesas.slice(0, 6)) assert(output.includes(`<strong>${registro.descricao}</strong>`), registro.descricao);
  for (const registro of despesas.slice(6)) assert(!output.includes(`<strong>${registro.descricao}</strong>`), registro.descricao);
  assert.match(output, /TOTAL DE DESPESAS OPERACIONAIS<\/b><\/span><span[^>]*>−R\$ 115,00/);
  assert.match(output, /Despesas operacionais<\/span><span[^>]*>−R\$ 115,00/);
  assert.match(output, /Compras adicionadas ao estoque[^<]*<\/span><span[^>]*>R\$ 150,00/);
  assert.match(output, /LUCRO LÍQUIDO<\/b><\/span><span[^>]*>R\$ -120,00/);
  assert.match(output, /Investimentos em patrimônio no período<\/span><span[^>]*>R\$ 900,00/);
  assert.doesNotMatch(output, /Invalid Date/);
  assert.deepEqual(h.app.despesas, despesas, 'renderizar não altera os registros financeiros');
});

test('filtro anual real inclui janeiro e dezembro e exclui anos vizinhos', () => {
  const h = harness({despesas: [
    despesa('Início do ano', '2026-01-01', 10),
    despesa('Fim do ano', '2026-12-31', 20),
    despesa('Ano anterior', '2025-12-31', 100),
    despesa('Ano seguinte', '2027-01-01', 200),
  ]});
  h.clicar('ano');
  const output = h.nodes.dreConteudo.innerHTML;
  assert.equal(h.app.filtro, 'ano');
  assert.match(output, /<strong>Início do ano<\/strong>/);
  assert.match(output, /<strong>Fim do ano<\/strong>/);
  assert.doesNotMatch(output, /<strong>Ano anterior<\/strong>|<strong>Ano seguinte<\/strong>/);
  assert.match(output, /TOTAL DE DESPESAS OPERACIONAIS<\/b><\/span><span[^>]*>−R\$ 30,00/);
  assert.deepEqual(h.botoes.filter(botao => botao.classList.contains('ativo')).map(botao => botao.dataset.filtro), ['ano']);
});

test('seletor lista meses sem vendas e mantém o mês escolhido durante novos renders', () => {
  const h = harness({despesas: [despesa('Despesa antiga', '2024-03-31', 17), despesa('Despesa recente', '2025-10-01', 20)],
    perdas: [{data: '2022-06-01', valorTotal: 3}], bens: [{data: '2023-02-01', valor: 100}]});
  h.render();
  const valores = h.nodes.selMesDre.options.map(opcao => opcao.value);
  for (const mes of ['2026-11', '2025-10', '2024-03', '2023-02', '2022-06']) assert(valores.includes(`custom-${mes}`), mes);
  assert.deepEqual(valores.slice(1), [...valores.slice(1)].sort().reverse());
  assert.doesNotMatch(h.nodes.selMesDre.innerHTML, /NaN/);
  h.selecionar('custom-2024-03');
  assert.equal(h.app.filtro, 'custom-2024-03');
  assert.equal(h.nodes.selMesDre.value, 'custom-2024-03');
  assert.match(h.nodes.dreConteudo.innerHTML, /<strong>Despesa antiga<\/strong>/);
  assert.doesNotMatch(h.nodes.dreConteudo.innerHTML, /<strong>Despesa recente<\/strong>/);
  assert.equal(h.botoes.filter(botao => botao.classList.contains('ativo')).length, 0);
  h.app.despesas.splice(0, 1);
  h.render();
  assert.equal(h.app.filtro, 'custom-2024-03');
  assert.equal(h.nodes.selMesDre.value, 'custom-2024-03', 'o mês continua selecionado mesmo sem registros após excluir sua despesa');
  h.clicar('mes');
  assert.equal(h.app.filtro, 'mes');
  assert.equal(h.nodes.selMesDre.value, '');
  assert.deepEqual(h.botoes.filter(botao => botao.classList.contains('ativo')).map(botao => botao.dataset.filtro), ['mes']);
});
