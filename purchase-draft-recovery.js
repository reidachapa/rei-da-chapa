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
    if (!registro || registro.savedRecordId == null || !registro.savedNote || !notaServidor) return false;
    var id = String(notaServidor.id);
    var ehNotaCompra = function (nota) {
      return !!(nota && nota.tipoRegistro !== 'despesa' && Array.isArray(nota.itens) && nota.itens.length);
    };
    if (!ehNotaCompra(registro.savedNote) || !ehNotaCompra(notaServidor)
      || String(registro.savedRecordId) !== id
      || String(registro.savedNote.id) !== id
      || !registro.syncSubmittedAt || registro.syncSubmittedAt !== registro.updatedAt) return false;
    // Only the full purchase comparison may confirm an already-linked draft.
    // The invoice signature intentionally omits fields, so it is insufficient here.
    return typeof igual === 'function' && !!igual(registro.savedNote, notaServidor);
  }

  function valorMoedaRascunho(valor) {
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
    var texto = String(valor == null ? '' : valor).trim().replace(/[^\d,.-]/g, '');
    if (!texto) return 0;
    if (texto.indexOf(',') >= 0) texto = texto.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, '');
    var numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
  }

  function rascunhoCorrespondeACompraSalva(registro, notas, assinatura) {
    if (!registro || !Array.isArray(notas) || typeof assinatura !== 'function'
      || registro.savedRecordId != null || registro.editId != null || registro.operacao === 'editar'
      || registro.operacao && registro.operacao !== 'nova') return false;
    var campos = registro.campos || {};
    var nf = String(campos.despNF || '').trim();
    var fornecedor = String(campos.despFornecedor || '').trim();
    var data = String(campos.despData || '').trim();
    if (!nf || !fornecedor || !data || !Array.isArray(registro.itens) || !registro.itens.length) return false;
    var desconto = valorMoedaRascunho(campos.despDesconto);
    if (desconto == null) return false;
    var candidata = {
      tipoRegistro: 'compra', data: data, nf: nf, fornecedor: fornecedor,
      descontoOriginal: desconto,
      descontoTipo: registro.descontoTipo === 'percent' ? 'percent' : 'valor',
      itens: registro.itens
    };
    var chave = assinatura(candidata);
    if (!chave) return false;
    function texto(valor) {
      // A legacy draft is removed only on exact business text; normalize spacing
      // and Unicode composition, but preserve case and accents to avoid false matches.
      return String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ').normalize('NFC');
    }
    function mesmoNumero(a, b) {
      var x = valorMoedaRascunho(a), y = valorMoedaRascunho(b);
      return x != null && y != null && Math.abs(x - y) <= 1e-8;
    }
    function extrasItem(item) {
      item = item || {};
      var tipoItem = tipoItemRascunho(item);
      return JSON.stringify({
        nome: texto(item.nome),
        nomeBase: texto(item.nomeBase || item.nome),
        marca: texto(item.marca),
        tipoItem: tipoItem,
        unidade: texto(item.unid || 'un'),
        categoria: texto(item.categoria || (tipoItem === 'prod' ? 'Produtos' : tipoItem === 'ing' ? 'outro' : '')),
        categoriaNome: texto(item.categoriaNome || item.categoria),
        precoVenda: valorMoedaRascunho(item.pv),
        lucroPct: valorMoedaRascunho(item.lucroPct),
        modoPreco: texto(item.modoPreco),
        modoCompra: texto(item.modoCompra),
        rendimento: valorMoedaRascunho(item.rend),
        unidadeEstoque: texto(item.unidadeEstoque),
        descontoOriginal: valorMoedaRascunho(item.descontoOriginal !== undefined ? item.descontoOriginal : item.desconto),
        descontoTipo: texto(item.descontoTipo || 'valor'),
        controlaEstoque: item.controlaEstoque,
        rendimentoInformado: item.rendimentoInformado
      });
    }
    function tipoItemRascunho(item) {
      var vinc = String(item.vinc || item.aplicado && item.aplicado.vinc || '');
      if (vinc.indexOf('ing:') === 0) return 'ing';
      if (vinc.indexOf('pao:') === 0) return 'pao';
      if (vinc.indexOf('prod:') === 0) return 'prod';
      return item.tipoItem === 'ing' || item.tipoItem === 'pao' ? item.tipoItem : 'prod';
    }
    function camposDoRascunhoIguais(nota) {
      if (!nota || !Array.isArray(nota.itens) || nota.itens.length !== registro.itens.length) return false;
      var subcategoria = String(campos.despSubcategoria || '').trim();
      var descontoNota = valorMoedaRascunho(nota.descontoOriginal !== undefined ? nota.descontoOriginal : nota.desconto);
      var subtotal = registro.itens.reduce(function (total, item) {
        var bruto = Math.max(0, (valorMoedaRascunho(item && item.qtd) || 0) * (valorMoedaRascunho(item && item.valor) || 0));
        var itemDesconto = Math.max(0, valorMoedaRascunho(item && (item.descontoOriginal !== undefined ? item.descontoOriginal : item.desconto)) || 0);
        if (item && item.descontoTipo === 'percent') itemDesconto = bruto * Math.min(100, itemDesconto) / 100;
        return total + Math.max(0, bruto - Math.min(bruto, itemDesconto));
      }, 0);
      var descontoEfetivo = registro.descontoTipo === 'percent' ? subtotal * Math.min(100, desconto) / 100 : desconto;
      var totalCalculado = Math.max(0, subtotal - Math.min(subtotal, descontoEfetivo));
      var categoriaNome = campos.despCategoriaNome || campos.despCategoria;
      if (texto(nota.nf) !== texto(nf)
        || texto(nota.fornecedor) !== texto(fornecedor)
        || texto(nota.data) !== texto(data)
        || texto(nota.categoria) !== texto(campos.despCategoria)
        || texto(nota.categoriaNome || nota.categoria) !== texto(categoriaNome)
        || texto(nota.subcategoria) !== texto(subcategoria)
        || texto(nota.descricao) !== texto(subcategoria || 'Compra')
        || texto(nota.status) !== texto(campos.despStatus)
        || texto(nota.obs) !== texto(campos.despObs)
        || texto(nota.descontoTipo || 'valor') !== texto(registro.descontoTipo || 'valor')
        || !mesmoNumero(descontoNota, desconto)
        || !mesmoNumero(nota.valor, totalCalculado)) return false;
      var extrasRascunho = registro.itens.map(extrasItem).sort();
      var extrasNota = nota.itens.map(extrasItem).sort();
      return extrasRascunho.every(function (valor, indice) { return valor === extrasNota[indice]; });
    }
    return notas.some(function (nota) {
      return !!nota && assinatura(nota) === chave && camposDoRascunhoIguais(nota);
    });
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

  async function excluirRascunhoServidorSeIgual(cliente, id, envelope) {
    if (!cliente || typeof cliente.from !== 'function' || !id || !envelope) throw new Error('Não foi possível verificar o rascunho antes de removê-lo.');
    var resposta = await cliente.from('estado')
      .delete()
      .eq('id', id)
      .filter('dados', 'eq', JSON.stringify(envelope))
      .select('id')
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    return !!(resposta.data && String(resposta.data.id) === String(id));
  }

  return {
    reconciliarBase: reconciliarBase,
    candidatas: candidatas,
    itensSemAplicacao: itensSemAplicacao,
    prepararRegistro: prepararRegistro,
    ehCompraNovaRascunho: ehCompraNovaRascunho,
    rascunhoConfirmadoSemEdicao: rascunhoConfirmadoSemEdicao,
    rascunhoCorrespondeACompraSalva: rascunhoCorrespondeACompraSalva,
    excluirRascunhoServidorSeIgual: excluirRascunhoServidorSeIgual,
    prepararComoNovaCompra: prepararComoNovaCompra
  };
});
