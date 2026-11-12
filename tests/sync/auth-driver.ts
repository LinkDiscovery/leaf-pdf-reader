// Imported only by Playwright from Vite's development server. Not part of the production app.
import { getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
export async function login(email: string) {
  const auth = getAuth(getApp('leaf-study'));
  try { await signInWithEmailAndPassword(auth, email, 'emulator-only-password'); }
  catch { await createUserWithEmailAndPassword(auth, email, 'emulator-only-password'); }
}
export async function logout() { await signOut(getAuth(getApp('leaf-study'))); }
