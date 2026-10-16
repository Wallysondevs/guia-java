#!/usr/bin/env node
/*
  tools/testes/rodar.js — bateria diferencial do simulador Java (assets/javasim.js).

  Cada caso (arquivos tools/testes/*.casos) roda no simulador e no JDK 25 real do
  laboratório (~/guia-java-lab/lab), e as saídas são comparadas byte a byte:
      [mensagens do javac] + [saída do "java Main" (stdout+stderr)] + "[código de saída: N]"

  Formato dos arquivos .casos:
      ### nome-do-caso
      public class Main { ... }            ← Main.java
      //// Conta.java                       ← (opcional) começa outro arquivo
      public class Conta { ... }
      ### outro [stdin="Ana\n29\n" args="a b" main="Prog"]
      ### sessao [jshell]                   ← linhas digitadas no JShell (jshell -q)
  "##" no início de uma linha (fora do código) é comentário só antes do primeiro ###.

  Uso:
    node tools/testes/rodar.js                 # todos os casos (usa o cache do laboratório)
    node tools/testes/rodar.js string          # só arquivos/casos cujo nome contém "string"
    node tools/testes/rodar.js --lab           # roda de novo no laboratório (ignora o cache)
    node tools/testes/rodar.js --diff          # mostra o diff de cada caso diferente
    node tools/testes/rodar.js --real nome     # mostra a saída real (laboratório) do caso
    node tools/testes/rodar.js --sim nome      # mostra a saída do simulador

  O laboratório é chamado UMA vez, com todos os casos que faltam no cache: uma JVM compila
  todos (javax.tools, em processo) e roda "java Main" de cada um, um por vez.
  Cache: tools/.cache-bateria.json.
*/
"use strict";
var fs = require("fs"), path = require("path"), cp = require("child_process"), crypto = require("crypto");
var DIR = __dirname, CACHE = path.join(DIR, "..", ".cache-bateria.json");
var LAB = path.join(process.env.HOME || "/home/wallyson", "guia-java-lab", "lab");

function lerCasos(filtro) {
  var casos = [];
  fs.readdirSync(DIR).filter(function (f) { return /\.casos$/.test(f); }).sort().forEach(function (f) {
    var txt = fs.readFileSync(path.join(DIR, f), "utf8"), atual = null;
    txt.split("\n").forEach(function (l) {
      var m = /^### (\S+)(?:\s+\[([^\]]*)\])?\s*$/.exec(l);
      if (m) {
        atual = { arq: f.replace(/\.casos$/, ""), nome: m[1], linhas: [], args: [], stdin: null, main: null, jshell: false };
        var extra = m[2] || "", ma;
        if ((ma = /args="([^"]*)"/.exec(extra))) atual.args = ma[1] ? ma[1].split(" ") : [];
        if ((ma = /stdin="([^"]*)"/.exec(extra))) atual.stdin = ma[1].replace(/\\n/g, "\n");
        if ((ma = /main="([^"]*)"/.exec(extra))) atual.main = ma[1];
        if (/\bjshell\b/.test(extra)) atual.jshell = true;
        casos.push(atual); return;
      }
      if (!atual) return;
      atual.linhas.push(l);
    });
  });
  casos.forEach(function (c) {
    while (c.linhas.length && c.linhas[c.linhas.length - 1] === "") c.linhas.pop();
    c.texto = c.linhas.join("\n") + "\n";
    c.arquivos = dividirArquivos(c.texto);
    if (!c.main) c.main = c.arquivos.some(function (a) { return a.nome === "Main.java"; }) ? "Main" : c.arquivos[0].nome.replace(/\.java$/, "");
    c.id = crypto.createHash("sha1").update((c.jshell ? "J" : "P") + "\0" + c.texto + "\0" + c.args.join(" ") + "\0" + (c.stdin === null ? "\u0000" : c.stdin) + "\0" + c.main).digest("hex").slice(0, 16);
  });
  if (filtro) casos = casos.filter(function (c) { return (c.arq + "/" + c.nome).indexOf(filtro) >= 0; });
  return casos;
}
function dividirArquivos(texto) {
  var arqs = [], cur = { nome: "Main.java", linhas: [] }, primeiro = true;
  texto.replace(/\n$/, "").split("\n").forEach(function (l) {
    var m = /^\/\/\/\/ (\S+\.java)\s*$/.exec(l);
    if (m) { if (!primeiro || cur.linhas.length) arqs.push(cur); cur = { nome: m[1], linhas: [] }; primeiro = false; return; }
    primeiro = false;
    cur.linhas.push(l);
  });
  arqs.push(cur);
  return arqs.map(function (a) { return { nome: a.nome, codigo: a.linhas.join("\n") + "\n" }; });
}

// ---- laboratório ----
function rodarLab(casos) {
  if (!casos.length) return {};
  var driver = fs.readFileSync(path.join(DIR, "Bateria.java"), "utf8");
  var entrada = casos.map(function (c) {
    var cab = [c.id, c.jshell ? "@jshell" : c.main, c.args.join("\u001f"), (c.stdin || "").replace(/\n/g, "\\n"), c.stdin === null ? "0" : "1"].join("\t");
    var arqs = c.jshell ? [{ nome: "sessao.jsh", codigo: c.texto }] : c.arquivos;
    return "\u001e" + cab + "\n" + arqs.map(function (a) { return a.nome + "\u001c" + a.codigo; }).join("\u001d");
  }).join("");
  process.stderr.write("laboratório: rodando " + casos.length + " caso(s) numa só chamada (uma JVM por vez)...\n");
  var script = "mkdir -p /tmp/drv && cat > /tmp/drv/Bateria.java <<'__FIM__'\n" + driver + "\n__FIM__\ncd /tmp/drv && javac -d . Bateria.java && java -Xmx512m -cp . Bateria";
  var r = cp.spawnSync("timeout", ["3000", LAB, "-n", "testes", "-r", "--", "bash", "-c", script], { input: entrada, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.stderr) process.stderr.write(r.stderr.slice(0, 2000));
  var res = {};
  (r.stdout || "").split("\u001d").slice(1).forEach(function (bloco) {
    var i = bloco.indexOf("\n");
    res[bloco.slice(0, i)] = bloco.slice(i + 1).replace("\u001b", "");
  });
  return res;
}

// ---- simulador ----
var JavaSim = null;
function carregarSim() {
  if (JavaSim) return JavaSim;
  try { JavaSim = require(process.env.JAVASIM || path.join(DIR, "..", "..", "assets", "javasim.js")); } catch (e) { JavaSim = { erro: e }; }
  return JavaSim;
}
function rodarSim(c) {
  var J = carregarSim();
  if (J.erro) return "(simulador não carregou: " + J.erro.message + ")";
  if (c.jshell) return J.rodarJShellTexto(c.texto);
  var r = J.rodarSync({ arquivos: c.arquivos, principal: c.main, args: c.args, stdin: c.stdin === null ? "" : c.stdin });
  return r.javac + (r.compilou ? r.texto + "[código de saída: " + r.status + "]\n" : "");
}

function normalizar(s) { return s.replace(/\r/g, ""); }
function diff(a, b) {
  var la = a.split("\n"), lb = b.split("\n"), out = [], n = Math.max(la.length, lb.length);
  for (var i = 0; i < n; i++) {
    if (la[i] === lb[i]) { out.push("  " + (la[i] === undefined ? "" : la[i])); continue; }
    if (la[i] !== undefined) out.push("\x1b[31m- " + la[i] + "\x1b[0m");
    if (lb[i] !== undefined) out.push("\x1b[32m+ " + lb[i] + "\x1b[0m");
  }
  if (out.length > 80) out = out.slice(0, 80).concat(["  … (" + (out.length - 80) + " linhas a mais)"]);
  return out.join("\n");
}

function main(argv) {
  var forcar = argv.indexOf("--lab") >= 0, mostrarDiff = argv.indexOf("--diff") >= 0;
  var real = argv.indexOf("--real") >= 0, soSim = argv.indexOf("--sim") >= 0;
  var filtro = argv.filter(function (a) { return a[0] !== "-"; })[0];
  var casos = lerCasos(filtro);
  var cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) { /* sem cache */ }
  if (!soSim) {
    var faltam = casos.filter(function (c) { return forcar || cache[c.id] === undefined; });
    if (faltam.length) {
      var novos = rodarLab(faltam);
      Object.keys(novos).forEach(function (k) { cache[k] = novos[k]; });
      var todosIds = {}; lerCasos().forEach(function (c) { todosIds[c.id] = 1; });
      Object.keys(cache).forEach(function (k) { if (!todosIds[k]) delete cache[k]; });
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
  }
  if (real || soSim) {
    casos.forEach(function (c) {
      console.log("\x1b[1m### " + c.arq + "/" + c.nome + "\x1b[0m");
      process.stdout.write(real ? (cache[c.id] === undefined ? "(sem resultado)\n" : cache[c.id]) : rodarSim(c));
    });
    return 0;
  }
  var iguais = 0, difs = [];
  casos.forEach(function (c) {
    var r = cache[c.id];
    if (r === undefined) { difs.push({ c: c, real: "(sem resultado do laboratório)", sim: "" }); return; }
    var s;
    try { s = rodarSim(c); } catch (e) { s = "(exceção no simulador) " + (e && e.stack || e); }
    r = normalizar(r); s = normalizar(s);
    if (r === s) iguais++; else difs.push({ c: c, real: r, sim: s });
  });
  difs.forEach(function (d) {
    console.log("✗ " + d.c.arq + "/" + d.c.nome);
    if (mostrarDiff) console.log(diff(d.real, d.sim) + "\n");
  });
  var pct = casos.length ? (100 * iguais / casos.length).toFixed(1) : "0";
  console.log("\n" + iguais + " de " + casos.length + " casos idênticos (" + pct + "%)" + (mostrarDiff ? "" : "  — use --diff para ver as diferenças"));
  return difs.length ? 1 : 0;
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { lerCasos: lerCasos, dividirArquivos: dividirArquivos, rodarLab: rodarLab };
