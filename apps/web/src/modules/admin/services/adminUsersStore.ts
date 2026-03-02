import type { User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { firebaseDb } from "../../../shared/config/firebase";

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

export type AdminUsersLoadResult = {
  rows: AdminUserRecord[];
  source: "cloud" | "local";
  cloudError: string | null;
};

const STORAGE_KEY = "numicheck_admin_users_v1";
const CLOUD_COLLECTION = "numicheck_admin_users";

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

function normalizeCloudRecord(raw: Record<string, unknown> | undefined, uid: string): AdminUserRecord | null {
  if (!raw) {
    return null;
  }

  const email = typeof raw.email === "string" ? raw.email : "";
  const displayName = typeof raw.displayName === "string" ? raw.displayName : "Sin nombre";
  const photoURL = typeof raw.photoURL === "string" ? raw.photoURL : "";
  const providerId = typeof raw.providerId === "string" ? raw.providerId : "unknown";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  const lastLoginAt = typeof raw.lastLoginAt === "string" ? raw.lastLoginAt : new Date(0).toISOString();
  const totalQueries =
    typeof raw.totalQueries === "number" && Number.isFinite(raw.totalQueries) ? Math.trunc(raw.totalQueries) : 0;
  const legalQueries =
    typeof raw.legalQueries === "number" && Number.isFinite(raw.legalQueries) ? Math.trunc(raw.legalQueries) : 0;
  const illegalQueries =
    typeof raw.illegalQueries === "number" && Number.isFinite(raw.illegalQueries) ? Math.trunc(raw.illegalQueries) : 0;

  return {
    uid,
    email,
    displayName,
    photoURL,
    providerId,
    createdAt,
    lastLoginAt,
    totalQueries,
    legalQueries,
    illegalQueries
  };
}

function sortByLastLogin(records: AdminUserRecord[]) {
  return [...records].sort((a, b) => b.lastLoginAt.localeCompare(a.lastLoginAt));
}

function upsertLocal(record: AdminUserRecord) {
  const records = readStore();
  const index = records.findIndex((entry) => entry.uid === record.uid);
  if (index === -1) {
    records.push(record);
  } else {
    records[index] = record;
  }
  writeStore(records);
}

function updateLocalCounters(uid: string, status: "legal" | "illegal") {
  const records = readStore();
  const index = records.findIndex((entry) => entry.uid === uid);
  if (index === -1) {
    return;
  }

  const current = records[index];
  records[index] = {
    ...current,
    totalQueries: current.totalQueries + 1,
    legalQueries: current.legalQueries + (status === "legal" ? 1 : 0),
    illegalQueries: current.illegalQueries + (status === "illegal" ? 1 : 0)
  };
  writeStore(records);
}

export function getAdminUsers(): AdminUserRecord[] {
  return sortByLastLogin(readStore());
}

function formatCloudError(error: unknown) {
  if (error && typeof error === "object") {
    const maybe = error as { code?: string; message?: string };
    if (typeof maybe.code === "string" && maybe.code.length > 0) {
      return maybe.code;
    }
    if (typeof maybe.message === "string" && maybe.message.length > 0) {
      return maybe.message;
    }
  }

  return "unknown";
}

export async function getAdminUsersCloudFirst(): Promise<AdminUsersLoadResult> {
  try {
    const q = query(collection(firebaseDb, CLOUD_COLLECTION), orderBy("lastLoginAt", "desc"));
    const snapshot = await getDocs(q);
    const cloudRows: AdminUserRecord[] = [];

    snapshot.forEach((entry) => {
      const normalized = normalizeCloudRecord(entry.data() as Record<string, unknown>, entry.id);
      if (normalized) {
        cloudRows.push(normalized);
      }
    });

    writeStore(cloudRows);
    return {
      rows: sortByLastLogin(cloudRows),
      source: "cloud",
      cloudError: null
    };
  } catch (error) {
    // Fallback to local cache if cloud is unavailable.
    return {
      rows: getAdminUsers(),
      source: "local",
      cloudError: formatCloudError(error)
    };
  }
}

export function upsertAdminUserFromAuth(user: User) {
  const now = new Date().toISOString();
  const localRecords = readStore();
  const existing = localRecords.find((entry) => entry.uid === user.uid) ?? null;
  const email = user.email ?? "sin-correo@numicheck.local";

  const next: AdminUserRecord = {
    uid: user.uid,
    email,
    displayName: user.displayName ?? existing?.displayName ?? "Sin nombre",
    photoURL: user.photoURL ?? existing?.photoURL ?? "",
    providerId: user.providerData[0]?.providerId ?? existing?.providerId ?? "unknown",
    createdAt: existing?.createdAt ?? now,
    lastLoginAt: now,
    totalQueries: existing?.totalQueries ?? 0,
    legalQueries: existing?.legalQueries ?? 0,
    illegalQueries: existing?.illegalQueries ?? 0
  };

  upsertLocal(next);

  void (async () => {
    try {
      await setDoc(doc(firebaseDb, CLOUD_COLLECTION, user.uid), next, { merge: true });
    } catch {
      // Keep local store as fallback.
    }
  })();
}

export function deleteAdminUser(uid: string) {
  const records = readStore().filter((record) => record.uid !== uid);
  writeStore(records);

  void (async () => {
    try {
      await deleteDoc(doc(firebaseDb, CLOUD_COLLECTION, uid));
    } catch {
      // Keep local delete even if cloud fails.
    }
  })();
}

export function registerAdminUserQuery(uid: string, status: "legal" | "illegal") {
  updateLocalCounters(uid, status);

  void (async () => {
    try {
      const ref = doc(firebaseDb, CLOUD_COLLECTION, uid);
      await setDoc(
        ref,
        {
          uid,
          totalQueries: 0,
          legalQueries: 0,
          illegalQueries: 0,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString()
        },
        { merge: true }
      );

      await updateDoc(ref, {
        totalQueries: increment(1),
        legalQueries: increment(status === "legal" ? 1 : 0),
        illegalQueries: increment(status === "illegal" ? 1 : 0)
      });
    } catch {
      // Keep local counters even if cloud fails.
    }
  })();
}
