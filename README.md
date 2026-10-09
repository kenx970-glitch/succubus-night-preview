# SUCCUBUS NIGHT

[共有プレビューを開く](https://kenx970-glitch.github.io/succubus-night-preview/)

成人の架空AIキャストと過ごすコンセプトカフェ。動画、Geminiの録音音声、Gのギフト、好意度、無料ストーリーをスマートフォンで試せます。

## この公開ページで動くもの

- 3人のキャスト選択、座席視点、事前生成した18本の表情動画
- Geminiの挨拶・話題・ギフト音声（かわいい成人女性の声、フランクな日本語）
- デモ50,000G・2,000S、Gギフト、物語、記念カード
- 30秒のテスト動画で100G（広告収益なし）

公開ページは静的デモです。自由なマイク会話、API生成、ログイン、実決済は接続していません。APIキー・アカウントDB・購入履歴は公開していません。デモの状態はこのブラウザだけに保存します。右上のアカウントボタンからリセットできます。

## ローカルのサーバー版

Node.js 24以上で `npm start` を実行し、http://127.0.0.1:3210/ を開きます。

- `.env.example` を参考にローカルの `.env` にFAL_KEYを設定
- 音声認識→Gemini返答→Gemini TTS、完成返答1回5S、失敗時返却、二重消費防止
- 料金・外部送信先を確認してマイク開始、入力メーター、手動送信
- テスト残高補充は `node scripts/fund-local-test.mjs --all-local-accounts`（既存ローカルアカウントのみ）
- Stripeは `sk_test_` とWebhook接続待ち。本番キー・本番イベントを拒否
- `npm test` / `npm run check` で検証

mainブランチの `site/` が共有デモ、gh-pagesブランチが配信用です。サーバー版のソースは `src/`、画面は `public/`。

## 本番化の残件

[構成](docs/ARCHITECTURE.md)、[スマホ改善](docs/MOBILE-REVIEW.md)、[公開前確認](docs/RELEASE.md) を参照。Stripe実接続試験、事業者ポリシー確認、日本での法的整理、クラウド・永続DB・費用制限・本物の広告検証は別途必要です。本番決済、実際の請求は所有者の明示承認が必要です。

Gemini Liveなどの低遅延会話は未接続。現在の録音音声は再生時にAI APIを呼びません。

## 素材

キャスト画像はAI生成、動画はFal経由Kling、音声はGemini TTS。日本語フォントはNoto Sans JP/Zen Maru Gothic、各フォントのSIL OFLライセンスは `public/fonts/`。素材の再生は外部AI呼び出しを発生させません。
