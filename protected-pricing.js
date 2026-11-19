(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrecoProtegido = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function numero(valor) {
    if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor.trim())) return null;
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function normalizarNome(valor) {
    return String(valor || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }

  function movimentacao(nota, vinculo, nomeProduto = '') {
    if (!nota || nota.tipoRegistro === 'despesa' || !Array.isArray(nota.itens)) return null;
    const tipo = vinculo.split(':')[0];
    const linhas = [];
    const lotesPorCusto = new Map();
    let quantidade = 0, valida = true;
    for (const item of nota.itens) {
      if (!item) continue;
      const aplicado = item.aplicado;
      const vinculoAplicado = aplicado && aplicado.vinc;
      const semVinculo = !item.vinc && !vinculoAplicado && (item.tipoItem || 'prod') === tipo;
      if (item.vinc !== vinculo && vinculoAplicado !== vinculo &&
          !(semVinculo && nomeProduto && normalizarNome(item.nomeBase || item.nome) === nomeProduto)) continue;
      const qtd = numero(aplicado && aplicado.qtdEst);
      const valor = numero(aplicado && aplicado.custoUnitario);
      if (vinculoAplicado === vinculo && aplicado.preservadoPorContagem && qtd === 0) {
        linhas.push(JSON.stringify(['preservada']));
        continue;
      }
      if (vinculoAplicado !== vinculo || (item.vinc && item.vinc !== vinculo) || !(qtd > 0) || valor === null) {
        valida = false;
        linhas.push(JSON.stringify(['pendente', numero(item.qtd), numero(item.valor),
          numero(item.descontoOriginal ?? item.desconto), item.descontoTipo || '', numero(nota.desconto)]));
      } else {
        linhas.push(JSON.stringify([qtd, valor]));
        quantidade += qtd;
        lotesPorCusto.set(valor, (lotesPorCusto.get(valor) || 0) + qtd);
      }
    }
    if (!linhas.length) return null;
    const data = typeof nota.criadoEm === 'string' ? Date.parse(nota.criadoEm) : NaN;
    const lotes = Array.from(lotesPorCusto, ([custo, quantidade]) => ({ custo, quantidade }));
    return { assinatura: JSON.stringify(linhas.sort()), valida: valida && Number.isFinite(quantidade), quantidade, lotes, data };
  }

  function assinaturaCompra(nota, vinculo) {
    const movimento = movimentacao(nota, vinculo);
    return movimento ? movimento.assinatura : null;
  }

  function buscarCompras(produto, despesas, opcoes) {
    if (produto.id == null || !String(produto.id).trim() || !Array.isArray(despesas)) return null;
    const compras = new Map();
    const vinculo = opcoes.vinculo ?? 'prod:' + produto.id;
    if (typeof vinculo !== 'string' || !['prod', 'ing', 'pao'].some(tipo => vinculo === tipo + ':' + produto.id)) return null;
    const nome = normalizarNome(produto.nomeBase || produto.nome);
    for (const nota of despesas) {
      const movimento = movimentacao(nota, vinculo, nome);
      if (!movimento) continue;
      const id = nota.id == null ? '' : String(nota.id);
      if (!id.trim() || compras.has(id)) return null;
      compras.set(id, movimento);
    }
    return compras;
  }

  function quantidade(valor, opcoes) {
    const qtd = numero(valor);
    return qtd === null || typeof opcoes.arredondarQtd !== 'function' ? qtd : numero(opcoes.arredondarQtd(qtd));
  }

  function saldoDoItem(produto, opcoes) {
    const valor = Object.prototype.hasOwnProperty.call(opcoes, 'saldo') ? opcoes.saldo : produto.estoque;
    return quantidade(valor, opcoes);
  }

  function iniciar(produto, despesas, custoInicial, percentual, opcoes = {}) {
    const quantidadeInicial = saldoDoItem(produto, opcoes), margem = numero(percentual);
    const custo = numero(custoInicial) ?? (quantidadeInicial === 0 ? 0 : null);
    if (quantidadeInicial === null) throw new Error('Confira o saldo do estoque antes de ativar o preço protegido.');
    if (custo === null || (quantidadeInicial > 0 && custo <= 0)) throw new Error('Informe o maior custo por unidade do estoque atual.');
    if (margem === null) throw new Error('Informe um percentual válido sobre o custo.');
    const compras = buscarCompras(produto, despesas, opcoes);
    if (!compras) throw new Error('Confira as compras antes de ativar o preço protegido.');
    const comprasIniciais = Object.fromEntries(Array.from(compras, ([id, movimento]) => [id, movimento.assinatura]));
    return { quantidadeInicial, custoInicial: custo, percentual: margem, comprasIniciais };
  }

  function resultado(status) {
    return { status, lotes: [], custoProtegido: null, preco: null };
  }

  function arredondarParaCima(valor) {
    const centavos = valor * 100;
    const inteiro = Math.round(centavos);
    const erro = Math.min(1e-7, Math.max(1, centavos) * Number.EPSILON * 2);
    const total = Math.abs(centavos - inteiro) <= erro ? inteiro : Math.ceil(centavos);
    return Number.isSafeInteger(total) ? total / 100 : null;
  }

  function sugerir(custo, acrescimo) {
    const valor = numero(custo), percentual = numero(acrescimo);
    return valor === null || percentual === null ? null : arredondarParaCima(valor * (1 + percentual / 100));
  }

  function calcular(produto, despesas, opcoes = {}) {
    const config = produto && produto.precoProtegido;
    if (!config) return resultado('desativado');
    const { comprasIniciais } = config;
    const saldo = saldoDoItem(produto, opcoes), quantidadeInicial = quantidade(config.quantidadeInicial, opcoes);
    const custoInicial = numero(config.custoInicial), percentual = numero(config.percentual);
    const multiplicador = opcoes.multiplicador === undefined ? 1 : numero(opcoes.multiplicador);
    const compras = buscarCompras(produto, despesas, opcoes);
    if (config.revisar || !compras || !comprasIniciais || typeof comprasIniciais !== 'object' ||
        Array.isArray(comprasIniciais) || [saldo, quantidadeInicial, custoInicial, percentual].includes(null) ||
        !(multiplicador > 0) || (quantidadeInicial > 0 && custoInicial === 0)) return resultado('conferir');

    for (const [id, assinatura] of Object.entries(comprasIniciais)) {
      if (!compras.has(id) || compras.get(id).assinatura !== assinatura) return resultado('conferir');
      compras.delete(id);
    }
    const entradas = Array.from(compras);
    if (entradas.some(([, compra]) => !compra.valida || (compra.quantidade > 0 && !Number.isFinite(compra.data)))) {
      return resultado('conferir');
    }
    if (saldo === 0) return resultado('semEstoque');
    entradas.sort(([idA, a], [idB, b]) => b.data - a.data || (idA < idB ? 1 : idA > idB ? -1 : 0));
    // O saldo PEPS começa pelas compras mais recentes. Na mesma nota, onde a
    // ordem física é desconhecida, preservamos primeiro os lotes mais caros.
    const lotesRecebidos = entradas.flatMap(([, entrada]) => entrada.lotes.sort((a, b) => b.custo - a.custo));
    lotesRecebidos.push({ quantidade: quantidadeInicial, custo: custoInicial });
    const lotes = [];
    const tolerancia = Math.min(1e-8, Number.EPSILON * Math.max(1, saldo) * 4);
    let restante = saldo, custoProtegido = 0;
    for (const entrada of lotesRecebidos) {
      if (restante <= 0 || (lotes.length > 0 && restante <= tolerancia)) break;
      const qtdEntrada = quantidade(entrada.quantidade, opcoes);
      if (qtdEntrada === null) return resultado('conferir');
      const qtd = Math.min(qtdEntrada, restante);
      if (qtd <= 0) continue;
      lotes.push({ qtd, custo: entrada.custo });
      restante -= qtd;
      custoProtegido = Math.max(custoProtegido, entrada.custo);
    }
    if (!lotes.length || restante > tolerancia) return resultado('conferir');
    const preco = sugerir(custoProtegido * multiplicador, percentual);
    if (preco === null) return resultado('conferir');
    return { status: 'ok', lotes: lotes.reverse(), custoProtegido, preco };
  }

  return { assinaturaCompra, iniciar, calcular, sugerir };
});
