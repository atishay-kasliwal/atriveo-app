import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { Top500Provider } from "./context/Top500Context";
import AppHeader from "./components/AppHeader";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Weekly from "./pages/Weekly";
import Settings from "./pages/Settings";
import Skills from "./pages/Skills";
import Unclicked100 from "./pages/Unclicked100";
import Cart from "./pages/Cart";
import States from "./pages/States";
import EmailFinder from "./pages/EmailFinder";
import Resumes from "./pages/Resumes";
import Activity from "./pages/Activity";
import ManualTailor from "./pages/ManualTailor";
import ResumeOptimizer from "./pages/ResumeOptimizer";
import Onboarding from "./pages/Onboarding";
import ManageTop500 from "./pages/ManageTop500";
import "./index.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div>
        <AppHeader />
        <div className="content-loading"><div className="spin" /></div>
      </div>
    );
  }
  if (!user) {
    window.location.replace("/landing/index.html");
    return null;
  }
  return <>{children}</>;
}

function P({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Top500Provider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* This Hour */}
          <Route path="/" element={<P><Dashboard initialPeriod="hour" initialScope="all" /></P>} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/this-hour" element={<Navigate to="/" replace />} />
          <Route path="/this-hour/top-500" element={<P><Dashboard initialPeriod="hour" initialScope="top500" /></P>} />
          <Route path="/this-hour/others" element={<P><Dashboard initialPeriod="hour" initialScope="others" /></P>} />

          {/* Today */}
          <Route path="/today" element={<P><Dashboard initialPeriod="today" initialScope="all" /></P>} />
          <Route path="/today/top-500" element={<P><Dashboard initialPeriod="today" initialScope="top500" /></P>} />
          <Route path="/today/others" element={<P><Dashboard initialPeriod="today" initialScope="others" /></P>} />

          {/* Yesterday */}
          <Route path="/yesterday" element={<P><Dashboard initialPeriod="yesterday" initialScope="all" /></P>} />
          <Route path="/yesterday/top-500" element={<P><Dashboard initialPeriod="yesterday" initialScope="top500" /></P>} />
          <Route path="/yesterday/others" element={<P><Dashboard initialPeriod="yesterday" initialScope="others" /></P>} />

          {/* This Week */}
          <Route path="/this-week" element={<P><Dashboard initialPeriod="week" initialScope="all" /></P>} />
          <Route path="/this-week/top-500" element={<P><Dashboard initialPeriod="week" initialScope="top500" /></P>} />
          <Route path="/this-week/others" element={<P><Dashboard initialPeriod="week" initialScope="others" /></P>} />

          {/* Legacy redirects */}
          <Route path="/swipe" element={<Navigate to="/" replace />} />
          <Route path="/weekly" element={<P><Weekly /></P>} />
          <Route path="/unclicked-100" element={<P><Unclicked100 /></P>} />
          <Route path="/cart" element={<P><Cart /></P>} />
          <Route path="/settings" element={<P><Settings /></P>} />
          <Route path="/skills" element={<P><Skills /></P>} />
          <Route path="/states" element={<P><States /></P>} />
          <Route path="/emailfinder" element={<P><EmailFinder /></P>} />
          <Route path="/resumes" element={<P><Resumes /></P>} />
          <Route path="/tailored" element={<Navigate to="/resumes" replace />} />
          <Route path="/activity" element={<P><Activity /></P>} />
          <Route path="/clickedjobs" element={<Navigate to="/activity" replace />} />
          <Route path="/manual-tailor" element={<P><ManualTailor /></P>} />
          <Route path="/optimizer" element={<P><ResumeOptimizer /></P>} />
          <Route path="/manage-top-500" element={<P><ManageTop500 /></P>} />
          <Route path="/*" element={<P><Navigate to="/" replace /></P>} />
        </Routes>
      </Top500Provider>
    </BrowserRouter>
  );
}
