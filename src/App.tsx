import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AudioProvider } from "@/contexts/AudioContext";
import { AudioSettingsButton } from "@/components/AudioSettingsButton";
import { TutorialProvider } from "@/components/Tutorial";
import Index from "./pages/Index";
import OnlineGame from "./pages/OnlineGame";
import Auth from "./pages/Auth";
import GameHistory from "./pages/GameHistory";
import Tutorial from "./pages/Tutorial";
import CaseStudy from "./pages/CaseStudy";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Fixed audio button shown on pages that don't have their own inline button
const GlobalAudioButton = () => {
  const { pathname } = useLocation();
  if (pathname === '/online' || pathname === '/') return null;
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <AudioSettingsButton />
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <AudioProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <TutorialProvider>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/online" element={<OnlineGame />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/history" element={<GameHistory />} />
                <Route path="/tutorial" element={<Tutorial />} />
                <Route path="/case-study" element={<CaseStudy />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </TutorialProvider>
            {/* Fixed audio button — appears on non-game pages (must be inside BrowserRouter for useLocation) */}
            <GlobalAudioButton />
          </BrowserRouter>
        </TooltipProvider>
      </AudioProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
