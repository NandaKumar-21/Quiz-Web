/* ---------- Firebase initialisation ---------- */
import { initializeApp }      from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getFirestore,
         collection, doc,
         addDoc, setDoc, getDoc,
         updateDoc, onSnapshot,
         query, orderBy, limit,
         serverTimestamp, increment } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyDeDonD2FR4Qr8371Z1xHHAQkQFkmclTp0",
  authDomain:        "quizmaster2025-3e131.firebaseapp.com",
  projectId:         "quizmaster2025-3e131",
  storageBucket:     "quizmaster2025-3e131.appspot.com",
  messagingSenderId: "609107619162",
  appId:             "1:609107619162:web:e460e39e3598a14fef5763"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* ---------- Global state ---------- */
const TOTAL_QUESTIONS   = 20;          // update if your question set changes
const HOST_PASS         = 'Nanda@secretcode'; // very simple password demo—replace in prod!

let currentState = {
  isHost: false,
  teamCode: null,
  questionNo: 0,
  timer: 60,
  timerInterval: null
};

/* ---------- DOM shortcuts ---------- */
const $ = id => document.getElementById(id);
const screens = {
  login:   $('loginScreen'),
  host:    $('hostScreen'),
  waiting: $('waitingScreen'),
  quiz:    $('quizScreen'),
  results: $('resultsScreen'),
  final:   $('finalScreen')
};

/* ---------- Utility UI helpers ---------- */
function show(screen) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[screen].classList.remove('hidden');
}
const notify = (msg, ok = true) => alert(msg);   // swap for toast if desired

/* ---------- EVENT BINDINGS ---------- */
document.addEventListener('DOMContentLoaded', () => {
  /* participant login */
  $('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('teamId').value.trim();
    if (!/^\d{5}$/.test(code)) return notify('Enter a 5-digit team code', false);

    currentState.teamCode = code;
    addDoc(collection(db, 'attendees'), {
      teamId: code,
      joined: serverTimestamp()
    });                                        // no await -> fire-and-forget
    $('teamDisplay').textContent = code;
    show('waiting');
  });

  /* switch to host view */
  $('hostModeBtn').onclick = () => {
    currentState.isHost = true;
    show('host');
    $('hostPassword').focus();
  };
  $('backToLoginBtn').onclick = () => location.reload();

  /* host auth */
  $('hostLoginBtn').onclick = () => {
    if ($('hostPassword').value !== HOST_PASS) return notify('Wrong password', false);
    $('hostLoginForm').classList.add('hidden');
    $('hostControls').classList.remove('hidden');
    watchMetadata();          // start live dashboard
  };

  /* host controls */
  $('startQuizBtn').onclick      = hostStartQuiz;
  $('nextQuestionBtn').onclick   = hostNextQuestion;
  $('endQuizBtn').onclick        = hostEndQuiz;

  /* participant answer */
  $('submitAnswer').onclick      = submitAnswer;

  /* numeric mask for team ID */
  $('teamId').oninput = e => e.target.value = e.target.value.replace(/\D/g, '').slice(0,5);

  /* waiting-room live stats */
  onSnapshot(collection(db, 'attendees'), snap => {
    $('waitingParticipants').textContent = snap.size;
  });
});

/* ---------- HOST FUNCTIONS ---------- */
async function hostStartQuiz() {
  await setDoc(doc(db, 'metadata', 'state'), {
    quizStarted: true,
    currentQuestion: 1,
    created: serverTimestamp()
  });
  $('startQuizBtn').classList.add('hidden');
  $('nextQuestionBtn').classList.remove('hidden');
}

async function hostNextQuestion() {
  const metaRef = doc(db, 'metadata', 'state');
  const metaSnap = await getDoc(metaRef);
  if (!metaSnap.exists()) return;

  const nextNum = metaSnap.data().currentQuestion + 1;
  if (nextNum > TOTAL_QUESTIONS) return notify('No more questions', false);

  await updateDoc(metaRef, { currentQuestion: nextNum });
}

async function hostEndQuiz() {
  await updateDoc(doc(db, 'metadata', 'state'), { quizEnded: true });
  $('nextQuestionBtn').classList.add('hidden');
  $('endQuizBtn').classList.add('hidden');
}

/* ---------- DASHBOARD LIVE COUNTS ---------- */
function watchMetadata() {
  const metaRef = doc(db, 'metadata', 'state');

  /* live quiz state */
  onSnapshot(metaRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();

    $('currentQuestionNum').textContent = data.currentQuestion ?? 0;

    if (data.quizStarted && !data.quizEnded) {
      loadQuestionForHost(data.currentQuestion);
    }
    if (data.quizEnded) showFinalStandings();
  });

  /* live participant totals */
  onSnapshot(collection(db, 'attendees'), s => {
    $('participantCount').textContent = s.size;
  });
}

/* show per-question live results for host */
function loadQuestionForHost(qNo) {
  const ansRef = collection(db, 'answers', `q${qNo}`, 'submissions');
  onSnapshot(ansRef, s => {
    $('responsesCount').textContent = s.size;
  });
}

/* ---------- PARTICIPANT LISTENERS ---------- */
onSnapshot(doc(db, 'metadata', 'state'), snap => {
  const data = snap.data() || {};
  if (!data.quizStarted) return;

  if (data.quizEnded) {
    showFinalStandings();
    return;
  }

  if (data.currentQuestion !== currentState.questionNo) {
    currentState.questionNo = data.currentQuestion;
    loadQuestionForPlayer(data.currentQuestion);
  }
});

/* get question data from 'questions/q1', 'questions/q2', … */
async function loadQuestionForPlayer(qNo) {
  const qSnap = await getDoc(doc(db, 'questions', `q${qNo}`));
  if (!qSnap.exists()) return;

  const q = qSnap.data();
  $('questionNumber').textContent = qNo;
  $('totalQuestions').textContent = TOTAL_QUESTIONS;
  $('questionText').textContent   = q.text;

  // build options
  const optsDiv = $('optionsContainer');
  optsDiv.innerHTML = '';
  ['A','B','C','D'].forEach(letter => {
    const div = document.createElement('div');
    div.className = 'option';
    div.textContent = `${letter}. ${q.options[letter]}`;
    div.onclick = () => selectOption(letter, div);
    optsDiv.appendChild(div);
  });
  $('submitAnswer').disabled = true;

  /* restart timer */
  if (currentState.timerInterval) clearInterval(currentState.timerInterval);
  currentState.timer = 60;
  tickDown();
  currentState.timerInterval = setInterval(tickDown, 1000);

  show('quiz');
}

function tickDown() {
  currentState.timer--;
  const m = String(Math.floor(currentState.timer/60)).padStart(2,'0');
  const s = String(currentState.timer%60).padStart(2,'0');
  $('timer').textContent     = `${m}:${s}`;
  $('hostTimer').textContent = `${m}:${s}`;
  if (currentState.timer <= 0) {
    clearInterval(currentState.timerInterval);
    notify('Time up!');           // auto-submit only if selected
    if ($('submitAnswer').disabled === false) submitAnswer();
  }
}

/* option selection */
function selectOption(letter, element) {
  document.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
  element.classList.add('selected');
  $('submitAnswer').dataset.answer = letter;
  $('submitAnswer').disabled = false;
}

/* ---------- ANSWER SUBMISSION ---------- */
async function submitAnswer() {
  const answer = $('submitAnswer').dataset.answer;
  if (!answer) return;

  const { teamCode, questionNo, timer } = currentState;
  const timeUsed = 60 - timer;

  // write under answers/qX/submissions/<generated>
  await addDoc(collection(db, 'answers', `q${questionNo}`, 'submissions'), {
    teamId: teamCode,
    answer,
    timeUsed,
    created: serverTimestamp()
  });

  // simplistic scoring: +10 pts if correct, +bonus(<=5) for speed
  const qSnap   = await getDoc(doc(db, 'questions', `q${questionNo}`));
  const correct = qSnap.data().correct === answer;
  const speedBonus = correct ? Math.max(0, 5 - Math.floor(timeUsed/12)) : 0;
  const points = correct ? 10 + speedBonus : 0;

  const partRef = doc(db, 'participants', teamCode);
  await setDoc(partRef, { totalScore: 0 }, { merge:true });
  if (points)
    await updateDoc(partRef, { totalScore: increment(points) });

  showResults(correct, points, qSnap.data().correct);
}

function showResults(correct, points, correctAnswer) {
  show('results');
  const box = $('answerFeedback');
  if (correct) {
    box.className = 'feedback correct';
    box.innerHTML = `<strong>Correct!</strong><br>You earned ${points} pts`;
  } else {
    box.className = 'feedback incorrect';
    box.innerHTML = `<strong>Incorrect.</strong><br>The correct answer was ${correctAnswer}`;
  }
  loadLeaderboard();
}

/* ---------- LEADERBOARD ---------- */
function loadLeaderboard() {
  const q = query(collection(db, 'participants'),
                  orderBy('totalScore','desc'), limit(100));
  onSnapshot(q, snap => {
    renderLeaderboard(snap.docs.map(d => d.data()), 'leaderboardList');
  });
}
function renderLeaderboard(list, targetId) {
  const tgt = $(targetId);
  tgt.innerHTML = '';
  list.forEach((row, idx) => {
    const div = document.createElement('div');
    div.className = 'leaderboard-item';
    div.innerHTML = `<span class="leaderboard-rank">#${idx+1}</span>
                     <span class="leaderboard-team">Team ${row.teamId}</span>
                     <span class="leaderboard-score">${row.totalScore} pts</span>`;
    tgt.appendChild(div);
  });
}

/* ---------- FINAL STANDINGS ---------- */
function showFinalStandings() {
  loadLeaderboard(); // fills leaderboardPreview too
  const myRef = doc(db, 'participants', currentState.teamCode);
  getDoc(myRef).then(snap => {
    const myScore = snap.data()?.totalScore ?? 0;
    // rank calculation client-side
    onSnapshot(query(collection(db, 'participants'),
                     orderBy('totalScore','desc')), snapAll => {
      const arr = snapAll.docs;
      const rank = arr.findIndex(d => d.id === currentState.teamCode) + 1;
      $('teamFinalRank').textContent  = `#${rank}`;
      $('teamFinalScore').textContent = myScore;
      renderLeaderboard(arr.map(d=>d.data()), 'finalLeaderboardList');
      show('final');
    });
  });
}
