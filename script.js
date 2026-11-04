/* =====================================================
   MotoGrana - lógica da aplicação
   Organização:
   1. Configurações e estado
   2. Utilitários (dinheiro e datas)
   3. Persistência (LocalStorage)
   4. Cálculos
   5. Validação
   6. Renderização (desenhar na tela)
   7. Eventos e inicialização
   ===================================================== */

/* ---------- 1. Configurações e estado ---------- */

const CHAVE_STORAGE = "motograna:movimentacoes";

// Categorias disponíveis para cada tipo de movimentação
const CATEGORIAS = {
  ganho: ["iFood", "Uber Eats", "99", "Entrega particular", "Gorjeta", "Outros"],
  despesa: ["Combustível", "Manutenção", "Alimentação", "Aluguel da moto", "Multa", "Outros"]
};

// Lista de movimentações em memória. Cada item:
// { id, descricao, tipo, categoria, valor, data (AAAA-MM-DD) }
let movimentacoes = [];

// Referências aos elementos da página
const form = document.getElementById("formMovimentacao");
const campoDescricao = document.getElementById("descricao");
const campoCategoria = document.getElementById("categoria");
const campoValor = document.getElementById("valor");
const campoData = document.getElementById("data");
const mensagemErro = document.getElementById("mensagemErro");
const listaHistorico = document.getElementById("listaHistorico");
const areaRelatorio = document.getElementById("relatorio");

/* ---------- 2. Utilitários ---------- */

// Formata número como moeda brasileira: 1234.5 -> "R$ 1.234,50"
function formatarMoeda(numero) {
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Converte um objeto Date em texto "AAAA-MM-DD" usando o fuso local
function dataParaTexto(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Converte "AAAA-MM-DD" para "DD/MM/AAAA" (sem mexer em fuso horário)
function formatarData(texto) {
  const [ano, mes, dia] = texto.split("-");
  return `${dia}/${mes}/${ano}`;
}

// Gera um identificador único para cada registro
function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Retorna o tipo escolhido no formulário ("ganho" ou "despesa")
function tipoSelecionado() {
  return form.elements["tipo"].value;
}

/* ---------- 3. Persistência ---------- */

function salvarDados() {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(movimentacoes));
  } catch (erro) {
    mostrarErro("Não foi possível salvar os dados neste navegador.");
  }
}

function carregarDados() {
  try {
    const texto = localStorage.getItem(CHAVE_STORAGE);
    const dados = texto ? JSON.parse(texto) : [];
    // Mantém apenas itens com formato válido (protege contra dados corrompidos)
    movimentacoes = Array.isArray(dados) ? dados.filter(registroValido) : [];
  } catch (erro) {
    movimentacoes = [];
  }
}

function registroValido(item) {
  return item
    && typeof item.id === "string"
    && (item.tipo === "ganho" || item.tipo === "despesa")
    && typeof item.descricao === "string"
    && typeof item.categoria === "string"
    && typeof item.valor === "number" && isFinite(item.valor)
    && typeof item.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.data);
}

/* ---------- 4. Cálculos ---------- */

// Soma ganhos, despesas e lucro das movimentações entre duas datas (inclusive).
// Sem datas, soma tudo. Comparar textos AAAA-MM-DD funciona em ordem cronológica.
function calcularTotais(inicio, fim) {
  let ganhos = 0;
  let despesas = 0;

  movimentacoes.forEach(function (m) {
    if (inicio && m.data < inicio) return;
    if (fim && m.data > fim) return;
    if (m.tipo === "ganho") ganhos += m.valor;
    else despesas += m.valor;
  });

  // Arredonda para evitar erros de ponto flutuante (ex.: 0.1 + 0.2)
  ganhos = Math.round(ganhos * 100) / 100;
  despesas = Math.round(despesas * 100) / 100;
  const lucro = Math.round((ganhos - despesas) * 100) / 100;
  return { ganhos, despesas, lucro };
}

// Descobre início e fim de hoje, da semana (segunda a domingo) e do mês
function obterPeriodos() {
  const hoje = new Date();

  const semanaInicio = new Date(hoje);
  const diasDesdeSegunda = (hoje.getDay() + 6) % 7; // segunda = 0
  semanaInicio.setDate(hoje.getDate() - diasDesdeSegunda);
  const semanaFim = new Date(semanaInicio);
  semanaFim.setDate(semanaInicio.getDate() + 6);

  const mesInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const mesFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  return [
    { nome: "Hoje", inicio: dataParaTexto(hoje), fim: dataParaTexto(hoje) },
    { nome: "Esta semana", inicio: dataParaTexto(semanaInicio), fim: dataParaTexto(semanaFim) },
    { nome: "Este mês", inicio: dataParaTexto(mesInicio), fim: dataParaTexto(mesFim) }
  ];
}

/* ---------- 5. Validação ---------- */

// Retorna uma mensagem de erro, ou "" se estiver tudo certo
function validarFormulario() {
  const descricao = campoDescricao.value.trim();
  const valor = parseFloat(campoValor.value);

  if (descricao === "") return "Informe uma descrição.";
  if (!CATEGORIAS[tipoSelecionado()].includes(campoCategoria.value)) return "Escolha uma categoria.";
  if (!isFinite(valor) || valor <= 0) return "Informe um valor maior que zero.";
  if (campoData.value === "" || isNaN(new Date(campoData.value + "T00:00:00"))) return "Informe uma data válida.";
  return "";
}

function mostrarErro(texto) {
  mensagemErro.textContent = texto;
}

/* ---------- 6. Renderização ---------- */

// Preenche o select de categorias conforme o tipo escolhido
function atualizarCategorias() {
  campoCategoria.innerHTML = "";
  CATEGORIAS[tipoSelecionado()].forEach(function (nome) {
    const opcao = document.createElement("option");
    opcao.value = nome;
    opcao.textContent = nome;
    campoCategoria.appendChild(opcao);
  });
}

// Atualiza os 3 cards do topo
function renderizarDashboard() {
  const total = calcularTotais();
  document.getElementById("totalGanhos").textContent = formatarMoeda(total.ganhos);
  document.getElementById("totalDespesas").textContent = formatarMoeda(total.despesas);
  document.getElementById("totalLucro").textContent = formatarMoeda(total.lucro);
  document.querySelector(".card-lucro").classList.toggle("negativo", total.lucro < 0);
}

// Cria uma linha do relatório (ex.: "Ganhos ........ R$ 100,00")
function criarLinhaRelatorio(classe, rotulo, valor) {
  const p = document.createElement("p");
  p.className = classe;
  const nome = document.createElement("span");
  nome.textContent = rotulo;
  const numero = document.createElement("span");
  numero.textContent = formatarMoeda(valor);
  p.append(nome, numero);
  return p;
}

// Desenha o resumo de hoje, semana e mês
function renderizarRelatorio() {
  areaRelatorio.innerHTML = "";
  obterPeriodos().forEach(function (periodo) {
    const totais = calcularTotais(periodo.inicio, periodo.fim);
    const bloco = document.createElement("div");
    bloco.className = "periodo";
    const titulo = document.createElement("h3");
    titulo.textContent = periodo.nome;
    bloco.append(
      titulo,
      criarLinhaRelatorio("g", "Ganhos", totais.ganhos),
      criarLinhaRelatorio("d", "Despesas", totais.despesas),
      criarLinhaRelatorio("l", "Lucro", totais.lucro)
    );
    areaRelatorio.appendChild(bloco);
  });
}

// Desenha a lista de movimentações (mais recentes primeiro)
function renderizarHistorico() {
  listaHistorico.innerHTML = "";

  if (movimentacoes.length === 0) {
    const vazio = document.createElement("li");
    vazio.className = "vazio";
    vazio.textContent = "Nenhuma movimentação ainda. Registre a primeira!";
    listaHistorico.appendChild(vazio);
    return;
  }

  const ordenadas = movimentacoes.slice().sort(function (a, b) {
    return b.data.localeCompare(a.data) || b.id.localeCompare(a.id);
  });

  ordenadas.forEach(function (m) {
    const item = document.createElement("li");
    item.className = "item " + m.tipo;

    const info = document.createElement("div");
    info.className = "info";
    const titulo = document.createElement("strong");
    titulo.textContent = m.descricao;
    const detalhe = document.createElement("small");
    detalhe.textContent = m.categoria + " • " + formatarData(m.data);
    info.append(titulo, detalhe);

    const valor = document.createElement("span");
    valor.className = "valor";
    valor.textContent = (m.tipo === "ganho" ? "+ " : "- ") + formatarMoeda(m.valor);

    const botao = document.createElement("button");
    botao.className = "btn-excluir";
    botao.type = "button";
    botao.textContent = "Excluir";
    botao.setAttribute("aria-label", "Excluir " + m.descricao);
    botao.dataset.id = m.id;

    item.append(info, valor, botao);
    listaHistorico.appendChild(item);
  });
}

// Atualiza tudo de uma vez após qualquer mudança
function atualizarTela() {
  renderizarDashboard();
  renderizarRelatorio();
  renderizarHistorico();
  renderizarMeta();
  atualizarExtras();
}

/* ---------- 6.0 Meta semanal ---------- */

const CHAVE_META = "motograna:metaSemanal";
let metaSemanal = 0; // 0 = sem meta definida

function carregarMeta() {
  try {
    const valor = parseFloat(localStorage.getItem(CHAVE_META));
    metaSemanal = isFinite(valor) && valor > 0 ? valor : 0;
  } catch (erro) {
    metaSemanal = 0;
  }
}

function aoSalvarMeta() {
  const campo = document.getElementById("campoMeta");
  const aviso = document.getElementById("mensagemMeta");
  const texto = campo.value.trim();
  const valor = texto === "" ? 0 : parseFloat(texto);

  if (!isFinite(valor) || valor < 0) {
    aviso.textContent = "Informe um valor válido para a meta.";
    aviso.classList.add("erro-msg");
    return;
  }

  metaSemanal = Math.round(valor * 100) / 100;
  try {
    if (metaSemanal > 0) localStorage.setItem(CHAVE_META, String(metaSemanal));
    else localStorage.removeItem(CHAVE_META);
  } catch (erro) {
    aviso.textContent = "Não foi possível salvar a meta neste navegador.";
    aviso.classList.add("erro-msg");
    return;
  }

  aviso.classList.remove("erro-msg");
  aviso.textContent = metaSemanal > 0 ? "Meta salva!" : "Meta removida.";
  renderizarMeta();
}

// Mostra o progresso do lucro da semana em relação à meta
function renderizarMeta() {
  const area = document.getElementById("progressoMeta");
  if (metaSemanal <= 0) {
    area.hidden = true;
    return;
  }
  area.hidden = false;

  const semana = obterPeriodos()[1];
  const lucro = calcularTotais(semana.inicio, semana.fim).lucro;
  const falta = Math.round((metaSemanal - lucro) * 100) / 100;
  const percentual = Math.max(0, Math.min(100, (lucro / metaSemanal) * 100));

  document.getElementById("barraMeta").style.width = percentual + "%";

  const textoProgresso = document.getElementById("textoProgresso");
  const textoDiario = document.getElementById("textoDiario");

  if (falta <= 0) {
    textoProgresso.textContent = "Meta batida! 🎉 Lucro da semana: " + formatarMoeda(lucro) +
      " de " + formatarMoeda(metaSemanal) + ".";
    textoDiario.textContent = "Parabéns pelo esforço! Tudo que vier agora é a mais.";
  } else {
    textoProgresso.textContent = Math.floor(percentual) + "% da meta • faltam " + formatarMoeda(falta) +
      " (lucro de " + formatarMoeda(lucro) + " em " + formatarMoeda(metaSemanal) + ").";
    // Dias que ainda restam na semana, contando hoje (semana vai de segunda a domingo)
    const diasRestantes = 7 - ((new Date().getDay() + 6) % 7);
    const porDia = falta / diasRestantes;
    textoDiario.textContent = "Para chegar lá: cerca de " + formatarMoeda(porDia) +
      " de lucro por dia nos próximos " + diasRestantes + (diasRestantes === 1 ? " dia." : " dias.");
  }
}

/* ---------- 6.05 Palavra de incentivo ---------- */

// Textos baseados na tradução Almeida (domínio público)
const VERSICULOS = [
  { texto: "Posso todas as coisas em Cristo que me fortalece.", ref: "Filipenses 4:13" },
  { texto: "O Senhor guardará a tua saída e a tua entrada, desde agora e para sempre.", ref: "Salmos 121:8" },
  { texto: "Entrega ao Senhor as tuas obras, e teus pensamentos serão estabelecidos.", ref: "Provérbios 16:3" },
  { texto: "Esforça-te, e tem bom ânimo; o Senhor teu Deus é contigo, por onde quer que andares.", ref: "Josué 1:9" },
  { texto: "Tudo quanto fizerdes, fazei-o de coração, como ao Senhor, e não aos homens.", ref: "Colossenses 3:23" },
  { texto: "A mão dos diligentes enriquece.", ref: "Provérbios 10:4" },
  { texto: "Não nos cansemos de fazer o bem, porque a seu tempo ceifaremos, se não desfalecermos.", ref: "Gálatas 6:9" },
  { texto: "Não temas, porque eu sou contigo; eu te fortaleço, e te ajudo.", ref: "Isaías 41:10" },
  { texto: "Aos seus anjos dará ordem a teu respeito, para te guardarem em todos os teus caminhos.", ref: "Salmos 91:11" },
  { texto: "Entrega o teu caminho ao Senhor; confia nele, e ele o fará.", ref: "Salmos 37:5" }
];

let indiceVersiculo = 0;

// Escolhe um versículo diferente a cada dia (mesmo ao recarregar a página)
function indiceDoDia() {
  const agora = new Date();
  const diasDesde1970 = Math.floor((agora.getTime() - agora.getTimezoneOffset() * 60000) / 86400000);
  return diasDesde1970 % VERSICULOS.length;
}

function renderizarVersiculo() {
  const v = VERSICULOS[indiceVersiculo];
  document.getElementById("textoVersiculo").textContent = "“" + v.texto + "”";
  document.getElementById("refVersiculo").textContent = v.ref;
}

function proximoVersiculo() {
  indiceVersiculo = (indiceVersiculo + 1) % VERSICULOS.length;
  renderizarVersiculo();
}

/* ---------- 6.1 Backup (exportar / importar) ---------- */

function mostrarAvisoBackup(texto, ehErro) {
  const aviso = document.getElementById("mensagemBackup");
  aviso.textContent = texto;
  aviso.classList.toggle("erro-msg", Boolean(ehErro));
}

// Baixa um arquivo .json com todas as movimentações
function exportarBackup() {
  if (movimentacoes.length === 0 && !temDadosExtras()) {
    mostrarAvisoBackup("Não há movimentações para exportar.", true);
    return;
  }
  const pacote = { versao: 2, movimentacoes, metaSemanal, combustivel: extras.combustivel, manutencoes: extras.manutencoes, turnos: extras.turnos, objetivos: extras.objetivos };
  const conteudo = JSON.stringify(pacote, null, 2);
  const arquivo = new Blob([conteudo], { type: "application/json" });
  const url = URL.createObjectURL(arquivo);

  const link = document.createElement("a");
  link.href = url;
  link.download = "motograna-backup-" + dataParaTexto(new Date()) + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  mostrarAvisoBackup("Backup exportado com " + movimentacoes.length + " movimentações.", false);
}

// Lê um arquivo de backup e adiciona os registros que ainda não existem
function importarBackup(arquivo) {
  if (!arquivo) return;

  const leitor = new FileReader();
  leitor.onerror = function () {
    mostrarAvisoBackup("Não foi possível ler o arquivo.", true);
  };
  leitor.onload = function () {
    let dados;
    try {
      dados = JSON.parse(leitor.result);
    } catch (erro) {
      mostrarAvisoBackup("Arquivo inválido: não é um backup do MotoGrana.", true);
      return;
    }
    // Aceita o formato antigo (lista de movimentações) e o novo (objeto com tudo)
    const pacote = Array.isArray(dados) ? { movimentacoes: dados } : dados;
    if (!pacote || !Array.isArray(pacote.movimentacoes)) {
      mostrarAvisoBackup("Arquivo inválido: formato não reconhecido.", true);
      return;
    }
    dados = pacote.movimentacoes;
    importarExtras(pacote);

    const idsExistentes = new Set(movimentacoes.map(function (m) { return m.id; }));
    let adicionados = 0;
    let ignorados = 0;

    dados.forEach(function (item) {
      if (registroValido(item) && !idsExistentes.has(item.id)) {
        movimentacoes.push({
          id: item.id,
          descricao: item.descricao.trim().slice(0, 60),
          tipo: item.tipo,
          categoria: item.categoria,
          valor: item.valor,
          data: item.data
        });
        idsExistentes.add(item.id);
        adicionados++;
      } else {
        ignorados++;
      }
    });

    salvarDados();
    atualizarTela();
    mostrarAvisoBackup(
      adicionados + " movimentações importadas" +
      (ignorados > 0 ? " (" + ignorados + " ignoradas: repetidas ou inválidas)." : "."),
      false
    );
  };
  leitor.readAsText(arquivo);
}

/* ---------- 6.2 Novas funções ----------
   Combustível, manutenção, gráficos, jornada, cofrinho e recordes.
   Os dados novos ficam em chaves próprias do LocalStorage; as movimentações
   (chave "motograna:movimentacoes") continuam exatamente como antes. */

const CHAVES_EXTRAS = {
  combustivel: "motograna:combustivel",
  manutencoes: "motograna:manutencoes",
  turnos: "motograna:turnos",
  objetivos: "motograna:objetivos"
};
// Campos numéricos obrigatórios de cada tipo (valida dados salvos e importados)
const CAMPOS_NUM = {
  combustivel: ["kmInicial", "kmFinal", "consumo", "preco", "custo"],
  manutencoes: ["valor", "km"],
  turnos: ["minutos", "ganhos", "entregas"],
  objetivos: ["meta", "guardado"]
};
const TIPOS_MANUTENCAO = ["Troca de óleo", "Pneus", "Kit relação", "Freios", "Corrente", "Outra"];
const extras = { combustivel: [], manutencoes: [], turnos: [], objetivos: [] };

const COR_VERDE = "#22c55e", COR_VERMELHO = "#ef4444", COR_TEXTO = "#8fa196", COR_GRADE = "#26322c";
let tipoGrafico = "barras";
let layoutGrafico = null; // posições do gráfico, usadas pelo balão de valores

/* --- Utilitários --- */
const $ = (id) => document.getElementById(id);
const arred = (n) => Math.round(n * 100) / 100;
const formatarNumero = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const num = (id) => parseFloat($(id).value);

// Cria um elemento com classe e texto (textContent evita injeção de HTML)
function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function aviso(id, texto, erro) {
  const a = $(id);
  a.textContent = texto;
  a.classList.toggle("erro-msg", Boolean(erro));
}

const ganhosDoDia = (data) => (data ? calcularTotais(data, data).ganhos : 0);

// Registra uma despesa na lista principal (usada pelas opções "lançar também como despesa")
function lancarDespesa(descricao, categoria, valor, data) {
  movimentacoes.push({ id: gerarId(), descricao: descricao.slice(0, 60), tipo: "despesa", categoria, valor: arred(valor), data });
  salvarDados();
}

// Linha "rótulo ........ valor" dentro de um bloco .periodo
function linhaInfo(rotulo, texto, classe) {
  const p = el("p", classe);
  p.append(el("span", "", rotulo), el("span", "", texto));
  return p;
}

// Item de lista no mesmo estilo do histórico principal
function criarItem(classe, titulo, detalhe, direita, aoExcluir) {
  const li = el("li", "item " + classe);
  const info = el("div", "info");
  info.append(el("strong", "", titulo), el("small", "", detalhe));
  li.append(info, el("span", "valor", direita));
  if (aoExcluir) {
    const b = el("button", "btn-excluir", "Excluir");
    b.type = "button";
    b.addEventListener("click", () => { if (confirm("Excluir este registro?")) aoExcluir(); });
    li.appendChild(b);
  }
  return li;
}

const listaVazia = (ul, texto) => ul.append(el("li", "vazio", texto));
const maisRecentes = (lista) => [...lista].sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id));

/* --- Persistência dos dados novos --- */
function itemExtraValido(nome, i) {
  return Boolean(i) && typeof i.id === "string"
    && (nome === "objetivos" || /^\d{4}-\d{2}-\d{2}$/.test(i.data))
    && CAMPOS_NUM[nome].every((c) => typeof i[c] === "number" && isFinite(i[c]));
}

function carregarExtras() {
  Object.keys(CHAVES_EXTRAS).forEach((nome) => {
    try {
      const dados = JSON.parse(localStorage.getItem(CHAVES_EXTRAS[nome]));
      extras[nome] = Array.isArray(dados) ? dados.filter((i) => itemExtraValido(nome, i)) : [];
    } catch (erro) {
      extras[nome] = [];
    }
  });
}

function salvarExtras(nome) {
  try { localStorage.setItem(CHAVES_EXTRAS[nome], JSON.stringify(extras[nome])); }
  catch (erro) { /* sem espaço ou bloqueado: o app continua funcionando em memória */ }
}

function removerExtra(nome, id) {
  extras[nome] = extras[nome].filter((i) => i.id !== id);
  salvarExtras(nome);
  atualizarExtras();
}

/* --- 1. Combustível --- */
function calcularCombustivel() {
  const kmInicial = num("kmInicial"), kmFinal = num("kmFinal"), consumo = num("consumo"), preco = num("precoLitro");
  if (![kmInicial, kmFinal, consumo, preco].every(isFinite)) return null;
  if (kmInicial < 0 || kmFinal <= kmInicial || consumo <= 0 || preco <= 0) return null;
  const distancia = kmFinal - kmInicial;
  const litros = distancia / consumo;
  return { kmInicial, kmFinal, consumo, preco, distancia: arred(distancia), litros: arred(litros), custo: arred(litros * preco) };
}

function renderizarResultadoCombustivel() {
  const area = $("resultadoCombustivel");
  area.innerHTML = "";
  const r = calcularCombustivel();
  if (!r) {
    area.append(el("p", "dica", "Preencha km inicial, km final (maior que o inicial), consumo e preço para ver o cálculo."));
    return;
  }
  const ganhos = ganhosDoDia($("dataCombustivel").value);
  const lucro = arred(ganhos - r.custo);
  area.append(
    linhaInfo("Distância percorrida", formatarNumero(r.distancia) + " km"),
    linhaInfo("Litros consumidos", formatarNumero(r.litros) + " L"),
    linhaInfo("Custo do combustível", formatarMoeda(r.custo), "d"),
    linhaInfo("Ganhos do dia (registrados)", formatarMoeda(ganhos), "g"),
    linhaInfo("Lucro após combustível", formatarMoeda(lucro), lucro < 0 ? "l d" : "l g")
  );
}

function aoSalvarCombustivel(ev) {
  ev.preventDefault();
  const r = calcularCombustivel(), data = $("dataCombustivel").value;
  if (!r || !data) {
    aviso("mensagemCombustivel", "Confira os campos: o km final deve ser maior que o inicial e os demais valores devem ser positivos.", true);
    return;
  }
  extras.combustivel.push({ id: gerarId(), data, ...r });
  salvarExtras("combustivel");
  if ($("lancarCombustivel").checked) {
    lancarDespesa("Combustível • " + formatarNumero(r.distancia) + " km", "Combustível", r.custo, data);
  }
  $("kmInicial").value = r.kmFinal; // o próximo trajeto começa onde este terminou
  $("kmFinal").value = "";
  aviso("mensagemCombustivel", "Cálculo salvo!", false);
  atualizarTela();
}

function renderizarListaCombustivel() {
  const ul = $("listaCombustivel");
  ul.innerHTML = "";
  if (!extras.combustivel.length) return listaVazia(ul, "Nenhum cálculo salvo ainda.");
  maisRecentes(extras.combustivel).forEach((c) => ul.append(criarItem(
    "despesa",
    formatarData(c.data) + " • " + formatarNumero(c.distancia) + " km",
    formatarNumero(c.litros) + " L a " + formatarMoeda(c.preco) + "/L • " + formatarNumero(c.consumo) + " km/L",
    formatarMoeda(c.custo),
    () => removerExtra("combustivel", c.id)
  )));
}

/* --- 2. Manutenção --- */
// Maior quilometragem já registrada (abastecimentos e manutenções)
const kmAtual = () => Math.max(0, ...extras.combustivel.map((c) => c.kmFinal), ...extras.manutencoes.map((m) => m.km));

function aoSalvarManutencao(ev) {
  ev.preventDefault();
  const tipo = $("tipoManut").value, desc = $("descManut").value.trim();
  const valor = num("valorManut"), km = num("kmManut"), data = $("dataManut").value;
  const intervaloKm = num("lembreteKm"), proxData = $("lembreteData").value;

  if (tipo === "Outra" && desc === "") return aviso("mensagemManut", "Descreva a manutenção.", true);
  if (!isFinite(valor) || valor < 0) return aviso("mensagemManut", "Informe o valor (pode ser 0).", true);
  if (!isFinite(km) || km < 0) return aviso("mensagemManut", "Informe a quilometragem da moto.", true);
  if (!data) return aviso("mensagemManut", "Informe a data.", true);

  const item = { id: gerarId(), tipo, descricao: desc || tipo, valor: arred(valor), km, data };
  if (isFinite(intervaloKm) && intervaloKm > 0) item.proxKm = km + intervaloKm;
  if (proxData) item.proxData = proxData;

  extras.manutencoes.push(item);
  salvarExtras("manutencoes");
  if ($("lancarManut").checked && item.valor > 0) lancarDespesa(item.descricao, "Manutenção", item.valor, data);

  ["descManut", "valorManut", "lembreteKm", "lembreteData"].forEach((id) => { $(id).value = ""; });
  aviso("mensagemManut", "Manutenção registrada!", false);
  atualizarTela();
}

// Considera só a manutenção mais recente de cada tipo e verifica se o lembrete venceu
function calcularLembretes() {
  const ultimos = {};
  extras.manutencoes.forEach((m) => {
    const chave = m.tipo === "Outra" ? m.descricao : m.tipo;
    const a = ultimos[chave];
    if (!a || m.data > a.data || (m.data === a.data && m.km >= a.km)) ultimos[chave] = m;
  });
  const hoje = dataParaTexto(new Date()), km = kmAtual();
  const limite = new Date();
  limite.setDate(limite.getDate() + 7);
  const em7dias = dataParaTexto(limite);
  const ordem = { vencido: 0, breve: 1, ok: 2 };

  return Object.values(ultimos)
    .filter((m) => m.proxKm !== undefined || m.proxData)
    .map((m) => {
      let estado = "ok";
      const motivos = [];
      if (m.proxData) {
        if (m.proxData < hoje) { estado = "vencido"; motivos.push("venceu em " + formatarData(m.proxData)); }
        else { motivos.push("até " + formatarData(m.proxData)); if (m.proxData <= em7dias) estado = "breve"; }
      }
      if (m.proxKm !== undefined) {
        const falta = m.proxKm - km;
        if (falta <= 0) { estado = "vencido"; motivos.push("passou de " + formatarNumero(m.proxKm) + " km"); }
        else { motivos.push("faltam " + formatarNumero(falta) + " km"); if (falta <= 300 && estado === "ok") estado = "breve"; }
      }
      return { m, estado, texto: motivos.join(" • ") };
    })
    .sort((a, b) => ordem[a.estado] - ordem[b.estado]);
}

function renderizarManutencao() {
  $("kmAtual").textContent = kmAtual() > 0
    ? "Km atual estimado: " + formatarNumero(kmAtual()) + " km (maior quilometragem registrada)."
    : "Registre abastecimentos ou manutenções com quilometragem para acompanhar o km da moto.";

  const lembretes = calcularLembretes(), ul = $("listaLembretes");
  ul.innerHTML = "";
  if (!lembretes.length) listaVazia(ul, "Nenhum lembrete programado.");
  const rotulos = { vencido: "Vencido", breve: "Em breve", ok: "Em dia" };
  lembretes.forEach((l) => ul.append(criarItem(l.estado, l.m.descricao, l.texto, rotulos[l.estado])));

  const urgentes = lembretes.filter((l) => l.estado !== "ok").length;
  const alerta = $("alertaManutencao");
  alerta.hidden = urgentes === 0;
  alerta.textContent = "🔧 " + urgentes + (urgentes === 1 ? " manutenção vencida ou perto de vencer" : " manutenções vencidas ou perto de vencer") + ". Veja a seção Manutenção.";

  const hist = $("listaManutencao");
  hist.innerHTML = "";
  if (!extras.manutencoes.length) return listaVazia(hist, "Nenhuma manutenção registrada ainda.");
  maisRecentes(extras.manutencoes).forEach((m) => hist.append(criarItem(
    "neutro", m.descricao, formatarData(m.data) + " • " + formatarNumero(m.km) + " km", formatarMoeda(m.valor),
    () => removerExtra("manutencoes", m.id)
  )));
}

/* --- 3. Gráficos (canvas, sem bibliotecas) --- */
function intervaloFiltro() {
  const periodo = $("filtroPeriodo").value, p = obterPeriodos();
  if (periodo === "semana") return p[1];
  if (periodo === "mes") return p[2];
  return { inicio: "", fim: "" };
}
const foraDoIntervalo = (data, i) => (i.inicio && data < i.inicio) || (i.fim && data > i.fim);

// Início da semana (segunda), mês ou o próprio dia
function chaveGrupo(data, agrup) {
  if (agrup === "mes") return data.slice(0, 7);
  if (agrup === "semana") {
    const [a, m, d] = data.split("-").map(Number);
    const dt = new Date(a, m - 1, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return dataParaTexto(dt);
  }
  return data;
}

function rotuloGrupo(chave, agrup) {
  const [a, m, d] = chave.split("-");
  if (agrup === "mes") return m + "/" + a;
  return (agrup === "semana" ? "sem " : "") + d + "/" + m;
}

// Soma ganhos e despesas por grupo, respeitando o filtro de período
function agruparMovimentacoes(agrup, intervalo) {
  const grupos = {};
  movimentacoes.forEach((m) => {
    if (intervalo && foraDoIntervalo(m.data, intervalo)) return;
    const k = chaveGrupo(m.data, agrup);
    grupos[k] = grupos[k] || { g: 0, d: 0 };
    if (m.tipo === "ganho") grupos[k].g += m.valor; else grupos[k].d += m.valor;
  });
  return grupos;
}

function dadosGrafico() {
  const agrup = $("filtroAgrupar").value;
  const grupos = agruparMovimentacoes(agrup, intervaloFiltro());
  let acumulado = 0;
  return Object.keys(grupos).sort().map((k) => {
    const lucro = arred(grupos[k].g - grupos[k].d);
    acumulado = arred(acumulado + lucro);
    return { rotulo: rotuloGrupo(k, agrup), g: arred(grupos[k].g), d: arred(grupos[k].d), l: lucro, a: acumulado };
  });
}

function desenharGrafico() {
  const canvas = $("canvasGrafico"), categorias = tipoGrafico === "categorias";
  canvas.hidden = categorias;
  $("graficoCategorias").hidden = !categorias;
  $("legendaGrafico").hidden = categorias;
  $("tooltipGrafico").hidden = true;
  if (categorias) return renderizarCategorias();

  const pts = dadosGrafico();
  const larg = canvas.clientWidth || 300, alt = 260, dpr = window.devicePixelRatio || 1;
  canvas.width = larg * dpr;
  canvas.height = alt * dpr;
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.font = "12px system-ui, sans-serif";
  c.textBaseline = "middle";

  const esq = 56, dir = 8, topo = 10, base = 30;
  layoutGrafico = { pts, esq, larg, slot: 1 };
  if (!pts.length) {
    c.fillStyle = COR_TEXTO; c.textAlign = "center";
    c.fillText("Sem movimentações neste período.", larg / 2, alt / 2);
    return;
  }

  const series = tipoGrafico === "barras" ? [(p) => p.g, (p) => p.d] : tipoGrafico === "lucro" ? [(p) => p.l] : [(p) => p.a];
  const valores = pts.flatMap((p) => series.map((f) => f(p)));
  let max = Math.max(0, ...valores);
  const min = Math.min(0, ...valores);
  if (max === min) max = 1;
  const w = larg - esq - dir, h = alt - topo - base, slot = w / pts.length;
  layoutGrafico.slot = slot;
  const y = (v) => topo + ((max - v) / (max - min)) * h;

  // Linhas de grade e valores do eixo vertical
  c.textAlign = "right"; c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    c.strokeStyle = COR_GRADE; c.fillStyle = COR_TEXTO;
    c.beginPath(); c.moveTo(esq, y(v)); c.lineTo(larg - dir, y(v)); c.stroke();
    c.fillText(formatarNumero(Math.round(v)), esq - 6, y(v));
  }
  c.strokeStyle = "#4b5d52";
  c.beginPath(); c.moveTo(esq, y(0)); c.lineTo(larg - dir, y(0)); c.stroke();

  // Rótulos do eixo horizontal (pula alguns quando há muitos)
  c.textAlign = "center"; c.fillStyle = COR_TEXTO;
  const passo = Math.ceil(pts.length / Math.max(1, Math.floor(w / 52)));
  pts.forEach((p, i) => { if (i % passo === 0) c.fillText(p.rotulo, esq + (i + 0.5) * slot, alt - base / 2); });

  if (tipoGrafico === "evolucao") {
    c.strokeStyle = COR_VERDE; c.lineWidth = 2.5; c.beginPath();
    pts.forEach((p, i) => { const px = esq + (i + 0.5) * slot; if (i) c.lineTo(px, y(p.a)); else c.moveTo(px, y(p.a)); });
    c.stroke();
    c.fillStyle = COR_VERDE;
    pts.forEach((p, i) => { c.beginPath(); c.arc(esq + (i + 0.5) * slot, y(p.a), 3.5, 0, Math.PI * 2); c.fill(); });
  } else {
    const largBarra = (slot * 0.7) / series.length;
    pts.forEach((p, i) => series.forEach((f, j) => {
      const v = f(p);
      c.fillStyle = tipoGrafico === "barras" ? (j === 0 ? COR_VERDE : COR_VERMELHO) : (v >= 0 ? COR_VERDE : COR_VERMELHO);
      c.fillRect(esq + i * slot + slot * 0.15 + j * largBarra, Math.min(y(v), y(0)), largBarra, Math.abs(y(v) - y(0)) || 1);
    }));
  }
}

// Balão com os valores do grupo tocado ou sob o mouse
function mostrarTooltip(ev) {
  const t = $("tooltipGrafico"), L = layoutGrafico;
  if (!L || !L.pts.length || tipoGrafico === "categorias") return;
  const x = ev.clientX - $("canvasGrafico").getBoundingClientRect().left;
  const i = Math.floor((x - L.esq) / L.slot);
  if (i < 0 || i >= L.pts.length) { t.hidden = true; return; }
  const p = L.pts[i];
  const linhas = [el("strong", "", p.rotulo), el("span", "", "Ganhos: " + formatarMoeda(p.g)), el("span", "", "Despesas: " + formatarMoeda(p.d)), el("span", "", "Lucro: " + formatarMoeda(p.l))];
  if (tipoGrafico === "evolucao") linhas.push(el("span", "", "Acumulado: " + formatarMoeda(p.a)));
  t.replaceChildren(...linhas);
  t.hidden = false;
  t.style.left = Math.min(Math.max(L.esq + (i + 0.5) * L.slot, 80), L.larg - 80) + "px";
}

// Despesas por categoria, da maior para a menor (respeita o filtro de período)
function renderizarCategorias() {
  const box = $("graficoCategorias"), intervalo = intervaloFiltro(), totais = {};
  let soma = 0;
  box.innerHTML = "";
  movimentacoes.forEach((m) => {
    if (m.tipo !== "despesa" || foraDoIntervalo(m.data, intervalo)) return;
    totais[m.categoria] = (totais[m.categoria] || 0) + m.valor;
    soma += m.valor;
  });
  const ordem = Object.keys(totais).sort((a, b) => totais[b] - totais[a]);
  if (!ordem.length) { box.append(el("p", "dica", "Sem despesas neste período.")); return; }
  ordem.forEach((cat) => {
    const pct = (totais[cat] / soma) * 100;
    const topo = el("div", "cat-topo");
    topo.append(el("span", "", cat), el("span", "", formatarMoeda(arred(totais[cat])) + " • " + Math.round(pct) + "%"));
    const barra = el("div", "barra"), cheio = el("div", "barra-preenchimento");
    cheio.style.width = pct + "%";
    cheio.style.background = "var(--vermelho)";
    barra.append(cheio);
    const linha = el("div", "cat-linha");
    linha.append(topo, barra);
    box.append(linha);
  });
}

/* --- 4. Jornada de trabalho --- */
const paraMinutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const horasTexto = (min) => Math.floor(min / 60) + "h" + String(min % 60).padStart(2, "0");

function aoSalvarTurno(ev) {
  ev.preventDefault();
  const data = $("dataTurno").value, ini = $("inicioTurno").value, fim = $("fimTurno").value;
  const ganhos = num("ganhosTurno"), entregas = num("entregasTurno");

  if (!data || !ini || !fim) return aviso("mensagemTurno", "Informe data, início e término.", true);
  let minutos = paraMinutos(fim) - paraMinutos(ini);
  if (minutos === 0) return aviso("mensagemTurno", "Início e término não podem ser iguais.", true);
  if (minutos < 0) minutos += 1440; // turno que passa da meia-noite
  if (!isFinite(ganhos) || ganhos < 0) return aviso("mensagemTurno", "Informe os ganhos do turno.", true);
  if (!Number.isInteger(entregas) || entregas < 0) return aviso("mensagemTurno", "Informe a quantidade de entregas (número inteiro).", true);

  extras.turnos.push({ id: gerarId(), data, inicio: ini, fim, minutos, ganhos: arred(ganhos), entregas });
  salvarExtras("turnos");
  $("ganhosTurno").value = "";
  $("entregasTurno").value = "";
  aviso("mensagemTurno", "Turno registrado!", false);
  atualizarTela();
}

function renderizarTurnos() {
  const resumo = $("resumoTurnos"), ul = $("listaTurnos");
  resumo.innerHTML = "";
  ul.innerHTML = "";
  if (!extras.turnos.length) {
    resumo.append(el("p", "dica", "Registre um turno para ver suas médias."));
    return listaVazia(ul, "Nenhum turno registrado ainda.");
  }
  const t = extras.turnos.reduce((s, x) => ({ min: s.min + x.minutos, g: s.g + x.ganhos, e: s.e + x.entregas }), { min: 0, g: 0, e: 0 });
  resumo.append(
    linhaInfo("Horas trabalhadas (total)", horasTexto(t.min)),
    linhaInfo("Ganhos nos turnos", formatarMoeda(arred(t.g)), "g"),
    linhaInfo("Média por hora", formatarMoeda(arred(t.g / (t.min / 60))), "g"),
    linhaInfo("Média por entrega", t.e > 0 ? formatarMoeda(arred(t.g / t.e)) : "—", "l g")
  );
  maisRecentes(extras.turnos).forEach((x) => ul.append(criarItem(
    "ganho",
    formatarData(x.data) + " • " + x.inicio + " às " + x.fim + " (" + horasTexto(x.minutos) + ")",
    formatarMoeda(arred(x.ganhos / (x.minutos / 60))) + "/h • " + x.entregas + " entregas" + (x.entregas > 0 ? " • " + formatarMoeda(arred(x.ganhos / x.entregas)) + "/entrega" : ""),
    formatarMoeda(x.ganhos),
    () => removerExtra("turnos", x.id)
  )));
}

/* --- 5. Cofrinho de objetivos --- */
function aoCriarObjetivo(ev) {
  ev.preventDefault();
  const nome = $("nomeObjetivo").value.trim(), meta = num("metaObjetivo");
  if (nome === "") return aviso("mensagemCofrinho", "Dê um nome ao objetivo.", true);
  if (!isFinite(meta) || meta <= 0) return aviso("mensagemCofrinho", "Informe um valor desejado maior que zero.", true);
  extras.objetivos.push({ id: gerarId(), nome: nome.slice(0, 40), meta: arred(meta), guardado: 0 });
  salvarExtras("objetivos");
  $("nomeObjetivo").value = "";
  $("metaObjetivo").value = "";
  aviso("mensagemCofrinho", "Objetivo criado!", false);
  atualizarExtras();
}

// sinal = 1 (guardar) ou -1 (retirar)
function movimentarObjetivo(id, sinal, valor) {
  const o = extras.objetivos.find((x) => x.id === id);
  if (!o) return;
  if (!isFinite(valor) || valor <= 0) return aviso("mensagemCofrinho", "Informe um valor maior que zero.", true);
  if (sinal < 0 && valor > o.guardado) return aviso("mensagemCofrinho", "Você só pode retirar até " + formatarMoeda(o.guardado) + ".", true);
  o.guardado = arred(o.guardado + sinal * valor);
  salvarExtras("objetivos");
  aviso("mensagemCofrinho", "", false);
  atualizarExtras();
}

function renderizarObjetivos() {
  const box = $("listaObjetivos");
  box.innerHTML = "";
  if (!extras.objetivos.length) { box.append(el("p", "dica", "Nenhum objetivo ainda. Crie o primeiro acima!")); return; }
  extras.objetivos.forEach((o) => {
    const pct = Math.min(100, (o.guardado / o.meta) * 100), falta = Math.max(0, arred(o.meta - o.guardado));
    const barra = el("div", "barra"), cheio = el("div", "barra-preenchimento");
    cheio.style.width = pct + "%";
    barra.append(cheio);

    const campo = el("input");
    campo.type = "number"; campo.min = "0.01"; campo.step = "0.01"; campo.placeholder = "Valor (R$)"; campo.inputMode = "decimal";
    const guardar = el("button", "btn-secundario", "➕ Guardar");
    const retirar = el("button", "btn-secundario", "➖ Retirar");
    const excluir = el("button", "btn-excluir", "Excluir");
    [guardar, retirar, excluir].forEach((b) => { b.type = "button"; });
    guardar.onclick = () => movimentarObjetivo(o.id, 1, parseFloat(campo.value));
    retirar.onclick = () => movimentarObjetivo(o.id, -1, parseFloat(campo.value));
    excluir.onclick = () => { if (confirm("Excluir este objetivo?")) removerExtra("objetivos", o.id); };
    const acoes = el("div", "acoes-objetivo");
    acoes.append(campo, guardar, retirar, excluir);

    const card = el("div", "objetivo");
    card.append(
      el("h3", "", o.nome + (falta === 0 ? " 🎉" : "")),
      barra,
      el("p", "progresso-texto", Math.floor(pct) + "% • " + formatarMoeda(o.guardado) + " de " + formatarMoeda(o.meta)),
      el("p", "dica", falta === 0 ? "Objetivo alcançado!" : "Faltam " + formatarMoeda(falta)),
      acoes
    );
    box.append(card);
  });
}

/* --- 6. Recordes pessoais --- */
// Encontra o maior valor de um objeto de grupos: devolve { chave, valor } ou null
function melhorDe(obj, valorFn) {
  let melhor = null;
  Object.keys(obj).forEach((k) => {
    const v = valorFn(obj[k]);
    if (melhor === null || v > melhor.valor) melhor = { chave: k, valor: v };
  });
  return melhor;
}

function renderizarRecordes() {
  const dias = agruparMovimentacoes("dia"), semanas = agruparMovimentacoes("semana"), meses = agruparMovimentacoes("mes");
  const entregas = {}, porHora = {};
  extras.turnos.forEach((t) => {
    entregas[t.data] = (entregas[t.data] || 0) + t.entregas;
    if (t.minutos > 0) porHora[t.id] = { v: t.ganhos / (t.minutos / 60), data: t.data };
  });
  const moeda = (v) => formatarMoeda(arred(v));
  const lista = [
    ["🏆 Melhor dia de faturamento", melhorDe(dias, (x) => x.g), moeda, formatarData],
    ["📅 Melhor semana", melhorDe(semanas, (x) => x.g), moeda, (k) => "Semana de " + formatarData(k)],
    ["🗓️ Melhor mês", melhorDe(meses, (x) => x.g), moeda, (k) => k.slice(5) + "/" + k.slice(0, 4)],
    ["📦 Mais entregas em um dia", melhorDe(entregas, (x) => x), (v) => v + " entregas", formatarData],
    ["💰 Maior lucro líquido diário", melhorDe(dias, (x) => x.g - x.d), moeda, formatarData],
    ["⚡ Recorde de ganhos por hora", melhorDe(porHora, (x) => x.v), (v) => moeda(v) + "/h", (k) => formatarData(porHora[k].data)]
  ];
  const grade = $("gradeRecordes");
  grade.innerHTML = "";
  lista.forEach(([titulo, m, formatarValor, formatarChave]) => {
    const ok = m && m.valor > 0;
    const card = el("div", "stat");
    card.append(el("span", "", titulo), el("strong", "", ok ? formatarValor(m.valor) : "—"), el("small", "", ok ? formatarChave(m.chave) : "Sem dados ainda"));
    grade.append(card);
  });
}

/* --- Backup: inclui os dados novos (e continua aceitando backups antigos) --- */
const temDadosExtras = () => Object.keys(extras).some((n) => extras[n].length > 0) || metaSemanal > 0;

function importarExtras(pacote) {
  Object.keys(extras).forEach((nome) => {
    const lista = Array.isArray(pacote[nome]) ? pacote[nome] : [];
    const ids = new Set(extras[nome].map((i) => i.id));
    lista.forEach((i) => {
      if (itemExtraValido(nome, i) && !ids.has(i.id)) { extras[nome].push(i); ids.add(i.id); }
    });
    salvarExtras(nome);
  });
  const meta = parseFloat(pacote.metaSemanal);
  if (metaSemanal <= 0 && isFinite(meta) && meta > 0) {
    metaSemanal = meta;
    try { localStorage.setItem(CHAVE_META, String(meta)); } catch (erro) { /* ignora */ }
    $("campoMeta").value = meta;
  }
}

/* --- Atualização e eventos das novas funções --- */
function atualizarExtras() {
  renderizarResultadoCombustivel();
  renderizarListaCombustivel();
  renderizarManutencao();
  renderizarTurnos();
  renderizarObjetivos();
  renderizarRecordes();
  desenharGrafico();
}

function iniciarExtras() {
  carregarExtras();
  const hoje = dataParaTexto(new Date());
  ["dataCombustivel", "dataManut", "dataTurno"].forEach((id) => { $(id).value = hoje; });
  TIPOS_MANUTENCAO.forEach((t) => { const o = el("option", "", t); o.value = t; $("tipoManut").append(o); });

  // Reaproveita o último abastecimento para agilizar o próximo cálculo
  const ultimo = maisRecentes(extras.combustivel)[0];
  if (ultimo) {
    $("kmInicial").value = ultimo.kmFinal;
    $("consumo").value = ultimo.consumo;
    $("precoLitro").value = ultimo.preco;
  }

  $("formCombustivel").addEventListener("submit", aoSalvarCombustivel);
  ["kmInicial", "kmFinal", "consumo", "precoLitro", "dataCombustivel"].forEach((id) => $(id).addEventListener("input", renderizarResultadoCombustivel));
  $("formManutencao").addEventListener("submit", aoSalvarManutencao);
  $("formTurno").addEventListener("submit", aoSalvarTurno);
  $("btnGanhosDoDia").addEventListener("click", () => {
    const g = ganhosDoDia($("dataTurno").value);
    $("ganhosTurno").value = g > 0 ? g : "";
    aviso("mensagemTurno", g > 0 ? "" : "Não há ganhos registrados nesta data.", g <= 0);
  });
  $("formObjetivo").addEventListener("submit", aoCriarObjetivo);

  $("abasGrafico").addEventListener("click", (ev) => {
    const aba = ev.target.closest(".aba");
    if (!aba) return;
    tipoGrafico = aba.dataset.grafico;
    document.querySelectorAll(".aba").forEach((a) => a.classList.toggle("ativa", a === aba));
    desenharGrafico();
  });
  $("filtroPeriodo").addEventListener("change", desenharGrafico);
  $("filtroAgrupar").addEventListener("change", desenharGrafico);
  const canvas = $("canvasGrafico");
  canvas.addEventListener("pointermove", mostrarTooltip);
  canvas.addEventListener("pointerdown", mostrarTooltip);
  canvas.addEventListener("pointerleave", () => { $("tooltipGrafico").hidden = true; });
  window.addEventListener("resize", desenharGrafico);
}

/* ---------- 7. Eventos e inicialização ---------- */

function aoEnviarFormulario(evento) {
  evento.preventDefault(); // impede a página de recarregar

  const erro = validarFormulario();
  if (erro) {
    mostrarErro(erro);
    return;
  }
  mostrarErro("");

  movimentacoes.push({
    id: gerarId(),
    descricao: campoDescricao.value.trim(),
    tipo: tipoSelecionado(),
    categoria: campoCategoria.value,
    valor: Math.round(parseFloat(campoValor.value) * 100) / 100,
    data: campoData.value
  });

  salvarDados();
  atualizarTela();

  // Limpa descrição e valor, mantendo tipo e data para agilizar novos registros
  campoDescricao.value = "";
  campoValor.value = "";
  campoDescricao.focus();
}

function aoClicarNoHistorico(evento) {
  const botao = evento.target.closest(".btn-excluir");
  if (!botao) return;
  if (!confirm("Excluir esta movimentação?")) return;

  movimentacoes = movimentacoes.filter(function (m) { return m.id !== botao.dataset.id; });
  salvarDados();
  atualizarTela();
}

function iniciar() {
  campoData.value = dataParaTexto(new Date()); // data padrão: hoje
  atualizarCategorias();
  carregarDados();
  carregarMeta();
  iniciarExtras();
  if (metaSemanal > 0) document.getElementById("campoMeta").value = metaSemanal;
  indiceVersiculo = indiceDoDia();
  renderizarVersiculo();
  atualizarTela();

  form.addEventListener("submit", aoEnviarFormulario);
  form.elements["tipo"].forEach(function (radio) {
    radio.addEventListener("change", atualizarCategorias);
  });
  listaHistorico.addEventListener("click", aoClicarNoHistorico);

  // Meta semanal e palavra de incentivo
  document.getElementById("btnSalvarMeta").addEventListener("click", aoSalvarMeta);
  document.getElementById("btnOutroVersiculo").addEventListener("click", proximoVersiculo);

  // Backup
  const campoArquivo = document.getElementById("arquivoImportar");
  document.getElementById("btnExportar").addEventListener("click", exportarBackup);
  document.getElementById("btnImportar").addEventListener("click", function () {
    campoArquivo.click();
  });
  campoArquivo.addEventListener("change", function () {
    importarBackup(campoArquivo.files[0]);
    campoArquivo.value = ""; // permite importar o mesmo arquivo de novo
  });
}

iniciar();
