/*
 * _purchase_threshold.js (内部ヘルパー、CLI ではない)
 *
 * 仕入れ候補の閾値 (14 日以内の SOLD 件数)。
 * 6-1 (build_identity_clusters.js) の判定スキップと
 * 6-3 (assign_final_cluster_ids.js) の is_purchase_candidate 判定が共用する。
 * Why: 閾値を 2 箇所に持つと 6-1 のスキップ基準と 6-3 の候補基準がずれ、
 * 「スキップしたのに候補になり得た」事故につながるため 1 箇所に置く。
 */

const PURCHASE_THRESHOLD = 3;

module.exports = { PURCHASE_THRESHOLD };
