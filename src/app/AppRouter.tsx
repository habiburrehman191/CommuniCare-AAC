import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { CommunicationBoardPage } from '@/app/pages/CommunicationBoardPage';
import { EmergencyPage } from '@/app/pages/EmergencyPage';
import { ProfileSelectionPage } from '@/app/pages/ProfileSelectionPage';
import { SettingsPage } from '@/app/pages/SettingsPage';
import { SignCollectionDevPage } from '@/app/pages/SignCollectionDevPage';
import { SignV3ManualValidationPage } from '@/app/pages/SignV3ManualValidationPage';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Navigate to="/board" replace />} />
          <Route path="profiles" element={<ProfileSelectionPage />} />
          <Route path="board" element={<CommunicationBoardPage />} />
          <Route path="emergency" element={<EmergencyPage />} />
          <Route path="caregiver" element={<Navigate to="/settings?section=advanced" replace />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="dev/sign-collection" element={<SignCollectionDevPage />} />
          <Route path="dev/v3-test" element={<SignV3ManualValidationPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
