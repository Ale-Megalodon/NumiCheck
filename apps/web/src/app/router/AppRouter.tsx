import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "../../modules/auth/pages/LoginPage";
import { DenominationPage } from "../../modules/public/pages/DenominationPage";
import { FeaturePlaceholderPage } from "../../modules/public/pages/FeaturePlaceholderPage";
import { MainMenuPage } from "../../modules/public/pages/MainMenuPage";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<MainMenuPage />} />
      <Route path="/billete/:denomination" element={<DenominationPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/perfil" element={<FeaturePlaceholderPage title="Perfil" />} />
      <Route path="/historial" element={<FeaturePlaceholderPage title="Historial" />} />
      <Route path="/configuracion" element={<FeaturePlaceholderPage title="Configuracion" />} />
      <Route path="/ayuda" element={<FeaturePlaceholderPage title="Ayuda" />} />
      <Route path="/app" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
