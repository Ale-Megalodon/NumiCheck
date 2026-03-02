import type { User } from "firebase/auth";

export type PublicAvatarType = "default" | "emoji" | "upload";

export type PublicProfile = {
  displayName: string;
  avatarType: PublicAvatarType;
  avatarValue: string;
  hashtags: string[];
  updatedAt: string;
};

const STORAGE_PREFIX = "numicheck_public_profile_v1";
const PROFILE_EVENT = "numicheck:public-profile-updated";
const DEFAULT_BRAND_NAME = "NumiCheck";

function getStorageKey(uid: string | null | undefined) {
  return `${STORAGE_PREFIX}:${uid?.trim() || "guest"}`;
}

function sanitizeHashtags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = input
    .map((item) => String(item ?? "").trim())
    .map((tag) => tag.replace(/^#+/, ""))
    .map((tag) => tag.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((tag) => tag.length >= 2 && tag.length <= 22)
    .slice(0, 8);

  return Array.from(new Set(normalized));
}

function sanitizeProfile(raw: Partial<PublicProfile> | null | undefined, fallbackName: string): PublicProfile {
  const displayName = String(raw?.displayName ?? "").trim() || fallbackName || DEFAULT_BRAND_NAME;
  const avatarType: PublicAvatarType =
    raw?.avatarType === "emoji" || raw?.avatarType === "upload" ? raw.avatarType : "default";
  const avatarValue = String(raw?.avatarValue ?? "").trim();
  const hashtags = sanitizeHashtags(raw?.hashtags);
  const updatedAt = typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString();

  return {
    displayName: displayName.slice(0, 32),
    avatarType,
    avatarValue,
    hashtags,
    updatedAt
  };
}

export function resolveFallbackName(user: User | null) {
  return user?.displayName?.trim() || DEFAULT_BRAND_NAME;
}

export function getPublicProfile(uid: string | null | undefined, fallbackName: string): PublicProfile {
  const storageKey = getStorageKey(uid);

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return sanitizeProfile(null, fallbackName);
    }

    const parsed = JSON.parse(raw) as Partial<PublicProfile>;
    return sanitizeProfile(parsed, fallbackName);
  } catch {
    return sanitizeProfile(null, fallbackName);
  }
}

export function savePublicProfile(
  uid: string | null | undefined,
  fallbackName: string,
  nextProfile: Partial<PublicProfile>
) {
  const storageKey = getStorageKey(uid);
  const current = getPublicProfile(uid, fallbackName);
  const merged = sanitizeProfile(
    {
      ...current,
      ...nextProfile,
      updatedAt: new Date().toISOString()
    },
    fallbackName
  );

  window.localStorage.setItem(storageKey, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: { uid: uid ?? "guest" } }));
  return merged;
}

export function subscribePublicProfileUpdates(onUpdate: () => void) {
  const handler = () => onUpdate();
  window.addEventListener(PROFILE_EVENT, handler);
  return () => window.removeEventListener(PROFILE_EVENT, handler);
}
