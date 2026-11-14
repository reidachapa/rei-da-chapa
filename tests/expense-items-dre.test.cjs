const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');

function extrairFunction(nome, proximaAssinatura) {
  const start = html.indexOf(`function ${nome}(`);
  const end = html.indexOf(proximaAssinatura, start);
  assert(start >= 0 && end > start, `a função ${nome} existe`);
  return html.slice(start, end);
}

const totalizarItensSource = extrairFunction('calcularTotalItensDespesaAvulsa', '\nfunction separarDespesasDRE(');
const validarItensSource = extrairFunction('validarItensDespesaAvulsa', '\nfunction separarDespesasDRE(');
const separarDreSource = extrairFunction('separarDespesasDRE', '\nfunction totalizarDespesasOperacionais(');
const totalizarDreSource = extrairFunction('totalizarDespesasOperacionais', '\nfunction renderDRE(');
const itemComConteudoSource = extrairFunction('itemDespesaAvulsaTemConteudo', '\nfunction renderItensDespesaAvulsa(');
const interpretarNumeroSource = extrairFunction('interpretarNumeroFinanceiroBR', '\nfunction calcularTotalAbastecimento(');
const calcularAbastecimentoSource = extrairFunction('calcularTotalAbastecimento', '\nfunction calcularTotalDespesaAvulsa(');
const calcularTotalDespesaSource = extrairFunction('calcularTotalDespesaAvulsa', '\nfunction formatarDetalhesFinanceirosDespesa(');
const compraExcelSource = extrairFunction('despesaEhCompraExcel', '\nfunction excelPlanilhaCompleta(');

const calcularTotalItens = new Function(`${totalizarItensSource}; return calcularTotalItensDespesaAvulsa;`)();
const validarItens = new Function(`${validarItensSource}; return validarItensDespesaAvulsa;`)();
const separarDRE = new Function('alvoEstoque', `${separarDreSource}; return separarDespesasDRE;`)(() => null);
const totalizarDespesas = new Function(`${totalizarDreSource}; return totalizarDespesasOperacionais;`)();
const itemTemConteudo = new Function(`${itemComConteudoSource}; return itemDespesaAvulsaTemConteudo;`)();
const interpretarNumero = new Function(`${interpretarNumeroSource}; return interpretarNumeroFinanceiroBR;`)();
const calcularAbastecimento = new Function(`${interpretarNumeroSource}\n${calcularAbastecimentoSource}; return calcularTotalAbastecimento;`)();
const calcularTotalDespesa = new Function(`${interpretarNumeroSource}\n${calcularAbastecimentoSource}\n${totalizarItensSource}\n${itemComConteudoSource}\n${calcularTotalDespesaSource}; return calcularTotalDespesaAvulsa;`)();
const ehCompraExcel = new Function(`${compraExcelSource}; return despesaEhCompraExcel;`)();

assert.equal(
  calcularTotalItens([
    { qtd: 2, valor: 10.25 },
    { qtd: 0.5, valor: 8 },
  ]),
  24.5,
  'soma quantidade × valor unitário, incluindo quantidades fracionárias'
);
assert.equal(validarItens([{ nome: '', qtd: 1, valor: 0 }]), true, 'linha vazia pode ser removida ou ignorada');
assert.equal(validarItens([{ nome: 'Conta de luz', qtd: 1, valor: 0 }]), false, 'linha começada não é descartada ao salvar incompleta');

const despesaItemizada = {
  tipoRegistro: 'despesa',
  categoria: 'manutencao',
  valor: 24.5,
  itens: [
    { nome: 'Peças', qtd: 2, valor: 10.25, vinc: '' },
    { nome: 'Mão de obra', qtd: 0.5, valor: 8, vinc: '' },
  ],
};
const compraComEstoque = {
  valor: 50,
  itens: [{ nome: 'Refrigerante', qtd: 5, valor: 10, aplicado: { qtdEst: 5 } }],
};
const grupos = separarDRE([despesaItemizada, compraComEstoque]);
assert.deepEqual(grupos.despesasOperacionais, [despesaItemizada], 'despesa sem vínculo de estoque permanece operacional');
assert.deepEqual(grupos.comprasEstoque, [compraComEstoque], 'compra que movimenta estoque conserva sua classificação');
assert.equal(totalizarDespesas(grupos.despesasOperacionais), 24.5, 'o DRE soma o valor da despesa uma única vez');
assert.match(html.slice(html.indexOf("$('#dreConteudo').querySelectorAll('.desp-acoes button')"), html.indexOf('\n}', html.indexOf("$('#dreConteudo').querySelectorAll('.desp-acoes button')"))), /ehDespesaAvulsa\(d\)[\s\S]*abrirModalDespesaAvulsa\(d\.id\)/, 'editar despesa pela área do DRE abre o formulário de despesa');

assert.equal(ehCompraExcel({ tipoRegistro: 'despesa', itens: [{ nome: 'Material', qtd: 1, valor: 10 }] }), false, 'despesa itemizada vai para Gastos e não para Compras no Excel');
assert.equal(ehCompraExcel({ tipoRegistro: 'compra', itens: [{ nome: 'Refrigerante', qtd: 1, valor: 10 }] }), true, 'compra itemizada continua na aba Compras do Excel');
assert.match(html, /gastos\.filter\(despesaEhCompraExcel\)\.forEach\(function\(d\)/, 'a planilha Itens de compras ignora itens de despesas avulsas');

function salvarCom({ itens = [], valor = '0,00', existente = null } = {}) {
  const campos = {
    despAvulsaData: { value: '2026-11-13' },
    despAvulsaCategoria: { value: 'manutencao' },
    despAvulsaDescricao: { value: 'Conserto do freezer' },
    despAvulsaValor: { value: valor },
    despAvulsaStatus: { value: 'pago' },
    despAvulsaObs: { value: '' },
    modalDespesaAvulsa: { classList: { remove() {} } },
  };
  const despesas = existente ? [{ ...existente }] : [];
  let atualizacoesDre = 0;
  const run = new Function(
    'document', 'souGerente', 'lerMoeda', 'uid', 'despesas', 'salvar',
    'renderDespesasAvulsas', 'renderDRE', 'toast', 'despesaAvulsaEditandoId',
    'despesaAvulsaItensTemp', 'calcularTotalItensDespesaAvulsa', 'validarItensDespesaAvulsa', 'itemDespesaAvulsaTemConteudo',
    'calcularTotalAbastecimento', 'calcularTotalDespesaAvulsa', 'categoriaEhAbastecimento', 'categoriaLabelSelecionada', 'interpretarNumeroFinanceiroBR',
    extrairFunction('salvarDespesaAvulsa', '\nfunction renderDespesasAvulsas') + '\nreturn salvarDespesaAvulsa;'
  )(
    { getElementById(id) { return campos[id]; } },
    () => true,
    (v) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0,
    () => 'test-1',
    despesas,
    () => {},
    () => {},
    () => { atualizacoesDre += 1; },
    () => {},
    existente ? existente.id : null,
    itens,
    calcularTotalItens,
    validarItens,
    itemTemConteudo,
    calcularAbastecimento,
    calcularTotalDespesa,
    () => false,
    () => '',
    interpretarNumero
  );
  run({ preventDefault() {} });
  assert.equal(atualizacoesDre, despesas.length ? 1 : 0, 'o DRE só atualiza depois de salvar uma despesa');
  return despesas[0];
}

const salvaComItens = salvarCom({ itens: despesaItemizada.itens });
assert.equal(salvaComItens.valor, 24.5, 'salvar usa o total calculado das linhas');
assert.equal(salvaComItens.itens.length, 2, 'salvar mantém as linhas detalhadas');
assert.equal(salvaComItens.itens[0].vinc, '', 'linhas de despesa não recebem vínculo de estoque');
assert.equal(salvaComItens.itens[0].semEstoque, true, 'linhas de despesa ficam explicitamente sem movimento de estoque');
assert.equal(salvarCom({ itens: [{ nome: 'Conta sem valor', qtd: 1, valor: 0 }] }), undefined, 'salvar bloqueia linha incompleta em vez de descartá-la');

const legado = salvarCom({
  valor: '42,50',
  existente: { id: 'gasto-antigo', tipoRegistro: 'despesa', descricao: 'Conta antiga', valor: 42.5, itens: [] },
});
assert.equal(legado.valor, 42.5, 'editar despesa antiga sem itens preserva o valor manual');
assert.deepEqual(legado.itens, [], 'editar despesa antiga não inventa itens');

const modal = html.slice(html.indexOf('<div id="modalDespesaAvulsa"'), html.indexOf('<div id="modalPersonalizar"'));
assert.match(modal, /despAvulsaItensLista/, 'o formulário contém a lista de itens');
assert.match(modal, /btnAddItemDespesaAvulsa/, 'o formulário permite adicionar linhas');
assert.match(extrairFunction('renderDespesasAvulsas', '\ndocument.getElementById(\'btnNovaDespesaPagina\')'), /desp-itens-resumo/, 'o histórico mostra uma prévia dos itens');
assert.match(html.slice(html.indexOf('function renderDRE()'), html.indexOf('\nfunction', html.indexOf('function renderDRE()') + 1)), /separarDespesasDRE\(despFiltradas\)/, 'o DRE usa a regra testada de classificação');

console.log('Expense itemization and DRE scenarios passed.');
