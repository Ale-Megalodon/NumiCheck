import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  signOut,
  type AuthProvider
} from "firebase/auth";
import { firebaseAuth } from "../../../shared/config/firebase";

const googleProvider = new GoogleAuthProvider();
const facebookProvider = new FacebookAuthProvider();

async function signInWithProvider(provider: AuthProvider) {
  try {
    await signInWithPopup(firebaseAuth, provider);
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    const shouldFallbackToRedirect =
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request";

    if (shouldFallbackToRedirect) {
      await signInWithRedirect(firebaseAuth, provider);
      return;
    }

    throw error;
  }
}

export async function signInWithGoogle() {
  await signInWithProvider(googleProvider);
}

export async function signInWithFacebook() {
  await signInWithProvider(facebookProvider);
}

export async function signOutUser() {
  await signOut(firebaseAuth);
}
