#!/usr/bin/env node
/*
  tools/sim.js — roda programas Java no simulador (assets/javasim.js), como no editor do guia.

  Uso:
    node tools/sim.js Main.java [mais arquivos .java] [-- argumentos]
    node tools/sim.js --stdin 'Ana\n29\n' Main.java       # entrada do Scanner (\n = Enter)
    node tools/sim.js --main Prog A.java Prog.java          # escolhe a classe com main
    echo 'class ...' | node tools/sim.js -                  # lê o código da entrada padrão (Main.java)
    node tools/sim.js --jshell sessao.txt                   # cada linha é digitada no JShell
    node tools/sim.js --seed 42 Main.java                   # semente dos números "aleatórios"

  Mostra o que o painel do guia mostra:
    $ javac Main.java      (erros do compilador, se houver)
    $ java Main            (saída, erros e o código de saída)
*/
"use strict";
var fs = require("fs"), path = require("path");
var JavaSim = require(process.env.JAVASIM || path.join(__dirname, "..", "assets", "javasim.js"));

function main(argv) {
  var files = [], args = [], stdin = "", principal = null, jshell = null, seed = 12345, i;
  for (i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--") { args = argv.slice(i + 1); break; }
    if (a === "--stdin") { stdin = argv[++i].replace(/\\n/g, "\n"); continue; }
    if (a === "--main") { principal = argv[++i]; continue; }
    if (a === "--seed") { seed = parseInt(argv[++i], 10); continue; }
    if (a === "--jshell") { jshell = argv[++i]; continue; }
    if (a === "-h" || a === "--help") { process.stdout.write(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^[\s\S]*?\/\*/, "")); return 0; }
    files.push(a);
  }
  if (jshell) {
    var txt = jshell === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(jshell, "utf8");
    process.stdout.write(JavaSim.rodarJShellTexto(txt, { interativo: true }));
    return 0;
  }
  var arquivos = files.map(function (f) {
    if (f === "-") return { nome: "Main.java", codigo: fs.readFileSync(0, "utf8") };
    return { nome: path.basename(f), codigo: fs.readFileSync(f, "utf8") };
  });
  if (!arquivos.length) { console.error("uso: node tools/sim.js Main.java"); return 2; }
  var r = JavaSim.rodarSync({ arquivos: arquivos, principal: principal, args: args, stdin: stdin, seed: seed });
  var out = "$ javac " + arquivos.map(function (a) { return a.nome; }).join(" ") + "\n" + r.javac;
  if (!r.compilou) { process.stdout.write(out + "[código de saída: 1]\n"); return 1; }
  out += "$ java " + r.principal + (args.length ? " " + args.join(" ") : "") + "\n" + r.texto + "[código de saída: " + r.status + "]\n";
  process.stdout.write(out);
  return r.status;
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
