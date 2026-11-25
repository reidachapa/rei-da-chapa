const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../ingredient-stock.js');
const stock = fs.existsSync(modulePath) ? require(modulePath) : {};
const ingredient = extra => ({ id: 'bacon', nome: 'Bacon', semEstoque: true, consumoMedia: true, unidade: 'kg', unidadeEstoque: 'kg', modoCompra: 'flexivel', rendimento: 0, estoqueEstimado: 6, inicioContagemKg: 6, comprasDesdeContagem: 0, perdasDesdeContagem: 0, pesoVendidoDesdeContagem: 10, ...extra });
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} should be ${expected}`);

test('stock displays the same measurement for each spelling of units, grams and kilograms', () => {
  for (const [label, unit] of [['un', 'un'], ['und', 'un'], ['unidade', 'un'], ['g', 'g'], ['gr', 'g'], ['kg', 'kg'], ['kilo', 'kg']]) {
    const ing = ingredient({ semEstoque: false, consumoMedia: false, unidadeEstoque: label });
    assert.deepEqual(stock.saldoParaExibicao(ing, 12), { quantidade: 12, unidade: unit, gramasPorUnidade: 0 });
    assert.equal(stock.paraEstoque(1, unit, ing), 1);
  }
});

test('a counted portion can display its equivalent weight and still deduct one portion per sale', () => {
  const ing = ingredient({ semEstoque: false, consumoMedia: false, unidadeEstoque: 'und', rendimento: 20, gramasPorUnidade: 50, estoque: 40 });
  assert.deepEqual(stock.saldoParaExibicao(ing, 40), { quantidade: 40, unidade: 'un', gramasPorUnidade: 50 });
  const pesado = { ...ing, unidadeExibicaoEstoque: 'gr' };
  assert.deepEqual(stock.saldoParaExibicao(pesado, 40), { quantidade: 2000, unidade: 'g', gramasPorUnidade: 50 });
  assert.equal(stock.saldoParaExibicao(stock.consumir(pesado, 1), 39).quantidade, 1950);
  assert.deepEqual(stock.saldoParaExibicao({ ...ing, unidadeExibicaoEstoque: 'kilo' }, 40), { quantidade: 2, unidade: 'kg', gramasPorUnidade: 50 });
});

test('stock kept in grams uses the physical balance without multiplying by the portion weight', () => {
  const ing = ingredient({ unidadeEstoque: 'gr', semEstoque: false, consumoMedia: false, gramasPorUnidade: 50, estoque: 500 });
  assert.deepEqual(stock.saldoParaExibicao(ing, 500), { quantidade: 500, unidade: 'g', gramasPorUnidade: 0 });
  const debited = stock.consumir(ing, stock.paraEstoque(50, 'g', ing));
  assert.equal(debited.estoque, 450);
});

test('the cart preserves a fractional kilogram and debits that amount from stock', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inicio = html.indexOf('function serializarIngs(');
  const fim = html.indexOf('function numeroPedidoExibicao(', inicio);
  const roundTrip = new Function(html.slice(inicio, fim) + '\nreturn parseChave(chaveItem("hamburguer", null, { bacon: 0.05 })).ings.bacon;');
  const ing = ingredient({ semEstoque: false, consumoMedia: false, estoque: 1 });
  close(stock.consumir(ing, roundTrip()).estoque, 0.95);
});

test('count converts 200 g into 0.2 kg without changing the recipe reference', () => {
  const ing = ingredient();
  const result = stock.analisarContagem(ing, { saldo: 200, unidade: 'g', id: 'count-1', data: '2026-11-14T12:00:00Z' });
  assert.equal(result.ok, true);
  close(result.novoIngrediente.estoqueEstimado, 0.2);
  close(result.novoIngrediente.fatorConsumoMedia, 0.58);
  assert.equal(result.novoIngrediente.contagemEstoqueId, 'count-1');
  assert.equal(ing.estoqueEstimado, 6, 'analysis never mutates the original ingredient');
});

test('counted net balance and a loss in the period do not debit the loss twice', () => {
  const result = stock.analisarContagem(ingredient({ estoqueEstimado: 4, inicioContagemKg: 3, comprasDesdeContagem: 1 }), { saldo: 3.4, unidade: 'kg', perda: 100, unidadePerda: 'g', id: 'count-2' });
  assert.equal(result.ok, true);
  close(result.novoIngrediente.estoqueEstimado, 3.4);
  close(result.resumo.consumo, 0.5);
  close(result.novoIngrediente.fatorConsumoMedia, 0.05);
  assert.equal(result.perda.qtdEstimativaBaixada, 0);
  assert.equal(result.perda.incluidaNaContagem, true);
});

test('an inconsistent physical count requires explicit confirmation and never learns negative consumption', () => {
  const ing = ingredient({ estoqueEstimado: 3, inicioContagemKg: 3, fatorConsumoMedia: 0.02, pesoHistorico: 10, kgHistorico: 0.2 });
  const pending = stock.analisarContagem(ing, { saldo: 3.4, unidade: 'kg', perda: 100, unidadePerda: 'g', id: 'count-3' });
  assert.equal(pending.ok, false);
  assert.equal(pending.requerConfirmacao, true);
  assert.equal(pending.novoIngrediente, undefined);
  const result = stock.analisarContagem(ing, { saldo: 3.4, unidade: 'kg', perda: 100, unidadePerda: 'g', id: 'count-3', confirmarAjuste: true });
  assert.equal(result.ok, true);
  assert.equal(result.resumo.mediaAtualizada, false);
  assert.equal(result.novoIngrediente.fatorConsumoMedia, 0.02);
  assert.equal(result.novoIngrediente.estoqueEstimado, 3.4);
});

test('first physical count establishes an anchor without inventing consumption', () => {
  const result = stock.analisarContagem(ingredient({ estoqueEstimado: null, inicioContagemKg: null }), { saldo: 200, unidade: 'g', id: 'count-first' });
  assert.equal(result.ok, true);
  assert.equal(result.novoIngrediente.estoqueEstimado, 0.2);
  assert.equal(result.resumo.mediaAtualizada, false);
});

test('count understands the real inventory unit even when recipe uses reference one', () => {
  const result = stock.analisarContagem(ingredient({ unidadeEstoque: 'g', estoqueEstimado: 6000, inicioContagemKg: 6000 }), { saldo: 0.2, unidade: 'kg', id: 'count-g' });
  assert.equal(result.ok, true);
  assert.equal(result.novoIngrediente.estoqueEstimado, 200);
  assert.equal(stock.unidadeFisicaInterna(result.novoIngrediente), 'g');
  assert.equal(stock.unidadeExibicao(result.novoIngrediente), 'kg');
});

test('uncontrolled measured ingredient uses learned consumption per recipe use, never one kg per use', () => {
  const ing = ingredient({ consumoMedia: false, estoqueEstimado: 3 });
  assert.equal(stock.consumir(ing, 1).estoqueEstimado, 3);
  const learned = stock.consumir({ ...ing, consumoMedia: true, fatorConsumoMedia: 0.02 }, 2);
  close(learned.estoqueEstimado, 2.96);
  assert.equal(learned.pesoVendidoDesdeContagem, 12);
  const portions = stock.consumir({ ...ing, unidadeEstoque: 'porção', rendimento: 100 }, 2);
  assert.equal(portions.estoqueEstimado, 1, 'yielded portions keep their existing semantics');
});

test('physical loss debits 100 g and its undo restores only the current counting epoch', () => {
  const ing = ingredient({ estoqueEstimado: 0.2, inicioContagemKg: 0.2, contagemEstoqueId: 'epoch-a' });
  const loss = stock.registrarPerda(ing, { qtd: 100, unidade: 'g' });
  close(loss.novoIngrediente.estoqueEstimado, 0.1);
  close(loss.novoIngrediente.perdasDesdeContagem, 0.1);
  const restored = stock.restaurarPerda(loss.novoIngrediente, loss.perda);
  close(restored.estoqueEstimado, 0.2);
  close(restored.perdasDesdeContagem, 0);
  const afterCount = { ...loss.novoIngrediente, estoqueEstimado: 0.04, perdasDesdeContagem: 0, contagemEstoqueId: 'epoch-b' };
  assert.equal(stock.restaurarPerda(afterCount, loss.perda).estoqueEstimado, 0.04, 'a newer observed count is authoritative');
});

test('undo of a loss from a closed period reclassifies consumption without overriding a newer physical count', () => {
  const ing = ingredient({ estoqueEstimado: 1, inicioContagemKg: 1, contagemEstoqueId: 'before' });
  const applied = stock.registrarPerda(ing, { qtd: 100, unidade: 'g' });
  const loss = { id: 'loss-closed', ...applied.perda };
  const counted = stock.analisarContagem(applied.novoIngrediente, { saldo: 0.7, unidade: 'kg', id: 'after' });
  close(counted.novoIngrediente.fatorConsumoMedia, 0.02);
  const restored = stock.restaurarPerda(counted.novoIngrediente, loss);
  assert.equal(restored.estoqueEstimado, 0.7);
  close(restored.fatorConsumoMedia, 0.03);
  close(stock.restaurarPerda(restored, loss).fatorConsumoMedia, 0.03, 'repeating the same undo does not add consumption twice');
});

test('deleting a loss already included in a physical count does not add physical stock', () => {
  const result = stock.analisarContagem(ingredient({ inicioContagemKg: 4, estoqueEstimado: 4 }), { saldo: 3.4, unidade: 'kg', perda: 100, unidadePerda: 'g', id: 'count-loss' });
  const restored = stock.restaurarPerda(result.novoIngrediente, result.perda);
  assert.equal(restored.estoqueEstimado, 3.4);
  close(restored.kgHistorico, 0.6, 'removing the loss reclassifies it as consumption for that same observed count');
  close(restored.fatorConsumoMedia, 0.06);
});

test('invalid and dimensionally incompatible quantities are rejected without changing the ingredient', () => {
  const ing = ingredient();
  for (const saldo of [-1, '', 'abc', Infinity]) assert.equal(stock.analisarContagem(ing, { saldo, unidade: 'kg' }).ok, false);
  assert.equal(stock.analisarContagem(ing, { saldo: 2, unidade: 'l' }).ok, false);
  assert.equal(ing.estoqueEstimado, 6);
});

test('uncontrolled measured purchases use reference-one learning even before the legacy flag is enabled', () => {
  const ing = ingredient({ consumoMedia: false });
  assert.equal(stock.usaMediaPorContagem(ing), true);
  const result = stock.analisarContagem(ing, { saldo: 5, unidade: 'kg', id: 'enable-learning' });
  assert.equal(result.novoIngrediente.consumoMedia, true);
  close(result.novoIngrediente.fatorConsumoMedia, 0.1);
});

test('a legacy balance without a trustworthy opening anchor does not double-count previous purchases', () => {
  const result = stock.analisarContagem(ingredient({ inicioContagemKg: null, comprasDesdeContagem: 3 }), { saldo: 5, unidade: 'kg', id: 'unknown-anchor' });
  assert.equal(result.ok, true);
  assert.equal(result.resumo.primeiraContagem, true);
  assert.equal(result.resumo.mediaAtualizada, false);
});

test('restoring a sale from a closed counting epoch preserves the newly observed balance', () => {
  const ing = ingredient({ estoqueEstimado: 0.2, pesoVendidoDesdeContagem: 0, contagemEstoqueId: 'new-count' });
  const returned = stock.devolver(ing, 1, { semEstoque: true, consumoMedia: true, estoqueEstimado: 0.02, pesoVendido: 1, contagemEstoqueId: 'old-count' });
  assert.equal(returned.estoqueEstimado, 0.2);
  assert.equal(returned.pesoVendidoDesdeContagem, 0);
  const sameEpoch = stock.devolver(ing, 1, { semEstoque: true, consumoMedia: true, estoqueEstimado: 0.02, pesoVendido: 1, contagemEstoqueId: 'new-count' });
  close(sameEpoch.estoqueEstimado, 0.22);
});

function purchaseIntegration(ing) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
  const source = (name, next) => {
    const start = html.indexOf('function ' + name + '(');
    const end = next ? html.indexOf('\nfunction ' + next + '(', start) : html.indexOf('\n}\n', start) + 2;
    return html.slice(start, end);
  };
  return new Function('window', 'EstoqueIngredientes', 'alvoEstoque', 'ehNotaCompraSalva', 'unidadeCanonicaMedida', 'converterQuantidadeUnidade', 'usaMediaPorContagemIngrediente', source('reverterCompraEstoque', 'vincularItemCompra') + '\n' + source('aplicarCompraEstoque') + '\nreturn {aplicarCompraEstoque,reverterCompraEstoque};')(
    { EstoqueIngredientes: stock }, stock, vinc => vinc === 'ing:bacon' ? { tipo: 'ing', obj: ing } : null, () => true,
    value => String(value).toLowerCase(), stock.converter, stock.usaMediaPorContagem
  );
}

test('actual purchase integration sums kilograms and reverses the active epoch purchase counter', () => {
  const ing = ingredient({ estoqueEstimado: 0, inicioContagemKg: null, consumoMedia: false });
  const api = purchaseIntegration(ing);
  const first = { vinc: 'ing:bacon', qtd: 3, unid: 'kg', valor: 20 };
  const second = { vinc: 'ing:bacon', qtd: 3000, unid: 'g', valor: 0.02 };
  api.aplicarCompraEstoque([first, second]);
  assert.equal(ing.estoqueEstimado, 6);
  assert.equal(ing.inicioContagemKg, 0);
  assert.equal(ing.comprasDesdeContagem, 6);
  api.reverterCompraEstoque([first], { itens: [first] });
  assert.equal(ing.estoqueEstimado, 3);
  assert.equal(ing.comprasDesdeContagem, 3);
});

test('actual purchase integration preserves a counted balance through historical invoice edits and allows a real new purchase', () => {
  const ing = ingredient({ estoqueEstimado: 0.2, inicioContagemKg: 0.2, contagemEstoqueId: 'count-observed', custo: 20 });
  const api = purchaseIntegration(ing);
  const old = { vinc: 'ing:bacon', qtd: 3, valor: 20, unid: 'kg', aplicado: { vinc: 'ing:bacon', qtdEst: 3, custoUnitario: 20, semEstoque: true, contagemEstoqueId: null } };
  api.reverterCompraEstoque([old], { itens: [old] });
  assert.equal(ing.estoqueEstimado, 0.2);
  const edited = { vinc: 'ing:bacon', qtd: 4, valor: 25, unid: 'kg', preservarSaldoContado: true };
  api.aplicarCompraEstoque([edited]);
  assert.equal(ing.estoqueEstimado, 0.2);
  assert.equal(ing.custo, 20);
  assert.equal(edited.aplicado.preservadoPorContagem, true);
  assert.equal(edited.preservarSaldoContado, undefined);
  api.reverterCompraEstoque([edited], { itens: [edited] });
  edited.preservarSaldoContado = true;
  api.aplicarCompraEstoque([edited]);
  assert.equal(ing.estoqueEstimado, 0.2);
  api.aplicarCompraEstoque([{ vinc: 'ing:bacon', qtd: 3, valor: 20, unid: 'kg' }]);
  assert.equal(ing.estoqueEstimado, 3.2);
  assert.equal(ing.comprasDesdeContagem, 3);
});

test('a new purchase with an incompatible physical unit is refused instead of treating units as kilograms', () => {
  const ing = ingredient({ unidade: 'un', unidadeEstoque: 'kg', estoqueEstimado: 150 });
  const before = structuredClone(ing);
  assert.throws(() => purchaseIntegration(ing).aplicarCompraEstoque([{ vinc: 'ing:bacon', qtd: 2, unid: 'un', valor: 10 }]), /unidade|medida/i);
  assert.deepEqual(ing, before);
});

function countIntegration(ing, save) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
  const start = html.indexOf('async function contarSaldoIngrediente('), end = html.indexOf('\nfunction reservadoProprio(', start);
  const state = { EstoqueIngredientes: stock, perdas: [] };
  const count = new Function('window', 'ingredientes', 'souGerente', 'uid', 'salvar', 'refrescarEstoqueUI', 'unidadeExibicaoEstoqueIngrediente', 'document', 'editandoIngId', html.slice(start, end) + '\nreturn contarSaldoIngrediente;')(
    state, [ing], () => true, () => 'id', save, () => {}, stock.unidadeExibicao, { getElementById() { return null; } }, null
  );
  return { count, state };
}

test('physical count success waits for server confirmation', async () => {
  const ing = ingredient();
  let resolveSave, settled = false;
  const integration = countIntegration(ing, () => new Promise(resolve => { resolveSave = resolve; }));
  const pending = integration.count(ing, { saldo: 5, unidade: 'kg', id: 'wait-save' }).then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveSave({ ok: true });
  assert.equal((await pending).ok, true);
  assert.equal(ing.estoqueEstimado, 5);
});

test('failed count save restores the previous ingredient and does not keep a phantom loss', async () => {
  const ing = ingredient(), before = structuredClone(ing);
  const integration = countIntegration(ing, async () => ({ ok: false, error: new Error('connection failed') }));
  const result = await integration.count(ing, { saldo: 5, unidade: 'kg', perda: 0.1, unidadePerda: 'kg', id: 'failed-save' });
  assert.equal(result.ok, false);
  assert.match(result.erro, /connection failed/);
  assert.deepEqual(ing, before);
  assert.equal(integration.state.perdas.length, 0);
});

test('failed count save never overwrites a purchase made while server confirmation was pending', async () => {
  const ing = ingredient();
  let resolveSave;
  const integration = countIntegration(ing, () => new Promise(resolve => { resolveSave = resolve; }));
  const pending = integration.count(ing, { saldo: 3.4, unidade: 'kg', perda: 0.1, unidadePerda: 'kg', id: 'count-with-later-purchase' });
  ing.estoqueEstimado += 3;
  ing.comprasDesdeContagem += 3;
  resolveSave({ ok: false, error: new Error('connection failed') });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.preservadoLocalmente, true);
  assert.equal(ing.estoqueEstimado, 6.4);
  assert.equal(ing.comprasDesdeContagem, 3);
  assert.equal(integration.state.perdas.length, 1);
});

test('checkout retry movement never replays an old decrement over a newer observed physical count', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const line = html.split(/\r?\n/).find(l => l.startsWith('function reaplicarMovimentosEstoqueCheckout('));
  const ing = ingredient({ estoqueEstimado: 0.2, contagemEstoqueId: 'observed-new' });
  const replay = new Function('ingredientes', 'produtos', 'paes', line + ';return reaplicarMovimentosEstoqueCheckout;')([ing], [], []);
  replay([{ tipo: 'ingrediente', id: 'bacon', campo: 'estoqueEstimado', delta: -0.05, contagemEstoqueId: 'observed-old' }]);
  assert.equal(ing.estoqueEstimado, 0.2);
  replay([{ tipo: 'ingrediente', id: 'bacon', campo: 'estoqueEstimado', delta: -0.05, contagemEstoqueId: 'observed-new' }]);
  close(ing.estoqueEstimado, 0.15);
});
