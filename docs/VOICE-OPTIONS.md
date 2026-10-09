# 音声の速度と公開運営

更新日：2026-10-09。

## 現在の方式

マイク→WAVアップロード→Whisper音声認識→Gemini返答→安全判定→Gemini TTS→音声ダウンロード。直列の複数API処理のため、最新の実接続試験では約36秒。人間の録音ではなく事前生成音声を入力した試験。小さい声の検知・手動送信の改善は完了したが、AIの生成遅延が解消したわけではない。

挨拶・定型会話・ギフトの27音声は事前生成し、待たずに再生する。APIを新たに呼ばない。再生までの時間は素材ダウンロードと回線による。

## 第一候補：Gemini Live

声の条件を維持する候補。Live APIは音声をストリーミングし、音声から音声で応答する低遅延API。[公式概要](https://ai.google.dev/gemini-api/docs/live-api)。現在のFalキーとは別にGoogle側のAPIキー・利用契約・予算の設定が必要。短い音声チャンク、割り込み、発話終了の扱いは[公式推奨](https://ai.google.dev/gemini-api/docs/live-api/best-practices)を使う。現行のTTSと同じ声を完全に再現できるかは試聴が必要。

キーはチャットへ送らず環境変数GEMINI_API_KEYへ。まだこのコードでは読み込まず、接続も行わない。キー設定だけで公開APIが有効にならない。

Liveでは1返答5Sのバッチ処理と料金管理をそのまま流用できない。セッション開始前のS予約、使用量取得、運営側の最大時間/同時実行数/日予算、接続切断、S精算と失敗時返却、所有者検証が必要。短寿命トークンだけを請求上限として扱わない。まず非公開試験で時間と実費を計測する。

## ChatGPT系の活用

自分のWebアプリに組み込む手段はOpenAIのRealtime API。音声から音声への低遅延応答、WebRTCなどを提供する。[公式ガイド](https://developers.openai.com/api/docs/guides/realtime)。通常の秘密鍵はサーバーに置き、クライアントへ渡さない。

これを採用するとGeminiのみという現在の声の条件が変わる。現時点では導入せず、Gemini Liveを先に検討する。OpenAIキー、利用予算、キャスト声の比較、リアルタイム料金と残高の管理を別途設計する。ChatGPT画面の音声ボットをこのゲームへ埋め込んだ実装ではない。

## PCを消しても動く範囲

GitHub Pagesの共有デモはPCに依存せず利用可能。[GitHub Pages公式説明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。Pagesは静的HTML/CSS/JSホスティングのため、Nodeサーバー・SQLite・秘密鍵付きAI APIを実行できない。

自由会話も外部で稼働させるには、常時動くHTTPSのNodeサーバー、永続DB、認証・外部費用の制限、ログ/監視、APIキーの秘密保管が必要。ホスティングの契約・月額予算とGoogleキーがまだ未確定。共有デモと有料API運営を混同しない。
