# Como escrever uma página do Guia Java

O guia é uma **escola**, estilo W3Schools, para quem **nunca programou**. Cada aula trata de **um assunto só** (o dono do projeto reclamou de outro guia que juntava vários comandos numa página). Nunca mostre código "seco": explique cada linha (anatomia), mostre a saída real, o que acontece quando dá errado (com a mensagem real do `javac` ou da exceção) e deixe o leitor praticar no editor do guia. Toda saída foi produzida por um **JDK 25 de verdade** (seção 5).

## 1. Esqueleto do arquivo

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Java TEMA — descrição curta | Guia Java</title>
<meta name="description" content="Uma frase sobre a página.">
<link rel="stylesheet" href="assets/style.css">
<script>try{var t=localStorage.getItem("tema");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
</head>
<body>
<div class="layout">
<nav class="sidebar" id="sidebar" aria-label="Tópicos"></nav>
<main class="main">
<div class="content">
<div class="pager"></div>
<h1>Java <span class="hl">TEMA</span></h1>
… conteúdo …
<div class="pager"></div>
</div>
</main>
</div>
<script src="assets/site.js"></script>
</body>
</html>
```
Menu, selo de nível e Anterior/Próximo vêm de `assets/site.js` (lista `NIVEIS`). **Não mude a `NIVEIS`**; links internos só para páginas dela.

## 2. Ordem de uma aula
1. **Intro** (`p.intro`), 2–3 frases. 2. **"Você vai aprender"** (`div.note`). 3. **A ideia antes do código**, com uma comparação do dia a dia. 4. **Do simples ao completo**, uma novidade por vez; cada trecho novo ganha uma `dl.anatomy` ou uma tabela "linha → o que faz". 5. **Saída real** depois de cada exemplo, explicada. 6. **Experimente** (`.tryjava`/`.tryjshell`) — **pelo menos dois por aula** (o W3Schools tem um "Try it Yourself" em quase todo exemplo; queremos o mesmo). 7. **Formas diferentes** + tabela "qual usar". 8. **Quando dá errado** (`div.cenario`): o código errado, a mensagem real do `javac`/exceção, o que ela quer dizer, como consertar. 9. **Referência** (`table.ref`). 10. **Exercícios** (3+: `.exercise` e `.mc`). 11. **Resumo**.

## 3. Componentes

### Código Java (só para ler)
```html
<pre class="file" data-file="Main.java">public class Main {
    public static void main(String[] args) {
        System.out.println("Olá, mundo!");
    }
}
</pre>
```
Escape `&lt; &gt; &amp;` dentro de `<pre>` (generics: `List&lt;String&gt;`).

### Terminal (`pre.term`)
Igual aos outros guias: `$ ` = comando (vira `ana@notebook:~$`), `> ` = continuação, `«` = anotação. Use para `javac`, `java`, `jshell`, `mvn`, `gradle`. Para sessões do JShell, o prompt é o do próprio JShell (`jshell> `) e aparece como saída: comece a sessão com `$ jshell` e copie o que o JShell mostra.

### Editor "Experimente" (`.tryjava`) — o "Try it Yourself" do guia
```html
<div class="tryjava" data-goal="out:Olá, Ana!">
<p class="try-task"><strong>Missão:</strong> troque "mundo" por "Ana" e clique em Rodar.</p>
<pre class="script">public class Main {
    public static void main(String[] args) {
        System.out.println("Olá, mundo!");
    }
}
</pre>
<pre class="solucao">public class Main {
    public static void main(String[] args) {
        System.out.println("Olá, Ana!");
    }
}
</pre>
</div>
```
- O leitor edita e clica em **Rodar**: o simulador "compila" (mostrando erros no formato do `javac`) e executa, exibindo a saída, as exceções (no formato real `Exception in thread "main" …`) e o código de saída.
- `data-file="Conta.java"` muda o nome do arquivo (a classe pública precisa ter o mesmo nome — como no Java real). Padrão: `Main.java`.
- `data-stdin="Ana\n29\n"`: entrada para o `Scanner` nos testes e no "Rodar solução"; no navegador, sem isso, o leitor digita num campo.
- `data-args="Ana 29"`: argumentos do `main`.
- Sem `data-goal`: caixa livre ("brinque com o código"). Com `data-goal`: missão; `pre.solucao` **obrigatório**.
- Vários arquivos: use vários `<pre class="script" data-file="…">` dentro da mesma caixa (abas).

### JShell no navegador (`.tryjshell`)
```html
<div class="tryjshell" data-goal="out:15">
<p class="try-task"><strong>Missão:</strong> calcule 7 + 8.</p>
<pre class="solucao">7 + 8</pre>
</div>
```
Um console que avalia expressões e declarações como o JShell real (`$1 ==> 15`, `x ==> 10`, `|  Error:`…). `pre.solucao` = linhas digitadas.

### Metas (`data-goal`, separadas por vírgula; `\,` para vírgula literal)
| Meta | Verdade quando… |
| --- | --- |
| `out:TEXTO` | a saída contém o texto |
| `outre:REGEX` | a saída casa com a regex |
| `err:TEXTO` | a saída de erro (exceção ou `System.err`) contém o texto |
| `compila` | o código compila sem erros |
| `erro-javac:TEXTO` | o código **não** compila e a mensagem do `javac` contém o texto (para missões "provoque o erro") |
| `excecao:NOME` | o programa termina com essa exceção (`ArithmeticException`) |
| `exit:N` | código de saída N (`System.exit(N)`; exceção não tratada = 1) |
| `src:REGEX` | o código do leitor casa com a regex (exigir um recurso: `src:\bfor\s*\(`) |

### Outros blocos
`dl.anatomy`, `div.note/.tip/.warning/.cenario`, `ol.passo`, `div.table-wrap > table.ref`, `.exercise > .ex-code > input[data-answer]`, `.mc[data-answer]`, `figure > img + figcaption` (imagens em `img/`).

## 4. O simulador (`assets/javasim.js` + `assets/javasim-lib.js`)
Um interpretador de **Java 25** em JavaScript: lexer → parser → verificação de tipos e de fluxo (os erros saem no formato exato do `javac`) → execução com a semântica do Java. Ele é comparado com o JDK real por uma bateria diferencial (`tools/testes/`, ~350 programas, 98% idênticos). O painel mostra `$ javac Main.java` (ou `javac Main.java Livro.java` com abas) e `$ java Main`, a saída, os erros em vermelho e `[código de saída: N]`.

**Cobre:** tipos primitivos com a aritmética exata (overflow de `int`/`long`, divisão inteira, `%` com negativos, `char` como número, `double`/`float` impressos como `Double.toString`/`Float.toString`), `String` (pool: literais e constantes internados × `new String`/concatenação em tempo de execução), `StringBuilder`, `Math`, wrappers e cache de `Integer` (-128..127), `Random` (mesmo algoritmo do JDK: mesma sequência com a mesma semente; `shuffle` idem), `Scanner(System.in)` com locale pt_BR (`3,5`; `nextInt` + `nextLine`), `BufferedReader`, `IO.println/readln`, `printf`/`String.format` em pt_BR (`%.2f` → `3,14`, `%,d` → `1.234.567`), arrays, todo o controle de fluxo (rótulos, `switch` clássico, com setas, `yield`, padrões, record patterns, `when`), métodos, sobrecarga (as 3 fases do javac), varargs, recursão, classes, construtores (inclusive os flexíveis do Java 25), `static`/inicializadores, herança, `super`, sobrescrita, polimorfismo, abstratas, interfaces (`default`/`static`/`private`), internas, anônimas e locais, `enum` (corpos, `values`, `valueOf`, `EnumMap`), `record` (compacto), `sealed`/`permits`, `instanceof` com padrão, generics com inferência, exceções (hierarquia real, checked/unchecked verificadas pelo javac, `try/catch/finally`, multi-catch, try-with-resources com suprimidas, causas e `... N more`, NPE com a mensagem detalhada `"<local1>"`, `StackOverflowError`, frames internos do JDK nas exceções da biblioteca), coleções (`ArrayList`, `LinkedList`, `ArrayDeque`, `PriorityQueue`, `Stack`, `HashMap`/`HashSet` com a **mesma ordem de iteração do JDK**, `LinkedHashMap` (inclusive LRU), `TreeMap`/`TreeSet`, `Iterator`, `ConcurrentModificationException`, `List.of`/`Map.of`/`Set.of` imutáveis, `Collections`, `Arrays`), lambdas, interfaces funcionais, referências de métodos, `Stream`/`IntStream`/`DoubleStream` preguiçosos, `Collectors` (groupingBy, partitioningBy, toMap, joining, summarizing…), `Optional`, text blocks, `var`, `java.time` (relógio fixo: **15/10/2026 10:30**, America/Sao_Paulo), `DateTimeFormatter` (pt_BR, modo SMART), `BigDecimal`/`BigInteger`, `NumberFormat`/`DecimalFormat` (`R$ 1.234,56` com espaço U+00A0), regex (`Pattern`/`Matcher`), `Files`/`Path`/`File`/`FileWriter`/`PrintWriter` num sistema de arquivos fictício (a pasta da Ana, que volta ao original a cada Rodar), `System.exit`, `System.err`, `Thread.sleep` (instantâneo), o `main` do Java 25 (`void main()`, arquivo compacto com `import module java.base` implícito) e o JShell (`.tryjshell`: `$1 ==> 15`, `x ==> 10`, `|  created method…`, `|  Error:`, `|  Exception…`, `/vars`, `/list`, `/methods`, `/types`, `/exit`).

**Erros do javac** com texto, linha e `^` idênticos: `cannot find symbol` (com `symbol:`/`location:`), `incompatible types` (inclusive `possible lossy conversion`, `bad type in conditional/switch expression`, `bad return type in lambda expression`, limites incompatíveis de inferência), `';' expected`, `')' expected`, `'(' expected`, `illegal start of expression`, `not a statement`, `reached end of file while parsing`, `unclosed string literal`, `'else' without 'if'`, `class X is public, should be declared in a file named X.java`, `missing return statement`, `unreachable statement`, `variable x might not have been initialized`, `cannot assign a value to final variable`, `final parameter x may not be assigned`, `variable x is already defined in method main(String[])`, `non-static variable/method … cannot be referenced from a static context`, `bad operand types for binary operator`, `incomparable types`, `method … cannot be applied to given types;`, `no suitable method found`, `reference to … is ambiguous`, `… has private access in …`, `X is abstract; cannot be instantiated`, `X is not abstract and does not override abstract method`, `method does not override or implement a method from a supertype`, `attempting to assign weaker access privileges`, `unreported exception X; must be caught or declared to be thrown`, `exception X is never thrown in body of corresponding try statement`, `local variables referenced from a lambda expression must be final or effectively final`, `the switch expression does not cover all possible input values`, `duplicate case label`, `class is not allowed to extend sealed class`, `recursive constructor invocation`, as notas `uses unchecked or unsafe operations` / `deprecated API` / `Some messages have been simplified` e o aviso de varargs. Como no javac real, erros de sintaxe param a compilação antes dos de tipo, e erros de tipo escondem os de fluxo.

**Diferenças conhecidas (não use em missões que comparam texto):**
- **Threads**: tudo roda numa thread só, de forma determinística. `Thread.start()` executa a tarefa até o fim na hora; `ExecutorService`/`CompletableFuture` executam as tarefas em sequência (nomes `pool-1-thread-1`, `ForkJoinPool.commonPool-worker-1`); `synchronized`/locks/`AtomicInteger` funcionam, mas condições de corrida **nunca** aparecem. A aula de threads mostra saídas reais em `pre.term` e usa o editor só para o que é determinístico.
- `Object.hashCode()`/`toString()` padrão (`Main@1b6d3586`, `[I@…`): valores fictícios estáveis, diferentes dos da JVM. `Set.of`/`Map.of` iteram numa ordem fixa (na JVM real ela muda a cada execução).
- Mensagens do lançador em `java Main` (classe), não `java Main.java` (arquivo-fonte): o `ClassCastException` diz `… loader 'app'`, e `printStackTrace` não tem as linhas `SourceLauncher`.
- Recursão profunda: o `StackOverflowError` aparece por volta de 2–3 mil chamadas (a JVM aguenta ~10 mil); o painel resume as 1024 linhas iguais do stack trace (o texto copiado/testado tem as 1024).
- Erros de sintaxe raros: o simulador para no primeiro erro que não sabe recuperar (o javac às vezes lista mais 1–2 erros em cascata). `System.out.println(stream.collect(...))` com inferência ambígua compila no simulador e não no javac real (raro).
- Laço infinito: o simulador interrompe depois de 10 milhões de passos com a mensagem `(simulador) execução interrompida…` (código 130). Leitura do teclado: o programa é executado de novo do início a cada linha digitada (é invisível, mas efeitos como `Math.random()` se repetem igual).
- Reflexão completa, anotações em tempo de execução, JDBC, rede, interface gráfica, módulos, serialização, Maven/Gradle: não existem (use `pre.term`).

**Ferramentas:**
- `node tools/testar-missoes.js suas-paginas.html` — para cada `.tryjava`: a meta **não** é cumprida pelo código inicial e **é** cumprida pela solução; a solução roda também no JDK do laboratório (`javac` + `java Main`, mesma `data-stdin`/`data-args`) e as saídas são comparadas (cache em `tools/.cache-missoes.json`). `--sem-lab` pula o laboratório; `-v` mostra a saída do simulador. `data-comparar="nao"` na caixa pula a comparação. Em `.tryjshell`, a solução é digitada no JShell do simulador e a meta é conferida.
- `node tools/sim.js Main.java [Outro.java] [--stdin 'Ana\n29\n'] [-- args]` mostra exatamente o que o painel mostraria; `node tools/sim.js --jshell sessao.txt` faz o mesmo para o JShell.
- `node tools/testes/rodar.js [filtro] [--diff]` roda a bateria diferencial (simulador × JDK real).
- Metas: `src:` olha **todas** as abas; `outre:`/`src:` são regex JavaScript completas (lookahead, `\n`…); as entidades HTML do atributo são decodificadas (`&quot;`, `&gt;`). Em `.tryjshell`, `out:` olha tudo o que o console mostrou (feedback e saída).

## 5. Fidelidade: o laboratório (`~/guia-java-lab/lab`)
A máquina da Ana do Guia Bash (usuária `ana`, `notebook`, `/home/ana`, pt_BR) com **Temurin JDK 25.0.4.1 LTS** em `/opt/jdk-25`, **Maven 3.10.0** em `/opt/maven` e **Gradle 9.8.1** em `/opt/gradle` (todos no `PATH`, `JAVA_HOME=/opt/jdk-25`). Nada de rodar Java direto no computador real (ele tem o Oracle JDK 26 como padrão, que dá saídas diferentes).
```bash
L=~/guia-java-lab/lab
# sessão no formato do pre.term:
printf '%s\n' 'mkdir -p java && cd java' "cat > Main.java <<'FIM'" 'public class Main {' '    public static void main(String[] args) {' '        System.out.println(10 / 3);' '    }' '}' 'FIM' 'javac Main.java && java Main' | $L -n SEUNOME -i
# rodar um programa direto (modo "arquivo-fonte", Java 11+):
$L -n SEUNOME -- bash -c 'cd java && java Main.java'
printf '%s\n' '7 + 8' 'int x = 10' 'x * 2' '/exit' | $L -n SEUNOME -- jshell -q    # sessão do JShell
```
- `-n SEUNOME`: sua pasta própria (`~/guia-java-lab/homes/SEUNOME`); `-r` recomeça do zero. `-t` dá um terminal de verdade.
- Fatos já conferidos: o **`javac` fala inglês** (não há tradução pt_BR): `error: incompatible types: String cannot be converted to int`, `1 error`; o **lançador `java` mistura**: mensagens próprias em português — no Temurin 25 com tradução embaralhada (`Erro: o método main não é Sem na classe javafx.application.Application; defina o método main como:`; o OpenJDK do Ubuntu dá `Erro: o método main não foi encontrado na classe Sem; …`) e `Erro: Não foi possível localizar nem carregar a classe principal Main` + `Causada por: java.lang.ClassNotFoundException: Main` — e as das exceções em inglês (`Exception in thread "main" java.lang.ArithmeticException: / by zero` + `\tat Ola.main(Ola.java:4)`). Locale padrão: `pt_BR` → **`printf("%.2f")` usa vírgula** (`3,14`) e `String.format` também; `System.out.println(3.14)` usa ponto. `mvn -version` mostra `Default locale: pt_BR`.
- O laboratório é leve, mas JVMs gastam memória: rode um programa por vez, com `timeout 60`, e nunca laços infinitos sem limite. Para medir desempenho, números pequenos.
- **Privacidade:** nunca use dados da máquina real (nomes de rede, MACs, IPs, usuário `wallyson`). Os exemplos acontecem na máquina fictícia da Ana.

### Versões
O guia ensina o **Java 25 LTS**. Quando um recurso é novo, marque com `<span class="versao">Java 21+</span>` (etc.) e diga a alternativa. Referências: 8 (2014, ainda em sistemas antigos), 11, 17, 21 e 25 são LTS; recursos-chave: `var` (10), text blocks (15), records (16), `switch` com setas (14), pattern matching de `instanceof` (16), classes seladas (17), padrões no `switch` e record patterns (21), threads virtuais (21), `main` simplificado e `IO.println` (25 — "compact source files"/"instance main methods"; confira no JDK do laboratório o que é final no 25 e mostre as duas formas).

## 6. Escrita
- Português do Brasil, frases curtas; fale com o leitor ("você"). O leitor **nunca programou**: explique o que é uma variável, um método, uma classe, como se fosse a primeira vez.
- Nomes em inglês do Java ganham tradução e origem (`static` = estático, "da classe"; `void` = vazio, "não devolve nada").
- Exemplos com a vida da Ana (notas de alunos, frutas, contas, uma loja), não `foo`/`bar`.
- Toda saída de erro é a real; código que não compila é marcado com um aviso visual ("este código tem um erro de propósito").
