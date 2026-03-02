import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  getPublicProfile,
  resolveFallbackName,
  subscribePublicProfileUpdates,
  type PublicProfile
} from "../services/publicProfileStore";

type PublicBrandProps = {
  loading: boolean;
  user: User | null;
};

function BrandSkeleton() {
  return (
    <div className="public-brand-skeleton">
      <div className="public-brand-logo-skeleton skeleton" aria-hidden="true" />
      <div className="public-brand-meta-skeleton">
        <div className="public-brand-wordmark-skeleton skeleton" aria-hidden="true" />
        <div className="public-brand-tags-skeleton skeleton" aria-hidden="true" />
      </div>
    </div>
  );
}

function resolveAvatar(profile: PublicProfile) {
  if ((profile.avatarType === "emoji" || profile.avatarType === "upload") && profile.avatarValue) {
    return profile.avatarValue;
  }

  return "/img/logoNumiCheck.jpeg";
}

export function PublicBrand({ loading, user }: PublicBrandProps) {
  const fallbackName = useMemo(() => resolveFallbackName(user), [user]);
  const [profile, setProfile] = useState<PublicProfile>(() => getPublicProfile(user?.uid, fallbackName));

  useEffect(() => {
    setProfile(getPublicProfile(user?.uid, fallbackName));
  }, [fallbackName, user?.uid]);

  useEffect(() => {
    const unsubscribe = subscribePublicProfileUpdates(() => {
      setProfile(getPublicProfile(user?.uid, fallbackName));
    });

    return unsubscribe;
  }, [fallbackName, user?.uid]);

  if (loading) {
    return <BrandSkeleton />;
  }

  const avatarSrc = resolveAvatar(profile);
  const isCustomAvatar = profile.avatarType !== "default" && Boolean(profile.avatarValue);

  return (
    <div className="public-brand">
      <img
        className={`public-brand-logo ${isCustomAvatar ? "public-brand-logo--avatar" : ""}`}
        src={avatarSrc}
        alt="Identidad de usuario"
      />

      <div className="public-brand-meta">
        <h1 className="brand-wordmark brand-wordmark--semibold public-brand-wordmark public-brand-wordmark--custom">
          <span>{profile.displayName}</span>
          <span className="brand-name-dot" aria-hidden="true" />
        </h1>

        {profile.hashtags.length > 0 ? (
          <div className="public-brand-tags" aria-label="Hashtags de perfil">
            {profile.hashtags.map((tag) => (
              <span key={tag} className="public-brand-tag">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
