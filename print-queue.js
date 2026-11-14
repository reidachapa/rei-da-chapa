(function instalarFilaCompartilhadaImpressao() {
  'use strict';

  const TABLE = 'fila_impressao';
  const STATION_TABLE = 'fila_impressao_estacoes';
  const LEASE_SECONDS = 60;
  const STATION_KEY = 'rei_chapa_estacao_impressao_v1';
  const OUTBOX_KEY = 'rei_chapa_fila_impressao_outbox_v1';
  const STATUS = {
    pendente: ['🕒', 'Na fila', '#e5b83f'],
    imprimindo: ['🖨️', 'Imprimindo', '#55a4e8'],
    impresso: ['✅', 'Impresso', '#3fb972'],
    conferir: ['⚠️', 'Conferir papel', '#f0a840']
  };
  let idEstacao = localStorage.getItem(STATION_KEY);
  if (!idEstacao) {
    idEstacao = window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'station_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem(STATION_KEY, idEstacao);
  }
  const nomeEstacao = /Android/i.test(navigator.userAgent) ? 'Celular Android' : (navigator.platform || 'Computador');
  let estacaoAtiva = false;
  let lojaEstacao = null;
  let modoEstacao = 'sistema';
  let processando = false;
  let atualizandoPainel = false;
  let ultimoSaveFila = null;
  let sequenciaSaveFila = 0;

  function elemento(id) { return document.getElementById(id); }
  function toastFila(texto) { if (typeof window.toast === 'function') window.toast(texto); else console.info(texto); }
  function aguardar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function clonarJson(valor) { return JSON.parse(JSON.stringify(valor)); }
  function lojaAtualFila() { return String(typeof lojaAtivaId !== 'undefined' && lojaAtivaId ? lojaAtivaId : 'l1'); }
  function clienteSupabaseDisponivel() { return !!(window.__authPermitido && typeof supa !== 'undefined' && supa); }
  function mostrarErro(error) { return error && (error.message || error.details || error.hint) || 'Falha na fila de impressão.'; }

  function montarSnapshotPedido(pedido, tipo) {
    const campos = [
      'id', 'numero', 'numeroDia', 'data', 'finalizadoEm', 'tipo', 'cliente', 'clienteNumero',
      'telefone', 'endereco', 'enderecoNumero', 'enderecoBairro', 'motoboyNome', 'obs',
      'subtotal', 'subtotalBruto', 'descontoPedido', 'desconto', 'taxaEntrega', 'total',
      'pagamento', 'pagamentos', 'pago', 'troco'
    ];
    const ticket = {};
    campos.forEach(campo => {
      if (pedido[campo] !== undefined) ticket[campo] = clonarJson(pedido[campo]);
    });
    ticket.itens = (pedido.itens || []).map(item => ({
      qtd: item.qtd, nome: item.nome, paoNome: item.paoNome, preco: item.preco
    }));
    if (pedido.ultimaAlteracaoPedido) ticket.ultimaAlteracaoPedido = clonarJson(pedido.ultimaAlteracaoPedido);
    return { id: String(pedido.id), numero: pedido.numero, numeroDia: pedido.numeroDia, ticket };
  }

  function chaveOutboxEvento(chaveEvento) { return OUTBOX_KEY + ':' + encodeURIComponent(String(chaveEvento)); }
  function lerOutbox() {
    const pendentes = new Map();
    try {
      const antigos = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
      if (Array.isArray(antigos)) antigos.forEach(function (registro, indice) {
        if (registro && registro.chave_evento) pendentes.set(String(registro.chave_evento), {
          registro: registro, storageKey: OUTBOX_KEY, criadoLocal: indice
        });
      });
      const chaves = [];
      for (let i = 0; i < localStorage.length; i++) {
        const chave = localStorage.key(i);
        if (chave && chave.startsWith(OUTBOX_KEY + ':')) chaves.push(chave);
      }
      chaves.forEach(function (chave) {
        try {
          const salvo = JSON.parse(localStorage.getItem(chave) || 'null');
          const registro = salvo && salvo.registro ? salvo.registro : salvo;
          if (registro && registro.chave_evento) pendentes.set(String(registro.chave_evento), {
            registro: registro, storageKey: chave, criadoLocal: Number(salvo && salvo.criadoLocal) || 0
          });
        } catch (_) {}
      });
    } catch (_) {}
    return Array.from(pendentes.values()).sort((a, b) => a.criadoLocal - b.criadoLocal);
  }
  function gravarOutboxItem(registro) {
    const chave = chaveOutboxEvento(registro.chave_evento);
    if (!localStorage.getItem(chave)) localStorage.setItem(chave, JSON.stringify({ registro: registro, criadoLocal: Date.now() }));
  }
  function removerOutboxItem(item) {
    if (item.storageKey !== OUTBOX_KEY) {
      localStorage.removeItem(item.storageKey);
      return;
    }
    try {
      const antigos = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
      const restantes = Array.isArray(antigos) ? antigos.filter(registro => String(registro.chave_evento) !== String(item.registro.chave_evento)) : [];
      if (restantes.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(restantes));
      else localStorage.removeItem(OUTBOX_KEY);
    } catch (error) { console.warn('Não consegui limpar o envio antigo da fila:', error); }
  }

  async function enfileirar(tipo, pedido, chaveEvento, lojaId) {
    if (!clienteSupabaseDisponivel()) throw new Error('O app ainda não confirmou a conexão com o servidor. A ficha não foi enviada à fila.');
    const store = String(lojaId || lojaAtualFila());
    const snapshot = montarSnapshotPedido(pedido, tipo);
    const registro = {
      loja_id: store, chave_evento: String(chaveEvento), pedido_id: snapshot.id,
      tipo: tipo, payload: snapshot, status: 'pendente'
    };
    gravarOutboxItem(registro);
    const sincronizacao = await tentarOutbox(store);
    const aindaPendente = lerOutbox().some(item => item.registro.chave_evento === registro.chave_evento);
    return {
      repetido: sincronizacao.repetidos.has(registro.chave_evento),
      id: sincronizacao.ids.get(registro.chave_evento) || null,
      guardadoLocal: aindaPendente
    };
  }

  async function enfileirarAposSalvar(tipo, pedido, chaveEvento, promiseSave, lojaId) {
    let resultado;
    try { resultado = await Promise.resolve(promiseSave); }
    catch (error) { toastFila('⚠️ Não consegui confirmar o pedido no servidor; não enviei a ficha para impressão.'); return; }
    if (!resultado || !resultado.ok) {
      toastFila('⚠️ O pedido ainda não foi confirmado no servidor; a ficha não entrou na fila. Mantenha o app aberto e tente sincronizar.');
      return;
    }
    try {
      const info = await enfileirar(tipo, pedido, chaveEvento, lojaId);
      toastFila(info.repetido ? '🖨️ Esta ficha já está na fila.' : info.guardadoLocal
        ? '⚠️ Ficha guardada neste aparelho e será enviada à fila na ordem quando a conexão voltar.'
        : '🖨️ Ficha adicionada à fila compartilhada.');
      atualizarPainelFila();
    } catch (error) {
      console.warn('Falha ao enfileirar ficha:', error);
      toastFila(error && error.guardadoLocal
        ? '⚠️ Pedido salvo; a ficha ficou guardada neste aparelho e será enviada à fila quando houver conexão.'
        : '⚠️ Pedido salvo, mas não consegui guardar a ficha para reenvio. Reimprima o pedido quando a conexão voltar.');
    }
  }

  let sincronizandoOutbox = false;
  async function tentarOutbox(lojaIdFiltro) {
    const sincronizacao = { completo: false, repetidos: new Set(), ids: new Map() };
    if (!clienteSupabaseDisponivel() || !navigator.onLine || sincronizandoOutbox) return sincronizacao;
    const pendentes = lerOutbox().filter(item => !lojaIdFiltro || String(item.registro.loja_id) === String(lojaIdFiltro));
    if (!pendentes.length) { sincronizacao.completo = true; return sincronizacao; }
    sincronizandoOutbox = true;
    let houveAlteracao = false;
    let completo = true;
    const lojasComFalha = new Set();
    try {
      for (const item of pendentes) {
        const lojaItem = String(item.registro.loja_id);
        if (lojasComFalha.has(lojaItem)) { completo = false; continue; }
        try {
          const { data, error } = await supa.from(TABLE).insert(item.registro).select('id').maybeSingle();
          if (error && error.code !== '23505') { completo = false; lojasComFalha.add(lojaItem); continue; }
          if (error && error.code === '23505') sincronizacao.repetidos.add(String(item.registro.chave_evento));
          else if (data && data.id) sincronizacao.ids.set(String(item.registro.chave_evento), data.id);
          removerOutboxItem(item);
          houveAlteracao = true;
        } catch (_) { completo = false; lojasComFalha.add(lojaItem); }
      }
      if (houveAlteracao) atualizarPainelFila();
    } finally { sincronizandoOutbox = false; }
    sincronizacao.completo = completo && !lerOutbox().some(item => !lojaIdFiltro || String(item.registro.loja_id) === String(lojaIdFiltro));
    return sincronizacao;
  }

  async function rpc(nome, parametros) {
    if (!clienteSupabaseDisponivel()) throw new Error('Conecte o app ao Supabase para usar a fila.');
    const { data, error } = await supa.rpc(nome, parametros);
    if (error) throw error;
    return data;
  }
  function primeiraLinha(data) { return Array.isArray(data) ? data[0] || null : data; }

  async function lerEstacao(store) {
    const { data, error } = await supa.from(STATION_TABLE)
      .select('estacao_id,nome_estacao,lease_ate')
      .eq('loja_id', store).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function reservarEstacao() {
    if (!clienteSupabaseDisponivel()) throw new Error('Conecte o app ao Supabase antes de ativar a fila.');
    const store = lojaAtualFila();
    const data = primeiraLinha(await rpc('fila_impressao_reservar_estacao', {
      p_loja_id: store, p_estacao_id: idEstacao, p_nome_estacao: nomeEstacao, p_lease_segundos: LEASE_SECONDS
    }));
    if (!data || data.reservada !== true) {
      const atual = await lerEstacao(store).catch(() => null);
      const nome = atual && atual.nome_estacao ? ' (' + atual.nome_estacao + ')' : '';
      throw new Error('A fila já está ativa em outro aparelho' + nome + '. Libere a estação atual antes de trocar.');
    }
    estacaoAtiva = true;
    lojaEstacao = store;
    if (/Android/i.test(navigator.userAgent)) modoEstacao = 'sistema';
    else modoEstacao = printerState && printerState.conectado ? 'escpos' : 'sistema';
    atualizarBotoesEstacao();
    iniciarMonitorFila();
    await atualizarPainelFila();
    toastFila(modoEstacao === 'sistema'
      ? '📲 Estação ativa. Use “Imprimir próxima” e escolha Bluetooth Print/Thermer no diálogo.'
      : '🖨️ Estação ativa. As fichas vão sair uma por vez pela fila.');
  }

  async function liberarEstacao() {
    if (!estacaoAtiva || !lojaEstacao) return;
    try { await rpc('fila_impressao_liberar_estacao', { p_loja_id: lojaEstacao, p_estacao_id: idEstacao }); }
    catch (error) { console.warn('Falha ao liberar a estação:', error); }
    estacaoAtiva = false;
    lojaEstacao = null;
    atualizarBotoesEstacao();
    atualizarPainelFila();
  }

  async function renovarEstacao() {
    if (!estacaoAtiva || !lojaEstacao || document.hidden) return;
    try {
      const ok = await rpc('fila_impressao_renovar_estacao', {
        p_loja_id: lojaEstacao, p_estacao_id: idEstacao, p_lease_segundos: LEASE_SECONDS
      });
      if (ok !== true) {
        estacaoAtiva = false;
        lojaEstacao = null;
        atualizarBotoesEstacao();
        toastFila('⚠️ Esta estação perdeu a reserva da impressora. Nenhum próximo pedido será iniciado aqui.');
      }
    } catch (error) { console.warn('Falha ao renovar a estação:', error); }
  }

  function nomeStatus(status) { const info = STATUS[status] || ['•', status || '—', '#aaa']; return '<span style="color:' + info[2] + ';font-weight:800">' + info[0] + ' ' + info[1] + '</span>'; }
  function escapar(texto) { return String(texto == null ? '' : texto).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  async function atualizarPainelFila() {
    if (atualizandoPainel || !clienteSupabaseDisponivel()) return;
    const lista = elemento('filaImpressaoLista');
    const resumo = elemento('filaImpressaoResumo');
    if (!lista || !resumo) return;
    atualizandoPainel = true;
    try {
      const store = lojaAtualFila();
      const [{ data: jobs, error }, estacao] = await Promise.all([
        supa.from(TABLE).select('id,pedido_id,tipo,status,criado_em,tentativas,erro,payload,estacao_id')
          .eq('loja_id', store).in('status', ['pendente', 'imprimindo', 'conferir']).order('criado_em', { ascending: true }).limit(60),
        lerEstacao(store)
      ]);
      if (error) throw error;
      const leaseValido = estacao && estacao.estacao_id && new Date(estacao.lease_ate).getTime() > Date.now();
      const contagem = (jobs || []).filter(j => ['pendente', 'imprimindo', 'conferir'].includes(j.status)).length;
      resumo.innerHTML = (leaseValido
        ? 'Estação ativa: <b>' + escapar(estacao.nome_estacao || 'Outro aparelho') + '</b>' + (estacao.estacao_id === idEstacao ? ' · este aparelho' : '')
        : 'Nenhuma estação ativa') + ' · ' + contagem + ' ficha(s) aguardando/conferência';
      atualizarBotoesEstacao(leaseValido, estacao);
      const visiveis = (jobs || []).filter(j => ['pendente', 'imprimindo', 'conferir'].includes(j.status)).slice(0, 12);
      if (!visiveis.length) {
        lista.innerHTML = '<div style="padding:8px 4px;color:var(--muted);font-size:11px">Fila vazia. Os próximos pedidos entram aqui automaticamente.</div>';
      } else {
        lista.innerHTML = visiveis.map(function (job) {
          const numero = job.payload && typeof numeroPedidoExibicao === 'function' ? numeroPedidoExibicao(job.payload) : '#' + (job.pedido_id || '?');
          const tipo = job.tipo === 'alteracao' ? 'Alteração' : job.tipo === 'reimpressao' ? 'Reimpressão' : 'Pedido';
          const data = job.criado_em ? new Date(job.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
          const podeReenviar = job.status === 'conferir' && estacaoAtiva && lojaEstacao === store;
          const podeConfirmar = podeReenviar && job.estacao_id === idEstacao;
          const acoesConferencia = podeReenviar ? '<div style="display:flex;gap:6px;margin-top:6px">' + (podeConfirmar ? '<button type="button" data-fila-confirmar="' + escapar(job.id) + '" style="flex:1;background:#268b54;color:#fff;border:0;border-radius:7px;padding:7px;font-weight:800">✅ Saiu o papel</button>' : '') + '<button type="button" data-fila-reenviar="' + escapar(job.id) + '" style="flex:1;background:#386fa5;color:#fff;border:0;border-radius:7px;padding:7px;font-weight:800">↻ Reenviar</button></div>' : '';
          const acaoExcluir = job.status === 'pendente' ? '<button type="button" data-fila-excluir="' + escapar(job.id) + '" data-fila-excluir-nome="' + escapar(tipo + ' ' + numero) + '" style="margin-top:6px;background:#842e35;color:#fff;border:1px solid #a94149;border-radius:7px;padding:6px 9px;font-weight:800;font-size:10px">🗑 Tirar da fila</button>' : '';
          const detalhe = job.status === 'conferir' && job.erro ? '<div style="font-size:10px;color:#e6b653;margin-top:3px">' + escapar(job.erro) + '</div>' : '';
          return '<div style="border:1px solid var(--iron-5);border-radius:8px;padding:7px 8px;margin:5px 0;background:rgba(0,0,0,.13)"><div style="display:flex;justify-content:space-between;gap:8px;font-size:11px"><b>' + escapar(tipo + ' ' + numero) + '</b><span>' + nomeStatus(job.status) + '</span></div><small style="color:var(--muted)">' + escapar(data) + (job.tentativas ? ' · ' + job.tentativas + ' tentativa(s)' : '') + '</small>' + detalhe + acoesConferencia + acaoExcluir + '</div>';
        }).join('');
      }
      const botaoProximo = elemento('btnFilaImprimirProxima');
      if (botaoProximo) botaoProximo.disabled = !estacaoAtiva || lojaEstacao !== store || !(jobs || []).some(j => j.status === 'pendente') || processando;
    } catch (error) {
      resumo.textContent = 'Não foi possível consultar a fila: ' + mostrarErro(error);
    } finally { atualizandoPainel = false; }
  }

  function atualizarBotoesEstacao(outraAtiva, dadosEstacao) {
    const status = elemento('printerStatus');
    const iniciar = elemento('btnFilaAtivarEstacao');
    const parar = elemento('btnFilaPararEstacao');
    if (iniciar) {
      iniciar.style.display = estacaoAtiva ? 'none' : 'block';
      iniciar.disabled = !!(outraAtiva && dadosEstacao && dadosEstacao.estacao_id && dadosEstacao.estacao_id !== idEstacao);
    }
    if (parar) parar.style.display = estacaoAtiva ? 'block' : 'none';
    if (status && estacaoAtiva) status.title = 'Estação compartilhada ativa neste aparelho';
  }

  async function finalizarJob(job, impresso, erro) {
    const ok = await rpc('fila_impressao_finalizar', {
      p_job_id: job.id, p_loja_id: lojaEstacao,
      p_estacao_id: idEstacao, p_impresso: !!impresso, p_erro: erro || null
    });
    if (ok !== true) throw new Error('A fila não confirmou o resultado. O trabalho ficará para conferência.');
  }

  async function resolverPedidoFila(job) {
    if (job.payload && job.payload.ticket && typeof job.payload.ticket === 'object') {
      return clonarJson(job.payload.ticket);
    }
    if (!clienteSupabaseDisponivel()) throw new Error('Sem conexão com o Supabase para carregar o pedido.');
    const { data, error } = await supa.from('estado').select('dados').eq('id', 'atual').maybeSingle();
    if (error) throw error;
    const dados = data && data.dados || {};
    const porLoja = dados.porLoja || {};
    const lojaDados = porLoja[String(job.loja_id || lojaEstacao)] || {};
    const pedidosDaLoja = (Array.isArray(lojaDados.pedidos) ? lojaDados.pedidos : [])
      .concat(Array.isArray(lojaDados.historico) ? lojaDados.historico : []);
    const pedido = pedidosDaLoja.find(p => String(p.id) === String(job.pedido_id));
    if (!pedido) throw new Error('O pedido não foi encontrado nos dados salvos. A ficha não foi impressa.');
    const resolvido = clonarJson(pedido);
    if (job.tipo === 'alteracao' && job.payload && job.payload.ultimaAlteracaoPedido) {
      resolvido.ultimaAlteracaoPedido = clonarJson(job.payload.ultimaAlteracaoPedido);
    }
    return resolvido;
  }

  async function imprimirJob(job) {
    const pedido = await resolverPedidoFila(job);
    if (modoEstacao === 'escpos' && printerState && printerState.conectado) {
      const bytes = job.tipo === 'alteracao' ? gerarCupomAlteracao(pedido) : await gerarCupom(pedido);
      await enviarImpressora(bytes);
      await finalizarJob(job, true, null);
      toastFila('✅ Pedido ' + (typeof numeroPedidoExibicao === 'function' ? '#' + numeroPedidoExibicao(pedido) : '') + ' saiu da fila.');
    } else {
      if (typeof imprimirViaNavegadorDirect !== 'function') throw new Error('Impressão do sistema indisponível neste aparelho.');
      imprimirViaNavegadorDirect(pedido);
      await aguardar(1200);
      await finalizarJob(job, false, 'Confira o papel no Bluetooth Print/Thermer e toque em “Saiu o papel”.');
      toastFila('📄 Diálogo de impressão fechado. Confirme se a ficha saiu ou escolha reenviar.');
    }
  }

  async function processarProximo(manual) {
    if (!estacaoAtiva || !lojaEstacao) { if (manual) toastFila('Ative este aparelho como estação de impressão primeiro.'); return; }
    if (processando) return;
    const executar = async function () {
      if (processando) return;
      processando = true;
      const botao = elemento('btnFilaImprimirProxima');
      if (botao) botao.disabled = true;
      try {
        await renovarEstacao();
        if (!estacaoAtiva) return;
        const job = primeiraLinha(await rpc('fila_impressao_proximo', {
          p_loja_id: lojaEstacao, p_estacao_id: idEstacao, p_lease_segundos: 120
        }));
        if (!job) { if (manual) toastFila('Não há ficha pendente na fila.'); return; }
        try { await imprimirJob(job); }
        catch (error) {
          console.warn('Falha ao imprimir trabalho da fila:', error);
          try { await finalizarJob(job, false, mostrarErro(error)); }
          catch (falhaFila) { console.warn('Não consegui marcar a ficha para conferência:', falhaFila); }
          toastFila('⚠️ A ficha ficou para conferência. Verifique o papel antes de reenviar.');
        }
      } catch (error) {
        console.warn('Falha ao processar fila:', error);
        if (manual) toastFila('⚠️ ' + mostrarErro(error));
      } finally {
        processando = false;
        if (botao) botao.disabled = !estacaoAtiva;
        atualizarPainelFila();
      }
    };
    if (navigator.locks && navigator.locks.request) {
      await navigator.locks.request('rei-chapa-fila-impressao', { ifAvailable: true }, async function (lock) {
        if (!lock) { if (manual) toastFila('Esta fila já está sendo processada em outra aba.'); return; }
        await executar();
      });
    } else await executar();
  }

  function iniciarMonitorFila() {
    if (!window.__reiChapaFilaInterval) {
      window.__reiChapaFilaInterval = setInterval(function () {
        if (!estacaoAtiva) return;
        renovarEstacao();
        if (modoEstacao === 'escpos' && elemento('chkAutoPrint') && elemento('chkAutoPrint').checked) processarProximo(false);
        if (elemento('modalPrinter') && elemento('modalPrinter').classList.contains('aberto')) atualizarPainelFila();
      }, 2500);
    }
    if (!window.__reiChapaFilaHeartbeat) window.__reiChapaFilaHeartbeat = setInterval(renovarEstacao, 15000);
  }

  function instalarInterface() {
    const modal = elemento('modalPrinter');
    const caixa = modal && modal.querySelector('.modal-box');
    if (!caixa || elemento('secaoFilaImpressao')) return;
    const secao = document.createElement('section');
    secao.id = 'secaoFilaImpressao';
    secao.style.cssText = 'margin:12px 0;padding:10px;border:1px solid var(--gold-dark);border-radius:10px;background:rgba(0,0,0,.16)';
    secao.innerHTML = '<h4 style="margin:0 0 6px;color:var(--gold-2);font-size:13px">🧾 Fila compartilhada</h4>' +
      '<div style="font-size:10px;line-height:1.45;color:var(--muted);margin-bottom:8px">Pedidos de todos os aparelhos entram na mesma fila. Só a estação ativa imprime. No Android, toque em “Imprimir próxima”, escolha Bluetooth Print/Thermer e confirme cada ficha.</div>' +
      '<div id="filaImpressaoResumo" style="font-size:11px;color:var(--txt);margin:5px 0 8px">Carregando fila…</div>' +
      '<div class="modal-acoes" style="margin:6px 0"><button type="button" class="btn-primario" id="btnFilaAtivarEstacao" style="width:100%">🖨️ Usar este aparelho como impressora</button><button type="button" class="btn-fantasma" id="btnFilaPararEstacao" style="width:100%;display:none">⏹️ Parar estação</button></div>' +
      '<div class="modal-acoes" style="margin:6px 0"><button type="button" class="btn-primario" id="btnFilaImprimirProxima" style="flex:1">▶ Imprimir próxima</button><button type="button" class="btn-fantasma" id="btnFilaAtualizar">↻ Atualizar fila</button></div>' +
      '<div id="filaImpressaoLista" style="max-height:170px;overflow:auto">Aguardando conexão…</div>';
    const antes = elemento('chkAutoPrint') && elemento('chkAutoPrint').closest('.check-linha');
    caixa.insertBefore(secao, antes || caixa.querySelector('.modal-acoes'));
    elemento('btnFilaAtivarEstacao').addEventListener('click', async function () {
      if (typeof souGerente === 'function' && !souGerente()) return toastFila('🔒 Só o gerente pode ativar a estação de impressão.');
      if (!/Android/i.test(navigator.userAgent) && !(printerState && printerState.conectado)) {
        const conectou = await conectarImpressoraParaUso().catch(() => false);
        if (!conectou && !confirm('Não conectou por Bluetooth/COM. Quer ativar usando a janela de impressão do computador?')) return;
      }
      try { await reservarEstacao(); }
      catch (error) { toastFila('⚠️ ' + mostrarErro(error)); }
    });
    elemento('btnFilaPararEstacao').addEventListener('click', liberarEstacao);
    elemento('btnFilaImprimirProxima').addEventListener('click', function () { processarProximo(true); });
    elemento('btnFilaAtualizar').addEventListener('click', atualizarPainelFila);
    secao.addEventListener('click', async function (event) {
      const confirmar = event.target.closest('[data-fila-confirmar]');
      const reenviar = event.target.closest('[data-fila-reenviar]');
      const excluir = event.target.closest('[data-fila-excluir]');
      if (!confirmar && !reenviar && !excluir) return;
      if (excluir) {
        const idExcluir = excluir.dataset.filaExcluir;
        const nomeFicha = excluir.dataset.filaExcluirNome || 'esta ficha';
        if (!confirm('Excluir ' + nomeFicha + ' da fila compartilhada? Ela não será impressa.')) return;
        excluir.disabled = true;
        try {
          const { data, error } = await supa.from(TABLE).delete()
            .eq('id', idExcluir).eq('loja_id', lojaAtualFila()).eq('status', 'pendente').select('id');
          if (error) throw error;
          if (!data || !data.length) throw new Error('A ficha já saiu da fila ou está sendo processada; atualize a lista.');
          toastFila('🗑️ Ficha removida da fila.');
          await atualizarPainelFila();
        } catch (error) {
          toastFila('⚠️ ' + mostrarErro(error));
          excluir.disabled = false;
          await atualizarPainelFila();
        }
        return;
      }
      const id = (confirmar || reenviar).dataset.filaConfirmar || (confirmar || reenviar).dataset.filaReenviar;
      if (!estacaoAtiva || lojaEstacao !== lojaAtualFila()) return toastFila('Ative esta estação antes de atualizar o status da ficha.');
      try {
        if (confirmar) {
          const ok = await rpc('fila_impressao_finalizar', { p_job_id: id, p_loja_id: lojaEstacao, p_estacao_id: idEstacao, p_impresso: true, p_erro: null });
          if (ok !== true) throw new Error('A estação perdeu a reserva. O papel não foi marcado como impresso.');
          toastFila('✅ Ficha confirmada como impressa.');
        } else {
          const ok = await rpc('fila_impressao_reenviar', { p_job_id: id, p_loja_id: lojaEstacao, p_estacao_id: idEstacao });
          if (ok !== true) throw new Error('Não consegui devolver a ficha para a fila. Atualize e tente de novo.');
          toastFila('↻ Ficha devolvida ao fim da fila para reenvio.');
        }
        await atualizarPainelFila();
      } catch (error) { toastFila('⚠️ ' + mostrarErro(error)); }
    });
    const titulo = caixa.querySelector('h3');
    if (titulo) titulo.insertAdjacentHTML('afterend', '<div style="font-size:10px;color:var(--muted);margin:-5px 0 8px">A impressora pode ser conectada no PC ou em um celular por vez.</div>');
  }

  function interceptarSalvar() {
    const salvarOriginal = salvar;
    salvar = function () {
      const promessa = salvarOriginal.apply(this, arguments);
      sequenciaSaveFila += 1;
      ultimoSaveFila = promessa;
      window.__reiChapaUltimoSaveFila = promessa;
      return promessa;
    };
  }

  function observarNovoPedido() {
    document.addEventListener('click', function (event) {
      if (!(event.target.closest && event.target.closest('#btnConfirmarPedido'))) return;
      const idsAntes = new Set((pedidos || []).map(p => String(p.id)));
      const sequenciaAntes = sequenciaSaveFila;
      const store = lojaAtualFila();
      setTimeout(function () {
        const novos = (pedidos || []).filter(p => p && !idsAntes.has(String(p.id)));
        if (!novos.length || sequenciaSaveFila <= sequenciaAntes) return;
        const save = ultimoSaveFila;
        novos.forEach(function (pedido) {
          const evento = store + ':novo:' + String(pedido.id);
          enfileirarAposSalvar('novo', clonarJson(pedido), evento, save, store);
        });
      }, 0);
    }, true);
  }

  function substituirImpressaoDireta() {
    window.__autoPrint = function () { return false; };
    window.imprimirPedido = async function (id) {
      const pedido = (pedidos || []).find(p => String(p.id) === String(id)) || (historico || []).find(p => String(p.id) === String(id));
      if (!pedido) return toastFila('Pedido não encontrado para colocar na fila.');
      const chave = lojaAtualFila() + ':reimpressao:' + String(pedido.id) + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
      await enfileirarAposSalvar('reimpressao', pedido, chave, Promise.resolve({ ok: true }));
    };
    window.imprimirViaNavegador = function (id) { return window.imprimirPedido(id); };
    if (typeof imprimirAutoPreparo === 'function') {
      imprimirAutoPreparo = function (pedido) {
        if (pedido) toastFila('🧾 A ficha do pedido já está sendo controlada pela fila compartilhada.');
      };
    }
    if (typeof reimprimirPedidoHist === 'function') {
      reimprimirPedidoHist = function (id) { return window.imprimirPedido(id); };
    }
    if (typeof imprimirAlteracaoPedido === 'function') {
      imprimirAlteracaoPedido = async function (pedido) {
        if (!pedido || !pedido.ultimaAlteracaoPedido) return;
        const alteracao = clonarJson(pedido.ultimaAlteracaoPedido);
        const store = lojaAtualFila();
        const chave = store + ':alteracao:' + String(pedido.id) + ':' + String(alteracao.data || Date.now());
        const snapshot = clonarJson(pedido);
        snapshot.ultimaAlteracaoPedido = alteracao;
        await enfileirarAposSalvar('alteracao', snapshot, chave, ultimoSaveFila || Promise.resolve({ ok: false }), store);
      };
    }
  }

  async function sincronizarEstacaoAoVoltar() {
    if (document.hidden) return;
    if (estacaoAtiva) {
      try {
        const resultado = await rpc('fila_impressao_reservar_estacao', {
          p_loja_id: lojaEstacao, p_estacao_id: idEstacao, p_nome_estacao: nomeEstacao, p_lease_segundos: LEASE_SECONDS
        });
        const data = primeiraLinha(resultado);
        if (!data || data.reservada !== true) {
          estacaoAtiva = false;
          lojaEstacao = null;
          atualizarBotoesEstacao();
          toastFila('⚠️ Outra estação assumiu a fila enquanto este aparelho estava parado.');
        }
      } catch (error) { console.warn('Não consegui retomar a estação:', error); }
    }
    tentarOutbox();
    atualizarPainelFila();
  }

  function iniciar() {
    instalarInterface();
    interceptarSalvar();
    observarNovoPedido();
    substituirImpressaoDireta();
    iniciarMonitorFila();
    document.addEventListener('visibilitychange', sincronizarEstacaoAoVoltar);
    window.addEventListener('online', tentarOutbox);
    window.addEventListener('pagehide', function () {
      if (estacaoAtiva && lojaEstacao) rpc('fila_impressao_liberar_estacao', { p_loja_id: lojaEstacao, p_estacao_id: idEstacao }).catch(() => {});
    });
    const botaoAbrir = elemento('fabPrinter');
    if (botaoAbrir) botaoAbrir.addEventListener('click', function () { setTimeout(atualizarPainelFila, 100); });
    document.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'chkAutoPrint' && estacaoAtiva) {
        if (event.target.checked) toastFila('⚡ Impressão automática ativada nesta estação.');
        atualizarPainelFila();
      }
    });
    setInterval(tentarOutbox, 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
