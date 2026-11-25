(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BackupCompartilhado = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MARCADOR = 1;
  var PREFIXO = 'backup_';
  var LIMITE_EXCLUSAO = 25;

  function ehIdBackup(id) {
    return typeof id === 'string' && id.indexOf(PREFIXO) === 0 && id !== 'atual';
  }
  function formatoData(valor) {
    var data = new Date(valor);
    return Number.isNaN(data.getTime()) ? '' : data.toLocaleString('pt-BR');
  }
  function metaDaLinha(linha) {
    var meta = linha && linha.meta && typeof linha.meta === 'object' ? linha.meta : {};
    var id = String(linha && linha.id || '');
    if (id.indexOf('backup_auto_compra_') === 0) {
      if (!meta.tipo) meta.tipo = 'auto';
      if (!meta.origem) meta.origem = 'compra';
    } else if (id.indexOf('backup_auto_semanal_') === 0) {
      if (!meta.tipo) meta.tipo = 'auto';
      if (!meta.origem) meta.origem = null;
    } else if (id.indexOf('backup_manual_') === 0 && !meta.tipo) meta.tipo = 'manual';
    var data = meta.data || linha && linha.atualizado_em || '';
    return Object.assign({}, meta, {
      id: id,
      data: data,
      dataFmt: meta.dataFmt || formatoData(data),
      compartilhado: true
    });
  }
  function desempacotar(linha) {
    var envelope = linha && linha.dados;
    if (!ehIdBackup(linha && linha.id) || !envelope || envelope._reiDaChapaBackup !== MARCADOR || !envelope.snapshot) return null;
    var meta = metaDaLinha({ id: linha.id, atualizado_em: linha.atualizado_em, meta: envelope.meta });
    return Object.assign(meta, { dados: envelope.snapshot });
  }
  async function resultado(query) {
    try { return await query; } catch (error) { return { data: null, error: error }; }
  }

  async function excluirVarios(cliente, ids, podeExcluir) {
    var pendentes = Array.isArray(ids) ? Array.from(new Set(ids)) : [];
    if (!cliente || !cliente.from || !pendentes.every(ehIdBackup)) return { excluidos: [], pendentes: pendentes };
    var confirmados = new Set();
    for (var i = 0; i < pendentes.length; i += LIMITE_EXCLUSAO) {
      if (podeExcluir && !podeExcluir()) break;
      var lote = pendentes.slice(i, i + LIMITE_EXCLUSAO);
      var resposta = await resultado(cliente.from('estado').delete()
        .in('id', lote).eq('dados->>_reiDaChapaBackup', String(MARCADOR)).select('id'));
      if (!resposta || resposta.error || !Array.isArray(resposta.data)) break;
      resposta.data.forEach(function (linha) {
        if (linha && lote.includes(linha.id)) confirmados.add(linha.id);
      });
    }
    return {
      excluidos: pendentes.filter(function (id) { return confirmados.has(id); }),
      pendentes: pendentes.filter(function (id) { return !confirmados.has(id); })
    };
  }

  return {
    ehIdBackup: ehIdBackup,
    salvar: async function(cliente, registro) {
      if (!cliente || !cliente.from || !registro || !ehIdBackup(registro.id)) return { ok: false, error: 'ID de backup inválido.' };
      var meta = {};
      ['data','dataFmt','tipo','origem','notaId','notaNF','tamanho','totalPedidos','totalNotasCompra','totalProdutos','totalRegistros']
        .forEach(function(chave) { if (registro[chave] !== undefined) meta[chave] = registro[chave]; });
      var linha = {
        id: registro.id,
        atualizado_em: registro.data || new Date().toISOString(),
        dados: { _reiDaChapaBackup: MARCADOR, meta: meta, snapshot: registro.dados }
      };
      var resposta = await resultado(cliente.from('estado').insert(linha));
      return resposta.error ? { ok: false, error: resposta.error } : { ok: true };
    },
    listar: async function(cliente, limite) {
      if (!cliente || !cliente.from) return [];
      limite = Math.max(1, Math.min(1000, Number(limite) || 100));
      var resposta = await resultado(cliente.from('estado')
        .select('id,atualizado_em,meta:dados->meta')
        .neq('id', 'atual')
        .order('atualizado_em', { ascending: false })
        .limit(limite));
      if (resposta.error) {
        resposta = await resultado(cliente.from('estado')
          .select('id,atualizado_em')
          .neq('id', 'atual')
          .order('atualizado_em', { ascending: false })
          .limit(limite));
      }
      if (resposta.error) throw resposta.error;
      if (!Array.isArray(resposta.data)) throw new Error('O Supabase não retornou a lista de backups.');
      return resposta.data.filter(function(linha) { return ehIdBackup(linha && linha.id); }).map(metaDaLinha);
    },
    buscar: async function(cliente, id) {
      if (!cliente || !cliente.from || !ehIdBackup(id)) return null;
      var resposta = await resultado(cliente.from('estado').select('*').eq('id', id).maybeSingle());
      if (resposta.error) throw resposta.error;
      return !resposta.data ? null : desempacotar(resposta.data);
    },
    excluir: async function(cliente, id) {
      if (!cliente || !cliente.from || !ehIdBackup(id)) return { ok: false, error: 'ID de backup inválido.' };
      var removidos = await excluirVarios(cliente, [id]);
      return removidos.excluidos.length === 1 ? { ok: true } : { ok: false, error: 'Exclusão não confirmada.' };
    },
    excluirVarios: excluirVarios,
    limitarCompras: async function(cliente, limite) {
      if (!cliente || !cliente.from) return { ok: false };
      limite = Math.max(1, Math.min(1000, Number(limite) || 50));
      var lista = await this.listar(cliente, 1000);
      var antigos = lista.filter(function(item) { return item.tipo === 'auto' && item.origem === 'compra'; })
        .sort(function(a, b) { return String(b.data || '').localeCompare(String(a.data || '')); })
        .slice(limite)
        .map(function(item) { return item.id; });
      if (!antigos.length) return { ok: true, removidos: 0 };
      var resposta = await resultado(cliente.from('estado').delete().in('id', antigos));
      return resposta.error ? { ok: false, error: resposta.error } : { ok: true, removidos: antigos.length };
    }
  };
});
