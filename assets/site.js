/* =========================================================
   Guia Java — navegação e componentes
   NIVEIS é a única fonte do menu lateral, do selo de nível e
   dos botões Anterior/Próximo. Para adicionar uma página,
   inclua-a aqui.
   ========================================================= */
var NIVEIS = [
  { id: "n1", nome: "Nível 1 · Iniciante", curto: "Iniciante", desc: "Programar em Java do zero", grupos: [
    { grupo: "Começando", itens: [
      ["index.html", "Início"],
      ["introducao.html", "O que é Java"],
      ["jdk-jre-jvm.html", "JDK, JRE e JVM"],
      ["versoes.html", "Versões e LTS"],
      ["instalar-linux.html", "Instalar no Linux"],
      ["instalar-windows-mac.html", "Instalar no Windows e macOS"],
      ["editores-ide.html", "Editores e IDEs"],
      ["simulador.html", "O Editor do Guia"]
    ]},
    { grupo: "Primeiro Programa", itens: [
      ["primeiro-programa.html", "Olá, Mundo"],
      ["compilar-executar.html", "javac e java"],
      ["jshell.html", "JShell"],
      ["sintaxe.html", "Sintaxe e Estrutura"],
      ["comentarios.html", "Comentários"],
      ["saida.html", "Saída: print e println"],
      ["erros-compilacao.html", "Lendo Erros do javac"]
    ]},
    { grupo: "Variáveis e Tipos", itens: [
      ["variaveis.html", "Variáveis"],
      ["tipos-primitivos.html", "Tipos Primitivos"],
      ["inteiros.html", "int, long, short, byte"],
      ["decimais.html", "double e float"],
      ["char-boolean.html", "char e boolean"],
      ["var.html", "var"],
      ["constantes.html", "Constantes (final)"],
      ["conversao-tipos.html", "Conversão de Tipos (casting)"]
    ]},
    { grupo: "Operadores", itens: [
      ["operadores-aritmeticos.html", "Operadores Aritméticos"],
      ["operadores-atribuicao.html", "Operadores de Atribuição"],
      ["operadores-comparacao.html", "Operadores de Comparação"],
      ["operadores-logicos.html", "Operadores Lógicos"],
      ["precedencia.html", "Precedência"]
    ]},
    { grupo: "Texto e Números", itens: [
      ["strings.html", "Strings"],
      ["metodos-string.html", "Métodos de String"],
      ["concatenacao.html", "Concatenação"],
      ["escapes.html", "Caracteres Especiais"],
      ["text-blocks.html", "Text Blocks"],
      ["math.html", "Math"],
      ["aleatorios.html", "Números Aleatórios"]
    ]},
    { grupo: "Decisões", itens: [
      ["booleanos.html", "Expressões Booleanas"],
      ["if-else.html", "if, else if, else"],
      ["ternario.html", "Operador Ternário"],
      ["switch.html", "switch"],
      ["switch-expressoes.html", "switch com Setas"]
    ]},
    { grupo: "Repetições", itens: [
      ["while.html", "while e do-while"],
      ["for.html", "for"],
      ["for-each.html", "for-each"],
      ["break-continue.html", "break e continue"],
      ["lacos-aninhados.html", "Laços Aninhados"]
    ]},
    { grupo: "Arrays", itens: [
      ["arrays.html", "Arrays"],
      ["percorrer-arrays.html", "Percorrer Arrays"],
      ["arrays-multidimensionais.html", "Arrays Multidimensionais"],
      ["classe-arrays.html", "A Classe Arrays"]
    ]},
    { grupo: "Entrada", itens: [
      ["scanner.html", "Ler do Teclado (Scanner)"],
      ["args.html", "Argumentos da Linha de Comando"]
    ]}
  ]},
  { id: "n2", nome: "Nível 2 · Intermediário", curto: "Intermediário", desc: "Métodos e orientação a objetos", grupos: [
    { grupo: "Métodos", itens: [
      ["metodos.html", "Métodos"],
      ["parametros.html", "Parâmetros e Argumentos"],
      ["retorno.html", "Valores de Retorno"],
      ["sobrecarga.html", "Sobrecarga"],
      ["escopo.html", "Escopo"],
      ["recursao.html", "Recursão"]
    ]},
    { grupo: "Classes e Objetos", itens: [
      ["poo.html", "O que é POO"],
      ["classes-objetos.html", "Classes e Objetos"],
      ["atributos.html", "Atributos"],
      ["metodos-objeto.html", "Métodos de Objeto"],
      ["construtores.html", "Construtores"],
      ["this.html", "this"],
      ["modificadores.html", "Modificadores de Acesso"],
      ["encapsulamento.html", "Encapsulamento (get e set)"],
      ["static.html", "static"],
      ["final.html", "final"]
    ]},
    { grupo: "Pacotes", itens: [
      ["pacotes.html", "Pacotes e import"],
      ["api-java.html", "A Biblioteca Padrão"]
    ]},
    { grupo: "Herança e Polimorfismo", itens: [
      ["heranca.html", "Herança"],
      ["super.html", "super"],
      ["sobrescrita.html", "Sobrescrita (@Override)"],
      ["polimorfismo.html", "Polimorfismo"],
      ["abstratas.html", "Classes Abstratas"],
      ["interfaces.html", "Interfaces"],
      ["classes-internas.html", "Classes Internas e Anônimas"],
      ["enums.html", "Enums"],
      ["records.html", "Records"],
      ["object.html", "A Classe Object"]
    ]},
    { grupo: "Exceções", itens: [
      ["excecoes.html", "O que são Exceções"],
      ["try-catch.html", "try e catch"],
      ["finally.html", "finally e try-with-resources"],
      ["throw-throws.html", "throw e throws"],
      ["checked-unchecked.html", "Checked × Unchecked"],
      ["excecoes-proprias.html", "Criar suas Exceções"]
    ]},
    { grupo: "Classes Úteis", itens: [
      ["wrappers.html", "Wrappers e Autoboxing"],
      ["stringbuilder.html", "StringBuilder"],
      ["formatacao.html", "Formatar Texto (format e printf)"],
      ["datas.html", "Datas e Horas (java.time)"],
      ["bigdecimal.html", "BigDecimal e Dinheiro"],
      ["arquivos.html", "Ler e Escrever Arquivos"]
    ]}
  ]},
  { id: "n3", nome: "Nível 3 · Avançado", curto: "Avançado", desc: "Java moderno e profissional", grupos: [
    { grupo: "Coleções", itens: [
      ["colecoes.html", "Visão Geral das Coleções"],
      ["arraylist.html", "ArrayList"],
      ["linkedlist.html", "LinkedList"],
      ["hashmap.html", "HashMap"],
      ["hashset.html", "HashSet"],
      ["treemap-treeset.html", "TreeMap e TreeSet"],
      ["iterator.html", "Iterator"],
      ["collections.html", "A Classe Collections"],
      ["comparable-comparator.html", "Comparable e Comparator"],
      ["generics.html", "Generics"]
    ]},
    { grupo: "Programação Funcional", itens: [
      ["lambdas.html", "Lambdas"],
      ["interfaces-funcionais.html", "Interfaces Funcionais"],
      ["method-references.html", "Referências de Métodos"],
      ["streams.html", "Streams"],
      ["collectors.html", "Collectors"],
      ["optional.html", "Optional"]
    ]},
    { grupo: "Java Moderno", itens: [
      ["pattern-matching.html", "Pattern Matching"],
      ["sealed.html", "Classes Seladas"],
      ["regex.html", "Expressões Regulares"],
      ["anotacoes.html", "Anotações"],
      ["reflexao.html", "Reflexão"],
      ["novidades.html", "Novidades do Java 17 ao 25"]
    ]},
    { grupo: "Concorrência", itens: [
      ["threads.html", "Threads"],
      ["executors.html", "ExecutorService"],
      ["virtual-threads.html", "Threads Virtuais"],
      ["sincronizacao.html", "synchronized e Locks"]
    ]},
    { grupo: "Ferramentas", itens: [
      ["jar.html", "Empacotar em JAR"],
      ["maven.html", "Maven"],
      ["gradle.html", "Gradle"],
      ["junit.html", "Testes com JUnit"],
      ["depuracao.html", "Depurar"],
      ["javadoc.html", "Javadoc"],
      ["modulos.html", "Módulos (JPMS)"],
      ["boas-praticas.html", "Boas Práticas"]
    ]}
  ]},
  { id: "proj", nome: "Projetos", curto: "Projetos", desc: "Programas completos, passo a passo", grupos: [
    { grupo: "Projetos", itens: [
      ["projetos.html", "Como Usar os Projetos"],
      ["projeto-calculadora.html", "Calculadora"],
      ["projeto-adivinhacao.html", "Jogo da Adivinhação"],
      ["projeto-agenda.html", "Agenda de Contatos"],
      ["projeto-biblioteca.html", "Sistema de Biblioteca"],
      ["projeto-banco.html", "Conta Bancária com Testes"],
      ["projeto-tarefas.html", "Tarefas com Maven"]
    ]}
  ]},
  { id: "ref", nome: "Referência", curto: "Referência", desc: "Consulta rápida", grupos: [
    { grupo: "Consulta", itens: [
      ["ref-palavras-chave.html", "Palavras-chave"],
      ["ref-string.html", "Métodos de String"],
      ["ref-math.html", "Métodos de Math"],
      ["ref-colecoes.html", "Cola de Coleções"],
      ["ref-excecoes.html", "Exceções Comuns"],
      ["ref-erros-javac.html", "Erros do Compilador"],
      ["glossario.html", "Glossário"],
      ["quiz.html", "Quiz"]
    ]}
  ]}
];

(function () {
  "use strict";

  var root = document.documentElement;
  var body = document.body;
  var atual = location.pathname.split("/").pop() || "index.html";

  // Lista linear de páginas (para Anterior/Próximo) e localização da atual
  var plano = [], aqui = null;
  NIVEIS.forEach(function (n) {
    n.grupos.forEach(function (g) {
      g.itens.forEach(function (i) {
        var item = { href: i[0], titulo: i[1], nivel: n, grupo: g.grupo };
        plano.push(item);
        if (i[0] === atual) aqui = item;
      });
    });
  });
  var pos = aqui ? plano.indexOf(aqui) : -1;

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function semAcento(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

  /* ---------- Barra superior ---------- */
  var links = NIVEIS.map(function (n) {
    return '<a class="top-link' + (aqui && aqui.nivel === n ? " ativo" : "") + '" href="' + n.grupos[0].itens[0][0] + '">' + n.curto + "</a>";
  }).join("");
  var header = el("header", { "class": "topbar" },
    '<button class="icon-btn" id="menu-btn" aria-label="Abrir menu" aria-expanded="false">&#9776;</button>' +
    '<a class="brand" href="index.html"><span class="brand-mark">J</span>Guia Java</a>' +
    '<nav class="top-links" aria-label="Níveis">' + links + "</nav>" +
    '<span class="spacer"></span>' +
    '<button class="icon-btn" id="theme-btn" aria-label="Alternar tema claro/escuro" title="Alternar tema"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button>');
  body.insertBefore(header, body.firstChild);

  /* ---------- Menu lateral com abas de nível ---------- */
  var sidebar = document.getElementById("sidebar");
  if (sidebar) {
    var nivelAtivo = aqui ? aqui.nivel.id : "n1";
    var html = '<div class="sidebar-filter"><input type="search" placeholder="Buscar em todos os níveis…" aria-label="Buscar tópicos"></div>';
    html += '<div class="nivel-tabs" role="tablist">' + NIVEIS.map(function (n) {
      return '<button type="button" role="tab" data-nivel="' + n.id + '" class="tab-' + n.id + '">' + n.curto + "</button>";
    }).join("") + "</div>";
    NIVEIS.forEach(function (n) {
      html += '<div class="nivel-lista" data-nivel="' + n.id + '"><p class="nivel-desc">' + n.desc + "</p>";
      n.grupos.forEach(function (g) {
        html += '<div class="grupo"><h2>' + g.grupo + "</h2><ul>";
        g.itens.forEach(function (i) {
          html += '<li><a href="' + i[0] + '"' + (i[0] === atual ? ' class="active" aria-current="page"' : "") + ">" + i[1] + "</a></li>";
        });
        html += "</ul></div>";
      });
      html += "</div>";
    });
    sidebar.innerHTML = html;

    var mostrar = function (id) {
      sidebar.querySelectorAll(".nivel-lista").forEach(function (l) { l.hidden = l.getAttribute("data-nivel") !== id; });
      sidebar.querySelectorAll(".nivel-tabs button").forEach(function (b) {
        var on = b.getAttribute("data-nivel") === id;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    };
    mostrar(nivelAtivo);
    sidebar.querySelectorAll(".nivel-tabs button").forEach(function (b) {
      b.addEventListener("click", function () { mostrar(b.getAttribute("data-nivel")); sidebar.scrollTop = 0; });
    });

    var ativo = sidebar.querySelector("a.active");
    if (ativo) sidebar.scrollTop = ativo.offsetTop - sidebar.clientHeight / 2;

    sidebar.querySelector(".sidebar-filter input").addEventListener("input", function () {
      var q = semAcento(this.value.trim());
      if (!q) { mostrar(nivelAtivo); sidebar.querySelectorAll(".grupo, li").forEach(function (x) { x.style.display = ""; }); sidebar.classList.remove("buscando"); return; }
      sidebar.classList.add("buscando");
      sidebar.querySelectorAll(".nivel-lista").forEach(function (l) {
        var algumNivel = false;
        l.querySelectorAll(".grupo").forEach(function (g) {
          var algum = false;
          g.querySelectorAll("li").forEach(function (li) {
            var ok = semAcento(li.textContent + " " + g.querySelector("h2").textContent).indexOf(q) !== -1;
            li.style.display = ok ? "" : "none";
            if (ok) algum = true;
          });
          g.style.display = algum ? "" : "none";
          if (algum) algumNivel = true;
        });
        l.hidden = !algumNivel;
      });
    });
  }

  /* ---------- Selo de nível abaixo do título ---------- */
  var h1 = document.querySelector(".content h1");
  if (h1 && aqui && atual !== "index.html") {
    var selo = el("p", { "class": "selo selo-" + aqui.nivel.id }, '<span class="selo-nivel">' + aqui.nivel.nome + '</span><span class="selo-grupo">' + aqui.grupo + "</span>");
    h1.parentNode.insertBefore(selo, h1.nextSibling);
  }

  /* ---------- Anterior / Próximo ---------- */
  document.querySelectorAll(".pager").forEach(function (p) {
    var h = "";
    if (pos > 0) h += '<a class="prev" href="' + plano[pos - 1].href + '">&#10094; Anterior</a>';
    if (pos >= 0 && pos < plano.length - 1) h += '<a class="next" href="' + plano[pos + 1].href + '">Próximo &#10095;</a>';
    p.innerHTML = h;
  });

  /* ---------- Rodapé ---------- */
  var content = document.querySelector(".content");
  if (content) {
    content.appendChild(el("footer", { "class": "site-footer" },
      "Guia Java · Java 25 LTS (OpenJDK/Temurin) · Os exemplos foram rodados num JDK de verdade · Vale para Linux, Windows e macOS."));
  }

  /* ---------- Tema ---------- */
  document.getElementById("theme-btn").addEventListener("click", function () {
    var t = root.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var novo = t === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", novo);
    try { localStorage.setItem("tema", novo); } catch (e) {}
  });

  /* ---------- Menu no celular ---------- */
  var menuBtn = document.getElementById("menu-btn");
  menuBtn.addEventListener("click", function () {
    var aberto = body.classList.toggle("menu-open");
    menuBtn.setAttribute("aria-expanded", aberto ? "true" : "false");
  });

  /* ---------- Copiar ---------- */
  function botaoCopiar(bloco, texto) {
    var b = el("button", { "class": "copy-btn", "type": "button" }, "copiar");
    b.addEventListener("click", function () {
      var feito = function () { b.textContent = "copiado!"; setTimeout(function () { b.textContent = "copiar"; }, 1500); };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(texto).then(feito);
      } else {
        var t = el("textarea"); t.value = texto; body.appendChild(t); t.select();
        try { document.execCommand("copy"); feito(); } catch (e) {}
        body.removeChild(t);
      }
    });
    bloco.appendChild(b);
  }

  /* ---------- Sessão de terminal (máquina fictícia) ----------
     <pre class="term">$ comando
     saída do comando        « anotação opcional
     #> comando como root
     </pre>
     data-user (ana) · data-host (notebook) · data-cwd (~)
     O prompt acompanha os "cd" da própria sessão. */
  function resolver(cwd, alvo, home) {
    if (!alvo || alvo === "~") return home;
    if (alvo === "-") return cwd;
    if (alvo.indexOf("~/") === 0) alvo = home + alvo.slice(1);
    var partes = (alvo[0] === "/" ? alvo : cwd + "/" + alvo).split("/"), out = [];
    partes.forEach(function (x) { if (!x || x === ".") return; if (x === "..") out.pop(); else out.push(x); });
    return "/" + out.join("/");
  }
  function curto(p, home) { return p === home ? "~" : p.indexOf(home + "/") === 0 ? "~" + p.slice(home.length) : p; }


  /* ---------- acompanhar a pasta atual nas sessões pre.term ----------
     Entende cd/pushd/popd com aspas, barras invertidas, ~, variáveis atribuídas
     na própria sessão, cd - e CDPATH (pela linha que o Bash imprime), e não
     muda a pasta quando a saída mostra que o comando falhou. */
  function saidaDepois(linhas, idx) {
    var out = [], j = idx + 1;
    while (j < linhas.length && /^> ?/.test(linhas[j])) j++; // linhas de continuação
    for (; j < linhas.length; j++) {
      if (/^(\$|#>)( |$)/.test(linhas[j])) break;
      out.push(linhas[j].replace(/\s*«.*$/, ""));
    }
    return out;
  }
  function palavrasShell(txt, vars, home) {
    var res = [], cur = null, i = 0, c;
    function add(x) { cur = (cur || "") + x; }
    function variavel() {
      var m = /^\$(\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/.exec(txt.slice(i));
      if (!m) { add("$"); i++; return; }
      var n = m[2] || m[3];
      add(n === "HOME" ? home : n === "PWD" ? vars.__pwd : n === "OLDPWD" ? (vars.__oldpwd || "") : (vars[n] != null ? vars[n] : "\u0000"));
      i += m[0].length;
    }
    while (i < txt.length) {
      c = txt[i];
      if (/\s/.test(c)) { if (cur !== null) { res.push(cur); cur = null; } i++; continue; }
      if (c === "~" && cur === null && (i + 1 === txt.length || /[\/\s]/.test(txt[i + 1]))) { add(home); i++; continue; }
      if (c === "\\") { add(txt[i + 1] || ""); i += 2; continue; }
      if (c === "'") { var f = txt.indexOf("'", i + 1); if (f < 0) f = txt.length; add(txt.slice(i + 1, f)); i = f + 1; continue; }
      if (c === '"') {
        i++; add("");
        while (i < txt.length && txt[i] !== '"') {
          if (txt[i] === "\\" && /[$`"\\]/.test(txt[i + 1] || "")) { add(txt[i + 1]); i += 2; }
          else if (txt[i] === "$") variavel();
          else { add(txt[i]); i++; }
        }
        i++; continue;
      }
      if (c === "$") { variavel(); continue; }
      add(c); i++;
    }
    if (cur !== null) res.push(cur);
    return res;
  }
  function segmentos(cmd) { // divide em && ; || fora de aspas
    var segs = [], cur = "", q = "", i;
    for (i = 0; i < cmd.length; i++) {
      var c = cmd[i];
      if (q) { cur += c; if (c === "\\" && q === '"') { cur += cmd[++i] || ""; } else if (c === q) q = ""; continue; }
      if (c === "\\") { cur += c + (cmd[++i] || ""); continue; }
      if (c === "'" || c === '"') { q = c; cur += c; continue; }
      if ((c === "&" && cmd[i + 1] === "&") || (c === "|" && cmd[i + 1] === "|")) { segs.push(cur); cur = ""; i++; continue; }
      if (c === ";" || c === "|") { segs.push(cur); cur = ""; continue; }
      cur += c;
    }
    segs.push(cur);
    return segs;
  }
  function acompanharCd(cmd, cwd, home, ses, saida) {
    var falhou = saida.some(function (l) { return /^bash: (cd|pushd|popd|dirs): /.test(l); });
    var impresso = saida.filter(function (l) { return /^(\/|~)/.test(l); })[0];
    var mudou = false;
    segmentos(cmd).forEach(function (seg) {
      ses.vars.__pwd = cwd; ses.vars.__oldpwd = ses.oldpwd;
      var w = palavrasShell(seg.trim(), ses.vars, home);
      if (!w.length) return;
      // atribuições simples: nome=valor (sem comando depois)
      if (w.every(function (x) { return /^[A-Za-z_]\w*=/.test(x); })) {
        w.forEach(function (x) { var k = x.indexOf("="); ses.vars[x.slice(0, k)] = x.slice(k + 1); });
        return;
      }
      var nome = w[0], args = w.slice(1).filter(function (a) { return !/^-[LPe@]+$/.test(a); });
      if (nome !== "cd" && nome !== "pushd" && nome !== "popd") return;
      if (falhou) return;
      if (args.some(function (a) { return a.indexOf("\u0000") !== -1; })) return; // variável desconhecida
      var novo = null;
      if (nome === "cd") {
        if (args[0] === "-") { if (!ses.oldpwd) return; novo = ses.oldpwd; }
        else if (impresso && !mudou) novo = impresso.replace(/^~(?=\/|$)/, home); // CDPATH: o Bash imprime a pasta
        else novo = resolver(cwd, args[0] || home, home);
      } else if (nome === "pushd") {
        if (impresso && !mudou) { // pushd imprime a pilha: a primeira entrada é a pasta nova
          var topo = impresso.split(" ")[0].replace(/^~(?=\/|$)/, home);
          novo = topo;
        } else novo = args[0] ? resolver(cwd, args[0], home) : (ses.pilha[ses.pilha.length - 1] || null);
        if (novo) ses.pilha.push(cwd);
      } else if (nome === "popd") {
        if (impresso && !mudou) novo = impresso.split(" ")[0].replace(/^~(?=\/|$)/, home);
        else novo = ses.pilha.length ? ses.pilha[ses.pilha.length - 1] : null;
        ses.pilha.pop();
      }
      if (novo && novo !== cwd) { ses.oldpwd = cwd; cwd = novo; mudou = true; }
      else if (novo) mudou = true;
    });
    return cwd;
  }
  document.querySelectorAll("pre.term").forEach(function (pre) {
    var user = pre.getAttribute("data-user") || "ana",
      host = pre.getAttribute("data-host") || "notebook",
      homeUser = user === "root" ? "/root" : "/home/" + user,
      cwd = resolver("/", (pre.getAttribute("data-cwd") || "~").replace(/^~/, homeUser), homeUser);
    var linhas = pre.textContent.replace(/^\n+|\s+$/g, "").split("\n"), html = [], cmds = [];
    var tituloCwd = curto(cwd, homeUser), primeiroUser = user, pilhaSu = [];
    var ultimoCmd = false, sessao = { vars: {}, oldpwd: null, pilha: [] };
    linhas.forEach(function (l, idx) {
      var mc = ultimoCmd && /^> ?(.*)$/.exec(l);
      if (mc) {
        var nc = "", ic = mc[1].indexOf("«");
        if (ic !== -1) { nc = '<span class="t-a">← ' + esc(mc[1].slice(ic + 1).trim()) + "</span>"; mc[1] = mc[1].slice(0, ic).replace(/\s+$/, ""); }
        html.push('<span class="t-p">&gt; </span><span class="t-c">' + esc(mc[1]) + "</span>" + (nc ? "   " + nc : ""));
        cmds[cmds.length - 1] += "\n" + mc[1];
        return;
      }
      var m = /^(\$|#>)(?: (.*)|())$/.exec(l);
      if (m && m[2] == null) m[2] = "";
      ultimoCmd = !!m;
      if (m) {
        var root_ = m[1] === "#>", u = root_ ? "root" : user, home = root_ ? "/root" : homeUser;
        var nota = "", ia = m[2].indexOf("«");
        if (ia !== -1) { nota = '<span class="t-a">← ' + esc(m[2].slice(ia + 1).trim()) + "</span>"; m[2] = m[2].slice(0, ia).replace(/\s+$/, ""); }
        html.push('<span class="t-p"><span class="t-u">' + u + "@" + host + '</span>:<span class="t-d">' + esc(curto(cwd, home)) + "</span>" + (root_ ? "#" : "$") + " </span>" + '<span class="t-c">' + esc(m[2]) + "</span>" + (nota ? "   " + nota : ""));
        cmds.push(m[2]);
        cwd = acompanharCd(m[2], cwd, home, sessao, saidaDepois(linhas, idx));
        if (/^\s*sudo -i\s*$/.test(m[2])) cwd = "/root";
        if (/^\s*su(\s+-|\s+-l|\s+--login)?(\s+root)?\s*$/.test(m[2])) { pilhaSu.push({ cwd: cwd }); if (/-/.test(m[2])) cwd = "/root"; }
        if (/^\s*(exit|logout)\s*$/.test(m[2]) && root_ && pilhaSu.length) cwd = pilhaSu.pop().cwd;
        return;
      }
      var a = l.indexOf("«");
      if (a !== -1) html.push('<span class="t-o">' + esc(l.slice(0, a)) + '</span><span class="t-a">← ' + esc(l.slice(a + 1).trim()) + "</span>");
      else html.push('<span class="t-o">' + esc(l) + "</span>");
    });
    var janela = el("div", { "class": "term-win" });
    var titulo = pre.getAttribute("data-title") || (primeiroUser + "@" + host + ": " + tituloCwd);
    janela.innerHTML = '<div class="term-bar"><span class="sim-dots"><i></i><i></i><i></i></span><span class="term-title">' + esc(titulo) + "</span></div>";
    pre.parentNode.insertBefore(janela, pre);
    pre.innerHTML = html.join("\n");
    janela.appendChild(pre);
    if (cmds.join("").trim()) botaoCopiar(janela, cmds.filter(function (c) { return c.trim(); }).join("\n"));
  });

  /* ---------- Anatomia do comando ----------
     <dl class="anatomy">
       <dt>pgrep</dt><dd>o programa que procura processos</dd>
       <dt>-a</dt><dd>mostra a linha de comando completa</dd>
     </dl> */
  document.querySelectorAll("dl.anatomy").forEach(function (dl) {
    var dts = dl.querySelectorAll("dt"), linha = el("div", { "class": "anat-cmd" });
    dts.forEach(function (dt, i) {
      var n = i + 1;
      dt.setAttribute("data-n", n);
      dt.classList.add("anat-" + (i % 6));
      var parte = el("span", { "class": "anat-parte anat-" + (i % 6), "data-n": n }, esc(dt.textContent));
      linha.appendChild(parte);
      if (i < dts.length - 1) linha.appendChild(document.createTextNode(" "));
    });
    dl.parentNode.insertBefore(linha, dl);
    var caixa = el("div", { "class": "anat-box" });
    dl.parentNode.insertBefore(caixa, linha);
    caixa.appendChild(el("p", { "class": "anat-label" }, "Anatomia do comando"));
    caixa.appendChild(linha);
    caixa.appendChild(dl);
  });

  /* ---------- Blocos antigos pre.cmd (ainda suportados) ---------- */
  document.querySelectorAll("pre.cmd").forEach(function (pre) {
    var linhas = pre.textContent.replace(/^\n+|\s+$/g, "").split("\n"), continua = false, copiaveis = [];
    pre.innerHTML = linhas.map(function (l) {
      var out;
      if (/^\s*#/.test(l)) out = '<span class="cmt">' + esc(l) + "</span>";
      else if (continua || l.trim() === "") { out = esc(l); copiaveis.push(l); }
      else { out = '<span class="prompt">$ </span>' + esc(l); copiaveis.push(l); }
      continua = /\\\s*$/.test(l);
      return out;
    }).join("\n");
    botaoCopiar(pre, copiaveis.join("\n"));
  });
  document.querySelectorAll("pre.file").forEach(function (pre) {
    botaoCopiar(pre, pre.textContent.replace(/^\n+|\s+$/g, ""));
  });

  /* ---------- Experimente: carrega o simulador só quando necessário ---------- */
  var tries = document.querySelectorAll(".try, .tryscript, .tryjava, .tryjshell");
  if (tries.length) {
    tries.forEach(function (t) {
      if (!t.querySelector(".try-head")) t.insertBefore(el("p", { "class": "try-head" }, t.classList.contains("tryjava") ? "Experimente: edite e rode o código" : t.classList.contains("tryjshell") ? "Experimente no JShell" : t.classList.contains("tryscript") ? "Experimente: edite e rode o script" : "Experimente você mesmo"), t.firstChild);
    });
    var s = el("script", { src: "assets/javasim.js" });
    body.appendChild(s);
  }

  /* ---------- Exercícios de completar ----------
     <div class="exercise"><div class="ex-code">ls <input data-answer="-a|-A"> ~</div></div> */
  document.querySelectorAll(".exercise").forEach(function (ex) {
    var inputs = ex.querySelectorAll(".ex-code input");
    if (!inputs.length) return;
    inputs.forEach(function (i) {
      i.setAttribute("autocomplete", "off");
      i.setAttribute("spellcheck", "false");
      i.setAttribute("autocapitalize", "off");
      var maior = 0;
      i.getAttribute("data-answer").split("|").forEach(function (r) { maior = Math.max(maior, r.length); });
      i.style.width = Math.max(4, maior + 2) + "ch";
    });
    var acoes = el("div", { "class": "ex-actions" },
      '<button type="button" class="ex-check">Verificar</button>' +
      '<button type="button" class="secondary ex-show">Mostrar resposta</button>' +
      '<span class="ex-result" aria-live="polite"></span>');
    ex.appendChild(acoes);
    var res = acoes.querySelector(".ex-result");
    function norm(s) { return s.trim().replace(/\s+/g, " "); }
    acoes.querySelector(".ex-check").addEventListener("click", function () {
      var tudo = true;
      inputs.forEach(function (i) {
        var certas = i.getAttribute("data-answer").split("|").map(norm);
        var ok = certas.indexOf(norm(i.value)) !== -1;
        i.classList.toggle("ok", ok);
        i.classList.toggle("bad", !ok);
        if (!ok) tudo = false;
      });
      res.textContent = tudo ? "Correto!" : "Ainda não. Tente de novo.";
      res.className = "ex-result " + (tudo ? "ok" : "bad");
    });
    acoes.querySelector(".ex-show").addEventListener("click", function () {
      inputs.forEach(function (i) {
        i.value = i.getAttribute("data-answer").split("|")[0];
        i.classList.remove("bad"); i.classList.add("ok");
      });
      res.textContent = "";
    });
    inputs.forEach(function (i) {
      i.addEventListener("keydown", function (e) { if (e.key === "Enter") acoes.querySelector(".ex-check").click(); });
    });
  });

  /* ---------- Múltipla escolha ----------
     <div class="mc" data-answer="2"><p class="mc-q">…</p><label><input type="radio" name="q1"> …</label>…</div> */
  document.querySelectorAll(".mc").forEach(function (mc) {
    var certa = parseInt(mc.getAttribute("data-answer"), 10) - 1;
    var labels = mc.querySelectorAll("label");
    var fb = el("p", { "class": "mc-feedback", "aria-live": "polite" });
    mc.appendChild(fb);
    labels.forEach(function (lb, n) {
      lb.querySelector("input").addEventListener("change", function () {
        labels.forEach(function (x) { x.classList.remove("ok", "bad"); });
        if (n === certa) { lb.classList.add("ok"); fb.textContent = "Correto!"; fb.style.color = "var(--ok)"; }
        else { lb.classList.add("bad"); fb.textContent = "Não é essa. Tente outra opção."; fb.style.color = "var(--bad)"; }
        var placar = document.getElementById("placar");
        if (placar) placar.textContent = document.querySelectorAll(".mc label.ok").length + " de " + document.querySelectorAll(".mc").length;
      });
    });
  });
})();
