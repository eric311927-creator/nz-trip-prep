# 🥝 紐西蘭蜜月行前準備

六大主題的中文知識學習網站，使用 SRS 間隔重複記憶系統，幫助 12 月蜜月前做好知識準備。

## 功能

- 📚 六大主題：歷史、人文、地理、交通、法規、食物／農產品
- 🎯 「先學後測」UX：閱讀內容 → 解鎖測驗 → 答題學習
- 🔁 SRS 間隔複習：答對拉長間隔、答錯重置（間隔：1, 3, 7, 14, 30, 60 天）
- 📅 每日複習佇列：跨主題混合複習到期的題目
- 📊 學習儀表板：各主題正確率、熟練進度
- ☁️ Google 帳戶登入 + Firestore 跨裝置同步

## 技術棧

| 層次 | 技術 |
|------|------|
| 前端 | 純 HTML / CSS / Vanilla JS（無打包工具）|
| 託管 | GitHub Pages |
| 資料庫 | Firebase Firestore（`english-practice-cea02` 專案）|
| 認證 | Firebase Google Sign-In |

## 首次設定步驟

### 1. 填入 Firebase 設定

開啟 `firebase-config.js`，把你英文練習網站的 Firebase 設定複製貼上：

```js
const firebaseConfig = {
  apiKey: "從英文練習網站的 firebase-config.js 複製",
  authDomain: "english-practice-cea02.firebaseapp.com",
  projectId: "english-practice-cea02",
  storageBucket: "english-practice-cea02.appspot.com",
  messagingSenderId: "從英文練習網站複製",
  appId: "從英文練習網站複製"
};
```

### 2. 更新 Firestore 規則

到 Firebase Console → Firestore Database → 規則分頁，貼上 `firestore.rules` 的內容：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /nzTripUsers/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### 3. 建立 GitHub Repo 並推送

```bash
cd nz-trip-prep
git init
git add .
git commit -m "初始化 NZ 行前準備學習網站"
git remote add origin https://github.com/你的帳號/nz-trip-prep.git
git push -u origin main
```

### 4. 開啟 GitHub Pages

GitHub repo → Settings → Pages → Source 選 `main` 分支根目錄 → Save

幾分鐘後即可透過 `https://你的帳號.github.io/nz-trip-prep/` 訪問。

### 5. 加入 GitHub Pages 網域到 Firebase 認證

Firebase Console → Authentication → Settings → 授權網域 → 加入 `你的帳號.github.io`

---

## Firestore 資料結構

每位使用者一個文件：`/nzTripUsers/{uid}`

```json
{
  "srs": {
    "h1-q1": { "reps": 2, "interval": 7, "nextReview": 1735000000000, "lapses": 0 }
  },
  "lessonProgress": {
    "history-1": "quiz-done"
  },
  "stats": {
    "totalAnswered": 45,
    "totalCorrect": 38,
    "byTopic": {
      "history": { "answered": 12, "correct": 10 }
    }
  }
}
```

## 課程內容

| 主題 | 課數 | 題數 |
|------|------|------|
| 歷史 | 5 | 15 |
| 人文 | 5 | 15 |
| 地理 | 5 | 15 |
| 交通 | 5 | 15 |
| 法規 | 5 | 15 |
| 食物／農產品 | 5 | 15 |
| **合計** | **30** | **90** |

---

## 補充說明

- **法規內容**（生物安全、海關、Freedom Camping、無人機、道路規則）均已查證官方來源（MPI、NZ Customs、NZTA、CAA、DOC），但規定可能更新，出發前建議再次確認官方網站
- Freedom Camping 過渡期：依最新法規，過渡期延長至 2026 年 6 月 7 日，屆時藍色舊認證完全失效
- 無人機：國家公園（含 Fiordland、Aoraki/Mt Cook）飛無人機需事先申請 DOC 許可
