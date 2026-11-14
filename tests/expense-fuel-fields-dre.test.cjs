const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');

function extrairFunction(nome, proximaAssinatura) {
  const start = html.indexOf(`function ${nome}(`);
  const end = html.indexOf(proximaAssinatura, start);
  assert(start >= 0 && end > start, `a função ${nome} existe`);
  return html.slice(start, end);
}

const interpretarSource = extrairFunction('interpretarNumeroFinanceiroBR', '\nfunction calcularTotalAbastecimento(');
const abastecimentoSource = extrairFunction('calcularTotalAbastecimento', '\nfunction calcularTotalDespesaAvulsa(');
const totalSource = extrairFunction('calcularTotalDespesaAvulsa', '\nfunction formatarDetalhesFinanceirosDespesa(');
const detalhesSource = extrairFunction('formatarDetalhesFinanceirosDespesa', '\nfunction calcularTotalItensDespesaAvulsa(');
const normalizarCategoriaSource = extrairFunction('normalizarCategoriaFinanceira', '\nfunction ordenarCategoriasFinanceiras(');
const categoriaAbastecimentoSource = extrairFunction('categoriaEhAbastecimento', '\nfunction calcularTotalItensDespesaAvulsa(');
const totalizarItensSource = extrairFunction('calcularTotalItensDespesaAvulsa', '\nfunction validarItensDespesaAvulsa(');
const validarItensSource = extrairFunction('validarItensDespesaAvulsa', '\nfunction separarDespesasDRE(');
const itemComConteudoSource = extrairFunction('itemDespesaAvulsaTemConteudo', '\nfunction renderItensDespesaAvulsa(');
const salvarSource = extrairFunction('salvarDespesaAvulsa', '\nfunction renderDespesasAvulsas(');
const totalizarDespesasSource = extrairFunction('totalizarDespesasOperacionais', '\nfunction renderDRE(');

const interpretar = new Function(`${interpretarSource}; return interpretarNumeroFinanceiroBR;`)();
const calcularAbastecimento = new Function(`${interpretarSource}\n${abastecimentoSource}; return calcularTotalAbastecimento;`)();
const calcularTotal = new Function(
  `${interpretarSource}\n${abastecimentoSource}\n${totalizarItensSource}\n${itemComConteudoSource}\n${totalSource}; return calcularTotalDespesaAvulsa;`
)();
const formatarDetalhes = new Function(
  'esc', 'moeda', `${interpretarSource}\n${detalhesSource}; return formatarDetalhesFinanceirosDespesa;`
)((value) => String(value), (value) => `R$ ${value.toFixed(2).replace('.', ',')}`);
const calcularItens = new Function(`${totalizarItensSource}; return calcularTotalItensDespesaAvulsa;`)();
const validarItens = new Function(`${validarItensSource}; return validarItensDespesaAvulsa;`)();
const itemTemConteudo = new Function(`${itemComConteudoSource}; return itemDespesaAvulsaTemConteudo;`)();
const ehCategoriaAbastecimento = new Function(`${normalizarCategoriaSource}\n${categoriaAbastecimentoSource}; return categoriaEhAbastecimento;`)();
const totalizarDespesas = new Function(`${totalizarDespesasSource}; return totalizarDespesasOperacionais;`)();

assert.equal(interpretar('2,475'), 2.475, 'lê litros com vírgula decimal');
assert.equal(interpretar('6.09'), 6.09, 'aceita ponto decimal digitado no celular');
assert.equal(calcularAbastecimento('2,475', '6,09'), 15.07, 'arredonda litros vezes preço por litro a centavos');
assert.equal(ehCategoriaAbastecimento('c_posto', '⛽ 14 - Abastecimento'), true, 'reconhece a categoria de abastecimento pelo rótulo financeiro');
assert.equal(ehCategoriaAbastecimento('luz', '💡 Luz'), false, 'não mostra campos de abastecimento em outras categorias');
assert.equal(calcularAbastecimento('', '6,09'), null, 'não calcula enquanto faltar litros');
assert.equal(calcularAbastecimento('2,475', ''), null, 'não calcula enquanto faltar preço por litro');
assert.equal(calcularTotal([{ nome: 'Luva', qtd: 1, valor: 10.1 }], '2,475', '6,09', ''), 25.17, 'soma combustível e itens uma vez cada');
assert.equal(calcularTotal([], '2,475', '6,09', ''), 15.07, 'usa o cálculo do abastecimento sem linhas de item');
assert.equal(calcularTotal([], '', '', ''), 0, 'aceita valor manual vazio como zero');
assert.equal(calcularTotal([], '', '', '0,00'), 0, 'aceita valor manual zero');

const combustivel = { nf: '000.123', abastecimento: { litros: 2.475, precoPorLitro: 6.09 } };
assert.match(formatarDetalhes(combustivel), /NF 000\.123/, 'mostra o número da nota');
assert.match(formatarDetalhes(combustivel), /2,475 L × R\$ 6,09\/L/, 'mostra litros e preço por litro');

function salvarCom({ categoria = 'c_posto', label = '⛽ Posto Avenida', nf = '000.123', litros = '2,475', preco = '6,09', valor = '' } = {}) {
  const fields = {
    despAvulsaData: { value: '2026-11-13' },
    despAvulsaCategoria: { value: categoria, options: [{ value: categoria, textContent: label }] },
    despAvulsaDescricao: { value: 'Posto Avenida' },
    despAvulsaNF: { value: nf },
    despAvulsaLitros: { value: litros },
    despAvulsaPrecoLitro: { value: preco },
    despAvulsaValor: { value: valor },
    despAvulsaStatus: { value: 'pago' },
    despAvulsaObs: { value: '' },
    modalDespesaAvulsa: { classList: { remove() {} } },
    despCategoria: { options: [{ value: categoria, textContent: label }] },
  };
  const expenses = [];
  const salvar = new Function(
    'document', 'souGerente', 'lerMoeda', 'uid', 'despesas', 'salvar', 'renderDespesasAvulsas',
    'renderDRE', 'toast', 'despesaAvulsaEditandoId', 'despesaAvulsaItensTemp',
    'calcularTotalItensDespesaAvulsa', 'validarItensDespesaAvulsa', 'itemDespesaAvulsaTemConteudo',
    'calcularTotalAbastecimento', 'calcularTotalDespesaAvulsa', 'categoriaEhAbastecimento',
    'categoriaLabelSelecionada', `${interpretarSource}\n${abastecimentoSource}\n${totalizarItensSource}\n${totalSource}\n${validarItensSource}\n${itemComConteudoSource}\n${salvarSource}; return salvarDespesaAvulsa;`
  )(
    { getElementById(id) { return fields[id] || null; } },
    () => true,
    (value) => Number(String(value || '').replace(/\./g, '').replace(',', '.')) || 0,
    () => 'test-fuel',
    expenses,
    () => ({ ok: true }),
    () => {},
    () => {},
    () => {},
    null,
    [],
    calcularItens,
    validarItens,
    itemTemConteudo,
    calcularAbastecimento,
    calcularTotal,
    (key, name) => /posto|abastec|combustivel/.test(`${key} ${name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()),
    (key) => fields.despAvulsaCategoria.options.find((option) => option.value === key).textContent
  );
  salvar({ preventDefault() {} });
  return expenses[0];
}

const salvaAbastecimento = salvarCom();
assert.equal(salvaAbastecimento.valor, 15.07, 'salvar usa o total calculado pela bomba');
assert.equal(salvaAbastecimento.nf, '000.123', 'salva o número da nota no registro');
assert.deepEqual(salvaAbastecimento.abastecimento, { litros: 2.475, precoPorLitro: 6.09 }, 'salva os dados do abastecimento');

const salvaZero = salvarCom({ categoria: 'outro', label: '🍴 Outro', nf: '', litros: '', preco: '', valor: '' });
assert.equal(salvaZero.valor, 0, 'permite salvar despesa sem valor informado');
assert.equal(salvaZero.abastecimento, null, 'não cria detalhe de abastecimento em outra categoria');

const salvaParcial = salvarCom({ nf: '', litros: '1,5', preco: '', valor: '0,00' });
assert.equal(salvaParcial.valor, 0, 'campos de bomba incompletos não impedem lançamento de valor zero');
assert.deepEqual(salvaParcial.abastecimento, { litros: 1.5, precoPorLitro: null }, 'preserva os dados parciais para completar depois');
assert.equal(totalizarDespesas([salvaZero]), 0, 'despesa de valor zero continua sendo um lançamento operacional do DRE');

const modal = html.slice(html.indexOf('<div id="modalDespesaAvulsa"'), html.indexOf('<div id="modalPersonalizar"'));
assert.match(modal, /despAvulsaNF/, 'o formulário contém o campo de nota fiscal');
assert.match(modal, /despAvulsaLitros/, 'o formulário contém litros');
assert.match(modal, /despAvulsaPrecoLitro/, 'o formulário contém preço por litro');
assert.doesNotMatch(modal.match(/id="despAvulsaValor"[^>]+/)[0], /required/, 'o valor total não é obrigatório');
const renderDreSource = extrairFunction('renderDRE', '\ndocument.addEventListener(\'DOMContentLoaded\'');
assert.match(renderDreSource, /despesasOperacionais\.forEach\(d\s*=>/, 'o DRE inclui despesas de valor zero no agrupamento por categoria');
assert.match(renderDreSource, /formatarDetalhesFinanceirosDespesa\(d\)/, 'o DRE mostra dados de abastecimento por lançamento');
assert.match(extrairFunction('renderDespesasAvulsas', '\ndocument.getElementById(\'btnNovaDespesaPagina\')'), /formatarDetalhesFinanceirosDespesa\(d\)/, 'o histórico de despesas mostra dados de abastecimento');

console.log('Expense fuel fields and DRE scenarios passed.');
