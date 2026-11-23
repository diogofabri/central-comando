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
