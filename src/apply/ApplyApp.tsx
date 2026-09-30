import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Applications from "../pages/Applications";
import AdminLogin from "./AdminLogin";
import ApplyHeader from "./ApplyHeader";

/** Signed-in admins see the console; everyone else is sent to the admin login. */
function Console() {
  const { user, loading } = useAuth();
  if (loading) return <div className="apply-loading" aria-busy="true"><div className="spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Applications header={<ApplyHeader user={user} />} />;
}

export default function ApplyApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AdminLogin />} />
        <Route path="*" element={<Console />} />
      </Routes>
    </BrowserRouter>
  );
}
