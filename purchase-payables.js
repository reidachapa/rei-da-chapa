(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VencimentosCompras = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const diaMs = 86400000;

  function instanteData(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
    const data = new Date(valor + 'T00:00:00Z');
    return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === valor ? data.getTime() : null;
  }

  function dataValida(valor) {
    return instanteData(valor) !== null;
  }

  function somarDias(data, dias) {
    const instante = instanteData(data);
    if (instante === null || !Number.isInteger(dias)) return '';
    const resultado = new Date(instante + dias * diaMs);
    if (!Number.isFinite(resultado.getTime())) return '';
    const iso = resultado.toISOString().slice(0, 10);
    return dataValida(iso) ? iso : '';
  }

  function formatarData(data) {
    return dataValida(data) ? data.split('-').reverse().join('/') : '';
  }

  function listarPendentes(notas, hoje) {
    const agora = instanteData(hoje);
    return (Array.isArray(notas) ? notas : [])
      .filter(nota => nota && nota.id != null && nota.status === 'pendente' && nota.tipoRegistro !== 'despesa')
      .map(nota => {
        const data = instanteData(nota.vencimento);
        const dias = data === null || agora === null ? null : (data - agora) / diaMs;
        const situacao = dias === null ? 'semData' : dias < 0 ? 'vencido' : dias === 0 ? 'hoje' :
          dias <= 7 ? 'proximo' : 'futuro';
        return { nota, dias, situacao };
      })
      .sort((a, b) => (a.dias ?? Infinity) - (b.dias ?? Infinity) ||
        String(a.nota.data || '').localeCompare(String(b.nota.data || '')) ||
        String(a.nota.id).localeCompare(String(b.nota.id)));
  }

  return { dataValida, somarDias, formatarData, listarPendentes };
});
