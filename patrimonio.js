(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Patrimonio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function centavos(valor) { var n = Number(valor); return Number.isFinite(n) && n > 0 ? Math.round((n + Number.EPSILON) * 100) : 0; }
  function dataCompraValida(valor) {
    var partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || ''));
    if (!partes) return false;
    var data = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]), 12);
    return data.getFullYear() === Number(partes[1]) && data.getMonth() === Number(partes[2]) - 1 && data.getDate() === Number(partes[3]);
  }
  function resumir(bens) {
    var lista = Array.isArray(bens) ? bens.filter(Boolean) : [], aquisicoes = 0, emUso = 0;
    lista.forEach(function (bem) { var valor = centavos(bem.valor); aquisicoes += valor; if (bem.estado !== 'Baixado') emUso += valor; });
    return { quantidade: lista.length, totalAquisicoes: aquisicoes / 100, valorEmUso: emUso / 100 };
  }
  function investimentosNoPeriodo(bens, inicio, fim) {
    var ini = new Date(inicio).getTime(), final = new Date(fim).getTime();
    if (!Number.isFinite(ini) || !Number.isFinite(final) || final <= ini) return 0;
    return (Array.isArray(bens) ? bens : []).reduce(function (soma, bem) {
      if (!bem || !dataCompraValida(bem.data)) return soma;
      var data = new Date(bem.data + 'T12:00:00').getTime();
      return soma + (data >= ini && data < final ? centavos(bem.valor) : 0);
    }, 0) / 100;
  }
  return { resumir: resumir, investimentosNoPeriodo: investimentosNoPeriodo, dataCompraValida: dataCompraValida };
});
