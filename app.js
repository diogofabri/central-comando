// Central de comando: dashboard global (lê e escreve no mesmo banco que o Telegram e os agentes).
// Sem config.js: modo demonstração com dados de exemplo em memória.
// Rotas: #/ (visão geral) · #/p/<projeto> (detalhe) · #/monitor (monitor de lives e placar) · #/agentes|tiktok|youtube|sites[/<id>] (análise de cada fonte).

const PROJETOS = {
  servicos: { nome: "Serviços", longo: "Serviços: agentes de IA e MCP para SaaS" },
  video:    { nome: "Vídeo", longo: "Canal de vídeo build-in-public (Vínculo)" },
  produtos: { nome: "Produtos", longo: "Produtos digitais: templates → MCP pago" },
  cafe:     { nome: "Café", longo: "Loja Herança: Mercado Livre, TikTok, B2B" },
  tortas:   { nome: "Tortaria", longo: "Tortaria Mineira: Uber Eats + Glovo (Porto)" },
  monitor:  { nome: "Monitor", longo: "Monitor de lives (uso pessoal)" },
};
const RENDA = ["servicos", "video", "produtos", "cafe", "tortas"];
const FONTES = { tiktok: "TikTok", youtube: "YouTube", sites: "Sites", telegram: "Telegram", agentes: "Agentes", tradingview: "TradingView" };

// ---------- contextos de mercado (12/11/2026): Forex, Bovespa e a visão Todos ----------
// No banco, a fonte do contexto Bovespa é "<fonte>@bovespa" (migração 0012); sem sufixo é Forex. A coluna `contexto` é gerada.
const CONTEXTOS = {
  forex: { nome: "Forex", fontes: ["tiktok", "youtube", "sites", "telegram", "agentes", "tradingview"], termometro: true, execucao: true,
           corretora: "dados Capital.com · execução ActivTrades" },
  // execução na CLEAR (16/11/2026): botões Demo/Real próprios (controle.execucao@bovespa:*), WIN/WDO em day trade por
  // padrão com botão de swing por operação; ações em swing
  bovespa: { nome: "Bovespa", fontes: ["youtube", "telegram", "agentes"], termometro: false, execucao: true,
             corretora: "dados e execução CLEAR · WIN/WDO em day trade (swing por operação)" },
};
const ctxDe = (f) => String(f ?? "").split("@")[1] || "forex";
const baseDe = (f) => String(f ?? "").split("@")[0];
const sufixoDe = (ctx) => (ctx && ctx !== "forex" && ctx !== "todos" ? `@${ctx}` : "");
let ctxLembrado = "forex", ctxAtual = "forex", ctxLente = "forex";
try { const c = localStorage.getItem("monitor-ctx"); if (c === "bovespa" || c === "todos") ctxLembrado = c; } catch { /* sem armazenamento: segue o padrão */ }
function lembrarContexto(c) {
  ctxLembrado = c;
  try { localStorage.setItem("monitor-ctx", c); } catch { /* ok */ }
}
const fontesDoCtx = () => CONTEXTOS[ctxLente]?.fontes ?? Object.keys(FONTES);

// A "lente": o resto do dashboard compara `fonte === "youtube"` em dezenas de lugares. Em vez de mexer em todos, cada contexto
// enxerga o estado só com as linhas dele e com o sufixo "@contexto" tirado do nome da fonte.
function lente(bruto, ctx) {
  if (!bruto) return bruto;
  const doCtx = (linhas) => (linhas ?? []).filter((r) => ctxDe(r.fonte) === ctx).map((r) => ({ ...r, fonte: baseDe(r.fonte) }));
  const chaves = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => ctxDe(k) === ctx).map(([k, v]) => [baseDe(k), v]));
  return { ...bruto, contexto: ctx,
    monitorFontes: doCtx(bruto.monitorFontes), monitorItens: doCtx(bruto.monitorItens), monitorSinais: doCtx(bruto.monitorSinais),
    monitorResultados: doCtx(bruto.monitorResultados), monitorOrdens: doCtx(bruto.monitorOrdens), monitorMaquinas: doCtx(bruto.monitorMaquinas),
    monitorComando: chaves(bruto.monitorComando),
    // controles que ainda são só do Forex (painel dos agentes, termômetro e login): vazios nos outros contextos; a execução
    // da Bovespa tem chaves próprias (execucao@bovespa:*), carregadas à parte
    ...(ctx !== "forex" ? { agentesPainel: null, termometro: null, loginFonte: {}, loginPedido: {},
      execucao: ctx === "bovespa" && bruto.execucaoBovespa ? bruto.execucaoBovespa : { selecao: { demo: {}, real: {} }, estado: { demo: null, real: null }, swing: {} } } : {}) };
}

// fontes no molde dos sites: uma linha por site/canal, com os pares recolhidos (item = "<site ou canal>:<par>")
const COMO_SITES = new Set(["sites", "telegram"]);
// Páginas de análise (?m=, 18/11/2026, pedido do Diogo): uma aba por corretora (ordens executadas, conta demo ou real em
// ?c=), o Teórico (todos os sinais pelo preço) e o Sem disparo. Os antigos ?m=demo|real abrem a corretora em uso.
const CORRETORAS_CTX = { forex: [["capitalcom", "Capital.com"], ["activtrades", "ActivTrades"]], bovespa: [["clear", "CLEAR"]] };
const MODOS_VALIDOS = new Set(["todos", "sem", "demo", "real", "capitalcom", "activtrades", "clear"]);
const corretorasDoCtx = () => CORRETORAS_CTX[ctxLente] ?? [];
const corretoraDoModo = (m) => corretorasDoCtx().find(([k]) => k === m);
const modalidadesDoCtx = () => [...corretorasDoCtx(), ["todos", "Teórico"], ["sem", "Sem disparo"]];
// modo da rota → modo válido no contexto (demo/real antigos e corretora de outro mercado viram a corretora em uso)
function modoNoCtx(modo) {
  if (modo === "todos" || modo === "sem" || corretoraDoModo(modo)) return modo;
  if (!corretorasDoCtx().length) return "todos";
  const ativa = ctxLente === "forex" ? (estado?.execucao?.corretora ?? "capitalcom") : corretorasDoCtx()[0][0];
  return corretoraDoModo(ativa) ? ativa : corretorasDoCtx()[0][0];
}
// fontes que não são contêiner: rodam na sessão do Claude Code a cada N min (monitor_fontes.proxima_execucao)
const FONTES_PERIODICAS = new Set(["agentes", "tradingview", "telegram"]);  // rodadas pelo executor (sem live): contador até a próxima rodada
// ordem na lista: o que está acontecendo agora primeiro
const ORDEM_ESTADO = { gravando: 0, aberto: 0, analisando: 1, proximo: 1, fila: 2, lido: 2, bloqueado: 3, executado: 4, sem_sinal: 5, sem_dados: 6, erro: 6 };
const ROTULO_ESTADO = { gravando: "capturando", analisando: "IA analisando", fila: "aguardando a vez", lido: "já analisado", offline: "offline",
  desconhecido: "desconhecido", aberto: "sinal aberto", executado: "encerrado", bloqueado: "bloqueado",
  ao_vivo: "ao vivo", login_necessario: "pede login", proximo: "próximo", sem_sinal: "sem sinal", sem_dados: "sem dados",
  erro: "erro", expirado: "vencido" };
const RESULTADO = { aprovada: "Aprovada", ajustada: "Ajustada", descartada: "Descartada", expirada: "Expirou" };
const TIPO_EVENTO = { acao: "ação", aprendizado: "aprendizado", alerta: "alerta", resumo: "resumo", erro: "erro" };
const MARCOS_PADRAO = { M1: 4, M3: 13, M6: 26, M12: 52 };
const INICIO_PADRAO = "2026-10-26";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ico = (nome, cls = "") => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
// Página pública de cada site do monitor (05-monitor-lives/sites/<id>/site.yaml → url_inicial)
const SITES_URL = { foresignal: "https://foresignal.com/pt/", cryptet: "https://cryptet.com/pt/", sureshotfx: "https://sureshotfx.com/live-signals" };
// URL para abrir o canal/live/site a partir do item do monitor (TikTok: handle; YouTube: handle, UC… ou v=<id>; sites: <site>:<par>)
function urlCanal(fonte, item) {
  if (!item || item === "consenso") return null;
  if (fonte === "tiktok") return `https://www.tiktok.com/@${encodeURIComponent(item.replace(/^@/, ""))}/live`;
  if (fonte === "youtube") {
    if (item.startsWith("v=")) return `https://www.youtube.com/watch?v=${encodeURIComponent(item.slice(2))}`;
    if (/^UC[\w-]{20,}$/.test(item)) return `https://www.youtube.com/channel/${item}/live`;
    // "canal~2": 2.ª live do mesmo canal (opção x2 do canais-youtube.txt); o link é o do canal
    return `https://www.youtube.com/@${encodeURIComponent(item.replace(/^@/, "").replace(/~\d+$/, ""))}/live`;
  }
  if (fonte === "sites") return SITES_URL[item.split(":")[0]] ?? null;
  if (fonte === "telegram") { const c = item.split(":")[0]; return /^-\d+$/.test(c) ? null : `https://t.me/${encodeURIComponent(c)}`; }  // canal privado (id numérico): sem link público
  return null;
}
// nome do canal como link que abre em outra aba (ou só o texto, quando não há URL)
function linkCanal(fonte, item, nome) {
  const url = urlCanal(fonte, item);
  return url ? `<a class="canal" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Abrir em outra aba">${esc(nome)}${ico("external")}</a>` : esc(nome);
}
const inteiro = (v) => Math.round(Number(v) || 0).toLocaleString("pt-BR");
const usd = (v) => `US$ ${inteiro(v)}`;
const brl = (v, taxa) => `R$ ${inteiro((Number(v) || 0) * taxa)}`;
const usdCurto = (v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",").replace(",0", "")}k` : inteiro(v);
const numero = (v) => { v = Number(v) || 0; return Math.abs(v) < 10 && v !== Math.round(v) ? v.toFixed(1).replace(".", ",") : inteiro(v); };
const quando = (iso) => iso ? new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—";
const dataCurta = (iso) => iso ? new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }) : "—";
const cor = (id) => `var(--${PROJETOS[id] ? id : "global"})`;
const nomeProj = (id) => PROJETOS[id]?.nome ?? "Global";
function prazoRelativo(iso) {
  const h = Math.round((new Date(iso) - Date.now()) / 36e5);
  if (h < 0) return { texto: "vencida", cls: "critical" };
  if (h < 12) return { texto: `${h} h`, cls: "warning" };
  return { texto: h < 48 ? `${h} h` : `${Math.round(h / 24)} dias`, cls: "good" };
}
function duracao(iso) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}
function haQuanto(iso) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso)) / 6e4);
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
}
const reduzMovimento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- metas e semanas (mesma lógica de 00-painel-resultados/scripts/painel.py) ----------

const semanaDe = (d, inicio) => Math.floor((d - inicio) / (7 * 864e5)) + 1;
function pontos(metas, marcos, origem) {
  const pts = origem === null ? [] : [[0, origem]];
  return pts.concat(Object.entries(metas).map(([m, v]) => [marcos[m], v]).sort((a, b) => a[0] - b[0]));
}
function interpolar(pts, semana) {
  if (!pts.length) return 0;
  if (semana <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [s0, v0] = pts[i], [s1, v1] = pts[i + 1];
    if (semana <= s1) return v0 + (v1 - v0) * (semana - s0) / (s1 - s0);
  }
  return pts[pts.length - 1][1];
}
const metaKpi = (kpi, marcos, semana) => interpolar(pontos(kpi.metas, marcos, kpi.tipo === "semanal" ? null : 0), semana);
const projecao = (proj, marcos, semana) =>
  Object.fromEntries(Object.entries(proj).map(([c, v]) => [c, interpolar(pontos(v, marcos, 0), semana)]));
function classificar(real, p) {
  if (real >= p.otimista) return { cls: "good", rotulo: "Acima do otimista" };
  if (real >= p.realista) return { cls: "good", rotulo: "No alvo" };
  if (real >= p.pessimista) return { cls: "warning", rotulo: "Abaixo do realista" };
  return { cls: "critical", rotulo: "Abaixo do pessimista" };
}
function statusKpi(atual, meta) {
  if (atual === null || atual === undefined) return { cls: "muted", rotulo: "Sem dado" };
  if (meta <= 0 || atual >= meta) return { cls: "good", rotulo: "No alvo" };
  if (atual >= 0.7 * meta) return { cls: "warning", rotulo: "Atenção" };
  return { cls: "critical", rotulo: "Crítico" };
}

// números derivados de um projeto: série semanal, projeção da semana atual, KPIs e pendências
function calcularProjeto(id, e) {
  const painel = e.painel ?? {};
  const inicio = new Date((painel.data_inicio ?? INICIO_PADRAO) + "T00:00:00");
  const marcos = painel.marcos_semana ?? MARCOS_PADRAO;
  const semAtual = Math.max(1, semanaDe(new Date(), inicio));
  const cfg = painel.projetos?.[id] ?? {};
  const semanal = {};
  let investido = 0;
  const lanc = (e.lancamentos ?? []).filter((l) => l.projeto_id === id);
  for (const l of lanc) {
    const v = Number(l.valor_usd) || 0;
    if (l.tipo === "investimento") { investido += v; continue; }
    const s = semanaDe(new Date(l.data + "T00:00:00"), inicio);
    semanal[s] = (semanal[s] ?? 0) + (l.tipo === "receita" ? v : -v);
  }
  const serie = Array.from({ length: semAtual }, (_, i) => semanal[i + 1] ?? 0);
  const media4 = serie.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, serie.length);
  const acumulado = serie.reduce((a, b) => a + b, 0);
  const proj = cfg.projecao_usd_semana ? projecao(cfg.projecao_usd_semana, marcos, semAtual) : null;
  const kpisProj = (e.kpis ?? []).filter((k) => k.projeto_id === id);
  const ultimo = (kpiId) => kpisProj.filter((k) => k.kpi === kpiId).sort((a, b) => (a.data < b.data ? 1 : -1))[0];
  const kpis = (cfg.kpis ?? []).map((k) => {
    const u = ultimo(k.id);
    const atual = u ? Number(u.valor) : null;
    const meta = metaKpi(k, marcos, semAtual);
    return { ...k, atual, meta, data: u?.data, status: statusKpi(atual, meta) };
  });
  const outrosIds = [...new Set(kpisProj.map((k) => k.kpi))].filter((kid) => !(cfg.kpis ?? []).some((k) => k.id === kid));
  const outrosKpis = outrosIds.map((kid) => { const u = ultimo(kid); return { id: kid, atual: Number(u.valor), data: u.data }; });
  const pend = (painel.pendencias ?? []).filter((p) => p.projeto === id);
  const alertas = (cfg.criterios_parada ?? []).filter((c) => semAtual >= c.semana)
    .filter((c) => { const k = kpis.find((x) => x.id === c.kpi); return !k || k.atual === null || k.atual < c.minimo; });
  return { id, cfg, inicio, marcos, semAtual, serie, media4, acumulado, investido, proj, lanc,
    status: proj && lanc.length ? classificar(media4, proj) : null, kpis, outrosKpis, pend,
    abertas: pend.filter((p) => !p.feito), feitas: pend.filter((p) => p.feito), alertas };
}

// ---------- fonte de dados: Supabase ou demonstração ----------

function fonteSupabase(cfg) {
  // implicit: o link do e-mail traz a sessão na URL e funciona mesmo aberto em outra aba/navegador
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true },
  });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  // O Supabase devolve no máximo 1.000 linhas por consulta, sem avisar (21/11/2026): o dashboard via só as 1.000 ordens
  // mais ANTIGAS (544 fechadas e todas as vivas de fora) e só os 1.000 resultados mais novos (~3 dias em vez de 30).
  // `todas` busca em páginas até o fim; a consulta precisa de uma ordem estável (desempate por chave).
  const todas = async (consulta, teto = 30000) => {
    const linhas = [];
    for (let de = 0; de < teto; de += 1000) {
      const pagina = ok(await consulta().range(de, de + 999));
      linhas.push(...pagina);
      if (pagina.length < 1000) break;
    }
    return linhas;
  };
  const ha30d = () => new Date(Date.now() - 31 * 864e5).toISOString();
  return {
    demo: false,
    sb,
    async carregar() {
      const [projetos, pendentes, resolvidas, instrucoes, eventos, cambio, controle, monitorFontes, monitorItens, monitorSinais, monitorResultados, kpis, lancamentos, monitorOrdens, monitorMaquinas] = await Promise.all([
        sb.from("v_estado_projetos").select("*").order("id").then(ok),
        sb.from("decisoes").select("*").eq("status", "pendente").order("impacto", { ascending: false }).order("prazo").then(ok),
        sb.from("decisoes").select("*").neq("status", "pendente").order("decidido_em", { ascending: false }).limit(20).then(ok),
        sb.from("instrucoes").select("*").order("criado_em", { ascending: false }).limit(30).then(ok),
        sb.from("eventos").select("*").order("criado_em", { ascending: false }).limit(80).then(ok),
        sb.from("cambio").select("*").order("data", { ascending: false }).limit(1).then(ok),
        sb.from("controle").select("chave,valor").then(ok),
        sb.from("monitor_fontes").select("*").then(ok),
        sb.from("monitor_itens").select("*").order("nome").then(ok),
        sb.from("monitor_sinais").select("*").order("desde", { ascending: false }).then(ok),
        todas(() => sb.from("monitor_resultados").select("*").gte("resolvido_em", ha30d())
          .order("resolvido_em", { ascending: false }).order("fonte").order("sinal_id")),
        sb.from("kpis").select("data,projeto_id,kpi,valor").order("data", { ascending: false }).limit(600).then(ok),
        sb.from("v_lancamentos_usd").select("data,projeto_id,tipo,valor,moeda,valor_usd,descricao").order("data", { ascending: false }).limit(600).then(ok),
        // ordens da ponte do MT5 (migração 0011); sem a tabela ainda, a página segue só com o placar teórico
        todas(() => sb.from("monitor_ordens").select("*").gte("criado_em", ha30d()).order("id")).catch(() => []),
        // máquina dona de cada fonte (Mac × VPS, migração 0006): renovada a cada passagem do monitor
        sb.from("monitor_maquinas").select("fonte,maquina,visto_em").then(ok).catch(() => []),
      ]);
      const ctl = Object.fromEntries(controle.map((c) => [c.chave, c.valor]));
      return { projetos, pendentes, resolvidas, instrucoes, eventos, taxa: cambio[0]?.brl ?? 5, pausado: ctl.pausa === true,
               painel: ctl.painel ?? null, kpis, lancamentos, monitorFontes, monitorItens, monitorSinais, monitorResultados,
               monitorComando: Object.fromEntries(Object.entries(ctl).filter(([k]) => k.startsWith("monitor:")).map(([k, v]) => [k.slice(8), v !== false])),
               agentesPainel: ctl["agentes:painel"] ?? null, selfLearning: ctl["agentes:self_learning"] !== false,
               termometro: ctl["termometro:painel"] ?? null, cotacoes: ctl["cotacoes:sinais"] ?? null,
               audio: Object.fromEntries(Object.entries(ctl).filter(([k]) => k.startsWith("audio:")).map(([k, v]) => [k.slice(6), v === true])),
               loginFonte: { youtube: ctl["login:youtube"] ?? null, tiktok: ctl["login:tiktok"] ?? null },
               categorias: Object.fromEntries(Object.entries(ctl).filter(([k]) => k.startsWith("categorias:")).map(([k, v]) => [k.slice(11), v?.nomes ?? {}])), loginPedido: { youtube: ctl["login:youtube:pedido"] === true },
               consensoLigado: ctl["consenso:modo"] === true, monitorOrdens, monitorMaquinas, execucao: execucaoDoControle(ctl),
               execucaoBovespa: execucaoDoControle(ctl, "@bovespa"),
               // modo de cada máquina (controle.maquina:<nome>, gravado por `maquinas operar|leitura|aplicar`)
               maquinasModo: Object.fromEntries(Object.entries(ctl).filter(([k]) => k.startsWith("maquina:")).map(([k, v]) => [k.slice(8), v])),
               // botão de troca (13/11/2026): pedido do dashboard e plano vigente gravado pelo seguidor das máquinas
               maquinasPedido: ctl["maquinas:pedido"] ?? null, maquinasPlano: ctl["maquinas:plano"] ?? null,
               // switcher de prioridade dos navegadores (17/11/2026): "normal" | "bovespa" | "forex"
               prioridade: ["bovespa", "forex"].includes(ctl["prioridade:navegadores"]) ? ctl["prioridade:navegadores"] : "normal" };
    },
    decidir: (id, status, resposta) =>
      sb.rpc("decidir", { p_id: id, p_status: status, p_resposta: resposta || null, p_canal: "dashboard" }).then(ok),
    instruir: (projeto, texto) =>
      sb.from("instrucoes").insert({ projeto_id: projeto || null, texto, origem: "dashboard" }).then(ok),
    pausar: (valor) => sb.from("controle").upsert({ chave: "pausa", valor }).then(ok),
    // liga/desliga um monitor de lives (o monitor lê controle.monitor:<fonte> a cada 10 s)
    comandarMonitor: (fontes, ligar) =>
      sb.from("controle").upsert(fontes.map((f) => ({ chave: `monitor:${f}`, valor: ligar }))).then(ok),
    // liga/desliga o self-learning do executor dos agentes (lido a cada execução, a cada 5 min)
    comandarSelfLearning: (ligar) => sb.from("controle").upsert({ chave: "agentes:self_learning", valor: ligar }).then(ok),
    // modo consenso do TikTok e do YouTube: true = vários canais precisam concordar; false (padrão) = cada canal gera o seu sinal
    comandarConsenso: (ligar) => sb.from("controle").upsert({ chave: "consenso:modo", valor: ligar }).then(ok),
    // escutar o áudio da live (feature flag por fonte e contexto, 16/11/2026): controle.audio:<fonte>[@contexto]
    comandarAudio: (fonteCtx, ligar) => sb.from("controle").upsert({ chave: `audio:${fonteCtx}`, valor: ligar }).then(ok),
    // pede ao monitor que abra a janela de login da conta Google (a senha é digitada só no noVNC; nada de credencial passa por aqui)
    pedirLogin: (f) => sb.from("controle").upsert({ chave: `login:${f}:pedido`, valor: true }).then(ok),
    // troca de máquina: o seguidor de cada máquina (`maquinas seguir`, a cada minuto) lê o pedido e aplica
    pedirTroca: (maquina) => sb.from("controle").upsert({ chave: "maquinas:pedido", valor: { operar: maquina, em: new Date().toISOString() } }).then(ok),
    // prioridade dos navegadores entre Forex e Bovespa (lida pelas fontes de vídeo a cada ~10 s)
    comandarPrioridade: (modo) => sb.from("controle").upsert({ chave: "prioridade:navegadores", valor: modo }).then(ok),
    // corretora das ordens novas do Forex (18/11/2026): lida pelas pontes a cada ciclo (~15 s)
    comandarCorretora: (id) => sb.from("controle").upsert({ chave: "execucao:corretora", valor: id }).then(ok),
    // seleção do que a ponte do MT5 executa (lida a cada ciclo de ~15 s): {fontes: {tiktok: true}, unidades: {tiktok: {"@canal": false}}}
    // suf: "" no Forex, "@bovespa" na Bovespa (os botões de um contexto nunca ligam o outro)
    comandarExecucao: (modo, selecao, suf = "") => sb.from("controle").upsert({ chave: `execucao${suf}:${modo}`, valor: selecao }).then(ok),
    // operações de WIN/WDO marcadas como swing: {"<fonte>@bovespa:<sinal_id>": true} (a ponte não zera no fim do pregão)
    comandarSwing: (suf, mapa) => sb.from("controle").upsert({ chave: `execucao${suf}:swing`, valor: mapa }).then(ok),
    aoMudar(fn) {
      sb.channel("central")
        .on("postgres_changes", { event: "*", schema: "public" }, fn)
        .subscribe();
    },
  };
}

function fonteDemo() {
  const agora = Date.now(), h = 36e5, dia = 864e5;
  const d = (n) => new Date(agora - n * dia).toISOString().slice(0, 10);
  const metas = (a, b, c, e) => ({ M1: a, M3: b, M6: c, M12: e });
  const s = {
    projetos: [
      { id: "servicos", nome: "Serviços: agentes de IA e MCP para SaaS", status: "ativo", fase: "Setup: perfil Upwork e 3 demos", resumo: "12 vagas ranqueadas hoje; 3 propostas prontas.", decisoes_pendentes: 1, instrucoes_novas: 0, lucro_7d_usd: 420, lucro_28d_usd: 1180, investido_usd: 40, ultima_atividade: new Date(agora - 2 * h).toISOString() },
      { id: "video", nome: "Canal de vídeo build-in-public", status: "ativo", fase: "Setup: canal e pipeline", resumo: "Roteiro do vídeo 1 pronto para revisão.", decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0, ultima_atividade: new Date(agora - 20 * h).toISOString() },
      { id: "produtos", nome: "Produtos digitais: templates → MCP pago", status: "ativo", fase: "Aguardando as primeiras demos", resumo: "", decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0, ultima_atividade: null },
      { id: "cafe", nome: "Loja Herança: Mercado Livre, TikTok, B2B", status: "ativo", fase: "Preparação para 11/01/2027", resumo: "Embalagens em orçamento com 3 gráficas.", decisoes_pendentes: 1, instrucoes_novas: 1, lucro_7d_usd: 0, lucro_28d_usd: -35, investido_usd: 990, ultima_atividade: new Date(agora - 5 * h).toISOString() },
      { id: "tortas", nome: "Tortaria Mineira: Uber Eats + Glovo (Porto)", status: "ativo", fase: "Preparação para abrir em dezembro de 2026", resumo: "Produção em casa (SIR); falta SIR na Câmara e início de atividade.", decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0, ultima_atividade: new Date(agora - 30 * h).toISOString() },
      { id: "monitor", nome: "Monitor de lives (uso pessoal)", status: "ativo", fase: "TikTok, YouTube, sites e agentes em monitoramento", resumo: "Sinais só para o Diogo; nunca compartilhar.", decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0, ultima_atividade: null },
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
      { id: 18, projeto_id: "video", agente: "Localização", tipo: "alerta", titulo: "Dublagem automática ainda desligada no canal Vínculo", criado_em: new Date(agora - 20 * h).toISOString() },
    ],
    taxa: 5.0465,
    pausado: false,
    kpis: [
      { data: d(1), projeto_id: "servicos", kpi: "propostas_semana", valor: 9 }, { data: d(1), projeto_id: "servicos", kpi: "clientes_pagos_total", valor: 1 },
      { data: d(2), projeto_id: "video", kpi: "inscritos", valor: 38 }, { data: d(2), projeto_id: "video", kpi: "videos_longos", valor: 1 },
      { data: d(1), projeto_id: "video", kpi: "tiktok_seguidores_vinculo", valor: 12 }, { data: d(3), projeto_id: "cafe", kpi: "tiktok_seguidores_heranca", valor: 4 },
    ],
    lancamentos: [
      { data: d(2), projeto_id: "servicos", tipo: "receita", valor: 500, moeda: "USD", valor_usd: 500, descricao: "Sinal do MCP Sprint (cliente 1)" },
      { data: d(5), projeto_id: "servicos", tipo: "custo", valor: 80, moeda: "USD", valor_usd: 80, descricao: "Connects do Upwork" },
      { data: d(9), projeto_id: "servicos", tipo: "receita", valor: 760, moeda: "USD", valor_usd: 760, descricao: "Diagnóstico pago" },
      { data: d(12), projeto_id: "cafe", tipo: "investimento", valor: 5000, moeda: "BRL", valor_usd: 990, descricao: "Amostras e embalagens de teste" },
      { data: d(6), projeto_id: "cafe", tipo: "custo", valor: 177, moeda: "BRL", valor_usd: 35, descricao: "Frete das amostras" },
    ],
    painel: {
      gerado_em: new Date(agora - 4 * h).toISOString(), data_inicio: INICIO_PADRAO, marcos_semana: MARCOS_PADRAO,
      projetos: {
        servicos: { trilho: "motor de renda", status: "a iniciar", pasta: "01-servicos-automacao-ia", projecao_usd_semana: { pessimista: metas(0, 30, 200, 250), realista: metas(100, 450, 1100, 1500), otimista: metas(300, 1100, 2500, 3800) },
          kpis: [{ id: "clientes_pagos_total", nome: "Clientes pagos (acumulado)", tipo: "acumulado", metas: metas(1, 5, 10, 18) }, { id: "retainers_ativos", nome: "Retainers ativos", tipo: "acumulado", metas: metas(0, 2, 4, 7) }, { id: "propostas_semana", nome: "Propostas enviadas na semana", tipo: "semanal", metas: metas(15, 15, 10, 6) }],
          criterios_parada: [{ semana: 8, kpi: "clientes_pagos_total", minimo: 1, acao: "Sem cliente pago em 8 semanas: trocar de nicho (não de modelo)." }] },
        video: { trilho: "aquisição e ativo de longo prazo", status: "a iniciar", pasta: "02-canal-video", projecao_usd_semana: { pessimista: metas(0, 0, 0, 10), realista: metas(0, 0, 60, 200), otimista: metas(0, 30, 300, 1000) },
          kpis: [{ id: "inscritos", nome: "Inscritos no YouTube", tipo: "acumulado", metas: metas(50, 500, 1000, 3000) }, { id: "videos_longos", nome: "Vídeos longos publicados", tipo: "acumulado", metas: metas(3, 12, 25, 50) }], criterios_parada: [] },
        produtos: { trilho: "renda escalável", status: "a iniciar", pasta: "03-produtos-digitais", projecao_usd_semana: { pessimista: metas(0, 0, 0, 40), realista: metas(0, 10, 120, 500), otimista: metas(0, 80, 400, 900) },
          kpis: [{ id: "templates_publicados", nome: "Templates publicados", tipo: "acumulado", metas: metas(1, 3, 5, 8) }], criterios_parada: [] },
        cafe: { trilho: "produto físico", status: "a iniciar", pasta: "04-loja-cafe", projecao_usd_semana: { pessimista: metas(0, 0, -20, 0), realista: metas(0, 5, 140, 350), otimista: metas(0, 20, 500, 1000) },
          kpis: [{ id: "pedidos_semana", nome: "Pedidos na semana (ML + TikTok)", tipo: "acumulado", metas: metas(0, 5, 40, 100) }], criterios_parada: [] },
        tortas: { trilho: "produto físico (comida)", status: "preparação", pasta: "06-tortas-porto", projecao_usd_semana: { pessimista: metas(0, 7, 63, 155), realista: metas(0, 63, 229, 562), otimista: metas(0, 155, 525, 1265) },
          kpis: [{ id: "pedidos_semana", nome: "Pedidos na semana (Uber Eats + Glovo)", tipo: "semanal", metas: metas(0, 25, 70, 160) }], criterios_parada: [] },
        monitor: { trilho: "uso pessoal (fora dos trilhos de renda)", status: "em operação no VPS; Mac em leitura", pasta: "05-monitor-lives", projecao_usd_semana: null, kpis: [], criterios_parada: [] },
      },
      pendencias: [
        { projeto: "servicos", secao: "Semana 1: setup", texto: "Diogo: colar o perfil do Upwork, foto, verificação de identidade e método de saque; criar o Project Catalog \"MCP Server Sprint\".", feito: false, responsavel: "Diogo", data: null },
        { projeto: "servicos", secao: "Semana 1: setup", texto: "Gerar por IA o vídeo da demo 1 e colocar no portfólio do Upwork.", feito: false, responsavel: null, data: null },
        { projeto: "servicos", secao: "Semanas 2–4: prova", texto: "Enviar ~10 propostas/semana manualmente e abordar 20 negócios locais/semana.", feito: false, responsavel: null, data: null },
        { projeto: "servicos", secao: "Semana 1: setup", texto: "3 demos construídas: openapi-mcp, support-agent e leads-agent (26/10/2026).", feito: true, responsavel: null, data: "26/10/2026" },
        { projeto: "video", secao: "Semana 1: setup", texto: "Site vinculohq.com com Termos e Privacidade (exigência da revisão do app TikTok).", feito: false, responsavel: null, data: null },
        { projeto: "video", secao: "Semana 1: setup", texto: "Canal de marca Vínculo (@vinculohq) criado e autorizado (25/10/2026).", feito: true, responsavel: null, data: "25/10/2026" },
        { projeto: "cafe", secao: "Café: preparação para 11/01/2027", texto: "Diogo: enviar o pacote de cotação a 3 gráficas e anotar as respostas; decidir Enxuto × Completo.", feito: false, responsavel: "Diogo", data: null },
        { projeto: "cafe", secao: "Café: preparação para 11/01/2027", texto: "Herança: medir o consumo de gás/lenha por lote e pedir amostras de 300–500 g por perfil.", feito: false, responsavel: "Herança", data: null },
        { projeto: "cafe", secao: "Café: preparação para 11/01/2027", texto: "Logo Coroa de Grãos aprovado, arquivos finais gerados (25/10/2026).", feito: true, responsavel: null, data: "25/10/2026" },
        { projeto: "tortas", secao: "Loja de tortas no Porto", texto: "Esposa (com o Diogo): SIR na Câmara do Porto para declarar a casa compatível com fabrico de pastelaria.", feito: false, responsavel: "Esposa", data: null },
        { projeto: "tortas", secao: "Loja de tortas no Porto", texto: "Marca Tortaria Mineira (26/10/2026). Falta conferir INPI e @ no Instagram.", feito: true, responsavel: null, data: "26/10/2026" },
        { projeto: "monitor", secao: "Monitor de lives", texto: "Validar o modo consenso com lives reais: legibilidade dos prints, taxa de leituras úteis, custo por leitura.", feito: false, responsavel: null, data: null },
        { projeto: "global", secao: "Decisões pendentes", texto: "Contador em PT: abrir atividade (recibos verdes, IVA, Segurança Social).", feito: false, responsavel: null, data: null },
      ],
    },
    monitorMaquinas: ["tiktok", "youtube", "sites", "telegram", "agentes", "tradingview"]
      .concat(["youtube@bovespa"]).map((fonte) => ({ fonte, maquina: /^(tiktok|youtube|sites)/.test(fonte) ? "mac" : "vps",
        visto_em: new Date(agora - 6e4).toISOString() })),
    monitorFontes: [
      { fonte: "tiktok", ligado: true, vagas: "5 vagas", resumo: "1 gravando, 0 na fila, 1 em análise", atualizado_em: new Date(agora).toISOString() },
      { fonte: "telegram", ligado: true, vagas: "2 canais", resumo: "SureShotFX, SureShotFX Signals (FREE): 1 sinais abertos, leitura a cada 5 min", atualizado_em: new Date(agora - 2 * 6e4).toISOString(), ultima_execucao: new Date(agora - 2 * 6e4).toISOString(), proxima_execucao: new Date(agora + 3 * 6e4).toISOString(), intervalo_min: 5 },
      { fonte: "sites", ligado: true, vagas: "3 site(s)", resumo: "Foresignal: 1 sinal aberto em 2 pares", atualizado_em: new Date(agora).toISOString() },
      { fonte: "youtube@bovespa", ligado: true, vagas: "2 canais", resumo: "2 lives ao vivo, 1 em análise", atualizado_em: new Date(agora - 6e4).toISOString() },
      { fonte: "agentes", ligado: true, vagas: "5 ativos · cruzamento-medias", resumo: "1 sinal(is) aberto(s) · próxima rodada 10:30", atualizado_em: new Date(agora - 0.1 * h).toISOString(), ultima_execucao: new Date(agora - 0.1 * h).toISOString(), proxima_execucao: new Date(agora + 0.4 * h).toISOString(), intervalo_min: 30 },
    ],
    monitorItens: [
      { fonte: "youtube@bovespa", item: "canal.win", nome: "@canal.win", estado: "gravando", ativo: true, analisando: true, espectadores: 2882, desde: new Date(agora - 0.3 * h).toISOString(), chamadas_hoje: 1, detalhe: "WIN ao vivo", ultima_analise: new Date(agora - 0.05 * h).toISOString(), proxima_analise: new Date(agora + 0.05 * h).toISOString(), ciclo_fim: new Date(agora + 0.2 * h).toISOString() },
      { fonte: "youtube@bovespa", item: "canal.wdo", nome: "@canal.wdo", estado: "lido", ativo: false, analisando: false, espectadores: 2517, chamadas_hoje: 0, detalhe: "leitura 11:20: sem marcação legível", ultima_analise: new Date(agora - 0.1 * h).toISOString(), proxima_analise: new Date(agora + 0.2 * h).toISOString() },
      { fonte: "tiktok", item: "canal.fx", nome: "@canal.fx", estado: "gravando", ativo: true, analisando: true, espectadores: 87, desde: new Date(agora - 0.4 * h).toISOString(), chamadas_hoje: 2, detalhe: "XAUUSD ao vivo", ultima_analise: new Date(agora - 0.07 * h).toISOString(), proxima_analise: new Date(agora + 0.03 * h).toISOString(), ciclo_fim: new Date(agora + 0.2 * h).toISOString() },
      { fonte: "tiktok", item: "outro", nome: "@outro", estado: "offline", ativo: false, analisando: false, chamadas_hoje: 0 },
      { fonte: "tiktok", item: "canal.b", nome: "@canal.b", estado: "lido", ativo: false, analisando: false, espectadores: 120, chamadas_hoje: 0, detalhe: "leitura 18:52: XAUUSD compra 4010", ultima_analise: new Date(agora - 0.1 * h).toISOString(), proxima_analise: new Date(agora + 0.2 * h).toISOString(), ciclo_fim: new Date(agora + 0.22 * h).toISOString() },
      { fonte: "tiktok", item: "canal.c", nome: "@canal.c", estado: "fila", ativo: false, analisando: false, espectadores: 64, chamadas_hoje: 0 },
      { fonte: "sites", item: "foresignal:EURUSD", nome: "Foresignal · EUR/USD", estado: "aberto", ativo: true, analisando: false, desde: new Date(agora - 1 * h).toISOString(), chamadas_hoje: 1, detalhe: "compra · válido até 07:51" },
      { fonte: "telegram", item: "SureShotFX_Signals:XAUUSD", nome: "SureShotFX Signals (FREE) · XAUUSD", estado: "aberto", ativo: true, analisando: false, desde: new Date(agora - 0.2 * h).toISOString(), chamadas_hoje: 1, detalhe: "compra · vale até 14:36 UTC", ultima_analise: new Date(agora - 2 * 6e4).toISOString(), proxima_analise: new Date(agora + 3 * 6e4).toISOString() },
      { fonte: "telegram", item: "sureshot_fx:", nome: "SureShotFX · sem sinais", estado: "sem_sinal", ativo: false, analisando: false, chamadas_hoje: 0, detalhe: "nenhum sinal com SL e TP no período", ultima_analise: new Date(agora - 2 * 6e4).toISOString(), proxima_analise: new Date(agora + 3 * 6e4).toISOString() },
      { fonte: "sites", item: "foresignal:GBPUSD", nome: "Foresignal · GBP/USD", estado: "executado", ativo: false, analisando: false, chamadas_hoje: 1, detalhe: "+11 pips" },
      { fonte: "agentes", item: "GOLD", nome: "GOLD · XAUUSD", estado: "aberto", ativo: true, analisando: false, desde: new Date(agora - 0.5 * h).toISOString(), chamadas_hoje: 1, detalhe: "ATIVO 🟢 COMPRA · entrada 4010 · stop 4002 · alvos 4019.6 / 4026", ultima_analise: new Date(agora - 0.1 * h).toISOString(), proxima_analise: new Date(agora + 0.4 * h).toISOString() },
      { fonte: "agentes", item: "cruzamento-medias:US100", nome: "cruzamento-medias · US100 · NAS100", estado: "proximo", ativo: false, analisando: false, chamadas_hoje: 0, detalhe: "PRÓXIMO 🔴 VENDA: falta ADX 14 baixo/deitado (lateral); novo cruzamento ou ADX virar para cima", ultima_analise: new Date(agora - 0.1 * h).toISOString(), proxima_analise: new Date(agora + 0.4 * h).toISOString() },
      { fonte: "agentes", item: "CRUDEOIL", nome: "CRUDEOIL · USOIL", estado: "sem_sinal", ativo: false, analisando: false, chamadas_hoje: 0, detalhe: "SEM SINAL · lateral (ADX < 20) · ADX 15.2 · RSI 48 · fora da janela do ativo", ultima_analise: new Date(agora - 0.1 * h).toISOString(), proxima_analise: new Date(agora + 0.4 * h).toISOString() },
      { fonte: "agentes", item: "multi-tf-auto:GOLD", nome: "multi-tf-auto · GOLD · XAUUSD", estado: "proximo", ativo: false, analisando: false, chamadas_hoje: 0, detalhe: "self-learning v3 · em ajuste · PRÓXIMO · M5 tendência +0.12 · M15 tendência +0.41 · H1 tendência +0.62 · vela heikin_ashi", ultima_analise: new Date(agora - 0.1 * h).toISOString(), proxima_analise: new Date(agora + 0.9 * h).toISOString() },
    ],
    monitorComando: { tiktok: true, sites: true, agentes: true, tradingview: true, telegram: true, "youtube@bovespa": true },
    agentesPainel: demoAgentes(agora), selfLearning: true,
    termometro: demoTermometro(agora),
    consensoLigado: false,
    monitorOrdens: demoOrdens(agora),
    cotacoes: { atualizado_em: new Date(agora - 90e3).toISOString(), ativos: {
      XAUUSD: { preco: 4014.6, fonte: "capitalcom", em: new Date(agora - 90e3).toISOString() },
      EURUSD: { preco: 1.1158, fonte: "capitalcom", em: new Date(agora - 90e3).toISOString() },
      WIN: { preco: 130095, fonte: "mt5-clear", em: new Date(agora - 60e3).toISOString() } } },
    execucao: { selecao: { demo: { fontes: { tiktok: true }, unidades: { tiktok: { "@mogotrading_off": false } } }, real: { fontes: {}, unidades: {} } },
      corretora: "capitalcom",
      estado: { demo: { conectado: true, servidor: "Capital.com-Demo", moeda: "EUR", corretora: "Capital.com", abertas: 1, pendentes: 0, resultado_dia: 4.2, atualizado_em: new Date(agora - 20e3).toISOString(), lote: 0.01,
                      flutuante: { 5: { lucro: -1.8, preco: 4009.2 }, 7: { lucro: 3.4, preco: 4014.6 } } },
        real: { conectado: false, aviso: "faltam MT5_REAL_LOGIN, MT5_REAL_PASSWORD e MT5_REAL_SERVER no .env do monitor", atualizado_em: new Date(agora - 30e3).toISOString() } } },
    execucaoBovespa: { selecao: { demo: { fontes: { agentes: true } }, real: {} }, swing: {},
      estado: { demo: { conectado: true, servidor: "ClearInvestimentos-DEMO", moeda: "BRL", abertas: 0, pendentes: 0, resultado_dia: 0, atualizado_em: new Date(agora - 15e3).toISOString(),
                        corretora: "CLEAR", volumes: { WIN: 1, WDO: 1, acoes: 100 }, flutuante: { 9: { lucro: -12, preco: 130095 } }, day_trade: { ativos: ["WIN", "WDO"], ultima_entrada: "17:45", zerar_as: "18:15" } }, real: null } },
    loginFonte: { youtube: { estado: "sem_login", atualizado_em: new Date(agora - 2 * 6e4).toISOString(), novnc: "http://127.0.0.1:6081/vnc.html?path=websockify%3Ftoken%3Dlogin" } }, loginPedido: { youtube: false },
    categorias: { youtube: { "forex & crypto live": "robo", forexlia: "robo", "trader demo": "trader" } },
    ...{ loginFonte: { youtube: { estado: "sem_login", atualizado_em: new Date(agora - 2 * 6e4).toISOString(), novnc: "http://127.0.0.1:6081/vnc.html?path=websockify%3Ftoken%3Dlogin" },
                       tiktok: { estado: "sem_login", atualizado_em: new Date(agora - 60e3).toISOString(), canais: ["canal_demo1", "canal_demo2"],
                                 comando: "nativo parar tiktok; .venv\\Scripts\\python.exe -m monitor_lives.nativo login tiktok; feche a janela; Start-ScheduledTask monitor-tiktok" } } },
    monitorResultados: [
      ...demoResultados(agora),
      { fonte: "youtube@bovespa", sinal_id: 29, origem: "@canal.win", instrumento: "WIN", direcao: "compra", entrada: "129880", status: "alvo", resultado_r: 1.6, desde: new Date(agora - 5 * h).toISOString(), resolvido_em: new Date(agora - 4 * h).toISOString() },
      { fonte: "youtube@bovespa", sinal_id: 30, origem: "@canal.wdo", instrumento: "WDO", direcao: "venda", entrada: "5410", status: "stop", resultado_r: -1, desde: new Date(agora - 3 * h).toISOString(), resolvido_em: new Date(agora - 2 * h).toISOString(), situacao: "normal", atraso_min: 4 },
      // atraso da leitura (demonstração): um atrasado que bateu o stop e outro que bateu o alvo
      { fonte: "youtube@bovespa", sinal_id: 32, origem: "Sinal do canal @canal.wdo", instrumento: "WDO", direcao: "compra", entrada: "5752", stop: 5741, alvos: "5774", status: "stop", resultado_r: -1, desde: new Date(agora - 2.5 * h).toISOString(), resolvido_em: new Date(agora - 2 * h).toISOString(), situacao: "atrasado", atraso_min: 120, entrada_canal: 5706.5 },
      { fonte: "youtube@bovespa", sinal_id: 33, origem: "Sinal do canal @canal.win", instrumento: "WIN", direcao: "venda", entrada: "172265", stop: 172700, alvos: "171400", status: "alvo", resultado_r: 2, desde: new Date(agora - 1.5 * h).toISOString(), resolvido_em: new Date(agora - 1 * h).toISOString(), situacao: "atrasado", atraso_min: 35, entrada_canal: 172480 },
      { fonte: "tiktok", sinal_id: 5, origem: "Consenso de 3 canais", instrumento: "XAUUSD", direcao: "compra", entrada: "4010", status: "alvo", resultado_r: 1.8, desde: new Date(agora - 4.2 * h).toISOString(), resolvido_em: new Date(agora - 3 * h).toISOString() },
      { fonte: "tiktok", sinal_id: 4, origem: "@mogotrading_off", instrumento: "XAUUSD", direcao: "venda", entrada: "4031–4034", status: "alvo", resultado_r: 2.1, resolvido_em: new Date(agora - 2 * h).toISOString() },
      { fonte: "sites", sinal_id: 9, origem: "Foresignal", instrumento: "NZDUSD", direcao: "compra", entrada: "0.5682", status: "alvo", resultado_pontos: 12, resultado_unidade: "pips", resultado_fonte: "site", resolvido_em: new Date(agora - 1 * h).toISOString() },
      { fonte: "sites", sinal_id: 10, origem: "CryptET", instrumento: "ADAUSDT", direcao: "venda", entrada: "0.2052", status: "stop", resultado_pontos: -12, resultado_unidade: "pontos", resultado_fonte: "site", resolvido_em: new Date(agora - 3 * h).toISOString() },
      { fonte: "sites", sinal_id: 11, origem: "Foresignal", instrumento: "AUDUSD", direcao: "compra", entrada: "0.6512", status: "expirado", resultado_fonte: "site", resolvido_em: new Date(agora - 5 * h).toISOString() },
      { fonte: "tradingview", sinal_id: 21, origem: "📐 novo-a (Novo A)", instrumento: "XAUUSD", direcao: "compra", entrada: "3913.49", status: "alvo", resultado_r: 1.6, desde: new Date(agora - 9 * h).toISOString(), resolvido_em: new Date(agora - 7.5 * h).toISOString() },
      { fonte: "tradingview", sinal_id: 22, origem: "📐 novo-c (Novo C)", instrumento: "XAUUSD", direcao: "venda", entrada: "3950.2", status: "stop", resultado_r: -1, desde: new Date(agora - 6 * h).toISOString(), resolvido_em: new Date(agora - 5.2 * h).toISOString() },
      { fonte: "tradingview", sinal_id: 23, origem: "📐 novo-a (Novo A)", instrumento: "XAUUSD", direcao: "venda", entrada: "3960.8", status: "alvo", resultado_r: 2, desde: new Date(agora - 3 * h).toISOString(), resolvido_em: new Date(agora - 2.4 * h).toISOString() },
    ],
    monitorSinais: [
      { fonte: "youtube@bovespa", sinal_id: 31, item: "canal.win", origem: "Sinal do canal @canal.win", instrumento: "WIN", direcao: "compra", entrada: "130150", stop: 129950, alvos: "130350 / 130550", desde: new Date(agora - 0.2 * h).toISOString(), ate: new Date(agora + 23.8 * h).toISOString(), situacao: "normal", atraso_min: 6 },
      { fonte: "youtube@bovespa", sinal_id: 34, item: "canal.wdo", origem: "Sinal do canal @canal.wdo", instrumento: "WDO", direcao: "compra", entrada: "5752", stop: 5741, alvos: "5774", desde: new Date(agora - 0.1 * h).toISOString(), ate: new Date(agora + 0.4 * h).toISOString(), situacao: "atrasado", atraso_min: 125, entrada_canal: 5706.5 },
      { fonte: "tiktok", sinal_id: 1, item: "canal.fx", origem: "Sinal do canal @canal.fx", instrumento: "XAUUSD", direcao: "compra", entrada: "4010–4012", stop: 4000, alvos: "4030 / 4050", desde: new Date(agora - 0.3 * h).toISOString(), ate: new Date(agora + 23.7 * h).toISOString() },
      { fonte: "telegram", sinal_id: 5, item: "SureShotFX_Signals:XAUUSD", origem: "SureShotFX Signals (FREE)", instrumento: "XAUUSD", direcao: "compra", entrada: "3934–3944", stop: 3930, alvos: "3954 / 3964", desde: new Date(agora - 0.2 * h).toISOString(), ate: new Date(agora + 23.8 * h).toISOString() },
      { fonte: "sites", sinal_id: 2, item: "foresignal:EURUSD", origem: "Foresignal", instrumento: "EURUSD", direcao: "compra", entrada: "1.117", stop: 1.1149, alvos: "1.1187", desde: new Date(agora - 1 * h).toISOString(), ate: new Date(agora + 7 * h).toISOString() },
      { fonte: "tradingview", sinal_id: 1, item: "GOLD", origem: "📐 novo-a (Novo A)", instrumento: "XAUUSD", direcao: "compra", entrada: "3913.49", stop: 3901, alvos: "3938.5", condicoes: "Scalper Pro, layout Novo A", desde: new Date(agora - 20 * 60e3).toISOString(), ate: new Date(agora + 11 * 3600e3).toISOString() },
      { fonte: "agentes", sinal_id: 1, item: "GOLD", origem: "🤖 cruzamento-medias", instrumento: "XAUUSD", direcao: "compra", entrada: "4010", stop: 4002, alvos: "4019.6 / 4026", condicoes: "EMA 9/21 cruzou no M15 (confirmação); H1 a favor; ADX 24; RSI 55", desde: new Date(agora - 0.5 * h).toISOString(), ate: new Date(agora + 11.5 * h).toISOString() },
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
    async comandarMonitor(fontes, ligar) {
      fontes.forEach((f) => {
        s.monitorComando[f] = ligar;
        const info = s.monitorFontes.find((x) => x.fonte === f);
        if (info) { info.ligado = ligar; info.resumo = ligar ? "voltando a checar" : "desligado pelo dashboard"; }
      });
    },
    async comandarSelfLearning(ligar) { s.selfLearning = ligar; s.agentesPainel.self_learning.ligado = ligar; },
    async comandarConsenso(ligar) { s.consensoLigado = ligar; },
    async comandarAudio(fonteCtx, ligar) { s.audio = { ...(s.audio ?? {}), [fonteCtx]: ligar }; },
    async comandarExecucao(modo, selecao, suf = "") { (suf ? s.execucaoBovespa : s.execucao).selecao[modo] = selecao; },
    async comandarSwing(suf, mapa) { s.execucaoBovespa.swing = mapa; },
    async pedirLogin(f) { s.loginFonte[f] = { ...s.loginFonte[f], estado: "aguardando", atualizado_em: new Date().toISOString() }; },
    async pedirTroca(maquina) { s.maquinasPedido = { operar: maquina, em: new Date().toISOString() }; },
    async comandarPrioridade(modo) { s.prioridade = modo; },
    async comandarCorretora(id) { s.execucao.corretora = id; },
    aoMudar() {},
  };
}

// resultados de exemplo para as páginas #/tiktok, #/youtube e #/sites (modo demonstração): 30 dias de sinais resolvidos
// ordens de exemplo da ponte do MT5 (modo demonstração): demo do TikTok; nada no real
function demoOrdens(agora) {
  const h = 3600e3, t = (x) => new Date(agora - x * h).toISOString();
  const o = (id, unidade, direcao, ex, sa, st, alvo, res, desfecho, x) => ({ id, modo: "demo", fonte: "tiktok", sinal_id: 100 + id, pagina: "tiktok", unidade, origem: unidade,
    instrumento: "XAUUSD", simbolo: "GOLD", direcao, tipo: "mercado", volume: 0.01, stop: st, alvo, preco_pedido: ex, preco_execucao: ex, preco_saida: sa, ticket: 5000 + id, posicao: 5000 + id,
    status: sa == null ? "aberta" : "fechada", resultado: res, moeda: "EUR", corretora: "Capital.com", desfecho, sinal_desde: t(x + 0.1), aberto_em: t(x), fechado_em: sa == null ? null : t(x - 0.8), criado_em: t(x + 0.1) });
  return [
    o(1, "@canal.fx", "compra", 4010.4, 4030, 4000, 4030, 19.1, "tp", 20),
    o(2, "@canal.fx", "venda", 4041.2, 4049, 4049, 4025, -8.1, "sl", 14),
    o(3, "@canal.fx", "compra", 4012.6, 4031, 4004, 4031, 18.0, "tp", 6),
    o(4, "@mogotrading_off", "venda", 4033.1, 4021, 4041, 4021, 11.7, "tp", 9),
    o(5, "@canal.fx", "compra", 4011.0, null, 4000, 4030, null, null, 0.3),
    { ...o(6, "@canal.fx", "compra", null, null, 4000, 4030, null, null, 2), status: "recusada", motivo: "perda no stop 52.00 acima do limite 50", ticket: null, preco_execucao: null },
    // ordens dos sinais ativos da demonstração: executada com lucro (TikTok), aguardando (agentes) e a da Bovespa
    { ...o(7, "@canal.fx", "compra", 4011.2, null, 4000, 4030, null, null, 0.25), sinal_id: 1 },
    { ...o(8, "cruzamento-medias", "compra", null, null, 4002, 4019.6, null, null, 0.45), fonte: "agentes", pagina: "agentes", sinal_id: 1, status: "pendente", preco_execucao: null, posicao: null },
    { ...o(9, "@canal.win", "compra", 130155, null, 129950, 130350, null, null, 0.15), fonte: "youtube@bovespa", pagina: "youtube", sinal_id: 31, instrumento: "WIN", simbolo: "WINZ26", volume: 1, moeda: "BRL", corretora: "CLEAR" },
  ];
}

function demoResultados(agora) {
  const h = 36e5;
  let semente = 11;
  const rnd = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
  const universo = [
    ["tiktok", "Sinal do canal @canal.fx", ["XAUUSD", "US30"], 0.18], ["tiktok", "Sinal do canal @mogotrading_off", ["XAUUSD"], -0.08],
    ["tiktok", "Sinal do canal @rayyy.fx", ["XAUUSD", "NAS100"], 0.05], ["youtube", "Sinal do canal ▶️ forex & crypto live", ["XAUUSD", "EURUSD"], 0.1],
    ["youtube", "Sinal do canal ▶️ forexlia", ["XAUUSD", "GBPUSD"], -0.15], ["youtube", "Sinal do canal ▶️ trader demo", ["XAUUSD"], 0.12], ["tiktok", "Consenso de 3 canais", ["XAUUSD"], 0.2],
    ["sites", "Foresignal", ["EURUSD", "GBPUSD", "USDJPY"], 0.12], ["sites", "CryptET", ["ETHUSDT", "ADAUSDT"], -0.05], ["sites", "SureShotFX", ["XAUUSD", "GBPJPY"], 0], ["telegram", "SureShotFX", ["XAUUSD", "GBPJPY"], 0.05],
  ];
  const linhas = [];
  let id = 100;
  universo.forEach(([fonte, origem, ativos, vies]) => {
    const n = 8 + Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) {
      const desde = agora - (i * 30 + rnd() * 20) * h, sorte = rnd(), venda = rnd() > 0.5;
      const status = sorte < 0.45 + vies ? "alvo" : sorte < 0.9 ? "stop" : "expirado";
      const r = status === "alvo" ? Math.round((1 + rnd() * 1.5) * 100) / 100 : status === "stop" ? -1 : Math.round((rnd() - 0.5) * 80) / 100;
      const site = fonte === "sites" && status !== "expirado";
      linhas.push({ fonte, sinal_id: id++, origem, instrumento: ativos[i % ativos.length], direcao: venda ? "venda" : "compra", entrada: "1.1000", stop: venda ? 1.101 : 1.099,
        alvos: venda ? "1.0985" : "1.1015", status, resultado_r: site ? undefined : r, resultado_pontos: site ? (status === "alvo" ? 15 : -10) : undefined,
        resultado_unidade: site ? "pips" : undefined, resultado_fonte: site ? "site" : "precos", desde: new Date(desde).toISOString(), resolvido_em: new Date(desde + (1 + rnd() * 10) * h).toISOString() });
    }
  });
  return linhas;
}

// dados de exemplo do termômetro (modo demonstração): mesma forma do controle.termometro:painel
function demoTermometro(agora) {
  const tf = (h1, m15, m5, rh1, rm15, adx) => ({ h1: { pontuacao: h1, regime: rh1, adx }, m15: { pontuacao: m15, regime: rm15, adx: adx - 3 }, m5: { pontuacao: m5, regime: "lateral", adx: 14 } });
  const it = (nome, v, regime = false, implica) => ({ nome, variacao_pct: v, regime, ...(implica ? { implica } : {}) });
  return {
    atualizado_em: new Date(agora - 6 * 6e4).toISOString(), mercado: "aberto", cotacoes: "tradingview", sentimento: "capital.com",
    ativos: [
      { id: "GOLD", nome: "Ouro", preco: 3927.1, variacao_dia_pct: -0.49, d1: -0.49, idade_min: 7, corretora: { estado: "TRADEABLE", spread: 0.5, spread_normal: 0.5, spread_x: 1, spread_alto: false, margem_pct: 5, tamanho_minimo: 0.01 }, fonte_velas: "capital.com", dia_faixa: { maxima: 3962.4, minima: 3901.1, vwap: 3931.2, preco: 3927.1, barras: 214, sessao: "atual" }, direcao: "baixa", forca: "forte", confirmacao: "H1 e M15",
        tf: tf(-0.72, -0.64, -0.2, "tendencia", "tendencia", 31), divergencia: false, sentimento: { compra: 78.5, venda: 21.5, leitura: "maioria comprada" },
        alinhamento: { a_favor: [it("US10Y", 0.85), it("SILVER", -1.86)], contra: [], parado: [it("DXY", 0.04), it("EURUSD", -0.04)], sem_leitura: [] },
        motivo: "Baixa forte · H1 e M15 · em tendência. A favor: US10Y +0,9%, SILVER −1,9%." },
      { id: "SILVER", nome: "Prata", preco: 49.71, variacao_dia_pct: -1.86, d1: -0.44, idade_min: 7, corretora: { estado: "TRADEABLE", spread: 0.05, margem_pct: 10, tamanho_minimo: 1 }, fonte_velas: "capital.com", dia_faixa: { maxima: 51.3, minima: 48.9, vwap: 50.2, preco: 49.71, barras: 214, sessao: "atual" }, direcao: "baixa", forca: "", confirmacao: "H1 e M15",
        tf: tf(-0.41, -0.35, -0.1, "tendencia", "lateral", 45), divergencia: false, sentimento: { compra: 91.9, venda: 8.1, leitura: "maioria comprada" },
        alinhamento: { a_favor: [it("GOLD", -0.49), it("COPPER", -2.6), it("US10Y", 0.85)], contra: [], parado: [it("DXY", 0.04)], sem_leitura: [] },
        motivo: "Baixa · H1 e M15 · em tendência. A favor: GOLD −0,5%, COPPER −2,6%, US10Y +0,9%." },
      { id: "CRUDEOIL", nome: "Petróleo WTI", preco: 95.87, variacao_dia_pct: -0.53, d1: 0, idade_min: 7, corretora: { estado: "TRADEABLE", spread: 0.04, margem_pct: 10, tamanho_minimo: 1 }, fonte_velas: "capital.com", dia_faixa: { maxima: 97.4, minima: 94.6, vwap: 96.1, preco: 95.87, barras: 214, sessao: "atual" }, direcao: "neutra", forca: "", confirmacao: "",
        tf: tf(0.12, -0.18, 0.05, "lateral", "lateral", 19), divergencia: false, sentimento: { compra: 52.0, venda: 48.0, leitura: "equilibrado" },
        alinhamento: { a_favor: [], contra: [it("BRENT", -1.3), it("US500", 0.3, true)], parado: [], sem_leitura: [] },
        motivo: "Sem direção clara · lateral. Direcionadores pedem queda: BRENT −1,3%, US500 +0,3% (regime 2025–26)." },
      { id: "US30", nome: "US30 (Dow Jones)", preco: 51742, variacao_dia_pct: -0.48, d1: -0.42, idade_min: 7, corretora: { estado: "TRADEABLE", spread: 10, spread_normal: 2, spread_x: 5, spread_alto: true, margem_pct: 5, tamanho_minimo: 0.001 }, fonte_velas: "capital.com", dia_faixa: { maxima: 52010.0, minima: 51480.0, vwap: 51790.5, preco: 51742.0, barras: 214, sessao: "atual" }, direcao: "baixa", forca: "", confirmacao: "só H1 (M15 não confirma)",
        tf: tf(-0.47, -0.12, 0.1, "tendencia", "lateral", 27), divergencia: true, sentimento: null,
        alinhamento: { a_favor: [it("US10Y", 0.85, true)], contra: [it("VIX", -2.2), it("US500", 0.3)], parado: [], sem_leitura: [it("CRUDEOIL")] },
        motivo: "Baixa · só H1 (M15 não confirma) · em tendência. A favor: US10Y +0,9% (regime 2025–26). Contra: VIX −2,2%, US500 +0,3%." },
      { id: "US100", nome: "US100 (Nasdaq)", preco: null, variacao_dia_pct: null, d1: null, direcao: null, alinhamento: null, divergencia: false, sentimento: null,
        motivo: "Sem dados: poucas velas em H1" },
    ],
  };
}

// dados de exemplo da página #/agentes (modo demonstração): mesma forma do controle.agentes:painel
function demoAgentes(agora) {
  const h = 36e5;
  let semente = 7;
  const rnd = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
  const met = (usds) => {
    const g = usds.filter((x) => x > 0).reduce((s, x) => s + x, 0), p = -usds.filter((x) => x < 0).reduce((s, x) => s + x, 0);
    let pico = 0, saldo = 0, dd = 0;
    usds.forEach((x) => { saldo += x; pico = Math.max(pico, saldo); dd = Math.max(dd, pico - saldo); });
    return { ops: usds.length, lucro_usd: Math.round(saldo * 100) / 100, acerto_pct: usds.length ? Math.round((1000 * usds.filter((x) => x > 0).length) / usds.length) / 10 : null,
             fator_lucro: p ? Math.round((100 * g) / p) / 100 : null, r_total: Math.round(usds.reduce((s, x) => s + x / 12, 0) * 100) / 100, drawdown_usd: Math.round(dd * 100) / 100 };
  };
  const agente = (id, tipo, metodo, ativos, tfs, n, vies, extra = {}) => {
    const ops = Array.from({ length: n }, (_, i) => ({ t: agora - (n - i) * 5 * h, ativo: ativos[i % ativos.length], lado: rnd() > 0.45 ? "compra" : "venda",
      hora: Math.floor(rnd() * 14) + 6, usd: Math.round(((rnd() - 0.5 + vies) * 30) * 100) / 100 }));
    ops.forEach((o) => { o.status = o.usd > 0 ? "alvo" : rnd() > 0.3 ? "stop" : "expirado"; });
    let saldo = 0;
    const grupo = (k) => Object.fromEntries([...new Set(ops.map(k))].map((v) => [v, met(ops.filter((o) => k(o) === v).map((o) => o.usd))]));
    return { id, tipo, metodo, ligado: true, ativos, timeframes: tfs, self_learning: false, por_ativo_versao: false, revisao_ia: false,
      ultima_execucao: new Date(agora - 0.4 * h).toISOString(), proxima_execucao: new Date(agora + 0.6 * h).toISOString(),
      metricas: met(ops.map((o) => o.usd)), curva: ops.map((o) => [new Date(o.t).toISOString(), Math.round((saldo += o.usd) * 100) / 100]),
      por_ativo: ativos.map((a) => ({ ativo: a, metricas: met(ops.filter((o) => o.ativo === a).map((o) => o.usd)), status: ["SEM SINAL", "PRÓXIMO", "ATIVO"][Math.floor(rnd() * 3)],
        texto: "SEM SINAL · H1 tendência +0.41 · M15 lateral +0.08", auto: null, backtest: null })),
      por_hora: grupo((o) => o.hora), por_lado: grupo((o) => o.lado), desfechos: grupo((o) => o.status), vetos: null, ciclos: [], trocas: [],
      pontos_fracos: [], pontos_fortes: [], ...extra };
  };
  const cm = agente("cruzamento-medias", "skill", "EMA 9/21 + filtro H1", ["US30", "US100", "GOLD", "SILVER", "CRUDEOIL"], ["M15"], 26, 0.04);
  cm.pontos_fracos = ["Perde em CRUDEOIL: US$ −18,40 em 5 operações.", "Pior horário: 13h UTC (US$ −22,10 em 4 operações)."];
  cm.pontos_fortes = ["Melhor ativo: GOLD, US$ +41,20 em 6 operações.", "Fator de lucro 1,4: ganha 1,4× o que perde."];
  const gk = agente("gk-sniper", "gk_sniper", "GK Sniper: ZLEMA 9/25, EMA 200, 1 print por tendência", ["GOLD"], ["M15", "H1"], 9, -0.06);
  gk.pontos_fracos = ["Amostra pequena (9 operações resolvidas): nada conclusivo ainda.", "As vendas perdem enquanto as compras ganham: o lado importa neste agente."];
  const mt = agente("multi-tf-auto", "multi_tf", "regime + indicadores H1/M15/M5, self-learning por ativo", ["US30", "US100", "GOLD", "SILVER", "CRUDEOIL"], ["M5", "M15", "H1"], 14, 0.08,
    { self_learning: true, por_ativo_versao: true, revisao_ia: true, vetos: { ops: 5, lucro_usd: -21.4, acerto_pct: 20, fator_lucro: 0.3, r_total: -2, drawdown_usd: 25 } });
  const estados = { US30: ["em ajuste", 0, -3.44, 8], US100: ["satisfeito", 1, 7.14, 14], GOLD: ["em ajuste", 0, -18.83, 11], SILVER: ["satisfeito", 2, 161.72, 10], CRUDEOIL: ["satisfeito", 0, 31.27, 4] };
  mt.por_ativo.forEach((x) => { const [e, v, l, n] = estados[x.ativo]; x.auto = { versao: v, estado: e }; x.backtest = { ops: n, lucro_usd: l }; });
  mt.trocas = [{ ativo: "SILVER", em: new Date(agora - 40 * h).toISOString(), versao: 2 }];
  mt.ciclos = [
    { ativo: "SILVER", em: new Date(agora - 40 * h).toISOString(), motivo: "20 operações desde o último ciclo", estado: "satisfeito", versao: 2, validacao_atual: { ops: 10, lucro_usd: 98.2 }, validacao_nova: { ops: 10, lucro_usd: 161.72 } },
    { ativo: "GOLD", em: new Date(agora - 40 * h).toISOString(), motivo: "3.0 dias desde o último ciclo", estado: "em ajuste", versao: null, validacao_atual: { ops: 11, lucro_usd: -18.83 }, validacao_nova: null },
  ];
  mt.pontos_fracos = ["Self-learning em ajuste em GOLD: a versão atual não lucra fora da amostra.", "Self-learning em ajuste em US30: a versão atual não lucra fora da amostra."];
  mt.pontos_fortes = ["Os vetos da IA pouparam US$ 21,40 em 5 sinais.", "Melhor ativo: SILVER, US$ +38,10 em 3 operações."];
  return { atualizado_em: new Date(agora - 0.05 * h).toISOString(), lote: 0.01, contratos: "tamanhos da folha MT5 da Capital.com (30/10/2026); spread real da API da Capital.com (03/11/2026)",
    self_learning: { ligado: true, ultimo: new Date(agora - 2 * h).toISOString(), proximo: new Date(agora + 4 * h).toISOString(), cada_h: 6 },
    agentes: [cm, gk, mt] };
}


// ---------- rotas ----------

// Rotas do monitor levam o contexto no prefixo (#/bovespa/youtube, #/todos/comparar). Sem prefixo vale o último contexto
// escolhido (lembrado no navegador), então os links antigos e os de dentro das telas seguem no contexto em que o Diogo está.
function rotaAtual() {
  let h = location.hash;
  const mc = h.match(/^#\/(forex|bovespa|todos)(?=[/?]|$)/);
  if (mc) { h = "#" + h.slice(mc[0].length); if (mc[1] !== ctxLembrado) lembrarContexto(mc[1]); }
  const ctx = mc ? mc[1] : ctxLembrado;
  const doMonitor = (r) => ({ ...r, ctx: ctx === "todos" ? "forex" : ctx });
  if (mc?.[1] === "todos" || h.startsWith("#/comparar"))
    return { tipo: "comparar", ctx: "todos", visao: new URLSearchParams(h.split("?")[1] ?? "").get("v") === "efetiva" ? "efetiva" : "teorica" };
  if (mc && (h === "#" || h.startsWith("#?"))) return doMonitor({ tipo: "monitor" });
  const m = h.match(/^#\/p\/(\w+)/);
  if (m && PROJETOS[m[1]]) return m[1] === "monitor" ? doMonitor({ tipo: "monitor" }) : { tipo: "projeto", id: m[1], ctx: "forex" };
  if (h.startsWith("#/monitor")) return doMonitor({ tipo: "monitor" });
  if (h.startsWith("#/termometro")) return doMonitor({ tipo: "termometro" });
  const an = h.match(/^#\/(consolidado|agentes|tiktok|youtube|sites|tradingview|telegram)(?:\/([^/?]+))?/);
  if (an) {
    const q = new URLSearchParams(h.split("?")[1] ?? ""), m = q.get("m");
    return doMonitor({ tipo: "analise", fonte: an[1], id: an[2] ? decodeURIComponent(an[2]) : undefined, modo: MODOS_VALIDOS.has(m) ? m : "todos",
      conta: q.get("c") === "real" || m === "real" ? "real" : "demo" });
  }
  return { tipo: "geral", ctx: "forex" };
}
const chaveRota = (r) => r.tipo + (r.ctx ?? "") + (r.fonte ?? "") + (r.id ?? "") + (r.modo ?? "") + (r.conta ?? "") + (r.visao ?? "");

// ---------- componentes ----------

let fonte, estado, estadoBruto = null, ajustando = null, erro = "", filtroEventos = "", rotaRenderizada = null;

function htmlBadge(cls, texto, icone) {
  return `<span class="badge ${cls}">${icone ? ico(icone) : ""}${esc(texto)}</span>`;
}
const ICONE_STATUS = { good: "check", warning: "alert", critical: "x", muted: "clock" };
const badgeStatus = (st) => st ? htmlBadge(st.cls, st.rotulo, ICONE_STATUS[st.cls]) : "";

// barra-bala: valor contra meta, com a faixa pessimista–otimista ao fundo (texto sempre ao lado: a cor é apoio)
function htmlBala({ valor, meta, min = 0, max, corCss, esq, dir, rotuloMeta = "meta" }) {
  const topo = Math.max(max ?? 0, meta ?? 0, valor ?? 0, 1) * 1.08;
  const pct = (v) => `${Math.max(0, Math.min(100, (100 * (v ?? 0)) / topo)).toFixed(1)}%`;
  const faixa = max !== undefined && max > 0 ? `<i class="faixa-cenarios" style="left:${pct(Math.max(0, min))};width:calc(${pct(max)} - ${pct(Math.max(0, min))})"></i>` : "";
  return `<div class="bala" style="--cor:${corCss}">
    <div class="rotulos"><span>${esq}</span><span>${dir}</span></div>
    <div class="trilho" aria-hidden="true">${faixa}<i class="barra" style="width:${pct(valor)}"></i>${meta !== undefined && meta !== null ? `<i class="marca" style="left:${pct(meta)}" title="${esc(rotuloMeta)}"></i>` : ""}</div>
  </div>`;
}

function htmlImpacto(n) {
  return `<span class="impacto" title="impacto ${n}/5" aria-label="impacto ${n} de 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
}

function htmlDecisao(d) {
  const p = prazoRelativo(d.prazo);
  const formAjuste = ajustando === d.id ? `
    <label for="aj-${d.id}">O que ajustar?</label>
    <textarea id="aj-${d.id}" placeholder="Ex.: subir para US$ 2.800 e incluir testes"></textarea>
    <div class="acoes">
      <button class="btn primario" data-acao="confirmar-ajuste" data-id="${d.id}">${ico("check")} Confirmar ajuste</button>
      <button class="btn" data-acao="cancelar-ajuste">Cancelar</button>
    </div>` : `
    <div class="acoes">
      <button class="btn primario" data-acao="aprovada" data-id="${d.id}">${ico("check")} Aprovar</button>
      <button class="btn" data-acao="ajustar" data-id="${d.id}">Ajustar</button>
      <button class="btn perigo" data-acao="descartada" data-id="${d.id}">${ico("x")} Descartar</button>
    </div>`;
  return `<article class="decisao" data-decisao="${d.id}">
    <div class="meta"><span class="chip"><i class="ponto" style="background:${cor(d.projeto_id)}"></i>${esc(nomeProj(d.projeto_id))}</span><span>${esc(d.agente)}</span>
      ${htmlImpacto(d.impacto)}<span class="badge ${p.cls}">${ico("clock")}prazo ${p.texto}</span><span>#${d.id}</span></div>
    <div class="titulo">${esc(d.titulo)}</div>
    ${d.contexto ? `<div>${esc(d.contexto)}</div>` : ""}
    ${d.recomendacao ? `<div class="reco">${ico("bulb")}<span><b>Recomendação:</b> ${esc(d.recomendacao)}</span></div>` : ""}
    <div class="meta">Sem resposta até o prazo: ${esc(d.padrao_sem_resposta)}</div>
    ${formAjuste}
  </article>`;
}

function htmlSecaoDecisoes(pendentes, resolvidas, titulo = "Decisões pendentes") {
  return `<section class="painel" aria-labelledby="h-decisoes">
    <h2 id="h-decisoes">${ico("inbox")} ${titulo} <span class="count ${pendentes.length ? "alerta" : ""}">${pendentes.length}</span></h2>
    ${pendentes.length ? pendentes.map(htmlDecisao).join("") : `<p class="vazio">Nada esperando por você.</p>`}
    <details><summary>${ico("chevron")}Últimas resolvidas <span class="count">${resolvidas.length}</span></summary>
      <ul class="lista">${resolvidas.map((d) => `<li>#${d.id} ${esc(d.titulo)}<div class="meta"><span class="chip"><i class="ponto" style="background:${cor(d.projeto_id)}"></i>${esc(nomeProj(d.projeto_id))}</span>${esc(RESULTADO[d.status] ?? d.status)} via ${esc(d.decidido_por)} · ${quando(d.decidido_em)}${d.resposta ? ` · “${esc(d.resposta)}”` : ""}</div></li>`).join("") || `<li class="vazio">Nenhuma ainda.</li>`}</ul>
    </details>
  </section>`;
}

function htmlFormInstrucao(projetoFixo) {
  const opcoes = Object.entries(PROJETOS).map(([k, v]) => `<option value="${k}" ${k === projetoFixo ? "selected" : ""}>${esc(v.nome)}</option>`).join("");
  return `<form id="form-instrucao">
    <label for="inst-projeto">Para</label>
    <select id="inst-projeto"><option value="">Todos os projetos</option>${opcoes}</select>
    <label for="inst-texto" style="margin-top:8px">Instrução ou input</label>
    <textarea id="inst-texto" required placeholder="Ex.: esta semana, foco total em fechar o 1º cliente"></textarea>
    <div class="acoes"><button class="btn primario" type="submit">${ico("send")} Enviar aos agentes</button></div>
  </form>`;
}

function htmlInstrucoes(lista) {
  return `<ul class="lista" style="margin-top:12px">${lista.map((i) => `<li>${esc(i.texto)}<div class="meta"><span class="chip"><i class="ponto" style="background:${cor(i.projeto_id)}"></i>${esc(nomeProj(i.projeto_id))}</span>${esc(i.status)} · via ${esc(i.origem)} · ${quando(i.criado_em)}${i.resultado ? ` · ${esc(i.resultado)}` : ""}</div></li>`).join("") || `<li class="vazio">Nenhuma instrução ainda.</li>`}</ul>`;
}

function htmlEventos(eventos, { filtros = false } = {}) {
  const lista = filtros && filtroEventos ? eventos.filter((v) => (v.projeto_id ?? "global") === filtroEventos) : eventos;
  const chips = filtros ? `<div class="filtros" role="group" aria-label="Filtrar por projeto">
      ${[["", "Todos"], ...Object.entries(PROJETOS).map(([k, v]) => [k, v.nome]), ["global", "Global"]].map(([k, n]) =>
        `<button class="btn" data-acao="filtro-eventos" data-projeto="${k}" aria-pressed="${filtroEventos === k}">${n}</button>`).join("")}
    </div>` : "";
  const cls = (t) => t === "alerta" || t === "erro" ? "critical" : t === "aprendizado" ? "warning" : "muted";
  return `${chips}<div>${lista.slice(0, 40).map((v) => `<div class="evento"><i class="ponto" style="--cor:${cor(v.projeto_id)}"></i>
    <div><span class="badge ${cls(v.tipo)}">${esc(TIPO_EVENTO[v.tipo] ?? v.tipo)}</span> ${esc(v.titulo)}
      <div class="meta"><span class="chip">${esc(nomeProj(v.projeto_id))}</span>${esc(v.agente)}${v.nivel ? ` · ${esc(v.nivel)}` : ""} · ${quando(v.criado_em)}</div></div></div>`).join("") || `<p class="vazio">Sem atividade ainda.</p>`}</div>`;
}

function htmlPendencias(c, { compacto = false } = {}) {
  if (!estado.painel) return `<div class="aviso neutro">${ico("list")}<span>Pendências ainda não sincronizadas. No Mac: <code>python3 00-central-comando/cliente/sincronizar_painel.py</code></span></div>`;
  if (!c.pend.length) return `<p class="vazio">Nenhuma pendência registrada no todo.md para este projeto.</p>`;
  const item = (p) => `<div class="pend ${p.feito ? "feita" : ""}">
      <span class="chk" aria-hidden="true">${p.feito ? ico("check") : ""}</span>
      <div><div class="texto">${esc(p.texto)}</div>
        ${(p.responsavel || p.data) ? `<div class="meta">${p.responsavel ? `<span class="resp">${esc(p.responsavel)}</span>` : ""}${p.data ? `<span>${esc(p.data)}</span>` : ""}</div>` : ""}</div>
    </div>`;
  const grupos = {};
  c.abertas.forEach((p) => (grupos[p.secao] ??= []).push(p));
  const total = c.pend.length, pct = total ? Math.round((100 * c.feitas.length) / total) : 0;
  const umGrupo = Object.keys(grupos).length === 1;  // um grupo só: o h3 repetiria o título do bloco
  return `<div class="meta" style="margin-bottom:8px"><span><b class="num">${c.abertas.length}</b> abertas</span><span><b class="num">${c.feitas.length}</b> feitas</span><span>${pct}% concluído</span><span style="margin-left:auto">todo.md · ${haQuanto(estado.painel.gerado_em)}</span></div>
    <div class="progresso" aria-hidden="true" style="--cor:${cor(c.id)}"><i style="width:${pct}%"></i></div>
    <div style="margin-top:6px">${Object.entries(grupos).map(([secao, itens]) => `<div class="pend-grupo">${compacto && umGrupo ? "" : `<h3>${esc(secao)}</h3>`}${(compacto ? itens.slice(0, 5) : itens).map(item).join("")}${compacto && itens.length > 5 ? `<p class="meta" style="padding:6px 0 0 28px">+ ${itens.length - 5} nesta seção</p>` : ""}</div>`).join("") || `<p class="vazio">Tudo feito por aqui.</p>`}</div>
    ${c.feitas.length ? `<details><summary>${ico("chevron")}Feitas <span class="count">${c.feitas.length}</span></summary>${c.feitas.map(item).join("")}</details>` : ""}`;
}

// gráfico de linha: realizado por semana contra os 3 cenários até o mês 12
function svgProjecao(c) {
  const proj = c.cfg.projecao_usd_semana;
  if (!proj) return "";
  const estreito = innerWidth < 560;
  const W = estreito ? 360 : 640, H = estreito ? 200 : 230, L = estreito ? 40 : 46, R = 14, T = 14, B = 30, w = W - L - R, h = H - T - B, fim = 52;
  const linhas = Object.fromEntries(Object.entries(proj).map(([k, v]) => [k, pontos(v, c.marcos, 0)]));
  const todos = [...Object.values(linhas).flat().map((p) => p[1]), ...c.serie];
  let yMin = Math.min(0, ...todos), yMax = Math.max(1, ...todos);
  yMax *= 1.08; if (yMin < 0) yMin *= 1.15;
  const x = (s) => L + (w * s) / fim, y = (v) => T + h - (h * (v - yMin)) / (yMax - yMin);
  const caminho = (pts) => pts.map(([s, v], i) => `${i ? "L" : "M"}${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const banda = `${caminho(linhas.otimista)} ${linhas.pessimista.slice().reverse().map(([s, v]) => `L${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} Z`;
  const real = c.serie.map((v, i) => [i + 1, v]);
  const passo = (yMax - yMin) / 4, ticks = [0, 1, 2, 3, 4].map((i) => yMin + passo * i);
  const marcos = Object.entries(c.marcos).sort((a, b) => a[1] - b[1]);
  const ultimo = real[real.length - 1];
  const descricao = `Lucro semanal realizado contra a projeção. Semana ${c.semAtual}: realizado ${usd(ultimo?.[1] ?? 0)}, realista ${usd(c.proj.realista)}.`;
  return `<div class="grafico" style="--cor:${cor(c.id)}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(descricao)}"><title>${esc(descricao)}</title>
      ${ticks.map((t) => `<line class="grade" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${usdCurto(t)}</text>`).join("")}
      <line class="eixo" x1="${L}" x2="${W - R}" y1="${y(Math.max(0, yMin)).toFixed(1)}" y2="${y(Math.max(0, yMin)).toFixed(1)}"/>
      ${marcos.map(([m, s]) => `<text class="marco" x="${x(s).toFixed(1)}" y="${H - 8}" text-anchor="${s === fim ? "end" : "middle"}">${estreito ? m : `${m} · sem. ${s}`}</text>`).join("")}
      <path class="banda" d="${banda}"/>
      <path class="linha-limite" d="${caminho(linhas.otimista)}"/>
      <path class="linha-limite" d="${caminho(linhas.pessimista)}"/>
      <path class="linha-realista" d="${caminho(linhas.realista)}"/>
      <line class="hoje" x1="${x(c.semAtual).toFixed(1)}" x2="${x(c.semAtual).toFixed(1)}" y1="${T}" y2="${T + h}"/>
      <text x="${(x(c.semAtual) + 4).toFixed(1)}" y="${T + 10}">sem. ${c.semAtual}</text>
      ${real.length > 1 ? `<path class="linha-real" pathLength="1" d="${caminho(real)}"/>` : ""}
      ${ultimo ? `<circle class="ponto-real" cx="${x(ultimo[0]).toFixed(1)}" cy="${y(ultimo[1]).toFixed(1)}" r="4"/>` : ""}
    </svg>
    <div class="legenda">
      <span><svg viewBox="0 0 22 10"><line x1="1" x2="21" y1="5" y2="5" stroke="${cor(c.id)}" stroke-width="2.5" stroke-linecap="round"/></svg>realizado (US$/semana)</span>
      <span><svg viewBox="0 0 22 10"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="5 4"/></svg>realista</span>
      <span><svg viewBox="0 0 22 10"><rect x="1" y="1" width="20" height="8" fill="${cor(c.id)}" opacity=".18"/><line x1="1" x2="21" y1="1.5" y2="1.5" stroke="var(--ink-3)" stroke-dasharray="1.5 3"/><line x1="1" x2="21" y1="8.5" y2="8.5" stroke="var(--ink-3)" stroke-dasharray="1.5 3"/></svg>faixa pessimista–otimista</span>
    </div>
    <details><summary>${ico("chevron")}Tabela da projeção</summary>
      <table class="tabela"><thead><tr><th>Marco</th><th>Pessimista</th><th>Realista</th><th>Otimista</th></tr></thead>
      <tbody>${marcos.map(([m, s]) => `<tr><td>${m} (semana ${s})</td><td>${usd(proj.pessimista[m])}</td><td>${usd(proj.realista[m])}</td><td>${usd(proj.otimista[m])}</td></tr>`).join("")}
      <tr><td>Semana atual (${c.semAtual})</td><td>${usd(c.proj.pessimista)}</td><td>${usd(c.proj.realista)}</td><td>${usd(c.proj.otimista)}</td></tr></tbody></table>
      <p class="meta" style="margin-top:6px">Valores semanais líquidos em US$ (00-painel-resultados/config/projetos.json). Entre os marcos, a meta é interpolada.</p>
    </details>
  </div>`;
}

function htmlKpis(c) {
  if (!c.kpis.length && !c.outrosKpis.length) return `<p class="vazio">Sem KPIs definidos para este projeto.</p>`;
  const linha = (k) => `<div class="kpi">
      <div class="nome">${esc(k.nome)}</div><div class="estado">${badgeStatus(k.status)}</div>
      ${htmlBala({ valor: k.atual ?? 0, meta: k.meta, corCss: cor(c.id), rotuloMeta: "meta",
        esq: k.atual === null ? "sem registro" : `<b>${numero(k.atual)}</b> em ${dataCurta(k.data)}`, dir: `meta da semana <b>${numero(k.meta)}</b>` })}
    </div>`;
  const outros = c.outrosKpis.length ? `<details><summary>${ico("chevron")}Outros KPIs registrados <span class="count">${c.outrosKpis.length}</span></summary>
      <ul class="lista">${c.outrosKpis.map((k) => `<li><code>${esc(k.id)}</code> <b class="num">${numero(k.atual)}</b> <span class="meta" style="display:inline">· ${dataCurta(k.data)}</span></li>`).join("")}</ul></details>` : "";
  return c.kpis.map(linha).join("") + outros;
}

function htmlIndicadores(c, p) {
  const roi = c.investido > 0 ? `${Math.round((100 * c.acumulado) / c.investido)}%` : "—";
  const bloco = (rotulo, valor, sub, dados) => `<div class="indicador"><span class="rotulo">${rotulo}</span><span class="valor" ${dados ?? ""}>${valor}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
  return `<div class="indicadores">
    ${bloco("Semana do roteiro", `<span data-contar="${c.semAtual}" data-fmt="int">${c.semAtual}</span>`, `desde ${c.inicio.toLocaleDateString("pt-PT")}`)}
    ${bloco("Lucro 7 dias", `<span data-contar="${p.lucro_7d_usd}" data-fmt="usd">${usd(p.lucro_7d_usd)}</span>`, brl(p.lucro_7d_usd, estado.taxa))}
    ${bloco("Lucro 28 dias", `<span data-contar="${p.lucro_28d_usd}" data-fmt="usd">${usd(p.lucro_28d_usd)}</span>`, `média 4 semanas ${usd(c.media4)}`)}
    ${c.proj ? bloco("Meta realista desta semana", `<span data-contar="${c.proj.realista}" data-fmt="usd">${usd(c.proj.realista)}</span>`, `${usd(c.proj.pessimista)} – ${usd(c.proj.otimista)}`) : ""}
    ${bloco("Investido", `<span data-contar="${c.investido}" data-fmt="usd">${usd(c.investido)}</span>`, `retorno acumulado ${roi}`)}
  </div>`;
}

// ---------- vistas ----------

// ---------- menu Monitor: um item só na barra, com um submenu para cada fonte ----------
// Abre ao passar o mouse, ao focar com o teclado ou ao tocar na seta (celular). O estado e o foco sobrevivem ao redesenho
// automático da página (a cada atualização o render troca o HTML inteiro). A lista do submenu fica FORA do .nav: o .nav rola
// na horizontal e, em tela estreita, tem uma máscara de degradê que apagaria o submenu.
let menuMonitorAberto = false, atrasoFecharMenu = null;
// mercado do submenu (18/11/2026, pedido do Diogo): hover, clique, toque ou Enter em Forex, Bovespa ou Todos só seleciona o
// mercado da lista, sem trocar de rota; ao fechar o menu volta ao mercado da tela
let ctxMenuPrevia = null;
const sinaisAbertosDe = (e, f) => (e.monitorSinais ?? []).filter((s) => s.fonte === f && (!s.ate || new Date(s.ate) > Date.now())).length;
const sinalAberto = (s) => !s.ate || new Date(s.ate) > Date.now();
const NOME_CTX = { forex: "Forex", bovespa: "Bovespa", todos: "Todos" };
const fmtR = (x) => `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")} R`;
const hrefCtx = (ctx, caminho = "monitor") => (ctx === "todos" ? "#/todos/comparar" : `#/${ctx}/${caminho}`);

function htmlGrupoMonitor(rota, e) {
  const total = (estadoBruto?.monitorSinais ?? []).filter((s) => sinalAberto(s) && (ctxAtual === "todos" || ctxDe(s.fonte) === ctxAtual)).length;
  return `<div class="aba-grupo" data-menu="monitor"${menuMonitorAberto ? " data-aberto" : ""}>
    <a class="aba" href="${hrefCtx(ctxAtual)}" ${["monitor", "analise", "termometro", "comparar"].includes(rota.tipo) ? 'aria-current="page"' : ""} style="--cor:${cor("monitor")}"><i class="ponto"></i>Monitor${total ? `<span class="count">${total}</span>` : ""}</a>
    <button type="button" class="aba-seta" data-menu-seta aria-expanded="${menuMonitorAberto}" aria-controls="menu-monitor" aria-label="Fontes do monitor">${ico("chevron")}</button>
  </div>`;
}

function htmlSubmenuMonitor(rota, e) {
  // o contexto do menu pode ser outro que o da tela (na Visão geral, p.ex.): a saúde e as contagens saem da lente do contexto do menu
  const ctxM = ctxMenuPrevia ?? ctxAtual;
  const el = ctxM === "todos" ? null : lente(estadoBruto, ctxM);
  const seletor = `<li class="ctx-seletor" role="group" aria-label="Contexto de mercado">${["forex", "bovespa", "todos"].map((c) =>
    `<a href="${hrefCtx(c)}" data-ctx="${c}" ${c === ctxM ? 'aria-current="true"' : ""}>${NOME_CTX[c]}</a>`).join("")}</li>`;
  const itens = ctxM === "todos"
    ? `<li><a href="#/todos/comparar" ${rota.tipo === "comparar" ? 'aria-current="page"' : ""}><i class="ponto" aria-hidden="true"></i>Comparar</a></li>`
    // Painel do mercado (18/11/2026): com Forex/Bovespa só selecionando o mercado, a página principal (sinais ativos, saúde
    // das fontes, ao vivo, placar) ganhou um item próprio
    : `<li><a href="${hrefCtx(ctxM)}" ${rota.tipo === "monitor" && rota.ctx === ctxM ? 'aria-current="page"' : ""}><i class="ponto" aria-hidden="true"></i>Painel</a></li>`
    + `<li><a href="${hrefCtx(ctxM, CONSOLIDADO)}" ${rota.tipo === "analise" && rota.fonte === CONSOLIDADO && rota.ctx === ctxM ? 'aria-current="page"' : ""}><i class="ponto" aria-hidden="true"></i>Consolidado</a></li>`
    + CONTEXTOS[ctxM].fontes.map((f) => {
      const n = sinaisAbertosDe(el, f);
      const s = saudeFonte(f, el).status;
      return `<li><a href="${hrefCtx(ctxM, f)}" ${rota.tipo === "analise" && rota.fonte === f && rota.ctx === ctxM ? 'aria-current="page"' : ""}><i class="ponto saude-${s.nivel}" title="${esc(s.t)}" aria-hidden="true"></i>${FONTES[f]}${s.nivel === "ok" ? "" : `<span class="so-leitor"> (${esc(s.t)})</span>`}${n ? `<span class="count" title="sinais abertos">${n}</span>` : ""}</a></li>`;
    }).join("") + (CONTEXTOS[ctxM].termometro ? `<li><a href="${hrefCtx(ctxM, "termometro")}" ${rota.tipo === "termometro" ? 'aria-current="page"' : ""}><i class="ponto" aria-hidden="true"></i>Termômetro</a></li>` : "");
  return `<ul class="submenu" id="menu-monitor" aria-label="Contexto e fontes do monitor"${menuMonitorAberto ? " data-aberto" : ""}>${seletor}${itens}</ul>`;
}

// Faixa do contexto: diz em qual mercado e corretora a tela está (as telas do Forex e da Bovespa são parecidas)
function htmlFaixaContexto(rota) {
  if (!["monitor", "analise", "termometro", "comparar"].includes(rota.tipo)) return "";
  if (rota.tipo === "comparar") return `<p class="ctx-faixa" data-ctx="todos"><b>Todos</b><span>Forex × Bovespa lado a lado · ${rota.visao === "efetiva" ? "ordens executadas" : "placar teórico"} · resultado em R</span></p>`;
  const c = CONTEXTOS[ctxLente];
  const texto = ctxLente === "forex" ? `dados Capital.com · execução ${corretoraExec()}` : c.corretora;
  return `<p class="ctx-faixa" data-ctx="${ctxLente}"><b>${c.nome}</b><span>${esc(texto)}</span></p>`;
}

const menuEl = () => document.querySelector('[data-menu="monitor"]');
const subEl = () => document.getElementById("menu-monitor");
const noMenu = (n) => !!n && (menuEl()?.contains(n) || subEl()?.contains(n));
const itensMenu = () => [...(menuEl()?.querySelectorAll("a, button") ?? []), ...(subEl()?.querySelectorAll("a") ?? [])];

function previaCtxMenu(c) {
  const alvo = c === ctxAtual ? null : c;
  if (alvo === ctxMenuPrevia) return;
  ctxMenuPrevia = alvo;
  const sub = subEl();
  if (!sub) return;
  sub.outerHTML = htmlSubmenuMonitor(rotaAtual(), estado);
  definirMenu(true);
}

function definirMenu(aberto) {
  clearTimeout(atrasoFecharMenu);
  if (!aberto && ctxMenuPrevia !== null) {  // fechou: o submenu volta ao mercado da tela
    ctxMenuPrevia = null;
    const sub = subEl();
    if (sub) sub.outerHTML = htmlSubmenuMonitor(rotaAtual(), estado);
  }
  menuMonitorAberto = aberto;
  const g = menuEl(), sub = subEl();
  if (!g || !sub) return;
  g.toggleAttribute("data-aberto", aberto);
  sub.toggleAttribute("data-aberto", aberto);
  g.querySelector(".aba-seta").setAttribute("aria-expanded", String(aberto));
  if (!aberto) return;
  // posicionado em relação ao .topo, colado embaixo do item Monitor
  const topo = g.closest(".topo").getBoundingClientRect(), r = g.getBoundingClientRect();
  sub.style.top = `${Math.round(r.bottom - topo.top - 1)}px`;
  sub.style.left = `${Math.max(8, Math.min(Math.round(r.left - topo.left), topo.width - sub.offsetWidth - 8))}px`;
}

const focoNoMenu = () => (noMenu(document.activeElement) ? itensMenu().indexOf(document.activeElement) : -1);
function restaurarMenu(foco) {
  if (menuMonitorAberto) definirMenu(true);
  if (foco >= 0) itensMenu()[foco]?.focus();
}

const comHover = matchMedia("(hover: hover)");
document.addEventListener("mouseover", (ev) => {
  if (!comHover.matches) return;
  const ctxLink = ev.target.closest?.(".ctx-seletor a[data-ctx]");
  if (ctxLink) previaCtxMenu(ctxLink.dataset.ctx);
  if (ev.target.closest?.('[data-menu="monitor"], .submenu')) definirMenu(true);
  else if (menuMonitorAberto && !noMenu(document.activeElement)) { clearTimeout(atrasoFecharMenu); atrasoFecharMenu = setTimeout(() => definirMenu(false), 160); }
});
document.addEventListener("click", (ev) => {
  // Forex, Bovespa e Todos só selecionam o mercado do submenu, sem trocar de rota (pedido do Diogo, 18/11/2026);
  // a página muda quando se escolhe uma fonte da lista
  const ctxLink = ev.target.closest?.(".ctx-seletor a[data-ctx]");
  if (ctxLink) {
    ev.preventDefault();
    previaCtxMenu(ctxLink.dataset.ctx);
    subEl()?.querySelector(`.ctx-seletor a[data-ctx="${ctxLink.dataset.ctx}"]`)?.focus();
    return definirMenu(true);
  }
  // com mouse o hover já abriu: o clique na seta mantém aberto; toque (sem hover) e teclado (detail 0) alternam
  if (ev.target.closest?.("[data-menu-seta]")) return definirMenu(comHover.matches && ev.detail > 0 ? true : !menuMonitorAberto);
  if (!ev.target.closest?.('[data-menu="monitor"], .submenu') || ev.target.closest?.(".submenu a, .aba-grupo > .aba")) definirMenu(false);
});
document.addEventListener("keydown", (ev) => {
  const g = menuEl();
  if (!g) return;
  if (ev.key === "Escape" && menuMonitorAberto) {
    const dentro = noMenu(document.activeElement);
    definirMenu(false);
    if (dentro) g.querySelector(".aba-seta").focus();
    return;
  }
  if (ev.key === "ArrowDown" && (ev.target.closest?.("[data-menu-seta]") || ev.target === g.querySelector(".aba"))) {
    ev.preventDefault();
    definirMenu(true);
    subEl()?.querySelector("a")?.focus();
    return;
  }
  const sub = ev.target.closest?.(".submenu");
  if (sub && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
    ev.preventDefault();
    const itens = [...sub.querySelectorAll("a")], i = itens.indexOf(ev.target.closest("a"));
    itens[(i + (ev.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length].focus();
  }
});
document.addEventListener("focusout", (ev) => {
  if (menuMonitorAberto && noMenu(ev.target) && ev.relatedTarget && !noMenu(ev.relatedTarget)) definirMenu(false);
});
document.addEventListener("scroll", (ev) => { if (menuMonitorAberto && ev.target.classList?.contains("nav")) definirMenu(false); }, true);
addEventListener("hashchange", () => definirMenu(false));
addEventListener("resize", () => { if (menuMonitorAberto) definirMenu(true); });

function htmlTopo(rota) {
  const e = estado;
  const semana = estado.painel ? Math.max(1, semanaDe(new Date(), new Date(estado.painel.data_inicio + "T00:00:00"))) : null;
  const aba = (href, atual, conteudo, corCss) => `<a class="aba" href="${href}" ${atual ? 'aria-current="page"' : ""} style="--cor:${corCss}">${conteudo}</a>`;
  // Monitor é o 2.º item (22/11/2026, crítica Impeccable): por último, ficava fora da tela no celular (x = 525 em 380 px)
  const abas = [aba("#/", rota.tipo === "geral", `${ico("compass")} Visão geral`, "var(--ink)")]
    .concat(htmlGrupoMonitor(rota, e))
    .concat(RENDA.map((id) => {
      const p = e.projetos.find((x) => x.id === id);
      const pend = p?.decisoes_pendentes ?? 0;
      return aba(`#/p/${id}`, rota.tipo === "projeto" && rota.id === id, `<i class="ponto"></i>${esc(PROJETOS[id].nome)}${pend ? `<span class="count alerta">${pend}</span>` : ""}`, cor(id));
    }));
  return `<header class="topo">
    <div class="topo-linha">
      <div class="marca"><span class="logo">${ico("zap")}</span><div><p class="marca-nome">Central de comando</p><small>${semana ? `Semana ${semana} do roteiro · ` : ""}${fonte.demo ? "modo demonstração" : "banco único"}</small></div></div>
      <span class="estado-agentes" title="${e.pausado ? "Agentes pausados" : "Agentes ativos"}"><i class="ponto ${e.pausado ? "parado" : "vivo"}"></i><span class="rotulo-topo">${e.pausado ? "Agentes pausados" : "Agentes ativos"}</span></span>
      <button class="btn ${e.pausado ? "primario" : ""}" data-acao="pausa" aria-label="${e.pausado ? "Retomar agentes" : "Pausar todos os agentes"}" title="${e.pausado ? "Retomar agentes" : "Pausar todos os agentes"}">${ico(e.pausado ? "play" : "pause")} <span class="rotulo-topo">${e.pausado ? "Retomar agentes" : "Pausar todos"}</span></button>
      <span class="sync" id="sync"><i class="ponto"></i>atualizado ${new Date().toLocaleTimeString("pt-PT", { timeStyle: "short" })}</span>
    </div>
    <nav class="nav" aria-label="Projetos">${abas.join("")}</nav>
    ${htmlSubmenuMonitor(rota, e)}
    ${htmlFaixaContexto(rota)}
  </header>`;
}

// meta realista do projeto na semana de um marco (M1, M3, M6, M12)
function metaNoMarco(c, marco) {
  const p = c.cfg.projecao_usd_semana ? projecao(c.cfg.projecao_usd_semana, c.marcos, c.marcos[marco] ?? c.semAtual) : null;
  return p ? p.realista : 0;
}

function htmlLinhaProjeto(p) {
  const c = calcularProjeto(p.id, estado);
  const pend = estado.painel ? `<span><b>${c.abertas.length}</b> pendências abertas</span>` : "";
  const st = c.status ? badgeStatus(c.status) : htmlBadge("muted", c.lanc.length ? "Sem projeção" : "Sem lançamentos", "clock");
  const fase = p.fase || c.cfg.status || "";
  const bala = !c.proj ? `<div class="meta">${esc(c.cfg.trilho ?? "")}</div>`
    : !c.lanc.length ? `<div class="meta"><span>ainda sem lançamentos</span><span>meta realista: <b>${usd(c.proj.realista)}</b>/sem. agora, <b>${usd(metaNoMarco(c, "M12"))}</b>/sem. no mês 12</span></div>`
    : htmlBala({ valor: c.media4, meta: c.proj.realista, min: c.proj.pessimista, max: c.proj.otimista, corCss: cor(p.id), rotuloMeta: "realista",
      esq: `média 4 sem. <b>${usd(c.media4)}</b>`, dir: `realista <b>${usd(c.proj.realista)}</b>` });
  return `<a class="proj" href="#/p/${p.id}" style="--cor:${cor(p.id)}" aria-label="${esc(PROJETOS[p.id]?.longo ?? p.nome)}">
    <div class="corpo">
      <div>
        <div class="nome"><i class="ponto" aria-hidden="true"></i>${esc(PROJETOS[p.id]?.longo ?? p.nome)} ${st}</div>
        <div class="fase">${esc(fase)}</div>
        <div class="numeros">${pend}<span><b>${p.decisoes_pendentes}</b> decisões</span><span><b>${p.instrucoes_novas}</b> instruções novas</span><span>atividade ${haQuanto(p.ultima_atividade)}</span></div>
      </div>
      <div>${bala}</div>
    </div>
  </a>`;
}

function htmlFaixaGeral(e) {
  const painel = e.painel;
  const calc = RENDA.map((id) => calcularProjeto(id, e));
  const lucro28 = e.projetos.filter((p) => RENDA.includes(p.id)).reduce((a, p) => a + Number(p.lucro_28d_usd || 0), 0);
  const metaSemana = calc.reduce((a, c) => a + (c.proj?.realista ?? 0), 0);
  const media4Total = calc.reduce((a, c) => a + (c.media4 || 0), 0);
  const abertas = painel ? painel.pendencias.filter((p) => !p.feito) : null;
  const doDiogo = abertas ? abertas.filter((p) => p.responsavel === "Diogo").length : 0;
  const sinais = (e.monitorSinais ?? []).filter((s) => !s.ate || new Date(s.ate) > Date.now()).length;
  const saudes = fontesDoCtx().map((f) => saudeFonte(f, e).status.nivel);
  const fontesNoAr = saudes.filter((n) => n === "ok" || n === "atencao").length, paradas = saudes.filter((n) => n === "parada").length;
  const bloco = (icone, rotulo, valor, sub) => `<div><span class="rotulo">${ico(icone)}${rotulo}</span><span class="valor">${valor}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
  return `<div class="faixa">
    ${bloco("inbox", "Decisões pendentes", `<span data-contar="${e.pendentes.length}" data-fmt="int">${e.pendentes.length}</span>`, e.pendentes.length ? `a mais urgente vence em ${prazoRelativo(e.pendentes[0].prazo).texto}` : "nada esperando por você")}
    ${bloco("list", "Pendências abertas", abertas ? `<span data-contar="${abertas.length}" data-fmt="int">${abertas.length}</span>` : "—", abertas ? `${doDiogo} dependem do Diogo` : "rode sincronizar_painel.py")}
    ${bloco("target", "Lucro semanal (média 4 sem.)", `<span data-contar="${media4Total}" data-fmt="usd">${usd(media4Total)}</span>`, `meta realista desta semana ${usd(metaSemana)} · 28 dias ${usd(lucro28)}`)}
    ${bloco("radio", "Monitor", `<span data-contar="${sinais}" data-fmt="int">${sinais}</span><small>sinais ativos</small>`, `${fontesNoAr} de ${fontesDoCtx().length} fontes no ar${paradas ? ` · <b class="neg">${paradas} parada${paradas > 1 ? "s" : ""}</b>` : ""}`)}
  </div>`;
}

function vistaGeral() {
  const e = estado;
  const renda = RENDA.map((id) => e.projetos.find((p) => p.id === id)).filter(Boolean);
  return `<main>
    <h1 class="oculto">Visão geral</h1>
    <div class="col">
      ${fonte.demo ? `<div class="aviso neutro">${ico("alert")}<span>Modo demonstração: dados de exemplo. Crie <code>config.js</code> para ligar ao banco.</span></div>` : ""}
      ${erro ? `<div class="aviso erro">${ico("alert")}<span>${esc(erro)}</span></div>` : ""}
      ${htmlFaixaGeral(e)}
      ${htmlSecaoDecisoes(e.pendentes, e.resolvidas)}
      <section class="painel" aria-labelledby="h-instrucao">
        <h2 id="h-instrucao">${ico("send")} Nova instrução</h2>
        ${htmlFormInstrucao("")}
        ${htmlInstrucoes(e.instrucoes.slice(0, 8))}
      </section>
    </div>
    <div class="col">
      <section class="painel" aria-labelledby="h-projetos">
        <h2 id="h-projetos">${ico("folder")} Projetos <span class="count">${renda.length}</span><span class="direita meta">clique para ver pendências, metas e gráfico</span></h2>
        <div class="proj-lista">${renda.map(htmlLinhaProjeto).join("")}</div>
      </section>
      ${(() => { const cm = calcularProjeto("monitor", e); return `<section class="painel" aria-labelledby="h-pend-monitor">
        <h2 id="h-pend-monitor">${ico("list")} Pendências do monitor <span class="count ${cm.abertas.length ? "alerta" : ""}">${cm.abertas.length}</span><a class="direita meta" href="#/monitor">abrir o Monitor</a></h2>
        ${htmlPendencias(cm, { compacto: true })}
      </section>`; })()}
      <section class="painel" aria-labelledby="h-atividade">
        <h2 id="h-atividade">${ico("activity")} Atividade dos agentes <span class="count">${e.eventos.length}</span></h2>
        ${htmlEventos(e.eventos, { filtros: true })}
      </section>
    </div>
  </main>`;
}

function vistaProjeto(id) {
  const e = estado;
  const p = e.projetos.find((x) => x.id === id) ?? { id, nome: PROJETOS[id].longo, decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0 };
  const c = calcularProjeto(id, e);
  const pendentes = e.pendentes.filter((d) => d.projeto_id === id), resolvidas = e.resolvidas.filter((d) => d.projeto_id === id);
  const eventos = e.eventos.filter((v) => v.projeto_id === id), instrucoes = e.instrucoes.filter((i) => i.projeto_id === id);
  const chips = [c.cfg.trilho ? `<span class="chip">${ico("compass")}${esc(c.cfg.trilho)}</span>` : "",
    c.cfg.status ? `<span class="chip">status: ${esc(c.cfg.status)}</span>` : "",
    p.status && p.status !== "ativo" ? htmlBadge("critical", p.status) : "",
    c.cfg.pasta ? `<span class="chip">${ico("folder")}${esc(c.cfg.pasta)}</span>` : ""].join("");
  return `<main>
    <div class="col">
      ${erro ? `<div class="aviso erro">${ico("alert")}<span>${esc(erro)}</span></div>` : ""}
      <div class="cabecalho-proj" style="--cor:${cor(id)}">
        <div class="bloco">
          <a class="voltar" href="#/">${ico("back")} Visão geral</a>
          <h1><i class="ponto" aria-hidden="true"></i>${esc(PROJETOS[id].longo)}</h1>
          <div class="meta">${chips}</div>
          ${p.fase ? `<div><b>Fase:</b> ${esc(p.fase)}</div>` : ""}
          ${p.resumo ? `<p class="resumo">${esc(p.resumo)}</p>` : ""}
          <div class="meta"><span>${ico("inbox")}${p.decisoes_pendentes} decisões pendentes</span><span>${ico("send")}${p.instrucoes_novas} instruções novas</span><span>${ico("activity")}atividade ${haQuanto(p.ultima_atividade)}</span>${c.status ? badgeStatus(c.status) : ""}</div>
        </div>
      </div>
      ${c.alertas.map((a) => `<div class="aviso">${ico("alert")}<span><b>Critério de parada atingido:</b> ${esc(a.acao)}</span></div>`).join("")}
      <section class="painel" aria-labelledby="h-numeros">
        <h2 id="h-numeros">${ico("target")} Números <span class="count">semana ${c.semAtual}</span></h2>
        ${htmlIndicadores(c, p)}
        <div style="margin-top:14px">${svgProjecao(c) || `<p class="vazio">Este projeto não tem projeção financeira (uso pessoal).</p>`}</div>
        ${c.lanc.length ? `<details><summary>${ico("chevron")}Últimos lançamentos <span class="count">${c.lanc.length}</span></summary>
          <ul class="lista">${c.lanc.slice(0, 10).map((l) => `<li>${esc(l.descricao)}<div class="meta"><span class="chip">${esc(l.tipo)}</span><span class="num">${l.tipo === "custo" ? "−" : ""}${esc(l.moeda)} ${numero(l.valor)}</span><span>≈ ${usd(l.valor_usd)}</span><span>${new Date(l.data + "T00:00:00").toLocaleDateString("pt-PT")}</span></div></li>`).join("")}</ul></details>` : `<p class="meta" style="margin-top:10px">Nenhum lançamento ainda. Registre com <code>painel.py lancar ${id} …</code>.</p>`}
      </section>
      <section class="painel" aria-labelledby="h-kpis">
        <h2 id="h-kpis">${ico("activity")} KPIs e metas <span class="count">${c.kpis.length}</span></h2>
        ${htmlKpis(c)}
        ${c.cfg.criterios_parada?.length ? `<details><summary>${ico("chevron")}Critérios de parada <span class="count">${c.cfg.criterios_parada.length}</span></summary>
          <ul class="lista">${c.cfg.criterios_parada.map((cr) => `<li>Semana ${cr.semana}: <code>${esc(cr.kpi)}</code> abaixo de ${numero(cr.minimo)} → ${esc(cr.acao)}</li>`).join("")}</ul></details>` : ""}
      </section>
    </div>
    <div class="col">
      ${htmlSecaoDecisoes(pendentes, resolvidas, "Decisões deste projeto")}
      <section class="painel" aria-labelledby="h-pend">
        <h2 id="h-pend">${ico("list")} Pendências <span class="count ${c.abertas.length ? "alerta" : ""}">${c.abertas.length}</span></h2>
        ${htmlPendencias(c)}
      </section>
      <section class="painel" aria-labelledby="h-instrucao">
        <h2 id="h-instrucao">${ico("send")} Instrução para ${esc(PROJETOS[id].nome)}</h2>
        ${htmlFormInstrucao(id)}
        ${htmlInstrucoes(instrucoes.slice(0, 6))}
      </section>
      <section class="painel" aria-labelledby="h-atividade">
        <h2 id="h-atividade">${ico("activity")} Atividade <span class="count">${eventos.length}</span></h2>
        ${htmlEventos(eventos)}
      </section>
    </div>
  </main>`;
}

// ---------- monitor de lives ----------

// contadores ao vivo (atualizados a cada segundo sem redesenhar a página)
function textoContador(iso) {
  const s = Math.round((new Date(iso) - Date.now()) / 1000);
  if (s <= 0) return "agora";
  // por extenso ("22 min 44 s"): "22:44" ao lado de horários ("23:21") se lia como hora
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = String(s % 60).padStart(2, "0");
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : m ? `${m} min ${seg} s` : `${s} s`;
}
function textoDesde(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  const hora = new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  return `${hora} (há ${s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`})`;
}
// tempo decorrido curto, para selos ("0:42", "3:05"): cabe no celular
function textoDecorrido(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
// Pregão da B3 (20/11/2026, pedido do Diogo): timer no topo do Consolidado da Bovespa. Mesmos horários e feriados de
// 07-monitor-bovespa/monitor_bovespa/pregao.py (minicontratos 09:00–18:30 de Brasília; o WDO fecha às 18:30) e da troca
// automática da prioridade das lives. Brasília é UTC−3 fixo (sem horário de verão desde 2019). 2027: a B3 ainda não
// publicou os feriados, então só fim de semana conta como fechado até a lista ser acrescentada aqui e no pregao.py.
const B3_FERIADOS = new Set(["2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01",
  "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-20", "2026-12-24", "2026-12-25", "2026-12-31"]);
const B3_ABERTURA_TARDIA = { "2026-02-18": [13, 0] };
const B3_ABRE = [9, 0], B3_FECHA = [18, 30], B3_UTC = -3;

function pregaoB3(agora = new Date()) {
  const noDia = (dia, [h, m]) => new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h - B3_UTC, m));
  const local = new Date(agora.getTime() + B3_UTC * 3600e3);  // "relógio de Brasília" lido pelos getters UTC
  for (let d = 0; d < 15; d++) {
    const dia = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d));
    const chave = dia.toISOString().slice(0, 10), semana = dia.getUTCDay();
    if (semana === 0 || semana === 6 || B3_FERIADOS.has(chave)) continue;
    const abre = noDia(dia, B3_ABERTURA_TARDIA[chave] ?? B3_ABRE), fecha = noDia(dia, B3_FECHA);
    if (agora < abre) return { aberto: false, ate: abre };
    if (agora < fecha) return { aberto: true, ate: fecha };
  }
  return null;
}
function textoPrazoLongo(ate) {
  const s = Math.max(0, Math.round((ate - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  if (d) return `${d} d ${h} h ${String(m).padStart(2, "0")} min`;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min ${String(seg).padStart(2, "0")} s`;
  return m ? `${m} min ${String(seg).padStart(2, "0")} s` : `${seg} s`;
}
// Forex (20/11/2026, pedido do Diogo): a mesma regra de fim de semana do monitor (config.yaml `mercado`, mercado.py):
// fecha sexta 17:00 e reabre domingo 18:00 em Nova York (CFDs de ouro, prata, índices e petróleo). Nova York tem horário
// de verão: o fuso de cada data vem do Intl. Feriados (Natal, Ano-Novo) não entram, como no mercado.py.
const FX_FUSO = "America/New_York", FX_FECHA = [5, 17, 0], FX_ABRE = [0, 18, 0];
function partesNoFuso(data, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(data).map((x) => [x.type, x.value]));
  return { a: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
function horaNoFuso(a, m, d, h, mi, tz) {  // "a/m/d h:mi em tz" → Date (UTC), acertando o horário de verão
  let t = Date.UTC(a, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = partesNoFuso(new Date(t), tz);
    t -= Date.UTC(p.a, p.m - 1, p.d, p.h, p.mi, p.s) - Date.UTC(a, m - 1, d, h, mi);
  }
  return new Date(t);
}
function pregaoForex(agora = new Date()) {
  const p = partesNoFuso(agora, FX_FUSO), semana = new Date(Date.UTC(p.a, p.m - 1, p.d)).getUTCDay();
  const minuto = semana * 1440 + p.h * 60 + p.mi, fecha = FX_FECHA[0] * 1440 + FX_FECHA[1] * 60 + FX_FECHA[2];
  const abre = FX_ABRE[0] * 1440 + FX_ABRE[1] * 60 + FX_ABRE[2];
  const aberto = minuto >= abre && minuto < fecha;
  const [diaAlvo, h, mi] = aberto ? FX_FECHA : FX_ABRE;
  const dias = (diaAlvo - semana + 7) % 7;
  const base = new Date(Date.UTC(p.a, p.m - 1, p.d + dias));
  return { aberto, ate: horaNoFuso(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, mi, FX_FUSO) };
}

const PREGOES = {
  bovespa: { calc: pregaoB3, tz: "America/Sao_Paulo", onde: "de Brasília", nome: "Pregão da B3" },
  forex: { calc: pregaoForex, tz: "Europe/Lisbon", onde: "de Lisboa", nome: "Mercado do Forex (CFDs)" },
};
function htmlPregao(ctx) {
  const cfg = PREGOES[ctx], p = cfg?.calc();
  if (!p) return "";
  const hora = p.ate.toLocaleString("pt-BR", { timeZone: cfg.tz, weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `${p.aberto ? htmlBadge("good", "OPENED", "check") : htmlBadge("critical", "CLOSED", "x")}
    <span class="meta">${p.aberto ? "fecha em" : "abre em"} <b class="num">${textoPrazoLongo(p.ate)}</b> (${esc(hora)} ${cfg.onde})</span>`;
}

function atualizarContadores() {
  if (document.hidden) return;  // aba escondida: nada a atualizar (auditoria de 17/11/2026)
  document.querySelectorAll("[data-pregao]").forEach((el) => { el.innerHTML = htmlPregao(el.dataset.pregao); });
  document.querySelectorAll("[data-ate]").forEach((el) => { el.textContent = textoContador(el.dataset.ate); });
  document.querySelectorAll("[data-desde]").forEach((el) => { el.textContent = textoDesde(el.dataset.desde); });
  document.querySelectorAll("[data-decorrido]").forEach((el) => { el.textContent = textoDecorrido(el.dataset.decorrido); });
}
setInterval(atualizarContadores, 1000);

function htmlContadores(i) {
  const partes = [];
  if (i.ultima_analise) partes.push(`<span>última análise <b class="num" data-desde="${esc(i.ultima_analise)}">${textoDesde(i.ultima_analise)}</b></span>`);
  if (i.proxima_analise && i.proxima_analise !== i.ciclo_fim) partes.push(`<span>próxima leitura em <b class="num" data-ate="${esc(i.proxima_analise)}">${textoContador(i.proxima_analise)}</b></span>`);
  if (i.ciclo_fim) partes.push(`<span>loop completo em <b class="num" data-ate="${esc(i.ciclo_fim)}">${textoContador(i.ciclo_fim)}</b></span>`);
  return partes.join("");
}

// motor em self-learning (agentes "-auto"): o monitor prefixa o detalhe com "self-learning v<n> · <estado> · "
const RE_AUTO = /^self-learning v(\d+) · ([^·]+?) · ?/;
const seloAuto = (texto) => `<span class="badge auto" title="parâmetros ajustados sozinhos pelo self-learning (lucro com lote 0,01)">${ico("bulb")}${esc(texto)}</span>`;
const seloFixo = () => `<span class="badge muted" title="parâmetros fixos: o self-learning não mexe neste agente">fixo</span>`;
// agente → tem self-learning? (do controle.agentes:painel; sem resumo, cai no sufixo "-auto" da convenção)
function modoAgente(id) {
  const a = estado.agentesPainel?.agentes?.find((x) => x.id === id);
  return a ? a.self_learning : /-auto$/.test(id ?? "");
}

// Status de cada fonte, no mesmo molde: resumo com contagens, grupos (o que significa) e um último grupo recolhido.
// "Sinal aberto" só conta aqui: os sinais ficam no painel "Sinais ativos".
const ABERTO = { t: "Sinal aberto", d: "listados em Sinais ativos", f: (i) => i.ativo || i.estado === "aberto", semLista: true };
const LOOP_LIVES = {
  titulo: "Loop de leitura", vazio: "Nada ao vivo agora.", resto: "Fora do ar",
  grupos: [
    { t: "Analisando agora", d: "live aberta, prints sendo lidos", f: (i) => i.estado === "gravando" || i.estado === "analisando" || i.analisando },
    { t: "Já analisados", d: "leitura feita; aguardam a próxima rodada", f: (i) => i.estado === "lido" },
    { t: "Aguardando a vez", d: "ainda sem análise nesta rodada", f: (i) => i.estado === "fila" },
  ],
};
const GRUPOS_FONTE = {
  tiktok: LOOP_LIVES, youtube: LOOP_LIVES,
  sites: { titulo: "Leitura dos sites", vazio: "Nenhum site lido ainda.", pares: "Pares" },  // desenho próprio: uma linha por site (htmlStatusSites)
  telegram: { titulo: "Leitura dos canais", vazio: "Nenhum canal lido ainda.", pares: "Sinais" },  // canais públicos do Telegram, no molde dos sites
  agentes: { titulo: "Rodada dos agentes", vazio: "Nenhuma rodada ainda.", resto: "Sem sinal",
    grupos: [ABERTO,
      { t: "Próximos de disparar", d: "setup se formando; o motor ainda não confirmou", f: (i) => i.estado === "proximo" },
      { t: "Sem dados", d: "sem velas novas; conferir o TradingView e o executor", f: (i) => i.estado === "sem_dados" || i.estado === "erro" }] },
  // Layouts do TradingView (02/11/2026): um item por layout (porte com os parâmetros do layout, ou alerta criado à mão)
  tradingview: { titulo: "Leitura dos layouts", vazio: "Nenhuma leitura ainda.", resto: "Sem sinal",
    grupos: [ABERTO,
      { t: "Aguardando alerta", d: "layout com script protegido: o alerta ainda não existe ou está parado no TradingView", f: (i) => /SEM ALERTA|parado no TradingView|não lidos/.test(i.detalhe ?? "") },
      { t: "Sem dados", d: "sem velas novas; conferir o TradingView e o executor", f: (i) => i.estado === "sem_dados" || i.estado === "erro" }] },
};

// Sites: quais sites o monitor lê, quando leu pela última vez, quando lê de novo e o que cada um tem. Os pares ficam recolhidos.
function htmlStatusSites(itens, f = "sites") {
  if (!itens.length) return `<p class="vazio">${GRUPOS_FONTE[f].vazio}</p>`;
  const por = {};
  itens.forEach((i) => (por[i.item.split(":")[0]] ??= []).push(i));
  return Object.values(por).sort((a, b) => a[0].nome.localeCompare(b[0].nome)).map((l) => {
    const nome = l[0].nome.split("·")[0].trim();
    const maisNovo = (campo) => l.map((i) => i[campo]).filter(Boolean).sort().pop();
    const ultima = maisNovo("ultima_analise"), proxima = maisNovo("proxima_analise");
    const conta = (estado) => l.filter((i) => estado === "aberto" ? i.ativo || i.estado === "aberto" : i.estado === estado).length;
    const contagens = [["aberto", "abertos"], ["bloqueado", "aguardando liberação"], ["executado", "encerrados"], ["expirado", "vencidos"]]
      .filter(([e]) => conta(e)).map(([e, t]) => `<span><b class="num">${conta(e)}</b> ${t}</span>`).join("");
    const leitura = ultima || proxima
      ? `${ultima ? `<span>última leitura <b class="num" data-desde="${esc(ultima)}">${textoDesde(ultima)}</b></span>` : ""}${proxima ? `<span>próxima em <b class="num" data-ate="${esc(proxima)}">${textoContador(proxima)}</b></span>` : ""}`
      : `<span>horário da leitura ainda não publicado</span>`;
    return `<div class="grupo-live"><div class="meta"><b>${esc(nome)}</b></div>
      <div class="meta">${leitura}</div><div class="meta">${contagens}</div>
      <details><summary>${ico("chevron")}${GRUPOS_FONTE[f].pares} de ${esc(nome)} ${l.length}</summary><ul class="lista">${l.map(htmlItemMonitor).join("")}</ul></details></div>`;
  }).join("");
}

// contagens por grupo numa linha (fica visível no cartão da fonte; as listas ficam no bloco recolhido)
function resumoStatusFonte(f, itens) {
  const cfg = GRUPOS_FONTE[f];
  if (!cfg.grupos || !itens.length) return "";
  const usados = new Set();
  const partes = cfg.grupos.map((g) => { const n = itens.filter((i) => !usados.has(i) && g.f(i)); n.forEach((i) => usados.add(i)); return [n.length, g.t]; })
    .concat([[itens.length - usados.size, cfg.resto]]).filter(([n]) => n);
  return `<div class="meta">${partes.map(([n, t]) => `<span><b class="num">${n}</b> ${esc(t.toLowerCase())}</span>`).join("")}</div>`;
}

function htmlStatusFonte(f, itens) {
  const cfg = GRUPOS_FONTE[f], usados = new Set();
  if (!itens.length) return `<p class="vazio">${esc(cfg.vazio)}</p>`;
  const blocos = cfg.grupos.map((g) => {
    const l = itens.filter((i) => !usados.has(i) && g.f(i));
    l.forEach((i) => usados.add(i));
    return { ...g, l };
  });
  const resto = itens.filter((i) => !usados.has(i));
  return blocos.filter((b) => b.l.length && !b.semLista).map((b) => `<div class="grupo-live"><div class="meta"><b>${esc(b.t)}</b><span>${esc(b.d)}</span></div>
        <ul class="lista">${b.l.map(htmlItemMonitor).join("")}</ul></div>`).join("")
    + (resto.length ? `<details><summary>${ico("chevron")}${esc(cfg.resto)} ${resto.length}</summary><ul class="lista">${resto.map(htmlItemMonitor).join("")}</ul></details>` : "");
}

function htmlItemMonitor(i) {
  const cls = i.ativo || i.estado === "lido" ? "good" : i.analisando || i.estado === "fila" ? "warning" : "muted";
  const auto = i.fonte === "agentes" ? RE_AUTO.exec(i.detalhe ?? "") : null;
  const detalhe = auto ? i.detalhe.slice(auto[0].length) : i.detalhe;
  const extras = [
    i.analisando && i.estado !== "analisando" ? `<span class="badge warning">analisando</span>` : "",
    i.espectadores != null ? `<span>${Number(i.espectadores).toLocaleString("pt-BR")} espectadores</span>` : "",
    i.ativo && i.desde ? `<span>há ${duracao(i.desde)}</span>` : "",
    i.chamadas_hoje ? `<span>${i.chamadas_hoje} chamada(s) hoje</span>` : "",
    COMO_SITES.has(i.fonte) ? "" : htmlContadores(i),
  ].join("");
  // só o self-learning ganha selo no item; o "fixo" fica na lista "Modo de cada agente" (dito uma vez)
  const selo = auto ? ` ${seloAuto(`self-learning v${auto[1]} · ${auto[2].trim()}`)}` : "";
  const icone = COMO_SITES.has(i.fonte) ? (i.item.split(":").pop() ? `${iconeAtivo(i.item.split(":").pop())} ` : "") : FONTES_PERIODICAS.has(i.fonte) ? `${iconeAtivo(i.nome.split("·").pop().trim())} ` : "";
  const vivo = i.ativo ? `<i class="ponto vivo" aria-hidden="true"></i>` : "";
  return `<li><span class="badge ${cls}">${vivo}${esc(ROTULO_ESTADO[i.estado] ?? i.estado)}</span> ${icone}${linkCanal(i.fonte, i.item, i.nome)}${selo}
    <div class="meta">${extras}${detalhe ? `<span>${esc(detalhe)}</span>` : ""}</div></li>`;
}

// mesmo mapa de 05-monitor-lives/monitor_lives/instrumentos.py (icone_instrumento); são conteúdo, não ícones de interface
// classe do ativo → ícone do sistema (sem emoji nem bandeiras: um traço e um peso só)
const MOEDAS = new Set(["EUR", "USD", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "CNH", "CNY", "MXN", "ZAR", "SEK", "NOK", "SGD", "HKD", "TRY", "PLN", "BRL"]);
const METAIS = /^(XAU|XAG|XPT|XPD|COPPER|GOLD|SILVER)/, ENERGIA = /^(USOIL|UKOIL|WTI|BRENT|CRUDEOIL|NGAS|NATGAS)/, CRIPTO = /^(BTC|ETH|SOL|XRP|BNB|ADA|DOGE|LTC|DOT|AVAX|LINK|MATIC|TRX|TON)/;
const INDICES = /^(NAS100|US100|NQ|US30|US500|SPX|GER40|DAX|UK100|FTSE|JP225|NIKKEI|FRA40|EU50|HK50|AUS200|IBOV|WIN|WDO|DXY)/;
function classeAtivo(sym) {
  const t = String(sym || "").toUpperCase();
  if (METAIS.test(t)) return "metal";
  if (ENERGIA.test(t)) return "energia";
  if (CRIPTO.test(t) || t.endsWith("USDT") || t.endsWith("USDC")) return "cripto";
  if (INDICES.test(t)) return "indice";
  if (t.length === 6 && MOEDAS.has(t.slice(0, 3)) && MOEDAS.has(t.slice(3))) return "forex";
  return "ativo";
}
const NOME_CLASSE = { metal: "metal", energia: "energia", cripto: "cripto", indice: "índice", forex: "forex", ativo: "ativo" };
function iconeAtivo(sym) { return ico(classeAtivo(sym), "ativo-ico"); }

// casas decimais pela grandeza do preço (índices e ouro 2, petróleo 3, forex e cripto 5, abaixo de 1 até 6): os portes
// e o ATR geram 28171.72125; o cartão mostra 28171.72 sem inventar precisão
const casasDoPreco = (x) => (Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 10 ? 3 : Math.abs(x) >= 1 ? 5 : 6);
// no formato do resto da tela (pt-BR: vírgula decimal, ponto de milhar): "1.117" virava mil cento e dezessete
const precoCurto = (v) => (v == null ? "—" : String(v).replace(/\d+(?:\.\d+)?/g, (m) => Number(m).toLocaleString("pt-BR", { maximumFractionDigits: casasDoPreco(Number(m)) })));

function htmlSinal(s) {
  const venda = s.direcao === "venda";
  const ate = s.ate ? new Date(s.ate).toLocaleTimeString("pt-PT", { timeStyle: "short" }) : null;
  const selo = s.fonte === "agentes" && modoAgente((s.origem ?? "").replace(/^\S+\s/, "")) ? seloAuto("self-learning") : "";
  const nivel = (rotulo, valor) => `<div><dt>${rotulo}</dt><dd>${esc(precoCurto(valor)).replace(/ \/ /g, "\u00a0/ ")}</dd></div>`;
  return `<li class="sinal">
    <div class="sinal-topo"><span class="badge ${venda ? "venda" : s.direcao === "compra" ? "compra" : ""}">${esc((s.direcao || "?").toUpperCase())}</span>
      <span aria-hidden="true">${iconeAtivo(s.instrumento)}</span><b>${esc(s.instrumento)}</b>${selo}</div>
    <dl class="sinal-niveis">${nivel("Entrada", s.entrada)}${nivel("Stop", s.stop)}${nivel("Alvo", s.alvos)}</dl>
    <div class="meta"><span>${linkCanal(s.fonte, s.item, s.origem)}</span><span>há ${duracao(s.desde)}</span>${ate ? `<span>válido até ${ate}</span>` : ""}${s.encerrado ? `<span title="O sinal saiu da lista de ativos, mas a ordem continua viva na corretora">sinal encerrado, ordem segue</span>` : ""}${htmlModalidadeOperacao(s)}</div>
    ${htmlExecucaoSinal(s)}</li>`;
}

// Execução do sinal na corretora (16/11/2026, pedido do Diogo): ícone do estado da ordem (aguardando, executada,
// encerrada, não executada) e o lucro até agora em verde ou vermelho. O lucro da ordem aberta vem da ponte
// (controle.execucao[@bovespa]:estado:<modo>.flutuante, a cada ~15 s); o da encerrada é o resultado real.
const ESTADO_ORDEM = {
  pendente: ["aguardando", "clock", "aguardando a entrada na corretora"],
  aberta: ["executada", "check", "ordem executada na corretora"],
  fechada: ["encerrada", "flag", "operação encerrada na corretora"],
  recusada: ["não executada", "x", "ordem recusada"], erro: ["não executada", "x", "erro no envio da ordem"],
  cancelada: ["cancelada", "x", "ordem cancelada"],
};
function dinheiroSinal(v, moeda) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  let txt;
  try { txt = Math.abs(n).toLocaleString("pt-BR", { style: "currency", currency: moeda || "USD" }); }
  catch { txt = `${Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moeda ?? ""}`; }
  const sinal = n > 0 ? "+" : n < 0 ? "−" : "";
  return `<b class="lucro-sinal ${n > 0 ? "ganho" : n < 0 ? "perda" : ""}">${sinal}${txt}</b>`;
}
// Lucro TEÓRICO do sinal (16/11/2026, pedido do Diogo): pelo preço de agora (controle.cotacoes:sinais, publicado pelo
// executor a cada ~5 min), supondo a entrada no preço do sinal. Forex: lote 0,01, líquido do spread real (CONTRATOS);
// Bovespa: 1 minicontrato (WIN R$ 0,20 e WDO R$ 10 por ponto [NV]) ou 100 ações. Sem tabela de contrato, só o R.
const PONTO_B3 = { WIN: 0.2, WDO: 10 };
function lucroTeorico(s) {
  const cot = estado.cotacoes?.ativos?.[String(s.instrumento ?? "").toUpperCase()];
  const ent = numerosDe(s.entrada), dir = s.direcao === "compra" ? 1 : s.direcao === "venda" ? -1 : 0;
  if (!cot || !ent.length || !dir) return null;
  const entrada = ent.length > 1 ? (ent[0] + ent[1]) / 2 : ent[0], mov = (Number(cot.preco) - entrada) * dir;
  const stop = Number(s.stop), risco = Number.isFinite(stop) ? Math.abs(entrada - stop) : 0;
  let valor = null, moeda = null, base = "";
  const inst = String(s.instrumento).toUpperCase(), raiz = Object.keys(PONTO_B3).find((r) => inst.startsWith(r));
  if (ctxLente === "bovespa") {
    if (raiz) { valor = mov * PONTO_B3[raiz]; moeda = "BRL"; base = "1 minicontrato"; }
    else if (/^[A-Z]{4}(\d{1,2})$/.test(inst)) { valor = mov * 100; moeda = "BRL"; base = "100 ações"; }
  } else {
    const c = contratoDe(s.instrumento);
    if (c) { valor = (mov - (c.pct ? c.pct * entrada : c.spread)) * c.un * (c.cota ?? 1); moeda = "USD"; base = "lote 0,01, líquido de spread"; }
  }
  return { valor, moeda, base, r: risco ? mov / risco : null, preco: Number(cot.preco), em: cot.em, fonte: cot.fonte };
}
// entrada do sinal já tocada? (controle.cotacoes:sinais.acionados, chave "<fonte com contexto>:<id>"): null = ainda não;
// ausente = não se sabe (sinal fora do registro), e o lucro aparece como antes
function entradaTocada(s) {
  const mapa = estado.cotacoes?.acionados;
  if (!mapa || s.encerrado) return true;
  const k = `${s.fonte}${ctxLente === "forex" ? "" : `@${ctxLente}`}:${s.sinal_id}`;
  return !(k in mapa) || mapa[k] != null;
}
function htmlLucroTeorico(s) {
  if (!entradaTocada(s)) {
    return `<span class="exec-ordem st-pendente" title="O preço ainda não chegou à entrada do sinal: o lucro teórico começa quando ela for tocada.">${ico("clock")}<span>aguardando entrada</span></span>`;
  }
  const t = lucroTeorico(s);
  if (!t || (t.valor == null && t.r == null)) return "";
  const rTxt = t.r == null ? "" : `${t.r > 0 ? "+" : t.r < 0 ? "−" : ""}${Math.abs(t.r).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} R`;
  const titulo = `Lucro teórico pelo preço de agora (${precoCurto(t.preco)}, ${t.fonte}, ${t.em ? `há ${duracao(t.em)}` : ""}), `
    + `com a entrada já tocada, no preço do sinal${t.base ? `; ${t.base}` : ""}. Não é o resultado da corretora.`;
  const valor = t.valor != null ? dinheiroSinal(t.valor, t.moeda) : `<b class="lucro-sinal ${t.r > 0 ? "ganho" : t.r < 0 ? "perda" : ""}">${rTxt}</b>`;
  return `<span class="exec-ordem st-teorico" title="${esc(titulo)}">${ico("activity")}<span>teórico</span>${valor}${t.valor != null && rTxt ? `<span class="meta">${rTxt}</span>` : ""}</span>`;
}

function htmlExecucaoSinal(s) {
  const dentro = htmlLucroTeorico(s) + htmlOrdensDoSinal(s) + htmlAtrasoSinal(s);
  return dentro ? `<div class="exec-sinal">${dentro}</div>` : "";
}
// Escutar o áudio da live (16/11/2026, pedido do Diogo): feature flag por fonte de VÍDEO e por contexto
// (controle.audio:<fonte>[@contexto]); o monitor lê a chave a cada ~10 s e vale a partir da próxima passagem. Sites e
// fontes sem vídeo (agentes, TradingView, Telegram) não têm áudio para escutar.
const FONTES_COM_VIDEO = new Set(["tiktok", "youtube"]);
function htmlBotaoAudio(f, e) {
  if (!FONTES_COM_VIDEO.has(f)) return "";
  const chave = `${f}${sufixoDe(ctxLente)}`, ligado = e.audio?.[chave] === true;
  const titulo = ligado ? `Parar de escutar o áudio das lives do ${FONTES[f]} (as leituras seguem só com os prints)`
    : `Escutar o áudio das lives do ${FONTES[f]}: a fala do apresentador é transcrita (Groq, grátis com limite diário) e ajuda a ler entrada, stop e alvo`;
  return `<div class="meta"><button class="btn pequeno exec ${ligado ? "ligado" : ""}" data-acao="audio" data-chave="${esc(chave)}" data-ligar="${!ligado}"
    aria-pressed="${ligado}" title="${esc(titulo)}" aria-label="${esc(titulo)}">${ico("radio")}<span class="sem-quebra">Escutar live</span><span class="estado-exec">${ligado ? "ligado" : "desligado"}</span></button></div>`;
}

// Atraso da leitura (16/11/2026, migração 0016): "atrasado" = o canal já tinha executado a posição na live há mais que a
// tolerância (15 min); o sinal nunca vira ordem nem aviso, mas o placar mede o que ele daria
const minTexto = (m) => (m == null ? "?" : m >= 90 ? `${(m / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${Math.round(m)} min`);
function htmlAtrasoSinal(s) {
  if (s.situacao === "atrasado") {
    const titulo = `Leitura atrasada: o canal já tinha executado esta posição na live${s.atraso_min != null ? ` há ${minTexto(s.atraso_min)}` : " (há quanto tempo não deu para medir)"}`
      + (s.entrada_canal != null
        ? `, com entrada em ${precoCurto(s.entrada_canal)}. Na Bovespa a ordem só entra no preço do canal (limite; a mercado se o preço estiver a até 0,2 R dele), nunca no preço de agora.`
        : ". Sem a entrada do canal, não vira ordem nem aviso; o placar acompanha o resultado à parte.");
    const acao = s.entrada_canal != null ? `só no preço do canal (${precoCurto(s.entrada_canal)})` : "não executar";
    return `<span class="exec-ordem st-atrasado" title="${esc(titulo)}">${ico("alert")}<span>atrasado · ${minTexto(s.atraso_min)} · ${acao}</span></span>`;
  }
  if (Number(s.atraso_min) > 0) {
    return `<span class="exec-ordem st-sem" title="${esc(`Leitura feita ${minTexto(s.atraso_min)} depois da execução na live (dentro da tolerância de 15 min)`)}">${ico("clock")}<span>atraso ${minTexto(s.atraso_min)}</span></span>`;
  }
  return "";
}
function htmlOrdensDoSinal(s) {
  const ordens = (estado.monitorOrdens ?? []).filter((o) => o.fonte === s.fonte && String(o.sinal_id) === String(s.sinal_id))
    .sort((a, b) => (a.modo === b.modo ? 0 : a.modo === "demo" ? -1 : 1));
  if (s.situacao === "atrasado" && !ordens.length) return "";  // o selo do atraso já diz por quê
  if (!ordens.length) {
    // sem ordem: diz por quê, em vez de não mostrar nada (pedido do Diogo, 16/11/2026)
    if (!CONTEXTOS[ctxLente]?.execucao && ctxLente !== "forex") return "";
    const est = estado.execucao?.estado ?? {};
    const conectada = ["demo", "real"].some((m) => est[m]?.conectado);
    const motivo = conectada
      ? "Nenhuma ordem para este sinal: o canal não está com Demo/Real ligado, o sinal chegou velho (mais de 30 min) ou fora do horário de entrada."
      : `Nenhuma ordem: a execução na ${corretoraExec()} não está conectada (a ponte do MT5 não está rodando para este mercado).`;
    return `<span class="exec-ordem st-sem" title="${esc(motivo)}">${ico("pause")}<span>${conectada ? "sem ordem" : "execução desligada"}</span></span>`;
  }
  return ordens.map((o) => {
    const [rotulo, icone, explica] = ESTADO_ORDEM[o.status] ?? [o.status, "alert", o.status];
    const est = estado.execucao?.estado?.[o.modo] ?? {}, moeda = o.moeda ?? est.moeda;
    const flut = o.status === "aberta" ? est.flutuante?.[String(o.id)] : null;
    const valor = o.status === "aberta" ? flut?.lucro : o.status === "fechada" ? o.resultado : null;
    const preco = o.status === "aberta" && o.preco_execucao != null ? ` a ${precoCurto(o.preco_execucao)}` : "";
    const titulo = `${o.modo === "real" ? "Conta real" : "Conta demo"}: ${explica}${preco}${o.motivo ? ` (${o.motivo})` : ""}`
      + (o.status === "aberta" ? (flut ? ", lucro até agora" : ", lucro ainda não publicado pela ponte") : "");
    // stop e alvo DA ORDEM (no tick da corretora; no livro virtual a ponte é quem os executa, o MT5 não mostra o TP)
    const niveis = (o.status === "aberta" || o.status === "pendente") && (o.stop != null || o.alvo != null)
      ? `<span class="meta" title="Stop e alvo da ordem, vigiados pela ponte (na conta netting a corretora só tem o stop de proteção)">stop ${precoCurto(o.stop)} · alvo ${precoCurto(o.alvo)}</span>` : "";
    return `<span class="exec-ordem st-${esc(o.status)}" title="${esc(titulo)}">${ico(icone)}<span>${o.modo === "real" ? "Real" : "Demo"} · ${rotulo}</span>${valor != null ? dinheiroSinal(valor, moeda) : ""}${niveis}</span>`;
  }).join("");
}

// filtro por ativo da seção Monitor de lives (vale para sinais ativos, pares dos sites e placar)
let filtroAtivo = (() => { try { return localStorage.getItem("filtroAtivo") || ""; } catch (e) { return ""; } })();
const ATALHOS_POR_CTX = { forex: [["", "Todos"], ["XAUUSD", "Ouro"], ["XAGUSD", "Prata"]], bovespa: [["", "Todos"], ["WIN", "Mini-índice"], ["WDO", "Mini-dólar"]] };
const atalhosAtivo = () => ATALHOS_POR_CTX[ctxLente] ?? ATALHOS_POR_CTX.forex;
const passaFiltro = (sym) => !filtroAtivo || String(sym || "").toUpperCase() === filtroAtivo;

function htmlFiltroAtivo(e) {
  const ativos = new Set([...(e.monitorSinais ?? []), ...(e.monitorResultados ?? [])].map((s) => String(s.instrumento || "").toUpperCase()));
  atalhosAtivo().forEach(([sym]) => sym && ativos.add(sym));
  const opcoes = [...ativos].filter(Boolean).sort();
  const chip = ([sym, rotulo]) => `<button class="btn" data-acao="filtro" data-ativo="${sym}" aria-pressed="${filtroAtivo === sym}">${sym ? iconeAtivo(sym) : ""}${rotulo}</button>`;
  return `<div class="filtros" style="align-items:center" role="group" aria-label="Filtrar por ativo">
    <span class="meta">Ativo:</span>${atalhosAtivo().map(chip).join("")}
    <select data-acao="filtro-lista" aria-label="Filtrar por ativo" style="width:auto;min-height:30px;padding:2px 8px;font-size:12.5px">
      <option value="">Outro ativo…</option>${opcoes.map((s) => `<option value="${s}" ${filtroAtivo === s ? "selected" : ""}>${s} (${NOME_CLASSE[classeAtivo(s)]})</option>`).join("")}
    </select>
    ${filtroAtivo ? `<span class="meta">mostrando só <b>${iconeAtivo(filtroAtivo)} ${esc(filtroAtivo)}</b></span>` : ""}
  </div>`;
}



// Placar no Monitor: uma linha por fonte (acerto e R médio); a lista por canal, site, layout ou agente fica na página da fonte
function htmlPlacar(e) {
  const resultados = e.monitorResultados ?? [];
  const pct = (w, l) => (w + l ? `${Math.round((100 * w) / (w + l))}%` : "—");
  const linhas = fontesDoCtx().map((f) => {
    const lista = resultados.filter((r) => r.fonte === f && passaFiltro(r.instrumento));
    const w = lista.filter((r) => r.status === "alvo").length, l = lista.filter((r) => r.status === "stop").length;
    const outros = lista.length - w - l, total = lista.length || 1;
    const rs = lista.map((r) => r.resultado_r).filter((x) => x !== null && x !== undefined).map(Number);
    const rMedio = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2).replace(".", ",") : "—";
    const barra = lista.length ? `<div class="placar-barra" role="img" aria-label="${w} win, ${l} loss, ${outros} outros"><i class="w" style="width:${(100 * w) / total}%"></i><i class="l" style="width:${(100 * l) / total}%"></i><i class="o" style="width:${(100 * outros) / total}%"></i></div>` : `<span class="meta">nenhum resolvido</span>`;
    return `<tr><th scope="row"><a href="#/${f}">${FONTES[f]}</a></th><td class="col-zero">${barra}</td>
      <td class="num">${w}</td><td class="num">${l}</td>
      <td class="num">${pct(w, l)}${w + l && w + l < 10 ? ` <small class="amostra" title="menos de 10 sinais decididos: não conclua nada ainda">amostra pequena</small>` : ""}</td>
      <td class="num">${rMedio}</td><td class="num col-expirados">${outros}</td></tr>`;
  });
  return `<section class="painel" aria-labelledby="h-placar">
    <h2 id="h-placar">${ico("target")} Placar dos sinais <span class="count">últimos 30 dias</span>${filtroAtivo ? `<span class="count">${iconeAtivo(filtroAtivo)} ${esc(filtroAtivo)}</span>` : ""}</h2>
    <div class="rolagem"><table class="tabela placar">
      <thead><tr><th scope="col">Fonte</th><th scope="col" class="col-zero">Win · loss · outros</th><th scope="col">Win</th><th scope="col">Loss</th><th scope="col">Acerto</th><th scope="col">R médio</th><th scope="col" class="col-expirados">Expirados</th></tr></thead>
      <tbody>${linhas.join("")}</tbody></table></div>
    <p class="meta nota">Win = bateu o alvo antes do stop; loss = bateu o stop (mesma vela conta como loss). Clique na fonte para ver cada canal, site, layout ou agente. Lá o acerto é em dinheiro, líquido de spread e sem os sinais repetidos do consenso, então pode diferir deste: um alvo curto que não paga o spread conta como perda.</p>
  </section>`;
}

// Atraso das leituras (16/11/2026, pedido do Diogo): por canal, quantos sinais chegaram atrasados, o atraso mediano,
// o que os atrasados dariam (win/loss e dinheiro, pelo placar) e quanto o atraso piora a entrada. Vale para Forex e
// Bovespa (a lente já separa o contexto). Dinheiro: Forex em US$ no lote 0,01; Bovespa em R$ por 1 minicontrato.
function dinheiroDoResultado(r) {
  const rr = rDoResultado(r);
  if (rr == null) return null;
  if (ctxLente === "bovespa") {
    const er = entradaERisco(r), inst = String(r.instrumento ?? "").toUpperCase();
    const raiz = Object.keys(PONTO_B3).find((k) => inst.startsWith(k));
    return er ? rr * er.risco * (raiz ? PONTO_B3[raiz] : 100) : null;
  }
  return usdDoResultado(r, rr);
}
function custoDoAtraso(s) {  // quanto a entrada do sinal ficou pior que a do canal (positivo = pior), em dinheiro
  const ent = numerosDe(s.entrada), dir = s.direcao === "compra" ? 1 : s.direcao === "venda" ? -1 : 0;
  if (s.entrada_canal == null || !ent.length || !dir) return null;
  const entrada = ent.length > 1 ? (ent[0] + ent[1]) / 2 : ent[0], pior = (entrada - Number(s.entrada_canal)) * dir;
  if (ctxLente === "bovespa") {
    const inst = String(s.instrumento ?? "").toUpperCase(), raiz = Object.keys(PONTO_B3).find((k) => inst.startsWith(k));
    return pior * (raiz ? PONTO_B3[raiz] : 100);
  }
  const c = contratoDe(s.instrumento);
  return c ? pior * c.un * (c.cota ?? 1) : null;
}
function htmlAtrasos(e) {
  const moeda = ctxLente === "bovespa" ? "BRL" : "USD";
  const ativos = (e.monitorSinais ?? []).map((s) => ({ ...s, status: "ativo" }));
  const vistos = new Set(ativos.map((s) => `${s.fonte}:${s.sinal_id}`));
  const todos = [...ativos, ...(e.monitorResultados ?? []).filter((r) => !vistos.has(`${r.fonte}:${r.sinal_id}`))]
    .filter((s) => s.situacao && fontesDoCtx().includes(s.fonte) && passaFiltro(s.instrumento));
  const titulo = `<h2 id="h-atrasos">${ico("clock")} Atraso das leituras <span class="count">últimos 30 dias</span></h2>`;
  if (!todos.length) {
    return `<section class="painel" aria-labelledby="h-atrasos">${titulo}<p class="vazio">Ainda sem sinais com o atraso medido (começou em 16/11/2026, nos canais do TikTok e do YouTube).</p></section>`;
  }
  const grupos = new Map();
  todos.forEach((s) => {
    const k = `${s.fonte}|${nomeDaUnidadeBase(s.origem)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(s);
  });
  const soma = (l) => l.reduce((a, b) => a + b, 0);
  const mediana = (l) => { const v = [...l].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const linhas = [...grupos.entries()].map(([k, l]) => {
    const [f, canal] = k.split("|");
    const atr = l.filter((s) => s.situacao === "atrasado"), comAtraso = l.filter((s) => s.situacao !== "atrasado" && Number(s.atraso_min) > 0);
    const w = atr.filter((s) => s.status === "alvo").length, perda = atr.filter((s) => s.status === "stop").length;
    const din = atr.map(dinheiroDoResultado).filter((x) => x != null);
    const custo = l.map(custoDoAtraso).filter((x) => x != null);
    return { f, canal, n: l.length, atr: atr.length, med: mediana(l.map((s) => s.atraso_min).filter((x) => x != null).map(Number)),
             comAtraso: comAtraso.length, w, perda, abertos: atr.filter((s) => s.status === "ativo").length,
             din: din.length ? soma(din) : null, custo: custo.length ? soma(custo) : null };
  }).sort((a, b) => b.atr - a.atr || b.n - a.n);
  const tot = { n: soma(linhas.map((x) => x.n)), atr: soma(linhas.map((x) => x.atr)) };
  const dinTot = linhas.map((x) => x.din).filter((x) => x != null), custoTot = linhas.map((x) => x.custo).filter((x) => x != null);
  const celDin = (v) => (v == null ? `<span class="meta">—</span>` : dinheiroSinal(v, moeda));
  const pctTxt = (a, n) => (n ? `${Math.round((100 * a) / n)}%` : "—");
  return `<section class="painel" aria-labelledby="h-atrasos">${titulo}
    <p class="meta nota">${tot.atr} de ${tot.n} sinais medidos chegaram atrasados (${pctTxt(tot.atr, tot.n)}).
      Os atrasados teriam dado ${dinTot.length ? dinheiroSinal(soma(dinTot), moeda) : "—"} pelo placar
      ${custoTot.length ? `· o atraso piorou a entrada em ${dinheiroSinal(-soma(custoTot), moeda)}` : ""}.</p>
    <div class="rolagem rolavel-y" data-rolavel="atrasos"><table class="tabela vira-lista atrasos">
      <thead><tr><th scope="col">Canal</th><th scope="col">Sinais</th><th scope="col">Atrasados</th><th scope="col">Atraso mediano</th>
        <th scope="col" title="Sinais executáveis lidos com algum atraso, dentro da tolerância de 15 min">Com atraso ≤ 15 min</th>
        <th scope="col" title="Atrasados resolvidos: alvo · stop (e ainda abertos)">Atrasados: win · loss</th>
        <th scope="col" title="Quanto os sinais atrasados teriam dado pelo placar (Forex: lote 0,01 líquido de spread; Bovespa: 1 minicontrato)">Resultado dos atrasados</th>
        <th scope="col" title="Diferença entre a entrada do sinal e a entrada do canal na live, quando conhecida (negativo = o atraso piorou a entrada)">Impacto na entrada</th></tr></thead>
      <tbody>${linhas.map((x) => `<tr><th scope="row"><a href="#/${x.f}">${esc(x.canal)}</a> <span class="meta">${esc(FONTES[x.f] ?? x.f)}</span></th>
        <td class="num">${x.n}</td><td class="num">${x.atr} (${pctTxt(x.atr, x.n)})</td>
        <td class="num">${minTexto(x.med)}</td><td class="num">${x.comAtraso}</td>
        <td class="num">${x.w} · ${x.perda}${x.abertos ? ` (+${x.abertos} aberto${x.abertos > 1 ? "s" : ""})` : ""}</td>
        <td class="num">${celDin(x.din)}</td><td class="num">${celDin(x.custo == null ? null : -x.custo)}</td></tr>`).join("")}</tbody></table></div>
    <p class="meta nota">Atrasado = o canal já tinha executado a posição na live há mais de 15 min quando o monitor leu (ou a posição já corria e a entrada não era legível). Esses sinais nunca viram ordem nem aviso; o placar mede o que dariam. Muitos atrasados num canal = a leitura dele precisa de mais frequência (foco) ou o canal não serve para seguir.</p>
  </section>`;
}

// Termômetro no Monitor: uma linha por ativo; leitura completa em #/termometro
function htmlTermometroCompacto(e) {
  const t = e.termometro;
  const titulo = (extra = "") => `<h2 id="h-termo">${ico("activity")} Termômetro ${extra}<a class="direita meta" href="#/termometro">termômetro completo</a></h2>`;
  if (!CONTEXTOS[ctxLente]?.termometro) return "";  // o termômetro ainda não existe para a B3 (auditoria de 17/11/2026)
  if (!t?.ativos?.length) return `<section class="painel" aria-labelledby="h-termo">${titulo()}<p class="vazio">Ainda sem leitura: o executor publica a cada ~15 min.</p></section>`;
  const fechado = t.mercado === "fechado";
  const linha = (a) => {
    const [rot, cls] = ROTULO_DIRECAO[a.direcao] ?? ["Sem leitura", "muted"];
    const velho = a.idade_min != null && a.idade_min > 45;
    return `<li><a href="#/termometro">${iconeAtivo(a.id)}<b>${esc(a.nome)}</b></a>
      ${a.preco != null ? `<span class="num">${esc(preco2(a.preco))}</span><span class="num ${a.variacao_dia_pct > 0 ? "alta" : a.variacao_dia_pct < 0 ? "baixa" : ""}">${pctSinal(a.variacao_dia_pct)}</span>` : `<span class="meta">sem cotação</span>`}
      <span class="selos">${htmlBadge(cls, rot + (a.forca ? " forte" : ""), a.direcao === "alta" ? "alta" : a.direcao === "baixa" ? "baixa" : undefined)}${a.divergencia ? htmlBadge("warning", "Divergência", "alert") : ""}${a.corretora?.spread_alto ? htmlBadge("warning", `Spread ${Number(a.corretora.spread_x).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`, "alert") : ""}${velho ? htmlBadge("muted", `velas de há ${duracaoMin(a.idade_min)}`, "clock") : ""}</span></li>`;
  };
  return `<section class="painel" aria-labelledby="h-termo">
    ${titulo(`<span class="meta">atualizado <b class="num" data-desde="${esc(t.atualizado_em)}">${textoDesde(t.atualizado_em)}</b></span>${fechado ? htmlBadge("muted", "mercado fechado", "clock") : ""}`)}
    <ul class="termo-compacto">${t.ativos.map(linha).join("")}</ul>
  </section>`;
}

function sinaisVigentes(e, f) {
  const ativos = (e.monitorSinais ?? []).filter((s) => s.fonte === f && (!s.ate || new Date(s.ate) > Date.now()) && passaFiltro(s.instrumento));
  // ordem ainda viva na corretora (aberta ou aguardando) cujo sinal já saiu da lista: continua aqui, com o lucro, até sair
  const tem = new Set(ativos.map((s) => String(s.sinal_id)));
  const orfas = (e.monitorOrdens ?? []).filter((o) => o.fonte === f && (o.status === "aberta" || o.status === "pendente")
      && !tem.has(String(o.sinal_id)) && passaFiltro(o.instrumento))
    .filter((o, i, l) => l.findIndex((x) => String(x.sinal_id) === String(o.sinal_id)) === i)
    .map((o) => ({ fonte: f, sinal_id: o.sinal_id, item: null, origem: o.origem || o.unidade, instrumento: o.instrumento,
                   direcao: o.direcao, entrada: o.preco_execucao ?? o.preco_pedido ?? o.entrada_sinal, stop: o.stop, alvos: o.alvo,
                   desde: o.aberto_em || o.sinal_desde || o.criado_em, ate: null, encerrado: true }));
  return [...ativos, ...orfas].sort((a, b) => new Date(b.desde) - new Date(a.desde));
}

// sinal que não vai virar operação: tem ordem e nenhuma está viva (recusada, erro, cancelada) ou é atrasado sem ordem
const ORDEM_VIVA = new Set(["aberta", "pendente"]);
function foraDaExecucao(s) {
  const ordens = (estado.monitorOrdens ?? []).filter((o) => o.fonte === s.fonte && String(o.sinal_id) === String(s.sinal_id));
  if (ordens.some((o) => ORDEM_VIVA.has(o.status) || o.status === "fechada")) return false;
  return ordens.length > 0 || s.situacao === "atrasado";
}

// Ao vivo agora (17/11/2026, pedido do Diogo): o que o DETECTOR achou no ar, separado do que a análise já leu e dos
// sinais. Vem de monitor_itens (um item por canal, estado da última checagem). TikTok e YouTube; os outros não têm live.
const NO_AR = new Set(["ao_vivo", "gravando", "analisando", "fila", "lido"]);
const SITUACAO_ANALISE = { gravando: "lendo agora", analisando: "IA analisando", fila: "aguardando a vez", lido: "já lido nesta rodada", ao_vivo: "detectado" };
function categoriaDoItem(f, e, i) {
  const nomeCanal = String(i.detalhe ?? "").split(/[;·]/)[0];  // YouTube: "Nome do canal; N espectadores"
  return categoriaDoCanal(f, e, i.item) ?? categoriaDoCanal(f, e, nomeCanal);
}
function htmlAoVivo(e) {
  const fontes = fontesDoCtx().filter((f) => f === "tiktok" || f === "youtube");
  if (!fontes.length) return "";
  const blocos = fontes.map((f) => {
    const itens = (e.monitorItens ?? []).filter((i) => i.fonte === f);
    if (!itens.length) return "";
    const vivos = itens.filter((i) => NO_AR.has(i.estado) || i.analisando)
      .sort((a, b) => (b.espectadores ?? -1) - (a.espectadores ?? -1));
    const login = itens.filter((i) => i.estado === "login_necessario").length;
    const desc = itens.filter((i) => i.estado === "desconhecido").length;
    const linhas = vivos.map((i) => {
      const cat = f === "youtube" ? categoriaDoItem(f, e, i) : null;
      const sit = SITUACAO_ANALISE[i.analisando && i.estado !== "gravando" ? "analisando" : i.estado] ?? i.estado;
      return `<li>${i.estado === "gravando" || i.analisando ? `<i class="ponto vivo" aria-hidden="true"></i>` : ""}${linkCanal(i.fonte, i.item, i.nome)}
        <div class="meta">${i.espectadores != null ? `<span><b class="num">${inteiro(i.espectadores)}</b> espectadores</span>` : ""}${cat ? `<span class="badge muted">${esc(ROTULO_CATEGORIA[cat])}</span>` : ""}<span>${esc(sit)}</span>${i.ultima_analise ? `<span>última leitura <b class="num" data-desde="${esc(i.ultima_analise)}">${textoDesde(i.ultima_analise)}</b></span>` : ""}</div></li>`;
    }).join("");
    const avisos = [login ? htmlBadge("critical", `${login} pede${login > 1 ? "m" : ""} login`, "alert") : "",
                    desc ? `<span title="o detector não conseguiu dizer se está no ar">${desc} sem resposta</span>` : ""].join("");
    return `<div class="cartao"><div class="titulo"><span class="nome-fonte">${FONTES[f]}</span> <span class="count">${vivos.length}</span></div>
      <div class="meta"><span>${vivos.length ? `${vivos.length} de ${itens.length} canais no ar` : `nenhum dos ${itens.length} canais no ar`}</span>${avisos}</div>
      ${vivos.length ? `<ul class="lista rolavel" data-rolavel="aovivo-${f}">${linhas}</ul>` : ""}</div>`;
  }).filter(Boolean);
  if (!blocos.length) return "";
  return `<section class="painel" aria-labelledby="h-aovivo">
    <h2 id="h-aovivo">${ico("radio")} Ao vivo agora</h2>
    <p class="nota">O que o detector achou no ar na última checagem de cada canal, separado da análise: estar aqui não quer dizer que já houve leitura nem sinal.</p>
    <div class="grade-cartoes">${blocos.join("")}</div>
  </section>`;
}

function htmlSinaisAtivos(e) {
  const por = fontesDoCtx().map((f) => [f, sinaisVigentes(e, f)]);
  const total = por.reduce((n, [, l]) => n + l.filter((s) => !foraDaExecucao(s)).length, 0);
  // fonte sem sinal não ganha cartão vazio: entra numa linha só, embaixo da grade. Os sinais que NÃO vão executar (ordem
  // recusada, cancelada ou sinal atrasado sem ordem) ficam num bloco recolhido, para a lista bater com a corretora
  // (pedido do Diogo, 16/11/2026); o placar continua medindo todos
  const cartoes = por.filter(([, l]) => l.length).map(([f, l]) => {
    const fora = l.filter(foraDaExecucao), dentro = l.filter((s) => !foraDaExecucao(s));
    return `<div class="cartao">
      <div class="titulo">${FONTES[f]} <span class="count">${dentro.length}</span></div>
      ${dentro.length ? `<ul class="lista rolavel" data-rolavel="sinais-${f}">${dentro.map(htmlSinal).join("")}</ul>` : `<p class="meta">Nenhum sinal em execução ou executável agora.</p>`}
      ${fora.length ? `<details class="fora-execucao"><summary>Fora da execução <span class="count">${fora.length}</span></summary>
        <ul class="lista rolavel" data-rolavel="fora-${f}">${fora.map(htmlSinal).join("")}</ul></details>` : ""}</div>`;
  });
  const semSinal = por.filter(([, l]) => !l.length).map(([f]) => FONTES[f]);
  return `<section class="painel" aria-labelledby="h-sinais">
    <h2 id="h-sinais">${ico("zap")} Sinais ativos <span class="count">${total}</span>${filtroAtivo ? `<span class="count">${iconeAtivo(filtroAtivo)} ${esc(filtroAtivo)}</span>` : ""}</h2>
    ${htmlFiltroAtivo(e)}
    ${cartoes.length ? `<div class="grade-cartoes larga sinais">${cartoes.join("")}</div>` : `<p class="vazio">Nenhum sinal ativo${filtroAtivo ? ` em ${esc(filtroAtivo)}` : ""}.</p>`}
    ${cartoes.length && semSinal.length ? `<p class="meta nota">Sem sinal ativo: ${semSinal.join(", ")}.</p>` : ""}
  </section>`;
}

// Saúde de uma fonte, num lugar só (cartão do Monitor, resumo da seção, pontos do submenu e faixa da Visão geral):
// ok = no ar sem problema; atencao = no ar com algo a resolver (login, itens sem dados) ou sem nenhum dado publicado;
// parada = atrasada ou pausada sozinha; inativa = desligada pelo dashboard ou fim de semana (esperado).
const NIVEL_SAUDE = { ok: ["good", "no ar", "check"], atencao: ["warning", "atenção", "alert"], parada: ["critical", "parada", "alert"], inativa: ["muted", "inativa", "pause"] };
function saudeFonte(f, e) {
  const info = (e.monitorFontes ?? []).find((x) => x.fonte === f);
  const periodica = FONTES_PERIODICAS.has(f);
  // fonte periódica (agentes): está "no ar" enquanto a próxima rodada prevista não atrasar mais de 10 min
  const atraso = !info ? Infinity : periodica ? (info.proxima_execucao ? (Date.now() - new Date(info.proxima_execucao)) / 6e4 - 10 : 0)
    : (Date.now() - new Date(info.atualizado_em)) / 6e4;
  const querLigado = e.monitorComando?.[f] !== false;  // sem comando = ligado
  const desligado = !!info && !info.ligado && /desligado pelo dashboard/.test(info.resumo ?? "");
  // mercado fechado (sex 17:00 → dom 18:00 NY): o monitor para sozinho e volta na abertura (regra do Diogo, 30/10/2026)
  const fimDeSemana = !!info && !info.ligado && /^fim de semana/.test(info.resumo ?? "");
  // Bovespa (16/11/2026): fora do pregão da B3 a fonte para sozinha e volta na abertura; é esperado, não "pausado"
  const foraDoPregao = !!info && !info.ligado && /fora do pregão/.test(info.resumo ?? "");
  const status = !info ? (e.contexto && e.contexto !== "forex" ? { t: "ainda não configurada", nivel: "inativa" } : { t: "sem dados", nivel: "atencao" })
    : atraso > 3 ? { t: periodica ? `rodada atrasada ${duracao(info.proxima_execucao)}` : `sem sinal há ${duracao(info.atualizado_em)}`, nivel: "parada" }
    : desligado ? { t: "desligado", nivel: "inativa" } : fimDeSemana ? { t: "fim de semana", nivel: "inativa" }
    : foraDoPregao ? { t: "fora do pregão", nivel: "inativa" }
    : info.ligado ? { t: "no ar", nivel: "ok" } : { t: "pausado", nivel: "parada" };
  // no ar, mas com algo a resolver: vira "atenção" e diz o quê
  const motivos = [];
  if (status.nivel === "ok") {
    const login = e.loginFonte?.youtube;
    if (f === "youtube" && (e.contexto ?? "forex") === "forex" && (!login || login.estado !== "logado")) motivos.push("sem login");  // o login é do YouTube do Forex
    if (f === "tiktok" && tiktokSemLogin(e)) motivos.push("sem login");  // sessão da @diogofabri2 vencida (17/11/2026)
    const semDados = (e.monitorItens ?? []).filter((i) => i.fonte === f && (i.estado === "sem_dados" || i.estado === "erro")).length;
    if (semDados) motivos.push(`${semDados} sem dados`);
    if (motivos.length) status.nivel = "atencao";
  }
  status.c = NIVEL_SAUDE[status.nivel][0];
  return { info, periodica, atraso, querLigado, desligado, status, motivos };
}

// máquina dona de cada fonte (12/11/2026: VPS em operação, Mac só leitura). Posse vencida (> 5 min sem renovar) = ninguém.
function maquinaDaFonte(f, e) {
  const m = (e.monitorMaquinas ?? []).find((x) => x.fonte === f);
  if (!m) return null;
  return { nome: m.maquina, viva: (Date.now() - new Date(m.visto_em)) / 6e4 <= 5, visto: m.visto_em };
}

function htmlMaquinaFonte(f, e) {
  const m = maquinaDaFonte(f, e);
  if (!m) return "";
  return m.viva ? `<span title="Máquina dona da fonte (renovada há ${duracao(m.visto)})">em <b>${esc(m.nome)}</b></span>`
    : `<span title="Nenhuma máquina renovou a posse desta fonte há ${duracao(m.visto)}">sem máquina (última: <b>${esc(m.nome)}</b>)</span>`;
}

// quem opera o quê (13/11/2026): cada fonte opera numa só máquina, então Mac e VPS ao mesmo tempo é a divisão
// normal, não alerta; a máquina sem nenhuma fonte está em modo leitura e não aparece. Fonte sem dono já pinta a saúde.
function htmlOperacao(e) {
  const porMaquina = {};
  fontesDoCtx().forEach((f) => { const m = maquinaDaFonte(f, e); if (m?.viva) (porMaquina[m.nome] ??= []).push(f); });
  const operando = Object.entries(porMaquina).sort(([a], [b]) => a.localeCompare(b))
    .map(([maq, fs]) => htmlBadge("muted", `${maq}: ${fs.map((f) => FONTES[f] ?? f).join(", ")}`, "radio")).join("");
  // máquina em leitura não tem posse de nenhuma fonte: vem do modo que ela mesma gravou ao trocar
  const leitura = Object.entries(e.maquinasModo ?? {}).filter(([maq, v]) => v?.modo === "leitura" && !porMaquina[maq])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([maq, v]) => `<span title="Em modo leitura desde ${esc(quando(v.em))}: não monitora nada, só consome o banco único">${htmlBadge("muted", `${maq}: só leitura`, "eye")}</span>`).join("");
  return operando + leitura;
}

// troca de máquina pelo dashboard (13/11/2026): as fontes que rodam nas duas máquinas passam para a outra; MT5 e o
// YouTube da B3 só existem no Windows e ficam sempre no VPS. Quem aplica é o seguidor de cada máquina, a cada minuto.
const FONTES_MOVEIS = ["tiktok", "youtube", "sites", "agentes", "tradingview", "telegram"];
const NOME_MAQUINA = { mac: "Mac", vps: "VPS" };

function quemOpera(e) {
  const plano = e.maquinasPlano?.maquinas;
  const n = { mac: 0, vps: 0 };
  if (plano) FONTES_MOVEIS.forEach((f) => ["mac", "vps"].forEach((m) => { if ((plano[m] ?? []).includes(f)) n[m]++; }));
  else FONTES_MOVEIS.forEach((f) => { const m = maquinaDaFonte(f, e); if (m?.viva && m.nome in n) n[m.nome]++; });
  return n.mac > n.vps ? "mac" : "vps";
}

// aguardando = nenhuma máquina leu o pedido ainda; aplicando = plano novo gravado, falta máquina registrar o modo
function estadoTroca(e) {
  const pedido = e.maquinasPedido, plano = e.maquinasPlano;
  if (!pedido?.em) return null;
  const desde = (Date.now() - new Date(pedido.em)) / 6e4;
  if (!(plano?.pedido_em >= pedido.em)) return { fase: "aguardando", alvo: pedido.operar, desde };
  if (plano.pedido_em !== pedido.em) return null;
  const igual = (a, b) => [...(a ?? [])].sort().join() === [...(b ?? [])].sort().join();
  const atras = ["mac", "vps"].filter((m) => !igual(e.maquinasModo?.[m]?.fontes, plano.maquinas?.[m]));
  return atras.length ? { fase: "aplicando", alvo: pedido.operar, atras, desde } : null;
}

function htmlTrocaMaquina(e) {
  const t = estadoTroca(e);
  if (t) {
    // etapas: 1 pedido enviado (as máquinas leem a cada minuto) → 2 a outra para → 3 o alvo liga e registra o modo
    const sai = t.alvo === "mac" ? "vps" : "mac";
    const etapa = t.fase === "aguardando" ? "pedido enviado" : t.atras.includes(sai) ? `parando o ${NOME_MAQUINA[sai]}` : `ligando o ${NOME_MAQUINA[t.alvo]}`;
    // passou de 10 min: provavelmente o Mac está dormindo, sem o Rancher aberto ou sem o seguidor instalado
    const lento = t.desde > 10;
    const dica = `Pedido de ${quando(e.maquinasPedido.em)}. Etapas: pedido enviado (cada máquina confere a cada minuto) → parando a máquina que sai → ligando a que entra. Leva de 1 a 5 min; as fontes do navegador só assumem na máquina nova depois de a outra soltar a posse.`
      + (lento ? " Passou de 10 min: confira se a máquina está ligada, com o Rancher aberto (Mac) e com o seguidor instalado." : "");
    // texto curto (cabe no celular); o detalhe vai na dica
    return `<span class="badge ${lento ? "critical" : "warning girando"}" role="status" title="${esc(dica)}">${ico(lento ? "alert" : "loader")}${lento ? `troca para o ${NOME_MAQUINA[t.alvo]} parada` : `${NOME_MAQUINA[t.alvo]}: ${etapa}`} · <span class="num" data-decorrido="${esc(e.maquinasPedido.em)}">${textoDecorrido(e.maquinasPedido.em)}</span></span>`;
  }
  const atual = quemOpera(e), outra = atual === "mac" ? "vps" : "mac";
  return `<button class="btn pequeno" data-acao="trocar-maquina" data-maquina="${outra}" title="As fontes operam hoje no ${NOME_MAQUINA[atual]}. Passa TikTok, YouTube, Sites, Agentes, TradingView e Telegram para o ${NOME_MAQUINA[outra]}; o MT5 e o YouTube da Bovespa ficam no VPS.">${ico("radio")} Operar no ${NOME_MAQUINA[outra]}</button>`;
}

// Prioridade entre Forex e Bovespa (17/11/2026, pedido do Diogo): a CPU do VPS não dá para todas as lives dos dois
// mercados. O mercado sem prioridade fica com no máximo 1 live aberta; "Bovespa" vale só no pregão da B3 e, nele, o
// YouTube do Forex não abre lives de robô.
const PRIORIDADES = [["bovespa", "Prioridade Bovespa", "No pregão da B3, o TikTok e o YouTube do Forex ficam com no máximo 1 live aberta cada (sem lives de robô no YouTube) e a Bovespa usa o resto da máquina. Fora do pregão, vale o Normal."],
  ["normal", "Normal", "Sem prioridade: cada fonte abre quantas lives a CPU e a memória da máquina deixarem."],
  ["forex", "Prioridade Forex", "O YouTube da Bovespa fica com no máximo 1 live aberta; o Forex usa o resto da máquina."]];

// troca automática (20/11/2026, pedido do Diogo; monitor_lives/prioridade_auto.py, pelo seguidor do VPS)
const PRIORIDADE_AUTO = "Troca sozinho nos dias de pregão da B3: Prioridade Bovespa às 08:45 de Brasília (15 min antes da abertura) e Prioridade Forex às 18:30 (fecho). Uma troca feita aqui vale até o próximo horário.";

function htmlPrioridade(e) {
  const atual = e.prioridade ?? "normal";
  return `<span class="segmentado prioridade" role="group" aria-label="Prioridade dos navegadores" title="${esc(PRIORIDADE_AUTO)}"><span class="seg-rot">Lives</span>${PRIORIDADES.map(([k, rot, dica]) =>
    `<button type="button" data-acao="prioridade" data-modo="${k}" aria-pressed="${k === atual}" title="${esc(`${dica} ${PRIORIDADE_AUTO}`)}">${rot}</button>`).join("")}</span>`;
}

function htmlResumoSaude(e) {
  const n = { ok: 0, atencao: 0, parada: 0, inativa: 0 };
  fontesDoCtx().forEach((f) => n[saudeFonte(f, e).status.nivel]++);
  return Object.entries(n).filter(([, v]) => v).map(([k, v]) => { const [cls, rot, icone] = NIVEL_SAUDE[k]; return htmlBadge(cls, `${v} ${v > 1 && k === "parada" ? "paradas" : v > 1 && k === "inativa" ? "inativas" : rot}`, icone); }).join("");
}

function htmlMonitor(e) {
  const fontes = fontesDoCtx().map((f) => {
    const itens = e.monitorItens.filter((i) => i.fonte === f)
      .sort((a, b) => (ORDEM_ESTADO[a.estado] ?? 9) - (ORDEM_ESTADO[b.estado] ?? 9) || (b.espectadores ?? 0) - (a.espectadores ?? 0));
    const visiveis = itens.filter((i) => !COMO_SITES.has(f) || !i.item.split(":").pop() || passaFiltro(i.item.split(":").pop()));
    const { info, periodica, atraso, querLigado, desligado, status, motivos } = saudeFonte(f, e);
    const rodada = periodica && info ? `<div class="meta">
        <span>último acionamento ${info.ultima_execucao ? `<b class="num" data-desde="${esc(info.ultima_execucao)}">${textoDesde(info.ultima_execucao)}</b>` : "<b>nunca</b>"}</span>
        ${info.proxima_execucao && info.ligado ? `<span>próximo em <b class="num" data-ate="${esc(info.proxima_execucao)}">${textoContador(info.proxima_execucao)}</b></span>` : ""}
        ${info.intervalo_min ? `<span>a cada ${info.intervalo_min} min</span>` : ""}</div>` : "";
    const nItens = COMO_SITES.has(f) ? new Set(visiveis.map((i) => i.item.split(":")[0])).size : visiveis.length;
    // o comando leva até ~10 s para chegar e ~1 min para o estado voltar ao painel
    const pendente = info && atraso <= 3 && querLigado === desligado;
    const botao = `<button class="btn pequeno ${querLigado ? "" : "primario"}" data-acao="monitor" data-fontes="${f}" data-ligar="${!querLigado}" aria-label="${querLigado ? "Desligar" : "Ligar"} ${esc(FONTES[f])}" title="${querLigado ? "Desligar" : "Ligar"} ${esc(FONTES[f])}">${ico(querLigado ? "power" : "play")}<span class="rotulo-btn">${querLigado ? "Desligar" : "Ligar"}</span></button>`;
    const aviso = pendente ? `<span class="badge warning">${ico("loader")}${querLigado ? "ligando…" : "desligando…"}</span>`
      : atraso > 3 && info ? `<span class="meta">${periodica ? "o executor dos agentes parou: conferir o launchd com.vinculo.agentes e o log em 05-monitor-lives/dados-agentes/logs/" : `o contêiner não responde: no Mac/VPS, <code>docker compose up -d ${f}</code>`}</span>` : "";
    const selo = status.nivel === "ok" || (status.nivel === "atencao" && info)
      ? `<span class="badge good"><i class="ponto vivo" aria-hidden="true"></i>${status.t}</span>`
      : htmlBadge(status.c, status.t, NIVEL_SAUDE[status.nivel][2]);
    return `<div class="cartao" data-fonte="${f}" data-saude="${status.nivel}">
      <div class="cartao-topo">
      <div class="titulo titulo-fonte"><span class="nome-fonte">${FONTES[f]}</span>${botao}</div>
      <div class="meta estado-fonte">${selo}${motivos.filter((m) => m !== "sem login").map((m) => htmlBadge("warning", m, "alert")).join("")}${info ? `<span>atualizado ${quando(info.atualizado_em)}</span>` : ""}${htmlMaquinaFonte(f, e)}</div>
      ${aviso ? `<div class="meta">${aviso}</div>` : ""}
      ${f === "youtube" ? htmlLoginYoutube(e) : f === "tiktok" ? htmlLoginTiktok(e) : ""}
      ${htmlBotaoAudio(f, e)}
      ${info && (info.vagas || info.resumo) ? `<div class="meta"><span>${esc(info.vagas ?? "")}</span><span>${esc(info.resumo ?? "")}</span></div>` : ""}
      ${rodada}
      ${resumoStatusFonte(f, visiveis)}
      </div>
      <details class="fila"><summary>${ico("chevron")}${GRUPOS_FONTE[f].titulo} <span class="count">${nItens}</span></summary>
        ${(COMO_SITES.has(f) ? htmlStatusSites(visiveis, f) : htmlStatusFonte(f, visiveis)) || `<p class="vazio">Os itens com sinal aberto estão em Sinais ativos.</p>`}
        ${f === "agentes" && info ? htmlModosAgentes(e) : ""}</details>
    </div>`;
  });
  const algum = fontesDoCtx().some((f) => e.monitorComando?.[f] !== false);
  // leitura × escrita (21/11/2026): o título só diz o estado; os comandos raros (corretora, máquina, consenso, desligar
  // todos) ficam recolhidos em "Comandos do monitor", com o estado atual escrito ao lado. O seletor das lives continua
  // à vista (pedido do Diogo) e a troca de máquina em andamento também, porque é estado, não comando.
  const troca = htmlTrocaMaquina(e), trocando = troca.startsWith("<span");
  const fx = ctxLente === "forex";
  const estadoCmd = fx ? `${NOME_CORRETORA_FX[e.execucao?.corretora ?? "capitalcom"]} · consenso ${e.consensoLigado ? "ligado" : "desligado"}` : "";
  return `<section class="painel" aria-labelledby="h-monitor">
    <h2 id="h-monitor">${ico("radio")} Saúde das fontes <span class="resumo-saude">${htmlResumoSaude(e)}${htmlOperacao(e)}</span></h2>
    <div class="comandos-monitor">${htmlPrioridade(e)}${trocando ? troca : ""}
      <details class="mais-comandos"><summary>${ico("chevron")}<span class="rot-cmd">Comandos do monitor</span>${estadoCmd ? ` <span class="estado-cmd">${estadoCmd}</span>` : ""}</summary>
        <div class="comandos-lista">${fx ? htmlSeletorCorretora(e) : ""}${trocando ? "" : troca}${fx ? `<button class="btn pequeno" data-acao="consenso" data-ligar="${!e.consensoLigado}" aria-pressed="${e.consensoLigado ? "true" : "false"}" title="${e.consensoLigado ? "Consenso ligado: só sai sinal quando vários canais do TikTok e do YouTube concordam." : "Consenso desligado: cada canal com leitura válida gera o seu próprio sinal ativo."}">${ico("radio")} Consenso: ${e.consensoLigado ? "ligado" : "desligado"}</button>` : ""}
        <button class="btn pequeno" data-acao="monitor" data-fontes="${fontesDoCtx().join(",")}" data-ligar="${!algum}">${ico(algum ? "power" : "play")} ${algum ? "Desligar todos" : "Ligar todos"}</button></div>
      </details></div>
    <div class="grade-cartoes fontes">${fontes.join("")}</div>
  </section>`;
}

// login da @diogofabri2 no TikTok (17/11/2026): o monitor publica controle.login:tiktok = sem_login quando os canais
// pedem login (sessão vencida no servidor com o cookie ainda no perfil). Valor com mais de 15 min = sem informação.
function tiktokSemLogin(e) {
  if ((e.contexto ?? "forex") !== "forex") return false;
  const l = e.loginFonte?.tiktok;
  return !!l && l.estado === "sem_login" && (Date.now() - new Date(l.atualizado_em)) / 6e4 <= 15;
}

function htmlLoginTiktok(e) {
  if (!tiktokSemLogin(e)) return "";
  const l = e.loginFonte.tiktok;
  const canais = (l.canais ?? []).filter((c) => !c.startsWith("(")).map((c) => "@" + c);
  return `<div class="meta"><span class="badge critical">${ico("alert")}sem login na @diogofabri2</span>
    <span title="${esc(canais.join(", "))}">${canais.length ? `${canais.length} ${canais.length === 1 ? "canal pediu" : "canais pediram"} login` : "perfil sem sessão"}: lives com restrição de idade não abrem.</span>
    <span title="${esc("No VPS, em 05-monitor-lives: " + (l.comando ?? "nativo login tiktok"))}">Refazer o login no VPS (passos no Telegram).</span></div>`;
}

// login da conta Google do monitor (YouTube): o estado vem do contêiner; a senha é digitada só no noVNC, nunca aqui
function htmlLoginYoutube(e) {
  if ((e.contexto ?? "forex") !== "forex") return "";  // o login de hoje é da conta Google do YouTube do Forex
  const l = e.loginFonte?.youtube;
  if (!l || (Date.now() - new Date(l.atualizado_em)) / 6e4 > 10) {
    return `<div class="meta"><span>Login da conta Google: sem informação (o contêiner do YouTube está parado?)</span></div>`;
  }
  const botao = (texto, primario) => `<button class="btn pequeno ${primario ? "primario" : ""}" data-acao="login" data-fonte="youtube">${texto}</button>`;
  if (l.estado === "logado") {
    return `<div class="meta"><span class="badge good">${ico("check")}conta Google logada</span>${botao("Trocar conta", false)}</div>`;
  }
  if (l.estado === "aguardando") {
    return `<div class="meta"><span class="badge warning">${ico("loader")}janela de login aberta</span>
      <a class="btn pequeno primario" href="${esc(l.novnc)}" target="_blank" rel="noopener">${ico("external")} Abrir noVNC</a>
      <span>Entre na conta lá (a senha é digitada só lá) e feche a janela do Chromium. O monitor volta sozinho.</span></div>`;
  }
  if (e.loginPedido?.youtube) {
    return `<div class="meta"><span class="badge warning">${ico("loader")}abrindo a janela de login…</span><span>leva até ~10 s</span></div>`;
  }
  return `<div class="meta"><span class="badge critical">sem login na conta Google</span>${botao("Entrar", true)}
    <span>Abre uma janela no noVNC; e-mail e senha são digitados só lá.</span></div>`;
}

// ---------- termômetro (painel do Monitor) ----------
// Lê controle.termometro:painel (executor dos agentes, a cada ~15 min). Contexto e confirmação, não sinal de entrada.
const ROTULO_DIRECAO = { alta: ["Alta", "good"], baixa: ["Baixa", "critical"], neutra: ["Neutra", "muted"] };
const sinal2 = (v) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctSinal = (v) => v == null ? "—" : `${sinal2(v)}%`;
const REGIME_TXT = { tendencia: "em tendência", lateral: "lateral", volatil: "volátil" };
const SENTIMENTO_TXT = { "aguardando chave": "Capital.com: aguardando a chave da API", "mercado fechado": "mercado fechado" };

const NOME_DRIVER = { DXY: "DXY", US10Y: "Juro 10 anos", EURUSD: "EUR/USD", USDJPY: "USD/JPY", VIX: "VIX", US500: "S&P 500", US100: "US100", US30: "US30",
  GOLD: "Ouro", SILVER: "Prata", COPPER: "Cobre", BRENT: "Brent", CRUDEOIL: "WTI" };
const ficha = (i) => `<span class="ficha">${esc(NOME_DRIVER[i.nome] ?? i.nome)} <b class="num">${i.variacao_pct == null ? "" : pctSinal(i.variacao_pct)}</b>${i.regime ? ` <abbr title="Relação medida só em 2025–26; no longo prazo muda de sinal.">regime</abbr>` : ""}</span>`;
const linhaFichas = (cls, icone, rotulo, itens) => itens?.length ? `<div class="termo-linha ${cls}">${ico(icone)}<span class="rot">${rotulo}</span><span class="fichas">${itens.map(ficha).join("")}</span></div>` : "";

// "Por que …": a leitura em linhas curtas, com ícone e título, em vez de um parágrafo
function htmlPorQue(a) {
  const [rot] = ROTULO_DIRECAO[a.direcao] ?? ["Sem leitura"];
  if (!a.alinhamento) return `<div class="termo-bloco"><div class="termo-sec-titulo">${ico("bulb")} Por que ${esc(rot.toLowerCase())}</div><p class="termo-leitura">${esc(a.motivo)}</p></div>`;
  const al = a.alinhamento, reg = REGIME_TXT[a.tf?.h1?.regime];
  const neutra = a.direcao === "neutra";
  const base = neutra ? `Sem direção clara: H1 e M15 não se alinham${reg ? ` · ${reg}` : ""}` : `${a.confirmacao}${reg ? ` · ${reg}` : ""}`;
  const semLeitura = al.sem_leitura?.length ? `<div class="termo-linha sem">${ico("alert")}<span class="rot">Sem cotação</span><span class="fichas">${al.sem_leitura.map((i) => `<span class="ficha">${esc(NOME_DRIVER[i.nome] ?? i.nome)}</span>`).join("")}</span></div>` : "";
  return `<div class="termo-bloco">
    <div class="termo-sec-titulo">${ico("bulb")} Por que ${esc(rot.toLowerCase())}${a.forca ? " forte" : ""}</div>
    <div class="termo-linha base">${ico("activity")}<span>${esc(base)}</span></div>
    ${neutra ? linhaFichas("favor", "alta", "Pedem alta", al.a_favor) + linhaFichas("contra", "baixa", "Pedem queda", al.contra)
             : linhaFichas("favor", "check", "A favor", al.a_favor) + linhaFichas("contra", "x", "Contra", al.contra)}
    ${linhaFichas("parado", "pause", "Parados", al.parado)}${semLeitura}
  </div>`;
}

// máxima, mínima e VWAP da sessão (velas M5 do monitor; a sessão começa às 17:00 de Nova York)
function htmlFaixaDia(a) {
  const d = a.dia_faixa;
  if (!d) return "";
  const amp = d.maxima - d.minima, pos = (v) => amp > 0 ? Math.max(0, Math.min(100, ((v - d.minima) / amp) * 100)) : 50;
  const noPreco = Math.round(pos(d.preco));
  const dv = d.vwap == null ? null : ((d.preco - d.vwap) / d.vwap) * 100;
  const leituraVwap = dv == null ? `VWAP indisponível: o feed não traz volume` : `${ico(dv >= 0 ? "alta" : "baixa")} Preço <b class="num">${preco2(Math.abs(dv))}%</b> ${dv >= 0 ? "acima" : "abaixo"} da VWAP`;
  const sessao = d.sessao === "anterior" ? "última sessão" : "sessão desde 17:00 NY";
  return `<div class="termo-bloco" role="group" aria-label="Faixa do dia: máxima ${preco2(d.maxima)}, mínima ${preco2(d.minima)}${d.vwap == null ? "" : `, VWAP ${preco2(d.vwap)}`}, preço a ${noPreco}% da faixa">
    <div class="termo-sec-titulo">${ico("faixa")} Faixa do dia <small>${sessao}</small></div>
    <div class="termo-faixa-nums"><div><small>Máxima</small><b class="num">${preco2(d.maxima)}</b></div><div><small>VWAP</small><b class="num">${d.vwap == null ? "—" : preco2(d.vwap)}</b></div><div><small>Mínima</small><b class="num">${preco2(d.minima)}</b></div></div>
    <div class="termo-trilho" aria-hidden="true">${d.vwap == null ? "" : `<i style="left:${pos(d.vwap)}%" title="VWAP"></i>`}<b style="left:${pos(d.preco)}%" title="Preço"></b></div>
    <div class="termo-leitura">${leituraVwap} · a <b class="num">${noPreco}%</b> da faixa do dia</div>
  </div>`;
}

// o que a corretora cobra e exige agora (API da Capital.com): spread real, margem (alavancagem) e tamanho mínimo da operação
const ESTADO_MERCADO = { TRADEABLE: null, CLOSED: "Fechado", EDITS_ONLY: "Só edição", AUCTION: "Leilão", SUSPENDED: "Suspenso" };
function htmlCorretora(a) {
  const c = a.corretora;
  if (!c) return "";
  const estado = c.estado in ESTADO_MERCADO ? ESTADO_MERCADO[c.estado] : c.estado;
  const alav = c.margem_pct > 0 ? `${Math.round(100 / c.margem_pct)}×` : "—";
  const tam = c.tamanho_minimo == null ? "—" : Number(c.tamanho_minimo).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return `<div class="termo-bloco" role="group" aria-label="Na corretora: spread ${preco2(c.spread)}, margem ${c.margem_pct}%, tamanho mínimo ${tam}">
    <div class="termo-sec-titulo">${ico("target")} Na corretora <small>Capital.com, agora</small>${estado ? htmlBadge("warning", estado, "alert") : ""}${c.spread_alto ? htmlBadge("warning", `Spread ${Number(c.spread_x).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× o normal`, "alert") : ""}</div>
    <div class="termo-faixa-nums"><div><small>Spread</small><b class="num">${preco2(c.spread)}</b>${c.spread_normal != null ? `<small>normal ${preco2(c.spread_normal)}</small>` : ""}</div><div><small>Margem</small><b class="num">${c.margem_pct ?? "—"}%</b> <small>${alav}</small></div><div><small>Mínimo</small><b class="num">${tam}</b></div></div>
  </div>`;
}

function htmlSentimentoTermo(a, estadoGeral) {
  const s = a.sentimento;
  if (!s) {
    const txt = estadoGeral === "capital.com" ? "Clientes Capital.com: sem dado deste ativo agora" : (SENTIMENTO_TXT[estadoGeral] ?? "Clientes Capital.com: indisponível agora");
    return `<div class="termo-sent vazio"><div class="termo-sent-topo"><span>${ico("pessoas")} ${esc(txt)}</span></div></div>`;
  }
  const c = Math.round(s.compra), v = 100 - c;
  return `<div class="termo-sent" role="group" aria-label="Clientes da Capital.com: ${c}% comprados, ${v}% vendidos">
    <div class="termo-sent-topo"><span>${ico("pessoas")} Clientes Capital.com</span>${htmlBadge("muted", s.leitura.charAt(0).toUpperCase() + s.leitura.slice(1))}</div>
    <div class="termo-barra" aria-hidden="true"><i class="compra" style="width:${c}%"></i><i class="venda" style="width:${v}%"></i></div>
    <div class="termo-sent-nums"><span class="compra">${ico("alta")}<b class="num">${c}%</b> comprados</span><span class="venda"><b class="num">${v}%</b> vendidos${ico("baixa")}</span></div>
  </div>`;
}

function htmlTermometroAtivo(a, estadoGeral) {
  const [rot, cls] = ROTULO_DIRECAO[a.direcao] ?? ["Sem leitura", "muted"];
  const velho = a.idade_min != null && a.idade_min > 45;
  const tfs = a.tf ? ["h1", "m15", "m5"].map((k) => `<span>${k.toUpperCase()} <b class="num">${sinal2(a.tf[k]?.pontuacao)}</b></span>`).join("") : "";
  const reg = a.tf?.h1?.regime ? `<span>${esc(REGIME_TXT[a.tf.h1.regime] ?? a.tf.h1.regime)}${a.tf.h1.adx != null ? ` · ADX <b class="num">${numero(a.tf.h1.adx)}</b>` : ""}</span>` : "";
  return `<div class="cartao termo">
    <div class="titulo">${iconeAtivo(a.id)} ${esc(a.nome)} ${a.direcao ? htmlBadge(cls, rot + (a.forca ? " forte" : ""), a.direcao === "alta" ? "alta" : a.direcao === "baixa" ? "baixa" : undefined) : htmlBadge("muted", rot)}${a.divergencia ? htmlBadge("warning", "Divergência", "alert") : ""}</div>
    ${a.preco != null ? `<div class="meta"><span class="num">${esc(preco2(a.preco))}</span><span>dia <b class="num">${pctSinal(a.variacao_dia_pct)}</b></span>${a.d1 != null ? `<span>nota D1 <b class="num">${sinal2(a.d1)}</b></span>` : ""}</div>` : ""}
    ${tfs ? `<div class="meta">${tfs}${reg}</div>` : ""}
    ${htmlPorQue(a)}
    ${htmlFaixaDia(a)}
    ${htmlCorretora(a)}
    ${htmlSentimentoTermo(a, estadoGeral)}
    ${velho ? `<div class="meta"><span class="atraso">${ico("clock")}velas de há ${esc(duracaoMin(a.idade_min))}</span></div>` : ""}
  </div>`;
}

const preco2 = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const duracaoMin = (min) => min >= 120 ? `${Math.round(min / 60)} h` : `${Math.round(min)} min`;

function origemVelas(t) {
  const fontes = new Set(t.ativos.map((a) => a.fonte_velas).filter(Boolean));
  if (!fontes.size) return "sem dados";
  if (fontes.size === 1) return fontes.has("capital.com") ? "Capital.com (preço de compra)" : "TradingView (reserva)";
  return "Capital.com e TradingView (reserva em parte)";
}

function htmlTermometro(e) {
  const t = e.termometro;
  if (!t?.ativos?.length) {
    return `<section class="painel" aria-labelledby="h-termo">
      <h2 id="h-termo">${ico("activity")} Termômetro</h2>
      <p class="vazio">Ainda sem leitura: o executor dos agentes publica o termômetro a cada ~15 min depois de terminar a próxima rodada.</p>
    </section>`;
  }
  const fechado = t.mercado === "fechado";
  const sent = SENTIMENTO_TXT[t.sentimento] ?? (t.sentimento === "capital.com" ? "Capital.com: sentimento dos clientes" : `Capital.com: ${t.sentimento}`);
  return `<section class="painel" aria-labelledby="h-termo">
    <h2 id="h-termo">${ico("activity")} Situação por ativo <span class="count">${t.ativos.length} ativos</span>${fechado ? htmlBadge("muted", "mercado fechado", "clock") : ""}</h2>
    <div class="meta termo-fonte">
      <span>atualizado <b class="num" data-desde="${esc(t.atualizado_em)}">${textoDesde(t.atualizado_em)}</b></span>
      ${t.proxima_em && !fechado ? `<span>próxima em ~<b class="num" data-ate="${esc(t.proxima_em)}">${textoContador(t.proxima_em)}</b> (a cada ${t.intervalo_min} min)</span>` : ""}
      <span>direcionadores: ${t.cotacoes === "tradingview" ? "TradingView" : "sem cotações agora"}</span>
      <span>velas: ${origemVelas(t)}</span>
      ${fechado ? "" : t.sentimento === "capital.com" ? htmlBadge("good", "Capital.com conectada", "check") : htmlBadge(String(t.sentimento).startsWith("erro") ? "critical" : "warning", sent, "alert")}
    </div>
    <div class="grade-cartoes larga">${t.ativos.map((a) => htmlTermometroAtivo(a, t.sentimento)).join("")}</div>
    <p class="meta termo-nota">Contexto e confirmação, não sinal de entrada: nos testes de 03/11/2026 os direcionadores acompanham o movimento do ativo, mas não o antecipam. Tendência = pontuação do multi-tf (−1 a +1; acima de ±0,30 em H1 e M15 há direção). "Regime 2025–26" = relação medida só neste período. Uso pessoal; não é recomendação.</p>
  </section>`;
}

// Monitor: o que muda minuto a minuto (sinais e saúde das fontes) em cima; termômetro e placar resumidos, com link para o detalhe.
// Pendências do monitor ficam na Visão geral; o termômetro completo em #/termometro (decisões do Diogo, 11/11/2026).
const NOTA_USO = `<p class="meta nota">Uso pessoal: sinais só para o Diogo, nunca compartilhar. Não é recomendação.</p>`;
const avisoErro = () => erro ? `<div class="aviso erro">${ico("alert")}<span>${esc(erro)}</span></div>` : "";

// Contexto sem nenhuma fonte publicando ainda (Bovespa antes de o monitor rodar): diz o que falta, em vez de tela em branco
function vistaContextoVazio(titulo) {
  const c = CONTEXTOS[ctxLente];
  return `<main class="uma">
    ${avisoErro()}
    <div class="cabecalho-proj compacto" style="--cor:${cor("monitor")}">
      <div class="bloco">
        <a class="voltar" href="#/">${ico("back")} Visão geral</a>
        <h1><i class="ponto" aria-hidden="true"></i>${esc(titulo)}</h1>
        <p class="resumo">Nenhuma fonte da ${esc(c.nome)} publicou ainda. Quando o monitor do contexto rodar, as fontes, os sinais e o placar aparecem aqui sozinhos.</p>
      </div>
    </div>
    <section class="painel" aria-labelledby="h-falta">
      <h2 id="h-falta">${ico("list")} O que ainda precisa existir</h2>
      <ul class="lista compacta">
        <li>Canais configurados e o monitor da fonte ligado (<code>${esc(ctxLente)}</code> no <code>07-monitor-${esc(ctxLente)}/</code>).</li>
        <li>Grupo de Telegram do contexto com o bot (variável <code>TG_${esc(ctxLente.toUpperCase())}_CHAT_ID</code>).</li>
        <li>Fonte de velas do contexto (TradingView ou exportador do MT5).</li>
        <li>Execução: ${c.execucao ? "pelos botões Demo e Real de cada fonte." : "ainda não existe; por enquanto só sinais e placar."}</li>
      </ul>
    </section>
  </main>`;
}

function vistaMonitor() {
  const e = estado;
  if (ctxLente !== "forex" && !(e.monitorFontes ?? []).length) return vistaContextoVazio(`Monitor ${CONTEXTOS[ctxLente].nome}`);
  const p = e.projetos.find((x) => x.id === "monitor");
  const c = calcularProjeto("monitor", e);
  return `<main class="uma">
    ${avisoErro()}
    <div class="cabecalho-proj compacto" style="--cor:${cor("monitor")}">
      <div class="bloco">
        <a class="voltar" href="#/">${ico("back")} Visão geral</a>
        <h1><i class="ponto" aria-hidden="true"></i>${ctxLente === "forex" ? esc(PROJETOS.monitor.longo) : `Monitor ${esc(CONTEXTOS[ctxLente].nome)} (uso pessoal)`}</h1>
        ${ctxLente !== "forex" ? "" : p?.fase || c.cfg.status ? `<div class="meta">${p?.fase ? `<span>${esc(p.fase)}</span>` : ""}${c.cfg.status ? `<span>${esc(c.cfg.status)}</span>` : ""}</div>` : ""}
      </div>
    </div>
    ${htmlSinaisAtivos(e)}
    ${htmlAoVivo(e)}
    ${htmlMonitor(e)}
    ${htmlTermometroCompacto(e)}
    ${htmlPlacar(e)}
    ${htmlAtrasos(e)}
    ${NOTA_USO}
  </main>`;
}

function vistaTermometro() {
  return `<main class="uma">
    ${avisoErro()}
    <div class="cabecalho-proj compacto" style="--cor:${cor("monitor")}">
      <div class="bloco">
        <a class="voltar" href="#/monitor">${ico("back")} Monitor</a>
        <h1><i class="ponto" aria-hidden="true"></i>Termômetro</h1>
        <div class="meta"><span>Situação de cada ativo: tendência, direcionadores, faixa do dia, corretora e clientes da Capital.com.</span></div>
      </div>
    </div>
    ${htmlTermometro(estado)}
  </main>`;
}

// ---------- agentes de sinais (#/agentes, #/agentes/<id>) ----------
// Lê controle.agentes:painel (publicado pelo executor dos agentes a cada 5 min). Gesto da página: o eixo zero.
// Todo ganho/perda é uma barra que sai de uma linha central (ganho à direita, perda à esquerda) com o valor escrito.

const usd2 = (v) => { v = Number(v) || 0; return `${v < 0 ? "−" : v > 0 ? "+" : ""}US$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const r2 = (v) => { v = Number(v) || 0; return `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} R`; };
// agentes: saldo em US$ (lote do otimizador); tiktok, youtube e sites: saldo em R (múltiplos do risco), calculado dos resultados do placar
const SIMBOLO_MOEDA = { BRL: "R$", EUR: "€", USD: "US$" };
const moedaConta = (m) => (v) => { v = Number(v) || 0; return `${v < 0 ? "−" : v > 0 ? "+" : ""}${SIMBOLO_MOEDA[m] ?? m} ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const dinheiro = (a) => (a.unidade === "r" ? r2 : a.moeda && a.moeda !== "USD" ? moedaConta(a.moeda) : usd2);
const pct = (v) => v == null ? "—" : `${String(v).replace(".", ",")}%`;
const ESTADO_AUTO = { satisfeito: "good", "em ajuste": "warning", aprendendo: "muted" };
const STATUS_AGORA = { ATIVO: "good", "PRÓXIMO": "warning", "SEM SINAL": "muted", "SEM DADOS": "critical", ERRO: "critical" };
const NOME_DESFECHO = { alvo: "alvo", stop: "stop", expirado: "expirou" };

function barraZero(v, max, rotulo = usd2(v)) {
  const n = Number(v) || 0, w = max > 0 ? Math.min(50, (50 * Math.abs(n)) / max) : 0;
  const lado = n > 0 ? "ganho" : n < 0 ? "perda" : "zero";
  return `<span class="zero ${lado}"><span class="trilho" aria-hidden="true"><i style="width:${w.toFixed(1)}%"></i></span><b class="num">${esc(rotulo)}</b></span>`;
}

function seloModo(a) {
  const auto = a.por_ativo.find((x) => x.auto)?.auto;
  const selos = [];
  if (a.self_learning) selos.push(seloAuto(a.por_ativo_versao ? "self-learning por ativo" : `self-learning v${auto?.versao ?? 0}`));
  if (a.revisao_ia) selos.push(`<span class="badge muted" title="o Sonnet aprova ou veta, o Opus confirma">${ico("check")}revisão por IA</span>`);
  selos.push(a.ligado ? `<span class="badge good"><i class="ponto vivo" aria-hidden="true"></i>ligado</span>` : `<span class="badge muted">desligado</span>`);
  return selos.join("");
}

// cartão Agentes do monitor: o modo de cada agente (self-learning ou fixo) e o botão, dizendo a quem se aplica
function htmlModosAgentes(e) {
  const ags = (e.agentesPainel?.agentes ?? []).filter((a) => a.tipo !== "todos");
  if (!ags.length) return `<div class="meta">${controleSelfLearning(e.agentesPainel, { compacto: true })}<a href="#/agentes">Ver cada agente</a></div>`;
  const auto = ags.filter((a) => a.self_learning);
  const resumoAuto = (a) => {
    if (!a.por_ativo_versao) { const v = a.por_ativo.find((x) => x.auto)?.auto; return `self-learning v${v?.versao ?? 0} · ${v?.estado ?? "aprendendo"}`; }
    const n = (est) => a.por_ativo.filter((x) => x.auto?.estado === est).length;
    return `self-learning por ativo · ${[["satisfeito", "satisfeitos"], ["em ajuste", "em ajuste"], ["aprendendo", "aprendendo"]].map(([k, r]) => n(k) ? `${n(k)} ${r}` : "").filter(Boolean).join(", ")}`;
  };
  return `<div class="modos-agentes">
    <div class="meta"><b>Modo de cada agente</b></div>
    <ul class="lista compacta">${ags.map((a) => `<li><a href="#/agentes/${esc(a.id)}">${esc(a.id)}</a>
      ${a.self_learning ? seloAuto(resumoAuto(a)) : seloFixo()}${a.ligado ? "" : `<span class="badge muted">desligado</span>`}</li>`).join("")}</ul>
    ${auto.length ? `${controleSelfLearning(e.agentesPainel, { compacto: true })}<div class="meta">O botão vale só para: ${auto.map((a) => esc(a.id)).join(", ")}. Os fixos não mudam.</div>`
      : `<div class="meta">Nenhum agente com self-learning ligado.</div>`}
    <a href="#/agentes">Ver cada agente</a>
  </div>`;
}

function controleSelfLearning(p, { compacto = false } = {}) {
  const sl = p?.self_learning ?? { ligado: estado.selfLearning };
  const ligado = estado.selfLearning;
  const pendente = p && sl.ligado !== ligado;
  const prox = ligado && sl.proximo ? `próxima verificação em <b class="num" data-ate="${esc(sl.proximo)}">${textoContador(sl.proximo)}</b>` : "";
  const texto = pendente ? `<span class="badge warning">${ico("loader")}${ligado ? "ligando…" : "desligando…"}</span>`
    : `<span class="badge ${ligado ? "auto" : "muted"}">${ico("bulb")}self-learning ${ligado ? "ligado" : "desligado"}</span>`;
  return `<div class="ctl-sl ${compacto ? "compacto" : ""}">${texto}
    ${compacto ? "" : `<span class="meta">${prox || (ligado ? `verifica a cada ${numero(sl.cada_h ?? 6)} h` : "as rodadas continuam; só os ajustes param")}</span>`}
    <button class="btn pequeno ${ligado ? "" : "primario"}" data-acao="self-learning" data-ligar="${!ligado}">${ico(ligado ? "pause" : "play")} ${ligado ? "Pausar self-learning" : "Retomar self-learning"}</button></div>`;
}

function svgSaldo(a) {
  const pts = a.curva.map(([t, v]) => [new Date(t).getTime(), v]);
  // a curva começa no zero, como um extrato (16/11/2026): antes, o 1.º ponto já era o resultado da 1.ª operação e um
  // loss inicial parecia saldo que "nasceu" negativo
  if (pts.length && pts[0][1] !== 0) pts.unshift([pts[0][0] - 60e3, 0]);
  if (pts.length < 2) return `<p class="vazio">A curva aparece a partir de 2 operações resolvidas (${a.metricas.ops} até agora).</p>`;
  const estreito = innerWidth < 560;
  const W = estreito ? 360 : 640, H = estreito ? 180 : 210, L = 52, R = 12, T = 12, B = 26, w = W - L - R, h = H - T - B;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  let yMin = Math.min(0, ...pts.map((p) => p[1])), yMax = Math.max(0, ...pts.map((p) => p[1]));
  const folga = (yMax - yMin || 1) * 0.12; yMin -= yMin < 0 ? folga : 0; yMax += folga;
  const x = (t) => L + (w * (t - t0)) / Math.max(1, t1 - t0), y = (v) => T + h - (h * (v - yMin)) / (yMax - yMin);
  const d = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(t1).toFixed(1)},${y(0).toFixed(1)} L${x(t0).toFixed(1)},${y(0).toFixed(1)} Z`;
  // o zero sempre rotulado (é a linha de referência do saldo); rótulo a menos de 14 px de outro sai
  const ticks = (yMin < 0 ? [yMin, 0, yMax] : [0, yMax / 2, yMax]).filter((t, i, l) => i === 0 || t === 0 || Math.abs(y(t) - y(l[i - 1])) >= 14)
    .filter((t, i, l) => t === 0 || !l.includes(0) || Math.abs(y(t) - y(0)) >= 14);
  const trocas = (a.trocas ?? []).filter((m) => { const t = new Date(m.em).getTime(); return t >= t0 && t <= t1; });
  const ult = pts[pts.length - 1];
  const din = dinheiro(a), curto = a.unidade === "r" ? (t) => String(Math.round(t * 10) / 10).replace(".", ",") : usdCurto;
  const desc = `Saldo acumulado de ${a.id}: ${din(ult[1])} em ${a.metricas.ops} operações, de ${dataCurta(a.curva[0][0])} a ${dataCurta(a.curva[a.curva.length - 1][0])}. Queda máxima ${din(-a.metricas.drawdown_usd)}.`;
  return `<div class="grafico saldo ${ult[1] < 0 ? "negativo" : ""}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}"><title>${esc(desc)}</title>
      ${ticks.map((t) => `<line class="grade" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${curto(t)}</text>`).join("")}
      <path class="area" d="${area}"/>
      <line class="eixo zero-linha" x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
      ${trocas.map((m) => `<line class="troca" x1="${x(new Date(m.em).getTime()).toFixed(1)}" x2="${x(new Date(m.em).getTime()).toFixed(1)}" y1="${T}" y2="${T + h}"/><text class="troca-rot" x="${(x(new Date(m.em).getTime()) + 3).toFixed(1)}" y="${T + 9}">v${m.versao}${m.ativo ? ` ${esc(m.ativo)}` : ""}</text>`).join("")}
      <path class="linha-saldo" pathLength="1" d="${d}"/>
      <circle class="ponto-real" cx="${x(ult[0]).toFixed(1)}" cy="${y(ult[1]).toFixed(1)}" r="4"/>
      <text x="${L}" y="${H - 6}">${dataCurta(a.curva[0][0])}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${dataCurta(a.curva[a.curva.length - 1][0])}</text>
    </svg>
    <div class="legenda"><span><svg viewBox="0 0 22 10"><line x1="1" x2="21" y1="5" y2="5" class="amostra-saldo"/></svg>${a.legenda ? esc(a.legenda) : a.unidade === "r" ? "saldo acumulado em R (múltiplos do risco)" : `saldo acumulado (lote ${String(estado.agentesPainel?.lote ?? 0.01).replace(".", ",")}, líquido de spread)`}</span>${trocas.length ? `<span><svg viewBox="0 0 22 10"><line x1="11" x2="11" y1="0" y2="10" class="amostra-troca"/></svg>troca de versão do self-learning</span>` : ""}</div>
  </div>`;
}

function htmlLeitura(a) {
  const item = (t, tipo) => `<li class="leitura-${tipo}">${ico(tipo === "fraco" ? "alert" : "check")}<span>${esc(t)}</span></li>`;
  return `<div class="leitura">
    <h3>Pontos fracos</h3>
    <ul class="lista compacta">${a.pontos_fracos.map((t) => item(t, "fraco")).join("") || `<li class="vazio">Nada que os números apontem por enquanto.</li>`}</ul>
    <h3>Pontos fortes</h3>
    <ul class="lista compacta">${a.pontos_fortes.map((t) => item(t, "forte")).join("") || `<li class="vazio">Ainda sem um ponto forte sustentado pelos números.</li>`}</ul>
    ${a.vetos && a.vetos.ops ? `<p class="meta">Vetos da IA medidos: ${a.vetos.ops} sinais, que teriam dado ${usd2(a.vetos.lucro_usd)}.</p>` : ""}
  </div>`;
}

function htmlAtuacao(a) {
  const max = Math.max(1, ...a.por_ativo.map((x) => Math.abs(x.metricas.lucro_usd)), ...a.por_ativo.map((x) => Math.abs(x.backtest?.lucro_usd ?? 0)));
  return `<div class="rolagem"><table class="tabela atuacao vira-lista">
    <thead><tr><th scope="col">Ativo</th><th scope="col">Agora</th><th scope="col">Operações</th><th scope="col">Acerto</th><th scope="col" class="col-zero">${a.rotulo_saldo ?? rotuloSaldo}</th>${a.self_learning ? `<th scope="col">Versão</th><th scope="col" class="col-zero">Backtest fora da amostra</th>` : ""}</tr></thead>
    <tbody>${a.por_ativo.map((x) => `<tr>
      <td><span class="ativo-nome">${iconeAtivo(x.ativo)}${esc(x.ativo)}</span></td>
      <td class="agora" data-rot="Agora">${x.status ? `<span class="badge ${STATUS_AGORA[x.status] ?? "muted"}">${esc(x.status.toLowerCase())}</span>` : `<span class="vazio">—</span>`}${x.texto ? `<span class="detalhe" title="${esc(x.texto)}">${esc(x.texto.replace(/^[A-ZÁÉÍÓÚÃÕÇ ]+ · /, ""))}</span>` : ""}</td>
      <td class="num" data-rot="Operações">${x.metricas.ops}</td><td class="num" data-rot="Acerto">${pct(x.metricas.acerto_pct)}</td>
      <td class="col-zero" data-rot="${a.rotulo_saldo ?? rotuloSaldo}">${x.metricas.ops ? barraZero(x.metricas.lucro_usd, max, dinheiro(a)(x.metricas.lucro_usd)) : `<span class="vazio">sem operações</span>`}</td>
      ${a.self_learning ? `<td data-rot="Versão">${x.auto ? `<span class="badge ${ESTADO_AUTO[x.auto.estado] ?? "muted"}">v${x.auto.versao} · ${esc(x.auto.estado)}</span>` : "—"}</td>
      <td class="col-zero" data-rot="Backtest fora da amostra">${x.backtest ? barraZero(x.backtest.lucro_usd, max, `${usd2(x.backtest.lucro_usd)} · ${x.backtest.ops} op.`) : `<span class="vazio">sem ciclo</span>`}</td>` : ""}
    </tr>`).join("")}</tbody></table></div>`;
}

function htmlRecortes(a) {
  const horas = Object.entries(a.por_hora).map(([h, m]) => [Number(h), m]).sort((p, q) => p[0] - q[0]);
  const lados = Object.entries(a.por_lado);
  const max = Math.max(1, ...horas.map(([, m]) => Math.abs(m.lucro_usd)), ...lados.map(([, m]) => Math.abs(m.lucro_usd)));
  const linha = (rot, m) => `<li><span class="rot">${rot}</span>${barraZero(m.lucro_usd, max, dinheiro(a)(m.lucro_usd))}<span class="meta">${m.ops} op. · ${pct(m.acerto_pct)}</span></li>`;
  const des = a.desfechos, total = Object.values(des).reduce((s, m) => s + m.ops, 0);
  return `<div class="recortes">
    <div class="recorte-horas"><h3>Por hora de abertura (UTC)</h3>${horas.length ? `<ul class="barras horas rolavel-movel" data-rolavel="horas">${horas.map(([h, m]) => linha(`${String(h).padStart(2, "0")}h`, m)).join("")}</ul>` : `<p class="vazio">Sem operações resolvidas.</p>`}</div>
    <div><h3>Por lado</h3>${lados.length ? `<ul class="barras">${lados.map(([l, m]) => linha(l === "compra" ? "compra" : "venda", m)).join("")}</ul>` : `<p class="vazio">Sem operações resolvidas.</p>`}
      <h3>Como as operações terminam</h3>${total ? `<div class="desfechos" role="img" aria-label="${esc(Object.entries(des).map(([k, m]) => `${NOME_DESFECHO[k] ?? k}: ${m.ops}`).join(", "))}">
        ${Object.entries(des).map(([k, m]) => `<span class="d-${k}" style="flex:${m.ops}">${NOME_DESFECHO[k] ?? k} ${m.ops}</span>`).join("")}</div>` : `<p class="vazio">—</p>`}</div>
  </div>`;
}

function htmlCiclos(a) {
  if (!a.self_learning) return "";
  return `<details ${a.ciclos.length ? "" : "open"}><summary>${ico("chevron")}Ciclos do self-learning <span class="count">${a.ciclos.length}</span></summary>
    ${a.ciclos.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th scope="col">Quando</th>${a.por_ativo_versao ? `<th scope="col">Ativo</th>` : ""}<th scope="col">Gatilho</th><th scope="col">Validação da versão em vigor</th><th scope="col">Candidata</th><th scope="col">Resultado</th></tr></thead>
      <tbody>${a.ciclos.map((c) => `<tr><td>${quando(c.em)}</td>${a.por_ativo_versao ? `<td>${esc(c.ativo ?? "—")}</td>` : ""}<td>${esc(c.motivo ?? "—")}</td>
        <td class="num">${c.validacao_atual?.ops != null ? `${usd2(c.validacao_atual.lucro_usd)} · ${c.validacao_atual.ops} op.` : "—"}</td>
        <td class="num">${c.validacao_nova ? `${usd2(c.validacao_nova.lucro_usd)} · ${c.validacao_nova.ops} op.` : "—"}</td>
        <td>${c.versao ? `<span class="badge good">trocou para v${c.versao}</span>` : `<span class="badge ${ESTADO_AUTO[c.estado] ?? "muted"}">manteve · ${esc(c.estado ?? "")}</span>`}</td></tr>`).join("")}</tbody></table></div>
      <p class="meta">Só troca com lucro fora da amostra, operações mínimas e mais lucro que a versão em vigor. Backtest, não recomendação.</p>`
      : `<p class="vazio">Nenhum ciclo ainda: o primeiro roda na próxima verificação.</p>`}
  </details>`;
}

// Histórico que escala (21/11/2026, crítica Impeccable): o Consolidado do Forex tinha 2.311 linhas e 38.081 nós na
// página. Agora a tabela mostra 50 linhas por vez, com filtro por situação, ordenação pelo cabeçalho e, nas ordens, as
// recusadas e canceladas fora da lista padrão, resumidas por motivo. As métricas do topo continuam com todas as linhas.
const HIST_PASSO = 50;
let histFiltro = "padrao", histLimite = HIST_PASSO, histOrdem = { col: null, dir: -1 }, histAtivo = "", histLado = "";
const HIST_COLUNAS = { abertura: (x) => new Date(x.abertura ?? 0).getTime(), fechamento: (x) => new Date(x.fechamento ?? x.abertura ?? 0).getTime(),
  ativo: (x) => String(x.ativo ?? ""), r: (x) => x.r, v: (x) => x.v };
// situação da linha: placar (execucao) ou ordem (sem o campo: fechada tem saída ou resultado; viva = aberta ou pendente)
function situacaoDoHistorico(x, ordens) {
  if (!ordens) return x.execucao === "executada" ? "exec" : x.execucao === "em_curso" ? "viva" : "nao";
  return x.fechamento && (x.v != null || x.saida != null) ? "exec" : /^(aberta|pendente)/.test(x.desfecho ?? "") ? "viva" : "nao";
}
// "recusada: preço 4013,2 já perto do stop 4012 (resta …)" e "… 3950,1 …" são o mesmo motivo: sem números nem parênteses
const motivoCurto = (t) => String(t ?? "").replace(/\([^)]*\)/g, "").replace(/·\s*parcial\s+\d+\s+de\s+\d+/gi, "").replace(/instrumento\s+\S+\s+sem/i, "instrumento sem").replace(/[-+−]?\d[\d.,]*/g, "").replace(/\s+/g, " ").replace(/\s+([:,.])/g, "$1").trim().replace(/[:,·\s]+$/, "") || "sem motivo";
function htmlMotivos(linhas) {
  const n = {};
  linhas.forEach((x) => { const k = motivoCurto(x.desfecho); n[k] = (n[k] ?? 0) + 1; });
  const ord = Object.entries(n).sort((p, q) => q[1] - p[1]);
  return `<details class="motivos"><summary>${ico("chevron")}Por que não executou <span class="count">${linhas.length}</span></summary>
    <ul class="lista compacta">${ord.map(([k, v]) => `<li><span>${esc(k)}</span><b class="num">${v}</b></li>`).join("")}</ul></details>`;
}

function htmlHistorico(a) {
  const h = a.historico;
  if (!h) return "";
  const din = dinheiro(a), todos = a.tipo === "todos";
  const rs = h.map((x) => x.r).filter((x) => x != null), vs = h.map((x) => x.v).filter((x) => x != null);
  const exe = h.filter((x) => x.execucao === "executada");
  const rsE = exe.map((x) => x.r).filter((x) => x != null), vsE = exe.map((x) => x.v).filter((x) => x != null);
  const fator = (l) => { const g = l.filter((x) => x > 0).reduce((s, x) => s + x, 0), p = -l.filter((x) => x < 0).reduce((s, x) => s + x, 0);
    return p ? (g / p).toFixed(2).replace(".", ",") : g ? "∞" : "—"; };
  const ordens = a.historicoTipo === "ordens";
  const hora = (t) => (t ? new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const celV = (v) => (v == null ? `<span class="meta">—</span>` : `<span class="${v < 0 ? "neg" : v > 0 ? "pos" : ""}">${din(v)}</span>`);
  const titulo = ordens ? "Histórico de ordens" : "Histórico de operações";
  const nota = ordens ? "Ordens enviadas à corretora, da mais recente para a mais antiga: preço executado, saída e resultado reais (com custos). Recusadas e canceladas aparecem com o motivo."
    : "Sinais resolvidos nos últimos 30 dias, do mais recente para o mais antigo. Executada = preço, saída e resultado reais da ordem na corretora. Não executado (em cinza) = o motivo (sinal em atraso, cancelada, sem ordem) e o resultado teórico do placar: a saída é o alvo ou o stop tocado, e o dinheiro segue a regra da página (lote 0,01 líquido de spread no Forex; 1 minicontrato ou 100 ações na Bovespa).";
  const sit = h.map((x) => situacaoDoHistorico(x, ordens)), conta = (k) => sit.filter((s) => s === k).length;
  const nNao = conta("nao"), nExec = conta("exec");
  const pilulas = ordens ? [["padrao", "Executadas e abertas", h.length - nNao], ["nao", "Recusadas e canceladas", nNao], ["todas", "Todas", h.length]]
    : [["padrao", "Todas", h.length], ["exec", "Executadas", nExec], ["nao", "Não executadas", nNao]];
  const filtro = pilulas.some(([k]) => k === histFiltro) ? histFiltro : "padrao";
  const passa = (s) => (filtro === "todas" || (filtro === "padrao" && !ordens) ? true : filtro === "padrao" ? s !== "nao" : s === filtro);
  const ativos = Object.entries(h.reduce((m, x) => { if (x.ativo) m[x.ativo] = (m[x.ativo] ?? 0) + 1; return m; }, {})).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]));
  const ativoSel = ativos.some(([k]) => k === histAtivo) ? histAtivo : "";
  let vis = h.filter((x, i) => passa(sit[i]) && (!ativoSel || x.ativo === ativoSel) && (!histLado || x.lado === histLado));
  const chaveOrd = HIST_COLUNAS[histOrdem.col];
  if (chaveOrd) vis = [...vis].sort((p, q) => { const x = chaveOrd(p), y = chaveOrd(q);
    if (x == null || y == null) return (x == null) - (y == null);  // sem valor vai para o fim, nos dois sentidos
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * histOrdem.dir; });
  const mostradas = vis.slice(0, histLimite), resto = vis.length - mostradas.length;
  const th = (col, rot, cls = "") => { const ativa = histOrdem.col === col;
    return `<th scope="col"${cls ? ` class="${cls}"` : ""}${ativa ? ` aria-sort="${histOrdem.dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" class="th-ordem" data-acao="hist-ordem" data-col="${col}" title="Ordenar por ${rot.toLowerCase()}">${rot}${ativa ? ico("chevron") : ""}</button></th>`; };
  return `<details class="historico" ${h.length ? "open" : ""}><summary>${ico("chevron")}${titulo} <span class="count">${h.length}</span></summary>
    ${!ordens ? `<p class="meta">Executadas na corretora (${exe.length}): fator de lucro <b class="num">${fator(rsE)}</b> em R (${r2(rsE.reduce((s, x) => s + x, 0))}) · <b class="num">${fator(vsE)}</b> em dinheiro (${din(vsE.reduce((s, x) => s + x, 0))})</p>` : ""}
    <p class="meta">${ordens ? "" : "Teórico de todos os sinais: "}Fator de lucro: <b class="num">${fator(rs)}</b> em R (${r2(rs.reduce((s, x) => s + x, 0))}) · <b class="num">${fator(vs)}</b> em dinheiro (${din(vs.reduce((s, x) => s + x, 0))})</p>
    ${h.length ? `<div class="hist-filtros"><span class="segmentado" role="group" aria-label="Filtrar o histórico"><span class="seg-rot">Linhas</span>${pilulas.map(([k, rot, n]) =>
      `<button type="button" data-acao="hist-filtro" data-filtro="${k}" aria-pressed="${k === filtro}">${rot} <span class="num">${n}</span></button>`).join("")}</span>
      <span class="segmentado" role="group" aria-label="Filtrar por lado"><span class="seg-rot">Lado</span>${[["", "Todos"], ["compra", "Compra"], ["venda", "Venda"]].map(([k, rot]) =>
        `<button type="button" data-acao="hist-lado" data-lado="${k}" aria-pressed="${k === histLado}">${rot}</button>`).join("")}</span>
      ${ativos.length > 1 ? `<label class="hist-ativo"><span>Ativo</span><select data-acao="hist-ativo" aria-label="Filtrar o histórico por ativo"><option value="">Todos (${h.length})</option>${ativos.map(([k, n]) =>
        `<option value="${esc(k)}"${k === ativoSel ? " selected" : ""}>${esc(k)} (${n})</option>`).join("")}</select></label>` : ""}</div>
    ${ordens && nNao ? htmlMotivos(h.filter((_, i) => sit[i] === "nao")) : ""}` : ""}
    ${!h.length ? `<p class="vazio">Nenhuma operação ainda.</p>` : !vis.length ? `<p class="vazio">Nenhuma linha neste filtro.</p>` : `<div class="rolagem rolavel-y" data-rolavel="historico-${esc(a.id)}"><table class="tabela vira-lista historico-ops">
      <thead><tr>${th("abertura", "Abertura")}${th("fechamento", "Fechamento")}${todos ? `<th scope="col">Origem</th>` : ""}
        ${th("ativo", "Ativo")}<th scope="col">Lado</th><th scope="col">Entrada</th><th scope="col">Stop</th><th scope="col">Alvo</th><th scope="col">Saída</th>
        <th scope="col" class="desfecho">Desfecho</th>${th("r", "R")}${th("v", ordens ? "Resultado" : "Dinheiro")}</tr></thead>
      <tbody>${mostradas.map((x) => `<tr${x.execucao === "teorico" ? ` class="teorico" title="Não executado: R e dinheiro só teóricos"` : ""}><td class="num">${hora(x.abertura)}</td><td class="num">${hora(x.fechamento)}</td>${todos ? `<td>${esc(x.unidade ?? "—")}</td>` : ""}
        <td>${esc(x.ativo ?? "—")}</td><td>${x.lado === "compra" ? `<span class="badge compra">COMPRA</span>` : x.lado === "venda" ? `<span class="badge venda">VENDA</span>` : "—"}</td>
        <td class="num">${precoCurto(x.entrada)}</td><td class="num">${precoCurto(x.stop)}</td><td class="num">${precoCurto(x.alvo)}</td><td class="num">${precoCurto(x.saida)}</td>
        <td class="desfecho">${esc(x.desfecho)}</td><td class="num">${x.r == null ? `<span class="meta">—</span>` : `<span class="${x.r < 0 ? "neg" : x.r > 0 ? "pos" : ""}">${r2(x.r)}</span>`}</td>
        <td class="num">${celV(x.v)}</td></tr>`).join("")}</tbody></table></div>
    <p class="meta hist-pe" role="status"><span>Mostrando <b class="num">${mostradas.length}</b> de <b class="num">${vis.length}</b>${vis.length < h.length ? ` (filtro; ${h.length} no total)` : ""}</span>${resto > 0
      ? `<button type="button" class="btn pequeno" data-acao="hist-mais" data-passo="${HIST_PASSO * 4}">Mostrar mais ${Math.min(resto, HIST_PASSO * 4)}</button>` : ""}</p>`}
    <p class="meta nota">${nota}</p>
  </details>`;
}

// link da live/canal/site de uma unidade da página de análise (17/11/2026, pedido do Diogo): procura o item do monitor
// pelo nome (YouTube por UC…, link ou @handle; TikTok pelo handle; Telegram pelo canal) e cai no nome quando não acha
const normNome = (x) => String(x ?? "").replace(/^[\s@▶️]+/u, "").trim().toLowerCase();
function urlDaUnidade(a) {
  const f = a.tipo;
  if (!f || f === "todos" || a.id === "Consenso" || !["tiktok", "youtube", "sites", "telegram"].includes(f)) return null;
  const n = normNome(a.id);
  const item = (estado.monitorItens ?? []).find((i) => i.fonte === f && (normNome(i.nome) === n || normNome(i.item) === n));
  if (item) return urlCanal(f, item.item);
  if (f === "sites") return SITES_URL[n] ?? null;
  return /^[\w.-]+$/.test(n) ? urlCanal(f, n) : null;  // nome com espaço (título do canal) não vira URL adivinhada
}
const linkDaUnidade = (a) => { const u = urlDaUnidade(a); const o = a.tipo === "sites" ? "o site" : a.tipo === "telegram" ? "o canal" : "a live";
  return u ? `<a class="abrir-live" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${o} de ${esc(normNome(a.id))} em outra aba">${ico("external")}abrir ${o.split(" ")[1]}</a>` : ""; };

// Páginas de análise enxutas (22/11/2026, crítica Impeccable): a resposta "como este canal foi?" vem primeiro (totais,
// indicadores, curva e pontos fracos), depois a Comparação, que é também o seletor de canal (a tira de abas saiu), e por
// fim o histórico e os recortes. A faixa de totais é o seletor de modalidade (a pílula "Mostrar" e a tabela "por
// modalidade" saíram: repetiam os mesmos números).
function htmlAgenteDetalhe(a) {
  return `<section class="painel agente detalhe" aria-label="Histórico e recortes de ${esc(a.id)}">
    ${htmlHistorico(a)}
    <h3>Onde atua</h3>
    ${htmlAtuacao(a)}
    ${htmlRecortes(a)}
    ${htmlCiclos(a)}
  </section>`;
}
function htmlAgente(a) {
  const m = a.metricas, din = dinheiro(a);
  const cel = (rot, valor, sub = "") => `<div><span class="rotulo">${rot}</span><span class="valor">${valor}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
  return `<section class="painel agente" aria-labelledby="h-ag-${esc(a.id)}">
    <h2 id="h-ag-${esc(a.id)}">${ico("radio")} ${esc(a.id)} ${linkDaUnidade(a)}<span class="selos">${a.selos ?? seloModo(a)}</span></h2>
    <div class="meta"><span>${esc(a.metodo)}</span><span>${a.ativos.map(esc).join(", ")}</span>${a.timeframes.length ? `<span>${a.timeframes.join(" · ")}</span>` : ""}
      ${a.ultima_execucao ? `<span>última rodada ${quando(a.ultima_execucao)}</span>` : ""}${a.proxima_execucao && a.ligado ? `<span>próxima em <b class="num" data-ate="${esc(a.proxima_execucao)}">${textoContador(a.proxima_execucao)}</b></span>` : ""}</div>
    <div class="faixa faixa-agente">
      ${cel(a.rotulo_saldo ?? rotuloSaldo, `<span class="${m.lucro_usd < 0 ? "neg" : m.lucro_usd > 0 ? "pos" : ""}">${din(m.lucro_usd)}</span>`,
        a.nota_saldo ? `${m.ops} operações · ${esc(a.nota_saldo.replace(/ \(\d+\)$/, ""))}` : `${m.ops} operações resolvidas`)}
      ${cel("Acerto", pct(m.acerto_pct), m.ops < 10 ? "amostra pequena" : "")}
      ${cel("Fator de lucro", m.fator_lucro == null ? "—" : String(m.fator_lucro).replace(".", ","), "ganhos ÷ perdas")}
      ${cel("Queda máxima", din(-m.drawdown_usd), a.unidade === "r" ? "do pico ao fundo" : `R total ${String(m.r_total).replace(".", ",")}`)}
    </div>
    <div class="agente-grade">
      <div><h3>Evolução do saldo</h3>${svgSaldo(a)}</div>
      ${htmlLeitura(a)}
    </div>
  </section>`;
}

// ---------- agentes, tiktok, youtube e sites (#/<fonte>, #/<fonte>/<id>) ----------
// Agentes: lê o painel publicado pelo executor. TikTok, YouTube e Sites não publicam um resumo: o dashboard soma os
// resultados já resolvidos (monitor_resultados, últimos 30 dias). O saldo é em US$ no lote mínimo 0,01: o R do resultado vira
// contrato e o spread em US$ vêm da tabela CONTRATOS (lote 0,01). As chaves seguem a forma dos agentes, para a mesma página servir às quatro fontes.

// Consolidado do mercado (16/11/2026, pedido do Diogo): a página de análise com cada FONTE do contexto como unidade e a aba
// Todos com o mercado inteiro (Forex em US$ no lote 0,01, Bovespa em R$ por 1 minicontrato ou 100 ações; Demo e Real com as ordens).
const CONSOLIDADO = "consolidado";
const SUBSTANTIVO = { consolidado: ["fonte", "fontes"], agentes: ["agente", "agentes"], tiktok: ["canal", "canais"], youtube: ["canal", "canais"], sites: ["site", "sites"], tradingview: ["layout", "layouts"], telegram: ["canal", "canais"] };
const RESUMO_B3 = "Cada canal com o seu saldo teórico em R$ por 1 minicontrato (WIN R$ 0,20 e WDO R$ 10 por ponto [NV]) ou 100 ações, pelos sinais resolvidos nos últimos 30 dias. O resultado real das ordens fica na aba CLEAR. O consenso fica à parte. Uso pessoal: não é recomendação.";
const RESUMO_ANALISE = {
  agentes: "Cada agente com o seu saldo teórico em US$ no lote 0,01, líquido de spread, pelos sinais resolvidos nos últimos 30 dias. Uso pessoal: não é recomendação.",
  tiktok: "Cada canal do TikTok com o seu saldo em US$ no lote mínimo de 0,01 (ouro: 1 oz por operação), líquido de spread. O stop vale −1 R e o alvo vale a distância até ele ÷ o risco. Soma os sinais já resolvidos nos últimos 30 dias; o consenso fica à parte. Uso pessoal: não é recomendação.",
  youtube: "Cada canal do YouTube com o seu saldo em US$ no lote mínimo de 0,01 (ouro: 1 oz por operação), líquido de spread. O stop vale −1 R e o alvo vale a distância até ele ÷ o risco. Soma os sinais já resolvidos nos últimos 30 dias; o consenso fica à parte. Uso pessoal: não é recomendação.",
  sites: "Cada site com o seu saldo em US$ no lote mínimo de 0,01 (forex: 1.000 unidades; cripto: 0,01 moeda), líquido do spread real da Capital.com. Quando o site só publica pips ou pontos, o resultado sai da entrada, do stop e do primeiro alvo (stop = −1 R). Soma os sinais resolvidos nos últimos 30 dias. Uso pessoal: não é recomendação.",
  telegram: "Cada canal público do Telegram com o seu saldo em US$ no lote mínimo de 0,01, líquido do spread real da Capital.com. O resultado sai do preço (Twelve Data e Binance), nunca do que o canal anuncia: stop = −1 R, alvo = distância até o 1.º alvo ÷ o risco. Soma os sinais resolvidos nos últimos 30 dias. Fonte em teste: o placar decide quais canais ficam. Uso pessoal: não é recomendação.",
  tradingview: "Cada layout do TradingView (portes dos indicadores e alertas criados à mão) com o seu saldo em US$ no lote mínimo de 0,01 (ouro: 1 oz por operação), líquido de spread. O stop vale −1 R e o alvo vale a distância até ele ÷ o risco. Soma os sinais já resolvidos nos últimos 30 dias. Fonte em teste: o placar decide quais layouts ficam. Uso pessoal: não é recomendação.",
};
const RESUMO_CONSOLIDADO = {
  forex: "O Forex inteiro e cada fonte (TikTok, YouTube, Sites, Telegram, Agentes, TradingView) com o saldo teórico em US$ no lote 0,01, líquido do spread real da Capital.com. Soma os sinais resolvidos nos últimos 30 dias, sem os consensos (repetem os sinais dos canais). Os Agentes aqui saem do placar, não do painel do executor. Uso pessoal: não é recomendação.",
  bovespa: "A Bovespa inteira e cada fonte com o saldo teórico em R$ (1 minicontrato ou 100 ações), pelos sinais resolvidos nos últimos 30 dias, sem os consensos. O resultado real das ordens fica na aba CLEAR. Uso pessoal: não é recomendação.",
};
const TODOS = "Todos";
const STATUS_COM_R = new Set(["alvo", "stop", "expirado"]);
const numerosDe = (t) => (String(t ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", "."))).filter(Number.isFinite);

// Lote 0,01 por instrumento: `un` = unidades do contrato no lote 0,01 (forex 100.000 × 0,01; ouro 100 oz × 0,01; cripto e US100: 1 contrato = 1 unidade),
// `spread` em preço (`pct` = fração do preço) e `cota` = o que converte a moeda de cotação em US$ (1/preço do par USD×moeda; só aproximação, [NV]).
// SPREAD = o REAL da API da Capital.com (regra do Diogo, 03/11/2026: spread de qualquer coisa dos monitores vem da API, nunca de estimativa):
// mediana do ask − bid do fecho de ~1.000 velas H1 (~6 semanas). Refazer com `python -m monitor_lives.termometro spreads-tudo` (05-monitor-lives).
const FX = 1000;
const CONTRATOS = {
  XAUUSD: { un: 1, spread: 0.50 }, US100: { un: 0.01, spread: 1.8 },
  NQ: { un: 0.01, spread: 1.8 },  // futuro do Nasdaq com vencimento (NQZ2026 na Capital.com: 1,8 em 17/11/2026, um retrato só)
  EURUSD: { un: FX, spread: 0.00007 }, GBPUSD: { un: FX, spread: 0.00013 }, AUDUSD: { un: FX, spread: 0.00006 }, NZDUSD: { un: FX, spread: 0.00015 },
  USDJPY: { un: FX, spread: 0.012, cota: 1 / 157 }, USDCHF: { un: FX, spread: 0.00014, cota: 1.22 }, USDCAD: { un: FX, spread: 0.0002, cota: 0.72 },
  EURJPY: { un: FX, spread: 0.018, cota: 1 / 157 }, GBPCHF: { un: FX, spread: 0.00024, cota: 1.22 }, GBPAUD: { un: FX, spread: 0.00018, cota: 0.70 },
  GBPNZD: { un: FX, spread: 0.00017, cota: 0.56 }, EURNZD: { un: FX, spread: 0.00016, cota: 0.56 },
};
// cripto: spread da API como fração do preço (mediana ÷ preço); o das altcoins é de 0,5% a 1,0%, bem acima de BTC e ETH
const CRIPTO_SPREAD = { BTC: 0.000644, ETH: 0.000762, XRP: 0.00535, DOGE: 0.00561, LTC: 0.00573, ADA: 0.00618, SOL: 0.00576, LINK: 0.00568, TRX: 0.01034 };
function contratoDe(instrumento) {
  const k = String(instrumento ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^NAS100$/, "US100");
  if (CONTRATOS[k]) return CONTRATOS[k];
  const moeda = Object.keys(CRIPTO_SPREAD).find((c) => k.startsWith(c));
  return moeda ? { un: 0.01, pct: CRIPTO_SPREAD[moeda] } : null;
}

// entrada (ponto médio se for faixa) e risco (distância até o stop) de um resultado
function entradaERisco(r) {
  const ent = numerosDe(r.entrada), stop = Number(r.stop);
  if (!ent.length || !Number.isFinite(stop)) return null;
  const entrada = ent.length > 1 ? (ent[0] + ent[1]) / 2 : ent[0], risco = Math.abs(entrada - stop);
  return risco ? { entrada, risco } : null;
}
// US$ líquido no lote 0,01: (movimento do preço − spread) × unidades × cota
function usdDoResultado(r, rr) {
  const c = contratoDe(r.instrumento), er = entradaERisco(r);
  if (rr == null || !c || !er) return null;
  const spread = c.pct ? c.pct * er.entrada : c.spread;
  return Math.round((rr * er.risco - spread) * c.un * (c.cota ?? 1) * 1e4) / 1e4;
}

// R de um resultado: o do placar; sem ele (sites que só publicam pips), stop = −1 R e alvo = distância ao 1º alvo ÷ risco
function rDoResultado(r) {
  if (r.resultado_r != null) return Number(r.resultado_r);
  if (r.status === "stop") return -1;
  if (r.status !== "alvo") return null;
  const ent = numerosDe(r.entrada), alvo = numerosDe(r.alvos)[0], stop = Number(r.stop);
  if (!ent.length || alvo == null || !Number.isFinite(stop)) return null;
  const entrada = ent.length > 1 ? (ent[0] + ent[1]) / 2 : ent[0], risco = Math.abs(entrada - stop);
  return risco ? Math.round((100 * Math.abs(alvo - entrada)) / risco) / 100 : null;
}

const nomeDaUnidadeBase = (origem) => (/^consenso/i.test(origem ?? "") ? "Consenso" : String(origem ?? "").replace(/^Sinal do canal /i, ""));
const plataformaDoCanal = (nome) => (nome.startsWith("@") ? "tiktok" : nome.startsWith("▶") ? "youtube" : null);
// o canal do YouTube aparece nos dois monitores; cada página fica com os canais da sua plataforma e com os consensos que o monitor dela avisou
function pertenceAFonte(f, fonteDoItem, origem) {
  if (ctxLente !== "forex") return fonteDoItem === f;  // a lente já separou o contexto; a heurística de plataforma por canal é do Forex
  if (COMO_SITES.has(f) || f === "tradingview" || f === "agentes") return fonteDoItem === f;
  if (fonteDoItem !== "tiktok" && fonteDoItem !== "youtube") return false;
  const nome = nomeDaUnidadeBase(origem);
  return nome === "Consenso" ? fonteDoItem === f : plataformaDoCanal(nome) === f;
}

function resultadosDaFonte(f, e) {
  const doMonitor = (e.monitorResultados ?? []).filter((r) => pertenceAFonte(f, r.fonte, r.origem));
  if (COMO_SITES.has(f) || f === "tradingview" || f === "agentes") return doMonitor;
  // os dois monitores publicam o mesmo sinal de canal: conta uma vez só (mesmo canal, ativo, lado e até 10 min de diferença)
  const vistos = [];
  return doMonitor.sort((a, b) => (b.fonte === f) - (a.fonte === f)).filter((r) => {
    const t = new Date(r.desde ?? r.resolvido_em).getTime();
    if (vistos.some((v) => v.origem === r.origem && v.instrumento === r.instrumento && v.direcao === r.direcao && Math.abs(v.t - t) < 6e5)) return false;
    vistos.push({ origem: r.origem, instrumento: r.instrumento, direcao: r.direcao, t });
    return true;
  });
}

function metricasUsd(ops) {
  const v = ops.map((o) => o.v), c2 = (x) => Math.round(x * 100) / 100;
  const ganhos = v.filter((x) => x > 0).reduce((s, x) => s + x, 0), perdas = -v.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  let saldo = 0, pico = 0, dd = 0;
  v.forEach((x) => { saldo += x; pico = Math.max(pico, saldo); dd = Math.max(dd, pico - saldo); });
  return { ops: v.length, lucro_usd: c2(saldo), acerto_pct: v.length ? Math.round((1000 * v.filter((x) => x > 0).length) / v.length) / 10 : null,
           fator_lucro: perdas ? c2(ganhos / perdas) : null, r_total: c2(ops.reduce((x, o) => x + o.r, 0)), drawdown_usd: c2(dd) };
}
function recorteUsd(ops, chave) {
  const g = {};
  ops.forEach((o) => (g[chave(o)] ??= []).push(o));
  return Object.fromEntries(Object.entries(g).map(([k, lista]) => [k, metricasUsd(lista)]));
}

// pontos fracos e fortes por regra, só com o que os números sustentam (mesmas regras do painel_agentes.py, sem vetos nem self-learning)
function leituraUsd(a, [um]) {
  const usd2 = dinheiro(a), m = a.metricas, n = m.ops, fracos = [], fortes = [];
  if (n < 10) fracos.push(`Amostra pequena (${n} operações resolvidas): nada conclusivo ainda.`);
  const comOps = a.por_ativo.filter((x) => x.metricas.ops >= 3);
  if (comOps.length) {
    const pior = comOps.reduce((p, x) => (x.metricas.lucro_usd < p.metricas.lucro_usd ? x : p)), melhor = comOps.reduce((p, x) => (x.metricas.lucro_usd > p.metricas.lucro_usd ? x : p));
    if (pior.metricas.lucro_usd < 0) fracos.push(`Perde em ${pior.ativo}: ${usd2(pior.metricas.lucro_usd)} em ${pior.metricas.ops} operações.`);
    if (melhor.metricas.lucro_usd > 0) fortes.push(`Melhor ativo: ${melhor.ativo}, ${usd2(melhor.metricas.lucro_usd)} em ${melhor.metricas.ops} operações.`);
  }
  const horas = Object.entries(a.por_hora).filter(([, x]) => x.ops >= 3);
  if (horas.length) {
    const [hp, xp] = horas.reduce((p, x) => (x[1].lucro_usd < p[1].lucro_usd ? x : p)), [hm, xm] = horas.reduce((p, x) => (x[1].lucro_usd > p[1].lucro_usd ? x : p));
    if (xp.lucro_usd < 0) fracos.push(`Pior horário: ${String(hp).padStart(2, "0")}h UTC (${usd2(xp.lucro_usd)} em ${xp.ops} operações).`);
    if (xm.lucro_usd > 0) fortes.push(`Melhor horário: ${String(hm).padStart(2, "0")}h UTC (${usd2(xm.lucro_usd)} em ${xm.ops} operações).`);
  }
  const c = a.por_lado.compra, v = a.por_lado.venda;
  if (c && v && c.ops >= 3 && v.ops >= 3 && (c.lucro_usd > 0) !== (v.lucro_usd > 0)) {
    const [ruim, bom] = c.lucro_usd < 0 ? ["compras", "vendas"] : ["vendas", "compras"];
    fracos.push(`As ${ruim} perdem enquanto as ${bom} ganham: o lado importa neste ${um}.`);
  }
  const expirados = a.desfechos.expirado?.ops ?? 0;
  if (n >= 10 && expirados / n > 0.4) fracos.push(`${Math.round((100 * expirados) / n)}% das operações expiram sem bater alvo nem stop: alvo longe demais?`);
  if (n && m.drawdown_usd > Math.abs(m.lucro_usd) && m.drawdown_usd > 0) fracos.push(`Queda máxima (${usd2(-m.drawdown_usd)}) maior que o saldo acumulado.`);
  if (m.fator_lucro && m.fator_lucro >= 1.3 && n >= 10) fortes.push(`Fator de lucro ${String(m.fator_lucro).replace(".", ",")}: ganha ${String(m.fator_lucro).replace(".", ",")}× o que perde.`);
  return [fracos, fortes];
}

// ops já montadas ({r, v, momento, aberto_em, ativo, lado, status}) → unidade no molde das páginas de análise
function unidadeDeOps(f, nome, ops, abertos, base, extra = {}) {
  ops = ops.filter((o) => o.v != null).sort((a, b) => new Date(a.momento) - new Date(b.momento));
  const ativos = [...new Set([...ops.map((o) => o.ativo), ...abertos.map((s) => s.instrumento)])].sort();
  const por_ativo = ativos.map((ativo) => {
    const s = abertos.find((x) => x.instrumento === ativo);
    return { ativo, metricas: metricasUsd(ops.filter((o) => o.ativo === ativo)), status: s ? "ATIVO" : null, auto: null, backtest: null,
      texto: s ? `ATIVO · ${String(s.direcao).toUpperCase()} · entrada ${s.entrada}${s.stop != null ? ` · stop ${s.stop}` : ""}${s.alvos ? ` · alvos ${s.alvos}` : ""}` : null };
  });
  let saldo = 0;
  const a = { id: nome, tipo: nome === TODOS ? "todos" : f, metodo: `${base}${ops.length ? ` · último resultado ${quando(ops[ops.length - 1].momento)}` : ""}`, ligado: true, ativos, timeframes: [],
    self_learning: false, por_ativo_versao: false, revisao_ia: false, selos: "", ultima_execucao: null, proxima_execucao: null, unidade: "usd", moeda: extra.moeda, legenda: extra.legenda,
    metricas: metricasUsd(ops), curva: ops.map((o) => [o.momento, Math.round((saldo += o.v) * 100) / 100]), por_ativo,
    por_hora: recorteUsd(ops, (o) => new Date(o.aberto_em).getUTCHours()), por_lado: recorteUsd(ops, (o) => o.lado), desfechos: recorteUsd(ops, (o) => o.status),
    vetos: null, ciclos: [], trocas: [], sinais: extra.sinais ?? ops.length + abertos.length, executadas: extra.executadas ?? ops.length,
    ganhos: ops.filter((o) => o.v > 0).length, perdas: ops.filter((o) => o.v < 0).length,
    nota_saldo: extra.nota_saldo ?? null, rotulo_saldo: extra.rotulo_saldo ?? null };
  [a.pontos_fracos, a.pontos_fortes] = leituraUsd(a, SUBSTANTIVO[f]);
  return a;
}

// Forex: US$ no lote 0,01 líquido de spread; Bovespa (16/11/2026): R$ por 1 minicontrato ou 100 ações (dinheiroDoResultado)
const opsDeResultados = (linhas) => linhas.filter((r) => STATUS_COM_R.has(r.status) && r.resolvido_em)
  .map((r) => ({ r: rDoResultado(r), v: dinheiroDoResultado(r), momento: r.resolvido_em, aberto_em: r.desde ?? r.resolvido_em, ativo: r.instrumento, lado: r.direcao, status: r.status }));
const extraDoCtx = () => (ctxLente === "bovespa" ? { moeda: "BRL", legenda: "saldo acumulado (1 minicontrato de WIN/WDO ou 100 ações, em R$, sem custos)" } : {});

// Histórico de operações (17/11/2026, pedido do Diogo): uma linha por operação da unidade, com horários, preços, desfecho,
// R e dinheiro. Nas abas Todos os sinais e Sem disparo vem do placar (saída = alvo ou stop tocado; teórico); em Demo e Real,
// das ordens da corretora (preço executado, saída e resultado reais, com custos).
const DESFECHO_SINAL = { alvo: "alvo", stop: "stop", expirado: "expirado", nao_acionada: "não acionada", invalida: "inválida", atrasado: "atrasado" };
// Execução de cada sinal do placar (18/11/2026, pedido do Diogo: a aba Todos os sinais misturava stops executados na
// corretora com sinais que nunca viraram ordem, como os atrasados). A ordem do sinal (mesma fonte e sinal_id; real antes
// de demo) dá o resultado REAL; sem ordem, a linha diz "não executado" e o motivo, e o R/dinheiro ficam como teóricos.
const ORDEM_FECHADA = new Set(["fechada"]);
// Desempenho (22/11/2026): com ~2.000 ordens e ~2.300 resultados, procurar a ordem de cada sinal com um filtro em todas
// as ordens custava milhões de comparações por painel, e o Consolidado levava 2,7 s para redesenhar. O índice é montado
// uma vez por lista de ordens (a lista muda a cada carga) e os painéis são guardados por estado (um por redesenho).
const indiceOrdens = new WeakMap();
function ordensPorSinal() {
  const lista = estado?.monitorOrdens ?? [];
  let ix = indiceOrdens.get(lista);
  if (!ix) {
    ix = { sinal: new Map(), modo: new Map() };
    for (const o of lista) {
      const k = `${o.fonte}|${Number(o.sinal_id)}`, km = `${k}|${o.modo}`;
      if (!ix.sinal.has(k)) ix.sinal.set(k, []);
      ix.sinal.get(k).push(o);
      ix.modo.set(km, (ix.modo.get(km) ?? 0) + 1);
    }
    indiceOrdens.set(lista, ix);
  }
  return ix;
}
const memoPaineis = new WeakMap();
function memoPorEstado(chave, fn) {
  if (!estado) return fn();
  let m = memoPaineis.get(estado);
  if (!m) { m = new Map(); memoPaineis.set(estado, m); }
  const k = `${ctxLente}|${chave}`;
  if (!m.has(k)) m.set(k, fn());
  return m.get(k);
}
function ordemDoSinal(r) {
  const os = (ordensPorSinal().sinal.get(`${r.fonte}|${Number(r.sinal_id)}`) ?? []).filter((o) => o.instrumento === r.instrumento && o.direcao === r.direcao);
  return os.find((o) => o.modo === "real" && ORDEM_FECHADA.has(o.status)) ?? os.find((o) => ORDEM_FECHADA.has(o.status))
    ?? os.find((o) => o.status === "aberta" || o.status === "pendente") ?? os[0] ?? null;
}
function motivoSemExecucao(r, o) {
  if (o && (o.status === "cancelada" || o.status === "recusada" || o.status === "erro"))
    return `${o.status === "recusada" ? "recusada" : o.status === "erro" ? "erro" : "cancelada"}${o.motivo ? `: ${o.motivo}` : ""}`;
  if (r.situacao === "atrasado") return "sinal em atraso";
  return "sem ordem (execução desligada ou fora do horário)";
}
function linhaDeResultado(r) {
  const ent = numerosDe(r.entrada), alvo = numerosDe(r.alvos)[0], st = Number(r.stop);
  const saida = r.status === "alvo" ? alvo : r.status === "stop" ? st : null;
  const base = { abertura: r.desde ?? null, fechamento: r.resolvido_em ?? null, ativo: r.instrumento, lado: r.direcao,
    entrada: ent.length > 1 ? `${ent[0]}–${ent[1]}` : ent[0] ?? null, stop: Number.isFinite(st) ? st : null, alvo: alvo ?? null,
    saida: saida ?? null, desfecho: DESFECHO_SINAL[r.status] ?? r.status ?? "—", r: STATUS_COM_R.has(r.status) ? rDoResultado(r) : null,
    v: STATUS_COM_R.has(r.status) ? dinheiroDoResultado(r) : null, unidade: nomeDaUnidade(r.fonte, r.origem) };
  const o = ordemDoSinal(r);
  if (o && ORDEM_FECHADA.has(o.status)) {  // executada: preços e resultado reais da corretora
    const real = linhaDeOrdem(o);
    return { ...base, desfecho: `${base.desfecho} (teórico) · executada${o.corretora ? ` na ${o.corretora}` : ""} (${o.modo}): ${real.desfecho}`,
      execucao: "executada", statusExec: DESFECHO_ORDEM[o.desfecho] ?? o.desfecho ?? "outro", ordemId: o.id };
  }
  if (o && (o.status === "aberta" || o.status === "pendente")) return { ...base, desfecho: `${base.desfecho} · ordem ${o.status} (${o.modo})`, execucao: "em_curso" };
  const decidido = STATUS_COM_R.has(r.status);
  return { ...base, desfecho: decidido ? `não executado: ${motivoSemExecucao(r, o)} (teórico: ${base.desfecho})` : base.desfecho,
    execucao: decidido ? "teorico" : "sem_r" };
}
// saídas parciais (18/11/2026): um sinal com vários alvos vira uma ordem por alvo (coluna `parcial`, migração 0017)
function rotuloParcial(o) {
  if (o.parcial == null) return "";
  const n = ordensPorSinal().modo.get(`${o.fonte}|${Number(o.sinal_id)}|${o.modo}`) ?? 0;
  return n > 1 ? ` · parcial ${o.parcial} de ${n}` : "";
}
function linhaDeOrdem(o) {
  const fechada = o.status === "fechada";
  return { abertura: o.aberto_em ?? o.criado_em ?? o.sinal_desde ?? null, fechamento: o.fechado_em ?? null, ativo: o.instrumento, lado: o.direcao,
    entrada: o.preco_execucao ?? o.preco_pedido ?? null, stop: o.stop ?? null, alvo: o.alvo ?? null, saida: fechada ? o.preco_saida : null,
    desfecho: (fechada ? (DESFECHO_ORDEM[o.desfecho] ?? o.desfecho ?? "fechada") : o.status === "aberta" ? "aberta" : o.status === "pendente" ? "pendente" : `${o.status}${o.motivo ? `: ${o.motivo}` : ""}`) + rotuloParcial(o),
    r: fechada ? rDaOrdem(o) : null, v: fechada && o.resultado != null ? Number(o.resultado) : null, moeda: o.moeda, unidade: o.unidade };
}
const ordenarHistorico = (l) => l.sort((a, b) => new Date(b.fechamento ?? b.abertura ?? 0) - new Date(a.fechamento ?? a.abertura ?? 0));

// Saldo só do que foi executado (18/11/2026, pedido do Diogo): na aba Todos os sinais e no Consolidado, com execução na
// corretora no contexto, saldo, acerto, fator de lucro, queda, curva e pontos fortes/fracos saem só das operações
// executadas (resultado real da ordem). Sem execução no contexto (Forex hoje), segue o placar teórico. "Sem disparo"
// continua teórico de propósito.
const TEORICO_TROCA_PARA_EXECUTADO = false;
const temExecucaoNoCtx = () => (estado?.monitorOrdens ?? []).some((o) => o.status === "fechada");
const opsExecutadas = (hist) => hist.filter((x) => x.execucao === "executada" && x.v != null)
  .map((x) => ({ r: x.r, v: x.v, momento: x.fechamento ?? x.abertura, aberto_em: x.abertura, ativo: x.ativo, lado: x.lado, status: x.statusExec }));
// ordem fechada sem linha no placar (ex.: zerada no fim do pregão com o sinal ainda aberto no placar): entra no saldo
// executado e no histórico da unidade a que pertence (filtro: página e nome da unidade)
function comOrdensOrfas(hist, pertence) {
  const usadas = new Set(hist.map((x) => x.ordemId).filter((x) => x != null));
  const orfas = (estado?.monitorOrdens ?? []).filter((o) => o.status === "fechada" && o.resultado != null && !usadas.has(o.id) && pertence(o))
    .map((o) => { const l = linhaDeOrdem(o); return { ...l, desfecho: `executada (${o.modo}): ${l.desfecho}`, execucao: "executada",
      statusExec: DESFECHO_ORDEM[o.desfecho] ?? o.desfecho ?? "outro", ordemId: o.id }; });
  return orfas.length ? ordenarHistorico([...hist, ...orfas]) : hist;
}
function metricasDoSaldo(linhas, hist, prefixo) {
  // 18/11/2026: com as abas por corretora, o Teórico volta a ser só o placar teórico (antes trocava sozinho para o executado)
  if (prefixo || !TEORICO_TROCA_PARA_EXECUTADO || !temExecucaoNoCtx()) return { ops: opsDeResultados(linhas), extra: {} };
  const ops = opsExecutadas(hist);
  return { ops, extra: { nota_saldo: `só operações executadas na ${corretoraExec()} (${ops.length})`, rotulo_saldo: "Saldo executado",
    legenda: `saldo acumulado só das ordens executadas na ${corretoraExec()} (resultado real)` } };
}

function unidadeDeResultados(f, nome, linhas, abertos, prefixo = "", categoria = false) {
  let hist = ordenarHistorico(linhas.map(linhaDeResultado));
  if (TEORICO_TROCA_PARA_EXECUTADO && !prefixo && !categoria && nome !== "Consenso") hist = comOrdensOrfas(hist, (o) => o.pagina === f && (nome === TODOS || o.unidade === nome));
  const m = metricasDoSaldo(linhas, hist, prefixo);
  const ops = m.ops;
  const base =nome === TODOS ? `Soma de todos os ${SUBSTANTIVO[f][1]} do ${FONTES[f]}${COMO_SITES.has(f) || f === "tradingview" || f === "agentes" ? "" : " (sem o consenso, que repete os mesmos sinais)"}` : nome === "Consenso" ? "Sinais de consenso entre canais" : f === "sites" ? "Sinais publicados pelo site" : f === "telegram" ? "Sinais publicados no canal do Telegram" : f === "tradingview" ? "Sinais deste layout do TradingView" : f === "agentes" ? "Sinais deste agente" : `Sinal do canal no ${FONTES[f]}`;
  return Object.assign(unidadeDeOps(f, nome, ops, abertos, prefixo + base, { sinais: linhas.length + abertos.length, ...extraDoCtx(), ...m.extra }),
    { historico: hist, historicoTipo: "placar" });
}

const abertosDaFonte = (f, e) => (e.monitorSinais ?? []).filter((s) => pertenceAFonte(f, s.fonte, s.origem) && (!s.ate || new Date(s.ate) > Date.now()));

// Consolidado (todos os sinais ou sem disparo): uma unidade por fonte do contexto + Todos = o mercado. Sem consensos, como na aba
// Todos de cada fonte; o mesmo sinal de canal dos dois monitores já sai uma vez só em resultadosDaFonte.
function painelConsolidado(e, modo = "todos") {
  const ordens = modo === "sem" ? (e.monitorOrdens ?? []).filter((o) => o.ticket != null) : null, prefixo = modo === "sem" ? "Sem disparo · " : "";
  const porFonte = fontesDoCtx().map((f) => {
    const semConsenso = (x) => nomeDaUnidade(f, x.origem) !== "Consenso" && !(ordens && foiDisparado(f, x, ordens));
    return { f, linhas: resultadosDaFonte(f, e).filter(semConsenso), abertos: abertosDaFonte(f, e).filter(semConsenso) };
  }).filter((x) => x.linhas.length || x.abertos.length);
  const fontesCtx = fontesDoCtx();
  const unidade = (nome, linhas, abertos, base, f) => {
    let hist = ordenarHistorico(linhas.map(linhaDeResultado));
    if (TEORICO_TROCA_PARA_EXECUTADO && !prefixo) hist = comOrdensOrfas(hist, (o) => (f ? o.pagina === f : fontesCtx.includes(o.pagina)));
    const m = metricasDoSaldo(linhas, hist, prefixo);
    return Object.assign(unidadeDeOps(CONSOLIDADO, nome, m.ops, abertos, prefixo + base, { sinais: linhas.length + abertos.length, ...extraDoCtx(), ...m.extra }),
      { fonte: f, historico: hist, historicoTipo: "placar" });
  };
  const agentes = porFonte.map((x) => unidade(FONTES[x.f], x.linhas, x.abertos, `Todos os sinais do ${FONTES[x.f]} (sem consenso)`, x.f))
    .sort((a, b) => b.metricas.ops - a.metricas.ops || a.id.localeCompare(b.id));
  if (agentes.length) agentes.unshift(unidade(TODOS, porFonte.flatMap((x) => x.linhas), porFonte.flatMap((x) => x.abertos), `Soma de todas as fontes do ${CONTEXTOS[ctxLente].nome}`));
  return { unidade: "usd", agentes, ...(ctxLente === "bovespa" ? { moeda: "BRL" } : {}) };
}

// nome do canal, site, agente ou layout (a ponte do MT5 usa a mesma regra: execucao.unidade_de)
const nomeDaUnidade = (f, origem) => { const n = nomeDaUnidadeBase(origem); return f === "tradingview" || f === "agentes" ? n.replace(/^[^\p{L}\p{N}]+/u, "") : n; };

// sinal que virou ordem de verdade (com ticket no MT5) em qualquer conta; o mesmo sinal de canal pode ter vindo pelo outro monitor
function foiDisparado(f, r, ordens) {
  const t = new Date(r.desde ?? r.resolvido_em).getTime(), u = nomeDaUnidade(f, r.origem);
  return ordens.some((o) => (o.fonte === r.fonte && o.sinal_id === r.sinal_id)
    || (o.unidade === u && o.instrumento === r.instrumento && o.direcao === r.direcao && Math.abs(new Date(o.sinal_desde).getTime() - t) < 6e5));
}

// categoria do canal do YouTube (robo | trader | outro), publicada pelo monitor em controle.categorias:<fonte>
const ROTULO_CATEGORIA = { robo: "Robô", trader: "Live trader", outro: "Outro" };
function categoriaDoCanal(f, e, nome) {
  const mapa = (e.categorias ?? {})[f + (ctxLente === "bovespa" ? "@bovespa" : "")] ?? {};
  const n = String(nome ?? "").replace(/^[@▶️\s]+/u, "").trim().toLowerCase();
  return mapa[n] ?? null;
}

function painelDeResultados(f, e, modo = "todos") {
  let linhas = resultadosDaFonte(f, e);
  let abertos = abertosDaFonte(f, e);
  if (modo === "sem") {
    const ordens = (e.monitorOrdens ?? []).filter((o) => o.ticket != null);
    linhas = linhas.filter((r) => !foiDisparado(f, r, ordens));
    abertos = abertos.filter((s) => !foiDisparado(f, s, ordens));
  }
  const prefixo = modo === "sem" ? "Sem disparo · " : "";
  const nomes = [...new Set([...linhas.map((r) => nomeDaUnidade(f, r.origem)), ...abertos.map((s) => nomeDaUnidade(f, s.origem))])];
  const agentes = nomes.map((n) => unidadeDeResultados(f, n, linhas.filter((r) => nomeDaUnidade(f, r.origem) === n), abertos.filter((s) => nomeDaUnidade(f, s.origem) === n), prefixo))
    .sort((a, b) => b.metricas.ops - a.metricas.ops || a.id.localeCompare(b.id));
  // aba "Todos": soma dos canais ou sites; o consenso fica fora porque repete os sinais dos canais
  const semConsenso = (x) => nomeDaUnidade(f, x.origem) !== "Consenso";
  // YouTube (17/11/2026, pedido do Diogo): uma aba por categoria do canal (robôs, live traders, outros), logo depois de Todos
  const cats = [];
  if (f === "youtube") {
    for (const a of agentes) { const c = categoriaDoCanal(f, e, a.id); if (c) a.metodo = `${ROTULO_CATEGORIA[c]} · ${a.metodo}`; }
    for (const c of Object.keys(ROTULO_CATEGORIA)) {
      const daCat = (x) => categoriaDoCanal(f, e, nomeDaUnidade(f, x.origem)) === c;
      const l = linhas.filter(daCat), ab = abertos.filter(daCat);
      // tipo "todos": é um agregado (fora da tabela por canal e sem botões de execução)
      if (!l.length && !ab.length) continue;
      const u = unidadeDeResultados(f, ROTULO_CATEGORIA[c] + "s", l, ab, prefixo, true);
      cats.push({ ...u, tipo: "todos", metodo: `${prefixo}Soma dos canais marcados como "${ROTULO_CATEGORIA[c].toLowerCase()}" na lista do YouTube` });
    }
  }
  if (agentes.some((a) => a.id !== "Consenso")) agentes.unshift(unidadeDeResultados(f, TODOS, linhas.filter(semConsenso), abertos.filter(semConsenso), prefixo), ...cats);
  return { unidade: "usd", agentes, ...(ctxLente === "bovespa" ? { moeda: "BRL" } : {}) };
}

// ---------- execução no MT5 (ActivTrades): ordens reais, seleção por canal e modalidades ----------
// A ponte (05-monitor-lives/monitor_lives/execucao.py, no VPS Windows) grava monitor_ordens e lê controle.execucao:<modo>.
const DESCRICAO_MODALIDADE = {
  todos: "Todos os sinais, executados ou não, no placar teórico pelo preço (lote 0,01, spread real). Não depende da seleção de execução.",
  demo: "Ordens executadas na conta DEMO da corretora: preço executado, swap e comissão reais, na moeda da conta.",
  real: "Ordens executadas na conta REAL da corretora: resultado real, na moeda da conta.",
  sem: "Sinais que não viraram ordem nem no demo nem no real (canal desligado ou ordem recusada), no placar teórico.",
};
// canal (19/11/2026): o canal fechou à mão na live e a ponte fechou a cópia (processador._avaliar_encerramentos)
const DESFECHO_ORDEM = { tp: "alvo", sl: "stop", vencimento: "expirado", zerado: "zerado no fim do pregão",
  canal: "encerrado pelo canal" };
const CORRETORA_EXEC = { forex: "ActivTrades", bovespa: "CLEAR" };
const corretoraExec = () => (ctxLente === "forex" && NOME_CORRETORA_FX[estado?.execucao?.corretora]) || CORRETORA_EXEC[ctxLente] || "corretora";

// botão da corretora do Forex (ordens novas); as ordens abertas na outra seguem vigiadas até fechar
// nome próprio: htmlCorretora(a) é o bloco "Na corretora" do termômetro; com o mesmo nome, esta declaração o substituía
// e cada cartão do termômetro desenhava o botão de execução (18/11/2026)
function htmlSeletorCorretora(e) {
  const atual = e.execucao?.corretora ?? "capitalcom";
  return `<span class="segmentado corretora" role="group" aria-label="Corretora das ordens novas do Forex"><span class="seg-rot">Execução</span>${CORRETORAS_FX.map(([k, rot, dica]) => {
    const vivo = ["demo", "real"].some((m) => { const s = e.execucao?.porCorretora?.[m]?.[k]; return s?.conectado && Date.now() - new Date(s.atualizado_em).getTime() < 120e3; });
    return `<button type="button" data-acao="corretora" data-corretora="${k}" aria-pressed="${k === atual}" title="${esc(`${dica}. ${vivo ? "Ponte conectada." : "Ponte sem conexão agora."} As ordens novas vão para a corretora marcada; as já abertas na outra continuam até o stop ou o alvo.`)}">${rot}</button>`;
  }).join("")}</span>`;
}

// Forex com duas corretoras (18/11/2026, pedido do Diogo): uma ponte por corretora, cada uma publica
// execucao:estado:<modo>:<id>. O botão grava execucao:corretora: só a ativa abre ordens novas; a outra segue vigiando as
// ordens que já abriu até o stop ou o alvo.
const CORRETORAS_FX = [["capitalcom", "Capital.com", "MT4 da Capital.com (conta demo no VPS), pelo EA MonitorPonte"],
  ["activtrades", "ActivTrades", "MT5 da ActivTrades: a conta ainda não está configurada no VPS (as ordens novas esperam a ponte dela rodar)"]];
const NOME_CORRETORA_FX = Object.fromEntries(CORRETORAS_FX.map(([k, n]) => [k, n]));
// suf: "" (Forex: execucao:demo…) ou "@bovespa" (execucao@bovespa:demo…, com as operações marcadas como swing)
function execucaoDoControle(ctl, suf = "") {
  const base = { selecao: { demo: ctl[`execucao${suf}:demo`] ?? {}, real: ctl[`execucao${suf}:real`] ?? {} },
           estado: { demo: ctl[`execucao${suf}:estado:demo`] ?? null, real: ctl[`execucao${suf}:estado:real`] ?? null },
           swing: ctl[`execucao${suf}:swing`] ?? {} };
  if (suf) return base;
  const corretora = NOME_CORRETORA_FX[ctl["execucao:corretora"]] ? ctl["execucao:corretora"] : "capitalcom";
  const porCorretora = { demo: {}, real: {} };
  for (const modo of ["demo", "real"]) {
    for (const [id] of CORRETORAS_FX) if (ctl[`execucao:estado:${modo}:${id}`]) porCorretora[modo][id] = ctl[`execucao:estado:${modo}:${id}`];
    // o lucro até agora vem de todas as pontes: a ordem aberta na corretora antiga continua no cartão do sinal
    const flutuante = Object.assign({}, ...Object.values(porCorretora[modo]).map((s) => s.flutuante ?? {}));
    const ativa = porCorretora[modo][corretora] ?? (Object.keys(porCorretora[modo]).length
      ? { conectado: false, aviso: `a ponte da ${NOME_CORRETORA_FX[corretora]} não está rodando: as ordens novas esperam por ela`, atualizado_em: new Date().toISOString() }
      : base.estado[modo]);
    base.estado[modo] = ativa ? { ...ativa, corretora: NOME_CORRETORA_FX[corretora], flutuante: { ...flutuante, ...(ativa.flutuante ?? {}) } } : null;
  }
  return { ...base, corretora, porCorretora };
}

// Bovespa (16/11/2026): WIN/WDO são day trade por padrão (a ponte zera no fim do pregão); cada operação pode virar swing.
// Ações (PETR4, VALE3…) são swing por padrão e não têm o botão.
const DAY_TRADE_B3 = /^(WIN|WDO)/i;
function htmlModalidadeOperacao(s) {
  if (ctxLente !== "bovespa" || (s.situacao === "atrasado" && s.entrada_canal == null)) return "";  // nunca vira ordem: sem botão
  if (!DAY_TRADE_B3.test(String(s.instrumento ?? ""))) return `<span class="badge" title="Ações são swing trade por padrão: saem no alvo ou no stop">swing</span>`;
  const chave = `${s.fonte}@bovespa:${s.sinal_id}`, swing = estado.execucao?.swing?.[chave] === true;
  const titulo = swing ? "Swing: não zera no fim do pregão; sai no alvo ou no stop. Clique para voltar a day trade."
                       : "Day trade: zerado até o fim do pregão se o alvo não vier. Clique para tornar swing.";
  return `<button class="btn pequeno exec ${swing ? "ligado" : ""}" data-acao="swing" data-chave="${esc(chave)}" data-ligar="${!swing}"
    aria-pressed="${swing}" title="${esc(titulo)}" aria-label="${esc(titulo)}">${ico(swing ? "activity" : "clock")}${swing ? "Swing" : "Day trade"}</button>`;
}
// o canal vale mais que a fonte; sem registro = desligado (mesma regra de execucao.selecionado)
function execucaoLigada(modo, f, id) {
  const sel = estado.execucao?.selecao?.[modo] ?? {}, canal = sel.unidades?.[f]?.[id];
  return typeof canal === "boolean" ? canal : sel.fontes?.[f] === true;
}
function botaoExecucao(modo, f, id, curto = false) {  // id ausente = a fonte inteira; curto = o nome da fonte já está ao lado
  const fonteToda = id == null, nome = modo === "demo" ? "Demo" : "Real";
  const ligado = fonteToda ? estado.execucao?.selecao?.[modo]?.fontes?.[f] === true : execucaoLigada(modo, f, id);
  const alvo = fonteToda ? `todo o ${FONTES[f]}` : id;
  const titulo = `${ligado ? "Desligar" : "Ligar"} a execução na conta ${nome.toLowerCase()} para ${alvo}`;
  return `<button class="btn pequeno exec ${ligado ? "ligado" : ""}" data-acao="execucao" data-modo="${modo}" data-fonte="${f}" ${fonteToda ? "" : `data-unidade="${esc(id)}"`}
    data-ligar="${!ligado}" aria-pressed="${ligado}" title="${esc(titulo)}" aria-label="${esc(titulo)}">${ico("power")}${fonteToda && !curto ? `${nome}: ${FONTES[f]}` : nome}<span class="estado-exec">${ligado ? "ligado" : "desligado"}</span></button>`;
}

// Leitura × escrita (21/11/2026, crítica Impeccable, escolha do Diogo): as tabelas de resultado só MOSTRAM quem executa
// (selo); os botões que gravam no banco ficam no painel "Execução automática", no fim da página, com a conta real
// separada da demo. Antes, a Comparação tinha de 51 a 79 interruptores Demo/Real ao lado dos números.
const fonteExecutando = (modo, f) => estado.execucao?.selecao?.[modo]?.fontes?.[f] === true
  || Object.values(estado.execucao?.selecao?.[modo]?.unidades?.[f] ?? {}).some((v) => v === true);
function seloExecucao(f, id) {  // id ausente = a fonte (linha do Consolidado)
  const ligada = (modo) => (id == null ? fonteExecutando(modo, f) : execucaoLigada(modo, f, id));
  const demo = ligada("demo"), real = ligada("real");
  if (!demo && !real) return `<span class="exec-selo desligada">desligada</span>`;
  return `<span class="exec-selo">${demo ? `<span class="badge good" title="Sinais novos abrem ordem na conta demo">${ico("check")}Demo</span>` : ""}${real
    ? `<span class="badge venda" title="Sinais novos abrem ordem na conta real">${ico("alert")}Real</span>` : ""}</span>`;
}
// canais (ou agentes, sites, layouts) que podem ser ligados: os que têm resultado em 30 dias e os já marcados à mão
function unidadesDeExecucao(f, painelTeorico) {
  const ids = new Set((painelTeorico?.agentes ?? []).filter((a) => a.tipo !== "todos" && a.id !== TODOS).map((a) => a.id));
  for (const modo of ["demo", "real"]) Object.keys(estado.execucao?.selecao?.[modo]?.unidades?.[f] ?? {}).forEach((u) => ids.add(u));
  return [...ids].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
function resumoExecucao(modo, f, ids) {
  const nome = modo === "demo" ? "Demo" : "Real", [um, varios] = SUBSTANTIVO[f];
  let texto, ligado;
  if (f === CONSOLIDADO) {
    const fontes = fontesDoCtx(), n = fontes.filter((x) => fonteExecutando(modo, x)).length;
    ligado = n > 0; texto = n ? `${n} de ${fontes.length} fontes` : "desligada";
  } else {
    const toda = estado.execucao?.selecao?.[modo]?.fontes?.[f] === true, n = ids.filter((u) => execucaoLigada(modo, f, u)).length;
    ligado = toda || n > 0;
    texto = toda ? (n < ids.length ? `toda a fonte, menos ${ids.length - n}` : "toda a fonte") : n ? `${n} ${n === 1 ? um : varios}` : "desligada";
  }
  return ligado ? `<span class="badge ${modo === "real" ? "venda" : "good"}">${ico(modo === "real" ? "alert" : "check")}${nome}: ${texto}</span>`
                : `<span class="badge muted">${nome}: ${texto}</span>`;
}
function htmlPainelExecucao(f, ids) {
  if (!(CONTEXTOS[ctxLente]?.execucao ?? true)) return "";
  const consol = f === CONSOLIDADO, [um, varios] = SUBSTANTIVO[f];
  const linhas = (modo) => (consol
    ? fontesDoCtx().map((x) => `<li><span class="exec-nome">${FONTES[x]}</span>${botaoExecucao(modo, x, null, true)}</li>`)
    : ids.map((u) => `<li><span class="exec-nome">${esc(u)}</span>${botaoExecucao(modo, f, u)}</li>`)).join("");
  const grupo = (modo) => {
    const real = modo === "real", lista = `<ul class="exec-lista">${linhas(modo)}</ul>`;
    return `<div class="exec-grupo ${modo}" role="group" aria-label="Execução na conta ${real ? "real" : "demo"}">
      <h3 class="exec-tit">${real ? `Conta real <span class="badge venda">${ico("alert")}dinheiro de verdade</span>` : "Conta demo"}</h3>
      <p class="meta">${real ? `Quem estiver ligado aqui abre ordens com dinheiro real na ${esc(corretoraExec())}. Cada ligação pede confirmação.`
        : `Quem estiver ligado aqui abre ordens na conta demo da ${esc(corretoraExec())} a cada sinal novo.`} As ordens já abertas não mudam: seguem até o stop ou o alvo.</p>
      ${consol ? "" : `<div class="exec-toda">${botaoExecucao(modo, f)}<span class="meta">Liga todos os ${varios} de uma vez; quem foi desligado um a um continua desligado.</span></div>`}
      ${consol ? lista : !ids.length ? `<p class="meta">Cada ${um} aparece aqui depois do primeiro sinal resolvido.</p>`
        : real ? `<details class="exec-um-a-um"><summary>${ico("chevron")}Escolher ${varios} da conta real um a um</summary>${lista}</details>` : lista}
    </div>`;
  };
  return `<section class="painel exec-painel" id="painel-exec" aria-labelledby="h-exec">
      <h2 id="h-exec">${ico("power")} Execução automática <span class="resumo-saude">${resumoExecucao("demo", f, ids)}${resumoExecucao("real", f, ids)}</span></h2>
      <p class="meta">Quem abre ordem na ${esc(corretoraExec())} quando sai um sinal novo. As tabelas acima só mostram o estado; a mudança é feita aqui.</p>
      <details class="exec-editar"><summary>${ico("chevron")}Alterar quem executa</summary>${grupo("demo")}${grupo("real")}</details>
    </section>`;
}

const rDaOrdem = (o) => {
  const ex = Number(o.preco_execucao), sa = Number(o.preco_saida), st = Number(o.stop), risco = Math.abs(ex - st);
  if (![ex, sa, st].every(Number.isFinite) || !risco) return 0;
  return Math.round((100 * (sa - ex) * (o.direcao === "compra" ? 1 : -1)) / risco) / 100;
};

function painelDeOrdens(f, e, modo, corretora = null) {
  const consol = f === CONSOLIDADO, fontes = fontesDoCtx();
  const ordens = (e.monitorOrdens ?? []).filter((o) => o.modo === modo && (consol ? fontes.includes(o.pagina) : o.pagina === f)
    && (!corretora || o.corretora === corretora));
  const chave = consol ? (o) => FONTES[o.pagina] ?? o.pagina : (o) => o.unidade;
  const moeda = ordens.find((o) => o.moeda)?.moeda ?? estadoDaCorretora(modo, corretora)?.moeda ?? (corretora ? null : e.execucao?.estado?.[modo]?.moeda) ?? "USD";
  const conta = modo === "demo" ? "da conta demo" : "da conta real";
  const unidade = (nome, lista) => {
    const ops = lista.filter((o) => o.status === "fechada" && o.resultado != null && o.fechado_em)
      .map((o) => ({ r: rDaOrdem(o), v: Number(o.resultado), momento: o.fechado_em, aberto_em: o.aberto_em ?? o.sinal_desde, ativo: o.instrumento, lado: o.direcao, status: DESFECHO_ORDEM[o.desfecho] ?? o.desfecho ?? "outro" }));
    const abertos = lista.filter((o) => o.status === "aberta" || o.status === "pendente")
      .map((o) => ({ instrumento: o.instrumento, direcao: o.direcao, entrada: o.preco_execucao ?? o.preco_pedido, stop: o.stop, alvos: o.alvo }));
    const base = nome === TODOS ? `Soma das ordens ${conta} de todos os ${SUBSTANTIVO[f][1]}${corretora ? ` na ${corretora}` : ""}` : `Ordens ${conta} da ${corretora ?? corretoraExec()}`;
    const recusas = lista.filter((o) => o.status === "recusada" || o.status === "erro").length;
    return Object.assign(unidadeDeOps(f, nome, ops, abertos, base + (recusas ? ` · ${recusas} recusadas` : ""),
      { sinais: lista.length, executadas: lista.filter((o) => o.preco_execucao != null).length, moeda, legenda: `resultado real das ordens ${conta} (com swap e comissão, em ${moeda})` }),
      { historico: ordenarHistorico(lista.map(linhaDeOrdem)), historicoTipo: "ordens" });
  };
  const nomes = [...new Set(ordens.map(chave))];
  const agentes = nomes.map((n) => Object.assign(unidade(n, ordens.filter((o) => chave(o) === n)), consol ? { fonte: fontes.find((x) => FONTES[x] === n) } : {})).sort((a, b) => b.metricas.ops - a.metricas.ops || a.id.localeCompare(b.id));
  if (agentes.length) agentes.unshift(unidade(TODOS, ordens));
  return { unidade: "usd", moeda, agentes };
}

function painelDaModalidade(f, e, modo, conta = "demo") {
  return e === estado ? memoPorEstado(`modalidade|${f}|${modo}|${conta}`, () => painelDaModalidadeCru(f, e, modo, conta)) : painelDaModalidadeCru(f, e, modo, conta);
}
function painelDaModalidadeCru(f, e, modo, conta = "demo") {
  const corr = corretoraDoModo(modo);
  if (corr) return painelDeOrdens(f, e, conta, corr[1]);
  if (modo === "demo" || modo === "real") return painelDeOrdens(f, e, modo);
  if (f === CONSOLIDADO) return painelConsolidado(e, modo);
  if (f === "agentes" && modo === "todos" && ctxLente === "forex") return comHistoricoDosAgentes(e.agentesPainel, e);
  return painelDeResultados(f, e, modo);
}

// o painel dos agentes do Forex vem pronto do executor (sem as operações): o histórico sai do placar, por nome do agente
function comHistoricoDosAgentes(painel, e) {
  if (!painel?.agentes) return painel;
  const linhas = resultadosDaFonte("agentes", e).map(linhaDeResultado);
  return { ...painel, agentes: painel.agentes.map((a) => ({ ...a, historicoTipo: "placar",
    historico: ordenarHistorico(a.tipo === "todos" || a.id === TODOS ? [...linhas] : linhas.filter((x) => x.unidade === a.id)) })) };
}

// estado publicado pela ponte de uma corretora (Forex: uma ponte por corretora; Bovespa: a da CLEAR)
function estadoDaCorretora(modo, corretora) {
  if (!corretora) return null;
  if (ctxLente === "forex") {
    const k = (CORRETORAS_CTX.forex.find(([, n]) => n === corretora) ?? [])[0];
    const s = estado?.execucao?.estado?.[modo];
    return estado?.execucao?.porCorretora?.[modo]?.[k] ?? (s?.corretora === corretora ? s : null);
  }
  return estado?.execucao?.estado?.[modo] ?? null;
}

function htmlEstadoExecucao(modo, corretora = null) {
  const s = corretora ? estadoDaCorretora(modo, corretora) : estado.execucao?.estado?.[modo], conta = modo === "demo" ? "Conta demo" : "Conta real";
  if (!s && corretora) return `<div class="aviso neutro">${ico("radio")}<span>${conta} da ${esc(corretora)}: nenhuma ponte publicou estado ainda (conta não aberta ou ponte desligada).</span></div>`;
  if (!s) return `<div class="aviso neutro">${ico("radio")}<span>${conta}: a ponte do MT5 ainda não rodou. Ela roda no VPS Windows com o MetaTrader 5 da ${corretoraExec()} (roteiro em <code>05-monitor-lives/docs/execucao-automatica.md</code>).</span></div>`;
  const parada = Date.now() - new Date(s.atualizado_em).getTime() > 120e3;
  if (!s.conectado || parada) return `<div class="aviso erro">${ico("alert")}<span>${conta}: ${!s.conectado ? `desconectada (${esc(s.aviso ?? "sem motivo")})` : "sem notícia da ponte"} · atualizado ${quando(s.atualizado_em)}</span></div>`;
  const din = dinheiro({ moeda: s.moeda });
  const partes = [`<span class="badge good"><i class="ponto vivo" aria-hidden="true"></i>${conta} conectada${s.corretora ? ` · ${esc(s.corretora)}` : ""}</span>`, `<span>${esc(s.servidor ?? "")}</span>`,
    `<span>${s.abertas} abertas · ${s.pendentes} pendentes</span>`, `<span>resultado do dia <b class="num">${din(s.resultado_dia)}</b></span>`];
  if (s.lote != null) partes.push(`<span>lote ${String(s.lote).replace(".", ",")}</span>`);
  if (s.volumes) partes.push(`<span>${Object.entries(s.volumes).map(([k, v]) => `${k === "acoes" ? "ações" : k} ${v}`).join(" · ")}</span>`);
  if (s.day_trade) partes.push(`<span>${esc((s.day_trade.ativos ?? []).join("/"))} day trade: sem entrada após ${esc(s.day_trade.ultima_entrada)}, zera às ${esc(s.day_trade.zerar_as)}</span>`);
  if (s.parado) partes.push(`<span class="badge warning">${ico("pause")}parada: ${esc(s.parado)}</span>`);
  if (s.aviso) partes.push(`<span class="badge warning">${ico("alert")}${esc(s.aviso)}</span>`);
  // posição na corretora ≠ soma das operações do monitor: posição órfã (sem stop, sem alvo, sem zeragem) ou mexida à mão
  for (const [simb, d] of Object.entries(s.divergencias ?? {}))
    partes.push(`<span class="badge critical" title="Posição na corretora diferente das operações do monitor: sem stop, alvo nem zeragem pela ponte. Conferir no terminal.">${ico("alert")}${esc(simb)}: corretora ${esc(String(d.corretora))} × monitor ${esc(String(d.operacoes))}</span>`);
  partes.push(`<span>atualizado ${quando(s.atualizado_em)}</span>`);
  return `<div class="meta exec-estado">${partes.join("")}</div>${corretora ? "" : htmlOutrasCorretoras(modo)}`;
}

// Forex: a corretora que deixou de receber ordens novas continua vigiando as que abriu (18/11/2026)
function htmlOutrasCorretoras(modo) {
  if (ctxLente !== "forex") return "";
  const ativa = estado.execucao?.corretora ?? "capitalcom";
  return Object.entries(estado.execucao?.porCorretora?.[modo] ?? {}).filter(([k]) => k !== ativa).map(([k, s]) => {
    const vivas = (estado.monitorOrdens ?? []).filter((o) => o.modo === modo && o.corretora === NOME_CORRETORA_FX[k] && (o.status === "aberta" || o.status === "pendente")).length;
    if (!vivas) return "";
    const ok = s.conectado && Date.now() - new Date(s.atualizado_em).getTime() < 120e3;
    return `<div class="meta exec-estado"><span class="badge ${ok ? "" : "warning"}">${ico(ok ? "clock" : "alert")}${esc(NOME_CORRETORA_FX[k])}: ${vivas} ${vivas === 1 ? "ordem viva" : "ordens vivas"}, sem ordens novas</span><span>${ok ? "vigiadas até o stop ou o alvo" : `ponte sem conexão (${esc(s.aviso ?? "sem notícia")}): stop e alvo seguem na corretora`}</span></div>`;
  }).join("");
}

const hrefAnalise = (f, id, modo = rotaAtual().modo ?? "todos", conta = rotaAtual().conta ?? "demo") =>
  `#/${f}/${encodeURIComponent(id)}${modo && modo !== "todos" ? `?m=${modo}${corretoraDoModo(modo) && conta === "real" ? "&c=real" : ""}` : ""}`;

// Totais lado a lado (18/11/2026, pedido do Diogo): cada corretora (executado, na moeda da conta) e o Teórico, da unidade aberta
function htmlFaixaTotais(f, id, modo, conta) {
  if (!corretorasDoCtx().length) return "";
  const cartoes = [...corretorasDoCtx().map(([k, n]) => {
    const p = painelDaModalidade(f, estado, k, conta), a = p.agentes.find((x) => x.id === id) ?? (id === TODOS ? null : undefined);
    const ordens = (estado.monitorOrdens ?? []).filter((o) => o.corretora === n && o.modo === conta);
    const desde = ordens.map((o) => o.sinal_desde ?? o.criado_em).filter(Boolean).sort()[0];
    const semConta = !estadoDaCorretora(conta, n) && !ordens.length;
    const corpo = a ? `<b class="num ${a.metricas.lucro_usd < 0 ? "neg" : a.metricas.lucro_usd > 0 ? "pos" : ""}">${dinheiro({ moeda: p.moeda })(a.metricas.lucro_usd)}</b>
        <span>${a.metricas.ops} ${a.metricas.ops === 1 ? "operação fechada" : "operações fechadas"} · acerto ${pct(a.metricas.acerto_pct)}</span>
        <span class="meta">conta ${conta} · ${esc(p.moeda)}${desde ? ` · desde ${new Date(desde).toLocaleDateString("pt-BR")}` : ""}</span>`
      : `<span class="meta">${semConta ? "sem conta ainda" : `sem ordens ${conta === "demo" ? "demo" : "reais"}${id === TODOS ? "" : " desta unidade"}`}</span>`;
    return `<a class="total-corretora${k === modo ? " atual" : ""}${a ? "" : " vazio"}" href="${hrefAnalise(f, id, k, conta)}" ${k === modo ? 'aria-current="page"' : ""}>
      <span class="total-rot">${esc(n)}</span>${corpo}</a>`;
  }), (() => {
    const p = memoPorEstado(`teorico|${f}`, () => (f !== CONSOLIDADO ? painelDeResultados(f, estado) : painelConsolidado(estado))), a = p?.agentes?.find((x) => x.id === id);
    const corpo = a ? `<b class="num ${a.metricas.lucro_usd < 0 ? "neg" : a.metricas.lucro_usd > 0 ? "pos" : ""}">${dinheiro(a ?? { moeda: p?.moeda })(a.metricas.lucro_usd)}</b>
        <span>${a.metricas.ops} ${a.metricas.ops === 1 ? "sinal resolvido" : "sinais resolvidos"} · acerto ${pct(a.metricas.acerto_pct)}</span>
        <span class="meta">todos os sinais pelo preço · 30 dias</span>` : `<span class="meta">sem sinais resolvidos</span>`;
    return `<a class="total-corretora teorico${modo === "todos" ? " atual" : ""}" href="${hrefAnalise(f, id, "todos")}" ${modo === "todos" ? 'aria-current="page"' : ""}>
      <span class="total-rot">Teórico</span>${corpo}</a>`;
  })(), (() => {
    const p = painelDaModalidade(f, estado, "sem"), a = p?.agentes?.find((x) => x.id === id);
    const corpo = a ? `<b class="num ${a.metricas.lucro_usd < 0 ? "neg" : a.metricas.lucro_usd > 0 ? "pos" : ""}">${dinheiro(a ?? { moeda: p?.moeda })(a.metricas.lucro_usd)}</b>
        <span>${a.metricas.ops} ${a.metricas.ops === 1 ? "sinal resolvido" : "sinais resolvidos"} · acerto ${pct(a.metricas.acerto_pct)}</span>
        <span class="meta">sinais que não viraram ordem · teórico</span>` : `<span class="meta">todos os sinais viraram ordem</span>`;
    return `<a class="total-corretora teorico${modo === "sem" ? " atual" : ""}${a ? "" : " vazio"}" href="${hrefAnalise(f, id, "sem")}" ${modo === "sem" ? 'aria-current="page"' : ""}>
      <span class="total-rot">Sem disparo</span>${corpo}</a>`;
  })()];
  return `<nav class="faixa-totais" aria-label="Resultado de ${esc(id)} por modalidade: escolha qual mostrar">${cartoes.join("")}</nav>`;
}

// Comparar (contexto Todos): cada fonte de cada contexto, lado a lado, em R (independe de moeda e de lote). O resultado em euros
// vem na etapa seguinte, com o câmbio do BCE do dia.
// Visão (18/11/2026, pedido do Diogo): Teórica = placar de todos os sinais pelo preço; Efetiva = ordens executadas nas
// corretoras (Forex: Capital.com + ActivTrades; Bovespa: CLEAR), conta demo e real, em R. R não depende de moeda, então
// a soma de Capital.com (€) e ActivTrades (US$) é válida; dinheiro não se soma entre as duas sem câmbio.
const CORRETORAS_EFETIVA = { forex: ["Capital.com", "ActivTrades"], bovespa: ["CLEAR"] };
function vistaComparar(visao = "teorica") {
  const ctxs = ["forex", "bovespa"], efetiva = visao === "efetiva";
  const pct = (w, l) => (w + l ? `${Math.round((100 * w) / (w + l))}%` : "—");
  // agrupado por mercado, com uma linha de subtotal (auditoria de 17/11/2026: o mercado se repetia em toda linha)
  const celulas = (abertos, w, perd, rs) => `<td class="num">${abertos}</td><td class="num">${w}</td><td class="num">${perd}</td>
        <td class="num">${pct(w, perd)}${w + perd && w + perd < 10 ? ` <small class="amostra" title="menos de 10 sinais decididos: não conclua nada ainda">amostra pequena</small>` : ""}</td>
        <td class="num">${rs.length ? fmtR(rs.reduce((a, b) => a + b, 0)) : "—"}</td><td class="num">${rs.length ? fmtR(rs.reduce((a, b) => a + b, 0) / rs.length) : "—"}</td>`;
  const linhas = ctxs.map((ctx) => {
    const l = lente(estadoBruto, ctx);
    const tot = { abertos: 0, w: 0, perd: 0, rs: [] };
    const corretoras = CORRETORAS_EFETIVA[ctx];
    const ordensCtx = (l.monitorOrdens ?? []).filter((o) => corretoras.includes(o.corretora));
    const fontes = CONTEXTOS[ctx].fontes.map((f) => {
      let w, perd, rs, abertos;
      if (efetiva) {
        const ordens = ordensCtx.filter((o) => o.pagina === f);
        const fechadas = ordens.filter((o) => o.status === "fechada" && o.resultado != null);
        w = fechadas.filter((o) => Number(o.resultado) > 0).length;
        perd = fechadas.filter((o) => Number(o.resultado) < 0).length;
        rs = fechadas.map(rDaOrdem).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
        abertos = ordens.filter((o) => o.status === "aberta" || o.status === "pendente").length;
      } else {
        const lista = (l.monitorResultados ?? []).filter((r) => r.fonte === f);
        w = lista.filter((r) => r.status === "alvo").length; perd = lista.filter((r) => r.status === "stop").length;
        rs = lista.map((r) => r.resultado_r).filter((x) => x !== null && x !== undefined).map(Number);
        abertos = sinaisAbertosDe(l, f);
      }
      tot.abertos += abertos; tot.w += w; tot.perd += perd; tot.rs.push(...rs);
      return `<tr><th scope="row" class="esq recuo"><a href="${hrefCtx(ctx, f)}">${esc(FONTES[f])}</a></th>${celulas(abertos, w, perd, rs)}</tr>`;
    });
    return `<tbody><tr class="subtotal"><th scope="row" class="esq">${esc(NOME_CTX[ctx])}${efetiva ? ` <small class="meta">${esc(corretoras.join(" + "))}</small>` : ""}</th>${celulas(tot.abertos, tot.w, tot.perd, tot.rs)}</tr>${fontes.join("")}</tbody>`;
  });
  return `<main class="uma">
    ${avisoErro()}
    <div class="cabecalho-proj compacto" style="--cor:${cor("monitor")}">
      <div class="bloco">
        <a class="voltar" href="#/">${ico("back")} Visão geral</a>
        <h1><i class="ponto" aria-hidden="true"></i>Comparar Forex e Bovespa</h1>
        <p class="resumo">As mesmas fontes nos dois mercados, em múltiplos do risco (R), que não dependem de moeda nem de tamanho de lote. Só vale concluir com amostra grande e lucro nos dois trechos (treino e validação).</p>
      </div>
    </div>
    <nav class="segmentado modalidades" aria-label="Visão"><span class="seg-rot">Visão</span>${[["teorica", "Teórica"], ["efetiva", "Efetiva"]]
      .map(([k, rot]) => `<a href="#/todos/comparar${k === "efetiva" ? "?v=efetiva" : ""}" ${k === visao ? 'aria-current="page"' : ""}>${rot}</a>`).join("")}</nav>
    <section class="painel" aria-labelledby="h-comp">
      <h2 id="h-comp">${ico("target")} Placar por mercado <span class="count">últimos 30 dias</span></h2>
      <div class="rolagem"><table class="tabela placar vira-lista">
        <thead><tr><th scope="col" class="esq">Mercado e fonte</th><th scope="col">${efetiva ? "Ordens vivas" : "Abertos"}</th><th scope="col">Win</th><th scope="col">Loss</th><th scope="col">Acerto</th><th scope="col">R total</th><th scope="col">R médio</th></tr></thead>
        ${linhas.join("")}</table></div>
      <p class="meta nota">${efetiva
        ? "Efetiva: ordens executadas na corretora (Forex: Capital.com + ActivTrades; Bovespa: CLEAR; demo e real), cada parcial conta como uma ordem. Win = fechou com lucro e loss = fechou com prejuízo (resultado da corretora, já com custos); R = (saída − entrada) ÷ (entrada − stop) da própria ordem, pelo preço."
        : "Teórica: todos os sinais pelo preço. Win = bateu o alvo antes do stop; loss = bateu o stop."} Promover algo de um mercado ao outro é decisão sua (N1) e exige backtest no mercado de destino.</p>
    </section>
  </main>`;
}

// cabeçalho das análises (auditoria de 17/11/2026: 5 linhas empurravam os dados): a 1.ª frase fica, o resto recolhe
function resumoRecolhido(html) {
  return html.replace(/<p class="resumo">([\s\S]*?)<\/p>/, (todo, texto) => {
    const m = /^([\s\S]*?[.:])\s+(?=[A-ZÀ-Ú<])([\s\S]+)$/.exec(texto);
    if (!m || m[2].replace(/<[^>]+>/g, "").length < 40) return todo;
    return `<p class="resumo">${m[1]}</p><details class="como"><summary>${ico("chevron")}Como é calculado</summary><p class="resumo">${m[2]}</p></details>`;
  });
}

function vistaAnalise(f, id, modo = "todos", conta = "demo") {
  modo = modoNoCtx(modo);
  if (f !== CONSOLIDADO && ctxLente !== "forex" && !(estado.monitorFontes ?? []).some((x) => x.fonte === f) && !(estado.monitorResultados ?? []).some((x) => x.fonte === f)) return vistaContextoVazio(`${FONTES[f]} · ${CONTEXTOS[ctxLente].nome}`);
  // Bovespa (16/11/2026, pedido do Diogo): a mesma página do Forex, com a aba Todos e cada canal em R$ (antes era só R,
  // em vistaAnaliseR). O painel dos agentes do executor só existe no Forex; na Bovespa os agentes saem do placar.
  const ehAgentes = f === "agentes" && modo === "todos" && ctxLente === "forex", p = painelDaModalidade(f, estado, modo, conta), [um, varios] = SUBSTANTIVO[f];
  const corr = corretoraDoModo(modo), din = dinheiro(p ?? {}), comOrdens = !!corr, consol = f === CONSOLIDADO;
  const temExec = CONTEXTOS[ctxLente]?.execucao ?? true;
  const idsExec = !temExec || consol ? [] : unidadesDeExecucao(f, modo === "todos" ? p : painelDaModalidade(f, estado, "todos"));
  const painelExec = htmlPainelExecucao(f, idsExec);
  const descricao = corr ? `Ordens executadas na ${corr[1]} (conta ${conta}): preço executado, swap e comissão reais, na moeda da conta${p?.moeda ? ` (${p.moeda})` : ""}. Nunca se mistura com outra corretora nem com o teórico.` : null;
  const cab = resumoRecolhido(`<div class="cabecalho-proj" style="--cor:${cor("monitor")}">
      <div class="bloco">
        <a class="voltar" href="${hrefCtx(ctxLente)}">${ico("back")} Monitor</a>
        <h1><i class="ponto" aria-hidden="true"></i>${consol ? `${CONTEXTOS[ctxLente].nome}: resultado consolidado` : f === "agentes" ? "Agentes de sinais" : `${FONTES[f]}: desempenho por ${um}`}</h1>
        ${consol && PREGOES[ctxLente] ? `<div class="pregao-b3" data-pregao="${ctxLente}" aria-label="${PREGOES[ctxLente].nome}">${htmlPregao(ctxLente)}</div>` : ""}
        <p class="resumo">${ehAgentes ? `Saldo de cada agente em dinheiro, com lote ${String(p?.lote ?? 0.01).replace(".", ",")} por operação e já descontado o spread. Tamanho dos contratos pela folha MT5 da Capital.com; spread real medido na API da Capital.com (03/11/2026). Uso pessoal: não é recomendação.` : comOrdens ? descricao : modo === "sem" ? DESCRICAO_MODALIDADE[modo] : consol ? RESUMO_CONSOLIDADO[ctxLente] : ctxLente !== "forex" ? RESUMO_B3 : RESUMO_ANALISE[f]}</p>
        ${ehAgentes && p ? `<div class="meta"><span>atualizado ${quando(p.atualizado_em)}</span>${(p.agentes ?? []).length ? `<span>self-learning em: ${p.agentes.filter((a) => a.self_learning).map((a) => esc(a.id)).join(", ") || "nenhum"}; fixos: ${p.agentes.filter((a) => !a.self_learning && a.tipo !== "todos").map((a) => esc(a.id)).join(", ") || "nenhum"}</span>` : ""}</div>` : ""}
      </div>
      ${!consol && (CONTEXTOS[ctxLente]?.execucao ?? true) ? `<div class="exec-fonte" aria-label="Execução automática do ${FONTES[f]}">${resumoExecucao("demo", f, idsExec)}${resumoExecucao("real", f, idsExec)}</div>` : ""}
      ${consol ? `<div class="exec-fonte">${htmlPrioridade(estado)}</div>` : ""}
      ${ehAgentes ? controleSelfLearning(p) : ""}
    </div>`);
  const temFaixa = corretorasDoCtx().length > 0;  // com a faixa de totais, ela é o seletor de modalidade
  const navMostrar = temFaixa ? "" : `<nav class="segmentado modalidades" aria-label="Resultado"><span class="seg-rot">Mostrar</span>${modalidadesDoCtx()
    .map(([k, rotulo]) => `<a href="${hrefAnalise(f, id ?? TODOS, k, conta)}" ${k === modo ? 'aria-current="page"' : ""}>${rotulo}</a>`).join("")}</nav>`;
  const navConta = comOrdens ? `<nav class="segmentado contas" aria-label="Conta"><span class="seg-rot">Conta</span>${[["demo", "Demo"], ["real", "Real"]].map(([k, rot]) => `<a href="${hrefAnalise(f, id ?? TODOS, modo, k)}" ${k === conta ? 'aria-current="page"' : ""}>${rot}</a>`).join("")}</nav>` : "";
  const modalidades = !temExec || !(navMostrar || navConta) ? "" : `<div class="linha-modalidades">${navMostrar}${navConta}</div>`;
  const estadoConta = comOrdens ? htmlEstadoExecucao(conta, corr[1]) : "";
  const aviso = erro ? `<div class="aviso erro">${ico("alert")}<span>${esc(erro)}</span></div>` : "";
  if (!p?.agentes?.length) {
    const vazio = ehAgentes ? "O resumo dos agentes ainda não chegou. Ele é publicado pelo executor (launchd <code>com.vinculo.agentes</code>) a cada 5 min; confira o log em <code>05-monitor-lives/dados-agentes/logs/</code>."
      : comOrdens ? `Nenhuma ordem ${conta === "demo" ? "demo" : "real"} ${consol ? `do ${CONTEXTOS[ctxLente].nome}` : `do ${FONTES[f]}`} na ${corr[1]} nos últimos 30 dias. A execução se liga no painel Execução automática, logo abaixo: ${conta === "demo" ? "conta demo" : "conta real"}, por ${um} ou na fonte inteira.`
      : modo === "sem" ? `Todos os sinais resolvidos do ${FONTES[f]} nos últimos 30 dias viraram ordem.` : `Nenhum sinal do ${FONTES[f]} foi resolvido nos últimos 30 dias. A página se monta sozinha quando o placar resolver o primeiro.`;
    return `<main class="uma">${aviso}${cab}${modalidades}${htmlFaixaTotais(f, id ?? TODOS, modo, conta)}${estadoConta}<div class="aviso neutro">${ico("radio")}<span>${vazio}</span></div>${painelExec}</main>`;
  }
  const atual = p.agentes.find((a) => a.id === id) ?? p.agentes[0];
  const unidades = p.agentes.filter((a) => a.tipo !== "todos");
  const max = Math.max(1, ...unidades.map((a) => Math.abs(a.metricas.lucro_usd)));
  const rotSaldoTab = p.agentes.find((a) => a.rotulo_saldo)?.rotulo_saldo ?? rotuloSaldo;
  const comparacao =`<section class="painel" aria-labelledby="h-comp">
      <h2 id="h-comp">${ico("target")} Comparação <span class="count">${unidades.length} ${unidades.length === 1 ? um : varios}</span><span class="meta dica-comp">clique num nome para abrir</span>${temExec
        ? `<span class="direita"><button class="btn pequeno" data-acao="ir-exec" title="Abre o painel Execução automática, no fim da página">${ico("power")} Alterar execução</button></span>` : ""}</h2>
      <div class="rolagem rolavel-y" data-rolavel="comparacao-${f}"><table class="tabela comparacao vira-lista">
        <thead><tr><th scope="col">${um[0].toUpperCase() + um.slice(1)}</th>${ehAgentes ? `<th scope="col">Modo</th>` : ""}<th scope="col">Operações</th><th scope="col">Acerto</th><th scope="col" class="col-zero">${comOrdens ? "Resultado" : rotSaldoTab}</th><th scope="col">Fator de lucro</th><th scope="col">Queda máxima</th><th scope="col">Execução</th></tr></thead>
        <tbody>${p.agentes.map((a) => `<tr ${a.id === atual.id ? 'aria-current="true"' : ""}>
          <td><a href="${hrefAnalise(f, a.id)}">${esc(a.id)}</a></td>
          ${ehAgentes ? `<td>${a.tipo === "todos" ? "" : a.self_learning ? seloAuto("self-learning") : `<span class="badge muted">fixo</span>`}</td>` : ""}
          <td class="num" data-rot="Operações">${a.metricas.ops}</td><td class="num" data-rot="Acerto">${pct(a.metricas.acerto_pct)}</td>
          <td class="col-zero" data-rot="${comOrdens ? "Resultado" : rotSaldoTab}">${barraZero(a.metricas.lucro_usd, max, din(a.metricas.lucro_usd))}</td>
          <td class="num" data-rot="Fator de lucro">${a.metricas.fator_lucro == null ? "—" : String(a.metricas.fator_lucro).replace(".", ",")}</td>
          <td class="num" data-rot="Queda máxima">${din(-a.metricas.drawdown_usd)}</td>
          <td class="exec-cel">${!temExec || a.tipo === "todos" ? "" : consol ? (a.fonte ? seloExecucao(a.fonte) : "") : seloExecucao(f, a.id)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;
  return `<main class="uma">
    ${aviso}
    ${cab}
    ${htmlFaixaTotais(f, atual.id, modo, conta)}
    ${modalidades}
    ${estadoConta}
    ${htmlAgente(atual)}
    ${comparacao}
    ${htmlAgenteDetalhe(atual)}
    ${painelExec}
  </main>`;
}

// ---------- renderização e movimento ----------

// o render troca o HTML inteiro a cada atualização (tempo real e a cada 30 s): sem isto, todo <details> volta ao padrão.
// Chave = cartão + título do resumo sem números ("Outros 12 itens" → "Outros # itens") + ordem dentro do cartão.
function detalhesComChave(raiz) {
  const cartoes = [...raiz.querySelectorAll(".cartao")], vistos = {};
  return [...raiz.querySelectorAll("details")].map((d) => {
    // cartão com data-fonte: a chave é a fonte (os cartões de Sinais ativos acima variam em número e deslocariam o índice)
    const base = `${d.closest("[data-fonte]")?.dataset.fonte ?? cartoes.indexOf(d.closest(".cartao"))}|${(d.querySelector("summary")?.textContent ?? "").replace(/\d+/g, "#").trim()}`;
    vistos[base] = (vistos[base] ?? 0) + 1;
    return [d, `${base}|${vistos[base]}`];
  });
}

// tabelas que viram lista no celular (auditoria de 17/11/2026): cada célula ganha o título da sua coluna em data-rot,
// que o CSS mostra antes do valor abaixo de 560 px; a 1.ª célula da linha vira o título do item
// listas com rolagem própria (17/11/2026, pedido do Diogo): a barra de rolagem some no Windows e no celular, então cada
// lista ganha um aviso de que há mais itens: degradê na borda de baixo e um selo "+N abaixo" clicável, que somem no fim
function prepararRolagens(raiz) {
  raiz.querySelectorAll("[data-rolavel]").forEach((el) => {
    if (!el.parentElement.classList.contains("rola-caixa")) {
      const caixa = document.createElement("div");
      caixa.className = "rola-caixa";
      el.replaceWith(caixa);
      caixa.append(el);
      const selo = document.createElement("button");
      selo.type = "button";
      selo.className = "rola-mais";
      selo.addEventListener("click", () => el.scrollBy({ top: el.clientHeight * 0.8, behavior: reduzMovimento() ? "auto" : "smooth" }));
      caixa.append(selo);
      el.addEventListener("scroll", () => marcarRolagem(el), { passive: true });
    }
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;  // rolável pelo teclado
    marcarRolagem(el);
  });
}
// recolhível aberto ou janela redimensionada: a lista muda de altura e o aviso é refeito
document.addEventListener("toggle", (ev) => ev.target.querySelectorAll?.("[data-rolavel]").forEach(marcarRolagem), true);
window.addEventListener("resize", () => document.querySelectorAll("[data-rolavel]").forEach(marcarRolagem));
function marcarRolagem(el) {
  const caixa = el.parentElement, selo = caixa.querySelector(".rola-mais");
  const fim = el.getBoundingClientRect().bottom;
  const itens = el.matches("ul") ? [...el.children] : [...el.querySelectorAll("tbody tr")];
  const restantes = el.scrollHeight - el.scrollTop - el.clientHeight > 4 ? itens.filter((i) => i.getBoundingClientRect().top >= fim - 4).length : 0;
  caixa.classList.toggle("tem-mais", restantes > 0);
  caixa.classList.toggle("rolou", el.scrollTop > 4);
  if (selo) { selo.textContent = restantes ? `+${restantes} abaixo ↓` : ""; selo.setAttribute("aria-label", `Rolar para ver mais ${restantes} itens`); selo.hidden = !restantes; }
}

function rotularTabelas(raiz) {
  raiz.querySelectorAll("table.vira-lista").forEach((t) => {
    const titulos = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((c, i) => {
      if (i > 0 && !c.dataset.rot && titulos[i]) c.dataset.rot = titulos[i];
    }));
  });
}

// "Saldo real" só nas abas Demo e Real (ordens na corretora); em Todos e Sem disparo o saldo é teórico, pelo preço
let rotuloSaldo = "Saldo teórico";
// render() troca a página inteira; com o mesmo estado e a mesma rota, só redesenha a cada 60 s (os textos "há X min"
// que não têm contador próprio). Auditoria de 17/11/2026: cada redesenho custava 25–51 ms e perdia a rolagem das tabelas.
let ultimoRender = { chave: "", hash: "", em: 0 };
function hashEstado(o) {
  let h = 0;
  const t = JSON.stringify(o);
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return `${t.length}:${h}`;
}

function render(forcar = true) {
  const rota = rotaAtual();
  rotuloSaldo = rota.tipo === "analise" && (rota.modo === "demo" || rota.modo === "real" || MODOS_VALIDOS.has(rota.modo) && !["todos", "sem"].includes(rota.modo)) ? "Saldo real" : "Saldo teórico";
  const chave = chaveRota(rota) + "|" + matchMedia("(max-width: 560px)").matches, hash = hashEstado([estadoBruto, erro]);
  if (!forcar && chave === ultimoRender.chave && hash === ultimoRender.hash && Date.now() - ultimoRender.em < 60e3) return;
  ultimoRender = { chave, hash, em: Date.now() };
  const nova = chaveRota(rota) !== rotaRenderizada;
  rotaRenderizada = chaveRota(rota);
  if (nova) { histFiltro = "padrao"; histLimite = HIST_PASSO; histOrdem = { col: null, dir: -1 }; histAtivo = ""; histLado = ""; }  // cada página abre o histórico do início
  // contexto da tela (lente) e do menu: nas telas do monitor os dois coincidem; nas outras o menu segue o último contexto escolhido
  const doMonitor = ["monitor", "analise", "termometro", "comparar"].includes(rota.tipo);
  ctxLente = rota.tipo === "comparar" ? "todos" : doMonitor ? rota.ctx : "forex";
  ctxAtual = doMonitor ? (rota.tipo === "comparar" ? "todos" : rota.ctx) : ctxLembrado;
  estado = ctxLente === "todos" ? estadoBruto : lente(estadoBruto, ctxLente);
  const corpo = rota.tipo === "projeto" ? vistaProjeto(rota.id) : rota.tipo === "monitor" ? vistaMonitor() : rota.tipo === "comparar" ? vistaComparar(rota.visao)
    : rota.tipo === "termometro" ? vistaTermometro() : rota.tipo === "analise" ? vistaAnalise(rota.fonte, rota.id, rota.modo, rota.conta) : vistaGeral();
  const app = document.getElementById("app");
  const abertos = nova ? null : new Map(detalhesComChave(app).map(([d, k]) => [k, d.open]));
  const focoMenu = focoNoMenu();
  // listas com rolagem própria (17/11/2026): a posição sobrevive ao redesenho da página
  const rolagens = nova ? new Map() : new Map([...app.querySelectorAll("[data-rolavel]")].map((el) => [el.dataset.rolavel, el.scrollTop]));
  app.innerHTML = htmlTopo(rota) + corpo;
  rolagens.size && app.querySelectorAll("[data-rolavel]").forEach((el) => { const y = rolagens.get(el.dataset.rolavel); if (y) el.scrollTop = y; });
  rotularTabelas(app);
  prepararRolagens(app);
  restaurarMenu(focoMenu);
  abertos?.size && detalhesComChave(app).forEach(([d, k]) => { if (abertos.has(k)) d.open = abertos.get(k); });
  document.title = rota.tipo === "projeto" ? `${PROJETOS[rota.id].nome} · Central de Comando` : rota.tipo === "monitor" ? "Monitor · Central de Comando" : rota.tipo === "termometro" ? "Termômetro · Central de Comando" : rota.tipo === "comparar" ? "Comparar mercados · Central de Comando" : rota.tipo === "analise" ? `${FONTES[rota.fonte] ?? "Consolidado"}${rota.ctx === "forex" ? "" : ` · ${NOME_CTX[rota.ctx]}`} · Central de Comando` : "Central de Comando";
  if (nova) {
    const main = app.querySelector("main");
    main.classList.add("entrada");
    contar(main);
    const atual = app.querySelector(".nav .aba[aria-current]");
    atual?.scrollIntoView({ block: "nearest", inline: "center" });
    if (rota.tipo !== "geral") scrollTo({ top: 0, behavior: reduzMovimento() ? "auto" : "smooth" });
  }
}

// os números dos indicadores sobem de zero ao abrir uma vista (uma vez; as atualizações seguintes não repetem)
const FORMATOS = { int: inteiro, usd };
function contar(raiz) {
  if (reduzMovimento()) return;
  const alvos = [...raiz.querySelectorAll("[data-contar]")];
  if (!alvos.length) return;
  const inicio = performance.now(), dur = 650;
  const passo = (t) => {
    const k = Math.min(1, (t - inicio) / dur), f = 1 - Math.pow(2, -10 * k); // ease-out exponencial
    alvos.forEach((el) => { const fmt = FORMATOS[el.dataset.fmt] ?? inteiro; el.textContent = fmt(Number(el.dataset.contar) * f); });
    if (k < 1) requestAnimationFrame(passo); else alvos.forEach((el) => { const fmt = FORMATOS[el.dataset.fmt] ?? inteiro; el.textContent = fmt(Number(el.dataset.contar)); });
  };
  requestAnimationFrame(passo);
}

function navegar() {
  if (!estadoBruto) return;
  if (document.startViewTransition && !reduzMovimento()) document.startViewTransition(() => render());
  else render();
}

async function recarregar(forcar = false) {  // só a atualização periódica pode pular o redesenho
  try { estadoBruto = await fonte.carregar(); erro = ""; } catch (e) { erro = `Falha ao carregar: ${e.message}`; }
  if (!estadoBruto) return;
  render(forcar === true);
  const sync = document.getElementById("sync");
  if (sync) { sync.classList.add("piscou"); setTimeout(() => sync.classList.remove("piscou"), 600); }
}

async function agir(fn) {
  try { await fn(); erro = ""; } catch (e) { erro = e.message.includes("já foi resolvida") ? "Essa decisão já tinha sido resolvida por outro canal (Telegram)." : e.message; }
  ajustando = null;
  await recarregar(true);
}

// a decisão sai do painel antes de recarregar: a resposta é visível na hora, mesmo com rede lenta
function sairDecisao(id) {
  const card = document.querySelector(`[data-decisao="${id}"]`);
  if (!card || reduzMovimento()) return Promise.resolve();
  card.classList.add("saindo");
  return new Promise((r) => setTimeout(r, 200));
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-acao]");
  if (!b) return;
  const id = Number(b.dataset.id), acao = b.dataset.acao;
  if (acao === "ajustar") { ajustando = id; return render(); }
  if (acao === "cancelar-ajuste") { ajustando = null; return render(); }
  if (acao === "pausa") { b.disabled = true; return agir(() => fonte.pausar(!estado.pausado)); }
  if (acao === "filtro") return definirFiltro(b.dataset.ativo);
  if (acao === "filtro-eventos") { filtroEventos = b.dataset.projeto; return render(); }
  // histórico: filtro, ordenação e "mostrar mais" só mexem na tela (nada é gravado)
  if (acao === "hist-filtro") { histFiltro = b.dataset.filtro; histLimite = HIST_PASSO; return render(); }
  if (acao === "hist-lado") { histLado = b.dataset.lado; histLimite = HIST_PASSO; return render(); }
  if (acao === "hist-mais") { histLimite += Number(b.dataset.passo) || HIST_PASSO; return render(); }
  if (acao === "hist-ordem") {
    const col = b.dataset.col;
    histOrdem = histOrdem.col !== col ? { col, dir: -1 } : histOrdem.dir < 0 ? { col, dir: 1 } : { col: null, dir: -1 };  // 3.º clique volta à ordem padrão
    histLimite = HIST_PASSO;
    render();
    return document.querySelector(`.th-ordem[data-col="${col}"]`)?.focus({ preventScroll: true });
  }
  if (acao === "ir-exec") {  // só navega: abre o painel de execução e leva o foco até ele
    const painel = document.getElementById("painel-exec"), det = painel?.querySelector("details.exec-editar");
    if (!painel) return;
    if (det) det.open = true;
    painel.scrollIntoView({ block: "start", behavior: reduzMovimento() ? "auto" : "smooth" });
    return det?.querySelector("summary")?.focus({ preventScroll: true });
  }
  // self-learning, consenso e login gravam em chaves globais que hoje são do Forex: fora dele, nada é gravado. A execução
  // tem chaves por contexto (execucao:* no Forex, execucao@bovespa:* na Bovespa) e vale onde o contexto a tiver.
  if ((["self-learning", "consenso", "login"].includes(acao) && ctxLente !== "forex")
      || (["execucao", "swing"].includes(acao) && !CONTEXTOS[ctxLente]?.execucao)) {
    erro = "Este controle não existe neste contexto.";
    return render();
  }
  if (acao === "swing") {
    const chave = b.dataset.chave, ligar = b.dataset.ligar === "true";
    const mapa = { ...(estado.execucao?.swing ?? {}) };
    if (ligar) mapa[chave] = true; else delete mapa[chave];
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarSwing(sufixoDe(ctxLente), mapa));
  }
  if (acao === "self-learning") {
    const ligar = b.dataset.ligar === "true";
    if (!ligar && !confirm("Pausar o self-learning? As rodadas dos agentes continuam; só param os ajustes automáticos de parâmetros até retomar.")) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarSelfLearning(ligar));
  }
  if (acao === "consenso") {
    const ligar = b.dataset.ligar === "true";
    if (ligar && !confirm("Ligar o consenso? O TikTok e o YouTube só geram sinal quando vários canais concordam (mínimo de canais, tolerância e bloqueio do lado oposto). Os sinais já abertos continuam. Vale em até ~10 s, sem reiniciar.")) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarConsenso(ligar));
  }
  if (acao === "audio") {
    const ligar = b.dataset.ligar === "true";
    if (ligar && !confirm("Escutar o áudio das lives desta fonte? A fala é enviada ao Groq para transcrição (grátis até ~8 h de áudio por dia) e entra na leitura das próximas passagens.")) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarAudio(b.dataset.chave, ligar));
  }
  if (acao === "execucao") {
    const modo = b.dataset.modo, f = b.dataset.fonte, u = b.dataset.unidade, ligar = b.dataset.ligar === "true";
    const alvo = u ?? `todo o ${FONTES[f]}`;
    if (ligar && modo === "real" && !confirm(`Ligar a execução na conta REAL da ${corretoraExec()} para ${alvo}? Os sinais novos passam a abrir ordens com dinheiro real.`)) return;
    if (!ligar && u == null && !confirm(`Desligar a execução ${modo === "demo" ? "demo" : "real"} de todo o ${FONTES[f]}? Os canais ligados um a um também desligam. As ordens já abertas continuam com stop e alvo.`)) return;
    const sel = structuredClone(estado.execucao?.selecao?.[modo] ?? {});
    sel.fontes = { ...(sel.fontes ?? {}) };
    sel.unidades = { ...(sel.unidades ?? {}) };
    if (u == null) {
      sel.fontes[f] = ligar;
      if (!ligar) sel.unidades[f] = Object.fromEntries(Object.entries(sel.unidades[f] ?? {}).filter(([, v]) => v === false));
    } else sel.unidades[f] = { ...(sel.unidades[f] ?? {}), [u]: ligar };
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarExecucao(modo, sel, sufixoDe(ctxLente)));
  }
  if (acao === "corretora") {
    const nova = b.dataset.corretora, atual = estado.execucao?.corretora ?? "capitalcom";
    if (ctxLente !== "forex" || nova === atual) return;
    const vivas = (estado.monitorOrdens ?? []).filter((o) => o.corretora === NOME_CORRETORA_FX[atual] && (o.status === "aberta" || o.status === "pendente")).length;
    if (!confirm(`Mandar as ordens novas do Forex para a ${NOME_CORRETORA_FX[nova]}?${vivas ? ` As ${vivas} ordens vivas na ${NOME_CORRETORA_FX[atual]} continuam lá, vigiadas até o stop ou o alvo.` : ""}${nova === "activtrades" ? " A ActivTrades ainda não está configurada no VPS: até a ponte dela rodar, nenhum sinal novo vira ordem." : ""}`)) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarCorretora(nova));
  }
  if (acao === "prioridade") {
    const modo = b.dataset.modo;
    if (modo === (estado.prioridade ?? "normal")) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarPrioridade(modo));
  }
  if (acao === "trocar-maquina") {
    const alvo = b.dataset.maquina, nome = NOME_MAQUINA[alvo];
    if (!confirm(`Passar o monitor para o ${nome}? TikTok, YouTube, Sites, Agentes, TradingView e Telegram param na outra máquina e ligam no ${nome} em 1 a 3 min; as gravações em andamento são encerradas. O MT5 e o YouTube da Bovespa continuam no VPS.${alvo === "mac" ? " O Mac precisa estar acordado e com o Rancher Desktop aberto." : ""}`)) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.pedirTroca(alvo));
  }
  if (acao === "login") {
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.pedirLogin(b.dataset.fonte));
  }
  if (acao === "monitor") {
    const fontes = b.dataset.fontes.split(","), ligar = b.dataset.ligar === "true";
    const nomes = fontes.map((f) => FONTES[f]).join(", ");
    const soPeriodicas = fontes.every((f) => FONTES_PERIODICAS.has(f));
    if (!ligar && !confirm(soPeriodicas ? `Desligar os agentes (${nomes})? As rodadas param (os sinais abertos continuam a ser conferidos) até ligar de novo.`
      : `Desligar o monitor (${nomes})? As gravações em andamento são encerradas e nada é capturado até ligar de novo.`)) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarMonitor(fontes.map((f) => f + sufixoDe(ctxLente)), ligar));  // youtube@bovespa nunca liga/desliga o youtube do Forex
  }
  if (acao === "confirmar-ajuste") {
    const texto = document.getElementById(`aj-${id}`).value.trim();
    if (!texto) return;
    b.disabled = true;
    return agir(async () => { await fonte.decidir(id, "ajustada", texto); await sairDecisao(id); });
  }
  if (acao === "aprovada" || acao === "descartada") {
    b.disabled = true;
    return agir(async () => { await fonte.decidir(id, acao); await sairDecisao(id); });
  }
});

function definirFiltro(sym) {
  filtroAtivo = sym || "";
  try { localStorage.setItem("filtroAtivo", filtroAtivo); } catch (e) { /* sem armazenamento: vale só nesta aba */ }
  render();
}

document.addEventListener("change", (ev) => {
  if (ev.target.matches("select[data-acao='filtro-lista']") && ev.target.value) definirFiltro(ev.target.value);
  if (ev.target.matches("select[data-acao='hist-ativo']")) {  // só filtra a tela; o foco volta ao seletor depois do redesenho
    histAtivo = ev.target.value; histLimite = HIST_PASSO;
    render();
    document.querySelector("select[data-acao='hist-ativo']")?.focus({ preventScroll: true });
  }
});

document.addEventListener("submit", (ev) => {
  if (ev.target.id !== "form-instrucao") return;
  ev.preventDefault();
  const texto = document.getElementById("inst-texto").value.trim();
  const botao = ev.target.querySelector("button[type=submit]");
  if (!texto) return;
  botao.disabled = true;
  agir(() => fonte.instruir(document.getElementById("inst-projeto").value, texto));
});

window.addEventListener("hashchange", navegar);
// o gráfico é desenhado para a largura da janela: ao cruzar a faixa estreita/larga, redesenha
let faixaLargura = innerWidth < 560, esperaRedim;
window.addEventListener("resize", () => { clearTimeout(esperaRedim); esperaRedim = setTimeout(() => { const f = innerWidth < 560; if (f !== faixaLargura && estado) { faixaLargura = f; render(); } }, 150); });

// ---------- login e início ----------

// erro que o Supabase devolve na URL quando o link expirou ou já foi usado
function erroDoLink() {
  const p = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
  const msg = p.get("error_description");
  return msg ? `O link não funcionou (${msg.replace(/\+/g, " ")}). Peça um novo abaixo.` : "";
}

function telaLogin(sb) {
  document.getElementById("app").innerHTML = `
  <section class="painel" id="login">
    <div class="marca" style="margin-bottom:14px"><span class="logo">${ico("zap")}</span><div><h1>Central de comando</h1><small>entre com o e-mail autorizado</small></div></div>
    <form id="form-login">
      <label for="email">E-mail autorizado</label>
      <input id="email" type="email" required autocomplete="email">
      <div class="acoes"><button class="btn primario" type="submit">${ico("send")} Receber link de acesso</button></div>
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
  if (!location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname); // tira o token da URL, mantém a rota
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
