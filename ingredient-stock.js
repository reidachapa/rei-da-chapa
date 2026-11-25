(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EstoqueIngredientes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MASSA = { mg: 0.001, g: 1, kg: 1000 }, VOLUME = { ml: 1, l: 1000 };
  function normalizarUnidade(valor) {
    var u = String(valor || '').trim().toLocaleLowerCase('pt-BR').replace(/\./g, '');
    if (/^(un|und|unds|unidades?)$/.test(u)) return 'un';
    if (/^(quilos?|kilos?|quilogramas?)$/.test(u)) return 'kg';
    if (/^(gr|gramas?)$/.test(u)) return 'g';
    if (/^miligramas?$/.test(u)) return 'mg';
    if (/^mililitros?$/.test(u)) return 'ml';
    if (/^(lt|litros?)$/.test(u)) return 'l';
    if (/^(porcao|porcoes|porções)$/.test(u)) return 'porção';
    return u;
  }
  function unidade(valor) { return normalizarUnidade(valor) || 'un'; }
  function numero(valor) {
    if (valor === null || valor === undefined || String(valor).trim() === '') return NaN;
    if (typeof valor === 'number') return valor;
    var texto = String(valor).trim();
    if (texto.indexOf(',') >= 0) texto = texto.replace(/\./g, '').replace(',', '.');
    return Number(texto);
  }
  function finito(valor) { var n = Number(valor); return Number.isFinite(n) ? n : 0; }
  function temSaldo(ing) { return ing && ing.estoqueEstimado !== null && ing.estoqueEstimado !== undefined && ing.estoqueEstimado !== '' && Number.isFinite(Number(ing.estoqueEstimado)); }
  function unidadeFisicaInterna(ing) {
    if (ing && ing.unidadeEstoque) return unidade(ing.unidadeEstoque);
    if (ing && ing.modoCompra === 'flexivel' && Number(ing.rendimento) > 0) return 'porção';
    return unidade(ing && ing.unidade);
  }
  function unidadeExibicao(ing) {
    var u = unidadeFisicaInterna(ing);
    return ing && ing.semEstoque && !(Number(ing.rendimento) > 0) ? (u in MASSA ? 'kg' : u in VOLUME ? 'l' : u) : u;
  }
  function usaMediaPorContagem(ing) { var u = unidadeFisicaInterna(ing); return !!(ing && ing.semEstoque && (ing.consumoMedia || ((u in MASSA || u in VOLUME) && !(Number(ing.rendimento) > 0)))); }
  function converter(qtd, origem, destino) {
    var n = numero(qtd), a = unidade(origem), b = unidade(destino);
    if (!Number.isFinite(n)) return NaN;
    if (a === b) return n;
    if (a in MASSA && b in MASSA) return n * MASSA[a] / MASSA[b];
    if (a in VOLUME && b in VOLUME) return n * VOLUME[a] / VOLUME[b];
    return NaN;
  }
  function paraEstoque(qtd, origem, ing) {
    var interno = unidadeFisicaInterna(ing), convertido = converter(qtd, origem, interno);
    if (Number.isFinite(convertido)) return convertido;
    var rendimento = Number(ing && ing.rendimento), compra = unidade(ing && ing.unidade);
    if (ing && ing.modoCompra === 'flexivel' && rendimento > 0 && !(interno in MASSA) && !(interno in VOLUME)) {
      var comprada = converter(qtd, origem, compra);
      if (Number.isFinite(comprada)) return comprada * rendimento;
    }
    return NaN;
  }
  function saldoParaExibicao(ing, quantidade) {
    var interna = unidadeFisicaInterna(ing), qtd = finito(quantidade);
    var escolhida = normalizarUnidade(ing.unidadeExibicaoEstoque);
    var medida = Number.isFinite(MASSA[interna]) || Number.isFinite(VOLUME[interna]);
    var peso = medida ? 0 : Math.max(0, finito(ing.gramasPorUnidade));
    var rendimento = finito(ing.rendimento);
    if (!medida && !peso && !ing.consumoMedia && rendimento > 0) {
      peso = Math.max(0, finito(converter(1, ing.unidade, 'g') / rendimento));
    }
    if (escolhida && escolhida !== interna) {
      var escolhidaEmMedida = Number.isFinite(MASSA[escolhida]) || Number.isFinite(VOLUME[escolhida]);
      if (!medida && !escolhidaEmMedida) {
        return { quantidade: qtd, unidade: escolhida, gramasPorUnidade: peso };
      }
      var exibida = converter(qtd, interna, escolhida);
      if (!medida) {
        if (peso > 0 && Number.isFinite(MASSA[escolhida])) exibida = converter(qtd * peso, 'g', escolhida);
        else if (rendimento > 0) exibida = converter(qtd / rendimento, ing.unidade, escolhida);
      }
      if (Number.isFinite(exibida)) return { quantidade: exibida, unidade: escolhida, gramasPorUnidade: peso };
    }
    return { quantidade: qtd, unidade: interna, gramasPorUnidade: peso };
  }
  function copiar(ing) { return Object.assign({}, ing); }
  function analisarContagem(ing, opcoes) {
    var op = opcoes || {}, saldo = paraEstoque(op.saldo, op.unidade || unidadeExibicao(ing), ing);
    var perdaEntrada = op.perda === undefined || op.perda === '' ? 0 : op.perda;
    var perda = paraEstoque(perdaEntrada, op.unidadePerda || op.unidade || unidadeExibicao(ing), ing);
    if (!Number.isFinite(saldo) || saldo < 0 || !Number.isFinite(perda) || perda < 0) return { ok: false, erro: 'Informe quantidades válidas e unidades compatíveis.' };
    var ancora = ing.inicioContagemKg === null || ing.inicioContagemKg === undefined ? null : finito(ing.inicioContagemKg);
    var compras = finito(ing.comprasDesdeContagem), perdas = finito(ing.perdasDesdeContagem), usos = op.usos === undefined ? finito(ing.pesoVendidoDesdeContagem) : numero(op.usos);
    if (!Number.isFinite(usos) || usos < 0) return { ok: false, erro: 'Quantidade de usos inválida.' };
    var disponivel = ancora === null ? null : ancora + compras - perdas;
    var diferenca = disponivel === null ? 0 : disponivel - perda - saldo;
    var ajuste = disponivel !== null && diferenca < -1e-8;
    var resumo = { saldo: saldo, unidade: unidadeFisicaInterna(ing), perda: perda, consumo: Math.max(0, diferenca), usos: usos, ajuste: ajuste, mediaAtualizada: false, saldoAnterior: disponivel, primeiraContagem: ancora === null };
    if (ajuste && !op.confirmarAjuste) return { ok: false, requerConfirmacao: true, erro: 'O saldo contado e as perdas são maiores que a quantidade registrada. Confirme o ajuste de estoque.', resumo: resumo };
    var novo = copiar(ing), historico = (ing.contagensEstoque || []).map(function (item) { return Object.assign({}, item); });
    var id = String(op.id || ('contagem_' + (historico.length + 1))), registro = { id: id, epocaAnterior: ing.contagemEstoqueId || null, data: op.data || '', unidadeEstoque: resumo.unidade, saldoAnterior: disponivel, saldo: saldo, compras: compras, perdasRegistradas: perdas, perdaInformada: perda, consumo: resumo.consumo, usos: usos, ajuste: ajuste, mediaAtualizada: false };
    if (usaMediaPorContagem(ing)) novo.consumoMedia = true;
    if (!ajuste && ancora !== null && usos > 0 && usaMediaPorContagem(ing)) {
      novo.pesoHistorico = finito(ing.pesoHistorico) + usos;
      novo.kgHistorico = finito(ing.kgHistorico) + resumo.consumo;
      novo.fatorConsumoMedia = novo.kgHistorico / novo.pesoHistorico;
      resumo.mediaAtualizada = registro.mediaAtualizada = true;
    }
    historico.push(registro);
    novo.contagensEstoque = historico;
    novo.contagemEstoqueId = id;
    novo.estoqueEstimado = saldo;
    novo.inicioContagemKg = saldo;
    novo.comprasDesdeContagem = 0;
    novo.perdasDesdeContagem = 0;
    novo.pesoVendidoDesdeContagem = 0;
    var resultado = { ok: true, novoIngrediente: novo, resumo: resumo };
    if (perda > 0) resultado.perda = { tipo: 'ing', itemId: ing.id, itemNome: ing.nome, qtd: numero(perdaEntrada), unidadeQtd: unidade(op.unidadePerda || op.unidade || unidadeExibicao(ing)), qtdEstoqueInterno: perda, qtdEstimativaBaixada: 0, incluidaNaContagem: true, contagemEstoqueId: id, unidadeEstoque: resumo.unidade };
    return resultado;
  }
  function consumir(ing, quantidade) {
    var novo = copiar(ing), n = Math.max(0, finito(quantidade));
    if (!ing.semEstoque) { novo.estoque = finito(ing.estoque) - n; return novo; }
    var fisica = unidadeFisicaInterna(ing), medidaSemRendimento = (fisica in MASSA || fisica in VOLUME) && !(Number(ing.rendimento) > 0);
    if (ing.consumoMedia || medidaSemRendimento) {
      novo.pesoVendidoDesdeContagem = finito(ing.pesoVendidoDesdeContagem) + n;
      if (ing.consumoMedia && Number(ing.fatorConsumoMedia) > 0 && temSaldo(ing)) novo.estoqueEstimado = Math.max(0, Number(ing.estoqueEstimado) - n * Number(ing.fatorConsumoMedia));
    } else if (temSaldo(ing)) novo.estoqueEstimado = Math.max(0, Number(ing.estoqueEstimado) - n);
    return novo;
  }
  function devolver(ing, quantidade, baixa) {
    var novo = copiar(ing), n = Math.max(0, finito(quantidade));
    if (baixa && typeof baixa === 'object') {
      if (baixa.semEstoque) {
        if (Object.prototype.hasOwnProperty.call(baixa, 'contagemEstoqueId') && !mesmaEpoca(ing, baixa)) return novo;
        if (baixa.consumoMedia) novo.pesoVendidoDesdeContagem = Math.max(0, finito(ing.pesoVendidoDesdeContagem) - finito(baixa.pesoVendido));
        if (Number(baixa.estoqueEstimado) > 0 && temSaldo(ing)) novo.estoqueEstimado = Number(ing.estoqueEstimado) + Number(baixa.estoqueEstimado);
      } else novo.estoque = finito(ing.estoque) + (Number(baixa.estoque) || n);
    } else if (!ing.semEstoque) novo.estoque = finito(ing.estoque) + n;
    return novo;
  }
  function registrarPerda(ing, opcoes) {
    var op = opcoes || {}, quantidade = paraEstoque(op.qtd, op.unidade || unidadeExibicao(ing), ing);
    if (!Number.isFinite(quantidade) || quantidade <= 0) return { ok: false, erro: 'Quantidade de perda inválida.' };
    var novo = copiar(ing), baixada = 0;
    if (ing.semEstoque) {
      if (temSaldo(ing)) { baixada = Math.min(Math.max(0, Number(ing.estoqueEstimado)), quantidade); novo.estoqueEstimado = Math.max(0, Number(ing.estoqueEstimado) - quantidade); }
      novo.perdasDesdeContagem = finito(ing.perdasDesdeContagem) + quantidade;
    } else { baixada = Math.min(Math.max(0, finito(ing.estoque)), quantidade); novo.estoque = Math.max(0, finito(ing.estoque) - quantidade); }
    return { ok: true, novoIngrediente: novo, perda: { qtdEstoqueInterno: quantidade, qtdEstimativaBaixada: ing.semEstoque ? baixada : 0, qtdEstoqueBaixada: ing.semEstoque ? 0 : baixada, perdaContador: ing.semEstoque ? quantidade : 0, contagemEstoqueId: ing.contagemEstoqueId || null, unidadeEstoque: unidadeFisicaInterna(ing) } };
  }
  function mesmaEpoca(ing, movimento) { return String(ing.contagemEstoqueId || '') === String(movimento.contagemEstoqueId || ''); }
  function restaurarPerda(ing, perda) {
    var novo = copiar(ing);
    if (perda.incluidaNaContagem) {
      novo.contagensEstoque = (ing.contagensEstoque || []).map(function (c) { return Object.assign({}, c); });
      var contagem = novo.contagensEstoque.find(function (c) { return String(c.id) === String(perda.contagemEstoqueId); });
      if (contagem && !contagem.perdaExcluida) {
        contagem.perdaExcluida = true;
        if (contagem.mediaAtualizada) { var qtd = Math.max(0, finito(perda.qtdEstoqueInterno)); contagem.consumo = finito(contagem.consumo) + qtd; novo.kgHistorico = finito(ing.kgHistorico) + qtd; if (Number(ing.pesoHistorico) > 0) novo.fatorConsumoMedia = novo.kgHistorico / Number(ing.pesoHistorico); }
      }
      return novo;
    }
    if (ing.semEstoque) {
      if (!mesmaEpoca(ing, perda)) {
        novo.contagensEstoque = (ing.contagensEstoque || []).map(function (c) { return Object.assign({}, c, { perdasExcluidas: (c.perdasExcluidas || []).slice() }); });
        var fechada = novo.contagensEstoque.find(function (c) { return String(c.epocaAnterior || '') === String(perda.contagemEstoqueId || ''); });
        if (fechada && perda.id && fechada.perdasExcluidas.indexOf(String(perda.id)) < 0) {
          fechada.perdasExcluidas.push(String(perda.id));
          var abatida = Math.min(Math.max(0, finito(fechada.perdasRegistradas)), Math.max(0, finito(perda.perdaContador === undefined ? perda.qtdEstimativaBaixada : perda.perdaContador)));
          fechada.perdasRegistradas = Math.max(0, finito(fechada.perdasRegistradas) - abatida);
          if (fechada.mediaAtualizada) { fechada.consumo = finito(fechada.consumo) + abatida; novo.kgHistorico = finito(ing.kgHistorico) + abatida; if (Number(ing.pesoHistorico) > 0) novo.fatorConsumoMedia = novo.kgHistorico / Number(ing.pesoHistorico); }
        }
        return novo;
      }
      if (temSaldo(ing)) novo.estoqueEstimado = Number(ing.estoqueEstimado) + Math.max(0, finito(perda.qtdEstimativaBaixada));
      novo.perdasDesdeContagem = Math.max(0, finito(ing.perdasDesdeContagem) - Math.max(0, finito(perda.perdaContador === undefined ? perda.qtdEstimativaBaixada : perda.perdaContador)));
    } else novo.estoque = finito(ing.estoque) + Math.max(0, finito(perda.qtdEstoqueBaixada === undefined ? perda.qtdEstoqueInterno : perda.qtdEstoqueBaixada));
    return novo;
  }
  return { normalizarUnidade: normalizarUnidade, saldoParaExibicao: saldoParaExibicao, unidadeFisicaInterna: unidadeFisicaInterna, unidadeExibicao: unidadeExibicao, usaMediaPorContagem: usaMediaPorContagem, converter: converter, paraEstoque: paraEstoque, analisarContagem: analisarContagem, consumir: consumir, devolver: devolver, registrarPerda: registrarPerda, restaurarPerda: restaurarPerda, mesmaEpoca: mesmaEpoca, temSaldo: temSaldo };
});
