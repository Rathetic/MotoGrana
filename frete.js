/* =====================================================
   Movix – Calculadora de frete por km
   O usuário informa origem, destino e quanto cobra por km. O app descobre a
   distância rodoviária pelo OpenRouteService (plano gratuito) e calcula:
     valor = (distância total × preço por km) + pedágio + taxa adicional
   Se não houver internet, chave ou resposta da API, dá para digitar a distância
   à mão (modo manual) e o cálculo continua igual.

   Guarda neste aparelho (localStorage, NÃO sincroniza e NÃO entra no backup):
     preço por km e origem padrão. Não guarda histórico de orçamentos.
   Depende de script.js ($, el, linhaInfo, toast, formatarMoeda) e config.js.
   ===================================================== */
(function () {
  "use strict";

  const CHAVE_FRETE = "motograna:frete";
  const ORS_URL_PADRAO = "https://api.heigit.org/openrouteservice";     // rotas
  const GEOCODE_URL_PADRAO = "https://api.heigit.org/pelias/v1";        // busca de endereços (serviço separado)
  const ORIGEM_PADRAO = "Vassouras, RJ";
  const PRECO_KM_PADRAO = 1;
  const FOCO_BUSCA = { lon: -43.66, lat: -22.4 };   // prioriza resultados perto de Vassouras
  const ESPERA_BUSCA_MS = 600;                       // evita gastar a cota enquanto digita
  const TEMPO_LIMITE_MS = 12000;

  /* ---------- Cálculo (funções puras, sem tela) ---------- */

  // Converte "1,50" ou "1.50" em número; vazio vira NaN
  function lerNumero(valor) {
    if (typeof valor === "number") return valor;
    const texto = String(valor == null ? "" : valor).trim().replace(",", ".");
    return texto === "" ? NaN : Number(texto);
  }

  // Arredonda só o dinheiro (centavos). A distância nunca é arredondada antes do cálculo.
  const arredondarCentavos = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Pedágio e taxa são opcionais: vazio = 0. Retorna NaN se for inválido (negativo ou texto).
  function valorOpcional(valor) {
    const n = lerNumero(valor);
    if (Number.isNaN(n)) return String(valor == null ? "" : valor).trim() === "" ? 0 : NaN;
    return n >= 0 ? n : NaN;
  }

  function calcularFrete({ distanciaKm, idaVolta, precoKm, pedagio, taxa }) {
    const ida = lerNumero(distanciaKm);
    const preco = lerNumero(precoKm);
    const ped = valorOpcional(pedagio);
    const tx = valorOpcional(taxa);
    if (!Number.isFinite(ida) || ida <= 0) return { ok: false, motivo: "distancia" };
    if (!Number.isFinite(preco) || preco <= 0) return { ok: false, motivo: "preco" };
    if (!Number.isFinite(ped)) return { ok: false, motivo: "pedagio" };
    if (!Number.isFinite(tx)) return { ok: false, motivo: "taxa" };
    const total = idaVolta ? ida * 2 : ida;
    return {
      ok: true,
      idaVolta: Boolean(idaVolta),
      distanciaIda: ida,
      distanciaTotal: total,
      precoKm: preco,
      pedagio: ped,
      taxa: tx,
      valor: arredondarCentavos(total * preco + ped + tx)
    };
  }

  const moeda = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const km1 = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km";

  // Texto do orçamento (copiar / WhatsApp). Pedágio e taxa só aparecem se forem maiores que zero.
  function montarMensagem(r, origem, destino) {
    const linhas = ["*Orçamento de frete* 🏍️"];
    if (origem) linhas.push("📍 Origem: " + origem);
    if (destino) linhas.push("🏁 Destino: " + destino);
    linhas.push(r.idaVolta
      ? "🛣️ Distância: " + km1(r.distanciaIda) + " (ida) • " + km1(r.distanciaTotal) + " (ida e volta)"
      : "🛣️ Distância: " + km1(r.distanciaIda) + " (somente ida)");
    linhas.push("💵 Valor por km: " + moeda(r.precoKm));
    if (r.pedagio > 0) linhas.push("🧾 Pedágio: " + moeda(r.pedagio));
    if (r.taxa > 0) linhas.push("➕ Taxa adicional: " + moeda(r.taxa));
    linhas.push("", "*Total estimado: " + moeda(r.valor) + "*");
    return linhas.join("\n");
  }

  /* ---------- OpenRouteService ---------- */

  function configuracaoOrs() {
    const cfg = (typeof MOVIX_CONFIG !== "undefined" && MOVIX_CONFIG) || {};
    const chave = String(cfg.orsApiKey || "").trim();
    const base = String(cfg.orsBaseUrl || ORS_URL_PADRAO).trim().replace(/\/+$/, "");
    const baseGeo = String(cfg.orsGeocodeUrl || GEOCODE_URL_PADRAO).trim().replace(/\/+$/, "");
    return { chave, base, baseGeo };
  }

  // Erro com um texto pronto para mostrar ao usuário (nunca contém a chave)
  function erroFrete(mensagem, codigo) {
    const e = new Error(mensagem);
    e.codigo = codigo;
    return e;
  }

  // GET com tempo limite. A chave vai na URL (assim a chamada é "simples" e não exige preflight de CORS).
  async function pedirOrs(caminho, parametros, geocodificacao) {
    const cfgOrs = configuracaoOrs();
    const chave = cfgOrs.chave;
    const base = geocodificacao ? cfgOrs.baseGeo : cfgOrs.base;
    if (!chave) throw erroFrete("A chave do OpenRouteService não está configurada em config.js.", "sem-chave");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw erroFrete("Sem internet no momento.", "offline");
    }
    const url = new URL(base + caminho);
    Object.keys(parametros).forEach((k) => url.searchParams.set(k, parametros[k]));
    url.searchParams.set("api_key", chave);
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
    let resposta;
    try {
      resposta = await fetch(url.toString(), { signal: controle.signal });
    } catch (erro) {
      throw erroFrete(erro && erro.name === "AbortError"
        ? "O serviço de rotas demorou demais para responder."
        : "Não foi possível falar com o serviço de rotas (verifique a internet).", "rede");
    } finally {
      clearTimeout(timer);
    }
    if (resposta.ok) {
      try { return await resposta.json(); } catch (erro) { throw erroFrete("Resposta inesperada do serviço de rotas.", "resposta"); }
    }
    if (resposta.status === 401 || resposta.status === 403) throw erroFrete("O serviço de rotas recusou a chave (inválida ou sem permissão).", "chave");
    if (resposta.status === 429) throw erroFrete("O limite gratuito diário do serviço de rotas foi atingido.", "limite");
    if (resposta.status === 404) throw erroFrete("Não encontrei estrada perto de um dos pontos.", "sem-rota");
    throw erroFrete("O serviço de rotas está indisponível agora (erro " + resposta.status + ").", "servico");
  }

  function lerLugares(dados) {
    const itens = (dados && Array.isArray(dados.features)) ? dados.features : [];
    return itens
      .filter((f) => f && f.geometry && Array.isArray(f.geometry.coordinates) && f.properties && f.properties.label)
      .map((f) => ({ texto: String(f.properties.label), lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]) }))
      .filter((l) => Number.isFinite(l.lon) && Number.isFinite(l.lat));
  }

  const parametrosBusca = (texto, tamanho) => ({
    text: texto,
    "boundary.country": "BR",
    size: String(tamanho),
    "focus.point.lon": String(FOCO_BUSCA.lon),
    "focus.point.lat": String(FOCO_BUSCA.lat)
  });

  const sugerirLugares = async (texto) => lerLugares(await pedirOrs("/autocomplete", parametrosBusca(texto, 5), true));

  async function resolverLugar(texto) {
    const lugares = lerLugares(await pedirOrs("/search", parametrosBusca(texto, 1), true));
    if (!lugares.length) throw erroFrete("Não encontrei o local “" + texto + "”. Tente incluir a cidade e o estado.", "sem-lugar");
    return lugares[0];
  }

  // Distância rodoviária em km (sem arredondar), a partir de duas coordenadas
  async function distanciaPorEstrada(a, b) {
    const dados = await pedirOrs("/v2/directions/driving-car", {
      start: a.lon + "," + a.lat,
      end: b.lon + "," + b.lat
    });
    const resumo =
      (dados && dados.features && dados.features[0] && dados.features[0].properties && dados.features[0].properties.summary) ||
      (dados && dados.routes && dados.routes[0] && dados.routes[0].summary);
    const metros = resumo ? Number(resumo.distance) : NaN;
    if (!Number.isFinite(metros) || metros <= 0) throw erroFrete("O serviço de rotas não devolveu a distância.", "resposta");
    return metros / 1000;
  }

  /* ---------- Armazenamento local (só neste aparelho) ---------- */

  function lerConfigFrete() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_FRETE));
      return salvo && typeof salvo === "object" ? salvo : {};
    } catch (erro) { return {}; }
  }

  function salvarConfigFrete(parcial) {
    try { localStorage.setItem(CHAVE_FRETE, JSON.stringify({ ...lerConfigFrete(), ...parcial })); } catch (erro) { /* sem armazenamento: ignora */ }
  }

  /* ---------- Tela ---------- */

  function iniciarFrete() {
    if (typeof document === "undefined" || !document.getElementById("sec-frete")) return;

    const campos = {
      origem: $("freteOrigem"), destino: $("freteDestino"), manual: $("freteDistManual"),
      preco: $("fretePrecoKm"), idaVolta: $("freteIdaVolta"), pedagio: $("fretePedagio"), taxa: $("freteTaxa")
    };
    const estado = {
      modo: configuracaoOrs().chave ? "auto" : "manual",
      origem: null,      // { texto, lon, lat } quando já resolvida
      destino: null,
      distancia: null,   // { km, origem, destino } vindo da API para o par de textos atual
      ultimo: null,      // último resultado válido (para copiar/compartilhar)
      calculando: false
    };

    // Valores guardados neste aparelho
    const salvo = lerConfigFrete();
    campos.preco.value = Number.isFinite(lerNumero(salvo.precoKm)) && lerNumero(salvo.precoKm) > 0 ? salvo.precoKm : PRECO_KM_PADRAO;
    const origemSalva = salvo.origem && salvo.origem.texto ? salvo.origem : null;
    campos.origem.value = origemSalva ? origemSalva.texto : ORIGEM_PADRAO;
    if (origemSalva && Number.isFinite(origemSalva.lon) && Number.isFinite(origemSalva.lat)) estado.origem = origemSalva;

    const status = (texto, erro) => {
      const a = $("mensagemFrete");
      a.textContent = texto || "";
      a.classList.toggle("erro-msg", Boolean(erro));
    };
    const textoOrigem = () => campos.origem.value.trim();
    const textoDestino = () => campos.destino.value.trim();

    /* --- modo automático / manual --- */
    function definirModo(modo) {
      estado.modo = modo;
      document.querySelectorAll("#abasFrete .aba").forEach((b) => {
        const ativa = b.dataset.modo === modo;
        b.classList.toggle("ativa", ativa);
        b.setAttribute("aria-pressed", String(ativa));
      });
      $("freteBlocoAuto").hidden = modo !== "auto";
      $("freteBlocoManual").hidden = modo !== "manual";
      if (modo === "manual" && !configuracaoOrs().chave) {
        status("Chave do OpenRouteService não configurada: use a distância manual (veja config.js).", false);
      } else if (modo === "manual") {
        status("");
      }
      renderizar();
    }

    /* --- resultado --- */
    function distanciaAtual() {
      if (estado.modo === "manual") return lerNumero(campos.manual.value);
      const d = estado.distancia;
      return d && d.origem === textoOrigem() && d.destino === textoDestino() ? d.km : NaN;
    }

    function renderizar() {
      const area = $("resultadoFrete");
      area.innerHTML = "";
      estado.ultimo = null;
      const r = calcularFrete({
        distanciaKm: distanciaAtual(), idaVolta: campos.idaVolta.checked,
        precoKm: campos.preco.value, pedagio: campos.pedagio.value, taxa: campos.taxa.value
      });
      $("acoesFrete").hidden = !r.ok;
      if (!r.ok) {
        const dicas = {
          distancia: estado.modo === "auto" ? "Informe origem e destino e toque em “Calcular distância”." : "Informe a distância em km para ver o valor.",
          preco: "Informe o valor por km (maior que zero).",
          pedagio: "O pedágio deve ser um valor positivo (ou fique em branco).",
          taxa: "A taxa adicional deve ser um valor positivo (ou fique em branco)."
        };
        area.append(el("p", "dica", dicas[r.motivo]));
        return;
      }
      const origem = textoOrigem(), destino = textoDestino();
      estado.ultimo = { r, origem, destino };
      if (origem) area.append(linhaInfo("Origem", origem));
      if (destino) area.append(linhaInfo("Destino", destino));
      area.append(linhaInfo(r.idaVolta ? "Distância de ida" : "Distância (somente ida)", km1(r.distanciaIda)));
      if (r.idaVolta) area.append(linhaInfo("Distância total (ida e volta)", km1(r.distanciaTotal)));
      area.append(
        linhaInfo("Valor por km", moeda(r.precoKm)),
        linhaInfo("Pedágio", moeda(r.pedagio)),
        linhaInfo("Taxa adicional", moeda(r.taxa)),
        linhaInfo("Total estimado", moeda(r.valor), "l g")
      );
    }

    /* --- calcular a distância pela API --- */
    async function calcularDistancia() {
      if (estado.calculando) return;
      const o = textoOrigem(), d = textoDestino();
      if (!o || !d) { status("Preencha a origem e o destino.", true); return; }
      estado.calculando = true;
      const botao = $("freteCalcular");
      botao.disabled = true;
      status("Calculando a rota…", false);
      try {
        // Guardamos o texto como o usuário digitou/escolheu, para não buscar o mesmo local de novo
        if (!estado.origem || estado.origem.texto !== o) {
          estado.origem = { ...(await resolverLugar(o)), texto: o };
          salvarConfigFrete({ origem: estado.origem });
        }
        if (!estado.destino || estado.destino.texto !== d) estado.destino = { ...(await resolverLugar(d)), texto: d };
        const km = await distanciaPorEstrada(estado.origem, estado.destino);
        estado.distancia = { km, origem: o, destino: d };
        status("Distância calculada pelo OpenRouteService.", false);
      } catch (erro) {
        estado.distancia = null;
        const motivo = erro && erro.codigo ? erro.message : "Algo deu errado ao calcular a rota.";
        const falhaDeServico = ["sem-chave", "offline", "rede", "chave", "limite", "servico", "resposta"].includes(erro && erro.codigo);
        if (falhaDeServico) definirModo("manual");   // antes do aviso, para o aviso não ser apagado
        status(motivo + (falhaDeServico ? " Você pode informar a distância manualmente." : ""), true);
        toast(motivo, true);
      } finally {
        estado.calculando = false;
        botao.disabled = false;
        renderizar();
      }
    }

    /* --- sugestões de endereço (digitar 3+ letras) --- */
    const cacheBusca = new Map();
    function ligarSugestoes(campo, lista, chaveEstado) {
      let timer = null, pedido = 0;
      const fechar = () => { lista.hidden = true; lista.innerHTML = ""; };
      campo.addEventListener("input", () => {
        // Editou o texto: a escolha anterior e a distância deixam de valer
        if (estado[chaveEstado] && estado[chaveEstado].texto !== campo.value.trim()) estado[chaveEstado] = null;
        if (chaveEstado === "origem") salvarConfigFrete({ origem: { texto: campo.value.trim() } });
        if (estado.modo === "auto") status("");   // some o aviso do cálculo anterior
        renderizar();
        clearTimeout(timer);
        const texto = campo.value.trim();
        if (estado.modo !== "auto" || texto.length < 3 || !configuracaoOrs().chave) { fechar(); return; }
        timer = setTimeout(async () => {
          const meu = ++pedido;
          try {
            let lugares = cacheBusca.get(texto.toLowerCase());
            if (!lugares) { lugares = await sugerirLugares(texto); cacheBusca.set(texto.toLowerCase(), lugares); }
            if (meu !== pedido || campo.value.trim() !== texto) return;   // chegou atrasada
            lista.innerHTML = "";
            lugares.forEach((lugar) => {
              const li = el("li");
              const b = el("button", "", lugar.texto);
              b.type = "button";
              b.addEventListener("click", () => {
                campo.value = lugar.texto;
                estado[chaveEstado] = lugar;
                if (chaveEstado === "origem") salvarConfigFrete({ origem: lugar });
                fechar();
                renderizar();
              });
              li.appendChild(b);
              lista.appendChild(li);
            });
            lista.hidden = lugares.length === 0;
          } catch (erro) {
            fechar();   // sugestões são só um conforto: o erro aparece ao calcular
          }
        }, ESPERA_BUSCA_MS);
      });
      campo.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fechar(); });
      document.addEventListener("click", (ev) => { if (!lista.contains(ev.target) && ev.target !== campo) fechar(); });
    }
    ligarSugestoes(campos.origem, $("freteSugOrigem"), "origem");
    ligarSugestoes(campos.destino, $("freteSugDestino"), "destino");

    /* --- copiar e compartilhar --- */
    async function copiarTexto(texto) {
      try {
        if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(texto); return true; }
      } catch (erro) { /* tenta o método antigo */ }
      const area = document.createElement("textarea");
      area.value = texto;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (erro) { ok = false; }
      area.remove();
      return ok;
    }

    const mensagemAtual = () => (estado.ultimo ? montarMensagem(estado.ultimo.r, estado.ultimo.origem, estado.ultimo.destino) : "");

    $("freteCopiar").addEventListener("click", async () => {
      const texto = mensagemAtual();
      if (!texto) return;
      toast(await copiarTexto(texto) ? "Orçamento copiado!" : "Não consegui copiar. Selecione o texto e copie manualmente.", false);
    });
    $("freteWhats").addEventListener("click", () => {
      const texto = mensagemAtual();
      if (!texto) return;
      window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank", "noopener");
    });

    /* --- eventos --- */
    document.querySelectorAll("#abasFrete .aba").forEach((b) => b.addEventListener("click", () => definirModo(b.dataset.modo)));
    $("formFrete").addEventListener("submit", (ev) => {
      ev.preventDefault();
      document.querySelectorAll(".sugestoes").forEach((l) => { l.hidden = true; });
      if (estado.modo === "auto") calcularDistancia();
    });
    $("freteCalcular").addEventListener("click", calcularDistancia);
    campos.preco.addEventListener("input", () => {
      const v = lerNumero(campos.preco.value);
      if (Number.isFinite(v) && v > 0) salvarConfigFrete({ precoKm: v });
      renderizar();
    });
    [campos.manual, campos.idaVolta, campos.pedagio, campos.taxa].forEach((c) => c.addEventListener("input", renderizar));
    campos.idaVolta.addEventListener("change", renderizar);

    definirModo(estado.modo);
  }

  // Para testes fora do navegador
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { calcularFrete, montarMensagem, lerNumero, distanciaPorEstrada, resolverLugar, sugerirLugares, lerLugares };
  }

  iniciarFrete();
})();
