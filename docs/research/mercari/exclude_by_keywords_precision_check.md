# exclude_by_keywords の精度確認

このドキュメントは `research/exclude_by_keywords.js` の判定精度を **定期的に測定する必要がある** という事実と、過去 (2026-04-18) に実施した検証事例を残すもの。

実施時の詳細な実行手順は時代によって変わる可能性があるため、その時点の状況に応じて設計し直してよい (ただし目的と前提条件は必ず確認すること)。

---

## 1. このスクリプトの位置づけ (リポジトリの文脈)

このリポジトリは **中国輸入物販** の業務支援プロジェクト。メルカリ等のフリマサイトで売れ筋商品を調査 → アリババ/ラクマートで仕入れ → 国内販売、という 9 工程を扱う。詳細は [`overview.md`](../../../overview.md) 参照。

工程 (1) の「メルカリ売れ筋リサーチ」は、生データ収集 → 除外フラグ付け → 主要ワード抽出 → クラスタリング → 仕入れ候補リスト化、という流れ。`research/exclude_by_keywords.js` はこのうち「除外フラグ付け」の段階を担当する (手順書 [`procedures/mercari-research-v2.md`](../../../procedures/mercari-research-v2.md) では「第 3 段階」あるいは「Step A」と呼称)。

このスクリプトの役割: **メルカリタイトルから、明らかに仕入れ候補外のもの (食品・ブランド模造・キャラ版権 等) を機械的に除外する**。

実装は `procedures/exclude_by_keywords/keywords.json` の辞書を使い、タイトルに対して JavaScript の `String.prototype.includes()` で部分文字列マッチしているだけ。LLM は使わない。数秒で全 7,000 件程度を処理できる。

---

## 2. 用語の定義

このドキュメントで頻出する用語:

| 用語 | 意味 |
|---|---|
| **仕入れ候補** | 中国輸入物販で仕入れ対象になりうる商品 (ブランド・キャラ・食品等に該当しないもの) |
| **flagged** | `exclude_by_keywords.js` が除外対象と判定した行。`exclusion` オブジェクトが付く |
| **unflagged** | スクリプトが判定しなかった行 (`exclusion: null`)。仕入れ候補プールに残る |
| **primary** | 複数カテゴリにマッチした場合の代表カテゴリ。優先度順で決定 |
| **matches** | マッチした全カテゴリと実際にヒットしたキーワードの辞書 |
| **exclusion** | flagged 行に付く `{ primary, matches }` オブジェクト。unflagged は `null` |
| **層別サンプリング** | primary カテゴリの件数比率を維持してランダム抽出する方法。全体の分布を代表する |
| **ground truth (GT)** | 正解データ。人間または Opus が画像込みで判定した結果 |
| **verdict** | 判定の 3 値: `exclude` / `rescue` / `unclear` (下記参照) |

### verdict の 3 値

| verdict | 意味 |
|---|---|
| `exclude` | スクリプトの除外判定が **正しい**。本当に仕入れ候補外 |
| `rescue` | スクリプトの判定が **誤り**。本当は仕入れ候補になりうる (救済すべき) |
| `unclear` | 画像を見ても人間でも判別困難な微妙なケース |

---

## 3. なぜ定期的な精度確認が必要か

`exclude_by_keywords.js` は辞書マッチのため、以下の理由で **時間とともに精度が陳腐化する**:

- 新しいブランド名・キャラクター名が流通する (辞書にない語は拾えない)
- 商品タイトルの書き方が変わる (新しい誤マッチパターンが出る)
- 辞書の既存キーワードが別の文脈で誤爆する (例: 「マカ」が「マカロン」に、「シュガ」が「ラッシュガード」に)

辞書を更新しても、精度を測らないと「効いたのか悪化したのか」が分からない。よって **辞書を大きく更新した直後**、あるいは **数ヶ月に一度** 精度確認を行う。

この作業は **リサーチ本体とは独立したメンテナンスプロセス** として実施する。リサーチ時のランタイムに組み込む必要はない (毎回やるとトークンの無駄)。

---

## 4. 実施タイミング

### 4.1 辞書更新のきっかけ

Step A の辞書は **時間とともに陳腐化する**。以下のきっかけで辞書を更新する:

- **仕入れ判断者からの新しい除外ルールの申し入れ** (新ブランド・新キャラクター・新パターン)
- **リサーチで誤判定 (rescue) が発見された** → 単語境界/組み合わせ/文脈除外のルールを追加 (パターンは `keywords_design_notes.md` 参照)
- **`references/注意商品.pdf` / `references/new仕入れ禁止商品_アパレル.pdf` の更新** → PDF 内の新規禁止商品を辞書に反映
- **`docs/research/mercari/keywords_design_notes.md` の追記** → 新しい誤爆パターン・組み合わせ判定の知見が見つかったとき、設計メモを更新し、必要に応じて keywords.json 側の構造 (notWith / withAll) に反映
- **動的辞書拡張 (暫定辞書) の昇格判断** → リサーチ実行時に生成された暫定辞書 (`mercari-research-v2.md` §3.8) から継続利用に値するキーワードを選定して反映

更新後は `research/exclude_by_keywords.js` を再実行すれば、過去データで再判定できる (数秒で完了、コストほぼゼロ)。

### 4.2 精度確認のきっかけ

以下のいずれかのきっかけで精度確認を実施する:

- 辞書 (`procedures/exclude_by_keywords/keywords.json`) を大きく更新した直後
- 前回の精度確認から数ヶ月経った
- 仕入れ判断者から「こういう商品が誤って除外されている (or 除外されていない)」というフィードバックが複数件来た
- 新カテゴリ (例: 新しい法規制対象) を辞書に追加した

---

## 5. 前提条件 (このドキュメントを書いた 2026-04-18 時点)

下記「過去事例」で示す手法は、以下の前提に立って組まれている。**どれか 1 つでも崩れていたら、当時の手順をそのまま踏襲しても意味が通らない**ため、その時のコンテキストに合わせて手法を再設計する必要がある。

- **判定ロジック**: `research/exclude_by_keywords.js` が部分文字列マッチ (`.includes()`) で除外フラグを付ける
- **辞書の形式**: `procedures/exclude_by_keywords/keywords.json` が JSON 形式で、`priority` 配列 + `keywords` オブジェクト (カテゴリ名 → キーワード配列の辞書) を持つ
- **分類カテゴリ**: 8 種類 (`food`, `plant_quarantine`, `medical`, `cosmetics_yakki`, `character_copyright`, `brand_imitation`, `electronics_check`, `handmade`)
- **primary の決定方法**: 上記カテゴリ間の優先度 (配列順) で決まる
- **出力の構造**: 各行に `exclusion: { primary, matches }` が付く。`exclusion === null` なら除外対象ではない
- **画像の取得**: 生データ (`research/*mercari_14day_results.json`) の各 item に `thumbnail` URL があり、そこから画像をダウンロードできる
- **仕入れ判断の方針**: ブランド模造・キャラクター版権・食品などを除外するという基本方針 (`references/注意商品.pdf` 等に準拠)
- **verdict の 3 値設計**: スクリプトの判定を仮フラグとして扱い、見直し対象になる設計である

これらが変わっていたら、サンプリング単位・判定基準・画像の有無などの前提が崩れる。

---

## 6. 実施の全体像

```
1. 最新データで exclude_by_keywords.js を実行して flagged を取得
2. flagged から層別サンプリングで N 件 (目安 150 件) を抽出
3. 各サンプルの画像をダウンロード
4. 親 Claude (画像認識のため Opus 推奨) が 1 件ずつ画像+タイトル+matches を見て verdict を付ける
5. verdict 分布・カテゴリ別精度・誤判定パターンを集計
6. 誤判定パターンを分析して辞書改善案を作成、keywords.json に反映
7. 再度 exclude_by_keywords.js を実行して、改善前後の flagged 件数の差を確認
```

---

## 7. 詳細手順

### 7.1 スクリプトを実行して flagged を取得

```bash
node research/exclude_by_keywords.js research/<latest_raw>.json tmp/<path>/gt_chunks_<date>
```

出力: `<output_dir>/step_a_auto_exclusion.json` (全ユニーク行、`exclusion !== null` が flagged)。

### 7.2 層別サンプリング

primary カテゴリの件数比率を保ってランダム抽出する。サンプル数 N の目安:

| サンプル数 | 95% 信頼区間の幅 (誤判定率 6% 前提) |
|---|---|
| 50 | ±6.7% |
| 100 | ±4.6% |
| **150** | **±3.8%** (実用的) |
| 300 | ±2.7% |

Node スクリプト例 (シード固定で再現性を確保):

```js
const fs = require("fs");
const stepA = JSON.parse(fs.readFileSync("tmp/<path>/step_a_auto_exclusion.json", "utf8"));
const flagged = stepA.rows.filter(r => r.exclusion !== null);

const byCat = {};
for (const r of flagged) {
  const p = r.exclusion.primary;
  (byCat[p] = byCat[p] || []).push(r);
}

// 配分: 総数 N を primary の比率で按分
const N = 150;
const allocation = {};
for (const [cat, list] of Object.entries(byCat)) {
  allocation[cat] = Math.max(1, Math.round(list.length / flagged.length * N));
}

// シード固定乱数
function mulberry32(seed) {
  return function() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const samples = [];
for (const [cat, n] of Object.entries(allocation)) {
  samples.push(...shuffle(byCat[cat]).slice(0, Math.min(n, byCat[cat].length)));
}
samples.sort((a, b) => a.rowIndex - b.rowIndex);
fs.writeFileSync("tmp/<path>/sample.json", JSON.stringify(samples, null, 2));
```

### 7.3 画像ダウンロード

生データの `thumbnail` URL からローカルに保存する。

```js
const fs = require("fs");
const https = require("https");
const raw = JSON.parse(fs.readFileSync("research/<latest_raw>.json", "utf8"));
const samples = JSON.parse(fs.readFileSync("tmp/<path>/sample.json", "utf8"));
const thumbMap = new Map(raw.items.map(it => [it.id, it.thumbnail]));

const outDir = "tmp/<path>/images";
fs.mkdirSync(outDir, { recursive: true });

const tasks = samples.map(s => ({
  rowIndex: s.rowIndex,
  url: thumbMap.get(s.ids[0]),
}));

const CONCURRENT = 30;
let active = 0, idx = 0, done = 0;
function next() {
  while (active < CONCURRENT && idx < tasks.length) {
    const t = tasks[idx++];
    const p = `${outDir}/${t.rowIndex}.webp`;
    if (fs.existsSync(p) && fs.statSync(p).size > 0) { done++; continue; }
    active++;
    https.get(t.url, res => {
      const f = fs.createWriteStream(p);
      res.pipe(f);
      f.on("finish", () => { f.close(); active--; done++; next(); });
    }).on("error", () => { active--; done++; next(); });
  }
}
next();
```

保存先: `tmp/<path>/images/{rowIndex}.webp`。

### 7.4 親 Claude による判定

親 Claude (画像認識のため Opus 推奨) が 1 件ずつ以下を行う:

1. `sample.json` から rowIndex, title, primary, matches を確認
2. `tmp/<path>/images/{rowIndex}.webp` を Read ツールで開く
3. 画像から商品の実体 (食品か雑貨か、ブランド物か量産品か、キャラ本体かキャラ無関係か 等) を判断
4. 判定基準 (下記) に従って verdict を決定
5. 判定理由を簡潔に書く (30 字程度)

判定結果を JSON として保存:

```json
[
  {
    "rowIndex": 315,
    "primary": "character_copyright",
    "gt_verdict": "exclude",
    "gt_reason": "BTS公式フォトブック"
  },
  ...
]
```

処理量の目安: 1 件あたり画像 Read + 判定で数秒、150 件で 20〜30 分程度。親セッション内で完結可能。

### 7.5 判定基準 (exclude / rescue / unclear の見分け方)

各 verdict の具体例:

| 入力 | 画像 | verdict | 理由 |
|---|---|---|---|
| primary=food, matches=`["ふきのとう"]`, title="ふきのとう模様の手ぬぐい" | 手ぬぐいの写真 | **rescue** | 食品ではなく雑貨 |
| primary=food, matches=`["ふきのとう"]`, title="天然ふきのとう 200g" | 山菜の写真 | **exclude** | 本当に食品 |
| primary=character_copyright, matches=`["ピカチュウ"]`, title="ピカチュウ風 量産ピアス" | ピカチュウと無関係な黄色いクマ | **rescue** | キャラ本体ではない |
| primary=character_copyright, matches=`["ピカチュウ"]`, title="ピカチュウ ピアス" | ピカチュウ本体のデザイン | **exclude** | キャラ版権 |
| primary=brand_imitation, matches=`["ニトリ"]`, title="ニトリ風 椅子" | 普通の椅子 | **unclear** | 模倣かどうか画像で確定できない |
| primary=food, matches=`["肉"]`, title="肉球ステッカー 犬猫" | 肉球柄のシール | **rescue** | 食品の「肉」ではなく動物の肉球柄 |
| primary=cosmetics_yakki, matches=`["洗顔"]`, title="洗顔パフ 2点セット" | タオル・パフ類 | **rescue** | 雑貨、薬機法対象外 |

判定の軸は「**画像を見たら、そのスクリプトの除外判定は正しかったか**」。具体的には:
- 画像の実体が primary/matches と一致 → `exclude`
- 画像の実体が primary/matches と無関係 → `rescue`
- 画像を見ても判断できない → `unclear`

### 7.6 統計集計

集計すべき項目:

1. **全体の verdict 分布**: exclude / rescue / unclear の件数と割合
2. **カテゴリ別精度**: primary ごとに、`exclude` が何件 / サンプル何件 = 精度
3. **誤判定パターン**: `rescue` になったサンプルの `matches` を収集、頻出キーワードを抽出

Node スクリプト例:

```js
const fs = require("fs");
const gt = JSON.parse(fs.readFileSync("tmp/<path>/gt_result.json", "utf8"));

const dist = { exclude: 0, rescue: 0, unclear: 0 };
for (const r of gt) dist[r.gt_verdict]++;
console.log("verdict分布:", dist);

const byCat = {};
for (const r of gt) {
  (byCat[r.primary] = byCat[r.primary] || { total: 0, exclude: 0 });
  byCat[r.primary].total++;
  if (r.gt_verdict === "exclude") byCat[r.primary].exclude++;
}
for (const [cat, s] of Object.entries(byCat)) {
  console.log(`${cat}: ${s.exclude}/${s.total} (${(s.exclude/s.total*100).toFixed(1)}%)`);
}
```

### 7.7 誤判定パターンの分析と辞書改善

`rescue` になったサンプルの `matches` を全部並べると、同じキーワードで何度も誤爆しているパターンが見える。例えば過去事例 (§9) では「マカ」「ガム」「シュガ」「RM」「オレンジ」「キャンディ」「洗顔」「アイス」が繰り返し誤爆していた。

辞書改善の方法は 3 つ:

1. **単語境界マッチに変える**: 「マカ」単独ならヒット、「マカロン」のように直後に別の文字が続く場合はヒットしない
2. **組み合わせマッチに昇格**: 「マカ」単独ではなく「マカ + ナッツ」「マカ + 粉末」のように別の食品語と共起したときだけヒット
3. **文脈除外ルール (notWith)**: 「オレンジ + イヤリング/ピアス/ブレスレット」なら食品ではないと明示的に除く

2026-04-18 以降、**3 の文脈除外 (notWith) は実装済み**。辞書のエントリを文字列 or オブジェクト形式で書けるように `classify()` を拡張した:

```json
"food": [
  "ふきのとう",
  "マカダミア",
  { "keyword": "キャンディ", "notWith": ["キャンディイエロー", "キャンディボンボン", "キャンディ柄"] },
  { "keyword": "ガム", "notWith": ["ギンガム"] }
]
```

オブジェクト形式の場合、`keyword` がタイトルに含まれていても `notWith` のいずれかが同時に含まれていればマッチを無効化する。

1 (単語境界) と 2 (組み合わせ) はまだ未実装。必要になったらスクリプトをさらに拡張する。

改善を入れたら、同じサンプルで再判定して精度変化を確認すること。

---

## 8. 過去事例: 2026-04-18 の検証

### 入力データ

`research/2026_04_16_06_46__mercari_14day_results.json` (8,059 items、ユニーク化後 7,223 行、うち flagged 2,475 件)

### 実施内容

1. flagged 2,475 件から primary カテゴリ比率で 150 件を層別サンプリング
2. 画像 2,500 枚を並列ダウンロード (tmp/2026/04/17/step_c_images/)
3. 親 Claude (Opus 4.7) が 150 件を 1 件ずつ判定
4. verdict 分布とカテゴリ別精度を集計

### 結果

| verdict | 件数 | 割合 |
|---|---|---|
| exclude | 139 | **92.7%** (判定が正しい) |
| rescue | 9 | 6.0% (誤判定、救済対象) |
| unclear | 2 | 1.3% (画像でも判別困難) |

**誤判定率 6.0% (95% 信頼区間 ±3.8%)**。全体 flagged 2,475 件のうち、150〜250 件程度が誤判定と推定される。

### カテゴリ別精度 (Sonnet 比較用に算出した時の値、サンプル数不均等)

| primary | 精度 |
|---|---|
| plant_quarantine | 100% |
| character_copyright | 93.5% |
| food | 92.3% |
| brand_imitation | 80.0% |
| cosmetics_yakki | 77.8% |
| handmade | 71.4% |

`handmade` `cosmetics_yakki` `brand_imitation` が特に弱い。

---

## 9. 発見された誤判定パターン (辞書改善の参考)

2026-04-18 時点で rescue 判定になった 9 件は、すべて「一般語の部分文字列マッチ」による誤爆:

| 辞書の単語 | 本来拾いたかった意味 | 実際に誤爆した商品例 |
|---|---|---|
| マカ | マカダミアナッツ (食品) | マカロンお守り |
| ガム | チューインガム (食品) | ギンガムチェックのバッグ |
| シュガ | BTS シュガ (K-POP) | ラッシュガード (水着) |
| RM | BTS RM (K-POP) | MARMAR ハンドクリーム、FARMSTAY 化粧品 |
| オレンジ | オレンジ (食品) | オレンジ色のイヤリング |
| キャンディ | キャンディ (食品) | キャンディイエロー (色名)、キャンディボンボン柄 |
| 洗顔 | 洗顔料 (化粧品) | 洗顔パフ、洗顔タオル (雑貨) |
| アイス | アイスクリーム (食品) | アイスヤーン (毛糸ブランド) |

これらは辞書改善 (§7.7) で潰せる。

### 補足: 旧辞書の掃除で自動修正された例

2026-04-18 の作業中、旧辞書 (スクリプト内にハードコードされていた頃) にコメント「削除」と書かれていたのに実際は残っていた単語 **「ニコちゃん」** (cosmetics_yakki カテゴリ) を辞書 JSON 化の際に削除した。結果、5 件 (ニコちゃんマットやニコちゃん柄パジャマなど) が正しく unflagged に戻った (candidate プール 4,748 → 4,752 件)。

### 今回使った中間ファイル (参考、git 管理外)

- サンプルと判定結果: `tmp/2026/04/17/gt_sample_150/`
  - `sample_150.json`: 層別抽出した 150 件
  - `gt_result.json`: 親 Claude の判定結果 (exclude/rescue/unclear と理由)
- 画像: `tmp/2026/04/17/step_c_images/{rowIndex}.webp` (flagged 全件分 = 約 2,500 枚)

これらは `tmp/` 配下 (gitignore) のため使い捨て。次回の検証時には新しくサンプリングし直す前提。

---

## 10. 次回やる時の注意点

- **前提条件 (§5) が全て成立しているか最初に確認する**。崩れているなら手法を再設計
- サンプル数・保存フォーマット・判定モデル (Opus/Sonnet) は、その時点の事情に応じて見直してよい
- 画像ダウンロードは flagged 全件分を事前準備しておくとサンプル差し替えがしやすい
- **変わらない目的**: `exclude_by_keywords.js` の誤判定率がどの程度で、どのパターンで発生しているかを定量的に把握し、辞書改善とスクリプト改善に反映すること
- **親 Claude の GT 判定も 100% 正確ではない**。2026-04-18 の検証では判定ミスが複数件あった (マイナーなサンリオ系キャラ「ウサハナ」や韓国コスメブランド「FARMSTAY」の知識不足など)。**作業中あるいは作業後にユーザーレビューを受けて訂正する運用**を前提にする
- **辞書の肥大化は受け入れる**。Claude (LLM) の訓練データは最新化できないため、新ブランド/新キャラクター/新商品名は明示的に辞書追加しないと気付けない。`.includes()` ベースなので数千語に増えてもパフォーマンス問題はない
- **多義的な一般語は辞書に入れない**。例: 「パウダー」単独は食品 (プロテイン/ベーキング)・工芸 (クロム/グリッター)・DIY (エイジング) で多用され、辞書に入れると誤爆が増える。化粧品専用の複合語 (「ルースパウダー」「フェイスパウダー」) のみ登録する

辞書改善の具体的な対応は `procedures/mercari-research-v2.md` の `exclude_by_keywords.js` を扱うセクションにも記述してある。

---

## 11. 過去事例 (続): 2026-04-18 の辞書改善

§8 の初回検証 (精度 92.7%) で判明した誤判定パターンと GT 訂正を踏まえて、同日中に辞書を改善して再検証した記録。

### 11.1 GT 訂正 (3 件)

初回 GT 判定の後にユーザーレビューを受けて訂正:

| rowIndex | タイトル | 初回 GT | 訂正後 | 訂正理由 |
|---|---|---|---|---|
| 982 | 【正規品】**ウサハナ** 韓国限定 キャンディボンボンステッカー | rescue (food 誤マッチ扱い) | **exclude** | ウサハナはサンリオ系キャラ。character_copyright として正当 |
| 2095 | **FARMSTAY** CICA FARM セバムフリーパウダー | rescue (character RM 誤マッチ扱い) | **exclude** | FARMSTAY は韓国コスメブランド。cosmetics_yakki として正当 |

訂正後の GT 分布:

| verdict | 件数 | 割合 |
|---|---|---|
| exclude | 142 | **94.7%** |
| rescue | 6 | 4.0% |
| unclear | 2 | 1.3% |

### 11.2 辞書改善の実施内容

#### notWith 化 (7 語)

§9 の誤判定パターン 9 件のうち、同一タイトル内の特定語で判別できるものを notWith で無効化:

| カテゴリ | キーワード | notWith |
|---|---|---|
| food | キャンディ | キャンディイエロー, キャンディボンボン, キャンディ柄 |
| food | ガム | ギンガム |
| food | アイス | アイスヤーン |
| cosmetics_yakki | 洗顔 | 洗顔パフ, 洗顔タオル, 洗顔ブラシ, 洗顔ネット |
| character_copyright | シュガ | ラッシュガード |
| character_copyright | RM | FARM, MARM, WARM, ARMS |
| handmade | ハンドメイド | ステンシルシート, 型紙 |

#### 新規キーワード追加 (15 語以上)

GT 訂正で判明した「Step A 辞書の漏れ」を明示的に追加:

| カテゴリ | 追加キーワード |
|---|---|
| character_copyright | ウサハナ, Usahana |
| cosmetics_yakki | FARMSTAY, ファームステイ, セバム, セバムフリー, セバムコントロール, CICA, シカ成分, フェイスパウダー, ルースパウダー, プレストパウダー, ミネラルパウダー, ベビーパウダー |

#### 採用しなかった候補

| キーワード | 採用しなかった理由 |
|---|---|
| パウダー (単独) | 食品 (プロテイン/ベーキング)・工芸 (クロム/グリッター)・DIY (エイジング) で多用される多義語。誤爆が増える |
| マカロン | GT に該当行なし (机上の検討だった)、かつ「マカロンお守り」のように非食品文脈で出てくる可能性があり、慎重に扱う |

### 11.3 改善後の再検証結果

辞書改善版で `exclude_by_keywords.js` を再実行し、同じ 150 件サンプルに対する精度を測定:

| 指標 | 改善前 | 改善後 |
|---|---|---|
| GT との一致率 | 92.7% | **98.7%** (unclear 除くと実質 100%) |
| rescue (誤判定) | 9 件 | **0 件** |
| false negative (見落とし) | 0 件 | 0 件 |
| unflagged (候補プール) | 4,748 件 | **4,763 件** (+15) |

候補プールが +15 件増えた (GT で見つけた 6 件より多いのは、未検証の範囲でも同様の誤マッチが散らばっていたため)。

### 11.4 この事例の教訓

- **判定ロジックのトレードオフ整理**: `.includes()` + notWith だけで 150 件サンプルの精度 98.7% に到達できた。単語境界マッチや組み合わせマッチまで実装する必要性は当面ない
- **GT 訂正の重要性**: 初回 GT の 3 件は親 Claude が見落とした (特殊記号の見落とし、マイナーブランド/キャラの知識不足)。レビューを挟む運用が安全
- **辞書の定期更新を前提に運用する**: 新しい誤判定パターンや見落としは運用しながら随時追加する。150 件外にも判定漏れがある可能性はあるが、全件目視でなく定期運用で発見する方式にした
- **LLM の知識は最新化できないので明示的な辞書追加が必須**: ブランド名・キャラ名は個別に登録する (肥大化を受け入れる)

---

## 12. レート制限・使用量制限・中断再開を前提とした実行設計

親 Claude の画像認識で数百〜数千件を判定する場合、以下 2 種類の Anthropic 側の制限に引っかかって途中で処理が止まる可能性がある。両者は別物で、挙動もリセットタイミングも発生条件も違う。

| 制限の種類 | 内容 | リセット | 主な発生条件 |
|---|---|---|---|
| **レート制限** (Rate Limit) | API の単位時間あたりのリクエスト数・トークン数上限 (RPM / TPM / ITPM / OTPM) | 数分〜 1 時間 | 単一のセッション (親 or Agent) が短時間に大量消費したとき |
| **使用量制限** (Usage Limit) | Claude プラン (Pro/Max) の 5 時間単位や日次のメッセージ数・トークン数上限。UI 上のエラー表示例: "You've hit your limit · resets 12am" | 5 時間 or 日次 | そのプランの 1 日 (または 5 時間窓) の合計消費が上限に達したとき |

以下の設計は両方への対応を兼ねる:

- **レート制限対策** = 単一 Agent の詰め込み量を抑える (§12.5)
- **使用量制限対策** = 1 日で完走できないサイズを想定し、複数日で `progress.json` 再開できるようにする (§12.1)

### 12.1 基本方針

1. **バッチ単位で順次処理**: 判定対象を N 件単位のバッチに分割し、バッチごとに処理する。1 バッチの所要が大きすぎないサイズを選ぶ (目安 50 件)
2. **バッチごとに結果を逐次保存**: 各バッチ完了時に独立した JSON ファイルに書き出す。途中でレート制限や使用量制限に当たっても完了済みバッチ分は無駄にならない
3. **進捗ファイルで再開可能にする**: `progress.json` に完了バッチ番号を記録し、再開時は未完了バッチのみ処理する
4. **tmp 配下の専用ディレクトリに全てを集約**: 検証日のディレクトリを切り、入力・画像・バッチ結果・集計・README を同じ場所に入れる。他の作業と混ざらないよう独立させる

### 12.2 判定結果 JSON の書き方 (精査可能性の確保)

後から精査・再分析できるよう、各判定行に以下を残す:

| フィールド | 内容 |
|---|---|
| `rowIndex` | 元データ (step_a_auto_exclusion.json) のインデックス |
| `title` | 商品タイトル |
| `primary` | スクリプトが付けた代表カテゴリ |
| `matches` | スクリプトがヒットした全マッチ情報 (primary 以外も含む) |
| `image_path` | 参照した画像ファイルのパス |
| `gt_verdict` | `exclude` / `rescue` / `unclear` |
| `gt_reason` | 判定理由 (簡潔に) |
| `judged_at` | 判定日時 (任意) |
| `judged_by` | 判定した Claude のモデル名 (任意) |

判定時に参照した全情報を同じファイル内に残すことで、後から特定カテゴリの誤判定だけ集めたり、第三者がレビューしたりできる。`matches` はキーワードだけでなくカテゴリ単位で全件残す (primary 以外のヒットも後の分析材料になる)。

### 12.3 推奨ディレクトリ構成

```
tmp/YYYY/MM/DD/exclude_by_keywords_precision_check/
├── README.md                         # 検証の概要・進捗状況
├── step_a_auto_exclusion.json        # exclude_by_keywords.js の生出力
├── flagged_all.json                  # 判定対象の入力情報
├── batches/batch_NNN.json            # バッチごとの入力
├── results/batch_NNN_result.json     # バッチごとの判定結果
├── progress.json                     # 完了バッチ番号のリスト
├── images/                           # 判定対象の画像 (既存ディレクトリ流用可)
└── summary/                          # 全バッチ完了後に作成
    ├── merged_gt.json                # 全バッチ統合 GT
    ├── stats.json                    # verdict 分布・カテゴリ別精度
    └── error_patterns.md             # 誤判定パターン分析
```

### 12.4 バッチサイズの目安

- 小さすぎるとバッチ数が増えて管理が煩雑になる (進捗管理・マージのオーバーヘッド)
- 大きすぎると 1 バッチがレート制限 / 使用量制限に引っかかりやすくなる
- **目安: 50 件 / バッチ**。その時点の制限残量や 1 件あたりの処理時間に応じて調整する

### 12.5 Agent (サブエージェント) 1 体あたりの担当件数

親 Claude の負荷とコンテキスト肥大を避けるため、大量判定は Agent ツールに委譲して **1 体ずつ順次処理する** 運用が有効 (並列起動はレート制限と使用量制限の両方を一気に消費するため非推奨)。Agent 1 体あたりに詰め込む件数は **コンテキスト容量 (Opus で 1M) ではなくレート制限 / 使用量制限** で決まる。

**実測値 (2026-04-18 〜 19、flagged 2,460 件の全件判定を実施したときのデータ):**

| 試した設定 | 結果 | 抵触した制限 |
|---|---|---|
| 500 件 / Agent (10 バッチ) | 5 バッチ (250 件) 処理した時点で停止 | レート制限 (単体 Agent が短時間に大量消費したため) |
| 150 件 / Agent (3 バッチ) を順次 14 体起動 | 全件完走したが、途中 1 回停止 → 翌日リセット後に再開 | 日次の使用量制限 (1 日の合計消費が上限に達したため) |

**学び:**

- Opus はコンテキスト 1M あるので、トークン容量上は 1 Agent で数百件処理できる計算になる
- しかし **レート制限または使用量制限のどちらかが先に当たる** (コンテキストには余裕があるのに処理が止まる)
- 親セッションでも画像 Read を行うと親 + 子の累積トークンが両制限の消費に寄与するため、親での画像 Read は避け、Agent 側の件数も保守的に抑える
- **レート制限は 1 体の Agent に詰め込みすぎると発生** → 1 Agent の担当件数を減らすことで対処
- **使用量制限は 1 日 (または 5 時間窓) の合計処理量で発生** → 1 日で完走できないサイズの作業は最初から複数日に分ける想定で `progress.json` 再開機構を組む
- 制限に当たった場合はリセット (レート制限は数分、使用量制限は 5 時間単位 or 日次) を待って `progress.json` から再開する

**推奨構成:**

- **1 Agent = 3 バッチ (約 150 件) を標準**。これ以上詰め込むとレート制限に当たりやすい
- 件数が多い場合 (例: 2,000 件超) は Agent を 10 体以上順次起動する前提で見積もる。1 日で終わらない前提でスケジュールを組む
- 親は Agent 間のオーケストレーション (完了確認・次の Agent 起動) に徹し、画像 Read は行わない
- Agent プロンプトに「過去に発見された誤マッチパターン」を注入しておくと、後発の Agent も判定品質が安定する

**推奨:**

- **1 Agent = 3 バッチ (150 件) を標準とする**
- 件数が多い場合 (2,000 件超) は Agent を 14 体以上順次起動する前提で見積もる
- 親は Agent 間のオーケストレーション (完了確認・次の Agent 起動) のみに徹する。親で画像 Read は極力行わない
- 各 Agent プロンプトに「過去 Agent で発見済みの誤マッチパターン」を注入すると、後半 Agent の判定品質が安定する

### 12.6 Agent 起動時に必ずプロンプトに入れる検証ステップ

Agent に複数件の画像判定を任せると、以下のミスを起こしやすい (実運用で観測された類型):

1. **入力件数と出力件数の食い違い**: N 件のバッチ入力に対し、出力 JSON の items が N - 1 件になるなど、一部が抜け落ちる
2. **画像 Read 失敗を unclear に逃がす**: 実在するファイルの読み込みで一時的にエラーが出た際、リトライせず「画像未取得」として unclear 判定で誤魔化す
3. **集計サマリーと items の不整合**: 出力の `verdict_counts` を Agent が独自に数えて記載し、実際の items 配列とずれる

**対策として Agent プロンプトに次を明示する:**

- 「出力 JSON の items 配列の件数が、入力バッチの items 配列の件数と一致することを必ず確認せよ」
- 「画像 Read でエラーが出た場合はリトライし、それでも失敗したら rowIndex と原因を明示的に報告せよ (unclear に逃げない)」
- 「`verdict_counts` は自分で数えず、items 配列から集計した結果を記載せよ」

**集計スクリプト側でも保険をかける:**

- 出力 JSON の `verdict_counts` は信用せず、items 配列から再集計する
- 全バッチの出力を統合する際に、判定対象の rowIndex 全件をカバーしているか差分チェックする。漏れがあれば親で補完判定する
