import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, doc, addDoc, getDoc, setDoc, updateDoc, onSnapshot, query, where, getDocs, orderBy, serverTimestamp, increment, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- IMPORTANT: REPLACE WITH YOUR FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey:            "AIzaSyDeDonD2FR4Qr8371Z1xHHAQkQFkmclTp0",
  authDomain:        "quizmaster2025-3e131.firebaseapp.com",
  projectId:         "quizmaster2025-3e131",
  storageBucket:     "quizmaster2025-3e131.appspot.com",
  messagingSenderId: "609107619162",
  appId:             "1:609107619162:web:e460e39e3598a14fef5763"
};

// --- INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const TOTAL_QUESTIONS = 40;
const QUESTION_TIMER = 30;

// --- STATE MANAGEMENT ---
let localState = {
  isHost: false,
  teamCode: null,
  currentQuestion: 0,
  selectedAnswer: null,
  isSubmitting: false,
  timerInterval: null,
};

// --- DOM ELEMENTS ---
const $ = id => document.getElementById(id);
const screens = {
  choice: $('choiceScreen'),
  participantLogin: $('participantLoginScreen'),
  hostLogin: $('hostLoginScreen'),
  host: $('hostScreen'),
  waiting: $('waitingScreen'),
  quiz: $('quizScreen'),
  results: $('resultsScreen'),
  final: $('finalScreen'),
};

// --- CORE FUNCTIONS ---
const showScreen = (screenName) => {
  Object.values(screens).forEach(screen => screen.classList.add('hidden'));
  screens[screenName].classList.remove('hidden');
};

const notify = (message, isError = false) => {
  alert(message); // Simple notification
};

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupForms();
  listenToGlobalState();
});

function setupNavigation() {
  $('showParticipantLogin').onclick = () => showScreen('participantLogin');
  $('showHostLogin').onclick = () => showScreen('hostLogin');
  $('backToChoiceP').onclick = () => showScreen('choice');
  $('backToChoiceH').onclick = () => showScreen('choice');
  $('logoutHostBtn').onclick = () => window.location.reload();
}

function setupForms() {
  // Participant Login
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const teamIdInput = $('teamId');
    const teamCode = teamIdInput.value.trim();
    if (!/^\d{5}$/.test(teamCode)) {
      return notify('Team Code must be 5 digits.', true);
    }
    
    const validTeamRef = doc(db, 'validTeams', teamCode);
    const validTeamSnap = await getDoc(validTeamRef);
    if (!validTeamSnap.exists()) {
      return notify('This Team Code is not registered.', true);
    }

    const participantRef = doc(db, 'participants', teamCode);
    const participantSnap = await getDoc(participantRef);
    if (participantSnap.exists() && participantSnap.data().joined) {
       return notify('This team has already joined the quiz.', true);
    }

    localState.teamCode = teamCode;
    // Set as a participant for scoring
    await setDoc(participantRef, { joined: true }, { merge: true });
    
    // NEW: Log the attendance in the 'attendees' collection
    await addDoc(collection(db, 'attendees'), {
        teamId: teamCode,
        joined: serverTimestamp()
    });

    $('teamDisplay').textContent = teamCode;
    showScreen('waiting');
  });

  // Host Login
  $('hostLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('hostPassword').value;
    const adminRef = doc(db, 'admin', 'host');
    const adminSnap = await getDoc(adminRef);

    if (adminSnap.exists() && adminSnap.data().password === password) {
      localState.isHost = true;
      showScreen('host');
      setupHostDashboard();
    } else {
      notify('Incorrect password.', true);
    }
  });

  // Participant Answer Submission
  $('submitAnswer').onclick = () => {
    if (localState.selectedAnswer && !localState.isSubmitting) {
      submitAnswer(localState.selectedAnswer);
    }
  };
}

// --- HOST DASHBOARD ---
function setupHostDashboard() {
  $('startQuizBtn').onclick = hostStartQuiz;
  $('nextQuestionBtn').onclick = hostNextQuestion;
  $('endQuizBtn').onclick = hostEndQuiz;
  $('resetQuizBtn').onclick = hostResetQuiz;
  $('downloadReportBtn').onclick = downloadCSVReport;
  $('downloadAttendeesBtn').onclick = downloadAttendeesReport; // New button event

  const participantsQuery = query(collection(db, 'participants'), where("joined", "==", true));
  onSnapshot(participantsQuery, (snap) => {
    $('participantCount').textContent = snap.size;
    const waitingParticipantsEl = $('waitingParticipants');
    if (waitingParticipantsEl) {
        waitingParticipantsEl.textContent = snap.size;
    }
  });

  const leaderboardQuery = query(collection(db, 'participants'), orderBy('totalScore', 'desc'), orderBy('totalResponseTime', 'asc'));
  onSnapshot(leaderboardQuery, (snap) => {
    const participants = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderLeaderboard(participants, 'hostLeaderboardList');
  });
}

// --- HOST ACTIONS ---
async function hostStartQuiz() {
  await updateDoc(doc(db, 'metadata', 'state'), { quizStarted: true, currentQuestion: 1 });
}

async function hostNextQuestion() {
  const stateRef = doc(db, 'metadata', 'state');
  const stateSnap = await getDoc(stateRef);
  const currentQ = stateSnap.data().currentQuestion;

  if (currentQ < TOTAL_QUESTIONS) {
    await updateDoc(stateRef, { currentQuestion: currentQ + 1 });
  } else {
    notify('This was the last question.', false);
    await hostEndQuiz();
  }
}

async function hostEndQuiz() {
  await updateDoc(doc(db, 'metadata', 'state'), { quizEnded: true });
}

async function hostResetQuiz() {
  if (!confirm('Are you sure you want to RESET the entire quiz? All scores will be lost.')) return;
  
  await setDoc(doc(db, 'metadata', 'state'), {
    currentQuestion: 0,
    quizStarted: false,
    quizEnded: false
  });

  const participantsSnap = await getDocs(collection(db, 'participants'));
  const batch = writeBatch(db);
  participantsSnap.forEach(doc => {
      batch.delete(doc.ref);
  });
  await batch.commit();

  notify('Quiz has been reset.');
  window.location.reload();
}

// --- PARTICIPANT QUIZ FLOW ---
function listenToGlobalState() {
  onSnapshot(doc(db, 'metadata', 'state'), (snap) => {
    const state = snap.data();
    if (!state) return;

    if (localState.isHost) {
      updateHostView(state);
    }
    
    if (!localState.isHost && localState.teamCode) {
        if (state.quizEnded) {
            showFinalScreen();
            return;
        }
        
        if (state.quizStarted && state.currentQuestion !== localState.currentQuestion) {
            loadQuestionForParticipant(state.currentQuestion);
        }
    }
  });
}

async function loadQuestionForParticipant(qNum) {
    localState.currentQuestion = qNum;
    if (qNum === 0) {
        showScreen('waiting');
        return;
    }

    const qRef = doc(db, 'questions', `q${qNum}`);
    const qSnap = await getDoc(qRef);
    if (!qSnap.exists()) return;

    const question = qSnap.data();
    $('questionNumber').textContent = qNum;
    $('questionText').textContent = question.text;

    localState.selectedAnswer = null;
    localState.isSubmitting = false;
    $('submissionNotice').textContent = '';
    $('submitAnswer').disabled = true;

    const optionsContainer = $('optionsContainer');
    optionsContainer.innerHTML = '';

    const optionOrder = ['A', 'B', 'C', 'D'];
    optionOrder.forEach(key => {
        if (question.options[key]) {
            const value = question.options[key];
            const optionEl = document.createElement('div');
            optionEl.className = 'option';
            optionEl.textContent = `${key}. ${value}`;
            optionEl.onclick = () => selectOption(key, optionEl);
            optionsContainer.appendChild(optionEl);
        }
    });

    startTimer();
    showScreen('quiz');
}

function selectOption(answerKey, element) {
  if (localState.isSubmitting) return;
  
  document.querySelectorAll('.option').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');
  localState.selectedAnswer = answerKey;
  $('submitAnswer').disabled = false;
}

async function submitAnswer(answer) {
  localState.isSubmitting = true;
  clearInterval(localState.timerInterval);

  const timeUsed = QUESTION_TIMER - (parseInt($('timer').textContent.split(':')[1]) || 0);
  $('submitAnswer').disabled = true;
  $('submissionNotice').textContent = 'Submitting...';

  const qNum = localState.currentQuestion;
  const qRef = doc(db, 'questions', `q${qNum}`);
  const qSnap = await getDoc(qRef);
  const correctAnswer = qSnap.data().correct;

  const isCorrect = answer === correctAnswer;
  
  const participantRef = doc(db, 'participants', localState.teamCode);
  await setDoc(participantRef, {
    totalScore: increment(isCorrect ? 1 : 0),
    totalResponseTime: increment(timeUsed)
  }, { merge: true });

  $('submissionNotice').textContent = 'Answer submitted successfully!';
  showResultsScreen(isCorrect, correctAnswer);
}

function showResultsScreen(isCorrect, correctAnswer) {
    const feedbackEl = $('answerFeedback');
    if (isCorrect) {
        feedbackEl.className = 'feedback correct';
        feedbackEl.innerHTML = `<strong>Correct!</strong> Your answer was submitted.`;
    } else {
        feedbackEl.className = 'feedback incorrect';
        feedbackEl.innerHTML = `<strong>Incorrect.</strong> The correct answer was ${correctAnswer}.`;
    }

    const leaderboardQuery = query(collection(db, 'participants'), orderBy('totalScore', 'desc'), orderBy('totalResponseTime', 'asc'));
    onSnapshot(leaderboardQuery, (snap) => {
        const participants = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderLeaderboard(participants, 'leaderboardList');
    });

    showScreen('results');
}

async function showFinalScreen() {
    clearInterval(localState.timerInterval);
    const leaderboardQuery = query(collection(db, 'participants'), orderBy('totalScore', 'desc'), orderBy('totalResponseTime', 'asc'));
    const snap = await getDocs(leaderboardQuery);
    const participants = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const myRank = participants.findIndex(p => p.id === localState.teamCode) + 1;
    const myData = participants.find(p => p.id === localState.teamCode);

    $('teamFinalRank').textContent = myRank > 0 ? `#${myRank}` : 'N/A';
    $('teamFinalScore').textContent = myData?.totalScore ?? 0;
    
    renderLeaderboard(participants, 'finalLeaderboardList');
    showScreen('final');
}

function startTimer() {
  clearInterval(localState.timerInterval);
  let timeLeft = QUESTION_TIMER;

  const updateTimers = () => {
    const minutes = String(Math.floor(timeLeft / 60)).padStart(2, '0');
    const seconds = String(timeLeft % 60).padStart(2, '0');
    const timeString = `${minutes}:${seconds}`;

    if (localState.isHost) {
        $('hostTimer').textContent = timeString;
    } else {
        $('timer').textContent = timeString;
    }
  };

  updateTimers();
  
  localState.timerInterval = setInterval(() => {
    timeLeft--;
    updateTimers();
    if (timeLeft <= 0) {
      clearInterval(localState.timerInterval);
      if (!localState.isHost && !localState.isSubmitting) {
          notify('Time is up!');
          submitAnswer(null);
      }
    }
  }, 1000);
}

function renderLeaderboard(participants, elementId) {
    const container = $(elementId);
    if (!container) return;
    container.innerHTML = '';
    participants.forEach((p, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        item.innerHTML = `
            <span class="leaderboard-rank">#${index + 1}</span>
            <span class="leaderboard-team">Team ${p.id}</span>
            <span class="leaderboard-score">${p.totalScore ?? 0} pts</span>
        `;
        container.appendChild(item);
    });
}

async function updateHostView(state) {
    $('currentQuestionNum').textContent = state.currentQuestion;

    if (state.quizEnded) {
        $('hostQuestionText').textContent = 'The quiz has ended!';
        $('hostOptionsContainer').innerHTML = '';
        $('startQuizBtn').classList.add('hidden');
        $('nextQuestionBtn').classList.add('hidden');
        $('endQuizBtn').classList.add('hidden');
        clearInterval(localState.timerInterval);
        $('hostTimer').textContent = "00:00";
        return;
    }

    if (state.quizStarted) {
        $('startQuizBtn').classList.add('hidden');
        $('nextQuestionBtn').classList.remove('hidden');
        $('endQuizBtn').classList.remove('hidden');
        
        if (state.currentQuestion > 0 && state.currentQuestion !== localState.currentQuestion) {
            localState.currentQuestion = state.currentQuestion;
            loadQuestionForHost(state.currentQuestion);
            startTimer();
        }
    } else {
        $('hostQuestionText').textContent = 'Waiting to start the quiz...';
        $('startQuizBtn').classList.remove('hidden');
        $('nextQuestionBtn').classList.add('hidden');
        $('endQuizBtn').classList.add('hidden');
    }
}

async function loadQuestionForHost(qNum) {
    if (qNum === 0) return;
    const qRef = doc(db, 'questions', `q${qNum}`);
    const qSnap = await getDoc(qRef);
    if (!qSnap.exists()) return;
    
    const question = qSnap.data();
    $('hostQuestionText').textContent = question.text;
    const optionsContainer = $('hostOptionsContainer');
    optionsContainer.innerHTML = '';
    
    const optionOrder = ['A', 'B', 'C', 'D'];
    optionOrder.forEach(key => {
        if (question.options[key]) {
            const value = question.options[key];
            const optionEl = document.createElement('div');
            optionEl.className = 'host-option';
            optionEl.textContent = `${key}. ${value}`;
            optionsContainer.appendChild(optionEl);
        }
    });
}

async function downloadCSVReport() {
    const leaderboardQuery = query(collection(db, 'participants'), orderBy('totalScore', 'desc'), orderBy('totalResponseTime', 'asc'));
    const snap = await getDocs(leaderboardQuery);
    
    let csvContent = 'Rank,TeamCode,TotalScore,TotalResponseTime(s)\n';
    snap.docs.forEach((doc, index) => {
        const data = doc.data();
        const row = [
            index + 1,
            doc.id,
            data.totalScore ?? 0,
            data.totalResponseTime ?? 0
        ].join(',');
        csvContent += row + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'TechQuiz-Leaderboard.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// NEW FUNCTION to download attendees
async function downloadAttendeesReport() {
    const attendeesQuery = query(collection(db, 'attendees'), orderBy('joined', 'asc'));
    const snap = await getDocs(attendeesQuery);

    let csvContent = 'TeamCode,JoinedAt\n';
    snap.docs.forEach(doc => {
        const data = doc.data();
        const joinedDate = data.joined ? data.joined.toDate().toLocaleString('en-IN') : 'N/A';
        const row = [
            data.teamId,
            `"${joinedDate}"`
        ].join(',');
        csvContent += row + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Quiz-Attendees.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
