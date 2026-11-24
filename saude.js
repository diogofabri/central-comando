// ---------- Saúde das integrações e dos limites (#/saude) ----------
// Página criada em 23/11/2026 (pedido do Diogo, depois do alerta de Disk IO do Supabase): cada limite que pode parar a
// aplicação, com o uso atual, o limite, a folga e o nível (ok, atenção a partir de 80%, crítico a partir de 90%).
// Lê controle.saude:painel, publicado a cada 15 min por 00-central-comando/cliente/saude.py, que também avisa no
// Telegram quando um item sobe de nível. Só leitura: a página não grava nada.
// Fica num arquivo à parte do app.js (carregado antes dele); usa os utilitários globais de lá (ico, esc, htmlBadge,
// avisoErro, quando, estado) só na hora de desenhar.

const SAUDE_NIVEL = {
  ok: { c: "good", t: "ok", i: "check" },
  atencao: { c: "warning", t: "atenção", i: "alert" },
  critico: { c: "critical", t: "crítico", i: "x" },
  sem_dado: { c: "muted", t: "sem medição", i: "clock" },
};
const saudeNum = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 }));

// O retrato envelhece: sem medição nova em 3 intervalos, o coletor parou e os números não valem como "agora".
function saudeParado(s, agora = Date.now()) {
  return !!s && agora - new Date(s.medido_em).getTime() > 3 * (s.intervalo_min ?? 15) * 60e3;
}

// Contagem para o menu: itens que geram aviso em atenção ou crítico (ou 1, se o coletor parou).
function saudeProblemas(s) {
  if (!s) return 0;
  const n = s.itens.filter((i) => i.avisar && (i.nivel === "atencao" || i.nivel === "critico")).length;
  return n + (saudeParado(s) ? 1 : 0);
}

function svgSaudeSerie(serie, atencao, critico) {
  if (!serie || serie.length < 3) return "";
  const W = 132, H = 30, max = Math.max(100, ...serie.map((p) => p[1])) * 1.05;
  const x = (k) => (k / (serie.length - 1)) * W, y = (v) => H - 1 - (v / max) * (H - 2);
  const d = serie.map((p, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const horas = Math.max(1, Math.round((serie[serie.length - 1][0] - serie[0][0]) / 3600));
  const pico = Math.max(...serie.map((p) => p[1]));
  return `<svg class="saude-serie" viewBox="0 0 ${W} ${H}" role="img" aria-label="Últimas ${horas} h: pico de ${saudeNum(pico)}% do limite">
    <line class="lim" x1="0" x2="${W}" y1="${y(critico).toFixed(1)}" y2="${y(critico).toFixed(1)}"/>
    <path d="${d}"/></svg>`;
}

function htmlSaudeItem(i) {
  // Teto nosso (sem aviso) perto do limite não é risco: selo neutro "no teto", nunca vermelho
  const noTeto = !i.avisar && (i.nivel === "atencao" || i.nivel === "critico");
  const n = noTeto ? { c: "muted", t: i.pct >= 100 ? "no teto" : "perto do teto", i: "clock" } : SAUDE_NIVEL[i.nivel] ?? SAUDE_NIVEL.sem_dado, pct = i.pct;
  const marca = (v, forte) => (v > 0 && v < 100 ? `<i class="saude-marca${forte ? " forte" : ""}" style="left:${v}%" title="${forte ? "crítico" : "atenção"} a partir de ${v}%"></i>` : "");
  const folga = pct == null ? "" : pct >= 100 ? `${saudeNum(pct - 100)}% acima do limite` : `${saudeNum(100 - pct)}% de folga`;
  const barra = pct == null ? "" : `<div class="saude-trilho" role="img" aria-label="${saudeNum(pct)}% do limite">
      <i class="saude-uso" style="width:${Math.min(100, Math.max(1, pct)).toFixed(1)}%"></i>
      ${marca(i.atencao, false)}${marca(i.critico, true)}</div>`;
  return `<li class="saude-item" data-nivel="${noTeto ? "teto" : esc(i.nivel)}">
    <div class="saude-topo"><b>${esc(i.nome)}</b>${htmlBadge(n.c, n.t, n.i)}${i.avisar ? "" : `<span class="meta" title="Teto nosso: bater o limite é o funcionamento normal, não um risco">sem aviso</span>`}</div>
    <div class="saude-valor">${pct == null ? `<span class="meta">${esc(i.detalhe || "sem medição")}</span>`
      : `<b>${saudeNum(pct)}%</b><span>${saudeNum(i.valor)} de ${saudeNum(i.limite)} ${esc(i.unidade)}</span><span class="meta">${folga}</span>`}</div>
    ${barra}
    ${svgSaudeSerie(i.serie, i.atencao, i.critico)}
    ${pct == null ? "" : `<p class="saude-detalhe">${esc(i.detalhe)}${i.origem ? ` <span class="meta">Limite: ${esc(i.origem)}.</span>` : ""}</p>`}
  </li>`;
}

function htmlSaude(s) {
  if (!s) {
    return `<section class="painel"><p class="vazio">Ainda sem medição. O coletor roda no VPS a cada 15 min
      (<code>python 00-central-comando/cliente/saude.py medir</code>; tarefa <code>central-saude</code>).</p></section>`;
  }
  const grupos = [];
  for (const i of s.itens) {
    let g = grupos.find((x) => x.nome === i.grupo);
    if (!g) grupos.push((g = { nome: i.grupo, itens: [] }));
    g.itens.push(i);
  }
  const ordem = { critico: 3, atencao: 2, ok: 1, sem_dado: 0 };
  const piorDe = (itens) => itens.reduce((p, i) => (i.avisar && ordem[i.nivel] > ordem[p] ? i.nivel : p), "ok");
  const crit = s.itens.filter((i) => i.avisar && i.nivel === "critico").length, aten = s.itens.filter((i) => i.avisar && i.nivel === "atencao").length;
  const parado = saudeParado(s);
  const resumo = parado ? htmlBadge("critical", "coletor parado", "x")
    : crit ? htmlBadge("critical", `${crit} crítico${crit > 1 ? "s" : ""}`, "x") : aten ? htmlBadge("warning", `${aten} em atenção`, "alert") : htmlBadge("good", "tudo dentro dos limites", "check");
  return `<section class="painel saude-resumo" aria-labelledby="h-saude-resumo">
      <h2 id="h-saude-resumo">${ico("activity")} Agora ${resumo}</h2>
      <p class="meta">Medido há ${duracao(s.medido_em)} (${quando(s.medido_em)}) em ${esc(s.maquina ?? "?")}, a cada ${s.intervalo_min ?? 15} min. Aviso no Telegram quando um item passa de 80% (atenção) ou de 90% (crítico) do limite, e quando volta ao normal.</p>
      ${parado ? `<p class="saude-alerta">${ico("alert")} Sem medição nova há mais de ${3 * (s.intervalo_min ?? 15)} min: os números abaixo são os últimos conhecidos. Conferir a tarefa <code>central-saude</code> no VPS.</p>` : ""}
    </section>
    ${grupos.map((g, k) => {
      const p = SAUDE_NIVEL[piorDe(g.itens)];
      return `<section class="painel" aria-labelledby="h-saude-${k}">
        <h2 id="h-saude-${k}">${esc(g.nome)} ${htmlBadge(p.c, p.t, p.i)}</h2>
        <ul class="saude-lista">${g.itens.map(htmlSaudeItem).join("")}</ul>
      </section>`;
    }).join("")}`;
}

// Folga do VPS (24/11/2026, pedido do Diogo): medição de hora em hora por 00-central-comando/cliente/folga.py (tarefa
// central-folga, sem IA), publicada em controle.saude:folga. Responde "dá para pôr mais coisas em paralelo?": CPU da
// máquina contra a linha de 85% da guarda das lives, uso da janela de 5 h da assinatura do Claude e as aberturas de live
// barradas pela guarda em cada hora.
const FOLGA_NIVEL = { folga: { c: "good", t: "há folga", i: "check" }, justo: { c: "warning", t: "justo", i: "alert" },
  limite: { c: "critical", t: "no limite", i: "x" } };
const folgaBloq = (p) => Object.values(p.bloqueios ?? {}).reduce((s, b) => s + (b.total ?? 0), 0);
function svgFolga(pontos) {
  const W = 1200, H = 240, E = 40, D = 10, T = 10, HB = 34, B = H - 22, Y0 = B - HB - 8;
  // eixo do tempo terminando na última medição, com pelo menos 6 h (poucas medições ficam à direita, sem se espremer)
  const t1 = new Date(pontos[pontos.length - 1].em).getTime(), t0 = Math.min(new Date(pontos[0].em).getTime(), t1 - 6 * 36e5);
  const x = (p) => E + ((new Date(p.em).getTime() - t0) / (t1 - t0)) * (W - E - D);
  const y = (v) => Y0 - (Math.min(v, 100) / 100) * (Y0 - T);
  const linha = (campo) => {
    let d = "", aberto = false;
    for (const p of pontos) {
      if (p[campo] == null) { aberto = false; continue; }
      d += `${aberto ? "L" : "M"}${x(p).toFixed(1)},${y(p[campo]).toFixed(1)} `; aberto = true;
    }
    return d.trim();
  };
  // cada barra é "a hora antes da medição": termina no ponto e começa na medição anterior (no máximo 1 h antes), para
  // medições próximas não se sobreporem e a última não passar da borda
  const maxB = Math.max(1, ...pontos.map(folgaBloq));
  const barras = pontos.map((p, k) => { const n = folgaBloq(p); if (!n) return ""; const h = (n / maxB) * HB;
    const fim = new Date(p.em).getTime(), ini = Math.max(fim - 36e5, k ? new Date(pontos[k - 1].em).getTime() : -Infinity, t0);
    const xi = x({ em: ini }) + 1, xf = x(p), larg = Math.max(2, xf - xi);
    return `<rect class="bloq" x="${(xf - larg).toFixed(1)}" y="${(B - h).toFixed(1)}" width="${larg.toFixed(1)}" height="${h.toFixed(1)}"><title>${quando(p.em)}: ${n} abertura(s) de live barrada(s) na hora anterior</title></rect>`; }).join("");
  const grade = [0, 50, 85, 100].map((v) => `<line class="${v === 85 ? "guarda" : "grade"}" x1="${E}" x2="${W - D}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
    <text class="eixo" x="${E - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}%</text>`).join("");
  // rótulos em horas redondas (passo de 1 a 24 h para caber até 7), com a data só no primeiro e quando o dia muda
  const passo = [1, 2, 3, 6, 12, 24].find((h) => (t1 - t0) / (h * 36e5) <= 7) ?? 24, ticks = [];
  const ini = new Date(t0); ini.setMinutes(0, 0, 0); ini.setHours(Math.ceil((ini.getHours() + (t0 > ini.getTime() ? 1 : 0)) / passo) * passo);
  let diaAnt = "";
  for (let tt = ini.getTime(); tt <= t1; tt += passo * 36e5) {
    const d = new Date(tt), dia = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    const rot = `${dia !== diaAnt ? dia + " " : ""}${String(d.getHours()).padStart(2, "0")}h`; diaAnt = dia;
    ticks.push(`<line class="grade" x1="${x({ em: tt }).toFixed(1)}" x2="${x({ em: tt }).toFixed(1)}" y1="${B}" y2="${B + 4}"/>
      <text class="eixo" x="${x({ em: tt }).toFixed(1)}" y="${H - 6}" text-anchor="middle">${rot}</text>`);
  }
  const pontosCpu = pontos.filter((p) => p.cpu != null).map((p) => `<circle class="pt ${p.veredito ?? ""}" cx="${x(p).toFixed(1)}" cy="${y(p.cpu).toFixed(1)}" r="4">
    <title>${quando(p.em)}: CPU ${saudeNum(p.cpu)}%, Claude 5 h ${p.claude_5h == null ? "—" : saudeNum(p.claude_5h) + "%"}, ${folgaBloq(p)} bloqueio(s) · ${FOLGA_NIVEL[p.veredito]?.t ?? ""}</title></circle>`).join("");
  return `<svg class="folga-grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="CPU do VPS e uso da assinatura do Claude nas últimas medições, com as aberturas de live barradas">
    ${grade}
    <line class="grade" x1="${E}" x2="${W - D}" y1="${B}" y2="${B}"/>${barras}
    <path class="cpu" d="${linha("cpu")}"/><path class="claude" d="${linha("claude_5h")}"/>${pontosCpu}${ticks.join("")}</svg>`;
}
function htmlFolga(f) {
  const pontos = (f?.pontos ?? []).slice(-7 * 24);
  if (!pontos.length) {
    return `<section class="painel"><h2>${ico("activity")} Folga do VPS</h2><p class="vazio">Ainda sem medição. Roda de hora em hora no VPS
      (<code>python 00-central-comando/cliente/folga.py medir</code>; tarefa <code>central-folga</code>).</p></section>`;
  }
  const u = pontos[pontos.length - 1], n = FOLGA_NIVEL[u.veredito] ?? FOLGA_NIVEL.justo;
  const lives = Object.entries(u.lives ?? {}).filter(([k]) => k !== "erro").map(([k, v]) => `${esc(k.replace("@bovespa", " da Bovespa").replace("youtube", "YouTube").replace("tiktok", "TikTok"))} ${v}`).join(" · ") || "nenhuma";
  const bloq = Object.entries(u.bloqueios ?? {}).filter(([, b]) => b.total).map(([k, b]) => `${esc(k)} ${b.total}`).join(" · ") || "nenhum";
  const bv = u.bovespa ?? {};
  return `<section class="painel" aria-labelledby="h-folga">
    <h2 id="h-folga">${ico("activity")} Folga do VPS ${htmlBadge(n.c, n.t, n.i)}</h2>
    <p class="meta">Medido ${quando(u.em)}, de hora em hora (amostra de ${f.amostra_s ?? 30} s). Há folga com CPU abaixo de 80%, nenhuma live barrada e assinatura abaixo de 70% da janela de 5 h; aí dá para pensar em mais faixas de leitura ou mais lives (decisão do Diogo).</p>
    <p class="folga-motivos">${(u.motivos ?? []).map(esc).join(" · ")}</p>
    <div class="folga-legenda"><span><i class="cpu"></i>CPU do VPS</span><span><i class="claude"></i>Claude, janela de 5 h</span><span><i class="bloq"></i>lives barradas na hora</span><span><i class="guarda"></i>guarda das lives (85%)</span></div>
    ${svgFolga(pontos)}
    <div class="folga-agora">
      <div><h3>CPU por programa</h3><table class="folga-tab"><tbody>${(u.programas ?? []).slice(0, 8).map((p) =>
        `<tr><td>${esc(p.nome)}</td><td class="num">${saudeNum(p.nucleos)} núcleo</td><td class="num">${(p.ram_mb ?? 0).toLocaleString("pt-BR")} MB</td></tr>`).join("")}</tbody></table></div>
      <div><h3>Agora</h3><dl class="folga-dl">
        <dt>CPU</dt><dd>${u.cpu == null ? "—" : saudeNum(u.cpu) + "%"}</dd>
        <dt>RAM livre</dt><dd>${u.ram_livre_gb == null ? "—" : saudeNum(u.ram_livre_gb) + " GB"}</dd>
        <dt>Lives abertas</dt><dd>${lives}</dd>
        <dt>Barradas na última hora</dt><dd>${bloq}</dd>
        <dt>Leitura contínua da Bovespa</dt><dd>${bv.vezes ?? 0} vezes em ${bv.canais ?? 0} canais · volta mediana ${bv.volta_s == null ? "—" : bv.volta_s + " s"}</dd>
        <dt>Assinatura do Claude</dt><dd>${u.claude_5h == null ? "—" : saudeNum(u.claude_5h) + "%"} da janela de 5 h · ${u.claude_7d == null ? "—" : saudeNum(u.claude_7d) + "%"} da semana</dd>
        <dt>Disk IO do Supabase</dt><dd>${u.iops_pct == null ? "—" : saudeNum(u.iops_pct) + "% da base"}</dd>
      </dl></div>
    </div>
  </section>`;
}
function demoFolga(agora) {
  const pontos = Array.from({ length: 30 }, (_, k) => {
    const cpu = Math.round(70 + 22 * Math.sin(k / 3)), bl = cpu > 88 ? 2 : 0;
    return { em: new Date(agora - (29 - k) * 36e5).toISOString(), cpu, ram_livre_gb: 4.4, claude_5h: Math.round(40 + 30 * Math.sin(k / 5 + 1)),
      claude_7d: 63, iops_pct: 80, bloqueios: { "YouTube Bovespa": { total: bl } }, lives: { "youtube@bovespa": 9, youtube: 1 },
      bovespa: { vezes: 206, canais: 9, volta_s: 80 }, veredito: cpu >= 85 || bl ? "limite" : cpu < 80 ? "folga" : "justo",
      motivos: [cpu >= 85 ? `CPU em ${cpu}% (a guarda barra a partir de 85%)` : "CPU abaixo de 80%, nenhum bloqueio e assinatura abaixo de 70% da janela de 5 h"],
      programas: [{ nome: "Chrome YouTube Bovespa", nucleos: 1.6, ram_mb: 3700 }, { nome: "Python do monitor", nucleos: 1.1, ram_mb: 900 }, { nome: "MT5", nucleos: 0.5, ram_mb: 340 }] };
  });
  return { pontos, amostra_s: 30 };
}

function vistaSaude() {
  return `<main class="uma">
    ${avisoErro()}
    <div class="cabecalho-proj compacto" style="--cor:var(--global)">
      <div class="bloco">
        <a class="voltar" href="#/">${ico("back")} Visão geral</a>
        <h1><i class="ponto" aria-hidden="true"></i>Saúde das integrações</h1>
        <div class="meta"><span>Uso de cada limite que pode parar a aplicação: banco, corretoras de dados, transcrição, máquina e backup.</span></div>
      </div>
    </div>
    ${htmlFolga(estado.saudeFolga)}
    ${htmlSaude(estado.saude)}
  </main>`;
}

// dados de exemplo (modo demonstração): mesma forma do controle.saude:painel
function demoSaude(agora) {
  const serie = (base, amp) => Array.from({ length: 48 }, (_, k) => [Math.round((agora - (47 - k) * 9e5) / 1e3), Math.max(1, +(base + amp * Math.sin(k / 5) + (k > 40 ? amp : 0)).toFixed(1))]);
  const it = (id, grupo, nome, valor, limite, unidade, detalhe, o = {}) => {
    const pct = valor == null ? null : +((100 * valor) / limite).toFixed(1), a = o.atencao ?? 80, c = o.critico ?? 90;
    return { id, grupo, nome, valor, limite, unidade, pct, nivel: pct == null ? "sem_dado" : pct >= c ? "critico" : pct >= a ? "atencao" : "ok",
      detalhe, avisar: o.avisar ?? true, origem: o.origem ?? "", atencao: a, critico: c, serie: o.serie ?? [] };
  };
  const sb = "Supabase (banco único)", doc = "compute Nano, documentação do Supabase";
  return { medido_em: new Date(agora - 4 * 60e3).toISOString(), maquina: "vps", intervalo_min: 15, nivel: "atencao", itens: [
    it("supabase.banco", sb, "Tamanho do banco", 104, 500, "MB", "Cota do plano grátis. Acima dela a organização pode ser restringida (HTTP 402).", { origem: doc, serie: serie(20.8, 0.1) }),
    it("supabase.disco", sb, "Disco do banco", 415, 1981, "MB", "Aos 95% de uso o Supabase põe o banco em somente leitura; disco cheio derruba o Postgres.", { origem: doc, atencao: 75, critico: 85, serie: serie(21, 0.1) }),
    it("supabase.iops", sb, "Disk IO: operações por segundo", 212, 250, "IOPS", "Média dos últimos 15 min. Acima da base o servidor gasta o saldo de Disk IO; com o saldo zerado o banco fica lento ou para de responder. Estimativa: o saldo real só aparece no painel do Supabase.", { origem: doc, serie: serie(48, 18) }),
    it("supabase.vazao", sb, "Disk IO: vazão", 1.9, 5, "MB/s", "Média dos últimos 15 min, leitura mais escrita. O saldo de Disk IO segue o pior entre operações e vazão.", { origem: doc, serie: serie(30, 8) }),
    it("supabase.memoria", sb, "Memória do servidor", 360, 432, "MB", "Sem memória livre o servidor usa o disco como memória (swap) e gasta Disk IO.", { origem: doc, avisar: false, atencao: 85, critico: 95, serie: serie(82, 2) }),
    it("tradingview.dia", "TradingView MCP", "Chamadas em 24 h", 331, 350, "chamadas", "Teto nosso: no limite, a rodada usa as velas da Capital.com (reserva). Não gera aviso.", { avisar: false, origem: "ORCAMENTO_TV do executor" }),
    it("tradingview.hora", "TradingView MCP", "Chamadas na última hora", 12, 20, "chamadas", "Teto nosso: no limite, a rodada usa as velas da Capital.com (reserva). Não gera aviso.", { avisar: false, origem: "ORCAMENTO_TV do executor" }),
    it("groq.dia:groq", "Groq (transcrição do Escutar live)", "Áudio em 24 h (groq)", 10582, 28800, "s", "Limite da chave no Groq (7.200 s/h e 28.800 s/dia). No limite a fala deixa de ser transcrita; não gera aviso.", { avisar: false }),
    it("maquina.memoria", "Máquina (vps)", "Memória", 9192, 12282, "MB", "Com pouca memória livre a guarda de recursos barra a abertura de lives.", { atencao: 88, critico: 95, serie: serie(76, 5) }),
    it("maquina.disco", "Máquina (vps)", "Disco", 82.4, 200, "GB", "Disco onde ficam o repositório, os prints e os bancos locais.", { atencao: 85, critico: 93, serie: serie(41, 0.2) }),
    it("backup.idade", "Backup do banco", "Dias desde o último backup", 2.1, 7, "dias", "Último: 20261123-093846. Rotina semanal (supabase/ROLLBACK.md).", { atencao: 100, critico: 200 }),
  ] };
}
