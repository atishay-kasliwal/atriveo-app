import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
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
import ClickedJobs from "./pages/ClickedJobs";
import Tailored from "./pages/Tailored";
import ResumeOptimizer from "./pages/ResumeOptimizer";
import ManualTailor from "./pages/ManualTailor";
import "./index.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // While auth resolves, render the SAME shell (header) every page uses, with a
  // spinner only in the content area — so a full-page reload never blanks the
  // screen or shifts the header.
  if (loading) {
    return (
      <div>
        <AppHeader />
        <div className="content-loading"><div className="spin" /></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/today" element={
          <ProtectedRoute>
            <Dashboard initialPeriod="today" />
          </ProtectedRoute>
        } />
        <Route path="/swipe" element={<Navigate to="/" replace />} />
        <Route
          path="/weekly"
          element={
            <ProtectedRoute>
              <Weekly />
            </ProtectedRoute>
          }
        />
        <Route
          path="/unclicked-100"
          element={
            <ProtectedRoute>
              <Unclicked100 />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cart"
          element={
            <ProtectedRoute>
              <Cart />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/skills"
          element={
            <ProtectedRoute>
              <Skills />
            </ProtectedRoute>
          }
        />
        <Route
          path="/states"
          element={
            <ProtectedRoute>
              <States />
            </ProtectedRoute>
          }
        />
        <Route
          path="/emailfinder"
          element={
            <ProtectedRoute>
              <EmailFinder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clickedjobs"
          element={
            <ProtectedRoute>
              <ClickedJobs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tailored"
          element={
            <ProtectedRoute>
              <Tailored />
            </ProtectedRoute>
          }
        />
        <Route
          path="/manual-tailor"
          element={
            <ProtectedRoute>
              <ManualTailor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/optimizer"
          element={
            <ProtectedRoute>
              <ResumeOptimizer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Navigate to="/" replace />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
