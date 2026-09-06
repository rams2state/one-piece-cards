// firebase.js — Firebase Auth (Google Sign-In) + Firestore sync for owned
// cards, plus public read-only share links. Mirrors Pokémon's firebase.js
// structure and defensive error-handling almost exactly; only the
// localStorage key (onepiece-rarity-binder-owned, see data.js) and the
// Firebase project config differ.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, setDoc, updateDoc, getDoc, onSnapshot, deleteField }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDH-iHu_KxWR2rQEjN0MrxVBuXocZxITno",
  authDomain: "one-piece-rarity-binder.firebaseapp.com",
  projectId: "one-piece-rarity-binder",
  storageBucket: "one-piece-rarity-binder.firebasestorage.app",
  messagingSenderId: "408542533990",
  appId: "1:408542533990:web:0a318b8df9db0b0e7e50a7"
};

let app, auth, db, provider;
let _firebaseAvailable = false;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  provider = new GoogleAuthProvider();
  _firebaseAvailable = true;
} catch (e) {
  console.warn('[Firebase] init failed — auth/sync disabled, app still works offline.', e);
}

let _firestoreUnsub = null;
let _currentUid = null;
let _currentShareId = null;

const _shareIdParam = new URLSearchParams(window.location.search).get('share');

const LOCAL_OWNED_KEY = 'onepiece-rarity-binder-owned';

if (_firebaseAvailable) {
  if (_shareIdParam) {
    initReadOnlyShareView(_shareIdParam);
  } else {
    try {
      onAuthStateChanged(auth, async user => {
        _currentUid = user ? user.uid : null;
        updateAuthUI(user);
        if (user) {
          await mergeFirestoreToLocal(user.uid);
          startFirestoreListener(user.uid);
          await loadExistingShareId(user.uid);
        } else {
          if (_firestoreUnsub) { _firestoreUnsub(); _firestoreUnsub = null; }
          _currentShareId = null;
          updateShareBtnVisibility();
        }
        if (typeof updateCollectionValue === 'function') updateCollectionValue();
        if (typeof render === 'function') render();
      });
    } catch (e) {
      console.warn('[Firebase] onAuthStateChanged failed', e);
    }
  }
} else {
  // Firebase unavailable — hide the auth/share buttons entirely rather than
  // leaving dead buttons that do nothing when clicked.
  const authBtn = document.getElementById('authBtn');
  const shareBtn = document.getElementById('shareBtn');
  if (authBtn) authBtn.style.display = 'none';
  if (shareBtn) shareBtn.style.display = 'none';
}

// ── Read-only shared-collection view ─────────────────────────────────────────
function initReadOnlyShareView(shareId) {
  const authBtn = document.getElementById('authBtn');
  const shareBtn = document.getElementById('shareBtn');
  const readOnlyRow = document.getElementById('readOnlyRow');
  if (authBtn) authBtn.style.display = 'none';
  if (shareBtn) shareBtn.style.display = 'none';
  if (readOnlyRow) readOnlyRow.style.display = '';

  const tryApplyReadOnlyUI = () => {
    if (typeof window.applyReadOnlyShareUI === 'function') window.applyReadOnlyShareUI();
    else setTimeout(tryApplyReadOnlyUI, 50);
  };
  tryApplyReadOnlyUI();

  const applySnapshot = snap => {
    const raw = snap.exists() ? (snap.data().owned ?? snap.data().keys ?? []) : [];
    const tryApply = () => {
      if (typeof window.setSharedOwned === 'function') window.setSharedOwned(raw);
      else setTimeout(tryApply, 50);
    };
    tryApply();
  };

  try {
    onSnapshot(shareDocRef(shareId), applySnapshot, e => {
      console.warn('[Firebase] Shared collection listener failed', e);
    });
  } catch (e) {
    console.warn('[Firebase] Could not attach share listener', e);
  }
}

function updateAuthUI(user) {
  const btn = document.getElementById('authBtn');
  if (!btn) return;
  if (user) {
    btn.textContent = '⬡ ' + (user.displayName ? user.displayName.split(' ')[0] : 'Signed in');
    btn.title = 'Click to sign out (' + user.email + ')';
    btn.classList.add('signed-in');
  } else {
    btn.textContent = '⬡ Sign in';
    btn.title = 'Sign in with Google to sync across devices';
    btn.classList.remove('signed-in');
  }
}

// ── Firestore read/write ────────────────────────────────────────────────────
function ownedDocRef(uid) {
  return doc(db, 'users', uid, 'data', 'owned');
}

function toPlainObject(raw) {
  if (Array.isArray(raw)) {
    const now = Date.now();
    const obj = {};
    for (const key of raw) obj[key] = { addedAt: now };
    return obj;
  }
  return raw && typeof raw === 'object' ? raw : {};
}

async function mergeFirestoreToLocal(uid) {
  try {
    const snap = await getDoc(ownedDocRef(uid));
    if (snap.exists()) {
      const data = snap.data();
      const remote = toPlainObject(data.owned ?? data.keys ?? []);
      localStorage.setItem(LOCAL_OWNED_KEY, JSON.stringify(remote));
    } else {
      const local = toPlainObject(JSON.parse(localStorage.getItem(LOCAL_OWNED_KEY) || '{}'));
      if (Object.keys(local).length > 0) {
        await setDoc(ownedDocRef(uid), { owned: local }, { merge: true });
      }
    }
  } catch (e) { console.warn('[Firebase] merge failed', e); }
}

function startFirestoreListener(uid) {
  if (_firestoreUnsub) _firestoreUnsub();
  try {
    _firestoreUnsub = onSnapshot(ownedDocRef(uid), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      const remote = toPlainObject(data.owned ?? data.keys ?? []);
      localStorage.setItem(LOCAL_OWNED_KEY, JSON.stringify(remote));
      if (typeof updateCollectionValue === 'function') updateCollectionValue();
    });
  } catch (e) {
    console.warn('[Firebase] listener attach failed', e);
  }
}

async function pushOwnedDelta(key, action, meta) {
  if (!_currentUid) return;
  const fieldPath = 'owned.' + key;
  const value = action === 'remove' ? deleteField() : meta;
  try {
    try {
      await updateDoc(ownedDocRef(_currentUid), { [fieldPath]: value });
    } catch (inner) {
      if (inner.code === 'not-found' && action !== 'remove') {
        await setDoc(ownedDocRef(_currentUid), { owned: { [key]: meta } }, { merge: true });
      } else if (inner.code !== 'not-found') {
        throw inner;
      }
    }
    if (_currentShareId) {
      try {
        await updateDoc(shareDocRef(_currentShareId), { ownerUid: _currentUid, [fieldPath]: value });
      } catch (inner) {
        if (inner.code === 'not-found' && action !== 'remove') {
          await setDoc(shareDocRef(_currentShareId), { ownerUid: _currentUid, owned: { [key]: meta } }, { merge: true });
        } else if (inner.code !== 'not-found') {
          throw inner;
        }
      }
    }
  } catch (e) { console.warn('[Firebase] delta write FAILED', e); }
}

window.addEventListener('owned-changed', e => {
  const { key, action, meta } = e.detail;
  if (key && action) {
    pushOwnedDelta(key, action, meta);
  }
});

// ── Auth button handler ─────────────────────────────────────────────────────
window._fbSignIn = async () => {
  if (!_firebaseAvailable) return;
  if (_currentUid) {
    await signOut(auth);
  } else {
    try { await signInWithPopup(auth, provider); }
    catch (e) { console.warn('Sign-in failed', e); }
  }
};

// ── Share link ───────────────────────────────────────────────────────────────
function shareDocRef(shareId) {
  return doc(db, 'shares', shareId);
}

async function loadExistingShareId(uid) {
  try {
    const snap = await getDoc(ownedDocRef(uid));
    _currentShareId = snap.exists() ? (snap.data().shareId || null) : null;
  } catch (e) { console.warn('[Firebase] loadExistingShareId failed', e); _currentShareId = null; }
  updateShareBtnVisibility();
}

function updateShareBtnVisibility() {
  const btn = document.getElementById('shareBtn');
  if (!btn) return;
  btn.style.display = _currentUid ? '' : 'none';
}

function shareUrlFor(shareId) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('share', shareId);
  return url.toString();
}

window._fbShare = async () => {
  if (!_firebaseAvailable || !_currentUid) return;
  const btn = document.getElementById('shareBtn');
  try {
    if (!_currentShareId) {
      _currentShareId = crypto.randomUUID();
      await setDoc(ownedDocRef(_currentUid), { shareId: _currentShareId }, { merge: true });
    }
    const owned = toPlainObject(JSON.parse(localStorage.getItem(LOCAL_OWNED_KEY) || '{}'));
    await setDoc(shareDocRef(_currentShareId), { ownerUid: _currentUid, owned });

    const url = shareUrlFor(_currentShareId);
    await navigator.clipboard.writeText(url);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '✓ Link copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
    }
  } catch (e) {
    console.warn('[Firebase] Share failed', e);
    if (btn) { btn.textContent = '⚠ Share failed'; setTimeout(() => { btn.textContent = '🔗 Share'; }, 2000); }
  }
};
