#!/bin/bash
# Python ラッパー: 環境差を吸収する
#
# - ローカル macOS (Claude Code): cheapest-price-research/.venv (Homebrew Python 3.13 + Pillow) を使う
# - Cowork サンドボックス (Linux): system python3 (3.10 + Pillow 12.1 プリインストール) を使う
#
# 使い方:
#   cheapest-price-research/run-python.sh cheapest-price-research/contact-sheet-builder.py --thumbs-dir ...
#
# どのインタプリタが使われたかは標準エラーに出る (デバッグ用)。

set -e
HERE=$(cd "$(dirname "$0")" && pwd)

if [ -x "$HERE/.venv/bin/python3" ] && "$HERE/.venv/bin/python3" -c "from PIL import Image" 2>/dev/null; then
  echo "[run-python.sh] using venv: $HERE/.venv/bin/python3" >&2
  exec "$HERE/.venv/bin/python3" "$@"
elif command -v python3 >/dev/null && python3 -c "from PIL import Image" 2>/dev/null; then
  echo "[run-python.sh] using system: $(command -v python3)" >&2
  exec python3 "$@"
else
  echo "[run-python.sh] ERROR: 動作可能な python3 + Pillow が見つかりません" >&2
  echo "  - venv 候補: $HERE/.venv/bin/python3 (存在しない or Pillow なし)" >&2
  echo "  - system: $(command -v python3 || echo 'python3 が PATH に無い')" >&2
  echo "  - macOS の場合: python3 -m venv $HERE/.venv && $HERE/.venv/bin/pip install -r $HERE/requirements.txt" >&2
  exit 1
fi
