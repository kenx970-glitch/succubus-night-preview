# 映像・音声・フォント

更新日：2026-10-09。キャストは架空の成人（ルナ27歳・ミオ25歳・レイナ29歳）です。

## 保存済み素材

| 素材 | 作成手段 | 保存先 |
| --- | --- | --- |
| 3人の入店画像・5秒映像 | built-in imagegen / Fal Kling 3 Pro | public/casts.png / media/welcome.mp4 |
| 3人それぞれの6表情参照画像 | built-in imagegen | public/media/{cast}-expressions.png |
| 席の向かいに座る1人の画像 | built-in imagegen、表情画像を参照して編集 | public/media/{cast}-seated.png |
| 待機・通常・喜・哀・軽い怒り・驚き | Fal Kling 3 Pro、各5秒×3人＝18本 | public/media/{cast}-{mood}.mp4 |
| キャスト別の挨拶WAV | Fal Gemini 3.8 Flash TTS | public/media/{cast}-greeting.wav |
| UIフォント | Google Fonts公式リポジトリ、SIL OFL同梱 | public/fonts/ |

castはluna/mio/reina、moodはidle/neutral/happy/sad/angry/surprisedです。生成モデル・リクエストID・サイズは `public/media/manifest.json` に保存。画像はbuilt-inツールで生成し、出力をこのフォルダーへコピーしています。

入店から選択した担当の席へ移り、2つの動画プレイヤーを重ねてループを切り替えます。音声返答の感情に合う事前生成映像を再生。発話ごとに新しい動画は生成しません。呼吸・瞬き・口の動きはありますが、発音との完全同期は未実装です。専用衣装、商品ごとの実写動画、長編物語の増補は追加制作が必要です。

本文はNoto Sans JP、見出しはZen Maru Gothic。ローカル配信のWOFF2は約4.35MB / 1.59MBです。日本語の全文字を含むため初回容量はまだ大きく、今後は文字別サブセット配信を検討できます。

## 最終プロンプト記録

席の画像：表情参照画像を入力した編集で使用した共通プロンプト。

> Use case: identity-preserve. Asset: a photorealistic single-person cinematic keyframe for a first-person seated conversation in SUCCUBUS NIGHT, an elegant burgundy and gold Japanese fantasy concept cafe. Reference image is the six-panel identity reference ONLY. Produce ONE photograph, not a grid: preserve the exact same adult woman, face, hairstyle, small ornamental horns, modest fully-covered high-neck burgundy uniform and jewelry. She is seated on the opposite side of a small dark polished table, looking warmly into the camera at a guest seated at equal eye height. Waist-up natural relaxed pose, both hands resting correctly on the table in the lower foreground. Close intimate conversational distance, head and upper body in the right-center of the horizontal composition with cafe bokeh and velvet seating visible on the left. DSLR-quality skin texture and individual hair strands, warm practical gold lamps, soft natural facial light, cinematic shallow depth of field. Landscape 16:9 frame. No other people, no text, no logo, no watermark, no grid, no extra limbs, no revealing clothing, no seductive pose. Her expression is a small calm welcoming smile with closed lips. Camera is steady at eye level.

入店映像：

> A five-second cinematic welcoming moment in an elegant burgundy and gold Japanese fantasy concept cafe. Preserve exactly these three adult women and their distinct faces, hairstyles, fully covered burgundy uniforms and small horn accessories. They gently lower their extended hands, breathe naturally, blink once and give a small warm smile. Realistic subtle movements, stable identities, correct hands, same framing and lighting, locked-off camera, no camera cuts. No speaking, no mouth talking motions, no sexualization, no text. End in a relaxed pose suitable for a gentle looping game scene.

各席動画の最終プロンプトは `scripts/generate-cast-videos.mjs` のbase＋moods＋末尾指定に保存。開始・終了画像に同じ席画像を指定、duration 5秒、generate_audio false。TTSの声はAoede / Zephyr / Ledaで、成人女性の自然で可愛い声を指定します。

## 再生成と費用

```powershell
# 保存済みジョブの状態確認。readyは再送しません。
node --env-file-if-exists=.env scripts/generate-cast-videos.mjs status
# 未作成分の制作にはFalのAPI料金が発生します。
node --env-file-if-exists=.env scripts/generate-cast-videos.mjs submit
```

結果不明のジョブを自動再送しません。記録を削除しての再送は請求が重なる可能性があります。18本の動画制作は公開単価による概算$10.08で、Falの確定請求額ではありません。[Klingの料金・API](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api)。

会話はWhisper音声認識→Gemini 3.8 Flash＋安全判定→Gemini 3.8 Flash TTS。プレイヤーの初期料金は返答1回5Sです。実際の運営API費は音声長、文字数、トークン、失敗した呼び出しなどで変動し、固定5円とは限りません。生成済み音声・映像の再生では生成APIを呼びませんが、配信・サーバー費用はかかります。

成功した会話/安全判定のusage.costはDBへ保存し、`node scripts/usage.mjs` で参考値を確認できます。STT/TTS、結果不明の呼び出し、素材制作、配信費は集計に含まれないため、Fal請求と照合してください。

参考：[Fal Gemini TTS](https://fal.ai/models/google/gemini-3.8-flash-tts/api)、[Fal LLM](https://fal.ai/models/openrouter/router/api)、[Google音声生成](https://ai.google.dev/gemini-api/docs/speech-generation)。

## 最新の音声素材

`variant: casual-v2` の27WAV（約9MB）を現在の画面で再生。各キャストの挨拶1、話題4、ギフト4。声はAoede/Zephyr/Leda、柔らかく可愛い成人女性、自然な相づち・フランクな日本語を指定。生成用の最終スタイルは `src/fal.mjs` と `scripts/generate-casual-speech.mjs` に保存。Gemini生成がMarkdownのJSONを返した際にJSONが読み上げられる問題は、厳密なJSON解析へ修正。壊れた出力は読み上げない。

プレミアムのルナ・レイナ音声はカジュアルなセリフに合わせ2本再制作。履歴には29生成を記録し、画面では最新27本を使用。公開するmanifestからは外部サービスのリクエストIDを除去する。
