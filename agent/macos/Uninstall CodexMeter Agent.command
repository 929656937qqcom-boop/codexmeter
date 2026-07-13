#!/bin/bash
set -euo pipefail
TARGET="$HOME/Library/Application Support/CodexMeter Agent"
PLIST="$HOME/Library/LaunchAgents/com.codexmeter.agent.plist"
launchctl bootout "gui/$UID/com.codexmeter.agent" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$TARGET"
/usr/bin/security delete-generic-password -s com.codexmeter.agent -a sync-credential >/dev/null 2>&1 || true
echo "CodexMeter Agent 已卸载。本机 Codex 日志未被修改。"
read -r -p "按回车关闭窗口..." _
