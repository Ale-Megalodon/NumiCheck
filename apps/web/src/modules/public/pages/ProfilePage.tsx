import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { BackHomeButton } from "../components/BackHomeButton";
import { PublicBrand } from "../components/PublicBrand";
import {
  getPublicProfile,
  resolveFallbackName,
  savePublicProfile,
  type PublicProfile
} from "../services/publicProfileStore";

const EMOJI_CANDIDATES = Array.from({ length: 9 }, (_, index) => `/img/Flat_${index + 1}.jpg`);
const MAX_NAME_LENGTH = 32;
const MAX_TAG_LENGTH = 22;
const MAX_TAGS = 8;

function normalizeTag(value: string) {
  return value
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, MAX_TAG_LENGTH);
}

export function ProfilePage() {
  const navigate = useNavigate();
  const { loading, user } = useAuth();
  const fallbackName = useMemo(() => resolveFallbackName(user), [user]);
  const [profile, setProfile] = useState<PublicProfile>(() => getPublicProfile(user?.uid, fallbackName));
  const [pendingTag, setPendingTag] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [emojiOptions, setEmojiOptions] = useState<string[]>([]);
  const [emojiLoading, setEmojiLoading] = useState(false);
  const [emojiLoaded, setEmojiLoaded] = useState(false);

  useEffect(() => {
    setProfile(getPublicProfile(user?.uid, fallbackName));
  }, [fallbackName, user?.uid]);

  useEffect(() => {
    if (!emojiPanelOpen || emojiLoaded) {
      return;
    }

    let mounted = true;
    setEmojiLoading(true);

    const loadEmojis = async () => {
      const checks = await Promise.all(
        EMOJI_CANDIDATES.map(
          (path) =>
            new Promise<string | null>((resolve) => {
              const image = new Image();
              image.onload = () => resolve(path);
              image.onerror = () => resolve(null);
              image.src = path;
            })
        )
      );

      if (!mounted) {
        return;
      }

      const available = checks.filter((value): value is string => Boolean(value));
      setEmojiOptions(available);
      setEmojiLoaded(true);
      setEmojiLoading(false);
    };

    void loadEmojis();
    return () => {
      mounted = false;
    };
  }, [emojiLoaded, emojiPanelOpen]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const persistProfile = (next: Partial<PublicProfile>) => {
    const saved = savePublicProfile(user?.uid, fallbackName, next);
    setProfile(saved);
    setNotice("Perfil actualizado.");
  };

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextName = event.target.value.slice(0, MAX_NAME_LENGTH);
    setProfile((prev) => ({ ...prev, displayName: nextName }));
  };

  const handleNameBlur = () => {
    persistProfile({ displayName: profile.displayName });
  };

  const handlePickEmoji = (emojiPath: string) => {
    persistProfile({
      avatarType: "emoji",
      avatarValue: emojiPath
    });
  };

  const handlePhotoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setNotice("Selecciona una imagen valida.");
      return;
    }

    if (file.size > 2.8 * 1024 * 1024) {
      setNotice("La imagen es muy pesada. Usa una menor a 2.8 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        setNotice("No se pudo leer la imagen.");
        return;
      }

      persistProfile({
        avatarType: "upload",
        avatarValue: result
      });
    };
    reader.onerror = () => setNotice("No se pudo leer la imagen.");
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleRestoreLogo = () => {
    persistProfile({
      avatarType: "default",
      avatarValue: ""
    });
  };

  const addTag = (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = normalizeTag(pendingTag);
    if (!normalized) {
      return;
    }

    if (profile.hashtags.length >= MAX_TAGS) {
      setNotice(`Maximo ${MAX_TAGS} hashtags.`);
      return;
    }

    if (profile.hashtags.includes(normalized)) {
      setNotice("Ese hashtag ya existe.");
      return;
    }

    const nextTags = [...profile.hashtags, normalized];
    setPendingTag("");
    persistProfile({ hashtags: nextTags });
  };

  const removeTag = (tag: string) => {
    const nextTags = profile.hashtags.filter((item) => item !== tag);
    persistProfile({ hashtags: nextTags });
  };

  if (!loading && !user) {
    return (
      <main className="public-page">
        <section className="public-shell">
          <header className="public-header">
            <HamburgerMenu />
            <PublicBrand loading={loading} user={user} />
          </header>

          <section className="profile-shell">
            <article className="profile-card">
              <h1 className="profile-title">Perfil</h1>
              <p className="profile-note">Inicia sesion para personalizar foto, nombre y hashtags.</p>
              <button type="button" className="auth-button" onClick={() => navigate("/login")}>
                Ir a iniciar sesion
              </button>
            </article>
          </section>
        </section>
      </main>
    );
  }

  const previewAvatar =
    (profile.avatarType === "emoji" || profile.avatarType === "upload") && profile.avatarValue
      ? profile.avatarValue
      : "/img/logoNumiCheck.jpeg";

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          <PublicBrand loading={loading} user={user} />
        </header>
        <BackHomeButton loading={loading} />

        <section className="profile-shell">
          {loading ? (
            <article className="profile-card profile-card--skeleton" aria-hidden="true">
              <div className="profile-title-skeleton skeleton" />
              <div className="profile-preview-skeleton skeleton" />
              <div className="profile-input-skeleton skeleton" />
              <div className="profile-input-skeleton skeleton" />
              <div className="profile-emoji-skeleton skeleton" />
            </article>
          ) : (
            <article className="profile-card">
              <h1 className="profile-title">Perfil</h1>
              <p className="profile-note">Personaliza tu identidad visual para todo NumiCheck.</p>

              <section className="profile-preview">
                <img className="profile-preview-avatar" src={previewAvatar} alt="Foto de perfil" />
                <div className="profile-preview-meta">
                  <h2 className="brand-wordmark brand-wordmark--semibold profile-preview-name">
                    <span>{profile.displayName || fallbackName}</span>
                    <span className="brand-name-dot" aria-hidden="true" />
                  </h2>
                  {profile.hashtags.length > 0 ? (
                    <div className="profile-preview-tags">
                      {profile.hashtags.map((tag) => (
                        <span key={tag} className="public-brand-tag">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="profile-note profile-note--micro">Agrega hashtags para completar tu perfil.</p>
                  )}
                </div>
              </section>

              <label className="profile-field">
                <span>Nombre visible</span>
                <input
                  className="manual-input"
                  type="text"
                  value={profile.displayName}
                  onChange={handleNameChange}
                  onBlur={handleNameBlur}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Ej: Ale M."
                />
                <small>{`${profile.displayName.length}/${MAX_NAME_LENGTH}`}</small>
              </label>

              <section className="profile-upload-actions">
                <label className="menu-toggle profile-upload-button">
                  Subir foto de galeria
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="profile-file-input" />
                </label>
                <button type="button" className="menu-toggle" onClick={handleRestoreLogo}>
                  Usar logo NumiCheck
                </button>
              </section>

              <section className="profile-emoji-section">
                <div className="profile-emoji-head">
                  <h3>Panel de emojis</h3>
                  <button type="button" className="menu-toggle" onClick={() => setEmojiPanelOpen(true)}>
                    Emojis
                  </button>
                </div>
                <p className="profile-note">Pulsa "Emojis" para abrir el panel sin afectar la velocidad inicial.</p>
              </section>

              <section className="profile-hashtag-section">
                <h3>Hashtags</h3>
                <form className="profile-hashtag-form" onSubmit={addTag}>
                  <input
                    className="manual-input"
                    type="text"
                    placeholder="Ej: coleccionista"
                    value={pendingTag}
                    maxLength={MAX_TAG_LENGTH}
                    onChange={(event) => setPendingTag(event.target.value)}
                  />
                  <button type="submit" className="manual-submit profile-hashtag-submit">
                    Agregar
                  </button>
                </form>
                <small>{`${profile.hashtags.length}/${MAX_TAGS} hashtags`}</small>

                {profile.hashtags.length > 0 ? (
                  <div className="profile-tag-list">
                    {profile.hashtags.map((tag) => (
                      <button key={tag} type="button" className="profile-tag-chip" onClick={() => removeTag(tag)}>
                        #{tag} <span aria-hidden="true">x</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              {notice ? <p className="profile-notice">{notice}</p> : null}
            </article>
          )}
        </section>
      </section>

      {emojiPanelOpen ? (
        <div className="profile-emoji-overlay" role="dialog" aria-modal="true">
          <article className="profile-emoji-modal-card">
            <header className="profile-emoji-modal-head">
              <h3>Panel de emojis</h3>
              <button
                type="button"
                className="scanner-close"
                onClick={() => setEmojiPanelOpen(false)}
                aria-label="Cerrar panel de emojis"
              >
                X
              </button>
            </header>

            {emojiLoading ? (
              <div className="profile-emoji-loading">
                <div className="profile-emoji-skeleton skeleton" aria-hidden="true" />
                <p className="profile-note">Cargando el mejor panel de emojis... wait!</p>
              </div>
            ) : emojiOptions.length > 0 ? (
              <div className="profile-emoji-grid">
                {emojiOptions.map((emojiPath, index) => {
                  const isSelected = profile.avatarType === "emoji" && profile.avatarValue === emojiPath;
                  return (
                    <button
                      key={emojiPath}
                      type="button"
                      className={`profile-emoji-button ${isSelected ? "profile-emoji-button--selected" : ""}`}
                      onClick={() => handlePickEmoji(emojiPath)}
                      aria-label={`Emoji ${index + 1}`}
                    >
                      <img src={emojiPath} alt={`Emoji ${index + 1}`} loading="lazy" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="profile-note">No se encontraron emojis en `apps/web/public/img/`.</p>
            )}
          </article>
        </div>
      ) : null}
    </main>
  );
}
