import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import RegistrationScreen from "@/components/RegistrationScreen";
import { SessionProvider } from "@/hooks/useSession";
import IncomingCallModal from "@/components/IncomingCallModal";

const queryClient = new QueryClient();

const RouterContent = () => {
  const [user, setUser] = useState<{ name: string; nodeId: string; avatar: number | string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const saved = localStorage.getItem("svyaz-user");
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        setUser(null);
      }
    }
  }, []);

  const handleRegister = useCallback((data: { name: string; nodeId: string; avatar: number | string }) => {
    localStorage.setItem("svyaz-user", JSON.stringify(data));
    setUser(data);
    navigate("/home", { replace: true });
  }, [navigate]);

  return (
    <>
      <IncomingCallModal />
      <Routes>
        <Route path="/" element={<Navigate to={user ? "/home" : "/registration"} replace />} />
        <Route path="/registration" element={<RegistrationScreen onRegister={handleRegister} />} />
        <Route path="/home" element={user ? <Index /> : <Navigate to="/registration" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <SessionProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <RouterContent />
        </BrowserRouter>
      </SessionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
