了解。いまの状況（900 行 App.tsx を崩したくない／時間ない／まず DB を確実に動かす）に合わせて、Step6〜11 を“迷わず進むためのプラン”に再設計します。

全体方針（これでブレない）

Step6 は「DB の INSERT/SELECT が確実に動く」ことが本体。

まずは 新しい Debug 画面で DB 動作だけを最短で固める（App.tsx はほぼ触らない）。

動いたら、同じ関数を Experience に移植して「Speak でカード増える」を達成。

口パクや最適化は後回し。評価に直結する “動く証拠” を先に確保。

Step6〜11：練り直しプラン（最新版）
Step6：UI 動作（入力 → INSERT → SELECT → 表示）

Step6-A（Debug 画面を追加）

追加するのは「messages 検証専用画面」1 枚だけ

UI は最低限：

Name input / Message input / Insert button

Reload button（select）

List（自分の行だけ表示）

表示する情報：created_at / name / message

Step6-B（Auth 前提を固定）

Debug 画面に入った時点で authStatus===ready であること（今の実装を流用）

authUserId が取れていることを画面に表示（すでに OK）

Step6-C（messages：自分だけ SELECT）

select ... eq("user_id", authUserId) を必ず入れる

order("created_at", { ascending: false }) + limit(20) で OK

Step6-D（messages：INSERT）

Insert は user_id, name, message を入れる

Insert 成功後に 必ず Reload（select） して最新表示
（Realtime は Step9 でやるので、Step6 はリロードで OK）

Step6-E（Experience へ移植）

Debug で動いた「insert/select 関数」をそのまま Experience にコピペ

Experience の Speak は一旦「音声なし」でも OK（Step7 でやる）

✅ DoD（Step6）：Experience で「Speak（または Send）→ DB に INSERT → 自分の行を SELECT して一覧に出る」

Step7：音声（Polly で再生）

Step6 の INSERT/SELECT が終わったらやる

Speak 押下で

DB INSERT

Polly URL 生成 → expo-av 再生

再生完了後に UI 状態を戻す

ネット無しで鳴る必要はない（URL 再生だから）

✅ DoD（Step7）：押すたびにメッセージ音声が鳴る

Step8：口パク（まず動けば OK）

“精度”じゃなく “動く” を最優先

音声再生中は jawOpen を周期的に振るだけで OK（最初はフェイクで OK）

後で viseme→blendshape に拡張

✅ DoD（Step8）：再生中に口が何かしら動く

Step9：Realtime（自分の INSERT だけ購読）

messages の INSERT を subscribe

自分の user_id のみ反映（filter）

Insert 後の Reload を消して、購読で追加されるのを見せる

✅ DoD（Step9）：Insert 直後に自動でカード追加（自分のみ）

Step10：パフォーマンス（低コスト 3 点）

ロード中 UI（Suspense fallback は既にある）

GLB preload（or Asset caching で 2 回目高速化）

音声キャッシュ（FileSystem に保存して再生）

✅ DoD（Step10）：ロード中固まらない + 2 回目速い

Step11：提出物（落とさない）

README（セットアップ、.env、Supabase 作成、messages テーブル、実行手順）

スクショ or 動画リンク（Landing→Experience→Speak→ カード増える → 音声 → 口パク）

✅ DoD（Step11）：第三者が手順通りに再現できる

次にやるのはこれ（今から 2 ステップだけ）

Step6-A：Debug 画面を追加
Step6-B：その画面で INSERT/SELECT を完成

この 2 つが終われば、Experience に移植して Step6 が確実に終わります。

次の返答で、あなたの今の構成に合わせて「Debug 画面をどこにぶら下げるか（Stack に 1 枚足す）」を前提に、Step6-A/B の実装方針を“迷わないレベル”で確定します。
