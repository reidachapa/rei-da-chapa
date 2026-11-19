(function () {
  'use strict';
  const api = window.VencimentosCompras;
  const campoData = document.getElementById('despData');
  const campoVencimento = document.getElementById('despVencimento');
  const campoStatus = document.getElementById('despStatus');
  const alerta = document.getElementById('btnProximoVencimentoCompra');
  const botaoLista = document.getElementById('btnComprasAPagar');
  const modal = document.getElementById('modalComprasAPagar');
  const lista = document.getElementById('listaComprasAPagar');
  const aviso = document.getElementById('avisoVencimentoCompra');
  let notaEmAviso = null;
  let diaExibido = '';

  function atualizarCamposPagamento() {
    const pendente = campoStatus.value === 'pendente';
    campoVencimento.min = campoData.value;
    document.getElementById('campoVencimentoCompra').hidden =
      !pendente && !campoVencimento.value;
    document.getElementById('campoOrigemPagamentoCompra').hidden = pendente;
  }
  window.atualizarCamposPagamentoCompra = atualizarCamposPagamento;
  campoStatus.addEventListener('change', atualizarCamposPagamento);
  campoData.addEventListener('change', atualizarCamposPagamento);
  campoVencimento.addEventListener('change', atualizarCamposPagamento);
  document.getElementById('btnVencimento30Dias').addEventListener('click', () => {
    const data = api.somarDias(campoData.value, 30);
    if (!data) return toast('Informe a data da compra primeiro.');
    campoVencimento.value = data;
    campoVencimento.dispatchEvent(new Event('change', { bubbles: true }));
  });

  function naListaDeCompras(nota) {
    return nota && (nota.tipoRegistro === 'compra' || !ehDespesaAvulsa(nota));
  }

  function abrirNota(id) {
    if (!souGerente() || id == null) return;
    const nota = despesas.find(n => naListaDeCompras(n) && String(n.id) === String(id) && n.status === 'pendente');
    if (!nota) {
      renderizar();
      return toast('Esta nota já saiu da lista de compras a pagar.');
    }
    modal.classList.remove('aberto');
    window.abrirModalDespesa(nota);
  }

  function textoPrazo(item) {
    const formatos = { vencido: 'Vencido em ', hoje: 'Vence hoje, ', proximo: 'Vence em ', futuro: 'Vence em ' };
    return item.situacao === 'semData' ? 'Sem vencimento informado' :
      formatos[item.situacao] + api.formatarData(item.nota.vencimento);
  }

  function desenharLista(pendentes) {
    lista.replaceChildren();
    if (!pendentes.length) {
      const vazio = document.createElement('p');
      vazio.className = 'dre-vazio';
      vazio.textContent = 'Nenhuma compra a pagar.';
      lista.appendChild(vazio);
      return;
    }
    const fragmento = document.createDocumentFragment();
    pendentes.forEach(item => {
      const nota = item.nota, botao = document.createElement('button');
      const titulo = document.createElement('strong'), valor = document.createElement('span');
      const datas = document.createElement('small'), prazo = document.createElement('span');
      botao.type = 'button';
      botao.className = 'compra-a-pagar';
      botao.dataset.notaPendente = String(nota.id);
      titulo.textContent = nota.fornecedor || nota.descricao || 'Compra';
      valor.textContent = moeda(Number(nota.valor) || 0);
      datas.textContent = [nota.nf ? 'NF ' + nota.nf : '', api.formatarData(nota.data) ? 'Compra em ' + api.formatarData(nota.data) : ''].filter(Boolean).join(' · ');
      prazo.className = 'compra-prazo compra-prazo-' + item.situacao;
      prazo.textContent = textoPrazo(item);
      botao.append(titulo, valor, datas, prazo);
      fragmento.appendChild(botao);
    });
    lista.appendChild(fragmento);
  }

  function renderizar() {
    if (!souGerente()) {
      notaEmAviso = null;
      alerta.hidden = true;
      modal.classList.remove('aberto');
      lista.replaceChildren();
      return;
    }
    const hoje = window.CaixaMensal.diaBrasil(new Date());
    diaExibido = hoje;
    const pendentes = api.listarPendentes(despesas.filter(naListaDeCompras), hoje);
    const proxima = pendentes.find(item => item.dias !== null);
    botaoLista.textContent = pendentes.length ? 'Compras a pagar (' + pendentes.length + ')' : 'Compras a pagar';
    notaEmAviso = proxima ? proxima.nota.id : null;
    alerta.hidden = !proxima;
    if (proxima) {
      alerta.dataset.situacao = proxima.situacao;
      aviso.textContent = textoPrazo(proxima);
      alerta.setAttribute('aria-label', aviso.textContent + ', abrir nota de ' + (proxima.nota.fornecedor || 'compra'));
    }
    if (modal.classList.contains('aberto')) desenharLista(pendentes);
  }

  window.renderVencimentosCompra = renderizar;
  alerta.addEventListener('click', () => abrirNota(notaEmAviso));
  botaoLista.addEventListener('click', () => {
    if (!souGerente()) return;
    modal.classList.add('aberto');
    renderizar();
    document.getElementById('btnFecharComprasAPagar').focus();
  });
  lista.addEventListener('click', evento => {
    const botao = evento.target.closest('[data-nota-pendente]');
    if (botao) abrirNota(botao.dataset.notaPendente);
  });
  document.getElementById('btnFecharComprasAPagar').addEventListener('click', () => {
    modal.classList.remove('aberto');
    botaoLista.focus();
  });
  modal.addEventListener('click', evento => {
    if (evento.target === modal) modal.classList.remove('aberto');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderizar();
  });
  window.setInterval(() => {
    if (!document.hidden && souGerente() && diaExibido !== window.CaixaMensal.diaBrasil(new Date())) renderizar();
  }, 60000);
})();
