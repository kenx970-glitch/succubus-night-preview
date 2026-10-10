# 音声の速度と公開運営

更新日：2026-10-10。

## 旧方式（Fal）

マイク→WAVアップロード→Whisper音声認識→Gemini返答→安全判定→Gemini TTS→音声ダウンロード。直列の複数API処理のため、最新の実接続試験では約36秒。人間の録音ではなく事前生成音声を入力した試験。小さい声の検知・手動送信の改善は完了したが、AIの生成遅延が解消したわけではない。

挨拶・定型会話・ギフトの27音声は事前生成し、待たずに再生する。APIを新たに呼ばない。再生までの時間は素材ダウンロードと回線による。

## 採用：Gemini Live

声の条件を維持する候補。Live APIは音声をストリーミングし、音声から音声で応答する低遅延API。[公式概要](https://ai.google.dev/gemini-api/docs/live-api)。現在のFalキーとは別にGoogle側のAPIキー・利用契約・予算の設定が必要。短い音声チャンク、割り込み、発話終了の扱いは[公式推奨](https://ai.google.dev/gemini-api/docs/live-api/best-practices)を使う。現行のTTSと同じ声を完全に再現できるかは試聴が必要。

キーはチャットへ送らずGEMINI_API_KEYを.envまたはサーバー環境へ。標準のGemini Live中継・ストリーミング再生を実装済み。2026-10-10にGoogleへの実接続を確認。テキスト入力と生成済み音声の16kHz PCM入力から、音声ストリーミング・文字起こし・24kHz WAV保存・隔離DBで20S→15Sを検証した。最初の返答音声はテキスト入力868ms、録音音声入力819ms（各1回の短い試験）。実マイク入力と声の好みは利用者の端末で確認する。[接続検証](GEMINI-LIVE-VERIFICATION.md)。[設定手順](GEMINI-LIVE-SETUP.md)。公開Pagesの自由会話は有効化しない。

認証されたサーバー中継が発話開始時に5Sを予約し、返答完成時に確定、切断・未完了時は返却する。入力30秒・返答20秒・接続4分・1接続8返答を制限し、同時2接続・全体1日100回・利用者1日60回でローカルテスト費用を抑える。日上限は金額の厳密な制御ではない。失敗も上限に数え、使用量報告を保存。短寿命トークンだけを請求上限として扱わない。Google実費と速度は非公開試験で計測が必要。

## ChatGPT系の活用

自分のWebアプリに組み込む手段はOpenAIのRealtime API。音声から音声への低遅延応答、WebRTCなどを提供する。[公式ガイド](https://developers.openai.com/api/docs/guides/realtime)。通常の秘密鍵はサーバーに置き、クライアントへ渡さない。

これを採用するとGeminiのみという現在の声の条件が変わる。現時点では導入せず、Gemini Liveを先に検討する。OpenAIキー、利用予算、キャスト声の比較、リアルタイム料金と残高の管理を別途設計する。ChatGPT画面の音声ボットをこのゲームへ埋め込んだ実装ではない。

## PCを消しても動く範囲

GitHub Pagesの共有デモはPCに依存せず利用可能。[GitHub Pages公式説明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。Pagesは静的HTML/CSS/JSホスティングのため、Nodeサーバー・SQLite・秘密鍵付きAI APIを実行できない。

自由会話も外部で稼働させるには、常時動くHTTPSのNodeサーバー、永続DB、認証・外部費用の制限、ログ/監視、APIキーの秘密保管が必要。Googleキーのローカル設定・接続は確認済み。ホスティングの契約・月額予算は未確定。共有デモと有料API運営を混同しない。
