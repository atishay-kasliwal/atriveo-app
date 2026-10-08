import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Applications from "../pages/Applications";
import AdminLogin from "./AdminLogin";
import ApplyHeader from "./ApplyHeader";
import QuestionsPage from "./QuestionsPage";
import ReadyPage from "./ReadyPage";
import ResumeBuilderPage from "./ResumeBuilderPage";
import StaffingPage from "./StaffingPage";
import TodayPage from "./TodayPage";
import UnansweredPage from "./UnansweredPage";

/** Signed-in admins see the console; everyone else is sent to the admin login. */
function Console() {
  const { user, loading } = useAuth();
  const path = useLocation().pathname.replace(/\/+$/, "");
  if (loading) return <div className="apply-loading" aria-busy="true"><div className="spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  const header = <ApplyHeader user={user} />;
  if (path === "/staffing") return <StaffingPage header={header} />;
  if (path === "/resume_builder") return <ResumeBuilderPage header={header} />;
  if (path === "/unanswered") return <QuestionsPage header={header} />;
  // The full form view: every question of one application, drafts included.
  if (path === "/answers") return <UnansweredPage header={header} />;
  if (path === "/ready" || path === "/review") return <ReadyPage header={header} />;
  if (path === "/stats" || path === "/overview") return <Applications header={header} />;
  return <TodayPage header={header} />;
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
