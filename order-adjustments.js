(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AjustesPedido = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var metodos = ['pix', 'dinheiro', 'debito', 'credito'];
  function centavos(valor) {
    var n = Number(valor == null || valor === '' ? 0 : valor);
    if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) throw new Error('Informe um valor válido, maior ou igual a zero.');
    return Math.round((n + Number.EPSILON) * 100);
  }
  function dinheiro(valor) { return valor / 100; }
  function calcularFechamento(op) {
    op = op || {};
    var bruto = centavos(op.subtotalBruto), desconto = Math.min(bruto, centavos(op.descontoPedido));
    var juros = centavos(op.jurosPedido), taxa = centavos(op.taxaEntrega), subtotal = bruto - desconto + juros;
    if (!Number.isSafeInteger(subtotal + taxa)) throw new Error('O valor informado é muito alto.');
    return { subtotalBruto: dinheiro(bruto), descontoPedido: dinheiro(desconto), jurosPedido: dinheiro(juros), subtotal: dinheiro(subtotal), taxaEntrega: dinheiro(taxa), total: dinheiro(subtotal + taxa) };
  }
  function resumo(p) {
    p = p || {};
    var taxa = Math.max(0, Number(p.taxaEntrega) || 0), juros = Math.max(0, Number(p.jurosPedido) || 0);
    var desconto = Math.max(0, Number(p.descontoPedido != null ? p.descontoPedido : p.desconto) || 0), bruto;
    if (p.subtotalBruto != null && Number.isFinite(Number(p.subtotalBruto))) bruto = Math.max(0, Number(p.subtotalBruto));
    else if (p.subtotal != null && Number.isFinite(Number(p.subtotal))) bruto = Math.max(0, Number(p.subtotal) + desconto - juros);
    else if (Array.isArray(p.itens)) bruto = p.itens.reduce(function (s, it) { return s + Math.max(0, Number(it.preco) || 0) * Math.max(0, Number(it.qtd) || 0); }, 0);
    else bruto = Math.max(0, (Number(p.total) || 0) - taxa + desconto - juros);
    var r = calcularFechamento({ subtotalBruto: bruto, descontoPedido: desconto, jurosPedido: juros, taxaEntrega: taxa });
    if (p.total != null && Number.isFinite(Number(p.total))) {
      r.total = dinheiro(centavos(Math.max(0, Number(p.total))));
      r.subtotal = dinheiro(Math.max(0, centavos(r.total) - centavos(r.taxaEntrega)));
    }
    return r;
  }
  function valorDevido(p) {
    if (!p || p.pago === true) return 0;
    var saldo = Number(p.saldoDevido), total = Math.max(0, Number(p.total) || 0);
    if (p.pago === false) {
      if (p.pagamento === 'pendente') return dinheiro(centavos(total));
      if (Number.isFinite(saldo) && saldo > 0) return dinheiro(centavos(Math.min(saldo, total || saldo)));
      var pagos = Object.values(p.pagamentos || {}).reduce(function (s, v) { return s + (Number(v) || 0); }, 0);
      var adicao = !!(p.ultimaAlteracaoPedido && p.ultimaAlteracaoPedido.tipo === 'itens_adicionados') || (p.log || []).some(function (l) { return l.status === 'itens_adicionados'; });
      return dinheiro(centavos(adicao && pagos > 0 ? Math.max(0, total - pagos) : total));
    }
    return Number.isFinite(saldo) && saldo > 0 ? dinheiro(centavos(Math.min(saldo, total || saldo))) : 0;
  }
  function simularRecebimento(p, op) {
    op = op || {};
    if (!p || p.pago === true || valorDevido(p) <= 0) throw new Error('Este pedido não tem valor em aberto.');
    if (op.tipo !== 'juros' && op.tipo !== 'desconto') throw new Error('Escolha desconto ou juros.');
    var valor = centavos(op.valor), devido = centavos(valorDevido(p)), f = resumo(p);
    var total = centavos(f.total), taxa = centavos(f.taxaEntrega), juros = centavos(f.jurosPedido), desconto = centavos(f.descontoPedido);
    // O total salvo é a referência também para pedidos antigos editados manualmente.
    if (total < taxa + juros) throw new Error('O total não confere com os juros e a taxa de entrega. Confira os valores do pedido antes de receber.');
    var bruto = total - taxa - juros + desconto, limite = Math.min(devido, Math.max(0, total - taxa));
    if (op.tipo === 'desconto' && valor > limite) throw new Error('O desconto máximo é R$ ' + dinheiro(limite).toFixed(2).replace('.', ',') + ', preservando a taxa de entrega.');
    if (op.tipo === 'juros') juros += valor;
    else { var sobreJuros = Math.min(juros, valor); juros -= sobreJuros; desconto += valor - sobreJuros; }
    var financeiro = calcularFechamento({ subtotalBruto: dinheiro(bruto), descontoPedido: dinheiro(desconto), jurosPedido: dinheiro(juros), taxaEntrega: dinheiro(taxa) });
    if (centavos(financeiro.total) !== total + (op.tipo === 'juros' ? valor : -valor)) throw new Error('Os valores do pedido não conferem. Confira o total antes de receber.');
    return { financeiro: financeiro, valorAnterior: dinheiro(devido), valorAjuste: dinheiro(valor), totalReceber: dinheiro(devido + (op.tipo === 'juros' ? valor : -valor)), limiteDesconto: dinheiro(limite) };
  }
  function prepararRecebimento(p, op) {
    if (!op || metodos.indexOf(op.metodo) < 0) throw new Error('Escolha uma forma de pagamento válida.');
    var simulacao = simularRecebimento(p, op), novo = JSON.parse(JSON.stringify(p));
    var antes = centavos(p.total), recebidoAntes = antes - centavos(simulacao.valorAnterior), pagamentos = {};
    if (recebidoAntes > 0) {
      Object.entries(p.pagamentos || {}).forEach(function (par) { if (Number(par[1]) > 0) pagamentos[par[0]] = dinheiro(centavos(par[1])); });
      var soma = Object.values(pagamentos).reduce(function (s, v) { return s + centavos(v); }, 0);
      if (!soma && metodos.indexOf(p.pagamento) >= 0) pagamentos[p.pagamento] = dinheiro(recebidoAntes);
      else if (soma !== recebidoAntes) throw new Error('Os pagamentos anteriores não conferem com o saldo. Confira o pedido antes de receber.');
    }
    var valor = centavos(simulacao.totalReceber), data = op.data || new Date().toISOString();
    if (valor > 0) pagamentos[op.metodo] = dinheiro(centavos(pagamentos[op.metodo]) + valor);
    var ativos = Object.keys(pagamentos).filter(function (k) { return pagamentos[k] > 0; });
    Object.assign(novo, simulacao.financeiro, { pagamentos: pagamentos, pagamento: ativos.length > 1 ? 'misto' : (ativos[0] || op.metodo), pago: true, saldoDevido: 0, troco: 0, pagoEm: data });
    novo.lucro = Math.round((novo.subtotal - (Number(p.custoTotal) || 0)) * 100) / 100;
    novo.ajustesRecebimento = Array.isArray(novo.ajustesRecebimento) ? novo.ajustesRecebimento : [];
    if (simulacao.valorAjuste > 0) novo.ajustesRecebimento.push({ tipo: op.tipo, valor: simulacao.valorAjuste, data: data, saldoAntes: simulacao.valorAnterior, valorRecebido: simulacao.totalReceber, metodo: op.metodo });
    novo.log = Array.isArray(novo.log) ? novo.log : [];
    novo.log.push({ status: 'pagamento_recebido', data: data, metodo: op.metodo, valor: simulacao.totalReceber, ajusteTipo: op.tipo, ajusteValor: simulacao.valorAjuste });
    return novo;
  }
  return { calcularFechamento: calcularFechamento, resumo: resumo, valorDevido: valorDevido, simularRecebimento: simularRecebimento, prepararRecebimento: prepararRecebimento };
});
