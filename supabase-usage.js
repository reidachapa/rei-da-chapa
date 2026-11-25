(function () {
  'use strict';

  const botao = document.getElementById('btnUsoSupabase');
  const modal = document.getElementById('modalUsoSupabase');
  const tamanho = document.getElementById('usoSupabaseBytes');
  const fotos = document.getElementById('usoSupabaseFotosBytes');
  const totalFotos = document.getElementById('usoSupabaseTotalFotos');
  const status = document.getElementById('usoSupabaseStatus');
  const atualizar = document.getElementById('btnRecarregarUsoSupabase');
  const formato = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  let consultaAtual = 0;

  function podeVerUso() {
    return Boolean(window.__authPermitido && souGerente());
  }

  function formatarTamanho(bytes) {
    if (bytes >= 1e9) return formato.format(bytes / 1e9) + ' GB';
    if (bytes >= 1e6) return formato.format(bytes / 1e6) + ' MB';
    if (bytes >= 1e3) return formato.format(bytes / 1e3) + ' KB';
    return formato.format(bytes) + ' B';
  }

  function inteiroNaoNegativo(valor) {
    if ((typeof valor !== 'number' && typeof valor !== 'string') || String(valor).trim() === '') return null;
    const numero = Number(valor);
    return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
  }

  async function carregarMetrica(nome) {
    const { data, error } = await supa.rpc(nome, {}, { get: true });
    if (error) throw error;
    return data;
  }

  async function consultarTamanho() {
    if (!podeVerUso() || !modal.open) return;
    const consulta = ++consultaAtual;
    const podeExibir = () => consulta === consultaAtual && modal.open && podeVerUso();
    atualizar.disabled = true;
    tamanho.textContent = '—';
    fotos.textContent = '—';
    totalFotos.textContent = 'Supabase Storage';
    status.textContent = 'Consultando o Supabase…';

    try {
      const [banco, armazenamento] = await Promise.allSettled([
        carregarMetrica('rei_tamanho_banco_bytes'),
        carregarMetrica('rei_uso_fotos_catalogo'),
      ]);
      if (!podeExibir()) return;
      const bytes = inteiroNaoNegativo(banco.value);
      const bytesFotos = inteiroNaoNegativo(armazenamento.value?.bytes);
      const arquivos = inteiroNaoNegativo(armazenamento.value?.arquivos);
      if (bytes !== null) tamanho.textContent = formatarTamanho(bytes);
      if (bytesFotos !== null && arquivos !== null) {
        fotos.textContent = formatarTamanho(bytesFotos);
        totalFotos.textContent = formato.format(arquivos) + (arquivos === 1 ? ' arquivo' : ' arquivos');
      }
      status.textContent = bytes !== null && bytesFotos !== null && arquivos !== null
        ? 'Uso atualizado.'
        : 'Não consegui consultar todos os valores. Tente atualizar ou abra o painel do Supabase.';
    } finally {
      if (podeExibir()) atualizar.disabled = false;
    }
  }

  window.atualizarVisibilidadeUsoSupabase = function () {
    const visivel = podeVerUso();
    botao.hidden = !visivel;
    if (!visivel && modal.open) modal.close();
  };

  botao.addEventListener('click', () => {
    if (!podeVerUso() || modal.open) return;
    modal.showModal();
    consultarTamanho();
  });
  modal.addEventListener('close', () => {
    if (podeVerUso() && !modal.open) botao.focus();
  });
  atualizar.addEventListener('click', consultarTamanho);
  window.atualizarVisibilidadeUsoSupabase();
})();
