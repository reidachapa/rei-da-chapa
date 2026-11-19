(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaixaMensal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const encerrados = new Set(['finalizado', 'entregue', 'concluido', 'concluído']);
  const pagamentosBancarios = new Set(['pix', 'debito', 'credito', 'cartao']);
  const calendario = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  });

  function diaBrasil(valor) {
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(valor)) {
      return valor.slice(0, 10);
    }
    if (!(valor instanceof Date) && typeof valor !== 'string') return '';
    const data = new Date(valor);
    if (!Number.isFinite(data.getTime())) return '';
    const campos = Object.fromEntries(calendario.formatToParts(data).map(({ type, value }) => [type, value]));
    return campos.year.padStart(4, '0') + '-' + campos.month + '-' + campos.day;
  }

  function outroMes(mes, deslocamento) {
    const [ano, numeroMes] = mes.split('-').map(Number);
    const indice = ano * 12 + numeroMes - 1 + deslocamento;
    const anoNovo = Math.floor(indice / 12);
    if (anoNovo < 1 || anoNovo > 9999) return mes;
    return String(anoNovo).padStart(4, '0') + '-' + String(indice % 12 + 1).padStart(2, '0');
  }

  function centavos(valor) {
    const numero = Number(valor);
    const inteiro = Math.round((numero + Number.EPSILON) * 100);
    return Number.isSafeInteger(inteiro) && inteiro > 0 ? inteiro : 0;
  }

  function metodoPagamento(valor) {
    const chave = String(valor || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (chave === 'cartao_credito') return 'credito';
    if (chave === 'cartao_debito') return 'debito';
    if (['pix', 'dinheiro', 'debito', 'credito', 'cartao'].includes(chave)) return chave;
    return !chave || chave === 'pendente' || chave === 'misto' ? 'semForma' : 'outros';
  }

  function repartir(total, valores, destino) {
    const partes = Object.entries(valores).filter(([, valor]) => valor > 0);
    const soma = partes.reduce((acumulado, [, valor]) => acumulado + valor, 0);
    if (!soma) {
      destino.semForma = (destino.semForma || 0) + total;
      return;
    }
    let acumulado = 0, distribuido = 0;
    for (const [metodo, valor] of partes) {
      acumulado += valor;
      const novoDistribuido = Math.round(total * acumulado / soma);
      const parcela = novoDistribuido - distribuido;
      if (parcela > 0) destino[metodo] = (destino[metodo] || 0) + parcela;
      distribuido = novoDistribuido;
    }
  }

  function recebimentos(pedido, valorDevido) {
    if (pedido.pago !== true && pedido.pago !== false) return [];
    const total = centavos(pedido.total);
    const recebido = Math.max(0, total - centavos(valorDevido(pedido)));
    if (!recebido) return [];

    const distribuidos = new Map();
    for (const [metodo, valor] of Object.entries(pedido.pagamentos || {})) {
      const pago = centavos(valor);
      if (pago) distribuidos.set(metodo, pago);
    }
    if (!distribuidos.size) distribuidos.set(pedido.pagamento, recebido);
    const venda = Math.max(0, total - centavos(pedido.taxaEntrega));
    const liquido = Math.round(recebido * venda / total);
    const dataPedido = pedido.finalizadoEm || pedido.data;
    const ultimo = Array.isArray(pedido.log) && pedido.log.slice().reverse().find(evento =>
      evento && evento.status === 'pagamento_recebido' && evento.data === pedido.pagoEm);
    const recebidoDepois = ultimo ? Math.min(recebido, centavos(ultimo.valor)) : 0;
    if (recebidoDepois && recebidoDepois < recebido) {
      const primeiraParte = Math.round(liquido * (recebido - recebidoDepois) / recebido);
      if (distribuidos.has(ultimo.metodo)) {
        distribuidos.set(ultimo.metodo, Math.max(0, distribuidos.get(ultimo.metodo) - recebidoDepois));
      }
      return [
        { data: dataPedido, valor: primeiraParte, pagamentos: agruparPagamentos(distribuidos) },
        { data: pedido.pagoEm, valor: liquido - primeiraParte, pagamentos: { [metodoPagamento(ultimo.metodo)]: recebidoDepois } },
      ];
    }
    return [{ data: pedido.pagoEm || dataPedido, valor: liquido, pagamentos: agruparPagamentos(distribuidos) }];
  }

  function agruparPagamentos(pagamentos) {
    const agrupados = {};
    for (const [metodo, valor] of pagamentos) {
      const chave = metodoPagamento(metodo);
      agrupados[chave] = (agrupados[chave] || 0) + valor;
    }
    return agrupados;
  }

  function calcular(loja, mes, valorDevido) {
    const resultado = {
      recebido: 0, comprado: 0, comprasPagas: 0, comprasAPagar: 0,
      saldo: 0, quantidadeVendas: 0, quantidadeCompras: 0,
      porOrigem: {
        dinheiro: { recebido: 0, pago: 0, saldo: 0 },
        banco: { recebido: 0, pago: 0, saldo: 0 },
        semOrigem: { recebido: 0, pago: 0, saldo: 0 },
      },
      porPagamento: {}, porDia: {}, temMovimento: false,
    };
    function diaNoMes(data) {
      const dia = diaBrasil(data);
      return dia.slice(0, 7) === mes ? Number(dia.slice(8)) : 0;
    }
    function movimentoDia(dia) {
      return resultado.porDia[dia] ||= { recebido: 0, comprado: 0 };
    }
    const vistos = new Set();
    for (const pedido of loja.historico) {
      if (!pedido || !encerrados.has(pedido.status)) continue;
      const id = pedido.id == null ? null : String(pedido.id);
      if (id !== null && vistos.has(id)) continue;
      if (id !== null) vistos.add(id);
      let contouVenda = false;
      for (const parcela of recebimentos(pedido, valorDevido)) {
        const dia = diaNoMes(parcela.data);
        if (!dia || parcela.valor <= 0) continue;
        resultado.recebido += parcela.valor;
        movimentoDia(dia).recebido += parcela.valor;
        repartir(parcela.valor, parcela.pagamentos, resultado.porPagamento);
        contouVenda = true;
      }
      if (contouVenda) resultado.quantidadeVendas++;
    }
    for (const [metodo, valor] of Object.entries(resultado.porPagamento)) {
      const origem = metodo === 'dinheiro' ? 'dinheiro' : pagamentosBancarios.has(metodo) ? 'banco' : 'semOrigem';
      resultado.porOrigem[origem].recebido += valor;
    }
    for (const nota of loja.despesas) {
      if (!nota || nota.tipoRegistro === 'despesa' ||
          (nota.tipoRegistro !== 'compra' && !(Array.isArray(nota.itens) && nota.itens.length))) continue;
      const dia = diaNoMes(nota.data);
      if (!dia) continue;
      const valor = centavos(nota.valor);
      resultado.comprado += valor;
      resultado.quantidadeCompras++;
      movimentoDia(dia).comprado += valor;
      if (nota.status === 'pendente') resultado.comprasAPagar += valor;
      else {
        resultado.comprasPagas += valor;
        const origem = ['dinheiro', 'banco'].includes(nota.origemPagamento) ? nota.origemPagamento : 'semOrigem';
        resultado.porOrigem[origem].pago += valor;
      }
    }
    for (const total of Object.values(resultado.porOrigem)) total.saldo = total.recebido - total.pago;
    resultado.saldo = resultado.recebido - resultado.comprasPagas;
    resultado.temMovimento = resultado.quantidadeVendas > 0 || resultado.quantidadeCompras > 0;
    return resultado;
  }

  return { calcular, diaBrasil, outroMes };
});
