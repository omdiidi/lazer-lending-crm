import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import AppLayout from "@/components/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import TodoPage from "@/pages/TodoPage";
import LeadsPage from "@/pages/LeadsPage";
import LeadDetailPage from "@/pages/LeadDetailPage";
import LeadGeneratorPage from "@/pages/LeadGeneratorPage";
import OutreachPage from "@/pages/OutreachPage";
import PipelinePage from "@/pages/PipelinePage";
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "@/pages/NotFound";
import UnsubscribePage from "@/pages/UnsubscribePage";
import CampaignDetailPage from "@/pages/CampaignDetailPage";
import CampaignBuilderPage from "@/pages/CampaignBuilderPage";
import StaffPerformancePage from "@/pages/StaffPerformancePage";

const queryClient = new QueryClient();

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center animate-pulse">
          <span className="text-primary-foreground font-bold text-sm">I</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/todos" element={<TodoPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/:id" element={<LeadDetailPage />} />
        <Route path="/generator" element={<LeadGeneratorPage />} />
        <Route path="/outreach" element={<OutreachPage />} />
        <Route path="/outreach/campaign/new" element={<CampaignBuilderPage />} />
        <Route path="/outreach/campaign/:id" element={<CampaignDetailPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/staff" element={<StaffPerformancePage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/unsubscribe/:token" element={<UnsubscribePage />} />
            <Route path="/*" element={<AuthGate />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
