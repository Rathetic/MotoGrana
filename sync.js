/* =====================================================
   Movix – Sincronização com o Supabase (Fase 3.4)
   Modelo "local primeiro": o app continua usando o LocalStorage; a nuvem
   é um espelho sincronizado em segundo plano (e funciona offline).
   Depende de config.js, script.js e auth.js (usa funções e variáveis de lá).

   Como funciona (resumo):
   1. ENVIAR: compara cada registro local com a "foto" da última sincronização
      (snapshot). Novos/alterados viram upsert; o que sumiu do aparelho vira
      exclusão lógica (deleted_at) na nuvem. A ordem respeita as chaves
      estrangeiras: veículos -> abastecimentos/manutenções -> movimentações.
   2. RECEBER: busca na nuvem o que mudou desde a última vez (updated_at) e
      aplica no aparelho. Exclusões de outros aparelhos chegam via deleted_at.
   3. Conflito: se o mesmo registro mudou nos dois lados, vale o que este
      aparelho tem pendente (ele é enviado antes de receber).
   Segurança dos dados: a sincronização NUNCA apaga nada daqui por conta
   própria; só remove um registro quando a nuvem diz explicitamente que ele
   foi excluído em outro aparelho.
   Organização: 1 Estado • 2 Tabelas • 3 API REST • 4 Enviar • 5 Receber
                • 6 Orquestração • 7 Ativação • 8 Tela • 9 Inicialização
   ===================================================== */

const SYNC_CHAVE = "movix:sync";               // estado da sincronização (não vai nos backups)
const BACKUP_PREVENTIVO_CHAVE = "movix:backup-preventivo";
const LOTE = 200, ESPERA_MS = 2500, JANELA_SEGURANCA_MS = 10000;

let estadoSync = null;      // { ativo, usuario, ultimoPull:{}, snapshot:{}, ultimaSync }
let sincronizando = false, refazer = false, timerSync = null, aplicandoRemoto = false;
let ultimoErroAvisado = "";
let resultadoSync = { erro: "", offline: false, rejeitados: [], enviados: {}, recebidos: {} };

/* ---------- 1. Estado ---------- */
const hashTexto = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h.toString(36) + ":" + s.length; };
const hashLinha = (t, item) => hashTexto(JSON.stringify(t.paraLinha(item)));
const numOuNulo = (v) => (typeof v === "number" && isFinite(v) ? v : null);

function carregarEstadoSync() {
  try { estadoSync = JSON.parse(localStorage.getItem(SYNC_CHAVE)); } catch (erro) { estadoSync = null; }
  if (!estadoSync || typeof estadoSync.usuario !== "string") estadoSync = null;
}
function salvarEstadoSync() {
  try { if (estadoSync) localStorage.setItem(SYNC_CHAVE, JSON.stringify(estadoSync)); } catch (erro) { /* ignora */ }
}
const usuarioAtual = () => (typeof sessao !== "undefined" && sessao ? sessao.user.id : null);
const podeSincronizar = () => Boolean(estadoSync && estadoSync.ativo && usuarioAtual() === estadoSync.usuario && lerConfiguracao().ok);

/* ---------- 2. Tabelas: como cada registro local vira linha do banco ---------- */
// paraLinha: local -> banco (só colunas gravávelis; colunas calculadas ficam de fora)
// paraLocal: banco -> local.  Ordem importa por causa das chaves estrangeiras
// (turnos vem ANTES de movimentacoes: o ganho do turno aponta para o turno por turno_id).
const TABELAS = [
  { nome: "veiculos", lista: () => extras.veiculos, gravar: (l) => { extras.veiculos = l; salvarExtras("veiculos"); },
    validar: (i) => itemExtraValido("veiculos", i),
    paraLinha: (v) => ({ id: v.id, tipo: v.tipo, marca: v.marca || "", modelo: v.modelo || "", ano: v.ano ? Number(v.ano) : null, placa: v.placa || null, apelido: v.apelido, km_atual: v.kmAtual }),
    paraLocal: (r) => ({ id: r.id, tipo: r.tipo, marca: r.marca, modelo: r.modelo, ano: r.ano == null ? "" : String(r.ano), placa: r.placa || "", apelido: r.apelido, kmAtual: Number(r.km_atual) }) },
  { nome: "abastecimentos", lista: () => extras.combustivel, gravar: (l) => { extras.combustivel = l; salvarExtras("combustivel"); },
    validar: (i) => itemExtraValido("combustivel", i),
    paraLinha: (c) => ({ id: c.id, veiculo_id: c.veiculoId, data: c.data, km_inicial: c.kmInicial, km_final: c.kmFinal, consumo_km_l: Math.round(c.consumo * 100) / 100, preco_litro: Math.round(c.preco * 1000) / 1000 }),
    paraLocal: (r) => ({ id: r.id, data: r.data, veiculoId: r.veiculo_id, kmInicial: Number(r.km_inicial), kmFinal: Number(r.km_final), consumo: Number(r.consumo_km_l), preco: Number(r.preco_litro), distancia: Number(r.distancia), litros: Number(r.litros), custo: Number(r.custo) }) },
  { nome: "manutencoes", lista: () => extras.manutencoes, gravar: (l) => { extras.manutencoes = l; salvarExtras("manutencoes"); },
    validar: (i) => itemExtraValido("manutencoes", i),
    paraLinha: (m) => ({ id: m.id, veiculo_id: m.veiculoId, tipo: String(m.tipo).slice(0, 40), descricao: String(m.descricao).trim().slice(0, 60) || String(m.tipo).slice(0, 40), valor: m.valor, km: m.km, data: m.data, prox_km: numOuNulo(m.proxKm), prox_data: m.proxData || null }),
    paraLocal: (r) => { const m = { id: r.id, tipo: r.tipo, descricao: r.descricao, valor: Number(r.valor), km: Number(r.km), data: r.data, veiculoId: r.veiculo_id }; if (r.prox_km != null) m.proxKm = Number(r.prox_km); if (r.prox_data) m.proxData = r.prox_data; return m; } },
  { nome: "turnos", lista: () => extras.turnos, gravar: (l) => { extras.turnos = l; salvarExtras("turnos"); },
    validar: (i) => itemExtraValido("turnos", i),
    paraLinha: (t) => ({ id: t.id, data: t.data, inicio: t.inicio, fim: t.fim, minutos: t.minutos, ganhos: t.ganhos, entregas: t.entregas, pausa_min: t.pausaMin || 0, registro: t.registro === "automático" ? "automatico" : "manual", km: numOuNulo(t.km), veiculo_id: null }),
    paraLocal: (r) => { const t = { id: r.id, data: r.data, inicio: String(r.inicio).slice(0, 5), fim: String(r.fim).slice(0, 5), minutos: Number(r.minutos), ganhos: Number(r.ganhos), entregas: Number(r.entregas), pausaMin: Number(r.pausa_min), registro: r.registro === "automatico" ? "automático" : "manual" }; if (r.km != null) t.km = Number(r.km); return t; } },
  { nome: "movimentacoes", lista: () => movimentacoes, gravar: (l) => { movimentacoes = l; salvarDados(); },
    validar: (i) => registroValido(i),
    paraLinha: (m) => ({ id: m.id, descricao: String(m.descricao).trim().slice(0, 60) || "Sem descrição", tipo: m.tipo, categoria: String(m.categoria).slice(0, 40), valor: m.valor, data: m.data,
      abastecimento_id: m.origem && m.origem.tipo === "combustivel" ? m.origem.id : null, manutencao_id: m.origem && m.origem.tipo === "manutencao" ? m.origem.id : null,
      turno_id: m.origem && m.origem.tipo === "turno" ? m.origem.id : null }),
    paraLocal: (r) => { const m = { id: r.id, descricao: r.descricao, tipo: r.tipo, categoria: r.categoria, valor: Number(r.valor), data: r.data }; if (r.abastecimento_id) m.origem = { tipo: "combustivel", id: r.abastecimento_id }; else if (r.manutencao_id) m.origem = { tipo: "manutencao", id: r.manutencao_id }; else if (r.turno_id) m.origem = { tipo: "turno", id: r.turno_id }; return m; } },
  { nome: "objetivos", lista: () => extras.objetivos, gravar: (l) => { extras.objetivos = l; salvarExtras("objetivos"); },
    validar: (i) => itemExtraValido("objetivos", i),
    paraLinha: (o) => ({ id: o.id, nome: String(o.nome).slice(0, 40), meta: o.meta, guardado: o.guardado }),
    paraLocal: (r) => ({ id: r.id, nome: r.nome, meta: Number(r.meta), guardado: Number(r.guardado) }) }
];

/* ---------- 3. Chamadas à API REST do Supabase (PostgREST) ---------- */
async function restFetch(caminho, { metodo = "GET", corpo, prefer } = {}, repetir = true) {
  const cfg = lerConfiguracao(), token = await obterTokenValido();
  if (!cfg.ok || !token) { const e = new Error("Sessão indisponível."); e.semSessao = true; throw e; }
  const ctrl = new AbortController(), limite = setTimeout(() => ctrl.abort(), 30000);
  let resp;
  try {
    resp = await fetch(cfg.url + "/rest/v1/" + caminho, {
      method: metodo, signal: ctrl.signal,
      headers: { apikey: cfg.chave, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
  } catch (erro) { const e = new Error("rede"); e.rede = true; throw e; } finally { clearTimeout(limite); }
  if (resp.status === 401 && repetir) { await renovarSessao(); return restFetch(caminho, { metodo, corpo, prefer }, false); }
  let dados = null;
  try { dados = await resp.json(); } catch (erro) { /* resposta vazia */ }
  if (!resp.ok) {
    const e = new Error((dados && (dados.message || dados.hint)) || "erro " + resp.status);
    e.status = resp.status;
    e.rejeicao = [400, 409, 422].includes(resp.status); // problema no DADO (não na conexão)
    throw e;
  }
  return dados;
}

/* ---------- 4. Enviar (local -> nuvem) ---------- */
async function enviarLote(t, lote, snap) {
  try {
    await restFetch(t.nome + "?on_conflict=user_id,id", { metodo: "POST", prefer: "resolution=merge-duplicates,return=minimal", corpo: lote.map((x) => ({ ...x.linha, deleted_at: null })) });
    lote.forEach((x) => { snap[x.linha.id] = x.h; });
    contar("enviados", t.nome, lote.length);
  } catch (e) {
    if (!e.rejeicao) throw e;
    if (lote.length > 1) { for (const x of lote) await enviarLote(t, [x], snap); return; } // isola o registro problemático
    resultadoSync.rejeitados.push({ tabela: t.nome, id: lote[0].linha.id, motivo: e.message });
  }
}

async function enviarTabela(t) {
  const snap = (estadoSync.snapshot[t.nome] = estadoSync.snapshot[t.nome] || {});
  const locais = t.lista(), ids = new Set(), sujos = [];
  locais.forEach((i) => { ids.add(i.id); const linha = t.paraLinha(i), h = hashTexto(JSON.stringify(linha)); if (snap[i.id] !== h) sujos.push({ linha, h }); });
  for (let k = 0; k < sujos.length; k += LOTE) await enviarLote(t, sujos.slice(k, k + LOTE), snap);

  const apagados = Object.keys(snap).filter((id) => !ids.has(id)); // existiam e sumiram daqui
  for (let k = 0; k < apagados.length; k += 100) {
    const parte = apagados.slice(k, k + 100);
    await restFetch(t.nome + "?id=in.(" + parte.join(",") + ")", { metodo: "PATCH", prefer: "return=minimal", corpo: { deleted_at: new Date().toISOString() } });
    parte.forEach((id) => delete snap[id]);
  }
}

// Metas ficam na tabela configuracoes (1 linha por usuário)
const linhaConfig = () => ({ meta_semanal: metaSemanal > 0 ? metaSemanal : null, meta_mensal: metaMensal > 0 ? metaMensal : null });

// Remuneração por turno (ganho fixo + valor por entrega) também fica em configuracoes.
// Precisa das colunas ganho_fixo_turno e valor_por_entrega. Se elas ainda não existem no banco,
// o app cai para o comportamento anterior (só as metas), sem travar a sincronização,
// e tenta de novo na próxima vez que o app for aberto.
let colunasRemuneracao = true;
const linhaRemuneracao = () => ({ ganho_fixo_turno: remuneracao.fixo > 0 ? remuneracao.fixo : null, valor_por_entrega: remuneracao.porEntrega > 0 ? remuneracao.porEntrega : null });
const linhaConfigCompleta = () => ({ ...linhaConfig(), ...(colunasRemuneracao ? linhaRemuneracao() : {}) });
const erroColunaRemuneracao = (e) => Boolean(e) && e.status === 400 && /ganho_fixo_turno|valor_por_entrega|column|coluna/i.test(e.message || "");

async function enviarConfig() {
  const snap = (estadoSync.snapshot.configuracoes = estadoSync.snapshot.configuracoes || {});
  const l = linhaConfigCompleta(), h = hashTexto(JSON.stringify(l));
  const sujo = snap.hash === undefined ? Object.values(l).some((v) => v !== null) : snap.hash !== h;
  snap.sujo = sujo;
  if (!sujo) return;
  const enviar = (campos) => restFetch("configuracoes?on_conflict=user_id", { metodo: "POST", prefer: "resolution=merge-duplicates,return=minimal", corpo: { user_id: estadoSync.usuario, ...campos } });
  try {
    await enviar(l);
    snap.hash = h;
  } catch (e) {
    if (!colunasRemuneracao || !erroColunaRemuneracao(e)) throw e;
    colunasRemuneracao = false;               // colunas ainda não existem: segue só com as metas
    const base = linhaConfig();
    await enviar(base);
    snap.hash = hashTexto(JSON.stringify(base));
  }
}

/* ---------- 5. Receber (nuvem -> local) ---------- */
function aplicarLinhas(t, linhas) {
  const snap = (estadoSync.snapshot[t.nome] = estadoSync.snapshot[t.nome] || {});
  const mapa = new Map(t.lista().map((i) => [i.id, i]));
  let mudou = false;
  linhas.forEach((r) => {
    if (r.deleted_at) { if (mapa.delete(r.id)) mudou = true; delete snap[r.id]; return; } // excluído em outro aparelho
    const novo = t.paraLocal(r);
    if (!t.validar(novo)) return;
    const h = hashLinha(t, novo), antigo = mapa.get(r.id);
    if (antigo && snap[r.id] !== undefined && hashLinha(t, antigo) !== snap[r.id]) return; // alteração local pendente vence
    if (!antigo || hashLinha(t, antigo) !== h) { mapa.set(r.id, novo); mudou = true; if (!antigo) contar("recebidos", t.nome, 1); }
    snap[r.id] = h;
  });
  if (mudou) { aplicandoRemoto = true; try { t.gravar([...mapa.values()]); } finally { aplicandoRemoto = false; } }
  return mudou;
}

async function receberTabela(t) {
  const ultimo = estadoSync.ultimoPull[t.nome] || "1970-01-01T00:00:00.000Z";
  // Recua alguns segundos: transações que terminaram depois não ficam para trás. Reaplicar é seguro.
  let cursor = new Date(Math.max(0, Date.parse(ultimo) - JANELA_SEGURANCA_MS)).toISOString(), mudou = false, maior = ultimo;
  for (;;) {
    const linhas = await restFetch(t.nome + "?select=*&order=updated_at.asc&limit=1000&updated_at=gte." + encodeURIComponent(cursor));
    if (!linhas.length) break;
    mudou = aplicarLinhas(t, linhas) || mudou;
    const fim = linhas[linhas.length - 1].updated_at;
    if (fim > maior) maior = fim;
    if (linhas.length < 1000 || fim === cursor) break;
    cursor = fim;
  }
  estadoSync.ultimoPull[t.nome] = maior;
  return mudou;
}

async function receberConfig() {
  const snap = estadoSync.snapshot.configuracoes;
  if (snap.sujo) { snap.sujo = false; return false; } // acabou de enviar: o local é a verdade
  const buscar = () => restFetch("configuracoes?select=meta_semanal,meta_mensal" + (colunasRemuneracao ? ",ganho_fixo_turno,valor_por_entrega" : "") + "&user_id=eq." + estadoSync.usuario);
  let linhas;
  try { linhas = await buscar(); }
  catch (e) {
    if (!colunasRemuneracao || !erroColunaRemuneracao(e)) throw e;
    colunasRemuneracao = false;               // colunas ainda não existem: busca só as metas
    linhas = await buscar();
  }
  if (!linhas.length) return false;
  const sem = Number(linhas[0].meta_semanal) > 0 ? Number(linhas[0].meta_semanal) : 0, men = Number(linhas[0].meta_mensal) > 0 ? Number(linhas[0].meta_mensal) : 0;
  const positivo = (v) => (Number(v) > 0 ? arred(Number(v)) : 0);
  const fixo = colunasRemuneracao ? positivo(linhas[0].ganho_fixo_turno) : remuneracao.fixo;
  const porEntrega = colunasRemuneracao ? positivo(linhas[0].valor_por_entrega) : remuneracao.porEntrega;
  let mudou = false;
  aplicandoRemoto = true;
  try {
    if (sem !== metaSemanal) { metaSemanal = sem; sem ? localStorage.setItem(CHAVE_META, String(sem)) : localStorage.removeItem(CHAVE_META); $("campoMeta").value = sem || ""; mudou = true; }
    if (men !== metaMensal) { metaMensal = men; men ? localStorage.setItem(CHAVE_META_MENSAL, String(men)) : localStorage.removeItem(CHAVE_META_MENSAL); $("campoMetaMensal").value = men || ""; mudou = true; }
    if (fixo !== remuneracao.fixo || porEntrega !== remuneracao.porEntrega) {   // vale só para turnos futuros; turnos antigos não são tocados
      remuneracao = { fixo, porEntrega };
      remuneracaoAtiva() ? localStorage.setItem(CHAVE_REMUNERACAO, JSON.stringify(remuneracao)) : localStorage.removeItem(CHAVE_REMUNERACAO);
      $("ganhoFixoTurno").value = fixo || ""; $("valorEntregaTurno").value = porEntrega || "";
      mudou = true;
    }
  } finally { aplicandoRemoto = false; }
  snap.hash = hashTexto(JSON.stringify(linhaConfigCompleta()));
  return mudou;
}

// O veículo padrão vazio criado em cada aparelho novo some quando a nuvem já tem veículos de verdade
function removerVeiculoPadraoVazio() {
  if (extras.veiculos.length < 2) return false;
  const usado = (v) => extras.combustivel.some((c) => c.veiculoId === v.id) || extras.manutencoes.some((m) => m.veiculoId === v.id);
  const sobra = extras.veiculos.find((v) => v.apelido === "Minha moto" && !v.marca && !v.modelo && !v.placa && v.kmAtual === 0 && !usado(v));
  if (!sobra) return false;
  extras.veiculos = extras.veiculos.filter((v) => v.id !== sobra.id);
  aplicandoRemoto = true; try { salvarExtras("veiculos"); } finally { aplicandoRemoto = false; }
  return true;
}

/* ---------- 6. Orquestração ---------- */
function traduzirErroSync(e) {
  if (e.rede) return "";
  if (e.semSessao) return "Sessão indisponível. Entre novamente.";
  if (e.status === 403) return "O servidor negou o acesso (RLS). Confira se o SQL da etapa 3.1 foi executado inteiro.";
  if (e.status === 404) return "Tabela não encontrada no Supabase. Execute o SQL da etapa 3.1.";
  return "Erro do servidor: " + e.message;
}

async function sincronizar() {
  if (!podeSincronizar()) return;
  if (sincronizando) { refazer = true; return; }
  if (!navigator.onLine) { resultadoSync.offline = true; renderizarSync(); return; }
  sincronizando = true;
  resultadoSync = { erro: "", offline: false, rejeitados: [], enviados: {}, recebidos: {} };
  renderizarSync();
  try {
    for (const t of TABELAS) await enviarTabela(t);
    await enviarConfig();
    let mudou = false;
    for (const t of TABELAS) mudou = (await receberTabela(t)) || mudou;
    mudou = (await receberConfig()) || mudou;
    if (removerVeiculoPadraoVazio()) mudou = true;
    estadoSync.ultimaSync = Date.now();
    if (mudou) { prepararVeiculos(); atualizarTela(); }
    acumularMigracao();
    await concluirMigracao();
  } catch (e) {
    acumularMigracao();
    if (e.rede) resultadoSync.offline = true; else { resultadoSync.erro = traduzirErroSync(e); marcarMigracaoFalha(e); }
  } finally {
    sincronizando = false;
    if (resultadoSync.erro && resultadoSync.erro !== ultimoErroAvisado) toast("Sincronização com problema. Veja os detalhes na seção Conta.", true);
    ultimoErroAvisado = resultadoSync.erro;
    salvarEstadoSync();
    renderizarSync();
    if (refazer) { refazer = false; agendar(); }
  }
}

function agendar() {
  if (aplicandoRemoto || !podeSincronizar()) return;
  if (sincronizando) { refazer = true; return; }
  clearTimeout(timerSync);
  timerSync = setTimeout(sincronizar, ESPERA_MS);
}

/* ---------- 7. Ativação (com backup preventivo) ---------- */
function baixarJson(nome, objeto) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function criarBackupPreventivo() {
  const pacote = montarPacoteBackup();
  // cópia interna (confirma que há espaço) + arquivo para o usuário guardar
  localStorage.setItem(BACKUP_PREVENTIVO_CHAVE, JSON.stringify({ criadoEm: new Date().toISOString(), usuario: usuarioAtual(), pacote }));
  baixarJson("movix-backup-preventivo-" + dataParaTexto(new Date()) + ".json", pacote);
  return pacote;
}

async function ativarSincronizacao() {
  if (!usuarioAtual()) return;
  const mensagem = "Ativar a sincronização?\n\n"
    + "• Antes de tudo, será salvo um backup de segurança deste aparelho (arquivo + cópia interna).\n"
    + "• Os dados deste aparelho serão ENVIADOS para a conta " + sessao.user.email + ".\n"
    + "• Os dados que já estiverem nessa conta serão TRAZIDOS para cá.\n\n"
    + "Nada é apagado deste aparelho.";
  if (!confirm(mensagem)) return;
  let pacote;
  try { pacote = criarBackupPreventivo(); }
  catch (e) { toast("Não foi possível criar o backup de segurança. Nada foi enviado.", true); return; }
  toast("Backup de segurança salvo. Sincronizando...");

  estadoSync = { ativo: true, usuario: usuarioAtual(), ultimoPull: {}, snapshot: {}, ultimaSync: null, migracao: null };
  const local = Object.fromEntries(TABELAS.map((t) => [t.nome, t.lista().length]));
  const migracao = { id: null, checksum: await calcularChecksum(JSON.stringify(pacote)), local, enviados: {}, recebidos: {}, rejeitados: [], jaFeita: false };
  try {                                   // sem internet? o registro é criado na primeira sincronização completa
    const reg = await registrarMigracao("localstorage", migracao.checksum, { local });
    if (reg.jaFeita) { migracao.jaFeita = true; toast("Estes dados já tinham sido migrados para esta conta. Seguindo com a sincronização normal."); }
    else migracao.id = reg.id;
  } catch (e) { /* tenta de novo depois */ }
  estadoSync.migracao = migracao;
  salvarEstadoSync();
  await sincronizar();
}

function pausarSincronizacao() {
  if (!estadoSync) return;
  estadoSync.ativo = false;
  salvarEstadoSync();
  toast("Sincronização pausada neste aparelho.");
  renderizarSync();
}

/* ---------- 8. Tela ---------- */
function contarPendencias() {
  if (!estadoSync) return 0;
  let n = 0;
  TABELAS.forEach((t) => {
    const snap = estadoSync.snapshot[t.nome] || {}, ids = new Set();
    t.lista().forEach((i) => { ids.add(i.id); if (snap[i.id] !== hashLinha(t, i)) n++; });
    Object.keys(snap).forEach((id) => { if (!ids.has(id)) n++; });
  });
  return n;
}

function renderizarSync() {
  const status = $("statusSync");
  if (!status) return;
  const logado = Boolean(usuarioAtual()), ativo = podeSincronizar();
  const outraConta = estadoSync && estadoSync.usuario !== usuarioAtual();
  status.innerHTML = "";
  $("btnSyncAtivar").hidden = !logado || ativo;
  $("botoesSync").hidden = !ativo;
  const temPreventivo = Boolean(lerJson(BACKUP_PREVENTIVO_CHAVE));
  $("btnDuplicatas").hidden = !ativo;
  $("btnRestaurarPreventivo").hidden = !temPreventivo;
  $("botoesMigracao").hidden = !logado || !(ativo || temPreventivo);
  if (!logado) { $("relatorioMigracao").hidden = $("tituloRelatorio").hidden = $("blocoDuplicatas").hidden = true; return; }
  renderizarRelatorio();

  let estado = "Desativada neste aparelho";
  if (ativo) estado = sincronizando ? "Sincronizando..." : resultadoSync.offline ? "Sem internet (sincroniza ao voltar)" : "Ativa";
  else if (estadoSync && estadoSync.usuario === usuarioAtual()) estado = "Pausada";
  status.append(linhaInfo("Sincronização", estado, ativo && !resultadoSync.erro ? "g" : ""));
  if (ativo) {
    status.append(linhaInfo("Última sincronização", estadoSync.ultimaSync ? new Date(estadoSync.ultimaSync).toLocaleString("pt-BR") : "ainda não"));
    const p = contarPendencias();
    status.append(linhaInfo("Alterações pendentes", String(p), p > 0 ? "d" : "g"));
  }
  if (!ativo) status.append(el("p", "dica", "⚠️ Seus dados ainda NÃO estão na nuvem. Toque em \"Ativar sincronização\" para enviá-los."));
  if (outraConta) status.append(el("p", "dica", "Este aparelho estava sincronizado com outra conta. Ao ativar, os dados que estão aqui serão enviados para esta conta."));
  const rej = resultadoSync.rejeitados;
  $("erroSync").textContent = resultadoSync.erro || (rej.length ? rej.length + " registro(s) não aceito(s) pelo servidor (ficam salvos aqui). Primeiro motivo: " + rej[0].motivo : "");
}

/* ---------- 10. Migração (Fase 3.5) ---------- */
// Cada migração é registrada na tabela "migracoes" (checksum único por conta),
// gera um relatório e pode ser desfeita localmente com o backup preventivo.
const RELATORIO_CHAVE = "movix:relatorio-migracao";
const BACKUP_ANTES_RESTAURAR_CHAVE = "movix:backup-antes-restauracao";
const NOMES_TABELAS = { veiculos: "Veículos", abastecimentos: "Abastecimentos", manutencoes: "Manutenções", movimentacoes: "Movimentações", turnos: "Turnos", objetivos: "Objetivos" };

const lerJson = (chave) => { try { return JSON.parse(localStorage.getItem(chave)); } catch (erro) { return null; } };
const contar = (tipo, nome, n) => { resultadoSync[tipo][nome] = (resultadoSync[tipo][nome] || 0) + n; };

// "Impressão digital" do conteúdo (SHA-256); se o navegador não oferecer, usa uma alternativa simples
async function calcularChecksum(texto) {
  try {
    if (window.crypto && crypto.subtle) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
      return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (erro) { /* usa a alternativa */ }
  return ("alt" + hashTexto(texto) + hashTexto([...texto].reverse().join("")) + texto.length).padEnd(16, "0");
}

// Já existe uma migração com esse conteúdo? Concluída -> avisa; pendente -> reaproveita; nova -> cria.
async function registrarMigracao(fonte, checksum, resumo) {
  const achadas = await restFetch("migracoes?select=id,status,created_at&checksum=eq." + checksum);
  if (achadas.length && achadas[0].status === "concluida") return { jaFeita: true, quando: achadas[0].created_at };
  if (achadas.length) {
    await restFetch("migracoes?id=eq." + achadas[0].id, { metodo: "PATCH", prefer: "return=minimal", corpo: { status: "iniciada", erro: null, resumo } });
    return { id: achadas[0].id };
  }
  const criada = await restFetch("migracoes", { metodo: "POST", prefer: "return=representation", corpo: { fonte, checksum, status: "iniciada", resumo } });
  return { id: criada[0].id };
}

const finalizarMigracao = (id, status, resumo, erro) => restFetch("migracoes?id=eq." + id, {
  metodo: "PATCH", prefer: "return=minimal",
  corpo: { status, resumo, erro: erro || null, concluida_em: status === "concluida" ? new Date().toISOString() : null }
});

// Soma as contagens de cada rodada de sincronização enquanto a migração não termina
function acumularMigracao() {
  const m = estadoSync && estadoSync.migracao;
  if (!m) return;
  ["enviados", "recebidos"].forEach((tipo) => Object.keys(resultadoSync[tipo]).forEach((n) => { m[tipo][n] = (m[tipo][n] || 0) + resultadoSync[tipo][n]; resultadoSync[tipo][n] = 0; }));
  resultadoSync.rejeitados.forEach((r) => { if (!m.rejeitados.some((x) => x.id === r.id && x.tabela === r.tabela)) m.rejeitados.push(r); });
}

// Primeira sincronização completa depois da ativação: fecha o registro e grava o relatório
async function concluirMigracao() {
  const m = estadoSync && estadoSync.migracao;
  if (!m) return;
  const duplicatas = detectarDuplicatas().length;
  const relatorio = { quando: new Date().toISOString(), enviados: m.enviados, recebidos: m.recebidos, rejeitados: m.rejeitados.slice(0, 50), duplicatas, jaMigrado: Boolean(m.jaFeita) };
  if (!m.id && !m.jaFeita) {              // o registro não pôde ser criado na ativação (estava sem internet)
    const r = await registrarMigracao("localstorage", m.checksum, { local: m.local });
    if (r.jaFeita) m.jaFeita = true; else m.id = r.id;
  }
  if (m.id) await finalizarMigracao(m.id, "concluida", { enviados: m.enviados, recebidos: m.recebidos, rejeitados: m.rejeitados.length, duplicatas }, null);
  try { localStorage.setItem(RELATORIO_CHAVE, JSON.stringify(relatorio)); } catch (erro) { /* ignora */ }
  estadoSync.migracao = null;
  salvarEstadoSync();
}

function marcarMigracaoFalha(e) {
  const m = estadoSync && estadoSync.migracao;
  if (m && m.id) finalizarMigracao(m.id, "falhou", { enviados: m.enviados, recebidos: m.recebidos }, e.message).catch(() => {});
}

/* --- Possíveis duplicatas (nunca remove sozinho) --- */
function detectarDuplicatas() {
  const grupos = [], norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
  const agrupar = (tabela, lista, chave, titulo) => {
    const mapa = new Map();
    lista.forEach((i) => { const k = chave(i); mapa.set(k, [...(mapa.get(k) || []), i]); });
    mapa.forEach((itens) => { if (itens.length > 1) grupos.push({ tabela, itens, titulo: titulo(itens[0]) }); });
  };
  // Movimentações ligadas a abastecimento/manutenção ficam de fora (têm vínculo)
  agrupar("movimentacoes", movimentacoes.filter((m) => !m.origem), (m) => [m.tipo, m.data, m.valor, norm(m.categoria), norm(m.descricao)].join("|"),
    (m) => m.descricao + " • " + m.categoria + " • " + formatarMoeda(m.valor) + " • " + formatarData(m.data));
  agrupar("turnos", extras.turnos, (t) => [t.data, t.inicio, t.fim, t.ganhos, t.entregas].join("|"),
    (t) => "Turno " + formatarData(t.data) + " • " + t.inicio + " às " + t.fim + " • " + formatarMoeda(t.ganhos));
  return grupos;
}

function removerCopias(grupo) {
  const n = grupo.itens.length - 1;
  if (!confirm("Remover " + n + " cópia(s) e manter 1?\n\nSe forem lançamentos legítimos repetidos, cancele.")) return;
  const remover = new Set(grupo.itens.slice(1).map((i) => i.id));
  if (grupo.tabela === "movimentacoes") { movimentacoes = movimentacoes.filter((m) => !remover.has(m.id)); salvarDados(); }
  else { extras.turnos = extras.turnos.filter((t) => !remover.has(t.id)); salvarExtras("turnos"); }
  atualizarTela();
  mostrarDuplicatas();
  toast("Cópias removidas.");
}

function mostrarDuplicatas() {
  const box = $("blocoDuplicatas"), grupos = detectarDuplicatas();
  box.hidden = false;
  box.innerHTML = "";
  if (!grupos.length) { box.append(el("p", "dica", "Nenhuma possível duplicata encontrada. 👍")); return; }
  box.append(el("p", "dica", "Itens com exatamente os mesmos dados. Podem ser repetições legítimas (ex.: duas corridas iguais no mesmo dia), então confira antes de remover."));
  const ul = el("ul", "historico");
  grupos.forEach((g) => {
    const li = criarItem("breve", g.titulo, g.itens.length + " registros idênticos", "");
    const b = el("button", "btn-excluir", "Remover " + (g.itens.length - 1) + (g.itens.length > 2 ? " cópias" : " cópia"));
    b.type = "button";
    b.addEventListener("click", () => removerCopias(g));
    li.append(b);
    ul.append(li);
  });
  box.append(ul);
}

/* --- Restaurar o backup preventivo (somente neste aparelho) --- */
function restaurarBackupPreventivo() {
  const b = lerJson(BACKUP_PREVENTIVO_CHAVE);
  if (!b || !b.pacote) { toast("Nenhum backup preventivo encontrado.", true); return; }
  const quando = new Date(b.criadoEm).toLocaleString("pt-BR");
  if (!confirm("Restaurar o backup preventivo de " + quando + "?\n\n• Os dados DESTE aparelho voltam ao estado daquele momento.\n• O estado atual é salvo antes (arquivo + cópia interna).\n• A sincronização será pausada; ao reativar, os dados são reunidos de novo com a nuvem.\n\nA nuvem não é alterada.")) return;
  try {
    const atual = montarPacoteBackup();
    localStorage.setItem(BACKUP_ANTES_RESTAURAR_CHAVE, JSON.stringify({ criadoEm: new Date().toISOString(), pacote: atual }));
    baixarJson("movix-backup-antes-da-restauracao-" + dataParaTexto(new Date()) + ".json", atual);
  } catch (e) { toast("Não foi possível salvar o estado atual. Nada foi alterado.", true); return; }

  if (estadoSync) { estadoSync.ativo = false; estadoSync.snapshot = {}; estadoSync.ultimoPull = {}; estadoSync.migracao = null; salvarEstadoSync(); }
  const p = b.pacote;
  movimentacoes = (Array.isArray(p.movimentacoes) ? p.movimentacoes : []).filter(registroValido);
  salvarDados();
  Object.keys(extras).forEach((nome) => { extras[nome] = (Array.isArray(p[nome]) ? p[nome] : []).filter((i) => itemExtraValido(nome, i)); salvarExtras(nome); });
  metaSemanal = Number(p.metaSemanal) > 0 ? Number(p.metaSemanal) : 0;
  metaMensal = Number(p.metaMensal) > 0 ? Number(p.metaMensal) : 0;
  metaSemanal ? localStorage.setItem(CHAVE_META, String(metaSemanal)) : localStorage.removeItem(CHAVE_META);
  metaMensal ? localStorage.setItem(CHAVE_META_MENSAL, String(metaMensal)) : localStorage.removeItem(CHAVE_META_MENSAL);
  $("campoMeta").value = metaSemanal || "";
  $("campoMetaMensal").value = metaMensal || "";
  prepararVeiculos();
  atualizarTela();
  renderizarSync();
  toast("Backup restaurado. Sincronização pausada neste aparelho.");
}

/* --- Relatório da migração --- */
function renderizarRelatorio() {
  const box = $("relatorioMigracao"), r = lerJson(RELATORIO_CHAVE);
  box.hidden = $("tituloRelatorio").hidden = !r;
  box.innerHTML = "";
  if (!r) return;
  box.append(linhaInfo("Concluída em", new Date(r.quando).toLocaleString("pt-BR")));
  Object.keys(NOMES_TABELAS).forEach((n) => {
    const env = (r.enviados && r.enviados[n]) || 0, rec = (r.recebidos && r.recebidos[n]) || 0;
    if (env || rec) box.append(linhaInfo(NOMES_TABELAS[n], env + " enviados • " + rec + " trazidos"));
  });
  box.append(linhaInfo("Recusados pelo servidor", String(r.rejeitados.length), r.rejeitados.length ? "d" : "g"),
    linhaInfo("Possíveis duplicatas", String(r.duplicatas), r.duplicatas ? "d" : "g"));
  if (r.jaMigrado) box.append(el("p", "dica", "Estes mesmos dados já tinham sido migrados antes para esta conta."));
}

/* ---------- 9. Inicialização ---------- */
function iniciarSync() {
  carregarEstadoSync();
  // Observa gravações do app no LocalStorage para agendar o envio
  const setOriginal = Storage.prototype.setItem, removeOriginal = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) { setOriginal.call(this, k, v); if (this === localStorage && String(k).startsWith("motograna:")) agendar(); };
  Storage.prototype.removeItem = function (k) { removeOriginal.call(this, k); if (this === localStorage && String(k).startsWith("motograna:")) agendar(); };

  $("btnSyncAtivar").addEventListener("click", ativarSincronizacao);
  $("btnSyncAgora").addEventListener("click", sincronizar);
  $("btnSyncPausar").addEventListener("click", pausarSincronizacao);
  $("btnDuplicatas").addEventListener("click", mostrarDuplicatas);
  $("btnRestaurarPreventivo").addEventListener("click", restaurarBackupPreventivo);
  // Backup JSON importado: registra a importação na conta (melhor esforço) e avisa se já foi feita
  document.addEventListener("movix:backup-importado", async (ev) => {
    if (!usuarioAtual() || !lerConfiguracao().ok || !navigator.onLine) return;
    try {
      const checksum = await calcularChecksum(ev.detail.texto);
      const resumo = { adicionados: ev.detail.adicionados, ignorados: ev.detail.ignorados };
      const r = await registrarMigracao("backup_json", checksum, resumo);
      if (r.jaFeita) toast("Este backup já tinha sido importado nesta conta em " + new Date(r.quando).toLocaleDateString("pt-BR") + ". Nada foi duplicado.");
      else await finalizarMigracao(r.id, "concluida", resumo, null);
    } catch (e) { /* registro é opcional */ }
  });
  document.addEventListener("movix:auth", () => { renderizarSync(); if (podeSincronizar()) sincronizar(); });
  window.addEventListener("online", sincronizar);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizar(); });
  setInterval(() => { if (!document.hidden) sincronizar(); }, 60000);

  renderizarSync();
  sincronizar();
}

iniciarSync();
