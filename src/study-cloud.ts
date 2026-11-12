import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, deleteDoc, doc, initializeFirestore, onSnapshot, persistentLocalCache, persistentMultipleTabManager, runTransaction, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { validEntry, type StudyEntry } from './study-model';

export type CloudState = { user: User | null; entries: StudyEntry[]; pending: boolean; cached: boolean; ready: boolean; error: string };
export function cloudError(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return '로그인이 취소되었어요.';
  if (code.includes('popup-blocked')) return '팝업을 허용한 뒤 Google 로그인을 다시 눌러 주세요.';
  if (code.includes('unauthorized-domain')) return '이 앱 주소가 Firebase 로그인 허용 도메인에 등록되어 있지 않아요.';
  if (code.includes('permission-denied')) return '동기화 권한이 없어요. Firebase 보안 규칙과 로그인 계정을 확인해 주세요.';
  if (code.includes('resource-exhausted')) return 'Firebase 무료 사용 한도에 도달했어요. 기기의 기록을 백업하고 나중에 다시 연결해 주세요.';
  if (code.includes('not-found')) return '다른 기기에서 삭제된 항목이에요. 내용을 복사한 뒤 새 항목으로 저장해 주세요.';
  if (code.includes('network') || code.includes('unavailable')) return '연결을 확인해 주세요. 전송 대기 중인 변경은 연결되면 동기화됩니다.';
  return '동기화하지 못했어요. 내용을 백업하고 연결 설정을 확인해 주세요.';
}
export async function createStudyCloud(config: FirebaseOptions, changed: (state: CloudState) => void) {
  const app = initializeApp(config, 'leaf-study');
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  // Only available in local development for automated integration tests, never in a production build.
  if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === 'true') {
    const { connectAuthEmulator } = await import('firebase/auth');
    const { connectFirestoreEmulator } = await import('firebase/firestore');
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  let state: CloudState = { user: null, entries: [], pending: false, cached: true, ready: false, error: '' };
  let unsubscribe: Unsubscribe | undefined;
  let epoch = 0;
  const emit = () => changed({ ...state });
  const entries = () => {
    if (!state.user) throw new Error('로그인이 필요해요.');
    return collection(db, 'users', state.user.uid, 'studyEntries');
  };
  onAuthStateChanged(auth, user => {
    const token = ++epoch;
    unsubscribe?.();
    state = { user, entries: [], pending: false, cached: true, ready: !user, error: '' };
    emit();
    if (user) unsubscribe = onSnapshot(entries(), { includeMetadataChanges: true }, snapshot => {
      if (token !== epoch) return;
      state.entries = snapshot.docs.map(item => ({ ...item.data(), id: item.id })).filter(validEntry);
      state.pending = snapshot.metadata.hasPendingWrites;
      state.cached = snapshot.metadata.fromCache;
      state.ready = true;
      state.error = '';
      emit();
    }, error => { if (token === epoch) { state.error = cloudError(error); state.ready = false; emit(); } });
  }, error => { state.error = cloudError(error); emit(); });
  function write(operation: Promise<void>, recover?: StudyEntry) {
    const token = epoch;
    state.pending = true; state.error = ''; emit();
    void operation.catch(error => {
      if (token !== epoch) return;
      state.error = cloudError(error); emit();
      // Preserve the rejected draft visibly, rather than silently losing the user's edit.
      window.dispatchEvent(new CustomEvent('leaf-study-write-error', { detail: { message: cloudError(error), entry: recover } }));
    });
  }
  return {
    login: () => signInWithPopup(auth, new GoogleAuthProvider()),
    logout: () => signOut(auth),
    save(entry: StudyEntry, isNew: boolean) {
      const ref = doc(entries(), entry.id);
      write(isNew ? setDoc(ref, entry) : updateDoc(ref, { text: entry.text, english: entry.english, korean: entry.korean, example: entry.example, note: entry.note, source: entry.source, page: entry.page, updatedAt: entry.updatedAt }), entry);
    },
    learned(entry: StudyEntry) { write(updateDoc(doc(entries(), entry.id), { learned: !entry.learned, updatedAt: Date.now() }), entry); },
    remove(entry: StudyEntry) { write(deleteDoc(doc(entries(), entry.id)), entry); },
    async importMissing(incoming: StudyEntry[]) {
      if (!state.ready || state.cached || state.pending) throw new Error('서버 연결과 동기화 완료 후 가져오기를 눌러 주세요.');
      const target = entries();
      const existing = new Set(state.entries.map(entry => entry.id));
      const fresh = incoming.filter(entry => !existing.has(entry.id));
      let imported = 0;
      for (let offset = 0; offset < fresh.length; offset += 200) {
        const group = fresh.slice(offset, offset + 200);
        // Recheck on the server so an import cannot overwrite a concurrent device's edit.
        imported += await runTransaction(db, async transaction => {
          const refs = group.map(entry => doc(target, entry.id));
          const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
          let count = 0;
          snapshots.forEach((snapshot, index) => { if (!snapshot.exists()) { transaction.set(refs[index], group[index]); count++; } });
          return count;
        });
      }
      return imported;
    }
  };
}
export type StudyCloud = Awaited<ReturnType<typeof createStudyCloud>>;
