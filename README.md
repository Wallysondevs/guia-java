<p align="center"><img src="capa.png" alt="Capa do guia-java" width="100%"></p>

# Guia Java

Site: https://wallysondevs.github.io/guia-java/

Curso de Java (Java 25 LTS) em português, do zero ao avançado, feito para quem **nunca programou**. Funciona como uma escola: uma aula para cada assunto, organizadas em **3 níveis + projetos + referência** (140 páginas).

Cada aula explica o código linha por linha (anatomia), mostra a saída real, o que acontece quando dá errado (com a mensagem verdadeira do `javac` ou da exceção), formas diferentes de fazer e exercícios no fim. Todas as saídas foram conferidas num JDK de verdade, o **Temurin JDK 25.0.4.1 LTS**.

Para praticar, as páginas trazem dois tipos de caixa que rodam no navegador:

- **Editor "Experimente"** (`.tryjava`): edite o programa, clique em **Rodar** e veja `javac`, `java`, a saída, os erros em vermelho e o código de saída. Nas **missões**, a caixa confere se você chegou ao resultado.
- **JShell no navegador** (`.tryjshell`): um console que avalia expressões e declarações como o JShell real (`$1 ==> 15`).

As duas usam `assets/javasim.js` (com a biblioteca grande em `assets/javasim-lib.js`), um **interpretador de Java 25 em JavaScript**. Ele verifica os tipos e o fluxo com as mensagens exatas do `javac` e executa o programa com a semântica do Java. É comparado com o JDK real por uma bateria diferencial de cerca de 350 programas, com 98% de saídas idênticas.

Site 100% estático (HTML + CSS + JS, sem build e sem dependências externas): abre direto no navegador e funciona no GitHub Pages.

## Estrutura

```
index.html                 página inicial
<tema>.html                uma aula por tema
assets/style.css           visual
assets/site.js             níveis/menu (lista NIVEIS), Anterior/Próximo, anatomia, exercícios
assets/javasim.js          o simulador de Java + interface do editor e do JShell
assets/javasim-lib.js      a biblioteca do simulador (coleções, streams, java.time, arquivos…)
tools/sim.js               roda um programa no simulador, como o editor do guia
tools/testar-missoes.js    testa todas as caixas (e compara com o JDK real do laboratório)
tools/testes/              bateria diferencial simulador × JDK real
tools/demo.html            página de teste com as caixas .tryjava e .tryjshell
CONTRIBUINDO.md            como escrever uma aula
.nojekyll                  faz o GitHub Pages servir os arquivos como estão
```

## Testes

```bash
node tools/testar-missoes.js --sem-lab       # todas as missões, só no simulador
node tools/testar-missoes.js                 # idem, comparando com o JDK real (precisa do laboratório)
node tools/testes/rodar.js                   # bateria diferencial (usa as saídas do JDK real guardadas do laboratório; --diff mostra as diferenças)
node tools/sim.js Main.java                  # roda um programa como o editor
node tools/sim.js --jshell sessao.txt        # idem, no JShell
bash tools/checar-privacidade.sh             # páginas e histórico; lista extra: PROIBIDO=lista.txt
```

## Publicar no GitHub Pages

Envie a pasta para um repositório e ative **Settings → Pages → Deploy from a branch → main / (root)**.

## Adicionar uma aula

Leia `CONTRIBUINDO.md` e inclua a página na lista `NIVEIS` de `assets/site.js`.
