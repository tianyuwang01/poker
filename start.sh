#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
printf '夜航扑克：http://127.0.0.1:8787\n也可以直接双击 index.html，无需安装依赖。\n'
exec python3 -m http.server 8787 --bind 127.0.0.1
