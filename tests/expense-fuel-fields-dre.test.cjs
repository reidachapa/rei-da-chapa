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
const formatarEditavelSource = extrairFunction('formatarNumeroFinanceiroEditavel', '\nfunction calcularTotalAbastecimento(');
const abastecimentoSource = extrairFunction('calcularTotalAbastecimento', '\nfunction calcularTotalDespesaAvulsa(');
const totalSource = extrairFunction('calcularTotalDespesaAvulsa', '\nfunction formatarDetalhesFinanceirosDespesa(');
const formatarPrecoLitroSource = extrairFunction('formatarPrecoLitroDetalhe', '\nfunction formatarDetalhesFinanceirosDespesa(');
const detalhesSource = extrairFunction('formatarDetalhesFinanceirosDespesa', '\nfunction calcularTotalItensDespesaAvulsa(');
const normalizarCategoriaSource = extrairFunction('normalizarCategoriaFinanceira', '\nfunction ordenarCategoriasFinanceiras(');
const categoriaAbastecimentoSource = extrairFunction('categoriaEhAbastecimento', '\nfunction calcularTotalItensDespesaAvulsa(');
const categoriaAbastecimentoDespesaSource = extrairFunction('categoriaEhAbastecimentoDespesa', '\nfunction calcularTotalItensDespesaAvulsa(');
const totalizarItensSource = extrairFunction('calcularTotalItensDespesaAvulsa', '\nfunction validarItensDespesaAvulsa(');
const validarItensSource = extrairFunction('validarItensDespesaAvulsa', '\nfunction separarDespesasDRE(');
const itemComConteudoSource = extrairFunction('itemDespesaAvulsaTemConteudo', '\nfunction renderItensDespesaAvulsa(');
const salvarSource = extrairFunction('salvarDespesaAvulsa', '\nfunction renderDespesasAvulsas(');
const atualizarCamposAbastecimentoSource = extrairFunction('atualizarCamposAbastecimento', '\nfunction abrirModalDespesaAvulsa(');
const totalizarDespesasSource = extrairFunction('totalizarDespesasOperacionais', '\nfunction renderDRE(');
const totalizarAbastecimentosSource = extrairFunction('totalizarAbastecimentosNoPeriodo', '\nfunction renderDRE(');

const interpretar = new Function(`${interpretarSource}; return interpretarNumeroFinanceiroBR;`)();
const formatarEditavel = new Function(`${formatarEditavelSource}; return formatarNumeroFinanceiroEditavel;`)();
const calcularAbastecimento = new Function(`${interpretarSource}\n${abastecimentoSource}; return calcularTotalAbastecimento;`)();
const calcularTotal = new Function(
  `${interpretarSource}\n${abastecimentoSource}\n${totalizarItensSource}\n${itemComConteudoSource}\n${totalSource}; return calcularTotalDespesaAvulsa;`
)();
const formatarDetalhes = new Function(
  'esc', 'moeda', `${interpretarSource}\n${formatarPrecoLitroSource}\n${detalhesSource}; return formatarDetalhesFinanceirosDespesa;`
)((value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]), (value) => `R$ ${value.toFixed(2).replace('.', ',')}`);
const calcularItens = new Function(`${totalizarItensSource}; return calcularTotalItensDespesaAvulsa;`)();
const validarItens = new Function(`${validarItensSource}; return validarItensDespesaAvulsa;`)();
const itemTemConteudo = new Function(`${itemComConteudoSource}; return itemDespesaAvulsaTemConteudo;`)();
const ehCategoriaAbastecimento = new Function(`${normalizarCategoriaSource}\n${categoriaAbastecimentoSource}; return categoriaEhAbastecimento;`)();
const ehCategoriaAbastecimentoDespesa = new Function(`${normalizarCategoriaSource}\n${categoriaAbastecimentoSource}\n${categoriaAbastecimentoDespesaSource}; return categoriaEhAbastecimentoDespesa;`)();
const atualizarCamposAbastecimento = new Function(
  'document', 'categoriaEhAbastecimentoDespesa', 'despesaAvulsaEditandoId', 'despesas',
  `${atualizarCamposAbastecimentoSource}; return atualizarCamposAbastecimento;`
);
const totalizarDespesas = new Function(`${totalizarDespesasSource}; return totalizarDespesasOperacionais;`)();
const totalizarAbastecimentos = new Function(
  'categoriaEhAbastecimentoDespesa', 'DESPESA_LABEL',
  `${normalizarCategoriaSource}\n${categoriaAbastecimentoSource}\n${categoriaAbastecimentoDespesaSource}\n${totalizarAbastecimentosSource}; return totalizarAbastecimentosNoPeriodo;`
)(ehCategoriaAbastecimentoDespesa, { c_posto: { txt: '14 - Abastecimento' }, luz: { txt: 'Luz' } });

assert.equal(interpretar('2,475'), 2.475, 'lê litros com vírgula decimal');
assert.equal(interpretar('6.09'), 6.09, 'aceita ponto decimal digitado no celular');
assert.equal(formatarEditavel(1000), '1000', 'não adiciona separador de milhar que altere litros ao editar');
assert.equal(interpretar(formatarEditavel(1000)), 1000, 'litros grandes continuam iguais após formatação de edição');
assert.equal(formatarEditavel(2.475), '2,475', 'preserva três casas decimais dos litros');
assert.equal(formatarEditavel(6.099), '6,099', 'preserva a precisão original do preço por litro');
assert.equal(interpretar(formatarEditavel(6.099)), 6.099, 'o preço formatado continua sendo lido sem arredondamento');
assert.equal(calcularAbastecimento('2,475', '6,09'), 15.07, 'arredonda litros vezes preço por litro a centavos');
assert.equal(ehCategoriaAbastecimento('c_posto', '⛽ 14 - Abastecimento'), true, 'reconhece a categoria de abastecimento pelo rótulo financeiro');
assert.equal(ehCategoriaAbastecimento('luz', '💡 Luz'), false, 'não mostra campos de abastecimento em outras categorias');
const abastecimentoRenomeado = { categoria: 'outro', categoriaNome: '⛽ Posto Avenida', abastecimento: { litros: 50, precoPorLitro: 6.099 } };
assert.equal(ehCategoriaAbastecimentoDespesa('outro', '🚗 Transporte', abastecimentoRenomeado), true, 'usa o rótulo histórico para preservar abastecimento após renomear a categoria');
assert.equal(ehCategoriaAbastecimentoDespesa('manutencao', '🔧 Manutenção', abastecimentoRenomeado), false, 'não carrega dados de abastecimento quando a categoria do registro foi alterada');
const camposAbastecimento = { hidden: true };
const seletorCategoriaRenomeada = { value: 'outro', selectedIndex: 0, options: [{ textContent: '🚗 Transporte' }] };
const atualizarCamposRenomeados = atualizarCamposAbastecimento(
  { getElementById(id) { return id === 'despAvulsaCategoria' ? seletorCategoriaRenomeada : camposAbastecimento; } },
  ehCategoriaAbastecimentoDespesa,
  'despesa-posto',
  [{ ...abastecimentoRenomeado, id: 'despesa-posto' }]
 )();
assert.equal(atualizarCamposRenomeados, true, 'mostra litros e preço/L ao editar uma categoria renomeada com abastecimento histórico');
assert.equal(camposAbastecimento.hidden, false, 'o formulário mantém visíveis os detalhes do abastecimento antigo');
assert.equal(calcularAbastecimento('', '6,09'), null, 'não calcula enquanto faltar litros');
assert.equal(calcularAbastecimento('2,475', ''), null, 'não calcula enquanto faltar preço por litro');
assert.equal(calcularTotal([{ nome: 'Luva', qtd: 1, valor: 10.1 }], '2,475', '6,09', ''), 25.17, 'soma combustível e itens uma vez cada');
assert.equal(calcularTotal([], '2,475', '6,09', ''), 15.07, 'usa o cálculo do abastecimento sem linhas de item');
assert.equal(calcularTotal([], '', '', ''), 0, 'aceita valor manual vazio como zero');
assert.equal(calcularTotal([], '', '', '0,00'), 0, 'aceita valor manual zero');

const combustivel = { nf: '000.123', abastecimento: { litros: 2.475, precoPorLitro: 6.09 } };
assert.match(formatarDetalhes(combustivel), /NF 000\.123/, 'mostra o número da nota');
assert.match(formatarDetalhes(combustivel), /2,475 L × R\$ 6,09\/L/, 'mostra litros e preço por litro');
assert.match(formatarDetalhes({ abastecimento: { litros: 50, precoPorLitro: 6.099 } }), /50 L × R\$ 6,099\/L/, 'mostra a precisão original do preço por litro na conferência');
assert.match(formatarDetalhes({ abastecimento: { placa: 'abc1d23' } }), /Placa ABC1D23/, 'mostra a placa formatada em maiúsculas');
assert.match(formatarDetalhes({ abastecimento: { placa: '<img src=x onerror=alert(1)>' } }), /Placa &lt;img/i, 'escapa a placa antes de exibi-la no histórico e no DRE');

function salvarCom({ categoria = 'c_posto', label = '⛽ Posto Avenida', nf = '000.123', placa = 'abc1d23', litros = '2,475', preco = '6,09', valor = '', existente = null, itens = [] } = {}) {
  const fields = {
    despAvulsaData: { value: '2026-11-13' },
    despAvulsaCategoria: { value: categoria, options: [{ value: categoria, textContent: label }] },
    despAvulsaDescricao: { value: 'Posto Avenida' },
    despAvulsaNF: { value: nf },
    despAvulsaPlaca: { value: placa },
    despAvulsaLitros: { value: litros },
    despAvulsaPrecoLitro: { value: preco },
    despAvulsaValor: { value: valor },
    despAvulsaStatus: { value: 'pago' },
    despAvulsaObs: { value: '' },
    modalDespesaAvulsa: { classList: { remove() {} } },
    despCategoria: { options: [{ value: categoria, textContent: label }] },
  };
  const expenses = existente ? [{ ...existente }] : [];
  const salvar = new Function(
    'document', 'souGerente', 'lerMoeda', 'uid', 'despesas', 'salvar', 'renderDespesasAvulsas',
    'renderDRE', 'toast', 'despesaAvulsaEditandoId', 'despesaAvulsaItensTemp',
    'calcularTotalItensDespesaAvulsa', 'validarItensDespesaAvulsa', 'itemDespesaAvulsaTemConteudo',
    'calcularTotalAbastecimento', 'calcularTotalDespesaAvulsa', 'categoriaEhAbastecimento', 'categoriaEhAbastecimentoDespesa',
    'categoriaLabelSelecionada', `${interpretarSource}\n${normalizarCategoriaSource}\n${categoriaAbastecimentoSource}\n${categoriaAbastecimentoDespesaSource}\n${abastecimentoSource}\n${totalizarItensSource}\n${totalSource}\n${validarItensSource}\n${itemComConteudoSource}\n${salvarSource}; return salvarDespesaAvulsa;`
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
    existente ? existente.id : null,
    itens,
    calcularItens,
    validarItens,
    itemTemConteudo,
    calcularAbastecimento,
    calcularTotal,
    ehCategoriaAbastecimento,
    ehCategoriaAbastecimentoDespesa,
    (key, name) => fields.despAvulsaCategoria.options.find((option) => option.value === key).textContent,
  );
  salvar({ preventDefault() {} });
  return expenses[0];
}

const salvaAbastecimento = salvarCom();
assert.equal(salvaAbastecimento.valor, 15.07, 'salvar usa o total calculado pela bomba');
assert.equal(salvaAbastecimento.nf, '000.123', 'salva o número da nota no registro');
assert.deepEqual(salvaAbastecimento.abastecimento, { litros: 2.475, precoPorLitro: 6.09, placa: 'ABC1D23' }, 'salva os dados do abastecimento e a placa normalizada');

const salvaZero = salvarCom({ categoria: 'outro', label: '🍴 Outro', nf: '', placa: 'ABC1D23', litros: '', preco: '', valor: '' });
assert.equal(salvaZero.valor, 0, 'permite salvar despesa sem valor informado');
assert.equal(salvaZero.abastecimento, null, 'não cria detalhe de abastecimento em outra categoria');
const salvaSomentePlaca = salvarCom({ nf: '', placa: 'abc1d23', litros: '', preco: '', valor: '0,00' });
assert.deepEqual(salvaSomentePlaca.abastecimento, { litros: null, precoPorLitro: null, placa: 'ABC1D23' }, 'preserva a placa mesmo antes de informar litros e preço');

const salvaParcial = salvarCom({ nf: '', litros: '1,5', preco: '', valor: '0,00' });
assert.equal(salvaParcial.valor, 0, 'campos de bomba incompletos não impedem lançamento de valor zero');
assert.deepEqual(salvaParcial.abastecimento, { litros: 1.5, precoPorLitro: null, placa: 'ABC1D23' }, 'preserva os dados parciais para completar depois');
assert.equal(totalizarDespesas([salvaZero]), 0, 'despesa de valor zero continua sendo um lançamento operacional do DRE');
assert.equal(totalizarAbastecimentos([
  { categoria: 'c_posto', valor: 304.95 },
  { categoria: 'luz', valor: 90 },
  { categoria: 'outro', categoriaNome: '⛽ Posto Avenida', abastecimento: { litros: 50, precoPorLitro: 6.099 }, valor: 314.95 },
]), 619.9, 'identifica o total de abastecimento pelas categorias e pelos rótulos históricos sem somar outras despesas');

const renomeadoSalvo = salvarCom({
  categoria: 'outro',
  label: '🚗 Transporte',
  nf: '',
  litros: '50',
  preco: '6,099',
  valor: '',
  existente: { id: 'gasto-posto', tipoRegistro: 'despesa', categoria: 'outro', categoriaNome: '⛽ Posto Avenida', descricao: 'Posto Avenida', valor: 304.95, nf: '', abastecimento: { litros: 50, precoPorLitro: 6.099 }, itens: [], criadoEm: '2026-11-01T10:00:00.000Z' },
  itens: [{ nome: 'Aditivo', qtd: 1, valor: 10 }],
});
assert.equal(renomeadoSalvo.abastecimento.litros, 50, 'editar uma despesa com categoria renomeada mantém os litros');
assert.equal(renomeadoSalvo.abastecimento.precoPorLitro, 6.099, 'editar uma despesa com categoria renomeada mantém a precisão do preço/L');
assert.equal(renomeadoSalvo.valor, 314.95, 'recalcula sem perder o abastecimento histórico nem os itens');
assert.equal(totalizarDespesas([renomeadoSalvo]), 314.95, 'o DRE conta o abastecimento preservado uma única vez');

const modal = html.slice(html.indexOf('<div id="modalDespesaAvulsa"'), html.indexOf('<div id="modalPersonalizar"'));
assert.match(modal, /despAvulsaNF/, 'o formulário contém o campo de nota fiscal');
assert.match(modal, /despAvulsaPlaca/, 'o formulário contém o campo opcional da placa');
assert.match(modal, /despAvulsaLitros/, 'o formulário contém litros');
assert.match(modal, /despAvulsaPrecoLitro/, 'o formulário contém preço por litro');
assert.doesNotMatch(modal.match(/id="despAvulsaValor"[^>]+/)[0], /required/, 'o valor total não é obrigatório');
const renderDreSource = extrairFunction('renderDRE', '\ndocument.addEventListener(\'DOMContentLoaded\'');
assert.match(renderDreSource, /despesasOperacionais\.forEach\(d\s*=>/, 'o DRE inclui despesas de valor zero no agrupamento por categoria');
assert.match(renderDreSource, /formatarDetalhesFinanceirosDespesa\(d\)/, 'o DRE mostra dados de abastecimento por lançamento');
assert.match(renderDreSource, /totalizarAbastecimentosNoPeriodo\(despesasOperacionais\)/, 'o DRE calcula o gasto em abastecimento dentro do período filtrado');
assert.match(renderDreSource, /Abastecimento[\s\S]*já incluído em despesas operacionais/i, 'o DRE mostra um resumo próprio de combustível sem duplicá-lo nos totais');
assert.match(renderDreSource, /rotuloCategoriaFinanceira\(d\)/, 'o detalhe do DRE mantém o rótulo histórico da categoria');
assert.match(extrairFunction('renderDespesasAvulsas', '\ndocument.getElementById(\'btnNovaDespesaPagina\')'), /formatarDetalhesFinanceirosDespesa\(d\)/, 'o histórico de despesas mostra dados de abastecimento');
assert.match(extrairFunction('renderDespesasAvulsas', '\ndocument.getElementById(\'btnNovaDespesaPagina\')'), /rotuloCategoriaFinanceira\(d\)/, 'o histórico de despesas mantém o rótulo histórico da categoria');
const abrirDespesaSource = extrairFunction('abrirModalDespesaAvulsa', '\nfunction itemDespesaAvulsaTemConteudo(');
assert.match(abrirDespesaSource, /formatarNumeroFinanceiroEditavel\(d\.abastecimento\.litros\)/, 'a edição reabre litros sem separador de milhar');
assert.match(abrirDespesaSource, /formatarNumeroFinanceiroEditavel\(d\.abastecimento\.precoPorLitro\)/, 'a edição reabre o preço sem arredondamento');
assert.match(abrirDespesaSource, /despAvulsaPlaca[^\n]*d\.abastecimento\.placa/, 'a edição reabre a placa salva');

console.log('Expense fuel fields and DRE scenarios passed.');
