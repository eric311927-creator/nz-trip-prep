// app.js — 主應用邏輯
// 依賴：firebase-config.js, lessons.js（需先於本檔載入）

// ── 常數 ─────────────────────────────────────────
const SRS_INTERVALS = [1, 3, 7, 14, 30, 60]; // 天
const DAY_MS        = 86400 * 1000;
const MASTERY_REPS  = 3;   // 答對 3 次（14 天間隔）視為「已熟練」
const COLLECTION    = 'nzTripUsers';

const TOPIC_COLORS = {
  history:     '#8B5A2B',
  culture:     '#7B4E8E',
  geography:   '#2B6CB0',
  transport:   '#B7651B',
  regulations: '#C0392B',
  food:        '#2E7D32',
};

// ── 狀態 ─────────────────────────────────────────
let auth, db;
let currentUser = null;
let userData = {
  srs:            {},   // { [qId]: { reps, interval, nextReview, lapses } }
  lessonProgress: {},   // { [lessonId]: 'viewed' | 'quiz-done' }
  stats:          { totalAnswered: 0, totalCorrect: 0, byTopic: {} }
};

// 當前視圖狀態
let view = { name: 'home', topicId: null, lessonId: null };

// 測驗進行中的狀態
let quizState = null;
// { questions:[], idx:0, score:0, mode:'lesson'|'review', topicId, lessonId }

// ── Firebase 初始化 ───────────────────────────────
function initApp() {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db   = firebase.firestore();

  auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      document.getElementById('user-name').textContent = user.displayName || user.email;
      document.getElementById('sign-out-btn').style.display = 'inline-block';
      document.getElementById('site-nav').style.display = 'block';
      loadUserData().then(() => render());
    } else {
      document.getElementById('sign-out-btn').style.display = 'none';
      document.getElementById('site-nav').style.display = 'none';
      renderSignIn();
    }
  });

  document.getElementById('sign-out-btn').addEventListener('click', () => {
    auth.signOut();
  });

  // 導覽列
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
    });
  });
}

// ── Firestore ─────────────────────────────────────
async function loadUserData() {
  try {
    const doc = await db.collection(COLLECTION).doc(currentUser.uid).get();
    if (doc.exists) {
      const d = doc.data();
      userData = {
        srs:            d.srs            || {},
        lessonProgress: d.lessonProgress || {},
        stats:          d.stats          || { totalAnswered: 0, totalCorrect: 0, byTopic: {} },
      };
    }
  } catch (e) { console.error('loadUserData:', e); }
}

async function saveUserData() {
  if (!currentUser) return;
  try {
    await db.collection(COLLECTION).doc(currentUser.uid).set(userData);
  } catch (e) { console.error('saveUserData:', e); }
}

// ── SRS 引擎 ──────────────────────────────────────
function recordAnswer(qId, topicId, correct) {
  const card = userData.srs[qId] || { reps: 0, interval: 0, nextReview: 0, lapses: 0 };

  if (correct) {
    card.reps++;
    card.interval = SRS_INTERVALS[Math.min(card.reps - 1, SRS_INTERVALS.length - 1)];
    card.nextReview = Date.now() + card.interval * DAY_MS;
  } else {
    card.lapses++;
    card.reps = 0;
    card.interval = 0;
    card.nextReview = Date.now() + DAY_MS; // 明天再考
  }
  userData.srs[qId] = card;

  // 更新統計
  if (!userData.stats.byTopic[topicId]) {
    userData.stats.byTopic[topicId] = { answered: 0, correct: 0 };
  }
  userData.stats.totalAnswered++;
  userData.stats.byTopic[topicId].answered++;
  if (correct) {
    userData.stats.totalCorrect++;
    userData.stats.byTopic[topicId].correct++;
  }
}

function isQuestionDue(qId) {
  const card = userData.srs[qId];
  return !card || card.nextReview <= Date.now();
}

function isLessonMastered(lesson) {
  return lesson.quiz.every(q => {
    const c = userData.srs[q.id];
    return c && c.reps >= MASTERY_REPS;
  });
}

function getLessonStatus(lesson) {
  const prog = userData.lessonProgress[lesson.id];
  if (!prog) return 'unstarted';
  if (prog === 'viewed') return 'viewed';
  return isLessonMastered(lesson) ? 'mastered' : 'learning';
}

function getTopicStats(topicId) {
  const topic = TOPICS.find(t => t.id === topicId);
  if (!topic) return { mastered: 0, total: 0, dueCount: 0, progress: 0 };

  let mastered = 0, dueCount = 0;
  topic.lessons.forEach(lesson => {
    if (isLessonMastered(lesson)) mastered++;
    if (userData.lessonProgress[lesson.id]) {
      lesson.quiz.forEach(q => { if (isQuestionDue(q.id)) dueCount++; });
    }
  });
  return {
    mastered,
    total: topic.lessons.length,
    dueCount,
    progress: Math.round((mastered / topic.lessons.length) * 100),
  };
}

function getDueQuestions(topicId = null) {
  const due = [];
  TOPICS.forEach(topic => {
    if (topicId && topic.id !== topicId) return;
    topic.lessons.forEach(lesson => {
      if (!userData.lessonProgress[lesson.id]) return;
      lesson.quiz.forEach(q => {
        if (isQuestionDue(q.id)) {
          due.push({ ...q, _topicId: topic.id, _topicTitle: topic.title, _lessonTitle: lesson.title });
        }
      });
    });
  });
  // 隨機打亂
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }
  return due;
}

// ── 視圖路由 ──────────────────────────────────────
function setView(name, topicId = null, lessonId = null) {
  view = { name, topicId, lessonId };
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  render();
  window.scrollTo(0, 0);
}

function render() {
  const app = document.getElementById('app');
  switch (view.name) {
    case 'home':      app.innerHTML = renderHome();      break;
    case 'topic':     app.innerHTML = renderTopic();     break;
    case 'lesson':    app.innerHTML = renderLesson();    break;
    case 'quiz':      app.innerHTML = renderQuiz();      break;
    case 'review':    app.innerHTML = renderReview();    break;
    case 'dashboard': app.innerHTML = renderDashboard(); break;
    default:          app.innerHTML = renderHome();
  }
  bindEvents();
}

// ── 登入畫面 ──────────────────────────────────────
function renderSignIn() {
  document.getElementById('app').innerHTML = `
    <div class="signin-screen">
      <div class="signin-hero">🥝🌿🏔️</div>
      <h1>紐西蘭蜜月行前準備</h1>
      <p>六大主題學習 × SRS 間隔複習 × 跨裝置同步<br/>讓你 12 月出發前胸有成竹！</p>
      <button class="google-btn" id="google-signin">
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.1 6.4 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-4z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 13 24 13c3.1 0 5.9 1.1 8 3l5.7-5.7C34.1 6.4 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.3-5.2C29.3 35.2 26.8 36 24 36c-5.2 0-9.6-3-11.3-7.3L6 33.6C9.4 39.6 16.3 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.6 4.6-4.7 6l6.3 5.2C41.2 35.7 44 30.3 44 24c0-1.3-.1-2.7-.4-4z"/>
        </svg>
        以 Google 帳戶登入
      </button>
    </div>
  `;
  document.getElementById('google-signin').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider);
  });
}

// ── 主頁 ──────────────────────────────────────────
function renderHome() {
  const totalDue = getDueQuestions().length;
  const cardsHtml = TOPICS.map(topic => {
    const stats = getTopicStats(topic.id);
    const color = TOPIC_COLORS[topic.id] || '#1A5C3A';
    const pct = stats.progress;
    const R = 22, C = 2 * Math.PI * R;
    const dashOffset = C - (pct / 100) * C;

    return `
      <div class="topic-card" style="border-left-color:${color}" onclick="setView('topic','${topic.id}')">
        <div class="topic-card-top">
          <div class="topic-icon">${topic.icon}</div>
          <div class="topic-info">
            <div class="topic-title">${topic.title}</div>
            <div class="topic-subtitle">${stats.mastered}/${stats.total} 課程已熟練</div>
          </div>
          <svg class="topic-progress-ring" width="52" height="52" viewBox="0 0 52 52">
            <circle class="ring-bg" cx="26" cy="26" r="${R}"/>
            <circle class="ring-fg" cx="26" cy="26" r="${R}"
              stroke="${color}"
              stroke-dasharray="${C}"
              stroke-dashoffset="${dashOffset}"/>
            <text class="ring-text" x="26" y="26">${pct}%</text>
          </svg>
        </div>
        <div class="topic-card-footer">
          <span class="topic-meta">${topic.lessons.length} 課</span>
          <span class="topic-due-badge ${stats.dueCount === 0 ? 'none' : ''}">
            ${stats.dueCount > 0 ? `📅 ${stats.dueCount} 題待複習` : '✓ 無待複習'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  const dueSection = totalDue > 0 ? `
    <div style="background:var(--surface);border-radius:var(--radius);padding:1rem 1.25rem;
                margin-bottom:1.5rem;box-shadow:var(--shadow);display:flex;align-items:center;
                justify-content:space-between;gap:1rem;border-left:4px solid var(--gold)">
      <div>
        <div style="font-weight:700;color:var(--text)">📅 今日有 ${totalDue} 題待複習</div>
        <div style="font-size:.82rem;color:var(--text-muted);margin-top:.15rem">保持間隔複習，讓記憶留得更久！</div>
      </div>
      <button class="btn btn-primary" onclick="setView('review')">開始複習</button>
    </div>
  ` : '';

  return `
    ${dueSection}
    <div class="section-header">
      <h2>六大主題</h2>
      <p>點擊主題卡片，開始學習紐西蘭知識</p>
    </div>
    <div class="topic-grid">${cardsHtml}</div>
  `;
}

// ── 主題課程列表 ──────────────────────────────────
function renderTopic() {
  const topic = TOPICS.find(t => t.id === view.topicId);
  if (!topic) return renderHome();
  const color = TOPIC_COLORS[topic.id] || '#1A5C3A';

  const STATUS_LABELS = {
    unstarted: ['未開始', 'status-unstarted'],
    viewed:    ['待測驗', 'status-viewed'],
    learning:  ['練習中', 'status-learning'],
    mastered:  ['已熟練 ✓', 'status-mastered'],
  };
  const STATUS_HINTS = {
    unstarted: '點擊開始學習',
    viewed:    '已閱讀，可以開始測驗了',
    learning:  '繼續練習直到熟練',
    mastered:  '全部題目已熟練',
  };

  const lessonsHtml = topic.lessons.map((lesson, i) => {
    const st = getLessonStatus(lesson);
    const [label, cls] = STATUS_LABELS[st];
    return `
      <div class="lesson-item" onclick="setView('lesson','${topic.id}','${lesson.id}')">
        <div class="lesson-num">${i + 1}</div>
        <div class="lesson-info">
          <div class="lesson-title">${lesson.title}</div>
          <div class="lesson-hint">${STATUS_HINTS[st]}</div>
        </div>
        <span class="status-badge ${cls}">${label}</span>
      </div>
    `;
  }).join('');

  return `
    <button class="back-btn" onclick="setView('home')">← 返回主頁</button>
    <div class="topic-banner" style="border-left-color:${color}">
      <div class="banner-icon">${topic.icon}</div>
      <div>
        <h2 style="color:${color}">${topic.title}</h2>
        <p>${topic.lessons.length} 個課程 · 每課含學習內容與小測驗</p>
      </div>
    </div>
    <div class="lesson-list">${lessonsHtml}</div>
  `;
}

// ── 課程內容 ──────────────────────────────────────
function renderLesson() {
  const topic = TOPICS.find(t => t.id === view.topicId);
  if (!topic) return renderHome();
  const lesson = topic.lessons.find(l => l.id === view.lessonId);
  if (!lesson) return renderTopic();
  const color = TOPIC_COLORS[topic.id] || '#1A5C3A';
  const st = getLessonStatus(lesson);

  // 標記為已閱讀
  if (!userData.lessonProgress[lesson.id]) {
    userData.lessonProgress[lesson.id] = 'viewed';
    saveUserData();
  }

  const kpHtml = lesson.keyPoints.map(k => `<li>${k}</li>`).join('');
  const quizBtn = st === 'mastered'
    ? `<button class="btn btn-outline" onclick="startQuiz('${topic.id}','${lesson.id}')">🔁 再次測驗</button>`
    : `<button class="btn btn-accent" onclick="startQuiz('${topic.id}','${lesson.id}')">📝 開始小測驗</button>`;

  return `
    <button class="back-btn" onclick="setView('topic','${topic.id}')">← 返回${topic.title}</button>
    <div class="lesson-header" style="border-left-color:${color}">
      <div class="lesson-topic-tag" style="color:${color}">${topic.icon} ${topic.title}</div>
      <h2>${lesson.title}</h2>
    </div>
    <div class="lesson-content-card">${lesson.content}</div>
    <div class="key-points-card">
      <h3>重點摘要</h3>
      <ul class="key-points-list">${kpHtml}</ul>
    </div>
    <div class="lesson-cta">
      ${quizBtn}
      <button class="btn btn-outline" onclick="setView('topic','${topic.id}')">返回課程列表</button>
    </div>
  `;
}

// ── 開始測驗 ──────────────────────────────────────
function startQuiz(topicId, lessonId, mode = 'lesson') {
  const topic = TOPICS.find(t => t.id === topicId);
  const lesson = topic ? topic.lessons.find(l => l.id === lessonId) : null;
  const questions = lesson ? lesson.quiz : [];

  quizState = {
    questions,
    idx: 0,
    score: 0,
    answered: false,
    mode,
    topicId,
    lessonId,
  };
  view = { name: 'quiz', topicId, lessonId };
  render();
  window.scrollTo(0, 0);
}

function startReviewSession() {
  const due = getDueQuestions();
  if (due.length === 0) { setView('review'); return; }
  quizState = {
    questions: due,
    idx: 0,
    score: 0,
    answered: false,
    mode: 'review',
    topicId: null,
    lessonId: null,
  };
  view = { name: 'quiz' };
  render();
  window.scrollTo(0, 0);
}

// ── 測驗畫面 ──────────────────────────────────────
function renderQuiz() {
  if (!quizState || quizState.idx >= quizState.questions.length) {
    return renderQuizSummary();
  }

  const q = quizState.questions[quizState.idx];
  const total = quizState.questions.length;
  const fillPct = Math.round((quizState.idx / total) * 100);
  const topicLabel = q._topicTitle
    ? `<div class="review-context-tag">📚 ${q._topicTitle} · ${q._lessonTitle}</div>`
    : '';

  const optsHtml = q.options.map((opt, i) => `
    <button class="quiz-option" id="opt-${i}" onclick="handleAnswer(${i})">${opt}</button>
  `).join('');

  return `
    <div class="quiz-header">
      <button class="back-btn" onclick="abortQuiz()">← 離開測驗</button>
      <div class="quiz-progress-bar-wrap">
        <div class="quiz-progress-bar-fill" style="width:${fillPct}%"></div>
      </div>
      <div class="quiz-progress-label">第 ${quizState.idx + 1} / ${total} 題</div>
    </div>
    ${topicLabel}
    <div class="quiz-card">
      <div class="quiz-q-text">${q.q}</div>
      <div class="quiz-options" id="quiz-opts">${optsHtml}</div>
      <div id="quiz-feedback"></div>
      <div class="quiz-next-wrap" id="quiz-next"></div>
    </div>
  `;
}

function handleAnswer(selectedIdx) {
  if (quizState.answered) return;
  quizState.answered = true;

  const q = quizState.questions[quizState.idx];
  const correct = selectedIdx === q.answer;
  const topicId = q._topicId || quizState.topicId;

  recordAnswer(q.id, topicId, correct);
  if (quizState.mode === 'lesson' && !userData.lessonProgress[quizState.lessonId]?.startsWith('quiz')) {
    userData.lessonProgress[quizState.lessonId] = 'quiz-done';
  }

  if (correct) quizState.score++;

  // 視覺回饋
  document.querySelectorAll('.quiz-option').forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.answer)   btn.classList.add('correct');
    if (i === selectedIdx && !correct) btn.classList.add('wrong');
  });

  const feedbackEl = document.getElementById('quiz-feedback');
  feedbackEl.innerHTML = `
    <div class="quiz-explain ${correct ? 'correct' : 'wrong'}">
      <strong>${correct ? '✓ 答對了！' : '✗ 答錯了'}</strong>
      ${q.explain}
    </div>
  `;

  const nextEl = document.getElementById('quiz-next');
  const isLast = quizState.idx + 1 >= quizState.questions.length;
  nextEl.innerHTML = `
    <button class="btn btn-primary" onclick="nextQuestion()">
      ${isLast ? '查看結果 →' : '下一題 →'}
    </button>
  `;

  saveUserData();
}

function nextQuestion() {
  quizState.idx++;
  quizState.answered = false;
  render();
  window.scrollTo(0, 0);
}

function abortQuiz() {
  if (quizState && quizState.mode === 'review') {
    setView('review');
  } else if (quizState) {
    setView('lesson', quizState.topicId, quizState.lessonId);
  } else {
    setView('home');
  }
  quizState = null;
}

// ── 測驗結果 ──────────────────────────────────────
function renderQuizSummary() {
  if (!quizState) return renderHome();
  const { score, questions, mode, topicId, lessonId } = quizState;
  const total = questions.length;
  const pct   = Math.round((score / total) * 100);
  const emoji = pct >= 80 ? '🎉' : pct >= 60 ? '👍' : '💪';
  const msg   = pct >= 80 ? '太棒了！' : pct >= 60 ? '不錯！繼續加油' : '繼續練習，你會更好的！';

  let btns = '';
  if (mode === 'lesson' && topicId && lessonId) {
    btns = `
      <button class="btn btn-primary"  onclick="startQuiz('${topicId}','${lessonId}')">再做一次</button>
      <button class="btn btn-outline" onclick="setView('lesson','${topicId}','${lessonId}')">回到課程</button>
      <button class="btn btn-outline" onclick="setView('topic','${topicId}')">課程列表</button>
    `;
  } else {
    btns = `
      <button class="btn btn-primary"  onclick="startReviewSession()">再複習一輪</button>
      <button class="btn btn-outline" onclick="setView('home')">回主頁</button>
    `;
  }

  return `
    <div class="quiz-summary">
      <div class="summary-emoji">${emoji}</div>
      <div class="summary-score">${score} / ${total}</div>
      <div class="summary-label">${pct}% 正確率 · ${msg}</div>
      <div class="summary-btns">${btns}</div>
    </div>
  `;
}

// ── 每日複習 ──────────────────────────────────────
function renderReview() {
  const due = getDueQuestions();
  if (due.length === 0) {
    return `
      <div class="section-header"><h2>每日複習</h2></div>
      <div class="review-empty">
        <div class="empty-icon">🌿</div>
        <p style="font-weight:700;margin-bottom:.5rem">今天沒有待複習的題目</p>
        <p style="font-size:.85rem">繼續學習新課程，題目會自動安排到未來的複習日！</p>
        <div style="margin-top:1.5rem">
          <button class="btn btn-primary" onclick="setView('home')">去學新課程</button>
        </div>
      </div>
    `;
  }

  const byTopic = {};
  due.forEach(q => {
    const tid = q._topicId;
    if (!byTopic[tid]) byTopic[tid] = { title: q._topicTitle, icon: TOPICS.find(t=>t.id===tid)?.icon||'', count: 0 };
    byTopic[tid].count++;
  });
  const breakdownHtml = Object.entries(byTopic).map(([tid, d]) => `
    <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;font-size:.9rem">
      <span>${d.icon}</span>
      <span style="flex:1">${d.title}</span>
      <span style="font-weight:600;color:var(--primary)">${d.count} 題</span>
    </div>
  `).join('');

  return `
    <div class="section-header">
      <h2>每日複習</h2>
      <p>SRS 排程選出今天最需要複習的題目</p>
    </div>
    <div style="background:var(--surface);border-radius:var(--radius);padding:1.25rem 1.5rem;
                box-shadow:var(--shadow);margin-bottom:1.5rem">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:.75rem">
        📅 今天共 <span style="color:var(--primary)">${due.length}</span> 題待複習
      </div>
      ${breakdownHtml}
      <div style="margin-top:1.25rem">
        <button class="btn btn-primary" onclick="startReviewSession()">開始複習 →</button>
      </div>
    </div>
  `;
}

// ── 儀表板 ────────────────────────────────────────
function renderDashboard() {
  const { totalAnswered, totalCorrect } = userData.stats;
  const acc = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  // 計算全域熟練題數
  let totalMastered = 0, totalQuestions = 0;
  TOPICS.forEach(topic => {
    topic.lessons.forEach(lesson => {
      lesson.quiz.forEach(q => {
        totalQuestions++;
        const c = userData.srs[q.id];
        if (c && c.reps >= MASTERY_REPS) totalMastered++;
      });
    });
  });

  const statsHtml = `
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-num">${totalAnswered}</div>
        <div class="stat-label">累計作答題次</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${acc}%</div>
        <div class="stat-label">整體正確率</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${totalMastered}</div>
        <div class="stat-label">已熟練題目 / ${totalQuestions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${getDueQuestions().length}</div>
        <div class="stat-label">今日待複習</div>
      </div>
    </div>
  `;

  const topicRowsHtml = TOPICS.map(topic => {
    const stats = getTopicStats(topic.id);
    const color = TOPIC_COLORS[topic.id] || '#1A5C3A';
    const ts = userData.stats.byTopic[topic.id] || { answered: 0, correct: 0 };
    const topicAcc = ts.answered > 0 ? Math.round((ts.correct / ts.answered) * 100) : null;

    return `
      <div class="topic-stat-row" onclick="setView('topic','${topic.id}')">
        <div class="topic-stat-icon">${topic.icon}</div>
        <div class="topic-stat-info">
          <div class="topic-stat-name">${topic.title}</div>
          <div class="topic-stat-detail">
            ${stats.mastered}/${stats.total} 課熟練
            ${topicAcc !== null ? ` · 正確率 ${topicAcc}%` : ''}
            ${stats.dueCount > 0 ? ` · 📅 ${stats.dueCount} 題待複習` : ''}
          </div>
        </div>
        <div class="bar-wrap">
          <div class="bar-bg"><div class="bar-fill" style="width:${stats.progress}%;background:${color}"></div></div>
          <div class="bar-pct">${stats.progress}%</div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="section-header"><h2>學習統計</h2></div>
    ${statsHtml}
    <div class="section-header"><h2>各主題進度</h2></div>
    <div style="display:flex;flex-direction:column;gap:.5rem">${topicRowsHtml}</div>
  `;
}

// ── 事件綁定 ──────────────────────────────────────
function bindEvents() {
  // 全域函數已在 HTML inline onclick 引用，無需額外綁定
}

// ── Toast 通知 ────────────────────────────────────
function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ── 啟動 ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);
