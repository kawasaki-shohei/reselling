#!/usr/bin/env python3
"""
コンタクトシート生成スクリプト

用途:
  procedures/cheapest-price-research.md の第 4 段階 4-2 で使う。
  検索 API で取得した 60 件のサムネ画像を、20 件 × 3 シートのコンタクトシート
  PNG に並べる。各セルには rank (index) と価格をオーバーレイ表示する。
  Sonnet (第 4 段階 1 次フィルタ) が対象画像と並べて比較しやすい形にすることが目的。

使い方:
  cheapest-price-research/run-python.sh cheapest-price-research/contact-sheet-builder.py \
    --thumbs-dir <path> \
    --rivals-json <path> \
    --output-dir <path> \
    --page <int>

  run-python.sh は環境ごとに適切な python3 を自動選択するラッパー (macOS は .venv、
  Cowork サンドボックスは system python3)。詳細は run-python.sh のヘッダ参照。

例:
  cheapest-price-research/run-python.sh cheapest-price-research/contact-sheet-builder.py \
    --thumbs-dir cheapest-price-research/runs/2026_05_25_13_00/items/FD00101/thumbs/page_01 \
    --rivals-json cheapest-price-research/runs/2026_05_25_13_00/items/FD00101/rivals/page_01.json \
    --output-dir cheapest-price-research/runs/2026_05_25_13_00/items/FD00101/sheets \
    --page 1

出力:
  output_dir 配下に page_NN_sheet_{1,2,3}.png を最大 3 枚生成。
  各シート: 5 列 × 4 行 = 20 セル。1 セル 400×500 (画像 400×400 + ラベル領域 100)。
  画像 60 件未満の場合、足りないシートは生成しない。

依存:
  Pillow (cheapest-price-research/requirements.txt)
  Cowork サンドボックスは Pillow プリインストール済み、setup 不要。
  ローカル macOS のみ初回セットアップ要:
    python3 -m venv cheapest-price-research/.venv
    cheapest-price-research/.venv/bin/pip install -r cheapest-price-research/requirements.txt

stdout: summary JSON
"""

import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


CELL_W = 400
CELL_H = 500
IMAGE_H = 400
LABEL_H = 100
COLS = 5
ROWS = 4
ITEMS_PER_SHEET = COLS * ROWS  # = 20
SHEETS_PER_PAGE = 3  # 60 件 / 20 件

SHEET_W = CELL_W * COLS
SHEET_H = CELL_H * ROWS


def load_font(size: int):
    """日本語が出るフォントを優先的に探す。"""
    candidates = [
        "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def build_sheet(sheet_items, thumbs_dir: Path, output_path: Path):
    """1 枚のシート PNG を書き出す。sheet_items は最大 20 件。"""
    canvas = Image.new("RGB", (SHEET_W, SHEET_H), "white")
    draw = ImageDraw.Draw(canvas)
    font_rank = load_font(48)
    font_price = load_font(28)
    font_title = load_font(20)

    for i, item in enumerate(sheet_items):
        col = i % COLS
        row = i // COLS
        x = col * CELL_W
        y = row * CELL_H

        rank_str = f"{item['rank']:02d}"
        thumb_path = thumbs_dir / f"{rank_str}.jpg"

        # 画像エリア
        if thumb_path.exists():
            try:
                img = Image.open(thumb_path).convert("RGB")
                img = img.resize((CELL_W, IMAGE_H), Image.LANCZOS)
                canvas.paste(img, (x, y))
            except Exception as e:
                draw.rectangle([x, y, x + CELL_W, y + IMAGE_H], outline="red", width=4)
                draw.text((x + 10, y + 10), f"ERR {e}", fill="red", font=font_title)
        else:
            draw.rectangle([x, y, x + CELL_W, y + IMAGE_H], outline="gray", width=2)
            draw.text((x + 10, y + 10), "NO IMG", fill="gray", font=font_title)

        # 左上に rank を黒下地白文字でオーバーレイ (目立たせる)
        bbox = draw.textbbox((0, 0), rank_str, font=font_rank)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        pad = 8
        draw.rectangle(
            [x + 5, y + 5, x + 5 + tw + pad * 2, y + 5 + th + pad * 2],
            fill="black",
        )
        draw.text((x + 5 + pad, y + 5 + pad - 4), rank_str, fill="white", font=font_rank)

        # ラベル領域 (画像下、白下地)
        label_y = y + IMAGE_H
        draw.rectangle([x, label_y, x + CELL_W, y + CELL_H], fill="white", outline="#ccc")
        draw.text((x + 10, label_y + 5), f"¥{item['price']:,}", fill="black", font=font_price)

        title_str = item.get("name", "") or ""
        line1 = title_str[:20]
        line2 = title_str[20:40] if len(title_str) > 20 else ""
        line3 = title_str[40:60] if len(title_str) > 40 else ""
        draw.text((x + 10, label_y + 40), line1, fill="#333", font=font_title)
        draw.text((x + 10, label_y + 62), line2, fill="#333", font=font_title)
        draw.text((x + 10, label_y + 80), line3, fill="#333", font=font_title)

    canvas.save(output_path, "PNG")


def main():
    parser = argparse.ArgumentParser(description="Build contact sheets for Mercari rival thumbnails.")
    parser.add_argument("--thumbs-dir", required=True, help="Directory containing {rank:02d}.jpg files")
    parser.add_argument("--rivals-json", required=True, help="Search API output JSON (rivals/page_NN.json)")
    parser.add_argument("--output-dir", required=True, help="Output directory for sheet PNGs")
    parser.add_argument("--page", type=int, required=True, help="Page number (1-based)")
    args = parser.parse_args()

    thumbs_dir = Path(args.thumbs_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(args.rivals_json, "r", encoding="utf-8") as f:
        rivals = json.load(f)
    items = rivals.get("items", [])

    sheets_out = []
    for sheet_no in range(1, SHEETS_PER_PAGE + 1):
        start = (sheet_no - 1) * ITEMS_PER_SHEET
        chunk = items[start:start + ITEMS_PER_SHEET]
        if not chunk:
            break
        out_path = output_dir / f"page_{args.page:02d}_sheet_{sheet_no}.png"
        build_sheet(chunk, thumbs_dir, out_path)
        sheets_out.append({
            "sheet": sheet_no,
            "path": str(out_path),
            "items": len(chunk),
            "rank_range": [chunk[0]["rank"], chunk[-1]["rank"]],
        })

    print(json.dumps({
        "page": args.page,
        "total_items": len(items),
        "sheets_generated": len(sheets_out),
        "sheets": sheets_out,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
