import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Modal from "./Modal.jsx";

/**
 * userId: id do perfil sendo visto
 * Se userId === currentUser.id, o modal entra em modo de edição (trocar avatar/banner/bio).
 * Caso contrário, mostra o perfil somente leitura (precisa compartilhar servidor com a pessoa).
 */
export default function ProfileModal({ token, userId, currentUser, onClose, onUpdated }) {
  const [profile, setProfile] = useState(null);
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [savingBio, setSavingBio] = useState(false);

  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  const isOwn = userId === currentUser.id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const fetcher = isOwn ? api.getMe(token) : api.getUserProfile(token, userId);
    fetcher
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setBio(p.bio || "");
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [userId, token, isOwn]);

  async function handleUpload(file, field, setUploading) {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const { url } = await api.uploadImage(token, file);
      const updated = await api.updateProfile(token, { [field]: url });
      setProfile(updated);
      onUpdated?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function saveBio() {
    setSavingBio(true);
    setError("");
    try {
      const updated = await api.updateProfile(token, { bio });
      setProfile(updated);
      onUpdated?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingBio(false);
    }
  }

  return (
    <Modal onClose={onClose} className="profile-modal">
        {loading ? (
          <div className="profile-loading">Carregando perfil…</div>
        ) : !profile ? (
          <div className="profile-loading">{error || "Perfil indisponível."}</div>
        ) : (
          <>
            <div
              className="profile-banner"
              style={profile.banner_url ? { backgroundImage: `url(${profile.banner_url})` } : undefined}
            >
              {isOwn && (
                <button
                  type="button"
                  className="profile-banner-edit"
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={uploadingBanner}
                  title="Trocar imagem de fundo do perfil"
                >
                  {uploadingBanner ? "…" : "🖼️ Trocar fundo"}
                </button>
              )}
              <input
                type="file"
                accept="image/*"
                hidden
                ref={bannerInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  handleUpload(file, "banner_url", setUploadingBanner);
                }}
              />

              <div className="profile-avatar-wrap">
                {profile.avatar_url ? (
                  <img className="profile-avatar" src={profile.avatar_url} alt={profile.username} />
                ) : (
                  <div className="profile-avatar" style={{ background: profile.avatar_color }}>
                    {profile.username.slice(0, 2).toUpperCase()}
                  </div>
                )}
                {isOwn && (
                  <button
                    type="button"
                    className="profile-avatar-edit"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    title="Trocar foto de perfil"
                  >
                    {uploadingAvatar ? "…" : "📷"}
                  </button>
                )}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  ref={avatarInputRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    handleUpload(file, "avatar_url", setUploadingAvatar);
                  }}
                />
              </div>
            </div>

            <div className="profile-body">
              <div className="profile-username">{profile.username}</div>

              {isOwn ? (
                <>
                  <label className="profile-bio-label">Sobre mim</label>
                  <textarea
                    className="profile-bio-input"
                    value={bio}
                    maxLength={190}
                    placeholder="Conte um pouco sobre você…"
                    onChange={(e) => setBio(e.target.value)}
                  />
                  <div className="profile-bio-footer">
                    <span className="profile-bio-count">{bio.length}/190</span>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={saveBio}
                      disabled={savingBio || bio === (profile.bio || "")}
                    >
                      {savingBio ? "Salvando…" : "Salvar"}
                    </button>
                  </div>
                </>
              ) : (
                profile.bio && <p className="profile-bio-view">{profile.bio}</p>
              )}

              {error && <div className="auth-error">{error}</div>}
            </div>
          </>
        )}
    </Modal>
  );
}
