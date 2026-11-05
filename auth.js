/* =====================================================
   Movix – Autenticação (Fase 3.2)
   Fala direto com a API de autenticação do Supabase usando fetch:
   nenhuma biblioteca externa. Depende do config.js e do script.js
   (usa $, el, toast e linhaInfo definidos lá).
   Os DADOS do app continuam no LocalStorage; a sincronização é a etapa 3.4.
   Organização: 1 Configuração • 2 Chamadas à API • 3 Sessão • 4 Ações
                • 5 Links de e-mail • 6 Tela • 7 Inicialização
   ===================================================== */

const SESSAO_CHAVE = "movix:sessao";   // não é incluída nos backups
const MARGEM_RENOVACAO = 60;           // renova o token 60 s antes de vencer
const TEMPO_LIMITE_MS = 15000;
const SENHA_MIN = 8;

let sessao = null;          // { access_token, refresh_token, expires_at, user: { id, email, nome } }
let modoAuth = "entrar";    // "entrar" | "criar"
let tokenRecuperacao = null; // { tokens, user } enquanto o usuário define a nova senha
let timerRenovacao = null;
let conectado = true;

const agoraSeg = () => Math.floor(Date.now() / 1000);
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ---------- 1. Configuração ---------- */

// Lê o papel ("role") dentro de uma chave JWT, só para barrar a service_role
function papelDaChave(chave) {
  try {
    const corpo = chave.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(corpo)).role || "";
  } catch (erro) { return ""; }
}

function lerConfiguracao() {
  const cfg = typeof MOVIX_CONFIG === "object" && MOVIX_CONFIG ? MOVIX_CONFIG : {};
  const url = String(cfg.supabaseUrl || "").trim().replace(/\/+$/, "");
  const chave = String(cfg.supabaseAnonKey || "").trim();
  if (!url && !chave) return { ok: false, motivo: "vazia" };
  if (!url || !chave) return { ok: false, motivo: "Preencha supabaseUrl e supabaseAnonKey no config.js." };
  let u;
  try { u = new URL(url); } catch (erro) { return { ok: false, motivo: "A URL do Supabase no config.js é inválida." }; }
  if (u.protocol !== "https:" && u.hostname !== "localhost") return { ok: false, motivo: "A URL do Supabase deve começar com https://." };
  if (chave.startsWith("sb_secret_") || papelDaChave(chave) === "service_role") {
    return { ok: false, motivo: "Chave bloqueada: essa é a service_role/secret e nunca pode ficar no app. Use a chave anon/publishable." };
  }
  return { ok: true, url, chave };
}

/* ---------- 2. Chamadas à API de autenticação ---------- */

async function authFetch(caminho, { metodo = "POST", corpo, token } = {}) {
  const cfg = lerConfiguracao();
  if (!cfg.ok) { const e = new Error("sem configuração"); e.semConfig = true; throw e; }
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  let resp;
  try {
    resp = await fetch(cfg.url + "/auth/v1" + caminho, {
      method: metodo,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: cfg.chave, ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
  } catch (erro) {
    const e = new Error("rede"); e.rede = true; throw e;
  } finally { clearTimeout(limite); }

  let dados = null;
  try { dados = await resp.json(); } catch (erro) { /* resposta sem corpo (ex.: logout) */ }
  if (!resp.ok) {
    const e = new Error((dados && (dados.msg || dados.error_description || dados.message)) || "erro");
    e.status = resp.status;
    e.codigo = dados ? (dados.error_code || dados.error || "") : "";
    throw e;
  }
  return dados;
}

function traduzirErro(e) {
  if (e.semConfig) return "Contas ainda não configuradas (config.js).";
  if (e.rede) return "Sem conexão com a internet. Tente novamente.";
  const mapa = {
    invalid_credentials: "E-mail ou senha incorretos.",
    email_not_confirmed: "Confirme seu e-mail antes de entrar (veja a caixa de entrada e o spam).",
    user_already_exists: "Este e-mail já está cadastrado. Tente entrar.",
    weak_password: "Senha fraca. Use ao menos " + SENHA_MIN + " caracteres, misturando letras e números.",
    over_request_rate_limit: "Muitas tentativas. Aguarde um pouco e tente de novo.",
    over_email_send_rate_limit: "Limite de e-mails atingido. Aguarde alguns minutos.",
    signup_disabled: "Novos cadastros estão desativados.",
    same_password: "A nova senha deve ser diferente da atual.",
    email_address_invalid: "E-mail inválido.",
    validation_failed: "Confira os dados informados."
  };
  if (mapa[e.codigo]) return mapa[e.codigo];
  if (e.status === 429) return mapa.over_request_rate_limit;
  const msg = (e.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) return mapa.invalid_credentials;
  if (msg.includes("email not confirmed")) return mapa.email_not_confirmed;
  return "Não foi possível concluir (erro " + (e.status || "?") + "). Tente novamente.";
}

// Endereço para onde o link do e-mail volta (só funciona com o app hospedado em http/https)
function parametroRedirecionamento() {
  return location.protocol.startsWith("http") ? "?redirect_to=" + encodeURIComponent(location.origin + location.pathname) : "";
}

/* ---------- 3. Sessão (persistente e renovada sozinha) ---------- */

function avisarMudancaDeSessao() {
  // Ponto de ligação para a sincronização (etapa 3.4)
  document.dispatchEvent(new CustomEvent("movix:auth", { detail: { logado: Boolean(sessao) } }));
}

function guardarSessao(tokens, user) {
  sessao = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Number(tokens.expires_at) || agoraSeg() + (Number(tokens.expires_in) || 3600),
    user: { id: user.id, email: user.email, nome: (user.user_metadata && user.user_metadata.nome) || "" }
  };
  try { localStorage.setItem(SESSAO_CHAVE, JSON.stringify(sessao)); } catch (erro) { /* sem espaço: segue só em memória */ }
  agendarRenovacao();
  avisarMudancaDeSessao();
}

function carregarSessao() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSAO_CHAVE));
    const valida = s && typeof s.access_token === "string" && typeof s.refresh_token === "string"
      && typeof s.expires_at === "number" && s.user && typeof s.user.id === "string";
    sessao = valida ? s : null;
  } catch (erro) { sessao = null; }
}

// Encerra só a sessão deste aparelho. Os dados do app NÃO são tocados.
function encerrarSessaoLocal() {
  sessao = null;
  clearTimeout(timerRenovacao);
  try { localStorage.removeItem(SESSAO_CHAVE); } catch (erro) { /* ignora */ }
  avisarMudancaDeSessao();
}

function agendarRenovacao() {
  clearTimeout(timerRenovacao);
  if (!sessao) return;
  const espera = Math.max(5000, (sessao.expires_at - MARGEM_RENOVACAO) * 1000 - Date.now());
  timerRenovacao = setTimeout(renovarSessao, Math.min(espera, 2147000000));
}

async function renovarSessao() {
  if (!sessao) return;
  try {
    const d = await authFetch("/token?grant_type=refresh_token", { corpo: { refresh_token: sessao.refresh_token } });
    guardarSessao(d, d.user || sessao.user);
    conectado = true;
  } catch (e) {
    if (e.rede || e.status >= 500) {          // sem internet: mantém a sessão e tenta de novo
      conectado = false;
      clearTimeout(timerRenovacao);
      timerRenovacao = setTimeout(renovarSessao, 30000);
    } else {                                    // token recusado: sessão não vale mais
      encerrarSessaoLocal();
      toast("Sua sessão expirou. Entre novamente.", true);
    }
  }
  renderizarConta();
}

// Para a sincronização usar: devolve um token válido (renovando se preciso) ou null
async function obterTokenValido() {
  if (!sessao) return null;
  if (sessao.expires_at - agoraSeg() < MARGEM_RENOVACAO) await renovarSessao();
  return sessao ? sessao.access_token : null;
}

/* ---------- 4. Ações do usuário ---------- */

function mostrarMensagemAuth(texto, erro) {
  const m = $("mensagemAuth");
  m.textContent = texto;
  m.classList.toggle("erro-msg", Boolean(erro));
}

function definirModoAuth(modo) {
  modoAuth = modo;
  document.querySelectorAll("#abasConta .aba").forEach((a) => a.classList.toggle("ativa", a.dataset.modo === modo));
  $("campoNomeAuth").hidden = modo !== "criar";
  $("campoConfirmarAuth").hidden = modo !== "criar";
  $("btnEsqueci").hidden = modo === "criar";
  $("btnAuth").textContent = modo === "criar" ? "Criar conta" : "Entrar";
  $("authSenha").autocomplete = modo === "criar" ? "new-password" : "current-password";
  mostrarMensagemAuth("", false);
}

async function aoEnviarAuth(ev) {
  ev.preventDefault();
  const email = $("authEmail").value.trim().toLowerCase(), senha = $("authSenha").value;
  if (!emailValido(email)) return mostrarMensagemAuth("Informe um e-mail válido.", true);
  if (modoAuth === "criar") {
    if (senha.length < SENHA_MIN) return mostrarMensagemAuth("A senha precisa ter ao menos " + SENHA_MIN + " caracteres.", true);
    if (senha !== $("authConfirmar").value) return mostrarMensagemAuth("As senhas não são iguais.", true);
  } else if (senha === "") return mostrarMensagemAuth("Informe a senha.", true);

  const botao = $("btnAuth"), textoBotao = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Aguarde...";
  mostrarMensagemAuth("", false);
  try {
    if (modoAuth === "entrar") {
      const d = await authFetch("/token?grant_type=password", { corpo: { email, password: senha } });
      guardarSessao(d, d.user);
      toast("Bem-vindo de volta!");
    } else {
      const nome = $("authNome").value.trim().slice(0, 80);
      const d = await authFetch("/signup" + parametroRedirecionamento(), { corpo: { email, password: senha, data: nome ? { nome } : {} } });
      if (d && d.access_token) {          // projeto sem confirmação de e-mail: já entra
        guardarSessao(d, d.user);
        toast("Conta criada! Você já está conectado.");
      } else {                            // mensagem neutra: não revela se o e-mail já existia
        definirModoAuth("entrar");
        mostrarMensagemAuth("Pronto! Se o e-mail for novo, enviamos um link de confirmação. Confirme e depois entre.", false);
      }
    }
    $("authSenha").value = ""; $("authConfirmar").value = "";
  } catch (e) {
    mostrarMensagemAuth(traduzirErro(e), true);
  } finally {
    botao.disabled = false;
    botao.textContent = textoBotao;
  }
  renderizarConta();
}

async function aoEsqueciSenha() {
  const email = $("authEmail").value.trim().toLowerCase();
  if (!emailValido(email)) return mostrarMensagemAuth("Digite seu e-mail no campo acima e toque de novo em \"Esqueci minha senha\".", true);
  try {
    await authFetch("/recover" + parametroRedirecionamento(), { corpo: { email } });
    mostrarMensagemAuth("Se existir uma conta com esse e-mail, enviamos o link para criar uma nova senha.", false);
  } catch (e) { mostrarMensagemAuth(traduzirErro(e), true); }
}

async function aoSair() {
  if (!confirm("Sair da conta neste aparelho? Seus dados continuam salvos aqui.")) return;
  const token = sessao && sessao.access_token;
  encerrarSessaoLocal();       // primeiro local, para funcionar mesmo sem internet
  renderizarConta();
  toast("Você saiu da conta.");
  try { if (token) await authFetch("/logout?scope=local", { token }); } catch (e) { /* ignora */ }
}

async function aoDefinirNovaSenha(ev) {
  ev.preventDefault();
  const senha = $("novaSenha").value, aviso = $("mensagemNovaSenha");
  aviso.classList.add("erro-msg");
  if (senha.length < SENHA_MIN) { aviso.textContent = "A senha precisa ter ao menos " + SENHA_MIN + " caracteres."; return; }
  if (senha !== $("novaSenhaConfirmar").value) { aviso.textContent = "As senhas não são iguais."; return; }
  try {
    const user = await authFetch("/user", { metodo: "PUT", token: tokenRecuperacao.tokens.access_token, corpo: { password: senha } });
    guardarSessao(tokenRecuperacao.tokens, user);
    tokenRecuperacao = null;
    $("novaSenha").value = ""; $("novaSenhaConfirmar").value = ""; aviso.textContent = "";
    toast("Senha alterada! Você já está conectado.");
  } catch (e) { aviso.textContent = traduzirErro(e); return; }
  renderizarConta();
}

/* ---------- 5. Links enviados por e-mail (confirmação e recuperação) ---------- */

function limparEndereco() {
  try { history.replaceState(null, "", location.pathname + location.search); } catch (erro) { /* ignora */ }
}

async function processarLinkDoEmail() {
  const hash = location.hash.slice(1);
  if (!hash.includes("access_token") && !hash.includes("error_description")) return;
  const p = new URLSearchParams(hash);
  limparEndereco(); // tokens nunca ficam no endereço
  if (p.get("error_description")) {
    mostrarMensagemAuth("Link inválido ou expirado. Peça um novo.", true);
    return;
  }
  const tokens = { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_at: p.get("expires_at"), expires_in: p.get("expires_in") };
  try {
    const user = await authFetch("/user", { metodo: "GET", token: tokens.access_token });
    if (p.get("type") === "recovery") tokenRecuperacao = { tokens, user };
    else { guardarSessao(tokens, user); toast("E-mail confirmado! Você já está conectado."); }
  } catch (e) { mostrarMensagemAuth(traduzirErro(e), true); }
  renderizarConta();
  const secao = $("sec-conta");
  if (secao) secao.scrollIntoView({ behavior: "smooth" });
}

/* ---------- 6. Tela ---------- */

function renderizarConta() {
  const cfg = lerConfiguracao(), aviso = $("contaAviso");
  aviso.hidden = cfg.ok;
  if (!cfg.ok) aviso.textContent = cfg.motivo === "vazia"
    ? "Contas ainda não configuradas: preencha supabaseUrl e supabaseAnonKey no arquivo config.js. Enquanto isso o Movix funciona normalmente, só neste aparelho."
    : cfg.motivo;

  $("formNovaSenha").hidden = !(cfg.ok && tokenRecuperacao);
  $("contaVisitante").hidden = !cfg.ok || Boolean(sessao) || Boolean(tokenRecuperacao);
  $("contaLogada").hidden = !cfg.ok || !sessao || Boolean(tokenRecuperacao);

  const resumo = $("resumoConta");
  resumo.innerHTML = "";
  if (sessao) {
    if (sessao.user.nome) resumo.append(linhaInfo("Nome", sessao.user.nome));
    resumo.append(
      linhaInfo("E-mail", sessao.user.email),
      linhaInfo("Sessão", conectado ? "Ativa" : "Sem internet (reconecta sozinha)", conectado ? "g" : "d")
    );
  }
  if (typeof renderizarSync === "function") renderizarSync();
}

/* ---------- 7. Inicialização ---------- */

async function iniciarAuth() {
  carregarSessao();
  $("abasConta").addEventListener("click", (ev) => { const a = ev.target.closest(".aba"); if (a) definirModoAuth(a.dataset.modo); });
  $("formAuth").addEventListener("submit", aoEnviarAuth);
  $("btnEsqueci").addEventListener("click", aoEsqueciSenha);
  $("btnSair").addEventListener("click", aoSair);
  $("formNovaSenha").addEventListener("submit", aoDefinirNovaSenha);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sessao && sessao.expires_at - agoraSeg() < MARGEM_RENOVACAO) renovarSessao(); });
  window.addEventListener("online", () => { if (sessao) renovarSessao(); });

  definirModoAuth("entrar");
  renderizarConta();
  await processarLinkDoEmail();
  if (sessao) {
    if (sessao.expires_at - agoraSeg() < MARGEM_RENOVACAO) await renovarSessao();
    else agendarRenovacao();
  }
  renderizarConta();
}

iniciarAuth();
