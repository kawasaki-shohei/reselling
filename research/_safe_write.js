// 既存ファイルを誤って上書きしないためのセーフライト。
// 手順書 v2 の「共通原則 1: 不変」(完了済み出力を再生成しない) を機械的に守るため、
// 出力先にファイルが既に存在していれば throw して止める。

const fs = require("node:fs");

function writeFileSafe(filePath, content, encoding = "utf8") {
  if (fs.existsSync(filePath)) {
    throw new Error(
      `output file already exists (共通原則 1: 不変): ${filePath}`,
    );
  }
  fs.writeFileSync(filePath, content, encoding);
}

module.exports = { writeFileSafe };
