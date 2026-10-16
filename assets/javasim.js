/* =====================================================================
   javasim.js — simulador de Java (Java 25) para o Guia Java.
   Roda no navegador (monta .tryjava e .tryjshell) e no Node
   (tools/sim.js, tools/testar-missoes.js, tools/testes/rodar.js).

   Etapas: lexer → parser (AST do Java, com as posições do javac) →
   verificação de tipos (Attr) e de fluxo (Flow) com as mensagens exatas do
   javac 25 → geração de funções JavaScript a partir da AST → execução com a
   semântica do Java (int de 32 bits, long em BigInt, char numérico, pool de
   Strings, cache de Integer, despacho dinâmico, exceções com stack trace…).

   A biblioteca grande (coleções, streams, java.time, BigDecimal, arquivos,
   regex, concorrência) fica em assets/javasim-lib.js, carregado logo depois
   que a página monta os componentes (o botão Rodar espera por ele).

   Fidelidade: tools/testes/ compara ~350 programas com o JDK 25 real do
   laboratório (98% idênticos byte a byte).

   LIMITAÇÕES CONHECIDAS (o que é diferente do JDK real):
   - Threads: tudo roda numa thread só, de forma determinística. Thread.start()
     roda a tarefa até o fim na hora; ExecutorService e CompletableFuture
     executam as tarefas em sequência; synchronized/locks não mudam nada;
     Thread.sleep é instantâneo (só avança o relógio fictício).
   - hashCode() de Object (e o "@1b6d3586" do toString padrão) são fictícios,
     estáveis; Set.of/Map.of iteram numa ordem fixa (na JVM ela varia).
   - Recursão: StackOverflowError por volta de 2–3 mil chamadas (a JVM aguenta
     mais); o stack trace tem as 1024 linhas como a JVM.
   - Mensagens do lançador como "java Main" (classe), não "java Main.java".
   - Erros de sintaxe: o simulador recupera os casos comuns (';', '(' e ')'
     esperados, "not a statement") e para no primeiro erro que não sabe
     recuperar; o javac às vezes lista mais erros em cascata.
   - Inferência de generics: cobre os casos comuns (inclusive coletores
     aninhados); inferências muito complexas podem ser aceitas onde o javac
     reclamaria (ex.: println(stream.collect(...)) ambíguo).
   - Entrada (Scanner/IO.readln): no navegador, o programa é executado de novo
     do início a cada linha digitada (determinístico, invisível ao leitor).
   - Limite de 10 milhões de passos (laço infinito): "(simulador) execução
     interrompida…", código 130.
   - Não existem: reflexão completa, anotações em tempo de execução, JDBC,
     rede, interface gráfica, módulos, serialização.
   - Relógio fixo: 15/10/2026 10:30 (America/Sao_Paulo). Arquivos: um sistema
     de arquivos fictício (a pasta da Ana), que volta ao original a cada Rodar.
   ===================================================================== */
(function (global) {
  "use strict";

  var JavaSim = {};
  var VERSAO = "25";

  /* =====================================================================
     1. Utilidades
     ===================================================================== */
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function nullProto(o) { Object.setPrototypeOf(o, null); return o; }
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function repeat(s, n) { var r = ""; while (n-- > 0) r += s; return r; }

  // erro de compilação (javac)
  function CompileError(file, pos, msg, kind) {
    this.file = file; this.pos = pos; this.msg = msg; this.kind = kind || "error";
  }
  // sinal interno: erro de sintaxe que interrompe o parser
  function ParseAbort() {}

  function SourceFile(name, src) {
    this.name = name;
    this.src = src;
    var ls = [0];
    for (var i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) ls.push(i + 1);
    this.lineStarts = ls;
  }
  SourceFile.prototype.lineOf = function (pos) {
    var ls = this.lineStarts, lo = 0, hi = ls.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (ls[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  SourceFile.prototype.colOf = function (pos) { return pos - this.lineStarts[this.lineOf(pos) - 1]; };
  SourceFile.prototype.lineText = function (line) {
    var a = this.lineStarts[line - 1], b = line < this.lineStarts.length ? this.lineStarts[line] - 1 : this.src.length;
    var t = this.src.slice(a, b);
    return t.replace(/\r$/, "");
  };

  /* =====================================================================
     2. Lexer
     ===================================================================== */
  var KEYWORDS = {};
  nullProto(KEYWORDS);
  ("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally " +
   "float for goto if implements import instanceof int interface long native new package private protected public return short " +
   "static strictfp super switch synchronized this throw throws transient try void volatile while true false null _").split(" ").forEach(function (k) { KEYWORDS[k] = true; });
  var OPS = [">>>=", "<<=", ">>=", ">>>", "...", "->", "::", "++", "--", "&&", "||", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>",
    "(", ")", "{", "}", "[", "]", ";", ",", ".", "@", "=", ">", "<", "!", "~", "?", ":", "+", "-", "*", "/", "&", "|", "^", "%"];
  var PRIMS = { "boolean": 1, "byte": 1, "short": 1, "char": 1, "int": 1, "long": 1, "float": 1, "double": 1 };
  nullProto(PRIMS);

  function isIdStart(c) { return /[A-Za-z_$À-￿]/.test(c); }
  function isIdPart(c) { return /[A-Za-z0-9_$À-￿]/.test(c); }

  function lex(file, errs) {
    var s = file.src, n = s.length, i = 0, toks = [], c;
    function tok(k, v, a, extra) { var t = { k: k, v: v, pos: a, end: i }; if (extra) for (var x in extra) t[x] = extra[x]; toks.push(t); return t; }
    function err(pos, msg) { errs.push(new CompileError(file, pos, msg)); throw new ParseAbort(); }
    function escape(j, quoteKind) {
      // devolve [char, novoIndice]
      var d = s[j + 1];
      switch (d) {
        case "b": return ["\b", j + 2]; case "t": return ["\t", j + 2]; case "n": return ["\n", j + 2];
        case "f": return ["\f", j + 2]; case "r": return ["\r", j + 2]; case "s": return [" ", j + 2];
        case '"': return ['"', j + 2]; case "'": return ["'", j + 2]; case "\\": return ["\\", j + 2];
        case "u": {
          var k = j + 1; while (s[k] === "u") k++;
          var hx = s.substr(k, 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hx)) err(j, "illegal unicode escape");
          return [String.fromCharCode(parseInt(hx, 16)), k + 4];
        }
        default:
          if (d >= "0" && d <= "7") {
            var m = /^[0-3]?[0-7]{1,2}|^[0-7]/.exec(s.slice(j + 1, j + 4));
            var o = /^[0-3][0-7]{0,2}|^[4-7][0-7]?/.exec(s.slice(j + 1, j + 4))[0];
            return [String.fromCharCode(parseInt(o, 8)), j + 1 + o.length];
          }
          err(j, "illegal escape character");
      }
    }
    while (true) {
      // espaços e comentários
      while (i < n) {
        c = s[i];
        if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") { i++; continue; }
        if (c === "/" && s[i + 1] === "/") { while (i < n && s[i] !== "\n") i++; continue; }
        if (c === "/" && s[i + 1] === "*") {
          var f = s.indexOf("*/", i + 2);
          if (f < 0) err(i, "unclosed comment");
          i = f + 2; continue;
        }
        break;
      }
      if (i >= n) { tok("eof", "", n); break; }
      var a = i;
      c = s[i];
      if (isIdStart(c)) {
        while (i < n && isIdPart(s[i])) i++;
        var w = s.slice(a, i);
        if (KEYWORDS[w]) tok("kw", w, a); else tok("id", w, a);
        continue;
      }
      if ((c >= "0" && c <= "9") || (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) { lexNumber(a); continue; }
      if (c === '"') {
        if (s.substr(i, 3) === '"""') { lexTextBlock(a); continue; }
        i++;
        var str = "";
        while (true) {
          if (i >= n || s[i] === "\n" || s[i] === "\r") err(a, "unclosed string literal");
          if (s[i] === '"') { i++; break; }
          if (s[i] === "\\") { var e = escape(i); str += e[0]; i = e[1]; continue; }
          str += s[i++];
        }
        tok("string", str, a);
        continue;
      }
      if (c === "'") {
        i++;
        if (s[i] === "'") err(a, "empty character literal");
        if (s[i] === "\n" || i >= n) err(a, "illegal line end in character literal");
        var ch;
        if (s[i] === "\\") { var e2 = escape(i); ch = e2[0]; i = e2[1]; }
        else { var cp = s.codePointAt(i); ch = String.fromCodePoint(cp); i += ch.length; if (ch.length > 1) err(a, "unclosed character literal"); }
        if (s[i] !== "'") err(a, "unclosed character literal");
        i++;
        tok("char", ch, a);
        continue;
      }
      var op = null;
      for (var k = 0; k < OPS.length; k++) { if (s.startsWith(OPS[k], i)) { op = OPS[k]; break; } }
      if (!op) { i++; err(a, "illegal character: '" + (c.charCodeAt(0) > 127 ? "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4) : c) + "'"); }
      i += op.length;
      tok("op", op, a);
    }
    return toks;

    function lexNumber(a) {
      var m, txt, kind;
      var rest = s.slice(a);
      if ((m = /^0[xX][0-9a-fA-F_]*(\.[0-9a-fA-F_]*)?[pP][+-]?[0-9_]+[fFdD]?/.exec(rest))) {
        txt = m[0]; i = a + txt.length;
        var hv = txt.replace(/_/g, "").replace(/[fFdD]$/, "");
        var mm = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([+-]?\d+)$/.exec(hv);
        var mant = parseInt((mm[1] || "0") + (mm[2] || ""), 16) / Math.pow(16, (mm[2] || "").length);
        var val = mant * Math.pow(2, parseInt(mm[3], 10));
        tok(/[fF]$/.test(txt) ? "float" : "double", val, a, { text: txt });
        return;
      }
      if ((m = /^0[xX][0-9a-fA-F_]+[lL]?/.exec(rest)) || (m = /^0[bB][01_]+[lL]?/.exec(rest))) {
        txt = m[0]; i = a + txt.length;
        tok(/[lL]$/.test(txt) ? "long" : "int", txt, a, { radix: /^0[xX]/.test(txt) ? 16 : 2 });
        return;
      }
      m = /^(\d[\d_]*)?(\.[\d_]*)?([eE][+-]?[\d_]+)?([fFdDlL])?/.exec(rest);
      txt = m[0]; i = a + txt.length;
      if (isIdPart(s[i] || "") && !/[0-9]/.test(s[i])) { /* ex.: 12abc */ }
      var suf = m[4] ? m[4].toLowerCase() : "";
      if (m[2] !== undefined || m[3] !== undefined || suf === "f" || suf === "d") {
        if (suf === "l") err(a, "malformed floating-point literal");
        var num = parseFloat(txt.replace(/_/g, "").replace(/[fFdD]$/, ""));
        if (suf === "f") {
          var fv = Math.fround(num);
          if (!isFinite(fv)) err(a, "floating-point number too large");
          if (fv === 0 && /[1-9]/.test(txt.replace(/[eE].*$/, ""))) err(a, "floating-point number too small");
          tok("float", fv, a, { text: txt });
        } else {
          if (!isFinite(num)) err(a, "floating-point number too large");
          if (num === 0 && /[1-9]/.test(txt.replace(/[eE].*$/, ""))) err(a, "floating-point number too small");
          tok("double", num, a, { text: txt });
        }
        return;
      }
      var radix = 10;
      if (/^0[0-7_]+[lL]?$/.test(txt)) radix = 8;
      tok(suf === "l" ? "long" : "int", txt, a, { radix: radix });
    }
    function lexTextBlock(a) {
      i = a + 3;
      while (s[i] === " " || s[i] === "\t" || s[i] === "\f") i++;
      if (s[i] === "\r") i++;
      if (s[i] !== "\n") err(a, "illegal text block open delimiter sequence, missing line terminator");
      i++;
      var ini = i, fim = -1;
      while (i < n) {
        if (s[i] === "\\") { i += 2; continue; }
        if (s.substr(i, 3) === '"""') { fim = i; break; }
        i++;
      }
      if (fim < 0) err(a, "unclosed text block");
      var raw = s.slice(ini, fim);
      i = fim + 3;
      tok("string", textBlockValue(raw), a, { textBlock: true });
    }
    function textBlockValue(raw) {
      var lines = raw.split(/\r?\n/);
      // a última linha (antes do """) conta para a indentação, mesmo se só tiver espaços
      var min = Infinity;
      lines.forEach(function (l, idx) {
        var last = idx === lines.length - 1;
        if (!last && /^[ \t\f]*$/.test(l)) return;
        var ind = /^[ \t\f]*/.exec(l)[0].length;
        if (last && /^[ \t\f]*$/.test(l)) ind = l.length;
        if (ind < min) min = ind;
      });
      if (min === Infinity) min = 0;
      var out = lines.map(function (l, idx) {
        var last = idx === lines.length - 1;
        if (/^[ \t\f]*$/.test(l)) return last ? "" : "";
        return l.slice(min).replace(/[ \t\f]+$/, "");
      });
      var txt = out.join("\n");
      // escapes (inclusive \<newline> e \s)
      var r = "", j = 0;
      while (j < txt.length) {
        if (txt[j] === "\\") {
          if (txt[j + 1] === "\n") { j += 2; continue; }
          var e = escapeStr(txt, j); r += e[0]; j = e[1]; continue;
        }
        r += txt[j++];
      }
      return r;
    }
    function escapeStr(t, j) {
      var d = t[j + 1];
      var map = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", s: " ", '"': '"', "'": "'", "\\": "\\" };
      if (map[d] !== undefined) return [map[d], j + 2];
      if (d >= "0" && d <= "7") { var o = /^[0-3][0-7]{0,2}|^[4-7][0-7]?/.exec(t.slice(j + 1, j + 4))[0]; return [String.fromCharCode(parseInt(o, 8)), j + 1 + o.length]; }
      return [d, j + 2];
    }
  }

  /* =====================================================================
     3. Parser (descida recursiva, imitando as posições do javac)
     ===================================================================== */
  function Parser(file, errs, opts) {
    this.file = file;
    this.errs = errs;
    this.opts = opts || {};
    this.toks = lex(file, errs);
    this.i = 0;
    this.glog = [];
  }
  // marca/volta (para tentativas): também desfaz as divisões de ">>"
  Parser.prototype.mark = function () { return { i: this.i, g: this.glog.length, e: this.errs.length }; };
  Parser.prototype.reset = function (m) {
    while (this.glog.length > m.g) { var x = this.glog.pop(); this.toks[x[0]] = x[1]; }
    this.i = m.i; this.errs.length = m.e;
  };
  var PP = Parser.prototype;
  PP.peek = function (k) { return this.toks[Math.min(this.i + (k || 0), this.toks.length - 1)]; };
  Object.defineProperty(PP, "t", { get: function () { return this.toks[this.i]; } });
  PP.prev = function () { return this.toks[this.i - 1] || this.toks[0]; };
  PP.next = function () { var t = this.toks[this.i]; if (this.i < this.toks.length - 1) this.i++; return t; };
  PP.is = function (v, k) { var t = this.toks[this.i + (k || 0)]; return t && (t.k === "op" || t.k === "kw") && t.v === v; };
  PP.isId = function (k) { var t = this.toks[this.i + (k || 0)]; return t && t.k === "id"; };
  PP.isWord = function (w, k) { var t = this.toks[this.i + (k || 0)]; return t && t.k === "id" && t.v === w; };
  PP.err = function (pos, msg) { this.errs.push(new CompileError(this.file, pos, msg)); throw new ParseAbort(); };
  PP.errSoft = function (pos, msg) { this.errs.push(new CompileError(this.file, pos, msg)); };
  PP.expected = function (what) {
    var t = this.t;
    if (t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
    this.err(this.prev().end, what + " expected");
  };
  PP.accept = function (v) {
    if (this.is(v)) return this.next();
    if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
    this.err(this.prev().end, "'" + v + "' expected");
  };
  // ';' com recuperação: se o próximo token está noutra linha, registra o erro e segue
  PP.semi = function () {
    if (this.is(";")) { this.next(); return; }
    var t = this.t, p = this.prev();
    if (t.k === "eof") this.err(p.end, "reached end of file while parsing");
    if (this.file.lineOf(t.pos) > this.file.lineOf(p.end) || this.is("}")) { this.errSoft(p.end, "';' expected"); this.recovered = true; return; }
    this.err(p.end, "';' expected");
  };
  PP.ident = function () {
    var t = this.t;
    if (t.k === "id") { this.next(); return t; }
    if (t.k === "kw" && t.v === "_") { this.next(); return { k: "id", v: "_", pos: t.pos, end: t.end }; }
    if (t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
    if (t.k === "kw" && !PRIMS[t.v] && !/^(true|false|null|this|super|new)$/.test(t.v)) this.err(t.pos, "<identifier> expected");
    this.err(this.prev().end, "<identifier> expected");
  };

  // ---------- unidade de compilação ----------
  PP.compilationUnit = function () {
    var cu = { k: "CU", file: this.file, pkg: null, imports: [], types: [], implicit: false, members: [] };
    var mods;
    if (this.is("package")) {
      var pp = this.next().pos;
      cu.pkg = this.qualifiedName().join(".");
      cu.pkgPos = pp;
      this.semi();
    }
    while (this.is("import") || this.is(";")) {
      if (this.is(";")) { this.next(); continue; }
      var ip = this.next().pos, st = false, module = false;
      if (this.is("static")) { this.next(); st = true; }
      if (this.isWord("module") && this.peek(1).k === "id") { this.next(); module = true; }
      var parts = [this.ident().v], star = false, lastPos = this.prev().pos;
      while (this.is(".")) {
        this.next();
        if (this.is("*")) { this.next(); star = true; break; }
        lastPos = this.t.pos;
        parts.push(this.ident().v);
      }
      this.semi();
      cu.imports.push({ pos: ip, name: parts.join("."), parts: parts, isStatic: st, star: star, module: module, namePos: lastPos });
    }
    while (this.t.k !== "eof") {
      if (this.is(";")) { this.next(); continue; }
      var start = this.t.pos;
      mods = this.modifiers();
      if (this.isTypeDeclStart()) { cu.types.push(this.typeDecl(mods)); continue; }
      if (this.is("import")) this.err(this.t.pos, "class, interface, enum, or record expected");
      // membro de nível superior: arquivo-fonte compacto (Java 25)
      if (this.is("}") || this.is(")") || this.t.k === "string" || this.t.k === "int") this.err(this.t.pos, "class, interface, annotation type, enum, record, method or field expected");
      cu.implicit = true;
      var m = this.memberAfterMods(mods, null, "class", start);
      if (m) for (var q = 0; q < m.length; q++) cu.members.push(m[q]);
    }
    return cu;
  };
  PP.qualifiedName = function () {
    var parts = [this.ident().v];
    while (this.is(".") && this.peek(1).k === "id") { this.next(); parts.push(this.ident().v); }
    return parts;
  };
  PP.isTypeDeclStart = function () {
    if (this.is("class") || this.is("interface") || this.is("enum")) return true;
    if (this.is("@") && this.is("interface", 1)) return true;
    if (this.isWord("record") && this.peek(1).k === "id" && (this.is("(", 2) || this.is("<", 2))) return true;
    return false;
  };

  // ---------- modificadores e anotações ----------
  var MODS = { "public": 1, "protected": 1, "private": 1, "static": 1, "final": 1, "abstract": 1, "native": 1, "synchronized": 1, "transient": 1, "volatile": 1, "strictfp": 1, "default": 1 };
  nullProto(MODS);
  PP.modifiers = function () {
    var m = { flags: {}, annos: [], pos: this.t.pos, any: false };
    while (true) {
      var t = this.t;
      if (t.k === "kw" && MODS[t.v]) {
        if (t.v === "default" && (this.is(":", 1) || this.is("->", 1))) break;
        if (m.flags[t.v]) this.err(t.pos, "repeated modifier");
        m.flags[t.v] = t.pos; m.any = true; this.next(); continue;
      }
      if (t.k === "id" && t.v === "sealed" && (this.peek(1).k === "kw" || this.peek(1).k === "id") && !this.is("=", 1) && !this.is("(", 1) && !this.is(";", 1) && !this.is(".", 1)) {
        if (this.is("class", 1) || this.is("interface", 1) || this.is("abstract", 1) || this.is("static", 1) || this.is("public", 1) || this.isWord("record", 1) || this.is("private", 1) || this.is("protected", 1)) { m.flags.sealed = t.pos; m.any = true; this.next(); continue; }
      }
      if (t.k === "id" && t.v === "non" && this.is("-", 1) && this.isWord("sealed", 2)) { m.flags["non-sealed"] = t.pos; m.any = true; this.next(); this.next(); this.next(); continue; }
      if (t.k === "op" && t.v === "@" && !this.is("interface", 1)) { m.annos.push(this.annotation()); m.any = true; continue; }
      break;
    }
    return m;
  };
  PP.annotation = function () {
    var p = this.next().pos;
    var name = this.qualifiedName();
    var a = { k: "Anno", pos: p, name: name.join("."), args: [] };
    if (this.is("(")) {
      this.next();
      if (!this.is(")")) {
        do {
          if (this.isId() && this.is("=", 1)) { var nm = this.ident().v; this.next(); a.args.push({ name: nm, value: this.annoValue() }); }
          else a.args.push({ name: "value", value: this.annoValue() });
        } while (this.is(",") && this.next());
      }
      this.accept(")");
    }
    return a;
  };
  PP.annoValue = function () {
    if (this.is("@")) return this.annotation();
    if (this.is("{")) {
      var p = this.next().pos, el = [];
      while (!this.is("}")) { el.push(this.annoValue()); if (!this.is(",")) break; this.next(); }
      this.accept("}");
      return { k: "ArrayInit", pos: p, elems: el };
    }
    return this.term1();
  };

  // ---------- declarações de tipo ----------
  PP.typeDecl = function (mods) {
    var kind, kp = this.t.pos;
    if (this.is("class")) { this.next(); kind = "class"; }
    else if (this.is("interface")) { this.next(); kind = "interface"; }
    else if (this.is("enum")) { this.next(); kind = "enum"; }
    else if (this.is("@")) { this.next(); this.next(); kind = "annotation"; }
    else { this.next(); kind = "record"; }
    var nameTok = this.ident();
    var cd = { k: "Class", kind: kind, name: nameTok.v, namePos: nameTok.pos, pos: kp, mods: mods, tparams: [], ext: null, impl: [], permits: [], members: [], recComps: null, enumConsts: [], file: this.file };
    if (this.is("<")) cd.tparams = this.typeParams();
    if (kind === "record") {
      this.accept("(");
      cd.recComps = [];
      if (!this.is(")")) {
        do {
          var pm = this.modifiers();
          var pt = this.type();
          var va = false;
          if (this.is("...")) { this.next(); va = true; pt = { k: "ArrayType", elem: pt, pos: pt.pos }; }
          var pn = this.ident();
          cd.recComps.push({ type: pt, name: pn.v, pos: pn.pos, varargs: va, mods: pm });
        } while (this.is(",") && this.next());
      }
      this.accept(")");
    }
    if (this.is("extends")) {
      this.next();
      if (kind === "interface") { cd.impl.push(this.type()); while (this.is(",")) { this.next(); cd.impl.push(this.type()); } }
      else cd.ext = this.type();
    }
    if (this.is("implements")) {
      this.next();
      cd.impl.push(this.type());
      while (this.is(",")) { this.next(); cd.impl.push(this.type()); }
    }
    if (this.isWord("permits")) {
      this.next();
      cd.permits.push(this.type());
      while (this.is(",")) { this.next(); cd.permits.push(this.type()); }
    }
    this.classBody(cd);
    return cd;
  };
  PP.typeParams = function () {
    this.accept("<");
    var r = [];
    do {
      this.modifiers();
      var nt = this.ident();
      var tp = { name: nt.v, pos: nt.pos, bounds: [] };
      if (this.is("extends")) {
        this.next();
        tp.bounds.push(this.type());
        while (this.is("&")) { this.next(); tp.bounds.push(this.type()); }
      }
      r.push(tp);
    } while (this.is(",") && this.next());
    this.acceptGT();
    return r;
  };
  PP.acceptGT = function () {
    // divide >> e >>> quando fecham generics
    var t = this.t;
    if (t.k === "op" && t.v === ">") { this.next(); return; }
    if (t.k === "op" && (t.v === ">>" || t.v === ">>>" || t.v === ">=" || t.v === ">>=")) {
      var rest = t.v.slice(1);
      this.glog.push([this.i, t]);
      this.toks[this.i] = { k: "op", v: rest, pos: t.pos + 1, end: t.end };
      return;
    }
    this.err(this.prev().end, "'>' expected");
  };
  PP.classBody = function (cd) {
    this.accept("{");
    if (cd.kind === "enum") this.enumConstants(cd);
    while (!this.is("}")) {
      if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
      if (this.is(";")) { this.next(); continue; }
      var start = this.t.pos;
      if (this.is("{")) { cd.members.push({ k: "Init", isStatic: false, body: this.block(), pos: start }); continue; }
      if (this.is("static") && this.is("{", 1)) { this.next(); cd.members.push({ k: "Init", isStatic: true, body: this.block(), pos: start }); continue; }
      var mods = this.modifiers();
      if (this.isTypeDeclStart()) { var nested = this.typeDecl(mods); cd.members.push(nested); continue; }
      var ms = this.memberAfterMods(mods, cd.name, cd.kind, start, cd);
      if (ms) for (var q = 0; q < ms.length; q++) cd.members.push(ms[q]);
    }
    cd.endPos = this.t.pos;
    this.next();
  };
  PP.enumConstants = function (cd) {
    while (this.isId() || this.is("@")) {
      var mods = this.modifiers();
      if (!this.isId()) break;
      var nt = this.ident();
      var ec = { name: nt.v, pos: nt.pos, args: null, body: null, mods: mods };
      if (this.is("(")) ec.args = this.arguments();
      if (this.is("{")) {
        var anon = { k: "Class", kind: "class", name: "", namePos: this.t.pos, pos: this.t.pos, mods: { flags: {}, annos: [] }, tparams: [], ext: null, impl: [], permits: [], members: [], enumConsts: [], file: this.file, anon: true };
        this.classBody(anon);
        ec.body = anon;
      }
      cd.enumConsts.push(ec);
      if (this.is(",")) { this.next(); continue; }
      break;
    }
    if (this.is(";")) this.next();
    else if (!this.is("}")) this.expected("',', '}', or ';'");
  };
  // membro depois dos modificadores: método, construtor ou campo(s)
  PP.memberAfterMods = function (mods, className, kind, start, cd) {
    var tparams = null;
    if (this.is("<")) tparams = this.typeParams();
    // construtor
    if (this.isId() && this.t.v === className && this.is("(", 1)) {
      var nt = this.ident();
      return [this.methodRest(mods, tparams, null, nt, true, start)];
    }
    // construtor compacto de record
    if (kind === "record" && this.isId() && this.t.v === className && this.is("{", 1)) {
      var nt2 = this.ident();
      var body = this.block();
      return [{ k: "Method", name: "<init>", namePos: nt2.pos, pos: nt2.pos, mods: mods, tparams: tparams || [], ret: null, params: null, compact: true, throws: [], body: body, isCtor: true }];
    }
    if (this.isId() && this.is("(", 1) && !className) {
      // método sem tipo de retorno no arquivo compacto? (erro do javac)
      this.err(this.t.pos, "invalid method declaration; return type required");
    }
    if (this.isId() && this.is("(", 1)) this.err(this.t.pos, "invalid method declaration; return type required");
    var type;
    if (this.is("void")) { var vt = this.next(); type = { k: "PrimType", name: "void", pos: vt.pos }; }
    else {
      if (this.isWord("var") && this.peek(1).k === "id") this.err(this.t.pos, "'var' is not allowed here");
      if (!this.isTypeStart()) {
        if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
        if (cd || !className) this.err(this.t.pos, className === null && !cd ? "class, interface, annotation type, enum, record, method or field expected" : "illegal start of type");
      }
      type = this.type();
    }
    var nameTok;
    if (this.isId() || this.is("_")) nameTok = this.ident();
    else {
      if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
      this.err(this.prev().end, "<identifier> expected");
    }
    if (this.is("(")) return [this.methodRest(mods, tparams, type, nameTok, false, start)];
    // campos
    var decls = [];
    var cur = nameTok;
    while (true) {
      var t2 = this.arrayDims(type);
      var d = { k: "Field", mods: mods, type: t2, name: cur.v, pos: cur.pos, init: null, start: start };
      if (this.is("=")) { this.next(); d.init = this.varInit(); }
      decls.push(d);
      if (this.is(",")) { this.next(); cur = this.ident(); continue; }
      break;
    }
    this.semi();
    return decls;
  };
  PP.arrayDims = function (type) {
    while (this.is("[") && this.is("]", 1)) { var p = this.next().pos; this.next(); type = { k: "ArrayType", elem: type, pos: p }; }
    return type;
  };
  PP.methodRest = function (mods, tparams, ret, nameTok, isCtor, start) {
    var m = { k: "Method", name: isCtor ? "<init>" : nameTok.v, namePos: nameTok.pos, pos: nameTok.pos, mods: mods, tparams: tparams || [], ret: ret, params: [], throws: [], body: null, isCtor: isCtor, start: start };
    this.accept("(");
    if (!this.is(")")) {
      do {
        var pm = this.modifiers();
        if (this.isId() && this.t.v === "this" ) { /* receiver */ }
        var pt = this.type();
        var va = false;
        if (this.is("...")) { var vp = this.next().pos; va = true; pt = { k: "ArrayType", elem: pt, pos: vp, varargs: true }; }
        if (this.is("this")) { this.next(); continue; }
        var pn = this.ident();
        pt = this.arrayDims(pt);
        m.params.push({ k: "Param", type: pt, name: pn.v, pos: pn.pos, varargs: va, mods: pm });
        if (va && this.is(",")) this.err(pn.pos, "varargs parameter must be the last parameter");
      } while (this.is(",") && this.next());
    }
    this.accept(")");
    if (!isCtor) m.ret = this.arrayDims(m.ret);
    if (this.is("throws")) {
      this.next();
      m.throws.push(this.type());
      while (this.is(",")) { this.next(); m.throws.push(this.type()); }
    }
    if (this.is("default")) { this.next(); m.defaultValue = this.annoValue(); }
    if (this.is("{")) m.body = this.block();
    else if (this.is(";")) { this.next(); }
    else if (this.is("=")) this.err(this.t.pos, "';' expected");
    else { if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing"); this.err(this.prev().end, "'{' or ';' expected"); }
    return m;
  };

  // ---------- tipos ----------
  PP.isTypeStart = function () {
    var t = this.t;
    return t.k === "id" || (t.k === "kw" && (PRIMS[t.v] || t.v === "void"));
  };
  PP.type = function (noDims) {
    var t = this.t, ty;
    if (this.is("@")) { this.annotation(); t = this.t; }
    if (t.k === "kw" && PRIMS[t.v]) { this.next(); ty = { k: "PrimType", name: t.v, pos: t.pos }; }
    else if (t.k === "kw" && t.v === "void") { this.next(); ty = { k: "PrimType", name: "void", pos: t.pos }; }
    else if (t.k === "id") ty = this.classType();
    else {
      if (t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
      if (t.k === "kw" && t.v === "_") this.err(t.pos, "as of release 9, '_' is a keyword, and may not be used as an identifier");
      this.err(t.pos, "illegal start of type");
    }
    if (!noDims) ty = this.arrayDims(ty);
    return ty;
  };
  PP.classType = function () {
    var parts = [];
    while (true) {
      if (this.is("@")) this.annotation();
      var nt = this.ident();
      var part = { name: nt.v, pos: nt.pos, args: null };
      if (this.is("<")) part.args = this.typeArgs();
      parts.push(part);
      if (this.is(".") && (this.isId(1) || this.is("@", 1))) { this.next(); continue; }
      break;
    }
    return { k: "ClassType", parts: parts, pos: parts[0].pos, name: parts.map(function (p) { return p.name; }).join(".") };
  };
  PP.typeArgs = function () {
    var p = this.accept("<").pos, args = [];
    if (this.is(">")) { this.next(); return { diamond: true, list: [], pos: p }; }
    do {
      if (this.is("?")) {
        var wp = this.next().pos, w = { k: "Wildcard", pos: wp, bound: null, kind: null };
        if (this.is("extends")) { this.next(); w.kind = "extends"; w.bound = this.type(); }
        else if (this.is("super")) { this.next(); w.kind = "super"; w.bound = this.type(); }
        args.push(w);
      } else args.push(this.type());
    } while (this.is(",") && this.next());
    this.acceptGT();
    return { diamond: false, list: args, pos: p };
  };

  // ---------- blocos e comandos ----------
  PP.block = function () {
    var p = this.accept("{").pos;
    var b = { k: "Block", pos: p, stats: [] };
    while (!this.is("}")) {
      if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
      if (this.is("case") || this.is("default")) this.err(this.t.pos, "orphaned " + this.t.v);
      b.stats.push(this.blockStatement());
    }
    b.endPos = this.t.pos;
    this.next();
    return b;
  };
  PP.isLocalVarDecl = function () {
    // tenta ler "Tipo nome" sem consumir
    var t = this.t;
    if (t.k === "kw" && PRIMS[t.v]) return !this.is(".", 1);
    if (t.k !== "id") return false;
    if (t.v === "var" && (this.isId(1) || this.is("_", 1))) return true;
    var mk = this.mark(), ok = false;
    try {
      this.type();
      ok = this.isId() || this.is("_");
      if (ok && this.t.v === "instanceof") ok = false;
    } catch (e) { if (!(e instanceof ParseAbort)) throw e; ok = false; }
    this.reset(mk);
    return ok;
  };
  PP.blockStatement = function () {
    var t = this.t;
    if (t.k === "kw") {
      switch (t.v) {
        case "final": case "abstract": case "static": case "strictfp": {
          var start = t.pos, mods = this.modifiers();
          if (this.isTypeDeclStart()) return { k: "LocalClass", pos: start, decl: this.typeDecl(mods) };
          return this.localVarDecl(mods, true);
        }
        case "class": case "interface": case "enum": return { k: "LocalClass", pos: t.pos, decl: this.typeDecl(this.modifiers()) };
      }
      if (PRIMS[t.v] && !this.is(".", 1) && !(this.is("[", 1) && this.is("]", 2) && this.is(".", 3))) return this.localVarDecl(this.modifiers(), true);
    }
    if (t.k === "op" && t.v === "@") {
      var mods2 = this.modifiers();
      if (this.isTypeDeclStart()) return { k: "LocalClass", pos: t.pos, decl: this.typeDecl(mods2) };
      return this.localVarDecl(mods2, true);
    }
    if (t.k === "id") {
      if (t.v === "record" && this.isId(1) && (this.is("(", 2) || this.is("<", 2))) return { k: "LocalClass", pos: t.pos, decl: this.typeDecl(this.modifiers()) };
      if (t.v === "yield" && !this.is("=", 1) && !this.is("(", 1) && !this.is(".", 1) && !this.is("[", 1) && !this.is("++", 1) && !this.is("--", 1)) {
        var yp = this.next().pos;
        var ye = this.expr();
        this.semi();
        return { k: "Yield", pos: yp, expr: ye };
      }
      if (this.is(":", 1)) {
        var lt = this.next(); this.next();
        return { k: "Labeled", pos: lt.pos, label: lt.v, body: this.statement() };
      }
      if (this.isLocalVarDecl()) return this.localVarDecl(this.modifiers(), true);
    }
    return this.statement();
  };
  PP.localVarDecl = function (mods, needSemi) {
    var start = mods.any ? mods.pos : this.t.pos;
    var type;
    var isVar = false;
    if (this.isWord("var") && (this.isId(1) || this.is("_", 1))) { var vt = this.next(); type = { k: "VarType", pos: vt.pos }; isVar = true; }
    else type = this.type();
    var decl = { k: "LocalVar", pos: start, mods: mods, type: type, vars: [] };
    do {
      var nt = this.ident();
      var ty = this.arrayDims(type);
      if (isVar && ty !== type) this.err(nt.pos, "'var' is not allowed as an element type of an array");
      var v = { name: nt.v, pos: nt.pos, type: ty, init: null };
      if (this.is("=")) { v.eqPos = this.next().pos; v.init = this.varInit(); }
      decl.vars.push(v);
      if (isVar && this.is(",")) this.err(this.t.pos, "'var' is not allowed in a compound declaration");
    } while (this.is(",") && this.next());
    if (needSemi) this.semi();
    return decl;
  };
  PP.varInit = function () {
    if (this.is("{")) return this.arrayInit();
    return this.expr();
  };
  PP.arrayInit = function () {
    var p = this.accept("{").pos, el = [];
    while (!this.is("}")) {
      el.push(this.varInit());
      if (this.is(",")) { this.next(); continue; }
      if (!this.is("}")) { if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing"); this.err(this.prev().end, "'}' expected"); }
    }
    this.next();
    return { k: "ArrayInit", pos: p, elems: el };
  };
  PP.parExpr = function () {
    this.lastParPos = this.t.pos;
    if (this.is("(")) this.next();
    else if (this.t.k !== "eof") { this.errSoft(this.prev().end, "'(' expected"); this.recovered = true; }
    else this.accept("(");
    var e = this.expr();
    if (this.is(")")) this.next();
    else if (this.t.k !== "eof" && (this.is("{") || this.file.lineOf(this.t.pos) > this.file.lineOf(this.prev().end))) { this.errSoft(this.prev().end, "')' expected"); this.recovered = true; }
    else this.accept(")");
    return e;
  };
  PP.statement = function () {
    var t = this.t, p = t.pos, e;
    if (t.k === "op") {
      if (t.v === "{") return this.block();
      if (t.v === ";") { this.next(); return { k: "Empty", pos: p }; }
    }
    if (t.k === "kw") switch (t.v) {
      case "if": {
        this.next();
        var c = this.parExpr();
        var th = this.statementAsBody();
        var el = null;
        if (this.is("else")) { this.next(); el = this.statementAsBody(); }
        return { k: "If", pos: p, cond: c, then: th, els: el };
      }
      case "while": { this.next(); var wc = this.parExpr(); return { k: "While", pos: p, cond: wc, body: this.statementAsBody() }; }
      case "do": {
        this.next();
        var body = this.statementAsBody();
        this.accept("while");
        var dc = this.parExpr();
        this.semi();
        return { k: "DoWhile", pos: p, cond: dc, body: body };
      }
      case "for": {
        this.next();
        this.accept("(");
        var init = [];
        if (!this.is(";")) {
          var save = this.i;
          var mods = this.modifiers();
          if (mods.any || this.isLocalVarDecl()) {
            var lv = this.localVarDecl(mods, false);
            if (this.is(":")) {
              if (lv.vars.length !== 1 || lv.vars[0].init) this.err(this.t.pos, "';' expected");
              this.next();
              var it = this.expr();
              this.accept(")");
              return { k: "ForEach", pos: p, varDecl: lv, expr: it, body: this.statementAsBody() };
            }
            init.push(lv);
          } else {
            this.i = save;
            do { init.push(this.exprStatementExpr()); } while (this.is(",") && this.next());
          }
        }
        this.accept(";");
        var cond = this.is(";") ? null : this.expr();
        this.accept(";");
        var upd = [];
        if (!this.is(")")) { do { upd.push(this.exprStatementExpr()); } while (this.is(",") && this.next()); }
        this.accept(")");
        return { k: "For", pos: p, init: init, cond: cond, update: upd, body: this.statementAsBody() };
      }
      case "try": return this.tryStatement();
      case "switch": {
        var sw = this.switchBody(false);
        return sw;
      }
      case "return": {
        this.next();
        e = this.is(";") ? null : this.expr();
        this.semi();
        return { k: "Return", pos: p, expr: e };
      }
      case "break": case "continue": {
        this.next();
        var lab = null;
        if (this.isId()) lab = this.ident().v;
        this.semi();
        return { k: t.v === "break" ? "Break" : "Continue", pos: p, label: lab };
      }
      case "throw": { this.next(); e = this.expr(); this.semi(); return { k: "Throw", pos: p, expr: e }; }
      case "synchronized": {
        this.next();
        var lk = this.parExpr();
        return { k: "Sync", pos: p, lock: lk, body: this.block() };
      }
      case "assert": {
        this.next();
        var ac = this.expr(), am = null;
        if (this.is(":")) { this.next(); am = this.expr(); }
        this.semi();
        return { k: "Assert", pos: p, cond: ac, msg: am };
      }
      case "else": this.err(p, "'else' without 'if'");
      case "catch": this.err(p, "'catch' without 'try'");
      case "finally": this.err(p, "'finally' without 'try'");
      case "case": case "default": this.err(p, "orphaned " + t.v);
      case "class": case "interface": case "enum": return { k: "LocalClass", pos: t.pos, decl: this.typeDecl(this.modifiers()) };
    }
    var ex = this.exprStatementExpr();
    this.semi();
    return { k: "ExprStmt", pos: p, expr: ex };
  };
  PP.statementAsBody = function () {
    // declarações não são permitidas como corpo de if/while/for
    var t = this.t;
    if (t.k === "kw" && PRIMS[t.v] && !this.is(".", 1)) {
      var save = this.i;
      if (this.isLocalVarDecl()) { this.localVarDecl(this.modifiers(), false); this.err(t.pos, "variable declaration not allowed here"); }
      this.i = save;
    }
    if (t.k === "id" && !this.is(":", 1) && this.isLocalVarDecl()) {
      var save2 = this.i;
      this.localVarDecl(this.modifiers(), false);
      this.i = save2;
      this.err(t.pos, "variable declaration not allowed here");
    }
    if (t.k === "kw" && (t.v === "class" || t.v === "interface" || t.v === "enum")) this.err(t.pos, "class, interface or enum declaration not allowed here");
    return this.statement();
  };
  PP.exprStatementExpr = function () {
    var e = this.expr();
    if (!isStatementExpr(e)) { this.errSoft(e.pos, "not a statement"); this.recovered = true; }
    return e;
  };
  function isStatementExpr(e) {
    switch (e.k) {
      case "Assign": case "CompoundAssign": case "Call": case "New": case "CtorCall": return true;
      case "Unary": return e.op === "++" || e.op === "--" || e.op === "post++" || e.op === "post--";
    }
    return false;
  }
  PP.tryStatement = function () {
    var p = this.next().pos;
    var res = null;
    if (this.is("(")) {
      this.next();
      res = [];
      while (!this.is(")")) {
        var rp = this.t.pos;
        var mods = this.modifiers();
        if (mods.any || this.isLocalVarDecl()) {
          var type;
          if (this.isWord("var") && this.isId(1)) { var vt = this.next(); type = { k: "VarType", pos: vt.pos }; }
          else type = this.type();
          var nt = this.ident();
          var eq = this.accept("=").pos;
          var init = this.expr();
          res.push({ k: "LocalVar", pos: rp, mods: mods, type: type, vars: [{ name: nt.v, pos: nt.pos, type: type, init: init, eqPos: eq }], resource: true });
        } else {
          res.push({ k: "ResourceExpr", pos: rp, expr: this.expr() });
        }
        if (this.is(";")) { this.next(); continue; }
        if (!this.is(")")) this.err(this.prev().end, "')' expected");
      }
      this.next();
    }
    var block = this.block();
    var catches = [], fin = null;
    while (this.is("catch")) {
      var cp = this.next().pos;
      this.accept("(");
      var cm = this.modifiers();
      var types = [this.type()];
      while (this.is("|")) { this.next(); types.push(this.type()); }
      var cn = this.ident();
      this.accept(")");
      catches.push({ pos: cp, mods: cm, types: types, name: cn.v, namePos: cn.pos, body: this.block() });
    }
    if (this.is("finally")) { this.next(); fin = this.block(); }
    if (!catches.length && !fin && !res) this.err(p, "'try' without 'catch', 'finally' or resource declarations");
    return { k: "Try", pos: p, resources: res, block: block, catches: catches, fin: fin };
  };

  // switch (comando ou expressão)
  PP.switchBody = function (isExpr) {
    var p = this.next().pos;
    var sel = this.parExpr();
    var selPos = this.lastParPos;
    var lb = this.accept("{").pos;
    var cases = [], arrow = null;
    while (!this.is("}")) {
      if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
      var cp = this.t.pos, labels = [], isDefault = false, guard = null;
      if (this.is("default")) { this.next(); isDefault = true; }
      else if (this.is("case")) {
        this.next();
        var nl0 = this.noLambda;
        this.noLambda = true;
        try {
          do {
            if (this.is("default")) { this.next(); labels.push({ k: "DefaultLabel", pos: this.prev().pos }); continue; }
            labels.push(this.caseLabel());
          } while (this.is(",") && this.next());
          if (this.isWord("when")) { this.next(); guard = this.expr(); }
        } finally { this.noLambda = nl0; }
      } else this.err(this.t.pos, "'case', 'default', or '}' expected");
      var thisArrow;
      if (this.is("->")) { this.next(); thisArrow = true; }
      else if (this.is(":")) { this.next(); thisArrow = false; }
      else this.err(this.prev().end, "':' or '->' expected");
      if (arrow === null) arrow = thisArrow;
      else if (arrow !== thisArrow) this.err(cp, "different case kinds used in the switch");
      var c = { pos: cp, labels: labels, isDefault: isDefault, guard: guard, body: null, stats: null };
      if (thisArrow) {
        if (this.is("{")) c.body = this.block();
        else if (this.is("throw")) c.body = this.statement();
        else {
          var e = this.expr();
          if (!isExpr && !isStatementExpr(e)) this.err(e.pos, "not a statement");
          this.semi();
          c.body = { k: "ExprStmt", pos: e.pos, expr: e, arrowExpr: true };
        }
      } else {
        c.stats = [];
        while (!this.is("case") && !this.is("default") && !this.is("}")) {
          if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
          c.stats.push(this.blockStatement());
        }
      }
      cases.push(c);
    }
    var endPos = this.t.pos;
    this.next();
    return { k: isExpr ? "SwitchExpr" : "Switch", pos: p, selector: sel, selPos: selPos, cases: cases, arrow: !!arrow, endPos: endPos };
  };
  PP.caseLabel = function () {
    // padrão de tipo, padrão de record, null, ou constante
    var t = this.t;
    if (t.k === "kw" && t.v === "null") { this.next(); return { k: "Expr", expr: { k: "Literal", type: "null", value: null, pos: t.pos }, pos: t.pos }; }
    if (this.looksLikePattern()) return this.pattern();
    var e = this.term1();
    return { k: "Expr", expr: e, pos: e.pos };
  };
  PP.looksLikePattern = function () {
    var t = this.t;
    if (t.k === "kw" && t.v === "final") return true;
    if (t.k === "kw" && PRIMS[t.v]) return true;
    if (t.k !== "id") return false;
    var mk = this.mark(), ok = false;
    try {
      this.type();
      ok = this.isId() || this.is("_") || this.is("(");
    } catch (e) { if (!(e instanceof ParseAbort)) throw e; }
    this.reset(mk);
    return ok;
  };
  PP.pattern = function () {
    var mods = this.modifiers();
    var p = this.t.pos;
    if (this.isWord("var") && (this.isId(1) || this.is("_", 1))) {
      this.next();
      var vn = this.ident();
      return { k: "TypePattern", pos: p, type: { k: "VarType", pos: p }, name: vn.v, namePos: vn.pos, mods: mods };
    }
    if (this.is("_")) { this.next(); return { k: "AnyPattern", pos: p }; }
    var ty = this.type();
    if (this.is("(")) {
      this.next();
      var subs = [];
      if (!this.is(")")) { do { subs.push(this.pattern()); } while (this.is(",") && this.next()); }
      this.accept(")");
      return { k: "RecordPattern", pos: p, type: ty, subs: subs };
    }
    var nt = this.ident();
    return { k: "TypePattern", pos: p, type: ty, name: nt.v, namePos: nt.pos, mods: mods };
  };

  // ---------- expressões ----------
  var ASSIGN_OPS = { "=": 1, "+=": 1, "-=": 1, "*=": 1, "/=": 1, "%=": 1, "&=": 1, "|=": 1, "^=": 1, "<<=": 1, ">>=": 1, ">>>=": 1 };
  nullProto(ASSIGN_OPS);
  var BIN_PREC = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "instanceof": 7, "<<": 8, ">>": 8, ">>>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
  nullProto(BIN_PREC);
  PP.expr = function () {
    var t = this.term1();
    if (this.t.k === "op" && ASSIGN_OPS[this.t.v]) {
      var op = this.next();
      var rhs = this.expr();
      if (op.v === "=") return { k: "Assign", pos: op.pos, target: t, value: rhs };
      return { k: "CompoundAssign", pos: op.pos, op: op.v.slice(0, -1), target: t, value: rhs };
    }
    return t;
  };
  PP.term1 = function () {
    var c = this.binary(1);
    if (this.is("?")) {
      var qp = this.next().pos;
      var a = this.term1OrLambda();
      this.accept(":");
      var b = this.term1OrLambda();
      return { k: "Cond", pos: qp, cond: c, a: a, b: b };
    }
    return c;
  };
  PP.term1OrLambda = function () {
    var e = this.term1();
    return e;
  };
  PP.binary = function (minPrec) {
    var left = this.unary();
    while (true) {
      var t = this.t;
      var op = (t.k === "op" || (t.k === "kw" && t.v === "instanceof")) ? t.v : null;
      var prec = op ? BIN_PREC[op] : 0;
      if (!prec || prec < minPrec) break;
      this.next();
      if (op === "instanceof") {
        var ip = t.pos, target;
        if (this.is("final") || this.looksLikePattern()) {
          var mk = this.mark();
          // tipo simples sem nome → teste de tipo
          var ty = null;
          try { this.modifiers(); ty = this.type(); } catch (e) { if (!(e instanceof ParseAbort)) throw e; }
          var isPat = this.isId() || this.is("_") || this.is("(");
          this.reset(mk);
          if (isPat) target = this.pattern();
          else target = this.type();
        } else target = this.type();
        left = { k: "InstanceOf", pos: ip, expr: left, target: target };
        continue;
      }
      var right = this.binary(prec + 1);
      left = { k: "Binary", pos: t.pos, op: op, l: left, r: right };
    }
    return left;
  };
  PP.unary = function () {
    var t = this.t;
    if (t.k === "op") {
      switch (t.v) {
        case "++": case "--": { this.next(); var e = this.unary(); return { k: "Unary", pos: t.pos, op: t.v, expr: e }; }
        case "+": case "-": {
          this.next();
          // -2147483648 e -9223372036854775808L
          var nt = this.t;
          if (t.v === "-" && (nt.k === "int" || nt.k === "long") && nt.radix === 10 && !this.isPostfixAfterLiteral()) {
            this.next();
            var lit = this.intLiteral(nt, true);
            var res = this.suffixes(lit);
            if (res === lit) return { k: "Unary", pos: t.pos, op: "-", expr: lit, negLiteral: true };
            return { k: "Unary", pos: t.pos, op: "-", expr: res };
          }
          var e2 = this.unary();
          return { k: "Unary", pos: t.pos, op: t.v, expr: e2 };
        }
        case "!": case "~": { this.next(); var e3 = this.unary(); return { k: "Unary", pos: t.pos, op: t.v, expr: e3 }; }
        case "(": return this.parenOrCastOrLambda();
      }
    }
    var prim = this.primary();
    return this.suffixes(prim);
  };
  PP.isPostfixAfterLiteral = function () { return this.is(".", 1) || this.is("[", 1); };
  PP.intLiteral = function (t, neg) {
    var txt = t.v.replace(/_/g, "").replace(/[lL]$/, "");
    var big;
    if (t.radix === 16) big = BigInt("0x" + txt.slice(2));
    else if (t.radix === 2) big = BigInt("0b" + txt.slice(2));
    else if (t.radix === 8) big = BigInt("0o" + (txt.slice(1) || "0"));
    else big = BigInt(txt);
    if (t.k === "int") {
      if (t.radix === 10) {
        if (big > 2147483648n || (big === 2147483648n && !neg)) this.err(t.pos, "integer number too large");
      } else if (big > 0xFFFFFFFFn) this.err(t.pos, "integer number too large");
      var v = Number(BigInt.asIntN(32, big));
      return { k: "Literal", type: "int", value: v, pos: t.pos, neg: neg };
    }
    if (t.radix === 10) {
      if (big > 9223372036854775808n || (big === 9223372036854775808n && !neg)) this.err(t.pos, "integer number too large");
    } else if (big > 0xFFFFFFFFFFFFFFFFn) this.err(t.pos, "integer number too large");
    return { k: "Literal", type: "long", value: BigInt.asIntN(64, big), pos: t.pos };
  };
  PP.parenOrCastOrLambda = function () {
    var p = this.t.pos;
    // lambda?
    var j = this.i, depth = 0;
    for (; j < this.toks.length; j++) {
      var tk = this.toks[j];
      if (tk.k === "op" && tk.v === "(") depth++;
      else if (tk.k === "op" && tk.v === ")") { depth--; if (depth === 0) break; }
      else if (tk.k === "eof") break;
    }
    var after = this.toks[j + 1];
    if (after && after.k === "op" && after.v === "->") return this.lambda();
    // cast?
    var next = this.peek(1);
    if (next.k === "kw" && PRIMS[next.v]) {
      var mk0 = this.mark();
      this.next();
      var pt = this.type();
      if (this.is(")")) {
        this.next();
        var ce = this.unary();
        return { k: "Cast", pos: p, type: pt, expr: ce };
      }
      this.reset(mk0);
    }
    if (next.k === "id") {
      var mk = this.mark(), isCast = false, ty = null, bounds = [];
      try {
        this.next();
        ty = this.type();
        while (this.is("&")) { this.next(); bounds.push(this.type()); }
        if (this.is(")")) {
          var a = this.peek(1);
          isCast = (a.k === "id" || a.k === "string" || a.k === "char" || a.k === "int" || a.k === "long" || a.k === "float" || a.k === "double" ||
            (a.k === "op" && (a.v === "(" || a.v === "!" || a.v === "~")) ||
            (a.k === "kw" && /^(this|super|new|true|false|null|switch|_)$/.test(a.v)) || (a.k === "kw" && PRIMS[a.v]));
        }
      } catch (e) { if (!(e instanceof ParseAbort)) throw e; isCast = false; }
      if (!isCast) this.reset(mk); else this.errs.length = mk.e;
      if (isCast) {
        this.next();
        var target;
        if (this.lambdaAhead()) target = this.lambda();
        else target = this.unary();
        return { k: "Cast", pos: p, type: ty, bounds: bounds, expr: target };
      }
    }
    this.next();
    var inner = this.expr();
    this.accept(")");
    var par = { k: "Paren", pos: p, expr: inner };
    return this.suffixes(par);
  };
  PP.lambdaAhead = function () {
    if (this.isId() && this.is("->", 1)) return true;
    if (!this.is("(")) return false;
    var j = this.i, depth = 0;
    for (; j < this.toks.length; j++) {
      var tk = this.toks[j];
      if (tk.k === "op" && tk.v === "(") depth++;
      else if (tk.k === "op" && tk.v === ")") { depth--; if (depth === 0) break; }
      else if (tk.k === "eof") return false;
    }
    var after = this.toks[j + 1];
    return after && after.k === "op" && after.v === "->";
  };
  PP.lambda = function () {
    var p = this.t.pos, params = [], explicit = false;
    if (this.isId() || this.is("_")) {
      var nt = this.ident();
      params.push({ name: nt.v, pos: nt.pos, type: null });
    } else {
      this.accept("(");
      if (!this.is(")")) {
        do {
          var mods = this.modifiers();
          if ((this.isId() || this.is("_")) && (this.is(",", 1) || this.is(")", 1))) {
            var n1 = this.ident();
            params.push({ name: n1.v, pos: n1.pos, type: null, mods: mods });
          } else {
            var ty;
            if (this.isWord("var")) { var vt = this.next(); ty = { k: "VarType", pos: vt.pos }; }
            else ty = this.type();
            if (this.is("...")) { this.next(); ty = { k: "ArrayType", elem: ty, pos: ty.pos }; }
            var n2 = this.ident();
            params.push({ name: n2.v, pos: n2.pos, type: ty, mods: mods });
            explicit = true;
          }
        } while (this.is(",") && this.next());
      }
      this.accept(")");
    }
    var ap = this.accept("->").pos;
    var body;
    if (this.is("{")) body = this.block();
    else body = this.expr();
    return { k: "Lambda", pos: ap, start: p, params: params, body: body, explicit: explicit };
  };
  PP.arguments = function () {
    var nl0 = this.noLambda; this.noLambda = false;
    try { return this.arguments0(); } finally { this.noLambda = nl0; }
  };
  PP.arguments0 = function () {
    var p = this.accept("(").pos, args = [];
    if (!this.is(")")) {
      do {
        if (this.is(")")) this.err(this.t.pos, "illegal start of expression");
        args.push(this.expr());
      } while (this.is(",") && this.next());
    }
    if (!this.is(")")) {
      if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
      this.err(this.prev().end, "')' or ',' expected");
    }
    this.next();
    args.pos = p;
    return args;
  };
  PP.primary = function () {
    var t = this.t, p = t.pos;
    switch (t.k) {
      case "int": case "long": this.next(); return this.intLiteral(t, false);
      case "float": this.next(); return { k: "Literal", type: "float", value: t.v, pos: p };
      case "double": this.next(); return { k: "Literal", type: "double", value: t.v, pos: p };
      case "char": this.next(); return { k: "Literal", type: "char", value: t.v.charCodeAt(0), pos: p };
      case "string": this.next(); return { k: "Literal", type: "String", value: t.v, pos: p, textBlock: !!t.textBlock };
      case "id": {
        if (this.is("->", 1) && !this.noLambda) return this.lambda();
        this.next();
        if (this.is("(")) {
          var args = this.arguments();
          return { k: "Call", pos: args.pos, target: null, name: t.v, namePos: p, args: args };
        }
        return { k: "Ident", pos: p, name: t.v };
      }
      case "kw":
        switch (t.v) {
          case "true": case "false": this.next(); return { k: "Literal", type: "boolean", value: t.v === "true", pos: p };
          case "null": this.next(); return { k: "Literal", type: "null", value: null, pos: p };
          case "this":
            this.next();
            if (this.is("(")) { var a2 = this.arguments(); return { k: "CtorCall", pos: a2.pos, kind: "this", args: a2, kwPos: p }; }
            return { k: "This", pos: p };
          case "super":
            this.next();
            if (this.is("(")) { var a3 = this.arguments(); return { k: "CtorCall", pos: a3.pos, kind: "super", args: a3, kwPos: p }; }
            if (this.is("::")) { this.next(); var sn = this.ident(); return { k: "MethodRef", pos: p, target: { k: "Super", pos: p }, name: sn.v }; }
            var dp = this.accept(".").pos;
            if (this.is("<")) this.typeArgs();
            var nm = this.ident();
            if (this.is("(")) { var a4 = this.arguments(); return { k: "Call", pos: a4.pos, target: { k: "Super", pos: p }, name: nm.v, namePos: dp, args: a4 }; }
            return { k: "Select", pos: dp, target: { k: "Super", pos: p }, name: nm.v };
          case "new": return this.creator(null);
          case "switch": return this.switchBody(true);
          case "_": this.err(p, "as of release 9, '_' is a keyword, and may not be used as an identifier");
          case "void":
            this.next();
            if (this.is(".") && this.is("class", 1)) { this.next(); this.next(); return { k: "ClassLit", pos: p, type: { k: "PrimType", name: "void", pos: p } }; }
            this.err(p, "illegal start of expression");
          default:
            if (PRIMS[t.v]) {
              var ty = this.type();
              if (this.is("::")) { this.next(); var nn = this.is("new") ? (this.next(), "new") : this.ident().v; return { k: "MethodRef", pos: p, target: { k: "TypeExpr", type: ty, pos: p }, name: nn }; }
              if (this.is(".") && this.is("class", 1)) { this.next(); this.next(); return { k: "ClassLit", pos: p, type: ty }; }
              this.err(this.t.pos, this.is(".") ? "class expected" : "'.class' expected");
            }
        }
    }
    if (t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
    this.err(p, "illegal start of expression");
  };
  PP.creator = function (outer) {
    var p = this.next().pos; // new
    var typeArgs = null;
    if (this.is("<")) typeArgs = this.typeArgs();
    var t = this.t, ty;
    if (t.k === "kw" && PRIMS[t.v]) { this.next(); ty = { k: "PrimType", name: t.v, pos: t.pos }; }
    else if (t.k === "id" || this.is("@")) ty = this.classType();
    else { if (t.k === "eof") this.err(this.prev().end, "reached end of file while parsing"); this.err(this.prev().end, "<identifier> expected"); }
    if (this.is("[")) {
      var dims = [], extra = 0, init = null;
      while (this.is("[")) {
        var bp = this.next().pos;
        if (this.is("]")) { this.next(); extra++; continue; }
        if (extra) this.err(bp, "']' expected");
        dims.push(this.expr());
        this.accept("]");
      }
      if (this.is("{")) {
        if (dims.length) this.err(this.t.pos, "';' expected");
        init = this.arrayInit();
      } else if (!dims.length) { this.errSoft(this.prev().end, "array dimension missing"); this.recovered = true; }
      var res = { k: "NewArray", pos: p, elemType: ty, dims: dims, extraDims: extra, init: init };
      return res;
    }
    if (ty.k === "PrimType") this.err(this.t.pos, "'[' expected");
    if (this.is("{")) this.err(this.prev().end, "'(' or '[' expected");
    if (!this.is("(")) { if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing"); this.err(this.prev().end, "'(' or '[' expected"); }
    var args = this.arguments();
    var body = null;
    if (this.is("{")) {
      var anon = { k: "Class", kind: "class", name: "", namePos: this.t.pos, pos: this.t.pos, mods: { flags: {}, annos: [] }, tparams: [], ext: null, impl: [], permits: [], members: [], enumConsts: [], file: this.file, anon: true };
      this.classBody(anon);
      body = anon;
    }
    return { k: "New", pos: p, type: ty, args: args, body: body, outer: outer };
  };
  PP.suffixes = function (e) {
    while (true) {
      var t = this.t;
      if (t.k !== "op") break;
      if (t.v === ".") {
        var dp = this.next().pos;
        if (this.is("new")) { e = this.creator(e); continue; }
        if (this.is("class")) { this.next(); e = { k: "ClassLit", pos: dp, type: exprToType(e, this) }; continue; }
        if (this.is("this")) { this.next(); e = { k: "This", pos: dp, qual: exprToType(e, this) }; continue; }
        if (this.is("super")) {
          var sp = this.next().pos;
          if (this.is("::")) { this.next(); var smn = this.ident(); e = { k: "MethodRef", pos: dp, target: { k: "Super", pos: sp, qual: exprToType(e, this) }, name: smn.v }; continue; }
          var dp2 = this.accept(".").pos;
          var sn = this.ident();
          var sa = this.arguments();
          e = { k: "Call", pos: sa.pos, target: { k: "Super", pos: sp, qual: exprToType(e, this) }, name: sn.v, namePos: dp2, args: sa };
          continue;
        }
        var targs = null;
        if (this.is("<")) targs = this.typeArgs();
        if (this.t.k !== "id") {
          if (this.t.k === "eof") this.err(this.prev().end, "reached end of file while parsing");
          this.err(this.prev().end, "<identifier> expected");
        }
        var nt = this.ident();
        if (this.is("(")) {
          var args = this.arguments();
          e = { k: "Call", pos: args.pos, target: e, name: nt.v, namePos: dp, args: args, typeArgs: targs };
        } else e = { k: "Select", pos: dp, target: e, name: nt.v };
        continue;
      }
      if (t.v === "[") {
        // tipo de array em expressão: String[]::new, int[].class
        if (this.is("]", 1)) {
          var ty = exprToType(e, this);
          while (this.is("[") && this.is("]", 1)) { var bp = this.next().pos; this.next(); ty = { k: "ArrayType", elem: ty, pos: bp }; }
          if (this.is("::")) { this.next(); var nn = this.is("new") ? (this.next(), "new") : this.ident().v; e = { k: "MethodRef", pos: e.pos, target: { k: "TypeExpr", type: ty, pos: e.pos }, name: nn }; continue; }
          if (this.is(".") && this.is("class", 1)) { this.next(); this.next(); e = { k: "ClassLit", pos: e.pos, type: ty }; continue; }
          this.err(this.t.pos, "illegal start of expression");
        }
        var ip = this.next().pos;
        var idx = this.expr();
        this.accept("]");
        e = { k: "Index", pos: ip, arr: e, index: idx };
        continue;
      }
      if (t.v === "++" || t.v === "--") { this.next(); e = { k: "Unary", pos: t.pos, op: "post" + t.v, expr: e }; continue; }
      if (t.v === "::") {
        var cp = this.next().pos;
        var name = this.is("new") ? (this.next(), "new") : this.ident().v;
        e = { k: "MethodRef", pos: e.pos, refPos: cp, target: e, name: name };
        continue;
      }
      if (t.v === "<" && (e.k === "Ident" || e.k === "Select") && this.genericTypeBeforeColons()) {
        // List<String>::size
        var ta = this.typeArgs();
        var ty2 = exprToType(e, this);
        ty2.parts[ty2.parts.length - 1].args = ta;
        this.accept("::");
        var n3 = this.is("new") ? (this.next(), "new") : this.ident().v;
        e = { k: "MethodRef", pos: e.pos, target: { k: "TypeExpr", type: ty2, pos: e.pos }, name: n3 };
        continue;
      }
      break;
    }
    return e;
  };
  PP.genericTypeBeforeColons = function () {
    var mk = this.mark(), ok = false;
    try { this.typeArgs(); ok = this.is("::"); } catch (e) { if (!(e instanceof ParseAbort)) throw e; }
    this.reset(mk);
    return ok;
  };
  function exprToType(e, parser) {
    var parts = [];
    function walk(x) {
      if (x.k === "Ident") { parts.push({ name: x.name, pos: x.pos, args: null }); return true; }
      if (x.k === "Select") { if (!walk(x.target)) return false; parts.push({ name: x.name, pos: x.pos, args: null }); return true; }
      return false;
    }
    if (e.k === "TypeExpr") return e.type;
    if (!walk(e)) parser.err(e.pos, "<identifier> expected");
    return { k: "ClassType", parts: parts, pos: parts[0].pos, name: parts.map(function (p) { return p.name; }).join(".") };
  }

  JavaSim._lex = lex;
  JavaSim._Parser = Parser;

  /* =====================================================================
     4. Tipos e símbolos
     ===================================================================== */
  function PrimType(n, rank) { this.k = "prim"; this.n = n; this.rank = rank; }
  var T = {
    "boolean": new PrimType("boolean", 0), "byte": new PrimType("byte", 1), "short": new PrimType("short", 2),
    "char": new PrimType("char", 2), "int": new PrimType("int", 3), "long": new PrimType("long", 4),
    "float": new PrimType("float", 5), "double": new PrimType("double", 6), "void": new PrimType("void", -1)
  };
  var T_NULL = { k: "null" }, T_ERR = { k: "err" };
  function ClassType(sym, args) { this.k = "class"; this.sym = sym; this.args = args || null; }
  function ArrayType(elem) { this.k = "array"; this.elem = elem; }
  function TVarType(sym) { this.k = "tvar"; this.sym = sym; }
  function WildType(kind, bound) { this.k = "wild"; this.kind = kind; this.bound = bound; }
  var tvarId = 0;
  function TVarSym(name, owner) { this.name = name; this.owner = owner; this.bounds = []; this.id = ++tvarId; this.type = new TVarType(this); }

  function isPrim(t) { return t.k === "prim"; }
  function isNumericPrim(t) { return t.k === "prim" && t.n !== "boolean" && t.n !== "void"; }
  function isIntegralPrim(t) { return t.k === "prim" && (t.n === "int" || t.n === "long" || t.n === "short" || t.n === "byte" || t.n === "char"); }
  function isRef(t) { return t.k === "class" || t.k === "array" || t.k === "tvar" || t.k === "null" || t.k === "wild" || t.k === "inter"; }
  function isErr(t) { return t === T_ERR || t.k === "err"; }

  // ---------- símbolos de classe ----------
  var classIdSeq = 0;
  function ClassSym(name, full, kind) {
    this.id = ++classIdSeq;
    this.name = name; this.full = full; this.kind = kind || "class";
    this.flags = {}; this.tparams = []; this.superT = null; this.ifaces = []; this.permits = null;
    this.fields = Object.create(null); this.fieldList = []; this.methods = Object.create(null); this.methodList = []; this.ctors = []; this.members = Object.create(null);
    this.outer = null; this.pkg = ""; this.bin = full; this.decl = null; this.lib = null;
    this.completed = false; this.headerDone = false;
    this.inner = false; this.local = false; this.anon = false;
    this.type = null; // ClassType sem argumentos (ou com as próprias variáveis)
  }
  ClassSym.prototype.isInterface = function () { return this.kind === "interface" || this.kind === "annotation"; };
  ClassSym.prototype.isEnum = function () { return this.kind === "enum"; };
  ClassSym.prototype.isRecord = function () { return this.kind === "record"; };
  ClassSym.prototype.thisType = function () {
    if (!this._thisType) this._thisType = new ClassType(this, this.tparams.length ? this.tparams.map(function (tv) { return tv.type; }) : null);
    return this._thisType;
  };
  ClassSym.prototype.rawType = function () {
    if (!this._rawType) this._rawType = new ClassType(this, null);
    return this._rawType;
  };
  ClassSym.prototype.kindName = function () {
    if (this.kind === "interface") return "interface";
    if (this.kind === "enum") return "enum";
    if (this.kind === "record") return "record";
    if (this.kind === "annotation") return "@interface";
    return "class";
  };

  function FieldSym(name, owner, type, flags) {
    this.name = name; this.owner = owner; this.type = type; this.flags = flags || {};
    this.constVal = undefined; this.key = name; this.decl = null; this.kind = "field";
  }
  var methodIdSeq = 0;
  function MethodSym(name, owner) {
    this.id = ++methodIdSeq;
    this.name = name; this.owner = owner; this.tparams = []; this.params = []; this.varargs = false;
    this.ret = T["void"]; this.throws = []; this.flags = {}; this.decl = null; this.impl = null; this.kind = "method";
  }
  function VarSym(name, type, kind) { this.name = name; this.type = type; this.kind = kind; this.slot = -1; this.flags = {}; this.assigns = 0; }

  // ---------- registro de classes da biblioteca ----------
  var LIB = {};          // nome completo → ClassSym
  var LIB_SIMPLE = {};   // nome simples → [ClassSym]
  var PKGS = {};         // pacote → { nome simples → ClassSym }
  function regLibClass(sym) {
    LIB[sym.full] = sym;
  nullProto(PKGS);
  nullProto(LIB_SIMPLE);
  nullProto(LIB);
    (LIB_SIMPLE[sym.name] = LIB_SIMPLE[sym.name] || []).push(sym);
    if (!sym.outer) (PKGS[sym.pkg] = PKGS[sym.pkg] || {})[sym.name] = sym;
  }
  function L(full) {
    var s = LIB[full];
    if (!s) throw new Error("classe da biblioteca não registrada: " + full);
    return s;
  }
  function libType(full, args) { var s = L(full); return args ? new ClassType(s, args) : s.rawType(); }

  // ---------- impressão de tipos (como o javac) ----------
  function typeStr(t) {
    if (!t) return "?";
    switch (t.k) {
      case "prim": return t.n;
      case "null": return "<null>";
      case "err": return "<any>";
      case "array": return typeStr(t.elem) + "[]";
      case "tvar": return t.sym.name;
      case "wild": return t.kind ? "? " + t.kind + " " + typeStr(t.bound) : "?";
      case "inter": return t.types.map(typeStr).join("&");
      case "class": {
        var n = classDisplayName(t.sym);
        if (t.args && t.args.length) n += "<" + t.args.map(typeStr).join(",") + ">";
        return n;
      }
    }
    return "?";
  }
  var QUALIFIED_NAMES = false;
  function classDisplayName(sym) {
    if (sym.anon) return "<anonymous " + (sym.anonOf ? typeStr(sym.anonOf) : "") + ">";
    if (QUALIFIED_NAMES && sym.isLib && sym.pkg) return canonicalName(sym);
    return sym.name;
  }
  // nome "qualificado" para mensagens como "No enum constant Main.Cor.X"
  function canonicalName(sym) {
    if (sym.outer) return canonicalName(sym.outer) + "." + sym.name;
    return sym.pkg ? sym.pkg + "." + sym.name : sym.name;
  }
  // nome binário (getClass().getName(), stack trace)
  function binaryName(sym) { return sym.bin; }

  // ---------- substituição ----------
  function substMap(tparams, args) {
    var m = {};
    if (!args) { tparams.forEach(function (tv) { m[tv.id] = erasure(tv.type); }); return m; }
    for (var i = 0; i < tparams.length; i++) m[tparams[i].id] = args[i] || L("java.lang.Object").rawType();
    return m;
  }
  function subst(t, m) {
    if (!t || !m) return t;
    switch (t.k) {
      case "tvar": return has(m, t.sym.id) ? m[t.sym.id] : t;
      case "array": { var e = subst(t.elem, m); return e === t.elem ? t : new ArrayType(e); }
      case "wild": return t.bound ? new WildType(t.kind, subst(t.bound, m)) : t;
      case "class": {
        if (!t.args) return t;
        var ch = false, na = t.args.map(function (a) { var b = subst(a, m); if (b !== a) ch = true; return b; });
        return ch ? new ClassType(t.sym, na) : t;
      }
    }
    return t;
  }
  function erasure(t) {
    switch (t.k) {
      case "tvar": return t.sym.bounds.length ? erasure(t.sym.bounds[0]) : L("java.lang.Object").rawType();
      case "array": { var e = erasure(t.elem); return e === t.elem ? t : new ArrayType(e); }
      case "class": return t.args ? t.sym.rawType() : t;
      case "wild": return t.bound && t.kind === "extends" ? erasure(t.bound) : L("java.lang.Object").rawType();
      case "inter": return erasure(t.types[0]);
    }
    return t;
  }
  // nome de tipo apagado, usado nas chaves de métodos em tempo de execução
  function erasedName(t) {
    t = erasure(t);
    if (t.k === "prim") return t.n;
    if (t.k === "array") return erasedName(t.elem) + "[]";
    if (t.k === "class") return t.sym.full;
    return "java.lang.Object";
  }
  function methodKey(name, params) { return name + "(" + params.map(erasedName).join(",") + ")"; }

  // ---------- hierarquia ----------
  function supertypesOf(t) {
    // supertipos diretos de um ClassType, com substituição
    var sym = t.sym; completeHeader(sym);
    var raw = !t.args && sym.tparams.length > 0;
    var m = sym.tparams.length && t.args ? substMap(sym.tparams, t.args) : null;
    var r = [];
    if (sym.superT) r.push(raw ? erasure(sym.superT) : m ? subst(sym.superT, m) : sym.superT);
    sym.ifaces.forEach(function (i) { r.push(raw ? erasure(i) : m ? subst(i, m) : i); });
    if (sym.isInterface() && !sym.ifaces.length && sym.full !== "java.lang.Object") r.push(L("java.lang.Object").rawType());
    return r;
  }
  // o supertipo de t cuja classe é "target" (ou null)
  function asSuper(t, target) {
    if (t.k === "tvar") {
      var bs = t.sym.bounds.length ? t.sym.bounds : [L("java.lang.Object").rawType()];
      for (var i = 0; i < bs.length; i++) { var r0 = asSuper(bs[i], target); if (r0) return r0; }
      return null;
    }
    if (t.k === "wild") return t.kind === "extends" ? asSuper(t.bound, target) : asSuper(L("java.lang.Object").rawType(), target);
    if (t.k === "inter") { for (var q = 0; q < t.types.length; q++) { var rr = asSuper(t.types[q], target); if (rr) return rr; } return null; }
    if (t.k === "array") {
      if (target.full === "java.lang.Object" || target.full === "java.lang.Cloneable" || target.full === "java.io.Serializable") return target.rawType();
      return null;
    }
    if (t.k !== "class") return null;
    if (t.sym === target) return t;
    var seen = {};
    function walk(x) {
      if (x.sym === target) return x;
      if (seen[x.sym.id]) return null;
      seen[x.sym.id] = 1;
      var ss = supertypesOf(x);
      for (var i = 0; i < ss.length; i++) { var r = walk(ss[i]); if (r) return r; }
      return null;
    }
    return walk(t);
  }
  function isSubClass(a, b) { // símbolos
    if (a === b) return true;
    return !!asSuper(a.rawType(), b);
  }

  // ---------- igualdade e subtipagem ----------
  function sameType(a, b) {
    if (a === b) return true;
    if (isErr(a) || isErr(b)) return true;
    if (a.k !== b.k) return false;
    switch (a.k) {
      case "prim": return a.n === b.n;
      case "array": return sameType(a.elem, b.elem);
      case "tvar": return a.sym === b.sym;
      case "null": return true;
      case "wild": return a.kind === b.kind && (!a.bound || sameType(a.bound, b.bound));
      case "class":
        if (a.sym !== b.sym) return false;
        if (!a.args || !b.args) return !a.args && !b.args;
        for (var i = 0; i < a.args.length; i++) if (!sameType(a.args[i], b.args[i])) return false;
        return true;
    }
    return false;
  }
  function OBJ() { return L("java.lang.Object").rawType(); }
  function isSubtype(s, t) {
    if (s === t) return true;
    if (isErr(s) || isErr(t)) return true;
    if (s.k === "prim" || t.k === "prim") {
      if (s.k !== "prim" || t.k !== "prim") return false;
      return s.n === t.n || primWidens(s, t);
    }
    if (s.k === "null") return true;
    if (t.k === "null") return false;
    if (t.k === "class" && t.sym.full === "java.lang.Object") return true;
    if (s.k === "inter") return s.types.some(function (x) { return isSubtype(x, t); });
    if (t.k === "inter") return t.types.every(function (x) { return isSubtype(s, x); });
    if (s.k === "wild") return isSubtype(s.kind === "extends" ? s.bound : OBJ(), t);
    if (t.k === "wild") return t.kind === "super" ? isSubtype(s, t.bound) : false;
    if (t.k === "tvar") {
      if (s.k === "tvar" && s.sym === t.sym) return true;
      if (s.k === "tvar") return s.sym.bounds.some(function (b) { return isSubtype(b, t); });
      return false;
    }
    if (s.k === "tvar") {
      var bs = s.sym.bounds.length ? s.sym.bounds : [OBJ()];
      return bs.some(function (b) { return isSubtype(b, t); });
    }
    if (s.k === "array") {
      if (t.k === "array") {
        if (s.elem.k === "prim" || t.elem.k === "prim") return s.elem.k === "prim" && t.elem.k === "prim" && s.elem.n === t.elem.n;
        return isSubtype(s.elem, t.elem);
      }
      if (t.k === "class") return t.sym.full === "java.lang.Object" || t.sym.full === "java.lang.Cloneable" || t.sym.full === "java.io.Serializable";
      return false;
    }
    if (s.k === "class" && t.k === "class") {
      var sup = asSuper(s, t.sym);
      if (!sup) return false;
      if (!t.args || !sup.args) return true; // tipo cru (conversão não verificada)
      for (var i = 0; i < t.args.length; i++) if (!containsArg(t.args[i], sup.args[i])) return false;
      return true;
    }
    return false;
  }
  function containsArg(t, s) {
    if (isErr(t) || isErr(s)) return true;
    if (t.k === "wild") {
      if (!t.kind) return true;
      if (t.kind === "extends") return isSubtype(s.k === "wild" ? (s.kind === "extends" ? s.bound : OBJ()) : s, t.bound);
      if (s.k === "wild") return s.kind === "super" && isSubtype(t.bound, s.bound);
      return isSubtype(t.bound, s);
    }
    if (s.k === "wild") return false;
    return sameType(t, s);
  }
  function primWidens(s, t) {
    var from = s.n, to = t.n;
    var w = {
      "byte": ["short", "int", "long", "float", "double"], "short": ["int", "long", "float", "double"],
      "char": ["int", "long", "float", "double"], "int": ["long", "float", "double"], "long": ["float", "double"], "float": ["double"]
    };
    return !!(w[from] && w[from].indexOf(to) >= 0);
  }
  // boxing / unboxing
  var BOX = { "boolean": "java.lang.Boolean", "byte": "java.lang.Byte", "short": "java.lang.Short", "char": "java.lang.Character", "int": "java.lang.Integer", "long": "java.lang.Long", "float": "java.lang.Float", "double": "java.lang.Double" };
  nullProto(BOX);
  var UNBOX = {};
  nullProto(UNBOX);
  Object.keys(BOX).forEach(function (k) { UNBOX[BOX[k]] = k; });
  function boxedType(p) { return L(BOX[p.n]).rawType(); }
  function unboxedType(t) {
    if (t.k === "class" && UNBOX[t.sym.full]) return T[UNBOX[t.sym.full]];
    if (t.k === "tvar") { for (var i = 0; i < t.sym.bounds.length; i++) { var u = unboxedType(t.sym.bounds[i]); if (u) return u; } }
    return null;
  }
  function unboxedOrSelf(t) { return t.k === "prim" ? t : (unboxedType(t) || null); }

  function isString(t) { return t.k === "class" && t.sym.full === "java.lang.String"; }
  function isObjectType(t) { return t.k === "class" && t.sym.full === "java.lang.Object"; }
  function isThrowable(t) { return t.k === "class" && isSubClass(t.sym, L("java.lang.Throwable")); }
  function isChecked(sym) {
    if (!isSubClass(sym, L("java.lang.Throwable"))) return false;
    return !isSubClass(sym, L("java.lang.RuntimeException")) && !isSubClass(sym, L("java.lang.Error"));
  }
  function isReifiable(t) {
    if (t.k === "prim") return true;
    if (t.k === "array") return isReifiable(t.elem);
    if (t.k === "class") return !t.args || t.args.every(function (a) { return a.k === "wild" && !a.kind; });
    return false;
  }

  // promoção numérica binária
  function binaryPromote(a, b) {
    if (a.n === "double" || b.n === "double") return T["double"];
    if (a.n === "float" || b.n === "float") return T["float"];
    if (a.n === "long" || b.n === "long") return T["long"];
    return T["int"];
  }
  function unaryPromote(a) {
    if (a.n === "byte" || a.n === "short" || a.n === "char") return T["int"];
    return a;
  }

  // ---------- completar a classe (ler as assinaturas da biblioteca) ----------
  function completeHeader(sym) {
    if (sym.headerDone) return;
    sym.headerDone = true;
    if (sym.lib && sym.lib.header) sym.lib.header(sym);
  }
  function complete(sym) {
    completeHeader(sym);
    if (sym.completed) return;
    sym.completed = true;
    if (sym.lib && sym.lib.members) sym.lib.members(sym);
  }

  JavaSim._T = T;

  /* =====================================================================
     5. Declaração da biblioteca (assinaturas em texto Java + implementação JS)
        defLib("java.util.ArrayList", { tp: "E", ext: "AbstractList<E>", impl: ["List<E>"],
               m: { "<init>()": fn, "boolean add(E)": fn, "static <T> List<T> of(T...)": fn } })
     ===================================================================== */
  var LIB_DEFAULT_IMPORTS = ["java.lang", "java.util", "java.util.function", "java.util.stream", "java.io", "java.nio.file", "java.time", "java.time.format", "java.math", "java.util.regex", "java.util.concurrent", "java.util.concurrent.atomic", "java.nio.charset", "java.time.temporal", "java.util.concurrent.locks", "java.text"];
  function defLib(full, spec) {
    var dot = full.lastIndexOf(".");
    var pkgPart = full.slice(0, dot), name = full.slice(dot + 1);
    var outer = null;
    // classe aninhada: "java.util.Map.Entry" (o pai já registrado)
    if (LIB[pkgPart]) { outer = LIB[pkgPart]; }
    var sym = new ClassSym(name, full, spec.kind || "class");
    sym.pkg = outer ? outer.pkg : pkgPart;
    sym.outer = outer;
    sym.bin = spec.bin || (outer ? outer.bin + "$" + name : full);
    sym.lib = { spec: spec, header: libHeader, members: libMembers };
    (spec.flags || "public").split(" ").forEach(function (f) { if (f) sym.flags[f] = true; });
    if (sym.kind === "interface") sym.flags.abstract = true;
    if (outer) { outer.members[name] = sym; sym.flags["static"] = true; }
    sym.isLib = true;
    regLibClass(sym);
    if (spec.tp) {
      // variáveis de tipo criadas já (os limites são lidos em libHeader)
      sym.tparams = splitTop(spec.tp).map(function (s) { var n = s.trim().split(/\s+/)[0]; return new TVarSym(n, sym); });
    }
    return sym;
  }
  function splitTop(s) {
    var r = [], d = 0, cur = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === "<") d++; else if (c === ">") d--;
      if (c === "," && d === 0) { r.push(cur); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim()) r.push(cur);
    return r;
  }
  // parser de tipos para assinaturas da biblioteca
  function parseTypeText(txt) {
    var f = new SourceFile("<lib>", txt);
    var p = new Parser(f, []);
    return p;
  }
  function libScope(sym, mtparams) {
    return function (name) {
      if (mtparams) for (var i = 0; i < mtparams.length; i++) if (mtparams[i].name === name) return mtparams[i].type;
      for (var c = sym; c; c = c.outer) {
        for (var j = 0; j < c.tparams.length; j++) if (c.tparams[j].name === name) return c.tparams[j].type;
        if (c.members[name]) return c.members[name];
        if (c.name === name) return c;
      }
      return null;
    };
  }
  function resolveLibTypeAst(ast, scope, ctxName) {
    if (ast.k === "PrimType") return T[ast.name];
    if (ast.k === "ArrayType") return new ArrayType(resolveLibTypeAst(ast.elem, scope, ctxName));
    if (ast.k === "ClassType") {
      var first = ast.parts[0].name, cur = null, i = 0;
      var sc = scope(first);
      if (sc && sc.k === "tvar") return sc;
      if (sc) { cur = sc; i = 1; }
      else {
        // nome qualificado completo?
        var acc = "";
        for (var j = 0; j < ast.parts.length; j++) {
          acc += (j ? "." : "") + ast.parts[j].name;
          if (LIB[acc]) { cur = LIB[acc]; i = j + 1; }
        }
        if (!cur) {
          var cands = LIB_SIMPLE[first] || [];
          cur = cands.filter(function (c) { return !c.outer; })[0] || cands[0];
          i = 1;
        }
        if (!cur) throw new Error("tipo desconhecido na assinatura de " + ctxName + ": " + first);
      }
      for (; i < ast.parts.length; i++) {
        var nx = cur.members[ast.parts[i].name];
        if (!nx) throw new Error("tipo desconhecido: " + ast.parts[i].name + " em " + ctxName);
        cur = nx;
      }
      var last = ast.parts[ast.parts.length - 1];
      if (last.args && !last.args.diamond) {
        return new ClassType(cur, last.args.list.map(function (a) {
          if (a.k === "Wildcard") return new WildType(a.kind, a.bound ? resolveLibTypeAst(a.bound, scope, ctxName) : null);
          return resolveLibTypeAst(a, scope, ctxName);
        }));
      }
      return cur.rawType();
    }
    throw new Error("tipo inválido em " + ctxName);
  }
  function libTypeFromText(txt, sym, mtparams) {
    var p = parseTypeText(txt);
    var ast = p.type();
    return resolveLibTypeAst(ast, libScope(sym, mtparams), sym.full);
  }
  function libHeader(sym) {
    var spec = sym.lib.spec;
    var sc = libScope(sym, null);
    if (spec.tp) {
      splitTop(spec.tp).forEach(function (s, i) {
        var m = /extends\s+(.*)$/.exec(s.trim());
        if (m) splitBounds(m[1]).forEach(function (b) { sym.tparams[i].bounds.push(libTypeFromText(b, sym)); });
      });
    }
    if (spec.ext) sym.superT = libTypeFromText(spec.ext, sym);
    else if (sym.full !== "java.lang.Object" && sym.kind !== "interface") {
      if (sym.kind === "enum") sym.superT = new ClassType(L("java.lang.Enum"), [sym.rawType()]);
      else if (sym.kind === "record") sym.superT = L("java.lang.Record").rawType();
      else sym.superT = OBJ();
    }
    sym.ifaces = (spec.impl || []).map(function (s) { return libTypeFromText(s, sym); });
    void sc;
  }
  function splitBounds(s) {
    var r = [], d = 0, cur = "";
    for (var i = 0; i < s.length; i++) { var c = s[i]; if (c === "<") d++; else if (c === ">") d--; if (c === "&" && d === 0) { r.push(cur.trim()); cur = ""; continue; } cur += c; }
    r.push(cur.trim());
    return r;
  }
  // lê "static <T> List<T> of(T...) throws X"
  function parseLibSig(sig, sym) {
    var f = new SourceFile("<lib>", sig);
    var errs = [];
    var p = new Parser(f, errs);
    var flags = {};
    while (p.t.k === "kw" && MODS[p.t.v]) { flags[p.t.v] = true; p.next(); }
    var mtp = [];
    var isCtor = p.is("<") && p.isWord("init", 1) && p.is(">", 2);
    if (!isCtor && p.is("<")) {
      // <T extends X, R>
      var a0 = p.t.pos, depth = 0, b0;
      while (true) {
        if (p.is("<")) depth++;
        else if (p.is(">")) depth--;
        else if (p.is(">>")) depth -= 2;
        else if (p.is(">>>")) depth -= 3;
        if (depth <= 0) { b0 = p.t.end; p.next(); break; }
        p.next();
      }
      var txt = sig.slice(a0 + 1, b0 - 1);
      splitTop(txt).forEach(function (s) { mtp.push(new TVarSym(s.trim().split(/\s+/)[0], null)); });
      splitTop(txt).forEach(function (s, i) {
        var m = /extends\s+(.*)$/.exec(s.trim());
        if (m) splitBounds(m[1]).forEach(function (b) { mtp[i].bounds.push(libTypeFromText(b, sym, mtp)); });
      });
      isCtor = p.is("<") && p.isWord("init", 1) && p.is(">", 2);
    }
    var ret = null, name;
    if (isCtor) {
      name = "<init>";
      p.next(); p.next(); p.next();
    } else {
      var rt = p.type();
      ret = resolveLibTypeAst(rt, libScope(sym, mtp), sym.full + "." + sig);
      name = p.ident().v;
    }
    if (!p.is("(")) {
      // campo
      return { field: true, name: name, type: ret, flags: flags };
    }
    p.next();
    var params = [], varargs = false;
    while (!p.is(")")) {
      var pt = p.type();
      var t = resolveLibTypeAst(pt, libScope(sym, mtp), sym.full + "." + sig);
      if (p.is("...")) { p.next(); t = new ArrayType(t); varargs = true; }
      if (p.isId()) p.next(); // nome opcional do parâmetro
      params.push(t);
      if (p.is(",")) p.next();
    }
    p.next();
    var throws = [];
    if (p.is("throws")) {
      p.next();
      do { throws.push(resolveLibTypeAst(p.type(), libScope(sym, mtp), sym.full)); } while (p.is(",") && p.next());
    }
    return { field: false, name: name, ret: ret, params: params, varargs: varargs, tparams: mtp, flags: flags, throws: throws };
  }
  function libMembers(sym) {
    var spec = sym.lib.spec;
    var ms = spec.m || {};
    Object.keys(ms).forEach(function (key) {
      key.split(" | ").forEach(function (sig) {
        var d;
        try { d = parseLibSig(sig.trim(), sym); }
        catch (e) {
          if (e && e.message && /tipo desconhecido/.test(e.message)) { if (JavaSim.debugLib) console.error("(lib) " + sym.full + ": " + sig + " — " + e.message); return; }
          throw new Error("assinatura inválida em " + sym.full + ": " + sig + " — " + (e.message || (e instanceof ParseAbort ? "erro de sintaxe" : e)));
        }
        var impl = ms[key];
        if (d.field) {
          var fs = new FieldSym(d.name, sym, d.type, d.flags);
          fs.flags["public"] = true;
          if (impl && typeof impl === "object" && has(impl, "c")) fs.constVal = impl.c;
          else fs.get = impl;
          fs.isLib = true;
          sym.fields[d.name] = fs; sym.fieldList.push(fs);
          return;
        }
        var m = new MethodSym(d.name, sym);
        m.params = d.params; m.varargs = d.varargs; m.tparams = d.tparams; m.flags = d.flags; m.throws = d.throws;
        m.tparams.forEach(function (tv) { tv.owner = m; });
        if (!m.flags["private"] && !m.flags["protected"]) m.flags["public"] = true;
        m.isLib = true;
        if (spec.deprecated && (spec.deprecated === true || spec.deprecated.indexOf(sig.trim()) >= 0)) m.deprecated = true;
        if (d.name === "<init>") { m.ret = T["void"]; m.impl = impl; m.key = methodKey("<init>", m.params); sym.ctors.push(m); return; }
        m.ret = d.ret;
        if (impl === null || impl === undefined) m.flags.abstract = true;
        else if (sym.isInterface() && !m.flags["static"]) m.flags["default"] = true;
        if (impl === "abstract") { m.flags.abstract = true; impl = null; m.flags["default"] = false; }
        m.impl = impl;
        m.key = methodKey(m.name, m.params);
        (sym.methods[m.name] = sym.methods[m.name] || []).push(m);
        sym.methodList.push(m);
      });
    });
    if (spec.after) spec.after(sym);
    if (spec.noCtor && sym.kind === "class" && !sym.ctors.length) {
      var pc = new MethodSym("<init>", sym); pc.ret = T["void"]; pc.flags["private"] = true; pc.key = "<init>()"; pc.isLib = true; pc.impl = function () {};
      sym.ctors.push(pc);
    }
    if (sym.kind !== "interface" && !sym.ctors.length && !spec.noCtor) {
      var c = new MethodSym("<init>", sym); c.ret = T["void"]; c.flags["public"] = true; c.key = "<init>()"; c.isLib = true; c.impl = function () {};
      sym.ctors.push(c);
    }
  }
  // exceções da biblioteca: construtores padrão
  function defExc(full, sup, opts) {
    opts = opts || {};
    var m = {
      "<init>()": function () { this.message = null; this.cause = null; this.suppressed = []; fillStack(this); },
      "<init>(String)": function (s) { this.message = s; this.cause = null; this.suppressed = []; fillStack(this); },
      "<init>(String,Throwable)": function (s, c) { this.message = s; this.cause = c; this.suppressed = []; fillStack(this); },
      "<init>(Throwable)": function (c) { this.message = c === null ? null : jstr(callToString(c)); this.cause = c; this.suppressed = []; fillStack(this); }
    };
    if (opts.m) Object.keys(opts.m).forEach(function (k) { m[k] = opts.m[k]; });
    if (opts.onlyMsg) { delete m["<init>(String,Throwable)"]; delete m["<init>(Throwable)"]; }
    return defLib(full, { ext: sup, m: m });
  }
  JavaSim.defLib = defLib;
  JavaSim.defExc = defExc;

  /* =====================================================================
     6. Verificação: entrar classes, cabeçalhos, membros
     ===================================================================== */
  function Scope(parent, owner) { this.parent = parent; this.vars = Object.create(null); this.classes = Object.create(null); this.owner = owner || (parent ? parent.owner : null); }
  Scope.prototype.lookupVar = function (name) {
    for (var s = this; s; s = s.parent) if (has(s.vars, name)) return s.vars[name];
    return null;
  };
  Scope.prototype.lookupClass = function (name) {
    for (var s = this; s; s = s.parent) if (has(s.classes, name)) return s.classes[name];
    return null;
  };

  // contexto de verificação
  function Env(o) {
    this.cls = null; this.method = null; this.isStatic = false; this.scope = null; this.lambda = null;
    this.ret = null; this.cu = null; this.file = null; this.outerEnv = null; this.ctor = false;
    this.inLoop = 0; this.inSwitch = 0; this.labels = []; this.yieldTarget = null; this.slotInfo = null;
    this.ctorPrologue = false; this.fieldInit = null;
    if (o) for (var k in o) this[k] = o[k];
  }
  Env.prototype.dup = function (o) { var e = new Env(this); if (o) for (var k in o) e[k] = o[k]; return e; };

  // numeração de variáveis locais como o javac (para as mensagens de NullPointerException)
  function SlotInfo(start) { this.next = start; this.max = start; }
  SlotInfo.prototype.alloc = function (t) {
    var s = this.next;
    this.next += (t.k === "prim" && (t.n === "long" || t.n === "double")) ? 2 : 1;
    if (this.next > this.max) this.max = this.next;
    return s;
  };

  function Program() {
    this.files = []; this.cus = []; this.classes = []; this.topClasses = []; this.errors = []; this.notes = {};
    this.byName = Object.create(null); this.anonCount = {}; this.localCount = {}; this.lambdaCount = {};
  }

  function Checker(prog) {
    this.prog = prog;
    this.errs = prog.errors;
    this.simplified = false;
  }
  var CK = Checker.prototype;
  CK.error = function (file, pos, msg) {
    // javac não repete o mesmo erro na mesma posição
    for (var i = 0; i < this.errs.length; i++) { var e = this.errs[i]; if (e.file === file && e.pos === pos && e.msg === msg) return; }
    this.errs.push(new CompileError(file, pos, msg));
  };
  CK.err = function (env, pos, msg) { this.error(env.file, pos, msg); };

  // ---------- fase 1: entrar as classes ----------
  CK.enterCU = function (cu) {
    var self = this, prog = this.prog;
    cu.importsSingle = {}; cu.importsStar = ["java.lang"]; cu.staticSingle = {}; cu.staticStar = [];
    if (cu.implicit) {
      // arquivo compacto: classe implícita com o nome do arquivo; importa o módulo java.base
      var nm = cu.file.name.replace(/\.java$/, "");
      var decl = { k: "Class", kind: "class", name: nm, namePos: 0, pos: 0, mods: { flags: { "final": 1 }, annos: [] }, tparams: [], ext: null, impl: [], permits: [], members: cu.members.concat(cu.types), enumConsts: [], file: cu.file, implicit: true };
      cu.types = [decl];
      LIB_DEFAULT_IMPORTS.forEach(function (p) { if (cu.importsStar.indexOf(p) < 0) cu.importsStar.push(p); });
      cu.implicitIO = true;
    }
    cu.types.forEach(function (d) { self.enterClass(d, null, cu); });
  };
  CK.enterClass = function (d, outer, cu, localScope) {
    var prog = this.prog;
    var sym = new ClassSym(d.name, d.name, d.kind);
    sym.decl = d; d.sym = sym; sym.cu = cu; sym.file = d.file;
    sym.pkg = cu.pkg || "";
    var fl = d.mods.flags;
    for (var f in fl) sym.flags[f] = true;
    if (d.kind === "interface" || d.kind === "annotation") sym.flags.abstract = true;
    if (d.kind === "enum" || d.kind === "record") { if (!d.enumConsts.some(function (e) { return e.body; })) sym.flags["final"] = true; }
    if (d.kind === "record") sym.flags["final"] = true;
    if (outer) {
      sym.outer = outer;
      if (outer.isInterface()) { sym.flags["static"] = true; sym.flags["public"] = true; }
      if (d.kind !== "class") sym.flags["static"] = true;
      sym.inner = !sym.flags["static"] && d.kind === "class";
    }
    if (localScope) {
      sym.local = true;
      // nome como o javac: classe envolvente + $ + primeiro número livre (+ nome, se local)
      var enc = outer.bin;
      prog.usedNames = prog.usedNames || {};
      var nome = d.anon ? "" : d.name;
      for (var ni = 1; ; ni++) { var cand = enc + "$" + ni + nome; if (!prog.usedNames[cand]) { prog.usedNames[cand] = true; sym.bin = cand; break; } }
      sym.full = sym.bin;
      if (d.anon) { sym.anon = true; sym.name = ""; }
      sym.inner = d.kind === "class" && !localScope.staticCtx;
      if (d.kind !== "class") sym.inner = false;
    } else if (outer) {
      sym.full = outer.full + "." + d.name;
      sym.bin = outer.bin + "$" + d.name;
      if (outer.members[d.name]) this.error(d.file, d.pos, "class " + outer.name + "." + d.name + " is already defined in " + outer.kindName() + " " + outer.name);
      else outer.members[d.name] = sym;
    } else {
      sym.full = (cu.pkg ? cu.pkg + "." : "") + d.name;
      sym.bin = sym.full;
      if (prog.byName[d.name]) this.error(d.file, d.pos, "duplicate class: " + d.name);
      else prog.byName[d.name] = sym;
      prog.topClasses.push(sym);
      if (sym.flags["public"] && cu.file.name !== d.name + ".java" && !d.implicit)
        this.error(d.file, d.pos, (d.kind === "interface" ? "interface " : d.kind === "enum" ? "enum " : d.kind === "record" ? "record " : "class ") + d.name + " is public, should be declared in a file named " + d.name + ".java");
    }
    prog.classes.push(sym);
    sym.tparams = d.tparams.map(function (tp) { var tv = new TVarSym(tp.name, sym); tv.decl = tp; return tv; });
    var self = this;
    d.members.forEach(function (m) { if (m.k === "Class") self.enterClass(m, sym, cu); });
    return sym;
  };

  // ---------- fase 2: cabeçalhos (supertipos) ----------
  CK.classEnv = function (sym) {
    if (sym.env) return sym.env;
    var outerEnv = sym.outer ? this.classEnv(sym.outer) : null;
    if (sym.localEnv) outerEnv = sym.localEnv;
    var env = new Env({ cls: sym, cu: sym.cu, file: sym.file, outerEnv: outerEnv, isStatic: false, scope: sym.localEnv ? sym.localEnv.scope : null });
    sym.env = env;
    return env;
  };
  CK.headerClass = function (sym) {
    if (sym.headerDone) return;
    sym.headerDone = true;
    var d = sym.decl, env = this.classEnv(sym), self = this;
    var tenv = env.dup({ typeOnly: true });
    sym.tparams.forEach(function (tv) {
      tv.bounds = (tv.decl.bounds || []).map(function (b) { return self.resolveType(b, tenv); });
    });
    if (d.kind === "enum") sym.superT = new ClassType(L("java.lang.Enum"), [sym.rawType()]);
    else if (d.kind === "record") sym.superT = L("java.lang.Record").rawType();
    else if (d.kind === "interface" || d.kind === "annotation") sym.superT = null;
    else if (d.ext) {
      var st = this.resolveType(d.ext, tenv);
      if (st.k === "class") {
        completeHeaderAny(this, st.sym);
        if (st.sym.isInterface()) { this.err(env, d.ext.pos, "no interface expected here"); st = OBJ(); }
        else if (st.sym.flags["final"]) { this.err(env, d.ext.pos, "cannot inherit from final " + st.sym.name); }
        else if (st.sym.isEnum()) { this.err(env, d.ext.pos, "classes cannot directly extend java.lang.Enum"); }
        if (st.k === "class" && isSubClass(st.sym, sym)) { this.err(env, d.pos, "cyclic inheritance involving " + sym.name); st = OBJ(); }
        sym.superT = st;
      } else sym.superT = OBJ();
    } else sym.superT = OBJ();
    if (sym.anon && sym.anonOf) {
      completeHeaderAny(this, sym.anonOf.sym);
      if (sym.anonOf.sym.isInterface()) { sym.superT = OBJ(); sym.ifaces = [sym.anonOf]; }
      else sym.superT = sym.anonOf;
    }
    var ifs = d.impl.map(function (it) {
      var t = self.resolveType(it, tenv);
      if (t.k === "class") {
        completeHeaderAny(self, t.sym);
        if (!t.sym.isInterface()) { self.err(env, it.pos, "interface expected here"); return null; }
      }
      return t.k === "class" ? t : null;
    }).filter(Boolean);
    if (!sym.anon || !sym.ifaces.length) sym.ifaces = ifs;
    if (d.permits && d.permits.length) {
      sym.permits = d.permits.map(function (p) { var t = self.resolveType(p, tenv); return t.k === "class" ? t.sym : null; }).filter(Boolean);
    }
  };
  function completeHeaderAny(ck, sym) { if (sym.decl && !sym.isLib) ck.headerClass(sym); else completeHeader(sym); }

  // ---------- fase 3: membros ----------
  CK.membersClass = function (sym) {
    if (sym.membersDone) return;
    sym.membersDone = true;
    sym.completed = true;
    var d = sym.decl, env = this.classEnv(sym), self = this;
    var isIface = sym.isInterface();
    // records: componentes
    if (d.kind === "record") {
      sym.recComps = [];
      d.recComps.forEach(function (rc) {
        var t = self.resolveType(rc.type, env);
        var f = new FieldSym(rc.name, sym, t, { "private": true, "final": true });
        f.decl = rc; f.pos = rc.pos;
        f.key = "f_" + rc.name + "_" + sym.id;
        sym.fields[rc.name] = f; sym.fieldList.push(f);
        sym.recComps.push({ name: rc.name, type: t, field: f, varargs: rc.varargs });
      });
    }
    // enums: constantes
    if (d.kind === "enum") {
      d.enumConsts.forEach(function (ec, idx) {
        var f = new FieldSym(ec.name, sym, sym.rawType(), { "public": true, "static": true, "final": true, enumConst: true });
        f.decl = ec; f.pos = ec.pos; f.ordinal = idx; f.key = "e_" + ec.name;
        if (sym.fields[ec.name]) self.err(env, ec.pos, "variable " + ec.name + " is already defined in enum " + sym.name);
        sym.fields[ec.name] = f; sym.fieldList.push(f);
      });
    }
    d.members.forEach(function (m) {
      if (m.k === "Field") {
        var t = self.resolveType(m.type, env.dup({ isStatic: !!m.mods.flags["static"] || isIface }));
        var flags = {};
        for (var fl in m.mods.flags) flags[fl] = true;
        if (isIface) { flags["public"] = flags["static"] = flags["final"] = true; }
        if (d.kind === "record" && !flags["static"]) self.err(env, m.pos, "field declaration must be static\n    (consider replacing field with record component)");
        var f = new FieldSym(m.name, sym, t, flags);
        f.decl = m; f.pos = m.pos; f.key = "f_" + m.name + "_" + sym.id;
        m.sym = f;
        if (has(sym.fields, m.name)) self.err(env, m.pos, "variable " + m.name + " is already defined in " + sym.kindName() + " " + sym.name);
        else { sym.fields[m.name] = f; sym.fieldList.push(f); }
      } else if (m.k === "Method") {
        self.enterMethod(m, sym, env);
      }
    });
    // construtor padrão
    if (!isIface && !sym.ctors.length) {
      var c = new MethodSym("<init>", sym);
      c.ret = T["void"];
      if (d.kind === "enum") c.flags["private"] = true;
      else if (sym.flags["public"]) c.flags["public"] = true;
      else if (sym.flags["protected"]) c.flags["protected"] = true;
      else if (sym.flags["private"]) c.flags["private"] = true;
      c.isDefault = true; c.key = "<init>()";
      if (d.kind === "record") {
        c.params = sym.recComps.map(function (rc) { return rc.type; });
        c.varargs = sym.recComps.length > 0 && sym.recComps[sym.recComps.length - 1].varargs;
        c.key = methodKey("<init>", c.params);
        c.canonical = true; c.isDefault = false; c.recordAuto = true;
        c.flags = { "public": true };
      }
      if (sym.anon) { c.anonCtor = true; }
      sym.ctors.push(c);
    }
    // records: acessores
    if (d.kind === "record") {
      sym.recComps.forEach(function (rc) {
        var ex = (sym.methods[rc.name] || []).filter(function (m) { return m.params.length === 0; })[0];
        if (ex) { rc.accessor = ex; return; }
        var a = new MethodSym(rc.name, sym);
        a.ret = rc.type; a.flags["public"] = true; a.recordAccessor = rc.field; a.key = methodKey(rc.name, []);
        (sym.methods[rc.name] = sym.methods[rc.name] || []).push(a); sym.methodList.push(a);
        rc.accessor = a;
      });
    }
    // enums: values() e valueOf()
    if (d.kind === "enum") {
      var vm = new MethodSym("values", sym); vm.ret = new ArrayType(sym.rawType()); vm.flags = { "public": true, "static": true }; vm.enumValues = true; vm.key = "values()";
      var vo = new MethodSym("valueOf", sym); vo.ret = sym.rawType(); vo.params = [L("java.lang.String").rawType()]; vo.flags = { "public": true, "static": true }; vo.enumValueOf = true; vo.key = "valueOf(java.lang.String)";
      [vm, vo].forEach(function (m) { (sym.methods[m.name] = sym.methods[m.name] || []).push(m); sym.methodList.push(m); });
    }
  };
  CK.enterMethod = function (m, sym, env) {
    var self = this, isIface = sym.isInterface();
    var ms = new MethodSym(m.isCtor ? "<init>" : m.name, sym);
    ms.decl = m; m.sym = ms; ms.pos = m.namePos;
    for (var fl in m.mods.flags) ms.flags[fl] = true;
    if (isIface) {
      if (!ms.flags["private"]) ms.flags["public"] = true;
      if (!m.body && !ms.flags["static"] && !ms.flags["private"]) ms.flags.abstract = true;
      if (m.body && !ms.flags["static"] && !ms.flags["private"] && !ms.flags["default"]) {
        this.err(env, m.namePos, "interface abstract methods cannot have body");
      }
    }
    ms.tparams = m.tparams.map(function (tp) { var tv = new TVarSym(tp.name, ms); tv.decl = tp; return tv; });
    var menv = env.dup({ method: ms, isStatic: !!ms.flags["static"] });
    ms.tparams.forEach(function (tv) { tv.bounds = (tv.decl.bounds || []).map(function (b) { return self.resolveType(b, menv); }); });
    if (m.compact) {
      ms.params = sym.recComps ? sym.recComps.map(function (rc) { return rc.type; }) : [];
      ms.compact = true;
    } else {
      ms.params = m.params.map(function (p) { return self.resolveType(p.type, menv); });
      ms.varargs = m.params.length > 0 && m.params[m.params.length - 1].varargs;
    }
    ms.ret = m.isCtor ? T["void"] : this.resolveType(m.ret, menv);
    if (ms.varargs) {
      var vp = ms.params[ms.params.length - 1];
      if (vp && vp.k === "array" && !isReifiable(vp.elem) && !m.mods.annos.some(function (a) { return /SafeVarargs$/.test(a.name); })) this.unchecked();
    }
    ms.throws = m.throws.map(function (t) { return self.resolveType(t, menv); });
    ms.key = methodKey(ms.name, ms.params);
    if (m.isCtor) {
      if (sym.isInterface()) { this.err(env, m.namePos, "<identifier> expected"); return; }
      var dupc = sym.ctors.filter(function (c) { return c.key === ms.key; })[0];
      if (dupc) this.err(env, m.namePos, "constructor " + sym.name + "(" + ms.params.map(typeStr).join(",") + ") is already defined in " + sym.kindName() + " " + sym.name);
      if (sym.kind === "record") {
        var canon = sym.recComps.length === ms.params.length && sym.recComps.every(function (rc, i) { return sameType(rc.type, ms.params[i]); });
        if (canon || m.compact) ms.canonical = true;
      }
      if (sym.isEnum() && (ms.flags["public"] || ms.flags["protected"])) this.err(env, m.mods.flags["public"] || m.mods.flags["protected"], "modifier " + (ms.flags["public"] ? "public" : "protected") + " not allowed here");
      if (sym.isEnum()) ms.flags["private"] = true;
      sym.ctors.push(ms);
      return;
    }
    if (!m.body && !ms.flags.abstract && !ms.flags["native"] && !isIface) this.err(env, m.namePos, "missing method body, or declare abstract");
    if (m.body && ms.flags.abstract && !isIface) this.err(env, m.namePos, "abstract methods cannot have a body");
    if (ms.flags.abstract && !sym.flags.abstract && !isIface && !(sym.isEnum())) {
      this.err(env, sym.decl.pos, sym.name + " is not abstract and does not override abstract method " + ms.name + "(" + ms.params.map(typeStr).join(",") + ") in " + sym.name);
    }
    var list = sym.methods[ms.name] || (sym.methods[ms.name] = []);
    var dup = list.filter(function (o) { return o.key === ms.key || sameErasedParams(o, ms); })[0];
    if (dup) {
      var where = sym.kindName() + " " + sym.name;
      this.err(env, m.namePos, "method " + ms.name + "(" + ms.params.map(typeStr).join(",") + ") is already defined in " + where);
      return;
    }
    list.push(ms); sym.methodList.push(ms);
  };
  function sameErasedParams(a, b) {
    if (a.params.length !== b.params.length) return false;
    for (var i = 0; i < a.params.length; i++) if (erasedName(a.params[i]) !== erasedName(b.params[i])) return false;
    return true;
  }

  // ---------- resolução de tipos ----------
  CK.resolveType = function (ast, env, opts) {
    if (!ast) return T_ERR;
    switch (ast.k) {
      case "PrimType": return T[ast.name];
      case "ArrayType": {
        var e = this.resolveType(ast.elem, env);
        if (e === T["void"]) { this.err(env, ast.elem.pos, "'void' type not allowed here"); return T_ERR; }
        return isErr(e) ? T_ERR : new ArrayType(e);
      }
      case "VarType": return T_ERR;
      case "ClassType": return this.resolveClassType(ast, env, opts);
    }
    return T_ERR;
  };
  CK.resolveClassType = function (ast, env, opts) {
    var parts = ast.parts, self = this;
    var first = parts[0];
    var cur = null, i = 1, outerType = null;
    var tv = this.findTypeVar(first.name, env);
    if (tv) {
      if (tv.owner instanceof ClassSym && env.isStatic && env.cls === tv.owner && !env.typeOnly) { this.err(env, first.pos, "non-static type variable " + tv.name + " cannot be referenced from a static context"); return T_ERR; }
      if (parts.length > 1) { this.err(env, parts[1].pos, "cannot select from a type variable"); return T_ERR; }
      if (first.args) { this.err(env, first.args.pos, "unexpected type"); }
      return tv.type;
    }
    cur = this.findType(first.name, env);
    if (!cur) {
      // talvez pacote: java.util.List
      var pk = first.name, j = 1, found = null;
      for (; j < parts.length; j++) {
        var cand = PKGS[pk] && PKGS[pk][parts[j].name];
        if (cand) { found = cand; break; }
        pk += "." + parts[j].name;
      }
      if (found && PKGS[pk]) { cur = found; i = j + 1; }
      else if (found) { cur = found; i = j + 1; }
      else {
        if (parts.length > 1 && isPackagePrefix(first.name)) {
          var pkn = first.name; var k2 = 1;
          while (k2 < parts.length - 1 && isPackagePrefix(pkn + "." + parts[k2].name)) { pkn += "." + parts[k2].name; k2++; }
          if (!PKGS[pkn]) { this.err(env, parts[k2 - 1 >= 1 ? k2 - 1 : 0].pos === first.pos ? first.pos : parts[k2].pos, "package " + pkn + " does not exist"); return T_ERR; }
          this.cannotFindClass(env, parts[k2].pos, parts[k2].name, "package " + pkn);
          return T_ERR;
        }
        if (parts.length > 1 && !isPackagePrefix(first.name)) {
          this.err(env, parts[1].pos, "package " + first.name + " does not exist");
          return T_ERR;
        }
        this.cannotFindClass(env, first.pos, first.name, null);
        return T_ERR;
      }
    }
    var argsFor = [];
    argsFor.push({ sym: cur, part: parts[i - 1] });
    for (; i < parts.length; i++) {
      completeAny(this, cur);
      var nx = this.findMemberType(cur, parts[i].name);
      if (!nx) { this.cannotFindClass(env, parts[i].pos, parts[i].name, (cur.isInterface() ? "interface " : "class ") + cur.name); return T_ERR; }
      cur = nx;
      argsFor.push({ sym: cur, part: parts[i] });
    }
    var last = parts[parts.length - 1];
    if (last.args) {
      if (last.args.diamond) {
        if (opts && opts.diamondOk) return { k: "diamond", sym: cur };
        this.err(env, last.args.pos, "illegal start of type");
        return T_ERR;
      }
      completeHeaderAny(this, cur);
      var args = last.args.list.map(function (a) {
        if (a.k === "Wildcard") return new WildType(a.kind, a.bound ? self.resolveType(a.bound, env) : null);
        var t = self.resolveType(a, env);
        if (t.k === "prim") { self.err(env, a.pos, "unexpected type\n  required: reference\n  found:    " + t.n); return T_ERR; }
        return t;
      });
      if (!cur.tparams.length) { this.err(env, last.args.pos, "type " + typeStr(cur.rawType()) + " does not take parameters"); return T_ERR; }
      if (args.length !== cur.tparams.length) { this.err(env, last.args.pos, "wrong number of type arguments; required " + cur.tparams.length); return T_ERR; }
      if (args.some(isErr)) return new ClassType(cur, args.map(function (a) { return isErr(a) ? OBJ() : a; }));
      // limites
      for (var q = 0; q < args.length; q++) {
        var a = args[q];
        if (a.k === "wild") continue;
        var bs = cur.tparams[q].bounds;
        var mm = substMap(cur.tparams, args);
        for (var b = 0; b < bs.length; b++) {
          if (!isSubtype(a, subst(bs[b], mm))) {
            this.err(env, last.args.list[q].pos, "type argument " + typeStr(a) + " is not within bounds of type-variable " + cur.tparams[q].name);
          }
        }
      }
      return new ClassType(cur, args);
    }
    return cur.rawType();
  };
  function isPackagePrefix(name) {
    for (var p in PKGS) if (p === name || p.indexOf(name + ".") === 0) return true;
    return false;
  }
  CK.cannotFindClass = function (env, pos, name, location) {
    var loc = location || this.locationOf(env);
    this.err(env, pos, "cannot find symbol\n  symbol:   class " + name + "\n  location: " + loc);
  };
  CK.locationOf = function (env) {
    var c = env.cls;
    if (!c) return "class ?";
    if (c.anon) return "class " + typeStr(c.thisType());
    return c.kindName() + " " + typeStr(c.thisType());
  };
  CK.findTypeVar = function (name, env) {
    for (var e = env; e; e = e.outerEnv) {
      for (var m = e.method; m; m = null) for (var i = 0; i < m.tparams.length; i++) if (m.tparams[i].name === name) return m.tparams[i];
      if (e.lambdaMethods) for (var q = 0; q < e.lambdaMethods.length; q++) { /* nada */ }
      if (e.cls) for (var j = 0; j < e.cls.tparams.length; j++) if (e.cls.tparams[j].name === name) return e.cls.tparams[j];
    }
    return null;
  };
  // procura um tipo pelo nome simples
  CK.findType = function (name, env) {
    // classes locais
    for (var e = env; e; e = e.outerEnv) {
      if (e.scope) { var lc = e.scope.lookupClass(name); if (lc) return lc; }
      if (e.cls) {
        if (e.cls.name === name && !e.cls.anon) return e.cls;
        var mt = this.findMemberType(e.cls, name);
        if (mt) return mt;
      }
    }
    var cu = env.cu;
    // classes do programa (pacote padrão)
    if (has(this.prog.byName, name)) return this.prog.byName[name];
    if (cu) {
      if (has(cu.importsSingle, name)) return cu.importsSingle[name];
      for (var i = 0; i < cu.importsStar.length; i++) {
        var p = PKGS[cu.importsStar[i]];
        if (p && has(p, name)) return p[name];
        var sc = LIB[cu.importsStar[i]];
        if (sc) { completeAny(this, sc); if (sc.members[name]) return sc.members[name]; }
      }
    }
    return null;
  };
  CK.findMemberType = function (sym, name) {
    var seen = {};
    var self = this;
    function walk(s) {
      if (!s || seen[s.id]) return null;
      seen[s.id] = 1;
      if (s.decl && !s.isLib) { /* membros já entrados */ } else complete(s);
      if (has(s.members, name)) return s.members[name];
      completeHeaderAny(self, s);
      if (s.superT && s.superT.k === "class") { var r = walk(s.superT.sym); if (r) return r; }
      for (var i = 0; i < s.ifaces.length; i++) { var r2 = walk(s.ifaces[i].sym); if (r2) return r2; }
      return null;
    }
    return walk(sym);
  };
  function completeAny(ck, sym) {
    if (sym.decl && !sym.isLib) { ck.headerClass(sym); ck.membersClass(sym); }
    else complete(sym);
  }

  /* =====================================================================
     7. Atribuição de tipos às expressões (Attr)
     ===================================================================== */
  // conversões
  function strictConv(s, t) {
    if (isErr(s) || isErr(t)) return true;
    if (s.k === "prim" && t.k === "prim") return s.n === t.n || primWidens(s, t);
    if (s.k === "prim" || t.k === "prim") return false;
    return isSubtype(s, t);
  }
  function looseConv(s, t) {
    if (strictConv(s, t)) return true;
    if (s.k === "prim" && s.n !== "void" && isRef(t)) return isSubtype(boxedType(s), t);
    if (isRef(s) && t.k === "prim") { var u = unboxedType(s); return !!u && (u.n === t.n || primWidens(u, t)); }
    return false;
  }
  function fitsConst(v, n) {
    if (typeof v !== "number") return false;
    if (n === "byte") return v >= -128 && v <= 127;
    if (n === "short") return v >= -32768 && v <= 32767;
    if (n === "char") return v >= 0 && v <= 65535;
    return false;
  }
  function assignConv(s, t, cv) {
    if (looseConv(s, t)) return true;
    if (cv !== undefined && s.k === "prim" && /^(int|short|char|byte)$/.test(s.n)) {
      if (t.k === "prim" && /^(byte|short|char)$/.test(t.n)) return fitsConst(cv, t.n);
      var u = t.k === "class" && UNBOX[t.sym.full];
      if (u && /^(byte|short|char)$/.test(u) && u !== s.n) return fitsConst(cv, u);
    }
    return false;
  }
  function isLossy(s, t) {
    var su = s.k === "prim" ? s : unboxedType(s);
    var tu = t.k === "prim" ? t : null;
    if (!su || !tu || su.n === "boolean" || tu.n === "boolean" || su.n === "void") return false;
    return !(su.n === tu.n || primWidens(su, tu));
  }

  CK.attribExpr = function (e, env, pt) {
    var t;
    try { t = this.attribExpr0(e, env, pt); }
    catch (ex) { if (ex === DEFER_FAIL) t = T_ERR; else throw ex; }
    if (!t) t = T_ERR;
    e.type = t;
    return t;
  };
  var DEFER_FAIL = {};
  // verifica que a expressão "e" (tipo s) pode ser atribuída ao tipo t; mensagens do javac
  CK.checkAssign = function (e, s, t, env, ctx) {
    if (isErr(s) || isErr(t)) return true;
    if (s === T["void"]) {
      this.err(env, e.pos, "incompatible types: void cannot be converted to " + typeStr(t));
      return false;
    }
    var cv = e.cv;
    if (ctx === "invoke" ? looseConv(s, t) : assignConv(s, t, cv)) {
      if (s.k === "class" && t.k === "class" && !s.args && t.args && s.sym.tparams.length && !isRawOk(s, t)) this.unchecked();
      return true;
    }
    if (isLossy(s, t) && (s.k === "prim" || t.k === "prim")) this.err(env, e.pos, "incompatible types: possible lossy conversion from " + typeStr(s.k === "prim" ? s : unboxedType(s)) + " to " + typeStr(t));
    else this.err(env, e.pos, "incompatible types: " + typeStr(s) + " cannot be converted to " + typeStr(t) + this.whereFor([s, t]));
    return false;
  };
  function isRawOk(s, t) { return false; }
  CK.unchecked = function () { this.prog.notes.unchecked = true; };
  CK.warn = function (env, pos, msg) { (this.prog.warnings = this.prog.warnings || []).push(new CompileError(env.file, pos, msg, "warning")); };

  // texto "where T is a type-variable:" (como o javac)
  CK.whereFor = function (types) {
    var tvs = [];
    function collect(t) {
      if (!t) return;
      if (t.k === "tvar") { if (tvs.indexOf(t.sym) < 0) tvs.push(t.sym); t.sym.bounds.forEach(function (b) { /* limites não entram */ }); return; }
      if (t.k === "array") return collect(t.elem);
      if (t.k === "wild") return collect(t.bound);
      if (t.k === "class" && t.args) t.args.forEach(collect);
    }
    types.forEach(collect);
    if (!tvs.length) return "";
    var r = "\n  where " + tvs.map(function (v) { return v.name; }).join(",") + (tvs.length > 1 ? " are type-variables:" : " is a type-variable:");
    tvs.forEach(function (v) {
      var b = v.bounds.length ? v.bounds.map(typeStr).join(",") : "Object";
      var decl;
      if (v.owner instanceof MethodSym) {
        var m = v.owner;
        decl = (m.name === "<init>" ? "constructor " : "method ") + "<" + m.tparams.map(function (x) { return x.name; }).join(",") + ">" + (m.name === "<init>" ? m.owner.name : m.name) + "(" + paramsStr(m) + ")";
      } else decl = (v.owner ? v.owner.kindName() + " " + v.owner.name : "class ?");
      r += "\n    " + v.name + " extends " + b + " declared in " + decl;
    });
    return r;
  };

  CK.attribExpr0 = function (e, env, pt) {
    var self = this, t;
    switch (e.k) {
      case "Literal": {
        switch (e.type) {
          case "int": e.cv = e.value; return T["int"];
          case "long": e.cv = e.value; return T["long"];
          case "float": e.cv = e.value; return T["float"];
          case "double": e.cv = e.value; return T["double"];
          case "char": e.cv = e.value; return T["char"];
          case "boolean": e.cv = e.value; return T["boolean"];
          case "String": e.cv = e.value; return L("java.lang.String").rawType();
          case "null": return T_NULL;
        }
        return T_ERR;
      }
      case "Paren": {
        t = this.attribExpr(e.expr, env, pt);
        e.cv = e.expr.cv;
        e.bindsTrue = e.expr.bindsTrue; e.bindsFalse = e.expr.bindsFalse;
        return t;
      }
      case "Ident": return this.attribIdent(e, env);
      case "Select": return this.attribSelect(e, env);
      case "This": return this.attribThis(e, env);
      case "Call": return this.attribCall(e, env, pt);
      case "New": return this.attribNew(e, env, pt);
      case "NewArray": return this.attribNewArray(e, env);
      case "ArrayInit": {
        if (!pt || pt.k !== "array") {
          if (pt && !isErr(pt)) this.err(env, e.pos, "illegal initializer for " + typeStr(pt));
          else if (!pt) this.err(env, e.pos, "array initializer is not allowed here");
          e.elems.forEach(function (x) { self.attribExpr(x, env, null); });
          return pt || T_ERR;
        }
        e.elems.forEach(function (x) {
          var et = self.attribExpr(x, env, pt.elem);
          if (x.k !== "ArrayInit") self.checkAssign(x, et, pt.elem, env);
        });
        return pt;
      }
      case "Index": {
        var at = this.attribExpr(e.arr, env, null);
        var it = this.attribExpr(e.index, env, null);
        this.checkIndex(e.index, it, env);
        if (isErr(at)) return T_ERR;
        if (at.k !== "array") { this.err(env, e.pos, "array required, but " + typeStr(at) + " found"); return T_ERR; }
        return capUpper(at.elem);
      }
      case "Unary": return this.attribUnary(e, env);
      case "Binary": return this.attribBinary(e, env);
      case "Assign": return this.attribAssign(e, env);
      case "CompoundAssign": return this.attribCompound(e, env);
      case "Cond": return this.attribCond(e, env, pt);
      case "Cast": return this.attribCast(e, env);
      case "InstanceOf": return this.attribInstanceOf(e, env);
      case "Lambda": return this.attribLambda(e, env, pt);
      case "MethodRef": return this.attribMethodRef(e, env, pt);
      case "SwitchExpr": return this.attribSwitch(e, env, pt, true);
      case "ClassLit": {
        var ct = this.resolveType(e.type, env);
        if (isErr(ct)) return T_ERR;
        e.litType = ct;
        var arg = ct.k === "prim" ? (ct.n === "void" ? L("java.lang.Void").rawType() : boxedType(ct)) : erasure(ct);
        return new ClassType(L("java.lang.Class"), [arg]);
      }
      case "CtorCall": return this.attribCtorCall(e, env);
      case "TypeExpr": this.err(env, e.pos, "illegal start of expression"); return T_ERR;
      case "Super": this.err(env, e.pos, "'.' expected"); return T_ERR;
    }
    throw new Error("attribExpr: " + e.k);
  };
  function capUpper(t) {
    // captura simplificada: ? extends X → X ; ? super X / ? → Object
    if (t && t.k === "wild") return t.kind === "extends" ? t.bound : OBJ();
    return t;
  }
  CK.checkIndex = function (ie, it, env) {
    if (isErr(it)) return;
    var u = it.k === "prim" ? it : unboxedType(it);
    if (!u || !isIntegralPrim(u) || u.n === "long") {
      if (u && u.n === "long") this.err(env, ie.pos, "incompatible types: possible lossy conversion from long to int");
      else this.err(env, ie.pos, "incompatible types: " + typeStr(it) + " cannot be converted to int");
    }
  };

  // ---------- nomes ----------
  // procura uma variável (local ou campo) pelo nome; devolve {kind, sym, depth, env}
  CK.findVar = function (name, env) {
    var depth = 0, crossed = [];
    for (var e = env; e; e = e.outerEnv) {
      for (var s = e.scope; s && s !== e.clsBaseScope; s = s.parent) {
        if (has(s.vars, name)) return { kind: "local", sym: s.vars[name], crossed: crossed, env: e };
      }
      if (e.cls) {
        var f = this.findField(e.cls, name);
        if (f) return { kind: "field", sym: f.sym, site: f.site, depth: depth, cls: e.cls, env: e };
        if (e.cls.local || e.cls.anon) crossed.push(e.cls);
      }
      depth++;
    }
    var cu = env.cu;
    if (cu) {
      if (has(cu.staticSingle, name)) {
        var ss = cu.staticSingle[name];
        for (var i = 0; i < ss.length; i++) { completeAny(this, ss[i]); var fs = this.findField(ss[i], name); if (fs && fs.sym.flags["static"]) return { kind: "field", sym: fs.sym, site: fs.site, imported: true }; }
      }
      for (var j = 0; j < cu.staticStar.length; j++) {
        completeAny(this, cu.staticStar[j]);
        var fs2 = this.findField(cu.staticStar[j], name);
        if (fs2 && fs2.sym.flags["static"]) return { kind: "field", sym: fs2.sym, site: fs2.site, imported: true };
      }
    }
    return null;
  };
  // campo em uma classe ou supertipos: {sym, site}
  CK.findField = function (sym, name, siteType) {
    var self = this, seen = {};
    function walk(t) {
      var s = t.sym;
      if (seen[s.id]) return null;
      seen[s.id] = 1;
      completeAny(self, s);
      if (has(s.fields, name)) return { sym: s.fields[name], site: t };
      var sups = supertypesOf(t);
      // interfaces antes da superclasse (como o javac), mas tanto faz na prática
      for (var i = 0; i < sups.length; i++) { if (sups[i].k !== "class") continue; var r = walk(sups[i]); if (r) return r; }
      return null;
    }
    return walk(siteType || sym.thisType());
  };
  // tipo de um membro visto a partir do "site"
  function memberType(t, site, owner) {
    if (!site || site.k !== "class") return t;
    var sup = asSuper(site, owner);
    if (!sup) return t;
    if (!owner.tparams.length) return t;
    if (!sup.args) return erasure(t);
    var m = substMap(owner.tparams, sup.args.map(capUpperArg));
    return subst(t, m);
  }
  function capUpperArg(a) { return a.k === "wild" ? (a.kind === "extends" ? a.bound : a.kind === "super" ? a.bound : OBJ()) : a; }

  CK.frameOf = function (env) { return env.frame || null; };
  CK.recordCapture = function (v, e, env) {
    if (v.frame === env.frame || !env.frame) return;
    var kind = env.frame.kind === "lambda" ? "lambda" : "inner";
    for (var f = env.frame; f && f !== v.frame; f = f.parentFrame) {
      if (f.kind === "lambda" && f.captures.indexOf(v) < 0) f.captures.push(v);
    }
    (this.prog.captureRefs = this.prog.captureRefs || []).push({ v: v, pos: e.pos, file: env.file, kind: kind });
  };
  CK.attribIdent = function (e, env) {
    var r = this.identTree(e, env, false);
    if (r.kind === "expr") return r.type;
    if (r.kind === "class" || r.kind === "tvar") {
      this.err(env, e.pos, "cannot find symbol\n  symbol:   variable " + e.name + "\n  location: " + this.locationOf(env) + this.whereFor([env.cls ? env.cls.thisType() : null]));
    }
    return T_ERR;
  };
  // nome simples que pode ser variável, tipo ou (se allowPkg) pacote
  CK.identTree = function (e, env, allowPkg) {
    var name = e.name;
    var r = this.findVar(name, env);
    if (r) {
      if (r.kind === "local") {
        e.ref = { kind: "local", sym: r.sym };
        this.recordCapture(r.sym, e, env);
        r.crossed.forEach(function (c) { c.captures = c.captures || []; if (c.captures.indexOf(r.sym) < 0) c.captures.push(r.sym); });
        if (r.sym.constVal !== undefined) e.cv = r.sym.constVal;
        e.type = r.sym.type;
        return { kind: "expr", type: r.sym.type };
      }
      var f = r.sym;
      e.ref = { kind: f.flags["static"] ? "sfield" : "field", sym: f, depth: r.depth || 0, cls: r.cls, implicitThis: true };
      if (!f.flags["static"]) {
        if (this.isStaticAt(env, r)) { this.err(env, e.pos, "non-static variable " + name + " cannot be referenced from a static context"); return { kind: "expr", type: T_ERR }; }
        if (env.ctorPrologue && (r.depth || 0) === 0 && !env.prologueAssign) {
          this.err(env, e.pos, "cannot reference " + name + " before supertype constructor has been called");
        }
      }
      this.checkAccess(f, e.pos, env, name);
      this.constOf(f, env);
      if (f.constVal !== undefined) e.cv = f.constVal;
      this.checkForwardRef(e, f, env);
      var ft = memberType(f.type, r.site, f.owner);
      e.type = ft;
      return { kind: "expr", type: ft };
    }
    var ty = this.findType(name, env);
    if (ty) { e.ref = { kind: "class", sym: ty }; return { kind: "class", sym: ty }; }
    var tv = this.findTypeVar(name, env);
    if (tv) return { kind: "tvar", sym: tv };
    if (allowPkg) { e.ref = { kind: "pkg", name: name }; return { kind: "pkg", name: name }; }
    this.err(env, e.pos, "cannot find symbol\n  symbol:   variable " + name + "\n  location: " + this.locationOf(env) + this.whereFor([env.cls ? env.cls.thisType() : null]));
    return { kind: "expr", type: T_ERR };
  };
  CK.checkForwardRef = function (e, f, env) {
    // "illegal forward reference" em inicializadores de campos
    if (!env.fieldInit || f.owner !== env.cls) return;
    if (!!f.flags["static"] !== !!env.fieldInit.isStatic) return;
    if (f.decl && f.decl.k === "Field" && env.fieldInitIndex !== undefined && f.declIndex !== undefined && f.declIndex >= env.fieldInitIndex && !env.inLambdaOrClass) {
      this.err(env, e.pos, (f.declIndex === env.fieldInitIndex ? "self-reference in initializer" : "illegal forward reference"));
    }
  };
  // estamos num contexto estático em relação ao campo/método encontrado?
  CK.isStaticAt = function (env, r) {
    var depth = r.depth || 0, e = env;
    for (var d = 0; d < depth && e; d++) {
      if (e.isStatic) return true;
      var c = e.cls;
      if (c && !c.inner) return true;
      e = e.outerEnv;
    }
    return e ? !!e.isStatic : true;
  };
  CK.checkAccess = function (sym, pos, env, name) {
    if (!sym.flags["private"]) return true;
    var owner = sym.owner;
    if (!owner.isLib && topLevel(owner) === topLevel(env.cls)) return true;
    var what = sym.kind === "method" ? (sym.name === "<init>" ? owner.name : sym.name) + "(" + sym.params.map(typeStr).join(",") + ")" : sym.name;
    this.err(env, pos, what + " has private access in " + owner.name);
    return false;
  };
  function topLevel(sym) { while (sym && sym.outer) sym = sym.outer; return sym; }
  // constante de compilação de um campo final (avalia o inicializador sob demanda)
  CK.constOf = function (f, env) {
    if (f.constVal !== undefined || f.constDone) return;
    f.constDone = true;
    if (!f.flags["final"] || !f.decl || f.decl.k !== "Field" || !f.decl.init) return;
    var t = f.type;
    if (!(t.k === "prim" || isString(t))) return;
    var cv = this.constFold(f.decl.init, f.owner);
    if (cv !== undefined) f.constVal = castConst(cv, t);
  };
  // avaliação de constantes direto na AST (para campos ainda não atribuídos)
  CK.constFold = function (e, cls) {
    var self = this;
    function ev(x) {
      switch (x.k) {
        case "Literal":
          if (x.type === "null") return undefined;
          return { v: x.value, t: x.type === "String" ? L("java.lang.String").rawType() : T[x.type] };
        case "Paren": return ev(x.expr);
        case "Ident": {
          var f = self.findField(cls, x.name);
          if (f && f.sym.flags["final"]) { self.constOf(f.sym); if (f.sym.constVal !== undefined) return { v: f.sym.constVal, t: f.sym.type }; }
          return undefined;
        }
        case "Select": {
          if (x.target.k !== "Ident") return undefined;
          var cs = self.findType(x.target.name, self.classEnv(cls));
          if (!cs) return undefined;
          completeAny(self, cs);
          var f2 = self.findField(cs, x.name);
          if (f2 && f2.sym.flags["final"] && f2.sym.flags["static"]) { self.constOf(f2.sym); if (f2.sym.constVal !== undefined) return { v: f2.sym.constVal, t: f2.sym.type }; }
          return undefined;
        }
        case "Unary": {
          if (/\+\+|--/.test(x.op)) return undefined;
          var o = ev(x.expr); if (!o) return undefined;
          var u = o.t.k === "prim" ? o.t : null; if (!u) return undefined;
          var rt = x.op === "!" ? T["boolean"] : unaryPromote(u);
          var r = foldUnary(x.op, castConst(o.v, rt), rt);
          return r === undefined ? undefined : { v: r, t: rt };
        }
        case "Binary": {
          var l = ev(x.l), rr = ev(x.r); if (!l || !rr) return undefined;
          var info = binaryResultType(x.op, l.t, rr.t);
          if (!info) return undefined;
          var r2 = foldBinary(x.op, l.v, rr.v, l.t, rr.t, info.opType, info.type);
          return r2 === undefined ? undefined : { v: r2, t: info.type };
        }
        case "Cast": {
          var o2 = ev(x.expr); if (!o2) return undefined;
          var ct = x.type.k === "PrimType" ? T[x.type.name] : (x.type.k === "ClassType" && x.type.name === "String" ? L("java.lang.String").rawType() : null);
          if (!ct) return undefined;
          return { v: castConst(o2.v, ct), t: ct };
        }
        case "Cond": {
          var c = ev(x.cond), a = ev(x.a), b = ev(x.b);
          if (!c || !a || !b) return undefined;
          return c.v ? a : b;
        }
      }
      return undefined;
    }
    var r = ev(e);
    return r ? r.v : undefined;
  };
  CK.attribThis = function (e, env) {
    if (e.qual) {
      var qt = this.resolveType(e.qual, env);
      if (isErr(qt)) return T_ERR;
      // Externa.this
      var depth = 0, found = false;
      for (var x = env; x; x = x.outerEnv) {
        if (x.cls === qt.sym) { found = true; break; }
        if (x.cls && (!x.outerEnv || x.outerEnv.cls !== x.cls)) depth++;
      }
      if (!found) { this.err(env, e.pos, "not an enclosing class: " + qt.sym.name); return T_ERR; }
      if (env.isStatic) { this.err(env, e.pos, "non-static variable this cannot be referenced from a static context"); return T_ERR; }
      e.depth = this.outerDepth(env, qt.sym);
      return qt.sym.thisType();
    }
    if (env.isStatic) { this.err(env, e.pos, "non-static variable this cannot be referenced from a static context"); return T_ERR; }
    if (env.ctorPrologue) { this.err(env, e.pos, "cannot reference this before supertype constructor has been called"); }
    e.depth = 0;
    return env.cls.thisType();
  };
  // quantos níveis de "this$0" até a classe alvo
  CK.outerDepth = function (env, target) {
    var d = 0, c = env.cls;
    while (c && c !== target && !isSubClass(c, target)) {
      c = this.enclosingInstanceClass(c);
      d++;
    }
    return d;
  };
  CK.enclosingInstanceClass = function (c) {
    if (c.local || c.anon) return c.localEnv && c.localEnv.cls;
    return c.outer;
  };

  // a.b como expressão
  CK.attribSelect = function (e, env) {
    var r = this.selectTree(e, env, false);
    if (r.kind === "expr") return r.type;
    if (r.kind === "class") {
      this.err(env, e.pos, "cannot find symbol\n  symbol:   variable " + e.name + "\n  location: " + this.locationOf(env));
    }
    return T_ERR;
  };
  // árvore qualificada: pacote, tipo ou expressão
  CK.qualTree = function (e, env, allowPkg) {
    if (e.k === "Ident") return this.identTree(e, env, allowPkg);
    if (e.k === "Select" && e.target.k !== "Super") return this.selectTree(e, env, allowPkg);
    return { kind: "expr", type: this.attribExpr(e, env, null) };
  };
  CK.selectTree = function (e, env, allowPkg) {
    var tgt = e.target, name = e.name, self = this;
    function expr(t) { e.type = t; return { kind: "expr", type: t }; }
    if (tgt.k === "Super") {
      if (env.isStatic) { this.err(env, tgt.pos, "non-static variable super cannot be referenced from a static context"); return expr(T_ERR); }
      var st = env.cls.superT || OBJ();
      var fs = this.findField(st.sym, name, st);
      if (!fs) { this.err(env, e.pos, "cannot find symbol\n  symbol: variable " + name); return expr(T_ERR); }
      e.ref = { kind: fs.sym.flags["static"] ? "sfield" : "field", sym: fs.sym, viaSuper: true };
      return expr(memberType(fs.sym.type, st, fs.sym.owner));
    }
    var tt = this.qualTree(tgt, env, true);
    if (tt.kind === "pkg") {
      var full = tt.name + "." + name;
      var c = PKGS[tt.name] && PKGS[tt.name][name];
      if (c) { e.ref = { kind: "class", sym: c }; return { kind: "class", sym: c }; }
      if (PKGS[tt.name]) {
        if (allowPkg && isPackagePrefix(full)) { e.ref = { kind: "pkg", name: full }; return { kind: "pkg", name: full }; }
        this.err(env, e.pos, "cannot find symbol\n  symbol:   class " + name + "\n  location: package " + tt.name);
        return expr(T_ERR);
      }
      if (allowPkg) { e.ref = { kind: "pkg", name: full }; return { kind: "pkg", name: full }; }
      this.err(env, e.pos, "package " + tt.name + " does not exist");
      return expr(T_ERR);
    }
    if (tt.kind === "tvar") { this.err(env, e.pos, "cannot select from a type variable"); return expr(T_ERR); }
    if (tt.kind === "class") {
      var cs = tt.sym;
      completeAny(this, cs);
      var f = this.findField(cs, name);
      if (f) {
        if (!f.sym.flags["static"]) { this.err(env, e.pos, "non-static variable " + name + " cannot be referenced from a static context"); return expr(T_ERR); }
        this.checkAccess(f.sym, e.pos, env);
        e.ref = { kind: "sfield", sym: f.sym };
        this.constOf(f.sym, env);
        if (f.sym.constVal !== undefined) e.cv = f.sym.constVal;
        return expr(f.sym.type);
      }
      var mt = this.findMemberType(cs, name);
      if (mt) { e.ref = { kind: "class", sym: mt }; return { kind: "class", sym: mt }; }
      if (name === "length" && false) return expr(T_ERR);
      this.err(env, e.pos, "cannot find symbol\n  symbol:   variable " + name + "\n  location: " + cs.kindName() + " " + typeStr(cs.thisType()) + this.whereFor([cs.thisType()]));
      return expr(T_ERR);
    }
    var t = tt.type;
    if (isErr(t)) return expr(T_ERR);
    if (t.k === "prim") { this.err(env, e.pos, t.n + " cannot be dereferenced"); return expr(T_ERR); }
    if (t.k === "null") { this.err(env, e.pos, "<null> cannot be dereferenced"); return expr(T_ERR); }
    if (t.k === "array") {
      if (name === "length") { e.ref = { kind: "length" }; return expr(T["int"]); }
      this.err(env, e.pos, "cannot find symbol\n  symbol:   variable " + name + "\n  location: " + this.exprLocation(tgt, t));
      return expr(T_ERR);
    }
    var ff = null, tc = t.k === "wild" ? capUpper(t) : t;
    if (tc.k === "class") ff = this.findField(tc.sym, name, tc);
    else if (tc.k === "tvar") { var bs = tc.sym.bounds; for (var i = 0; i < bs.length && !ff; i++) if (bs[i].k === "class") ff = this.findField(bs[i].sym, name, bs[i]); }
    if (!ff) {
      this.err(env, e.pos, "cannot find symbol\n  symbol:   variable " + name + "\n  location: " + this.exprLocation(tgt, t));
      return expr(T_ERR);
    }
    this.checkAccess(ff.sym, e.pos, env);
    e.ref = { kind: ff.sym.flags["static"] ? "sfield" : "field", sym: ff.sym, onExpr: true };
    if (ff.sym.flags["static"]) { this.constOf(ff.sym, env); }
    return expr(memberType(ff.sym.type, tc.k === "class" ? tc : ff.site, ff.sym.owner));
  };
  // descrição "location:" para um alvo de expressão
  CK.exprLocation = function (tgt, t) {
    var base = tgt;
    while (base.k === "Paren") base = base.expr;
    if ((base.k === "Ident" || base.k === "Select") && base.ref && (base.ref.kind === "local" || base.ref.kind === "field" || base.ref.kind === "sfield"))
      return "variable " + (base.name) + " of type " + typeStr(t) + this.whereFor([t]);
    if (t.k === "class") return t.sym.kindName() + " " + typeStr(t) + this.whereFor([t]);
    if (t.k === "tvar") return "type-variable " + typeStr(t) + this.whereFor([t]);
    return "class " + typeStr(t);
  };


  // ---------- constantes ----------
  function castConst(v, t) {
    if (v === undefined) return undefined;
    if (t.k !== "prim") { if (isString(t)) return typeof v === "string" ? v : undefined; return undefined; }
    var n = typeof v === "bigint" ? v : v;
    switch (t.n) {
      case "boolean": return typeof v === "boolean" ? v : undefined;
      case "int": return typeof n === "bigint" ? Number(BigInt.asIntN(32, n)) : toInt32(n);
      case "short": return typeof n === "bigint" ? Number(BigInt.asIntN(16, n)) : ((toInt32(n) << 16) >> 16);
      case "byte": return typeof n === "bigint" ? Number(BigInt.asIntN(8, n)) : ((toInt32(n) << 24) >> 24);
      case "char": return typeof n === "bigint" ? Number(BigInt.asUintN(16, n)) : (toInt32(n) & 0xFFFF);
      case "long": return typeof n === "bigint" ? n : d2l(n);
      case "float": return Math.fround(typeof n === "bigint" ? Number(n) : n);
      case "double": return typeof n === "bigint" ? Number(n) : n;
    }
    return undefined;
  }
  // double → int com as regras do Java (NaN → 0, satura)
  function toInt32(x) {
    if (typeof x === "boolean") return x;
    if (x !== x) return 0;
    if (x >= 2147483647) return 2147483647;
    if (x <= -2147483648) return -2147483648;
    return x < 0 ? Math.ceil(x) | 0 : Math.floor(x) | 0;
  }
  function d2l(x) {
    if (x !== x) return 0n;
    if (x >= 9223372036854775807) return 9223372036854775807n;
    if (x <= -9223372036854775808) return -9223372036854775808n;
    return BigInt(Math.trunc(x));
  }
  function foldUnary(op, v, t) {
    switch (op) {
      case "+": return v;
      case "-": return t.n === "long" ? BigInt.asIntN(64, -v) : t.n === "int" ? (-v) | 0 : t.n === "float" ? Math.fround(-v) : -v;
      case "~": return t.n === "long" ? ~v : ~v;
      case "!": return !v;
    }
    return undefined;
  }
  // tipo resultante de um operador binário: {type, opType} ou null (erro)
  function binaryResultType(op, lt, rt) {
    var STR = L("java.lang.String").rawType();
    if (op === "+" && (isString(lt) || isString(rt))) {
      if (lt === T["void"] || rt === T["void"]) return null;
      return { type: STR, opType: STR, concat: true };
    }
    var lu = lt.k === "prim" ? lt : unboxedType(lt), ru = rt.k === "prim" ? rt : unboxedType(rt);
    switch (op) {
      case "+": case "-": case "*": case "/": case "%":
        if (lu && ru && isNumericPrim(lu) && isNumericPrim(ru)) { var pt = binaryPromote(lu, ru); return { type: pt, opType: pt }; }
        return null;
      case "<<": case ">>": case ">>>":
        if (lu && ru && isIntegralPrim(lu) && isIntegralPrim(ru)) { var p1 = unaryPromote(lu); return { type: p1, opType: p1, shiftType: unaryPromote(ru) }; }
        return null;
      case "<": case ">": case "<=": case ">=":
        if (lu && ru && isNumericPrim(lu) && isNumericPrim(ru)) return { type: T["boolean"], opType: binaryPromote(lu, ru) };
        return null;
      case "==": case "!=":
        if (lt.k === "prim" || rt.k === "prim") {
          if (lu && ru && isNumericPrim(lu) && isNumericPrim(ru)) return { type: T["boolean"], opType: binaryPromote(lu, ru) };
          if (lu && ru && lu.n === "boolean" && ru.n === "boolean") return { type: T["boolean"], opType: T["boolean"] };
          return null;
        }
        return { type: T["boolean"], opType: null, refCmp: true };
      case "&": case "|": case "^":
        if (lu && ru && lu.n === "boolean" && ru.n === "boolean") return { type: T["boolean"], opType: T["boolean"] };
        if (lu && ru && isIntegralPrim(lu) && isIntegralPrim(ru)) { var p2 = binaryPromote(lu, ru); return { type: p2, opType: p2 }; }
        return null;
      case "&&": case "||":
        if (lu && ru && lu.n === "boolean" && ru.n === "boolean") return { type: T["boolean"], opType: T["boolean"] };
        return null;
    }
    return null;
  }
  function foldBinary(op, a, b, lt, rt, ot, rest) {
    if (ot && isString(ot)) return constToString(a, lt) + constToString(b, rt);
    if (!ot) return undefined;
    a = castConst(a, ot); b = castConst(b, op === "<<" || op === ">>" || op === ">>>" ? (rt.k === "prim" ? unaryPromote(rt) : rt) : ot);
    if (a === undefined || b === undefined) return undefined;
    var n = ot.n;
    if (n === "boolean") {
      switch (op) { case "==": return a === b; case "!=": return a !== b; case "&": case "&&": return a && b; case "|": case "||": return a || b; case "^": return a !== b; }
      return undefined;
    }
    if (n === "long") {
      var bb = typeof b === "bigint" ? b : BigInt(b);
      switch (op) {
        case "+": return BigInt.asIntN(64, a + bb); case "-": return BigInt.asIntN(64, a - bb); case "*": return BigInt.asIntN(64, a * bb);
        case "/": if (bb === 0n) return undefined; return BigInt.asIntN(64, a / bb);
        case "%": if (bb === 0n) return undefined; return BigInt.asIntN(64, a % bb);
        case "<<": return BigInt.asIntN(64, a << (BigInt(b) & 63n)); case ">>": return BigInt.asIntN(64, a >> (BigInt(b) & 63n));
        case ">>>": return BigInt.asIntN(64, BigInt.asUintN(64, a) >> (BigInt(b) & 63n));
        case "&": return a & bb; case "|": return a | bb; case "^": return a ^ bb;
        case "<": return a < bb; case ">": return a > bb; case "<=": return a <= bb; case ">=": return a >= bb; case "==": return a === bb; case "!=": return a !== bb;
      }
      return undefined;
    }
    if (n === "int") {
      switch (op) {
        case "+": return (a + b) | 0; case "-": return (a - b) | 0; case "*": return Math.imul(a, b);
        case "/": if (b === 0) return undefined; return (a / b) | 0;
        case "%": if (b === 0) return undefined; return (a % b) | 0;
        case "<<": return a << (b & 31); case ">>": return a >> (b & 31); case ">>>": return (a >>> (b & 31)) | 0;
        case "&": return a & b; case "|": return a | b; case "^": return a ^ b;
        case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b; case "==": return a === b; case "!=": return a !== b;
      }
      return undefined;
    }
    // float/double
    var r;
    switch (op) {
      case "+": r = a + b; break; case "-": r = a - b; break; case "*": r = a * b; break; case "/": r = a / b; break;
      case "%": r = jfmod(a, b); break;
      case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b; case "==": return a === b; case "!=": return a !== b;
      default: return undefined;
    }
    return n === "float" ? Math.fround(r) : r;
  }
  function jfmod(a, b) { return a % b; }
  function constToString(v, t) {
    if (t.k === "prim") {
      switch (t.n) {
        case "char": return String.fromCharCode(v);
        case "double": return doubleToString(v);
        case "float": return floatToString(v);
        case "long": return v.toString();
        default: return String(v);
      }
    }
    return String(v);
  }

  // ---------- operadores ----------
  CK.attribUnary = function (e, env) {
    var op = e.op;
    if (op === "++" || op === "--" || op === "post++" || op === "post--") {
      var t = this.attribExpr(e.expr, env, null);
      if (isErr(t)) return T_ERR;
      var opName = op.replace("post", "");
      if (!this.isVariable(e.expr)) { this.err(env, e.expr.pos, "unexpected type\n  required: variable\n  found:    value"); return T_ERR; }
      var u = t.k === "prim" ? t : unboxedType(t);
      if (!u || !isNumericPrim(u)) { this.err(env, e.pos, "bad operand type " + typeStr(t) + " for unary operator '" + opName + "'"); return T_ERR; }
      this.checkAssignable(e.expr, env);
      return t;
    }
    if (e.negLiteral) { var lt0 = this.attribExpr(e.expr, env, null); e.cv = foldUnary("-", e.expr.cv, lt0); if (lt0.n === "int") e.cv = e.expr.cv === -2147483648 ? -2147483648 : (-e.expr.cv) | 0; else e.cv = BigInt.asIntN(64, -e.expr.cv); return lt0; }
    var ot = this.attribExpr(e.expr, env, null);
    if (isErr(ot)) return T_ERR;
    var uu = ot.k === "prim" ? ot : unboxedType(ot);
    var rt;
    if (op === "!") {
      if (!uu || uu.n !== "boolean") { this.err(env, e.pos, "bad operand type " + typeStr(ot) + " for unary operator '!'"); return T_ERR; }
      rt = T["boolean"];
      e.bindsTrue = e.expr.bindsFalse; e.bindsFalse = e.expr.bindsTrue;
    } else if (op === "~") {
      if (!uu || !isIntegralPrim(uu)) { this.err(env, e.pos, "bad operand type " + typeStr(ot) + " for unary operator '~'"); return T_ERR; }
      rt = unaryPromote(uu);
    } else {
      if (!uu || !isNumericPrim(uu)) { this.err(env, e.pos, "bad operand type " + typeStr(ot) + " for unary operator '" + op + "'"); return T_ERR; }
      rt = unaryPromote(uu);
    }
    if (e.expr.cv !== undefined) { var c = foldUnary(op, castConst(e.expr.cv, rt), rt); if (c !== undefined) e.cv = c; }
    e.opType = rt;
    return rt;
  };
  CK.isVariable = function (x) {
    while (x.k === "Paren") x = x.expr;
    if (x.k === "Ident") return x.ref && (x.ref.kind === "local" || x.ref.kind === "field" || x.ref.kind === "sfield");
    if (x.k === "Select") return x.ref && (x.ref.kind === "field" || x.ref.kind === "sfield");
    if (x.k === "Index") return true;
    return false;
  };
  // verifica atribuição a variável final
  CK.checkAssignable = function (x, env) {
    while (x.k === "Paren") x = x.expr;
    if (x.k === "Index") return;
    var r = x.ref;
    if (!r) return;
    if (r.kind === "local") {
      var v = r.sym;
      v.assigns++;
      if (v.flags["final"] && (v.kind === "param" || (v.kind === "catch" && !v.multiCatch))) {
        (this.prog.finalParamAssigns = this.prog.finalParamAssigns || []).push({ v: v, pos: x.pos, file: env.file });
      } else if (v.flags["final"] && v.kind === "catch") {
        this.err(env, x.pos, "multi-catch parameter " + v.name + " may not be assigned");
      } else if (v.flags["final"] && (v.hasInit || v.kind === "foreach" || v.kind === "pattern" || v.kind === "resource")) {
        this.err(env, x.pos, "cannot assign a value to final variable " + v.name);
      }
      if (v.kind === "resource") this.err(env, x.pos, "auto-closeable resource " + v.name + " may not be assigned");
      if (env.frame && v.frame !== env.frame) { (this.prog.captureAssigns = this.prog.captureAssigns || []).push({ v: v, pos: x.pos, file: env.file, kind: env.frame.kind }); }
      return;
    }
    if (r.kind === "field" || r.kind === "sfield") {
      var f = r.sym;
      if (f.flags["final"]) {
        var ok = false;
        // campo final em branco pode ser atribuído no construtor/inicializador da própria classe
        if (!f.isLib && !(f.decl && f.decl.init) && f.owner === env.cls && !f.recordAuto && !f.flags.enumConst) {
          if (f.flags["static"] ? env.staticInit : (env.ctor || env.instanceInit) && (x.k === "Ident" || (x.k === "Select" && x.target.k === "This" && !x.target.qual))) ok = true;
        }
        if (f.owner.isRecord && f.owner.isRecord() && !f.flags["static"] && env.compactCtor) ok = false;
        if (!ok) {
          if (f.flags["static"]) this.err(env, x.pos, "cannot assign a value to static final variable " + f.name);
          else this.err(env, x.pos, "cannot assign a value to final variable " + f.name);
        }
      }
    }
  };
  CK.attribBinary = function (e, env) {
    var op = e.op, self = this;
    var lt, rt;
    if (op === "&&" || op === "||") {
      lt = this.attribExpr(e.l, env, null);
      // as variáveis de padrão do lado esquerdo valem no lado direito
      var renv = env;
      var binds = op === "&&" ? e.l.bindsTrue : e.l.bindsFalse;
      if (binds && binds.length) { renv = env.dup({ scope: new Scope(env.scope) }); binds.forEach(function (v) { self.declareVar(v, renv, true); }); }
      rt = this.attribExpr(e.r, renv, null);
      if (op === "&&") { e.bindsTrue = (e.l.bindsTrue || []).concat(e.r.bindsTrue || []); e.bindsFalse = null; }
      else { e.bindsFalse = (e.l.bindsFalse || []).concat(e.r.bindsFalse || []); e.bindsTrue = null; }
    } else {
      lt = this.attribExpr(e.l, env, null);
      rt = this.attribExpr(e.r, env, null);
    }
    if (isErr(lt) || isErr(rt)) return op === "+" ? T_ERR : T_ERR;
    if (lt === T["void"] || rt === T["void"]) {
      this.err(env, lt === T["void"] ? e.l.pos : e.r.pos, "'void' type not allowed here");
      return T_ERR;
    }
    var info = binaryResultType(op, lt, rt);
    if (!info) {
      this.err(env, e.pos, "bad operand types for binary operator '" + op + "'\n  first type:  " + typeStr(lt) + "\n  second type: " + typeStr(rt) + this.whereFor([lt, rt]));
      return T_ERR;
    }
    if (info.refCmp) {
      // comparação de referências: os tipos precisam ser "convertíveis" por cast
      if (lt.k !== "null" && rt.k !== "null" && !castable(lt, rt) && !castable(rt, lt)) {
        this.err(env, e.pos, "incomparable types: " + typeStr(lt) + " and " + typeStr(rt) + this.whereFor([lt, rt]));
        return T_ERR;
      }
      // Integer == int → numérica (tratada acima); Integer == Integer → referência
    }
    e.opType = info.opType; e.concat = !!info.concat; e.refCmp = !!info.refCmp; e.shiftType = info.shiftType;
    if (e.l.cv !== undefined && e.r.cv !== undefined) {
      var c = foldBinary(op, e.l.cv, e.r.cv, lt, rt, info.opType, info.type);
      if (c !== undefined) e.cv = c;
    }
    return info.type;
  };
  // pode converter s em t por cast?
  function castable(s, t) {
    if (isErr(s) || isErr(t)) return true;
    if (s.k === "prim" && t.k === "prim") {
      if (s.n === "boolean" || t.n === "boolean") return s.n === t.n;
      return true;
    }
    if (s.k === "prim") return isSubtype(boxedType(s), t);
    if (t.k === "prim") {
      var u = unboxedType(s);
      if (u) return u.n === t.n || primWidens(u, t);
      // Object/Number/Comparable → int (checkcast + unboxing)
      return isSubtype(boxedType(t), s);
    }
    if (s.k === "null") return true;
    if (isSubtype(s, t) || isSubtype(t, s)) return true;
    if (s.k === "tvar" || t.k === "tvar" || s.k === "wild" || t.k === "wild") return true;
    if (s.k === "array" && t.k === "array") {
      if (s.elem.k === "prim" || t.elem.k === "prim") return sameType(s.elem, t.elem);
      return castable(s.elem, t.elem);
    }
    if (s.k === "array" || t.k === "array") {
      var o = s.k === "array" ? t : s;
      return o.k === "class" && (o.sym.full === "java.lang.Object" || o.sym.full === "java.lang.Cloneable" || o.sym.full === "java.io.Serializable");
    }
    if (s.k === "class" && t.k === "class") {
      var si = s.sym.isInterface(), ti = t.sym.isInterface();
      if (si && ti) return true;
      if (si && !t.sym.flags["final"]) return true;
      if (ti && !s.sym.flags["final"]) return true;
      if (si || ti) {
        // classe final que não implementa a interface
        var cls = si ? t.sym : s.sym, itf = si ? s.sym : t.sym;
        if (cls.flags["final"]) return isSubClass(cls, itf);
        return true;
      }
      // duas classes: uma deve ser subclasse da outra
      return isSubClass(s.sym, t.sym) || isSubClass(t.sym, s.sym);
    }
    return true;
  }
  CK.attribAssign = function (e, env) {
    var tt = this.attribExpr(e.target, env.ctorPrologue && e.target.k === "Ident" ? env.dup({ prologueAssign: true }) : env, null);
    if (!isErr(tt) && !this.isVariable(e.target)) {
      this.err(env, e.target.pos, "unexpected type\n  required: variable\n  found:    value");
      this.attribExpr(e.value, env, null);
      return T_ERR;
    }
    var vt = this.attribExpr(e.value, env, isErr(tt) ? null : tt);
    if (!isErr(tt)) {
      this.checkAssignable(e.target, env);
      this.checkAssign(e.value, vt, tt, env);
    }
    return tt;
  };
  CK.attribCompound = function (e, env) {
    var tt = this.attribExpr(e.target, env, null);
    var vt = this.attribExpr(e.value, env, null);
    if (isErr(tt) || isErr(vt)) return T_ERR;
    if (!this.isVariable(e.target)) { this.err(env, e.target.pos, "unexpected type\n  required: variable\n  found:    value"); return T_ERR; }
    var op = e.op;
    if (vt === T["void"]) { this.err(env, e.value.pos, "'void' type not allowed here"); return T_ERR; }
    var info = binaryResultType(op, tt, vt);
    if (!info || (op === "+" && info.concat && !isString(tt))) {
      this.err(env, e.pos, "bad operand types for binary operator '" + op + "'\n  first type:  " + typeStr(tt) + "\n  second type: " + typeStr(vt));
      return T_ERR;
    }
    // o resultado volta para o tipo da variável (cast implícito); boxed precisa caber sem narrowing
    if (tt.k === "class" && !isString(tt)) {
      var u = unboxedType(tt);
      if (u && !(u.n === info.type.n || primWidens(info.type, u)) && !info.concat) {
        this.err(env, e.pos, "incompatible types: possible lossy conversion from " + typeStr(info.type) + " to " + typeStr(u));
      }
    }
    e.opType = info.opType; e.concat = !!info.concat; e.resType = info.type; e.shiftType = info.shiftType;
    this.checkAssignable(e.target, env);
    return tt;
  };
  CK.attribCond = function (e, env, pt) {
    var self = this;
    var ct = this.attribExpr(e.cond, env, null);
    this.checkCond(e.cond, ct, env);
    var aenv = env, benv = env;
    if (e.cond.bindsTrue && e.cond.bindsTrue.length) { aenv = env.dup({ scope: new Scope(env.scope) }); e.cond.bindsTrue.forEach(function (v) { self.declareVar(v, aenv, true); }); }
    if (e.cond.bindsFalse && e.cond.bindsFalse.length) { benv = env.dup({ scope: new Scope(env.scope) }); e.cond.bindsFalse.forEach(function (v) { self.declareVar(v, benv, true); }); }
    var poly = pt && isRef(pt) && (isPolyExpr(e.a) || isPolyExpr(e.b));
    var at = this.attribExpr(e.a, aenv, poly || (pt && isRef(pt)) ? pt : null);
    var bt = this.attribExpr(e.b, benv, poly || (pt && isRef(pt)) ? pt : null);
    if (isErr(at) || isErr(bt)) return T_ERR;
    if (at === T["void"] || bt === T["void"]) { this.err(env, (at === T["void"] ? e.a : e.b).pos, "'void' type not allowed here"); return T_ERR; }
    if (pt && !isErr(pt) && pt.k === "prim" && pt !== T["void"] && !(isNumericOrBoxed(at) && isNumericOrBoxed(bt)) && !(isBoolOrBoxed(at) && isBoolOrBoxed(bt))) {
      var okA = assignConv(at, pt, e.a.cv), okB = assignConv(bt, pt, e.b.cv);
      if (!okA) this.err(env, e.a.pos, "incompatible types: bad type in conditional expression\n    " + typeStr(at) + " cannot be converted to " + typeStr(pt));
      if (!okB) this.err(env, e.b.pos, "incompatible types: bad type in conditional expression\n    " + typeStr(bt) + " cannot be converted to " + typeStr(pt));
      if (!okA || !okB) return T_ERR;
      return pt;
    }
    var r = condType(at, bt, e.a.cv, e.b.cv);
    // condicional de referência com tipo-alvo: o tipo é o alvo
    if (pt && isRef(pt) && !(at.k === "prim" && bt.k === "prim") && !(isNumericOrBoxed(at) && isNumericOrBoxed(bt)) && !(isBoolOrBoxed(at) && isBoolOrBoxed(bt))) {
      if (looseConv(at, pt) && looseConv(bt, pt)) r = pt;
      else {
        if (!looseConv(at, pt)) this.err(env, e.a.pos, "incompatible types: bad type in conditional expression\n    " + typeStr(at) + " cannot be converted to " + typeStr(pt));
        if (!looseConv(bt, pt)) this.err(env, e.b.pos, "incompatible types: bad type in conditional expression\n    " + typeStr(bt) + " cannot be converted to " + typeStr(pt));
        return T_ERR;
      }
      e.refCond = true;
    }
    if (e.cond.cv !== undefined && e.a.cv !== undefined && e.b.cv !== undefined && r.k === "prim") e.cv = castConst(e.cond.cv ? e.a.cv : e.b.cv, r);
    else if (e.cond.cv !== undefined && e.a.cv !== undefined && e.b.cv !== undefined && isString(r)) e.cv = e.cond.cv ? e.a.cv : e.b.cv;
    return r;
  };
  function isNumericOrBoxed(t) { var u = t.k === "prim" ? t : unboxedType(t); return !!u && isNumericPrim(u); }
  function isBoolOrBoxed(t) { var u = t.k === "prim" ? t : unboxedType(t); return !!u && u.n === "boolean"; }
  function isPolyExpr(e) {
    while (e.k === "Paren") e = e.expr;
    return e.k === "Lambda" || e.k === "MethodRef" || e.k === "Cond" && (isPolyExpr(e.a) || isPolyExpr(e.b));
  }
  function condType(a, b, acv, bcv) {
    if (sameType(a, b)) return a;
    var au = a.k === "prim" ? a : unboxedType(a), bu = b.k === "prim" ? b : unboxedType(b);
    if (au && bu && au.n === "boolean" && bu.n === "boolean") return T["boolean"];
    if (au && bu && isNumericPrim(au) && isNumericPrim(bu)) {
      if (au.n === bu.n) return au;
      var small = { "byte": 1, "short": 1, "char": 1 };
      if (small[au.n] && bu.n === "int" && bcv !== undefined && b.k === "prim" && fitsConst(bcv, au.n)) return au;
      if (small[bu.n] && au.n === "int" && acv !== undefined && a.k === "prim" && fitsConst(acv, bu.n)) return bu;
      if ((au.n === "byte" && bu.n === "short") || (au.n === "short" && bu.n === "byte")) return T["short"];
      return binaryPromote(au, bu);
    }
    if (a.k === "null" && b.k === "prim") return boxedType(b);
    if (b.k === "null" && a.k === "prim") return boxedType(a);
    if (a.k === "null") return b;
    if (b.k === "null") return a;
    var ab = a.k === "prim" ? boxedType(a) : a, bb = b.k === "prim" ? boxedType(b) : b;
    return lub([ab, bb]);
  }
  // menor supertipo comum (simplificado)
  function lub(ts) {
    ts = ts.filter(function (t) { return t.k !== "null" && !isErr(t); });
    if (!ts.length) return OBJ();
    var first = ts[0];
    if (ts.every(function (t) { return sameType(t, first); })) return first;
    for (var i = 0; i < ts.length; i++) {
      var c = ts[i];
      if (ts.every(function (t) { return isSubtype(t, c); })) return c;
    }
    if (ts.every(function (t) { return t.k === "array"; })) {
      if (ts.every(function (t) { return t.elem.k !== "prim"; })) return new ArrayType(lub(ts.map(function (t) { return t.elem; })));
      return OBJ();
    }
    // sobe pela cadeia de superclasses do primeiro
    if (first.k === "class") {
      var cands = [];
      (function walk(t) {
        if (!t || t.k !== "class") return;
        cands.push(t);
        supertypesOf(t).forEach(walk);
      })(first);
      for (var j = 0; j < cands.length; j++) {
        var c2 = cands[j];
        if (c2.sym.full === "java.lang.Object") continue;
        if (c2.sym.isInterface()) continue;
        var ok = ts.every(function (t) { return !!asSuper(t, c2.sym); });
        if (ok) {
          var sups = ts.map(function (t) { return asSuper(t, c2.sym); });
          if (sups.every(function (s) { return sameType(s, sups[0]); })) return sups[0];
          return c2.sym.rawType();
        }
      }
      for (var k = 0; k < cands.length; k++) {
        var c3 = cands[k];
        if (!c3.sym.isInterface()) continue;
        if (ts.every(function (t) { return !!asSuper(t, c3.sym); })) {
          var s3 = ts.map(function (t) { return asSuper(t, c3.sym); });
          if (s3.every(function (s) { return sameType(s, s3[0]); })) return s3[0];
          if (c3.sym.full === "java.lang.Comparable" || c3.sym.full === "java.io.Serializable") continue;
          return c3.sym.rawType();
        }
      }
    }
    return OBJ();
  }
  CK.attribCast = function (e, env) {
    var ct = this.resolveType(e.type, env);
    var bounds = (e.bounds || []).map(function (b) { return this.resolveType(b, env); }, this);
    var target = bounds.length ? { k: "inter", types: [ct].concat(bounds) } : ct;
    var et = this.attribExpr(e.expr, env, isPolyExpr(e.expr) ? target : null);
    if (isErr(ct) || isErr(et)) return isErr(ct) ? T_ERR : ct;
    if (isPolyExpr(e.expr)) return target;
    if (et === T["void"]) { this.err(env, e.expr.pos, "incompatible types: void cannot be converted to " + typeStr(ct)); return T_ERR; }
    if (!castable(et, ct)) {
      this.err(env, e.expr.pos, "incompatible types: " + typeStr(et) + " cannot be converted to " + typeStr(ct) + this.whereFor([et, ct]));
      return T_ERR;
    }
    if (ct.k === "class" && ct.args && !isReifiable(ct) && !isSubtype(et, ct)) this.unchecked();
    if (e.expr.cv !== undefined && (ct.k === "prim" || isString(ct))) e.cv = castConst(e.expr.cv, ct);
    e.fromType = et;
    return target;
  };
  CK.attribInstanceOf = function (e, env) {
    var et = this.attribExpr(e.expr, env, null);
    var tgt = e.target, tt, self = this;
    if (tgt.k === "TypePattern" || tgt.k === "RecordPattern" || tgt.k === "AnyPattern") {
      tt = this.attribPattern(tgt, env, et, true);
      e.pattern = tgt;
      e.bindsTrue = collectBindings(tgt);
      e.bindsFalse = null;
    } else {
      tt = this.resolveType(tgt, env);
      e.targetType = tt;
    }
    if (isErr(et) || isErr(tt)) return T["boolean"];
    if (et.k === "prim") { this.err(env, e.expr.pos, "unexpected type\n  required: reference\n  found:    " + typeStr(et)); return T["boolean"]; }
    if (!castable(et, tt)) { this.err(env, e.expr.pos, "incompatible types: " + typeStr(et) + " cannot be converted to " + typeStr(tt) + this.whereFor([et, tt])); return T["boolean"]; }
    if (tt.k === "class" && tt.args && !isReifiable(tt) && !isSubtype(et, tt)) {
      this.err(env, e.expr.pos, typeStr(et) + " cannot be safely cast to " + typeStr(tt));
    }
    e.testType = tt;
    return T["boolean"];
  };
  function collectBindings(p) {
    var r = [];
    (function walk(x) {
      if (x.k === "TypePattern" && x.vsym) r.push(x.vsym);
      if (x.k === "RecordPattern") x.subs.forEach(walk);
    })(p);
    return r;
  }
  // padrões: "Tipo nome", "Rec(padrões...)", "var x", "_"
  CK.attribPattern = function (p, env, exprType, top) {
    var self = this;
    if (p.k === "AnyPattern") { p.ptype = exprType; return exprType; }
    if (p.k === "TypePattern") {
      var t;
      if (p.type.k === "VarType") t = exprType;
      else t = this.resolveType(p.type, env);
      p.ptype = t;
      if (p.name !== "_") {
        var v = new VarSym(p.name, isErr(t) ? T_ERR : t, "pattern");
        if (p.mods && p.mods.flags["final"]) v.flags["final"] = true;
        v.pos = p.namePos;
        v.hasInit = true;
        p.vsym = v;
      }
      if (!top && !isErr(t) && !isErr(exprType) && p.type.k !== "VarType") {
        if (!castable(exprType, t)) this.err(env, p.pos, "incompatible types: " + typeStr(exprType) + " cannot be converted to " + typeStr(t));
      }
      return t;
    }
    if (p.k === "RecordPattern") {
      var rt = this.resolveType(p.type, env);
      p.ptype = rt;
      if (isErr(rt)) return T_ERR;
      if (rt.k !== "class" || !rt.sym.isRecord()) { this.err(env, p.pos, typeStr(rt) + " is not a record class"); return T_ERR; }
      completeAny(this, rt.sym);
      // record genérico sem argumentos: infere do tipo da expressão
      if (rt.sym.tparams.length && !rt.args && exprType.k === "class") {
        var sup = asSuper(exprType, rt.sym);
        if (sup && sup.args) rt = sup;
        else { rt = rt.sym.thisType(); }
        p.ptype = rt;
      }
      var comps = rt.sym.recComps || [];
      if (comps.length !== p.subs.length) { this.err(env, p.pos, "incorrect number of nested patterns\n  required: " + comps.map(function (c) { return typeStr(c.type); }).join(",") + "\n  found:    " + p.subs.map(function () { return "?"; }).join(",")); return T_ERR; }
      p.comps = comps;
      p.subs.forEach(function (sp, i) {
        var ctype = memberType(comps[i].type, rt, rt.sym);
        var st = self.attribPattern(sp, env, ctype, false);
        if (sp.k === "TypePattern" && !isErr(st) && !isErr(ctype) && st.k !== "prim" && ctype.k === "prim") self.err(env, sp.pos, "incompatible types: " + typeStr(ctype) + " cannot be converted to " + typeStr(st));
        sp.compType = ctype;
      });
      return rt;
    }
    return T_ERR;
  };
  CK.checkCond = function (e, t, env) {
    if (isErr(t)) return;
    if (t.k === "prim" && t.n === "boolean") return;
    var u = unboxedType(t);
    if (u && u.n === "boolean") return;
    this.err(env, e.pos, "incompatible types: " + typeStr(t) + " cannot be converted to boolean");
  };

  /* =====================================================================
     8. Métodos: resolução de sobrecarga, inferência, lambdas, referências
     ===================================================================== */
  // ---------- contexto de inferência ----------
  function Infer(vars) {
    this.vars = vars; this.ids = {}; this.b = {};
    var self = this;
    vars.forEach(function (v) { self.ids[v.id] = true; self.b[v.id] = { eq: null, lower: [], upper: [] }; v.inferring = true; v.inferCtx = self; });
    this.solved = null;
  }
  Infer.prototype.isVar = function (t) { return t && t.k === "tvar" && this.ids[t.sym.id]; };
  Infer.prototype.mentions = function (t) {
    var self = this, r = false;
    (function walk(x) {
      if (!x || r) return;
      if (x.k === "tvar") { if (self.ids[x.sym.id] && !self.isResolved(x.sym)) r = true; return; }
      if (x.k === "array") walk(x.elem);
      else if (x.k === "wild") walk(x.bound);
      else if (x.k === "class" && x.args) x.args.forEach(walk);
    })(t);
    return r;
  };
  Infer.prototype.isResolved = function (v) { return this.solved && has(this.solved, v.id); };
  function ownerInf(t) {
    var r = null;
    (function walk(x) { if (!x || r) return; if (x.k === "tvar") { if (x.sym.inferring && x.sym.inferCtx) r = x.sym.inferCtx; return; } if (x.k === "array") walk(x.elem); else if (x.k === "wild") walk(x.bound); else if (x.k === "class" && x.args) x.args.forEach(walk); })(t);
    return r;
  }
  function isForeignFree(t, inf) { return t.k === "tvar" && t.sym.inferring && !(inf && inf.ids[t.sym.id]); }
  // kind: "lower" (actual <: formal), "upper" (formal <: actual), "eq"
  Infer.prototype.unify = function (formal, actual, kind) {
    if (!formal || !actual || isErr(actual)) return;
    if (actual.k === "null") return;
    if (formal.k === "tvar" && this.ids[formal.sym.id]) {
      if (actual.k === "prim") { if (actual.n === "void") return; actual = boxedType(actual); }
      if (isForeignFree(actual, this)) return;
      if (actual.k === "wild") actual = capUpper(actual);
      var b = this.b[formal.sym.id];
      if (kind === "eq") { if (!b.eq) b.eq = actual; }
      else if (kind === "lower") { if (!b.lower.some(function (x) { return sameType(x, actual); })) b.lower.push(actual); }
      else { if (!b.upper.some(function (x) { return sameType(x, actual); })) b.upper.push(actual); }
      return;
    }
    if (actual.k === "tvar" && isForeignFree(actual, this)) return;
    if (formal.k === "wild") {
      if (formal.kind === "extends") this.unify(formal.bound, actual, kind === "eq" ? "lower" : kind);
      else if (formal.kind === "super") this.unify(formal.bound, actual, kind === "eq" ? "upper" : (kind === "lower" ? "upper" : "lower"));
      return;
    }
    if (formal.k === "array") {
      if (actual.k === "array" && formal.elem.k !== "prim" && actual.elem.k !== "prim") this.unify(formal.elem, actual.elem, kind);
      return;
    }
    if (formal.k === "class" && formal.args) {
      var sup;
      if (actual.k === "prim") actual = boxedType(actual);
      if (kind === "upper") {
        // formal <: actual: leva o formal até a classe do actual
        if (actual.k !== "class") return;
        sup = asSuper(formal, actual.sym);
        if (!sup || !sup.args || !actual.args) return;
        for (var i = 0; i < sup.args.length; i++) {
          var fa = sup.args[i], aa = actual.args[i];
          if (aa.k === "wild") {
            if (aa.kind === "extends") this.unify(fa, aa.bound, "upper");
            else if (aa.kind === "super") this.unify(fa, aa.bound, "lower");
          } else this.unify(fa, aa, "eq");
        }
        return;
      }
      if (actual.k === "class" || actual.k === "tvar" || actual.k === "inter") {
        sup = asSuper(actual, formal.sym);
        if (!sup || !sup.args) return;
        for (var j = 0; j < formal.args.length; j++) {
          var f = formal.args[j], a = sup.args[j];
          if (f.k === "wild") {
            if (!f.kind) continue;
            var ab = a.k === "wild" ? a.bound : a;
            if (!ab) continue;
            if (f.kind === "extends") this.unify(f.bound, ab, "lower");
            else this.unify(f.bound, ab, "upper");
          } else {
            if (a.k === "wild") { if (a.bound) this.unify(f, a.bound, a.kind === "extends" ? "lower" : "upper"); }
            else this.unify(f, a, "eq");
          }
        }
      }
    }
  };
  // resolve as variáveis; "only": lista de variáveis a resolver agora (as demais continuam livres)
  Infer.prototype.solve = function (only) {
    var self = this;
    if (!this.solved) this.solved = {};
    var targets = only || this.vars;
    targets.forEach(function (v) {
      if (has(self.solved, v.id)) return;
      var b = self.b[v.id], r = null;
      var map = self.solvedMap();
      var ctorLow = b.lower.filter(function (x) { return x.ctorRef; })[0];
      if (ctorLow) {
        b.lower = b.lower.filter(function (x) { return !x.ctorRef; });
        // Classe::new genérica: argumentos vêm do limite declarado (ex.: M extends Map<K,D>)
        var others = self.vars.filter(function (o) { return o !== v && !has(self.solved, o.id); });
        if (others.length) self.solve(others);
        map = self.solvedMap();
        var bnd = v.bounds.length ? subst(v.bounds[0], map) : null;
        var cs = ctorLow.sym;
        if (bnd && bnd.k === "class" && cs.tparams.length) {
          var fv = cs.tparams.map(function (tv) { return new TVarSym(tv.name, cs); });
          var fm = {}; cs.tparams.forEach(function (tv, i) { fm[tv.id] = fv[i].type; });
          var ti = new Infer(fv);
          ti.unify(subst(cs.thisType(), fm), bnd, "upper");
          var tm = ti.solve();
          b.lower.push(new ClassType(cs, fv.map(function (x) { return tm[x.id]; })));
        } else b.lower.push(cs.rawType());
      }
      if (b.eq) {
        r = b.eq;
        var bad = b.lower.filter(function (x) { return !isSubtype(subst(x, map), r) && !isErr(x); });
        if (bad.length && !self.conflict) self.conflict = { v: v, eq: r, lower: b.lower.slice() };
      }
      else if (b.lower.length) r = lub(b.lower.map(function (x) { return subst(x, map); }));
      else if (b.upper.length) {
        var ups = b.upper.map(function (x) { return subst(x, map); }).filter(function (x) { return !isObjectType(x); });
        r = ups.length ? ups[0] : OBJ();
      } else {
        r = v.bounds.length ? v.bounds[0] : OBJ();
        if (self.mentionsSelf(r, v)) r = erasure(r);
        else r = subst(r, map);
        if (r.k === "tvar" && self.ids[r.sym.id]) r = OBJ();
      }
      if (r.k === "tvar" && self.ids[r.sym.id] && r.sym === v) r = OBJ();
      self.solved[v.id] = r;
    });
    if (!only) this.vars.forEach(function (v) { v.inferring = false; });
    return this.solvedMap();
  };
  Infer.prototype.mentionsSelf = function (t, v) {
    var r = false;
    (function walk(x) { if (!x || r) return; if (x.k === "tvar") { if (x.sym === v) r = true; return; } if (x.k === "array") walk(x.elem); else if (x.k === "wild") walk(x.bound); else if (x.k === "class" && x.args) x.args.forEach(walk); })(t);
    return r;
  };
  Infer.prototype.solvedMap = function () {
    var m = {};
    if (this.solved) for (var k in this.solved) m[k] = this.solved[k];
    return m;
  };
  Infer.prototype.finish = function () { this.vars.forEach(function (v) { v.inferring = false; }); };
  // variáveis desta inferência que aparecem em t e ainda não foram resolvidas
  Infer.prototype.freeIn = function (t) {
    var self = this, r = [];
    (function walk(x) {
      if (!x) return;
      if (x.k === "tvar") { if (self.ids[x.sym.id] && !self.isResolved(x.sym) && r.indexOf(x.sym) < 0) r.push(x.sym); return; }
      if (x.k === "array") walk(x.elem); else if (x.k === "wild") walk(x.bound); else if (x.k === "class" && x.args) x.args.forEach(walk);
    })(t);
    return r;
  };

  // ---------- interface funcional ----------
  var OBJECT_METHOD_KEYS = { "equals(java.lang.Object)": 1, "hashCode()": 1, "toString()": 1 };
  nullProto(OBJECT_METHOD_KEYS);
  CK.findSam = function (sym) {
    if (sym._sam !== undefined) return sym._sam;
    sym._sam = null;
    if (!sym.isInterface()) return null;
    var abstracts = [], self = this, seen = {};
    var all = this.allMethods(sym.thisType());
    all.forEach(function (c) {
      var m = c.m;
      if (!m.flags.abstract || m.flags["static"]) return;
      if (OBJECT_METHOD_KEYS[m.key]) return;
      if (m.owner.full === "java.lang.Object") return;
      abstracts.push(c);
    });
    // métodos abstratos com a mesma assinatura (herdados de várias interfaces) contam como um
    var uniq = [];
    abstracts.forEach(function (c) {
      var ps = c.m.params.map(function (p) { return erasedName(memberType(p, c.site, c.m.owner)); }).join(",");
      if (!uniq.some(function (u) { return u.m.name === c.m.name && u.ps === ps; })) uniq.push({ m: c.m, site: c.site, ps: ps });
    });
    if (uniq.length === 1) sym._sam = uniq[0];
    return sym._sam;
  };
  // todos os métodos visíveis num tipo (sem os sobrescritos)
  CK.allMethods = function (t, name) {
    var self = this, res = [], seenCls = {};
    function addFrom(st) {
      var s = st.sym;
      if (seenCls[s.id]) return;
      seenCls[s.id] = 1;
      completeAny(self, s);
      var list = name ? (s.methods[name] || []) : s.methodList;
      list.forEach(function (m) {
        // sobrescrito por algum já coletado?
        for (var i = 0; i < res.length; i++) {
          var o = res[i];
          if (o.m.name === m.name && o.m.params.length === m.params.length && self.sameSigIn(o, { m: m, site: st })) return;
        }
        res.push({ m: m, site: st });
      });
    }
    function walk(st) {
      if (!st || st.k !== "class") return;
      addFrom(st);
      var sups = supertypesOf(st);
      // primeiro a superclasse (cadeia), depois as interfaces
      sups.forEach(function (x) { if (x.k === "class" && !x.sym.isInterface()) walk(x); });
      sups.forEach(function (x) { if (x.k === "class" && x.sym.isInterface()) walk(x); });
    }
    if (t.k === "tvar" || t.k === "inter") {
      var bs = t.k === "tvar" ? (t.sym.bounds.length ? t.sym.bounds : [OBJ()]) : t.types;
      bs.forEach(function (b) { if (b.k === "class") walk(b); else if (b.k === "tvar") { var r = self.allMethods(b, name); r.forEach(function (x) { res.push(x); }); } });
      walk(OBJ());
    } else if (t.k === "array") {
      walk(OBJ());
    } else walk(t);
    return res;
  };
  CK.sameSigIn = function (a, b) {
    for (var i = 0; i < a.m.params.length; i++) {
      var pa = memberType(a.m.params[i], a.site, a.m.owner), pb = memberType(b.m.params[i], b.site, b.m.owner);
      if (!sameType(pa, pb) && erasedName(pa) !== erasedName(pb)) {
        // método genérico: compara apagando
        if (!(a.m.tparams.length || b.m.tparams.length)) return false;
        if (erasedName(pa) !== erasedName(pb)) return false;
      }
    }
    return true;
  };
  // parametrização sem curingas (JLS 9.9)
  function nonWildcard(t) {
    if (t.k !== "class" || !t.args) return t;
    var sym = t.sym;
    return new ClassType(sym, t.args.map(function (a, i) {
      if (a.k !== "wild") return a;
      if (a.kind === "extends" || a.kind === "super") return a.bound;
      var tb = sym.tparams[i] && sym.tparams[i].bounds[0];
      return tb && !mentionsTvars(tb) ? tb : OBJ();
    }));
  }
  function mentionsTvars(t) { var r = false; (function w(x) { if (!x || r) return; if (x.k === "tvar") r = true; else if (x.k === "array") w(x.elem); else if (x.k === "class" && x.args) x.args.forEach(w); else if (x.k === "wild") w(x.bound); })(t); return r; }
  // {sam, params, ret, site} de um tipo funcional (ou null)
  CK.samOf = function (t) {
    if (!t) return null;
    if (t.k === "inter") { for (var i = 0; i < t.types.length; i++) { var r0 = this.samOf(t.types[i]); if (r0) return r0; } return null; }
    if (t.k !== "class") return null;
    completeAny(this, t.sym);
    var s = this.findSam(t.sym);
    if (!s) return null;
    var site = nonWildcard(t);
    var sup = asSuper(site, s.m.owner) || site;
    var params = s.m.params.map(function (p) { return memberType(p, sup, s.m.owner); });
    var ret = memberType(s.m.ret, sup, s.m.owner);
    return { sam: s.m, params: params, ret: ret, site: site, ftype: t };
  };

  // ---------- argumentos (alguns "adiados" até saber o tipo-alvo) ----------
  CK.attribArgs = function (args, env) {
    var self = this;
    return args.map(function (a) {
      var x = a;
      while (x.k === "Paren") x = x.expr;
      if (x.k === "Lambda" || x.k === "MethodRef") return { node: a, poly: true, kind: x.k, inner: x, env: env };
      if (x.k === "Cond" && isPolyExpr(x)) return { node: a, poly: true, kind: "Cond", inner: x };
      if (x.k === "Call" || (x.k === "New" && x.type.parts && x.type.parts[x.type.parts.length - 1].args && x.type.parts[x.type.parts.length - 1].args.diamond)) {
        var head = x.k === "Call" ? self.callHead(x, env) : self.newHead(x, env);
        if (x.k === "New" && x.body && head && head.diamond) return { node: a, poly: true, kind: "Call", inner: x, head: head, prov: head.sym.rawType() };
        if (head && head.inf && head.isPoly) {
          return { node: a, poly: true, kind: "Call", inner: x, head: head, prov: head.provType };
        }
        var t = x.k === "Call" ? self.callFinish(x, head, env, null) : self.newFinish(x, head, env, null);
        if (t === T["void"]) { self.err(env, a.pos, "'void' type not allowed here"); t = T_ERR; }
        x.type = t; if (a !== x) a.type = t;
        return { node: a, type: t };
      }
      var t2 = self.attribExpr(a, env, null);
      if (t2 === T["void"]) { self.err(env, a.pos, "'void' type not allowed here"); t2 = T_ERR; }
      return { node: a, type: t2 };
    });
  };
  // completa um argumento adiado com o tipo-alvo
  CK.completeArg = function (ai, target, env, inf) {
    var x = ai.inner, t;
    if (ai.kind === "Lambda") t = this.attribLambda(x, env, target, inf);
    else if (ai.kind === "MethodRef") t = this.attribMethodRef(x, env, target, inf);
    else if (ai.kind === "Cond") t = this.attribCond(x, env, target);
    else if (ai.kind === "Call") {
      t = x.k === "Call" ? this.callFinish(x, ai.head, env, target, inf) : this.newFinish(x, ai.head, env, target, inf);
    }
    x.type = t;
    for (var n = ai.node; n !== x; n = n.expr) n.type = t;
    ai.type = t;
    return t;
  };
  function argTypeStr(ai) {
    if (ai.poly) {
      if (ai.kind === "Call" && ai.prov) return typeStr(ai.prov);
      return ai.kind === "Lambda" ? "(" + ai.inner.params.map(function () { return ""; }).join(",") + ")->{ }" : "method reference";
    }
    return typeStr(ai.type);
  }
  // compatibilidade "potencial" de lambda/referência com o tipo formal
  CK.potentiallyCompatible = function (ai, formal, inf) {
    if (formal.k === "tvar") return true;
    var ss = this.samOf(formal);
    if (ai.kind === "Lambda") {
      if (!ss) return false;
      if (ss.params.length !== ai.inner.params.length) return false;
      var body = ai.inner.body;
      var voidRet = ss.ret === T["void"];
      if (body.k !== "Block") {
        if (voidRet) return isStatementExpr(body);
        if (ai.inner.params.length === 0 && body.k === "Call") { if (ai.voidBody === undefined) ai.voidBody = this.quietVoid(body, ai.env); if (ai.voidBody) return false; }
        return true;
      }
      var rv = blockReturns(body);
      if (voidRet) return !rv.value;
      return rv.value || !rv.normal;
    }
    if (ai.kind === "MethodRef") { if (!ss) return false; return this.mrefArityOk(ai, ss.params.length); }
    if (ai.kind === "Cond") return true;
    if (ai.kind === "Call") {
      var p = ai.prov;
      if (!p) return true;
      var pe = eraseFree(p), fe = eraseFree(formal);
      return looseConv(pe, fe) || isErr(pe);
    }
    return true;
  };
  // o corpo (expressão) de uma lambda sem parâmetros é void? (atribuição descartável)
  CK.quietVoid = function (body, env) {
    if (!env) return false;
    var n = this.errs.length, t;
    var savedCaps = this.prog.captureRefs ? this.prog.captureRefs.length : 0;
    try { t = this.attribExpr(cloneTree(body), env.dup({ frame: { kind: "lambda", captures: [], parentFrame: env.frame } }), null); } catch (e) { t = T_ERR; }
    this.errs.length = n;
    if (this.prog.captureRefs) this.prog.captureRefs.length = savedCaps;
    return t === T["void"];
  };
  CK.mrefArityOk = function (ai, n) {
    var x = ai.inner, env = ai.env;
    if (!env || x.target.k === "TypeExpr" || x.target.k === "Super") return true;
    var tt = null;
    try { tt = this.qualTreeQuiet(x.target, env); } catch (e) { return true; }
    if (!tt) return true;
    if (x.name === "new") { if (tt.kind !== "class") return true; completeAny(this, tt.sym); return tt.sym.ctors.some(function (c) { return c.params.length === n || (c.varargs && n >= c.params.length - 1); }); }
    var site = tt.kind === "class" ? tt.sym.thisType() : tt.type;
    if (!site || isErr(site) || site.k === "prim") return true;
    var ms = this.allMethods(site, x.name);
    if (!ms.length) return true;
    return ms.some(function (c) {
      var m = c.m, k = m.params.length;
      var okN = k === n || (m.varargs && n >= k - 1);
      var okU = tt.kind === "class" && !m.flags["static"] && (k === n - 1 || (m.varargs && n - 1 >= k - 1));
      if (tt.kind === "class") return (m.flags["static"] && okN) || okU;
      return okN;
    });
  };
  function eraseFree(t) {
    // apaga variáveis em inferência para comparações grosseiras
    if (t.k === "tvar" && t.sym.inferring) return t.sym.bounds.length ? erasure(t.sym.bounds[0]) : OBJ();
    if (t.k === "class" && t.args) return t.sym.rawType();
    if (t.k === "array") return new ArrayType(eraseFree(t.elem));
    return t;
  }
  // um bloco de lambda devolve valor? termina normalmente?
  function blockReturns(b) {
    var value = false, voidR = false;
    (function walk(s) {
      if (!s) return;
      switch (s.k) {
        case "Return": if (s.expr) value = true; else voidR = true; return;
        case "Block": s.stats.forEach(walk); return;
        case "If": walk(s.then); walk(s.els); return;
        case "While": case "DoWhile": case "For": case "ForEach": case "Labeled": case "Sync": walk(s.body); return;
        case "Try": walk(s.block); s.catches.forEach(function (c) { walk(c.body); }); walk(s.fin); return;
        case "Switch": s.cases.forEach(function (c) { if (c.body) walk(c.body); if (c.stats) c.stats.forEach(walk); }); return;
      }
    })(b);
    var last = b.stats[b.stats.length - 1];
    var normal = !(last && (last.k === "Return" || last.k === "Throw"));
    if (last && last.k === "While" && last.cond.k === "Literal" && last.cond.value === true) normal = false;
    if (last && last.k === "For" && !last.cond) normal = false;
    return { value: value, voidR: voidR, normal: normal };
  }

  // ---------- aplicabilidade ----------
  function freshVars(m, extra) {
    var olds = m.tparams.concat(extra || []);
    var fresh = olds.map(function (tv) { var n = new TVarSym(tv.name, tv.owner); n.orig = tv; return n; });
    var map = {};
    olds.forEach(function (tv, i) { map[tv.id] = fresh[i].type; });
    fresh.forEach(function (tv, i) { tv.bounds = olds[i].bounds.map(function (b) { return subst(b, map); }); });
    return { vars: fresh, map: map };
  }
  // cand: {m, site}; devolve {ok, formals, inf, reason}
  CK.applicable = function (cand, argInfos, phase, env, extraVars, siteMapOverride) {
    var m = cand.m, n = argInfos.length;
    var formals = m.params.map(function (p) { return siteMapOverride ? subst(p, siteMapOverride) : memberType(p, cand.site, m.owner); });
    var inf = null;
    var fv = null;
    if (m.tparams.length || (extraVars && extraVars.length)) {
      fv = freshVars(m, extraVars);
      formals = formals.map(function (f) { return subst(f, fv.map); });
      inf = new Infer(fv.vars);
    }
    if (phase < 3) { if (formals.length !== n) { if (inf) inf.finish(); return { ok: false, arity: true }; } }
    else { if (!m.varargs || n < formals.length - 1) { if (inf) inf.finish(); return { ok: false, arity: true }; } }
    function formalAt(i) {
      if (phase === 3 && i >= formals.length - 1) { var last = formals[formals.length - 1]; return last.k === "array" ? last.elem : last; }
      return formals[i];
    }
    var i, ai, f;
    if (inf) {
      for (i = 0; i < n; i++) { ai = argInfos[i]; if (!ai.poly) inf.unify(formalAt(i), ai.type, "lower"); }
      // referências de método exatas e lambdas explícitas ajudam a inferir
      for (i = 0; i < n; i++) { ai = argInfos[i]; if (ai.poly) this.unifyPolyArgShape(ai, formalAt(i), inf, env); }
    }
    var partial = inf ? this.partialSolve(inf) : null;
    for (i = 0; i < n; i++) {
      ai = argInfos[i];
      f = formalAt(i);
      var fs = partial ? subst(f, partial) : f;
      if (ai.poly) {
        if (!this.potentiallyCompatible(ai, fs, inf)) { if (inf) inf.finish(); return { ok: false, argIndex: i, reason: "poly" }; }
        continue;
      }
      var at = ai.type;
      if (isErr(at)) continue;
      var ok;
      var fchk = inf && inf.mentions(fs) ? eraseFree(fs) : fs;
      if (inf && inf.mentions(fs) && fs.k === "tvar") ok = at !== T["void"];
      else ok = phase === 1 ? strictConv(at, fchk) : looseConv(at, fchk);
      if (!ok && fchk !== fs && phase > 1 && at.k === "prim") ok = looseConv(boxedType(at), fchk);
      if (!ok) { if (inf) inf.finish(); return { ok: false, argIndex: i, formal: fs, actual: at }; }
    }
    if (inf) inf.finish();
    return { ok: true, formals: formals, inf: inf, fv: fv, phase: phase };
  };
  // resolve parcialmente (só variáveis com limites conhecidos)
  CK.partialSolve = function (inf) {
    var m = {};
    inf.vars.forEach(function (v) {
      var b = inf.b[v.id];
      if (b.eq) m[v.id] = b.eq;
      else if (b.lower.length) m[v.id] = lub(b.lower);
    });
    return m;
  };
  // para inferência: formato de referências exatas (Tipo::metodo) e lambdas com tipos explícitos
  CK.unifyPolyArgShape = function (ai, formal, inf, env) {
    var ss = this.samOf(formal.k === "tvar" ? null : formal);
    if (!ss) return;
    var x = ai.inner;
    if (ai.kind === "Lambda" && x.explicit && x.params.length === ss.params.length) {
      for (var i = 0; i < x.params.length; i++) {
        if (!x.params[i].type || x.params[i].type.k === "VarType") return;
        var pt = this.resolveTypeQuiet(x.params[i].type, env);
        if (pt && !isErr(pt)) inf.unify(ss.params[i], pt, "eq");
      }
      return;
    }
    if (ai.kind === "MethodRef") {
      var ex = this.exactMethodRef(x, env);
      if (!ex) return;
      var ps = ex.params;
      if (ex.unbound) ps = [ex.recv].concat(ps);
      if (ps.length !== ss.params.length) return;
      for (var j = 0; j < ps.length; j++) inf.unify(ss.params[j], ps[j], "lower");
      if (ex.ret && ex.ret !== T["void"] && ss.ret !== T["void"]) inf.unify(ss.ret, ex.ret.k === "prim" ? boxedType(ex.ret) : ex.ret, "lower");
    }
  };
  CK.resolveTypeQuiet = function (ast, env) {
    var n = this.errs.length;
    var t = this.resolveType(ast, env);
    this.errs.length = n;
    return t;
  };
  // Tipo::metodo com um único método com esse nome (não genérico) → {params, ret, unbound, recv}
  CK.exactMethodRef = function (x, env) {
    if (x.name === "new") return null;
    var tgt = x.target;
    if (tgt.k !== "Ident" && tgt.k !== "Select" && tgt.k !== "TypeExpr") return null;
    var n = this.errs.length;
    var tt;
    try { tt = tgt.k === "TypeExpr" ? null : this.qualTreeQuiet(tgt, env); } finally { this.errs.length = n; }
    if (!tt) return null;
    var site = tt.kind === "class" ? tt.sym.rawType() : tt.kind === "expr" ? tt.type : null;
    if (!site || isErr(site)) return null;
    if (tt.kind === "class" && tt.sym.tparams.length) return null;
    var ms = this.allMethods(site, x.name);
    if (ms.length !== 1) return null;
    var m = ms[0].m;
    if (m.tparams.length || m.varargs) return null;
    var params = m.params.map(function (p) { return memberType(p, ms[0].site, m.owner); });
    var ret = memberType(m.ret, ms[0].site, m.owner);
    if (tt.kind === "class" && !m.flags["static"]) return { params: params, ret: ret, unbound: true, recv: site };
    return { params: params, ret: ret, unbound: false };
  };
  CK.qualTreeQuiet = function (tgt, env) {
    // atribui sem deixar marcas (usado só para inspecionar)
    var save = this.errs.length;
    var r;
    if (tgt.k === "Ident") {
      var v = this.findVar(tgt.name, env);
      if (v) return { kind: "expr", type: v.kind === "local" ? v.sym.type : memberType(v.sym.type, v.site, v.sym.owner) };
      var ty = this.findType(tgt.name, env);
      if (ty) return { kind: "class", sym: ty };
      return null;
    }
    r = this.qualTree(cloneTree(tgt), env, false);
    this.errs.length = save;
    return r;
  };
  function cloneTree(e) {
    if (Array.isArray(e)) { var a = e.map(cloneTree); if (e.pos !== undefined) a.pos = e.pos; return a; }
    if (!e || typeof e !== "object") return e;
    if (e instanceof SourceFile) return e;
    var o = {};
    for (var k in e) {
      if (k === "type" && e[k] && typeof e[k] === "object" && /^(prim|class|array|tvar|null|err|wild|inter|diamond)$/.test(e[k].k)) continue;
      if (k === "ref" || k === "msym" || k === "cv" || k === "sym" || k === "head") continue;
      o[k] = cloneTree(e[k]);
    }
    return o;
  }

  // escolhe o método mais específico
  CK.mostSpecific = function (apps, argInfos, env) {
    var self = this;
    if (apps.length === 1) return apps[0];
    function formalOf(a, i) {
      var fs = a.res.formals;
      if (a.res.phase === 3 && i >= fs.length - 1) { var l = fs[fs.length - 1]; return l.k === "array" ? l.elem : l; }
      return fs[i];
    }
    function more(a, b) {
      var n = Math.max(argInfos.length, 0);
      if (a.res.phase === 3) n = Math.max(a.res.formals.length, b.res.formals.length);
      for (var i = 0; i < n; i++) {
        var fa = formalOf(a, i), fb = formalOf(b, i);
        if (!fa || !fb) continue;
        var ai = argInfos[i];
        if (ai && ai.poly && (ai.kind === "Lambda" || ai.kind === "MethodRef")) {
          var sa = self.samOf(fa), sb = self.samOf(fb);
          if (sa && sb && !sameType(erasure(fa), erasure(fb))) {
            if (isSubtype(fa, fb)) continue;
            if (sa.ret !== T["void"] && sb.ret === T["void"]) continue;
            if (sa.ret.k === "prim" && sa.ret !== T["void"] && sb.ret.k !== "prim") continue;
            if (sa.ret.k !== "prim" && sb.ret.k !== "prim" && sa.ret !== T["void"] && sb.ret !== T["void"] && isSubtype(sa.ret, sb.ret)) continue;
            return false;
          }
        }
        if (fa.k === "prim" && fb.k === "prim") { if (fa.n === fb.n || primWidens(fa, fb)) continue; return false; }
        var ea = a.res.fv ? erasure(fa) : eraseFree(fa), eb = b.res.fv ? erasure(fb) : eraseFree(fb);
        if (!isSubtype(eraseFree(fa), eraseFree(fb)) && !isSubtype(ea, eb)) {
          if (fa.k === "prim" && ai && !ai.poly && ai.type && ai.type.k === "prim" && fb.k !== "prim") continue;
          return false;
        }
      }
      return true;
    }
    var best = apps.filter(function (a) {
      return apps.every(function (b) { return a === b || more(a, b); });
    });
    if (best.length > 1) {
      // mesma assinatura: prefere o não abstrato / o da subclasse
      var conc = best.filter(function (a) { return !a.cand.m.flags.abstract; });
      if (conc.length === 1) return conc[0];
      var b0 = best[0];
      if (best.every(function (b) { return b.cand.m.params.length === b0.cand.m.params.length && b.res.formals.every(function (f, i) { return sameType(eraseFree(f), eraseFree(b0.res.formals[i])); }); })) {
        // escolhe o mais "derivado"
        var der = best.filter(function (a) { return best.every(function (b) { return a === b || isSubClass(a.cand.m.owner, b.cand.m.owner); }); });
        return der[0] || best[0];
      }
      return { ambiguous: best };
    }
    if (best.length === 1) return best[0];
    // nenhum é mais específico que todos: ambíguo
    return { ambiguous: apps.slice(0, 2) };
  };

  // resolve uma chamada entre candidatos; devolve {cand, res} ou reporta erro
  CK.resolveAmong = function (cands, argInfos, env, errInfo, extraVarsFn) {
    var self = this;
    for (var phase = 1; phase <= 3; phase++) {
      var apps = [];
      cands.forEach(function (c) {
        var r = self.applicable(c, argInfos, phase, env, extraVarsFn ? extraVarsFn(c) : null, c.siteMap);
        if (r.ok) apps.push({ cand: c, res: r });
      });
      if (apps.length) {
        var best = this.mostSpecific(apps, argInfos, env);
        if (best.ambiguous) {
          var a = best.ambiguous[0].cand.m, b = best.ambiguous[1].cand.m;
          this.err(env, errInfo.pos, "reference to " + errInfo.name + " is ambiguous\n  both " + methodDesc(a) + " in " + a.owner.name + " and " + methodDesc(b) + " in " + b.owner.name + " match");
          return null;
        }
        return best;
      }
    }
    this.reportInapplicable(cands, argInfos, env, errInfo);
    return null;
  };
  function paramsStr(m) {
    return m.params.map(function (p, i) { return m.varargs && i === m.params.length - 1 && p.k === "array" ? typeStr(p.elem) + "..." : typeStr(p); }).join(",");
  }
  function methodDesc(m) {
    if (m.name === "<init>") return "constructor " + m.owner.name + "(" + paramsStr(m) + ")";
    return "method " + (m.tparams.length ? "<" + m.tparams.map(function (t) { return t.name; }).join(",") + ">" : "") + m.name + "(" + paramsStr(m) + ")";
  }
  function sigStr(m) { return (m.name === "<init>" ? m.owner.name : m.name) + "(" + paramsStr(m) + ")"; }
  CK.reportInapplicable = function (cands, argInfos, env, info) {
    var self = this;
    // motivo de cada candidato (fase 2 ou 3)
    var reasons = cands.map(function (c) {
      var r = self.applicable(c, argInfos, 2, env, null, c.siteMap);
      if (r.arity && c.m.varargs) { var r3 = self.applicable(c, argInfos, 3, env, null, c.siteMap); if (!r3.arity) r = r3; }
      return { cand: c, r: r };
    });
    var found = argInfos.length ? argInfos.map(argTypeStr).join(",") : "no arguments";
    var kindWord = info.ctor ? "constructor" : "method";
    function mismatchText(r) {
      if (r.reason === "poly") {
        var ai = argInfos[r.argIndex];
        return "argument mismatch; " + (ai.kind === "Lambda" ? "incompatible parameter types in lambda expression" : "invalid method reference");
      }
      if (isLossy(r.actual, r.formal) && (r.actual.k === "prim" || r.formal.k === "prim")) return "argument mismatch; possible lossy conversion from " + typeStr(r.actual.k === "prim" ? r.actual : unboxedType(r.actual)) + " to " + typeStr(r.formal);
      return "argument mismatch; " + typeStr(r.actual) + " cannot be converted to " + typeStr(r.formal);
    }
    var nonArity = reasons.filter(function (x) { return !x.r.arity; });
    if (nonArity.length === 1 && nonArity[0].r.argIndex !== undefined && nonArity[0].r.reason !== "poly") {
      // forma "simplificada" do javac
      var r = nonArity[0].r, ai = argInfos[r.argIndex];
      if (isLossy(r.actual, r.formal) && (r.actual.k === "prim" || r.formal.k === "prim")) this.err(env, ai.node.pos, "incompatible types: possible lossy conversion from " + typeStr(r.actual.k === "prim" ? r.actual : unboxedType(r.actual)) + " to " + typeStr(r.formal));
      else this.err(env, ai.node.pos, "incompatible types: " + typeStr(r.actual) + " cannot be converted to " + typeStr(r.formal) + this.whereFor([r.actual, r.formal]));
      this.simplified = true;
      return;
    }
    if (cands.length === 1) {
      var c = cands[0], m = c.m;
      var req = m.params.length ? m.params.map(function (p) { return typeStr(c.siteMap ? subst(p, c.siteMap) : memberType(p, c.site, m.owner)); }).join(",") : "no arguments";
      var rr = reasons[0].r;
      var reason = rr.arity ? "actual and formal argument lists differ in length" : mismatchText(rr);
      var nm = info.ctor ? m.owner.name : m.name;
      var where = info.ctor ? "class " + m.owner.name : (m.owner.kindName() + " " + typeStr(m.owner.thisType()));
      if (m.tparams.length) {
        this.err(env, info.pos, kindWord + " " + nm + " in " + where + " cannot be applied to given types;\n  required: " + req + "\n  found:    " + found + "\n  reason: cannot infer type-variable(s) " + m.tparams.map(function (t) { return t.name; }).join(",") + "\n    (" + reason + ")" + this.whereFor(m.tparams.map(function (t) { return t.type; })));
      } else {
        this.err(env, info.pos, kindWord + " " + nm + " in " + where + " cannot be applied to given types;\n  required: " + req + "\n  found:    " + found + "\n  reason: " + reason + this.whereFor([m.owner.thisType()]));
      }
      return;
    }
    var txt = "no suitable " + kindWord + " found for " + info.name + "(" + found + ")";
    reasons.forEach(function (x) {
      var m = x.cand.m;
      var desc = info.ctor ? "constructor " + qualName(m.owner) + "." + sigStr(m) : "method " + qualName(m.owner) + "." + (m.tparams.length ? "<" + m.tparams.map(function (t) { return t.name; }).join(",") + ">" : "") + sigStr(m);
      txt += "\n    " + desc + " is not applicable";
      txt += "\n      (" + (x.r.arity ? "actual and formal argument lists differ in length" : mismatchText(x.r)) + ")";
    });
    this.err(env, info.pos, txt);
  };
  function qualName(sym) { return sym.outer ? qualName(sym.outer) + "." + sym.name : sym.name; }

  // ---------- chamadas de método ----------
  Infer.prototype.activate = function () { this.vars.forEach(function (v) { v.inferring = true; }); };
  CK.attribCall = function (e, env, pt) {
    var head = this.callHead(e, env);
    return this.callFinish(e, head, env, pt, null);
  };
  CK.callHead = function (e, env) {
    var self = this, name = e.name, cands = null, site = null, depth = 0, staticSite = false, superCall = false, ifaceSuper = null;
    var info = { pos: e.namePos, name: name };
    var locDesc = null;
    if (!e.target) {
      var d = 0;
      for (var x = env; x; x = x.outerEnv) {
        if (x.cls) {
          var ms = this.allMethods(x.cls.thisType(), name);
          if (ms.length) { cands = ms; site = x.cls.thisType(); depth = d; e.foundEnv = x; break; }
          d++;
        }
      }
      if (!cands && env.cu) {
        var cu = env.cu, si = [];
        (cu.staticSingle[name] || []).forEach(function (s) { completeAny(self, s); (s.methods[name] || []).forEach(function (m) { if (m.flags["static"]) si.push({ m: m, site: s.rawType() }); }); });
        if (!si.length) cu.staticStar.forEach(function (s) { completeAny(self, s); self.allMethods(s.rawType(), name).forEach(function (c) { if (c.m.flags["static"]) si.push(c); }); });
        if (si.length) { cands = si; staticSite = true; e.staticImport = true; }
      }
      locDesc = this.locationOf(env) + this.whereFor([env.cls ? env.cls.thisType() : null]);
      e.implicitDepth = depth;
    } else if (e.target.k === "Super") {
      if (env.isStatic) { this.err(env, e.target.pos, "non-static variable super cannot be referenced from a static context"); this.attribArgs(e.args, env); return null; }
      if (e.target.qual) {
        // Interface.super.m()
        var qt = this.resolveType(e.target.qual, env);
        if (qt.k === "class" && qt.sym.isInterface()) { site = (env.cls.ifaces.filter(function (i) { return i.sym === qt.sym; })[0]) || qt; ifaceSuper = qt.sym; }
        else site = qt.k === "class" ? (qt.sym.superT || OBJ()) : OBJ();
      } else site = env.cls.superT || OBJ();
      cands = this.allMethods(site, name);
      superCall = true;
      locDesc = "class " + typeStr(site);
    } else {
      var tt = this.qualTree(e.target, env, false);
      if (tt.kind === "class") {
        site = tt.sym.rawType(); staticSite = true;
        cands = this.allMethods(tt.sym.thisType(), name).map(function (c) { return c; });
        locDesc = tt.sym.kindName() + " " + typeStr(tt.sym.thisType()) + this.whereFor([tt.sym.thisType()]);
      } else if (tt.kind === "expr") {
        var t = tt.type;
        if (isErr(t)) { this.attribArgs(e.args, env); return null; }
        if (t.k === "prim") { this.err(env, e.namePos, t.n + " cannot be dereferenced"); this.attribArgs(e.args, env); return null; }
        if (t.k === "null") { this.err(env, e.namePos, "<null> cannot be dereferenced"); this.attribArgs(e.args, env); return null; }
        if (t === T["void"]) { this.err(env, e.namePos, "void cannot be dereferenced"); this.attribArgs(e.args, env); return null; }
        site = t.k === "wild" ? capUpper(t) : t;
        e.recvType = site;
        cands = this.allMethods(site, name);
        if (t.k === "array" && name === "clone") cands = [{ m: arrayCloneMethod(t), site: t }];
        locDesc = this.exprLocation(e.target, t);
      } else { this.attribArgs(e.args, env); return null; }
    }
    var args = this.attribArgs(e.args, env);
    if (!cands || !cands.length) {
      if (args.some(function (a) { return !a.poly && isErr(a.type); })) return null;
      this.err(env, info.pos, "cannot find symbol\n  symbol:   method " + name + "(" + args.map(argTypeStr).join(",") + ")\n  location: " + locDesc);
      return null;
    }
    if (args.some(function (a) { return !a.poly && isErr(a.type); })) { this.completeDeferredLoosely(args, env); return null; }
    var best = this.resolveAmong(cands, args, env, info);
    if (!best) { this.completeDeferredLoosely(args, env); return null; }
    var m = best.cand.m;
    // estático x instância
    if (!m.flags["static"]) {
      if (staticSite && !superCall) {
        this.err(env, info.pos, "non-static method " + sigStr(m) + " cannot be referenced from a static context");
        this.completeDeferredLoosely(args, env); return null;
      }
      if (!e.target) {
        var rr = { depth: depth };
        if (this.isStaticAt(env, rr)) { this.err(env, info.pos, "non-static method " + sigStr(m) + " cannot be referenced from a static context"); this.completeDeferredLoosely(args, env); return null; }
        if (env.ctorPrologue && depth === 0) this.err(env, info.pos, "cannot reference " + name + "(" + ") before supertype constructor has been called");
      }
    } else if (m.owner.isInterface() && e.target && !staticSite && !superCall) {
      this.err(env, info.pos, "illegal static interface method call\n  the receiver expression should be replaced with the type qualifier '" + m.owner.name + "<>'");
    }
    if (superCall && m.flags.abstract) { this.err(env, info.pos, "abstract method " + sigStr(m) + " in " + m.owner.kindName() + " " + m.owner.name + " cannot be accessed directly"); }
    this.checkAccess(m, info.pos, env);
    var head = { e: e, best: best, args: args, site: best.cand.site || site, staticSite: staticSite, superCall: superCall, depth: depth, ifaceSuper: ifaceSuper, env: env };
    var inf = best.res.inf;
    if (inf) {
      head.inf = inf;
      var ret = memberType(m.ret, best.cand.site, m.owner);
      ret = subst(ret, best.res.fv.map);
      head.ret = ret;
      inf.activate();
      // poli: o tipo de retorno depende de variáveis ainda não resolvidas
      var part = this.partialSolve(inf);
      var prov = subst(ret, part);
      if (inf.mentions(prov) && !e.typeArgs) { head.isPoly = true; head.provType = prov; }
    }
    return head;
  };
  // lambdas de chamadas que falharam: atribui sem tipo (para não perder outros erros)
  CK.completeDeferredLoosely = function (args, env) {
    var self = this;
    args.forEach(function (a) {
      if (!a.poly) return;
      if (a.kind === "Call") { try { self.completeArg(a, null, env, null); } catch (x) { if (x !== DEFER_FAIL) throw x; } }
      a.inner.type = T_ERR;
    });
  };
  function arrayCloneMethod(t) {
    var m = new MethodSym("clone", L("java.lang.Object"));
    m.ret = t; m.flags = { "public": true }; m.key = "clone()"; m.arrayClone = true;
    return m;
  }
  CK.callFinish = function (e, head, env, pt, outerInf) {
    if (!head) { e.type = T_ERR; return T_ERR; }
    var self = this, best = head.best, m = best.cand.m, res = best.res, inf = res.inf, args = head.args;
    var formals = res.formals.slice();
    var ret = head.ret || memberType(m.ret, best.cand.site, m.owner);
    function formalAt(i) {
      if (res.phase === 3 && i >= formals.length - 1) { var l = formals[formals.length - 1]; return l.k === "array" ? l.elem : l; }
      return formals[i];
    }
    if (inf) {
      inf.activate();
      // tipos explícitos: obj.<String>metodo()
      if (e.typeArgs && !e.typeArgs.diamond) {
        e.typeArgs.list.forEach(function (ta, i) { if (res.fv.vars[i]) inf.unify(res.fv.vars[i].type, self.resolveType(ta, env), "eq"); });
      }
      if (pt && pt !== T["void"] && !isErr(pt)) inf.unify(ret, pt.k === "prim" ? boxedType(pt) : pt, "upper");
      args.forEach(function (ai, i) {
        if (!ai.poly) return;
        var f = formalAt(i);
        var cur = subst(f, inf.solvedMap());
        if ((ai.kind === "Lambda" || ai.kind === "MethodRef") && cur.k === "tvar" && inf.ids[cur.sym.id]) { inf.solve([cur.sym]); cur = subst(f, inf.solvedMap()); }
        var part = self.partialSolve(inf);
        var ss = (ai.kind === "Lambda" || ai.kind === "MethodRef") ? self.samOf(subst(cur, part)) : null;
        if (ss) {
          var need = [];
          self.samOf(cur) && self.samOf(cur).params.forEach(function (p) { inf.freeIn(p).forEach(function (v) { if (need.indexOf(v) < 0) need.push(v); }); });
          if (need.length) inf.solve(need);
          cur = subst(f, inf.solvedMap());
        }
        if (ai.kind === "Call") { var pm = self.partialSolve(inf), sm = inf.solvedMap(); for (var q in sm) pm[q] = sm[q]; cur = subst(f, pm); }
        var t = self.completeArg(ai, cur, env, inf);
        if (ai.kind === "Call" && !isErr(t)) inf.unify(f, t, "lower");
      });
      var map = inf.solve();
      formals = formals.map(function (f) { return subst(f, map); });
      ret = subst(ret, map);
      inf.finish();
      if (inf.conflict) {
        var cf = inf.conflict, ov = cf.v.orig || cf.v;
        this.err(env, e.pos, "incompatible types: inference variable " + ov.name + " has incompatible bounds\n    equality constraints: " + typeStr(cf.eq) + "\n    lower bounds: " + cf.lower.slice().reverse().map(typeStr).join(",") + this.whereFor([ov.type]));
        e.type = T_ERR; return T_ERR;
      }
    } else {
      args.forEach(function (ai, i) { if (ai.poly) self.completeArg(ai, formalAt(i), env, null); });
    }
    // chamada sobre tipo cru: apaga
    var site = best.cand.site;
    if (site && site.k === "class" && !site.args && (site.sym.tparams.length || m.owner.tparams.length) && !m.flags["static"] && !head.staticSite && m.owner.tparams.length) {
      ret = erasure(ret);
      if (m.params.some(mentionsTvars)) this.unchecked();
    }
    if (m.name === "getClass" && m.params.length === 0 && m.owner.full === "java.lang.Object") {
      var st = head.site && !head.staticSite ? head.site : (env.cls ? env.cls.thisType() : OBJ());
      if (!e.target) st = env.cls.thisType();
      ret = new ClassType(L("java.lang.Class"), [new WildType("extends", erasure(st))]);
    }
    e.msym = m;
    if (m.deprecated) this.prog.notes.deprecation = true;
    if (m.varargs && res.phase < 3 && args.length === m.params.length) {
      var lastA = args[args.length - 1], lastF = formals[formals.length - 1];
      if (lastA && !lastA.poly && lastA.type && lastA.type.k === "array" && lastF.k === "array" && !sameType(lastA.type, lastF) && lastF.elem.k !== "prim" && isSubtype(lastA.type, lastF.elem)) {
        this.warn(env, lastA.node.pos, "non-varargs call of varargs method with inexact argument type for last parameter;\n  cast to " + typeStr(lastF.elem) + " for a varargs call\n  cast to " + typeStr(lastF) + " for a non-varargs call and to suppress this warning");
      }
    }
    e.formals = formals;
    e.varargsCall = res.phase === 3;
    e.callSite = head.site;
    e.superCall = head.superCall;
    e.ifaceSuper = head.ifaceSuper;
    e.staticSite = head.staticSite;
    e.thrown = m.throws.map(function (t) { return inf ? subst(subst(memberType(t, site, m.owner), res.fv.map), inf.solvedMap()) : memberType(t, site, m.owner); });
    // argumentos com tipos finais
    args.forEach(function (ai, i) { if (!ai.poly && !isErr(ai.type)) { /* já verificado na aplicabilidade */ } });
    ret = capUpper(ret);
    if (ret.k === "class" && ret.args && ret.args.some(function (a) { return a.k === "wild"; })) { /* mantém */ }
    e.type = ret;
    return ret;
  };

  // ---------- new ----------
  CK.attribNew = function (e, env, pt) {
    var head = this.newHead(e, env);
    return this.newFinish(e, head, env, pt, null);
  };
  CK.newHead = function (e, env) {
    var self = this, t, sym, outerType = null;
    if (e.outer) {
      outerType = this.attribExpr(e.outer, env, null);
      if (isErr(outerType)) { this.attribArgs(e.args, env); return null; }
      if (outerType.k !== "class") { this.err(env, e.pos, "unexpected type"); return null; }
      var nm = e.type.parts[0].name;
      var inner = this.findMemberType(outerType.sym, nm);
      if (!inner) { this.cannotFindClass(env, e.type.pos, nm, "class " + outerType.sym.name); this.attribArgs(e.args, env); return null; }
      var lp = e.type.parts[e.type.parts.length - 1];
      if (lp.args && !lp.args.diamond) t = new ClassType(inner, lp.args.list.map(function (a) { return self.resolveType(a, env); }));
      else if (lp.args && lp.args.diamond) t = { k: "diamond", sym: inner };
      else t = inner.rawType();
    } else t = this.resolveType(e.type, env, { diamondOk: true });
    if (isErr(t)) { this.attribArgs(e.args, env); if (e.body) this.attribAnonLoosely(e, env); return null; }
    if (t.k === "prim") { this.err(env, e.pos, "'[' expected"); return null; }
    if (t.k === "tvar") { this.err(env, e.type.pos, "unexpected type\n  required: class\n  found:    type parameter " + t.sym.name); this.attribArgs(e.args, env); return null; }
    var diamond = t.k === "diamond";
    sym = t.sym;
    completeAny(this, sym);
    if (!e.body) {
      if (sym.isInterface()) { this.err(env, e.pos, sym.name + " is abstract; cannot be instantiated"); this.attribArgs(e.args, env); return null; }
      if (sym.flags.abstract) { this.err(env, e.pos, sym.name + " is abstract; cannot be instantiated"); this.attribArgs(e.args, env); return null; }
    }
    if (sym.isEnum()) { this.err(env, e.pos, "enum classes may not be instantiated"); this.attribArgs(e.args, env); return null; }
    var head = { e: e, sym: sym, t: t, diamond: diamond, outerType: outerType, env: env };
    // instância externa
    if (sym.inner && !e.outer) {
      var ok = false, d = 0;
      for (var x = env, dd = 0; x; x = x.outerEnv) {
        if (x.cls && (x.cls === sym.outer || isSubClass(x.cls, sym.outer))) { ok = !this.isStaticAt(env, { depth: dd }); d = dd; break; }
        if (x.cls && (!x.outerEnv || x.outerEnv.cls !== x.cls)) dd++;
      }
      if (!ok) { this.err(env, e.pos, "non-static variable this cannot be referenced from a static context"); this.attribArgs(e.args, env); return null; }
      head.outerDepth = this.outerDepth(env, sym.outer);
    }
    if ((sym.local || sym.anon) && sym.inner && !e.body) {
      if (env.isStatic && sym.localEnv && !sym.localEnv.isStatic) { /* raro */ }
    }
    var args = this.attribArgs(e.args, env);
    head.args = args;
    if (args.some(function (a) { return !a.poly && isErr(a.type); })) { if (e.body) this.attribAnonLoosely(e, env); return null; }
    if (sym.isInterface()) {
      // classe anônima que implementa interface: só o construtor sem argumentos
      if (args.length) { this.err(env, e.pos, "anonymous class implements interface; cannot have arguments"); return null; }
      head.best = null;
      head.ifaceAnon = true;
      return head;
    }
    var site = diamond ? sym.thisType() : t;
    var cands = sym.ctors.map(function (c) { return { m: c, site: site }; });
    var best = this.resolveAmong(cands, args, env, { pos: e.pos, name: sym.name, ctor: true }, diamond ? function () { return sym.tparams; } : null);
    if (!best) { this.completeDeferredLoosely(args, env); if (e.body) this.attribAnonLoosely(e, env); return null; }
    this.checkAccess(best.cand.m, e.pos, env);
    head.best = best;
    if (best.res.inf) {
      head.inf = best.res.inf;
      head.inf.activate();
      if (diamond) {
        var fv = best.res.fv;
        var clsVars = sym.tparams.map(function (tv) { return fv.map[tv.id]; });
        head.ret = new ClassType(sym, clsVars);
        var part = this.partialSolve(head.inf);
        head.provType = subst(head.ret, part);
        head.isPoly = !e.body && head.inf.mentions(head.provType);
      }
    }
    return head;
  };
  CK.attribAnonLoosely = function (e, env) { /* corpo de classe anônima com tipo errado: ignorado */ };
  CK.newFinish = function (e, head, env, pt, outerInf) {
    if (!head) { e.type = T_ERR; return T_ERR; }
    var self = this, sym = head.sym, t = head.t, best = head.best, args = head.args;
    var resultType = head.diamond ? null : t;
    if (best) {
      var res = best.res, inf = res.inf, formals = res.formals.slice();
      var formalAt = function (i) {
        if (res.phase === 3 && i >= formals.length - 1) { var l = formals[formals.length - 1]; return l.k === "array" ? l.elem : l; }
        return formals[i];
      };
      if (inf) {
        inf.activate();
        if (head.diamond && pt && !isErr(pt) && pt.k !== "prim") inf.unify(head.ret, pt, "upper");
        args.forEach(function (ai, i) {
          if (!ai.poly) return;
          var f = formalAt(i);
          var cur = subst(f, inf.solvedMap());
          if ((ai.kind === "Lambda" || ai.kind === "MethodRef") && cur.k === "tvar" && inf.ids[cur.sym.id]) { inf.solve([cur.sym]); cur = subst(f, inf.solvedMap()); }
          var ss0 = (ai.kind === "Lambda" || ai.kind === "MethodRef") ? self.samOf(cur) : null;
          if (ss0) {
            var need = [];
            ss0.params.forEach(function (p) { inf.freeIn(p).forEach(function (v) { if (need.indexOf(v) < 0) need.push(v); }); });
            if (need.length) inf.solve(need);
            cur = subst(f, inf.solvedMap());
          }
          if (ai.kind === "Call") { var pm2 = self.partialSolve(inf), sm2 = inf.solvedMap(); for (var q2 in sm2) pm2[q2] = sm2[q2]; cur = subst(f, pm2); }
          var at = self.completeArg(ai, cur, env, inf);
          if (ai.kind === "Call" && !isErr(at)) inf.unify(f, at, "lower");
        });
        var map = inf.solve();
        formals = formals.map(function (f) { return subst(f, map); });
        if (head.diamond) resultType = subst(head.ret, map);
        inf.finish();
      } else {
        args.forEach(function (ai, i) { if (ai.poly) self.completeArg(ai, formalAt(i), env, null); });
        if (head.diamond) resultType = sym.rawType();
      }
      e.csym = best.cand.m;
      e.formals = formals;
      e.varargsCall = res.phase === 3;
      e.thrown = best.cand.m.throws.slice();
      if (best.cand.m.deprecated) this.prog.notes.deprecation = true;
    } else if (head.diamond) {
      // interface anônima com diamante
      resultType = pt && pt.k === "class" ? asSuper(pt, sym) || sym.rawType() : sym.rawType();
    }
    if (!resultType) resultType = sym.rawType();
    e.clsSym = sym;
    e.outerDepth = head.outerDepth;
    if (e.body) {
      var anonOf = resultType;
      if (anonOf.k === "class" && anonOf.args) anonOf = new ClassType(anonOf.sym, anonOf.args.map(capUpperArg));
      var asym = this.declareAnon(e, env, anonOf);
      e.anonSym = asym;
      e.type = anonOf;
      return anonOf;
    }
    if (resultType.k === "class" && !resultType.args && sym.tparams.length && !head.diamond) {
      if (best && best.cand.m.params.some(mentionsTvars)) this.unchecked();
    }
    e.type = resultType;
    return resultType;
  };
  // classe anônima: entra, completa e verifica o corpo agora
  CK.declareAnon = function (e, env, anonOf) {
    var d = e.body;
    d.anon = true;
    var localScope = { staticCtx: env.isStatic };
    var sym = this.enterClass(d, env.cls, env.cu, localScope);
    sym.anonOf = anonOf;
    sym.localEnv = env;
    sym.staticCtx = env.isStatic;
    sym.inner = !env.isStatic;
    sym.creationFrame = env.frame;
    var cenv = this.classEnv(sym);
    cenv.outerEnv = env;
    this.headerClass(sym);
    this.membersClass(sym);
    // construtor anônimo repassa os argumentos para o da superclasse
    if (e.csym && !sym.anonOf.sym.isInterface()) {
      var c = sym.ctors[0];
      c.params = e.formals ? e.formals.slice() : [];
      c.varargs = false;
      c.key = methodKey("<init>", c.params);
      c.anonSuper = e.csym;
      c.anonVarargs = e.varargsCall;
    }
    this.attribClass(sym);
    return sym;
  };

  // ---------- arrays ----------
  CK.attribNewArray = function (e, env) {
    var self = this;
    var et = this.resolveType(e.elemType, env);
    e.dims.forEach(function (d) { var t = self.attribExpr(d, env, null); self.checkIndex(d, t, env); });
    if (isErr(et)) { if (e.init) this.attribExpr(e.init, env, null); return T_ERR; }
    if (et.k === "tvar" || (et.k === "class" && et.args && !isReifiable(et))) {
      this.err(env, e.pos, "generic array creation");
      return T_ERR;
    }
    var t = et, n = e.dims.length + e.extraDims;
    for (var i = 0; i < n; i++) t = new ArrayType(t);
    if (e.init) this.attribExpr(e.init, env, t);
    e.arrType = t;
    return t;
  };

  // ---------- this(...) / super(...) ----------
  CK.attribCtorCall = function (e, env) {
    var self = this;
    if (!env.ctor) {
      this.err(env, e.kwPos, "explicit constructor invocation may only appear within a constructor body");
      this.attribArgs(e.args, env);
      return T["void"];
    }
    var penv = env.dup({ ctorPrologue: true });
    var args = this.attribArgs(e.args, penv);
    if (args.some(function (a) { return !a.poly && isErr(a.type); })) return T["void"];
    var target = e.kind === "this" ? env.cls : (env.cls.superT ? env.cls.superT.sym : null);
    if (!target) return T["void"];
    completeAny(this, target);
    var site = e.kind === "this" ? env.cls.thisType() : env.cls.superT;
    if (env.cls.isEnum() && e.kind === "super") { this.err(env, e.kwPos, "call to super not allowed in enum constructor"); return T["void"]; }
    var cands = target.ctors.map(function (c) { return { m: c, site: site }; });
    var best = this.resolveAmong(cands, args, penv, { pos: e.kwPos, name: target.name, ctor: true });
    if (!best) return T["void"];
    this.checkAccess(best.cand.m, e.kwPos, env);
    var fake = { args: args, best: best };
    var res = best.res, formals = res.formals;
    args.forEach(function (ai, i) {
      if (ai.poly) {
        var f = res.phase === 3 && i >= formals.length - 1 ? formals[formals.length - 1].elem : formals[i];
        self.completeArg(ai, f, penv, null);
      }
    });
    e.csym = best.cand.m;
    e.formals = formals;
    e.varargsCall = res.phase === 3;
    e.thrown = best.cand.m.throws.slice();
    if (e.kind === "this" && best.cand.m === env.method) this.err(env, e.kwPos, "recursive constructor invocation");
    return T["void"];
  };

  // ---------- lambdas ----------
  CK.attribLambda = function (e, env, pt, inf) {
    var self = this;
    if (!pt || isErr(pt)) {
      if (!pt) this.err(env, e.start !== undefined ? e.start : e.pos, "lambda expression not expected here");
      return T_ERR;
    }
    var ss = this.samOf(pt);
    if (!ss) {
      this.err(env, e.start !== undefined ? e.start : e.pos, "incompatible types: " + typeStr(pt) + " is not a functional interface");
      return T_ERR;
    }
    var params = ss.params, ret = ss.ret;
    if (inf) {
      var need = [];
      params.forEach(function (p) { inf.freeIn(p).forEach(function (v) { if (need.indexOf(v) < 0) need.push(v); }); });
      if (need.length) { var mp = inf.solve(need); params = params.map(function (p) { return subst(p, mp); }); ret = subst(ret, inf.solvedMap()); }
      else { params = params.map(function (p) { return subst(p, inf.solvedMap()); }); ret = subst(ret, inf.solvedMap()); }
    }
    if (e.params.length !== params.length) {
      this.err(env, e.start !== undefined ? e.start : e.pos, "incompatible types: incompatible parameter types in lambda expression");
      return T_ERR;
    }
    if (!(inf && inf.mentions(ret))) { var oi = ownerInf(ret); if (oi) inf = oi; }
    var frame = { kind: "lambda", captures: [], parentFrame: env.frame, node: e };
    e.frame = frame;
    var lenv = env.dup({ scope: new Scope(env.scope), frame: frame, ret: ret, retInf: inf && inf.mentions(ret) ? inf : null, inLoop: 0, inSwitch: 0, labels: [], yieldTarget: null, slotInfo: new SlotInfo(0), lambdaNode: e, inLambda: true });
    e.paramSyms = e.params.map(function (p, i) {
      var t;
      if (p.type && p.type.k !== "VarType") t = self.resolveType(p.type, env);
      else t = capUpper(params[i]);
      var v = new VarSym(p.name, t, "param");
      v.pos = p.pos; v.hasInit = true;
      if (p.mods && p.mods.flags && p.mods.flags["final"]) v.flags["final"] = true;
      if (p.name !== "_") self.declareVar(v, lenv);
      return v;
    });
    e.sam = ss.sam; e.ftype = pt; e.samParams = params; e.samRet = ret;
    if (e.body.k === "Block") {
      lenv.lambdaReturns = [];
      this.attribBlock(e.body, lenv);
      if (lenv.retInf && lenv.lambdaReturns.length) lenv.lambdaReturns.forEach(function (rt) { inf.unify(ret, rt, "lower"); });
    } else {
      if (ret === T["void"]) {
        this.attribExpr(e.body, lenv, null);
        if (!isStatementExpr(e.body) && !isErr(e.body.type || T_ERR)) this.err(env, e.body.pos, "incompatible types: lambda body is not compatible with a void functional interface\n    (consider using a block lambda body, or use a statement expression instead)");
      } else {
        var tgt = inf && inf.mentions(ret) ? null : ret;
        var bt = this.attribExpr(e.body, lenv, tgt);
        if (!isErr(bt)) {
          if (bt === T["void"]) this.err(env, e.body.pos, "incompatible types: bad return type in lambda expression\n    void cannot be converted to " + typeStr(ret));
          else if (inf && inf.mentions(ret)) inf.unify(ret, bt, "lower");
          else if (!assignConv(bt, ret, e.body.cv)) {
            if (isLossy(bt, ret)) this.err(env, e.body.pos, "incompatible types: bad return type in lambda expression\n    possible lossy conversion from " + typeStr(bt) + " to " + typeStr(ret));
            else this.err(env, e.body.pos, "incompatible types: bad return type in lambda expression\n    " + typeStr(bt) + " cannot be converted to " + typeStr(ret));
          }
        }
      }
    }
    e.frameSize = lenv.slotInfo.max;
    return pt;
  };

  // ---------- referências de método ----------
  CK.attribMethodRef = function (e, env, pt, inf) {
    var self = this;
    if (!pt || isErr(pt)) { if (!pt) this.err(env, e.pos, "method reference not expected here"); return T_ERR; }
    var ss = this.samOf(pt);
    if (!ss) { this.err(env, e.pos, "incompatible types: " + typeStr(pt) + " is not a functional interface"); return T_ERR; }
    var params = ss.params, ret = ss.ret;
    if (inf) {
      var need = [];
      params.forEach(function (p) { inf.freeIn(p).forEach(function (v) { if (need.indexOf(v) < 0) need.push(v); }); });
      if (need.length) inf.solve(need);
      params = params.map(function (p) { return subst(p, inf.solvedMap()); });
      ret = subst(ret, inf.solvedMap());
    }
    params = params.map(capUpper);
    if (!(inf && inf.mentions(ret))) { var oi2 = ownerInf(ret); if (oi2) inf = oi2; }
    var fakeArgs = function (ps) { return ps.map(function (t) { return { node: e, type: t }; }); };
    var name = e.name, chosen = null, kind = null, site = null, mret = null;
    var tgt = e.target;
    function quietResolve(cands, ps) {
      var n = self.errs.length;
      var r = cands.length ? self.resolveAmong(cands, fakeArgs(ps), env, { pos: e.pos, name: name }) : null;
      self.errs.length = n;
      return r;
    }
    if (tgt.k === "TypeExpr" && name === "new") {
      var at = this.resolveType(tgt.type, env);
      if (at.k !== "array") { this.err(env, e.pos, "unexpected type"); return T_ERR; }
      e.refKind = "arrayCtor"; e.arrType = at; mret = at;
    } else {
      var tt;
      if (tgt.k === "Super") { tt = { kind: "expr", type: env.cls.superT || OBJ() }; e.superRef = true; }
      else if (tgt.k === "TypeExpr") tt = { kind: "class", sym: null, type: this.resolveType(tgt.type, env) };
      else tt = this.qualTree(tgt, env, false);
      if (tt.kind === "expr" && isErr(tt.type)) return T_ERR;
      if (tt.kind === "class") {
        var csym = tt.sym || (tt.type && tt.type.sym);
        var ctype = tt.type || csym.rawType();
        if (tgt.k === "TypeExpr" && tgt.type.k === "ClassType") ctype = tt.type;
        completeAny(this, csym);
        if (name === "new") {
          if (csym.flags.abstract) { this.err(env, e.pos, csym.name + " is abstract; cannot be instantiated"); return T_ERR; }
          var gsite = csym.tparams.length && !ctype.args ? csym.thisType() : ctype;
          var cc = csym.ctors.map(function (c) { return { m: c, site: gsite }; });
          var n0 = this.errs.length;
          var br = cc.length ? this.resolveAmong(cc, fakeArgs(params), env, { pos: e.pos, name: csym.name, ctor: true }, csym.tparams.length && !ctype.args ? function () { return csym.tparams; } : null) : null;
          this.errs.length = n0;
          if (!br) { this.err(env, e.pos, "incompatible types: invalid constructor reference\n    constructor " + csym.name + " in class " + csym.name + " cannot be applied to given types"); return T_ERR; }
          chosen = br.cand.m; kind = "ctor";
          if (br.res.inf && csym.tparams.length && !ctype.args && inf && ret && ret.k === "tvar" && inf.ids[ret.sym.id] && ret.sym.bounds.length) {
            br.res.inf.finish();
            mret = new ClassType(csym, null); mret = Object.create(mret); mret.ctorRef = true;
          } else if (br.res.inf) {
            var inf2 = br.res.inf; inf2.activate();
            var cret = new ClassType(csym, csym.tparams.map(function (tv) { return br.res.fv.map[tv.id]; }));
            if (ret && ret !== T["void"]) inf2.unify(cret, ret.k === "prim" ? boxedType(ret) : ret, "upper");
            var mp2 = inf2.solve(); mret = subst(cret, mp2); inf2.finish();
          } else mret = ctype;
          e.clsSym = csym;
          e.formals = br.res.formals;
          e.varargsCall = br.res.phase === 3;
        } else {
          var all = this.allMethods(csym.thisType(), name);
          var stat = all.filter(function (c) { return c.m.flags["static"]; });
          var inst = all.filter(function (c) { return !c.m.flags["static"]; });
          var r1 = quietResolve(stat, params);
          var r2 = null;
          if (params.length >= 1 && (isSubtype(params[0], ctype) || isSubtype(erasure(params[0]), erasure(ctype)))) {
            var rsite = asSuper(params[0], csym) || ctype;
            var inst2 = this.allMethods(rsite, name).filter(function (c) { return !c.m.flags["static"]; });
            r2 = quietResolve(inst2, params.slice(1));
            if (r2) site = rsite;
          }
          if (r1 && r2) { this.err(env, e.pos, "incompatible types: invalid method reference\n    reference to " + name + " is ambiguous\n      both " + methodDesc(r1.cand.m) + " in " + r1.cand.m.owner.name + " and " + methodDesc(r2.cand.m) + " in " + r2.cand.m.owner.name + " match"); return T_ERR; }
          var r = r1 || r2;
          if (!r) {
            var anyInst = quietResolve(inst, params);
            if (anyInst) { this.err(env, e.pos, "incompatible types: invalid method reference\n    unexpected instance method " + sigStr(anyInst.cand.m) + " found in unbound lookup"); return T_ERR; }
            this.err(env, e.pos, "invalid method reference\n  cannot find symbol\n    symbol:   method " + name + "(" + params.map(typeStr).join(",") + ")\n    location: " + csym.kindName() + " " + typeStr(csym.thisType()));
            return T_ERR;
          }
          chosen = r.cand.m; kind = r === r1 ? "static" : "unbound";
          if (!site) site = r.cand.site;
          mret = this.mrefRet(r, ret);
          e.formals = r.res.formals; e.varargsCall = r.res.phase === 3;
        }
      } else {
        var st = tt.type;
        if (st.k === "prim") { this.err(env, e.pos, st.n + " cannot be dereferenced"); return T_ERR; }
        var cands = this.allMethods(st, name);
        var rb = quietResolve(cands, params);
        if (!rb) {
          this.err(env, e.pos, "invalid method reference\n  cannot find symbol\n    symbol:   method " + name + "(" + params.map(typeStr).join(",") + ")\n    location: " + (st.k === "class" ? st.sym.kindName() + " " + typeStr(st) : "class " + typeStr(st)));
          return T_ERR;
        }
        chosen = rb.cand.m; kind = e.superRef ? "super" : (chosen.flags["static"] ? "static" : "bound");
        if (chosen.flags["static"] && !e.superRef) { this.err(env, e.pos, "incompatible types: invalid method reference\n    unexpected static method " + sigStr(chosen) + " found in bound lookup"); return T_ERR; }
        site = rb.cand.site;
        mret = this.mrefRet(rb, ret);
        e.formals = rb.res.formals; e.varargsCall = rb.res.phase === 3;
      }
    }
    e.msym = chosen; e.refKind = e.refKind || kind; e.ftype = pt; e.sam = ss.sam; e.samParams = params; e.samRet = ret; e.mrefSite = site;
    if (chosen) e.thrown = chosen.throws.slice();
    if (ret !== T["void"] && mret) {
      if (mret === T["void"]) { this.err(env, e.pos, "incompatible types: bad return type in method reference\n    void cannot be converted to " + typeStr(ret)); return T_ERR; }
      if (inf && inf.mentions(ret)) inf.unify(ret, mret, "lower");
      else if (!looseConv(mret, ret) && !isErr(mret)) { this.err(env, e.pos, "incompatible types: bad return type in method reference\n    " + typeStr(mret) + " cannot be converted to " + typeStr(ret)); return T_ERR; }
    }
    e.mret = mret;
    return pt;
  };
  CK.mrefRet = function (r, samRet) {
    var m = r.cand.m, ret = memberType(m.ret, r.cand.site, m.owner);
    if (r.res.inf) {
      var inf = r.res.inf; inf.activate();
      ret = subst(ret, r.res.fv.map);
      if (samRet && samRet !== T["void"]) inf.unify(ret, samRet.k === "prim" ? boxedType(samRet) : samRet, "upper");
      var mp = inf.solve(); ret = subst(ret, mp); inf.finish();
    }
    if (m.name === "getClass" && !m.params.length) ret = new ClassType(L("java.lang.Class"), [new WildType("extends", erasure(r.cand.site))]);
    return capUpper(ret);
  };

  // ---------- switch ----------
  CK.attribSwitch = function (e, env, pt, isExpr) {
    var self = this;
    var st = this.attribExpr(e.selector, env, null);
    var u = st.k === "prim" ? st : unboxedType(st);
    var selKind;
    if (isErr(st)) selKind = "err";
    else if (u && /^(char|byte|short|int)$/.test(u.n)) selKind = "int";
    else if (isString(st)) selKind = "string";
    else if (st.k === "class" && st.sym.isEnum()) selKind = "enum";
    else if (u && /^(long|float|double|boolean)$/.test(u.n) && st.k === "prim") {
      this.err(env, e.selPos !== undefined ? e.selPos : e.selector.pos, "primitive patterns are a preview feature and are disabled by default.\n  (use --enable-preview to enable primitive patterns)");
      selKind = "primPreview";
    } else selKind = "pattern";
    e.selKind = selKind; e.selType = st;
    var saveSlot0 = env.slotInfo ? env.slotInfo.next : 0;
    if (selKind === "string" && env.slotInfo) { e.strTmp = env.slotInfo.alloc(T["int"]); env.slotInfo.alloc(T["int"]); }
    var swEnv = env.dup({ scope: new Scope(env.scope), inSwitch: (env.inSwitch || 0) + 1 });
    if (isExpr) swEnv.yieldTarget = { pt: pt && !isErr(pt) ? pt : null, types: [], node: e, env: env };
    else swEnv.switchStmt = e;
    var seen = [], hasDefault = false, hasPattern = false, hasNull = false, unguardedTypes = [];
    var saveSlot = env.slotInfo ? env.slotInfo.next : 0;
    e.cases.forEach(function (c) {
      var cenv = e.arrow ? swEnv.dup({ scope: new Scope(swEnv.scope) }) : swEnv;
      if (!e.arrow && c.labels.some(function (l) { return l.k === "TypePattern" || l.k === "RecordPattern"; })) cenv = swEnv.dup({ scope: new Scope(swEnv.scope) });
      if (c.isDefault) { if (hasDefault) self.err(env, c.pos, "duplicate default label"); hasDefault = true; }
      c.labels.forEach(function (l) {
        if (l.k === "DefaultLabel") { if (hasDefault) self.err(env, l.pos, "duplicate default label"); hasDefault = true; c.hasDefault = true; return; }
        if (l.k === "Expr") {
          var x = l.expr;
          if (x.k === "Literal" && x.type === "null") {
            if (st.k === "prim") self.err(env, x.pos, "incompatible types: <null> cannot be converted to " + typeStr(st));
            hasNull = true; l.isNull = true; return;
          }
          if (selKind === "enum" && x.k === "Ident") {
            completeAny(self, st.sym);
            var f = st.sym.fields[x.name];
            if (!f || !f.flags.enumConst) { self.err(env, x.pos, "an enum switch case label must be the unqualified name of an enumeration constant"); return; }
            l.enumConst = f;
            if (seen.indexOf(f) >= 0) self.err(env, c.labels[0] === l ? c.pos : x.pos, "duplicate case label");
            seen.push(f);
            return;
          }
          var lt = self.attribExpr(x, cenv, null);
          if (isErr(lt) || selKind === "err") return;
          if (selKind === "primPreview") {
            if (!(lt.k === "prim" && lt.n === u.n)) self.err(env, x.pos, "constant label of type " + typeStr(lt) + " is not compatible with switch selector type " + typeStr(st));
            return;
          }
          if (selKind === "enum" || (selKind === "pattern" && x.ref && x.ref.sym && x.ref.sym.flags && x.ref.sym.flags.enumConst)) {
            if (x.ref && x.ref.sym && x.ref.sym.flags.enumConst) {
              l.enumConst = x.ref.sym;
              if (seen.indexOf(x.ref.sym) >= 0) self.err(env, x.pos, "duplicate case label");
              seen.push(x.ref.sym);
              if (selKind === "pattern") hasPattern = true;
              return;
            }
          }
          if (selKind === "pattern") {
            self.err(env, x.pos, "constant label of type " + typeStr(lt) + " is not compatible with switch selector type " + typeStr(st));
            return;
          }
          if (x.cv === undefined) { self.err(env, x.pos, selKind === "enum" ? "an enum switch case label must be the unqualified name of an enumeration constant" : "constant expression required"); return; }
          var target = selKind === "int" ? u : st;
          if (!assignConv(lt, target, x.cv)) {
            if (isLossy(lt, target)) self.err(env, x.pos, "incompatible types: possible lossy conversion from " + typeStr(lt) + " to " + typeStr(target));
            else self.err(env, x.pos, "incompatible types: " + typeStr(lt) + " cannot be converted to " + typeStr(target));
            return;
          }
          var key = selKind === "int" ? castConst(x.cv, T["int"]) : String(x.cv);
          l.constVal = key;
          if (seen.some(function (s) { return s === key; })) self.err(env, c.labels[0] === l ? c.pos : x.pos, "duplicate case label");
          seen.push(key);
          return;
        }
        // padrão
        hasPattern = true;
        if (selKind === "int" || (st.k === "prim")) { /* padrões com primitivos: prévia */ }
        var ptT = self.attribPattern(l, cenv, st, false);
        collectBindings(l).forEach(function (v) { self.declareVar(v, cenv, true); });
        if (!isErr(ptT) && !isErr(st) && !castable(st, ptT)) self.err(env, l.pos, "incompatible types: " + typeStr(st) + " cannot be converted to " + typeStr(ptT));
        // dominância
        if (!isErr(ptT)) {
          unguardedTypes.forEach(function (prev) {
            if (isSubtype(erasure(ptT), erasure(prev.t)) && (l.k === "TypePattern" || prev.k === "TypePattern")) self.err(env, l.pos, "this case label is dominated by a preceding case label");
          });
        }
        l.lt = ptT;
      });
      if (c.guard) {
        var gt = self.attribExpr(c.guard, cenv, null);
        self.checkCond(c.guard, gt, env);
        if (c.guard.cv === false) self.err(env, c.guard.pos, "this case label has a guard that is a constant expression with value 'false'");
      }
      c.labels.forEach(function (l) { if ((l.k === "TypePattern" || l.k === "RecordPattern") && !c.guard && l.lt) unguardedTypes.push({ t: l.lt, k: l.k, l: l }); });
      // corpo
      if (e.arrow) {
        var b = c.body;
        if (b.k === "ExprStmt" && b.arrowExpr && isExpr) {
          var tgt = swEnv.yieldTarget.pt;
          var rt = self.attribExpr(b.expr, cenv, tgt);
          self.yieldValue(b.expr, rt, cenv);
        } else if (b.k === "ExprStmt") self.attribExpr(b.expr, cenv, null);
        else self.attribStat(b, cenv);
      } else {
        var bl = { k: "Block", stats: c.stats, pos: c.pos };
        var blocked = [];
        c.stats.forEach(function (s2) {
          var post = self.attribStat(s2, cenv);
          if (post && post.length) post.forEach(function (v) { self.declareVar(v, cenv, true); });
        });
      }
    });
    if (env.slotInfo) env.slotInfo.next = saveSlot0;
    e.hasDefault = hasDefault; e.hasPattern = hasPattern; e.hasNull = hasNull;
    // exaustividade
    var needExhaustive = isExpr || hasPattern || hasNull;
    if (needExhaustive && !hasDefault && selKind !== "err" && selKind !== "primPreview") {
      var covered = false;
      if (selKind === "enum") {
        completeAny(this, st.sym);
        var consts = st.sym.fieldList.filter(function (f) { return f.flags.enumConst; });
        covered = consts.every(function (f) { return seen.indexOf(f) >= 0; }) || this.coversType(st, unguardedTypes);
      } else if (selKind === "pattern") covered = this.coversType(st, unguardedTypes, seen);
      else if (u && u.n === "boolean") covered = false;
      if (!covered) this.err(env, e.pos, isExpr ? "the switch expression does not cover all possible input values" : "the switch statement does not cover all possible input values");
      e.exhaustive = true;
    }
    if (!isExpr) return T["void"];
    var yt = swEnv.yieldTarget;
    if (yt.pt) return yt.pt;
    var types = yt.types.filter(function (t) { return !isErr(t); });
    if (!types.length) return T_ERR;
    var r = types[0];
    for (var i = 1; i < types.length; i++) r = condType(r, types[i]);
    return r;
  };
  CK.yieldValue = function (x, t, env) {
    var yt = env.yieldTarget;
    if (!yt) return;
    if (isErr(t)) { yt.types.push(T_ERR); return; }
    if (t === T["void"]) { this.err(env, x.pos, "incompatible types: bad type in switch expression\n    void cannot be converted to " + (yt.pt ? typeStr(yt.pt) : "Object")); return; }
    if (yt.pt) {
      if (!assignConv(t, yt.pt, x.cv)) {
        if (isLossy(t, yt.pt)) this.err(env, x.pos, "incompatible types: bad type in switch expression\n    possible lossy conversion from " + typeStr(t) + " to " + typeStr(yt.pt));
        else this.err(env, x.pos, "incompatible types: bad type in switch expression\n    " + typeStr(t) + " cannot be converted to " + typeStr(yt.pt));
      }
    }
    yt.types.push(t);
  };
  // os padrões sem guarda cobrem o tipo t?
  CK.coversType = function (t, pats, enumSeen) {
    var self = this;
    if (pats.some(function (p) { return p.k === "TypePattern" && isSubtype(erasure(t), erasure(p.t)); })) return true;
    if (pats.some(function (p) { return p.k === "RecordPattern" && p.t.k === "class" && t.k === "class" && p.t.sym === t.sym && self.recordPatternTotal(p.l); })) return true;
    if (t.k !== "class") return false;
    var sym = t.sym;
    completeAny(this, sym);
    if (sym.isEnum() && enumSeen) {
      var consts = sym.fieldList.filter(function (f) { return f.flags.enumConst; });
      if (consts.length && consts.every(function (f) { return enumSeen.indexOf(f) >= 0; })) return true;
    }
    // selada: todas as subclasses permitidas cobertas
    if (sym.flags.sealed) {
      var subs = this.permittedOf(sym);
      if (!subs.length) return false;
      return subs.every(function (s) { return self.coversType(s.rawType(), pats, enumSeen); });
    }
    return false;
  };
  CK.recordPatternTotal = function (l) {
    var self = this;
    return l.subs.every(function (sp, i) {
      if (sp.k === "AnyPattern") return true;
      if (sp.k === "TypePattern") return sp.type.k === "VarType" || (sp.compType && sp.ptype && isSubtype(erasure(sp.compType.k === "prim" ? sp.compType : sp.compType), erasure(sp.ptype)));
      if (sp.k === "RecordPattern") return self.recordPatternTotal(sp);
      return false;
    });
  };
  CK.permittedOf = function (sym) {
    if (sym.permits) return sym.permits;
    // sem "permits": as subclasses no mesmo arquivo
    var self = this;
    return this.prog.classes.filter(function (c) {
      if (c === sym || !c.decl) return false;
      self.headerClass(c);
      return (c.superT && c.superT.sym === sym) || c.ifaces.some(function (i) { return i.sym === sym; });
    });
  };

  /* =====================================================================
     9. Comandos
     ===================================================================== */
  CK.methodDescFor = function (env) {
    var m = env.method;
    if (!m) return env.isStatic ? "static initializer" : "instance initializer";
    if (m.name === "<init>") return "constructor " + m.owner.name + "(" + m.params.map(typeStr).join(",") + ")";
    return "method " + (m.tparams.length ? "<" + m.tparams.map(function (t) { return t.name; }).join(",") + ">" : "") + m.name + "(" + m.params.map(typeStr).join(",") + ")";
  };
  CK.declareVar = function (v, env, quiet) {
    // já existe uma local com esse nome no mesmo método (inclusive lambdas externas)?
    for (var s = env.scope; s && s !== env.clsBaseScope; s = s.parent) {
      if (has(s.vars, v.name)) {
        var o = s.vars[v.name];
        this.err(env, v.pos, "variable " + v.name + " is already defined in " + this.methodDescFor(env));
        break;
      }
    }
    env.scope.vars[v.name] = v;
    v.frame = env.frame;
    if (env.slotInfo && v.slot < 0) v.slot = env.slotInfo.alloc(v.type && v.type.k ? v.type : T["int"]);
    if (env.method) v.method = env.method;
  };
  CK.attribBlock = function (b, env) {
    var self = this;
    var benv = env.dup({ scope: new Scope(env.scope) });
    var save = env.slotInfo ? env.slotInfo.next : 0;
    b.stats.forEach(function (s) {
      var post = self.attribStat(s, benv);
      if (post && post.length) post.forEach(function (v) { self.declareVar(v, benv, true); });
    });
    if (env.slotInfo) env.slotInfo.next = save;
  };
  // devolve variáveis de padrão que passam a valer depois do comando (if com saída antecipada)
  CK.attribStat = function (s, env) {
    var self = this, t;
    switch (s.k) {
      case "Block": this.attribBlock(s, env); return null;
      case "Empty": return null;
      case "LocalVar": this.attribLocalVar(s, env); return null;
      case "LocalClass": this.attribLocalClass(s, env); return null;
      case "ExprStmt": this.attribExpr(s.expr, env, null); return null;
      case "If": {
        t = this.attribExpr(s.cond, env, null);
        this.checkCond(s.cond, t, env);
        var tenv = this.withBindings(env, s.cond.bindsTrue);
        this.attribScopedStat(s.then, tenv);
        if (s.els) this.attribScopedStat(s.els, this.withBindings(env, s.cond.bindsFalse));
        var post = [];
        if (!canComplete(s.then) && s.cond.bindsFalse) post = post.concat(s.cond.bindsFalse);
        if (s.els && !canComplete(s.els) && s.cond.bindsTrue) post = post.concat(s.cond.bindsTrue);
        return post.length ? post.map(cloneVar) : null;
      }
      case "While": {
        t = this.attribExpr(s.cond, env, null);
        this.checkCond(s.cond, t, env);
        this.attribScopedStat(s.body, this.withBindings(env, s.cond.bindsTrue).dup({ inLoop: (env.inLoop || 0) + 1, loopStmt: s }));
        if (s.cond.bindsFalse && !hasBreak(s.body)) return s.cond.bindsFalse.map(cloneVar);
        return null;
      }
      case "DoWhile": {
        this.attribScopedStat(s.body, env.dup({ inLoop: (env.inLoop || 0) + 1, loopStmt: s }));
        t = this.attribExpr(s.cond, env, null);
        this.checkCond(s.cond, t, env);
        return null;
      }
      case "For": {
        var fenv = env.dup({ scope: new Scope(env.scope) });
        var save = env.slotInfo ? env.slotInfo.next : 0;
        s.init.forEach(function (x) { if (x.k === "LocalVar") self.attribLocalVar(x, fenv); else self.attribExpr(x, fenv, null); });
        var benv = fenv;
        if (s.cond) { t = this.attribExpr(s.cond, fenv, null); this.checkCond(s.cond, t, fenv); benv = this.withBindings(fenv, s.cond.bindsTrue); }
        this.attribScopedStat(s.body, benv.dup({ inLoop: (env.inLoop || 0) + 1, loopStmt: s }));
        s.update.forEach(function (x) { self.attribExpr(x, benv, null); });
        if (env.slotInfo) env.slotInfo.next = save;
        return null;
      }
      case "ForEach": this.attribForEach(s, env); return null;
      case "Return": this.attribReturn(s, env); return null;
      case "Break": {
        if (s.label) {
          if (!env.labels.some(function (l) { return l.name === s.label; })) this.err(env, s.pos, "undefined label: " + s.label);
          else s.target = env.labels.filter(function (l) { return l.name === s.label; }).pop().stmt;
        } else if (!env.inLoop && !(env.inSwitch && !env.yieldTarget)) {
          if (env.yieldTarget) this.err(env, s.pos, "attempting to break out of a switch expression");
          else this.err(env, s.pos, "break outside switch or loop");
        }
        return null;
      }
      case "Continue": {
        if (s.label) {
          var lb = env.labels.filter(function (l) { return l.name === s.label; }).pop();
          if (!lb) this.err(env, s.pos, "undefined label: " + s.label);
          else if (!/^(While|DoWhile|For|ForEach)$/.test(lb.stmt.k)) this.err(env, s.pos, "not a loop label: " + s.label);
        } else if (!env.inLoop) this.err(env, s.pos, env.yieldTarget ? "attempting to continue out of a switch expression" : "continue outside of loop");
        return null;
      }
      case "Yield": {
        if (!env.yieldTarget) { this.err(env, s.pos, "yield outside of switch expression"); this.attribExpr(s.expr, env, null); return null; }
        t = this.attribExpr(s.expr, env, env.yieldTarget.pt);
        this.yieldValue(s.expr, t, env);
        return null;
      }
      case "Throw": {
        t = this.attribExpr(s.expr, env, null);
        if (!isErr(t) && t.k !== "null" && !isSubtype(t, L("java.lang.Throwable").rawType())) this.err(env, s.expr.pos, "incompatible types: " + typeStr(t) + " cannot be converted to Throwable");
        return null;
      }
      case "Try": this.attribTry(s, env); return null;
      case "Switch": this.attribSwitch(s, env, null, false); return null;
      case "Labeled": {
        if (env.labels.some(function (l) { return l.name === s.label; })) this.err(env, s.pos, "label " + s.label + " already in use");
        var lenv = env.dup({ labels: env.labels.concat([{ name: s.label, stmt: s.body }]) });
        return this.attribStat(s.body, lenv);
      }
      case "Sync": {
        t = this.attribExpr(s.lock, env, null);
        if (!isErr(t) && t.k === "prim") this.err(env, s.lock.pos, "unexpected type\n  required: reference\n  found:    " + typeStr(t));
        this.attribBlock(s.body, env);
        return null;
      }
      case "Assert": {
        t = this.attribExpr(s.cond, env, null);
        this.checkCond(s.cond, t, env);
        if (s.msg) { var mt = this.attribExpr(s.msg, env, null); if (mt === T["void"]) this.err(env, s.msg.pos, "'void' type not allowed here"); }
        return null;
      }
    }
    throw new Error("attribStat: " + s.k);
  };
  function cloneVar(v) { return v; }
  function hasBreak(s) {
    var r = false;
    (function walk(x, depth) {
      if (!x || r) return;
      switch (x.k) {
        case "Break": if (!x.label && depth === 0) r = true; else if (x.label) r = true; return;
        case "Block": x.stats.forEach(function (y) { walk(y, depth); }); return;
        case "If": walk(x.then, depth); walk(x.els, depth); return;
        case "Labeled": walk(x.body, depth); return;
        case "While": case "DoWhile": case "For": case "ForEach": walk(x.body, depth + 1); return;
        case "Switch": x.cases.forEach(function (c) { (c.stats || [c.body]).forEach(function (y) { walk(y, depth + 1); }); }); return;
        case "Try": walk(x.block, depth); x.catches.forEach(function (c) { walk(c.body, depth); }); walk(x.fin, depth); return;
        case "Sync": walk(x.body, depth); return;
      }
    })(s, 0);
    return r;
  }
  // análise simples de "termina normalmente?" (para o escopo de padrões)
  function canComplete(s) {
    if (!s) return true;
    switch (s.k) {
      case "Return": case "Throw": case "Break": case "Continue": case "Yield": return false;
      case "Block": return s.stats.length ? canComplete(s.stats[s.stats.length - 1]) : true;
      case "If": return !s.els || canComplete(s.then) || canComplete(s.els);
      case "While": return !(s.cond.cv === true) || hasBreak(s.body);
      case "For": return !(!s.cond || s.cond.cv === true) || hasBreak(s.body);
      case "DoWhile": return canComplete(s.body) || hasBreak(s.body) || s.cond.cv !== true;
      case "Labeled": return canComplete(s.body) || true;
      case "Try": return (canComplete(s.block) || s.catches.some(function (c) { return canComplete(c.body); })) && (!s.fin || canComplete(s.fin));
      case "Sync": return canComplete(s.body);
    }
    return true;
  }
  CK.withBindings = function (env, binds) {
    if (!binds || !binds.length) return env;
    var self = this, e2 = env.dup({ scope: new Scope(env.scope) });
    binds.forEach(function (v) { self.declareVar(v, e2, true); });
    return e2;
  };
  // corpo de if/while/for: uma declaração solta teria escopo próprio
  CK.attribScopedStat = function (s, env) {
    if (s.k === "Block") { this.attribBlock(s, env); return; }
    var e2 = env.dup({ scope: new Scope(env.scope) });
    var save = env.slotInfo ? env.slotInfo.next : 0;
    this.attribStat(s, e2);
    if (env.slotInfo) env.slotInfo.next = save;
  };
  CK.attribLocalVar = function (s, env) {
    var self = this;
    var isVar = s.type.k === "VarType";
    var baseT = isVar ? null : this.resolveType(s.type, env);
    if (baseT === T["void"]) { this.err(env, s.type.pos, "'void' type not allowed here"); baseT = T_ERR; }
    s.vars.forEach(function (d) {
      var t;
      if (isVar) {
        if (!d.init) { self.err(env, d.pos, "cannot infer type for local variable " + d.name + "\n  (cannot use 'var' on variable without initializer)"); t = T_ERR; }
        else if (d.init.k === "ArrayInit") { self.err(env, d.pos, "cannot infer type for local variable " + d.name + "\n  (array initializer needs an explicit target-type)"); t = T_ERR; }
        else if (d.init.k === "Lambda") { self.err(env, d.pos, "cannot infer type for local variable " + d.name + "\n  (lambda expression needs an explicit target-type)"); t = T_ERR; }
        else if (d.init.k === "MethodRef") { self.err(env, d.pos, "cannot infer type for local variable " + d.name + "\n  (method reference needs an explicit target-type)"); t = T_ERR; }
        else {
          var it = self.attribExpr(d.init, env, null);
          if (it.k === "null") { self.err(env, d.pos, "cannot infer type for local variable " + d.name + "\n  (variable initializer is 'null')"); t = T_ERR; }
          else if (it === T["void"]) { self.err(env, d.pos, "cannot infer type for local variable " + d.name + "\n  (variable initializer is 'void')"); t = T_ERR; }
          else t = upward(it);
        }
      } else {
        t = d.type === s.type ? baseT : self.resolveType(d.type, env);
      }
      var v = new VarSym(d.name, t, s.resource ? "resource" : "local");
      v.pos = d.pos; v.decl = d;
      if (s.mods.flags["final"]) v.flags["final"] = true;
      d.vsym = v;
      if (!isVar && d.init) {
        var vt = self.attribExpr(d.init, env, isErr(t) ? null : t);
        if (!isErr(t) && d.init.k !== "ArrayInit") self.checkAssign(d.init, vt, t, env);
      }
      if (d.init) v.hasInit = true;
      if (d.init && v.flags["final"] && d.init.cv !== undefined && (t.k === "prim" || isString(t))) v.constVal = castConst(d.init.cv, t);
      self.declareVar(v, env);
    });
  };
  // tipo de "var": sem tipos de captura/nulos
  function upward(t) { return t; }
  CK.attribLocalClass = function (s, env) {
    var d = s.decl;
    if (env.scope.lookupClass(d.name) && this.localClassInMethod(env, d.name)) this.err(env, d.pos, "class " + d.name + " is already defined in " + this.methodDescFor(env));
    var sym = this.enterClass(d, env.cls, env.cu, { staticCtx: env.isStatic });
    sym.localEnv = env;
    sym.staticCtx = env.isStatic;
    if (d.kind !== "class") sym.inner = false;
    else sym.inner = !env.isStatic;
    sym.creationFrame = env.frame;
    env.scope.classes[d.name] = sym;
    var cenv = this.classEnv(sym);
    cenv.outerEnv = env;
    // classes aninhadas da local
    this.headerClass(sym);
    this.membersClass(sym);
    var self = this;
    d.members.forEach(function (m) { if (m.k === "Class") { self.headerClass(m.sym); self.membersClass(m.sym); } });
    this.attribClass(sym);
  };
  CK.localClassInMethod = function (env, name) {
    for (var s = env.scope; s && s !== env.clsBaseScope; s = s.parent) if (has(s.classes, name)) return true;
    return false;
  };
  CK.attribForEach = function (s, env) {
    var self = this;
    var fenv = env.dup({ scope: new Scope(env.scope) });
    var save = env.slotInfo ? env.slotInfo.next : 0;
    var et = this.attribExpr(s.expr, env, null);
    var elem = T_ERR;
    if (!isErr(et)) {
      if (et.k === "array") elem = et.elem;
      else {
        var it = asSuper(et.k === "wild" ? capUpper(et) : et, L("java.lang.Iterable"));
        if (it) { elem = it.args ? capUpper(it.args[0]) : OBJ(); s.iterable = true; }
        else this.err(env, s.expr.pos, "for-each not applicable to expression type\n  required: array or java.lang.Iterable\n  found:    " + typeStr(et));
      }
    }
    var d = s.varDecl.vars[0];
    var vt;
    if (s.varDecl.type.k === "VarType") vt = elem;
    else vt = this.resolveType(d.type, env);
    // javac reserva slots para o iterador/array antes da variável
    if (env.slotInfo) { if (et.k === "array") { env.slotInfo.alloc(T["int"]); env.slotInfo.alloc(T["int"]); env.slotInfo.alloc(T["int"]); } else env.slotInfo.alloc(T["int"]); }
    var v = new VarSym(d.name, vt, "foreach");
    v.pos = d.pos; v.hasInit = true; v.decl = d;
    if (s.varDecl.mods.flags["final"]) v.flags["final"] = true;
    d.vsym = v;
    if (!isErr(elem) && !isErr(vt) && !assignConv(elem, vt)) {
      if (isLossy(elem, vt)) this.err(env, s.expr.pos, "incompatible types: possible lossy conversion from " + typeStr(elem) + " to " + typeStr(vt));
      else this.err(env, s.expr.pos, "incompatible types: " + typeStr(elem) + " cannot be converted to " + typeStr(vt));
    }
    s.elemType = elem; s.exprType = et;
    this.declareVar(v, fenv);
    this.attribScopedStat(s.body, fenv.dup({ inLoop: (env.inLoop || 0) + 1, loopStmt: s }));
    if (env.slotInfo) env.slotInfo.next = save;
  };
  CK.attribReturn = function (s, env) {
    if (env.lambdaNode) {
      var ret = env.ret;
      if (s.expr) {
        if (ret === T["void"]) { this.err(env, s.expr.pos, "incompatible types: bad return type in lambda expression\n    " + "unexpected return value"); this.attribExpr(s.expr, env, null); return; }
        var bt = this.attribExpr(s.expr, env, env.retInf ? null : ret);
        if (isErr(bt)) return;
        if (env.retInf) { env.lambdaReturns.push(bt); return; }
        if (!assignConv(bt, ret, s.expr.cv)) {
          if (isLossy(bt, ret)) this.err(env, s.expr.pos, "incompatible types: bad return type in lambda expression\n    possible lossy conversion from " + typeStr(bt) + " to " + typeStr(ret));
          else this.err(env, s.expr.pos, "incompatible types: bad return type in lambda expression\n    " + typeStr(bt) + " cannot be converted to " + typeStr(ret));
        }
      } else if (ret !== T["void"] && !isErr(ret)) this.err(env, s.pos, "incompatible types: bad return type in lambda expression\n    missing return value");
      return;
    }
    if (!env.method) { this.err(env, s.pos, "return outside method"); if (s.expr) this.attribExpr(s.expr, env, null); return; }
    var mret = env.method.ret;
    if (s.expr) {
      if (mret === T["void"] || env.method.name === "<init>") {
        this.attribExpr(s.expr, env, null);
        this.err(env, s.expr.pos, "incompatible types: unexpected return value");
        return;
      }
      var t = this.attribExpr(s.expr, env, mret);
      if (s.expr.k !== "ArrayInit") this.checkAssign(s.expr, t, mret, env);
    } else if (mret !== T["void"] && !isErr(mret)) {
      this.err(env, s.pos, "incompatible types: missing return value");
    }
  };
  CK.attribTry = function (s, env) {
    var self = this;
    var tenv = env.dup({ scope: new Scope(env.scope) });
    var save = env.slotInfo ? env.slotInfo.next : 0;
    var AC = L("java.lang.AutoCloseable").rawType();
    (s.resources || []).forEach(function (r) {
      if (r.k === "LocalVar") {
        self.attribLocalVar(r, tenv);
        var v = r.vars[0].vsym;
        v.flags["final"] = true; v.kind = "resource";
        if (!isErr(v.type) && !isSubtype(v.type, AC)) self.err(env, r.vars[0].init.pos, "incompatible types: try-with-resources not applicable to variable type\n    (" + typeStr(v.type) + " cannot be converted to AutoCloseable)");
        r.rtype = v.type;
      } else {
        var t = self.attribExpr(r.expr, tenv, null);
        if (!isErr(t) && !isSubtype(t, AC)) self.err(env, r.expr.pos, "incompatible types: try-with-resources not applicable to variable type\n    (" + typeStr(t) + " cannot be converted to AutoCloseable)");
        r.rtype = t;
      }
    });
    this.attribBlock(s.block, tenv);
    if (env.slotInfo) env.slotInfo.next = save;
    var THR = L("java.lang.Throwable").rawType();
    s.catches.forEach(function (c) {
      var cenv = env.dup({ scope: new Scope(env.scope) });
      var save2 = env.slotInfo ? env.slotInfo.next : 0;
      var types = c.types.map(function (ta) {
        var t = self.resolveType(ta, env);
        if (!isErr(t) && !isSubtype(t, THR)) { self.err(env, ta.pos, "incompatible types: " + typeStr(t) + " cannot be converted to Throwable"); return T_ERR; }
        return t;
      });
      if (types.length > 1) {
        for (var i = 0; i < types.length; i++) for (var j = 0; j < types.length; j++) {
          if (i !== j && !isErr(types[i]) && !isErr(types[j]) && isSubClass(types[j].sym, types[i].sym)) {
            var sub = j, sup = i;
            self.err(env, c.types[Math.max(sub, sup)].pos, "Alternatives in a multi-catch statement cannot be related by subclassing\n  Alternative " + typeStr(types[sub]) + " is a subclass of alternative " + typeStr(types[sup]));
            i = j = types.length;
          }
        }
      }
      c.ctypes = types;
      var vt = types.length === 1 ? types[0] : lub(types.filter(function (t) { return !isErr(t); }));
      var v = new VarSym(c.name, vt, "catch");
      v.pos = c.namePos; v.hasInit = true;
      if (types.length > 1 || (c.mods && c.mods.flags["final"])) v.flags["final"] = true;
      if (types.length > 1) v.multiCatch = true;
      c.vsym = v;
      self.declareVar(v, cenv);
      self.attribBlock(c.body, cenv);
      if (env.slotInfo) env.slotInfo.next = save2;
    });
    if (s.fin) this.attribBlock(s.fin, env);
  };

  /* =====================================================================
     10. Classes e métodos
     ===================================================================== */
  CK.attribClass = function (sym) {
    if (sym.attributed) return;
    sym.attributed = true;
    var self = this, d = sym.decl, env = this.classEnv(sym);
    completeAny(this, sym);
    // métodos abstratos não implementados
    if (!sym.flags.abstract && !sym.isInterface()) this.checkAllDefined(sym, env);
    if (sym.flags.sealed && sym.permits) {
      sym.permits.forEach(function (p) {
        if (p.decl) self.headerClass(p);
        if (!(p.superT && p.superT.sym === sym) && !p.ifaces.some(function (i) { return i.sym === sym; }))
          self.err(env, d.pos, "invalid permits clause\n  (subclass " + p.name + " must extend sealed class)");
      });
    }
    // subclasse de selada precisa ser final, sealed ou non-sealed
    var sups = [];
    if (sym.superT && sym.superT.k === "class") sups.push(sym.superT.sym);
    sym.ifaces.forEach(function (i) { sups.push(i.sym); });
    sups.forEach(function (s) {
      if (s.flags.sealed && !sym.anon && !sym.local) {
        if (!sym.flags["final"] && !sym.flags.sealed && !sym.flags["non-sealed"] && !(sym.isEnum && sym.isEnum()) && !(sym.isRecord && sym.isRecord()))
          self.err(env, d.pos, "sealed, non-sealed or final modifiers expected");
        var perm = self.permittedOf(s);
        if (perm.indexOf(sym) < 0) self.err(env, d.ext && s === (sym.superT && sym.superT.sym) ? d.ext.pos : d.pos, "class is not allowed to extend sealed class: " + s.name + " (as it is not listed in its 'permits' clause)");
      }
    });
    // constantes de enum: argumentos do construtor
    if (sym.isEnum()) {
      d.enumConsts.forEach(function (ec) {
        var cenv = env.dup({ isStatic: true, staticInit: true, frame: { kind: "method", captures: [], parentFrame: null }, slotInfo: new SlotInfo(0), scope: new Scope(env.scope), clsBaseScope: env.scope });
        var args = self.attribArgs(ec.args || [], cenv);
        if (args.some(function (a) { return !a.poly && isErr(a.type); })) return;
        var cands = sym.ctors.map(function (c) { return { m: c, site: sym.thisType() }; });
        var best = self.resolveAmong(cands, args, cenv, { pos: ec.pos, name: sym.name, ctor: true });
        if (best) {
          var formals = best.res.formals;
          args.forEach(function (ai, i) { if (ai.poly) self.completeArg(ai, best.res.phase === 3 && i >= formals.length - 1 ? formals[formals.length - 1].elem : formals[i], cenv, null); });
          ec.csym = best.cand.m; ec.formals = formals; ec.varargsCall = best.res.phase === 3;
        }
        ec.frameSize = cenv.slotInfo.max;
        if (ec.body) {
          var fakeNew = { formals: ec.formals || [], csym: ec.csym, varargsCall: ec.varargsCall };
          ec.body.anon = true;
          var asym = self.enterClass(ec.body, sym, env.cu, { staticCtx: true });
          asym.anonOf = sym.rawType(); asym.localEnv = cenv; asym.staticCtx = true; asym.inner = false;
          asym.enumBody = true;
          asym.creationFrame = cenv.frame;
          self.classEnv(asym).outerEnv = cenv;
          self.headerClass(asym);
          asym.superT = sym.rawType(); asym.ifaces = [];
          self.membersClass(asym);
          var c = asym.ctors[0];
          c.params = (ec.formals || []).slice(); c.key = methodKey("<init>", c.params); c.anonSuper = ec.csym; c.anonVarargs = ec.varargsCall;
          self.attribClass(asym);
          ec.anonSym = asym;
        }
      });
    }
    var fieldIndex = 0;
    d.members.forEach(function (m) {
      if (m.k === "Field") {
        if (m.sym) m.sym.declIndex = fieldIndex;
        var isSt = !!(m.sym && m.sym.flags["static"]);
        var fenv = env.dup({ isStatic: isSt, staticInit: isSt, instanceInit: !isSt, fieldInit: { isStatic: isSt }, fieldInitIndex: fieldIndex, frame: { kind: "method", captures: [], parentFrame: null, init: true }, slotInfo: new SlotInfo(isSt ? 0 : 1), scope: new Scope(env.scope), clsBaseScope: env.scope });
        fieldIndex++;
        if (m.init && m.sym) {
          var t = m.sym.type;
          var it = self.attribExpr(m.init, fenv, t);
          if (m.init.k !== "ArrayInit") self.checkAssign(m.init, it, t, fenv);
          if (m.sym.flags["final"] && m.init.cv !== undefined && (t.k === "prim" || isString(t)) && m.sym.constVal === undefined) m.sym.constVal = castConst(m.init.cv, t);
          m.frameSize = fenv.slotInfo.max;
          m.initFrame = fenv.frame;
        }
      } else if (m.k === "Init") {
        var ienv = env.dup({ isStatic: m.isStatic, staticInit: m.isStatic, instanceInit: !m.isStatic, method: null, frame: { kind: "method", captures: [], parentFrame: null, init: true }, slotInfo: new SlotInfo(m.isStatic ? 0 : 1), scope: new Scope(env.scope), clsBaseScope: env.scope, ret: T["void"] });
        if (m.isStatic && sym.inner) { /* Java 16+: permitido */ }
        self.attribBlock(m.body, ienv);
        m.frameSize = ienv.slotInfo.max;
        m.initFrame = ienv.frame;
      } else if (m.k === "Method") {
        if (m.sym) self.attribMethod(m.sym, env);
      } else if (m.k === "Class") {
        self.attribClass(m.sym);
      }
    });
    // construtor padrão: super() implícito
    sym.ctors.forEach(function (c) {
      if ((c.isDefault && !c.anonSuper) || (c.anonCtor && !c.anonSuper) || c.recordAuto) self.checkImplicitSuper(sym, c, env, d.pos);
    });
  };
  CK.checkAllDefined = function (sym, env) {
    var self = this;
    var all = this.allMethods(sym.thisType());
    for (var i = 0; i < all.length; i++) {
      var c = all[i], m = c.m;
      if (!m.flags.abstract || m.flags["static"]) continue;
      if (m.owner === sym) continue;
      if (m.owner.full === "java.lang.Object") continue;
      if (OBJECT_METHOD_KEYS[m.key] && m.owner.isInterface()) continue;
      // implementado por algum método concreto (inclusive default)?
      var impl = this.findImpl(sym, c);
      if (impl) continue;
      if (sym.isEnum() && sym.decl && sym.decl.enumConsts.length && sym.decl.enumConsts.every(function (ec) { return ec.body; })) continue;
      var nm = sym.anon ? "<anonymous " + sym.bin.replace(/^.*\./, "") + ">" : sym.name;
      var pos = sym.decl.pos;
      this.err(env, pos, nm + " is not abstract and does not override abstract method " + m.name + "(" + m.params.map(function (p) { return typeStr(memberType(p, c.site, m.owner)); }).join(",") + ") in " + m.owner.name);
      return;
    }
  };
  CK.findImpl = function (sym, c) {
    var self = this, m = c.m;
    var cands = this.allMethods(sym.thisType(), m.name);
    for (var i = 0; i < cands.length; i++) {
      var o = cands[i];
      if (o.m === m || o.m.flags.abstract || o.m.flags["static"]) continue;
      if (o.m.params.length !== m.params.length) continue;
      var ok = true;
      for (var j = 0; j < m.params.length; j++) {
        var a = memberType(m.params[j], asSuper(sym.thisType(), m.owner) || c.site, m.owner);
        var b = memberType(o.m.params[j], asSuper(sym.thisType(), o.m.owner) || o.site, o.m.owner);
        if (!sameType(a, b) && erasedName(a) !== erasedName(b)) { ok = false; break; }
      }
      if (ok) return o;
    }
    return null;
  };
  CK.checkImplicitSuper = function (sym, ctor, env, pos) {
    if (sym.isInterface() || sym.isEnum() || sym.isRecord() || !sym.superT) return;
    var sup = sym.superT.sym;
    completeAny(this, sup);
    var cands = sup.ctors.map(function (c) { return { m: c, site: sym.superT }; });
    if (!cands.length) return;
    var best = this.resolveAmong(cands, [], env.dup({ isStatic: false }), { pos: pos, name: sup.name, ctor: true });
    if (best) { ctor.implicitSuper = best.cand.m; this.checkAccess(best.cand.m, pos, env); ctor.implicitThrows = best.cand.m.throws; }
  };
  CK.attribMethod = function (ms, env) {
    var self = this, d = ms.decl;
    this.checkOverride(ms, env);
    var isSt = !!ms.flags["static"];
    var frame = { kind: "method", captures: [], parentFrame: null, ms: ms };
    ms.frame = frame;
    var menv = env.dup({ method: ms, isStatic: isSt, scope: new Scope(env.scope), clsBaseScope: env.scope, frame: frame, ret: ms.ret, ctor: ms.name === "<init>", slotInfo: new SlotInfo(isSt ? 0 : 1), inLoop: 0, inSwitch: 0, labels: [], yieldTarget: null, compactCtor: !!ms.compact });
    if (ms.owner.isEnum() && ms.name === "<init>") { menv.slotInfo = new SlotInfo(3); }
    ms.paramSyms = [];
    if (ms.compact) {
      ms.owner.recComps.forEach(function (rc) {
        var v = new VarSym(rc.name, rc.type, "param"); v.pos = d.namePos; v.hasInit = true;
        self.declareVar(v, menv);
        ms.paramSyms.push(v);
      });
    } else {
      d.params.forEach(function (p, i) {
        var v = new VarSym(p.name, ms.params[i], "param");
        v.pos = p.pos; v.hasInit = true;
        if (p.mods && p.mods.flags["final"]) v.flags["final"] = true;
        self.declareVar(v, menv);
        ms.paramSyms.push(v);
      });
    }
    if (!d.body) return;
    if (ms.name === "<init>") {
      // procura a chamada explícita this(...)/super(...)
      var stats = d.body.stats, idx = -1;
      for (var i = 0; i < stats.length; i++) {
        if (stats[i].k === "ExprStmt" && stats[i].expr.k === "CtorCall") { idx = i; break; }
      }
      d.ctorCallIndex = idx;
      if (idx < 0 && !ms.owner.isEnum() && !ms.owner.isRecord()) this.checkImplicitSuper(ms.owner, ms, menv, d.body.pos);
      if (idx < 0 && ms.owner.isRecord() && !ms.canonical) {
        this.err(env, d.namePos, "constructor is not canonical, so its first statement must invoke another constructor of class " + ms.owner.name);
      }
      var benv = menv.dup({ scope: new Scope(menv.scope) });
      stats.forEach(function (s, k) {
        var senv = k < idx ? benv.dup({ ctorPrologue: true }) : benv;
        if (k === idx) senv = benv;
        var post = self.attribStat(s, senv);
        if (post && post.length) post.forEach(function (v) { self.declareVar(v, benv, true); });
      });
      // segunda chamada this(...)/super(...)
      stats.forEach(function (s, k) {
        if (k > idx && s.k === "ExprStmt" && s.expr.k === "CtorCall") self.err(env, s.expr.pos, "redundant explicit constructor invocation");
      });
    } else {
      this.attribBlock(d.body, menv);
    }
    ms.frameSize = menv.slotInfo.max;
  };
  // regras de sobrescrita e @Override
  CK.checkOverride = function (ms, env) {
    var self = this, sym = ms.owner, d = ms.decl;
    if (ms.name === "<init>") return;
    var hasOverrideAnno = d.mods.annos.some(function (a) { return a.name === "Override" || a.name === "java.lang.Override"; });
    var annoPos = hasOverrideAnno ? d.mods.annos.filter(function (a) { return a.name === "Override" || a.name === "java.lang.Override"; })[0].pos : 0;
    var overridden = [];
    var sups = supertypesOf(sym.thisType());
    if (sym.isInterface()) sups = sups.filter(function (s) { return true; });
    var seen = {};
    sups.forEach(function (st) {
      if (st.k !== "class") return;
      self.allMethods(st, ms.name).forEach(function (c) {
        var m = c.m;
        if (seen[m.id]) return;
        seen[m.id] = 1;
        if (m.flags["private"] || m.params.length !== ms.params.length) return;
        for (var i = 0; i < m.params.length; i++) {
          var a = memberType(m.params[i], c.site, m.owner), b = ms.params[i];
          if (!sameType(a, b) && erasedName(a) !== erasedName(b)) return;
          if (!sameType(a, b) && !(m.tparams.length || ms.tparams.length) && !(a.k === "tvar" || (a.k === "class" && !a.args && b.k === "class"))) {
            if (erasedName(a) === erasedName(b) && a.k === "class" && b.k === "class" && a.args && b.args) return;
          }
        }
        overridden.push(c);
      });
    });
    if (hasOverrideAnno && !overridden.length && !ms.flags["static"]) {
      this.err(env, annoPos, "method does not override or implement a method from a supertype");
      return;
    }
    if (hasOverrideAnno && ms.flags["static"]) { this.err(env, annoPos, "method does not override or implement a method from a supertype"); return; }
    ms.overrides = overridden.map(function (c) { return c.m; });
    for (var k = 0; k < overridden.length; k++) {
      var c = overridden[k], m = c.m;
      var verb = (m.owner.isInterface() && !sym.isInterface()) ? "implement" : "override";
      if (m.flags.abstract && !m.owner.isInterface()) verb = "override";
      if (m.owner.isInterface() && !sym.isInterface()) verb = "implement";
      var head = ms.name + "(" + ms.params.map(typeStr).join(",") + ") in " + sym.name + " cannot " + verb + " " + m.name + "(" + m.params.map(function (p) { return typeStr(memberType(p, c.site, m.owner)); }).join(",") + ") in " + m.owner.name;
      if (m.owner.full === "java.lang.Object" && sym.isInterface()) continue;
      if (m.flags["static"] && !ms.flags["static"]) { this.err(env, d.namePos, head + "\n  overridden method is static"); return; }
      if (!m.flags["static"] && ms.flags["static"]) { this.err(env, d.namePos, head + "\n  overriding method is static"); return; }
      if (m.flags["final"]) { this.err(env, d.namePos, head + "\n  overridden method is final"); return; }
      var rank = function (f) { return f["public"] ? 3 : f["protected"] ? 2 : f["private"] ? 0 : 1; };
      if (rank(ms.flags) < rank(m.flags)) {
        var was = m.flags["public"] ? "public" : m.flags["protected"] ? "protected" : "package";
        this.err(env, d.namePos, head + "\n  attempting to assign weaker access privileges; was " + was);
        return;
      }
      var mr = memberType(m.ret, c.site, m.owner);
      var okRet;
      if (mr.k === "prim" || ms.ret.k === "prim") okRet = sameType(mr, ms.ret);
      else okRet = isSubtype(ms.ret, mr) || isSubtype(erasure(ms.ret), erasure(mr));
      if (!okRet) { this.err(env, d.namePos, head + "\n  return type " + typeStr(ms.ret) + " is not compatible with " + typeStr(mr)); return; }
      // exceções verificadas
      for (var q = 0; q < ms.throws.length; q++) {
        var tq = ms.throws[q];
        if (tq.k !== "class" || !isChecked(tq.sym)) continue;
        var ok = m.throws.some(function (mt) { return mt.k === "class" && isSubClass(tq.sym, mt.sym); });
        if (!ok) { this.err(env, d.namePos, head + "\n  overridden method does not throw " + typeStr(tq)); return; }
      }
    }
  };

  /* =====================================================================
     11. Compilação de um programa (javac)
     ===================================================================== */
  function parseFile(name, code, errs) {
    var f = new SourceFile(name, code);
    var p = null;
    var cu = null;
    try { p = new Parser(f, errs); cu = p.compilationUnit(); } catch (e) { if (!(e instanceof ParseAbort)) throw e; }
    if (p && p.recovered) cu = null;
    return { file: f, cu: cu };
  }
  function compileProgram(files, opts) {
    ensureLib();
    opts = opts || {};
    var prog = new Program();
    var parseErrs = [];
    var parsed = files.map(function (fl) { return parseFile(fl.nome || fl.name, fl.codigo !== undefined ? fl.codigo : fl.code, parseErrs); });
    prog.files = parsed.map(function (p) { return p.file; });
    if (parseErrs.length) { prog.errors = parseErrs; return prog; }
    prog.cus = parsed.map(function (p) { return p.cu; });
    var ck = new Checker(prog);
    prog.checker = ck;
    try {
      prog.cus.forEach(function (cu) { ck.enterCU(cu); });
      prog.cus.forEach(function (cu) { ck.resolveImports(cu); });
      prog.classes.slice().forEach(function (c) { ck.headerClass(c); });
      prog.classes.slice().forEach(function (c) { ck.membersClass(c); });
      prog.topClasses.slice().forEach(function (c) { ck.attribClass(c); });
      if (!prog.errors.length && !opts.semFlow) {
        var fl = new Flow(prog, ck);
        prog.topClasses.forEach(function (c) { fl.analyzeClass(c); });
      }
    } catch (e) {
      if (e instanceof ParseAbort) { /* */ }
      else throw e;
    }
    prog.simplified = ck.simplified;
    return prog;
  }
  CK.resolveImports = function (cu) {
    var self = this;
    var env = new Env({ cu: cu, file: cu.file });
    cu.imports.forEach(function (im) {
      var parts = im.parts;
      if (im.module) {
        if (im.name === "java.base") LIB_DEFAULT_IMPORTS.forEach(function (p) { if (cu.importsStar.indexOf(p) < 0) cu.importsStar.push(p); });
        return;
      }
      if (im.isStatic) {
        var cname = parts.slice(0, im.star ? parts.length : parts.length - 1).join(".");
        var cs = self.findQualifiedClass(cname, cu);
        if (!cs) { self.reportBadImport(env, im, parts.slice(0, im.star ? parts.length : parts.length - 1)); return; }
        if (im.star) cu.staticStar.push(cs);
        else {
          var mn = parts[parts.length - 1];
          completeAny(self, cs);
          if (!self.findField(cs, mn) && !self.allMethods(cs.rawType(), mn).length && !self.findMemberType(cs, mn)) {
            self.err(env, im.namePos, "cannot find symbol\n  symbol:   static " + mn + "\n  location: " + cs.kindName() + " " + cs.name);
            return;
          }
          (cu.staticSingle[mn] = cu.staticSingle[mn] || []).push(cs);
        }
        return;
      }
      if (im.star) {
        var pk = im.name;
        if (PKGS[pk]) { if (cu.importsStar.indexOf(pk) < 0) cu.importsStar.push(pk); return; }
        var cls = self.findQualifiedClass(pk, cu);
        if (cls) { cu.importsStar.push(pk); return; }
        self.err(env, im.namePos === undefined ? im.pos : findPartPos(cu.file, im), "package " + pk + " does not exist");
        return;
      }
      var c = self.findQualifiedClass(im.name, cu);
      if (c) { cu.importsSingle[c.name] = c; return; }
      self.reportBadImport(env, im, parts);
    });
  };
  function findPartPos(file, im) { return im.pos; }
  CK.reportBadImport = function (env, im, parts) {
    var pkg = parts.slice(0, -1).join(".");
    // posição do último "."
    var src = env.file.src, p = im.pos, txt = src.slice(p, src.indexOf(";", p));
    var lastDot = p + txt.lastIndexOf(".");
    if (PKGS[pkg] || this.findQualifiedClass(pkg, env.cu)) {
      this.err(env, lastDot, "cannot find symbol\n  symbol:   class " + parts[parts.length - 1] + "\n  location: " + (PKGS[pkg] ? "package " + pkg : "class " + parts[parts.length - 2]));
    } else {
      // o pacote que não existe: o maior prefixo inexistente
      var dots = [], q = -1;
      while ((q = txt.indexOf(".", q + 1)) >= 0) dots.push(p + q);
      var n = parts.length - 1;
      var k = 1;
      while (k < n && isPackagePrefix(parts.slice(0, k + 1).join("."))) k++;
      this.err(env, dots[n - 1], "package " + pkg + " does not exist");
    }
  };
  CK.findQualifiedClass = function (name, cu) {
    if (LIB[name]) return LIB[name];
    if (this.prog.byName[name]) return this.prog.byName[name];
    // classe aninhada: java.util.Map.Entry, Main.Cor
    var parts = name.split(".");
    for (var i = parts.length - 1; i > 0; i--) {
      var base = parts.slice(0, i).join(".");
      var c = LIB[base] || (i === 1 ? this.prog.byName[base] : null);
      if (c) {
        for (var j = i; j < parts.length && c; j++) { completeAny(this, c); c = c.members[parts[j]]; }
        if (c) return c;
      }
    }
    return null;
  };

  // formata os erros como o javac
  function formatDiagnostics(prog) {
    var out = "";
    var errs = prog.errors.filter(function (e) { return e.kind === "error"; });
    var warns = errs.length ? [] : (prog.warnings || []);
    errs.slice(0, 100).concat(warns).forEach(function (e) {
      var f = e.file, line = f.lineOf(Math.min(e.pos, f.src.length)), col = f.colOf(Math.min(e.pos, f.src.length));
      var lines = e.msg.split("\n");
      out += f.name + ":" + line + ": " + (e.kind === "warning" ? "warning" : "error") + ": " + lines[0] + "\n";
      var text = f.lineText(line);
      out += text + "\n";
      var caret = "";
      for (var i = 0; i < col; i++) caret += text[i] === "\t" ? "\t" : " ";
      out += caret + "^\n";
      for (var k = 1; k < lines.length; k++) out += lines[k] + "\n";
    });
    if (!errs.length) {
      if (prog.notes.deprecation) out += "Note: " + prog.files[0].name + " uses or overrides a deprecated API.\nNote: Recompile with -Xlint:deprecation for details.\n";
      if (prog.notes.unchecked) out += "Note: " + prog.files[0].name + " uses unchecked or unsafe operations.\nNote: Recompile with -Xlint:unchecked for details.\n";
    }
    if (prog.simplified && errs.length) out += "Note: Some messages have been simplified; recompile with -Xdiags:verbose to get full output\n";
    if (errs.length) out += errs.length + (errs.length === 1 ? " error\n" : " errors\n");
    if (warns.length) out += warns.length + (warns.length === 1 ? " warning\n" : " warnings\n");
    return out;
  }
  JavaSim.compileProgram = compileProgram;
  JavaSim.formatDiagnostics = formatDiagnostics;

  /* =====================================================================
     12. Fluxo: comandos inalcançáveis, retorno, inicialização, exceções
     ===================================================================== */
  // filhos de uma expressão (para achar lambdas, classes anônimas e switch)
  function exprKids(e) {
    switch (e.k) {
      case "Paren": return [e.expr];
      case "Select": return e.target.k === "Super" ? [] : [e.target];
      case "Call": return (e.target && e.target.k !== "Super" ? [e.target] : []).concat(e.args);
      case "New": return (e.outer ? [e.outer] : []).concat(e.args);
      case "NewArray": return e.dims.concat(e.init ? [e.init] : []);
      case "ArrayInit": return e.elems;
      case "Index": return [e.arr, e.index];
      case "Unary": return [e.expr];
      case "Binary": return [e.l, e.r];
      case "Assign": case "CompoundAssign": return [e.target, e.value];
      case "Cond": return [e.cond, e.a, e.b];
      case "Cast": return [e.expr];
      case "InstanceOf": return [e.expr];
      case "CtorCall": return e.args;
      case "MethodRef": return e.target && e.target.k !== "TypeExpr" && e.target.k !== "Super" ? [e.target] : [];
    }
    return [];
  }
  function Flow(prog, ck) { this.prog = prog; this.ck = ck; }
  var FL = Flow.prototype;
  FL.err = function (file, pos, msg) { this.ck.error(file, pos, msg); };
  FL.analyzeClass = function (sym) {
    var self = this;
    this.file = sym.file;
    this.alive(sym);
    this.assign(sym);
    (this.prog.finalParamAssigns || []).forEach(function (a) { if (topLevel(a.v.method ? a.v.method.owner : sym) === sym || !a.v.method) self.err(a.file, a.pos, "final parameter " + a.v.name + " may not be assigned"); });
    this.exc(sym);
    if (sym === this.prog.topClasses[this.prog.topClasses.length - 1]) this.captures();
  };
  // percorre membros (inclusive classes aninhadas) chamando fn(corpo, contexto)
  function eachBody(sym, fn) {
    var d = sym.decl;
    if (sym.isEnum && sym.isEnum()) d.enumConsts.forEach(function (ec) { (ec.args || []).forEach(function (a) { fn({ expr: a, cls: sym, isStatic: true }); }); if (ec.anonSym) eachBody(ec.anonSym, fn); });
    d.members.forEach(function (m) {
      if (m.k === "Field" && m.init) fn({ expr: m.init, cls: sym, isStatic: !!(m.sym && m.sym.flags["static"]), field: m });
      else if (m.k === "Init") fn({ block: m.body, cls: sym, isStatic: m.isStatic, init: m });
      else if (m.k === "Method" && m.body) fn({ block: m.body, cls: sym, method: m.sym, decl: m });
      else if (m.k === "Class" && m.sym) eachBody(m.sym, fn);
    });
  }
  // ----- 12.1 vivacidade -----
  FL.alive = function (sym) {
    var self = this;
    eachBody(sym, function (b) {
      if (b.expr) { self.aliveExpr(b.expr); return; }
      self.recovery = false;
      var alive = self.aliveStat(b.block, true);
      if (b.method && alive && !self.recovery && b.method.ret !== T["void"] && b.method.name !== "<init>" && !isErr(b.method.ret)) {
        self.err(sym.file, b.block.endPos, "missing return statement");
      }
      if (b.init && !alive) self.err(sym.file, b.init.pos, "initializer must be able to complete normally");
    });
  };
  FL.aliveExpr = function (e) {
    var self = this;
    if (!e || typeof e !== "object") return;
    if (e.k === "Lambda") {
      if (e.body.k === "Block") {
        var a = this.aliveStat(e.body, true);
        if (a && e.samRet && e.samRet !== T["void"] && !isErr(e.samRet)) this.err(this.file, e.body.endPos, "missing return statement");
      } else this.aliveExpr(e.body);
      return;
    }
    if (e.k === "SwitchExpr") { this.aliveExpr(e.selector); this.aliveSwitch(e, true, true); return; }
    if (e.k === "New" && e.anonSym) { exprKids(e).forEach(function (x) { self.aliveExpr(x); }); var sf = this.file; this.alive(e.anonSym); this.file = sf; return; }
    exprKids(e).forEach(function (x) { self.aliveExpr(x); });
  };
  FL.aliveBlockStats = function (stats, alive) {
    var reported = false;
    for (var i = 0; i < stats.length; i++) {
      var s = stats[i];
      if (!alive && !reported && s.k !== "LocalClass" && s.k !== "Empty") {
        this.err(this.file, s.pos, "unreachable statement");
        reported = true;
        alive = true;
        this.recovery = true;
      }
      alive = this.aliveStat(s, alive);
    }
    return alive;
  };
  FL.aliveStat = function (s, alive) {
    var self = this;
    switch (s.k) {
      case "Block": return this.aliveBlockStats(s.stats, alive);
      case "LocalVar": s.vars.forEach(function (v) { self.aliveExpr(v.init); }); return alive;
      case "LocalClass": { var sf = this.file; this.alive(s.decl.sym); this.file = sf; return alive; }
      case "ExprStmt": this.aliveExpr(s.expr); return alive;
      case "If": {
        this.aliveExpr(s.cond);
        var a = this.aliveStat(s.then, alive);
        var b = s.els ? this.aliveStat(s.els, alive) : true;
        return a || b;
      }
      case "While": {
        this.aliveExpr(s.cond);
        s.broken = false;
        var bodyAlive = s.cond.cv === false ? false : alive;
        if (s.cond.cv === false) { this.err(this.file, s.body.pos, "unreachable statement"); bodyAlive = true; }
        this.withLoop(s, function () { self.aliveStat(s.body, bodyAlive); });
        return s.cond.cv === true ? !!s.broken : true;
      }
      case "DoWhile": {
        s.broken = false; s.continued = false;
        var ba = false;
        this.withLoop(s, function () { ba = self.aliveStat(s.body, alive); });
        this.aliveExpr(s.cond);
        return ((ba || s.continued) && s.cond.cv !== true) || !!s.broken;
      }
      case "For": {
        s.init.forEach(function (x) { if (x.k === "LocalVar") self.aliveStat(x, true); else self.aliveExpr(x); });
        if (s.cond) this.aliveExpr(s.cond);
        s.broken = false;
        if (s.cond && s.cond.cv === false) { this.err(this.file, s.body.pos, "unreachable statement"); }
        this.withLoop(s, function () { self.aliveStat(s.body, true); });
        s.update.forEach(function (x) { self.aliveExpr(x); });
        return (s.cond && s.cond.cv !== true) ? true : !!s.broken;
      }
      case "ForEach": {
        this.aliveExpr(s.expr);
        this.withLoop(s, function () { self.aliveStat(s.body, true); });
        return true;
      }
      case "Labeled": {
        s.broken = false;
        var prevL = this.labelTargets || [];
        this.labelTargets = prevL.concat([{ name: s.label, stmt: s }]);
        var r = this.aliveStat(s.body, alive);
        this.labelTargets = prevL;
        return r || !!s.broken;
      }
      case "Switch": this.aliveExpr(s.selector); return this.aliveSwitch(s, alive, false);
      case "Try": {
        (s.resources || []).forEach(function (r) { if (r.k === "LocalVar") self.aliveStat(r, true); else self.aliveExpr(r.expr); });
        var t = this.aliveStat(s.block, alive);
        s.catches.forEach(function (c) { if (self.aliveStat(c.body, true)) t = true; });
        if (s.fin) { var f = this.aliveStat(s.fin, true); if (!f) return false; }
        return t;
      }
      case "Sync": this.aliveExpr(s.lock); return this.aliveStat(s.body, alive);
      case "Return": if (s.expr) this.aliveExpr(s.expr); return false;
      case "Throw": this.aliveExpr(s.expr); return false;
      case "Yield": this.aliveExpr(s.expr); return false;
      case "Break": {
        var tgt = this.breakTarget(s);
        if (tgt) tgt.broken = true;
        return false;
      }
      case "Continue": { var lt = this.contTarget(s); if (lt) lt.continued = true; return false; }
      case "Assert": this.aliveExpr(s.cond); if (s.msg) this.aliveExpr(s.msg); return alive;
      case "Empty": return alive;
    }
    return alive;
  };
  FL.withLoop = function (s, fn) {
    var prev = this.loops || [];
    this.loops = prev.concat([s]);
    try { fn(); } finally { this.loops = prev; }
  };
  FL.breakTarget = function (s) {
    if (s.label) {
      var l = (this.labelTargets || []).filter(function (x) { return x.name === s.label; }).pop();
      return l ? l.stmt : null;
    }
    var ls = this.loops || [];
    return ls[ls.length - 1] || null;
  };
  FL.contTarget = function (s) {
    if (s.label) { var l = (this.labelTargets || []).filter(function (x) { return x.name === s.label; }).pop(); return l ? (l.stmt.body || l.stmt) : null; }
    var ls = (this.loops || []).filter(function (x) { return x.k !== "Switch"; });
    return ls[ls.length - 1] || null;
  };
  FL.aliveSwitch = function (s, alive, isExpr) {
    var self = this;
    s.broken = false;
    var any = false, lastAlive = true;
    var prev = this.loops || [];
    if (!isExpr) this.loops = prev.concat([s]);
    else this.loops = [];
    var prevL = this.labelTargets; if (isExpr) this.labelTargets = [];
    try {
      s.cases.forEach(function (c) {
        if (c.guard) self.aliveExpr(c.guard);
        if (s.arrow) {
          var b = c.body;
          var a;
          if (b.k === "ExprStmt") { self.aliveExpr(b.expr); a = true; }
          else a = self.aliveStat(b, true);
          if (a) { any = true; if (isExpr && b.k === "Block") self.err(self.file, b.endPos, "switch rule completes without providing a value\n  (switch rules in switch expressions must either provide a value or throw)"); }
        } else {
          lastAlive = self.aliveBlockStats(c.stats, true);
        }
      });
    } finally { this.loops = prev; this.labelTargets = prevL; }
    if (isExpr) {
      if (!s.arrow && lastAlive && s.cases.length) this.err(this.file, s.endPos, "switch expression completes without providing a value\n  (switch expressions must either provide a value or throw for all possible input values)");
      return true;
    }
    var exhaustive = s.hasDefault || s.exhaustive;
    if (s.arrow) return any || !exhaustive || !!s.broken;
    return lastAlive || !exhaustive || !!s.broken || !s.cases.length;
  };

  // ----- 12.2 atribuição definitiva -----
  function DA(o) { this.s = o || {}; this.dead = false; }
  DA.prototype.copy = function () { var n = new DA(); for (var k in this.s) n.s[k] = 1; n.dead = this.dead; return n; };
  DA.prototype.has = function (v) { return this.dead || !!this.s[v.uid]; };
  DA.prototype.add = function (v) { this.s[v.uid] = 1; };
  function daJoin(a, b) {
    if (a.dead) return b.copy();
    if (b.dead) return a.copy();
    var n = new DA();
    for (var k in a.s) if (b.s[k]) n.s[k] = 1;
    return n;
  }
  function daDead() { var d = new DA(); d.dead = true; return d; }
  var varUid = 0;
  function uidOf(v) { if (!v.uid) v.uid = ++varUid; return v.uid; }
  FL.assign = function (sym, base) {
    var self = this;
    this.reportedUninit = this.reportedUninit || {};
    this.blankFinals(sym, base);
    eachBody(sym, function (b) {
      var st = base ? base.copy() : new DA();
      if (b.method && b.method.paramSyms) b.method.paramSyms.forEach(function (p) { uidOf(p); st.add(p); });
      if (b.expr) { self.daExpr(b.expr, st); return; }
      self.daStat(b.block, st);
    });
  };
  // campos final sem valor inicial precisam ser atribuídos em todo construtor
  FL.blankFinals = function (sym, base) {
    var self = this, d = sym.decl;
    if (!d) return;
    d.members.forEach(function (m) { if (m.k === "Class" && m.sym) self.blankFinals(m.sym, base); });
    if (sym.isInterface() || sym.isRecord()) return;
    var blanks = sym.fieldList.filter(function (f) { return f.flags["final"] && !f.flags["static"] && f.decl && f.decl.k === "Field" && !f.decl.init; });
    if (!blanks.length) return;
    blanks.forEach(uidOf);
    var st0 = new DA();
    this.daFields = blanks;
    d.members.forEach(function (m) { if (m.k === "Init" && !m.isStatic) self.daStat(m.body, st0); });
    var ctors = d.members.filter(function (m) { return m.k === "Method" && m.isCtor && m.body; });
    if (!ctors.length) {
      blanks.forEach(function (f) { if (!st0.has(f)) self.err(sym.file, d.pos, "variable " + f.name + " not initialized in the default constructor"); });
      this.daFields = null;
      return;
    }
    ctors.forEach(function (c) {
      var stats = c.body.stats;
      if (stats.length && stats[0].k === "ExprStmt" && stats[0].expr.k === "CtorCall" && stats[0].expr.kind === "this") return;
      var st = st0.copy();
      if (c.sym && c.sym.paramSyms) c.sym.paramSyms.forEach(function (p) { uidOf(p); st.add(p); });
      self.reportedUninit = {};
      var errs0 = self.ck.errs.length;
      self.daStat(c.body, st);
      self.ck.errs.length = errs0;
      if (st.dead) return;
      blanks.forEach(function (f) { if (!st.has(f)) self.err(sym.file, c.body.endPos, "variable " + f.name + " might not have been initialized"); });
    });
    this.daFields = null;
  };
  // devolve {t, f} para condições
  FL.daCond = function (e, st) {
    var self = this;
    while (e.k === "Paren") e = e.expr;
    if (e.cv === true) return { t: st.copy(), f: daDead() };
    if (e.cv === false) return { t: daDead(), f: st.copy() };
    if (e.k === "Binary" && e.op === "&&") {
      var l = this.daCond(e.l, st);
      var r = this.daCond(e.r, l.t);
      return { t: r.t, f: daJoin(l.f, r.f) };
    }
    if (e.k === "Binary" && e.op === "||") {
      var l2 = this.daCond(e.l, st);
      var r2 = this.daCond(e.r, l2.f);
      return { t: daJoin(l2.t, r2.t), f: r2.f };
    }
    if (e.k === "Unary" && e.op === "!") { var x = this.daCond(e.expr, st); return { t: x.f, f: x.t }; }
    if (e.k === "Cond") {
      var c = this.daCond(e.cond, st);
      var a = this.daCond(e.a, c.t), b = this.daCond(e.b, c.f);
      return { t: daJoin(a.t, b.t), f: daJoin(a.f, b.f) };
    }
    var s2 = st.copy();
    this.daExpr(e, s2);
    return { t: s2, f: s2.copy() };
  };
  FL.daUse = function (e, st) {
    var v = e.ref.sym;
    uidOf(v);
    if (v.kind !== "local" && v.kind !== "resource") return;
    if (!st.has(v)) {
      if (!this.reportedUninit[v.uid]) this.err(this.file, e.pos, "variable " + v.name + " might not have been initialized");
      st.add(v);
    }
  };
  // avalia a expressão, atualizando st (estado após)
  FL.daExpr = function (e, st) {
    var self = this;
    if (!e) return;
    switch (e.k) {
      case "Ident":
        if (e.ref && e.ref.kind === "local") this.daUse(e, st);
        return;
      case "Assign": {
        var tg = e.target;
        while (tg.k === "Paren") tg = tg.expr;
        if (tg.k === "Ident" && tg.ref && tg.ref.kind === "local") {
          this.daExpr(e.value, st);
          var v = tg.ref.sym; uidOf(v);
          if (v.flags["final"] && !v.hasInit && st.has(v) && !st.dead) this.err(this.file, tg.pos, "variable " + v.name + " might already have been assigned");
          st.add(v);
          return;
        }
        if (tg.k === "Index") { this.daExpr(tg.arr, st); this.daExpr(tg.index, st); }
        else if (tg.k === "Select") this.daExpr(tg.target, st);
        this.daExpr(e.value, st);
        if (this.daFields && tg.ref && tg.ref.kind === "field" && this.daFields.indexOf(tg.ref.sym) >= 0 && (tg.k === "Ident" || (tg.k === "Select" && tg.target.k === "This"))) st.add(tg.ref.sym);
        return;
      }
      case "Binary":
        if (e.op === "&&" || e.op === "||") { var r = this.daCond(e, st); var j = daJoin(r.t, r.f); st.s = j.s; st.dead = j.dead; return; }
        break;
      case "Cond": {
        if (e.type === T["boolean"]) { var r2 = this.daCond(e, st); var j2 = daJoin(r2.t, r2.f); st.s = j2.s; st.dead = j2.dead; return; }
        var c = this.daCond(e.cond, st);
        this.daExpr(e.a, c.t); this.daExpr(e.b, c.f);
        var j3 = daJoin(c.t, c.f); st.s = j3.s; st.dead = j3.dead;
        return;
      }
      case "Lambda": {
        var ls = st.copy();
        if (e.paramSyms) e.paramSyms.forEach(function (p) { uidOf(p); ls.add(p); });
        if (e.body.k === "Block") this.daStat(e.body, ls); else this.daExpr(e.body, ls);
        return;
      }
      case "SwitchExpr": this.daSwitch(e, st, true); return;
      case "New":
        exprKids(e).forEach(function (x) { self.daExpr(x, st); });
        if (e.anonSym) { var sf = this.file; this.assign(e.anonSym, st); this.file = sf; }
        return;
      case "InstanceOf":
        this.daExpr(e.expr, st);
        if (e.pattern) collectBindings(e.pattern).forEach(function (v) { uidOf(v); st.add(v); });
        return;
    }
    exprKids(e).forEach(function (x) { self.daExpr(x, st); });
  };
  FL.daSet = function (st, from) { st.s = from.s; st.dead = from.dead; };
  FL.daStat = function (s, st) {
    var self = this, c, j;
    switch (s.k) {
      case "Block": s.stats.forEach(function (x) { self.daStat(x, st); }); return;
      case "LocalVar":
        s.vars.forEach(function (d) { if (d.vsym) uidOf(d.vsym); if (d.init) { self.daExpr(d.init, st); st.add(d.vsym); } });
        return;
      case "LocalClass": { var sf = this.file; this.assign(s.decl.sym, st); this.file = sf; return; }
      case "ExprStmt": this.daExpr(s.expr, st); return;
      case "If": {
        c = this.daCond(s.cond, st);
        this.daStat(s.then, c.t);
        if (s.els) this.daStat(s.els, c.f);
        this.daSet(st, daJoin(c.t, c.f));
        return;
      }
      case "While": {
        c = this.daCond(s.cond, st);
        s.daBreaks = [];
        this.daLoop(s, function () { self.daStat(s.body, c.t); });
        var out = c.f;
        s.daBreaks.forEach(function (b) { out = daJoin(out, b); });
        this.daSet(st, out);
        return;
      }
      case "DoWhile": {
        s.daBreaks = [];
        var b0 = st.copy();
        this.daLoop(s, function () { self.daStat(s.body, b0); });
        c = this.daCond(s.cond, b0);
        var out2 = c.f;
        s.daBreaks.forEach(function (b) { out2 = daJoin(out2, b); });
        this.daSet(st, out2);
        return;
      }
      case "For": {
        s.init.forEach(function (x) { if (x.k === "LocalVar") self.daStat(x, st); else self.daExpr(x, st); });
        c = s.cond ? this.daCond(s.cond, st) : { t: st.copy(), f: daDead() };
        s.daBreaks = [];
        var body = c.t;
        this.daLoop(s, function () { self.daStat(s.body, body); s.update.forEach(function (x) { self.daExpr(x, body); }); });
        var out3 = c.f;
        s.daBreaks.forEach(function (b) { out3 = daJoin(out3, b); });
        this.daSet(st, out3);
        return;
      }
      case "ForEach": {
        this.daExpr(s.expr, st);
        var bs = st.copy();
        var v = s.varDecl.vars[0].vsym; if (v) { uidOf(v); bs.add(v); }
        s.daBreaks = [];
        this.daLoop(s, function () { self.daStat(s.body, bs); });
        return;
      }
      case "Labeled": {
        s.daBreaks = [];
        var prev = this.daLabels || [];
        this.daLabels = prev.concat([{ name: s.label, stmt: s }]);
        this.daStat(s.body, st);
        this.daLabels = prev;
        var o = st;
        s.daBreaks.forEach(function (b) { o = daJoin(o, b); });
        this.daSet(st, o);
        return;
      }
      case "Switch": this.daSwitch(s, st, false); return;
      case "Try": {
        var start = st.copy();
        var ts = st.copy();
        (s.resources || []).forEach(function (r) { if (r.k === "LocalVar") self.daStat(r, ts); else self.daExpr(r.expr, ts); });
        this.daStat(s.block, ts);
        var end = ts;
        s.catches.forEach(function (cc) {
          var cs = start.copy();
          if (cc.vsym) { uidOf(cc.vsym); cs.add(cc.vsym); }
          self.daStat(cc.body, cs);
          end = daJoin(end, cs);
        });
        if (s.fin) {
          var fs = start.copy();
          this.daStat(s.fin, fs);
          if (fs.dead) end = daDead();
          else for (var k in fs.s) end.s[k] = 1;
        }
        this.daSet(st, end);
        return;
      }
      case "Sync": this.daExpr(s.lock, st); this.daStat(s.body, st); return;
      case "Return": case "Throw": case "Yield":
        if (s.expr) this.daExpr(s.expr, st);
        this.daSet(st, daDead());
        return;
      case "Break": {
        var tg = this.daBreakTarget(s);
        if (tg && tg.daBreaks) tg.daBreaks.push(st.copy());
        this.daSet(st, daDead());
        return;
      }
      case "Continue": this.daSet(st, daDead()); return;
      case "Assert": { var sv = st.copy(); this.daCond(s.cond, sv); if (s.msg) this.daExpr(s.msg, sv); return; }
    }
  };
  FL.daLoop = function (s, fn) { var prev = this.daLoops || []; this.daLoops = prev.concat([s]); try { fn(); } finally { this.daLoops = prev; } };
  FL.daBreakTarget = function (s) {
    if (s.label) { var l = (this.daLabels || []).filter(function (x) { return x.name === s.label; }).pop(); return l ? l.stmt : null; }
    var ls = this.daLoops || [];
    return ls[ls.length - 1];
  };
  FL.daSwitch = function (s, st, isExpr) {
    var self = this;
    this.daExpr(s.selector, st);
    var start = st.copy(), out = null;
    s.daBreaks = [];
    var prev = this.daLoops || [];
    this.daLoops = isExpr ? [] : prev.concat([s]);
    var fall = null;
    try {
      s.cases.forEach(function (c) {
        var cs = start.copy();
        c.labels.forEach(function (l) { collectBindings(l).forEach(function (v) { uidOf(v); cs.add(v); }); });
        if (c.guard) { var g = self.daCond(c.guard, cs); cs = g.t; }
        if (s.arrow) {
          if (c.body.k === "ExprStmt") self.daExpr(c.body.expr, cs); else self.daStat(c.body, cs);
          out = out ? daJoin(out, cs) : cs;
        } else {
          if (fall && !fall.dead) cs = daJoin(cs, fall);
          c.stats.forEach(function (x) { self.daStat(x, cs); });
          fall = cs;
        }
      });
    } finally { this.daLoops = prev; }
    if (!s.arrow && fall) out = fall;
    if (!out) out = start.copy();
    s.daBreaks.forEach(function (b) { out = daJoin(out, b); });
    if (!s.hasDefault && !s.exhaustive) out = daJoin(out, start);
    if (isExpr) out = start.copy();
    this.daSet(st, out);
  };

  // ----- 12.3 exceções verificadas -----
  FL.exc = function (sym) {
    var self = this;
    eachBody(sym, function (b) {
      self.pending = [];
      self.handlers = [];
      var declared = b.method ? b.method.throws.filter(function (t) { return t.k === "class"; }).map(function (t) { return t.sym; }) : [];
      // inicializadores de instância: podem lançar o que todos os construtores declaram
      if (b.init && !b.isStatic || (b.field && !b.isStatic)) {
        var ctors = sym.ctors.filter(function (c) { return !c.isDefault; });
        if (ctors.length && !sym.anon) declared = ctors[0].throws.filter(function (t) { return t.k === "class"; }).map(function (t) { return t.sym; });
        if (sym.anon) declared = null;
      }
      self.declared = declared;
      if (b.method && b.method.implicitThrows && b.decl) b.method.implicitThrows.forEach(function (t) { if (t.k === "class") self.thrown(t.sym, b.decl.body.pos); });
      if (b.expr) self.excExpr(b.expr); else self.excStat(b.block);
      self.pending.forEach(function (p) { self.err(sym.file, p.pos, "unreported exception " + p.sym.name + "; must be caught or declared to be thrown" + (p.extra || "")); });
    });
    // construtores padrão que chamam super() com exceções
    sym.ctors.forEach(function (c) {
      if ((c.isDefault || c.anonCtor) && c.implicitThrows) c.implicitThrows.forEach(function (t) {
        if (t.k === "class" && isChecked(t.sym) && !sym.anon) self.err(sym.file, sym.decl.pos, "unreported exception " + t.sym.name + " in default constructor");
      });
    });
  };
  FL.thrown = function (csym, pos, extra) {
    if (!isChecked(csym)) {
      // não verificada: ainda conta para "catch" de Exception etc.
      for (var i = this.handlers.length - 1; i >= 0; i--) { this.handlers[i].thrownAll.push(csym); if (this.handlers[i].catches.some(function (c) { return isSubClass(csym, c); })) return; }
      return;
    }
    for (var j = this.handlers.length - 1; j >= 0; j--) {
      var h = this.handlers[j];
      if (h.lambda) {
        if (h.allowed.some(function (c) { return isSubClass(csym, c); })) return;
        this.pending.push({ sym: csym, pos: pos, extra: extra });
        return;
      }
      h.thrownAll.push(csym);
      if (h.catches.some(function (c) { return isSubClass(csym, c); })) return;
    }
    if (this.declared === null) return;
    if (this.declared.some(function (c) { return isSubClass(csym, c); })) return;
    this.pending.push({ sym: csym, pos: pos, extra: extra });
  };
  FL.excExpr = function (e) {
    var self = this;
    if (!e || typeof e !== "object") return;
    switch (e.k) {
      case "Lambda": {
        var allowed = (e.sam && e.sam.throws || []).filter(function (t) { return t.k === "class"; }).map(function (t) { return t.sym; });
        this.handlers.push({ lambda: true, allowed: allowed, catches: [], thrownAll: [] });
        if (e.body.k === "Block") this.excStat(e.body); else this.excExpr(e.body);
        this.handlers.pop();
        return;
      }
      case "MethodRef": {
        exprKids(e).forEach(function (x) { self.excExpr(x); });
        if (e.thrown && e.sam) {
          var al = (e.sam.throws || []).filter(function (t) { return t.k === "class"; }).map(function (t) { return t.sym; });
          e.thrown.forEach(function (t) { if (t.k === "class" && isChecked(t.sym) && !al.some(function (c) { return isSubClass(t.sym, c); })) self.err(self.file, e.pos, "incompatible thrown types " + t.sym.name + " in functional expression"); });
        }
        return;
      }
      case "SwitchExpr": this.excExpr(e.selector); this.excSwitch(e); return;
      case "New": {
        exprKids(e).forEach(function (x) { self.excExpr(x); });
        (e.thrown || []).forEach(function (t) { if (t.k === "class") self.thrown(t.sym, e.pos); });
        if (e.anonSym) { var sp = [this.pending, this.handlers, this.declared, this.file]; this.exc(e.anonSym); this.pending = sp[0]; this.handlers = sp[1]; this.declared = sp[2]; this.file = sp[3]; }
        return;
      }
      case "Call": case "CtorCall":
        exprKids(e).forEach(function (x) { self.excExpr(x); });
        (e.thrown || []).forEach(function (t) { if (t.k === "class") self.thrown(t.sym, e.k === "CtorCall" ? e.kwPos : e.pos); else if (t.k === "tvar") { var b = erasure(t); if (b.k === "class") self.thrown(b.sym, e.pos); } });
        return;
    }
    exprKids(e).forEach(function (x) { self.excExpr(x); });
  };
  FL.excStat = function (s) {
    var self = this;
    if (!s) return;
    switch (s.k) {
      case "Block": s.stats.forEach(function (x) { self.excStat(x); }); return;
      case "LocalVar": s.vars.forEach(function (d) { self.excExpr(d.init); }); return;
      case "LocalClass": { var sp = [this.pending, this.handlers, this.declared, this.file]; this.exc(s.decl.sym); this.pending = sp[0]; this.handlers = sp[1]; this.declared = sp[2]; this.file = sp[3]; return; }
      case "ExprStmt": this.excExpr(s.expr); return;
      case "If": this.excExpr(s.cond); this.excStat(s.then); this.excStat(s.els); return;
      case "While": case "DoWhile": this.excExpr(s.cond); this.excStat(s.body); return;
      case "For": s.init.forEach(function (x) { if (x.k === "LocalVar") self.excStat(x); else self.excExpr(x); }); this.excExpr(s.cond); s.update.forEach(function (x) { self.excExpr(x); }); this.excStat(s.body); return;
      case "ForEach": this.excExpr(s.expr); this.excStat(s.body); return;
      case "Labeled": this.excStat(s.body); return;
      case "Switch": this.excExpr(s.selector); this.excSwitch(s); return;
      case "Sync": this.excExpr(s.lock); this.excStat(s.body); return;
      case "Return": case "Yield": this.excExpr(s.expr); return;
      case "Throw": {
        this.excExpr(s.expr);
        var t = s.expr.type;
        if (t && t.k === "class") {
          // relançar parâmetro de catch efetivamente final: tipos precisos
          var x = s.expr;
          if (x.k === "Ident" && x.ref && x.ref.kind === "local" && x.ref.sym.kind === "catch" && x.ref.sym.assigns === 0 && x.ref.sym.precise) {
            x.ref.sym.precise.forEach(function (ps) { self.thrown(ps, s.pos); });
          } else this.thrown(t.sym, s.pos);
        }
        return;
      }
      case "Try": this.excTry(s); return;
      case "Assert": this.excExpr(s.cond); this.excExpr(s.msg); return;
    }
  };
  FL.excSwitch = function (s) {
    var self = this;
    s.cases.forEach(function (c) {
      self.excExpr(c.guard);
      if (s.arrow) { if (c.body.k === "ExprStmt") self.excExpr(c.body.expr); else self.excStat(c.body); }
      else c.stats.forEach(function (x) { self.excStat(x); });
    });
  };
  FL.excTry = function (s) {
    var self = this;
    var catches = [];
    s.catches.forEach(function (c) { (c.ctypes || []).forEach(function (t) { if (t.k === "class") catches.push(t.sym); }); });
    var h = { catches: catches, thrownAll: [] };
    this.handlers.push(h);
    (s.resources || []).forEach(function (r) {
      if (r.k === "LocalVar") self.excStat(r); else self.excExpr(r.expr);
      // close() implícito
      var rt = r.rtype;
      if (rt && rt.k === "class") {
        var cm = self.ck.allMethods(rt, "close").filter(function (c) { return c.m.params.length === 0; })[0];
        if (cm) cm.m.throws.forEach(function (t) {
          if (t.k === "class") self.thrown(t.sym, r.k === "LocalVar" ? r.vars[0].init.pos : r.expr.pos, "\n  exception thrown from implicit call to close() on resource variable " + (r.k === "LocalVar" ? r.vars[0].name : "?"));
        });
      }
    });
    this.excStat(s.block);
    this.handlers.pop();
    // catch nunca lançado / já capturado
    var prevTypes = [];
    s.catches.forEach(function (c) {
      var precise = [];
      (c.ctypes || []).forEach(function (t, idx) {
        if (t.k !== "class") return;
        var cs = t.sym;
        if (prevTypes.some(function (p) { return isSubClass(cs, p); })) {
          self.err(self.file, c.pos, "exception " + cs.name + " has already been caught");
          return;
        }
        var checkedOnly = isChecked(cs) && cs.full !== "java.lang.Exception" && cs.full !== "java.lang.Throwable";
        var could = h.thrownAll.some(function (x) { return isSubClass(x, cs) || isSubClass(cs, x); });
        if (checkedOnly && !could) self.err(self.file, c.pos, "exception " + cs.name + " is never thrown in body of corresponding try statement");
        h.thrownAll.forEach(function (x) { if (isChecked(x) && (isSubClass(x, cs)) && precise.indexOf(x) < 0) precise.push(x); });
      });
      if (c.vsym) c.vsym.precise = precise.length ? precise : null;
      (c.ctypes || []).forEach(function (t) { if (t.k === "class") prevTypes.push(t.sym); });
    });
    s.catches.forEach(function (c) { self.excStat(c.body); });
    if (s.fin) this.excStat(s.fin);
  };
  // ----- 12.4 variáveis capturadas precisam ser efetivamente finais -----
  FL.captures = function () {
    var self = this;
    function effFinal(v) {
      if (v.flags["final"]) return true;
      if (v.kind === "param" || v.kind === "catch" || v.kind === "foreach" || v.kind === "pattern" || v.kind === "resource") return v.assigns === 0;
      return v.hasInit ? v.assigns === 0 : v.assigns <= 1;
    }
    var all = (this.prog.captureRefs || []).concat(this.prog.captureAssigns || []);
    all.sort(function (a, b) { return a.pos - b.pos; });
    all.forEach(function (r) {
      if (r.v.kind === "field") return;
      var assignedInside = (self.prog.captureAssigns || []).some(function (a) { return a.v === r.v; });
      if (!effFinal(r.v) || assignedInside) {
        self.err(r.file, r.pos, "local variables referenced from " + (r.kind === "lambda" ? "a lambda expression" : "an inner class") + " must be final or effectively final");
      }
    });
  };

  /* =====================================================================
     13. Execução: valores, pilha, exceções
     ===================================================================== */
  var RT = null; // execução atual
  function JBox(c, v) { this.$c = c; this.v = v; }
  function JArr(c, a) { this.$c = c; this.a = a; }
  function JavaThrow(ex) { this.ex = ex; }
  function ExitSignal(code) { this.code = code; }
  function NeedInput() {}
  function LimitSignal(msg) { this.msg = msg; }
  function StopSignal() {}
  function isInternal(e) { return e instanceof ExitSignal || e instanceof NeedInput || e instanceof LimitSignal || e instanceof StopSignal; }
  var RET = { t: 3 }, YLD = { t: 4 };
  function Brk(label) { this.t = 1; this.label = label; }
  function Cont(label) { this.t = 2; this.label = label; }
  var BRK0 = new Brk(null), CONT0 = new Cont(null);

  function jstr(s) { return new String(s); }  // String criada em tempo de execução (não internada)
  function isStr(v) { return typeof v === "string" || v instanceof String; }
  function S(v) { return typeof v === "string" ? v : v.valueOf(); }
  function Frame(t, n, name) { this.t = t; this.l = new Array(n); this.line = 0; this.name = name; this.rv = undefined; this.c = null; }

  function classOf(v) {
    if (typeof v === "string" || v instanceof String) return LIB["java.lang.String"];
    return v.$c;
  }
  // tabela de métodos virtuais
  function vtOf(sym) {
    if (sym.vt) return sym.vt;
    complete(sym);
    var vt = Object.create(null);
    if (sym.superT && sym.superT.k === "class") { var sv = vtOf(sym.superT.sym); for (var k in sv) vt[k] = sv[k]; }
    var own = Object.create(null);
    sym.methodList.forEach(function (m) {
      if (m.flags["static"] || !m.impl) return;
      if (m.flags.abstract && !m.flags["default"]) return;
      own[m.key] = m.impl;
      (m.overrides || []).forEach(function (o) { if (o.key) own[o.key] = m.impl; });
      (m.bridges || []).forEach(function (bk) { own[bk] = m.impl; });
    });
    for (var k2 in own) vt[k2] = own[k2];
    // métodos default das interfaces (se ninguém implementa)
    var seen = {};
    (function addIf(s) {
      s.ifaces.forEach(function (it) {
        var is = it.sym;
        if (seen[is.id]) return;
        seen[is.id] = 1;
        complete(is);
        var iv = vtOf(is);
        for (var k3 in iv) if (!(k3 in vt)) vt[k3] = iv[k3];
        addIf(is);
      });
      if (s.superT && s.superT.k === "class") addIf(s.superT.sym);
    })(sym);
    sym.vt = vt;
    return vt;
  }
  function vcall(recv, key, args) {
    var c = classOf(recv);
    var fn = vtOf(c)[key];
    if (!fn) fn = findByName(c, key);
    if (!fn) throw new Error("(simulador) método não encontrado: " + key + " em " + c.full);
    return fn.apply(recv, args || []);
  }
  // procura por nome+aridade (para chamadas da biblioteca a objetos do usuário)
  function findByName(c, key) {
    var name = key.slice(0, key.indexOf("(")), n = key === name + "()" ? 0 : key.split(",").length;
    var vt = vtOf(c);
    for (var k in vt) {
      if (k.slice(0, k.indexOf("(")) === name) {
        var kn = k.indexOf("()") >= 0 ? 0 : k.split(",").length;
        if (kn === n) return vt[k];
      }
    }
    return null;
  }
  // chama o método "name" de um objeto Java (usado pela biblioteca): procura pela aridade
  function jcall(recv, name, args) {
    var c = classOf(recv), vt = vtOf(c);
    var cache = c.byNameCache || (c.byNameCache = {});
    var ck = name + "/" + args.length;
    var fn = cache[ck];
    if (!fn) {
      fn = findByName(c, name + "(" + (args.length ? new Array(args.length).fill("x").join(",") : "") + ")");
      cache[ck] = fn;
    }
    if (!fn) throw new Error("(simulador) método não encontrado: " + name + " em " + c.full);
    return fn.apply(recv, args);
  }

  // ---------- exceções ----------
  function newObj(sym) { var o = { $c: sym }; return o; }
  function mkThrowable(full, msg, internal) {
    var sym = L(full);
    var o = newObj(sym);
    o.message = msg === undefined ? null : msg;
    o.cause = null; o.suppressed = [];
    fillStack(o, internal);
    return o;
  }
  function throwJ(full, msg, internal) { throw new JavaThrow(mkThrowable(full, msg, internal)); }
  function npe(msg) { throwJ("java.lang.NullPointerException", msg === undefined ? null : msg); }
  function fillStack(o, internal) {
    var frames = [];
    if (internal) internal.forEach(function (f) { frames.push(f); });
    if (!RT) { o.stack = frames; return; }
    var st = RT.stack, i = st.length - 1;
    // pula construtores da própria exceção
    while (i >= 0 && st[i].ctorOf && isSubClass(o.$c, st[i].ctorOf) && isSubClass(st[i].ctorOf, L("java.lang.Throwable"))) i--;
    for (; i >= 0; i--) {
      var f = st[i];
      frames.push(f.name + "(" + (f.file || "Main.java") + ":" + f.line + ")");
      if (frames.length >= 1024) break;
    }
    o.stack = frames;
  }
  // converte erro JS em exceção Java (StackOverflowError etc.)
  function toJava(e) {
    if (e instanceof JavaThrow) return e.ex;
    if (e instanceof RangeError) {
      var o = newObj(L("java.lang.StackOverflowError")); o.message = null; o.cause = null; o.suppressed = [];
      o.stack = e.javaStack || [];
      return o;
    }
    return null;
  }

  // ---------- conversões em tempo de execução ----------
  function primCastFn(from, to) {
    var f = from.n, t = to.n;
    if (f === t) return null;
    switch (t) {
      case "int":
        if (f === "long") return function (v) { return Number(BigInt.asIntN(32, v)); };
        if (f === "float" || f === "double") return toInt32;
        return null;
      case "long":
        if (f === "float" || f === "double") return d2l;
        return function (v) { return BigInt(v); };
      case "short":
        if (f === "byte") return null;
        if (f === "long") return function (v) { return Number(BigInt.asIntN(16, v)); };
        if (f === "float" || f === "double") return function (v) { return (toInt32(v) << 16) >> 16; };
        return function (v) { return (v << 16) >> 16; };
      case "byte":
        if (f === "long") return function (v) { return Number(BigInt.asIntN(8, v)); };
        if (f === "float" || f === "double") return function (v) { return (toInt32(v) << 24) >> 24; };
        return function (v) { return (v << 24) >> 24; };
      case "char":
        if (f === "long") return function (v) { return Number(BigInt.asUintN(16, v)); };
        if (f === "float" || f === "double") return function (v) { return toInt32(v) & 0xFFFF; };
        return function (v) { return v & 0xFFFF; };
      case "float":
        if (f === "long") return function (v) { return Math.fround(Number(v)); };
        if (f === "double") return Math.fround;
        return f === "int" ? function (v) { return Math.fround(v); } : null;
      case "double":
        if (f === "long") return function (v) { return Number(v); };
        return null;
    }
    return null;
  }
  var BOX_CACHE_KEYS = { "java.lang.Integer": 1, "java.lang.Short": 1, "java.lang.Byte": 1, "java.lang.Long": 1, "java.lang.Character": 1 };
  nullProto(BOX_CACHE_KEYS);
  function boxVal(n, v) {
    var full = BOX[n];
    if (n === "boolean") return v ? RT.TRUE : RT.FALSE;
    if (BOX_CACHE_KEYS[full]) {
      var num = n === "long" ? Number(v) : v;
      var lim = n === "char" ? (num >= 0 && num <= 127) : (num >= -128 && num <= 127);
      if (lim) {
        var cache = RT.boxCache[n] || (RT.boxCache[n] = {});
        var c = cache[num];
        if (!c) c = cache[num] = new JBox(L(full), v);
        return c;
      }
    }
    return new JBox(L(full), v);
  }
  function unboxVal(v, desc) {
    if (v === null) npe(desc ? desc : null);
    return v.v;
  }
  // função de conversão de "from" para "to" (null = identidade)
  function convFn(from, to, nullDesc) {
    if (!from || !to || isErr(from) || isErr(to) || from === T["void"]) return null;
    if (from.k === "prim" && to.k === "prim") return primCastFn(from, to);
    if (from.k === "prim" && to.k !== "prim") {
      if (from.n === "void") return null;
      var tu = unboxedType(to);
      if (tu && tu.n !== from.n) { var c0 = primCastFn(from, tu); return function (v) { return boxVal(tu.n, c0 ? c0(v) : v); }; }
      var n = from.n;
      return function (v) { return boxVal(n, v); };
    }
    if (from.k !== "prim" && to.k === "prim") {
      var fu = unboxedType(from) || to;
      var c1 = primCastFn(fu, to);
      var d = nullDesc;
      var bt = boxedType(fu);
      var checkCls = !unboxedType(from);
      return function (v) {
        if (v === null) npe(d);
        if (checkCls && !(v instanceof JBox && v.$c === bt.sym)) castFail(v, bt);
        return c1 ? c1(v.v) : v.v;
      };
    }
    return null;
  }
  function castFail(v, t) {
    var from = classOf(v);
    var tn = t.k === "array" ? arrayClassName(t) : t.sym.bin;
    var fromN = from.bin;
    var mod = function (c) { return c.isLib ? "module java.base of loader 'bootstrap'" : "unnamed module of loader 'app'"; };
    var tc = t.k === "class" ? t.sym : null;
    var msg;
    if (tc && from.isLib === tc.isLib) msg = "class " + fromN + " cannot be cast to class " + tn + " (" + fromN + " and " + tn + " are in " + mod(from) + ")";
    else msg = "class " + fromN + " cannot be cast to class " + tn + " (" + fromN + " is in " + mod(from) + "; " + tn + " is in " + (tc ? mod(tc) : "module java.base of loader 'bootstrap'") + ")";
    throwJ("java.lang.ClassCastException", msg);
  }
  // instanceof em tempo de execução
  function instOf(v, t) {
    if (v === null) return false;
    if (t.k === "class") {
      var c = classOf(v);
      if (c === t.sym) return true;
      if (t.sym.full === "java.lang.Object") return true;
      return isSubClass(c, t.sym);
    }
    if (t.k === "array") {
      if (!(v instanceof JArr)) return false;
      var et = v.$c.elemType;
      if (t.elem.k === "prim" || et.k === "prim") return et.k === t.elem.k && et.n === t.elem.n;
      return isSubtype(et, t.elem) || isSubtype(erasure(et), erasure(t.elem));
    }
    if (t.k === "tvar") return instOf(v, erasure(t));
    if (t.k === "inter") return t.types.every(function (x) { return instOf(v, x); });
    return true;
  }

  // ---------- arrays ----------
  var ARRAY_CLASSES = {};
  function arrayClassName(t) {
    if (t.k === "prim") return { "int": "I", "long": "J", "double": "D", "float": "F", "boolean": "Z", "char": "C", "byte": "B", "short": "S" }[t.n];
    if (t.k === "array") return "[" + arrayClassName(t.elem);
    return "L" + erasedName(t).replace(/^.*?(?=[^.]*$)/, function (m) { return m; }) + ";";
  }
  function binName(t) {
    if (t.k === "prim") return arrayClassName(t);
    if (t.k === "array") return "[" + binName(t.elem);
    var e = erasure(t);
    return "L" + (e.sym ? e.sym.bin : "java.lang.Object") + ";";
  }
  function arrayClass(elem) {
    var name = "[" + binName(elem);
    var c = ARRAY_CLASSES[name];
    if (c) return c;
    c = new ClassSym(name, name, "class");
    c.bin = name; c.isLib = true; c.isArray = true; c.elemType = elem;
    c.superT = OBJ(); c.headerDone = true; c.completed = true;
    c.ifaces = [libType("java.lang.Cloneable"), libType("java.io.Serializable")];
    ARRAY_CLASSES[name] = c;
    return c;
  }
  function newArray(elem, n) {
    if (n < 0) throwJ("java.lang.NegativeArraySizeException", String(n));
    var a;
    if (elem.k === "prim") {
      switch (elem.n) {
        case "int": a = new Int32Array(n); break;
        case "long": a = new BigInt64Array(n); break;
        case "double": a = new Float64Array(n); break;
        case "float": a = new Float32Array(n); break;
        case "short": a = new Int16Array(n); break;
        case "byte": a = new Int8Array(n); break;
        case "char": a = new Uint16Array(n); break;
        case "boolean": a = new Array(n).fill(false); break;
      }
    } else { a = new Array(n).fill(null); }
    return new JArr(arrayClass(elem), a);
  }
  function newMultiArray(t, dims, k) {
    var elem = t.elem;
    var arr = newArray(elem, dims[k]);
    if (k + 1 < dims.length) for (var i = 0; i < dims[k]; i++) arr.a[i] = newMultiArray(elem, dims, k + 1);
    return arr;
  }
  function arrIndexFail(i, n) { throwJ("java.lang.ArrayIndexOutOfBoundsException", "Index " + i + " out of bounds for length " + n); }

  // ---------- hash de identidade (fictício, estável) ----------
  function identityHash(o) {
    if (o.$h === undefined) {
      // xorshift estável por execução
      var x = RT.hashState;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      RT.hashState = x;
      o.$h = (x >>> 1) & 0x7fffffff;
      if (!o.$h) o.$h = 0x1b6d3586;
    }
    return o.$h;
  }

  // ---------- toString / equals / hashCode ----------
  function toStr(v) {
    if (v === null) return "null";
    if (typeof v === "string") return v;
    if (v instanceof String) return v.valueOf();
    if (v instanceof JBox) return boxToString(v);
    var r = vcall(v, "toString()", []);
    return r === null ? "null" : S(r);
  }
  function callToString(v) { return toStr(v); }
  function boxToString(b) {
    var n = UNBOX[b.$c.full];
    switch (n) {
      case "char": return String.fromCharCode(b.v);
      case "double": return doubleToString(b.v);
      case "float": return floatToString(b.v);
      case "long": return b.v.toString();
      default: return String(b.v);
    }
  }
  function jequals(a, b) {
    if (a === null) return b === null;
    if (isStr(a)) return isStr(b) && S(a) === S(b);
    if (a instanceof JBox) return b instanceof JBox && a.$c === b.$c && (a.v === b.v || (a.v !== a.v && b.v !== b.v));
    var r = vcall(a, "equals(java.lang.Object)", [b]);
    return r;
  }
  function stringHash(s) {
    s = S(s);
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  }
  function doubleHash(d) {
    var buf = new DataView(new ArrayBuffer(8));
    if (d !== d) d = NaN;
    buf.setFloat64(0, d);
    return (buf.getInt32(0) ^ buf.getInt32(4)) | 0;
  }
  function boxHash(b) {
    var n = UNBOX[b.$c.full];
    switch (n) {
      case "int": case "short": case "byte": case "char": return b.v | 0;
      case "boolean": return b.v ? 1231 : 1237;
      case "long": return Number(BigInt.asIntN(32, b.v ^ (b.v >> 32n)));
      case "double": return doubleHash(b.v);
      case "float": { var dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, b.v); return dv.getInt32(0); }
    }
    return 0;
  }
  function jhash(v) {
    if (v === null) return 0;
    if (isStr(v)) return stringHash(v);
    if (v instanceof JBox) return boxHash(v);
    return vcall(v, "hashCode()", []) | 0;
  }
  function jcompare(a, b, frames) {
    // Comparable natural
    if (a === null || b === null) npe();
    if (isStr(a)) { if (!isStr(b)) castFail(b, L("java.lang.String").rawType()); return compareStrings(S(a), S(b)); }
    if (a instanceof JBox) {
      if (!(b instanceof JBox)) castFail(b, a.$c.rawType());
      if (a.$c !== b.$c) castFail(b, a.$c.rawType());
      var x = a.v, y = b.v;
      if (typeof x === "boolean") return x === y ? 0 : (x ? 1 : -1);
      if (UNBOX[a.$c.full] === "double" || UNBOX[a.$c.full] === "float") return doubleCompare(x, y);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    if (!isSubClass(classOf(a), L("java.lang.Comparable"))) {
      var ca = classOf(a);
      throwJ("java.lang.ClassCastException", "class " + ca.bin + " cannot be cast to class java.lang.Comparable (" + (ca.isLib ? ca.bin + " and java.lang.Comparable are in module java.base of loader 'bootstrap')" : ca.bin + " is in unnamed module of loader 'app'; java.lang.Comparable is in module java.base of loader 'bootstrap')"), frames || undefined);
    }
    return vcall(a, "compareTo(java.lang.Object)", [b]);
  }
  function compareStrings(a, b) {
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) { var d = a.charCodeAt(i) - b.charCodeAt(i); if (d) return d; }
    return a.length - b.length;
  }
  function doubleCompare(x, y) {
    if (x < y) return -1;
    if (x > y) return 1;
    if (x === y) { if (x === 0) { var a = 1 / x, b = 1 / y; return a === b ? 0 : (a < b ? -1 : 1); } return 0; }
    if (x !== x) return y !== y ? 0 : 1;
    return -1;
  }

  // ---------- Double.toString / Float.toString (como o Java) ----------
  function doubleToString(d) {
    if (d !== d) return "NaN";
    if (d === Infinity) return "Infinity";
    if (d === -Infinity) return "-Infinity";
    if (d === 0) return 1 / d < 0 ? "-0.0" : "0.0";
    var digits = shortestDigits(d, false);
    return formatJavaFloat(d < 0, digits.ds, digits.e);
  }
  function floatToString(f) {
    if (f !== f) return "NaN";
    if (f === Infinity) return "Infinity";
    if (f === -Infinity) return "-Infinity";
    if (f === 0) return 1 / f < 0 ? "-0.0" : "0.0";
    var digits = shortestDigits(f, true);
    return formatJavaFloat(f < 0, digits.ds, digits.e);
  }
  // dígitos significativos mínimos (e = expoente decimal do primeiro dígito)
  function shortestDigits(x, isFloat) {
    var a = Math.abs(x), s;
    if (isFloat) {
      for (var p = 1; p <= 9; p++) { s = a.toPrecision(p); if (Math.fround(parseFloat(s)) === a) break; }
    } else s = a.toExponential();
    var m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(isFloat ? Number(s).toExponential() : s);
    var ds = m[1] + (m[2] || ""), e = parseInt(m[3], 10);
    if (isFloat) { ds = ds.replace(/0+$/, "") || "0"; }
    // Java escolhe o mais próximo entre os de 2 dígitos quando o mais curto tem 1
    if (ds.length === 1) {
      var two = a.toPrecision(2);
      var tv = parseFloat(two);
      var ok = isFloat ? Math.fround(tv) === a : tv === a;
      if (ok) {
        var m2 = /^(\d)\.?(\d)?e?([+-]\d+)?$/.exec(Number(two).toExponential(1));
        var cand = Number(two).toExponential(1);
        var mm = /^(\d)\.(\d)e([+-]\d+)$/.exec(cand);
        if (mm && mm[2] !== "0") {
          // compara distâncias exatas
          if (closer(a, mm[1] + mm[2], parseInt(mm[3], 10), ds, e, isFloat)) { ds = mm[1] + mm[2]; e = parseInt(mm[3], 10); }
        }
      }
    }
    return { ds: ds, e: e };
  }
  // o candidato de 2 dígitos (d2,e2) está mais perto de x que (d1,e1)?
  function closer(x, d2, e2, d1, e1) {
    // x exato como fração m*2^k
    var buf = new DataView(new ArrayBuffer(8)); buf.setFloat64(0, x);
    var hi = buf.getUint32(0), lo = buf.getUint32(4);
    var exp = (hi >>> 20) & 0x7ff;
    var mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (exp) mant |= 1n << 52n; else exp = 1;
    var k = exp - 1075; // x = mant * 2^k
    // compara |x - D| usando escala comum: tudo * 2^(-k) * 10^(-emin)
    function dec(ds, e) { return { m: BigInt(ds), e: e - (ds.length - 1) }; }
    var A = dec(d1, e1), B = dec(d2, e2);
    var emin = Math.min(A.e, B.e, 0);
    function scaled(v) { // v.m * 10^(v.e - emin) * 2^(-k)
      var n = v.m * (10n ** BigInt(v.e - emin));
      return k < 0 ? n * (2n ** BigInt(-k)) : n;
    }
    var X = k < 0 ? mant * (10n ** BigInt(-emin)) : mant * (2n ** BigInt(k)) * (10n ** BigInt(-emin));
    var a = scaled(A), b = scaled(B);
    if (k >= 0) { a = A.m * (10n ** BigInt(A.e - emin)); b = B.m * (10n ** BigInt(B.e - emin)); }
    var da = a > X ? a - X : X - a, db = b > X ? b - X : X - b;
    return db < da;
  }
  function formatJavaFloat(neg, ds, e) {
    var r;
    if (e >= -3 && e < 7) {
      if (e >= 0) {
        var ip = ds.slice(0, e + 1); while (ip.length < e + 1) ip += "0";
        var fp = ds.slice(e + 1) || "0";
        r = ip + "." + fp;
      } else {
        r = "0." + repeat("0", -e - 1) + ds;
      }
    } else {
      r = ds[0] + "." + (ds.slice(1) || "0") + "E" + e;
    }
    return (neg ? "-" : "") + r;
  }
  JavaSim.doubleToString = doubleToString;
  JavaSim.floatToString = floatToString;

  /* =====================================================================
     14. Geração de código: AST → funções JavaScript
     ===================================================================== */
  function Gen(prog) { this.prog = prog; }
  var GN = Gen.prototype;
  // contexto: {frame (dono das locais), cls, method, file, traceName}
  GN.lineOf = function (ctx, pos) { return ctx.file.lineOf(pos); };
  // acesso a variável local: devolve {get(f), set(f,v)}
  GN.varAccess = function (ctx, v) {
    if (v.frame === ctx.frame || !ctx.frame) { var sl = v.slot; return { get: function (f) { return f.l[sl]; }, set: function (f, x) { f.l[sl] = x; } }; }
    if (ctx.frame.kind === "lambda") {
      var idx = ctx.frame.captures.indexOf(v);
      if (idx >= 0) return { get: function (f) { return f.c[idx]; }, set: function () {} };
    }
    // capturada por classe local/anônima: this.$cap
    var uid = uidOf(v);
    var hops = this.capHops(ctx, v);
    return { get: function (f) { var o = f.t; for (var i = 0; i < hops; i++) o = o.$outer; return o.$cap[uid]; }, set: function () {} };
  };
  // quantos $outer até a classe local que capturou v
  GN.capHops = function (ctx, v) {
    var c = ctx.cls, h = 0;
    while (c && !(c.captures && c.captures.indexOf(v) >= 0)) { c = c.localEnv ? c.localEnv.cls : c.outer; h++; if (h > 20) break; }
    return h;
  };
  // valor do "this" de n níveis acima
  function outerOf(o, n) { for (var i = 0; i < n; i++) o = o.$outer; return o; }

  GN.compileProgram = function () {
    var self = this;
    this.prog.classes.forEach(function (c) { self.prepareClass(c); });
  };
  GN.traceClassName = function (sym) { return sym.bin; };
  GN.prepareClass = function (sym) {
    if (sym.prepared) return;
    sym.prepared = true;
    var self = this, d = sym.decl;
    var file = sym.file;
    // valores padrão dos campos de instância (incluindo superclasses do usuário)
    var defs = [];
    for (var c = sym; c && !c.isLib; c = c.superT && c.superT.sym) {
      c.fieldList.forEach(function (f) { if (!f.flags["static"]) defs.push([f.key, defaultValue(f.type)]); });
    }
    sym.fieldDefaults = defs;
    // métodos
    sym.methodList.forEach(function (m) {
      if (m.decl && m.decl.body) m.impl = self.methodImpl(m, sym);
      else if (m.recordAccessor) { var k = m.recordAccessor.key; m.impl = function () { return this[k]; }; }
      else if (m.enumValues) m.impl = function () { ensureInit(sym); var vs = RT.enumVals[sym.id]; return new JArr(arrayClass(sym.rawType()), vs.slice()); };
      else if (m.enumValueOf) m.impl = function (n) {
        ensureInit(sym);
        if (n === null) npe("Name is null");
        var vs = RT.enumVals[sym.id];
        for (var i = 0; i < vs.length; i++) if (vs[i].$name === S(n)) return vs[i];
        throwJ("java.lang.IllegalArgumentException", "No enum constant " + canonicalName(sym) + "." + S(n), ["java.base/java.lang.Enum.valueOf(Enum.java:293)", sym.bin + ".valueOf(" + sym.file.name + ":" + sym.file.lineOf(sym.decl.pos) + ")"]);
      };
    });
    // records: equals/hashCode/toString implícitos
    if (sym.isRecord()) this.recordMethods(sym);
    sym.ctors.forEach(function (c) { c.impl = self.ctorImpl(c, sym); });
    sym.clinit = function () { self.runClinit(sym); };
    sym.iinit = this.instanceInit(sym);
  };
  function defaultValue(t) {
    if (t.k !== "prim") return null;
    if (t.n === "boolean") return false;
    if (t.n === "long") return 0n;
    return 0;
  }
  GN.recordMethods = function (sym) {
    var comps = sym.recComps;
    function has0(name, n) { return (sym.methods[name] || []).some(function (m) { return m.decl && m.params.length === n; }); }
    var keys = comps.map(function (c) { return c.field.key; });
    var types = comps.map(function (c) { return c.type; });
    function add(name, params, ret, impl) {
      var m = new MethodSym(name, sym); m.params = params; m.ret = ret; m.flags = { "public": true }; m.key = methodKey(name, params); m.impl = impl;
      sym.methodList.push(m); (sym.methods[name] = sym.methods[name] || []).push(m);
    }
    if (!has0("toString", 0)) add("toString", [], L("java.lang.String").rawType(), function () {
      var self = this;
      return jstr(sym.name + "[" + comps.map(function (c, i) { return c.name + "=" + valueToString(self[keys[i]], types[i]); }).join(", ") + "]");
    });
    if (!has0("hashCode", 0)) add("hashCode", [], T["int"], function () {
      var h = 0, self = this;
      comps.forEach(function (c, i) { h = (Math.imul(h, 31) + hashOfTyped(self[keys[i]], types[i])) | 0; });
      return h;
    });
    if (!has0("equals", 1)) add("equals", [OBJ()], T["boolean"], function (o) {
      if (o === this) return true;
      if (o === null || classOf(o) !== sym) return false;
      for (var i = 0; i < keys.length; i++) {
        var a = this[keys[i]], b = o[keys[i]];
        if (types[i].k === "prim") { if (types[i].n === "double" || types[i].n === "float" ? doubleCompare(a, b) !== 0 : a !== b) return false; }
        else if (!(a === null ? b === null : jequals(a, b))) return false;
      }
      return true;
    });
  };
  function valueToString(v, t) {
    if (t.k === "prim") {
      switch (t.n) {
        case "char": return String.fromCharCode(v);
        case "double": return doubleToString(v);
        case "float": return floatToString(v);
        case "long": return v.toString();
        default: return String(v);
      }
    }
    return toStr(v);
  }
  function hashOfTyped(v, t) {
    if (t.k === "prim") return boxHash({ $c: L(BOX[t.n]), v: v });
    return v === null ? 0 : jhash(v);
  }
  GN.ctxFor = function (sym, frame, method, traceName) {
    return { cls: sym, frame: frame, method: method, file: sym.file, traceName: traceName };
  };
  GN.methodImpl = function (m, sym) {
    var self = this, d = m.decl;
    var frame = m.frame || { kind: "method", captures: [] };
    var tname = this.traceClassName(sym) + "." + (m.name === "<init>" ? "<init>" : m.name);
    var ctx = this.ctxFor(sym, frame, m, tname);
    var lazy = null;
    var slots = (m.paramSyms || []).map(function (p) { return p.slot; });
    var n = m.frameSize || 1;
    var file = sym.file.name;
    var isStatic = !!m.flags["static"];
    return function () {
      if (!lazy) lazy = self.block(d.body, ctx);
      if (isStatic) { if (RT.inited[sym.id] !== 2) ensureInit(sym); }
      var f = new Frame(this, n, tname);
      f.file = file;
      for (var i = 0; i < slots.length; i++) f.l[slots[i]] = arguments[i];
      enterFrame(f);
      try {
        var r = lazy(f);
        return r === RET ? f.rv : undefined;
      } catch (e) { if (e instanceof RangeError && !e.javaStack) snapshotOverflow(e); throw e; }
      finally { RT.stack.pop(); }
    };
  };
  GN.findFrame = function (m) {
    // frame do método: procurado nas variáveis declaradas (pode não haver parâmetros)
    var fr = null;
    (function walk(x) {
      if (fr || !x || typeof x !== "object") return;
      if (x instanceof SourceFile) return;
      if (x.vsym && x.vsym.frame) { fr = x.vsym.frame; return; }
      if (x.k === "Lambda" || x.k === "Class") return;
      for (var k in x) { if (k === "type" || k === "ref" || k === "sym" || k === "msym" || k === "file" || k === "head" || k === "frame") continue; var v = x[k]; if (v && typeof v === "object") walk(v); }
    })(m.decl.body);
    return fr || { kind: "method", captures: [] };
  };
  function enterFrame(f) {
    var st = RT.stack;
    st.push(f);
    if (st.length > RT.maxDepth) {
      var e = new RangeError("java stack");
      st.pop();
      snapshotOverflow(e);
      throw e;
    }
    if (++RT.steps > RT.limit) stepLimit();
  }
  function snapshotOverflow(e) {
    try {
      var st = RT.stack, fr = [];
      for (var i = st.length - 1; i >= 0 && fr.length < 1024; i--) fr.push(st[i].name + "(" + (st[i].file || "Main.java") + ":" + st[i].line + ")");
      e.javaStack = fr;
    } catch (x) { e.javaStack = []; }
  }
  function stepLimit() {
    throw new LimitSignal("(simulador) execução interrompida: passou de " + RT.limit.toLocaleString("pt-BR") + " passos (laço infinito?). No terminal de verdade, use Ctrl+C para parar.");
  }
  // construtor
  GN.ctorImpl = function (c, sym) {
    var self = this, d = c.decl;
    var tname = this.traceClassName(sym) + ".<init>";
    var file = sym.file.name;
    var superSym = sym.superT && sym.superT.k === "class" ? sym.superT.sym : null;
    if (!d) {
      // construtor padrão / anônimo / canônico automático
      return function () {
        var f = new Frame(this, 0, tname); f.file = file; f.line = sym.decl.anon ? sym.file.lineOf(sym.decl.pos) : sym.file.lineOf(sym.decl.pos);
        f.ctorOf = sym;
        enterFrame(f);
        try {
          if (c.anonSuper) {
            var args = Array.prototype.slice.call(arguments);
            if (c.anonSuper.impl) c.anonSuper.impl.apply(this, args);
          } else if (c.implicitSuper && c.implicitSuper.impl) c.implicitSuper.impl.call(this);
          sym.iinit(this);
          if (c.recordAuto) { for (var i = 0; i < sym.recComps.length; i++) this[sym.recComps[i].field.key] = arguments[i]; }
        } finally { RT.stack.pop(); }
      };
    }
    var frame = c.frame || { kind: "method", captures: [] };
    var ctx = this.ctxFor(sym, frame, c, tname);
    var slots = (c.paramSyms || []).map(function (p) { return p.slot; });
    var n = c.frameSize || 1;
    var stats = d.body.stats, idx = d.ctorCallIndex;
    var compiled = null;
    var callsThis = idx >= 0 && stats[idx].expr.kind === "this";
    return function () {
      if (!compiled) {
        compiled = {
          pre: stats.slice(0, Math.max(idx, 0)).map(function (s) { return self.stat(s, ctx); }),
          call: idx >= 0 ? self.stat(stats[idx], ctx) : null,
          post: stats.slice(idx + 1).map(function (s) { return self.stat(s, ctx); })
        };
      }
      var f = new Frame(this, n, tname); f.file = file; f.ctorOf = sym;
      for (var i = 0; i < slots.length; i++) f.l[slots[i]] = arguments[i];
      enterFrame(f);
      try {
        var r, k;
        for (k = 0; k < compiled.pre.length; k++) { r = compiled.pre[k](f); if (r) return; }
        if (compiled.call) compiled.call(f);
        else if (c.implicitSuper && c.implicitSuper.impl) { f.line = sym.file.lineOf(d.body.pos); c.implicitSuper.impl.call(this); }
        if (!callsThis) sym.iinit(this);
        for (k = 0; k < compiled.post.length; k++) { r = compiled.post[k](f); if (r) break; }
        if (c.compact) { for (var j = 0; j < sym.recComps.length; j++) this[sym.recComps[j].field.key] = f.l[c.paramSyms[j].slot]; }
      } catch (e) { if (e instanceof RangeError && !e.javaStack) snapshotOverflow(e); throw e; }
      finally { RT.stack.pop(); }
    };
  };
  // inicializadores de instância (campos e blocos, em ordem)
  GN.instanceInit = function (sym) {
    var self = this, d = sym.decl, parts = null;
    var items = d.members.filter(function (m) { return (m.k === "Field" && m.init && m.sym && !m.sym.flags["static"]) || (m.k === "Init" && !m.isStatic); });
    if (!items.length) return function () {};
    var tname = this.traceClassName(sym) + ".<init>";
    return function (obj) {
      if (!parts) parts = items.map(function (m) {
        var ctx = self.ctxFor(sym, m.initFrame || { kind: "method", captures: [] }, null, tname);
        if (m.k === "Field") {
          var ex = self.exprConv(m.init, m.sym.type, ctx), key = m.sym.key, line = sym.file.lineOf(m.pos);
          return { n: m.frameSize || 1, fn: function (f) { f.line = line; obj = f.t; f.t[key] = ex(f); } };
        }
        return { n: m.frameSize || 1, fn: self.block(m.body, ctx) };
      });
      var top = RT.stack[RT.stack.length - 1];
      for (var i = 0; i < parts.length; i++) {
        var f = top && top.t === obj ? top : new Frame(obj, parts[i].n, tname);
        var f2 = new Frame(obj, parts[i].n, tname); f2.file = sym.file.name;
        // usa o frame do construtor para a linha (como a JVM: o código fica no <init>)
        f2.line = top ? top.line : 0;
        var saved = RT.stack.length;
        if (top && top.t === obj) { RT.stack[RT.stack.length - 1] = f2; f2.ctorOf = top.ctorOf; }
        try { parts[i].fn(f2); } finally { if (top && top.t === obj) { top.line = f2.line; RT.stack[RT.stack.length - 1] = top; } }
      }
    };
  };
  // <clinit>
  function ensureInit(sym) {
    var st = RT.inited[sym.id];
    if (st === 2 || st === 1) return;
    if (sym.isLib) { RT.inited[sym.id] = 2; return; }
    RT.inited[sym.id] = 1;
    if (sym.superT && sym.superT.k === "class" && !sym.superT.sym.isLib) ensureInit(sym.superT.sym);
    RT.st[sym.id] = RT.st[sym.id] || {};
    sym.fieldList.forEach(function (f) { if (f.flags["static"] && !f.flags.enumConst) RT.st[sym.id][f.key] = f.constVal !== undefined ? f.constVal : defaultValue(f.type); });
    try { sym.clinit(); }
    catch (e) {
      RT.inited[sym.id] = 3;
      if (e instanceof JavaThrow && !isSubClass(e.ex.$c, L("java.lang.Error"))) {
        var w = mkThrowable("java.lang.ExceptionInInitializerError", null);
        w.cause = e.ex;
        throw new JavaThrow(w);
      }
      throw e;
    }
    RT.inited[sym.id] = 2;
  }
  GN.runClinit = function (sym) {
    var self = this, d = sym.decl;
    if (!sym.clinitParts) {
      var tname = this.traceClassName(sym) + ".<clinit>";
      var parts = [];
      if (sym.isEnum()) {
        d.enumConsts.forEach(function (ec, idx) {
          var cctx = self.ctxFor(sym, { kind: "method", captures: [] }, null, tname);
          var line = sym.file.lineOf(ec.pos);
          var args = self.callArgs(ec.args || [], ec.formals || [], ec.varargsCall, cctx);
          var ctor = ec.csym, asym = ec.anonSym;
          var f0 = sym.fields[ec.name];
          parts.push({ n: ec.frameSize || 1, fn: function (f) {
            f.line = line;
            var cls = asym || sym;
            if (asym) self.prepareClass(asym);
            var o = newInstance(cls);
            o.$name = ec.name; o.$ord = idx;
            var av = args(f);
            if (asym) asym.ctors[0].impl.apply(o, av); else if (ctor && ctor.impl) ctor.impl.apply(o, av);
            RT.st[sym.id][f0.key] = o;
            (RT.enumVals[sym.id] = RT.enumVals[sym.id] || []).push(o);
          } });
        });
      }
      d.members.forEach(function (m) {
        if (m.k === "Field" && m.init && m.sym && m.sym.flags["static"]) {
          if (m.sym.constVal !== undefined) return;
          var ctx = self.ctxFor(sym, m.initFrame || { kind: "method", captures: [] }, null, tname);
          var ex = self.exprConv(m.init, m.sym.type, ctx), key = m.sym.key, line = sym.file.lineOf(m.pos);
          parts.push({ n: m.frameSize || 1, fn: function (f) { f.line = line; RT.st[sym.id][key] = ex(f); } });
        } else if (m.k === "Init" && m.isStatic) {
          var ctx2 = self.ctxFor(sym, m.initFrame || { kind: "method", captures: [] }, null, tname);
          parts.push({ n: m.frameSize || 1, fn: self.block(m.body, ctx2) });
        }
      });
      sym.clinitParts = parts;
      sym.clinitName = tname;
    }
    if (!RT.enumVals[sym.id] && sym.isEnum()) RT.enumVals[sym.id] = [];
    sym.clinitParts.forEach(function (p) {
      var f = new Frame(null, p.n, sym.clinitName); f.file = sym.file.name;
      enterFrame(f);
      try { p.fn(f); } finally { RT.stack.pop(); }
    });
  };
  function newInstance(sym) {
    if (RT.inited[sym.id] !== 2) ensureInit(sym);
    var o = { $c: sym };
    var defs = sym.fieldDefaults;
    if (defs) for (var i = 0; i < defs.length; i++) o[defs[i][0]] = defs[i][1];
    return o;
  }

  // ---------- comandos ----------
  GN.block = function (b, ctx) {
    var self = this;
    var fs = b.stats.map(function (s) { return self.stat(s, ctx); }).filter(Boolean);
    var n = fs.length;
    if (n === 0) return function () { return 0; };
    if (n === 1) return fs[0];
    return function (f) {
      for (var i = 0; i < n; i++) { var r = fs[i](f); if (r) return r; }
      return 0;
    };
  };
  GN.stat = function (s, ctx, label) {
    var self = this, line = ctx.file.lineOf(s.pos), c, b, x;
    switch (s.k) {
      case "Block": return this.block(s, ctx);
      case "Empty": return null;
      case "LocalClass": { this.prepareClass(s.decl.sym); var self2 = this; (function prep(sym) { sym.decl.members.forEach(function (m) { if (m.k === "Class" && m.sym) { self2.prepareClass(m.sym); prep(m.sym); } }); })(s.decl.sym); return null; }
      case "LocalVar": {
        var parts = s.vars.map(function (d) {
          var v = d.vsym, acc = self.varAccess(ctx, v);
          if (!d.init) { return function (f) { acc.set(f, defaultValue(v.type)); }; }
          var ex = self.exprConv(d.init, v.type, ctx);
          var ln = ctx.file.lineOf(d.pos);
          return function (f) { f.line = ln; acc.set(f, ex(f)); };
        });
        if (parts.length === 1) { var p0 = parts[0]; return function (f) { p0(f); return 0; }; }
        return function (f) { for (var i = 0; i < parts.length; i++) parts[i](f); return 0; };
      }
      case "ExprStmt": {
        x = this.expr(s.expr, ctx, true);
        return function (f) { f.line = line; x(f); return 0; };
      }
      case "If": {
        c = this.cond(s.cond, ctx);
        var th = this.stat(s.then, ctx) || ret0, el = s.els ? (this.stat(s.els, ctx) || ret0) : null;
        if (el) return function (f) { f.line = line; return c(f) ? th(f) : el(f); };
        return function (f) { f.line = line; return c(f) ? th(f) : 0; };
      }
      case "While": {
        c = this.cond(s.cond, ctx);
        b = this.stat(s.body, ctx) || ret0;
        return function (f) {
          while (true) {
            f.line = line;
            if (!c(f)) break;
            if (++RT.steps > RT.limit) stepLimit();
            var r = b(f);
            if (r) {
              if (r.t === 1) { if (r.label === null || r.label === label) break; return r; }
              if (r.t === 2) { if (r.label === null || r.label === label) continue; return r; }
              return r;
            }
          }
          return 0;
        };
      }
      case "DoWhile": {
        c = this.cond(s.cond, ctx);
        b = this.stat(s.body, ctx) || ret0;
        var cline = ctx.file.lineOf(s.cond.pos);
        return function (f) {
          do {
            if (++RT.steps > RT.limit) stepLimit();
            var r = b(f);
            if (r) {
              if (r.t === 1) { if (r.label === null || r.label === label) break; return r; }
              if (r.t === 2) { if (r.label === null || r.label === label) { f.line = cline; continue; } return r; }
              return r;
            }
            f.line = cline;
          } while (c(f));
          return 0;
        };
      }
      case "For": {
        var init = s.init.map(function (i) { return i.k === "LocalVar" ? self.stat(i, ctx) : self.expr(i, ctx, true); });
        c = s.cond ? this.cond(s.cond, ctx) : null;
        var upd = s.update.map(function (u) { return self.expr(u, ctx, true); });
        b = this.stat(s.body, ctx) || ret0;
        return function (f) {
          f.line = line;
          for (var i = 0; i < init.length; i++) init[i](f);
          while (true) {
            f.line = line;
            if (c && !c(f)) break;
            if (++RT.steps > RT.limit) stepLimit();
            var r = b(f);
            if (r) {
              if (r.t === 1) { if (r.label === null || r.label === label) break; return r; }
              if (r.t === 2) { if (!(r.label === null || r.label === label)) return r; }
              else return r;
            }
            f.line = line;
            for (var j = 0; j < upd.length; j++) upd[j](f);
          }
          return 0;
        };
      }
      case "ForEach": {
        var v = s.varDecl.vars[0].vsym, acc = this.varAccess(ctx, v);
        var src = this.expr(s.expr, ctx);
        b = this.stat(s.body, ctx) || ret0;
        var conv = convFn(capUpper(s.elemType), v.type);
        var desc = this.nullDesc(s.expr, ctx);
        var isArr = s.exprType && s.exprType.k === "array";
        return function (f) {
          f.line = line;
          var coll = src(f), r;
          if (coll === null) npe(isArr ? "Cannot read the array length because " + desc + " is null" : "Cannot invoke \"java.util.Iterator.iterator()\" because " + desc + " is null");
          if (isArr) {
            var a = coll.a, n = a.length;
            for (var i = 0; i < n; i++) {
              if (++RT.steps > RT.limit) stepLimit();
              acc.set(f, conv ? conv(a[i]) : a[i]);
              r = b(f);
              if (r) {
                if (r.t === 1) { if (r.label === null || r.label === label) break; return r; }
                if (r.t === 2) { if (r.label === null || r.label === label) continue; return r; }
                return r;
              }
            }
            return 0;
          }
          var it = jcall(coll, "iterator", []);
          while (true) {
            f.line = line;
            if (!jcall(it, "hasNext", [])) break;
            if (++RT.steps > RT.limit) stepLimit();
            acc.set(f, conv ? conv(jcall(it, "next", [])) : jcall(it, "next", []));
            r = b(f);
            if (r) {
              if (r.t === 1) { if (r.label === null || r.label === label) break; return r; }
              if (r.t === 2) { if (r.label === null || r.label === label) continue; return r; }
              return r;
            }
          }
          return 0;
        };
      }
      case "Labeled": {
        var inner = this.stat(s.body, ctx, s.label) || ret0;
        var lb = s.label;
        return function (f) { var r = inner(f); if (r && r.t === 1 && r.label === lb) return 0; return r; };
      }
      case "Return": {
        if (!s.expr) return function (f) { f.line = line; return RET; };
        var rt = ctx.lambdaRet || (ctx.method ? ctx.method.ret : null);
        x = rt ? this.exprConv(s.expr, rt, ctx) : this.expr(s.expr, ctx);
        return function (f) { f.line = line; f.rv = x(f); return RET; };
      }
      case "Break": { var br = s.label ? new Brk(s.label) : BRK0; return function (f) { f.line = line; return br; }; }
      case "Continue": { var co = s.label ? new Cont(s.label) : CONT0; return function (f) { f.line = line; return co; }; }
      case "Yield": {
        x = ctx.yieldType ? this.exprConv(s.expr, ctx.yieldType, ctx) : this.expr(s.expr, ctx);
        return function (f) { f.line = line; f.yv = x(f); return YLD; };
      }
      case "Throw": {
        x = this.expr(s.expr, ctx);
        return function (f) {
          f.line = line;
          var ex = x(f);
          if (ex === null) npe("Cannot throw exception because \"null\" is null");
          throw new JavaThrow(ex);
        };
      }
      case "Try": return this.tryStat(s, ctx, line);
      case "Switch": return this.switchCode(s, ctx, false, label);
      case "Sync": {
        x = this.expr(s.lock, ctx); b = this.block(s.body, ctx);
        return function (f) { f.line = line; if (x(f) === null) npe(); return b(f); };
      }
      case "Assert": return null; // asserções desligadas por padrão (como no java sem -ea)
    }
    throw new Error("stat: " + s.k);
  };
  function ret0() { return 0; }
  GN.tryStat = function (s, ctx, line) {
    var self = this;
    var res = (s.resources || []).map(function (r) {
      if (r.k === "LocalVar") {
        var v = r.vars[0].vsym, acc = self.varAccess(ctx, v), ex = self.exprConv(r.vars[0].init, v.type, ctx);
        return { init: function (f) { var o = ex(f); acc.set(f, o); return o; } };
      }
      var e = self.expr(r.expr, ctx);
      return { init: e };
    });
    var body = this.block(s.block, ctx);
    var catches = s.catches.map(function (c) {
      return { types: c.ctypes || [], acc: self.varAccess(ctx, c.vsym), body: self.block(c.body, ctx) };
    });
    var fin = s.fin ? this.block(s.fin, ctx) : null;
    function runBody(f) {
      if (!res.length) return body(f);
      var opened = [], r, primary = null;
      try {
        for (var i = 0; i < res.length; i++) opened.push(res[i].init(f));
        r = body(f);
      } catch (e) {
        if (isInternal(e)) throw e;
        primary = e;
      }
      for (var j = opened.length - 1; j >= 0; j--) {
        var o = opened[j];
        if (o === null) continue;
        try { jcall(o, "close", []); }
        catch (e2) {
          if (isInternal(e2)) throw e2;
          if (primary) { var pj = toJava(primary), sj = toJava(e2); if (pj && sj) pj.suppressed.push(sj); }
          else primary = e2;
        }
      }
      if (primary) throw primary;
      return r;
    }
    return function (f) {
      f.line = line;
      var r = 0, pending = null;
      try { r = runBody(f); }
      catch (e) {
        if (isInternal(e)) throw e;
        var ex = toJava(e);
        if (!ex) throw e;
        if (e instanceof RangeError) e = new JavaThrow(ex);
        var hit = null;
        for (var i = 0; i < catches.length && !hit; i++) {
          for (var k = 0; k < catches[i].types.length; k++) if (instOf(ex, catches[i].types[k])) { hit = catches[i]; break; }
        }
        if (!hit) pending = e;
        else {
          try { hit.acc.set(f, ex); r = hit.body(f); }
          catch (e2) { if (isInternal(e2)) throw e2; pending = e2; }
        }
      }
      if (fin) { var fr = fin(f); if (fr) return fr; }
      if (pending) throw pending;
      return r;
    };
  };

  // ---------- switch ----------
  GN.switchCode = function (s, ctx, isExpr, label) {
    var self = this, line = ctx.file.lineOf(s.pos);
    var sel = this.expr(s.selector, ctx);
    var kind = s.selKind, st = s.selType;
    var unbox = st.k !== "prim" && kind === "int" ? convFn(st, unboxedType(st), this.nullDesc(s.selector, ctx)) : null;
    var selDesc = this.nullDesc(s.selector, ctx);
    var yieldType = isExpr ? (s.type && !isErr(s.type) ? s.type : null) : null;
    var cctx = isExpr ? Object.assign({}, ctx, { yieldType: yieldType }) : ctx;
    // cada caso: testes + corpo
    var cases = s.cases.map(function (c) {
      var tests = [];
      c.labels.forEach(function (l) {
        if (l.k === "DefaultLabel") { tests.push({ def: true }); return; }
        if (l.k === "Expr") {
          if (l.isNull) tests.push({ isNull: true });
          else if (l.enumConst) tests.push({ en: l.enumConst });
          else tests.push({ cv: l.constVal });
          return;
        }
        tests.push({ pat: self.patternMatcher(l, ctx) });
      });
      if (c.isDefault) tests.push({ def: true });
      var guard = c.guard ? self.cond(c.guard, ctx) : null;
      var body;
      if (s.arrow) {
        var bd = c.body;
        if (bd.k === "ExprStmt" && isExpr) { var ex = yieldType ? self.exprConv(bd.expr, yieldType, cctx) : self.expr(bd.expr, cctx); var bl = ctx.file.lineOf(bd.pos); body = function (f) { f.line = bl; f.yv = ex(f); return YLD; }; }
        else if (bd.k === "ExprStmt") { var ex2 = self.expr(bd.expr, cctx, true); var bl2 = ctx.file.lineOf(bd.pos); body = function (f) { f.line = bl2; ex2(f); return 0; }; }
        else body = self.stat(bd, cctx) || ret0;
      } else {
        var sts = c.stats.map(function (x) { return self.stat(x, cctx); }).filter(Boolean);
        body = function (f) { for (var i = 0; i < sts.length; i++) { var r = sts[i](f); if (r) return r; } return 0; };
      }
      return { tests: tests, guard: guard, body: body };
    });
    var defIdx = -1;
    cases.forEach(function (c, i) { if (c.tests.some(function (t) { return t.def; })) defIdx = i; });
    // índice rápido para constantes
    var map = new Map();
    cases.forEach(function (c, i) { c.tests.forEach(function (t) { if (t.cv !== undefined && !map.has(t.cv)) map.set(t.cv, i); if (t.en) map.set(t.en.key, i); }); });
    var hasPat = cases.some(function (c) { return c.tests.some(function (t) { return t.pat; }) || c.guard; });
    var nullCase = -1;
    cases.forEach(function (c, i) { if (c.tests.some(function (t) { return t.isNull; })) nullCase = i; });
    var exhaustiveNoDefault = (isExpr || s.hasPattern) && defIdx < 0;
    function findCase(f, v) {
      if (v === null) {
        if (nullCase >= 0) return nullCase;
        if (kind === "string") npe("Cannot invoke \"String.hashCode()\" because " + (s.strTmp !== undefined ? "\"<local" + s.strTmp + ">\"" : selDesc) + " is null");
        if (kind === "enum") npe("Cannot invoke \"" + qualJava(st) + ".ordinal()\" because " + selDesc + " is null");
        npe(null);
      }
      if (!hasPat) {
        var key = kind === "string" ? S(v) : kind === "enum" ? enumKey(v) : v;
        var i = map.get(key);
        if (i !== undefined) return i;
        return defIdx;
      }
      for (var k = 0; k < cases.length; k++) {
        var c = cases[k];
        for (var j = 0; j < c.tests.length; j++) {
          var t = c.tests[j], ok = false;
          if (t.pat) ok = t.pat(f, v);
          else if (t.en) ok = v === RT.st[t.en.owner.id][t.en.key];
          else if (t.cv !== undefined) ok = (kind === "string" ? S(v) === t.cv : v === t.cv) || (isStr(v) && S(v) === t.cv) || (v instanceof JBox && v.v === t.cv);
          if (ok && (!c.guard || c.guard(f))) return k;
        }
      }
      return defIdx;
    }
    function enumKey(v) { var sym = v.$c; while (sym && !sym.isEnum()) sym = sym.superT && sym.superT.sym; return v.$c.fields && v.$c.isEnum() ? "e_" + v.$name : "e_" + v.$name; }
    var arrow = s.arrow;
    return function (f) {
      f.line = line;
      var v = sel(f);
      if (unbox) v = unbox(v);
      if (kind === "enum" && v !== null) ensureInit(v.$c.isEnum() ? v.$c : v.$c.superT.sym);
      var idx = findCase(f, v), r;
      if (idx < 0) {
        if (exhaustiveNoDefault) {
          if (kind === "enum") throwJ("java.lang.IncompatibleClassChangeError", null);
          throwJ("java.lang.MatchException", null);
        }
        return 0;
      }
      if (arrow) {
        r = cases[idx].body(f);
      } else {
        for (var i = idx; i < cases.length; i++) { r = cases[i].body(f); if (r) break; }
      }
      if (r) {
        if (r === YLD) return isExpr ? r : r;
        if (r.t === 1 && r.label === null && !isExpr) return 0;
        if (r.t === 1 && label && r.label === label) return 0;
        return r;
      }
      return 0;
    };
  };
  function qualJava(t) { return t.k === "class" ? t.sym.bin.replace(/\$/g, ".") : typeStr(t); }
  // testa um padrão e preenche as variáveis
  GN.patternMatcher = function (p, ctx) {
    var self = this;
    if (p.k === "AnyPattern") return function () { return true; };
    if (p.k === "TypePattern") {
      var t = p.ptype, acc = p.vsym ? this.varAccess(ctx, p.vsym) : null;
      var prim = t.k === "prim";
      var test = prim ? function (v) { return v !== null && v !== undefined; } : function (v) { return instOf(v, erasure(t)); };
      var total = p.type.k === "VarType";
      var unb = null;
      return function (f, v) {
        if (!total && !prim && !test(v)) return false;
        if (acc) acc.set(f, v);
        return true;
      };
    }
    if (p.k === "RecordPattern") {
      var rt = erasure(p.ptype);
      var comps = p.comps || [];
      var subs = p.subs.map(function (sp, i) {
        var m = self.patternMatcher(sp, ctx);
        var key = comps[i] ? comps[i].field.key : null;
        var accessor = comps[i] ? comps[i].accessor : null;
        var ct = sp.compType;
        var nullOk = sp.k === "AnyPattern" || (sp.k === "TypePattern" && (sp.type.k === "VarType" || (ct && ct.k === "class" && sp.ptype && isSubtype(erasure(ct), erasure(sp.ptype)))));
        return { m: m, key: key, accessor: accessor, nullOk: nullOk, prim: ct && ct.k === "prim" };
      });
      return function (f, v) {
        if (!instOf(v, rt)) return false;
        for (var i = 0; i < subs.length; i++) {
          var sv = subs[i].accessor && subs[i].accessor.impl ? subs[i].accessor.impl.call(v) : v[subs[i].key];
          if (sv === null && !subs[i].nullOk) return false;
          if (!subs[i].m(f, sv)) return false;
        }
        return true;
      };
    }
    return function () { return false; };
  };

  // ---------- mensagens úteis de NullPointerException ----------
  function npeClassName(sym) {
    if (sym.full === "java.lang.String") return "String";
    if (sym.full === "java.lang.Object") return "Object";
    return sym.bin;
  }
  function npeTypeName(t) {
    t = erasure(t);
    if (t.k === "prim") return t.n;
    if (t.k === "array") return npeTypeName(t.elem) + "[]";
    return npeClassName(t.sym);
  }
  function npeMethodDesc(m, siteType) {
    var owner = m.owner;
    if (siteType && siteType.k === "class" && !m.flags["static"]) owner = erasure(siteType).sym;
    return npeClassName(owner) + "." + m.name + "(" + m.params.map(function (p) { return npeTypeName(p); }).join(", ") + ")";
  }
  GN.nullDesc = function (e, ctx) {
    while (e.k === "Paren") e = e.expr;
    switch (e.k) {
      case "Ident":
        if (!e.ref) return null;
        if (e.ref.kind === "local") {
          var v = e.ref.sym;
          if (ctx.frame && v.frame !== ctx.frame) return null;
          if (v.kind === "param" && ctx.method && ctx.method.paramSyms) { var pi = ctx.method.paramSyms.indexOf(v); if (pi >= 0) return "\"<parameter" + (pi + 1) + ">\""; }
          return "\"<local" + v.slot + ">\"";
        }
        if (e.ref.kind === "field") return "\"this." + e.name + "\"";
        if (e.ref.kind === "sfield") return "\"" + (e.ref.sym.npeName || e.ref.sym.owner.bin + "." + e.name) + "\"";
        return null;
      case "Select": {
        if (!e.ref) return null;
        if (e.ref.kind === "sfield") return "\"" + e.ref.sym.owner.bin + "." + e.name + "\"";
        if (e.ref.kind === "field") {
          var t = this.nullDesc(e.target, ctx);
          if (e.target.k === "This") return "\"this." + e.name + "\"";
          if (!t || t[0] !== "\"") return null;
          return t.slice(0, -1) + "." + e.name + "\"";
        }
        return null;
      }
      case "This": return "\"this\"";
      case "Literal": return e.type === "null" ? "\"null\"" : null;
      case "Call":
        if (!e.msym) return null;
        return "the return value of \"" + npeMethodDesc(e.msym, e.recvType || e.callSite) + "\"";
      case "Index": {
        var a = this.nullDesc(e.arr, ctx);
        if (!a || a[0] !== "\"") return null;
        var ix = e.index;
        while (ix.k === "Paren") ix = ix.expr;
        var id;
        if (ix.cv !== undefined) id = String(ix.cv);
        else { var d2 = this.nullDesc(ix, ctx); id = d2 && d2[0] === "\"" ? d2.slice(1, -1) : "..."; }
        return a.slice(0, -1) + "[" + id + "]\"";
      }
    }
    return null;
  };
  function becauseTxt(d) { return d ? " because " + d + " is null" : ""; }
  function arrKindName(t) {
    if (t && t.k === "array" && t.elem.k === "prim") return t.elem.n;
    return "object";
  }

  // ---------- expressões ----------
  // expressão convertida para o tipo alvo
  GN.exprConv = function (e, target, ctx) {
    var x = this.expr(e, ctx);
    if (!target || e.k === "ArrayInit") return x;
    var from = e.type;
    if (e.k === "Lambda" || e.k === "MethodRef") return x;
    var c = convFn(from, target, this.unboxDesc(e, ctx, from));
    if (!c) return x;
    return function (f) { return c(x(f)); };
  };
  GN.unboxDesc = function (e, ctx, from) {
    if (!from || from.k === "prim") return null;
    var u = unboxedType(from);
    if (!u) return null;
    var d = this.nullDesc(e, ctx);
    var boxName = BOX[u.n];
    var mname = u.n + "Value";
    return "Cannot invoke \"" + boxName + "." + mname + "()\"" + becauseTxt(d);
  };
  // condição booleana (desembrulha Boolean)
  GN.cond = function (e, ctx) {
    if (e.type && e.type.k !== "prim") return this.exprConv(e, T["boolean"], ctx);
    return this.expr(e, ctx);
  };
  GN.expr = function (e, ctx, asStmt) {
    if (e.cv !== undefined && !asStmt) {
      var cv = e.cv;
      if (isString(e.type) || (e.type && e.type.k === "class" && typeof cv === "string")) return function () { return cv; };
      return function () { return cv; };
    }
    var fn = this.expr0(e, ctx, asStmt);
    return fn;
  };
  GN.expr0 = function (e, ctx, asStmt) {
    var self = this, x, y;
    switch (e.k) {
      case "Literal": { var v = e.value; return function () { return v; }; }
      case "Paren": return this.expr(e.expr, ctx);
      case "Ident": case "Select": return this.varRead(e, ctx);
      case "This": {
        var dep = e.depth || 0;
        if (!dep) return function (f) { return f.t; };
        return function (f) { return outerOf(f.t, dep); };
      }
      case "Index": {
        var arr = this.expr(e.arr, ctx), idx = this.exprConv(e.index, T["int"], ctx);
        var desc = this.nullDesc(e.arr, ctx), kn = arrKindName(e.arr.type);
        return function (f) {
          var a = arr(f), i = idx(f);
          if (a === null) npe("Cannot load from " + kn + " array" + becauseTxt(desc));
          if (i < 0 || i >= a.a.length) arrIndexFail(i, a.a.length);
          return a.a[i];
        };
      }
      case "Call": return this.callCode(e, ctx);
      case "New": return this.newCode(e, ctx);
      case "NewArray": return this.newArrayCode(e, ctx);
      case "ArrayInit": return this.arrayInitCode(e, e.type, ctx);
      case "Unary": return this.unaryCode(e, ctx);
      case "Binary": return this.binaryCode(e, ctx);
      case "Assign": return this.assignCode(e, ctx);
      case "CompoundAssign": return this.compoundCode(e, ctx);
      case "Cond": {
        var c = this.cond(e.cond, ctx);
        var tt = e.type;
        var a = this.exprConv(e.a, tt, ctx), b = this.exprConv(e.b, tt, ctx);
        return function (f) { return c(f) ? a(f) : b(f); };
      }
      case "Cast": {
        x = this.expr(e.expr, ctx);
        var to = e.type, from = e.expr.type;
        if (e.expr.k === "Lambda" || e.expr.k === "MethodRef") return x;
        if (to.k === "prim" || from.k === "prim") {
          var cf = convFn(from, to, this.unboxDesc(e.expr, ctx, from));
          if (!cf) return x;
          return function (f) { return cf(x(f)); };
        }
        var te = erasure(to.k === "inter" ? to.types[0] : to);
        if (te.k === "class" && te.sym.full === "java.lang.Object") return x;
        return function (f) { var v = x(f); if (v !== null && !instOf(v, te)) castFail(v, te); return v; };
      }
      case "InstanceOf": {
        x = this.expr(e.expr, ctx);
        if (e.pattern) {
          var pm = this.patternMatcher(e.pattern, ctx);
          return function (f) { var v = x(f); return v !== null && pm(f, v); };
        }
        var tt2 = erasure(e.testType || T_ERR);
        return function (f) { return instOf(x(f), tt2); };
      }
      case "Lambda": return this.lambdaCode(e, ctx);
      case "MethodRef": return this.mrefCode(e, ctx);
      case "SwitchExpr": {
        var sw = this.switchCode(e, ctx, true, null);
        return function (f) { var r = sw(f); if (r === YLD) return f.yv; if (r === RET) throw new Error("return em switch"); return f.yv; };
      }
      case "ClassLit": {
        var ct = this.resolveClassLit(e);
        return function () { return classObject(ct); };
      }
      case "CtorCall": return this.ctorCallCode(e, ctx);
    }
    throw new Error("expr: " + e.k);
  };
  GN.resolveClassLit = function (e) {
    if (e.litType) return e.litType;
    var t = e.type && e.type.k === "class" && e.type.args ? e.type.args[0] : null;
    return t || OBJ();
  };
  // leitura de variável/campo
  GN.varRead = function (e, ctx) {
    var r = e.ref;
    if (!r) throw new Error("referência não resolvida: " + (e.name || ""));
    if (r.kind === "local") { var acc = this.varAccess(ctx, r.sym); return acc.get; }
    if (r.kind === "length") {
      var a = this.expr(e.target, ctx), d = this.nullDesc(e.target, ctx);
      return function (f) { var v = a(f); if (v === null) npe("Cannot read the array length" + becauseTxt(d)); return v.a.length; };
    }
    if (r.kind === "sfield") return this.staticFieldRead(r.sym, e, ctx);
    if (r.kind === "field") {
      var key = r.sym.key, fs = r.sym;
      if (fs.isLib) { var g = fs.get; var tgt0 = e.k === "Select" && e.target.k !== "Super" ? this.expr(e.target, ctx) : function (f) { return f.t; }; return function (f) { return g.call(tgt0(f)); }; }
      if (e.k === "Ident" || (e.k === "Select" && e.target.k === "Super")) {
        var dep = r.depth || 0;
        if (!dep) return function (f) { return f.t[key]; };
        return function (f) { return outerOf(f.t, dep)[key]; };
      }
      var tg = this.expr(e.target, ctx), desc = this.nullDesc(e.target, ctx), nm = e.name;
      return function (f) { var o = tg(f); if (o === null) npe("Cannot read field \"" + nm + "\"" + becauseTxt(desc)); return o[key]; };
    }
    if (r.kind === "class") return function () { return null; };
    throw new Error("varRead: " + r.kind);
  };
  GN.staticFieldRead = function (fs, e, ctx) {
    var tgt = e.k === "Select" && e.target.ref && e.target.ref.kind !== "class" && e.target.ref.kind !== "pkg" ? this.expr(e.target, ctx) : null;
    if (fs.constVal !== undefined) { var cv = fs.constVal; return function () { return cv; }; }
    if (fs.isLib) { var g = fs.get; return function (f) { if (tgt) tgt(f); return g(); }; }
    var owner = fs.owner, key = fs.key, id = owner.id;
    return function (f) {
      if (tgt) tgt(f);
      if (RT.inited[id] !== 2) ensureInit(owner);
      return RT.st[id][key];
    };
  };
  // atribuição: devolve {get, set} para um alvo (local, campo, elemento)
  GN.lvalue = function (t, ctx) {
    var self = this;
    while (t.k === "Paren") t = t.expr;
    var r = t.ref;
    if (t.k === "Index") {
      var arr = this.expr(t.arr, ctx), idx = this.exprConv(t.index, T["int"], ctx);
      var desc = this.nullDesc(t.arr, ctx), kn = arrKindName(t.arr.type);
      var et = t.arr.type && t.arr.type.k === "array" ? t.arr.type.elem : null;
      var refElem = et && et.k !== "prim";
      return {
        prep: function (f) {
          var a = arr(f), i = idx(f);
          if (a === null) npe("Cannot store to " + kn + " array" + becauseTxt(desc));
          if (i < 0 || i >= a.a.length) arrIndexFail(i, a.a.length);
          return [a, i];
        },
        get: function (f, p) { return p[0].a[p[1]]; },
        set: function (f, p, v) {
          if (refElem && v !== null && !instOf(v, erasure(p[0].$c.elemType))) throwJ("java.lang.ArrayStoreException", classOf(v).bin);
          p[0].a[p[1]] = v;
        }
      };
    }
    if (r.kind === "local") {
      var acc = this.varAccess(ctx, r.sym);
      return { prep: function () { return null; }, get: function (f) { return acc.get(f); }, set: function (f, p, v) { acc.set(f, v); } };
    }
    if (r.kind === "sfield") {
      var fs = r.sym, owner = fs.owner, key = fs.key, id = owner.id;
      var tgt = t.k === "Select" && t.target.ref && t.target.ref.kind !== "class" ? this.expr(t.target, ctx) : null;
      return {
        prep: function (f) { if (tgt) tgt(f); if (RT.inited[id] !== 2) ensureInit(owner); return null; },
        get: function () { return RT.st[id][key]; },
        set: function (f, p, v) { RT.st[id][key] = v; }
      };
    }
    if (r.kind === "field") {
      var key2 = r.sym.key;
      if (t.k === "Ident" || (t.k === "Select" && t.target.k === "Super")) {
        var dep = r.depth || 0;
        return { prep: function (f) { return dep ? outerOf(f.t, dep) : f.t; }, get: function (f, o) { return o[key2]; }, set: function (f, o, v) { o[key2] = v; } };
      }
      var tg = this.expr(t.target, ctx), d2 = this.nullDesc(t.target, ctx), nm = t.name;
      return {
        prep: function (f) { var o = tg(f); return o; },
        get: function (f, o) { if (o === null) npe("Cannot read field \"" + nm + "\"" + becauseTxt(d2)); return o[key2]; },
        set: function (f, o, v) { if (o === null) npe("Cannot assign field \"" + nm + "\"" + becauseTxt(d2)); o[key2] = v; }
      };
    }
    throw new Error("lvalue: " + r.kind);
  };
  GN.assignCode = function (e, ctx) {
    var lv = this.lvalue(e.target, ctx);
    var val = this.exprConv(e.value, e.target.type, ctx);
    return function (f) { var p = lv.prep(f); var v = val(f); lv.set(f, p, v); return v; };
  };
  // operação aritmética no tipo "ot"
  function arith(op, ot) {
    var n = ot.n;
    if (n === "int") {
      switch (op) {
        case "+": return function (a, b) { return (a + b) | 0; };
        case "-": return function (a, b) { return (a - b) | 0; };
        case "*": return Math.imul;
        case "/": return function (a, b) { if (b === 0) throwJ("java.lang.ArithmeticException", "/ by zero"); return (a / b) | 0; };
        case "%": return function (a, b) { if (b === 0) throwJ("java.lang.ArithmeticException", "/ by zero"); return (a % b) | 0; };
        case "<<": return function (a, b) { return a << b; };
        case ">>": return function (a, b) { return a >> b; };
        case ">>>": return function (a, b) { return (a >>> b) | 0; };
        case "&": return function (a, b) { return a & b; };
        case "|": return function (a, b) { return a | b; };
        case "^": return function (a, b) { return a ^ b; };
      }
    }
    if (n === "long") {
      switch (op) {
        case "+": return function (a, b) { return BigInt.asIntN(64, a + b); };
        case "-": return function (a, b) { return BigInt.asIntN(64, a - b); };
        case "*": return function (a, b) { return BigInt.asIntN(64, a * b); };
        case "/": return function (a, b) { if (b === 0n) throwJ("java.lang.ArithmeticException", "/ by zero"); return BigInt.asIntN(64, a / b); };
        case "%": return function (a, b) { if (b === 0n) throwJ("java.lang.ArithmeticException", "/ by zero"); return a % b; };
        case "<<": return function (a, b) { return BigInt.asIntN(64, a << (BigInt(b) & 63n)); };
        case ">>": return function (a, b) { return a >> (BigInt(b) & 63n); };
        case ">>>": return function (a, b) { return BigInt.asIntN(64, BigInt.asUintN(64, a) >> (BigInt(b) & 63n)); };
        case "&": return function (a, b) { return a & b; };
        case "|": return function (a, b) { return a | b; };
        case "^": return function (a, b) { return a ^ b; };
      }
    }
    if (n === "boolean") {
      switch (op) {
        case "&": return function (a, b) { return a && b; };
        case "|": return function (a, b) { return a || b; };
        case "^": return function (a, b) { return a !== b; };
      }
    }
    var fl = n === "float";
    switch (op) {
      case "+": return fl ? function (a, b) { return Math.fround(a + b); } : function (a, b) { return a + b; };
      case "-": return fl ? function (a, b) { return Math.fround(a - b); } : function (a, b) { return a - b; };
      case "*": return fl ? function (a, b) { return Math.fround(a * b); } : function (a, b) { return a * b; };
      case "/": return fl ? function (a, b) { return Math.fround(a / b); } : function (a, b) { return a / b; };
      case "%": return fl ? function (a, b) { return Math.fround(a % b); } : function (a, b) { return a % b; };
    }
    throw new Error("arith " + op + " " + n);
  }
  // texto de um valor (concatenação)
  function strOfTyped(t) {
    if (t.k === "prim") {
      switch (t.n) {
        case "char": return function (v) { return String.fromCharCode(v); };
        case "double": return doubleToString;
        case "float": return floatToString;
        case "long": return function (v) { return v.toString(); };
        default: return function (v) { return String(v); };
      }
    }
    if (isString(t)) return function (v) { return v === null ? "null" : S(v); };
    return toStr;
  }
  GN.binaryCode = function (e, ctx) {
    var op = e.op, self = this;
    if (e.concat) {
      // achata a cadeia de concatenações
      var parts = [];
      (function flat(x) {
        if (x.k === "Binary" && x.op === "+" && x.concat && x.cv === undefined) { flat(x.l); flat(x.r); }
        else parts.push(x);
      })(e);
      var fns = parts.map(function (p) { var ev = self.expr(p, ctx), sf = strOfTyped(p.type); return function (f) { return sf(ev(f)); }; });
      return function (f) { var s = ""; for (var i = 0; i < fns.length; i++) s += fns[i](f); return jstr(s); };
    }
    if (op === "&&") { var l = this.cond(e.l, ctx), r = this.cond(e.r, ctx); return function (f) { return l(f) && r(f); }; }
    if (op === "||") { var l2 = this.cond(e.l, ctx), r2 = this.cond(e.r, ctx); return function (f) { return l2(f) || r2(f); }; }
    if (e.refCmp) {
      var a = this.expr(e.l, ctx), b = this.expr(e.r, ctx);
      if (op === "==") return function (f) { return a(f) === b(f); };
      return function (f) { return a(f) !== b(f); };
    }
    var ot = e.opType;
    var shift = op === "<<" || op === ">>" || op === ">>>";
    var A = this.exprConv(e.l, ot, ctx);
    var B = this.exprConv(e.r, shift ? (e.shiftType || T["int"]) : ot, ctx);
    switch (op) {
      case "==": return function (f) { return A(f) === B(f); };
      case "!=": return function (f) { return A(f) !== B(f); };
      case "<": return function (f) { return A(f) < B(f); };
      case ">": return function (f) { return A(f) > B(f); };
      case "<=": return function (f) { return A(f) <= B(f); };
      case ">=": return function (f) { return A(f) >= B(f); };
    }
    var fn = arith(op, ot);
    return function (f) { var x = A(f); return fn(x, B(f)); };
  };
  GN.unaryCode = function (e, ctx) {
    var op = e.op, self = this;
    if (op === "++" || op === "--" || op === "post++" || op === "post--") {
      var lv = this.lvalue(e.expr, ctx);
      var t = e.expr.type, u = t.k === "prim" ? t : unboxedType(t);
      var post = op.indexOf("post") === 0, inc = op.indexOf("++") >= 0;
      var pt = unaryPromote(u);
      var add = arith(inc ? "+" : "-", pt);
      var one = pt.n === "long" ? 1n : 1;
      var narrow = primCastFn(pt, u);
      var unb = t.k !== "prim" ? convFn(t, u, this.unboxDesc(e.expr, ctx, t)) : null;
      var rebox = t.k !== "prim" ? function (v) { return boxVal(u.n, v); } : null;
      return function (f) {
        var p = lv.prep(f);
        var old = lv.get(f, p);
        var ov = unb ? unb(old) : old;
        var nv = add(ov, one);
        if (narrow) nv = narrow(nv);
        lv.set(f, p, rebox ? rebox(nv) : nv);
        return post ? (rebox ? old : ov) : (rebox ? boxVal(u.n, nv) : nv);
      };
    }
    var rt = e.opType;
    var x = this.exprConv(e.expr, op === "!" ? T["boolean"] : rt, ctx);
    switch (op) {
      case "!": return function (f) { return !x(f); };
      case "+": return x;
      case "-":
        if (rt.n === "int") return function (f) { return (-x(f)) | 0; };
        if (rt.n === "long") return function (f) { return BigInt.asIntN(64, -x(f)); };
        return function (f) { return -x(f); };
      case "~":
        if (rt.n === "long") return function (f) { return ~x(f); };
        return function (f) { return ~x(f); };
    }
    throw new Error("unary " + op);
  };
  GN.compoundCode = function (e, ctx) {
    var lv = this.lvalue(e.target, ctx);
    var tt = e.target.type;
    if (e.concat) {
      var sv = this.expr(e.value, ctx), sf = strOfTyped(e.value.type), lf = strOfTyped(tt);
      return function (f) { var p = lv.prep(f); var old = lv.get(f, p); var v = jstr(lf(old) + sf(sv(f))); lv.set(f, p, v); return v; };
    }
    var ot = e.opType, op = e.op;
    var shift = op === "<<" || op === ">>" || op === ">>>";
    var val = this.exprConv(e.value, shift ? (e.shiftType || T["int"]) : ot, ctx);
    var fn = arith(op, ot);
    var tu = tt.k === "prim" ? tt : unboxedType(tt);
    var toOt = convFn(tt, ot, this.unboxDesc(e.target, ctx, tt));
    var back = primCastFn(ot, tu);
    var rebox = tt.k !== "prim" ? function (v) { return boxVal(tu.n, v); } : null;
    return function (f) {
      var p = lv.prep(f);
      var old = lv.get(f, p);
      var a = toOt ? toOt(old) : old;
      var r = fn(a, val(f));
      if (back) r = back(r);
      if (rebox) r = rebox(r);
      lv.set(f, p, r);
      return r;
    };
  };
  // argumentos de chamada com conversões e varargs
  GN.callArgs = function (args, formals, varargs, ctx) {
    var self = this, n = formals.length;
    if (!varargs) {
      var fs = args.map(function (a, i) { return self.exprConv(a, formals[i], ctx); });
      if (fs.length === 0) return function () { return []; };
      if (fs.length === 1) { var f0 = fs[0]; return function (f) { return [f0(f)]; }; }
      return function (f) { var r = new Array(fs.length); for (var i = 0; i < fs.length; i++) r[i] = fs[i](f); return r; };
    }
    var fixed = args.slice(0, n - 1).map(function (a, i) { return self.exprConv(a, formals[i], ctx); });
    var vt = formals[n - 1], et = vt.elem;
    var rest = args.slice(n - 1).map(function (a) { return self.exprConv(a, et, ctx); });
    var ac = arrayClass(erasure(et).k === "prim" ? et : erasure(et));
    var isPrim = et.k === "prim";
    return function (f) {
      var r = [];
      for (var i = 0; i < fixed.length; i++) r.push(fixed[i](f));
      var arr = newArray(isPrim ? et : erasure(et), rest.length);
      for (var j = 0; j < rest.length; j++) arr.a[j] = rest[j](f);
      r.push(arr);
      return r;
    };
  };
  GN.callCode = function (e, ctx) {
    var self = this, m = e.msym;
    var args = this.callArgs(e.args, e.formals, e.varargsCall, ctx);
    var line = ctx.file.lineOf(e.pos);
    var key = m.key;
    if (m.arrayClone) {
      var at = this.expr(e.target, ctx);
      return function (f) { var a = at(f); if (a === null) npe(); return new JArr(a.$c, a.a.slice()); };
    }
    if (m.flags["static"]) {
      var tgtEval = e.target && e.target.ref && e.target.ref.kind !== "class" && e.target.ref.kind !== "pkg" && e.target.k !== "Super" ? this.expr(e.target, ctx) : null;
      var owner = m.owner;
      if (m.isLib) {
        var impl = m.impl;
        if (typeof impl !== "function") throw new Error("(simulador) método da biblioteca sem implementação: " + owner.full + "." + m.name);
        return function (f) { if (tgtEval) tgtEval(f); var a = args(f); f.line = line; return impl.apply(null, a); };
      }
      return function (f) { if (tgtEval) tgtEval(f); var a = args(f); f.line = line; return m.impl.apply(null, a); };
    }
    // receptor
    var recv;
    if (!e.target) { var dep = e.implicitDepth || 0; recv = dep ? function (f) { return outerOf(f.t, dep); } : function (f) { return f.t; }; }
    else if (e.target.k === "Super") recv = function (f) { return f.t; };
    else recv = this.expr(e.target, ctx);
    var desc = e.target && e.target.k !== "Super" ? this.nullDesc(e.target, ctx) : null;
    var npeMsg = "Cannot invoke \"" + npeMethodDesc(m, e.recvType || e.callSite) + "\"" + becauseTxt(desc);
    // invocação direta (super., privado, final)
    if (e.superCall || m.flags["private"]) {
      var direct = m;
      if (e.superCall && m.flags.abstract === undefined && false) direct = m;
      return function (f) {
        var o = recv(f); var a = args(f); f.line = line;
        var im = direct.impl;
        if (!im) { im = vtOf(direct.owner)[key]; }
        return im.apply(o, a);
      };
    }
    var siteSym = e.callSite && e.callSite.k === "class" ? e.callSite.sym : null;
    var finalStr = siteSym && siteSym.full === "java.lang.String";
    if (finalStr && m.impl) {
      var si = m.impl;
      return function (f) { var o = recv(f); var a = args(f); f.line = line; if (o === null) npe(npeMsg); return si.apply(o, a); };
    }
    return function (f) {
      var o = recv(f);
      var a = args(f);
      f.line = line;
      if (o === null) npe(npeMsg);
      var c = typeof o === "string" || o instanceof String ? LIB["java.lang.String"] : o.$c;
      var fn = (c.vt || vtOf(c))[key];
      if (!fn) { fn = findByName(c, key); if (!fn) throw new Error("(simulador) método " + key + " não encontrado em " + c.full); }
      return fn.apply(o, a);
    };
  };
  GN.newCode = function (e, ctx) {
    var self = this;
    var sym = e.anonSym || e.clsSym;
    var line = ctx.file.lineOf(e.pos);
    var c = e.anonSym ? (sym.ctors[0]) : e.csym;
    var formals = e.anonSym ? (e.formals || []) : e.formals;
    var args = this.callArgs(e.args, formals || [], e.anonSym ? e.varargsCall : e.varargsCall, ctx);
    var outerFn = null;
    if (e.outer) outerFn = this.expr(e.outer, ctx);
    else if (sym.inner && !sym.local && !sym.anon) { var dep = (e.outerDepth || 0); outerFn = function (f) { return outerOf(f.t, dep); }; }
    else if ((sym.local || sym.anon) && sym.inner) outerFn = function (f) { return f.t; };
    if (sym.local || sym.anon) this.prepareClass(sym);
    var caps = null;
    if (sym.captures && sym.captures.length) {
      caps = sym.captures.map(function (v) { return { uid: uidOf(v), acc: self.varAccess(ctx, v) }; });
    }
    if (sym.isLib) {
      if (c.make) { var mk = c.make; return function (f) { var a = args(f); f.line = line; return mk.apply(null, a); }; }
      return function (f) {
        var a = args(f); f.line = line;
        var o = { $c: sym };
        c.impl.apply(o, a);
        return o;
      };
    }
    return function (f) {
      var outer = outerFn ? outerFn(f) : null;
      var a = args(f);
      f.line = line;
      var o = newInstance(sym);
      if (outerFn) { if (outer === null) npe(); o.$outer = outer; }
      if (caps) { o.$cap = {}; for (var i = 0; i < caps.length; i++) o.$cap[caps[i].uid] = caps[i].acc.get(f); }
      if (sym.anon && sym.ifaces.length && !c.anonSuper) { if (c.impl) c.impl.apply(o, a); }
      else c.impl.apply(o, a);
      return o;
    };
  };
  GN.ctorCallCode = function (e, ctx) {
    var c = e.csym, args = this.callArgs(e.args, e.formals, e.varargsCall, ctx);
    var line = ctx.file.lineOf(e.kwPos);
    var supSym = c.owner;
    return function (f) {
      var a = args(f);
      f.line = line;
      if (c.impl) c.impl.apply(f.t, a);
      return undefined;
    };
  };
  GN.newArrayCode = function (e, ctx) {
    var self = this;
    var t = e.arrType || e.type;
    if (e.init) return this.arrayInitCode(e.init, t, ctx);
    var dims = e.dims.map(function (d) { return self.exprConv(d, T["int"], ctx); });
    if (dims.length === 1) { var d0 = dims[0], el = t.elem; return function (f) { return newArray(el, d0(f)); }; }
    return function (f) {
      var ds = dims.map(function (d) { return d(f); });
      ds.forEach(function (n) { if (n < 0) throwJ("java.lang.NegativeArraySizeException", String(n)); });
      return newMultiArray(t, ds, 0);
    };
  };
  GN.arrayInitCode = function (e, t, ctx) {
    var self = this, et = t.elem;
    var els = e.elems.map(function (x) { return x.k === "ArrayInit" ? self.arrayInitCode(x, et, ctx) : self.exprConv(x, et, ctx); });
    var ee = et.k === "prim" ? et : erasure(et);
    return function (f) {
      var arr = newArray(ee, els.length);
      for (var i = 0; i < els.length; i++) arr.a[i] = els[i](f);
      return arr;
    };
  };

  // ---------- lambdas e referências de método ----------
  var LAMBDA_CLASSES = {};
  function lambdaClassFor(isym, sam, node) {
    var key = isym.id + "/" + (node || "Main");
    var c = LAMBDA_CLASSES[key];
    if (c) return c;
    c = new ClassSym(isym.name, "Main$$Lambda", "class");
    c.bin = (node || "Main") + "$$Lambda/0x" + (0x7f0000 + isym.id * 0x40).toString(16).padStart(16, "0");
    c.superT = OBJ(); c.ifaces = [isym.rawType()]; c.headerDone = true; c.completed = true; c.isLib = true; c.isLambda = true;
    var vt = Object.create(vtOf(L("java.lang.Object")));
    var all = Object.create(null);
    (function addI(s) {
      complete(s);
      var iv = vtOf(s);
      for (var k in iv) if (!(k in all)) all[k] = iv[k];
      s.ifaces.forEach(function (i) { addI(i.sym); });
    })(isym);
    for (var k2 in all) vt[k2] = all[k2];
    var samKeys = [];
    // a chave do SAM e as de métodos abstratos equivalentes em superinterfaces
    (function addSam(s) {
      complete(s);
      s.methodList.forEach(function (m) { if (m.name === sam.name && m.params.length === sam.params.length && m.flags.abstract) samKeys.push(m.key); });
      s.ifaces.forEach(function (i) { addSam(i.sym); });
    })(isym);
    if (samKeys.indexOf(sam.key) < 0) samKeys.push(sam.key);
    var call = function () { return this.fn.apply(this, arguments); };
    samKeys.forEach(function (k3) { vt[k3] = call; });
    c.vt = vt;
    LAMBDA_CLASSES[key] = c;
    return c;
  }
  function mkLambda(isym, sam, fn) { return { $c: lambdaClassFor(isym, sam, RT && RT.lambdaOwner), fn: fn }; }
  GN.lambdaName = function (ctx) {
    var top = ctx.cls; while (top.outer) top = top.outer;
    var m = ctx.method ? (ctx.method.name === "<init>" ? "new" : ctx.method.name) : (ctx.traceName && /clinit/.test(ctx.traceName) ? "static" : "new");
    var cnt = this.prog.lambdaCount[ctx.cls.bin] = (this.prog.lambdaCount[ctx.cls.bin] || 0);
    this.prog.lambdaCount[ctx.cls.bin]++;
    return ctx.cls.bin + ".lambda$" + m + "$" + cnt;
  };
  GN.lambdaCode = function (e, ctx) {
    var self = this;
    var isym = erasure(e.ftype.k === "inter" ? e.ftype.types[0] : e.ftype).sym;
    var sam = e.sam;
    var frame = e.frame;
    var caps = frame.captures.map(function (v) { return self.varAccess(ctx, v); });
    var name = this.lambdaName(ctx);
    var lctx = { cls: ctx.cls, frame: frame, method: ctx.method, file: ctx.file, traceName: name, lambdaRet: e.samRet };
    var slots = e.paramSyms.map(function (p) { return p.slot; });
    // conversões dos argumentos: chegam apagados (objetos); os parâmetros podem ser primitivos
    var samParams = sam.params;
    var conv = e.paramSyms.map(function (p, i) {
      var from = erasure(samParams[i] || OBJ());
      var fromT = (e.samParams && e.samParams[i]) || from;
      if (p.type.k === "prim" && from.k !== "prim") return convFn(fromT.k === "prim" ? boxedType(fromT) : fromT, p.type);
      if (p.type.k === "prim" && from.k === "prim" && p.type.n !== from.n) return primCastFn(from, p.type);
      return null;
    });
    var body = null, isExpr = e.body.k !== "Block";
    var n = e.frameSize || 1;
    var samRet = sam.ret;
    var erasedRet = erasure(samRet);
    var retConv = null;
    var file = ctx.file.name;
    var line0 = ctx.file.lineOf(e.pos);
    function getBody() {
      if (body) return body;
      if (isExpr) {
        var bt = e.body.type;
        if (samRet === T["void"]) { var ex = self.expr(e.body, lctx, true); body = function (f) { ex(f); return undefined; }; }
        else {
          var target = erasedRet.k === "prim" ? erasedRet : (bt && bt.k === "prim" ? boxedType(bt) : null);
          var ex2 = target ? self.exprConv(e.body, target, lctx) : self.expr(e.body, lctx);
          body = ex2;
        }
      } else {
        var lctx2 = Object.assign({}, lctx, { lambdaRet: erasedRet.k === "prim" ? erasedRet : (e.samRet && e.samRet.k === "prim" ? e.samRet : null) });
        var bl = self.block(e.body, lctx2);
        body = function (f) { var r = bl(f); return r === RET ? f.rv : undefined; };
      }
      return body;
    }
    return function (f) {
      var capVals = caps.length ? caps.map(function (a) { return a.get(f); }) : null;
      var self0 = f.t;
      return mkLambda(isym, sam, function () {
        var lf = new Frame(self0, n, name);
        lf.file = file; lf.line = line0; lf.c = capVals;
        for (var i = 0; i < slots.length; i++) { var v = arguments[i]; lf.l[slots[i]] = conv[i] ? conv[i](v) : v; }
        enterFrame(lf);
        try {
          var r = getBody()(lf);
          if (r !== undefined && erasedRet.k !== "prim" && samRet !== T["void"] && typeof r !== "object" && typeof r !== "string") {
            // valor primitivo para retorno genérico: encaixota
            r = boxGuess(r, e.body.type || e.samRet);
          }
          return r;
        } catch (ex) { if (ex instanceof RangeError && !ex.javaStack) snapshotOverflow(ex); throw ex; }
        finally { RT.stack.pop(); }
      });
    };
  };
  function boxGuess(v, t) {
    if (t && t.k === "prim") return boxVal(t.n, v);
    if (typeof v === "boolean") return boxVal("boolean", v);
    if (typeof v === "bigint") return boxVal("long", v);
    if (typeof v === "number") return boxVal(Number.isInteger(v) ? "int" : "double", v);
    return v;
  }
  GN.mrefCode = function (e, ctx) {
    var self = this;
    var isym = erasure(e.ftype.k === "inter" ? e.ftype.types[0] : e.ftype).sym;
    var sam = e.sam, m = e.msym, kind = e.refKind;
    var samParams = e.samParams || [];
    var mret = e.mret;
    var erasedRet = erasure(sam.ret);
    // conversão do retorno para o SAM (apagado)
    function retFix(v) {
      if (sam.ret === T["void"]) return undefined;
      if (erasedRet.k !== "prim" && mret && mret.k === "prim") return boxVal(mret.n, v);
      if (erasedRet.k === "prim" && mret && mret.k !== "prim") { var c = convFn(mret, erasedRet); return c ? c(v) : v; }
      if (erasedRet.k === "prim" && mret && mret.k === "prim" && erasedRet.n !== mret.n) { var c2 = primCastFn(mret, erasedRet); return c2 ? c2(v) : v; }
      return v;
    }
    // conversões dos argumentos para os parâmetros do método
    function argConvs(params, offset) {
      return params.map(function (p, i) {
        var st = samParams[i + offset] || OBJ();
        var fromErased = erasure(sam.params[i + offset] || OBJ());
        var from = fromErased.k === "prim" ? fromErased : (st.k === "prim" ? boxedType(st) : st);
        return convFn(from, p) || null;
      });
    }
    if (kind === "arrayCtor") {
      var at = e.arrType;
      return function () { return mkLambda(isym, sam, function (n) { if (n instanceof JBox) n = n.v; return newArray(at.elem, n); }); };
    }
    var formals = e.formals || m.params;
    var varargs = e.varargsCall;
    function packArgs(a, convs) {
      var r = a.map(function (v, i) { return convs[i] ? convs[i](v) : v; });
      if (varargs) {
        var nf = formals.length;
        var et = formals[nf - 1].elem;
        var arr = newArray(et.k === "prim" ? et : erasure(et), r.length - (nf - 1));
        for (var i = nf - 1; i < r.length; i++) arr.a[i - (nf - 1)] = r[i];
        r = r.slice(0, nf - 1).concat([arr]);
      }
      return r;
    }
    var key = m.key;
    function invokeOn(o, args) {
      if (o === null) npe();
      var c = classOf(o);
      var fn = m.flags["private"] ? m.impl : ((c.vt || vtOf(c))[key] || findByName(c, key));
      return fn.apply(o, args);
    }
    if (kind === "ctor") {
      var sym = e.clsSym;
      var convC = argConvs(varargs ? formals.slice(0, -1).concat(samParams.slice(formals.length - 1).map(function () { return formals[formals.length - 1].elem; })) : formals, 0);
      var outerNeeded = sym.inner;
      return function (f) {
        var outer = outerNeeded ? f.t : null;
        return mkLambda(isym, sam, function () {
          var a = packArgs(Array.prototype.slice.call(arguments), convC);
          if (sym.isLib) { var o0 = { $c: sym }; m.impl.apply(o0, a); return o0; }
          self.prepareClass(sym);
          var o = newInstance(sym);
          if (outer) o.$outer = outer;
          m.impl.apply(o, a);
          return o;
        });
      };
    }
    if (kind === "static") {
      var convS = argConvs(varargs ? formals.slice(0, -1).concat(samParams.slice(formals.length - 1).map(function () { return formals[formals.length - 1].elem; })) : formals, 0);
      return function () {
        return mkLambda(isym, sam, function () { return retFix(m.impl.apply(null, packArgs(Array.prototype.slice.call(arguments), convS))); });
      };
    }
    if (kind === "unbound") {
      var convU = argConvs(formals, 1);
      return function () {
        return mkLambda(isym, sam, function () {
          var a = Array.prototype.slice.call(arguments);
          var o = a.shift();
          if (o instanceof JBox && m.owner.full !== "java.lang.Object" && UNBOX[m.owner.full] === undefined) { /* */ }
          return retFix(invokeOn(o, packArgs(a, convU)));
        });
      };
    }
    // bound / super
    var recvFn = e.superRef ? function (f) { return f.t; } : this.expr(e.target, ctx);
    var convB = argConvs(formals, 0);
    var isSuper = kind === "super";
    var desc = e.target.k !== "Super" ? this.nullDesc(e.target, ctx) : null;
    return function (f) {
      var o = recvFn(f);
      if (o === null) npe(desc ? "Cannot invoke \"Object.getClass()\" because " + desc + " is null" : null);
      return mkLambda(isym, sam, function () {
        var a = packArgs(Array.prototype.slice.call(arguments), convB);
        if (isSuper) return retFix(m.impl.apply(o, a));
        return retFix(invokeOn(o, a));
      });
    };
  };
  // objeto Class
  function classObject(t) {
    var e = erasure(t);
    var key = e.k === "prim" ? e.n : e.k === "array" ? "[" + binName(e.elem) : e.sym.bin;
    RT.classObjs = RT.classObjs || {};
    if (!RT.classObjs[key]) RT.classObjs[key] = { $c: L("java.lang.Class"), t: e };
    return RT.classObjs[key];
  }
  function classObjectOfValue(v) {
    var c = classOf(v);
    RT.classObjs = RT.classObjs || {};
    if (!RT.classObjs[c.bin]) RT.classObjs[c.bin] = { $c: L("java.lang.Class"), t: c.rawType ? c.rawType() : OBJ(), sym: c };
    return RT.classObjs[c.bin];
  }

  /* =====================================================================
     15. Formatação (String.format/printf) com locale pt_BR
     ===================================================================== */
  var LOC_PT = { dec: ",", grp: "." }, LOC_US = { dec: ".", grp: "," };
  // dígitos curtos de um double: {ds, e}
  function decDigits(v) {
    if (v === 0) return { ds: "0", e: 0 };
    return shortestDigits(Math.abs(v), false);
  }
  // arredonda HALF_UP para "prec" casas; devolve {int: "123", frac: "45"}
  function fixedParts(v, prec, isFloat) {
    var d = isFloat ? shortestDigits(Math.abs(v), true) : decDigits(v);
    if (v === 0) d = { ds: "0", e: 0 };
    var N = BigInt(d.ds), scale = d.ds.length - 1 - d.e, q;
    if (scale <= prec) q = N * (10n ** BigInt(prec - scale));
    else {
      var div = 10n ** BigInt(scale - prec);
      q = N / div;
      var r = N % div;
      if (r * 2n >= div) q += 1n;
    }
    var s = q.toString();
    while (s.length <= prec) s = "0" + s;
    return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
  }
  function bigFixedParts(digits, scale, prec) {
    // digits: BigInt (valor absoluto) com "scale" casas decimais
    var N = digits, q;
    if (scale <= prec) q = N * (10n ** BigInt(prec - scale));
    else { var div = 10n ** BigInt(scale - prec); q = N / div; if ((N % div) * 2n >= div) q += 1n; }
    var s = q.toString();
    while (s.length <= prec) s = "0" + s;
    return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
  }
  function groupDigits(s, sep) {
    var r = "";
    for (var i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) r += sep; r += s[i]; }
    return r;
  }
  function sciParts(v, prec, isFloat) {
    // mantissa com prec casas, expoente
    if (v === 0) return { m: "0" + (prec ? "." + repeat("0", prec) : ""), e: 0, mi: "0", mf: repeat("0", prec) };
    var d = isFloat ? shortestDigits(Math.abs(v), true) : decDigits(v);
    var N = BigInt(d.ds), len = d.ds.length, e = d.e, q;
    if (len - 1 <= prec) q = N * (10n ** BigInt(prec - (len - 1)));
    else { var div = 10n ** BigInt(len - 1 - prec); q = N / div; if ((N % div) * 2n >= div) q += 1n; }
    var s = q.toString();
    if (s.length > prec + 1) { s = s.slice(0, prec + 1); e++; }
    return { mi: s[0], mf: s.slice(1), e: e };
  }
  function fmtErr(cls, msg, extraFrames) { throwJ(cls, msg); }
  // núcleo do Formatter
  var FMT_CALLER = {
    printf: ["java.base/java.io.PrintStream.format(PrintStream.java:1183)", "java.base/java.io.PrintStream.printf(PrintStream.java:1081)"],
    format: ["java.base/java.io.PrintStream.format(PrintStream.java:1183)"],
    string: ["java.base/java.util.Formatter.format(Formatter.java:2698)", "java.base/java.lang.String.format(String.java:4455)"],
    formatted: ["java.base/java.lang.String.formatted(String.java:4579)"]
  };
  // caller: "printf"/"string"/...; emit: função que recebe a saída parcial (printf escreve aos pedaços)
  function jformatAt(fmt, args, loc, caller, emit) {
    var partial = { s: "" };
    try { var r = jformat(fmt, args, loc, partial); if (emit) emit(r); return r; }
    catch (e) {
      if (e instanceof JavaThrow) {
        var ex = e.ex, nm = ex.$c.full;
        var top = [];
        if (nm === "java.util.IllegalFormatConversionException") top = ["java.base/java.util.Formatter$FormatSpecifier.failConversion(Formatter.java:4662)", "java.base/java.util.Formatter$FormatSpecifier.printInteger(Formatter.java:3200)", "java.base/java.util.Formatter$FormatSpecifier.print(Formatter.java:3155)", "java.base/java.util.Formatter.format(Formatter.java:2761)"];
        else if (nm === "java.util.MissingFormatArgumentException") top = ["java.base/java.util.Formatter.format(Formatter.java:2760)"];
        else if (nm === "java.util.UnknownFormatConversionException") top = ["java.base/java.util.Formatter$FormatSpecifier.conversion(Formatter.java:3069)", "java.base/java.util.Formatter$FormatSpecifier.<init>(Formatter.java:3125)", "java.base/java.util.Formatter$FormatSpecifierParser.parse(Formatter.java:2915)", "java.base/java.util.Formatter.parse(Formatter.java:2814)", "java.base/java.util.Formatter.format(Formatter.java:2744)"];
        ex.stack = top.concat(FMT_CALLER[caller] || []).concat(ex.stack || []);
        if (emit && partial.s) emit(partial.s);
      }
      throw e;
    }
  }
  function jformat(fmt, args, loc, partial) {
    loc = loc || LOC_PT;
    fmt = S(fmt);
    var out = "", i = 0, argi = 0, last = -1;
    var re = /%(\d+\$|<)?([-#+ 0,(]*)(\d+)?(\.\d+)?([a-zA-Z%])/g, m, pos = 0;
    while ((m = re.exec(fmt))) {
      out += fmt.slice(pos, m.index);
      if (partial) partial.s = out;
      pos = re.lastIndex;
      var conv = m[5], flags = m[2] || "", width = m[3] ? parseInt(m[3], 10) : -1, prec = m[4] ? parseInt(m[4].slice(1), 10) : -1;
      var spec = m[0];
      if (conv === "n") { out += "\n"; continue; }
      if (conv === "%") { out += pad("%", width, flags); continue; }
      if (!/^[bBhHsScCdoxXeEfgGaAtT]$/.test(conv)) throwJ("java.util.UnknownFormatConversionException", "Conversion = '" + conv + "'");
      var idx;
      if (m[1] === "<") idx = last;
      else if (m[1]) idx = parseInt(m[1], 10) - 1;
      else idx = argi++;
      if (partial) partial.s = out;
      if (idx < 0 || idx >= args.length) throwJ("java.util.MissingFormatArgumentException", "Format specifier '" + spec + "'");
      last = idx;
      var a = args[idx];
      out += fmtOne(conv, flags, width, prec, a, loc, spec);
    }
    out += fmt.slice(pos);
    var bad = /%(?![-#+ 0,(\d.$<]*[a-zA-Z%])/.exec(fmt.slice(pos));
    if (bad) throwJ("java.util.UnknownFormatConversionException", "Conversion = '%'");
    return out;
  }
  function pad(s, width, flags) {
    if (width < 0 || s.length >= width) return s;
    return flags.indexOf("-") >= 0 ? s + repeat(" ", width - s.length) : repeat(" ", width - s.length) + s;
  }
  function boxKind(a) { return a instanceof JBox ? UNBOX[a.$c.full] : null; }
  function convFail(conv, a) { throwJ("java.util.IllegalFormatConversionException", conv + " != " + classOf(a).full); }
  function fmtOne(conv, flags, width, prec, a, loc, spec) {
    var up = conv === conv.toUpperCase() && conv !== "%";
    var lc = conv.toLowerCase();
    var s, neg = false;
    switch (lc) {
      case "b": s = a === null ? "false" : (a instanceof JBox && UNBOX[a.$c.full] === "boolean") ? String(a.v) : "true"; break;
      case "h": s = a === null ? "null" : (jhash(a) >>> 0).toString(16); break;
      case "s": s = a === null ? "null" : toStr(a); if (prec >= 0) s = s.slice(0, prec); break;
      case "c": {
        if (a === null) { s = "null"; break; }
        var k = boxKind(a);
        if (k === "char") s = String.fromCharCode(a.v);
        else if (k === "int" || k === "byte" || k === "short") s = String.fromCodePoint(a.v);
        else convFail(conv, a);
        break;
      }
      case "d": {
        if (a === null) { s = "null"; break; }
        var kd = boxKind(a), num;
        if (kd === "int" || kd === "short" || kd === "byte") num = BigInt(a.v);
        else if (kd === "long") num = a.v;
        else if (classOf(a).full === "java.math.BigInteger") num = a.big;
        else convFail(conv, a);
        neg = num < 0n;
        var ds = (neg ? -num : num).toString();
        if (flags.indexOf(",") >= 0) ds = groupDigits(ds, loc.grp);
        s = signed(ds, neg, flags, width);
        return s;
      }
      case "o": case "x": {
        if (a === null) { s = "null"; break; }
        var kx = boxKind(a), v;
        if (kx === "int") v = BigInt(a.v >>> 0);
        else if (kx === "short") v = BigInt(a.v & 0xffff);
        else if (kx === "byte") v = BigInt(a.v & 0xff);
        else if (kx === "long") v = BigInt.asUintN(64, a.v);
        else if (classOf(a).full === "java.math.BigInteger") v = a.big;
        else convFail(conv, a);
        s = v.toString(lc === "o" ? 8 : 16);
        if (flags.indexOf("#") >= 0) s = (lc === "o" ? "0" : "0x") + s;
        if (flags.indexOf("0") >= 0 && width > s.length) s = repeat("0", width - s.length) + s;
        break;
      }
      case "e": case "f": case "g": case "a": {
        if (a === null) { s = "null"; break; }
        var kf = boxKind(a), dv, isF = false, bd = null;
        if (kf === "double") dv = a.v;
        else if (kf === "float") { dv = a.v; isF = true; }
        else if (classOf(a).full === "java.math.BigDecimal") bd = a;
        else convFail(conv, a);
        if (bd) { s = fmtBigDecimal(lc, bd, prec, flags, width, loc); return up ? s.toUpperCase() : s; }
        if (dv !== dv || dv === Infinity || dv === -Infinity) {
          s = dv !== dv ? "NaN" : (dv > 0 ? (flags.indexOf("+") >= 0 ? "+Infinity" : "Infinity") : (flags.indexOf("(") >= 0 ? "(Infinity)" : "-Infinity"));
          return pad(up ? s.toUpperCase() : s, width, flags.replace("0", ""));
        }
        neg = dv < 0 || (dv === 0 && 1 / dv < 0);
        var av = Math.abs(dv);
        if (lc === "f") {
          var p = prec < 0 ? 6 : prec;
          var fp = fixedParts(av, p, isF);
          var ip = flags.indexOf(",") >= 0 ? groupDigits(fp.int, loc.grp) : fp.int;
          s = ip + (p > 0 ? loc.dec + fp.frac : (flags.indexOf("#") >= 0 ? loc.dec : ""));
        } else if (lc === "e") {
          var pe = prec < 0 ? 6 : prec;
          var sp = sciParts(av, pe, isF);
          s = sp.mi + (pe > 0 ? loc.dec + sp.mf : "") + "e" + (sp.e < 0 ? "-" : "+") + (Math.abs(sp.e) < 10 ? "0" : "") + Math.abs(sp.e);
        } else if (lc === "g") {
          var pg = prec < 0 ? 6 : (prec === 0 ? 1 : prec);
          // valor arredondado para pg dígitos significativos
          var spg = sciParts(av, pg - 1, isF);
          var rv = parseFloat(spg.mi + "." + spg.mf + "e" + spg.e);
          if (av !== 0 && (rv < 1e-4 || rv >= Math.pow(10, pg))) {
            s = spg.mi + (pg - 1 > 0 ? loc.dec + spg.mf : "") + "e" + (spg.e < 0 ? "-" : "+") + (Math.abs(spg.e) < 10 ? "0" : "") + Math.abs(spg.e);
          } else {
            var dec = av === 0 ? pg - 1 : pg - 1 - spg.e;
            var fg = fixedParts(av, Math.max(dec, 0), isF);
            var ipg = flags.indexOf(",") >= 0 ? groupDigits(fg.int, loc.grp) : fg.int;
            s = ipg + (dec > 0 ? loc.dec + fg.frac : "");
          }
        } else {
          s = hexFloat(av);
        }
        s = signed(s, neg, flags, width);
        return up ? s.toUpperCase() : s;
      }
      default:
        throwJ("java.util.UnknownFormatConversionException", "Conversion = '" + conv + "'");
    }
    if (up) s = s.toUpperCase();
    return pad(s, width, flags);
  }
  function signed(ds, neg, flags, width) {
    var pre = "", suf = "";
    if (neg) { if (flags.indexOf("(") >= 0) { pre = "("; suf = ")"; } else pre = "-"; }
    else if (flags.indexOf("+") >= 0) pre = "+";
    else if (flags.indexOf(" ") >= 0) pre = " ";
    if (flags.indexOf("0") >= 0 && width > 0) {
      var need = width - pre.length - suf.length - ds.length;
      if (need > 0) ds = repeat("0", need) + ds;
    }
    return pad(pre + ds + suf, width, flags);
  }
  function hexFloat(v) {
    if (v === 0) return "0x0.0p0";
    var buf = new DataView(new ArrayBuffer(8)); buf.setFloat64(0, v);
    var hi = buf.getUint32(0), lo = buf.getUint32(4);
    var exp = ((hi >>> 20) & 0x7ff) - 1023;
    var mant = ((BigInt(hi & 0xfffff) << 32n) | BigInt(lo)).toString(16).padStart(13, "0").replace(/0+$/, "") || "0";
    return "0x1." + mant + "p" + exp;
  }
  function fmtBigDecimal(lc, bd, prec, flags, width, loc) {
    var neg = bd.big < 0n, abs = neg ? -bd.big : bd.big, s;
    if (lc === "f") {
      var p = prec < 0 ? 6 : prec;
      var fp = bigFixedParts(abs, bd.scale, p);
      var ip = flags.indexOf(",") >= 0 ? groupDigits(fp.int, loc.grp) : fp.int;
      s = ip + (p > 0 ? loc.dec + fp.frac : "");
    } else {
      var dv = Number(bd.big) / Math.pow(10, bd.scale);
      return fmtOne(lc, flags, width, prec, new JBox(L("java.lang.Double"), dv), loc);
    }
    return signed(s, neg, flags, width);
  }
  JavaSim.jformat = jformat;

  /* =====================================================================
     16. Biblioteca: java.lang (núcleo)
     ===================================================================== */
  var LIB_DEFINERS = [], libReady = false;
  function ensureLib() {
    if (libReady) return;
    libReady = true;
    defineCoreLib();
    LIB_DEFINERS.forEach(function (fn) { fn(JavaSim); });
  }
  JavaSim.addLib = function (fn) { if (libReady) fn(JavaSim); else LIB_DEFINERS.push(fn); };
  function box(n, v) { return boxVal(n, v); }
  function jbool(v) { return v; }
  function strArg(s, what) { if (s === null) npe(what || null); return S(s); }
  function charsOf(s) { return S(s); }
  function checkIdx(i, n, kind) {
    if (i < 0 || i >= n) throwJ("java.lang.StringIndexOutOfBoundsException", kind === "charAt" ? "Index " + i + " out of bounds for length " + n : "index " + i + ", length " + n);
  }
  var PRECOND = ["java.base/jdk.internal.util.Preconditions$1.apply(Preconditions.java:55)", "java.base/jdk.internal.util.Preconditions$1.apply(Preconditions.java:52)", "java.base/jdk.internal.util.Preconditions$4.apply(Preconditions.java:213)", "java.base/jdk.internal.util.Preconditions$4.apply(Preconditions.java:210)", "java.base/jdk.internal.util.Preconditions.outOfBounds(Preconditions.java:98)"];
  function subRangeFail(b, e, n, one) { throwJ("java.lang.StringIndexOutOfBoundsException", "Range [" + b + ", " + e + ") out of bounds for length " + n, PRECOND.concat(["java.base/jdk.internal.util.Preconditions.outOfBoundsCheckFromToIndex(Preconditions.java:112)", "java.base/jdk.internal.util.Preconditions.checkFromToIndex(Preconditions.java:349)", "java.base/java.lang.String.checkBoundsBeginEnd(String.java:4937)", "java.base/java.lang.String.substring(String.java:2899)"]).concat(one ? ["java.base/java.lang.String.substring(String.java:2872)"] : [])); }
  function isWs(c) { return c === 32 || (c >= 9 && c <= 13) || (c >= 28 && c <= 31) || c === 0x1680 || (c >= 0x2000 && c <= 0x2006) || (c >= 0x2008 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x205f || c === 0x3000; }
  function jtrim(s) { var a = 0, b = s.length; while (a < b && s.charCodeAt(a) <= 32) a++; while (b > a && s.charCodeAt(b - 1) <= 32) b--; return s.slice(a, b); }
  function jstrip(s) { var a = 0, b = s.length; while (a < b && isWs(s.charCodeAt(a))) a++; while (b > a && isWs(s.charCodeAt(b - 1))) b--; return s.slice(a, b); }
  function regexFromJava(rx) { return javaRegex(S(rx)); }
  // regex do Java → JS (o básico)
  function javaRegex(src, flags) {
    var s = src.replace(/\\p\{Alpha\}/g, "[A-Za-z]").replace(/\\p\{Digit\}/g, "\\d").replace(/\\p\{Upper\}/g, "[A-Z]").replace(/\\p\{Lower\}/g, "[a-z]").replace(/\\p\{Punct\}/g, "[!-\\/:-@\\[-`{-~]").replace(/\\p\{Alnum\}/g, "[A-Za-z0-9]").replace(/\\p\{L\}/g, "\\p{L}").replace(/\\p\{IsAlphabetic\}/g, "\\p{L}").replace(/\\p\{javaWhitespace\}/g, "\\s").replace(/\\p\{Space\}/g, "\\s").replace(/\\z/g, "$").replace(/\\Z/g, "$").replace(/\\A/g, "^").replace(/\(\?<([a-zA-Z][a-zA-Z0-9]*)>/g, "(?<$1>").replace(/\*\+/g, "*").replace(/\+\+/g, "+").replace(/\?\+/g, "?");
    try { return new RegExp(s, (flags || "") + "u"); }
    catch (e) {
      try { return new RegExp(s, flags || ""); }
      catch (e2) { throwJ("java.util.regex.PatternSyntaxException", e2.message + " near index 0\n" + src); }
    }
  }
  function jsplit(s, rx, limit) {
    limit = limit || 0;
    var re = javaRegex(rx, "g");
    var parts = [], last = 0, m, count = 0;
    if (s.length === 0) return [""];
    while ((m = re.exec(s))) {
      if (m[0].length === 0) { if (m.index >= s.length) break; if (m.index === 0) { re.lastIndex++; continue; } }
      if (limit > 0 && parts.length === limit - 1) break;
      if (!(m.index === 0 && m[0].length > 0 && last === 0 && parts.length === 0 && false)) {
        if (!(m.index === 0 && m[0].length > 0 && parts.length === 0 && last === 0)) parts.push(s.slice(last, m.index));
        else parts.push("");
      }
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    parts.push(s.slice(last));
    // Java: separador no início produz "" inicial só se o casamento tiver largura > 0
    if (limit === 0) while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    if (limit === 0 && parts.length === 1 && parts[0] === "" && s.length > 0) return [];
    return parts;
  }
  function strArray(arr) { var a = newArray(L("java.lang.String").rawType(), arr.length); for (var i = 0; i < arr.length; i++) a.a[i] = jstr(arr[i]); return a; }
  function jreplaceAll(s, rx, rep, once) {
    var re = javaRegex(S(rx), once ? "" : "g");
    var r = S(rep).replace(/\$(\d)/g, "$$$1").replace(/\\\$/g, "$$$$");
    return s.replace(re, r);
  }
  function lower(s) { return s.toLowerCase(); }

  function defineCoreLib() {
    var SO = "java.lang.";
    defLib("java.lang.Object", { m: {
      "<init>()": function () {},
      "boolean equals(Object)": function (o) { return this === o; },
      "int hashCode()": function () { return identityHash(this); },
      "String toString()": function () { return jstr(classOf(this).bin + "@" + (vcall(this, "hashCode()", []) >>> 0).toString(16)); },
      "Class<?> getClass()": function () { return classObjectOfValue(this); },
      "void notify()": function () {}, "void notifyAll()": function () {},
      "void wait()": function () {}, "void wait(long)": function () {},
      "protected Object clone()": function () { var o = {}; for (var k in this) if (k !== "$h") o[k] = this[k]; return o; }
    } });
    defLib("java.io.Serializable", { kind: "interface", m: {} });
    defLib("java.lang.Cloneable", { kind: "interface", m: {} });
    defLib("java.lang.Comparable", { kind: "interface", tp: "T", m: { "int compareTo(T)": null } });
    defLib("java.lang.CharSequence", { kind: "interface", m: {
      "int length()": null, "char charAt(int)": null,
      "boolean isEmpty()": function () { return jcall(this, "length", []) === 0; },
      "String toString()": null,
      "CharSequence subSequence(int,int)": null
    } });
    defLib("java.lang.Iterable", { kind: "interface", tp: "T", m: {
      "Iterator<T> iterator()": null,
      "void forEach(Consumer<? super T>)": function (c) { var it = jcall(this, "iterator", []); while (jcall(it, "hasNext", [])) jcall(c, "accept", [jcall(it, "next", [])]); }
    } });
    defLib("java.lang.Runnable", { kind: "interface", m: { "void run()": null } });
    defLib("java.lang.AutoCloseable", { kind: "interface", m: { "void close() throws Exception": null } });
    defLib("java.io.Closeable", { kind: "interface", impl: ["AutoCloseable"], m: { "void close() throws IOException": null } });
    defLib("java.lang.Override", { kind: "annotation", m: {} });
    defLib("java.lang.FunctionalInterface", { kind: "annotation", m: {} });
    defLib("java.lang.Deprecated", { kind: "annotation", m: {} });
    defLib("java.lang.SuppressWarnings", { kind: "annotation", m: {} });
    defLib("java.lang.SafeVarargs", { kind: "annotation", m: {} });
    defLib("java.lang.Void", { flags: "public final", noCtor: true, m: {} });
    defLib("java.lang.Record", { flags: "public abstract", m: { "<init>()": function () {} } });

    // ---------- String ----------
    defLib("java.lang.String", { flags: "public final", impl: ["CharSequence", "Comparable<String>", "java.io.Serializable"], m: {
      "<init>()": null, "<init>(String)": null, "<init>(char[])": null, "<init>(char[],int,int)": null, "<init>(StringBuilder)": null,
      "int length()": function () { return S(this).length; },
      "char charAt(int)": function (i) { var s = S(this); if (i < 0 || i >= s.length) throwJ("java.lang.StringIndexOutOfBoundsException", "Index " + i + " out of bounds for length " + s.length, PRECOND.concat(["java.base/jdk.internal.util.Preconditions.outOfBoundsCheckIndex(Preconditions.java:106)", "java.base/jdk.internal.util.Preconditions.checkIndex(Preconditions.java:302)", "java.base/java.lang.String.checkIndex(String.java:4904)", "java.base/java.lang.StringLatin1.charAt(StringLatin1.java:45)", "java.base/java.lang.String.charAt(String.java:1624)"])); return s.charCodeAt(i); },
      "boolean isEmpty()": function () { return S(this).length === 0; },
      "boolean isBlank()": function () { return jstrip(S(this)).length === 0; },
      "String substring(int)": function (b) { var s = S(this); if (b < 0 || b > s.length) subRangeFail(b, s.length, s.length, true); return b === 0 ? this : jstr(s.slice(b)); },
      "String substring(int,int)": function (b, e) { var s = S(this); if (b < 0 || e > s.length || b > e) subRangeFail(b, e, s.length); return (b === 0 && e === s.length) ? this : jstr(s.slice(b, e)); },
      "CharSequence subSequence(int,int)": function (b, e) { var s = S(this); if (b < 0 || e > s.length || b > e) subRangeFail(b, e, s.length); return jstr(s.slice(b, e)); },
      "int indexOf(String)": function (x) { return S(this).indexOf(strArg(x)); },
      "int indexOf(int)": function (c) { return S(this).indexOf(String.fromCodePoint(c)); },
      "int indexOf(String,int)": function (x, f) { return S(this).indexOf(strArg(x), Math.max(0, f)); },
      "int indexOf(int,int)": function (c, f) { return S(this).indexOf(String.fromCodePoint(c), Math.max(0, f)); },
      "int lastIndexOf(String)": function (x) { return S(this).lastIndexOf(strArg(x)); },
      "int lastIndexOf(int)": function (c) { return S(this).lastIndexOf(String.fromCodePoint(c)); },
      "int lastIndexOf(String,int)": function (x, f) { return f < 0 ? -1 : S(this).lastIndexOf(strArg(x), f); },
      "int lastIndexOf(int,int)": function (c, f) { return f < 0 ? -1 : S(this).lastIndexOf(String.fromCodePoint(c), f); },
      "boolean contains(CharSequence)": function (x) { return S(this).indexOf(toStr(x === null ? npe() : x)) >= 0; },
      "boolean startsWith(String)": function (x) { return S(this).startsWith(strArg(x)); },
      "boolean startsWith(String,int)": function (x, o) { return S(this).startsWith(strArg(x), o); },
      "boolean endsWith(String)": function (x) { return S(this).endsWith(strArg(x)); },
      "boolean equals(Object)": function (o) { return o !== null && isStr(o) && S(o) === S(this); },
      "boolean equalsIgnoreCase(String)": function (o) { return o !== null && S(o).length === S(this).length && S(o).toUpperCase().toLowerCase() === S(this).toUpperCase().toLowerCase(); },
      "int compareTo(String)": function (o) { if (o === null) npe(); return compareStrings(S(this), S(o)); },
      "int compareToIgnoreCase(String)": function (o) { return compareStrings(S(this).toUpperCase().toLowerCase(), S(o).toUpperCase().toLowerCase()); },
      "int hashCode()": function () { return stringHash(this); },
      "String toString()": function () { return this; },
      "String toUpperCase()": function () { var s = S(this), u = s.toUpperCase(); return u === s ? this : jstr(u); },
      "String toLowerCase()": function () { var s = S(this), u = s.toLowerCase(); return u === s ? this : jstr(u); },
      "String toUpperCase(java.util.Locale)": function () { var s = S(this), u = s.toUpperCase(); return u === s ? this : jstr(u); },
      "String toLowerCase(java.util.Locale)": function () { var s = S(this), u = s.toLowerCase(); return u === s ? this : jstr(u); },
      "String trim()": function () { var s = S(this), t = jtrim(s); return t === s ? this : jstr(t); },
      "String strip()": function () { var s = S(this), t = jstrip(s); return t === s ? this : jstr(t); },
      "String stripLeading()": function () { var s = S(this), a = 0; while (a < s.length && isWs(s.charCodeAt(a))) a++; return a ? jstr(s.slice(a)) : this; },
      "String stripTrailing()": function () { var s = S(this), b = s.length; while (b > 0 && isWs(s.charCodeAt(b - 1))) b--; return b < s.length ? jstr(s.slice(0, b)) : this; },
      "String replace(char,char)": function (a, b) { var s = S(this), r = s.split(String.fromCharCode(a)).join(String.fromCharCode(b)); return r === s ? this : jstr(r); },
      "String replace(CharSequence,CharSequence)": function (a, b) { var s = S(this); var r = s.split(toStr(a)).join(toStr(b)); return jstr(r); },
      "String replaceAll(String,String)": function (rx, rep) { return jstr(jreplaceAll(S(this), rx, rep, false)); },
      "String replaceFirst(String,String)": function (rx, rep) { return jstr(jreplaceAll(S(this), rx, rep, true)); },
      "boolean matches(String)": function (rx) { var re = javaRegex("^(?:" + S(rx) + ")$"); return re.test(S(this)); },
      "String[] split(String)": function (rx) { return strArray(jsplit(S(this), S(rx), 0)); },
      "String[] split(String,int)": function (rx, n) { return strArray(jsplit(S(this), S(rx), n)); },
      "char[] toCharArray()": function () { var s = S(this), a = newArray(T["char"], s.length); for (var i = 0; i < s.length; i++) a.a[i] = s.charCodeAt(i); return a; },
      "String concat(String)": function (o) { var x = strArg(o); return x.length ? jstr(S(this) + x) : this; },
      "String repeat(int)": function (n) { if (n < 0) throwJ("java.lang.IllegalArgumentException", "count is negative: " + n, ["java.base/java.lang.String.repeat(String.java:4733)"]); return jstr(repeat(S(this), n)); },
      "String intern()": function () { return S(this); },
      "IntStream chars()": function () { var s = S(this), r = []; for (var i = 0; i < s.length; i++) r.push(s.charCodeAt(i)); return JavaSim.mkIntStream ? JavaSim.mkIntStream(r) : null; },
      "java.util.stream.Stream<String> lines()": function () { var parts = S(this).split(/\r?\n/); if (parts[parts.length - 1] === "") parts.pop(); return JavaSim.mkStream(parts.map(jstr)); },
      "String indent(int)": function (n) { var lines = S(this).split(/\n/); if (lines[lines.length - 1] === "") lines.pop(); return jstr(lines.map(function (l) { return n >= 0 ? repeat(" ", n) + l : l.replace(new RegExp("^ {0," + (-n) + "}"), ""); }).join("\n") + "\n"); },
      "String formatted(Object...)": function (a) { return jstr(jformatAt(this, a.a, null, "formatted")); },
      "int codePointAt(int)": function (i) { return S(this).codePointAt(i); },
      "boolean contentEquals(CharSequence)": function (c) { return S(this) === toStr(c); },
      "static String valueOf(Object)": function (o) { return o === null ? "null" : jstr(toStr(o)); },
      "static String valueOf(int)": function (v) { return jstr(String(v)); },
      "static String valueOf(long)": function (v) { return jstr(v.toString()); },
      "static String valueOf(double)": function (v) { return jstr(doubleToString(v)); },
      "static String valueOf(float)": function (v) { return jstr(floatToString(v)); },
      "static String valueOf(boolean)": function (v) { return jstr(String(v)); },
      "static String valueOf(char)": function (v) { return jstr(String.fromCharCode(v)); },
      "static String valueOf(char[])": function (a) { return jstr(String.fromCharCode.apply(null, Array.from(a.a))); },
      "static String valueOf(char[],int,int)": function (a, o, n) { return jstr(String.fromCharCode.apply(null, Array.from(a.a).slice(o, o + n))); },
      "static String copyValueOf(char[],int,int)": function (a, o, n) { return jstr(String.fromCharCode.apply(null, Array.from(a.a).slice(o, o + n))); },
      "static String copyValueOf(char[])": function (a) { return jstr(String.fromCharCode.apply(null, Array.from(a.a))); },
      "static String format(String,Object...)": function (f, a) { return jstr(jformatAt(f, a.a, null, "string")); },
      "static String format(java.util.Locale,String,Object...)": function (l, f, a) { return jstr(jformatAt(f, a.a, l && l.loc, "string")); },
      "static String join(CharSequence,CharSequence...)": function (d, a) { return jstr(a.a.map(toStr).join(toStr(d))); },
      "static String join(CharSequence,Iterable<? extends CharSequence>)": function (d, it) { var r = [], i = jcall(it, "iterator", []); while (jcall(i, "hasNext", [])) r.push(toStr(jcall(i, "next", []))); return jstr(r.join(toStr(d))); },
      "static final java.util.Comparator<String> CASE_INSENSITIVE_ORDER": function () { return JavaSim.caseInsensitive(); }
    } });
    LIB["java.lang.String"].lib.spec.after = function (STRS) {
      STRS.ctors.forEach(function (c) {
        c.newString = true;
        if (c.key === "<init>()") c.make = function () { return jstr(""); };
        else if (c.key === "<init>(java.lang.String)") c.make = function (s) { if (s === null) npe(); return jstr(S(s)); };
        else if (c.key === "<init>(char[])") c.make = function (a) { return jstr(String.fromCharCode.apply(null, Array.from(a.a))); };
        else if (c.key === "<init>(char[],int,int)") c.make = function (a, o, n) { return jstr(String.fromCharCode.apply(null, Array.from(a.a.slice(o, o + n)))); };
        else c.make = function (sb) { return jstr(sb.s); };
      });
    };
    // ---------- StringBuilder ----------
    function sbIdx(sb, i) { if (i < 0 || i > sb.s.length) throwJ("java.lang.StringIndexOutOfBoundsException", "offset " + i + ", length " + sb.s.length); }
  var SB = {
      "<init>()": function () { this.s = ""; },
      "<init>(int)": function () { this.s = ""; },
      "<init>(String)": function (s) { if (s === null) npe(); this.s = S(s); },
      "<init>(CharSequence)": function (s) { this.s = toStr(s); },
      "StringBuilder append(String)": function (x) { this.s += x === null ? "null" : S(x); return this; },
      "StringBuilder append(Object)": function (x) { this.s += toStr(x); return this; },
      "StringBuilder append(CharSequence)": function (x) { this.s += toStr(x); return this; },
      "StringBuilder append(int)": function (x) { this.s += String(x); return this; },
      "StringBuilder append(long)": function (x) { this.s += x.toString(); return this; },
      "StringBuilder append(double)": function (x) { this.s += doubleToString(x); return this; },
      "StringBuilder append(float)": function (x) { this.s += floatToString(x); return this; },
      "StringBuilder append(boolean)": function (x) { this.s += String(x); return this; },
      "StringBuilder append(char)": function (x) { this.s += String.fromCharCode(x); return this; },
      "StringBuilder append(char[])": function (a) { this.s += String.fromCharCode.apply(null, Array.from(a.a)); return this; },
      "StringBuilder insert(int,String)": function (i, x) { sbIdx(this, i); this.s = this.s.slice(0, i) + (x === null ? "null" : S(x)) + this.s.slice(i); return this; },
      "StringBuilder insert(int,char)": function (i, x) { sbIdx(this, i); this.s = this.s.slice(0, i) + String.fromCharCode(x) + this.s.slice(i); return this; },
      "StringBuilder insert(int,int)": function (i, x) { sbIdx(this, i); this.s = this.s.slice(0, i) + String(x) + this.s.slice(i); return this; },
      "StringBuilder insert(int,Object)": function (i, x) { sbIdx(this, i); this.s = this.s.slice(0, i) + toStr(x) + this.s.slice(i); return this; },
      "StringBuilder reverse()": function () { this.s = Array.from(this.s).reverse().join(""); return this; },
      "StringBuilder delete(int,int)": function (a, b) { if (a < 0 || a > this.s.length || a > b) throwJ("java.lang.StringIndexOutOfBoundsException", "start " + a + ", end " + b + ", length " + this.s.length); this.s = this.s.slice(0, a) + this.s.slice(Math.min(b, this.s.length)); return this; },
      "StringBuilder deleteCharAt(int)": function (i) { if (i < 0 || i >= this.s.length) throwJ("java.lang.StringIndexOutOfBoundsException", "index " + i + ",length " + this.s.length); this.s = this.s.slice(0, i) + this.s.slice(i + 1); return this; },
      "StringBuilder replace(int,int,String)": function (a, b, x) { this.s = this.s.slice(0, a) + S(x) + this.s.slice(Math.min(b, this.s.length)); return this; },
      "void setCharAt(int,char)": function (i, c) { if (i < 0 || i >= this.s.length) throwJ("java.lang.StringIndexOutOfBoundsException", "index " + i + ",length " + this.s.length); this.s = this.s.slice(0, i) + String.fromCharCode(c) + this.s.slice(i + 1); },
      "void setLength(int)": function (n) { this.s = n <= this.s.length ? this.s.slice(0, n) : this.s + repeat("\u0000", n - this.s.length); },
      "int length()": function () { return this.s.length; },
      "int capacity()": function () { return Math.max(16, this.s.length); },
      "char charAt(int)": function (i) { if (i < 0 || i >= this.s.length) throwJ("java.lang.StringIndexOutOfBoundsException", "index " + i + ",length " + this.s.length); return this.s.charCodeAt(i); },
      "int indexOf(String)": function (x) { return this.s.indexOf(S(x)); },
      "int lastIndexOf(String)": function (x) { return this.s.lastIndexOf(S(x)); },
      "String substring(int)": function (a) { return jstr(this.s.slice(a)); },
      "String substring(int,int)": function (a, b) { if (a < 0 || b > this.s.length || a > b) subRangeFail(a, b, this.s.length); return jstr(this.s.slice(a, b)); },
      "CharSequence subSequence(int,int)": function (a, b) { return jstr(this.s.slice(a, b)); },
      "boolean isEmpty()": function () { return this.s.length === 0; },
      "int compareTo(StringBuilder)": function (o) { return compareStrings(this.s, o.s); },
      "String toString()": function () { return jstr(this.s); }
    };
    defLib("java.lang.StringBuilder", { flags: "public final", impl: ["CharSequence", "Comparable<StringBuilder>"], m: SB });
    var SB2 = {};
    Object.keys(SB).forEach(function (k) { SB2[k.replace(/StringBuilder/g, "StringBuffer")] = SB[k]; });
    defLib("java.lang.StringBuffer", { flags: "public final", impl: ["CharSequence", "Comparable<StringBuffer>"], m: SB2 });
    var sbProto = function (o) { };

    // ---------- Math ----------
    function iabs(x) { return x < 0 ? (-x) | 0 : x; }
    defLib("java.lang.Math", { flags: "public final", noCtor: true, m: {
      "static final double PI": { c: Math.PI }, "static final double E": { c: Math.E },
      "static int abs(int)": iabs, "static long abs(long)": function (x) { return x < 0n ? BigInt.asIntN(64, -x) : x; },
      "static double abs(double)": Math.abs, "static float abs(float)": Math.abs,
      "static int max(int,int)": Math.max, "static long max(long,long)": function (a, b) { return a > b ? a : b; },
      "static double max(double,double)": function (a, b) { return a !== a || b !== b ? NaN : Math.max(a, b); }, "static float max(float,float)": Math.max,
      "static int min(int,int)": Math.min, "static long min(long,long)": function (a, b) { return a < b ? a : b; },
      "static double min(double,double)": function (a, b) { return a !== a || b !== b ? NaN : Math.min(a, b); }, "static float min(float,float)": Math.min,
      "static double sqrt(double)": Math.sqrt, "static double cbrt(double)": Math.cbrt,
      "static double pow(double,double)": function (a, b) { if (b !== b) return NaN; if (b === 0) return 1; return Math.pow(a, b); },
      "static double exp(double)": Math.exp, "static double log(double)": Math.log, "static double log10(double)": Math.log10,
      "static double sin(double)": Math.sin, "static double cos(double)": Math.cos, "static double tan(double)": Math.tan,
      "static double asin(double)": Math.asin, "static double acos(double)": Math.acos, "static double atan(double)": Math.atan, "static double atan2(double,double)": Math.atan2,
      "static double sinh(double)": Math.sinh, "static double cosh(double)": Math.cosh, "static double tanh(double)": Math.tanh,
      "static double hypot(double,double)": Math.hypot,
      "static double ceil(double)": Math.ceil, "static double floor(double)": Math.floor,
      "static double rint(double)": function (x) { var r = Math.round(x); if (Math.abs(x % 1) === 0.5) r = 2 * Math.round(x / 2); return r; },
      "static long round(double)": function (x) { if (x !== x) return 0n; return d2l(Math.round(x)); },
      "static int round(float)": function (x) { if (x !== x) return 0; return toInt32(Math.round(x)); },
      "static double random()": function () { return RT.mathRandom.nextDouble(); },
      "static double signum(double)": function (x) { return x > 0 ? 1 : x < 0 ? -1 : x; },
      "static double toRadians(double)": function (x) { return x / 180 * Math.PI; },
      "static double toDegrees(double)": function (x) { return x * 180 / Math.PI; },
      "static int floorDiv(int,int)": function (a, b) { if (b === 0) throwJ("java.lang.ArithmeticException", "/ by zero"); return Math.floor(a / b) | 0; },
      "static long floorDiv(long,long)": function (a, b) { if (b === 0n) throwJ("java.lang.ArithmeticException", "/ by zero"); var q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n; return q; },
      "static int floorMod(int,int)": function (a, b) { if (b === 0) throwJ("java.lang.ArithmeticException", "/ by zero"); return ((a % b) + b) % b; },
      "static long floorMod(long,long)": function (a, b) { if (b === 0n) throwJ("java.lang.ArithmeticException", "/ by zero"); return ((a % b) + b) % b; },
      "static int addExact(int,int)": function (a, b) { var r = a + b; if (r > 2147483647 || r < -2147483648) throwJ("java.lang.ArithmeticException", "integer overflow", ["java.base/java.lang.Math.addExact(Math.java:915)"]); return r; },
      "static long addExact(long,long)": function (a, b) { var r = a + b; if (BigInt.asIntN(64, r) !== r) throwJ("java.lang.ArithmeticException", "long overflow"); return r; },
      "static int subtractExact(int,int)": function (a, b) { var r = a - b; if (r > 2147483647 || r < -2147483648) throwJ("java.lang.ArithmeticException", "integer overflow", ["java.base/java.lang.Math.subtractExact(Math.java:956)"]); return r; },
      "static int multiplyExact(int,int)": function (a, b) { var r = a * b; if (r > 2147483647 || r < -2147483648) throwJ("java.lang.ArithmeticException", "integer overflow", ["java.base/java.lang.Math.multiplyExact(Math.java:996)"]); return r; },
      "static long multiplyExact(long,long)": function (a, b) { var r = a * b; if (BigInt.asIntN(64, r) !== r) throwJ("java.lang.ArithmeticException", "long overflow"); return r; },
      "static int incrementExact(int)": function (a) { if (a === 2147483647) throwJ("java.lang.ArithmeticException", "integer overflow"); return a + 1; },
      "static int negateExact(int)": function (a) { if (a === -2147483648) throwJ("java.lang.ArithmeticException", "integer overflow"); return -a; },
      "static int toIntExact(long)": function (a) { if (a > 2147483647n || a < -2147483648n) throwJ("java.lang.ArithmeticException", "integer overflow", ["java.base/java.lang.Math.toIntExact(Math.java:1375)"]); return Number(a); },
      "static int absExact(int)": function (a) { if (a === -2147483648) throwJ("java.lang.ArithmeticException", "Overflow to represent absolute value of Integer.MIN_VALUE"); return iabs(a); },
      "static int clamp(long,int,int)": function (v, lo, hi) { if (lo > hi) throwJ("java.lang.IllegalArgumentException", lo + " > " + hi); v = Number(v); return Math.min(hi, Math.max(lo, v)); },
      "static long clamp(long,long,long)": function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
      "static double clamp(double,double,double)": function (v, lo, hi) { if (lo > hi) throwJ("java.lang.IllegalArgumentException", doubleToString(lo) + " > " + doubleToString(hi)); return Math.min(hi, Math.max(lo, v)); },
      "static float clamp(float,float,float)": function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); },
      "static double fma(double,double,double)": function (a, b, c) { return a * b + c; },
      "static double ulp(double)": function (x) { return Math.abs(x) * Number.EPSILON; },
      "static double log1p(double)": Math.log1p, "static double expm1(double)": Math.expm1
    } });

    // ---------- Number e wrappers ----------
    defLib("java.lang.Number", { flags: "public abstract", impl: ["java.io.Serializable"], m: {
      "<init>()": function () {},
      "abstract int intValue()": "abstract", "abstract long longValue()": "abstract", "abstract double doubleValue()": "abstract", "abstract float floatValue()": "abstract",
      "short shortValue()": function () { return (jcall(this, "intValue", []) << 16) >> 16; },
      "byte byteValue()": function () { return (jcall(this, "intValue", []) << 24) >> 24; }
    } });
    function numVal(b) { return typeof b.v === "bigint" ? Number(b.v) : b.v; }
    var NUM_INST = {
      "int intValue()": function () { return typeof this.v === "bigint" ? Number(BigInt.asIntN(32, this.v)) : toInt32(this.v); },
      "long longValue()": function () { return typeof this.v === "bigint" ? this.v : d2l(this.v); },
      "double doubleValue()": function () { return numVal(this); },
      "float floatValue()": function () { return Math.fround(numVal(this)); },
      "short shortValue()": function () { return (toInt32(numVal(this)) << 16) >> 16; },
      "byte byteValue()": function () { return (toInt32(numVal(this)) << 24) >> 24; },
      "String toString()": function () { return jstr(boxToString(this)); },
      "int hashCode()": function () { return boxHash(this); },
      "boolean equals(Object)": function (o) { return o instanceof JBox && o.$c === this.$c && (o.v === this.v || (o.v !== o.v && this.v !== this.v)); }
    };
    function wrap(name, prim, extra, flags) {
      var m = {};
      Object.keys(NUM_INST).forEach(function (k) { m[k] = NUM_INST[k]; });
      m["int compareTo(" + name + ")"] = function (o) { if (o === null) npe(); return jcompare(this, o); };
      Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
      var dep = Object.keys(m).filter(function (k) { return /^<init>/.test(k); });
      return defLib("java.lang." + name, { flags: "public final", ext: prim === "boolean" || prim === "char" ? null : "Number", impl: ["Comparable<" + name + ">", "java.io.Serializable"], m: m, noCtor: false, deprecated: dep });
    }
    function nfe(s, frames) { throwJ("java.lang.NumberFormatException", s === null ? "Cannot parse null string: null" : "For input string: \"" + S(s) + "\"" + (frames && frames.radix ? " under radix " + frames.radix : ""), frames && frames.f); }
    function parseIntJ(s, radix, isLong, viaValueOf) {
      var fis = "java.base/java.lang.NumberFormatException.forInputString(NumberFormatException.java:67)";
      var tail = isLong ? ["java.base/java.lang.Long.parseLong(Long.java:698)"] : viaValueOf ? ["java.base/java.lang.Integer.valueOf(Integer.java:912)"] : ["java.base/java.lang.Integer.parseInt(Integer.java:662)"];
      if (s === null) throwJ("java.lang.NumberFormatException", "Cannot parse null string", (isLong ? ["java.base/java.lang.Long.parseLong(Long.java:" + "577)"] : ["java.base/java.lang.Integer.parseInt(Integer.java:527)"]).concat(tail));
      var str = S(s);
      radix = radix || 10;
      var bad = [fis, isLong ? "java.base/java.lang.Long.parseLong(Long.java:594)" : "java.base/java.lang.Integer.parseInt(Integer.java:565)"].concat(tail);
      var msg = "For input string: \"" + str + "\"" + (radix !== 10 ? " under radix " + radix : "");
      if (str === "") throwJ("java.lang.NumberFormatException", msg, [fis, isLong ? "java.base/java.lang.Long.parseLong(Long.java:" + "571)" : "java.base/java.lang.Integer.parseInt(Integer.java:542)"].concat(tail));
      var re = radix === 10 ? /^[+-]?\d+$/ : radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : radix === 2 ? /^[+-]?[01]+$/ : radix === 8 ? /^[+-]?[0-7]+$/ : /^[+-]?[0-9a-zA-Z]+$/;
      if (!re.test(str)) throwJ("java.lang.NumberFormatException", msg, bad);
      var neg = str[0] === "-", body = str.replace(/^[+-]/, "");
      var v = 0n;
      for (var i = 0; i < body.length; i++) v = v * BigInt(radix) + BigInt(parseInt(body[i], 36));
      if (neg) v = -v;
      var lo = isLong ? -9223372036854775808n : -2147483648n, hi = isLong ? 9223372036854775807n : 2147483647n;
      if (v < lo || v > hi) throwJ("java.lang.NumberFormatException", msg, bad);
      return isLong ? v : Number(v);
    }
    function parseDoubleJ(s) {
      if (s === null) npe();
      var str = jtrim(S(s));
      if (/^[+-]?(NaN|Infinity)$/.test(str)) return str.indexOf("NaN") >= 0 ? NaN : (str[0] === "-" ? -Infinity : Infinity);
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/.test(str) && !/^[+-]?0[xX]/.test(str)) {
        throwJ("java.lang.NumberFormatException", str === "" ? "empty String" : "For input string: \"" + S(s) + "\"", str === "" ? ["java.base/jdk.internal.math.FloatingDecimal.readJavaFormatString(FloatingDecimal.java:1953)", "java.base/jdk.internal.math.FloatingDecimal.parseDouble(FloatingDecimal.java:110)", "java.base/java.lang.Double.parseDouble(Double.java:971)"] : ["java.base/jdk.internal.math.FloatingDecimal.check(FloatingDecimal.java:2324)", "java.base/jdk.internal.math.FloatingDecimal.readJavaFormatString(FloatingDecimal.java:1969)", "java.base/jdk.internal.math.FloatingDecimal.parseDouble(FloatingDecimal.java:110)", "java.base/java.lang.Double.parseDouble(Double.java:971)"]);
      }
      return parseFloat(str.replace(/[fFdD]$/, ""));
    }
    JavaSim.parseIntJ = parseIntJ; JavaSim.parseDoubleJ = parseDoubleJ;
    function radixStr(v, r) { return v.toString(r); }
    wrap("Integer", "int", {
      "<init>(int)": function (v) { this.v = v; }, "<init>(String)": function (s) { this.v = parseIntJ(s); },
      "static final int MAX_VALUE": { c: 2147483647 }, "static final int MIN_VALUE": { c: -2147483648 }, "static final int SIZE": { c: 32 }, "static final int BYTES": { c: 4 },
      "static int parseInt(String)": function (s) { return parseIntJ(s, 10); },
      "static int parseInt(String,int)": function (s, r) { return parseIntJ(s, r); },
      "static Integer valueOf(int)": function (v) { return box("int", v); },
      "static Integer valueOf(String)": function (s) { return box("int", parseIntJ(s, 10, false, true)); },
      "static Integer valueOf(String,int)": function (s, r) { return box("int", parseIntJ(s, r)); },
      "static String toString(int)": function (v) { return jstr(String(v)); },
      "static String toString(int,int)": function (v, r) { return jstr(v.toString(r)); },
      "static String toBinaryString(int)": function (v) { return jstr((v >>> 0).toString(2)); },
      "static String toHexString(int)": function (v) { return jstr((v >>> 0).toString(16)); },
      "static String toOctalString(int)": function (v) { return jstr((v >>> 0).toString(8)); },
      "static int compare(int,int)": function (a, b) { return a < b ? -1 : a > b ? 1 : 0; },
      "static int max(int,int)": Math.max, "static int min(int,int)": Math.min, "static int sum(int,int)": function (a, b) { return (a + b) | 0; },
      "static int signum(int)": function (v) { return v > 0 ? 1 : v < 0 ? -1 : 0; },
      "static int bitCount(int)": function (v) { var c = 0; v = v >>> 0; while (v) { c += v & 1; v >>>= 1; } return c; },
      "static int reverse(int)": function (v) { var r = 0; for (var i = 0; i < 32; i++) { r = (r << 1) | (v & 1); v >>>= 1; } return r | 0; },
      "static int hashCode(int)": function (v) { return v; },
      "static int parseUnsignedInt(String)": function (s) { return Number(BigInt(S(s))) | 0; },
      "static int highestOneBit(int)": function (v) { return v === 0 ? 0 : (1 << (31 - Math.clz32(v))) | 0; },
      "static int numberOfLeadingZeros(int)": Math.clz32,
      "static int numberOfTrailingZeros(int)": function (v) { if (v === 0) return 32; var n = 0; while (!(v & 1)) { v >>>= 1; n++; } return n; }
    });
    wrap("Long", "long", {
      "<init>(long)": function (v) { this.v = v; },
      "static final long MAX_VALUE": { c: 9223372036854775807n }, "static final long MIN_VALUE": { c: -9223372036854775808n },
      "static long parseLong(String)": function (s) { return parseIntJ(s, 10, true); },
      "static long parseLong(String,int)": function (s, r) { return parseIntJ(s, r, true); },
      "static Long valueOf(long)": function (v) { return box("long", v); },
      "static Long valueOf(String)": function (s) { return box("long", parseIntJ(s, 10, true)); },
      "static String toString(long)": function (v) { return jstr(v.toString()); },
      "static String toBinaryString(long)": function (v) { return jstr(BigInt.asUintN(64, v).toString(2)); },
      "static String toHexString(long)": function (v) { return jstr(BigInt.asUintN(64, v).toString(16)); },
      "static int compare(long,long)": function (a, b) { return a < b ? -1 : a > b ? 1 : 0; },
      "static long max(long,long)": function (a, b) { return a > b ? a : b; }, "static long min(long,long)": function (a, b) { return a < b ? a : b; },
      "static long sum(long,long)": function (a, b) { return BigInt.asIntN(64, a + b); },
      "static int hashCode(long)": function (v) { return Number(BigInt.asIntN(32, v ^ (v >> 32n))); },
      "static int signum(long)": function (v) { return v > 0n ? 1 : v < 0n ? -1 : 0; },
      "static int bitCount(long)": function (v) { var c = 0, u = BigInt.asUintN(64, v); while (u) { c += Number(u & 1n); u >>= 1n; } return c; }
    });
    wrap("Double", "double", {
      "<init>(double)": function (v) { this.v = v; },
      "static final double MAX_VALUE": { c: Number.MAX_VALUE }, "static final double MIN_VALUE": { c: 5e-324 },
      "static final double POSITIVE_INFINITY": { c: Infinity }, "static final double NEGATIVE_INFINITY": { c: -Infinity }, "static final double NaN": { c: NaN },
      "static double parseDouble(String)": parseDoubleJ,
      "static Double valueOf(double)": function (v) { return box("double", v); },
      "static Double valueOf(String)": function (s) { return box("double", parseDoubleJ(s)); },
      "static String toString(double)": function (v) { return jstr(doubleToString(v)); },
      "static int compare(double,double)": doubleCompare,
      "static boolean isNaN(double)": function (v) { return v !== v; },
      "static boolean isInfinite(double)": function (v) { return v === Infinity || v === -Infinity; },
      "static boolean isFinite(double)": function (v) { return isFinite(v); },
      "boolean isNaN()": function () { return this.v !== this.v; },
      "boolean isInfinite()": function () { return this.v === Infinity || this.v === -Infinity; },
      "static double max(double,double)": Math.max, "static double min(double,double)": Math.min, "static double sum(double,double)": function (a, b) { return a + b; },
      "static int hashCode(double)": doubleHash,
      "static long doubleToLongBits(double)": function (d) { var b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, d); return b.getBigInt64(0); }
    });
    wrap("Float", "float", {
      "<init>(float)": function (v) { this.v = v; },
      "static final float MAX_VALUE": { c: 3.4028234663852886e38 }, "static final float MIN_VALUE": { c: 1.401298464324817e-45 },
      "static final float POSITIVE_INFINITY": { c: Infinity }, "static final float NEGATIVE_INFINITY": { c: -Infinity }, "static final float NaN": { c: NaN },
      "static float parseFloat(String)": function (s) { return Math.fround(parseDoubleJ(s)); },
      "static Float valueOf(float)": function (v) { return box("float", v); },
      "static Float valueOf(String)": function (s) { return box("float", Math.fround(parseDoubleJ(s))); },
      "static String toString(float)": function (v) { return jstr(floatToString(v)); },
      "static int compare(float,float)": doubleCompare,
      "static boolean isNaN(float)": function (v) { return v !== v; },
      "static float max(float,float)": Math.max, "static float min(float,float)": Math.min, "static float sum(float,float)": function (a, b) { return Math.fround(a + b); }
    });
    wrap("Short", "short", {
      "static final short MAX_VALUE": { c: 32767 }, "static final short MIN_VALUE": { c: -32768 },
      "static short parseShort(String)": function (s) { var v = parseIntJ(s, 10); if (v < -32768 || v > 32767) throwJ("java.lang.NumberFormatException", "Value out of range. Value:\"" + S(s) + "\" Radix:10"); return v; },
      "static Short valueOf(short)": function (v) { return box("short", v); },
      "static String toString(short)": function (v) { return jstr(String(v)); },
      "static int compare(short,short)": function (a, b) { return a - b; }
    });
    wrap("Byte", "byte", {
      "static final byte MAX_VALUE": { c: 127 }, "static final byte MIN_VALUE": { c: -128 },
      "static byte parseByte(String)": function (s) { var v = parseIntJ(s, 10); if (v < -128 || v > 127) throwJ("java.lang.NumberFormatException", "Value out of range. Value:\"" + S(s) + "\" Radix:10"); return v; },
      "static Byte valueOf(byte)": function (v) { return box("byte", v); },
      "static String toString(byte)": function (v) { return jstr(String(v)); },
      "static int compare(byte,byte)": function (a, b) { return a - b; }
    });
    var CH = {
      "<init>(char)": function (v) { this.v = v; },
      "static final char MAX_VALUE": { c: 65535 }, "static final char MIN_VALUE": { c: 0 },
      "char charValue()": function () { return this.v; },
      "String toString()": function () { return jstr(String.fromCharCode(this.v)); },
      "int hashCode()": function () { return this.v; },
      "boolean equals(Object)": function (o) { return o instanceof JBox && o.$c === this.$c && o.v === this.v; },
      "static Character valueOf(char)": function (v) { return box("char", v); },
      "static String toString(char)": function (v) { return jstr(String.fromCharCode(v)); },
      "static String toString(int)": function (v) { return jstr(String.fromCodePoint(v)); },
      "static int compare(char,char)": function (a, b) { return a - b; },
      "static int getNumericValue(char)": function (c) { var ch = String.fromCharCode(c); if (/[0-9]/.test(ch)) return c - 48; if (/[a-z]/i.test(ch)) return ch.toLowerCase().charCodeAt(0) - 87; return -1; },
      "static int digit(char,int)": function (c, r) { var v = parseInt(String.fromCharCode(c), r); return isNaN(v) ? -1 : v; },
      "static char forDigit(int,int)": function (d, r) { return d >= 0 && d < r ? d.toString(r).charCodeAt(0) : 0; },
      "static int hashCode(char)": function (c) { return c; },
      "static char[] toChars(int)": function (cp) { var s = String.fromCodePoint(cp), a = newArray(T["char"], s.length); for (var i = 0; i < s.length; i++) a.a[i] = s.charCodeAt(i); return a; }
    };
    [["isLetter", function (c) { return /\p{L}/u.test(String.fromCodePoint(c)); }], ["isDigit", function (c) { return /\p{Nd}/u.test(String.fromCodePoint(c)); }],
     ["isLetterOrDigit", function (c) { return /[\p{L}\p{Nd}]/u.test(String.fromCodePoint(c)); }], ["isAlphabetic", function (c) { return /\p{Alphabetic}/u.test(String.fromCodePoint(c)); }],
     ["isUpperCase", function (c) { return /\p{Lu}/u.test(String.fromCodePoint(c)); }], ["isLowerCase", function (c) { return /\p{Ll}/u.test(String.fromCodePoint(c)); }],
     ["isWhitespace", function (c) { return isWs(c) && c !== 0xa0; }], ["isSpaceChar", function (c) { return /[\p{Zs}\u2028\u2029]/u.test(String.fromCodePoint(c)); }]].forEach(function (p) {
      CH["static boolean " + p[0] + "(char)"] = p[1]; CH["static boolean " + p[0] + "(int)"] = p[1];
    });
    CH["static char toUpperCase(char)"] = function (c) { var u = String.fromCharCode(c).toUpperCase(); return u.length === 1 ? u.charCodeAt(0) : c; };
    CH["static char toLowerCase(char)"] = function (c) { var u = String.fromCharCode(c).toLowerCase(); return u.length === 1 ? u.charCodeAt(0) : c; };
    CH["static int toUpperCase(int)"] = function (c) { var u = String.fromCodePoint(c).toUpperCase(); return u.codePointAt(0); };
    CH["static int toLowerCase(int)"] = function (c) { var u = String.fromCodePoint(c).toLowerCase(); return u.codePointAt(0); };
    CH["int compareTo(Character)"] = function (o) { return this.v - o.v; };
    defLib("java.lang.Character", { flags: "public final", impl: ["Comparable<Character>", "java.io.Serializable"], m: CH, deprecated: ["<init>(char)"] });
    defLib("java.lang.Boolean", { flags: "public final", impl: ["Comparable<Boolean>", "java.io.Serializable"], deprecated: ["<init>(boolean)"], m: {
      "<init>(boolean)": function (v) { this.v = v; },
      "static final Boolean TRUE": function () { return RT.TRUE; }, "static final Boolean FALSE": function () { return RT.FALSE; },
      "boolean booleanValue()": function () { return this.v; },
      "String toString()": function () { return jstr(String(this.v)); },
      "int hashCode()": function () { return this.v ? 1231 : 1237; },
      "boolean equals(Object)": function (o) { return o instanceof JBox && o.$c === this.$c && o.v === this.v; },
      "int compareTo(Boolean)": function (o) { return this.v === o.v ? 0 : this.v ? 1 : -1; },
      "static boolean parseBoolean(String)": function (s) { return s !== null && S(s).toLowerCase() === "true"; },
      "static Boolean valueOf(boolean)": function (v) { return box("boolean", v); },
      "static Boolean valueOf(String)": function (s) { return box("boolean", s !== null && S(s).toLowerCase() === "true"); },
      "static String toString(boolean)": function (v) { return jstr(String(v)); },
      "static int compare(boolean,boolean)": function (a, b) { return a === b ? 0 : a ? 1 : -1; },
      "static boolean logicalAnd(boolean,boolean)": function (a, b) { return a && b; },
      "static boolean logicalOr(boolean,boolean)": function (a, b) { return a || b; },
      "static boolean logicalXor(boolean,boolean)": function (a, b) { return a !== b; }
    } });
    ["Integer", "Long", "Double", "Float", "Short", "Byte", "Character", "Boolean"].forEach(function (n) { L("java.lang." + n).isBox = true; });

    // ---------- Throwable e exceções ----------
    defLib("java.lang.Throwable", { impl: ["java.io.Serializable"], m: {
      "<init>()": function () { this.message = null; this.cause = null; this.suppressed = []; fillStack(this); },
      "<init>(String)": function (s) { this.message = s; this.cause = null; this.suppressed = []; fillStack(this); },
      "<init>(String,Throwable)": function (s, c) { this.message = s; this.cause = c; this.suppressed = []; fillStack(this); },
      "<init>(Throwable)": function (c) { this.message = c === null ? null : jstr(toStr(c)); this.cause = c; this.suppressed = []; fillStack(this); },
      "String getMessage()": function () { return this.message === undefined ? null : this.message; },
      "String getLocalizedMessage()": function () { return jcall(this, "getMessage", []); },
      "Throwable getCause()": function () { return this.cause || null; },
      "Throwable initCause(Throwable)": function (c) { this.cause = c; return this; },
      "String toString()": function () { var m = jcall(this, "getLocalizedMessage", []); var n = classOf(this).bin; return jstr(m !== null ? n + ": " + S(m) : n); },
      "void printStackTrace()": function () { RT.write("err", stackTraceText(this)); },
      "StackTraceElement[] getStackTrace()": function () { var arr = newArray(L("java.lang.StackTraceElement").rawType(), (this.stack || []).length); (this.stack || []).forEach(function (s, i) { arr.a[i] = { $c: L("java.lang.StackTraceElement"), s: s }; }); return arr; },
      "void addSuppressed(Throwable)": function (t) { this.suppressed.push(t); },
      "Throwable[] getSuppressed()": function () { var arr = newArray(L("java.lang.Throwable").rawType(), this.suppressed.length); this.suppressed.forEach(function (s, i) { arr.a[i] = s; }); return arr; },
      "Throwable fillInStackTrace()": function () { fillStack(this); return this; }
    } });
    defLib("java.lang.StackTraceElement", { flags: "public final", noCtor: true, m: {
      "String getMethodName()": function () { return jstr(/\.([^.(]+)\(/.exec(this.s)[1]); },
      "String getClassName()": function () { return jstr(this.s.replace(/^.*\//, "").replace(/\.[^.(]+\(.*$/, "")); },
      "int getLineNumber()": function () { var m = /:(\d+)\)$/.exec(this.s); return m ? parseInt(m[1], 10) : -1; },
      "String getFileName()": function () { var m = /\(([^:)]+)/.exec(this.s); return m ? jstr(m[1]) : null; },
      "String toString()": function () { return jstr(this.s); }
    } });
    defExc("java.lang.Exception", "Throwable");
    defExc("java.lang.Error", "Throwable");
    defExc("java.lang.RuntimeException", "Exception");
    [["ArithmeticException", "RuntimeException"], ["NullPointerException", "RuntimeException"], ["ClassCastException", "RuntimeException"],
     ["IllegalArgumentException", "RuntimeException"], ["IllegalStateException", "RuntimeException"], ["IndexOutOfBoundsException", "RuntimeException"],
     ["ArrayIndexOutOfBoundsException", "IndexOutOfBoundsException"], ["StringIndexOutOfBoundsException", "IndexOutOfBoundsException"],
     ["NumberFormatException", "IllegalArgumentException"], ["UnsupportedOperationException", "RuntimeException"], ["NegativeArraySizeException", "RuntimeException"],
     ["ArrayStoreException", "RuntimeException"], ["CloneNotSupportedException", "Exception"], ["InterruptedException", "Exception"],
     ["ReflectiveOperationException", "Exception"], ["ClassNotFoundException", "ReflectiveOperationException"], ["SecurityException", "RuntimeException"],
     ["StackOverflowError", "VirtualMachineError"], ["OutOfMemoryError", "VirtualMachineError"], ["AssertionError", "Error"],
     ["ExceptionInInitializerError", "LinkageError"], ["IncompatibleClassChangeError", "LinkageError"], ["MatchException", "RuntimeException"]].forEach(function (p) {
      if (p[1] === "VirtualMachineError" && !LIB["java.lang.VirtualMachineError"]) defExc("java.lang.VirtualMachineError", "Error");
      if (p[1] === "LinkageError" && !LIB["java.lang.LinkageError"]) defExc("java.lang.LinkageError", "Error");
      defExc("java.lang." + p[0], p[1]);
    });
    LIB["java.lang.NullPointerException"].lib.spec.m["<init>()"] = function () { this.message = null; this.cause = null; this.suppressed = []; fillStack(this); };
    defExc("java.io.IOException", "Exception");
    defExc("java.io.FileNotFoundException", "IOException");
    defExc("java.io.UncheckedIOException", "RuntimeException");
    defExc("java.io.EOFException", "IOException");
    defExc("java.util.NoSuchElementException", "RuntimeException");
    defExc("java.util.InputMismatchException", "NoSuchElementException");
    defExc("java.util.ConcurrentModificationException", "RuntimeException");
    defExc("java.util.IllegalFormatException", "IllegalArgumentException");
    defExc("java.util.IllegalFormatConversionException", "IllegalFormatException");
    defExc("java.util.MissingFormatArgumentException", "IllegalFormatException");
    defExc("java.util.UnknownFormatConversionException", "IllegalFormatException");
    defExc("java.util.EmptyStackException", "RuntimeException");
    defExc("java.util.concurrent.ExecutionException", "Exception");
    defExc("java.util.concurrent.TimeoutException", "Exception");
    defExc("java.time.DateTimeException", "RuntimeException");
    defExc("java.time.format.DateTimeParseException", "java.time.DateTimeException");
    defExc("java.util.regex.PatternSyntaxException", "IllegalArgumentException");
    defExc("java.nio.file.FileSystemException", "IOException");
    defExc("java.nio.file.NoSuchFileException", "FileSystemException");
    defExc("java.nio.file.FileAlreadyExistsException", "FileSystemException");
    defExc("java.nio.file.DirectoryNotEmptyException", "FileSystemException");

    // ---------- System, PrintStream, IO, Thread ----------
    var PS = {
      "void println()": function () { RT.write(this.err ? "err" : "out", "\n"); },
      "void flush()": function () {},
      "void close()": function () {},
      "PrintStream printf(String,Object...)": function (f, a) { var st = this.err ? "err" : "out"; jformatAt(f, a.a, null, "printf", function (t) { RT.write(st, t); }); return this; },
      "PrintStream printf(java.util.Locale,String,Object...)": function (l, f, a) { var st = this.err ? "err" : "out"; jformatAt(f, a.a, l && l.loc, "printf", function (t) { RT.write(st, t); }); return this; },
      "PrintStream format(String,Object...)": function (f, a) { var st = this.err ? "err" : "out"; jformatAt(f, a.a, null, "format", function (t) { RT.write(st, t); }); return this; },
      "void write(int)": function (b) { RT.write(this.err ? "err" : "out", String.fromCharCode(b & 255)); }
    };
    var printers = { "boolean": function (v) { return String(v); }, "char": function (v) { return String.fromCharCode(v); }, "int": function (v) { return String(v); },
      "long": function (v) { return v.toString(); }, "float": floatToString, "double": doubleToString,
      "char[]": function (a) { if (a === null) npe(); return String.fromCharCode.apply(null, Array.from(a.a)); },
      "String": function (s) { return s === null ? "null" : S(s); }, "Object": function (o) { return o === null ? "null" : toStr(o); } };
    Object.keys(printers).forEach(function (t) {
      var p = printers[t];
      PS["void print(" + t + ")"] = function (v) { RT.write(this.err ? "err" : "out", p(v)); };
      PS["void println(" + t + ")"] = function (v) { RT.write(this.err ? "err" : "out", p(v) + "\n"); };
    });
    defLib("java.io.OutputStream", { flags: "public abstract", impl: ["Closeable"], m: { "void write(int) throws IOException": "abstract", "void flush() throws IOException": function () {}, "void close() throws IOException": function () {} } });
    defLib("java.io.PrintStream", { ext: "java.io.OutputStream", m: PS });
    defLib("java.io.InputStream", { flags: "public abstract", impl: ["Closeable"], m: {
      "int read() throws IOException": function () { return RT.stdinReadByte(); },
      "void close() throws IOException": function () {},
      "int available() throws IOException": function () { return RT.stdinAvailable(); }
    } });
    defLib("java.lang.System", { flags: "public final", noCtor: true, m: {
      "static final PrintStream out": function () { return RT.sysout; },
      "static final PrintStream err": function () { return RT.syserr; },
      "static final InputStream in": function () { return RT.sysin; },
      "static void exit(int)": function (c) { throw new ExitSignal(c); },
      "static long currentTimeMillis()": function () { return BigInt(Math.floor(RT.clockMs())); },
      "static long nanoTime()": function () { return BigInt(Math.floor(RT.clockMs() * 1e6)) + BigInt(RT.steps); },
      "static void arraycopy(Object,int,Object,int,int)": function (src, sp, dst, dp, n) {
        if (src === null || dst === null) npe();
        if (sp < 0 || dp < 0 || n < 0 || sp + n > src.a.length || dp + n > dst.a.length) {
          var msg = sp + n > src.a.length ? "arraycopy: last source index " + (sp + n) + " out of bounds for " + arrTypeName(src) + "[" + src.a.length + "]" : "arraycopy: last destination index " + (dp + n) + " out of bounds for " + arrTypeName(dst) + "[" + dst.a.length + "]";
          if (n < 0) msg = "arraycopy: length " + n + " is negative";
          throwJ("java.lang.ArrayIndexOutOfBoundsException", msg, ["java.base/java.lang.System.arraycopy(Native Method)"]);
        }
        var tmp = Array.prototype.slice.call(src.a, sp, sp + n);
        for (var i = 0; i < n; i++) dst.a[dp + i] = tmp[i];
      },
      "static String lineSeparator()": function () { return "\n"; },
      "static String getProperty(String)": function (k) { var p = { "java.version": "25.0.4", "user.name": "ana", "user.home": "/home/ana", "os.name": "Linux", "user.dir": "/home/ana", "line.separator": "\n", "file.separator": "/", "java.vendor": "Eclipse Adoptium" }[S(k)]; return p === undefined ? null : p; },
      "static String getenv(String)": function (k) { var p = { "HOME": "/home/ana", "USER": "ana", "LANG": "pt_BR.UTF-8", "JAVA_HOME": "/opt/jdk-25" }[S(k)]; return p === undefined ? null : p; },
      "static int identityHashCode(Object)": function (o) { return o === null ? 0 : identityHash(o); },
      "static void gc()": function () {}
    } });
    function arrTypeName(a) { var e = a.$c.elemType; return e.k === "prim" ? e.n : "object array"; }
    defLib("java.lang.IO", { flags: "public final", noCtor: true, m: {
      "static void println(Object)": function (o) { RT.write("out", toStr(o) + "\n"); },
      "static void println()": function () { RT.write("out", "\n"); },
      "static void print(Object)": function (o) { RT.write("out", toStr(o)); },
      "static String readln()": function () { var l = RT.readLine(); return l === null ? null : jstr(l); },
      "static String readln(String)": function (p) { RT.write("out", toStr(p)); var l = RT.readLine(); return l === null ? null : jstr(l); }
    } });
    defLib("java.lang.Thread", { impl: ["Runnable"], m: {
      "<init>()": function () { this.task = null; this.name = "Thread-" + (RT.threadSeq++); },
      "<init>(Runnable)": function (r) { this.task = r; this.name = "Thread-" + (RT.threadSeq++); },
      "<init>(Runnable,String)": function (r, n) { this.task = r; this.name = S(n); },
      "<init>(String)": function (n) { this.task = null; this.name = S(n); },
      "static void sleep(long) throws InterruptedException": function (ms) { RT.clockAdvance(Number(ms)); },
      "static Thread currentThread()": function () { return RT.curThread || RT.mainThread; },
      "void start()": function () { runThread(this); },
      "void run()": function () { if (this.task) jcall(this.task, "run", []); },
      "void join() throws InterruptedException": function () {},
      "void join(long) throws InterruptedException": function () {},
      "String getName()": function () { return jstr(this.name); },
      "void setName(String)": function (n) { this.name = S(n); },
      "boolean isAlive()": function () { return false; },
      "void interrupt()": function () {},
      "boolean isInterrupted()": function () { return false; },
      "void setDaemon(boolean)": function () {},
      "long threadId()": function () { return BigInt(this.id || 1); },
      "boolean isVirtual()": function () { return !!this.virt; },
      "static Thread startVirtualThread(Runnable)": function (r) { var t = { $c: L("java.lang.Thread"), task: r, name: "", virt: true }; runThread(t); return t; },
      "static Thread.Builder ofVirtual()": function () { return { $c: L("java.lang.Thread.Builder"), virt: true }; },
      "static Thread.Builder ofPlatform()": function () { return { $c: L("java.lang.Thread.Builder"), virt: false }; },
      "String toString()": function () { return jstr(this.virt ? "VirtualThread[#" + (this.id || 21) + "]/runnable" : "Thread[#" + (this.id || 1) + "," + this.name + ",5,main]"); }
    } });
    defLib("java.lang.Thread.Builder", { kind: "interface", m: {
      "Thread start(Runnable)": function (r) { var t = { $c: L("java.lang.Thread"), task: r, name: this.virt ? "" : "Thread-" + (RT.threadSeq++), virt: this.virt }; runThread(t); return t; },
      "Thread unstarted(Runnable)": function (r) { return { $c: L("java.lang.Thread"), task: r, name: this.virt ? "" : "Thread-" + (RT.threadSeq++), virt: this.virt }; },
      "Thread.Builder name(String)": function (n) { this.nm = S(n); return this; }
    } });
    defLib("java.lang.Class", { tp: "T", flags: "public final", noCtor: true, m: {
      "String getName()": function () { return jstr(classObjName(this)); },
      "String getSimpleName()": function () { var t = this.t; if (t.k === "prim") return jstr(t.n); if (t.k === "array") return jstr(typeStr(t)); var s = this.sym || t.sym; if (s.anon || s.isLambda) return jstr(s.isLambda ? s.bin.replace(/^.*\./, "") : ""); return jstr(s.isLib ? s.bin.replace(/^.*[.$]/, "") : s.name); },
      "String toString()": function () { var t = this.t; return jstr((t.k === "prim" ? "" : (t.k === "class" && t.sym.isInterface() ? "interface " : "class ")) + classObjName(this)); },
      "boolean isInstance(Object)": function (o) { return instOf(o, this.t); },
      "Class<? super T> getSuperclass()": function () { var s = this.sym || this.t.sym; return s && s.superT ? classObject(s.superT) : null; },
      "boolean isInterface()": function () { var s = this.sym || this.t.sym; return !!(s && s.isInterface()); },
      "boolean isRecord()": function () { var s = this.sym || this.t.sym; return !!(s && s.isRecord && s.isRecord()); },
      "boolean isEnum()": function () { var s = this.sym || this.t.sym; return !!(s && s.isEnum && s.isEnum()); },
      "T cast(Object)": function (o) { if (o !== null && !instOf(o, this.t)) castFail(o, this.t); return o; },
      "int hashCode()": function () { return identityHash(this); }
    } });
    function classObjName(c) { var t = c.t; if (t.k === "prim") return t.n; if (t.k === "array") return "[" + binName(t.elem); return (c.sym || t.sym).bin; }
    defLib("java.lang.Enum", { tp: "E extends Enum<E>", flags: "public abstract", impl: ["Comparable<E>", "java.io.Serializable"], m: {
      "<init>()": function () {},
      "final String name()": function () { return this.$name; },
      "final int ordinal()": function () { return this.$ord; },
      "String toString()": function () { return this.$name; },
      "final int compareTo(E)": function (o) { return this.$ord - o.$ord; },
      "final boolean equals(Object)": function (o) { return this === o; },
      "final int hashCode()": function () { return identityHash(this); },
      "final Class<E> getDeclaringClass()": function () { var c = this.$c; if (!c.isEnum()) c = c.superT.sym; return classObject(c.rawType()); },
      "static <T extends Enum<T>> T valueOf(Class<T>,String)": function (c, n) { var sym = c.t.sym; return vcallStatic(sym, "valueOf", [n]); }
    } });
    // StrictMath = Math
    defLib("java.lang.StrictMath", { flags: "public final", noCtor: true, m: { "static double sqrt(double)": Math.sqrt, "static double pow(double,double)": Math.pow, "static double abs(double)": Math.abs } });
    defLib("java.lang.Runtime", { noCtor: true, m: {
      "static Runtime getRuntime()": function () { return { $c: L("java.lang.Runtime") }; },
      "int availableProcessors()": function () { return 4; },
      "long totalMemory()": function () { return 268435456n; }, "long freeMemory()": function () { return 201326592n; }, "long maxMemory()": function () { return 4127195136n; }
    } });
    defineUtilCore();
  }
  function vcallStatic(sym, name, args) { var m = (sym.methods[name] || [])[0]; return m.impl.apply(null, args); }
  // threads: rodam até o fim, na hora (determinístico)
  function runThread(t) {
    var prev = RT.curThread;
    RT.curThread = t;
    try { if (t.task) jcall(t.task, "run", []); else jcall(t, "run", []); }
    catch (e) {
      if (isInternal(e)) throw e;
      var ex = toJava(e);
      if (!ex) throw e;
      RT.write("err", "Exception in thread \"" + (t.name || "") + "\" " + stackTraceText(ex));
    }
    finally { RT.curThread = prev; }
  }
  // texto do printStackTrace (com "Caused by" e "... N more")
  function stackTraceText(ex) {
    var out = "";
    var seen = [];
    function frames(o) { return o.stack || []; }
    function one(o, prefix, caption, enclosing) {
      if (seen.indexOf(o) >= 0) { out += prefix + caption + "[CIRCULAR REFERENCE: " + toStr(o) + "]\n"; return; }
      seen.push(o);
      var fr = frames(o);
      var m = fr.length - 1, n = enclosing.length - 1;
      while (m >= 0 && n >= 0 && fr[m] === enclosing[n]) { m--; n--; }
      var inCommon = fr.length - 1 - m;
      out += prefix + caption + toStr(o) + "\n";
      for (var i = 0; i <= m; i++) out += prefix + "\tat " + fr[i] + "\n";
      if (inCommon) out += prefix + "\t... " + inCommon + " more\n";
      (o.suppressed || []).forEach(function (s) { one(s, prefix + "\t", "Suppressed: ", fr); });
      if (o.cause) one(o.cause, prefix, "Caused by: ", fr);
    }
    seen.push(ex);
    out += toStr(ex) + "\n";
    frames(ex).forEach(function (f) { out += "\tat " + f + "\n"; });
    (ex.suppressed || []).forEach(function (s) { one(s, "\t", "Suppressed: ", frames(ex)); });
    if (ex.cause) one(ex.cause, "", "Caused by: ", frames(ex));
    return out;
  }
  JavaSim.stackTraceText = stackTraceText;

  /* =====================================================================
     17. Biblioteca: Scanner, Random, Objects, Locale
     ===================================================================== */
  // ---------- Random (mesmo algoritmo do java.util.Random) ----------
  var MULT = 0x5DEECE66Dn, MASK48 = (1n << 48n) - 1n;
  function JRandom(seed) { this.seed = (BigInt.asIntN(64, seed) ^ MULT) & MASK48; this.haveG = false; }
  JRandom.prototype.next = function (bits) {
    this.seed = (this.seed * MULT + 0xBn) & MASK48;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  };
  JRandom.prototype.nextInt = function () { return this.next(32); };
  JRandom.prototype.nextIntB = function (bound) {
    if (bound <= 0) throwJ("java.lang.IllegalArgumentException", "bound must be positive");
    var r = this.next(31), m = bound - 1;
    if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
    for (var u = r; ((u - (r = u % bound) + m) | 0) < 0; u = this.next(31));
    return r;
  };
  JRandom.prototype.nextIntRange = function (origin, bound) {
    if (origin >= bound) throwJ("java.lang.IllegalArgumentException", "bound must be greater than origin");
    var r = this.nextInt();
    var n = (bound - origin) | 0, m = (n - 1) | 0;
    if ((n & m) === 0) return ((r & m) + origin) | 0;
    if (n > 0) {
      for (var u = r >>> 1; ((u + m - (r = u % n)) | 0) < 0; u = this.nextInt() >>> 1);
      return (r + origin) | 0;
    }
    while (r < origin || r >= bound) r = this.nextInt();
    return r;
  };
  JRandom.prototype.nextLong = function () { return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32))); };
  JRandom.prototype.nextDouble = function () { return (Number(BigInt(this.next(26)) << 27n) + this.next(27)) * Math.pow(2, -53); };
  JRandom.prototype.nextFloat = function () { return this.next(24) / (1 << 24); };
  JRandom.prototype.nextBoolean = function () { return this.next(1) !== 0; };
  JRandom.prototype.nextGaussian = function () {
    if (this.haveG) { this.haveG = false; return this.nextG; }
    var v1, v2, s;
    do { v1 = 2 * this.nextDouble() - 1; v2 = 2 * this.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0);
    var mul = Math.sqrt(-2 * Math.log(s) / s);
    this.nextG = v2 * mul; this.haveG = true;
    return v1 * mul;
  };
  JavaSim.JRandom = JRandom;
  function rndOf(o) { return o.r; }

  // ---------- leitura da entrada padrão ----------
  function Input(text, eof) { this.buf = text || ""; this.pos = 0; this.eof = eof !== false; }
  Input.prototype.need = function () { if (this.eof) return false; throw new NeedInput(); };
  function isSpaceCh(c) { return c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f" || c === "\u000b" || c === "\u001c" || c === "\u001d" || c === "\u001e" || c === "\u001f" || c === " " && false; }
  // próximo token sem consumir: {tok, start, end} ou null (fim)
  Input.prototype.peekToken = function () {
    var p = this.pos, b = this.buf;
    while (true) {
      while (p < b.length && isSpaceCh(b[p])) p++;
      if (p >= b.length) { if (this.need() === false) return null; }
      else break;
    }
    var q = p;
    while (q < b.length && !isSpaceCh(b[q])) q++;
    if (q >= b.length && !this.eof) this.need();
    return { tok: b.slice(p, q), start: p, end: q };
  };
  Input.prototype.readLine = function () {
    if (this.pos >= this.buf.length) { if (this.need() === false) return null; }
    var i = this.buf.indexOf("\n", this.pos);
    if (i < 0) { if (!this.eof) this.need(); var r = this.buf.slice(this.pos); this.pos = this.buf.length; return r.replace(/\r$/, ""); }
    var line = this.buf.slice(this.pos, i);
    this.pos = i + 1;
    return line.replace(/\r$/, "");
  };
  Input.prototype.hasLine = function () {
    if (this.pos < this.buf.length) return true;
    if (this.need() === false) return false;
    return true;
  };
  var SC_FR = {
    throwFor: "java.base/java.util.Scanner.throwFor(Scanner.java:977)",
    throwForEof: "java.base/java.util.Scanner.throwFor(Scanner.java:975)",
    next: "java.base/java.util.Scanner.next(Scanner.java:1632)",
    nextBare: "java.base/java.util.Scanner.next(Scanner.java:1516)",
    nextInt1: "java.base/java.util.Scanner.nextInt(Scanner.java:2297)",
    nextInt2: "java.base/java.util.Scanner.nextInt(Scanner.java:2251)",
    nextLong1: "java.base/java.util.Scanner.nextLong(Scanner.java:2448)",
    nextLong2: "java.base/java.util.Scanner.nextLong(Scanner.java:2400)",
    nextDouble: "java.base/java.util.Scanner.nextDouble(Scanner.java:2603)",
    nextBoolean: "java.base/java.util.Scanner.nextBoolean(Scanner.java:1947)",
    nextLine: "java.base/java.util.Scanner.nextLine(Scanner.java:1690)"
  };
  function scanNum(sc, kind) {
    var inp = sc.inp;
    var t = inp.peekToken();
    var fr = kind === "int" ? [SC_FR.nextInt1, SC_FR.nextInt2] : kind === "long" ? [SC_FR.nextLong1, SC_FR.nextLong2] : kind === "boolean" ? [SC_FR.nextBoolean] : [SC_FR.nextDouble];
    if (!t) throwJ("java.util.NoSuchElementException", null, [SC_FR.throwForEof, SC_FR.next].concat(fr));
    var v = parseScanToken(t.tok, kind, sc.loc || LOC_PT);
    if (v === undefined) throwJ("java.util.InputMismatchException", tooBig(t.tok, kind) ? "For input string: \"" + t.tok + "\"" : null, [SC_FR.throwFor, SC_FR.next].concat(fr));
    inp.pos = t.end;
    return v;
  }
  function tooBig(tok, kind) { return (kind === "int" || kind === "long") && /^[+-]?\d+$/.test(tok); }
  function parseScanToken(tok, kind, loc) {
    var g = loc.grp === "." ? "\\." : ",", d = loc.dec === "," ? "," : "\\.";
    if (kind === "int" || kind === "long" || kind === "short" || kind === "byte") {
      var re = new RegExp("^([+-]?)(\\d+|\\d{1,3}(" + g + "\\d{3})+)$");
      var m = re.exec(tok);
      if (!m) return undefined;
      var v = BigInt(m[1] + m[2].split(loc.grp).join(""));
      var lim = { "int": 2147483647n, "long": 9223372036854775807n, "short": 32767n, "byte": 127n }[kind];
      if (v > lim || v < -lim - 1n) return undefined;
      return kind === "long" ? v : Number(v);
    }
    if (kind === "boolean") { var lw = tok.toLowerCase(); if (lw === "true") return true; if (lw === "false") return false; return undefined; }
    if (/^[+-]?(NaN|Infinity|∞)$/.test(tok)) return tok.indexOf("NaN") >= 0 ? NaN : tok[0] === "-" ? -Infinity : Infinity;
    var re2 = new RegExp("^([+-]?)(\\d+|\\d{1,3}(" + g + "\\d{3})+)?(?:" + d + "(\\d*))?$");
    var m2 = re2.exec(tok);
    if (!m2 || (!m2[2] && !m2[4])) return undefined;
    var num = parseFloat(m2[1] + (m2[2] || "0").split(loc.grp).join("") + "." + (m2[4] || "0"));
    return kind === "float" ? Math.fround(num) : num;
  }
  function scanHas(sc, kind) {
    var t = sc.inp.peekToken();
    if (!t) return false;
    return parseScanToken(t.tok, kind, sc.loc || LOC_PT) !== undefined;
  }
  function checkOpen(sc) { if (sc.closed) throwJ("java.lang.IllegalStateException", "Scanner closed"); }

  function defineUtilCore() {
    defLib("java.util.Locale", { flags: "public final", deprecated: ["<init>(String)", "<init>(String,String)"], m: {
      "<init>(String)": function (l) { this.lang = S(l); this.ctry = ""; this.loc = S(l) === "pt" ? LOC_PT : LOC_US; RT.notes && 0; },
      "<init>(String,String)": function (l, c) { this.lang = S(l); this.ctry = S(c); this.loc = locFor(this.lang, this.ctry); },
      "static Locale of(String)": function (l) { return mkLocale(S(l), ""); },
      "static Locale of(String,String)": function (l, c) { return mkLocale(S(l), S(c)); },
      "static Locale getDefault()": function () { return mkLocale("pt", "BR"); },
      "static void setDefault(Locale)": function (l) { RT.defaultLoc = l.loc; },
      "static Locale forLanguageTag(String)": function (t) { var p = S(t).split("-"); return mkLocale(p[0], p[1] || ""); },
      "static final Locale US": function () { return mkLocale("en", "US"); },
      "static final Locale ENGLISH": function () { return mkLocale("en", ""); },
      "static final Locale UK": function () { return mkLocale("en", "GB"); },
      "static final Locale ROOT": function () { return mkLocale("", ""); },
      "static final Locale GERMANY": function () { return mkLocale("de", "DE"); },
      "static final Locale FRANCE": function () { return mkLocale("fr", "FR"); },
      "String getLanguage()": function () { return jstr(this.lang); },
      "String getCountry()": function () { return jstr(this.ctry); },
      "String getDisplayCountry()": function () { return jstr({ BR: "Brasil", US: "Estados Unidos", PT: "Portugal" }[this.ctry] || this.ctry); },
      "String getDisplayLanguage()": function () { return jstr({ pt: "português", en: "inglês", es: "espanhol" }[this.lang] || this.lang); },
      "String toString()": function () { return jstr(this.lang + (this.ctry ? "_" + this.ctry : "")); },
      "String toLanguageTag()": function () { return jstr(this.lang + (this.ctry ? "-" + this.ctry : "")); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && o.lang === this.lang && o.ctry === this.ctry; },
      "int hashCode()": function () { return stringHash(this.lang + "_" + this.ctry); }
    } });
    LIB["java.util.Locale"].deprecatedCtors = true;
    defLib("java.util.Scanner", { flags: "public final", impl: ["java.io.Closeable", "java.util.Iterator<String>"], m: {
      "<init>(java.io.InputStream)": function (is) { this.inp = RT.stdin; this.loc = null; },
      "<init>(String)": function (s) { this.inp = new Input(S(s), true); },
      "<init>(java.nio.file.Path) throws IOException": function (p) { this.inp = new Input(JavaSim.readFileText ? JavaSim.readFileText(p) : "", true); },
      "<init>(java.io.File) throws java.io.FileNotFoundException": function (f) { this.inp = new Input(JavaSim.readFileText ? JavaSim.readFileText(f) : "", true); },
      "<init>(Readable)": function (r) { this.inp = r.inp || RT.stdin; },
      "String nextLine()": function () { checkOpen(this); var l = this.inp.readLine(); if (l === null) throwJ("java.util.NoSuchElementException", "No line found", [SC_FR.nextLine]); return jstr(l); },
      "String next()": function () { checkOpen(this); var t = this.inp.peekToken(); if (!t) throwJ("java.util.NoSuchElementException", null, [SC_FR.throwForEof, SC_FR.nextBare]); this.inp.pos = t.end; return jstr(t.tok); },
      "int nextInt()": function () { checkOpen(this); return scanNum(this, "int"); },
      "int nextInt(int)": function () { checkOpen(this); return scanNum(this, "int"); },
      "long nextLong()": function () { checkOpen(this); return scanNum(this, "long"); },
      "double nextDouble()": function () { checkOpen(this); return scanNum(this, "double"); },
      "float nextFloat()": function () { checkOpen(this); return scanNum(this, "float"); },
      "short nextShort()": function () { checkOpen(this); return scanNum(this, "short"); },
      "byte nextByte()": function () { checkOpen(this); return scanNum(this, "byte"); },
      "boolean nextBoolean()": function () { checkOpen(this); return scanNum(this, "boolean"); },
      "boolean hasNext()": function () { checkOpen(this); return !!this.inp.peekToken(); },
      "boolean hasNextLine()": function () { checkOpen(this); return this.inp.hasLine(); },
      "boolean hasNextInt()": function () { checkOpen(this); return scanHas(this, "int"); },
      "boolean hasNextLong()": function () { checkOpen(this); return scanHas(this, "long"); },
      "boolean hasNextDouble()": function () { checkOpen(this); return scanHas(this, "double"); },
      "boolean hasNextBoolean()": function () { checkOpen(this); return scanHas(this, "boolean"); },
      "Scanner useLocale(Locale)": function (l) { this.loc = l.loc; return this; },
      "Scanner useDelimiter(String)": function (d) { this.delim = S(d); return this; },
      "void close()": function () { this.closed = true; },
      "void remove()": function () { throwJ("java.lang.UnsupportedOperationException", null); }
    } });
    defLib("java.util.Random", { impl: ["java.util.random.RandomGenerator", "java.io.Serializable"], m: {
      "<init>()": function () { this.r = new JRandom(RT.nextSeed()); },
      "<init>(long)": function (s) { this.r = new JRandom(s); },
      "void setSeed(long)": function (s) { this.r = new JRandom(s); },
      "int nextInt()": function () { return this.r.nextInt(); },
      "int nextInt(int)": function (b) { return this.r.nextIntB(b); },
      "int nextInt(int,int)": function (a, b) { return this.r.nextIntRange(a, b); },
      "long nextLong()": function () { return this.r.nextLong(); },
      "double nextDouble()": function () { return this.r.nextDouble(); },
      "double nextDouble(double,double)": function (a, b) { var r = this.r.nextDouble(); r = r * (b - a) + a; if (r >= b) r = b - Number.EPSILON; return r; },
      "double nextDouble(double)": function (b) { return this.r.nextDouble() * b; },
      "float nextFloat()": function () { return this.r.nextFloat(); },
      "boolean nextBoolean()": function () { return this.r.nextBoolean(); },
      "double nextGaussian()": function () { return this.r.nextGaussian(); },
      "void nextBytes(byte[])": function (arr) { for (var i = 0; i < arr.a.length;) for (var rnd = this.r.nextInt(), n = Math.min(arr.a.length - i, 4); n-- > 0; rnd >>= 8) arr.a[i++] = (rnd << 24) >> 24; }
    } });
    defLib("java.util.random.RandomGenerator", { kind: "interface", m: {
      "int nextInt()": null,
      "int nextInt(int)": function (b) { return jcall(this, "nextInt", []) >>> 1 % b; },
      "static RandomGenerator getDefault()": function () { var o = { $c: L("java.util.Random") }; o.r = new JRandom(RT.nextSeed()); return o; },
      "static RandomGenerator of(String)": function () { var o = { $c: L("java.util.Random") }; o.r = new JRandom(RT.nextSeed()); return o; }
    } });
    defLib("java.util.Objects", { flags: "public final", noCtor: true, m: {
      "static boolean equals(Object,Object)": function (a, b) { return a === b || (a !== null && jequals(a, b)); },
      "static int hashCode(Object)": function (o) { return o === null ? 0 : jhash(o); },
      "static int hash(Object...)": function (a) { var h = 1; for (var i = 0; i < a.a.length; i++) h = (Math.imul(31, h) + (a.a[i] === null ? 0 : jhash(a.a[i]))) | 0; return h; },
      "static String toString(Object)": function (o) { return jstr(toStr(o)); },
      "static String toString(Object,String)": function (o, d) { return o === null ? d : jstr(toStr(o)); },
      "static boolean isNull(Object)": function (o) { return o === null; },
      "static boolean nonNull(Object)": function (o) { return o !== null; },
      "static <T> T requireNonNull(T)": function (o) { if (o === null) throwJ("java.lang.NullPointerException", null, ["java.base/java.util.Objects.requireNonNull(Objects.java:220)"]); return o; },
      "static <T> T requireNonNull(T,String)": function (o, m) { if (o === null) throwJ("java.lang.NullPointerException", m, ["java.base/java.util.Objects.requireNonNull(Objects.java:246)"]); return o; },
      "static <T> T requireNonNullElse(T,T)": function (o, d) { return o !== null ? o : d; },
      "static <T> int compare(T,T,java.util.Comparator<? super T>)": function (a, b, c) { return a === b ? 0 : jcall(c, "compare", [a, b]); },
      "static int checkIndex(int,int)": function (i, n) { if (i < 0 || i >= n) throwJ("java.lang.IndexOutOfBoundsException", "Index " + i + " out of bounds for length " + n); return i; }
    } });
  }
  function locFor(l, c) { return (l === "pt" || l === "de" || l === "es" || l === "it") ? LOC_PT : (l === "fr" ? { dec: ",", grp: " " } : LOC_US); }
  function mkLocale(l, c) { return { $c: L("java.util.Locale"), lang: l, ctry: c, loc: locFor(l, c) }; }
  JavaSim.mkLocale = mkLocale;

  /* =====================================================================
     18. Execução de um programa (java Main)
     ===================================================================== */
  var CLOCK0 = Date.UTC(2026, 9, 15, 13, 30, 0); // 15/10/2026 10:30 em São Paulo (UTC-3)
  function Runtime(opts) {
    opts = opts || {};
    this.chunks = [];
    this.outLen = 0;
    this.maxOut = opts.maxOut || 400000;
    this.stack = [];
    this.steps = 0;
    this.limit = opts.limite || 20000000;
    this.maxDepth = opts.maxDepth || (typeof window !== "undefined" ? 2200 : 3000);
    this.inited = {}; this.st = {}; this.enumVals = {}; this.boxCache = {};
    this.hashState = 0x2545F491 ^ (opts.seed || 0);
    this.seedBase = opts.seed !== undefined ? opts.seed : 0x1234567;
    this.seedCount = 0;
    this.stdin = new Input(opts.stdin || "", opts.eof !== false);
    this.clock = CLOCK0;
    this.threadSeq = 0;
    this.fs = opts.fs || null;
  }
  var RTP = Runtime.prototype;
  RTP.write = function (s, t) {
    if (!t) return;
    this.outLen += t.length;
    var last = this.chunks[this.chunks.length - 1];
    if (last && last.s === s) last.t += t; else this.chunks.push({ s: s, t: t });
    if (this.outLen > this.maxOut) throw new LimitSignal("(simulador) execução interrompida: saída grande demais.");
  };
  RTP.readLine = function () { return this.stdin.readLine(); };
  RTP.stdinReadByte = function () {
    var inp = this.stdin;
    if (inp.pos >= inp.buf.length) { if (inp.need() === false) return -1; }
    var c = inp.buf.charCodeAt(inp.pos++);
    return c;
  };
  RTP.stdinAvailable = function () { return this.stdin.buf.length - this.stdin.pos; };
  RTP.clockMs = function () { return this.clock + this.steps / 100000; };
  RTP.clockAdvance = function (ms) { this.clock += ms; };
  RTP.nextSeed = function () {
    // sementes "aleatórias" estáveis dentro da mesma sessão (para reexecuções com entrada)
    this.seedCount++;
    var x = BigInt(this.seedBase) * 6364136223846793005n + BigInt(this.seedCount) * 1442695040888963407n;
    return BigInt.asIntN(64, x ^ (x >> 29n));
  };
  RTP.setup = function () {
    this.TRUE = new JBox(L("java.lang.Boolean"), true);
    this.FALSE = new JBox(L("java.lang.Boolean"), false);
    this.sysout = { $c: L("java.io.PrintStream"), err: false };
    this.syserr = { $c: L("java.io.PrintStream"), err: true };
    this.sysin = { $c: L("java.io.InputStream") };
    this.mathRandom = new JRandom(this.nextSeed());
    this.mainThread = { $c: L("java.lang.Thread"), name: "main", id: 1 };
  };
  RTP.text = function () { return this.chunks.map(function (c) { return c.t; }).join(""); };

  // compila e executa; devolve um objeto com tudo
  function compileAndPrepare(arquivos) {
    var prog = compileProgram(arquivos);
    var javac = formatDiagnostics(prog);
    var ok = !prog.errors.some(function (e) { return e.kind === "error"; });
    if (ok) {
      var gen = new Gen(prog);
      prog.gen = gen;
      gen.compileProgram();
    }
    return { prog: prog, javac: javac, ok: ok };
  }
  function findMain(prog, nome) {
    var cls = prog.byName[nome];
    if (!cls) return { erro: "Erro: Não foi possível localizar nem carregar a classe principal " + nome + "\nCausada por: java.lang.ClassNotFoundException: " + nome + "\n" };
    var cands = cls.methods.main || [];
    var STR = L("java.lang.String");
    function isArgs(m) { return m.params.length === 1 && m.params[0].k === "array" && isString(m.params[0].elem); }
    var pick = null;
    [function (m) { return m.flags["static"] && isArgs(m); }, function (m) { return m.flags["static"] && m.params.length === 0; },
     function (m) { return !m.flags["static"] && isArgs(m); }, function (m) { return !m.flags["static"] && m.params.length === 0; }].some(function (test) {
      pick = cands.filter(function (m) { return !m.flags["private"] && m.ret === T["void"] && test(m); })[0] || null;
      return !!pick;
    });
    // herdado
    if (!pick) {
      for (var s = cls.superT && cls.superT.sym; s && !s.isLib && !pick; s = s.superT && s.superT.sym) {
        pick = (s.methods.main || []).filter(function (m) { return m.flags["static"] && isArgs(m) && !m.flags["private"]; })[0] || null;
      }
    }
    if (!pick) return { erro: "Erro: o método main não é " + nome + " na classe javafx.application.Application; defina o método main como:\n   public static void main(String[] args)\n" };
    return { cls: cls, m: pick };
  }
  function runMain(prep, opts) {
    opts = opts || {};
    var prog = prep.prog;
    var rt = new Runtime(opts);
    var prevRT = RT;
    RT = rt;
    rt.setup();
    rt.lambdaOwner = opts.principal || "Main";
    var status = 0, excecao = null, needInput = false, limitMsg = null;
    try {
      var mm = findMain(prog, opts.principal || "Main");
      if (mm.erro) { rt.write("err", mm.erro); status = 1; }
      else {
        var args = newArray(L("java.lang.String").rawType(), (opts.args || []).length);
        (opts.args || []).forEach(function (a, i) { args.a[i] = jstr(a); });
        var m = mm.m;
        try {
          ensureInit(mm.cls);
          if (m.flags["static"]) m.impl.apply(null, m.params.length ? [args] : []);
          else {
            var ctor = mm.cls.ctors.filter(function (c) { return c.params.length === 0; })[0];
            var o = newInstance(mm.cls);
            if (ctor && ctor.impl) ctor.impl.call(o);
            m.impl.apply(o, m.params.length ? [args] : []);
          }
        } catch (e) {
          if (e instanceof ExitSignal) status = e.code;
          else if (e instanceof NeedInput) needInput = true;
          else if (e instanceof LimitSignal) { rt.write("err", "\n" + e.msg + "\n"); status = 130; limitMsg = e.msg; }
          else if (e instanceof StopSignal) { status = 130; }
          else {
            var ex = toJava(e);
            if (!ex) {
              rt.write("err", "(simulador) erro interno: " + (e && e.message || e) + "\n");
              if (typeof console !== "undefined" && JavaSim.debug) console.error(e);
              status = 1;
              return { chunks: rt.chunks, status: 1, excecao: null, needInput: false, interno: true, rt: rt };
            }
            rt.stack = [];
            try { rt.write("err", "Exception in thread \"main\" " + stackTraceText(ex)); }
            catch (e2) {
              if (e2 instanceof ExitSignal) status = e2.code;
              else if (e2 instanceof LimitSignal) { rt.write("err", "\n" + e2.msg + "\n"); }
              else rt.write("err", "Exception in thread \"main\" " + classOf(ex).bin + "\n");
            }
            status = 1;
            excecao = classOf(ex).bin;
          }
        }
      }
    } finally { RT = prevRT; }
    return { chunks: rt.chunks, status: status, excecao: excecao, needInput: needInput, limite: limitMsg, rt: rt };
  }
  // API síncrona para o Node e para o navegador
  // opts: {arquivos:[{nome,codigo}], principal, args:[], stdin, eof, limite, seed}
  function rodarSync(opts) {
    ensureLib();
    var prep = compileAndPrepare(opts.arquivos);
    var res = { javac: prep.javac, compilou: prep.ok, chunks: [], texto: "", out: "", err: "", status: prep.ok ? 0 : 1, excecao: null, needInput: false };
    if (!prep.ok) return res;
    var principal = opts.principal || guessMain(prep.prog, opts.arquivos);
    var r = runMain(prep, { principal: principal, args: opts.args || [], stdin: opts.stdin || "", eof: opts.eof !== false, limite: opts.limite, seed: opts.seed, maxDepth: opts.maxDepth });
    res.chunks = r.chunks; res.status = r.status; res.excecao = r.excecao; res.needInput = r.needInput; res.limite = r.limite;
    r.chunks.forEach(function (c) { res.texto += c.t; if (c.s === "err") res.err += c.t; else res.out += c.t; });
    res.prep = prep;
    res.principal = principal;
    return res;
  }
  function guessMain(prog, arquivos) {
    // a classe do primeiro arquivo que tem main
    var nomes = arquivos.map(function (a) { return (a.nome || a.name).replace(/\.java$/, ""); });
    for (var i = 0; i < nomes.length; i++) {
      var c = prog.byName[nomes[i]];
      if (c && c.methods.main) return nomes[i];
    }
    for (var j = 0; j < prog.topClasses.length; j++) if (prog.topClasses[j].methods.main) return prog.topClasses[j].name;
    return nomes[0];
  }
  JavaSim.rodarSync = rodarSync;
  JavaSim.compileAndPrepare = compileAndPrepare;
  JavaSim.runMain = runMain;
  JavaSim.guessMain = guessMain;

  // ---------- internos expostos para assets/javasim-lib.js ----------
  JavaSim._i = {
    defLib: defLib, defExc: defExc, L: L, jstr: jstr, S: S, isStr: isStr, toStr: toStr, jequals: jequals, jhash: jhash, jcompare: jcompare,
    jcall: jcall, vcall: vcall, throwJ: throwJ, npe: npe, JBox: JBox, JArr: JArr, newArray: newArray, arrayClass: arrayClass, boxVal: boxVal,
    rt: function () { return RT; }, mkThrowable: mkThrowable, classOf: classOf, jformat: jformat, doubleToString: doubleToString, floatToString: floatToString,
    T: T, OBJ: OBJ, typeStr: typeStr, instOf: instOf, JavaThrow: JavaThrow, toJava: toJava, isInternal: isInternal, stringHash: stringHash, identityHash: identityHash,
    compareStrings: compareStrings, doubleCompare: doubleCompare, JRandom: JRandom, LOC_PT: LOC_PT, LOC_US: LOC_US, fixedParts: fixedParts, groupDigits: groupDigits,
    erasure: erasure, isSubClass: isSubClass, castFail: castFail, Input: Input, unboxedType: unboxedType, UNBOX: UNBOX, BOX: BOX, boxHash: boxHash,
    javaRegex: javaRegex, jsplit: jsplit, strArray: strArray, toInt32: toInt32, d2l: d2l, enterFrame: enterFrame, Frame: Frame, CLOCK0: CLOCK0, repeat: repeat,
    stackTraceText: stackTraceText, ensureInit: ensureInit, complete: complete,
    newLib: function (full, key, args) { var sy = L(full); complete(sy); var c = sy.ctors.filter(function (k) { return k.key === (key || "<init>()"); })[0]; var o = { $c: sy }; c.impl.apply(o, args || []); return o; }, newObj: newObj, LIB: LIB, parseDoubleJ: function (s) { return JavaSim.parseDoubleJ(s); }
  };
  JavaSim.lambdaClass = function (sym) {
    complete(sym);
    var sam = null;
    (function find(s) {
      if (sam) return;
      complete(s);
      s.methodList.forEach(function (m) { if (!sam && m.flags.abstract && !m.flags["static"] && !OBJECT_METHOD_KEYS[m.key]) sam = m; });
      s.ifaces.forEach(function (i) { find(i.sym); });
    })(sym);
    return lambdaClassFor(sym, sam);
  };

  /* =====================================================================
     19. Metas (data-goal)
     ===================================================================== */
  var META_TIPOS = /^(out|outre|err|errre|compila|erro-javac|excecao|exit|src)(?=:|,|$)/;
  function dividirMetas(meta) {
    var r = [], cur = "";
    for (var i = 0; i < meta.length; i++) {
      if (meta[i] === "\\" && meta[i + 1] === ",") { cur += ","; i++; continue; }
      if (meta[i] === "," && META_TIPOS.test(meta.slice(i + 1).replace(/^\s+/, ""))) { r.push(cur); cur = ""; continue; }
      cur += meta[i];
    }
    r.push(cur);
    return r.map(function (x) { return x.replace(/^\s+/, ""); }).filter(Boolean);
  }
  // ctx: {compilou, javac, out, err, status, excecao, src}
  function checarMeta(meta, ctx) {
    var falhas = [];
    dividirMetas(meta).forEach(function (g) {
      var i = g.indexOf(":"), tipo = i < 0 ? g : g.slice(0, i), val = i < 0 ? "" : g.slice(i + 1), ok = false;
      try {
        switch (tipo) {
          case "out": ok = !!ctx.compilou && (ctx.out || "").indexOf(val) >= 0; break;
          case "outre": ok = !!ctx.compilou && new RegExp(val, "m").test(ctx.out || ""); break;
          case "err": ok = (ctx.err || "").indexOf(val) >= 0; break;
          case "errre": ok = new RegExp(val, "m").test(ctx.err || ""); break;
          case "compila": ok = !!ctx.compilou; break;
          case "erro-javac": ok = !ctx.compilou && (ctx.javac || "").indexOf(val) >= 0; break;
          case "excecao": ok = !!ctx.excecao && (ctx.excecao === val || ctx.excecao.split(/[.$]/).pop() === val || ctx.excecao.replace(/\$/g, ".") === val); break;
          case "exit": ok = !!ctx.compilou && String(ctx.status) === val.trim(); break;
          case "src": ok = new RegExp(val, "m").test(ctx.src || ""); break;
          default: ok = false;
        }
      } catch (e) { ok = false; }
      if (!ok) falhas.push(g);
    });
    return falhas;
  }
  JavaSim.dividirMetas = dividirMetas;
  JavaSim.checarMeta = checarMeta;

  /* =====================================================================
     20. Interface no navegador: .tryjava (editor) e .tryjshell (console)
     ===================================================================== */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html !== undefined && html !== null) e.innerHTML = html;
    return e;
  }
  function decodificarAttr(s) { return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t"); }
  function dividirArgs(s) {
    var r = [], cur = null, i = 0;
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { if (cur !== null) { r.push(cur); cur = null; } i++; continue; }
      if (cur === null) cur = "";
      if (c === "'") { var f = s.indexOf("'", i + 1); if (f < 0) f = s.length; cur += s.slice(i + 1, f); i = f + 1; continue; }
      if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === "\\" && /["\\$`]/.test(s[i + 1] || "")) i++; cur += s[i]; i++; } i++; continue; }
      if (c === "\\" && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
      cur += c; i++;
    }
    if (cur !== null) r.push(cur);
    return r;
  }
  JavaSim.dividirArgs = dividirArgs;
  var libCallbacks = [];
  function quandoLib(fn) { if (JavaSim.libLoaded || typeof document === "undefined") fn(); else libCallbacks.push(fn); }
  JavaSim._libPronta = function () { JavaSim.libLoaded = true; var cbs = libCallbacks; libCallbacks = []; cbs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); };
  function carregarLib() {
    if (JavaSim.libLoaded || document.getElementById("javasim-lib")) return;
    var scripts = document.getElementsByTagName("script"), base = "assets/";
    for (var i = 0; i < scripts.length; i++) { var src = scripts[i].getAttribute("src") || ""; if (/javasim\.js(\?|$)/.test(src)) { base = src.replace(/javasim\.js.*$/, ""); break; } }
    var s = document.createElement("script"); s.src = base + "javasim-lib.js"; s.id = "javasim-lib"; s.async = true;
    s.onerror = function () { JavaSim._libPronta(); };
    document.body.appendChild(s);
  }
  // linhas de saída: agrupa linhas repetidas muitas vezes (ex.: StackOverflowError)
  function compactarRepeticoes(txt) {
    var ls = txt.split("\n"), out = [], i = 0;
    while (i < ls.length) {
      var j = i;
      while (j + 1 < ls.length && ls[j + 1] === ls[i]) j++;
      var n = j - i + 1;
      if (n > 12) { for (var k = 0; k < 5; k++) out.push(ls[i]); out.push("\u0000(simulador: mais " + (n - 6) + " linhas iguais omitidas)"); out.push(ls[i]); }
      else for (var q = i; q <= j; q++) out.push(ls[q]);
      i = j + 1;
    }
    return out.join("\n");
  }

  function montarTryjava(box) {
    if (box.getAttribute("data-montado")) return;
    box.setAttribute("data-montado", "1");
    var meta = box.getAttribute("data-goal") || "", stdinAttr = box.getAttribute("data-stdin"), argsIni = box.getAttribute("data-args") || "";
    var arquivoPadrao = box.getAttribute("data-file") || "Main.java";
    var scripts = Array.prototype.slice.call(box.querySelectorAll("pre.script"));
    var sols = Array.prototype.slice.call(box.querySelectorAll("pre.solucao"));
    function ler(pre) { return pre.textContent.replace(/^\n/, ""); }
    var abas = scripts.map(function (p, i) { return { nome: p.getAttribute("data-file") || (i === 0 ? arquivoPadrao : "Arquivo" + i + ".java"), original: ler(p), atual: ler(p) }; });
    if (!abas.length) abas.push({ nome: arquivoPadrao, original: "", atual: "" });
    var solucao = sols.length ? sols.map(function (p, i) { return { nome: p.getAttribute("data-file") || (abas[i] ? abas[i].nome : arquivoPadrao), codigo: ler(p) }; }) : null;
    scripts.concat(sols).forEach(function (p) { p.style.display = "none"; });
    var ativa = 0;
    var w = el("div", { "class": "ts tj" });
    var tabsHtml = abas.length > 1 ? abas.map(function (a, i) { return '<button type="button" class="tj-tab' + (i === 0 ? " on" : "") + '" data-i="' + i + '">' + escHtml(a.nome) + "</button>"; }).join("") : '<span class="ts-arq">' + escHtml(abas[0].nome) + "</span>";
    w.innerHTML =
      '<div class="ts-bar"><span class="tj-tabs">' + tabsHtml + '</span><span class="ts-sp"></span>' +
      (solucao ? '<button type="button" class="sim-btn ts-sol">Ver solução</button>' : "") +
      '<button type="button" class="sim-btn ts-rest" title="Volta ao código original">Restaurar</button></div>' +
      '<div class="ts-confirma" hidden><span>Trocar o seu código pela solução?</span> <button type="button" class="sim-btn2 ts-sim">Sim, mostrar</button> <button type="button" class="sim-btn2 secundario ts-nao">Cancelar</button></div>' +
      '<div class="ts-editor"><pre class="ts-nums" aria-hidden="true"></pre><textarea class="ts-code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Código Java"></textarea></div>' +
      '<div class="ts-run"><label class="ts-args-l">Argumentos: <input class="ts-args" type="text" spellcheck="false" autocomplete="off" autocapitalize="off"></label><button type="button" class="ts-rodar">▶ Rodar</button></div>' +
      '<div class="sim ts-saida" hidden><div class="sim-bar"><span class="sim-dots"><i></i><i></i><i></i></span><span class="sim-title">Terminal</span></div><div class="sim-screen ts-tela"><div class="sim-out"></div></div></div>';
    box.appendChild(w);
    var status = null;
    if (meta) { status = el("p", { "class": "sim-status" }, "Missão em andamento…"); box.appendChild(status); }
    var ta = w.querySelector(".ts-code"), nums = w.querySelector(".ts-nums"), argsIn = w.querySelector(".ts-args"), btn = w.querySelector(".ts-rodar");
    var saidaBox = w.querySelector(".ts-saida"), out = w.querySelector(".sim-out"), tela = w.querySelector(".ts-tela");
    argsIn.value = argsIni;
    ta.value = abas[0].atual;
    var cumprida = false, sessao = null;
    function ajustar() {
      var n = ta.value.split("\n").length, t = "";
      for (var i = 1; i <= n; i++) t += i + "\n";
      nums.textContent = t;
      ta.style.height = "auto";
      ta.style.height = Math.max(ta.scrollHeight, 60) + "px";
    }
    function salvarAba() { abas[ativa].atual = ta.value; }
    function trocarAba(i) {
      salvarAba(); ativa = i; ta.value = abas[i].atual; ajustar();
      Array.prototype.forEach.call(w.querySelectorAll(".tj-tab"), function (b) { b.classList.toggle("on", +b.getAttribute("data-i") === i); });
    }
    Array.prototype.forEach.call(w.querySelectorAll(".tj-tab"), function (b) { b.addEventListener("click", function () { trocarAba(+b.getAttribute("data-i")); }); });
    ta.addEventListener("input", function () { salvarAba(); ajustar(); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); var a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + "    " + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + 4; salvarAba(); ajustar(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rodar(); }
      else if (e.key === "Enter") {
        var p = ta.selectionStart, ini = ta.value.lastIndexOf("\n", p - 1) + 1, ind = /^[ \t]*/.exec(ta.value.slice(ini, p))[0];
        if (/\{\s*$/.test(ta.value.slice(ini, p))) ind += "    ";
        if (ind) { e.preventDefault(); ta.value = ta.value.slice(0, p) + "\n" + ind + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = p + 1 + ind.length; salvarAba(); ajustar(); }
      }
    });
    function linha(html, cls) { var d = el("div", cls ? { "class": cls } : null, html); out.appendChild(d); return d; }
    function prompt(cmd) { linha('<span class="c-u">ana@notebook</span>:<span class="c-d">~</span>$ ' + escHtml(cmd), "sim-cmd"); }
    // desenha a saída do programa com os textos digitados no lugar certo
    function desenharExecucao(chunks, digitados, paradas, fim) {
      var cont = el("div", { "class": "tj-exec" });
      var pos = 0, k = 0, linhaAtual = null;
      function escrever(txt, cls) {
        txt.split("\n").forEach(function (p, i, arr) {
          if (!linhaAtual) { linhaAtual = el("div"); cont.appendChild(linhaAtual); }
          if (p) {
            if (p.indexOf("\u0000") === 0) linhaAtual.appendChild(el("span", { "class": "sim-info" }, escHtml(p.slice(1))));
            else linhaAtual.appendChild(el("span", cls ? { "class": cls } : null, escHtml(p)));
          }
          if (i < arr.length - 1) linhaAtual = null;
        });
      }
      function eco(i) { escrever(""); linhaAtual.appendChild(el("span", { "class": "sim-digitado" }, escHtml(digitados[i]))); linhaAtual = null; }
      chunks.forEach(function (c) {
        var t = c.t;
        while (k < paradas.length && pos + t.length >= paradas[k] && k < digitados.length) {
          var corte = paradas[k] - pos;
          escrever(t.slice(0, corte), c.s === "err" ? "sim-err" : "");
          eco(k); pos += corte; t = t.slice(corte); k++;
        }
        escrever(compactarRepeticoes(t), c.s === "err" ? "sim-err" : "");
        pos += t.length;
      });
      while (k < digitados.length && k < paradas.length) { eco(k); k++; }
      return { cont: cont, linha: function () { if (!linhaAtual) { linhaAtual = el("div"); cont.appendChild(linhaAtual); } return linhaAtual; } };
    }
    function textoChunks(chunks) { var n = 0; chunks.forEach(function (c) { n += c.t.length; }); return n; }
    function fim(res, s) {
      btn.textContent = "▶ Rodar"; sessao = null;
      out.appendChild(el("div", { "class": "ts-codigo" + (res.status ? " ts-erro" : "") }, "[código de saída: " + res.status + "]"));
      tela.scrollTop = tela.scrollHeight;
      verificar({ compilou: true, javac: s.prep.javac, out: res.out, err: res.err, status: res.status, excecao: res.excecao });
    }
    function verificar(ctx) {
      if (!status || cumprida) return;
      ctx.src = abas.map(function (a) { return a.atual; }).join("\n");
      var f = checarMeta(meta, ctx);
      if (!f.length) { cumprida = true; status.textContent = "✔ Missão cumprida!"; status.className = "sim-status ok"; }
      else if (/^(src|exit|compila|erro-javac|excecao)/.test(f[0])) status.textContent = "Missão em andamento… (ainda falta: " + f.join(", ") + ")";
      else status.textContent = "Missão em andamento… (a saída ainda não é a esperada)";
    }
    function executar(s) {
      var res;
      try {
        res = runMain(s.prep, { principal: s.principal, args: s.args, stdin: s.digitados.map(function (d) { return d + "\n"; }).join(""), eof: s.eof || s.fixo, seed: s.seed, limite: 10000000 });
      } catch (e) {
        res = { chunks: [{ s: "err", t: "(simulador) erro interno: " + (e && e.message || e) + "\n" }], status: 1 };
        if (typeof console !== "undefined") console.error(e);
      }
      res.out = ""; res.err = "";
      res.chunks.forEach(function (c) { if (c.s === "err") res.err += c.t; else res.out += c.t; });
      if (s.execDiv) s.execDiv.parentNode.removeChild(s.execDiv);
      if (res.needInput) s.paradas[s.digitados.length] = textoChunks(res.chunks);
      var d = desenharExecucao(res.chunks, s.digitados, s.paradas, !res.needInput);
      s.execDiv = d.cont;
      out.appendChild(d.cont);
      if (res.needInput) {
        var campo = el("input", { "class": "ts-campo", type: "text", spellcheck: "false", autocomplete: "off", "aria-label": "Entrada do programa (Enter envia, Ctrl+D encerra)" });
        d.linha().appendChild(campo);
        campo.focus({ preventScroll: true });
        tela.scrollTop = tela.scrollHeight;
        s.campo = campo;
        campo.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); s.digitados.push(campo.value); s.campo = null; executar(s); }
          else if (e.ctrlKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); s.eof = true; s.campo = null; executar(s); }
          else if (e.ctrlKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); parar(); }
        });
        return;
      }
      tela.scrollTop = tela.scrollHeight;
      fim(res, s);
    }
    function parar() {
      if (!sessao) return;
      var s = sessao;
      if (s.campo) { var sp = el("span", null, "^C"); s.campo.parentNode.replaceChild(sp, s.campo); s.campo = null; }
      sessao = null; btn.textContent = "▶ Rodar";
      out.appendChild(el("div", { "class": "ts-codigo ts-erro" }, "[código de saída: 130]"));
    }
    function rodar() {
      if (sessao) { parar(); return; }
      salvarAba();
      saidaBox.hidden = false;
      out.innerHTML = "";
      btn.disabled = true; btn.textContent = "…";
      quandoLib(function () {
        btn.disabled = false;
        var arquivos = abas.map(function (a) { return { nome: a.nome, codigo: a.atual }; });
        prompt("javac " + arquivos.map(function (a) { return a.nome; }).join(" "));
        var prep;
        try { ensureLib(); prep = compileAndPrepare(arquivos); }
        catch (e) { linha(escHtml("(simulador) erro interno: " + (e && e.message || e)), "sim-err"); btn.textContent = "▶ Rodar"; if (typeof console !== "undefined") console.error(e); return; }
        if (prep.javac) {
          var cls = prep.ok ? "sim-info" : "sim-err";
          prep.javac.replace(/\n$/, "").split("\n").forEach(function (l) { linha(escHtml(l) || "&nbsp;", cls); });
        }
        if (!prep.ok) {
          out.appendChild(el("div", { "class": "ts-codigo ts-erro" }, "[código de saída: 1]"));
          btn.textContent = "▶ Rodar";
          verificar({ compilou: false, javac: prep.javac, out: "", err: "", status: 1, excecao: null });
          tela.scrollTop = tela.scrollHeight;
          return;
        }
        var principal = guessMain(prep.prog, arquivos);
        var args = dividirArgs(argsIn.value);
        prompt("java " + principal + (argsIn.value.trim() ? " " + argsIn.value.trim() : ""));
        var fixo = stdinAttr !== null;
        sessao = { prep: prep, principal: principal, args: args, digitados: [], paradas: [], seed: Math.floor(Math.random() * 2147483647), fixo: fixo, eof: false };
        if (fixo) sessao.digitados = [];
        btn.textContent = "■ Parar";
        if (fixo) {
          var r;
          try { r = runMain(prep, { principal: principal, args: args, stdin: decodificarAttr(stdinAttr), eof: true, seed: sessao.seed, limite: 10000000 }); }
          catch (e) { r = { chunks: [{ s: "err", t: "(simulador) erro interno: " + (e && e.message || e) + "\n" }], status: 1 }; }
          r.out = ""; r.err = "";
          r.chunks.forEach(function (c) { if (c.s === "err") r.err += c.t; else r.out += c.t; });
          out.appendChild(desenharExecucao(r.chunks, [], [], true).cont);
          fim(r, sessao);
          return;
        }
        executar(sessao);
      });
    }
    btn.addEventListener("click", rodar);
    w.querySelector(".ts-rest").addEventListener("click", function () { abas.forEach(function (a) { a.atual = a.original; }); ta.value = abas[ativa].atual; ajustar(); });
    var conf = w.querySelector(".ts-confirma");
    if (solucao) {
      w.querySelector(".ts-sol").addEventListener("click", function () { conf.hidden = false; });
      w.querySelector(".ts-sim").addEventListener("click", function () {
        solucao.forEach(function (sl) {
          var a = abas.filter(function (x) { return x.nome === sl.nome; })[0];
          if (a) a.atual = sl.codigo; else abas.push({ nome: sl.nome, original: "", atual: sl.codigo });
        });
        ta.value = abas[ativa].atual; ajustar(); conf.hidden = true;
      });
      w.querySelector(".ts-nao").addEventListener("click", function () { conf.hidden = true; });
    }
    ajustar();
  }

  function montarTudo() {
    var boxes = document.querySelectorAll(".tryjava, .tryjshell");
    if (!boxes.length) return;
    carregarLib();
    Array.prototype.forEach.call(document.querySelectorAll(".tryjava"), function (b) { try { montarTryjava(b); } catch (e) { if (typeof console !== "undefined") console.error(e); } });
    Array.prototype.forEach.call(document.querySelectorAll(".tryjshell"), function (b) { try { if (JavaSim.montarTryjshell) JavaSim.montarTryjshell(b); } catch (e) { if (typeof console !== "undefined") console.error(e); } });
  }
  JavaSim.montarTudo = montarTudo;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montarTudo); else montarTudo();
  }

  /* =====================================================================
     21. JShell
     ===================================================================== */
  function jshellStrLit(s, q) {
    return q + s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\f/g, "\\f").replace(/\x08/g, "\\b").replace(q === '"' ? /"/g : /'/g, "\\" + q) + q;
  }
  function jshellValue(v, t) {
    if (v === null || v === undefined) return "null";
    if (t && t.k === "prim") {
      switch (t.n) {
        case "char": return jshellStrLit(String.fromCharCode(v), "'");
        case "double": return doubleToString(v);
        case "float": return floatToString(v);
        case "long": return v.toString();
        default: return String(v);
      }
    }
    if (isStr(v)) return jshellStrLit(S(v), '"');
    if (v && v.$c && v.$c.isLambda) return toStr(v).replace(/^\$JShell\$\d+\$/, "");
    if (v instanceof JBox && UNBOX[v.$c.full] === "char") return jshellStrLit(String.fromCharCode(v.v), "'");
    if (v instanceof JArr) {
      var et = v.$c.elemType;
      var base = typeStr(et).replace(/^[\s\S]*?([^.]+)$/, "$1"), dims = "";
      var inner = et; while (inner.k === "array") { inner = inner.elem; }
      var name = typeStr(et.k === "array" ? inner : et);
      var extra = ""; var x = et; while (x.k === "array") { extra += "[]"; x = x.elem; }
      return name + "[" + v.a.length + "]" + extra + " { " + Array.prototype.map.call(v.a, function (e) { return jshellValue(e, et); }).join(", ") + " }";
    }
    return toStr(v);
  }
  function JShell(opts) {
    opts = opts || {};
    ensureLib();
    this.rt = new Runtime({ stdin: opts.stdin || "", eof: true, seed: opts.seed || 777, limite: opts.limite || 5000000 });
    var prev = RT; RT = this.rt; this.rt.setup(); RT = prev;
    var repl = new ClassSym("REPL", "REPL", "class");
    repl.bin = "REPL"; repl.superT = OBJ(); repl.headerDone = true; repl.completed = true; repl.membersDone = true; repl.attributed = true; repl.prepared = true;
    repl.flags["public"] = true;
    repl.file = new SourceFile("REPL", "");
    repl.fieldDefaults = [];
    this.repl = repl;
    this.rt.inited[repl.id] = 2; this.rt.st[repl.id] = {};
    this.classes = Object.create(null);
    this.snips = [];
    this.vars = [];
    this.nextId = 1;
    this.imports = [];
    this.encerrado = false;
  }
  var JSP = JShell.prototype;
  // divide "int a = 1, b = 2" em declarações separadas
  JSP.classify = function (src) {
    var trimmed = src.replace(/\s+$/, "");
    if (/^\s*\//.test(trimmed)) return { kind: "cmd", cmd: trimmed.trim() };
    if (/^\s*import\s/.test(trimmed)) return { kind: "import", src: trimmed.replace(/;?\s*$/, ";") };
    var f = new SourceFile("snippet", trimmed);
    var errs = [], p;
    try { p = new Parser(f, errs); } catch (e) { if (e instanceof ParseAbort) return { kind: "err", errs: errs, src: trimmed }; throw e; }
    var mods = null;
    try {
      var mk = p.mark();
      mods = p.modifiers();
      if (p.isTypeDeclStart()) return { kind: "type", src: trimmed };
      // método: Tipo nome(
      if (p.is("<")) { p.reset(mk); return { kind: "method", src: trimmed }; }
      var mk2 = p.mark();
      if (p.isTypeStart() || p.is("void")) {
        try { if (p.is("void")) p.next(); else p.type(); if (p.isId() && p.is("(", 1)) { p.reset(mk); return { kind: "method", src: trimmed }; } } catch (e) { if (!(e instanceof ParseAbort)) throw e; }
      }
      p.reset(mk2);
      if (p.isLocalVarDecl() || (mods.any && !p.is("("))) { p.reset(mk); return { kind: "var", src: trimmed }; }
      p.reset(mk);
      // expressão completa?
      try {
        var ex = p.expr();
        if (p.is(";")) p.next();
        if (p.t.k === "eof") return { kind: "expr", src: trimmed.replace(/;\s*$/, ""), node: ex };
      } catch (e) { if (!(e instanceof ParseAbort)) throw e; }
      p.reset(mk);
    } catch (e) { if (!(e instanceof ParseAbort)) throw e; }
    return { kind: "stmt", src: trimmed };
  };
  JSP.prefix = function () {
    return this.imports.join("\n") + (this.imports.length ? "\n" : "");
  };
  // compila um trecho embrulhado; devolve {prog, cls, erros, offset}
  JSP.compile = function (code, userSrc, userOffset, extraTypes) {
    var prog = new Program();
    prog.jshell = true;
    var self = this;
    var arquivo = { nome: "snippet.java", codigo: code };
    var parseErrs = [];
    var parsed = parseFile("snippet.java", code, parseErrs);
    prog.files = [parsed.file];
    if (parseErrs.length) { prog.errors = parseErrs; return prog; }
    prog.cus = [parsed.cu];
    // tipos já declarados no JShell
    Object.keys(this.classes).forEach(function (n) { prog.byName[n] = self.classes[n]; });
    prog.byName.REPL = this.repl;
    var ck = new Checker(prog);
    QUALIFIED_NAMES = true;
    try {
      parsed.cu.implicit = false;
      ck.enterCU(parsed.cu);
      LIB_DEFAULT_IMPORTS.forEach(function (pk) { if (parsed.cu.importsStar.indexOf(pk) < 0) parsed.cu.importsStar.push(pk); });
      ck.resolveImports(parsed.cu);
      prog.classes.slice().forEach(function (c) { ck.headerClass(c); });
      prog.classes.slice().forEach(function (c) { ck.membersClass(c); });
      prog.topClasses.slice().forEach(function (c) { ck.attribClass(c); });
      if (!prog.errors.length) { var fl = new Flow(prog, ck); prog.topClasses.forEach(function (c) { fl.analyzeClass(c); }); }
    } finally { QUALIFIED_NAMES = false; }
    prog.checker = ck;
    return prog;
  };
  JSP.errText = function (prog, userSrc, offset) {
    var out = "";
    var errs = prog.errors.filter(function (e) { return e.kind === "error"; });
    errs.slice(0, 1).forEach(function (e) {
      var lines = e.msg.split("\n");
      out += "|  Error:\n|  " + lines[0] + "\n";
      for (var k = 1; k < lines.length; k++) { if (/^\s*location: class \$JShell\$/.test(lines[k])) continue; out += "|  " + lines[k] + "\n"; }
      var rel = e.pos - offset;
      if (rel < 0 || rel > userSrc.length) rel = 0;
      var f = new SourceFile("s", userSrc);
      var ln = f.lineOf(rel), col = f.colOf(rel), text = f.lineText(ln);
      out += "|  " + text + "\n";
      // extensão do token no ponto do erro
      var len = 1;
      var m = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][\w$]*|\d[\w.]*)/.exec(text.slice(col));
      if (m) len = m[0].length;
      var caret = "";
      for (var i = 0; i < col; i++) caret += text[i] === "\t" ? "\t" : " ";
      caret += len <= 1 ? "^" : "^" + repeat("-", len - 2) + "^";
      out += "|  " + caret + "\n";
    });
    return out;
  };
  // roda o $run() de uma classe de trecho
  JSP.run = function (prog, cls, id) {
    var gen = new Gen(prog);
    gen.compileProgram();
    var prev = RT; RT = this.rt;
    this.rt.chunks = []; this.rt.outLen = 0; this.rt.steps = 0; this.rt.stack = [];
    var res = { value: undefined, exc: null, out: "" };
    this.rt.lambdaOwner = cls.bin;
    try {
      var m = (cls.methods.$run || [])[0];
      ensureInit(cls);
      if (m) res.value = m.impl.apply(null, []);
    } catch (e) {
      if (e instanceof ExitSignal) { this.encerrado = true; }
      else if (e instanceof LimitSignal) { this.rt.write("err", e.msg + "\n"); }
      else if (e instanceof NeedInput) { this.rt.write("err", "(simulador) o JShell do guia não lê o teclado\n"); }
      else {
        var ex = toJava(e);
        if (!ex) throw e;
        res.exc = ex;
      }
    } finally { RT = prev; }
    res.out = this.rt.chunks.map(function (c) { return c.t; }).join("");
    return res;
  };
  function jshellFrames(ex, bases) {
    return (ex.stack || []).map(function (f) {
      var m = /^\$JShell\$(\d+)\.\$run\(snippet\.java:(\d+)\)$/.exec(f);
      if (m) return "(#" + m[1] + ":" + Math.max(1, parseInt(m[2], 10) - (bases[m[1]] || 0)) + ")";
      var m2 = /^\$JShell\$(\d+)\.([\w$<>]+)\(snippet\.java:(\d+)\)$/.exec(f);
      if (m2) return m2[2] + " (#" + m2[1] + ":" + Math.max(1, parseInt(m2[3], 10) - (bases[m2[1]] || 0)) + ")";
      var m3 = /^(?:java\.base\/)?(?:[a-z]+\.)*([A-Z][\w$]*)\.([\w$<>]+)\((.*)\)$/.exec(f);
      if (m3) return m3[1] + "." + m3[2] + " (" + m3[3].replace(/^snippet\.java/, "#?") + ")";
      return f;
    });
  }
  JSP.excText = function (ex) {
    var msg = jcall(ex, "getMessage", []);
    var out = "|  Exception " + classOf(ex).bin + (msg !== null ? ": " + S(msg) : "") + "\n";
    jshellFrames(ex, this.bases || {}).forEach(function (f) { out += "|        at " + f + "\n"; });
    return out;
  };
  JSP.declareVar = function (name, type, value, id) {
    var repl = this.repl;
    var f = new FieldSym(name, repl, type, { "static": true, "public": true });
    f.key = "v_" + name + "_" + id;
    f.npeName = "REPL.$JShell$" + id + "." + name;
    repl.fields[name] = f;
    repl.fieldList = repl.fieldList.filter(function (x) { return x.name !== name; }).concat([f]);
    this.rt.st[repl.id][f.key] = value;
    this.vars = this.vars.filter(function (v) { return v.name !== name; }).concat([{ name: name, type: type, field: f, id: id }]);
  };
  JSP.wrap = function (body, id) {
    var pre = this.prefix() + "class $JShell$" + id + " extends REPL {\n    static Object $run() {\n";
    this.bases = this.bases || {};
    this.bases[id] = pre.split("\n").length - 1;
    return { code: pre + body.before + body.src + body.after + "\n    }\n}\n", offset: pre.length + body.before.length };
  };
  // avalia um trecho; devolve o texto que o JShell mostraria
  JSP.eval = function (src) {
    var prev = RT; RT = this.rt;
    try { return this.eval0(src); } finally { RT = prev; }
  };
  JSP.eval0 = function (src) {
    if (this.encerrado) return "";
    if (!src.trim()) return "";
    var c = this.classify(src);
    var self = this;
    switch (c.kind) {
      case "cmd": return this.command(c.cmd);
      case "import": this.imports.push(c.src); this.snips.push({ id: this.nextId++, src: c.src, kind: "import" }); return "";
      case "err": return this.errText({ errors: c.errs }, c.src, 0);
      case "var": return this.evalVar(c.src);
      case "expr": return this.evalExpr(c.src, c.node);
      case "method": return this.evalMethod(c.src);
      case "type": return this.evalType(c.src);
      default: return this.evalStmt(c.src);
    }
  };
  JSP.evalVar = function (src) {
    // separa declarações múltiplas
    var f = new SourceFile("s", src), p = new Parser(f, []);
    var decl;
    try { decl = p.localVarDecl(p.modifiers(), false); } catch (e) { return this.evalStmt(src); }
    if (decl.vars.length > 1) {
      var self = this, tipo = src.slice(decl.type.pos, decl.vars[0].pos).trim(), out = "";
      var mods = src.slice(0, decl.type.pos);
      decl.vars.forEach(function (v, i) {
        var end = i + 1 < decl.vars.length ? src.lastIndexOf(",", decl.vars[i + 1].pos) : src.replace(/;\s*$/, "").length;
        var piece = src.slice(v.pos, end).trim();
        out += self.evalVar(mods + tipo + " " + piece);
      });
      return out;
    }
    var name = decl.vars[0].name;
    var id = this.nextId;
    var body = src.replace(/;\s*$/, "");
    var semInit = !decl.vars[0].init;
    var w = this.wrap({ before: "        ", src: body, after: semInit ? ";\n        return null;" : ";\n        return " + name + ";" }, id);
    var prog = this.compile(w.code);
    if (prog.errors.length) return this.errText(prog, body, w.offset);
    this.nextId++;
    var cls = prog.byName["$JShell$" + id];
    var m = cls.methods.$run[0];
    var vsym = null;
    (function find(x) { if (!x || vsym || typeof x !== "object") return; if (x.k === "LocalVar") { vsym = x.vars[0].vsym; return; } if (x.stats) x.stats.forEach(find); })(m.decl.body);
    var t = vsym ? vsym.type : OBJ();
    var r = this.run(prog, cls, id);
    var v = semInit ? defaultValue(t) : r.value;
    if (t.k === "prim" && v instanceof JBox) v = v.v;
    if (r.exc) { this.declareVar(name, t, defaultValue(t), id); this.snips.push({ id: id, src: body + ";", kind: "var", name: name }); return r.out + this.excText(r.exc); }
    var exists = this.vars.some(function (x) { return x.name === name; });
    this.declareVar(name, t, v === undefined ? defaultValue(t) : v, id);
    this.snips.push({ id: id, src: body + ";", kind: "var", name: name });
    return r.out + name + " ==> " + jshellValue(v === undefined ? defaultValue(t) : v, t) + "\n";
  };
  JSP.evalExpr = function (src, node) {
    var id = this.nextId;
    var w = this.wrap({ before: "        var $res = ", src: src, after: ";\n        return $res;" }, id);
    var prog = this.compile(w.code);
    if (prog.errors.length) {
      // pode ser uma chamada void: tenta como comando
      if (prog.errors.some(function (e) { return /variable initializer is 'void'/.test(e.msg); })) return this.evalStmt(src);
      return this.errText(prog, src, w.offset);
    }
    this.nextId++;
    var cls = prog.byName["$JShell$" + id];
    var m = cls.methods.$run[0];
    var t = m.decl.body.stats[0].vars[0].vsym.type;
    var r = this.run(prog, cls, id);
    var v = r.value;
    if (t.k === "prim" && v instanceof JBox) v = v.v;
    // atribuição a variável: "x ==> 20"
    var target = null;
    if (node && node.k === "Assign" && node.target.k === "Ident" && this.repl.fields[node.target.name]) target = node.target.name;
    var bare = node && node.k === "Ident" && this.repl.fields[node.name] ? node.name : null;
    if (bare) target = bare;
    this.snips.push({ id: id, src: src, kind: "expr" });
    if (r.exc) { this.declareVar("$" + id, t, defaultValue(t), id); return r.out + this.excText(r.exc); }
    if (target) return r.out + target + " ==> " + jshellValue(v, t) + "\n";
    this.declareVar("$" + id, t, v, id);
    return r.out + "$" + id + " ==> " + jshellValue(v, t) + "\n";
  };
  JSP.evalStmt = function (src) {
    var id = this.nextId;
    var body = /[;}]\s*$/.test(src) ? src : src + ";";
    var w = this.wrap({ before: "        ", src: body, after: "\n        return null;" }, id);
    var prog = this.compile(w.code);
    if (prog.errors.length) return this.errText(prog, src, w.offset);
    this.nextId++;
    var cls = prog.byName["$JShell$" + id];
    var r = this.run(prog, cls, id);
    this.snips.push({ id: id, src: body, kind: "stmt" });
    return r.out + (r.exc ? this.excText(r.exc) : "");
  };
  JSP.evalMethod = function (src) {
    var id = this.nextId;
    var pre = this.prefix() + "class $JShell$" + id + " extends REPL {\n    static ";
    this.bases = this.bases || {};
    this.bases[id] = pre.split("\n").length - 1;
    var code = pre + src + "\n}\n";
    var prog = this.compile(code);
    if (prog.errors.length) return this.errText(prog, src, pre.length);
    this.nextId++;
    var cls = prog.byName["$JShell$" + id];
    new Gen(prog).compileProgram();
    var repl = this.repl, out = "";
    cls.methodList.forEach(function (m) {
      var list = repl.methods[m.name] || (repl.methods[m.name] = []);
      var old = list.filter(function (o) { return o.key === m.key; })[0];
      repl.methods[m.name] = list.filter(function (o) { return o.key !== m.key; }).concat([m]);
      repl.methodList = repl.methodList.filter(function (o) { return o !== old; }).concat([m]);
      out += "|  " + (old ? "modified" : "created") + " method " + m.name + "(" + m.params.map(typeStr).join(",") + ")\n";
    });
    this.snips = this.snips.filter(function (s) { return !(s.kind === "method" && s.sig === cls.methodList[0].key); });
    this.snips.push({ id: id, src: src, kind: "method", sig: cls.methodList[0] && cls.methodList[0].key, m: cls.methodList[0] });
    return out;
  };
  JSP.evalType = function (src) {
    var id = this.nextId;
    var pre = this.prefix();
    var prog = this.compile(pre + src + "\n");
    if (prog.errors.length) return this.errText(prog, src, pre.length);
    this.nextId++;
    new Gen(prog).compileProgram();
    var self = this, out = "";
    prog.topClasses.forEach(function (c) {
      var old = self.classes[c.name];
      self.classes[c.name] = c;
      out += "|  " + (old ? "replaced" : "created") + " " + c.kindName().replace("@interface", "annotation interface") + " " + c.name + "\n";
      self.snips.push({ id: id, src: src, kind: "type", cls: c });
    });
    return out;
  };
  JSP.command = function (cmd) {
    var self = this, out = "";
    var c = cmd.split(/\s+/)[0];
    switch (c) {
      case "/exit": this.encerrado = true; return "|  Goodbye\n";
      case "/vars":
        this.vars.forEach(function (v) { out += "|    " + typeStr(v.type) + " " + v.name + " = " + jshellValue(self.rt.st[self.repl.id][v.field.key], v.type) + "\n"; });
        return out;
      case "/list":
        this.snips.forEach(function (s) { if (s.kind === "import") return; out += (s.id < 10 ? "   " : s.id < 100 ? "  " : " ") + s.id + " : " + s.src + "\n"; });
        return "\n" + out;
      case "/methods":
        Object.keys(this.repl.methods).forEach(function (n) { self.repl.methods[n].forEach(function (m) { out += "|    " + typeStr(m.ret) + " " + m.name + "(" + m.params.map(typeStr).join(",") + ")\n"; }); });
        return out;
      case "/types":
        Object.keys(this.classes).forEach(function (n) { out += "|    " + self.classes[n].kindName() + " " + n + "\n"; });
        return out;
      case "/imports":
        ["java.io.*", "java.math.*", "java.net.*", "java.nio.file.*", "java.util.*", "java.util.concurrent.*", "java.util.function.*", "java.util.prefs.*", "java.util.regex.*", "java.util.stream.*"].forEach(function (p) { out += "|    import " + p + "\n"; });
        this.imports.forEach(function (i) { out += "|    " + i.replace(/;$/, "") + "\n"; });
        return out;
      case "/reset": { var n = new JShell(); for (var k in n) this[k] = n[k]; return "|  Resetting state.\n"; }
      case "/help": return "|  Comandos do JShell no simulador: /vars, /list, /methods, /types, /imports, /reset, /exit\n";
    }
    return "|  Invalid command: " + c + "\n|  Type /help for help.\n";
  };
  // trechos com várias linhas: chaves/parênteses abertos continuam
  function jshellCompleto(src) {
    var d = 0, q = null;
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (q) { if (ch === "\\") { i++; continue; } if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === "{" || ch === "(" || ch === "[") d++;
      else if (ch === "}" || ch === ")" || ch === "]") d--;
    }
    return d <= 0 && !q;
  }
  // roda um texto como se fosse digitado no JShell; devolve a transcrição
  function rodarJShellTexto(txt, opts) {
    opts = opts || {};
    var js = new JShell(opts);
    var linhas = txt.replace(/\n$/, "").split("\n");
    var out = "", saida = "", buf = null;
    for (var i = 0; i < linhas.length && !js.encerrado; i++) {
      var l = linhas[i];
      out += (buf === null ? "jshell> " : "   ...> ") + l + "\n";
      buf = buf === null ? l : buf + "\n" + l;
      if (!jshellCompleto(buf)) continue;
      var r;
      try { r = js.eval(buf); } catch (e) { r = "(simulador) erro interno: " + (e && e.message || e) + "\n"; }
      out += r; saida += r;
      buf = null;
    }
    if (!js.encerrado) out += "jshell> ";
    if (opts.retornarSessao) return { texto: out, out: saida, err: saida, sessao: js };
    return out;
  }
  JavaSim.JShell = JShell;
  JavaSim.rodarJShellTexto = rodarJShellTexto;
  JavaSim.jshellCompleto = jshellCompleto;

  // ---------- console .tryjshell ----------
  JavaSim.montarTryjshell = function (box) {
    if (box.getAttribute("data-montado")) return;
    box.setAttribute("data-montado", "1");
    var meta = box.getAttribute("data-goal") || "";
    var preSol = box.querySelector("pre.solucao");
    var sol = preSol ? preSol.textContent.replace(/^\n/, "").replace(/\n+$/, "") : null;
    if (preSol) preSol.style.display = "none";
    var preIni = box.querySelector("pre.script");
    var inicial = preIni ? preIni.textContent.replace(/^\n/, "").replace(/\n+$/, "") : null;
    if (preIni) preIni.style.display = "none";
    var w = el("div", { "class": "sim tj-shell" });
    w.innerHTML = '<div class="sim-bar"><span class="sim-dots"><i></i><i></i><i></i></span><span class="sim-title">jshell</span>' +
      (sol !== null ? '<button type="button" class="sim-btn tj-ver">Ver solução</button>' : "") +
      '<button type="button" class="sim-btn tj-reset" title="Começa uma sessão nova do JShell">Reiniciar</button></div>' +
      '<div class="ts-confirma tj-conf" hidden><span>Digitar a solução numa sessão nova?</span> <button type="button" class="sim-btn2 tj-sim">Sim, mostrar</button> <button type="button" class="sim-btn2 secundario tj-nao">Cancelar</button></div>' +
      '<div class="sim-screen" tabindex="-1"><div class="sim-out" aria-live="polite"></div>' +
      '<div class="sim-line"><span class="sim-prompt">jshell&gt; </span><input class="sim-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Digite um trecho de Java"></div></div>';
    box.appendChild(w);
    var status = null;
    if (meta) { status = el("p", { "class": "sim-status" }, "Missão em andamento…"); box.appendChild(status); }
    var out = w.querySelector(".sim-out"), inp = w.querySelector(".sim-input"), pr = w.querySelector(".sim-prompt"), tela = w.querySelector(".sim-screen");
    var js = null, buf = null, hist = [], hpos = 0, saida = "", digitado = "", cumprida = false;
    function linha(txt, cls) {
      txt.replace(/\n$/, "").split("\n").forEach(function (l) { out.appendChild(el("div", cls ? { "class": cls } : null, escHtml(l) || "&nbsp;")); });
    }
    function iniciar() {
      out.innerHTML = ""; buf = null; saida = ""; digitado = "";
      pr.textContent = "jshell> ";
      linha("|  Welcome to JShell -- Version 25.0.4.1\n|  For an introduction type: /help intro", "sim-info");
      js = null;
      quandoLib(function () { js = new JShell(); if (inicial) inicial.split("\n").forEach(function (l) { executar(l, true); }); });
    }
    function verificar() {
      if (!status || cumprida) return;
      var f = checarMeta(meta, { compilou: true, out: saida, err: saida, javac: saida, src: digitado, status: 0 });
      if (!f.length) { cumprida = true; status.textContent = "✔ Missão cumprida!"; status.className = "sim-status ok"; }
    }
    function executar(l, silencioso) {
      var d = el("div", { "class": "sim-cmd" });
      d.appendChild(el("span", { "class": "sim-prompt" }, escHtml(buf === null ? "jshell> " : "   ...> ")));
      d.appendChild(el("span", { "class": "sim-digitado" }, escHtml(l)));
      out.appendChild(d);
      if (!silencioso) digitado += l + "\n";
      buf = buf === null ? l : buf + "\n" + l;
      if (!jshellCompleto(buf)) { pr.textContent = "   ...> "; return; }
      pr.textContent = "jshell> ";
      var r;
      try { r = js.eval(buf); } catch (e) { r = "(simulador) erro interno: " + (e && e.message || e) + "\n"; if (typeof console !== "undefined") console.error(e); }
      buf = null;
      if (r) {
        r.replace(/\n$/, "").split("\n").forEach(function (x) { out.appendChild(el("div", /^\|  (Error|Exception)/.test(x) || /^\|\s{2,}\S/.test(x) && false ? { "class": "sim-err" } : null, escHtml(x) || "&nbsp;")); });
        saida += r;
      }
      if (js.encerrado) { w.querySelector(".sim-line").style.display = "none"; }
      tela.scrollTop = tela.scrollHeight;
      verificar();
    }
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var l = inp.value; inp.value = "";
        if (l.trim()) { hist.push(l); hpos = hist.length; }
        quandoLib(function () { if (!js) js = new JShell(); executar(l); });
      } else if (e.key === "ArrowUp") { if (hpos > 0) { hpos--; inp.value = hist[hpos]; e.preventDefault(); } }
      else if (e.key === "ArrowDown") { if (hpos < hist.length) { hpos++; inp.value = hist[hpos] || ""; e.preventDefault(); } }
    });
    tela.addEventListener("click", function () { if (!window.getSelection || !String(window.getSelection())) inp.focus({ preventScroll: true }); });
    w.querySelector(".tj-reset").addEventListener("click", function () { w.querySelector(".sim-line").style.display = ""; iniciar(); });
    if (sol !== null) {
      var conf = w.querySelector(".tj-conf");
      w.querySelector(".tj-ver").addEventListener("click", function () { conf.hidden = false; });
      w.querySelector(".tj-nao").addEventListener("click", function () { conf.hidden = true; });
      w.querySelector(".tj-sim").addEventListener("click", function () {
        conf.hidden = true; w.querySelector(".sim-line").style.display = "";
        iniciar();
        quandoLib(function () { sol.split("\n").forEach(function (l) { executar(l); }); });
      });
    }
    iniciar();
  };
  global.JavaSim = JavaSim;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = JavaSim;
    try { require("./javasim-lib.js"); } catch (e) { if (!/Cannot find module/.test(e.message)) throw e; }
  }
})(typeof window !== "undefined" ? window : globalThis);
