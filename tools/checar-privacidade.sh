#!/usr/bin/env bash
# Varre páginas e o histórico do git atrás de dados pessoais.
# A lista extra (valores de uma máquina específica) fica FORA do
# repositório. Use PROIBIDO=lista.txt para incluí-la. Não versione
# a lista.
# "re:" = expressão regular (grep -P), sem diferenciar maiúsculas.
set -u
cd "$(dirname "$0")/.."
LISTA="${PROIBIDO:-}"

padroes=()
# /home/<nome>, menos a usuária de exemplo ana e nomes claramente
# fictícios ou pastas que não são contas (destinos do makepkg, pastas
# de runtime do editor, testes do guia).
padroes+=("re:/home/(?!ana\\b|bia\\b|bruno\\b|nome\\b|novo\\b|seu-nome\\b|teste-[a-z0-9-]+\\b|custompkgs\\b|packages\\b|sources\\b|srcpackages\\b|Downloads\\b|Documentos\\b|web_user\\b|pyodide\\b|node_modules\\b|c\\b)[A-Za-z_][A-Za-z0-9_-]*")
# Pasta de trabalho da máquina de coleta (não casa workspace.xml).
padroes+=("re:/workspace(?![A-Za-z0-9._-])")
# Conta ou prompt com este usuário (localhost, notebook, etc.).
# Não casa wallysondevs@…
padroes+=("re:wallyson@(?!users\\.noreply)")
# C:\Users\<nome> e /Users/<nome>, menos ana / Public / Default e
# os placeholders seu-nome, {nome} e reticências.
padroes+=("re:C:\\\\Users\\\\(?!ana\\b|Public\\b|Default\\b|seu-nome\\b|\\{nome\\}|…|\\.\\.\\.)[^\\\\s\\\\/<>\"]+")
padroes+=("re:/Users/(?!ana\\b|Shared\\b|Guest\\b|seu-nome\\b)[A-Za-z][^/\\s\"<>]*")
# IPv4 privado, fora dos exemplos documentados:
# 192.168.0.* (ilustrativos), 10.0.2.* (NAT padrão do VirtualBox),
# 192.168.122.* (NAT padrão do libvirt), 192.168.50.* (laboratório
# Wi-Fi do guia), 10.0.0.5, 10.0.0.8 e 172.16.4.2 (IPs inventados
# de log), 10.0.168.192 (inversão de 192.168.0.10 no exemplo do awk),
# 169.254.10.20 e 169.254.10.21. 127.* e 192.0.2.* não são cobertos.
padroes+=("re:(?<![\\d.])(?:10\\.(?!0\\.2\\.|0\\.0\\.5(?![\\d.])|0\\.0\\.8(?![\\d.])|0\\.168\\.192(?![\\d.]))(?:\\d{1,3}\\.){2}\\d{1,3}|172\\.(?!16\\.4\\.2(?![\\d.]))(?:1[6-9]|2\\d|3[0-1])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.(?!0\\.|50\\.|122\\.)\\d{1,3}\\.\\d{1,3}|169\\.254\\.(?!10\\.20(?![\\d.])|10\\.21(?![\\d.]))\\d{1,3}\\.\\d{1,3})(?![\\d.])")
# E-mails, menos @users.noreply.github.com, GitHub/GitLab, domínios
# de exemplo (RFC e os das aulas), unidades systemd/journal e
# endereços públicos de projetos, empacotadores e noreply de ferramentas.
padroes+=("re:[A-Za-z0-9._%+-]+@(?!users\\.noreply\\.github\\.com\\b|github\\.com\\b|gitlab\\.com\\b|(?:[A-Za-z0-9-]+\\.)*(?:example|exemplo|test|teste|invalid|localhost)\\b|(?:email|lojinha|padaria|escola|foo|ex|doe|loja|x|[a-z])\\.(?:com|org|net|com\\.br|edu\\.br|br)\\b|escola\\.edu\\.br\\b|empresa\\.exemplo\\b|archlinux\\.org\\b|aur\\.archlinux\\.org\\b|gnu\\.org\\b|kernel\\.org\\b|vger\\.kernel\\.org\\b|debian\\.org\\b|microsoft\\.com\\b|googlegroups\\.com\\b|kennethreitz\\.org\\b|invisible-island\\.net\\b|whitequark\\.org\\b|mailbox\\.org\\b|anthropic\\.com\\b)[A-Za-z0-9.-]+\\.(?!service\\b|socket\\b|timer\\b|target\\b|scope\\b|slice\\b|device\\b|mount\\b|swap\\b|path\\b|journal\\b)[A-Za-z]{2,}\\b")
# SID de máquina/domínio (não os SID bem conhecidos S-1-5-32-… / S-1-5-18)
padroes+=("re:S-1-5-21-\\d+-\\d+-\\d+(-\\d+)?")
# MAC. Não casa no meio de uma data (2026-06-01-15-21-12-00).
# Libera prefixo 02 (exemplos), nulo, broadcast, e os do laboratório:
# 12:00:00:00:00:00 (hwsim), 52:54:00:12:35:00 (roteador NAT) e
# 3c:a9:f4:12:34:56 (wlan ilustrativa).
padroes+=("re:(?<![0-9A-Fa-f:-])(?!02[:-]|00[:-]00[:-]00[:-]00[:-]00[:-]00\\b|ff[:-]ff[:-]ff[:-]ff[:-]ff[:-]ff\\b|12[:-]00[:-]00[:-]00[:-]00[:-]00\\b|52[:-]54[:-]00[:-]12[:-]35[:-]00\\b|3c[:-]a9[:-]f4[:-]12[:-]34[:-]56\\b)(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])")
# Número de série do volume do dir (Windows)
padroes+=("re:(N[uú]mero de S[eé]rie do Volume|Volume Serial Number).{0,40}[0-9A-F]{4}[-:][0-9A-F]{4}")

if [ -n "$LISTA" ] && [ -f "$LISTA" ]; then
  echo "Usando lista $LISTA (além dos padrões embutidos)."
  while IFS= read -r linha || [ -n "$linha" ]; do
    [[ -z "$linha" || "$linha" == \#* ]] && continue
    padroes+=("$linha")
  done < "$LISTA"
elif [ -n "$LISTA" ]; then
  echo "Lista $LISTA não encontrada; usando só os padrões embutidos."
else
  echo "Nenhuma lista externa (use PROIBIDO=lista.txt para incluir uma). Usando só os padrões embutidos."
fi

# Tipos de texto deste repositório (bins como png/wasm/gz ficam de fora).
includes=(
  --include='*.html' --include='*.js' --include='*.mjs' --include='*.css'
  --include='*.md' --include='*.txt' --include='*.json' --include='*.sh'
  --include='*.yml' --include='*.yaml' --include='*.py' --include='*.c'
  --include='*.h' --include='*.cpp' --include='*.java' --include='*.cs'
  --include='*.csproj' --include='*.props' --include='*.dart'
  --include='*.php' --include='*.sql' --include='*.lua' --include='*.casos'
  --include='*.esperado' --include='*.stdin' --include='*.patch'
  --include='.gitignore' --include='.nojekyll' --include='*.xml'
)

falhou=0
for pad0 in "${padroes[@]}"; do
  if [[ "$pad0" == re:* ]]; then pad="${pad0#re:}"; opt=(-P -i); else pad="$pad0"; opt=(-F -i); fi
  achou=$(grep -rn "${opt[@]}" "${includes[@]}" --exclude-dir=.git --exclude-dir=_saidas --exclude-dir=_saidas-anon --exclude-dir=node_modules --exclude-dir=__pycache__ --exclude-dir=licencas --exclude='checar-privacidade.sh' --exclude='ThirdPartyNotices*' -e "$pad" . | head -5)
  hist=$(git log --all -p -- . ':(exclude)tools/checar-privacidade.sh' ':(exclude)tools/licencas' ':(exclude)*ThirdPartyNotices*' 2>/dev/null | grep -c "${opt[@]}" -e "$pad")
  if [ -n "$achou" ] || [ "$hist" != "0" ]; then
    falhou=1; echo "FALHA: $pad (histórico: $hist)"; [ -n "$achou" ] && echo "$achou"
  fi
done

# "em breve" é só aviso: não falha o checador.
aviso=$(grep -rn -i --include='*.html' --include='*.md' --include='*.js' --include='*.txt' --exclude-dir=.git --exclude-dir=node_modules -e 'em breve' . || true)
if [ -n "$aviso" ]; then
  echo "AVISO: aparece \"em breve\" (não falha o checador):"
  echo "$aviso" | head -10
fi

[ $falhou = 0 ] && echo "OK: nenhuma string proibida nas páginas nem no histórico."
exit $falhou
