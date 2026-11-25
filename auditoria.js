// ---------- Auditor das lives (#/<mercado>/auditoria) ----------
// Página criada em 24/11/2026 (etapa 4 do auditor, pedido do Diogo). Mostra o que o auditor das lives
// (05-monitor-lives/monitor_lives/auditor*.py) fez: o estado do agente e da trava da assinatura, os canais revistos no
// dia (com a calibração do vídeo), o resumo por categoria, as melhorias por escopo e, no botão "Detalhes", cada
// operação revista no vídeo gravado. Só leitura: ligar e desligar o agente fica na página Comandos (só ela grava).
// Arquivo à parte do app.js (carregado antes dele), como o saude.js; usa os utilitários globais de lá (ico, esc,
// htmlBadge, quando, duracao, haQuanto, dinheiroSinal, estado, fonte, render) só na hora de desenhar.
// O modal é um <dialog> fora do #app: o redesenho periódico da página (a cada 30 s) não o fecha.

const AUD_CAT = {
  ganho: ["ganho", "good"], breakeven: ["empate", "muted"], loss_do_canal: ["perda do canal", "muted"],
  entrada_tardia: ["entrada tardia", "warning"], atraso_leitura: ["atraso de leitura", "warning"],
  execucao: ["execução", "critical"], saida_do_canal: ["não saiu com o canal", "warning"], saida_cedo: ["saiu cedo", "warning"],
  leitura_errada: ["leitura errada", "critical"], nao_executado: ["não executado", "muted"], indefinido: ["indefinido", "muted"],
};
const AUD_NOSSAS = new Set(["entrada_tardia", "atraso_leitura", "execucao", "saida_do_canal", "leitura_errada", "saida_cedo"]);
const AUD_MOTIVO = { pior: "pior do dia", todos: "canal do dia", rodizio: "rodízio", sem_ordem: "só sinais sem ordem", atrasados: "só atrasados", pedido: "pedido à mão" };
const AUD_SITUACAO = { concluida: ["concluída", "good", "check"], rodando: ["rodando", "warning", "loader"], fila: ["na fila", "muted", "clock"], erro: ["erro", "critical", "x"], sem_dados: ["sem vídeo", "muted", "clock"] };
const AUD_MELHORIA = { sugerida: ["sugerida", "muted"], aprovada: ["aprovada", "warning"], aplicada: ["aplicada", "good"], monitorando: ["monitorando", "good"],
  descartada: ["descartada", "muted"], revertida: ["revertida", "muted"] };
let audDia = null, audDialogo = null;

const audNum = (v, casas = 0) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas }).replace("-", "−"));
const audHora = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const audSeg = (s) => (s == null ? "—" : Math.abs(s) < 120 ? `${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.abs(Math.round(s))} s` : `${s > 0 ? "+" : "−"}${Math.round(Math.abs(s) / 60)} min`);
const audDiaFmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const audCanal = (c) => String(c ?? "").replace(/^\S*\s/, "");  // "▶️ princesarumoaosmilhoes" → "princesarumoaosmilhoes"
const audCat = (c) => { const [t, cls] = AUD_CAT[c] ?? [c ?? "sem categoria", "muted"]; return htmlBadge(cls, t); };
const audDinheiro = (v, moeda) => (v == null ? "—" : dinheiroSinal(v, moeda === "BRL" ? "BRL" : moeda || "BRL") || audNum(v, 2));

// ligado por padrão: Bovespa sim, Forex não (o mesmo PADRAO_LIGADO do auditor_agendador.py)
function audLigado(e, ctx) {
  const v = e.auditorControle?.[ctx];
  return v && typeof v === "object" && "ligado" in v ? v.ligado === true : ctx === "bovespa";
}

function audDiasDisponiveis(e, ctx) {
  const dias = new Set([...(e.auditorias ?? []), ...(e.auditoriaCanalDia ?? [])].filter((x) => x.contexto === ctx).map((x) => x.dia));
  return [...dias].sort().reverse();
}

// ---------- agente e trava ----------
function htmlAudTrilho(rot, pct, reset, aviso) {
  const p = pct == null ? null : Math.max(0, Math.min(100, pct));
  const nivel = p == null ? "sem" : p >= 100 ? "critico" : p >= aviso ? "atencao" : "ok";
  return `<div class="aud-trilho-linha" data-nivel="${nivel}">
    <span class="aud-trilho-rot">${esc(rot)}</span>
    <span class="saude-trilho" role="img" aria-label="${esc(rot)}: ${p == null ? "sem medida" : `${audNum(p)}% usado`}"><i class="saude-uso" style="width:${p == null ? 0 : Math.max(1, p).toFixed(1)}%"></i><i class="saude-marca forte" style="left:${aviso}%" title="o auditor para a partir de ${aviso}%"></i></span>
    <span class="aud-trilho-num"><b>${p == null ? "—" : `${audNum(p)}%`}</b>${reset ? ` <span class="meta">volta a zero ${esc(quando(reset))}</span>` : ""}</span></div>`;
}

function htmlAudTrava(t) {
  if (!t) return `<p class="aud-nota">Sem medida da assinatura ainda: o agendador publica a cada 10 min (tarefa <code>monitor-auditor</code> no VPS).</p>`;
  const est = { saudavel: ["saudável", "good", "check"], perto: ["perto do limite", "warning", "alert"], no_limite: ["no limite", "critical", "x"] }[t.estado] ?? ["sem medida", "muted", "clock"];
  const r = t.real, base = t.base === "real" && r;
  const origem = Object.entries(t.por_origem ?? {}).map(([k, v]) => `${esc(k)} ${audNum(v)}`).join(" · ");
  return `<div class="aud-trava">
    <p class="aud-trava-topo"><b>Trava da assinatura do Claude</b> ${htmlBadge(est[1], est[0], est[2])}
      <span class="meta">${base ? `uso real informado pelo Claude, medido ${esc(haQuanto(r.medido_em))}` : `estimativa por contagem: ${audNum(t.chamadas_5h)} de ~${audNum(t.limite_estimado_5h)} chamadas em 5 h`}</span></p>
    ${base ? htmlAudTrilho("Janela de 5 h", (r.uso_5h ?? 0) * 100, r.reset_5h, 80) + htmlAudTrilho("Semana", (r.uso_7d ?? 0) * 100, r.reset_7d, 90) : ""}
    <p class="aud-nota">O auditor só gasta com a trava saudável: as leituras das lives, que viram ordem, têm prioridade. Chamadas nas últimas 5 h: ${origem || "nenhuma"}.</p>
  </div>`;
}

function htmlAudAgente(e, ctx) {
  const st = e.auditorEstado?.[ctx] ?? {}, ligado = audLigado(e, ctx);
  const hoje = (e.auditorias ?? []).filter((a) => a.contexto === ctx && a.dia === st.dia);
  const rodandos = hoje.filter((a) => a.situacao === "rodando");  // até 2 canais ao mesmo tempo (24/11/2026)
  const total = (e.auditoriaCanalDia ?? []).filter((c) => c.contexto === ctx && c.dia === st.dia && /^youtube/.test(c.fonte)
    && (c.ordens > 0 || c.atrasados_sem_ordem > 0 || c.sem_execucao > 0)).length;
  const feitas = hoje.filter((a) => a.situacao !== "rodando" && a.situacao !== "fila").length;
  let situacao, detalhe = "";
  if (!ligado) { situacao = htmlBadge("muted", "desligado", "power"); detalhe = "Não roda até ser ligado na página Comandos."; }
  else if (st.situacao === "rodando") {
    situacao = htmlBadge("warning", "rodando", "loader");
    const pct = total ? Math.round((100 * (feitas + rodandos.reduce((s, a) => s + (a.progresso ?? 0), 0))) / total) : null;
    detalhe = `Dia ${audDiaFmt(st.dia)} · ${feitas} de ${total || "?"} canais prontos${rodandos.length ? ` · agora: ${rodandos.map((a) => `${esc(audCanal(a.canal))} (${esc(a.etapa ?? "começando")})`).join("; ")}` : ""} · começou ${esc(haQuanto(st.iniciado_em))}`
      + (pct != null ? `<span class="progresso aud-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Andamento da rodada"><i style="width:${pct}%"></i></span>` : "");
  } else if (st.situacao === "erro") { situacao = htmlBadge("critical", "parou com erro", "x"); detalhe = `Dia ${audDiaFmt(st.dia)}: ${esc(st.erro ?? "sem detalhe")}`; }
  else { situacao = htmlBadge("good", "aguardando a próxima rodada", "clock"); detalhe = st.dia ? `Última rodada: dia ${audDiaFmt(st.dia)}, ${audNum(st.relatorios)} canais em ${audNum(st.duracao_min)} min, terminou ${esc(quando(st.terminado_em))}.` : "Ainda não rodou."; }
  const hora = ctx === "bovespa" ? "20:00 de Brasília nos dias de pregão" : "19:00 de Nova York, de segunda a sexta (2 h depois do fecho)";
  return `<section class="painel" aria-labelledby="h-aud-agora">
    <h2 id="h-aud-agora">${ico("activity")} Agora ${situacao}</h2>
    <p class="aud-detalhe">${detalhe}</p>
    <p class="aud-nota">Roda às ${hora}${ligado && st.proxima ? `; próxima ${esc(quando(st.proxima))}` : ""}. No fim, só um aviso no Telegram: aí dá para pedir na sessão do Claude a conferência dos itens pendentes do auditor no <code>todo.md</code>. Ligar e desligar: <a href="${hrefCtx(ctx, "comandos")}">Comandos</a>.</p>
    ${htmlAudTrava(e.auditorTrava)}
  </section>`;
}

// ---------- canais do dia ----------
function htmlAudCalibracao(p) {
  if (!p) return `<span class="meta">sem perfil</span>`;
  const relogio = p.mostra_relogio == null ? null : Number(p.mostra_relogio) >= 0.5;
  const aj = p.ultimo_ajuste_s == null ? "" : ` · vídeo ${audSeg(Number(p.ultimo_ajuste_s))}`;
  return relogio == null ? `<span class="meta">ainda não medida${aj}</span>`
    : relogio ? `${htmlBadge("good", "relógio da tela", "clock")}<span class="meta">${aj}</span>`
    : `${htmlBadge("warning", "só pela API", "alert")}<span class="meta" title="Sem relógio na tela: a hora vem do início da live pela API e o vídeo gravado deriva">${aj}</span>`;
}

// tempo de cada canal na rodada (24/11/2026, pedido do Diogo): início, fim e duração; rodando, o tempo corrido
const audHoraMin = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const audDur = (s) => (s == null ? "—" : s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")} min`);
function htmlAudTempo(a) {
  if (!a?.iniciado_em) return "—";
  if (a.situacao === "rodando") return `${audDur((Date.now() - new Date(a.iniciado_em).getTime()) / 1e3)}<div class="meta">desde ${audHoraMin(a.iniciado_em)}</div>`;
  const s = a.duracao_s ?? (a.terminado_em ? (new Date(a.terminado_em) - new Date(a.iniciado_em)) / 1e3 : null);
  return `${audDur(s)}<div class="meta">${audHoraMin(a.iniciado_em)}${a.terminado_em ? ` → ${audHoraMin(a.terminado_em)}` : ""}</div>`;
}
function htmlAudCanais(e, ctx, dia) {
  const linhas = (e.auditoriaCanalDia ?? []).filter((c) => c.contexto === ctx && c.dia === dia && /^youtube/.test(c.fonte));
  const aud = new Map((e.auditorias ?? []).filter((a) => a.contexto === ctx && a.dia === dia).map((a) => [a.canal, a]));
  for (const a of aud.values()) if (!linhas.some((l) => l.canal === a.canal)) linhas.push({ canal: a.canal, ordens: a.n_ordens, operacoes: a.n_operacoes, resultado: a.resultado, moeda: a.moeda });
  if (!linhas.length) return `<section class="painel"><h2>${ico("list")} Canais do dia</h2><p class="vazio">Nenhum canal do YouTube com sinal neste dia.</p></section>`;
  const perfil = new Map((e.canaisPerfil ?? []).filter((p) => p.contexto === ctx).map((p) => [p.canal, p]));
  linhas.sort((x, y) => Number(x.resultado ?? 0) - Number(y.resultado ?? 0));
  const corpo = linhas.map((l) => {
    const a = aud.get(l.canal), s = a ? AUD_SITUACAO[a.situacao] ?? [a.situacao, "muted"] : null;
    const sit = !a ? htmlBadge("muted", "não revisto", "clock")
      : a.situacao === "rodando" ? `${htmlBadge(s[1], `${s[0]} ${Math.round(100 * (a.progresso ?? 0))}%`, s[2])}<div class="meta">${esc(a.etapa ?? "começando")}</div>`
      : htmlBadge(s[1], s[0], s[2]);
    const semOrdem = Number(l.atrasados_sem_ordem ?? 0) + Number(l.sem_execucao ?? 0);
    return `<tr>
      <td class="esq"><b>${esc(audCanal(l.canal))}</b>${a?.motivo ? `<div class="meta">${esc(AUD_MOTIVO[a.motivo] ?? a.motivo)}</div>` : ""}</td>
      <td class="esq">${sit}${a?.situacao === "erro" && a.erro ? `<div class="meta">${esc(a.erro)}</div>` : ""}</td>
      <td>${htmlAudTempo(a)}</td>
      <td>${audNum(l.operacoes ?? l.ordens)}</td>
      <td>${Number(l.ordens ?? 0) ? audDinheiro(l.resultado, l.moeda ?? a?.moeda) : "—"}</td>
      <td>${a ? audDinheiro(a.perda_canal, a.moeda) : "—"}</td>
      <td>${a ? audDinheiro(a.perda_nossa, a.moeda) : "—"}</td>
      <td>${semOrdem ? `${audNum(semOrdem)}<div class="meta">${audNum(l.atrasados_sem_ordem)} atrasados · ${audNum(l.sem_execucao)} sem execução</div>` : "0"}</td>
      <td class="esq">${htmlAudCalibracao(perfil.get(l.canal))}</td>
      <td>${a && a.situacao !== "rodando" ? `<button type="button" class="btn pequeno" data-aud="abrir" data-id="${a.id}">Detalhes</button>` : ""}</td></tr>`;
  }).join("");
  return `<section class="painel" aria-labelledby="h-aud-canais">
    <h2 id="h-aud-canais">${ico("list")} Canais do dia</h2>
    <p class="aud-nota">Todo canal do YouTube com sinal no dia, o pior primeiro. "Do canal" é a perda que o próprio canal teve; "nossa" é a que veio de atraso, entrada, execução, saída ou leitura. Sem ordem: sinais atrasados ou não executados, revistos só na entrada.</p>
    <div class="rolagem"><table class="tabela vira-lista aud-tabela">
      <thead><tr><th scope="col" class="esq">Canal</th><th scope="col" class="esq">Revisão</th><th scope="col">Tempo</th><th scope="col">Operações</th><th scope="col">Resultado</th>
        <th scope="col">Perda do canal</th><th scope="col">Perda nossa</th><th scope="col">Sem ordem</th><th scope="col" class="esq">Hora medida por</th><th scope="col" aria-label="Ação"></th></tr></thead>
      <tbody>${corpo}</tbody></table></div>
  </section>`;
}

// ---------- resumo do dia ----------
function htmlAudResumo(e, ctx, dia) {
  const auds = (e.auditorias ?? []).filter((a) => a.contexto === ctx && a.dia === dia && a.situacao === "concluida");
  if (!auds.length) return "";
  const moeda = auds[0].moeda ?? "BRL", soma = (k) => auds.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  const cats = {};
  for (const a of auds) for (const [c, v] of Object.entries(a.por_categoria ?? {})) {
    cats[c] ??= { ordens: 0, resultado: 0 };
    cats[c].ordens += Number(v.ordens ?? 0); cats[c].resultado += Number(v.resultado ?? 0);
  }
  const lista = Object.entries(cats).sort((x, y) => x[1].resultado - y[1].resultado);
  const maior = Math.max(1, ...lista.map(([, v]) => Math.abs(v.resultado)));
  const nossa = soma("perda_nossa"), canal = soma("perda_canal");
  return `<section class="painel" aria-labelledby="h-aud-resumo">
    <h2 id="h-aud-resumo">${ico("target")} Resumo do dia</h2>
    <p class="aud-frase">${auds.length} ${auds.length > 1 ? "canais revistos" : "canal revisto"}: resultado ${audDinheiro(soma("resultado"), moeda)}. Das perdas, ${audDinheiro(nossa, moeda)} vieram de causa nossa e ${audDinheiro(canal, moeda)} do próprio canal.</p>
    <table class="tabela aud-cats"><thead><tr><th scope="col" class="esq">Categoria</th><th scope="col">Ordens</th><th scope="col">Resultado</th><th scope="col" class="esq" aria-label="Peso"></th></tr></thead>
      <tbody>${lista.map(([c, v]) => `<tr><td class="esq">${audCat(c)}${AUD_NOSSAS.has(c) ? ` <span class="meta">causa nossa</span>` : ""}</td><td>${audNum(v.ordens)}</td><td>${audDinheiro(v.resultado, moeda)}</td>
        <td class="esq aud-peso"><i class="${v.resultado < 0 ? "perda" : "ganho"}" style="width:${((100 * Math.abs(v.resultado)) / maior).toFixed(1)}%"></i></td></tr>`).join("")}</tbody></table>
  </section>`;
}

// ---------- melhorias ----------
function htmlAudMelhorias(e, ctx) {
  const ms = (e.melhorias ?? []).filter((m) => m.contexto === ctx || m.contexto === "todos");
  if (!ms.length) return "";
  const abertas = ms.filter((m) => !["descartada", "revertida"].includes(m.situacao)), outras = ms.filter((m) => !abertas.includes(m));
  const linha = (m) => {
    const s = AUD_MELHORIA[m.situacao] ?? [m.situacao, "muted"];
    const escopo = m.escopo === "global" ? htmlBadge("warning", "global") : m.escopo === "padrao" ? htmlBadge("muted", `padrão ${m.padrao ?? ""}`) : esc(audCanal(m.canal));
    return `<tr><td class="esq"><b>${esc(m.titulo.replace(/ · ▶️ .*$/, ""))}</b>${m.contradiz ? `<div class="meta">${ico("alert")} contraria a melhoria ${m.contradiz}</div>` : ""}</td>
      <td class="esq">${escopo}</td><td class="esq">${audCat(m.categoria)}</td><td>${audNum(m.ocorrencias)}</td>
      <td>${m.impacto == null ? "—" : audDinheiro(m.impacto, ctx === "bovespa" ? "BRL" : "USD")}</td><td class="esq">${htmlBadge(s[1], s[0])}<div class="meta">#${m.id}</div></td></tr>`;
  };
  const tabela = (xs) => `<div class="rolagem"><table class="tabela vira-lista"><thead><tr><th scope="col" class="esq">Melhoria</th><th scope="col" class="esq">Escopo</th>
    <th scope="col" class="esq">Causa</th><th scope="col">Vezes</th><th scope="col">Impacto</th><th scope="col" class="esq">Situação</th></tr></thead><tbody>${xs.map(linha).join("")}</tbody></table></div>`;
  return `<section class="painel" aria-labelledby="h-aud-melhorias">
    <h2 id="h-aud-melhorias">${ico("bulb")} Melhorias</h2>
    <p class="aud-nota">Cada melhoria nasce no canal onde a causa apareceu e só vira global com a mesma causa em 3 ou mais canais em 14 dias. Aplicar é decisão sua: <code>python -m monitor_lives.auditor melhoria aplicar &lt;n.º&gt;</code>.</p>
    ${abertas.length ? tabela(abertas) : `<p class="vazio">Nenhuma melhoria aberta.</p>`}
    ${outras.length ? `<details data-chave="aud-melhorias-fechadas"><summary>Descartadas ou revertidas (${outras.length})</summary>${tabela(outras)}</details>` : ""}
  </section>`;
}

// ---------- modal com a análise completa ----------
// linha do tempo da operação: entrada e saída do canal (medidas no vídeo) contra as nossas, em segundos
function svgAudTempo(op) {
  const c0 = op.canal_entrou_em ? new Date(op.canal_entrou_em).getTime() : null;
  const pts = [];
  if (c0 != null) pts.push(["canal entra", c0, "canal"]);
  if (c0 != null && op.atraso_entrada_s != null) pts.push([op.ordens?.length ? "nossa entrada" : "nosso sinal", c0 + op.atraso_entrada_s * 1e3, "nos"]);
  const cs = op.canal_saiu_em ? new Date(op.canal_saiu_em).getTime() : null;
  if (cs != null) pts.push(["canal sai", cs, "canal"]);
  for (const s of op.atrasos_saida ?? []) if (cs != null && s.atraso_s != null) pts.push([`nossa saída${(op.atrasos_saida ?? []).length > 1 ? ` ${s.parcial}` : ""}`, cs + s.atraso_s * 1e3, "nos"]);
  if (pts.length < 2) return "";
  const t0 = Math.min(...pts.map((p) => p[1])), t1 = Math.max(...pts.map((p) => p[1])), W = 560, M = 14;
  const x = (t) => M + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * M);
  pts.sort((a, b) => a[1] - b[1]);
  // Rótulos do canal em cima e os nossos embaixo. Cada um vai para a 1.ª linha do seu lado em que cabe sem encostar
  // no anterior (largura estimada pelo número de letras), com quantas linhas forem precisas; um fio liga o rótulo ao
  // ponto. 24/11/2026: três saídas a minutos uma da outra escreviam por cima umas das outras.
  const LETRA = 6.4, FOLGA = 10, PASSO = 15;
  const linhas = { canal: [], nos: [] };
  const rotulos = pts.map(([rot, t, quem]) => {
    const texto = `${rot} ${audHora(new Date(t).toISOString())}`, larg = texto.length * LETRA, xp = x(t);
    const ancora = xp - larg / 2 < 2 ? "start" : xp + larg / 2 > W - 2 ? "end" : "middle";
    const ini = ancora === "start" ? xp : ancora === "end" ? xp - larg : xp - larg / 2;
    const ocup = linhas[quem];
    let linha = ocup.findIndex((fim) => ini > fim + FOLGA);
    if (linha < 0) { linha = ocup.length; ocup.push(0); }
    ocup[linha] = ini + larg;
    return { texto, xp, quem, linha, ancora };
  });
  const nCima = Math.max(1, linhas.canal.length), nBaixo = Math.max(1, linhas.nos.length);
  const Y = 8 + nCima * PASSO + 6, H = Y + 10 + nBaixo * PASSO + 4;
  // fios e pontos primeiro, textos por cima (com contorno da cor do fundo): um fio de fora nunca risca o texto de dentro
  const yt = ({ quem, linha }) => (quem === "canal" ? Y - 12 - linha * PASSO : Y + 20 + linha * PASSO);
  const marcas = rotulos.map((r) => {
    const fio = r.quem === "canal" ? [yt(r) + 3, Y - 5] : [Y + 5, yt(r) - 11];
    return `<g class="aud-t-${r.quem}"><line class="fio" x1="${r.xp.toFixed(1)}" x2="${r.xp.toFixed(1)}" y1="${fio[0]}" y2="${fio[1]}"/><circle cx="${r.xp.toFixed(1)}" cy="${Y}" r="4"/></g>`;
  }).join("") + rotulos.map((r) => `<g class="aud-t-${r.quem}"><text x="${r.xp.toFixed(1)}" y="${yt(r)}" text-anchor="${r.ancora}">${esc(r.texto)}</text></g>`).join("");
  return `<div class="aud-tempo-caixa"><svg class="aud-tempo" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(rotulos.map((r) => r.texto).join(", "))} (horário de Brasília)">
    <line class="eixo" x1="${M}" x2="${W - M}" y1="${Y}" y2="${Y}"/>${marcas}</svg></div>`;
}

function htmlAudOp(op, moeda) {
  const tipo = op.atrasado ? htmlBadge("warning", "atrasado, sem ordem", "clock") : op.sem_execucao ? htmlBadge("muted", "sem execução", "x") : "";
  const valor = op.resultado != null ? audDinheiro(op.resultado, moeda) : op.r_teorico != null ? `<b>${audNum(op.r_teorico, 1)} R</b> <span class="meta">teórico</span>` : `<span class="meta">${esc(op.status_placar ?? "sem resultado")}</span>`;
  const calib = op.calibracao === "relogio" ? "relógio da tela" : op.calibracao === "api" ? "início da live pela API" : op.calibracao ?? "—";
  return `<article class="aud-op">
    <header><b>${esc(op.instrumento ?? "")} ${esc(op.direcao ?? "")}</b> <span class="meta">sinal ${op.sinal_id}</span> ${audCat(op.categoria)} ${tipo}<span class="direita">${valor}</span></header>
    ${svgAudTempo(op)}
    <dl class="aud-fatos">
      <div><dt>Canal entrou</dt><dd>${audHora(op.canal_entrou_em)}</dd></div>
      <div><dt>Nosso atraso na entrada</dt><dd>${audSeg(op.atraso_entrada_s)}</dd></div>
      <div><dt>Canal saiu</dt><dd>${op.canal_saiu_em ? audHora(op.canal_saiu_em) : op.canal_fora ? "já estava fora" : "—"}</dd></div>
      <div><dt>Atraso nas saídas</dt><dd>${(op.atrasos_saida ?? []).map((s) => audSeg(s.atraso_s)).join(" · ") || "—"}</dd></div>
      <div><dt>Hora medida por</dt><dd>${esc(calib)}${op.ajuste_video_s != null ? ` <span class="meta">(vídeo ${audSeg(Number(op.ajuste_video_s))})</span>` : ""}</dd></div>
      <div><dt>Prints</dt><dd>${audNum(op.prints_video)} do vídeo · ${audNum(op.prints_locais)} nossos</dd></div>
    </dl>
    ${op.o_que_aconteceu ? `<p class="aud-texto"><b>O que aconteceu.</b> ${esc(op.o_que_aconteceu)}</p>` : ""}
    ${op.melhoria ? `<p class="aud-texto"><b>Melhoria sugerida.</b> ${esc(op.melhoria)}</p>` : ""}
  </article>`;
}

async function audAbrir(id) {
  const a = (estado.auditorias ?? []).find((x) => x.id === id);
  if (!a) return;
  if (!audDialogo) {
    audDialogo = document.createElement("dialog");
    audDialogo.className = "aud-dialogo";
    audDialogo.setAttribute("aria-labelledby", "aud-dialogo-titulo");
    audDialogo.addEventListener("click", (ev) => { if (ev.target === audDialogo || ev.target.closest("[data-aud=fechar]")) audDialogo.close(); });
    document.body.append(audDialogo);
  }
  const cab = `<header class="aud-dialogo-topo"><h2 id="aud-dialogo-titulo">${esc(audCanal(a.canal))} · ${audDiaFmt(a.dia)}</h2>
    <button type="button" class="btn pequeno" data-aud="fechar" aria-label="Fechar">${ico("x")}</button></header>`;
  audDialogo.innerHTML = `${cab}<p class="aud-nota">${ico("loader")} Carregando as operações…</p>`;
  audDialogo.showModal();
  let ops = [], perfil = (estado.canaisPerfil ?? []).find((p) => p.contexto === a.contexto && p.canal === a.canal), relatorio = a.relatorio;
  try {
    if (fonte.demo) ops = demoAuditoriaOps(a);
    else {
      const sb = fonte.sb;
      const [o, r] = await Promise.all([
        sb.from("monitor_auditoria_ops").select("*").eq("auditoria_id", id).order("sinal_id"),
        relatorio == null ? sb.from("monitor_auditorias").select("relatorio").eq("id", id).single() : Promise.resolve({ data: { relatorio } }),
      ]);
      if (o.error) throw new Error(o.error.message);
      ops = o.data ?? []; relatorio = r.data?.relatorio ?? null;
    }
  } catch (err) {
    audDialogo.innerHTML = `${cab}<p class="saude-alerta">${ico("alert")} Não deu para carregar as operações: ${esc(err.message)}. Feche e tente de novo.</p>`;
    return;
  }
  const comOrdem = ops.filter((o) => !o.atrasado && !o.sem_execucao), semOrdem = ops.filter((o) => o.atrasado || o.sem_execucao);
  const s = AUD_SITUACAO[a.situacao] ?? [a.situacao, "muted"];
  audDialogo.innerHTML = `${cab}
    <p class="aud-frase">${htmlBadge(s[1], s[0], s[2])} ${esc(AUD_MOTIVO[a.motivo] ?? a.motivo ?? "")} · resultado ${audDinheiro(a.resultado, a.moeda)} · perda do canal ${audDinheiro(a.perda_canal, a.moeda)} · perda nossa ${audDinheiro(a.perda_nossa, a.moeda)}
      · ${audNum(a.prints_video)} prints do vídeo em ${audNum((a.duracao_s ?? 0) / 60)} min</p>
    ${perfil ? `<p class="aud-nota">Perfil do canal (${audNum(perfil.operacoes)} operações revistas): parciais em média ${audNum(perfil.parciais_media, 1)}, move o stop em ${audNum(100 * (perfil.move_stop ?? 0))}% das operações, segura além da live em ${audNum(100 * (perfil.segura_alem_da_live ?? 0))}%, atraso mediano nosso na entrada ${audSeg(perfil.atraso_entrada_mediano_s)} e na saída ${audSeg(perfil.atraso_saida_mediano_s)}.</p>` : ""}
    <p class="aud-nota">Horas no horário de Brasília (UTC−3). Os textos "O que aconteceu" e "Melhoria sugerida" são da revisão pela IA e citam as horas em UTC, 3 h à frente.</p>
    ${comOrdem.length ? `<h3>Operações com ordem (${comOrdem.length})</h3>${comOrdem.map((o) => htmlAudOp(o, a.moeda)).join("")}` : ""}
    ${semOrdem.length ? `<h3>Sinais sem ordem (${semOrdem.length})</h3>${semOrdem.map((o) => htmlAudOp(o, a.moeda)).join("")}` : ""}
    ${!ops.length ? `<p class="vazio">Nenhuma operação gravada para esta revisão.</p>` : ""}
    ${relatorio ? `<details><summary>Relatório completo em texto</summary><pre class="aud-relatorio">${esc(relatorio)}</pre></details>` : ""}`;
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-aud]");
  if (!b || b.dataset.aud !== "abrir") return;
  audAbrir(Number(b.dataset.id));
});
document.addEventListener("change", (ev) => {
  if (!ev.target.matches("select[data-aud-dia]")) return;
  audDia = ev.target.value || null;
  render();
});

function vistaAuditoria(ctx) {
  const e = estado, dias = audDiasDisponiveis(e, ctx);
  const dia = dias.includes(audDia) ? audDia : dias[0];
  const seletor = dias.length > 1 ? `<label class="hist-ativo"><span>Dia</span><select data-aud-dia aria-label="Dia auditado">${dias.map((d) =>
    `<option value="${d}"${d === dia ? " selected" : ""}>${new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</option>`).join("")}</select></label>` : "";
  return `<main class="uma">
    ${avisoErro()}
    <div class="cabecalho-proj compacto" style="--cor:var(--monitor)">
      <div class="bloco">
        <h1><i class="ponto" aria-hidden="true"></i>Auditoria das lives</h1>
        <div class="meta"><span>Cada canal do YouTube com sinal no dia, revisto no vídeo gravado da live: quando o canal entrou e saiu contra quando nós entramos e saímos, e o que causou cada perda.</span></div>
      </div>
    </div>
    ${htmlAudAgente(e, ctx)}
    ${dia ? `<div class="aud-dia">${seletor}${dias.length === 1 ? `<span class="aud-nota">Dia auditado: ${audDiaFmt(dia)}</span>` : ""}</div>
      ${htmlAudCanais(e, ctx, dia)}${htmlAudResumo(e, ctx, dia)}` : `<section class="painel"><p class="vazio">Nenhum dia auditado ainda neste mercado.</p></section>`}
    ${htmlAudMelhorias(e, ctx)}
    ${htmlAudAntesDepois(e, ctx)}
    ${htmlAudAtrasados(e, ctx)}
  </main>`;
}

// ---------- etapa 5 (24/11/2026): marcas na curva, antes × depois por melhoria e tendência dos atrasados ----------
// Melhoria aplicada é uma mudança: entra na curva como marco de comando (losango, lista e "antes × depois" da própria
// curva). A rodada do auditor só observa: entra como marca discreta no eixo, sem antes × depois.
function audMarcosCurva(ctx) {
  const out = [];
  for (const m of estadoBruto?.melhorias ?? []) {
    if (m.contexto !== ctx && m.contexto !== "todos") continue;
    const canais = (m.aplicada_canais?.length ? m.aplicada_canais : [m.canal]).filter(Boolean).map(audCanal).join(", ");
    const alvo = m.escopo === "global" ? "todos os canais" : canais;
    const titulo = String(m.titulo ?? "").replace(/ · ▶️ .*$/, "");
    if (m.aplicada_em) out.push({ em: m.aplicada_em, texto: `Melhoria #${m.id} aplicada (${alvo}): ${titulo}`, ctx, fonte: "youtube" });
    if (m.revertida_em) out.push({ em: m.revertida_em, texto: `Melhoria #${m.id} revertida: ${titulo}`, ctx, fonte: "youtube" });
  }
  return out;
}

function audRodadasCurva(ctx) {
  const porDia = new Map();
  for (const a of estadoBruto?.auditorias ?? []) {
    if (a.contexto !== ctx || a.situacao !== "concluida" || !a.terminado_em) continue;
    const g = porDia.get(a.dia) ?? { em: a.terminado_em, canais: 0, nossa: 0, moeda: a.moeda };
    g.canais += 1;
    g.nossa += Number(a.perda_nossa ?? 0);
    if (a.terminado_em > g.em) g.em = a.terminado_em;
    porDia.set(a.dia, g);
  }
  return [...porDia].map(([dia, g]) => ({ em: g.em,
    texto: `Auditoria de ${audDiaFmt(dia)}: ${g.canais} ${g.canais > 1 ? "canais revistos" : "canal revisto"}, perda de causa nossa ${audNum(g.nossa, 2)} ${g.moeda ?? ""}` }));
}

// R por operação e quantas operações tiveram a causa, nos canais do escopo, 14 dias antes × depois da aplicação
const AUD_JANELA_DIAS = 14;
function audAntesDepois(m, linhasDia) {
  if (!m.aplicada_em) return null;
  const quandoAp = m.aplicada_em.slice(0, 10), d0 = new Date(`${quandoAp}T12:00:00`);
  const inicio = new Date(d0 - AUD_JANELA_DIAS * 864e5).toISOString().slice(0, 10);
  const canais = m.escopo === "global" ? null : new Set((m.aplicada_canais?.length ? m.aplicada_canais : [m.canal]).filter(Boolean));
  const excl = new Set(m.excluidos ?? []);
  const doEscopo = linhasDia.filter((x) => (m.contexto === "todos" || x.contexto === m.contexto) && (!canais || canais.has(x.canal)) && !excl.has(x.canal));
  const soma = (xs) => ({ ops: xs.reduce((s, x) => s + Number(x.operacoes ?? 0), 0), r: xs.reduce((s, x) => s + Number(x.r_total ?? 0), 0),
    causa: xs.reduce((s, x) => s + Number(x.por_categoria?.[m.categoria]?.ordens ?? 0), 0) });
  return { antes: soma(doEscopo.filter((x) => x.dia >= inicio && x.dia < quandoAp)), depois: soma(doEscopo.filter((x) => x.dia > quandoAp)) };
}

function htmlAudAntesDepois(e, ctx) {
  const aplicadas = (e.melhorias ?? []).filter((m) => (m.contexto === ctx || m.contexto === "todos") && m.aplicada_em && !m.revertida_em);
  if (!aplicadas.length) return "";
  const lado = (j) => (j.ops ? `${audNum(j.r / j.ops, 2)} R/op <span class="meta">em ${audNum(j.ops)} operações, causa em ${audNum(j.causa)}</span>` : `<span class="meta">sem operações</span>`);
  const linhas = aplicadas.map((m) => {
    const ad = audAntesDepois(m, e.auditoriaCanalDia ?? []);
    const pouco = !ad || ad.depois.ops < 10;
    const dif = ad && ad.antes.ops && ad.depois.ops ? ad.depois.r / ad.depois.ops - ad.antes.r / ad.antes.ops : null;
    const difTxt = dif == null ? "—" : `<b class="${dif < 0 ? "neg" : dif > 0 ? "pos" : ""}">${dif > 0 ? "+" : dif < 0 ? "−" : ""}${audNum(Math.abs(dif), 2)} R/op</b>`;
    return `<tr><td class="esq"><b>${esc(String(m.titulo).replace(/ · ▶️ .*$/, ""))}</b><div class="meta">#${m.id} · aplicada ${esc(quando(m.aplicada_em))}</div></td>
      <td class="esq">${ad ? lado(ad.antes) : "—"}</td><td class="esq">${ad ? lado(ad.depois) : "—"}</td>
      <td>${difTxt}${pouco ? `<div class="meta">cedo para concluir</div>` : ""}</td></tr>`;
  }).join("");
  return `<section class="painel" aria-labelledby="h-aud-ad">
    <h2 id="h-aud-ad">${ico("activity")} Antes × depois das melhorias aplicadas</h2>
    <p class="aud-nota">Nos canais do escopo de cada melhoria: ${AUD_JANELA_DIAS} dias antes da aplicação contra os dias depois, só dos dias auditados. Com menos de 10 operações depois é cedo para concluir; outras coisas mudam junto, então a diferença é indício, não prova.</p>
    <div class="rolagem"><table class="tabela vira-lista"><thead><tr><th scope="col" class="esq">Melhoria</th><th scope="col" class="esq">Antes</th><th scope="col" class="esq">Depois</th><th scope="col">Diferença</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
  </section>`;
}

// Atrasados por canal, dia a dia: a tendência esperada é cair (decisão do Diogo, 24/11/2026, opção B)
function htmlAudAtrasados(e, ctx) {
  const linhas = (e.auditoriaCanalDia ?? []).filter((x) => x.contexto === ctx && /^youtube/.test(x.fonte));
  const dias = [...new Set(linhas.map((x) => x.dia))].sort().slice(-7);
  if (dias.length < 2) return "";
  const porCanal = new Map();
  for (const x of linhas) {
    if (!dias.includes(x.dia)) continue;
    const m = porCanal.get(x.canal) ?? new Map();
    m.set(x.dia, x);
    porCanal.set(x.canal, m);
  }
  const sinais = (x) => Number(x.operacoes ?? 0) + Number(x.atrasados_sem_ordem ?? 0) + Number(x.sem_execucao ?? 0);
  const meio = Math.floor(dias.length / 2);
  const canais = [...porCanal].map(([canal, m]) => {
    const tot = [...m.values()].reduce((s, x) => s + Number(x.atrasados ?? 0), 0);
    const parte = (ds) => {
      const xs = ds.map((d) => m.get(d)).filter(Boolean), s = xs.reduce((a, x) => a + sinais(x), 0);
      return s ? xs.reduce((a, x) => a + Number(x.atrasados ?? 0), 0) / s : null;
    };
    return { canal, m, tot, p0: parte(dias.slice(0, meio)), p1: parte(dias.slice(meio)) };
  }).filter((c) => c.tot > 0).sort((a, b) => b.tot - a.tot);
  if (!canais.length) return "";
  const tend = (c) => (c.p0 == null || c.p1 == null ? htmlBadge("muted", "poucos dias") : c.p1 < c.p0 - 0.05 ? htmlBadge("good", "caindo", "baixa")
    : c.p1 > c.p0 + 0.05 ? htmlBadge("critical", "subindo", "alta") : htmlBadge("muted", "estável"));
  const cab = dias.map((d) => `<th scope="col">${new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</th>`).join("");
  const corpo = canais.map((c) => `<tr><td class="esq"><b>${esc(audCanal(c.canal))}</b></td>${dias.map((d) => {
    const x = c.m.get(d);
    return `<td>${x ? `${audNum(x.atrasados)} <small class="aud-de">de ${audNum(sinais(x))}</small>` : `<span class="meta">—</span>`}</td>`;
  }).join("")}<td class="esq">${tend(c)}</td></tr>`).join("");
  return `<section class="painel" aria-labelledby="h-aud-atr">
    <h2 id="h-aud-atr">${ico("clock")} Atrasados por canal</h2>
    <p class="aud-nota">Sinais que saíram atrasados (a posição do canal já corria no nosso print), de todos os sinais do canal no dia. A tendência compara a parte atrasada da 1.ª metade dos dias com a da 2.ª; com as melhorias de leitura, o esperado é cair.</p>
    <div class="rolagem"><table class="tabela aud-atrasos"><thead><tr><th scope="col" class="esq">Canal</th>${cab}<th scope="col" class="esq">Tendência</th></tr></thead><tbody>${corpo}</tbody></table></div>
  </section>`;
}

// ---------- dados de exemplo (modo demonstração) ----------
function demoAuditoria(agora) {
  const r = demoAuditoriaBase(agora);
  r.auditoriaCanalDia = [...r.auditoriaCanalDia, ...r.auditoriaCanalDiaExtra];
  delete r.auditoriaCanalDiaExtra;
  return r;
}

function demoAuditoriaBase(agora) {
  const dia = new Date(agora - 864e5).toISOString().slice(0, 10), h = 3600e3;
  const aud = (id, canal, motivo, resultado, canalP, nossa, extra = {}) => ({ id, contexto: "bovespa", dia, canal: `▶️ ${canal}`, motivo, situacao: "concluida", resultado, moeda: "BRL",
    n_ordens: 6, n_operacoes: 4, perda_canal: canalP, perda_nossa: nossa, progresso: 1, duracao_s: 2400, prints_video: 310,
    por_categoria: { ganho: { ordens: 2, resultado: 180 }, entrada_tardia: { ordens: 1, resultado: nossa }, loss_do_canal: { ordens: 1, resultado: canalP } }, ...extra });
  return {
    auditorias: [aud(1, "canal.wdo", "pior", -820, -120, -880), aud(2, "canal.win", "todos", 310, -60, -40),
      aud(3, "canal.acoes", "sem_ordem", 0, 0, 0, { n_ordens: 0, n_operacoes: 0, por_categoria: { atraso_leitura: { ordens: 2, resultado: 0 } } })],
    auditoriaCanalDia: [
      { contexto: "bovespa", dia, fonte: "youtube@bovespa", canal: "▶️ canal.wdo", ordens: 6, operacoes: 4, resultado: -820, moeda: "BRL", atrasados: 3, atrasados_sem_ordem: 2, sem_execucao: 1 },
      { contexto: "bovespa", dia, fonte: "youtube@bovespa", canal: "▶️ canal.win", ordens: 3, operacoes: 3, resultado: 310, moeda: "BRL", atrasados: 0, atrasados_sem_ordem: 0, sem_execucao: 0 },
      { contexto: "bovespa", dia, fonte: "youtube@bovespa", canal: "▶️ canal.acoes", ordens: 0, operacoes: 0, resultado: 0, moeda: "BRL", atrasados: 2, atrasados_sem_ordem: 2, sem_execucao: 0 },
    ],
    // dias anteriores (tendência dos atrasados e antes × depois): menos atrasados depois da melhoria #6
    ...(() => {
      const extra = [];
      for (let k = 2; k <= 7; k++) {
        const d = new Date(agora - k * 864e5).toISOString().slice(0, 10), depois = k <= 3;
        extra.push({ contexto: "bovespa", dia: d, fonte: "youtube@bovespa", canal: "▶️ canal.wdo", ordens: 5, operacoes: 4, resultado: depois ? 120 : -300, r_total: depois ? 0.8 : -1.6,
          moeda: "BRL", atrasados: depois ? 1 : 4, atrasados_sem_ordem: depois ? 1 : 3, sem_execucao: 1, por_categoria: { atraso_leitura: { ordens: depois ? 0 : 2, resultado: 0 } } });
        extra.push({ contexto: "bovespa", dia: d, fonte: "youtube@bovespa", canal: "▶️ canal.win", ordens: 3, operacoes: 3, resultado: 60, r_total: 0.4, moeda: "BRL",
          atrasados: 1, atrasados_sem_ordem: 0, sem_execucao: 0, por_categoria: {} });
      }
      return { auditoriaCanalDiaExtra: extra };
    })(),
    canaisPerfil: [
      { contexto: "bovespa", canal: "▶️ canal.wdo", operacoes: 9, parciais_media: 2.1, move_stop: 0.8, segura_alem_da_live: 0.2, atraso_entrada_mediano_s: 150, atraso_saida_mediano_s: 62, mostra_relogio: 1, ultimo_ajuste_s: 199 },
      { contexto: "bovespa", canal: "▶️ canal.win", operacoes: 3, parciais_media: 1, move_stop: 0.3, segura_alem_da_live: 0, atraso_entrada_mediano_s: 40, atraso_saida_mediano_s: 20, mostra_relogio: 0, ultimo_ajuste_s: -5 },
    ],
    melhorias: [
      { id: 2, contexto: "bovespa", titulo: "Zerar a cópia quando a posição do canal some, diminui por último ou vira de lado", escopo: "canal", canal: "▶️ canal.wdo", categoria: "saida_do_canal", ocorrencias: 2, impacto: -1460, situacao: "sugerida" },
      { id: 6, contexto: "bovespa", titulo: "Reduzir o atraso entre a operação do canal e o nosso sinal", escopo: "global", categoria: "atraso_leitura", ocorrencias: 7, impacto: 0, situacao: "aplicada",
        aplicada_em: new Date(agora - 3.5 * 864e5).toISOString() },
      { id: 4, contexto: "bovespa", titulo: "Segurar a última parcial enquanto o canal segue posicionado", escopo: "canal", canal: "▶️ canal.wdo", categoria: "saida_cedo", ocorrencias: 2, impacto: 385, situacao: "sugerida", contradiz: 2 },
    ],
    auditorEstado: { bovespa: { ligado: true, situacao: "concluida", dia, relatorios: 3, duracao_min: 64, terminado_em: new Date(agora - 14 * h).toISOString(), proxima: new Date(agora + 8 * h).toISOString() },
      forex: { ligado: false, proxima: new Date(agora + 9 * h).toISOString() } },
    auditorControle: {},
    auditorTrava: { estado: "saudavel", base: "real", chamadas_5h: 120, limite_estimado_5h: 540, por_origem: { leitura: 96, auditor: 24 },
      real: { uso_5h: 0.42, reset_5h: new Date(agora + 1.4 * h).toISOString(), uso_7d: 0.58, reset_7d: new Date(agora + 110 * h).toISOString(), medido_em: new Date(agora - 4 * 60e3).toISOString() } },
  };
}

function demoAuditoriaOps(a) {
  const base = new Date(`${a.dia}T15:01:44Z`).getTime();
  if (a.n_ordens === 0) return [{ sinal_id: 4391, instrumento: "WDO", direcao: "venda", categoria: "atraso_leitura", atrasado: true, r_teorico: -1, status_placar: "stop",
    canal_entrou_em: new Date(base).toISOString(), atraso_entrada_s: 1980, atrasos_saida: [], calibracao: "relogio", ajuste_video_s: -5, prints_video: 31, prints_locais: 2,
    o_que_aconteceu: "O canal já estava vendido havia 33 min quando o nosso print leu a posição." }];
  const z = (hms) => new Date(`${a.dia}T${hms}Z`).toISOString();
  return [
    { sinal_id: 5, ordens: [1, 2, 3], instrumento: "WDO", direcao: "venda", resultado: -890, categoria: "leitura_errada", canal_entrou_em: z("12:15:09"), atraso_entrada_s: 790,
      canal_saiu_em: z("12:32:49"), atrasos_saida: [{ parcial: 1, atraso_s: 7320 }, { parcial: 2, atraso_s: 7512 }, { parcial: 3, atraso_s: 7512 }], calibracao: "relogio", ajuste_video_s: -5,
      prints_video: 68, prints_locais: 2, o_que_aconteceu: "O monitor abriu a venda às 12:28:18 sobre um sinal de 12:27:24; nesse momento o canal estava zerado." },
    { sinal_id: 3238, ordens: [1036], instrumento: "WDO", direcao: "venda", resultado: -345, categoria: "entrada_tardia", canal_entrou_em: new Date(base).toISOString(), atraso_entrada_s: 3743,
      canal_saiu_em: new Date(base + 3748e3).toISOString(), atrasos_saida: [{ parcial: 1, atraso_s: 1200 }], calibracao: "relogio", ajuste_video_s: 199, prints_video: 74, prints_locais: 1,
      o_que_aconteceu: "O canal entrou vendido 20 às 12:01 e zerou às 13:04:12; a nossa venda abriu às 13:04:07, cinco segundos antes de ele sair.",
      melhoria: "Não abrir ordem para um sinal com mais de 15 min de atraso." },
    { sinal_id: 4405, ordens: [1201, 1202], instrumento: "WIN", direcao: "compra", resultado: 120, categoria: "ganho", canal_entrou_em: new Date(base + 9e6).toISOString(), atraso_entrada_s: 95,
      canal_saiu_em: new Date(base + 9e6 + 1171e3).toISOString(), atrasos_saida: [{ parcial: 1, atraso_s: -300 }, { parcial: 2, atraso_s: 40 }], calibracao: "relogio", ajuste_video_s: -5, prints_video: 58, prints_locais: 4 },
    { sinal_id: 4420, instrumento: "WDO", direcao: "compra", categoria: "nao_executado", sem_execucao: true, status_placar: "nao_acionada", canal_entrou_em: new Date(base + 1.2e7).toISOString(), atraso_entrada_s: 70,
      atrasos_saida: [], calibracao: "api", prints_video: 24, prints_locais: 1, o_que_aconteceu: "Leitura em dia com o canal; a entrada não foi tocada no prazo." },
  ];
}
