const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { reconciliarBase, candidatas, itensSemAplicacao, prepararRegistro, rascunhoConfirmadoSemEdicao, rascunhoCorrespondeACompraSalva, excluirRascunhoServidorSeIgual, finalizarRemocaoRascunhoSeIgual } = require('../purchase-draft-recovery.js');
const ComprasDuplicadas = require('../purchase-duplicates.js');

function congelar(valor) {
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}

function igual(a, b) {
  if (!a || !b || String(a.id) !== String(b.id)) return false;
  const limpar = nota => {
    const copia = structuredClone(nota);
    delete copia.criadoEm;
    (copia.itens || []).forEach(item => { delete item.aplicado; });
    return copia;
  };
  return require('node:util').isDeepStrictEqual(limpar(a), limpar(b));
}

const item = {
  nome: 'Suco goiaba', marca: 'Marca escolhida', tipoItem: 'prod', vinc: 'prod:suco',
  qtd: 12, valor: 3.24, unid: 'UN', pv: 5.93, lucroPct: 83, modoPreco: 'percentual',
  desconto: 19.44, descontoTipo: 'valor', descontoOriginal: 19.44,
  categoria: 'Bebidas', categoriaNome: 'Bebidas antigas',
  snapshot: { custo: 1.62, preco: 5.93 },
  aplicado: { vinc: 'prod:suco', qtdEst: 12, custoAntes: 0 },
  _indiceOriginalNota: 0, preservarSaldoContado: true,
};
const notaSalva = {
  id: 'nota-a', tipoRegistro: 'compra', nf: '123', fornecedor: 'Açaí Distribuidora',
  data: '2026-11-15', categoria: 'insumos', categoriaNome: 'Insumos / Compras',
  descricao: 'Compra', subcategoria: '', status: 'pago', obs: '',
  desconto: 0, descontoOriginal: 0, descontoTipo: 'valor', valor: 38.88,
  itens: [{ nome: 'Suco goiaba', qtd: 12, valor: 3.24, unid: 'un', categoria: 'Produtos' }],
};

test('compra nova salva encerra o rascunho após normalização sem ignorar diferenças da compra', () => {
  const registro = {
    operacao: 'nova',
    savedRecordId: notaSalva.id,
    savedNote: structuredClone(notaSalva),
    syncSubmittedAt: 'versao-enviada',
    updatedAt: 'versao-enviada',
  };
  const notaServidor = { ...structuredClone(notaSalva), criadoEm: 'data confirmada pelo servidor' };

  assert.equal(rascunhoConfirmadoSemEdicao(registro, notaServidor, igual), true);
  assert.equal(rascunhoConfirmadoSemEdicao(registro, notaServidor, () => false), false);
  notaServidor.itens[0].valor = 99;
  assert.equal(rascunhoConfirmadoSemEdicao(registro, notaServidor, igual), false);
});

test('rascunho alterado depois do envio não é confundido com a nota já salva', () => {
  const registro = {
    savedRecordId: notaSalva.id,
    savedNote: structuredClone(notaSalva),
    syncSubmittedAt: 'versao-enviada',
    updatedAt: 'versao-mais-nova',
  };

  assert.equal(rascunhoConfirmadoSemEdicao(registro, notaSalva, igual, ComprasDuplicadas.assinatura), false);
});

test('rascunho antigo sem vínculo só é reconhecido como compra já salva quando a nota inteira coincide', () => {
  const registro = {
    operacao: 'nova', editId: null, descontoTipo: 'valor',
    campos: { despData: notaSalva.data, despFornecedor: notaSalva.fornecedor, despNF: notaSalva.nf, despDesconto: '0,00', despCategoria: 'insumos', despCategoriaNome: notaSalva.categoriaNome, despSubcategoria: '', despStatus: 'pago', despObs: '' },
    itens: [{ ...notaSalva.itens[0], qtd: 12, valor: 3.24, unid: 'un' }],
  };
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [notaSalva], ComprasDuplicadas.assinatura), true);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, itens: [{ ...notaSalva.itens[0], valor: 3.25 }] }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, categoria: 'outro' }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, categoriaNome: 'Categoria diferente' }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, itens: [{ ...notaSalva.itens[0], categoria: 'Outra categoria' }] }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, obs: 'Observação ainda não salva' }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, obs: 'Não pôde retirar' }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva({ ...registro, campos: { ...registro.campos, despObs: 'Não pode retirar' } }, [{ ...notaSalva, obs: 'Não pôde retirar' }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, subcategoria: 'Marca diferente', descricao: 'Marca diferente' }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva(registro, [{ ...notaSalva, itens: [{ ...notaSalva.itens[0], pv: 7.5 }] }], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva({ ...registro, campos: { ...registro.campos, despFornecedor: '' } }, [notaSalva], ComprasDuplicadas.assinatura), false);
  assert.equal(rascunhoCorrespondeACompraSalva({ ...registro, operacao: 'editar', editId: notaSalva.id }, [notaSalva], ComprasDuplicadas.assinatura), false);
});

test('confirmação da própria gravação avança a base antiga preservando o rascunho mais recente', () => {
  const registro = congelar({
    baseNota: { ...notaSalva, nf: '122' }, savedNote: { ...notaSalva, criadoEm: 'local' },
    campos: { despNF: '123', despObs: 'Continuo digitando', despDesconto: '10,5' },
    itens: [structuredClone(item)], descontoTipo: 'percent', updatedAt: 'edicao-posterior',
    syncSubmittedAt: 'envio-anterior', savedRecordId: 'nota-a', savedSession: 'celular',
  });
  const resultado = reconciliarBase(registro, notaSalva, { ...notaSalva, criadoEm: 'servidor' }, igual);
  assert.equal(resultado.atualizou, true);
  assert.deepEqual(resultado.registro.baseNota, registro.savedNote);
  assert.deepEqual(resultado.registro.campos, registro.campos);
  assert.deepEqual(resultado.registro.itens, registro.itens);
  assert.equal(resultado.registro.syncSubmittedAt, 'envio-anterior');
  assert.equal(resultado.registro.updatedAt, 'edicao-posterior');
  assert.equal(registro.baseNota.nf, '122');
  resultado.registro.campos.despObs = 'Outra edição';
  resultado.registro.itens[0].snapshot.custo = 9;
  resultado.registro.baseNota.itens[0].qtd = 99;
  assert.equal(registro.campos.despObs, 'Continuo digitando');
  assert.equal(registro.itens[0].snapshot.custo, 1.62);
  assert.equal(registro.savedNote.itens[0].qtd, 12);
});

test('nota confirmada divergente mantém a base original para sinalizar conflito real', () => {
  const registro = congelar({ baseNota: { ...notaSalva, nf: '122' }, savedNote: notaSalva, campos: { despNF: '123' } });
  const resultado = reconciliarBase(registro, notaSalva, { ...notaSalva, fornecedor: 'Outro fornecedor' }, igual);
  assert.equal(resultado.atualizou, false);
  assert.deepEqual(resultado.registro, registro);
  assert.notEqual(resultado.registro, registro);
  assert.notEqual(resultado.registro.baseNota, registro.baseNota);
});

test('nota local divergente impede avanço mesmo quando o servidor confirma a nota enviada', () => {
  const registro = congelar({ baseNota: { ...notaSalva, nf: '122' }, savedNote: notaSalva });
  const resultado = reconciliarBase(registro, { ...notaSalva, nf: '124' }, notaSalva, igual);
  assert.equal(resultado.atualizou, false);
  assert.deepEqual(resultado.registro, registro);
});

test('confirmação incompleta não substitui a base nem chama comparador com nota ausente', () => {
  const registro = congelar({ baseNota: { ...notaSalva, nf: '122' }, savedNote: notaSalva });
  const comparar = (a, b) => { assert(a && b); return igual(a, b); };
  for (const [atual, confirmada] of [[null, notaSalva], [notaSalva, null], [null, null]]) {
    assert.deepEqual(reconciliarBase(registro, atual, confirmada, comparar), { registro, atualizou: false });
  }
  const semNotaEnviada = { baseNota: registro.baseNota, itens: [item] };
  assert.deepEqual(reconciliarBase(semNotaEnviada, notaSalva, notaSalva, comparar), { registro: semNotaEnviada, atualizou: false });
  assert.deepEqual(reconciliarBase(registro, notaSalva, notaSalva), { registro, atualizou: false });
});

test('base já equivalente à nota enviada não pede nova gravação', () => {
  const registro = congelar({ baseNota: { ...notaSalva, criadoEm: 'servidor' }, savedNote: { ...notaSalva, criadoEm: 'local' } });
  const resultado = reconciliarBase(registro, notaSalva, notaSalva, igual);
  assert.equal(resultado.atualizou, false);
  assert.deepEqual(resultado.registro, registro);
});

test('candidatas retorna todas as compras correspondentes sem escolher nem incluir a identidade antiga', () => {
  const notas = congelar([
    { ...notaSalva, id: 'antiga' },
    { ...notaSalva, id: 'nova-a', nf: ' NF 123 ', fornecedor: '  ACAI   DISTRIBUIDORA  ' },
    { ...notaSalva, id: 'nova-b', nf: 'nf 123', fornecedor: 'Açaí Distribuidora' },
    { ...notaSalva, id: 'outro-dia', nf: 'NF 123', data: '2026-11-14' },
    { ...notaSalva, id: 'despesa', nf: 'NF 123', tipoRegistro: 'despesa' },
    { ...notaSalva, id: 'sem-itens', nf: 'NF 123', itens: [] },
    { ...notaSalva, id: 'itens-invalidos', nf: 'NF 123', itens: {} },
    null,
  ]);
  const identidade = congelar({ id: 'antiga', nf: ' nf 123 ', fornecedor: 'açaí distribuidora', data: ' 2026-11-15 ' });
  assert.deepEqual(candidatas(notas, identidade).map(nota => nota.id), ['nova-a', 'nova-b']);
  assert.equal(notas.length, 8);
  assert.equal(identidade.id, 'antiga');
});

test('sem data informada todas as datas correspondentes permanecem como candidatas', () => {
  const notas = [{ ...notaSalva, id: 'nova-a' }, { ...notaSalva, id: 'nova-b', data: '2026-11-14' }];
  assert.deepEqual(candidatas(notas, { nf: '123', fornecedor: 'Açaí Distribuidora' }).map(nota => nota.id), ['nova-a', 'nova-b']);
});

test('NF e fornecedor são obrigatórios para localizar uma nota refeita', () => {
  for (const identidade of [null, {}, { nf: '123' }, { fornecedor: 'Açaí Distribuidora' }, { nf: '  ', fornecedor: 'Açaí Distribuidora' }]) {
    assert.deepEqual(candidatas([notaSalva], identidade), []);
  }
  const identidade = { nf: '123', fornecedor: 'Açaí Distribuidora' };
  assert.deepEqual(candidatas([{ ...notaSalva, nf: '' }, { ...notaSalva, fornecedor: ' ' }], identidade), []);
  assert.deepEqual(candidatas(null, identidade), []);
});

test('NF, fornecedor e data diferentes não entram por aproximação', () => {
  const notas = [
    { ...notaSalva, id: 'zero', nf: '00123' },
    { ...notaSalva, id: 'parecido', fornecedor: 'Açaí Distribuidora Ltda' },
    { ...notaSalva, id: 'formato', data: '15/11/2026' },
  ];
  assert.deepEqual(candidatas(notas, notaSalva), []);
  assert.deepEqual(candidatas([{ ...notaSalva, id: 42 }], { ...notaSalva, id: '42' }), []);
});

test('itens reaproveitados perdem somente as marcas de aplicação da nota anterior', () => {
  const itens = congelar([structuredClone(item)]);
  const resultado = itensSemAplicacao(itens);
  assert.deepEqual(resultado, [{
    nome: 'Suco goiaba', marca: 'Marca escolhida', tipoItem: 'prod', vinc: 'prod:suco',
    qtd: 12, valor: 3.24, unid: 'UN', pv: 5.93, lucroPct: 83, modoPreco: 'percentual',
    desconto: 19.44, descontoTipo: 'valor', descontoOriginal: 19.44,
    categoria: 'Bebidas', categoriaNome: 'Bebidas antigas', snapshot: { custo: 1.62, preco: 5.93 },
  }]);
  resultado[0].snapshot.custo = 8;
  assert.equal(itens[0].snapshot.custo, 1.62);
  assert.equal(itens[0].aplicado.qtdEst, 12);
  assert.equal(itens[0]._indiceOriginalNota, 0);
  assert.equal(itens[0].preservarSaldoContado, true);
});

test('preparar como nova nota elimina identidade salva preservando todos os valores do formulário', () => {
  const registro = congelar({
    versao: 1, editId: 'excluida', baseNota: notaSalva, savedRecordId: 'excluida',
    savedSession: 'celular', savedNote: notaSalva, syncSubmittedAt: 'envio', syncPendente: true,
    campos: { despNF: '123', despFornecedor: 'Açaí Distribuidora', despData: '2026-11-15', despDesconto: '10,50', despObs: 'Manter observação' },
    descontoTipo: 'percent', itens: [structuredClone(item)],
    updatedAt: 'edicao', telaAtiva: 'compras', scrollFormulario: 15, temRascunho: false, retomarAoVoltar: false,
  });
  const resultado = prepararRegistro(registro, { editId: null, baseNota: null });
  assert.deepEqual(resultado, {
    versao: 1, editId: null, baseNota: null,
    campos: { despNF: '123', despFornecedor: 'Açaí Distribuidora', despData: '2026-11-15', despDesconto: '10,50', despObs: 'Manter observação' },
    descontoTipo: 'percent', itens: [{
      nome: 'Suco goiaba', marca: 'Marca escolhida', tipoItem: 'prod', vinc: 'prod:suco',
      qtd: 12, valor: 3.24, unid: 'UN', pv: 5.93, lucroPct: 83, modoPreco: 'percentual',
      desconto: 19.44, descontoTipo: 'valor', descontoOriginal: 19.44,
      categoria: 'Bebidas', categoriaNome: 'Bebidas antigas', snapshot: { custo: 1.62, preco: 5.93 },
    }], updatedAt: 'edicao', telaAtiva: 'compras', scrollFormulario: 15, temRascunho: true, retomarAoVoltar: true,
  });
  resultado.campos.despObs = 'Editada depois';
  resultado.itens[0].snapshot.custo = 7;
  assert.equal(registro.campos.despObs, 'Manter observação');
  assert.equal(registro.itens[0].snapshot.custo, 1.62);
  assert.equal(registro.savedRecordId, 'excluida');
});

test('preparar atualização usa a nova identidade e a base fornecida sem alterar os itens digitados', () => {
  const registro = congelar({ editId: 'excluida', baseNota: { ...notaSalva, itens: [structuredClone(item)] }, campos: { despNF: '123' }, descontoTipo: 'valor', itens: [structuredClone(item)] });
  const novaBase = congelar({ ...notaSalva, id: 'refeita', itens: [structuredClone(item)] });
  const resultado = prepararRegistro(registro, { editId: 'refeita', baseNota: novaBase });
  assert.equal(resultado.editId, 'refeita');
  assert.deepEqual(resultado.baseNota, novaBase);
  assert.equal(resultado.itens[0].qtd, 12);
  assert.equal(resultado.itens[0].pv, 5.93);
  assert.equal(resultado.itens[0].desconto, 19.44);
  assert.equal(resultado.itens[0]._indiceOriginalNota, 0);
  resultado.baseNota.itens[0].qtd = 88;
  assert.equal(novaBase.itens[0].qtd, 12);
  assert.equal(registro.editId, 'excluida');
});

const ingredienteContado = {
  nome: 'Maionese Quero', nomeBase: 'Maionese', marca: 'Quero', tipoItem: 'ing', vinc: 'ing:molho',
  qtd: 2, valor: 3, unid: 'un', modoCompra: 'pacote', controlaEstoque: false,
  categoria: 'outro', categoriaNome: 'Rótulo histórico',
  aplicado: { vinc: 'ing:molho', qtdEst: 2, semEstoque: true, contagemEstoqueId: 'contagem-antiga' },
};

test('atualização remapeia a origem histórica após reordenação sem usar o nome ou marca editados', () => {
  const registro = congelar({
    baseNota: { id: 'antiga', itens: [ingredienteContado, item] },
    itens: [{ ...ingredienteContado, nome: 'Maionese Hellmanns', marca: 'Hellmanns', qtd: 4, _indiceOriginalNota: 0 }, { nome: 'Linha nova', qtd: 1 }],
  });
  const atual = congelar({ id: 'refeita', itens: [item, { ...ingredienteContado, qtd: 5 }] });
  const resultado = prepararRegistro(registro, { editId: 'refeita', baseNota: atual });
  assert.equal(resultado.itens[0]._indiceOriginalNota, 1);
  assert.equal(resultado.itens[0].nome, 'Maionese Hellmanns');
  assert.equal(resultado.itens[0].marca, 'Hellmanns');
  assert.equal(resultado.itens[0].qtd, 4);
  assert.equal(resultado.itens[0].categoriaNome, 'Rótulo histórico');
  assert.equal(resultado.itens[0].aplicado, undefined);
  assert.equal(resultado.itens[0].preservarSaldoContado, undefined);
  assert.equal(resultado.itens[1]._indiceOriginalNota, undefined);
  assert.equal(registro.itens[0]._indiceOriginalNota, 0);
});

test('linha repetida distingue snapshots históricos antes de remapear a ocorrência', () => {
  const segunda = { ...ingredienteContado, qtd: 6, aplicado: { ...ingredienteContado.aplicado, qtdEst: 6, contagemEstoqueId: 'outra-contagem' } };
  const registro = congelar({ baseNota: { id: 'antiga', itens: [ingredienteContado, segunda] }, itens: [{ ...segunda, qtd: 9, _indiceOriginalNota: 1 }] });
  const atual = congelar({ id: 'refeita', itens: [segunda, ingredienteContado] });
  const resultado = prepararRegistro(registro, { editId: 'refeita', baseNota: atual });
  assert.equal(resultado.itens[0]._indiceOriginalNota, 0);
  assert.equal(resultado.itens[0].qtd, 9);
});

test('ocorrências repetidas equivalentes mantêm referências distintas na mesma nota inalterada', () => {
  const base = congelar({ id: 'nota', itens: [ingredienteContado, structuredClone(ingredienteContado)] });
  const registro = congelar({ baseNota: base, itens: [{ ...ingredienteContado, _indiceOriginalNota: 0 }, { ...ingredienteContado, qtd: 9, _indiceOriginalNota: 1 }] });
  assert.deepEqual(prepararRegistro(registro, { editId: 'nota', baseNota: base }).itens.map(it => it._indiceOriginalNota), [0, 1]);
});

test('histórico ambíguo de ingrediente contado interrompe a preparação e preserva o rascunho', () => {
  const registro = congelar({ baseNota: { id: 'antiga', itens: [ingredienteContado, structuredClone(ingredienteContado)] }, itens: [{ ...ingredienteContado, _indiceOriginalNota: 1 }] });
  const atual = congelar({ id: 'refeita', itens: [ingredienteContado] });
  const antes = JSON.stringify(registro);
  assert.throws(() => prepararRegistro(registro, { editId: 'refeita', baseNota: atual }), { code: 'RASCUNHO_COMPRA_HISTORICO_INSEGURO' });
  assert.equal(JSON.stringify(registro), antes);
});

test('referência histórica ausente ou sem correspondência não é convertida em compra nova silenciosamente', () => {
  const linha = { ...ingredienteContado, _indiceOriginalNota: 0 };
  const atual = congelar({ id: 'refeita', itens: [{ ...ingredienteContado, marca: 'Outra marca' }] });
  for (const registro of [
    { itens: [linha] },
    { baseNota: { itens: [] }, itens: [linha] },
    { baseNota: { itens: [ingredienteContado] }, itens: [linha] },
    { baseNota: { itens: [ingredienteContado] }, itens: [ingredienteContado] },
  ]) {
    assert.throws(() => prepararRegistro(congelar(registro), { editId: 'refeita', baseNota: atual }), { code: 'RASCUNHO_COMPRA_HISTORICO_INSEGURO' });
  }
});

test('preparar como nova remove também o histórico de ingrediente contado sem tentar remapear', () => {
  const registro = congelar({ itens: [{ ...ingredienteContado, _indiceOriginalNota: 42, preservarSaldoContado: true }] });
  const resultado = prepararRegistro(registro, { editId: null, baseNota: null });
  assert.equal(resultado.itens[0].aplicado, undefined);
  assert.equal(resultado.itens[0]._indiceOriginalNota, undefined);
  assert.equal(resultado.itens[0].preservarSaldoContado, undefined);
  assert.equal(resultado.itens[0].categoriaNome, 'Rótulo histórico');
});

test('salvar atualização preparada mantém o saldo contado e o rótulo histórico usando a função real', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
  function source(nome, proxima) {
    const inicio = html.indexOf('function ' + nome + '(');
    const fim = proxima ? html.indexOf('\nfunction ' + proxima + '(', inicio) : html.indexOf('\n}\n', inicio) + 2;
    assert(inicio >= 0 && fim > inicio);
    return html.slice(inicio, fim);
  }
  const anterior = { id: 'nota-contada', tipoRegistro: 'compra', itens: [structuredClone(ingredienteContado)] };
  const preparado = prepararRegistro({ baseNota: structuredClone(anterior), itens: [{ ...ingredienteContado, qtd: 4, _indiceOriginalNota: 0 }] }, { editId: anterior.id, baseNota: anterior });
  const campos = Object.fromEntries(Object.entries({ despData: '2026-11-14', despCategoria: 'outro', despSubcategoria: '', despFornecedor: 'Teste', despNF: '123', despStatus: 'pago', despObs: '', despDesconto: '' }).map(([id, value]) => [id, { value }]));
  campos.btnSalvarDespesa = { disabled: false, textContent: 'Atualizar nota' };
  campos.modalDespesa = { classList: { remove() {} } };
  const deps = {
    ingredientes: [{ id: 'molho', nome: 'Maionese', nomeBase: 'Maionese', marca: 'Atual', semEstoque: true, estoque: 0, estoqueEstimado: 0.2, contagemEstoqueId: 'contagem-atual', modoCompra: 'pacote', unidade: 'un' }],
    notas: [structuredClone(anterior)], campos, preparado,
    PrecosCompra: require('../purchase-pricing.js'), EstoqueIngredientes: require('../ingredient-stock.js'), ComprasDuplicadas: require('../purchase-duplicates.js'),
  };
  const inicioSalvar = html.indexOf('async function salvarCompraDaNota(');
  const fimSalvar = html.indexOf('// Um único ponto de gravação', inicioSalvar);
  const app = new Function('deps', `
    var ingredientes=deps.ingredientes,produtos=[],paes=[],despesas=deps.notas,despItensTemp=deps.preparado.itens,editandoDespesaId=deps.preparado.editId;
    var window={despItensTemp:despItensTemp,editandoDespesaId:editandoDespesaId,PrecosCompra:deps.PrecosCompra,EstoqueIngredientes:deps.EstoqueIngredientes,ComprasDuplicadas:deps.ComprasDuplicadas,_descontoNotaTipo:'valor',BackupSys:{async salvar(){return true}}};
    var document={getElementById(id){return deps.campos[id]||null},querySelector(){return null}};
    var compraNotaEmAndamento=false,notaCompraEmSincronizacaoId=null,revisaoLocal=0;
    function uid(){return 'teste'} function souGerente(){return true} function toast(){}
    function salvar(){return Promise.resolve({ok:true,persisted:true})}
    function categoriaLabelSelecionada(){return 'Outro'} function addSugestao(){} function popularTodasSugestoes(){}
    function ehNotaCompraSalva(n){return !!(n&&Array.isArray(n.itens)&&n.tipoRegistro!=='despesa')}
    function alert(msg){throw new Error(msg)}
    ${source('normalizarNomeCadastro', 'formatarQtdMedida')}
    ${html.split('\n').find(linha => linha.startsWith('function usaMediaPorContagemIngrediente('))}
    ${source('lerMoeda', 'lerQuantidade')}
    ${source('alvoEstoque', 'refrescarEstoqueUI')}
    ${source('buscarIngredienteCompra', 'sincronizarIngredienteCompraPorNome')}
    ${source('reverterCompraEstoque', 'vincularItemCompra')}
    ${source('aplicarCompraEstoque')}
    ${html.slice(inicioSalvar, fimSalvar)}
    return {salvarCompraDaNota,get ingredientes(){return ingredientes},get notas(){return despesas}};
  `)(deps);
  await app.salvarCompraDaNota();
  assert.equal(app.ingredientes[0].estoqueEstimado, 0.2);
  assert.equal(app.ingredientes[0].marca, 'Atual');
  assert.equal(app.notas[0].itens[0].aplicado.preservadoPorContagem, true);
  assert.equal(app.notas[0].itens[0].aplicado.qtdEst, 0);
  assert.equal(app.notas[0].itens[0].categoriaNome, 'Rótulo histórico');
});

test('módulo UMD também funciona no navegador sem CommonJS', () => {
  const contexto = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../purchase-draft-recovery.js'), 'utf8'), contexto);
  const resultado = contexto.RecuperacaoCompra.prepararRegistro({ campos: { despNF: '123' }, itens: [] }, { editId: null, baseNota: null });
  assert.equal(resultado.editId, null);
  assert.equal(resultado.baseNota, null);
  assert.equal(resultado.campos.despNF, '123');
  assert.equal(resultado.temRascunho, true);
});

test('seletor financeiro reabre a lista sem texto antigo e Enter vazio não escolhe uma categoria', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert(html.includes("function abrirListaCompleta(){input.value='';ativo=-1;desenhar()}"));
  assert(html.includes("input.addEventListener('focus',abrirListaCompleta)"));
  assert(html.includes("input.addEventListener('pointerdown',function(){if(document.activeElement===input&&input.value)abrirListaCompleta()})"));
  assert(html.includes("if(!String(input.value||'').trim()&&ativo<0)return;"));
});

test('exclusão remota de rascunho usa comparação exata e só confirma quando retorna a linha apagada', async () => {
  const envelope = { tipo: 'rei-da-chapa-rascunho-compra', versao: 1, registro: { updatedAt: 'rev-1', fornecedor: 'Açaí' } };
  const chamadas = [];
  function clienteComResposta(resposta) {
    const query = {
      delete() { chamadas.push(['delete']); return this; },
      eq(coluna, valor) { chamadas.push(['eq', coluna, valor]); return this; },
      filter(coluna, operador, valor) { chamadas.push(['filter', coluna, operador, valor]); return this; },
      select(colunas) { chamadas.push(['select', colunas]); return this; },
      maybeSingle() { return Promise.resolve(resposta); },
    };
    return { from(tabela) { chamadas.push(['from', tabela]); return query; } };
  }

  assert.equal(await excluirRascunhoServidorSeIgual(clienteComResposta({ data: { id: 'draft-1' }, error: null }), 'draft-1', envelope), true);
  assert.deepEqual(chamadas, [
    ['from', 'estado'], ['delete'], ['eq', 'id', 'draft-1'],
    ['filter', 'dados', 'eq', JSON.stringify(envelope)], ['select', 'id'],
  ]);

  chamadas.length = 0;
  assert.equal(await excluirRascunhoServidorSeIgual(clienteComResposta({ data: null, error: null }), 'draft-1', envelope), false);
  assert.equal(await excluirRascunhoServidorSeIgual(clienteComResposta({ data: { id: 'other-id' }, error: null }), 'draft-1', envelope), false);
});

test('cópia local só é removida após exclusão remota e preserva uma versão local mais nova', async () => {
  const original = { updatedAt: 'rev-1' };
  let atual = structuredClone(original);
  let removocoes = 0;
  let preservados = 0;
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const ausente = await finalizarRemocaoRascunhoSeIgual({
    esperado: original, igual, lerLocal: () => atual,
    async excluirServidor() { return false; },
    removerLocal() { removocoes++; },
    preservarLocalMaisNovo() { preservados++; },
  });
  assert.equal(ausente, false);
  assert.equal(removocoes, 0, 'linha ausente ou alterada mantém a cópia local');

  const alteradoDuranteDelete = await finalizarRemocaoRascunhoSeIgual({
    esperado: original, igual, lerLocal: () => atual,
    async excluirServidor() { atual = { updatedAt: 'rev-2' }; return true; },
    removerLocal() { removocoes++; },
    preservarLocalMaisNovo(registro) { preservados++; assert.equal(registro.updatedAt, 'rev-2'); },
  });
  assert.equal(alteradoDuranteDelete, false);
  assert.equal(removocoes, 0, 'edição feita enquanto o Supabase respondia não é apagada');
  assert.equal(preservados, 1);

  atual = structuredClone(original);
  const removido = await finalizarRemocaoRascunhoSeIgual({
    esperado: original, igual, lerLocal: () => atual,
    async excluirServidor() { return true; },
    removerLocal() { removocoes++; atual = null; },
    preservarLocalMaisNovo() { preservados++; },
  });
  assert.equal(removido, true);
  assert.equal(removocoes, 1);
  assert.equal(preservados, 1);
});

test('confirmação normal, retomada e sincronização passam pela limpeza condicional do rascunho', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inicio = html.indexOf('function removerRascunhoConfirmado(k)');
  const fim = html.indexOf('function enfileirarExclusaoRascunhoSeIgual', inicio);
  assert(inicio >= 0 && fim > inicio, 'a limpeza comum do rascunho existe');
  const limpeza = html.slice(inicio, fim);
  assert.match(limpeza, /removerRascunhoConfirmadoSeIgual\(k,esperado\)/);
  assert.doesNotMatch(limpeza, /__appMemoryStorage\.removeItem/);
  const abertura = html.slice(html.indexOf('window.abrirModalDespesa = function (despesa)'), html.indexOf('aberturaRascunho++;', html.indexOf('window.abrirModalDespesa = function (despesa)')));
  assert.match(abertura, /limpezasConfirmadas\.get\(chaveLimpezaNova\)/);
  assert.match(abertura, /limpezaNova\.then\(continuarNovaCompra,continuarNovaCompra\)/);
});
