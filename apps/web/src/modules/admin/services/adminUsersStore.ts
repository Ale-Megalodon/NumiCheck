import type { User } from "firebase/auth";

export type AdminUserRecord = {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  providerId: string;
  createdAt: string;
  lastLoginAt: string;
  totalQueries: number;
  legalQueries: number;
  illegalQueries: number;
};

const STORAGE_KEY = "numicheck_admin_users_v1";

function readStore(): AdminUserRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as AdminUserRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

function writeStore(records: AdminUserRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function getAdminUsers(): AdminUserRecord[] {
  return readStore().sort((a, b) => b.lastLoginAt.localeCompare(a.lastLoginAt));
}

export function upsertAdminUserFromAuth(user: User) {
  const records = readStore();
  const now = new Date().toISOString();
  const index = records.findIndex((record) => record.uid === user.uid);
  const email = user.email ?? "sin-correo@numicheck.local";

  if (index === -1) {
    records.push({
      uid: user.uid,
      email,
      displayName: user.displayName ?? "Sin nombre",
      photoURL: user.photoURL ?? "",
      providerId: user.providerData[0]?.providerId ?? "unknown",
      createdAt: now,
      lastLoginAt: now,
      totalQueries: 0,
      legalQueries: 0,
      illegalQueries: 0
    });
  } else {
    const previous = records[index];
    records[index] = {
      ...previous,
      email,
      displayName: user.displayName ?? previous.displayName,
      photoURL: user.photoURL ?? previous.photoURL,
      providerId: user.providerData[0]?.providerId ?? previous.providerId,
      lastLoginAt: now
    };
  }

  writeStore(records);
}

export function deleteAdminUser(uid: string) {
  const records = readStore().filter((record) => record.uid !== uid);
  writeStore(records);
}

export function registerAdminUserQuery(uid: string, status: "legal" | "illegal") {
  const records = readStore();
  const index = records.findIndex((record) => record.uid === uid);

  if (index === -1) {
    return;
  }

  const target = records[index];
  records[index] = {
    ...target,
    totalQueries: target.totalQueries + 1,
    legalQueries: target.legalQueries + (status === "legal" ? 1 : 0),
    illegalQueries: target.illegalQueries + (status === "illegal" ? 1 : 0)
  };

  writeStore(records);
}
