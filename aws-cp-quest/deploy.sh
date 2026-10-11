#!/usr/bin/env bash
# CLF-C02 クエストを S3 + CloudFront に反映する(2回目以降の更新用)。
# 使い方: BUCKET=<バケット名> DISTRIBUTION_ID=<ディストリビューションID> ./deploy.sh
# 前提: AWS CLI v2 がインストール済みで、S3 と CloudFront を操作できる認証情報が設定されていること。
set -euo pipefail

: "${BUCKET:?BUCKET にバケット名を指定してください}"
: "${DISTRIBUTION_ID:?DISTRIBUTION_ID に CloudFront のディストリビューションIDを指定してください}"

cd "$(dirname "$0")"

# アプリに必要なファイルだけを同期する(README などはアップロードしない)。
# no-cache にしておくと、ブラウザは毎回 ETag で更新を確認するので、変更がすぐ届く。
aws s3 sync . "s3://${BUCKET}" --delete \
  --exclude "*" \
  --include "index.html" --include "app.js" --include "sw.js" --include "manifest.json" \
  --include "data/*" --include "icons/*" \
  --cache-control "no-cache"

# CloudFront のエッジに残っている古いキャッシュを消す
aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/*" \
  --query 'Invalidation.Id' --output text

echo "デプロイ完了。アプリを2回開き直すと新しい版になります(1回目の起動で裏で更新を取得します)。"
