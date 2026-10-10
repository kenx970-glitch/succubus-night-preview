# 共有ページ

更新日：2026-10-10。ユーザーからGitHubで見せられるURLの公開を依頼されて公開。

- [共有プレビュー](https://kenx970-glitch.github.io/succubus-night-preview/)
- [GitHubリポジトリ](https://github.com/kenx970-glitch/succubus-night-preview)

GitHub Pagesの公開ビルド成功・HTTP 200を確認。公開URLのブラウザで座席映像とGemini音声再生を確認。390×844と1280×900で表示を確認。公開画面は `PUBLIC-MOBILE.jpg` / `PUBLIC-DESKTOP.jpg` に保存。

## できること

3人の選択、入店から座席への映像遷移、18表情動画、Geminiの事前生成音声27本、Gギフト、好意度、無料物語、記念アルバム、テスト動画での100G、デモ残高と履歴。右上のアカウントからリセット。

共有版のローカル試験ではシャンパン購入で50,000G→40,000G、Sは2,000のまま、好意度4→14、Gemini音声と記念カードを確認。テスト動画視聴後40,100G。状態はブラウザ内のlocalStorageだけに保存。

## 自由会話を含む版との違い

公開ページにはマイク会話・新規AI生成・ログイン・実決済・広告収益を接続していない。GitHub Pagesは静的配信のためNodeサーバーを実行できない。PCを停止しても共有ページは利用できる。

ローカルの `http://127.0.0.1:3210/` はGemini Liveを標準として実装済み。GoogleのAPIキー設定・実接続検証は待機中。旧Fal方式は明示選択の場合に使用する。ここはPCとNodeサーバーに依存する。外部で自由会話も動かすには、クラウドサーバー・永続DB・HTTPS・費用上限・APIキーの保管が必要。

APIキー・ローカルDB・個人アカウント・購入履歴・会話音声は公開していない。公開用manifestからFalの生成リクエストIDを除去。ローカルの試験JSONは公開ソースへ含めていない。

## 更新

公開リポジトリのmainはサーバー版のソースと `site/` の共有版。gh-pagesは `site/` の静的ファイルをルートに配置。Pagesの配信元はgh-pagesの `/`。秘密鍵やDBをコミットしない。

現在のGit管理されたコピーは `outputs/succubus-night-share`。元の稼働中プロジェクトは `outputs/succubus-night-economy`。変更を公開用コピーへ反映し、秘密情報チェックとブラウザ確認を行ってからmainを更新する。共有版を変えた場合は `git subtree split --prefix site --branch gh-pages` とgh-pagesのpushで更新。

本番決済・実際の料金請求は無効のまま。今回の静的デモ公開は、本番の有料API運営や課金有効化の承認ではない。
