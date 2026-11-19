const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function carregar() {
  const arquivo = path.join(__dirname, '../protected-pricing.js');
  assert.ok(fs.existsSync(arquivo), 'o cálculo do preço protegido deve existir');
  return require(arquivo);
}

const produto = { id: 'coca', nome: 'Coca-Cola', estoque: 10, preco: 14 };
const vinc = 'prod:coca';
const linha = (qtd, custo) => ({ nome: produto.nome, vinc, aplicado: { vinc, qtdEst: qtd, custoUnitario: custo } });
const nota = (id, criadoEm, ...itens) => ({ id, tipoRegistro: 'compra', criadoEm, itens });

test('protege o lote caro restante e sugere baixar só depois de sua saída pelo PEPS', () => {
  const { iniciar, calcular } = carregar();
  const despesas = [nota('barato', '2026-11-20T12:00:00Z', linha(10, 8))];
  const configurado = { ...produto, estoque: 20, precoProtegido: iniciar(produto, [], 12, 25) };
  const antes = calcular(configurado, despesas);
  assert.deepEqual(antes, {
    status: 'ok', lotes: [{ qtd: 10, custo: 12 }, { qtd: 10, custo: 8 }], custoProtegido: 12, preco: 15,
  });
  assert.equal(calcular({ ...configurado, estoque: 11 }, despesas).preco, 15);
  assert.equal(calcular({ ...configurado, estoque: 10 }, despesas).preco, 10);
  assert.equal(calcular({ ...configurado, estoque: 0 }, despesas).status, 'semEstoque');
  assert.equal(configurado.preco, 14, 'a sugestão nunca altera o preço');
});

test('ordena compras pela criação e protege o maior custo quando um lote mais novo é mais caro', () => {
  const { iniciar, calcular } = carregar();
  const despesas = [
    nota('c', '2026-11-22T12:00:00Z', linha(4, 12)),
    nota('a', '2026-11-20T12:00:00Z', linha(1, 3)),
    nota('b', '2026-11-21T12:00:00Z', linha(3, 7)),
  ];
  const p = { ...produto, estoque: 5, precoProtegido: iniciar({ ...produto, estoque: 0 }, [], 0, 25) };
  assert.deepEqual(calcular(p, despesas).lotes, [{ qtd: 1, custo: 7 }, { qtd: 4, custo: 12 }]);
  assert.equal(calcular(p, despesas).preco, 15);
});

test('lotes de uma mesma compra seguram o maior custo até o fim daquela entrada', () => {
  const { iniciar, calcular } = carregar();
  const despesas = [nota('unica', '2026-11-20T12:00:00Z', linha(3, 5), linha(2, 0))];
  const p = { ...produto, estoque: 2, precoProtegido: iniciar({ ...produto, estoque: 0 }, [], 0, 30) };
  assert.deepEqual(calcular(p, despesas).lotes, [{ qtd: 2, custo: 5 }]);
  assert.equal(calcular(p, despesas).preco, 6.5);
  assert.equal(calcular(p, [nota('unica', '2026-11-20T12:00:00Z', linha(2, 0))]).preco, 0);
});

test('refazer ou remover uma compra anterior à conferência exige nova conferência', () => {
  const { iniciar, calcular, assinaturaCompra } = carregar();
  const antiga = nota('antiga', '2026-11-13T12:00:00Z', linha(12, 11.8));
  const mudada = nota('antiga', '2026-11-13T12:00:00Z', linha(8, 11.8));
  const p = { ...produto, precoProtegido: iniciar(produto, [antiga], 12, 25) };
  assert.notEqual(assinaturaCompra(mudada, vinc), assinaturaCompra(antiga, vinc));
  assert.equal(calcular(p, [{ ...antiga, descricao: 'Novo texto' }]).preco, 15);
  assert.equal(calcular(p, [mudada]).status, 'conferir');
  assert.equal(calcular(p, []).status, 'conferir');
  assert.equal(calcular({ ...p, precoProtegido: { ...p.precoProtegido, revisar: true } }, [antiga]).preco, null);
});

test('se a origem do saldo ou o custo de uma compra nova for desconhecido, não sugere preço', () => {
  const { iniciar, calcular } = carregar();
  const p = { ...produto, precoProtegido: iniciar(produto, [], 12, 25) };
  assert.equal(calcular(p, null).status, 'conferir');
  assert.equal(calcular({ ...p, estoque: 11 }, []).status, 'conferir');
  assert.equal(calcular({ ...p, estoque: -1 }, []).status, 'conferir');
  assert.equal(calcular(p, [nota('sem-custo', '2026-11-20T12:00:00Z', linha(1, null))]).status, 'conferir');
  assert.equal(calcular(p, [nota('sem-aplicado', '2026-11-20T12:00:00Z', { vinc })]).status, 'conferir');
  assert.equal(calcular(p, [nota('sem-vinculo', '2026-11-20T12:00:00Z', { nome: produto.nome })]).status, 'conferir');
  assert.equal(calcular(p, [nota('sem-data', '', linha(2, 5))]).status, 'conferir');
  assert.throws(() => iniciar(produto, [], 0, 25), /custo/i);
  assert.equal(calcular(produto, []).status, 'desativado');
});

test('arredonda para o centavo acima e não muda o centavo por ruído de ponto flutuante', () => {
  const { iniciar, calcular } = carregar();
  const centavo = (custo, percentual) => calcular({
    ...produto,
    precoProtegido: iniciar(produto, [], custo, percentual),
  }, []).preco;
  assert.equal(centavo(1.001, 25), 1.26);
  assert.equal(centavo(4.1, 50), 6.15);
  assert.equal(centavo(0.1 + 0.2, 0), 0.3);
  assert.equal(centavo(1.00000000000001, 0), 1.01);
});

test('ingrediente protege o custo por dose e usa o saldo em sua unidade física', () => {
  const { iniciar, calcular } = carregar();
  const ingrediente = { id: 'tomate', nome: 'Tomate', estoque: 0, estoqueEstimado: 350 };
  const vinculo = 'ing:tomate';
  const config = iniciar(ingrediente, [], 0.008, 25, { vinculo, saldo: 350 });
  const compra = nota('nova', '2026-11-20T12:00:00Z',
    { tipoItem: 'ing', vinc: vinculo, aplicado: { vinc: vinculo, qtdEst: 250.5, custoUnitario: 0.004 } });
  const calcularIngrediente = saldo => calcular(
    { ...ingrediente, precoProtegido: config }, [compra], { vinculo, saldo, multiplicador: 100 },
  );
  assert.equal(calcularIngrediente(270.75).custoProtegido, 0.008);
  assert.equal(calcularIngrediente(270.75).preco, 1);
  assert.deepEqual(calcularIngrediente(250.5).lotes, [{ qtd: 250.5, custo: 0.004 }]);
  assert.equal(calcularIngrediente(250.5).preco, 0.5);
  assert.equal(calcularIngrediente(null).status, 'conferir');
  assert.throws(() => iniciar(ingrediente, [], 0.008, 25, { vinculo, saldo: null }), /saldo/i);
});

test('pão compartilha o cálculo, mas os lotes do produto homônimo ficam separados', () => {
  const { iniciar, calcular } = carregar();
  const pao = { id: 'brioche', nome: 'Brioche', estoque: 0 };
  const vinculo = 'pao:brioche';
  const config = iniciar(pao, [], 0, 25, { vinculo });
  const outraCompra = nota('produto-brioche', '2026-11-21T12:00:00Z', {
    vinc: 'prod:brioche', aplicado: { vinc: 'prod:brioche', qtdEst: 50, custoUnitario: 100 },
  });
  const compraPao = nota('brioche', '2026-11-20T12:00:00Z', {
    vinc: vinculo, aplicado: { vinc: vinculo, qtdEst: 10, custoUnitario: 2 },
  });
  const resultado = calcular({ ...pao, estoque: 5, precoProtegido: config }, [compraPao, outraCompra], { vinculo });
  assert.deepEqual(resultado.lotes, [{ qtd: 5, custo: 2 }]);
  assert.equal(resultado.preco, 2.5);
});

test('ruído decimal na quantidade não movimenta um lote antigo já esgotado', () => {
  const { iniciar, calcular } = carregar();
  const configuracao = iniciar({ ...produto, estoque: 0.4 }, [], 12, 25);
  const saldo = { ...produto, estoque: 0.1 + 0.2, precoProtegido: configuracao };
  const compra = nota('nova', '2026-11-20T12:00:00Z', linha(0.3, 8));
  assert.equal(calcular(saldo, [compra]).preco, 10);
});
