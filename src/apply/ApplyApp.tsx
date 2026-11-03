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
import DayPlanPage from "./DayPlanPage";
import ApplyHeader from "./ApplyHeader";
import ReadyPage from "./ReadyPage";
import ResumeBuilderPage from "./ResumeBuilderPage";
import StaffingPage from "./StaffingPage";
import JobMatchingPage from "./JobMatchingPage";
import OutreachPage from "./OutreachPage";
import NetworkPage from "./NetworkPage";
import TodayPage from "./TodayPage";
import CaptureDock from "./CaptureDock";
import LoopsPage from "./LoopsPage";
import LuckyPage from "./LuckyPage";
import PhoneActivity from "./PhoneActivity";
import PhoneHome from "./PhoneHome";
import PhonePeople from "./PhonePeople";
import PhoneTriage from "./PhoneTriage";
import { PhoneTabBar, PhoneTopBar } from "./PhoneShell";
import { usePhone } from "./usePhone";

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
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, "");
  const search = location.search;
  const phone = usePhone();
  // Measure time and feature use (counts only) while someone is signed in; read the path fresh so page changes are noticed.
  useEffect(() => (user ? startUsageTracking(() => window.location.pathname) : undefined), [user]);
  useEffect(() => (user ? startExtensionUsage() : undefined), [user]);
  if (loading) return <div className="apply-loading" aria-busy="true"><div className="spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // A phone gets its own top bar and bottom tabs; the pages below take whichever header they are given.
  const header = phone ? <PhoneTopBar /> : <ApplyHeader user={user} />;
  // Every signed-in screen: its page, and the Loops capture dock over it.
  const page = (() => {
    if (path === "/outreach") return <OutreachPage header={header} />;
    // On a phone, People first; the whole Network (and any ?person= / ?work= link) opens the canvas.
    if (path === "/network") return phone && !search ? <PhonePeople header={header} /> : <NetworkPage header={header} />;
    if (path === "/loops") return <LoopsPage header={header} />;
    if (path === "/lucky") return <LuckyPage header={header} />;
    if (path === "/job-matching") return phone ? <PhoneTriage header={header} /> : <JobMatchingPage header={header} />;
    if (path === "/applied" && phone) return <PhoneActivity header={header} />;
    if (path === "/applied" || path.startsWith("/applied/")) return <AppliedPage header={header} />;
    if (path === "/settings") return <SettingsPage header={header} />;
    if (path === "/general") return <GeneralPage header={header} />;
    if (path === "/usage") return <UsagePage header={header} />;
    if (path === "/assessments") return <AssessmentsPage header={header} />;
    if (path === "/staffing") return <StaffingPage header={header} />;
    if (path === "/resume_builder") return <ResumeBuilderPage header={header} />;
    if (path === "/bank") return <BankPage header={header} />;
    if (path === "/day-plan") return <DayPlanPage header={header} />;
    // The answer pages (To answer, and the full form view) were retired: old links and bookmarks land on Today.
    if (path === "/unanswered" || path === "/answers") return <Navigate to="/" replace />;
    if (path === "/ready" || path === "/review") return <ReadyPage header={header} />;
    if (path === "/stats" || path === "/overview") return <InsightsPage header={header} />;
    // The earlier, heavier analytics page stays reachable for the detail.
    if (path === "/analytics") return <Applications header={header} />;
    // Today's work needs the laptop's extension; on a phone, Home comes first and Today stays one tap away.
    if (path === "/today" || !phone) return <TodayPage header={header} />;
    return <PhoneHome header={header} />;
  })();
  if (phone) return <div className="ph-app"><div className="ph-main">{page}</div><PhoneTabBar /><CaptureDock /></div>;
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
