const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const PrecosCompra = require('../purchase-pricing.js');
const EstoqueIngredientes = require('../ingredient-stock.js');
const VencimentosCompras = require('../purchase-payables.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
function source(name, next) {
  const start = html.indexOf('function ' + name + '(');
  const end = next ? html.indexOf('\nfunction ' + next + '(', start) : html.indexOf('\n}\n', start) + 2;
  assert(start >= 0 && end > start, 'função real disponível: ' + name);
  return html.slice(start, end);
}
const lookupSource = source('buscarIngredienteCompra', 'sincronizarIngredienteCompraPorNome');
function buscar(item, ingredientes) {
  return new Function('ingredientes', 'it', source('normalizarNomeCadastro', 'unidadeCanonicaMedida') + '\n' + source('alvoEstoque', 'refrescarEstoqueUI') + '\n' + lookupSource + '\nreturn buscarIngredienteCompra(it);')(ingredientes, item);
}

test('vínculo de ingrediente prevalece sobre nome histórico que hoje pertence a outro cadastro', () => {
  const ingredientes = [
    { id: 'outro', nome: 'Milho', nomeBase: 'Milho' },
    { id: 'original', nome: 'Milho doce', nomeBase: 'Milho doce' },
  ];
  assert.equal(buscar({ vinc: 'ing:original', nome: 'Milho Quero', nomeBase: 'Milho', marca: 'Quero' }, ingredientes), ingredientes[1]);
});

test('nome base normalizado encontra o mesmo ingrediente com outra marca', () => {
  const ingredientes = [{ id: 'molho', nome: 'Maionese', nomeBase: 'Maionése', marca: 'Quero' }];
  assert.equal(buscar({ nome: '  maionese Hellmann’s ', nomeBase: ' MAIONESE ', marca: 'Hellmann’s' }, ingredientes), ingredientes[0]);
});

function memoria({ ingredientes = [], produtos = [], paes = [], notas = [], itens, editId = null, camposNota = {}, itensAoAbrir = null, tipoDesconto = 'valor', descontoExato }) {
  const campos = Object.fromEntries(Object.entries({ despData: '2026-11-14', despCategoria: 'outro', despSubcategoria: '', despFornecedor: 'Fornecedor teste', despNF: '000.123', despStatus: 'pago', despObs: '', despDesconto: '', ...camposNota }).map(([id, value]) => [id, { value }]));
  if (descontoExato !== undefined) campos.despDesconto.dataset = { descontoExato };
  campos.btnSalvarDespesa = { disabled: false, textContent: editId ? 'Atualizar nota' : 'Salvar compra' };
  campos.modalDespesa = { classList: { remove() {} } };
  const document = { getElementById(id) { return campos[id] || null; }, querySelector() { return null; } };
  const window = { despItensTemp: structuredClone(itens), editandoDespesaId: editId, __prepararRevisaoRascunhoCompra: async ({ idOriginal }) => ({ ok: true, nova: false, editId: idOriginal }), PrecosCompra, EstoqueIngredientes, VencimentosCompras, ComprasDuplicadas: require('../purchase-duplicates.js'), _descontoNotaTipo: tipoDesconto, BackupSys: { async salvar() { return true; } } };
  if (itensAoAbrir) {
    const snapshot = structuredClone(itensAoAbrir);
    window.__itensDaCompraSemEdicao = itensAtuais => isDeepStrictEqual(itensAtuais, snapshot);
  }
  const messages = [];
  const deps = { ingredientes, produtos, paes, notas, window, document, toast: msg => messages.push(msg), PrecosCompra };
  const saveStart = html.indexOf('async function salvarCompraDaNota(');
  const saveEnd = html.indexOf('// Um único ponto de gravação', saveStart);
  const code = `
    var ingredientes=deps.ingredientes,produtos=deps.produtos,paes=deps.paes,despesas=deps.notas,despItensTemp=deps.window.despItensTemp,editandoDespesaId=deps.window.editandoDespesaId;
    var window=deps.window,document=deps.document,toast=deps.toast,compraNotaEmAndamento=false,notaCompraEmSincronizacaoId=null,revisaoLocal=0,sequencia=0;
    function uid(){return 'teste_'+(++sequencia)} function souGerente(){return true}
    function salvar(){return Promise.resolve({ok:true,persisted:true})}
    function quantidadeEstoqueProjetada(it){return Number(it&&it.qtd)||0}
    function categoriaLabelSelecionada(){return 'Outro'} function addSugestao(){} function popularTodasSugestoes(){}
    function ehNotaCompraSalva(n){return !!(n&&Array.isArray(n.itens)&&n.tipoRegistro!=='despesa')}
    function alert(msg){throw new Error(msg)}
    ${source('normalizarNomeCadastro', 'formatarQtdMedida')}
    ${html.split('\n').find(line => line.startsWith('function usaMediaPorContagemIngrediente('))}
    ${source('lerMoeda', 'lerQuantidade')}
    ${source('alvoEstoque', 'refrescarEstoqueUI')}
    ${lookupSource}
    ${source('reverterCompraEstoque', 'vincularItemCompra')}
    ${source('aplicarCompraEstoque')}
    ${source('paesPadrao', 'limparEstoqueDaDespesaDaCompra')}
    ${html.slice(saveStart, saveEnd)}
    return {salvarCompraDaNota,get ingredientes(){return ingredientes},get produtos(){return produtos},get paes(){return paes},get notas(){return despesas}};
  `;
  return { app: new Function('deps', code)(deps), messages };
}

const ingrediente = () => ({ id: 'milho', nome: 'Milho', nomeBase: 'Milho', marca: 'Quero', estoque: 3, custo: 2, modoCompra: 'pacote', unidade: 'un', semEstoque: false });
const item = (extra = {}) => ({ nome: 'Milho Bonduelle', nomeBase: 'Milho', marca: 'Bonduelle', tipoItem: 'ing', qtd: 2, valor: 3, unid: 'un', controlaEstoque: true, ...extra });
const configuracaoAntigaDeLotes = () => ({ quantidadeInicial: 10, custoInicial: 4, percentual: 90, comprasIniciais: {} });

test('compra da Coca-Cola vinculada soma no estoque e preserva o preço de venda do cadastro', async () => {
  const coca = {
    id: 'coca-600', nome: '0600ml Coca-Cola', estoque: 10, custo: 4, preco: 10.78,
    categoria: 'Refrigerante', precoProtegido: configuracaoAntigaDeLotes(),
  };
  const fixture = memoria({ produtos: [coca], itens: [{
    nome: '0600ml Coca-Cola', tipoItem: 'prod', vinc: 'prod:coca-600',
    qtd: 2, valor: 6, pv: null, lucroPct: null, modoPreco: null,
  }] });

  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.produtos.length, 1);
  assert.equal(coca.estoque, 12);
  assert.equal(coca.custo, 52 / 12);
  assert.equal(coca.preco, 10.78);
  assert.equal(fixture.app.notas[0].valor, 12);
  assert.equal(fixture.app.notas[0].itens[0].pv, null);
});

test('compra com margem explícita calcula o preço sobre o custo médio mesmo com configuração antiga de lotes', async () => {
  const coca = {
    id: 'coca-600', nome: 'Coca-Cola', estoque: 10, custo: 4, preco: 10.78,
    precoProtegido: configuracaoAntigaDeLotes(),
  };
  const { app } = memoria({ produtos: [coca], itens: [{
    nome: coca.nome, tipoItem: 'prod', vinc: 'prod:coca-600',
    qtd: 2, valor: 6, pv: null, lucroPct: 25, modoPreco: 'percentual',
  }] });

  await app.salvarCompraDaNota();

  assert.equal(coca.estoque, 12);
  assert.equal(coca.custo, 52 / 12);
  assert.equal(coca.preco, 5.42);
  assert.equal(app.notas[0].itens[0].pv, 5.42);
});

test('salvar nota usa o desconto e o custo unitário exatos com o campo visual em duas casas', async () => {
  const produto = { id: 'coca-600', nome: 'Coca-Cola', estoque: 0, custo: 0, preco: 15 };
  const fixture = memoria({
    produtos: [produto],
    itens: [{ nome: produto.nome, tipoItem: 'prod', qtd: 12, valor: 88 / 12, totalCusto: 88, vinc: 'prod:coca-600' }],
    tipoDesconto: 'percent', descontoExato: '10,5051', camposNota: { despDesconto: '10,51' },
  });
  await fixture.app.salvarCompraDaNota();
  const nota = fixture.app.notas[0];
  assert.equal(nota.descontoOriginal, 10.5051);
  assert.equal(nota.itens[0].valor, 88 / 12);
  assert.ok(Math.abs(nota.valor - 88 * (1 - 10.5051 / 100)) < 1e-12);
});

function compraEmEdicao({ vencimento, novoCusto = 6, camposNota = {} }) {
  const coca = {
    id: 'coca-600', nome: '0600ml Coca-Cola', unidade: 'un', categoria: 'Refrigerante',
    estoque: 12, custo: 52 / 12, preco: 10.78,
  };
  const vinc = 'prod:' + coca.id;
  const linha = {
    nome: coca.nome, tipoItem: 'prod', vinc, qtd: 2, valor: 6, unid: 'un',
    categoria: coca.categoria, desconto: 0, descontoOriginal: 0, descontoTipo: 'valor',
    aplicado: { vinc, qtdEst: 2, custoAntes: 4, custoUnitario: 6 },
  };
  const nota = {
    id: 'nota-coca', tipoRegistro: 'compra', descricao: 'Compra', categoria: 'outro', categoriaNome: 'Outro',
    subcategoria: '', fornecedor: 'Fornecedor teste', nf: '000.123', obs: '',
    data: '2026-11-14', criadoEm: '2026-11-14T12:00:00Z',
    status: 'pendente', vencimento: '2026-12-14', desconto: 0, descontoOriginal: 0, descontoTipo: 'valor',
    valor: 12, itens: [linha],
  };
  const itensAoAbrir = [{ ...linha, _indiceOriginalNota: 0 }];
  const fixture = memoria({
    produtos: [coca], notas: [nota], editId: nota.id,
    itens: [{ ...itensAoAbrir[0], valor: novoCusto }],
    itensAoAbrir,
    camposNota: { despStatus: nota.status, despVencimento: vencimento, ...camposNota },
  });
  return { ...fixture, coca, nota };
}

test('editar apenas o vencimento mantém o movimento de estoque, custo médio e preço do cadastro', async () => {
  const { app, coca, nota } = compraEmEdicao({ vencimento: '2026-12-15' });
  coca.estoque = 1;
  const produtoAntes = structuredClone(coca);
  const movimentoAntes = structuredClone(nota.itens[0].aplicado);

  await app.salvarCompraDaNota();

  assert.equal(app.notas.length, 1);
  assert.equal(app.notas[0].vencimento, '2026-12-15');
  assert.equal(app.notas[0].valor, 12);
  assert.equal(app.notas[0].itens[0].qtd, 2);
  assert.deepEqual(app.notas[0].itens[0].aplicado, movimentoAntes);
  assert.deepEqual(app.produtos[0], produtoAntes);
});

test('editar o custo da compra recalcula a média e preserva o preço quando não há margem informada', async () => {
  const { app } = compraEmEdicao({ vencimento: '2026-12-14', novoCusto: 7 });

  await app.salvarCompraDaNota();

  assert.equal(app.notas[0].vencimento, '2026-12-14');
  assert.equal(app.notas[0].valor, 14);
  assert.equal(app.notas[0].itens[0].aplicado.custoUnitario, 7);
  assert.equal(app.produtos[0].estoque, 12);
  assert.equal(app.produtos[0].custo, 4.5);
  assert.equal(app.produtos[0].preco, 10.78);
});

test('quitar uma compra pelo banco grava a origem e mantém o vencimento e o estoque', async () => {
  const { app, coca, nota } = compraEmEdicao({
    vencimento: '2026-12-14', camposNota: { despStatus: 'pago', despOrigemPagamento: 'banco' },
  });
  coca.estoque = 1;
  const produtoAntes = structuredClone(coca);
  await app.salvarCompraDaNota();
  assert.equal(nota.status, 'pago');
  assert.equal(nota.origemPagamento, 'banco');
  assert.equal(nota.vencimento, '2026-12-14');
  assert.deepEqual(app.produtos[0], produtoAntes);
});

test('salvar compra com marca diferente soma no ingrediente existente e mantém rótulo da nota', async () => {
  const fixture = memoria({ ingredientes: [ingrediente()], itens: [item()] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes.length, 1, 'marca é metadado; não deve criar outro saldo');
  assert.equal(fixture.app.ingredientes[0].estoque, 5);
  assert.equal(fixture.app.ingredientes[0].marca, 'Bonduelle');
  const linha = fixture.app.notas[0].itens[0];
  assert.deepEqual([linha.nome, linha.nomeBase, linha.marca, linha.vinc], ['Milho Bonduelle', 'Milho', 'Bonduelle', 'ing:milho']);
});

test('novo ingrediente criado pela compra mantém nome base e marca em campos separados', async () => {
  const fixture = memoria({ itens: [item()] });
  await fixture.app.salvarCompraDaNota();
  const ing = fixture.app.ingredientes[0];
  assert.deepEqual([ing.nome, ing.nomeBase, ing.marca, ing.estoque], ['Milho', 'Milho', 'Bonduelle', 2]);
});

test('compra salva preço de venda pela margem e categoria no ingrediente existente', async () => {
  const ing = { ...ingrediente(), estoque: 10, custo: 2, precoExtra: 1, precoProtegido: configuracaoAntigaDeLotes() };
  const fixture = memoria({ ingredientes: [ing], itens: [item({
    vinc: 'ing:milho', qtd: 2, valor: 5, categoria: 'Molhos',
    modoPreco: 'percentual', lucroPct: 80, pv: null,
  })] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(ing.custo, 2.5, 'a média considera o saldo anterior e a compra atual');
  assert.equal(ing.precoExtra, 4.5, 'a margem é aplicada ao custo médio final');
  assert.equal(ing.categoria, 'Molhos');
  assert.equal(fixture.app.notas[0].itens[0].pv, 4.5);
});

test('compra usa o pão selecionado, preservando a descrição do fornecedor e o preço configurado', async () => {
  const pao = { id: 'brioche', nome: 'Pão Brioche', estoque: 10, custo: 2, preco: 3, precoProtegido: configuracaoAntigaDeLotes() };
  const outro = { id: 'australia', nome: 'Pão Austrália', estoque: 3, custo: 4 };
  const fixture = memoria({ paes: [pao, outro], itens: [{
    nome: 'Pão Austrália', tipoItem: 'pao', vinc: 'pao:brioche', qtd: 2, valor: 5,
    categoria: 'Pães especiais', modoPreco: 'percentual', lucroPct: 80, pv: null,
  }] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(pao.custo, 2.5);
  assert.equal(pao.preco, 4.5);
  assert.equal(pao.categoria, 'Pães especiais');
  assert.equal(pao.estoque, 12);
  assert.equal(outro.estoque, 3);
  assert.equal(fixture.app.notas[0].itens[0].nome, 'Pão Austrália');
  assert.equal(fixture.app.notas[0].itens[0].vinc, 'pao:brioche');
  assert.equal(fixture.app.notas[0].itens[0].pv, 4.5);
});

test('compra cria ingrediente com preço e categoria digitados', async () => {
  const fixture = memoria({ itens: [item({
    categoria: 'Temperos', modoPreco: 'manual', pv: 6.25,
  })] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].categoria, 'Temperos');
  assert.equal(fixture.app.ingredientes[0].precoExtra, 6.25);
});

test('compra exige escolher um pão cadastrado, mesmo digitando o nome exato de um pão', async () => {
  for (const vinc of ['', 'pao:removido']) {
    const pao = { id: 'brioche', nome: 'Pão Brioche', estoque: 7, custo: 2 };
    const fixture = memoria({ paes: [pao], itens: [{ nome: pao.nome, tipoItem: 'pao', qtd: 2, valor: 3, vinc }] });
    await fixture.app.salvarCompraDaNota();
    assert.equal(fixture.app.notas.length, 0);
    assert.equal(fixture.app.paes.length, 1);
    assert.equal(pao.estoque, 7);
    assert.match(fixture.messages[0], /Selecione o pão/);
  }
  const fixture = memoria({ itens: [{ nome: 'Descrição nova do fornecedor', tipoItem: 'pao', qtd: 2, valor: 3 }] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.paes.length, 0);
  assert.equal(fixture.app.notas.length, 0);
});

test('marca diferente não permite apagar rendimento já usado pelo ingrediente', async () => {
  const ing = { ...ingrediente(), modoCompra: 'flexivel', rendimento: 10, unidadeEstoque: 'porção' };
  const fixture = memoria({ ingredientes: [ing], itens: [item({ rendimentoInformado: true, rend: 0 })] });
  const antes = structuredClone(ing);
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.notas.length, 0);
  assert.deepEqual(fixture.app.ingredientes[0], antes);
  assert.match(fixture.messages[0], /rendimento salvo/);
});

test('compra sem metadado de controle conserva o ingrediente sem controle', async () => {
  const linha = item();
  delete linha.controlaEstoque;
  const fixture = memoria({ ingredientes: [{ ...ingrediente(), semEstoque: true, estoque: 0, estoqueEstimado: 3 }], itens: [linha] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].semEstoque, true);
  assert.equal(fixture.app.ingredientes[0].estoqueEstimado, 5);
});

test('editar quantidade de nota antiga conserva seus rótulos e a marca atual do catálogo', async () => {
  const antiga = { id: 'nota-antiga', nf: '000.123', criadoEm: '2026-10-01T00:00:00Z', tipoRegistro: 'compra', itens: [item({ nome: 'Milho Quero', marca: 'Quero', vinc: 'ing:milho' })] };
  const ing = { ...ingrediente(), nome: 'Milho doce', nomeBase: 'Milho doce', marca: 'Atual', estoque: 5 };
  const fixture = memoria({ ingredientes: [ing], notas: [antiga], editId: antiga.id, itens: [{ ...structuredClone(antiga.itens[0]), qtd: 4, _indiceOriginalNota: 0 }] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].marca, 'Atual');
  assert.deepEqual(fixture.app.notas[0].itens.map(i => [i.nome, i.nomeBase, i.marca]), [['Milho Quero', 'Milho', 'Quero']]);
});

test('marca explicitamente alterada ao editar nota atualiza o catálogo sem tocar em outras notas', async () => {
  const antiga = { id: 'nota-antiga', tipoRegistro: 'compra', itens: [item({ nome: 'Milho Quero', marca: 'Quero', vinc: 'ing:milho' })] };
  const intocada = { id: 'outra', nf: '000.010', tipoRegistro: 'compra', itens: [item({ nome: 'Milho Histórico', marca: 'Histórico', vinc: 'ing:milho' })] };
  const antes = structuredClone(intocada);
  const fixture = memoria({ ingredientes: [ingrediente()], notas: [antiga, intocada], editId: antiga.id, itens: [item({ vinc: 'ing:milho', _indiceOriginalNota: 0 })] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].marca, 'Bonduelle');
  assert.deepEqual(fixture.app.notas[1], antes);
});

test('editar nota de antes da contagem não soma novamente o estoque já contado', async () => {
  const antiga = { id: 'nota-contada', tipoRegistro: 'compra', itens: [item({ nome: 'Milho Quero', marca: 'Quero', vinc: 'ing:milho', controlaEstoque: false, aplicado: { vinc: 'ing:milho', qtdEst: 2, semEstoque: true, contagemEstoqueId: 'contagem-1' } })] };
  const fixture = memoria({ ingredientes: [{ ...ingrediente(), semEstoque: true, estoque: 0, estoqueEstimado: 0.2, contagemEstoqueId: 'contagem-2' }], notas: [antiga], editId: antiga.id, itens: [{ ...structuredClone(antiga.itens[0]), marca: 'Bonduelle', nome: 'Milho Bonduelle', _indiceOriginalNota: 0 }] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].estoqueEstimado, 0.2);
  assert.equal(fixture.app.notas[0].itens[0].aplicado.preservadoPorContagem, true);
  assert.equal(fixture.app.notas[0].itens[0].aplicado.qtdEst, 0);
  assert.equal(fixture.app.notas[0].itens[0].preservarSaldoContado, undefined);
  assert.equal(fixture.app.ingredientes[0].marca, 'Bonduelle');
});

test('segunda edição da nota preservada continua sem resomar e novas linhas somam normalmente', async () => {
  const linha = item({ vinc: 'ing:milho', controlaEstoque: false, aplicado: { vinc: 'ing:milho', qtdEst: 0, semEstoque: true, contagemEstoqueId: 'contagem-2', preservadoPorContagem: true } });
  const antiga = { id: 'nota-contada', tipoRegistro: 'compra', itens: [linha] };
  const fixture = memoria({ ingredientes: [{ ...ingrediente(), semEstoque: true, estoque: 0, estoqueEstimado: 0.2, contagemEstoqueId: 'contagem-2' }], notas: [antiga], editId: antiga.id, itens: [{ ...structuredClone(linha), _indiceOriginalNota: 0 }, item({ qtd: 3, controlaEstoque: false })] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].estoqueEstimado, 3.2);
  assert.equal(fixture.app.notas[0].itens[0].aplicado.preservadoPorContagem, true);
  assert.equal(fixture.app.notas[0].itens[1].aplicado.qtdEst, 3);
});

test('editar compra antiga de ovos não reimporta kg sobre a unidade corrigida do catálogo', async () => {
  const linha = item({ nome: 'Ovo', nomeBase: 'Ovo', marca: '', vinc: 'ing:ovo', qtd: 30, unid: 'un', unidadeEstoque: 'kg', modoCompra: 'flexivel', rend: 0, controlaEstoque: false, aplicado: { vinc: 'ing:ovo', qtdEst: 30, semEstoque: true, custoAntes: 0, custoUnitario: 1 } });
  const antiga = { id: 'ovos', tipoRegistro: 'compra', itens: [linha] };
  const ovo = { id: 'ovo', nome: 'Ovo', nomeBase: 'Ovo', unidade: 'un', unidadeEstoque: 'un', modoCompra: 'flexivel', rendimento: 0, semEstoque: true, estoque: 0, estoqueEstimado: 30, custo: 1 };
  const fixture = memoria({ ingredientes: [ovo], notas: [antiga], editId: antiga.id, itens: [{ ...structuredClone(linha), qtd: 60, _indiceOriginalNota: 0 }] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].unidadeEstoque, 'un');
  assert.equal(fixture.app.ingredientes[0].estoqueEstimado, 60);
  assert.equal(fixture.app.notas[0].itens[0].unid, 'un');
  assert.equal(fixture.app.notas[0].itens[0].aplicado.qtdEst, 60);
});

test('compra em gramas converte para os kg persistidos sem trocar a unidade interna', async () => {
  const ing = { id: 'milho', nome: 'Milho', nomeBase: 'Milho', unidade: 'kg', unidadeEstoque: 'kg', modoCompra: 'flexivel', rendimento: 0, semEstoque: true, estoque: 0, estoqueEstimado: 3, custo: 10 };
  const fixture = memoria({ ingredientes: [ing], itens: [item({ qtd: 3000, valor: 0.01, unid: 'g', unidadeEstoque: 'g', modoCompra: 'flexivel', rend: 0, controlaEstoque: false })] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].unidadeEstoque, 'kg');
  assert.equal(fixture.app.ingredientes[0].estoqueEstimado, 6);
  assert.equal(fixture.app.notas[0].itens[0].unid, 'g');
  assert.equal(fixture.app.notas[0].itens[0].aplicado.qtdEst, 3);
});

test('compra com rendimento preserva a unidade de porções cadastrada apesar do snapshot antigo', async () => {
  const ing = { id: 'milho', nome: 'Milho', nomeBase: 'Milho', unidade: 'kg', unidadeEstoque: 'porção', modoCompra: 'flexivel', rendimento: 10, semEstoque: false, estoque: 5, custo: 1 };
  const fixture = memoria({ ingredientes: [ing], itens: [item({ qtd: 2, unid: 'kg', unidadeEstoque: 'kg', modoCompra: 'flexivel', rend: 10 })] });
  await fixture.app.salvarCompraDaNota();
  assert.equal(fixture.app.ingredientes[0].unidadeEstoque, 'porção');
  assert.equal(fixture.app.ingredientes[0].estoque, 25);
  assert.equal(fixture.app.notas[0].itens[0].aplicado.qtdEst, 20);
});

test('autocomplete reúne marcas de ingredientes, produtos e notas sem duplicar e ordena em português', () => {
  const marcas = new Function('ingredientes', 'produtos', 'despesas', source('normalizarNomeCadastro', 'unidadeCanonicaMedida') + '\n' + source('listaMarcasIngredientes', 'atualizarMarcasIngredientes') + '\nreturn listaMarcasIngredientes();')(
    [{ marca: 'Zulu' }, { marca: 'água' }, { marca: 'Quero' }],
    [{ marca: 'Coca-Cola' }, { marca: 'QUERO' }],
    [{ itens: [{ tipoItem: 'ing', marca: 'quero' }, { tipoItem: 'ing', marca: 'Bonduelle' }, { tipoItem: 'prod', marca: 'Del Valle' }] }]
  );
  assert.deepEqual(marcas, ['água', 'Bonduelle', 'Coca-Cola', 'Del Valle', 'Quero', 'Zulu']);
});
