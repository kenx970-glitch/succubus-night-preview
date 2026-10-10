# Gemini Live 接続検証

2026-10-10 / ローカル限定

Googleへの短い音声生成は計2回。Googleの課金設定を変更していない。APIキーだけではFree/Paidプランや実請求額を確認できず、無料利用を保証する記録ではない。AI Studio側で課金プラン・利用量・請求額を確認する。

```json
{
  "connected": true,
  "model": "gemini-3.8-live",
  "voice": "Aoede",
  "reply": "こんにちは、お話ししてくれてありがとう！音声テスト、バッチリ聞こえてるよ。",
  "firstAudioMs": 868,
  "audioSeconds": 5.62,
  "testS": 15,
  "realMicrophoneTested": false
}
```

実際のGoogle接続、テキスト入力から音声ストリーミング、24kHz WAV保存、テスト用Sの消費を隔離したメモリーDBで確認。通常アカウントの残高は変更していない。PCの実マイク入力・聞こえ方は利用者の端末で確認する。APIキーを記録・公開していない。

## 録音済み音声入力

```json
{
  "connected": true,
  "input": "recorded_pcm",
  "model": "gemini-3.8-live",
  "voice": "Aoede",
  "inputTranscript": "こんにちは。お話ししてくれてありがとう。音声テスト、ばっちり聞こえてるよ。",
  "reply": "こんにちは！音声テスト、ばっちりだね。こちらこそ、見つけてくれてありがとう。",
  "firstAudioMs": 819,
  "audioSeconds": 5.6,
  "testS": 15,
  "realMicrophoneTested": false
}
```

生成済みの挨拶音声を16kHz PCMへ変換し、40msずつ送信して発話開始・終了、文字起こし、音声返答、Sの消費を確認。実マイク・ブラウザー録音は別途端末で確認する。
