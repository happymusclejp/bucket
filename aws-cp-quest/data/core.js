// CLF-C02 クエストの出題データ(共通部分)。各ファイルがここに push する。
// questions: { id, d: ドメイン番号, q: 問題文, o: 選択肢(4つ), a: 正解の選択肢インデックス(複数選択は2つ), e: 解説 }
// cards / terms: { n: 名前, c: カテゴリ, d: ひとこと説明 }  ※cards は単語帳と早押し、terms は用語カードで使う
window.CLF_DATA = {
  domains: [
    { id: 1, code: 'D1', name: 'クラウドの概念', weight: 24 },
    { id: 2, code: 'D2', name: 'セキュリティとコンプライアンス', weight: 30 },
    { id: 3, code: 'D3', name: 'クラウドテクノロジーとサービス', weight: 34 },
    { id: 4, code: 'D4', name: '請求、料金、およびサポート', weight: 12 },
  ],

  questions: [],
  cards: [],
  terms: [],
};
