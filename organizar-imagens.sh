#!/usr/bin/env bash
# Movix: move todas as imagens/favicons da raiz para img/ (mantendo os nomes)
# e confere se cada imagem referenciada em index.html, style.css e *.js existe.
# Rode na RAIZ do repositório:  bash organizar-imagens.sh
set -u
IMAGENS="apple-touch-icon.png favicon-16.png favicon-32.png favicon.ico icon-192.png icon-512.png logo-movix-finance-540.png logo-movix-finance.png logo-movix-oficial.png logo-movix-simbolo.png"

mkdir -p img
for f in $IMAGENS; do
  if [ -f "$f" ]; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git mv "$f" "img/$f"; else mv "$f" "img/$f"; fi
    echo "movido:      $f -> img/$f"
  elif [ -f "img/$f" ]; then
    echo "já em img/:  $f"
  else
    echo "AVISO: não encontrado: $f"
  fi
done

echo; echo "== Conferindo referências =="
erros=0
# src="..." / href="..." (html) e url(...) (css) apontando para imagens
refs=$(grep -ohE "(src|href)=\"[^\"#?]+\.(png|ico|jpe?g|gif|svg|webp)(\?[^\"]*)?\"|url\(['\"]?[^)'\"]+\.(png|ico|jpe?g|gif|svg|webp)[^)]*\)" index.html style.css *.js 2>/dev/null \
  | sed -E "s/^(src|href)=\"//; s/\"$//; s/^url\(['\"]?//; s/['\"]?\)$//; s/\?.*$//" | sort -u)
for r in $refs; do
  case "$r" in http*|//*|data:*) continue;; esac
  if [ -f "$r" ]; then echo "OK        $r"; else echo "FALTA     $r"; erros=$((erros+1)); fi
done
# imagens que ainda sobraram na raiz
sobra=$(ls *.png *.ico *.jpg *.jpeg *.gif *.svg *.webp 2>/dev/null)
[ -n "$sobra" ] && { echo "AVISO: imagens ainda na raiz: $sobra"; erros=$((erros+1)); }
echo; [ $erros -eq 0 ] && echo "Tudo certo: todas as imagens referenciadas existem em img/." || echo "Há $erros problema(s) acima."
exit $erros
