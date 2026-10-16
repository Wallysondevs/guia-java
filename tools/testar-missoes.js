#!/usr/bin/env node
/*
  tools/testar-missoes.js — confere os "Experimente" (.tryjava e .tryjshell) das páginas.

  Uso:
    node tools/testar-missoes.js                  # todas as páginas .html da raiz
    node tools/testar-missoes.js strings.html     # só estas páginas
    node tools/testar-missoes.js --sem-lab ...    # não compara com o JDK real do laboratório
    node tools/testar-missoes.js --refazer-lab    # ignora o cache do laboratório
    node tools/testar-missoes.js -v ...           # mostra a saída do simulador de cada caixa

  Para cada .tryjava:
    - com data-goal: o código inicial NÃO cumpre a meta; a solução (pre.solucao) cumpre;
    - sem data-goal: o código roda sem erro interno do simulador;
    - a solução (ou o código, se não houver solução) é comparada com o JDK 25 real do
      laboratório: "javac *.java" + "java Main" (mesma entrada data-stdin e data-args).
      Diferenças só de hash de objetos (Classe@1b6d3586), números aleatórios sem semente,
      data/hora do relógio de verdade ou ordem de threads viram avisos (⚠).
      data-comparar="nao" pula a comparação.
  Para cada .tryjshell: digita a solução no JShell do simulador e confere a meta.
  O laboratório é chamado uma vez só, com todos os casos que faltam no cache
  (tools/.cache-missoes.json); uma JVM compila tudo e roda um programa por vez.
*/
"use strict";
var fs = require("fs"), path = require("path"), crypto = require("crypto");
var RAIZ = path.join(__dirname, "..");
var JavaSim = require(process.env.JAVASIM || path.join(RAIZ, "assets", "javasim.js"));
var bateria = require(path.join(__dirname, "testes", "rodar.js"));
var CACHE = path.join(__dirname, ".cache-missoes.json");

function decodificar(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (m, e) {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–" }[e] || m;
  });
}
function atributos(tag) {
  var at = {}, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, m;
  tag = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
  while ((m = re.exec(tag))) at[m[1]] = decodificar(m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : "");
  return at;
}
// lê uma tag a partir de "<" respeitando aspas (atributos podem conter ">")
function lerTag(html, i) {
  var j = i + 1, q = null;
  for (; j < html.length; j++) {
    var c = html[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ">") break;
  }
  return html.slice(i, j + 1);
}
// todas as tags <nome ...> (abertura) com posição
function tags(html, nome) {
  var r = [], re = new RegExp("<" + nome + "\\b", "gi"), m;
  while ((m = re.exec(html))) { var t = lerTag(html, m.index); r.push({ pos: m.index, tag: t, fim: m.index + t.length }); re.lastIndex = m.index + t.length; }
  return r;
}
function fimDiv(html, ini) {
  var d = 0, i = ini;
  while (i < html.length) {
    var a = html.indexOf("<div", i), b = html.indexOf("</div>", i);
    if (b < 0) return html.length;
    if (a >= 0 && a < b && /[\s>]/.test(html[a + 4] || "")) { d++; i = a + lerTag(html, a).length; continue; }
    if (a >= 0 && a < b) { i = a + 4; continue; }
    d--; if (d === 0) return b;
    i = b + 6;
  }
  return html.length;
}
function pres(html, classe) {
  var r = [];
  tags(html, "pre").forEach(function (t) {
    var at = atributos(t.tag);
    if (!at["class"] || at["class"].split(/\s+/).indexOf(classe) < 0) return;
    var fim = html.indexOf("</pre>", t.fim);
    r.push({ file: at["data-file"] || null, texto: decodificar(html.slice(t.fim, fim).replace(/<[^>]+>/g, "")).replace(/^\n/, "") });
  });
  return r;
}
function extrair(html) {
  var res = [];
  tags(html, "div").forEach(function (t) {
    var at = atributos(t.tag), classes = (at["class"] || "").split(/\s+/);
    var tipo = classes.indexOf("tryjava") >= 0 ? "tryjava" : classes.indexOf("tryjshell") >= 0 ? "tryjshell" : null;
    if (!tipo) return;
    var fim = fimDiv(html, t.pos), corpo = html.slice(t.fim, fim);
    var tarefa = /<p\b[^>]*class\s*=\s*["'][^"']*try-task[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(corpo);
    res.push({ tipo: tipo, at: at, tarefa: tarefa ? decodificar(tarefa[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "", scripts: pres(corpo, "script"), solucoes: pres(corpo, "solucao"), linha: html.slice(0, t.pos).split("\n").length });
  });
  return res;
}
function arquivosDe(m, lista) {
  var padrao = m.at["data-file"] || "Main.java";
  return lista.map(function (p, i) { return { nome: p.file || (i === 0 ? padrao : (m.scripts[i] && m.scripts[i].file) || "Arquivo" + i + ".java"), codigo: p.texto }; });
}
// solução: substitui as abas que ela traz; as outras ficam como no código original
function arquivosSolucao(m) {
  var base = arquivosDe(m, m.scripts);
  var sol = arquivosDe(m, m.solucoes.map(function (s, i) { return { file: s.file || (m.scripts[i] && m.scripts[i].file) || (i === 0 ? m.at["data-file"] || "Main.java" : null), texto: s.texto }; }));
  sol.forEach(function (s) { var a = base.filter(function (b) { return b.nome === s.nome; })[0]; if (a) a.codigo = s.codigo; else base.push(s); });
  return base;
}
function rodarSim(m, arquivos) {
  var stdin = m.at["data-stdin"] !== undefined ? m.at["data-stdin"].replace(/\\n/g, "\n").replace(/\\t/g, "\t") : "";
  var r = JavaSim.rodarSync({ arquivos: arquivos, args: JavaSim.dividirArgs(m.at["data-args"] || ""), stdin: stdin, seed: 12345, limite: 5000000 });
  r.src = arquivos.map(function (a) { return a.codigo; }).join("\n");
  r.textoLab = r.javac + (r.compilou ? r.texto + "[código de saída: " + r.status + "]\n" : "");
  return r;
}
function ctxMeta(r) { return { compilou: r.compilou, javac: r.javac, out: r.out, err: r.err, status: r.status, excecao: r.excecao, src: r.src }; }
function normalizar(s) { return s.replace(/@[0-9a-f]{1,8}\b/g, "@HASH"); }
function diffLinhas(a, b) {
  var la = a.split("\n"), lb = b.split("\n"), out = [];
  for (var i = 0; i < Math.max(la.length, lb.length) && out.length < 24; i++) {
    if (la[i] === lb[i]) continue;
    if (la[i] !== undefined) out.push("        lab: " + JSON.stringify(la[i]));
    if (lb[i] !== undefined) out.push("        sim: " + JSON.stringify(lb[i]));
  }
  return out.join("\n");
}

function main(argv) {
  var semLab = argv.indexOf("--sem-lab") >= 0, refazer = argv.indexOf("--refazer-lab") >= 0, verbose = argv.indexOf("-v") >= 0;
  var paginas = argv.filter(function (a) { return a[0] !== "-"; });
  if (!paginas.length) paginas = fs.readdirSync(RAIZ).filter(function (f) { return /\.html$/.test(f); }).sort();
  var falhas = 0, total = 0, relatorio = [], comparacoes = [];
  paginas.forEach(function (pg) {
    var arq = fs.existsSync(pg) ? pg : path.join(RAIZ, pg);
    if (!fs.existsSync(arq)) { relatorio.push({ pg: pg, linhas: [{ nome: "arquivo não encontrado", erros: ["?"], avisos: [] }] }); return; }
    var missoes = extrair(fs.readFileSync(arq, "utf8"));
    if (!missoes.length) return;
    var linhas = [];
    missoes.forEach(function (m, ix) {
      total++;
      var nome = m.tipo + " #" + (ix + 1) + " (linha " + m.linha + ")" + (m.tarefa ? ": " + m.tarefa.slice(0, 70) + (m.tarefa.length > 70 ? "…" : "") : "");
      var meta = m.at["data-goal"] || "", erros = [], avisos = [];
      try {
        if (m.tipo === "tryjshell") {
          if (meta && !m.solucoes.length) erros.push("falta pre.solucao (obrigatório quando há data-goal)");
          if (m.solucoes.length) {
            var sess = JavaSim.rodarJShellTexto(m.solucoes[0].texto, { retornarSessao: true });
            if (verbose) linhas.push({ nome: "   saída: " + JSON.stringify(sess.texto.slice(0, 400)), erros: [], avisos: [], info: true });
            if (/\(simulador\) erro interno/.test(sess.texto)) erros.push("erro interno do simulador: " + sess.texto.slice(0, 300));
            if (meta) {
              var f0 = JavaSim.checarMeta(meta, { compilou: true, out: sess.out, err: sess.err, javac: sess.texto, src: m.solucoes[0].texto, status: 0 });
              if (f0.length) erros.push("com a solução, a meta não foi cumprida: " + f0.join(", ") + "\n      saída: " + JSON.stringify(sess.texto.slice(0, 300)));
            }
          }
        } else {
          if (!m.scripts.length) erros.push("falta pre.script");
          if (meta && !m.solucoes.length) erros.push("falta pre.solucao (obrigatório quando há data-goal)");
          var r0 = m.scripts.length ? rodarSim(m, arquivosDe(m, m.scripts)) : null;
          if (r0 && /\(simulador\) erro interno/.test(r0.texto)) erros.push("erro interno do simulador (código inicial): " + r0.texto.slice(0, 300));
          if (meta && r0) {
            var f1 = JavaSim.checarMeta(meta, ctxMeta(r0));
            if (!f1.length) erros.push("o código inicial já cumpre a meta");
          }
          var r1 = null, arqSol = null;
          if (m.solucoes.length) {
            arqSol = arquivosSolucao(m);
            r1 = rodarSim(m, arqSol);
            if (verbose) linhas.push({ nome: "   saída: " + JSON.stringify(r1.textoLab.slice(0, 400)), erros: [], avisos: [], info: true });
            if (/\(simulador\) erro interno/.test(r1.texto)) erros.push("erro interno do simulador (solução): " + r1.texto.slice(0, 300));
            if (meta) {
              var f2 = JavaSim.checarMeta(meta, ctxMeta(r1));
              if (f2.length) erros.push("com a solução, a meta não foi cumprida: " + f2.join(", ") + "\n      saída: " + JSON.stringify(r1.textoLab.slice(0, 300)));
            }
          } else if (verbose && r0) linhas.push({ nome: "   saída: " + JSON.stringify(r0.textoLab.slice(0, 400)), erros: [], avisos: [], info: true });
          var comparar = r1 || r0;
          var arqs = arqSol || (m.scripts.length ? arquivosDe(m, m.scripts) : null);
          if (!semLab && comparar && arqs && m.at["data-comparar"] !== "nao") {
            var caso = {
              arquivos: arqs, main: comparar.principal || "Main", args: JavaSim.dividirArgs(m.at["data-args"] || ""),
              stdin: m.at["data-stdin"] !== undefined ? m.at["data-stdin"].replace(/\\n/g, "\n").replace(/\\t/g, "\t") : "", jshell: false
            };
            caso.id = crypto.createHash("sha1").update(JSON.stringify([caso.arquivos, caso.main, caso.args, caso.stdin])).digest("hex").slice(0, 16);
            comparacoes.push({ caso: caso, sim: comparar.textoLab, erros: erros, avisos: avisos, codigo: comparar.src });
          }
        }
      } catch (e) { erros.push("exceção: " + (e && e.stack || e)); }
      linhas.push({ nome: nome, erros: erros, avisos: avisos });
    });
    relatorio.push({ pg: path.basename(arq), linhas: linhas });
  });
  if (comparacoes.length) {
    var cache = {};
    try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) { /* */ }
    var vistos = {}, faltam = [];
    comparacoes.forEach(function (c) { if ((refazer || cache[c.caso.id] === undefined) && !vistos[c.caso.id]) { vistos[c.caso.id] = 1; faltam.push(c.caso); } });
    if (faltam.length) {
      try { var novos = bateria.rodarLab(faltam); Object.keys(novos).forEach(function (k) { cache[k] = novos[k]; }); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
      catch (e) { process.stderr.write("(não foi possível rodar o laboratório: " + e.message + ")\n"); }
    }
    comparacoes.forEach(function (c) {
      var real = cache[c.caso.id];
      if (real === undefined) { c.avisos.push("sem resultado do laboratório"); return; }
      if (real === c.sim) return;
      var cod = c.codigo || "";
      if (normalizar(real) === normalizar(c.sim)) { c.avisos.push("difere só no hash dos objetos (Classe@…): o simulador usa valores fictícios"); return; }
      if (/new\s+Random\s*\(\s*\)|Math\.random|ThreadLocalRandom|RandomGenerator|shuffle\s*\([^,)]*\)/.test(cod)) { c.avisos.push("usa números aleatórios sem semente: não dá para comparar com o laboratório"); return; }
      if (/\.now\s*\(|currentTimeMillis|nanoTime|Instant\./.test(cod)) { c.avisos.push("usa o relógio: o laboratório usa a hora real; o simulador, 15/10/2026 10:30"); return; }
      if (/Thread|Executor|parallel|CompletableFuture/.test(cod) && real.split("\n").sort().join("\n") === c.sim.split("\n").sort().join("\n")) { c.avisos.push("as mesmas linhas, em outra ordem (threads)"); return; }
      c.erros.push("a saída no simulador é diferente da do JDK real:\n" + diffLinhas(real, c.sim));
    });
  }
  relatorio.forEach(function (r) {
    if (!r.linhas.length) return;
    console.log(r.pg);
    r.linhas.forEach(function (l) {
      if (l.info) { console.log(l.nome); return; }
      if (!l.erros.length) { console.log("  ✔ " + l.nome); (l.avisos || []).forEach(function (a) { console.log("      ⚠ " + a); }); }
      else { falhas++; console.log("  ✗ " + l.nome); l.erros.forEach(function (e) { console.log("      - " + e); }); }
    });
  });
  console.log("\n" + (total - falhas) + " de " + total + " caixas ok" + (falhas ? " — " + falhas + " com problema" : ""));
  return falhas ? 1 : 0;
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { extrair: extrair };
