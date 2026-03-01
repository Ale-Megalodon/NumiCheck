import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { firebaseAuth } from "../../../shared/config/firebase";

const googleProvider = new GoogleAuthProvider();
const facebookProvider = new FacebookAuthProvider();

export async function signInWithGoogle() {
  await signInWithPopup(firebaseAuth, googleProvider);
}

export async function signInWithFacebook() {
  await signInWithPopup(firebaseAuth, facebookProvider);
}

export async function signOutUser() {
  await signOut(firebaseAuth);
}