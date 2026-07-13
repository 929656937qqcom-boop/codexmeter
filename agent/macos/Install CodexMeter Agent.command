#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/Library/Application Support/CodexMeter Agent"
PLIST="$HOME/Library/LaunchAgents/com.codexmeter.agent.plist"
LOG="$HOME/Library/Logs/CodexMeter Agent.log"

mkdir -p "$TARGET" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$ROOT/Resources/node" "$TARGET/node"
cp "$ROOT/Resources/agent.cjs" "$TARGET/agent.cjs"
chmod 700 "$TARGET/node"

echo "CodexMeter Agent 将读取本机 ~/.codex 日志，只上传匿名 Token 汇总。"
read -r -p "请输入已有设备生成的 8 位配对码: " PAIR_CODE
"$TARGET/node" "$TARGET/agent.cjs" pair "$PAIR_CODE"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.codexmeter.agent</string>
  <key>ProgramArguments</key><array><string>$TARGET/node</string><string>$TARGET/agent.cjs</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF

launchctl bootout "gui/$UID/com.codexmeter.agent" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/com.codexmeter.agent"

echo
echo "安装完成。CodexMeter Agent 已在后台运行，每 5 分钟自动同步。"
echo "日志位置: $LOG"
read -r -p "按回车关闭窗口..." _
