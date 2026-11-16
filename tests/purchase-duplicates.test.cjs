const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assinatura, encontrar, validarEstado } = require('../purchase-duplicates.js');

const clone = value => structuredClone(value);
const item = (extra = {}) => ({ nome: 'Suco Goiaba', marca: 'Del Valle', tipoItem: 'prod', unid: 'un', qtd: 6, valor: 3.24, ...extra });
const nota = (extra = {}) => ({ id: 'nota-1', tipoRegistro: 'compra', data: '2026-11-15', fornecedor: 'Distribuidora Bora BB', nf: '000.002', desconto: 0, itens: [item()], ...extra });
const estado = notas => ({ porLoja: { l1: { despesas: notas, produtos: [{ id: 'suco', estoque: 6 }] } } });

test('assinatura identifica o conteúdo da compra sem depender do ID ou do catálogo atual', () => {
  const original = nota();
  const outra = nota({ id: 'outro-id', criadoEm: 'outro instante', categoria: 'nova', categoriaNome: 'Outro rótulo', status: 'pendente', obs: 'Pagar amanhã', valor: 0 });
  Object.assign(outra.itens[0], { vinc: 'prod:outro-cadastro', aplicado: { qtdEst: 6, custoUnitario: 3.24 }, _indiceOriginalNota: 0, pv: 90, lucroPct: 500, categoria: 'Bebidas', categoriaNome: 'Sucos', preservarSaldoContado: true });
  assert.equal(typeof assinatura(original), 'string');
  assert.equal(assinatura(original), assinatura(outra));
});

test('espaços, caixa e representações numéricas equivalentes não permitem duplicar a compra', () => {
  const equivalente = nota({ fornecedor: '  DISTRIBUIDORA  BORA BB ', nf: ' 000.002 ' });
  equivalente.itens = [item({ nome: ' suco   GOIABA ', marca: 'DEL VALLE', unid: 'UN', qtd: '6', valor: '3.24000000001' })];
  assert.equal(assinatura(nota()), assinatura(equivalente));
});

test('ordem dos itens não distingue duas notas idênticas, mas linhas repetidas são preservadas', () => {
  const primeiro = nota({ itens: [item(), item({ nome: 'Pão', marca: '', tipoItem: 'pao', qtd: 10, valor: 1.5 })] });
  const invertido = clone(primeiro); invertido.itens.reverse();
  assert.equal(assinatura(primeiro), assinatura(invertido));
  assert.notEqual(assinatura(nota({ itens: [item(), item()] })), assinatura(nota({ itens: [item({ qtd: 12 })] })));
});

test('datas, fornecedor e NF diferentes continuam sendo compras diferentes', () => {
  const original = assinatura(nota());
  for (const extra of [{ data: '2026-11-16' }, { fornecedor: 'Outro fornecedor' }, { nf: '000.003' }]) assert.notEqual(original, assinatura(nota(extra)));
});

test('quantidade, custo, unidade, nome, marca e tipo diferentes não são confundidos', () => {
  const original = assinatura(nota());
  for (const extra of [{ qtd: 7 }, { valor: 3.25 }, { unid: 'kg' }, { nome: 'Suco Uva' }, { marca: 'Outra marca' }, { tipoItem: 'ing' }]) assert.notEqual(original, assinatura(nota({ itens: [item(extra)] })));
});

test('tipo pode ser inferido do vínculo legado sem usar o identificador do cadastro', () => {
  const ingrediente = item({ tipoItem: 'ing', vinc: 'ing:antigo' });
  const legado = item({ vinc: 'ing:novo' }); delete legado.tipoItem;
  assert.equal(assinatura(nota({ itens: [ingrediente] })), assinatura(nota({ itens: [legado] })));
});

test('desconto efetivo do item compara percentual e valor e respeita descontoOriginal zero', () => {
  const porValor = nota({ itens: [item({ desconto: 9.72, descontoTipo: 'valor' })] });
  const percentual = nota({ itens: [item({ desconto: 50, descontoTipo: 'percent' })] });
  assert.equal(assinatura(porValor), assinatura(percentual));
  assert.notEqual(assinatura(nota()), assinatura(percentual));
  const salva = nota({ itens: [item({ desconto: 10, descontoOriginal: 0, descontoTipo: 'valor' })] });
  assert.equal(assinatura(nota()), assinatura(salva));
});

test('desconto geral salvo como valor efetivo equivale ao desconto percentual original', () => {
  const percentual = nota({ desconto: 1.944, descontoOriginal: 10, descontoTipo: 'percent' });
  const legado = nota({ desconto: 1.944, descontoTipo: 'percent' });
  const valor = nota({ desconto: 1.944, descontoOriginal: 1.944, descontoTipo: 'valor' });
  assert.equal(assinatura(percentual), assinatura(legado));
  assert.equal(assinatura(percentual), assinatura(valor));
  assert.notEqual(assinatura(nota()), assinatura(valor));
});

test('descontos são limitados ao total disponível sem criar totais negativos', () => {
  assert.equal(assinatura(nota({ descontoOriginal: 999 })), assinatura(nota({ descontoOriginal: 19.44 })));
  assert.equal(assinatura(nota({ itens: [item({ desconto: 999 })] })), assinatura(nota({ itens: [item({ desconto: 19.44 })] })));
});

test('compras idênticas sem NF também são detectadas', () => {
  const salva = nota({ nf: '' });
  assert.equal(encontrar([salva], nota({ id: 'nova', nf: '' })).id, 'nota-1');
});

test('encontrar ignora a própria nota ao editar e retorna a outra nota salva sem modificá-la', () => {
  const original = nota();
  const duplicada = nota({ id: 'outra' });
  assert.equal(encontrar([original], original, original.id), null);
  assert.equal(encontrar([original, duplicada], original, original.id), duplicada);
  assert.equal(original.id, 'nota-1');
});

test('despesas avulsas e compras sem itens válidos não recebem assinatura de compra', () => {
  for (const valor of [null, {}, nota({ tipoRegistro: 'despesa' }), nota({ itens: [] }), nota({ itens: [item({ nome: '' })] }), nota({ itens: [item({ qtd: 0 })] })]) assert.equal(assinatura(valor), null);
  assert.equal(encontrar([nota({ tipoRegistro: 'despesa' })], nota()), null);
});

test('validarEstado bloqueia nova compra idêntica e informa a nota existente e a loja', () => {
  const original = nota();
  const base = estado([original]);
  const candidato = estado([original, nota({ id: 'nova' })]);
  assert.throws(() => validarEstado(base, candidato), erro => erro.code === 'COMPRA_DUPLICADA' && erro.notaExistente.id === 'nota-1' && erro.lojaId === 'l1');
  assert.equal(candidato.porLoja.l1.despesas.length, 2);
});

test('validarEstado bloqueia duas notas novas idênticas no mesmo estado', () => {
  assert.throws(() => validarEstado(estado([]), estado([nota(), nota({ id: 'outra' })])), erro => erro.code === 'COMPRA_DUPLICADA');
});

test('editar uma compra para ficar idêntica a outra também é bloqueado', () => {
  const original = nota();
  const outra = nota({ id: 'outra', nf: '000.003' });
  assert.throws(() => validarEstado(estado([original, outra]), estado([original, nota({ id: 'outra' })])), erro => erro.code === 'COMPRA_DUPLICADA' && erro.notaExistente.id === 'nota-1');
});

test('uma atualização do mesmo ID sem outra nota igual pode ser salva', () => {
  assert.doesNotThrow(() => validarEstado(estado([nota()]), estado([nota({ itens: [item({ qtd: 7 })] })])));
  assert.doesNotThrow(() => validarEstado(estado([nota()]), estado([nota({ status: 'pendente' })])));
});

test('duplicatas antigas não impedem salvar alterações alheias ou mudar status sem lançar outra compra', () => {
  const base = estado([nota(), nota({ id: 'outra' })]);
  const candidato = clone(base); candidato.porLoja.l1.produtos[0].estoque = 10;
  candidato.porLoja.l1.despesas[1].status = 'pendente';
  assert.doesNotThrow(() => validarEstado(base, candidato));
});

test('compras iguais em lojas diferentes são independentes', () => {
  const base = estado([nota()]);
  const candidato = clone(base); candidato.porLoja.l2 = { despesas: [nota({ id: 'outra' })] };
  assert.doesNotThrow(() => validarEstado(base, candidato));
});

test('módulo não modifica entradas congeladas e funciona no navegador', () => {
  const original = nota(); const antes = clone(original);
  Object.freeze(original); Object.freeze(original.itens); Object.freeze(original.itens[0]);
  assinatura(original); encontrar([original], nota({ id: 'nova' }));
  assert.deepEqual(original, antes);
  const contexto = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../purchase-duplicates.js'), 'utf8'), contexto);
  assert.equal(contexto.ComprasDuplicadas.assinatura(original), assinatura(original));
});
