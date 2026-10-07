#!/bin/bash
# Duplo clique neste arquivo (Finder) para abrir o harness no navegador.
# Ele sobe um servidor local na pasta do projeto (o navegador não deixa
# rodar o Worker direto de file://). Feche esta janela do Terminal para parar.
cd "$(dirname "$0")/.."
PORT=8765
( sleep 1; open "http://localhost:$PORT/harness/" ) &
echo "Harness em http://localhost:$PORT/harness/  (Ctrl+C para parar)"
python3 -m http.server $PORT
