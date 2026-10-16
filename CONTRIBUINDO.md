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

## 4. O simulador (`assets/javasim.js`) — sendo construído em paralelo
Um interpretador de **Java (subconjunto grande do Java 25)** em JavaScript, comparado automaticamente com o JDK real. Ele cobre o que as aulas dos níveis 1–3 usam: tipos primitivos com a aritmética exata do Java (overflow de `int`/`long`, divisão inteira, `char` como número, `double` impresso como o Java imprime), `String` e seus métodos, `StringBuilder`, `Math`, `Random` (mesma sequência do Java com a mesma semente), `Scanner(System.in)`, arrays, controle de fluxo (incl. `switch` com setas e `yield`, `for-each`, rótulos), métodos, recursão, classes, construtores, herança, interfaces (com `default`), classes abstratas, internas e anônimas, `enum`, `record`, `sealed`, `instanceof` com padrão, `switch` com padrões, exceções (checked/unchecked, `try/catch/finally`, try-with-resources, stack trace no formato real), generics, coleções (`ArrayList`, `LinkedList`, `HashMap`, `HashSet`, `TreeMap`, `TreeSet`, `ArrayDeque`, `Iterator`, `Collections`, `Arrays`, `List.of`…), lambdas, interfaces funcionais, referências de métodos, `Stream` (incl. `Collectors`), `Optional`, `String.format`/`printf`, text blocks, `var`, wrappers e autoboxing, `java.time` (o básico), `BigDecimal`/`BigInteger` (o básico), `Files`/`Path` num sistema de arquivos fictício. **Erros de compilação** comuns com a mensagem exata do `javac` (`cannot find symbol`, `incompatible types`, `';' expected`, `missing return statement`, `variable … might not have been initialized`, `unreachable statement`, `class X is public, should be declared in a file named X.java`, `unreported exception … must be caught or declared to be thrown`…).
**Não faz** (use só `pre.term`): threads reais (a aula de threads usa saídas reais e o simulador roda as tarefas em sequência — confira o contrato atualizado nesta seção quando ele ficar pronto), reflexão completa, JDBC, rede, interface gráfica, Maven/Gradle.

Quando `tools/testar-missoes.js` existir: `node tools/testar-missoes.js suas-paginas.html` (roda a solução no simulador e no JDK real e compara).

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
