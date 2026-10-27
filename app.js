// Central de comando: dashboard global (lê e escreve no mesmo banco que o Telegram e os agentes).
// Sem config.js: modo demonstração com dados de exemplo em memória.

const PROJETOS = { servicos: "Serviços", video: "Vídeo", produtos: "Produtos", cafe: "Café", tortas: "Tortaria Mineira", monitor: "Monitor de lives" };
const FONTES = { tiktok: "TikTok", youtube: "YouTube", sites: "Sites" };
// ordem na lista: o que está acontecendo agora primeiro
const ORDEM_ESTADO = { gravando: 0, aberto: 0, analisando: 1, fila: 2, bloqueado: 3, executado: 4 };
const ROTULO_ESTADO = { gravando: "gravando", analisando: "analisando", fila: "na fila", offline: "offline",
  desconhecido: "desconhecido", aberto: "sinal aberto", executado: "encerrado", bloqueado: "bloqueado",
  ao_vivo: "ao vivo", login_necessario: "pede login" };
const RESULTADO = { aprovada: "Aprovada", ajustada: "Ajustada", descartada: "Descartada", expirada: "Expirou" };
const TIPO_EVENTO = { acao: "ação", aprendizado: "aprendizado", alerta: "alerta", resumo: "resumo", erro: "erro" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (v) => `US$ ${Math.round(Number(v) || 0).toLocaleString("pt-BR")}`;
const brl = (v, taxa) => `R$ ${Math.round((Number(v) || 0) * taxa).toLocaleString("pt-BR")}`;
const quando = (iso) => iso ? new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—";
function prazoRelativo(iso) {
  const h = Math.round((new Date(iso) - Date.now()) / 36e5);
  if (h < 0) return { texto: "vencida", cls: "critical" };
  if (h < 12) return { texto: `${h} h`, cls: "warning" };
  return { texto: h < 48 ? `${h} h` : `${Math.round(h / 24)} dias`, cls: "good" };
}

// ---------- fonte de dados: Supabase ou demonstração ----------

function fonteSupabase(cfg) {
  // implicit: o link do e-mail traz a sessão na URL e funciona mesmo aberto em outra aba/navegador
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true },
  });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    demo: false,
    sb,
    async carregar() {
      const [projetos, pendentes, resolvidas, instrucoes, eventos, cambio, pausa, monitorFontes, monitorItens, monitorSinais] = await Promise.all([
        sb.from("v_estado_projetos").select("*").order("id").then(ok),
        sb.from("decisoes").select("*").eq("status", "pendente").order("impacto", { ascending: false }).order("prazo").then(ok),
        sb.from("decisoes").select("*").neq("status", "pendente").order("decidido_em", { ascending: false }).limit(10).then(ok),
        sb.from("instrucoes").select("*").order("criado_em", { ascending: false }).limit(10).then(ok),
        sb.from("eventos").select("*").order("criado_em", { ascending: false }).limit(25).then(ok),
        sb.from("cambio").select("*").order("data", { ascending: false }).limit(1).then(ok),
        sb.from("controle").select("valor").eq("chave", "pausa").then(ok),
        sb.from("monitor_fontes").select("*").then(ok),
        sb.from("monitor_itens").select("*").order("nome").then(ok),
        sb.from("monitor_sinais").select("*").order("desde", { ascending: false }).then(ok),
      ]);
      return { projetos, pendentes, resolvidas, instrucoes, eventos, taxa: cambio[0]?.brl ?? 5, pausado: pausa[0]?.valor === true,
               monitorFontes, monitorItens, monitorSinais };
    },
    decidir: (id, status, resposta) =>
      sb.rpc("decidir", { p_id: id, p_status: status, p_resposta: resposta || null, p_canal: "dashboard" }).then(ok),
    instruir: (projeto, texto) =>
      sb.from("instrucoes").insert({ projeto_id: projeto || null, texto, origem: "dashboard" }).then(ok),
    pausar: (valor) => sb.from("controle").upsert({ chave: "pausa", valor }).then(ok),
    aoMudar(fn) {
      sb.channel("central")
        .on("postgres_changes", { event: "*", schema: "public" }, fn)
        .subscribe();
    },
  };
}

function fonteDemo() {
  const agora = Date.now(), h = 36e5;
  const s = {
    projetos: [
      { id: "servicos", nome: "Serviços: agentes de IA e MCP para SaaS", fase: "Setup: perfil Upwork e 3 demos", resumo: "12 vagas ranqueadas hoje; 3 propostas prontas.", decisoes_pendentes: 1, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 40, ultima_atividade: new Date(agora - 2 * h).toISOString() },
      { id: "video", nome: "Canal de vídeo build-in-public", fase: "Setup: canal e pipeline", resumo: "Roteiro do vídeo 1 pronto para revisão.", decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0, ultima_atividade: new Date(agora - 20 * h).toISOString() },
      { id: "produtos", nome: "Produtos digitais: templates → MCP pago", fase: "Aguardando as primeiras demos", resumo: "", decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0, ultima_atividade: null },
      { id: "cafe", nome: "Loja Herança: Mercado Livre, TikTok, B2B", fase: "Preparação para 11/01/2027", resumo: "Embalagens em orçamento com 3 gráficas.", decisoes_pendentes: 1, instrucoes_novas: 1, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 990, ultima_atividade: new Date(agora - 5 * h).toISOString() },
    ],
    pendentes: [
      { id: 7, projeto_id: "servicos", agente: "Propostas", titulo: "Enviar proposta \"MCP server for billing API\" (US$ 2.400)", contexto: "Cliente SaaS de faturamento, 4,9★, já contratou 12 freelancers. Pede MCP para a API REST deles.", recomendacao: "Enviar com o pacote MCP Server Sprint, prazo de 10 dias.", impacto: 5, prazo: new Date(agora + 30 * h).toISOString(), padrao_sem_resposta: "não enviar" },
      { id: 8, projeto_id: "cafe", agente: "Estoque e produção", titulo: "Pedir à Herança 40 kg do lote Especial para torra de dezembro", contexto: "Plano de verde: 98 kg até maio. Fotos e amostras precisam de 10 kg.", recomendacao: "Aprovar 40 kg agora, o restante em fevereiro.", impacto: 3, prazo: new Date(agora + 8 * h).toISOString(), padrao_sem_resposta: "não pedir" },
    ],
    resolvidas: [
      { id: 6, projeto_id: "video", agente: "Edição e cortes", titulo: "Publicar o vídeo longo #1", status: "aprovada", decidido_por: "telegram", decidido_em: new Date(agora - 26 * h).toISOString() },
    ],
    instrucoes: [
      { id: 3, projeto_id: "cafe", texto: "Priorizar o kit presente nos anúncios de lançamento", origem: "telegram", status: "nova", criado_em: new Date(agora - 3 * h).toISOString() },
    ],
    eventos: [
      { id: 21, projeto_id: "servicos", agente: "Prospector", tipo: "acao", titulo: "12 vagas ranqueadas; 3 acima de 80 pontos", criado_em: new Date(agora - 2 * h).toISOString() },
      { id: 20, projeto_id: "cafe", agente: "Gestor", tipo: "aprendizado", titulo: "Títulos com \"pontos\" e \"Sul de Minas\" vencem no teste de busca", criado_em: new Date(agora - 5 * h).toISOString() },
      { id: 19, projeto_id: null, agente: "Gestor", tipo: "resumo", titulo: "Resumo diário enviado (2 decisões)", criado_em: new Date(agora - 9 * h).toISOString() },
    ],
    taxa: 5.0465,
    pausado: false,
    monitorFontes: [
      { fonte: "tiktok", ligado: true, vagas: "5 vagas", resumo: "1 gravando, 0 na fila, 1 em análise", atualizado_em: new Date(agora).toISOString() },
      { fonte: "sites", ligado: true, vagas: "1 site(s)", resumo: "Foresignal: 1 sinais abertos em 2 pares", atualizado_em: new Date(agora).toISOString() },
    ],
    monitorItens: [
      { fonte: "tiktok", item: "canal.fx", nome: "@canal.fx", estado: "gravando", ativo: true, analisando: true, espectadores: 87, desde: new Date(agora - 0.4 * h).toISOString(), chamadas_hoje: 2, detalhe: "XAUUSD ao vivo" },
      { fonte: "tiktok", item: "outro", nome: "@outro", estado: "offline", ativo: false, analisando: false, chamadas_hoje: 0 },
      { fonte: "sites", item: "foresignal:EURUSD", nome: "Foresignal · EUR/USD", estado: "aberto", ativo: true, analisando: false, desde: new Date(agora - 1 * h).toISOString(), chamadas_hoje: 1, detalhe: "compra · válido até 07:51" },
      { fonte: "sites", item: "foresignal:GBPUSD", nome: "Foresignal · GBP/USD", estado: "executado", ativo: false, analisando: false, chamadas_hoje: 1, detalhe: "+11 pips" },
    ],
    monitorSinais: [
      { fonte: "tiktok", sinal_id: 1, item: "canal.fx", origem: "@canal.fx", instrumento: "XAUUSD", direcao: "compra", entrada: "4010–4012", stop: 4000, alvos: "4030 / 4050", desde: new Date(agora - 0.3 * h).toISOString(), ate: new Date(agora + 23.7 * h).toISOString() },
      { fonte: "sites", sinal_id: 2, item: "foresignal:EURUSD", origem: "Foresignal", instrumento: "EURUSD", direcao: "compra", entrada: "1.117", stop: 1.1149, alvos: "1.1187", desde: new Date(agora - 1 * h).toISOString(), ate: new Date(agora + 7 * h).toISOString() },
    ],
  };
  return {
    demo: true,
    carregar: async () => structuredClone(s),
    async decidir(id, status, resposta) {
      const i = s.pendentes.findIndex((d) => d.id === id);
      if (i < 0) throw new Error(`decisão ${id} já foi resolvida`);
      const [d] = s.pendentes.splice(i, 1);
      s.resolvidas.unshift({ ...d, status, resposta, decidido_por: "dashboard", decidido_em: new Date().toISOString() });
    },
    async instruir(projeto, texto) {
      s.instrucoes.unshift({ id: Date.now(), projeto_id: projeto || null, texto, origem: "dashboard", status: "nova", criado_em: new Date().toISOString() });
    },
    async pausar(valor) { s.pausado = valor; },
    aoMudar() {},
  };
}

// ---------- renderização ----------

let fonte, estado, ajustando = null, erro = "";

function htmlDecisao(d) {
  const p = prazoRelativo(d.prazo);
  const formAjuste = ajustando === d.id ? `
    <label for="aj-${d.id}">O que ajustar?</label>
    <textarea id="aj-${d.id}" placeholder="Ex.: subir para US$ 2.800 e incluir testes"></textarea>
    <div class="acoes">
      <button class="primario" data-acao="confirmar-ajuste" data-id="${d.id}">Confirmar ajuste</button>
      <button data-acao="cancelar-ajuste">Cancelar</button>
    </div>` : `
    <div class="acoes">
      <button class="primario" data-acao="aprovada" data-id="${d.id}">Aprovar</button>
      <button data-acao="ajustar" data-id="${d.id}">Ajustar</button>
      <button data-acao="descartada" data-id="${d.id}">Descartar</button>
    </div>`;
  return `<div class="card">
    <div class="meta"><span class="chip">${esc(PROJETOS[d.projeto_id] ?? "Global")}</span><span>${esc(d.agente)}</span>
      <span>impacto ${d.impacto}/5</span><span class="badge ${p.cls}">prazo ${p.texto}</span><span>#${d.id}</span></div>
    <div class="titulo">${esc(d.titulo)}</div>
    ${d.contexto ? `<div>${esc(d.contexto)}</div>` : ""}
    ${d.recomendacao ? `<div class="reco"><b>Recomendação:</b> ${esc(d.recomendacao)}</div>` : ""}
    <div class="meta">Sem resposta: ${esc(d.padrao_sem_resposta)}</div>
    ${formAjuste}
  </div>`;
}

function htmlProjeto(p) {
  return `<div class="card">
    <div class="titulo">${esc(p.nome)}</div>
    <div class="meta">${esc(p.fase ?? "")}</div>
    ${p.resumo ? `<div style="font-size:14px">${esc(p.resumo)}</div>` : ""}
    <div class="meta">
      <span>Lucro 7d <span class="num">${usd(p.lucro_7d_usd)}</span> · ${brl(p.lucro_7d_usd, estado.taxa)}</span>
      <span>28d <span class="num">${usd(p.lucro_28d_usd)}</span></span>
      <span>Investido <span class="num">${usd(p.investido_usd)}</span></span>
    </div>
    <div class="meta"><span>${p.decisoes_pendentes} decisões</span><span>${p.instrucoes_novas} instruções novas</span><span>ativo ${quando(p.ultima_atividade)}</span></div>
  </div>`;
}

function duracao(iso) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

function htmlItemMonitor(i) {
  const cls = i.ativo ? "good" : i.analisando || i.estado === "fila" ? "warning" : "";
  const extras = [
    i.analisando && i.estado !== "analisando" ? `<span class="badge warning">analisando</span>` : "",
    i.espectadores != null ? `<span>${Number(i.espectadores).toLocaleString("pt-BR")} espectadores</span>` : "",
    i.ativo && i.desde ? `<span>há ${duracao(i.desde)}</span>` : "",
    i.chamadas_hoje ? `<span>${i.chamadas_hoje} chamada(s) hoje</span>` : "",
  ].join("");
  return `<li><span class="badge ${cls}">${esc(ROTULO_ESTADO[i.estado] ?? i.estado)}</span> ${esc(i.nome)}
    <div class="meta">${extras}${i.detalhe ? `<span>${esc(i.detalhe)}</span>` : ""}</div></li>`;
}

function htmlSinal(s) {
  const venda = s.direcao === "venda";
  const ate = s.ate ? new Date(s.ate).toLocaleTimeString("pt-PT", { timeStyle: "short" }) : null;
  return `<li><span class="badge ${venda ? "critical" : s.direcao === "compra" ? "good" : ""}">${esc((s.direcao || "?").toUpperCase())}</span>
    <b>${esc(s.instrumento)}</b> · entrada ${esc(s.entrada ?? "—")} · SL ${esc(s.stop ?? "—")} · TP ${esc(s.alvos ?? "—")}
    <div class="meta"><span>${esc(s.origem)}</span><span>há ${duracao(s.desde)}</span>${ate ? `<span>válido até ${ate}</span>` : ""}</div></li>`;
}

function htmlMonitor(e) {
  const fontes = Object.keys(FONTES).map((f) => {
    const info = e.monitorFontes.find((x) => x.fonte === f);
    const itens = e.monitorItens.filter((i) => i.fonte === f)
      .sort((a, b) => (ORDEM_ESTADO[a.estado] ?? 9) - (ORDEM_ESTADO[b.estado] ?? 9) || (b.espectadores ?? 0) - (a.espectadores ?? 0));
    const sinais = (e.monitorSinais ?? []).filter((s) => s.fonte === f && (!s.ate || new Date(s.ate) > Date.now()));
    // item cujo sinal aberto já aparece em "Sinais ativos" (sites: um item por par) não se repete na lista
    const comSinal = new Set(sinais.map((s) => s.item));
    const visiveis = itens.filter((i) => !(i.estado === "aberto" && comSinal.has(i.item)));
    const agora = visiveis.filter((i) => (ORDEM_ESTADO[i.estado] ?? 9) <= 2 || i.analisando);
    const resto = visiveis.filter((i) => !agora.includes(i));
    const atraso = info ? (Date.now() - new Date(info.atualizado_em)) / 6e4 : Infinity;
    const status = !info ? { t: "sem dados", c: "" } : atraso > 3 ? { t: `sem sinal há ${duracao(info.atualizado_em)}`, c: "critical" }
      : info.ligado ? { t: "no ar", c: "good" } : { t: "pausado", c: "critical" };
    return `<div class="card">
      <div class="titulo">${FONTES[f]} <span class="badge ${status.c}">${status.t}</span></div>
      ${info ? `<div class="meta"><span>${esc(info.vagas ?? "")}</span><span>${esc(info.resumo ?? "")}</span><span>atualizado ${quando(info.atualizado_em)}</span></div>` : ""}
      <div class="sinais"><div class="meta"><b>Sinais ativos</b> <span class="count">${sinais.length}</span></div>
        <ul class="lista">${sinais.map(htmlSinal).join("") || `<li class="vazio">Nenhum sinal ativo.</li>`}</ul></div>
      ${agora.length ? `<ul class="lista">${agora.map(htmlItemMonitor).join("")}</ul>` : sinais.length ? "" : `<p class="vazio">Nada ativo agora.</p>`}
      ${resto.length ? `<details><summary>Outros ${resto.length} itens</summary><ul class="lista">${resto.map(htmlItemMonitor).join("")}</ul></details>` : ""}
    </div>`;
  });
  return `<section>
    <h2>Monitor de lives <span class="count">${e.monitorItens.filter((i) => i.ativo).length} ativos</span>
      <span class="count">${(e.monitorSinais ?? []).filter((s) => !s.ate || new Date(s.ate) > Date.now()).length} sinais</span></h2>
    <div class="projetos">${fontes.join("")}</div>
    <p class="meta" style="margin-top:8px">Uso pessoal: sinais só para o Diogo, nunca compartilhar.</p>
  </section>`;
}

function render() {
  const e = estado;
  document.getElementById("app").innerHTML = `
  <header>
    <h1>Central de comando</h1>
    <span class="badge ${e.pausado ? "critical" : "good"}">${e.pausado ? "✕ Agentes pausados" : "✓ Agentes ativos"}</span>
    <button data-acao="pausa">${e.pausado ? "Retomar agentes" : "Pausar todos"}</button>
    <span class="meta">atualizado ${new Date().toLocaleTimeString("pt-PT", { timeStyle: "short" })}</span>
  </header>
  <main>
    <div class="col">
      ${fonte.demo ? `<div class="aviso">Modo demonstração: dados de exemplo. Crie <code>config.js</code> para ligar ao banco.</div>` : ""}
      ${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ""}
      <section>
        <h2>Decisões pendentes <span class="count">${e.pendentes.length}</span></h2>
        ${e.pendentes.length ? e.pendentes.map(htmlDecisao).join("") : `<p class="vazio">Nada esperando por você.</p>`}
        <details><summary>Últimas resolvidas</summary>
          <ul class="lista">${e.resolvidas.map((d) => `<li>#${d.id} ${esc(d.titulo)}<div class="meta">${esc(RESULTADO[d.status] ?? d.status)} via ${esc(d.decidido_por)} · ${quando(d.decidido_em)}${d.resposta ? ` · “${esc(d.resposta)}”` : ""}</div></li>`).join("") || `<li class="vazio">Nenhuma ainda.</li>`}</ul>
        </details>
      </section>
      ${htmlMonitor(e)}
      <section>
        <h2>Projetos</h2>
        <div class="projetos">${e.projetos.map(htmlProjeto).join("")}</div>
      </section>
    </div>
    <div class="col">
      <section>
        <h2>Nova instrução</h2>
        <form id="form-instrucao">
          <label for="inst-projeto">Para</label>
          <select id="inst-projeto"><option value="">Todos os projetos</option>${Object.entries(PROJETOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <label for="inst-texto" style="margin-top:8px">Instrução ou input</label>
          <textarea id="inst-texto" required placeholder="Ex.: esta semana, foco total em fechar o 1º cliente"></textarea>
          <div class="acoes"><button class="primario" type="submit">Enviar aos agentes</button></div>
        </form>
        <ul class="lista" style="margin-top:12px">${e.instrucoes.map((i) => `<li>${esc(i.texto)}<div class="meta"><span class="chip">${esc(PROJETOS[i.projeto_id] ?? "Global")}</span>${esc(i.status)} · via ${esc(i.origem)} · ${quando(i.criado_em)}${i.resultado ? ` · ${esc(i.resultado)}` : ""}</div></li>`).join("")}</ul>
      </section>
      <section>
        <h2>Atividade dos agentes</h2>
        <ul class="lista">${e.eventos.map((v) => `<li><span class="badge ${v.tipo === "alerta" || v.tipo === "erro" ? "critical" : v.tipo === "aprendizado" ? "warning" : ""}">${esc(TIPO_EVENTO[v.tipo] ?? v.tipo)}</span> ${esc(v.titulo)}<div class="meta"><span class="chip">${esc(PROJETOS[v.projeto_id] ?? "Global")}</span>${esc(v.agente)} · ${quando(v.criado_em)}</div></li>`).join("") || `<li class="vazio">Sem atividade ainda.</li>`}</ul>
      </section>
    </div>
  </main>`;
}

async function recarregar() {
  try { estado = await fonte.carregar(); erro = ""; } catch (e) { erro = `Falha ao carregar: ${e.message}`; }
  if (estado) render();
}

async function agir(fn) {
  try { await fn(); erro = ""; } catch (e) { erro = e.message.includes("já foi resolvida") ? "Essa decisão já tinha sido resolvida por outro canal (Telegram)." : e.message; }
  ajustando = null;
  await recarregar();
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-acao]");
  if (!b) return;
  const id = Number(b.dataset.id), acao = b.dataset.acao;
  if (acao === "ajustar") { ajustando = id; return render(); }
  if (acao === "cancelar-ajuste") { ajustando = null; return render(); }
  if (acao === "pausa") return agir(() => fonte.pausar(!estado.pausado));
  if (acao === "confirmar-ajuste") {
    const texto = document.getElementById(`aj-${id}`).value.trim();
    if (!texto) return;
    return agir(() => fonte.decidir(id, "ajustada", texto));
  }
  if (acao === "aprovada" || acao === "descartada") { b.disabled = true; return agir(() => fonte.decidir(id, acao)); }
});

document.addEventListener("submit", (ev) => {
  if (ev.target.id !== "form-instrucao") return;
  ev.preventDefault();
  const texto = document.getElementById("inst-texto").value.trim();
  if (texto) agir(() => fonte.instruir(document.getElementById("inst-projeto").value, texto));
});

// ---------- login e início ----------

// erro que o Supabase devolve na URL quando o link expirou ou já foi usado
function erroDoLink() {
  const p = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
  const msg = p.get("error_description");
  return msg ? `O link não funcionou (${msg.replace(/\+/g, " ")}). Peça um novo abaixo.` : "";
}

function telaLogin(sb) {
  document.getElementById("app").innerHTML = `
  <section id="login">
    <h2>Central de comando</h2>
    <form id="form-login">
      <label for="email">E-mail autorizado</label>
      <input id="email" type="email" required autocomplete="email">
      <div class="acoes"><button class="primario" type="submit">Receber link de acesso</button></div>
      <p class="meta" id="login-msg">${esc(erroDoLink())}</p>
    </form>
  </section>`;
  history.replaceState(null, "", location.pathname); // limpa erro/tokens da URL
  document.getElementById("form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { error } = await sb.auth.signInWithOtp({
      email: document.getElementById("email").value,
      options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false },
    });
    document.getElementById("login-msg").textContent = error ? error.message
      : "Link enviado. Use o e-mail \"Magic Link\" mais recente e abra neste computador.";
  });
}

let painelIniciado = false;

async function iniciarPainel() {
  if (painelIniciado) return;
  painelIniciado = true;
  history.replaceState(null, "", location.pathname);
  await recarregar();
  let espera;
  fonte.aoMudar(() => { clearTimeout(espera); espera = setTimeout(recarregar, 300); });
  setInterval(recarregar, 30000); // reserva caso o tempo real caia
}

(async function iniciar() {
  const cfg = window.CENTRAL_CONFIG;
  fonte = cfg ? fonteSupabase(cfg) : fonteDemo();
  if (fonte.demo || cfg.modoTeste) return iniciarPainel();
  fonte.sb.auth.onAuthStateChange((evento, sessao) => {
    if (sessao) setTimeout(iniciarPainel, 0); // sessão vinda do link do e-mail
  });
  const { data } = await fonte.sb.auth.getSession();
  if (data.session) return iniciarPainel();
  telaLogin(fonte.sb);
})();
