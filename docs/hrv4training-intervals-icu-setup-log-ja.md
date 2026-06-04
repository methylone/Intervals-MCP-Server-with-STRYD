# HRV4Training ↔ Intervals.icu 接続トライアル作業ログ（まとめ）

## 目的
- **朝の定点測定（HRV4Training）** を Intervals.icu に取り込みたい
- Garminの24/7データと混在しないように整理したい
- ウルトラレース向けの週次サマリーに使える形にしたい

---

## 前提（手元のデータソース）
- **Garmin Watch**
  - 24/7装着
  - RHR / HRV / Sleep系（睡眠時間・スコア）
- **HRV4Training**
  - 朝の定点測定（RHR / HRV / 主観系）
- （検討）**Sleep Cycle / Apple Health**
  - 睡眠分析用途

---

## 今回の結論（最終方針）
### データの役割分担
- **Garmin（24/7）**
  - Sleep Time
  - Sleep Score（入る場合）
- **HRV4Training（朝の定点）**
  - RHR
  - HRV系（rMSSD / 必要ならSDNN）
  - Motivation
  - Mood
  - Soreness
  - Fatigue
- **ワークアウト本体**
  - Garmin / Strava 連携を継続（HRV4T経由では入れない）

---

## 1. 取り込み方法の確認（調査フェーズ）
### 確認したこと
- HRV4Training → Intervals の連携は、**Dropbox経由**で可能
- Intervals側は **Wellnessデータとして取り込む**（ワークアウト本体ではない）
- GarminのWellness（RHR/HRV等）と混在しやすいので、運用設計が必要

### 補足
- Dropbox無料枠（Basic）は **2GB** で、HRV4TのCSV用途には十分

---

## 2. HRV4Training の Dropbox 連携（最初のハマり）
### 症状
- HRV4Trainingアプリ内で Dropbox連携したが、
  - 同期されない
  - チェックが外れてしまう
- Dropbox側にファイルが見えない

### 原因として理解したこと
- **「Dropbox連携」= 認証**
- **「データ送信」= Export操作（別）**
- つまり、常時自動同期ではなく、**HRV4Training側で `Export Data > Dropbox` が必要**

### 対処
- HRV4TrainingのDropbox連携を再確認
- 必要に応じて Dropbox をログアウト→再ログイン
- `Export Data > Dropbox` を実行
- Dropbox内（通常 `Apps/HRV4Training`）にCSVが出ることを確認

### メモ
- **Dropboxフォルダは通常手動作成不要**
- App folder方式なので `Apps/HRV4Training` が自動生成される想定

---

## 3. Intervals.icu 側の設定（Dropbox / HRV4Training ファイル）
### 実施内容
- Intervals.icu の **Dropbox設定**を開く
- **HRV4Trainingファイルのインポート設定**を追加
- 対象CSVを指定して取り込み開始

### ハマりポイント
- `First day to import` の日付設定が新しすぎると、過去データが入らない可能性あり
- 必要に応じて開始日を見直す

---

## 4. HRV4Training から取り込むメトリクスの選択
### 設定箇所
- Intervals.icu の Dropbox設定内
- HRV4Trainingファイル設定ダイアログの **項目一覧右側の鉛筆アイコン（✏️）**

### ON/OFFを設定した項目（採用）
- ✅ RHR
- ✅ HRV系（rMSSD中心）
- ✅ Motivation
- ✅ Mood
- ✅ Soreness
- ✅ Fatigue

### 保留/非採用（混在回避のため）
- ❌ Sleep Time（Garmin側を使う）
- ❌ Sleep Quality（Garmin側を優先）
- （必要に応じて）
  - ❌ SDNN
  - ❌ VO2max
  - ❌ その他の主観項目

---

## 5. Garmin由来のRHR/HRVが混在した問題（整理）
### 症状
- HRV4TrainingのRHR/HRVを入れたら、**Garmin由来のRHR/HRVが既に混在**していた

### 対処手順（実施）
1. **Intervals.icu 側で Garmin Wellness の取り込みをOFF**
   - 先に止めないと、削除しても再流入する
2. **Wellness CSV をダウンロード**
3. CSVを編集して、Garmin由来で消したい値のセルに `-1` を入力
   - `hrv`, `resting_hr` など対象列
   - ※空欄では削除扱いにならない
4. **編集CSVを再アップロード**
5. 必要なら HRV4Training 側のデータを再Export / 再読込

### 結果
- Garmin由来のRHR/HRVを整理できた
- HRV4Trainingの朝定点データに統一できた

---

## 6. 「HRV4TrainingのStrava連携」がIntervalsにワークアウトを送るか？問題
### 懸念
- HRV4TrainingはStrava連携している
- そのワークアウトデータが Intervals に混入しないか？

### 結論
- **基本的に問題なし**
- HRV4Training → Dropbox → Intervals は **Wellness取り込み経路**
- **ワークアウト本体は入らない**（RHR/HRV/主観系などの体調データが中心）

### つまり
- ワークアウト同期は引き続き Garmin / Strava で管理
- HRV4Trainingは朝の体調データ専用として使える

---

## 7. Sleep系のソース設計（Garmin vs Sleep Cycle）
### 検討したこと
- Sleep Cycleを使いたい
- Apple Health経由でIntervalsに入れるルートもある（HealthFit / Health Sync / BreakAway 等）
- ただし構成が複雑になる & Sleep Qualityの扱いがやや不安定

### 最終判断
- **Intervalsに入れる睡眠データは Garmin を採用**
  - 24/7装着前提なら最も簡便
  - Garmin → Intervals の直接連携で完結
- **Sleep Cycle は個人の見返し・分析用途として継続可**

---

## 現在の最終構成（運用イメージ）
### Intervals.icu に入るもの
#### Garmin（Wellness）
- Sleep Time
- Sleep Score（取得できる場合）

#### HRV4Training（Dropbox経由）
- RHR
- HRV（rMSSD）
- Motivation
- Mood
- Soreness
- Fatigue

#### Garmin / Strava（ワークアウト）
- 活動ログ（ラン、バイク等）

---

## 日次運用フロー（実務）
1. 朝、**HRV4Trainingで測定**
2. HRV4Trainingで **`Export Data > Dropbox`**
3. Intervals.icu 側でDropbox連携により取り込み（自動反映）
4. IntervalsのWellness画面で確認
   - RHR / HRV / 主観系が更新されているか
5. Garminは24/7装着のまま
   - Sleep Time / Sleep Scoreを自動取得

---

## 注意点（今後の運用）
- **GarminとHRV4Tで同じ項目を同時に入れない**
  - 例：RHR / HRV はHRV4T側に寄せる
- **HRV4Trainingは「Export」が必要**
  - 連携認証だけでは送られない
- CSV異常値（例：VO2max=0）があると取り込みエラーの原因になることがある
  - 必要なら該当項目の取り込みをOFF

---

## 次の一手（任意）
- IntervalsのWellness画面を前提に、**ウルトラレース向けの監視項目（最小構成）**を確定する
  - 例：
    - HRV（rMSSD）
    - RHR
    - Motivation
    - Mood
    - Soreness
    - Fatigue
    - Sleep Time
    - Sleep Score
- 週次サマリー（GAS/スプレッドシート）側へ、これらをどう連携・表示するかを設計する