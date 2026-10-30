// Central de comando: dashboard global (lê e escreve no mesmo banco que o Telegram e os agentes).
// Sem config.js: modo demonstração com dados de exemplo em memória.
// Rotas: #/ (visão geral) · #/p/<projeto> (detalhe) · #/monitor (monitor de lives e placar).

const PROJETOS = {
  servicos: { nome: "Serviços", longo: "Serviços: agentes de IA e MCP para SaaS" },
  video:    { nome: "Vídeo", longo: "Canal de vídeo build-in-public (Vínculo)" },
  produtos: { nome: "Produtos", longo: "Produtos digitais: templates → MCP pago" },
  cafe:     { nome: "Café", longo: "Loja Herança: Mercado Livre, TikTok, B2B" },
  tortas:   { nome: "Tortaria", longo: "Tortaria Mineira: Uber Eats + Glovo (Porto)" },
  monitor:  { nome: "Monitor", longo: "Monitor de lives (uso pessoal)" },
};
const RENDA = ["servicos", "video", "produtos", "cafe", "tortas"];
const FONTES = { tiktok: "TikTok", youtube: "YouTube", sites: "Sites" };
// ordem na lista: o que está acontecendo agora primeiro
const ORDEM_ESTADO = { gravando: 0, aberto: 0, analisando: 1, fila: 2, bloqueado: 3, executado: 4 };
const ROTULO_ESTADO = { gravando: "gravando", analisando: "analisando", fila: "na fila", offline: "offline",
  desconhecido: "desconhecido", aberto: "sinal aberto", executado: "encerrado", bloqueado: "bloqueado",
  ao_vivo: "ao vivo", login_necessario: "pede login" };
const RESULTADO = { aprovada: "Aprovada", ajustada: "Ajustada", descartada: "Descartada", expirada: "Expirou" };
const TIPO_EVENTO = { acao: "ação", aprendizado: "aprendizado", alerta: "alerta", resumo: "resumo", erro: "erro" };
const MARCOS_PADRAO = { M1: 4, M3: 13, M6: 26, M12: 52 };
const INICIO_PADRAO = "2026-10-26";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ico = (nome, cls = "") => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
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
  return {
    demo: false,
    sb,
    async carregar() {
      const [projetos, pendentes, resolvidas, instrucoes, eventos, cambio, controle, monitorFontes, monitorItens, monitorSinais, monitorResultados, kpis, lancamentos] = await Promise.all([
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
        sb.from("monitor_resultados").select("*").order("resolvido_em", { ascending: false }).then(ok),
        sb.from("kpis").select("data,projeto_id,kpi,valor").order("data", { ascending: false }).limit(600).then(ok),
        sb.from("v_lancamentos_usd").select("data,projeto_id,tipo,valor,moeda,valor_usd,descricao").order("data", { ascending: false }).limit(600).then(ok),
      ]);
      const ctl = Object.fromEntries(controle.map((c) => [c.chave, c.valor]));
      return { projetos, pendentes, resolvidas, instrucoes, eventos, taxa: cambio[0]?.brl ?? 5, pausado: ctl.pausa === true,
               painel: ctl.painel ?? null, kpis, lancamentos, monitorFontes, monitorItens, monitorSinais, monitorResultados,
               monitorComando: Object.fromEntries(Object.entries(ctl).filter(([k]) => k.startsWith("monitor:")).map(([k, v]) => [k.slice(8), v !== false])) };
    },
    decidir: (id, status, resposta) =>
      sb.rpc("decidir", { p_id: id, p_status: status, p_resposta: resposta || null, p_canal: "dashboard" }).then(ok),
    instruir: (projeto, texto) =>
      sb.from("instrucoes").insert({ projeto_id: projeto || null, texto, origem: "dashboard" }).then(ok),
    pausar: (valor) => sb.from("controle").upsert({ chave: "pausa", valor }).then(ok),
    // liga/desliga um monitor de lives (o monitor lê controle.monitor:<fonte> a cada 10 s)
    comandarMonitor: (fontes, ligar) =>
      sb.from("controle").upsert(fontes.map((f) => ({ chave: `monitor:${f}`, valor: ligar }))).then(ok),
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
      { id: "monitor", nome: "Monitor de lives (uso pessoal)", status: "ativo", fase: "TikTok, YouTube e sites em monitoramento", resumo: "Sinais só para o Diogo; nunca compartilhar.", decisoes_pendentes: 0, instrucoes_novas: 0, lucro_7d_usd: 0, lucro_28d_usd: 0, investido_usd: 0, ultima_atividade: null },
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
        monitor: { trilho: "uso pessoal (fora dos trilhos de renda)", status: "em teste no Mac; produção no VPS", pasta: "05-monitor-lives", projecao_usd_semana: null, kpis: [], criterios_parada: [] },
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
    monitorFontes: [
      { fonte: "tiktok", ligado: true, vagas: "5 vagas", resumo: "1 gravando, 0 na fila, 1 em análise", atualizado_em: new Date(agora).toISOString() },
      { fonte: "sites", ligado: true, vagas: "3 site(s)", resumo: "Foresignal: 1 sinal aberto em 2 pares", atualizado_em: new Date(agora).toISOString() },
    ],
    monitorItens: [
      { fonte: "tiktok", item: "canal.fx", nome: "@canal.fx", estado: "gravando", ativo: true, analisando: true, espectadores: 87, desde: new Date(agora - 0.4 * h).toISOString(), chamadas_hoje: 2, detalhe: "XAUUSD ao vivo", ultima_analise: new Date(agora - 0.07 * h).toISOString(), proxima_analise: new Date(agora + 0.03 * h).toISOString(), ciclo_fim: new Date(agora + 0.2 * h).toISOString() },
      { fonte: "tiktok", item: "outro", nome: "@outro", estado: "offline", ativo: false, analisando: false, chamadas_hoje: 0 },
      { fonte: "sites", item: "foresignal:EURUSD", nome: "Foresignal · EUR/USD", estado: "aberto", ativo: true, analisando: false, desde: new Date(agora - 1 * h).toISOString(), chamadas_hoje: 1, detalhe: "compra · válido até 07:51" },
      { fonte: "sites", item: "foresignal:GBPUSD", nome: "Foresignal · GBP/USD", estado: "executado", ativo: false, analisando: false, chamadas_hoje: 1, detalhe: "+11 pips" },
    ],
    monitorComando: { tiktok: true, sites: true },
    monitorResultados: [
      { fonte: "tiktok", sinal_id: 4, origem: "@mogotrading_off", instrumento: "XAUUSD", direcao: "venda", entrada: "4031–4034", status: "alvo", resultado_r: 2.1, resolvido_em: new Date(agora - 2 * h).toISOString() },
      { fonte: "sites", sinal_id: 9, origem: "Foresignal", instrumento: "NZDUSD", direcao: "compra", entrada: "0.5682", status: "alvo", resultado_pontos: 12, resultado_unidade: "pips", resultado_fonte: "site", resolvido_em: new Date(agora - 1 * h).toISOString() },
      { fonte: "sites", sinal_id: 10, origem: "CryptET", instrumento: "ADAUSDT", direcao: "venda", entrada: "0.2052", status: "stop", resultado_pontos: -12, resultado_unidade: "pontos", resultado_fonte: "site", resolvido_em: new Date(agora - 3 * h).toISOString() },
      { fonte: "sites", sinal_id: 11, origem: "Foresignal", instrumento: "AUDUSD", direcao: "compra", entrada: "0.6512", status: "expirado", resultado_fonte: "site", resolvido_em: new Date(agora - 5 * h).toISOString() },
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
    async comandarMonitor(fontes, ligar) {
      fontes.forEach((f) => {
        s.monitorComando[f] = ligar;
        const info = s.monitorFontes.find((x) => x.fonte === f);
        if (info) { info.ligado = ligar; info.resumo = ligar ? "voltando a checar" : "desligado pelo dashboard"; }
      });
    },
    aoMudar() {},
  };
}

// ---------- rotas ----------

function rotaAtual() {
  const h = location.hash;
  const m = h.match(/^#\/p\/(\w+)/);
  if (m && PROJETOS[m[1]]) return m[1] === "monitor" ? { tipo: "monitor" } : { tipo: "projeto", id: m[1] };
  if (h.startsWith("#/monitor")) return { tipo: "monitor" };
  return { tipo: "geral" };
}
const chaveRota = (r) => r.tipo + (r.id ?? "");

// ---------- componentes ----------

let fonte, estado, ajustando = null, erro = "", filtroEventos = "", rotaRenderizada = null;

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
  return `<div class="meta" style="margin-bottom:8px"><span><b class="num">${c.abertas.length}</b> abertas</span><span><b class="num">${c.feitas.length}</b> feitas</span><span>${pct}% concluído</span><span style="margin-left:auto">todo.md · ${haQuanto(estado.painel.gerado_em)}</span></div>
    <div class="progresso" aria-hidden="true" style="--cor:${cor(c.id)}"><i style="width:${pct}%"></i></div>
    <div style="margin-top:6px">${Object.entries(grupos).map(([secao, itens]) => `<div class="pend-grupo"><h3>${esc(secao)}</h3>${(compacto ? itens.slice(0, 5) : itens).map(item).join("")}${compacto && itens.length > 5 ? `<p class="meta" style="padding:6px 0 0 28px">+ ${itens.length - 5} nesta seção</p>` : ""}</div>`).join("") || `<p class="vazio">Tudo feito por aqui.</p>`}</div>
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

function htmlTopo(rota) {
  const e = estado;
  const semana = estado.painel ? Math.max(1, semanaDe(new Date(), new Date(estado.painel.data_inicio + "T00:00:00"))) : null;
  const aba = (href, atual, conteudo, corCss) => `<a class="aba" href="${href}" ${atual ? 'aria-current="page"' : ""} style="--cor:${corCss}">${conteudo}</a>`;
  const abas = [aba("#/", rota.tipo === "geral", `${ico("compass")} Visão geral`, "var(--ink)")]
    .concat(RENDA.map((id) => {
      const p = e.projetos.find((x) => x.id === id);
      const pend = p?.decisoes_pendentes ?? 0;
      return aba(`#/p/${id}`, rota.tipo === "projeto" && rota.id === id, `<i class="ponto"></i>${esc(PROJETOS[id].nome)}${pend ? `<span class="count alerta">${pend}</span>` : ""}`, cor(id));
    }))
    .concat(aba("#/monitor", rota.tipo === "monitor", `<i class="ponto"></i>Monitor${(e.monitorSinais ?? []).filter((s) => !s.ate || new Date(s.ate) > Date.now()).length ? `<span class="count">${(e.monitorSinais ?? []).filter((s) => !s.ate || new Date(s.ate) > Date.now()).length}</span>` : ""}`, cor("monitor")));
  return `<header class="topo">
    <div class="topo-linha">
      <div class="marca"><span class="logo">${ico("zap")}</span><div><h1>Central de comando</h1><small>${semana ? `Semana ${semana} do roteiro · ` : ""}${fonte.demo ? "modo demonstração" : "banco único"}</small></div></div>
      <span class="estado-agentes"><i class="ponto ${e.pausado ? "parado" : "vivo"}"></i>${e.pausado ? "Agentes pausados" : "Agentes ativos"}</span>
      <button class="btn ${e.pausado ? "primario" : ""}" data-acao="pausa">${ico(e.pausado ? "play" : "pause")} ${e.pausado ? "Retomar agentes" : "Pausar todos"}</button>
      <span class="sync" id="sync"><i class="ponto"></i>atualizado ${new Date().toLocaleTimeString("pt-PT", { timeStyle: "short" })}</span>
    </div>
    <nav class="nav" aria-label="Projetos">${abas.join("")}</nav>
  </header>`;
}

function htmlLinhaProjeto(p) {
  const c = calcularProjeto(p.id, estado);
  const pend = estado.painel ? `<span><b>${c.abertas.length}</b> pendências abertas</span>` : "";
  const st = c.status ? badgeStatus(c.status) : htmlBadge("muted", c.lanc.length ? "Sem projeção" : "Sem lançamentos", "clock");
  const fase = p.fase || c.cfg.status || "";
  const bala = c.proj ? htmlBala({ valor: c.media4, meta: c.proj.realista, min: c.proj.pessimista, max: c.proj.otimista, corCss: cor(p.id), rotuloMeta: "realista",
    esq: `média 4 sem. <b>${usd(c.media4)}</b>`, dir: `realista <b>${usd(c.proj.realista)}</b>` }) : `<div class="meta">${esc(c.cfg.trilho ?? "")}</div>`;
  return `<a class="proj" href="#/p/${p.id}" style="--cor:${cor(p.id)}" aria-label="${esc(PROJETOS[p.id]?.longo ?? p.nome)}">
    <i class="barra" aria-hidden="true"></i>
    <div class="corpo">
      <div>
        <div class="nome">${esc(PROJETOS[p.id]?.longo ?? p.nome)} ${st}</div>
        <div class="fase">${esc(fase)}</div>
        <div class="numeros">${pend}<span><b>${p.decisoes_pendentes}</b> decisões</span><span><b>${p.instrucoes_novas}</b> instruções novas</span><span>atividade ${haQuanto(p.ultima_atividade)}</span></div>
      </div>
      <div>${bala}</div>
    </div>
  </a>`;
}

function htmlFaixaGeral(e) {
  const painel = e.painel;
  const semana = painel ? Math.max(1, semanaDe(new Date(), new Date(painel.data_inicio + "T00:00:00"))) : null;
  const calc = RENDA.map((id) => calcularProjeto(id, e));
  const lucro28 = e.projetos.filter((p) => RENDA.includes(p.id)).reduce((a, p) => a + Number(p.lucro_28d_usd || 0), 0);
  const metaSemana = calc.reduce((a, c) => a + (c.proj?.realista ?? 0), 0);
  const abertas = painel ? painel.pendencias.filter((p) => !p.feito) : null;
  const doDiogo = abertas ? abertas.filter((p) => p.responsavel === "Diogo").length : 0;
  const sinais = (e.monitorSinais ?? []).filter((s) => !s.ate || new Date(s.ate) > Date.now()).length;
  const fontesNoAr = (e.monitorFontes ?? []).filter((f) => f.ligado && (Date.now() - new Date(f.atualizado_em)) / 6e4 <= 3).length;
  const bloco = (icone, rotulo, valor, sub) => `<div><span class="rotulo">${ico(icone)}${rotulo}</span><span class="valor">${valor}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
  return `<div class="faixa">
    ${bloco("flag", "Semana do roteiro", semana ? `<span data-contar="${semana}" data-fmt="int">${semana}</span><small>de 52</small>` : "—", painel ? `início em ${new Date(painel.data_inicio + "T00:00:00").toLocaleDateString("pt-PT")}` : "sem sincronização")}
    ${bloco("inbox", "Decisões pendentes", `<span data-contar="${e.pendentes.length}" data-fmt="int">${e.pendentes.length}</span>`, e.pendentes.length ? `a mais urgente vence em ${prazoRelativo(e.pendentes[0].prazo).texto}` : "nada esperando por você")}
    ${bloco("list", "Pendências abertas", abertas ? `<span data-contar="${abertas.length}" data-fmt="int">${abertas.length}</span>` : "—", abertas ? `${doDiogo} dependem do Diogo` : "rode sincronizar_painel.py")}
    ${bloco("target", "Lucro 28 dias", `<span data-contar="${lucro28}" data-fmt="usd">${usd(lucro28)}</span>`, `meta realista desta semana ${usd(metaSemana)}`)}
    ${bloco("radio", "Monitor de lives", `<span data-contar="${sinais}" data-fmt="int">${sinais}</span><small>sinais ativos</small>`, `${fontesNoAr} de ${Object.keys(FONTES).length} fontes no ar`)}
  </div>`;
}

function vistaGeral() {
  const e = estado;
  const renda = RENDA.map((id) => e.projetos.find((p) => p.id === id)).filter(Boolean);
  return `<main>
    <div class="col">
      ${fonte.demo ? `<div class="aviso neutro">${ico("alert")}<span>Modo demonstração: dados de exemplo. Crie <code>config.js</code> para ligar ao banco.</span></div>` : ""}
      ${erro ? `<div class="aviso erro">${ico("alert")}<span>${esc(erro)}</span></div>` : ""}
      ${htmlFaixaGeral(e)}
      ${htmlSecaoDecisoes(e.pendentes, e.resolvidas)}
      <section class="painel" aria-labelledby="h-projetos">
        <h2 id="h-projetos">${ico("folder")} Projetos <span class="count">${renda.length}</span><span class="direita meta">clique para ver pendências, metas e gráfico</span></h2>
        <div class="proj-lista">${renda.map(htmlLinhaProjeto).join("")}</div>
      </section>
    </div>
    <div class="col">
      <section class="painel" aria-labelledby="h-instrucao">
        <h2 id="h-instrucao">${ico("send")} Nova instrução</h2>
        ${htmlFormInstrucao("")}
        ${htmlInstrucoes(e.instrucoes.slice(0, 8))}
      </section>
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
      <section class="painel" aria-labelledby="h-pend">
        <h2 id="h-pend">${ico("list")} Pendências <span class="count ${c.abertas.length ? "alerta" : ""}">${c.abertas.length}</span></h2>
        ${htmlPendencias(c)}
      </section>
    </div>
    <div class="col">
      ${htmlSecaoDecisoes(pendentes, resolvidas, "Decisões deste projeto")}
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
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${seg}` : `${m}:${seg}`;
}
function textoDesde(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  const hora = new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  return `${hora} (há ${s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`})`;
}
function atualizarContadores() {
  document.querySelectorAll("[data-ate]").forEach((el) => { el.textContent = textoContador(el.dataset.ate); });
  document.querySelectorAll("[data-desde]").forEach((el) => { el.textContent = textoDesde(el.dataset.desde); });
}
setInterval(atualizarContadores, 1000);

function htmlContadores(i) {
  const partes = [];
  if (i.ultima_analise) partes.push(`<span>última análise <b class="num" data-desde="${esc(i.ultima_analise)}">${textoDesde(i.ultima_analise)}</b></span>`);
  if (i.proxima_analise && i.proxima_analise !== i.ciclo_fim) partes.push(`<span>próxima leitura em <b class="num" data-ate="${esc(i.proxima_analise)}">${textoContador(i.proxima_analise)}</b></span>`);
  if (i.ciclo_fim) partes.push(`<span>loop completo em <b class="num" data-ate="${esc(i.ciclo_fim)}">${textoContador(i.ciclo_fim)}</b></span>`);
  return partes.join("");
}

function htmlItemMonitor(i) {
  const cls = i.ativo ? "good" : i.analisando || i.estado === "fila" ? "warning" : "muted";
  const extras = [
    i.analisando && i.estado !== "analisando" ? `<span class="badge warning">analisando</span>` : "",
    i.espectadores != null ? `<span>${Number(i.espectadores).toLocaleString("pt-BR")} espectadores</span>` : "",
    i.ativo && i.desde ? `<span>há ${duracao(i.desde)}</span>` : "",
    i.chamadas_hoje ? `<span>${i.chamadas_hoje} chamada(s) hoje</span>` : "",
    htmlContadores(i),
  ].join("");
  const icone = i.fonte === "sites" ? `${iconeAtivo(i.item.split(":").pop())} ` : "";
  const vivo = i.ativo ? `<i class="ponto vivo" aria-hidden="true"></i>` : "";
  return `<li><span class="badge ${cls}">${vivo}${esc(ROTULO_ESTADO[i.estado] ?? i.estado)}</span> ${icone}${esc(i.nome)}
    <div class="meta">${extras}${i.detalhe ? `<span>${esc(i.detalhe)}</span>` : ""}</div></li>`;
}

// mesmo mapa de 05-monitor-lives/monitor_lives/instrumentos.py (icone_instrumento); são conteúdo, não ícones de interface
const BANDEIRAS = { EUR: "🇪🇺", USD: "🇺🇸", GBP: "🇬🇧", JPY: "🇯🇵", CHF: "🇨🇭", AUD: "🇦🇺", NZD: "🇳🇿", CAD: "🇨🇦",
  BRL: "🇧🇷", MXN: "🇲🇽", ZAR: "🇿🇦", TRY: "🇹🇷", SEK: "🇸🇪", NOK: "🇳🇴", SGD: "🇸🇬", HKD: "🇭🇰", CNH: "🇨🇳", PLN: "🇵🇱" };
const ICONES = { XAUUSD: "🥇", XAGUSD: "🥈", XPTUSD: "⚪", XPDUSD: "⚪", USOIL: "🛢️", UKOIL: "🛢️", NGAS: "🔥",
  COPPER: "🟠", DXY: "💵", NAS100: "🇺🇸📈", US30: "🇺🇸📈", US500: "🇺🇸📈", GER40: "🇩🇪📈", UK100: "🇬🇧📈",
  JP225: "🇯🇵📈", FRA40: "🇫🇷📈", EU50: "🇪🇺📈", HK50: "🇭🇰📈", AUS200: "🇦🇺📈", IBOV: "🇧🇷📈", WIN: "🇧🇷📈",
  WDO: "🇧🇷💵", BTCUSD: "₿", ETHUSD: "Ξ" };
function iconeAtivo(sym) {
  const t = String(sym || "").toUpperCase();
  if (ICONES[t]) return ICONES[t];
  if (t.startsWith("XAU")) return "🥇";
  if (t.startsWith("XAG")) return "🥈";
  if (t.length === 6 && BANDEIRAS[t.slice(0, 3)] && BANDEIRAS[t.slice(3)]) return BANDEIRAS[t.slice(0, 3)] + BANDEIRAS[t.slice(3)];
  if (t.startsWith("BTC")) return "₿";
  if (t.startsWith("ETH")) return "Ξ";
  if (t.endsWith("USDT") || t.endsWith("USDC") || (t.endsWith("USD") && t.length > 6 && !BANDEIRAS[t.slice(0, -3)])) return "🪙";
  return "📊";
}

function htmlSinal(s) {
  const venda = s.direcao === "venda";
  const ate = s.ate ? new Date(s.ate).toLocaleTimeString("pt-PT", { timeStyle: "short" }) : null;
  return `<li><span class="badge ${venda ? "venda" : s.direcao === "compra" ? "compra" : ""}">${esc((s.direcao || "?").toUpperCase())}</span>
    <span aria-hidden="true">${iconeAtivo(s.instrumento)}</span> <b>${esc(s.instrumento)}</b> · entrada ${esc(s.entrada ?? "—")} · SL ${esc(s.stop ?? "—")} · TP ${esc(s.alvos ?? "—")}
    <div class="meta"><span>${esc(s.origem)}</span><span>há ${duracao(s.desde)}</span>${ate ? `<span>válido até ${ate}</span>` : ""}</div></li>`;
}

// filtro por ativo da seção Monitor de lives (vale para sinais ativos, pares dos sites e placar)
let filtroAtivo = (() => { try { return localStorage.getItem("filtroAtivo") || ""; } catch (e) { return ""; } })();
const ATALHOS_ATIVO = [["", "Todos"], ["XAUUSD", "🥇 Ouro"], ["XAGUSD", "🥈 Prata"]];
const passaFiltro = (sym) => !filtroAtivo || String(sym || "").toUpperCase() === filtroAtivo;

function htmlFiltroAtivo(e) {
  const ativos = new Set([...(e.monitorSinais ?? []), ...(e.monitorResultados ?? [])].map((s) => String(s.instrumento || "").toUpperCase()));
  ATALHOS_ATIVO.forEach(([sym]) => sym && ativos.add(sym));
  const opcoes = [...ativos].filter(Boolean).sort();
  const chip = ([sym, rotulo]) => `<button class="btn" data-acao="filtro" data-ativo="${sym}" aria-pressed="${filtroAtivo === sym}">${rotulo}</button>`;
  return `<div class="filtros" style="align-items:center" role="group" aria-label="Filtrar por ativo">
    <span class="meta">Ativo:</span>${ATALHOS_ATIVO.map(chip).join("")}
    <select data-acao="filtro-lista" aria-label="Filtrar por ativo" style="width:auto;min-height:30px;padding:2px 8px;font-size:12.5px">
      <option value="">Outro ativo…</option>${opcoes.map((s) => `<option value="${s}" ${filtroAtivo === s ? "selected" : ""}>${iconeAtivo(s)} ${s}</option>`).join("")}
    </select>
    ${filtroAtivo ? `<span class="meta">mostrando só <b>${iconeAtivo(filtroAtivo)} ${esc(filtroAtivo)}</b></span>` : ""}
  </div>`;
}

const ROTULO_RESULTADO = { alvo: ["good", "win", "check"], stop: ["critical", "loss", "x"], expirado: ["muted", "expirou", "clock"],
  nao_acionada: ["muted", "não acionada", "clock"], sem_dados: ["muted", "sem preço", "loader"] };
const badgeResultado = (st) => { const [cls, txt, icone] = ROTULO_RESULTADO[st] ?? ["muted", st, "clock"]; return htmlBadge(cls, txt, icone); };

function htmlPlacar(e) {
  const resultados = e.monitorResultados ?? [];
  const pct = (w, l) => (w + l ? `${Math.round((100 * w) / (w + l))}%` : "—");
  const cartoes = Object.keys(FONTES).map((f) => {
    const lista = resultados.filter((r) => r.fonte === f && passaFiltro(r.instrumento));
    const w = lista.filter((r) => r.status === "alvo").length, l = lista.filter((r) => r.status === "stop").length;
    const outros = lista.length - w - l;
    const rs = lista.map((r) => r.resultado_r).filter((x) => x !== null && x !== undefined).map(Number);
    const rMedio = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) : null;
    const porOrigem = {};
    lista.forEach((r) => { const o = (porOrigem[r.origem] ??= { w: 0, l: 0 }); if (r.status === "alvo") o.w++; if (r.status === "stop") o.l++; });
    const origens = Object.entries(porOrigem).sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l));
    const amostra = w + l < 10 ? `<span class="meta">amostra pequena (${w + l} decididas): não conclua nada ainda</span>` : "";
    const resultado = (r) => r.resultado_pontos != null ? `${Number(r.resultado_pontos) > 0 ? "+" : ""}${r.resultado_pontos} ${esc(r.resultado_unidade ?? "")}`
      : r.resultado_r != null ? `${Number(r.resultado_r) > 0 ? "+" : ""}${Number(r.resultado_r).toFixed(2)} R` : "";
    const total = lista.length || 1;
    const barra = lista.length ? `<div class="placar-barra" role="img" aria-label="${w} win, ${l} loss, ${outros} outros"><i class="w" style="width:${(100 * w) / total}%"></i><i class="l" style="width:${(100 * l) / total}%"></i><i class="o" style="width:${(100 * outros) / total}%"></i></div>` : "";
    return `<div class="cartao">
      <div class="titulo">${FONTES[f]}</div>
      ${barra}
      <div class="meta"><span class="badge compra">${w} win</span><span class="badge venda">${l} loss</span>
        <span>acerto <b class="num">${pct(w, l)}</b></span>${rMedio ? `<span>R médio <b class="num">${rMedio}</b></span>` : ""}
        ${outros ? `<span>${outros} expirados/não acionados</span>` : ""}</div>
      ${amostra}
      ${origens.length ? `<ul class="lista">${origens.map(([o, c]) => `<li>${esc(o)}<div class="meta"><span>${c.w} win · ${c.l} loss</span><span>acerto ${pct(c.w, c.l)}</span></div></li>`).join("")}</ul>` : `<p class="vazio">Nenhum sinal resolvido ainda.</p>`}
      ${lista.length ? `<details><summary>${ico("chevron")}Últimos resultados</summary><ul class="lista">${lista.slice(0, 15).map((r) => `<li>${badgeResultado(r.status)} · ${iconeAtivo(r.instrumento)} <b>${esc(r.instrumento)}</b> ${esc((r.direcao || "").toUpperCase())} ${esc(r.entrada ?? "")}<div class="meta"><span>${esc(r.origem)}</span><span>${resultado(r)}</span><span>${quando(r.resolvido_em)}</span><span>${r.resultado_fonte === "site" ? "resultado do site" : "pelo preço"}</span></div></li>`).join("")}</ul></details>` : ""}
    </div>`;
  });
  return `<section class="painel" aria-labelledby="h-placar">
    <h2 id="h-placar">${ico("target")} Placar dos sinais <span class="count">últimos 30 dias</span>${filtroAtivo ? `<span class="count">${iconeAtivo(filtroAtivo)} ${esc(filtroAtivo)}</span>` : ""}</h2>
    <div class="grade-cartoes">${cartoes.join("")}</div>
    <p class="meta" style="margin-top:8px">Win = bateu o alvo antes do stop; loss = bateu o stop (mesma vela conta como loss). Sites: o resultado publicado pelo próprio site; lives e sureshotfx: velas de preço (Binance para cripto, Twelve Data para forex e ouro). Não é recomendação.</p>
  </section>`;
}

function htmlMonitor(e) {
  const fontes = Object.keys(FONTES).map((f) => {
    const info = e.monitorFontes.find((x) => x.fonte === f);
    const itens = e.monitorItens.filter((i) => i.fonte === f)
      .sort((a, b) => (ORDEM_ESTADO[a.estado] ?? 9) - (ORDEM_ESTADO[b.estado] ?? 9) || (b.espectadores ?? 0) - (a.espectadores ?? 0));
    const sinais = (e.monitorSinais ?? []).filter((s) => s.fonte === f && (!s.ate || new Date(s.ate) > Date.now())
      && passaFiltro(s.instrumento));
    // item cujo sinal aberto já aparece em "Sinais ativos" (sites: um item por par) não se repete na lista
    const comSinal = new Set(sinais.map((s) => s.item));
    const visiveis = itens.filter((i) => !(i.estado === "aberto" && comSinal.has(i.item))
      && (f !== "sites" || passaFiltro(i.item.split(":").pop())));
    const agora = visiveis.filter((i) => (ORDEM_ESTADO[i.estado] ?? 9) <= 2 || i.analisando);
    const resto = visiveis.filter((i) => !agora.includes(i));
    const atraso = info ? (Date.now() - new Date(info.atualizado_em)) / 6e4 : Infinity;
    const querLigado = e.monitorComando?.[f] !== false;  // sem comando = ligado
    const desligado = info && !info.ligado && /desligado pelo dashboard/.test(info.resumo ?? "");
    const status = !info ? { t: "sem dados", c: "muted" } : atraso > 3 ? { t: `sem sinal há ${duracao(info.atualizado_em)}`, c: "critical" }
      : desligado ? { t: "desligado", c: "muted" } : info.ligado ? { t: "no ar", c: "good" } : { t: "pausado", c: "critical" };
    // o comando leva até ~10 s para chegar e ~1 min para o estado voltar ao painel
    const pendente = info && atraso <= 3 && querLigado === desligado;
    const botao = `<button class="btn pequeno ${querLigado ? "" : "primario"}" data-acao="monitor" data-fontes="${f}" data-ligar="${!querLigado}">${ico(querLigado ? "power" : "play")} ${querLigado ? "Desligar" : "Ligar"}</button>`;
    const aviso = pendente ? `<span class="badge warning">${ico("loader")}${querLigado ? "ligando…" : "desligando…"}</span>`
      : atraso > 3 && info ? `<span class="meta">o contêiner não responde: no Mac/VPS, <code>docker compose up -d ${f}</code></span>` : "";
    return `<div class="cartao">
      <div class="titulo" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${FONTES[f]} <span class="badge ${status.c}">${status.c === "good" ? `<i class="ponto vivo" aria-hidden="true"></i>` : ""}${status.t}</span>${aviso}<span style="margin-left:auto">${botao}</span></div>
      ${info ? `<div class="meta"><span>${esc(info.vagas ?? "")}</span><span>${esc(info.resumo ?? "")}</span><span>atualizado ${quando(info.atualizado_em)}</span></div>` : ""}
      <div class="sinais"><div class="meta"><b>Sinais ativos</b> <span class="count">${sinais.length}</span></div>
        <ul class="lista">${sinais.map(htmlSinal).join("") || `<li class="vazio">Nenhum sinal ativo.</li>`}</ul></div>
      ${agora.length ? `<ul class="lista">${agora.map(htmlItemMonitor).join("")}</ul>` : sinais.length ? "" : `<p class="vazio">Nada ativo agora.</p>`}
      ${resto.length ? `<details><summary>${ico("chevron")}Outros ${resto.length} itens</summary><ul class="lista">${resto.map(htmlItemMonitor).join("")}</ul></details>` : ""}
    </div>`;
  });
  const algum = Object.keys(FONTES).some((f) => e.monitorComando?.[f] !== false);
  return `<section class="painel" aria-labelledby="h-monitor">
    <h2 id="h-monitor">${ico("radio")} Monitor de lives <span class="count">${e.monitorItens.filter((i) => i.ativo).length} ativos</span>
      <span class="count">${(e.monitorSinais ?? []).filter((s) => !s.ate || new Date(s.ate) > Date.now()).length} sinais</span>
      <span class="direita"><button class="btn pequeno" data-acao="monitor" data-fontes="${Object.keys(FONTES).join(",")}" data-ligar="${!algum}">${ico(algum ? "power" : "play")} ${algum ? "Desligar todos" : "Ligar todos"}</button></span></h2>
    ${htmlFiltroAtivo(e)}
    <div class="grade-cartoes">${fontes.join("")}</div>
    <p class="meta" style="margin-top:8px">Uso pessoal: sinais só para o Diogo, nunca compartilhar.</p>
  </section>`;
}

function vistaMonitor() {
  const e = estado;
  const p = e.projetos.find((x) => x.id === "monitor");
  const c = calcularProjeto("monitor", e);
  return `<main class="uma">
    ${erro ? `<div class="aviso erro">${ico("alert")}<span>${esc(erro)}</span></div>` : ""}
    <div class="cabecalho-proj" style="--cor:${cor("monitor")}">
      <div class="bloco">
        <a class="voltar" href="#/">${ico("back")} Visão geral</a>
        <h1><i class="ponto" aria-hidden="true"></i>${esc(PROJETOS.monitor.longo)}</h1>
        <div class="meta">${c.cfg.trilho ? `<span class="chip">${ico("compass")}${esc(c.cfg.trilho)}</span>` : ""}<span class="chip">${ico("folder")}05-monitor-lives</span></div>
        ${p?.fase ? `<div><b>Fase:</b> ${esc(p.fase)}</div>` : ""}
        ${c.cfg.status ? `<p class="resumo">${esc(c.cfg.status)}</p>` : ""}
      </div>
    </div>
    ${htmlMonitor(e)}
    ${htmlPlacar(e)}
    <section class="painel" aria-labelledby="h-pend">
      <h2 id="h-pend">${ico("list")} Pendências do monitor <span class="count ${c.abertas.length ? "alerta" : ""}">${c.abertas.length}</span></h2>
      ${htmlPendencias(c)}
    </section>
  </main>`;
}

// ---------- renderização e movimento ----------

function render() {
  const rota = rotaAtual();
  const nova = chaveRota(rota) !== rotaRenderizada;
  rotaRenderizada = chaveRota(rota);
  const corpo = rota.tipo === "projeto" ? vistaProjeto(rota.id) : rota.tipo === "monitor" ? vistaMonitor() : vistaGeral();
  const app = document.getElementById("app");
  app.innerHTML = htmlTopo(rota) + corpo;
  document.title = rota.tipo === "projeto" ? `${PROJETOS[rota.id].nome} · Central de Comando` : rota.tipo === "monitor" ? "Monitor · Central de Comando" : "Central de Comando";
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
  if (!estado) return;
  if (document.startViewTransition && !reduzMovimento()) document.startViewTransition(() => render());
  else render();
}

async function recarregar() {
  try { estado = await fonte.carregar(); erro = ""; } catch (e) { erro = `Falha ao carregar: ${e.message}`; }
  if (!estado) return;
  render();
  const sync = document.getElementById("sync");
  if (sync) { sync.classList.add("piscou"); setTimeout(() => sync.classList.remove("piscou"), 600); }
}

async function agir(fn) {
  try { await fn(); erro = ""; } catch (e) { erro = e.message.includes("já foi resolvida") ? "Essa decisão já tinha sido resolvida por outro canal (Telegram)." : e.message; }
  ajustando = null;
  await recarregar();
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
  if (acao === "monitor") {
    const fontes = b.dataset.fontes.split(","), ligar = b.dataset.ligar === "true";
    const nomes = fontes.map((f) => FONTES[f]).join(", ");
    if (!ligar && !confirm(`Desligar o monitor (${nomes})? As gravações em andamento são encerradas e nada é capturado até ligar de novo.`)) return;
    b.disabled = true; b.classList.add("ocupado");
    return agir(() => fonte.comandarMonitor(fontes, ligar));
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
