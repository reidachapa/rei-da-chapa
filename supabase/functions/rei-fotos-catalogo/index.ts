const BUCKET = 'rei-catalogo-fotos';
const CAPACIDADE_SHA256 = '__CAPACIDADE_SHA256__';
const EXPIRA_EM_MS = Number('__EXPIRACAO_MS__');
const AGENDAMENTO_SHA256 = '__AGENDAMENTO_SHA256__';
const MAX_FOTO_BYTES = 512 * 1024;
const LIMITE_BUCKET_AGENDADO = 100 * 1024 * 1024;
const PRAZO_BACKUP_AGENDADO = 24 * 60 * 60 * 1000;
const ID_TRANSFORMAVEL = /^(atual|backup_[a-z0-9_-]{1,160})$/i;

type Objeto = Record<string, unknown>;
type Referencia = Objeto & { imagem: string };
type Foto = { bytes: Uint8Array<ArrayBuffer>; mime: string; extension: string };

function objeto(valor: unknown): valor is Objeto {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

export function coletarReferencias(id: string, dados: unknown): Referencia[] {
  if (!ID_TRANSFORMAVEL.test(id) || !objeto(dados)) return [];
  const raiz = id === 'atual'
    ? dados
    : dados._reiDaChapaBackup === 1 && objeto(dados.snapshot) ? dados.snapshot : null;
  if (!raiz) return [];

  const containers = [raiz];
  if (objeto(raiz.porLoja)) {
    containers.push(...Object.values(raiz.porLoja).filter(objeto));
  }
  if (objeto(raiz.dados)) {
    containers.push(raiz.dados);
    if (objeto(raiz.dados.porLoja)) {
      containers.push(...Object.values(raiz.dados.porLoja).filter(objeto));
    }
  }
  const fotos = new Set<Referencia>();
  for (const loja of containers) {
    for (const tipo of ['produtos', 'ingredientes']) {
      const registros = loja[tipo];
      if (!Array.isArray(registros)) continue;
      for (const item of registros) {
        if (objeto(item) && typeof item.imagem === 'string' && /^data:image\//i.test(item.imagem)) {
          fotos.add(item as Referencia);
        }
      }
    }
  }
  return Array.from(fotos);
}

export function lerFoto(url: string): Foto | null {
  // Reject malformed and oversized input before allocating the decoded bytes.
  if (url.length > Math.ceil(MAX_FOTO_BYTES / 3) * 4 + 40) return null;
  const partes = /^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(url);
  if (!partes) return null;
  const tipo = partes[1].toLowerCase();
  let bytes;
  try {
    bytes = Uint8Array.from(atob(partes[2]), (caractere) => caractere.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length > MAX_FOTO_BYTES) return null;
  const iniciaCom = (assinatura: number[]) => assinatura.every((byte, i) => bytes[i] === byte);
  if ((tipo === 'jpeg' || tipo === 'jpg') && iniciaCom([255, 216, 255])) {
    return { bytes, mime: 'image/jpeg', extension: 'jpg' };
  }
  if (tipo === 'png' && iniciaCom([137, 80, 78, 71, 13, 10, 26, 10])) {
    return { bytes, mime: 'image/png', extension: 'png' };
  }
  if (tipo === 'webp' && iniciaCom([82, 73, 70, 70]) &&
      [87, 69, 66, 80].every((byte, i) => bytes[i + 8] === byte)) {
    return { bytes, mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (v) => v.toString(16).padStart(2, '0')).join('');
}

export function revisaoSeguinte(id: string, anterior: string, agora: number): string {
  const depoisDaAnterior = Date.parse(anterior) + 1;
  // Keep historical backups in their existing chronological order.
  return new Date(id === 'atual' ? Math.max(agora, depoisDaAnterior) : depoisDaAnterior).toISOString();
}

function resposta(status: number, dados: Objeto) {
  return new Response(JSON.stringify(dados), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function lerHexadecimal(valor: string) {
  return Uint8Array.from(valor.match(/.{2}/g) || [], (par) => parseInt(par, 16));
}

async function assinaturaValida(chaveHex: string, assinatura: string, escopo: string) {
  if (!/^[a-f0-9]{64}$/.test(chaveHex)) return false;
  const chave = await crypto.subtle.importKey(
    'raw', lerHexadecimal(chaveHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  return crypto.subtle.verify('HMAC', chave, lerHexadecimal(assinatura), new TextEncoder().encode(escopo));
}

class Falha extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, status = 502) {
    super(codigo);
    this.codigo = codigo;
    this.status = status;
  }
}

function backend(url: string, chave: string) {
  function admin(path: string, opcoes: RequestInit = {}) {
    const headers = new Headers(opcoes.headers);
    headers.set('apikey', chave);
    headers.set('authorization', 'Bearer ' + chave);
    return fetch(url + path, { ...opcoes, headers });
  }
  function rotaEstado(parametros: Record<string, string>) {
    return '/rest/v1/estado?' + new URLSearchParams(parametros).toString();
  }
  async function listar(inicio: number) {
    const result = await admin(rotaEstado({
      select: 'id',
      or: '(id.eq.atual,id.like.backup_*)',
      order: 'id.asc',
      offset: String(inicio),
      limit: '40',
    }));
    if (!result.ok) throw new Falha('lista_indisponivel');
    const linhas = await result.json();
    return {
      ids: linhas.filter((linha: Objeto) => typeof linha.id === 'string' && ID_TRANSFORMAVEL.test(linha.id))
        .map((linha: Objeto) => linha.id),
      proximo: linhas.length === 40 ? inicio + 40 : null,
    };
  }
  async function ler(id: string) {
    const result = await admin(rotaEstado({ select: 'dados,atualizado_em', id: 'eq.' + id, limit: '1' }));
    if (!result.ok) throw new Falha('registro_indisponivel');
    const [linha] = await result.json();
    if (!linha) throw new Falha('registro_ausente', 404);
    if (!objeto(linha.dados) || !Number.isFinite(Date.parse(linha.atualizado_em))) {
      throw new Falha('registro_invalido', 422);
    }
    if (id !== 'atual' && (linha.dados._reiDaChapaBackup !== 1 || !objeto(linha.dados.snapshot))) {
      throw new Falha('envelope_de_backup_invalido', 422);
    }
    return { dados: linha.dados, atualizadoEm: linha.atualizado_em };
  }
  async function guardar(id: string, dados: Objeto, revisao: string) {
    const result = await admin(rotaEstado({ id: 'eq.' + id, atualizado_em: 'eq.' + revisao, select: 'id' }), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ dados, atualizado_em: revisaoSeguinte(id, revisao, Date.now()) }),
    });
    if (!result.ok) throw new Falha('referencias_nao_salvas');
    const linhas = await result.json();
    if (!linhas.some((linha: Objeto) => linha.id === id)) throw new Falha('registro_mudou_repetir', 409);
  }
  async function bytesEmUso() {
    const result = await admin('/rest/v1/rpc/rei_uso_fotos_catalogo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!result.ok) throw new Falha('uso_do_bucket_indisponivel');
    const dados = await result.json();
    const metricas = Array.isArray(dados) ? dados[0] : dados;
    const valor = objeto(metricas) ? metricas.bytes ?? metricas.total_bytes ?? metricas.tamanho_bytes : metricas;
    if ((typeof valor !== 'number' && typeof valor !== 'string') || String(valor).trim() === '') {
      throw new Falha('uso_do_bucket_invalido');
    }
    const bytes = Number(valor);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Falha('uso_do_bucket_invalido');
    return bytes;
  }
  async function enviarEVerificar(foto: Foto, antesDeEnviar: (bytes: number) => Promise<void>) {
    const hash = await sha256Hex(foto.bytes);
    const caminho = '/storage/v1/object/' + BUCKET + '/' + hash + '.' + foto.extension;
    const publico = url + caminho.replace('/object/', '/object/public/');
    const existente = await fetch(publico, { headers: { 'cache-control': 'no-cache' } });
    let arquivo = existente;
    if (existente.status === 400 || existente.status === 404) {
      await existente.body?.cancel();
      await antesDeEnviar(foto.bytes.length);
      const upload = await admin(caminho, {
        method: 'POST',
        headers: { 'content-type': foto.mime, 'x-upsert': 'false' },
        body: foto.bytes,
      });
      // Concurrent uploads can produce a duplicate error. The verified digest
      // below proves whether the final path has the required immutable bytes.
      await upload.body?.cancel();
      arquivo = await fetch(publico, { headers: { 'cache-control': 'no-cache' } });
    }
    if (!arquivo.ok) {
      await arquivo.body?.cancel();
      throw new Falha('arquivo_publico_indisponivel');
    }
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (bytes.length !== foto.bytes.length || await sha256Hex(bytes) !== hash) {
      throw new Falha('arquivo_publico_divergente');
    }
    return publico;
  }
  return { listar, ler, guardar, enviarEVerificar, bytesEmUso };
}

async function receber(req: Request) {
  const janelaAdministrativa = Number.isFinite(EXPIRA_EM_MS) && Date.now() < EXPIRA_EM_MS;
  const temAgendamento = /^[a-f0-9]{64}$/.test(AGENDAMENTO_SHA256);
  if (!janelaAdministrativa && !temAgendamento) {
    return resposta(410, { ok: false, erro: 'migracao_fechada' });
  }
  if (req.method !== 'POST') return resposta(405, { ok: false, erro: 'metodo_invalido' });
  const assinatura = req.headers.get('x-rei-fotos-assinatura') || '';
  const expira = req.headers.get('x-rei-fotos-expira') || '';
  const prazo = Number(expira);
  if (!/^[a-f0-9]{64}$/.test(assinatura) || !Number.isSafeInteger(prazo) ||
      prazo < Date.now() || prazo > Date.now() + 180000) {
    return resposta(403, { ok: false, erro: 'acesso_negado' });
  }
  let entrada: Objeto;
  try {
    const corpo = await req.text();
    if (corpo.length > 1024) return resposta(413, { ok: false, erro: 'corpo_grande' });
    const candidata = JSON.parse(corpo);
    if (!objeto(candidata)) return resposta(400, { ok: false, erro: 'entrada_invalida' });
    entrada = candidata;
  } catch {
    return resposta(400, { ok: false, erro: 'entrada_invalida' });
  }
  const escopo = [expira, entrada.op, entrada.id || '', entrada.limit ?? 12, entrada.offset ?? 0].join('|');
  const autorizadoAdmin = janelaAdministrativa && await assinaturaValida(CAPACIDADE_SHA256, assinatura, escopo);
  const autorizadoAgendamento = temAgendamento && await assinaturaValida(AGENDAMENTO_SHA256, assinatura, escopo);
  if (!autorizadoAdmin && !autorizadoAgendamento) return resposta(403, { ok: false, erro: 'acesso_negado' });
  // The time-limited administration token alone can inspect or migrate old records.
  if (!autorizadoAdmin && entrada.op !== 'run') {
    return resposta(403, { ok: false, erro: 'operacao_restrita' });
  }
  const url = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !chave) return resposta(503, { ok: false, erro: 'backend_indisponivel' });
  const supa = backend(url, chave);

  try {
    if (entrada.op === 'list') {
      const inicio = entrada.offset ?? 0;
      if (typeof inicio !== 'number' || !Number.isInteger(inicio) || inicio < 0 || inicio > 1000) {
        return resposta(400, { ok: false, erro: 'offset_invalido' });
      }
      return resposta(200, { ok: true, ...(await supa.listar(inicio)) });
    }
    if ((entrada.op !== 'dryrun' && entrada.op !== 'run') ||
        typeof entrada.id !== 'string' || !ID_TRANSFORMAVEL.test(entrada.id)) {
      return resposta(400, { ok: false, erro: 'operacao_invalida' });
    }
    const limite = entrada.limit ?? 12;
    if (typeof limite !== 'number' || !Number.isInteger(limite) || limite < 1 || limite > 50) {
      return resposta(400, { ok: false, erro: 'limite_invalido' });
    }
    const { dados, atualizadoEm } = await supa.ler(entrada.id);
    if (!autorizadoAdmin && entrada.id !== 'atual') {
      const idade = Date.now() - Date.parse(atualizadoEm);
      if (idade < 0 || idade > PRAZO_BACKUP_AGENDADO) {
        return resposta(403, { ok: false, erro: 'backup_antigo_restrito' });
      }
    }
    const referencias = coletarReferencias(entrada.id, dados);
    let semSuporte = 0;
    let quantidadeValida = 0;
    let bytesTotal = 0;
    const selecionadas: Array<{ ref: Referencia; foto: Foto }> = [];
    for (const ref of referencias) {
      const foto = lerFoto(ref.imagem);
      if (!foto) {
        semSuporte++;
        continue;
      }
      quantidadeValida++;
      bytesTotal += foto.bytes.length;
      if (selecionadas.length < limite) selecionadas.push({ ref, foto });
    }
    if (entrada.op === 'dryrun') {
      return resposta(200, { ok: true, validas: quantidadeValida, semSuporte, bytesTotal });
    }
    const verificados = new Map<string, string>();
    let usoProjetado: number | undefined;
    async function reservarEspaco(bytes: number) {
      if (autorizadoAdmin) return;
      usoProjetado ??= await supa.bytesEmUso();
      if (usoProjetado + bytes > LIMITE_BUCKET_AGENDADO) throw new Falha('limite_de_fotos_atingido', 409);
      usoProjetado += bytes;
    }
    for (const { ref, foto } of selecionadas) {
      let caminho = verificados.get(ref.imagem);
      if (!caminho) {
        caminho = await supa.enviarEVerificar(foto, reservarEspaco);
        verificados.set(ref.imagem, caminho);
      }
      ref.imagem = caminho;
    }
    if (selecionadas.length) await supa.guardar(entrada.id, dados, atualizadoEm);
    return resposta(200, {
      ok: true, migradas: selecionadas.length, objetosVerificados: verificados.size,
      restantes: quantidadeValida - selecionadas.length, semSuporte,
    });
  } catch (erro) {
    // No provider response, photo, request body, or privileged header is logged.
    return erro instanceof Falha
      ? resposta(erro.status, { ok: false, erro: erro.codigo })
      : resposta(502, { ok: false, erro: 'migracao_indisponivel' });
  }
}

if (typeof Deno !== 'undefined') Deno.serve(receber);
