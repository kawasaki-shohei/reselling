---
name: extension-maintenance-test
description: Chrome拡張 furima-listing-booster-extension の一括メンテ（値下げ往復・再出品）をテスト垢で実機検証するときの手順。「拡張をテストして」「実機で動かして」「E2Eやろう」「メルカリ/ヤフマで動かしてみて」と言われたら必ず使用する。config のテスト値の決め方・反映・検証・本番値への戻しまでを定める。
---

# 拡張の一括メンテ 実機テスト手順

対象リポジトリ: `/Users/kawasaki/Documents/work_source/2026_04_10_reselling/furima-listing-booster-extension/`
アカウント・API確認コマンド・認証などの**事実**は同リポジトリの `CLAUDE.md` を参照（手順はこの skill が正）。

## 鉄則

- テストで変えてよい config は **`MAINTENANCE_PERIOD_SEC`**（メルカリのときは `OWNER_SELLER_ID` も）**だけ**。
  `RESTORE_DELAY_MS`・`MAINTENANCE_INTERVAL_MS`・`MAINTENANCE_JITTER_MAX_MS`・日数境界
  （ACTIVATE/REPUBLISH/UPDATE_GAP）は変えない（過去に勝手に縮めて叱責された経緯あり。
  INTERVAL/JITTER のみ速度目的の短縮可だが、戻し挙動の検証には本番値で臨む）
- **テスト後は必ず本番値に戻してビルドする**（`MAINTENANCE_PERIOD_SEC=86400`、
  メルカリなら `OWNER_SELLER_ID='116890565'`）。戻し忘れは本番事故になる
- 本番アカウント（ふわしーぷ）の商品には書き込まない。テストは必ずテスト垢で行う

## 手順

### 1. 対象サイトとテスト垢を確認する

| サイト | テスト垢 | config変更 | 実行タブ |
|---|---|---|---|
| メルカリ | ぷー (`372589027`) | `OWNER_SELLER_ID` をぷーに + periodSec | jp.mercari.com（ぷーでログイン） |
| Yahoo!フリマ | リセルンメルルン (`p76048367`) | periodSec のみ（seller設定は不要） | paypayfleamarket.yahoo.co.jp（リセルンメルルンでログイン） |

一括メンテは「popup 実行時にアクティブな対応サイトのタブ」でだけ動く。
**片方のサイトだけ動かしたいときは、そのサイトのタブをアクティブにし、他方のタブは閉じておく**。

### 2. periodSec のテスト値を算出する

テスト垢の現在の出品の経過時間（メルカリ=created、ヤフマ=openTime）を API で取得し、
やらせたい操作のゾーンに入る値を選ぶ:

- 値下げ往復ゾーン: 経過 ∈ [periodSec, 3×periodSec] かつ 最終更新からの経過 ≥ periodSec
  （最終更新の条件はメルカリのみ。ヤフマは updated ガード無しなので最終更新を見ない）
- 再出品ゾーン: 経過 > 3×periodSec（最終更新は見ない）
- 対象外: 経過 < periodSec

例: 経過9hの商品を再出品・経過2.2hの商品を往復にしたい → periodSec=7200(2h)。

### 3. config 変更 → ビルド → 反映

```bash
cd furima-listing-booster-extension && npm run build
```
- `chrome://extensions` で拡張をリロード（↻）
- 対象サイトのタブをリロード（content script 再注入）

### 4. 実行と観察

- popup（拡張アイコン、またはタブで `chrome-extension://<拡張ID>/src/ui/popup.html`）から
  再出品件数を入れて「1日1回メンテを実行」
- popup の進捗表示で確認: サイト名・件数進捗・「いま:」行（操作中の商品ID/待機種別と残り秒数/リトライ回数）

### 5. 検証

- 値下げ往復: 対象商品の価格が元値に復帰しているか（戻し漏れがないか）。最終更新時刻が動いたか
- 再出品: 新IDで出品され（作成時刻=今）、旧IDが一覧から消えているか。
  タイトル・説明文（管理番号 FDxxxxx 含む）・specs・配送設定が引き継がれているか
- 失敗時: popup の失敗欄と、安値のまま残った商品がないかを確認

### 6. 本番値へ戻す

config を本番値へ戻して `npm run build`。戻したことを diff で確認してから完了報告する。

## テストデータの作り方

- メルカリ: `stop`→`on_sale` 復帰で updated が now にリセットされる（created は不変）。
  これで「created 古・updated 新」を作れる（updatedガード検証用）
- ヤフマ: `PUT status=CLOSE→OPEN` で同様の操作ができる（updateTime への影響は未実測。
  使う前に1商品で確認すること）
