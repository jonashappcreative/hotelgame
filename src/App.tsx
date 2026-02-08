import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { TutorialProvider } from "@/components/Tutorial";
import Index from "./pages/Index";
import OnlineGame from "./pages/OnlineGame";
import Auth from "./pages/Auth";
import GameHistory from "./pages/GameHistory";
import Tutorial from "./pages/Tutorial";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
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
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TutorialProvider>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
