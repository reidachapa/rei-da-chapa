(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PeriodosDRE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dataLocal(ano, mes, dia, hora) {
    var resultado = new Date(0);
    resultado.setFullYear(ano, mes, dia);
    resultado.setHours(hora || 0, 0, 0, 0);
    return resultado;
  }

  function diaValido(ano, mes, dia) {
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    var resultado = dataLocal(ano, mes - 1, dia, 12);
    return resultado.getFullYear() === ano && resultado.getMonth() === mes - 1 && resultado.getDate() === dia ? resultado : null;
  }

  function data(valor) {
    if (valor instanceof Date) return Number.isFinite(valor.getTime()) ? new Date(valor.getTime()) : null;
    if (typeof valor !== 'string') return null;
    var partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    if (partes) return diaValido(Number(partes[1]), Number(partes[2]), Number(partes[3]));
    partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))?$/i.exec(valor);
    if (!partes || !diaValido(Number(partes[1]), Number(partes[2]), Number(partes[3]))) return null;
    var hora = Number(partes[4]), minuto = Number(partes[5]), segundo = Number(partes[6] || 0);
    if (hora > 24 || minuto > 59 || segundo > 59 || Number(partes[9] || 0) > 23 || Number(partes[10] || 0) > 59) return null;
    if (hora === 24 && (minuto || segundo || Number(partes[7] || 0))) return null;
    var resultado = new Date(valor);
    return Number.isFinite(resultado.getTime()) ? resultado : null;
  }

  function periodo(filtro, agora) {
    var referencia = data(agora) || new Date();
    var ano = referencia.getFullYear(), mes = referencia.getMonth(), dia = referencia.getDate();
    if (filtro === 'todos') return { ini: new Date(-8640000000000000), fim: new Date(8640000000000000), label: 'Todo o período' };
    if (filtro === 'hoje') return { ini: dataLocal(ano, mes, dia), fim: dataLocal(ano, mes, dia + 1), label: 'Hoje' };
    if (filtro === 'ontem') return { ini: dataLocal(ano, mes, dia - 1), fim: dataLocal(ano, mes, dia), label: 'Ontem' };
    if (filtro === 'semana') return { ini: dataLocal(ano, mes, dia - 6), fim: dataLocal(ano, mes, dia + 1), label: 'Últimos 7 dias' };
    if (filtro === 'ano') return { ini: dataLocal(ano, 0, 1), fim: dataLocal(ano + 1, 0, 1), label: 'Este ano' };
    var escolhido = /^custom-(\d{4})-(\d{2})$/.exec(typeof filtro === 'string' ? filtro : '');
    if (escolhido && Number(escolhido[2]) >= 1 && Number(escolhido[2]) <= 12) {
      var inicio = dataLocal(Number(escolhido[1]), Number(escolhido[2]) - 1, 1);
      var nome = inicio.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return { ini: inicio, fim: dataLocal(Number(escolhido[1]), Number(escolhido[2]), 1), label: nome.charAt(0).toUpperCase() + nome.slice(1) };
    }
    return { ini: dataLocal(ano, mes, 1), fim: dataLocal(ano, mes + 1, 1), label: 'Este mês' };
  }

  function mesesDisponiveis(registros, agora) {
    var colecoes = registros || {}, meses = Object.create(null);
    function incluir(valor) {
      var registroData = data(valor);
      if (registroData) meses[String(registroData.getFullYear()).padStart(4, '0') + '-' + String(registroData.getMonth() + 1).padStart(2, '0')] = true;
    }
    incluir(data(agora) || new Date());
    ['historico', 'despesas', 'perdas', 'bensEmpresa'].forEach(function (chave) {
      (Array.isArray(colecoes[chave]) ? colecoes[chave] : []).forEach(function (registro) {
        if (registro) incluir(chave === 'historico' ? registro.finalizadoEm || registro.data : registro.data);
      });
    });
    return Object.keys(meses).sort().reverse();
  }

  return { periodo: periodo, data: data, mesesDisponiveis: mesesDisponiveis };
});
