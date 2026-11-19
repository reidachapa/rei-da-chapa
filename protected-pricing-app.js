(function () {
  'use strict';
  const api = window.PrecoProtegido;
  const colecoes = { prod: 'produtos', ing: 'ingredientes', pao: 'paes' };
  let contexto = null, ocupado = false;

  function ehReceita(tipo, item) {
    return tipo === 'prod' && (tipoCadastroProduto(item) !== 'proprio' || item.pao ||
      Object.values(item.ingredientes || {}).some(qtd => Number(qtd) > 0));
  }

  function opcoes(tipo, item) {
    if (tipo !== 'ing') return { vinculo: tipo + ':' + item.id, saldo: item.estoque, unidade: 'un.', multiplicador: 1 };
    const interna = unidadeFisicaEstoqueIngrediente(item) || 'un.';
    const unidade = /^(g|mg|kg)$/.test(interna) ? 'kg' : /^(ml|l)$/.test(interna) ? 'l' : interna;
    const saldo = item.semEstoque ? item.estoqueEstimado : item.estoque;
    const porMedida = interna === unidade ? 1 : window.EstoqueIngredientes.converter(1, unidade, interna);
    return { vinculo: 'ing:' + item.id, saldo, unidade: item.consumoMedia ? 'uso' : unidade,
      multiplicador: item.consumoMedia ? Number(item.fatorConsumoMedia) : porMedida,
      saldoPorUnidade: porMedida, unidadeSaldo: unidade };
  }

  function calcular(tipo, item, loja) {
    if (!ehReceita(tipo, item)) {
      const medidas = opcoes(tipo, item);
      return api.calcular(item, loja.despesas, medidas);
    }
    if (!item.precoProtegido) return { status: 'desativado' };
    let custo = 0, componentes = 0;
    const qtdPorLote = ehRefeicao(item) ? Number(item.rendimentoLote) || 1 : 1;
    for (const [id, qtd] of Object.entries(item.ingredientes || {})) {
      if (!(Number(qtd) > 0)) continue;
      const ing = procurar(loja, 'ing', id);
      const info = ing && calcular('ing', ing, loja);
      if (info?.status !== 'ok') return { status: 'conferir' };
      const consumo = ing.consumoMedia ? opcoes('ing', ing).multiplicador : 1;
      custo += info.custoProtegido * consumo * Number(qtd) / qtdPorLote;
      componentes++;
    }
    if (item.pao) {
      const pao = procurar(loja, 'pao', item.pao);
      const info = pao && calcular('pao', pao, loja);
      if (info?.status !== 'ok') return { status: 'conferir' };
      custo += info.custoProtegido;
      componentes++;
    }
    const preco = api.sugerir(custo, item.precoProtegido.percentual);
    return componentes && preco !== null
      ? { status: 'ok', custoProtegido: custo, preco, lotes: [] } : { status: 'conferir' };
  }

  function lojaLocal() {
    return { produtos, ingredientes, paes, despesas };
  }

  function procurar(loja, tipo, id) {
    const lista = loja?.[colecoes[tipo]];
    return Array.isArray(lista) && lista.find(item => String(item.id) === String(id));
  }

  function precoAtual(tipo, item, medidas) {
    return (Number(tipo === 'ing' ? item.precoExtra : item.preco) || 0) *
      (tipo === 'ing' && !item.consumoMedia ? medidas.multiplicador : 1);
  }

  const modal = document.createElement('div');
  modal.id = 'modalPrecoProtegido';
  modal.className = 'modal';
  modal.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="precoProtegidoTitulo">' +
    '<h3 id="precoProtegidoTitulo">Preço protegido</h3><p id="precoProtegidoNome"></p>' +
    '<div id="precoProtegidoResumo"></div>' +
    '<div class="campo"><label for="protecaoPercentual">Acréscimo sobre o custo (%)</label>' +
    '<input id="protecaoPercentual" inputmode="decimal" type="text" placeholder="Ex.: 25"></div>' +
    '<div id="protecaoContagem" hidden><p id="protecaoSaldo"></p>' +
    '<div class="campo"><label id="protecaoQtdLabel" for="protecaoQtd">Quantidade conferida</label>' +
    '<input id="protecaoQtd" inputmode="decimal" type="text"></div>' +
    '<div class="campo" id="protecaoCustoCampo"><label id="protecaoCustoLabel" for="protecaoCusto">Maior custo do estoque atual</label>' +
    '<input id="protecaoCusto" inputmode="decimal" type="text" placeholder="Ex.: 12,00"></div></div>' +
    '<p id="protecaoFeedback" role="status"></p><div class="modal-acoes" style="flex-wrap:wrap">' +
    '<button type="button" class="btn-fantasma" id="fecharProtecao">Fechar</button>' +
    '<button type="button" class="btn-fantasma" id="salvarProtecao">Salvar configuração</button>' +
    '<button type="button" class="btn-primario" id="aplicarProtecao" hidden>Aplicar preço</button></div></div>';
  document.body.appendChild(modal);
  const el = id => document.getElementById(id);
  const decimal = valor => {
    const texto = String(valor || '').trim();
    return /^\d+(?:[,.]\d+)?$/.test(texto) ? Number(texto.replace(',', '.')) : NaN;
  };
  const formatarQuantidade = valor => Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 8 });

  function fechar() {
    if (ocupado) return;
    modal.classList.remove('aberto');
    contexto = null;
  }

  function render() {
    if (!contexto || !modal.classList.contains('aberto')) return;
    if (!souGerente() || contexto.loja !== lojaAtivaId) { fechar(); return; }
    const { tipo, id } = contexto, loja = lojaLocal(), item = procurar(loja, tipo, id);
    if (!item) { fechar(); return; }
    const receita = ehReceita(tipo, item);
    const resultado = calcular(tipo, item, loja);
    const medidas = opcoes(tipo, item), porUnidade = medidas.saldoPorUnidade || 1;
    const sufixo = tipo === 'ing' ? ' por ' + medidas.unidade : ' por unidade';
    const atual = precoAtual(tipo, item, medidas);
    const precisaConferir = !receita && ['conferir', 'desativado'].includes(resultado.status);
    const semSaldo = medidas.saldo === null || medidas.saldo === undefined || medidas.saldo === '';
    const resumo = el('precoProtegidoResumo');
    resumo.replaceChildren();
    function linha(texto, destaque) {
      const tag = document.createElement(destaque ? 'strong' : 'p');
      tag.textContent = texto;
      resumo.appendChild(tag);
    }
    el('precoProtegidoNome').textContent = item.nome;
    linha((tipo === 'ing' ? 'Adicional atual' : 'Preço atual') + ' · ' + (Number.isFinite(atual) ? moeda(atual) : '—') + sufixo);
    if (resultado.status === 'ok') {
      const custo = resultado.custoProtegido * (receita ? 1 : medidas.multiplicador);
      linha('Custo de referência · ' + moeda(custo) + sufixo);
      linha(resultado.preco > 0 ? 'Sugestão · ' + moeda(resultado.preco) + sufixo : 'O estoque restante tem custo de compra zero.', true);
      if (resultado.preco > 0 && atual + 0.000001 < resultado.preco) linha('O preço atual está abaixo da sugestão protegida.');
      for (const lote of resultado.lotes) {
        linha('Lote com ' + formatarQuantidade(lote.qtd / porUnidade) + ' ' + (medidas.unidadeSaldo || 'un.') +
          ' restantes · ' + moeda(lote.custo * porUnidade) + ' por ' + (medidas.unidadeSaldo || 'un.'));
      }
    } else if (resultado.status === 'semEstoque') linha('A próxima compra vai definir o novo custo de referência.');
    else if (receita) linha('A sugestão usa os custos protegidos do pão e dos ingredientes da receita. Ative e confira cada componente.');
    else linha(semSaldo ? 'Faça a contagem do estoque antes de ativar a proteção.' :
      'Confirme a quantidade e o maior custo unitário das mercadorias que ainda estão no estoque.');
    if (tipo === 'ing' && item.semEstoque) linha('O saldo é estimado. Confira fisicamente os lotes antes de aceitar uma redução.');
    if (tipo === 'ing' || tipo === 'pao') linha('Para mudar o preço do lanche, revise também o Preço protegido do lanche.');
    if (receita && resultado.status === 'ok') linha('Sugestão para a receita cadastrada.');
    el('protecaoContagem').hidden = !precisaConferir;
    el('protecaoCustoCampo').hidden = !(Number(medidas.saldo) > 0);
    el('protecaoSaldo').textContent = semSaldo ? 'Saldo ainda não informado.' :
      'Saldo no app · ' + formatarQuantidade(Number(medidas.saldo) / porUnidade) + ' ' + (medidas.unidadeSaldo || 'un.');
    el('protecaoQtdLabel').textContent = 'Quantidade conferida (' + (medidas.unidadeSaldo || 'un.') + ')';
    el('protecaoCustoLabel').textContent = 'Maior custo atual (R$ por ' + (medidas.unidadeSaldo || 'un.') + ')';
    const aplicar = el('aplicarProtecao');
    aplicar.hidden = resultado.status !== 'ok' || !(resultado.preco > 0) || Math.abs(resultado.preco - atual) < 0.000001;
    aplicar.textContent = (tipo === 'ing' ? 'Aplicar adicional ' : 'Aplicar preço ') + (resultado.preco > 0 ? moeda(resultado.preco) : '');
    aplicar.dataset.valor = resultado.preco > 0 ? String(resultado.preco) : '';
    aplicar.disabled = ocupado;
    el('salvarProtecao').disabled = ocupado || (precisaConferir && semSaldo);
  }

  function abrir(tipo, id) {
    if (!souGerente() || ocupado) return;
    const item = procurar(lojaLocal(), tipo, id);
    if (!item) return;
    contexto = { tipo, id, loja: lojaAtivaId };
    el('protecaoPercentual').value = item.precoProtegido ? String(item.precoProtegido.percentual).replace('.', ',') : '';
    el('protecaoQtd').value = '';
    el('protecaoCusto').value = '';
    el('protecaoFeedback').textContent = '';
    modal.classList.add('aberto');
    render();
  }

  async function gravar(acao) {
    if (ocupado || !contexto || !souGerente() || contexto.loja !== lojaAtivaId) return;
    const feedback = el('protecaoFeedback');
    try {
      if (!window.__authPermitido || !supa || !ultimaAtualizacao || !estadoBaseSincronizado ||
          estadoLocalSujo || salvandoRemoto || compraNotaEmAndamento || window.__compraTemRascunhoAtivo?.()) {
        throw new Error('Aguarde o estoque sincronizar antes de confirmar.');
      }
      const { tipo, id, loja: lojaId } = contexto, versao = ultimaAtualizacao, revisao = revisaoLocal;
      const dados = clonarDadosEstado(estadoBaseSincronizado), loja = dados.porLoja[lojaId];
      const item = procurar(loja, tipo, id), local = procurar(lojaLocal(), tipo, id);
      if (!item || !dadosIguais(item, local)) throw new Error('O cadastro mudou. Confira os dados sincronizados.');
      const resultado = calcular(tipo, item, loja), medidas = opcoes(tipo, item);
      if (acao === 'aplicar') {
        const escolhido = Number(el('aplicarProtecao').dataset.valor);
        if (resultado.status !== 'ok' || !(escolhido > 0) || escolhido !== resultado.preco) {
          throw new Error('A sugestão mudou. Confira o novo preço antes de aplicar.');
        }
        if (tipo === 'ing') item.precoExtra = item.consumoMedia ? escolhido : escolhido / medidas.multiplicador;
        else item.preco = escolhido;
      } else {
        const percentual = decimal(el('protecaoPercentual').value);
        if (!Number.isFinite(percentual)) throw new Error('Informe o percentual sobre o custo.');
        if (ehReceita(tipo, item)) item.precoProtegido = { percentual, receita: true };
        else if (resultado.status === 'ok' || resultado.status === 'semEstoque') {
          item.precoProtegido = { ...item.precoProtegido, percentual };
        } else {
          const porUnidade = medidas.saldoPorUnidade || 1;
          const qtd = decimal(el('protecaoQtd').value) * porUnidade;
          const custo = Number(medidas.saldo) === 0 ? 0 : decimal(el('protecaoCusto').value) / porUnidade;
          if (medidas.saldo == null || !Number.isFinite(qtd) || Math.abs(qtd - Number(medidas.saldo)) > 1e-8 * porUnidade) {
            throw new Error('A quantidade conferida deve bater com o saldo do app. Corrija o estoque se houver diferença.');
          }
          item.precoProtegido = api.iniciar(item, loja.despesas, custo, percentual, medidas);
        }
      }
      ocupado = true;
      feedback.textContent = 'Confirmando no Supabase…';
      render();
      const agora = new Date(Math.max(Date.now(), Date.parse(versao) + 1)).toISOString();
      const { data, error } = await supa.from('estado').update({ dados, atualizado_em: agora })
        .eq('id', 'atual').eq('atualizado_em', versao).select('id');
      if (error) throw new Error('O Supabase não confirmou a alteração. Atualize os dados para conferir.');
      if (!data?.length) throw new Error('Outro aparelho atualizou o estoque. Atualize os dados e confira a sugestão novamente.');
      if (versao === ultimaAtualizacao && revisao === revisaoLocal && !estadoLocalSujo && !salvandoRemoto) {
        ultimaAtualizacao = agora;
        estadoBaseSincronizado = clonarDadosEstado(dados);
        aplicarDadosEstadoAtual(dados);
      }
      feedback.textContent = acao === 'aplicar' ? 'Preço confirmado no servidor.' : 'Configuração confirmada no servidor.';
    } catch (erro) {
      feedback.textContent = erro.message || 'Não consegui confirmar a alteração.';
    } finally {
      ocupado = false;
      render();
    }
  }

  el('fecharProtecao').addEventListener('click', fechar);
  el('salvarProtecao').addEventListener('click', () => gravar('configurar'));
  el('aplicarProtecao').addEventListener('click', () => gravar('aplicar'));
  document.addEventListener('click', event => {
    const botao = event.target.closest('[data-preco-protegido]');
    if (botao) abrir(botao.dataset.precoProtegido, botao.dataset.id);
    if (event.target === modal) fechar();
  });
  window.atualizarPainelPrecoProtegido = render;
  window.botaoPrecoProtegido = (tipo, item) => {
    if (!souGerente() || item.isIng) return '';
    const resultado = item.precoProtegido && calcular(tipo, item, lojaLocal());
    const atual = resultado?.status === 'ok' ? precoAtual(tipo, item, opcoes(tipo, item)) : 0;
    let rotulo = 'Preço protegido';
    let alerta = '';
    if (resultado?.status === 'conferir') rotulo = 'Conferir preço protegido';
    if (resultado?.preco > 0 && Math.abs(resultado.preco - atual) > 0.000001) {
      rotulo = 'Sugestão: ' + moeda(resultado.preco);
      alerta = resultado.preco > atual ? ' class="preco-protegido-alerta"' : '';
    }
    return '<button type="button"' + alerta + ' data-preco-protegido="' + tipo +
      '" data-id="' + esc(item.id) + '">' + esc(rotulo) + '</button>';
  };
})();
