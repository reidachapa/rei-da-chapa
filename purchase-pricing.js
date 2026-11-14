/*
 * Pure purchase pricing projection. calcular({itens, produtos, notaAnterior,
 * descontoNota, descontoNotaTipo}) returns {porIndice, grupos}; each product
 * group supplies indices, produtoId, projected custoMedio/estoque, modoPreco,
 * lucroPct and preco. Non-product/incomplete lines map to null in porIndice.
 * Inputs are never changed. Discounts are allocated across all valid note
 * lines; old stock applications are reversed on copies before projection.
 * Explicit pricing modes take precedence over legacy fields. The last explicit
 * choice in a group wins; otherwise lucroPct selects percentage pricing, then
 * pv selects manual pricing. A null price means preserve the catalog price.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrecosCompra = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function numero(valor) { return Number(valor) || 0; }
  function finito(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    var n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  function nomeNormalizado(nome) {
    return String(nome || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }
  function bruto(it) { return Math.max(0, numero(it.qtd) * numero(it.valor)); }
  function descontoItem(it, original) {
    var total = bruto(it);
    var desconto = Math.max(0, numero(original && it.descontoOriginal !== undefined ? it.descontoOriginal : it.desconto));
    if (it.descontoTipo === 'percent') desconto = total * Math.min(100, desconto) / 100;
    return Math.min(total, desconto);
  }
  function itemValido(it) { return !!(it && String(it.nome || '').trim() && numero(it.qtd) > 0); }

  // Keep the product branch equivalent to reverterCompraEstoque, including its
  // fallback for legacy notes without an aplicado snapshot.
  function reverterNota(nota, produtosPorId) {
    var lista = nota && Array.isArray(nota.itens) ? nota.itens : [];
    var ehCompra = !!(nota && nota.tipoRegistro !== 'despesa' && lista.length);
    var subtotal = lista.reduce(function (s, it) { return s + bruto(it) - descontoItem(it, true); }, 0);
    lista.forEach(function (it) {
      if (!it) return;
      var ap = it.aplicado;
      if (!ap && !ehCompra) return;
      var vinc = String(ap && ap.vinc || it.vinc || '');
      if (vinc.indexOf('prod:') !== 0) return;
      var produto = produtosPorId.get(vinc.slice(5));
      if (!produto) return;
      var quantidade = ap ? numero(ap.qtdEst) : numero(it.qtd);
      if (!(quantidade > 0)) return;
      var semEstoque = !!(ap && ap.semEstoque);
      var saldoBruto = semEstoque ? produto.estoqueEstimado : produto.estoque;
      if (semEstoque && (saldoBruto === null || saldoBruto === undefined || saldoBruto === '')) return;
      var qtdAtual = Number(saldoBruto), custoAtual = numero(produto.custo);
      var custoUnitario = ap && ap.custoUnitario !== null && ap.custoUnitario !== undefined ? Number(ap.custoUnitario) : NaN;
      if (!Number.isFinite(custoUnitario)) {
        var total = bruto(it), desconto = descontoItem(it, true);
        if (it.descontoOriginal !== undefined && subtotal > 0) desconto += Math.max(0, numero(nota.desconto)) * (total - desconto) / subtotal;
        custoUnitario = Math.max(0, total - desconto) / quantidade;
      }
      if (semEstoque) {
        if (ap && ap.saldoAntes == null && Number.isFinite(qtdAtual) && Math.abs(qtdAtual - quantidade) < 0.000001) produto.estoqueEstimado = null;
        else if (Number.isFinite(qtdAtual)) produto.estoqueEstimado = Math.max(0, qtdAtual - quantidade);
      } else produto.estoque = numero(produto.estoque) - quantidade;
      if (Number.isFinite(custoUnitario) && Number.isFinite(qtdAtual)) {
        var restante = semEstoque ? Number(produto.estoqueEstimado) : Number(produto.estoque);
        produto.custo = restante > 0 ? Math.max(0, (qtdAtual * custoAtual - quantidade * custoUnitario) / restante) : ap ? numero(ap.custoAntes) : 0;
      } else if (ap) produto.custo = ap.custoAntes;
    });
  }

  function escolhaPreco(linhas) {
    var explicita = null, percentual = null, manual = null;
    linhas.forEach(function (it) {
      if (it.modoPreco === 'percentual' || it.modoPreco === 'manual') explicita = it;
      if (finito(it.lucroPct) !== null) percentual = it;
      if (finito(it.pv) !== null && Number(it.pv) > 0) manual = it;
    });
    if (explicita) return { modo: explicita.modoPreco, item: explicita };
    if (percentual) return { modo: 'percentual', item: percentual };
    if (manual) return { modo: 'manual', item: manual };
    return { modo: null, item: null };
  }

  function calcular(entrada) {
    entrada = entrada || {};
    var itens = Array.isArray(entrada.itens) ? entrada.itens : [];
    var catalogo = Array.isArray(entrada.produtos) ? entrada.produtos : [];
    var produtosPorId = new Map(), produtosPorNome = new Map();
    catalogo.forEach(function (p) {
      if (!p || p.id == null) return;
      var copia = Object.assign({}, p), id = String(p.id), nome = nomeNormalizado(p.nome);
      produtosPorId.set(id, copia);
      if (nome && !produtosPorNome.has(nome)) produtosPorNome.set(nome, copia);
    });
    reverterNota(entrada.notaAnterior, produtosPorId);
    var validos = itens.filter(itemValido);
    var subtotal = validos.reduce(function (s, it) { return s + bruto(it) - descontoItem(it); }, 0);
    var descontoNota = numero(entrada.descontoNota);
    if (entrada.descontoNotaTipo === 'percent') descontoNota = subtotal * Math.min(100, descontoNota) / 100;
    descontoNota = Math.min(subtotal, Math.max(0, descontoNota));
    var grupos = [], porIndice = itens.map(function () { return null; }), porChave = new Map();

    itens.forEach(function (it, indice) {
      if (!itemValido(it)) return;
      var vinc = String(it.vinc || ''), vincProduto = vinc.indexOf('prod:') === 0 ? produtosPorId.get(vinc.slice(5)) : null;
      var tipo = vinc.indexOf('ing:') === 0 ? 'ing' : vinc.indexOf('pao:') === 0 ? 'pao' : it.tipoItem === 'ing' || it.tipoItem === 'pao' ? it.tipoItem : 'prod';
      if (vincProduto) tipo = 'prod';
      if (tipo !== 'prod') return;
      var nome = nomeNormalizado(it.nome), produto = vincProduto || produtosPorNome.get(nome);
      var chave = produto ? 'id:' + String(produto.id) : 'nome:' + nome;
      var grupo = porChave.get(chave);
      if (!grupo) {
        grupo = { indices: [], produtoId: produto ? String(produto.id) : null, custoMedio: produto ? numero(produto.custo) : 0, estoque: produto ? numero(produto.estoque) : 0, modoPreco: null, lucroPct: null, preco: null };
        porChave.set(chave, grupo);
        grupos.push(grupo);
      }
      var base = bruto(it) - descontoItem(it);
      var liquido = Math.max(0, base - (subtotal > 0 ? descontoNota * base / subtotal : 0));
      var qtd = numero(it.qtd), saldo = grupo.estoque, custo = grupo.custoMedio, novoSaldo = saldo + qtd;
      grupo.custoMedio = novoSaldo > 0 ? (saldo * custo + liquido) / novoSaldo : liquido / qtd;
      grupo.estoque = novoSaldo;
      grupo.indices.push(indice);
      porIndice[indice] = grupo;
    });

    grupos.forEach(function (grupo) {
      var escolha = escolhaPreco(grupo.indices.map(function (i) { return itens[i]; }));
      grupo.modoPreco = escolha.modo;
      if (!escolha.item) return;
      if (escolha.modo === 'percentual') {
        grupo.lucroPct = finito(escolha.item.lucroPct);
        if (grupo.lucroPct !== null) grupo.preco = Math.round((Math.max(0, grupo.custoMedio * (1 + grupo.lucroPct / 100)) + Number.EPSILON) * 100) / 100;
      } else {
        var manual = finito(escolha.item.pv);
        if (manual !== null) {
          grupo.preco = Math.round((Math.max(0, manual) + Number.EPSILON) * 100) / 100;
          grupo.lucroPct = grupo.custoMedio > 0 ? (grupo.preco / grupo.custoMedio - 1) * 100 : null;
        }
      }
    });
    return { porIndice: porIndice, grupos: grupos };
  }

  return { calcular: calcular };
});
