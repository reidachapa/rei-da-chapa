/* Pure recovery helpers for purchase drafts. Recovery prepares a draft only;
 * selecting a replacement note and saving it remain explicit caller actions.
 * All draft/note data is copied before modification.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RecuperacaoCompra = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clonar(valor) {
    if (!valor || typeof valor !== 'object') return valor;
    if (Array.isArray(valor)) return valor.map(clonar);
    var copia = {};
    Object.keys(valor).forEach(function (chave) { copia[chave] = clonar(valor[chave]); });
    return copia;
  }

  function normalizar(valor) {
    return String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }

  function reconciliarBase(registro, notaLocal, notaConfirmada, igual) {
    var resultado = { registro: clonar(registro), atualizou: false };
    if (!registro || !registro.savedNote || !notaLocal || !notaConfirmada || typeof igual !== 'function') return resultado;
    if (!igual(registro.savedNote, notaLocal) || !igual(registro.savedNote, notaConfirmada)) return resultado;
    if (registro.baseNota && igual(registro.baseNota, registro.savedNote)) return resultado;
    resultado.registro.baseNota = clonar(registro.savedNote);
    resultado.atualizou = true;
    return resultado;
  }

  function candidatas(notas, identidade) {
    identidade = identidade || {};
    var nf = normalizar(identidade.nf), fornecedor = normalizar(identidade.fornecedor), data = normalizar(identidade.data);
    if (!nf || !fornecedor || !Array.isArray(notas)) return [];
    return notas.filter(function (nota) {
      if (!nota || normalizar(nota.tipoRegistro) === 'despesa' || !Array.isArray(nota.itens) || !nota.itens.length) return false;
      if (identidade.id != null && String(nota.id) === String(identidade.id)) return false;
      return normalizar(nota.nf) === nf && normalizar(nota.fornecedor) === fornecedor && (!data || normalizar(nota.data) === data);
    });
  }

  function itensSemAplicacao(itens) {
    return (Array.isArray(itens) ? itens : []).map(function (item) {
      var copia = clonar(item);
      if (copia && typeof copia === 'object') {
        delete copia.aplicado;
        delete copia._indiceOriginalNota;
        delete copia.preservarSaldoContado;
      }
      return copia;
    });
  }

  function ehCompraNovaRascunho(registro, igual) {
    if (!registro) return false;
    if (registro.operacao === 'nova') return true;
    if (registro.operacao === 'editar') return false;
    if (registro.editId == null) return true;
    return !!(registro.savedRecordId != null && String(registro.savedRecordId) === String(registro.editId)
      && registro.baseNota && registro.savedNote && typeof igual === 'function'
      && igual(registro.baseNota, registro.savedNote));
  }

  function rascunhoConfirmadoSemEdicao(registro, notaServidor, igual) {
    return !!(registro && registro.savedRecordId != null && registro.savedNote && notaServidor
      && String(registro.savedRecordId) === String(notaServidor.id)
      && registro.syncSubmittedAt && registro.syncSubmittedAt === registro.updatedAt
      && typeof igual === 'function' && igual(registro.savedNote, notaServidor));
  }

  function prepararComoNovaCompra(registro) {
    var copia = clonar(registro || {});
    ['savedRecordId', 'savedSession', 'savedNote', 'syncSubmittedAt', 'syncPendente', 'baseNota', 'notaServidorAntesDaRevisao']
      .forEach(function (chave) { delete copia[chave]; });
    copia.editId = null;
    copia.operacao = 'nova';
    copia.temRascunho = true;
    copia.retomarAoVoltar = true;
    return copia;
  }

  function tipoItem(item) {
    var vinc = String(item.vinc || item.aplicado && item.aplicado.vinc || '');
    if (vinc.indexOf('ing:') === 0) return 'ing';
    if (vinc.indexOf('pao:') === 0) return 'pao';
    if (vinc.indexOf('prod:') === 0) return 'prod';
    return item.tipoItem === 'ing' || item.tipoItem === 'pao' ? item.tipoItem : 'prod';
  }

  function identidadeItem(item) {
    if (!item || typeof item !== 'object') return null;
    return JSON.stringify([
      String(item.vinc || item.aplicado && item.aplicado.vinc || '').trim(),
      tipoItem(item), normalizar(item.nomeBase || item.nome), normalizar(item.marca)
    ]);
  }

  function snapshotHistorico(valor) {
    if (!valor || typeof valor !== 'object') return valor;
    if (Array.isArray(valor)) return valor.map(snapshotHistorico);
    var copia = {};
    Object.keys(valor).sort().forEach(function (chave) {
      if (chave !== '_indiceOriginalNota' && chave !== 'preservarSaldoContado') copia[chave] = snapshotHistorico(valor[chave]);
    });
    return copia;
  }

  function erroHistorico() {
    var erro = new Error('Não foi possível relacionar com segurança os itens antigos à nota atual. O rascunho foi preservado; confira os itens antes de atualizar.');
    erro.code = 'RASCUNHO_COMPRA_HISTORICO_INSEGURO';
    return erro;
  }

  function remapearIndices(itens, anteriores, atuais, preparados) {
    var usados = new Set();
    function indices(lista, chave) {
      var encontrados = [];
      lista.forEach(function (item, indice) { if (identidadeItem(item) === chave) encontrados.push(indice); });
      return encontrados;
    }
    itens.forEach(function (item, indice) {
      if (!item || typeof item !== 'object') return;
      if (item._indiceOriginalNota == null) {
        var aplicado = item.aplicado;
        if (tipoItem(item) === 'ing' && (item.preservarSaldoContado || aplicado && (aplicado.semEstoque || aplicado.preservadoPorContagem || aplicado.contagemEstoqueId != null))) throw erroHistorico();
        return;
      }
      var origem = Number(item._indiceOriginalNota);
      if (!Number.isInteger(origem) || origem < 0 || origem >= anteriores.length || !anteriores[origem]) throw erroHistorico();
      // The draft's name/brand/quantity may already have been edited. Locate the
      // original row from its old base, then find that row in the fresh note.
      var chave = identidadeItem(anteriores[origem]);
      var antigas = indices(anteriores, chave), novas = indices(atuais, chave), destino;
      if (antigas.length === 1 && novas.length === 1) destino = novas[0];
      else {
        // Repeated identities need equivalent historical snapshots. Equal
        // occurrences retain their order only when both counts still agree.
        var snapshot = JSON.stringify(snapshotHistorico(anteriores[origem]));
        antigas = antigas.filter(function (i) { return JSON.stringify(snapshotHistorico(anteriores[i])) === snapshot; });
        novas = novas.filter(function (i) { return JSON.stringify(snapshotHistorico(atuais[i])) === snapshot; });
        if (!novas.length || antigas.length !== novas.length) throw erroHistorico();
        destino = novas[antigas.indexOf(origem)];
      }
      if (destino == null || usados.has(destino)) throw erroHistorico();
      usados.add(destino);
      preparados[indice]._indiceOriginalNota = destino;
    });
  }

  function prepararRegistro(registro, opcoes) {
    var copia = clonar(registro || {});
    opcoes = opcoes || {};
    delete copia.savedRecordId;
    delete copia.savedSession;
    delete copia.savedNote;
    delete copia.syncSubmittedAt;
    delete copia.syncPendente;
    copia.editId = opcoes.editId == null ? null : opcoes.editId;
    copia.baseNota = opcoes.baseNota == null ? null : clonar(opcoes.baseNota);
    copia.itens = itensSemAplicacao(copia.itens);
    if (copia.editId != null) remapearIndices(
      registro && Array.isArray(registro.itens) ? registro.itens : [],
      registro && registro.baseNota && Array.isArray(registro.baseNota.itens) ? registro.baseNota.itens : [],
      copia.baseNota && Array.isArray(copia.baseNota.itens) ? copia.baseNota.itens : [],
      copia.itens
    );
    copia.temRascunho = true;
    copia.retomarAoVoltar = true;
    return copia;
  }

  return {
    reconciliarBase: reconciliarBase,
    candidatas: candidatas,
    itensSemAplicacao: itensSemAplicacao,
    prepararRegistro: prepararRegistro,
    ehCompraNovaRascunho: ehCompraNovaRascunho,
    rascunhoConfirmadoSemEdicao: rascunhoConfirmadoSemEdicao,
    prepararComoNovaCompra: prepararComoNovaCompra
  };
});
