/* Content-based purchase duplicate checks. Technical persistence/catalog fields
 * do not identify an invoice. Inputs are read only; old duplicates are not
 * removed and do not block unrelated saves.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ComprasDuplicadas = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function texto(valor) {
    return String(valor == null ? '' : valor).trim().normalize('NFC')
      .replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  }

  function numero(valor) {
    var n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }

  function preciso(valor) { return Math.round((valor + Number.EPSILON) * 1e8) / 1e8; }

  function tipo(item) {
    if (item.tipoItem === 'despesa') return 'despesa';
    var vinc = String(item.vinc || item.aplicado && item.aplicado.vinc || '');
    if (vinc.indexOf('ing:') === 0) return 'ing';
    if (vinc.indexOf('pao:') === 0) return 'pao';
    if (vinc.indexOf('prod:') === 0) return 'prod';
    return item.tipoItem === 'ing' || item.tipoItem === 'pao' ? item.tipoItem : 'prod';
  }

  function descontoItem(item, bruto) {
    var valor = Math.max(0, numero(item.descontoOriginal !== undefined ? item.descontoOriginal : item.desconto));
    if (item.descontoTipo === 'percent') valor = bruto * Math.min(100, valor) / 100;
    return Math.min(bruto, valor);
  }

  function assinatura(nota) {
    if (!nota || nota.tipoRegistro === 'despesa' || !Array.isArray(nota.itens)) return null;
    var itens = nota.itens.filter(function (item) { return item && texto(item.nome) && numero(item.qtd) > 0; });
    if (!itens.length) return null;
    var subtotal = 0;
    var linhas = itens.map(function (item) {
      var quantidade = numero(item.qtd), custo = numero(item.valor);
      var bruto = Math.max(0, quantidade * custo), desconto = descontoItem(item, bruto);
      var tipoLinha = tipo(item);
      subtotal += bruto - desconto;
      return JSON.stringify([
        texto(item.nome), texto(tipoLinha === 'despesa' ? '' : item.marca), tipoLinha, texto(item.unid || 'un'),
        preciso(quantidade), preciso(custo), preciso(desconto)
      ]);
    }).sort();
    // Stored desconto is already the effective invoice discount. Only the
    // explicit original input is interpreted using descontoTipo again.
    var desconto = Math.max(0, numero(nota.descontoOriginal !== undefined ? nota.descontoOriginal : nota.desconto));
    if (nota.descontoOriginal !== undefined && nota.descontoTipo === 'percent') desconto = subtotal * Math.min(100, desconto) / 100;
    desconto = Math.min(subtotal, desconto);
    return JSON.stringify([
      texto(nota.data), texto(nota.fornecedor), texto(nota.nf), linhas,
      preciso(desconto), preciso(Math.max(0, subtotal - desconto))
    ]);
  }

  function encontrar(notas, candidata, ignorarId) {
    var chave = assinatura(candidata);
    if (!chave || !Array.isArray(notas)) return null;
    return notas.find(function (nota) {
      if (!nota || nota === candidata || ignorarId != null && String(nota.id) === String(ignorarId)) return false;
      return assinatura(nota) === chave;
    }) || null;
  }

  function validarEstado(base, candidato) {
    var lojasBase = base && base.porLoja || {}, lojas = candidato && candidato.porLoja || {};
    Object.keys(lojas).forEach(function (lojaId) {
      var anteriores = new Map();
      var notasBase = lojasBase[lojaId] && lojasBase[lojaId].despesas;
      (Array.isArray(notasBase) ? notasBase : []).forEach(function (nota) { if (nota && nota.id != null) anteriores.set(String(nota.id), nota); });
      var notas = lojas[lojaId] && lojas[lojaId].despesas;
      if (!Array.isArray(notas)) return;
      notas.forEach(function (nota) {
        var chave = assinatura(nota);
        if (!chave) return;
        var anterior = nota.id != null && anteriores.get(String(nota.id));
        if (anterior && assinatura(anterior) === chave) return;
        var existente = encontrar(notas, nota, nota.id);
        if (!existente) return;
        var erro = new Error('Esta compra já foi lançada: ' + (existente.fornecedor || 'sem fornecedor') + ', NF ' + (existente.nf || 'sem número') + ', ' + (existente.data || 'sem data') + '. Nenhuma nova compra foi gravada.');
        erro.code = 'COMPRA_DUPLICADA';
        erro.notaExistente = existente;
        erro.lojaId = lojaId;
        throw erro;
      });
    });
    return true;
  }

  return { assinatura: assinatura, encontrar: encontrar, validarEstado: validarEstado };
});
