/* =====================================================
   Movix – Lobby (tela inicial)
   Decide o que mostrar ao abrir o app:
     • sem login                      -> Lobby (Entrar / Criar conta)
     • com login                      -> direto para o Dashboard
     • config.js vazio (sem Supabase) -> Dashboard local, sem Lobby
     • "Usar sem conta" escolhido     -> Dashboard local (até entrar ou sair de uma conta)
   Este arquivo NÃO tem autenticação própria: reaproveita o formulário de
   login/cadastro, a sessão e a recuperação de senha do auth.js.
   Depende de script.js ($) e auth.js (sessao, lerConfiguracao, definirModoAuth).
   A primeira decisão (sem "piscar") é tomada por um pequeno script no <head>
   do index.html, que marca <html class="lobby-ativo">.
   ===================================================== */

const CHAVE_MODO_LOCAL = "movix:modo-local";   // "1" = usuário escolheu usar sem conta

const configOk = () => lerConfiguracao().ok;
const autenticado = () => typeof sessao !== "undefined" && Boolean(sessao);
const modoLocal = () => { try { return localStorage.getItem(CHAVE_MODO_LOCAL) === "1"; } catch (erro) { return false; } };
const definirModoLocal = (ligado) => { try { ligado ? localStorage.setItem(CHAVE_MODO_LOCAL, "1") : localStorage.removeItem(CHAVE_MODO_LOCAL); } catch (erro) { /* ignora */ } };
const precisaLobby = () => configOk() && !autenticado() && !modoLocal();

// tela: "lobby" | "auth" (formulário em tela cheia) | "app" (Dashboard)
function aplicarTela(tela) {
  const raiz = document.documentElement;
  raiz.classList.toggle("lobby-ativo", tela !== "app");
  raiz.classList.toggle("tela-auth", tela === "auth");
  if (tela !== "app") window.scrollTo(0, 0);
}

function telaInicial() {
  if (!configOk()) return "app";
  if (autenticado() || modoLocal()) return "app";
  return window.__movixLinkEmail ? "auth" : "lobby";   // link de confirmação/recuperação aberto
}

// Abre o login/cadastro (o mesmo formulário da seção Conta) e guarda no histórico para o botão Voltar
function abrirAuth(modo) {
  definirModoAuth(modo);
  history.pushState({ movix: "auth", doLobby: true }, "");
  aplicarTela("auth");
}

function voltarParaLobby() {
  if (history.state && history.state.doLobby) history.back();   // popstate volta para o Lobby
  else aplicarTela("lobby");
}

function usarSemConta() {
  definirModoLocal(true);
  aplicarTela("app");
}

function aoVoltarNoNavegador() {
  if (!precisaLobby()) { aplicarTela("app"); return; }
  aplicarTela(history.state && history.state.movix === "auth" ? "auth" : "lobby");
}

// auth.js avisa quando entra ou sai uma sessão (login, logout, sessão expirada)
function aoMudarSessao(ev) {
  if (ev.detail.logado) {
    definirModoLocal(false);
    if (history.state && history.state.movix === "auth") history.replaceState(null, "");
    aplicarTela("app");
  } else if (configOk()) {
    definirModoLocal(false);
    aplicarTela("lobby");
  }
}

function iniciarLobby() {
  $("lobbyEntrar").addEventListener("click", () => abrirAuth("entrar"));
  $("lobbyCriar").addEventListener("click", () => abrirAuth("criar"));
  $("lobbyLocal").addEventListener("click", usarSemConta);
  $("authVoltar").addEventListener("click", voltarParaLobby);
  document.addEventListener("movix:auth", aoMudarSessao);
  window.addEventListener("popstate", aoVoltarNoNavegador);
  aplicarTela(telaInicial());
}

iniciarLobby();
