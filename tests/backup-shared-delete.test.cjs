const test = require('node:test');
const assert = require('node:assert/strict');
const BackupCompartilhado = require('../backup-shared.js');

function clienteDeBackups(respostas) {
  const chamadas = [];
  const cliente = {
    from(tabela) {
      assert.equal(tabela, 'estado');
      const filtros = [];
      return {
        delete() { return this; },
        in(campo, valores) { filtros.push([campo, valores]); return this; },
        eq(campo, valor) { filtros.push([campo, valor]); return this; },
        select(coluna) { chamadas.push({ filtros, coluna }); return Promise.resolve(respostas.shift()); },
      };
    },
  };
  return { cliente, chamadas };
}

test('só envia IDs de backup distintos e confirma apenas as linhas retornadas', async () => {
  const { cliente, chamadas } = clienteDeBackups([{ data: [{ id: 'backup_a' }, { id: 'outro' }], error: null }]);
  const resultado = await BackupCompartilhado.excluirVarios(cliente, ['backup_a', 'backup_b', 'backup_a']);
  assert.deepEqual(resultado.excluidos, ['backup_a']);
  assert.deepEqual(resultado.pendentes, ['backup_b']);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].coluna, 'id');
  assert.deepEqual(chamadas[0].filtros, [
    ['id', ['backup_a', 'backup_b']],
    ['dados->>_reiDaChapaBackup', '1'],
  ]);
  assert.deepEqual((await BackupCompartilhado.excluirVarios(cliente, ['backup_a', 'atual'])).excluidos, []);
  assert.deepEqual((await BackupCompartilhado.excluirVarios(cliente, ['rascunho_compra_v1:a'])).excluidos, []);
  assert.equal(chamadas.length, 1);
});

test('preserva os não confirmados e interrompe novos lotes se o gerente sair', async () => {
  const ids = Array.from({ length: 26 }, (_, indice) => 'backup_' + indice);
  const { cliente, chamadas } = clienteDeBackups([
    { data: [{ id: ids[0] }], error: null },
    { data: null, error: new Error('Sem conexão') },
  ]);
  const resultado = await BackupCompartilhado.excluirVarios(cliente, ids);
  assert.deepEqual(chamadas.map(chamada => chamada.filtros[0][1].length), [25, 1]);
  assert.deepEqual(resultado.excluidos, [ids[0]]);
  assert.deepEqual(resultado.pendentes, ids.slice(1));

  const aposTrocaDePerfil = clienteDeBackups([{ data: [{ id: ids[0] }], error: null }]);
  const resultadoComTroca = await BackupCompartilhado.excluirVarios(aposTrocaDePerfil.cliente, ids,
    () => aposTrocaDePerfil.chamadas.length === 0);
  assert.equal(aposTrocaDePerfil.chamadas.length, 1);
  assert.deepEqual(resultadoComTroca.pendentes, ids.slice(1));
});
