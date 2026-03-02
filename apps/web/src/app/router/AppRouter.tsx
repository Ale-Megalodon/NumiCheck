import { Navigate, Route, Routes } from "react-router-dom";
import { AdminPanelPage } from "../../modules/admin/pages/AdminPanelPage";
import { LoginPage } from "../../modules/auth/pages/LoginPage";
import { DenominationPage } from "../../modules/public/pages/DenominationPage";
import { FeaturePlaceholderPage } from "../../modules/public/pages/FeaturePlaceholderPage";
import { HistoryPage } from "../../modules/public/pages/HistoryPage";
import { MainMenuPage } from "../../modules/public/pages/MainMenuPage";
import { ProfilePage } from "../../modules/public/pages/ProfilePage";
import { SettingsPage } from "../../modules/public/pages/SettingsPage";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<MainMenuPage />} />
      <Route path="/control-interno-nc-a73k9q" element={<AdminPanelPage />} />
      <Route path="/billete/:denomination" element={<DenominationPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/perfil" element={<ProfilePage />} />
      <Route path="/historial" element={<HistoryPage />} />
      <Route path="/configuracion" element={<SettingsPage />} />
      <Route path="/ayuda" element={<FeaturePlaceholderPage title="Ayuda" />} />
      <Route path="/app" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
