import GeneralPage from "./GeneralPage";
import UsagePage from "./UsagePage";
import AssessmentsPage from "./AssessmentsPage";
import InsightsPage from "./InsightsPage";
import { startUsageTracking } from "./usage";
import { startExtensionUsage } from "./extensionUsage";
import { syncProfileToExtension } from "./companionProfile";
import { syncGoalToPhoneMessages } from "./phoneGoal";
import { useEffect } from "react";
import AppliedPage from "./AppliedPage";
import SettingsPage from "./SettingsPage";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Applications from "../pages/Applications";
import AdminLogin from "./AdminLogin";
import BankPage from "./BankPage";
import ApplyHeader from "./ApplyHeader";
import ReadyPage from "./ReadyPage";
import ResumeBuilderPage from "./ResumeBuilderPage";
import StaffingPage from "./StaffingPage";
import JobMatchingPage from "./JobMatchingPage";
import OutreachPage from "./OutreachPage";
import NetworkPage from "./NetworkPage";
import TodayPage from "./TodayPage";
import CaptureDock from "./CaptureDock";

/** Signed-in admins see the console; everyone else is sent to the admin login. */
function Console() {
  const { user, loading } = useAuth();
  // Give the extension your shared details whenever the console is open, so its panel always has them.
  useEffect(() => {
    if (!user) return;
    void syncProfileToExtension(); void syncGoalToPhoneMessages();
    const visible = () => { if (document.visibilityState === "visible") { void syncProfileToExtension(); void syncGoalToPhoneMessages(); } };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [user]);
  const path = useLocation().pathname.replace(/\/+$/, "");
  // Measure time and feature use (counts only) while someone is signed in; read the path fresh so page changes are noticed.
  useEffect(() => (user ? startUsageTracking(() => window.location.pathname) : undefined), [user]);
  useEffect(() => (user ? startExtensionUsage() : undefined), [user]);
  if (loading) return <div className="apply-loading" aria-busy="true"><div className="spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  const header = <ApplyHeader user={user} />;
  // Every signed-in screen: its page, and the Loops capture dock over it.
  const page = (() => {
    if (path === "/outreach") return <OutreachPage header={header} />;
    if (path === "/network") return <NetworkPage header={header} />;
    if (path === "/job-matching") return <JobMatchingPage header={header} />;
    if (path === "/applied" || path.startsWith("/applied/")) return <AppliedPage header={header} />;
    if (path === "/settings") return <SettingsPage header={header} />;
    if (path === "/general") return <GeneralPage header={header} />;
    if (path === "/usage") return <UsagePage header={header} />;
    if (path === "/assessments") return <AssessmentsPage header={header} />;
    if (path === "/staffing") return <StaffingPage header={header} />;
    if (path === "/resume_builder") return <ResumeBuilderPage header={header} />;
    if (path === "/bank") return <BankPage header={header} />;
    // The answer pages (To answer, and the full form view) were retired: old links and bookmarks land on Today.
    if (path === "/unanswered" || path === "/answers") return <Navigate to="/" replace />;
    if (path === "/ready" || path === "/review") return <ReadyPage header={header} />;
    if (path === "/stats" || path === "/overview") return <InsightsPage header={header} />;
    // The earlier, heavier analytics page stays reachable for the detail.
    if (path === "/analytics") return <Applications header={header} />;
    return <TodayPage header={header} />;
  })();
  return <>{page}<CaptureDock /></>;
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
