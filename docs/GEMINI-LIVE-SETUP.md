# Gemini Live の設定

更新日：2026-10-10。自由会話の標準方式は Google に直接接続する `gemini-3.8-live`。Falのキーとは別のキーを使用する。2026-10-10にGoogleへの実接続を確認。テキスト入力と生成済み音声の16kHz PCM入力から、音声ストリーミング・文字起こし・24kHz WAV保存・隔離DBで20S→15Sを検証した。最初の返答音声はテキスト入力868ms、録音音声入力819ms（各1回の短い試験）。実マイク入力と声の好みは利用者の端末で確認する。[接続検証](GEMINI-LIVE-VERIFICATION.md)。

## 1. Google のキーを取得する

1. [Google AI Studio の API Keys](https://aistudio.google.com/apikey) にGoogleアカウントでログイン。
2. 初めて利用する場合は画面の案内に従い、プロジェクトとAPIキーを用意する。既存のCloudプロジェクトを使う場合はProjectsでImportしてからAPI Keysでキーを作成。
3. キーをコピーする。チャット、GitHub、HTML、ブラウザの保存領域には貼らない。

キーを作れない場合はプロジェクトの権限を確認する。[Google公式のキー作成・権限の説明](https://ai.google.dev/gemini-api/docs/api-key)。日本は対応地域で、APIの開発者と利用対象には18歳以上などの条件がある。[対応地域](https://ai.google.dev/gemini-api/docs/available-regions)、[利用条件](https://ai.google.dev/gemini-api/terms)。

## 2. ローカルに保存する

このプロジェクトの `.env` をテキストエディターで開き、以下を設定する。ファイルがない場合は `.env.example` を `.env` としてコピーする。ファイル名は `.env` であり `.env.txt` ではない。

```dotenv
VOICE_BACKEND=gemini-live
GEMINI_API_KEY=ここを取得したキーに置き換える
GEMINI_LIVE_MODEL=gemini-3.8-live
VOICE_TURN_PRICE_S=5
LIVE_MAX_SESSIONS=2
LIVE_DAILY_MAX_TURNS=100
LIVE_USER_DAILY_MAX_TURNS=60
```

`.env` はGitの対象から除外済み。既存のFAL_KEYやStripeテスト設定がある場合は消さずに追記・変更する。Windowsの環境変数にも設定できるが、既に動いているプロセスには反映されないため再起動が必要。環境変数と.envの両方に同じ名前がある場合、Nodeは環境変数を優先する。

## 3. 起動・再起動

プロジェクトのフォルダーを開いたターミナルで初回だけ依存関係をインストールする。

```powershell
npm ci
```

既存のゲームサーバーを停止してから起動する。

```powershell
npm start
```

[ローカルのゲーム](http://127.0.0.1:3210/) を開き、ページを更新。ログインして担当を選び、「音声で話す」を開く。「Gemini Liveの設定済み」が表示されればサーバーがキーを読み込んでいる。この表示だけではキーの有効性・残り枠・音声接続成功を保証しない。

18歳以上・料金と送信先を確認し、マイクを開始。ブラウザのマイク許可は利用者が操作する。声を検出するとSを予約し、約800msの無音または「話し終えた」で返答を開始。音声チャンクを届いた順に再生する。完成した返答は5S、未完了は返却、聞き直しは追加消費なし。

## 4. 無料枠と費用

ゲームのS残高とGoogleのAPI料金は別管理。現在の2,000Sはテスト用の付与で、Stripeは未接続。テスト用Sを増やしてもGoogle側の費用が無料になるわけではない。GoogleのAPIキーは対象プロジェクトの課金状態を引き継ぐため、AI StudioのAPI KeysでBilling Tier / Planを確認する。Free Tierは無料枠内で利用、Paidは運営者のGoogleプロジェクトで料金が発生する。ローカルで接続できたことだけでは無料・有料や請求額を判定できない。[課金状態の公式説明](https://ai.google.dev/gemini-api/docs/billing)。

Gemini Liveには無料枠が掲載されているが、利用量・モデル・アカウントの枠に制約がある。料金や割当はGoogleの[料金表](https://ai.google.dev/gemini-api/docs/pricing)と[Billing](https://ai.google.dev/gemini-api/docs/billing)で確認する。有料枠を使う場合は対象プロジェクトの課金設定が必要。Googleの有料枠への変更は運営者が行う。

このローカル版の上限は同時2セッション、全体で日本時間1日100回、1アカウント1日60回の開始済み発言。失敗やキャンセルもAPI費用が発生し得るため上限に数える。これはドルの正確な日予算上限ではない。Googleの料金・会話履歴・処理量によって実費は変わる。

入力30秒、返答音声20秒、無音45秒、接続4分、1接続8返答、返答待ち30秒で制限する。長い接続は更新し、過去8発言のテキストを引き継ぐ。請求上限をブラウザの申告や短寿命トークンに任せない。

## よくある状態

| 画面・状態 | 対処 |
| --- | --- |
| キー設定待ち | .envの場所・名前・値を確認し、サーバーを再起動 |
| キーの権限・利用枠を確認 | AI Studioのプロジェクト、APIキー制限、割当、必要なら課金設定を確認 |
| マイク未許可 | Chrome / Edge / Safariのサイト設定でこのローカルサイトへのマイクアクセスを確認 |
| 入力メーターが動かない | OSの入力機器・既定マイク、他の通話アプリの占有を確認 |
| S不足 | ローカルテスト用補充スクリプトを使用。本番の料金請求は無効 |
| 未完了・通信断 | 履歴と残高を確認し、新しい発言として開始。途中音声も停止 |

## 公開ページとの違い

GitHub Pagesの共有デモにはこの接続を入れていない。静的PagesではNodeの認証・台帳・WebSocket中継を動かせない。外部で自由会話を動かすには常時稼働するHTTPSサーバーと永続DBが必要。APIキーの公開や、本番決済の有効化は行わない。

実装：`src/gemini-live.mjs` / `public/gemini-live-client.mjs` / `public/live-audio.mjs`。Googleの[WebSocket仕様](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket)と[発話検出・声の設定](https://ai.google.dev/gemini-api/docs/live-api/capabilities)を使用。可愛い成人女性の声、キャスト別Aoede・Zephyr・Leda、フランクな日本語を指定。声の好み・実速度は実接続後に確認する。
