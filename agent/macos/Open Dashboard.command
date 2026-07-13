#!/bin/bash
set -euo pipefail
TARGET="$HOME/Library/Application Support/CodexMeter Agent"
if [ ! -x "$TARGET/node" ]; then
  echo "请先运行 Install CodexMeter Agent.command"
  read -r -p "按回车关闭窗口..." _
  exit 1
fi
"$TARGET/node" "$TARGET/agent.cjs" dashboard
read -r -p "同步凭据已复制，粘贴到网页后按回车关闭窗口..." _
