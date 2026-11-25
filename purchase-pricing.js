/*
 * Pure purchase pricing projection. calcular({itens, produtos, ingredientes,
 * paes, notaAnterior, descontoNota, descontoNotaTipo,
 * quantidadesEstoquePorIndice, incluirRascunhosSemNome}) returns {porIndice,
 * grupos}. Product, ingredient and bread catalogs remain isolated by type.
 * Inputs are never changed. Discounts are allocated across all valid lines;
 * old stock applications are reversed on copies before projection.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrecosCompra = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function numero(valor) { return Number(valor) || 0; }
  function normalizarPercentualDigitado(valor) {
    var texto = String(valor == null ? '' : valor).replace(/[^\d.,]/g, '').replace(/\./g, ',');
    var separador = texto.indexOf(',');
    if (separador >= 0) texto = texto.slice(0, separador + 1) + texto.slice(separador + 1).replace(/,/g, '');
    return texto;
  }
  function lerPercentualNota(valor) {
    var texto = normalizarPercentualDigitado(valor).replace(',', '.');
    var n = texto ? Number(texto) : 0;
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
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
  function somarDescontosItens(itens) {
    return (Array.isArray(itens) ? itens : []).reduce(function (s, it) { return s + descontoItem(it); }, 0);
  }

  function separarValoresDaCompra(nota) {
    if (!nota || nota.tipoRegistro === 'despesa' || !Array.isArray(nota.itens)) return null;
    var despesas = [];
    var bases = nota.itens.map(function (item, indice) {
      if (!item) return 0;
      if (item.tipoItem === 'despesa') despesas.push({ indice: indice, valorCentavos: 0 });
      return bruto(item) - descontoItem(item, true);
    });
    if (!despesas.length) return null;
    var subtotal = bases.reduce(function (s, base) { return s + base; }, 0);
    var valor = finito(nota.valor);
    if (valor === null) valor = subtotal - Math.max(0, numero(nota.desconto));
    var totalCentavos = Math.round((Math.max(0, valor) + Number.EPSILON) * 100);
    var baseAcumulada = 0, centavosDistribuidos = 0;
    // Distribuir o líquido salvo por peso, arredondando no acumulado, fecha no total da nota.
    var centavosPorIndice = bases.map(function (base) {
      baseAcumulada += base;
      var novoTotal = subtotal > 0 ? Math.round(totalCentavos * baseAcumulada / subtotal) : 0;
      var centavos = novoTotal - centavosDistribuidos;
      centavosDistribuidos = novoTotal;
      return centavos;
    });
    var estoqueCentavos = totalCentavos;
    despesas.forEach(function (despesa) {
      despesa.valorCentavos = centavosPorIndice[despesa.indice];
      estoqueCentavos -= despesa.valorCentavos;
    });
    return { estoqueCentavos: estoqueCentavos, despesas: despesas };
  }

  function itemValido(it, incluirSemNome) { return !!(it && (String(it.nome || '').trim() || incluirSemNome) && numero(it.qtd) > 0); }
  function tipoVinculo(vinc) {
    var prefixo = String(vinc || '').split(':')[0];
    return prefixo === 'ing' || prefixo === 'pao' || prefixo === 'prod' ? prefixo : '';
  }
  function tipoItem(it) {
    var vinculado = tipoVinculo(it && it.vinc);
    return vinculado || (it && (it.tipoItem === 'ing' || it.tipoItem === 'pao') ? it.tipoItem : 'prod');
  }
  function unidadeMedida(valor) {
    var unidade = String(valor || '').trim().toLocaleLowerCase('pt-BR').replace(/\./g, '');
    if (/^(mg|miligramas?)$/.test(unidade)) return 'mg';
    if (/^(quilos?|kilos?|quilogramas?)$/.test(unidade)) return 'kg';
    if (/^(gr|grama|gramas)$/.test(unidade)) return 'g';
    if (/^(ml|mililitros?)$/.test(unidade)) return 'ml';
    if (/^(lt|litro|litros)$/.test(unidade)) return 'l';
    return unidade;
  }
  function gramasPorUnidadeCompra(unidade) {
    var medida = unidadeMedida(unidade);
    if (medida === 'kg') return 1000;
    if (medida === 'g') return 1;
    if (medida === 'mg') return 0.001;
    return 0;
  }
  function rendimentoPorGramas(gramasPorUnidade, unidadeCompra) {
    var tipo = typeof gramasPorUnidade;
    if (tipo !== 'number' && tipo !== 'string') return 0;
    var gramas = Number(String(gramasPorUnidade).trim().replace(',', '.'));
    if (!Number.isFinite(gramas) || gramas <= 0) return 0;
    var rendimento = gramasPorUnidadeCompra(unidadeCompra) / gramas;
    return Number.isFinite(rendimento) ? rendimento : 0;
  }
  function quantidadesEquivalentes(a, b) {
    return Number.isFinite(a) && Number.isFinite(b) &&
      Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  function podeContarIngredientePorUnidades(ingrediente, notas) {
    if (!ingrediente) return true;
    if (ingrediente.consumoMedia) return false;
    var usaRendimento = ingrediente.modoCompra === 'flexivel' && finito(ingrediente.rendimento) > 0;
    var unidadeEstoque = unidadeMedida(ingrediente.unidadeEstoque || (usaRendimento ? 'un' : ingrediente.unidade));
    if (!/^(mg|g|kg|ml|l)$/.test(unidadeEstoque)) return true;
    if (!usaRendimento || ingrediente.contagemEstoqueId ||
        Array.isArray(ingrediente.contagensEstoque) && ingrediente.contagensEstoque.length) return false;

    var saldo = finito(ingrediente.semEstoque ? ingrediente.estoqueEstimado : ingrediente.estoque);
    if (saldo === null || saldo < 0 || ingrediente.id == null) return false;
    var vinculo = 'ing:' + String(ingrediente.id);
    var quantidadeConfirmada = 0;
    for (var nota of Array.isArray(notas) ? notas : []) {
      if (!nota || nota.tipoRegistro === 'despesa' || !Array.isArray(nota.itens)) continue;
      for (var item of nota.itens) {
        if (!item || item.tipoItem === 'despesa') continue;
        var aplicado = item.aplicado;
        if (item.vinc !== vinculo && (!aplicado || aplicado.vinc !== vinculo)) continue;
        var rendimento = finito(item.rend);
        var quantidade = finito(item.qtd);
        var quantidadeAplicada = aplicado && finito(aplicado.qtdEst);
        if (!aplicado || aplicado.vinc !== vinculo || aplicado.preservadoPorContagem ||
            Boolean(aplicado.semEstoque) !== Boolean(ingrediente.semEstoque) ||
            item.modoCompra && item.modoCompra !== 'flexivel' ||
            !gramasPorUnidadeCompra(item.unid || ingrediente.unidade) ||
            !(rendimento > 0 && quantidade > 0 && quantidadeAplicada > 0) ||
            !quantidadesEquivalentes(quantidadeAplicada, quantidade * rendimento)) return false;
        quantidadeConfirmada += quantidadeAplicada;
      }
    }

    // O saldo pode ser menor que as entradas se a loja já vendeu unidades.
    return Number.isFinite(quantidadeConfirmada) && quantidadeConfirmada > 0 &&
      (saldo <= quantidadeConfirmada || quantidadesEquivalentes(saldo, quantidadeConfirmada));
  }
  function converterQuantidade(qtd, origem, destino) {
    var n = numero(qtd), a = unidadeMedida(origem), b = unidadeMedida(destino);
    var massa = { mg: 0.001, g: 1, kg: 1000 }, volume = { ml: 1, l: 1000 };
    if (a === b) return n;
    if (a in massa && b in massa) return n * massa[a] / massa[b];
    if (a in volume && b in volume) return n * volume[a] / volume[b];
    return n;
  }
  function quantidadeEstoqueLegada(item, catalogo, tipo) {
    var quantidade = numero(item.qtd);
    if (tipo !== 'ing' || catalogo.modoCompra !== 'flexivel') return quantidade;
    if (numero(item.rend) > 0) return quantidade * numero(item.rend);
    var unidadeCompra = item.unid || catalogo.unidade || 'kg';
    var unidadeEstoque = catalogo.unidadeEstoque || item.unidadeEstoque || unidadeCompra;
    if (!/^(mg|g|kg|ml|l)$/.test(unidadeMedida(unidadeEstoque))) unidadeEstoque = unidadeCompra;
    return converterQuantidade(quantidade, unidadeCompra, unidadeEstoque);
  }

  // Reverse the edited note on cloned catalog rows before projecting the new values.
  function reverterNota(nota, porTipoId) {
    var lista = nota && Array.isArray(nota.itens) ? nota.itens : [];
    var ehCompra = !!(nota && nota.tipoRegistro !== 'despesa' && lista.length);
    var subtotal = lista.reduce(function (s, it) { return it ? s + bruto(it) - descontoItem(it, true) : s; }, 0);
    lista.forEach(function (it) {
      if (!it || it.tipoItem === 'despesa') return;
      var ap = it.aplicado;
      if (ap && ap.preservadoPorContagem) return;
      if (!ap && !ehCompra) return;
      var vinc = String(ap && ap.vinc || it.vinc || ''), tipo = tipoVinculo(vinc);
      if (!tipo) return;
      var catalogo = porTipoId[tipo].get(vinc.slice(tipo.length + 1));
      if (!catalogo) return;
      var quantidade = ap ? numero(ap.qtdEst) : quantidadeEstoqueLegada(it, catalogo, tipo);
      if (!(quantidade > 0)) return;
      var semEstoque = tipo === 'ing' && !!(ap ? ap.semEstoque : catalogo.semEstoque);
      if (semEstoque && catalogo.contagemEstoqueId && String(ap && ap.contagemEstoqueId || '') !== String(catalogo.contagemEstoqueId)) return;
      var saldoBruto = semEstoque ? catalogo.estoqueEstimado : catalogo.estoque;
      if (semEstoque && (saldoBruto === null || saldoBruto === undefined || saldoBruto === '')) return;
      var qtdAtual = Number(saldoBruto), custoAtual = numero(catalogo.custo);
      var custoUnitario = ap && ap.custoUnitario !== null && ap.custoUnitario !== undefined ? Number(ap.custoUnitario) : NaN;
      if (!Number.isFinite(custoUnitario)) {
        var total = bruto(it), desconto = descontoItem(it, true);
        if (it.descontoOriginal !== undefined && subtotal > 0) desconto += Math.max(0, numero(nota.desconto)) * (total - desconto) / subtotal;
        custoUnitario = Math.max(0, total - desconto) / quantidade;
      }
      if (semEstoque) {
        if (ap && ap.saldoAntes == null && Number.isFinite(qtdAtual) && Math.abs(qtdAtual - quantidade) < 0.000001) catalogo.estoqueEstimado = null;
        else if (Number.isFinite(qtdAtual)) catalogo.estoqueEstimado = Math.max(0, qtdAtual - quantidade);
      } else catalogo.estoque = numero(catalogo.estoque) - quantidade;
      if (Number.isFinite(custoUnitario) && Number.isFinite(qtdAtual)) {
        var restante = semEstoque ? Number(catalogo.estoqueEstimado) : Number(catalogo.estoque);
        catalogo.custo = restante > 0 ? Math.max(0, (qtdAtual * custoAtual - quantidade * custoUnitario) / restante) : ap ? numero(ap.custoAntes) : 0;
      } else if (ap) catalogo.custo = ap.custoAntes;
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
    var incluirSemNome = entrada.incluirRascunhosSemNome === true;
    var itens = Array.isArray(entrada.itens) ? entrada.itens : [];
    var catalogos = {
      prod: Array.isArray(entrada.produtos) ? entrada.produtos : [],
      ing: Array.isArray(entrada.ingredientes) ? entrada.ingredientes : [],
      pao: Array.isArray(entrada.paes) ? entrada.paes : [],
    };
    var porTipoId = { prod: new Map(), ing: new Map(), pao: new Map() };
    var porTipoNome = { prod: new Map(), ing: new Map(), pao: new Map() };
    Object.keys(catalogos).forEach(function (tipo) {
      catalogos[tipo].forEach(function (item) {
        if (!item || item.id == null) return;
        var copia = Object.assign({}, item), id = String(item.id), nome = nomeNormalizado(item.nomeBase || item.nome);
        porTipoId[tipo].set(id, copia);
        if (nome && !porTipoNome[tipo].has(nome)) porTipoNome[tipo].set(nome, copia);
      });
    });
    reverterNota(entrada.notaAnterior, porTipoId);
    var validos = itens.filter(function (it) { return itemValido(it, incluirSemNome); });
    var subtotal = validos.reduce(function (s, it) { return s + bruto(it) - descontoItem(it); }, 0);
    var descontoNota = numero(entrada.descontoNota);
    if (entrada.descontoNotaTipo === 'percent') descontoNota = subtotal * Math.min(100, descontoNota) / 100;
    descontoNota = Math.min(subtotal, Math.max(0, descontoNota));
    var grupos = [], porIndice = itens.map(function () { return null; }), porChave = new Map();

    itens.forEach(function (it, indice) {
      if (!itemValido(it, incluirSemNome) || it.tipoItem === 'despesa') return;
      var nome = nomeNormalizado(it.nomeBase || it.nome), tipo = it.tipoItem === 'pao' ? 'pao' : tipoItem(it);
      var vinc = String(it.vinc || ''), catalogo = null;
      // For bread the stock destination is chosen independently of the note description.
      if ((tipo === 'pao' || nome) && tipoVinculo(vinc) === tipo) {
        catalogo = porTipoId[tipo].get(vinc.slice(tipo.length + 1)) || null;
      }
      if (tipo === 'pao' && !catalogo) return;
      if (!catalogo && nome) catalogo = porTipoNome[tipo].get(nome) || null;
      var chave = tipo + ':' + (catalogo ? 'id:' + String(catalogo.id) : nome ? 'nome:' + nome : 'rascunho:' + indice);
      var grupo = porChave.get(chave);
      if (!grupo) {
        var saldoInicial = catalogo ? (tipo === 'ing' && catalogo.semEstoque ? catalogo.estoqueEstimado : catalogo.estoque) : 0;
        grupo = { indices: [], tipoItem: tipo, catalogoId: catalogo ? String(catalogo.id) : null, produtoId: tipo === 'prod' && catalogo ? String(catalogo.id) : null, custoMedio: catalogo ? numero(catalogo.custo) : 0, estoque: numero(saldoInicial), modoPreco: null, lucroPct: null, preco: null };
        porChave.set(chave, grupo);
        grupos.push(grupo);
      }
      var base = bruto(it) - descontoItem(it);
      var liquido = Math.max(0, base - (subtotal > 0 ? descontoNota * base / subtotal : 0));
      var qtd = Array.isArray(entrada.quantidadesEstoquePorIndice) ? numero(entrada.quantidadesEstoquePorIndice[indice]) : (tipo === 'ing' && it.modoCompra === 'flexivel' && numero(it.rend) > 0 ? numero(it.qtd) * numero(it.rend) : numero(it.qtd));
      if (!(qtd > 0)) return;
      var saldo = grupo.estoque, custo = grupo.custoMedio, novoSaldo = saldo + qtd;
      var saldoParaCusto = tipo === 'ing' ? Math.max(0, saldo) : saldo;
      var pesoDoCusto = saldoParaCusto + qtd;
      grupo.custoMedio = pesoDoCusto > 0 ? (saldoParaCusto * custo + liquido) / pesoDoCusto : liquido / qtd;
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

  return {
    calcular: calcular,
    gramasPorUnidadeCompra: gramasPorUnidadeCompra,
    rendimentoPorGramas: rendimentoPorGramas,
    podeContarIngredientePorUnidades: podeContarIngredientePorUnidades,
    separarValoresDaCompra: separarValoresDaCompra,
    normalizarNome: nomeNormalizado,
    calcularDescontoItem: descontoItem,
    somarDescontosItens: somarDescontosItens,
    normalizarPercentualDigitado: normalizarPercentualDigitado,
    lerPercentualNota: lerPercentualNota,
  };
});
