import type { SelectedJobAnalysis } from "../utils/jobAnalysis";

interface Props {
  analysis: SelectedJobAnalysis | null;
}

function SkillPill({ skill, count, percent, inResume }: { skill: string; count: number; percent: number; inResume?: boolean }) {
  return (
    <span className={`jd-analysis-skill${inResume ? " is-covered" : ""}`}>
      <strong>{skill}</strong>
      <small>{count} jobs · {percent}%</small>
    </span>
  );
}

export default function BulkJobAnalysisPanel({ analysis }: Props) {
  if (!analysis) return null;

  return (
    <section className="jd-analysis-panel" aria-label="Selected job description analysis">
      <div className="jd-analysis-head">
        <div>
          <span>Selected JD Analysis</span>
          <h3>{analysis.selectedCount} jobs, decoded</h3>
          <p>
            {analysis.fullDescriptionCount}/{analysis.selectedCount} full descriptions used · Avg CareerOps {analysis.avgCareerOps}/100
          </p>
        </div>
        <div className="jd-analysis-score">
          <strong>{analysis.missingSkills.length}</strong>
          <small>resume gaps</small>
        </div>
      </div>

      <div className="jd-analysis-grid">
        <div className="jd-analysis-card wide">
          <div className="jd-analysis-card-title">Repeated requirements</div>
          <div className="jd-analysis-skills">
            {analysis.topSkills.slice(0, 12).map((skill) => (
              <SkillPill
                key={skill.skill}
                skill={skill.skill}
                count={skill.jobCount}
                percent={skill.percent}
                inResume={skill.inResume}
              />
            ))}
          </div>
        </div>

        <div className="jd-analysis-card">
          <div className="jd-analysis-card-title">Resume gaps</div>
          {analysis.hasResume ? (
            <div className="jd-analysis-list">
              {analysis.missingSkills.slice(0, 6).map((skill) => (
                <div key={skill.skill} className="jd-analysis-row">
                  <span>{skill.skill}</span>
                  <strong>{skill.percent}%</strong>
                </div>
              ))}
              {analysis.missingSkills.length === 0 && <p>No major selected-job gaps detected.</p>}
            </div>
          ) : (
            <p>Save your resume in Settings to compare these requirements against your actual resume.</p>
          )}
        </div>

        <div className="jd-analysis-card">
          <div className="jd-analysis-card-title">Role themes</div>
          <div className="jd-analysis-bars">
            {analysis.themes.slice(0, 6).map((theme) => (
              <div key={theme.theme} className="jd-analysis-bar-row">
                <span>{theme.theme}</span>
                <div><i style={{ width: `${theme.percent}%` }} /></div>
                <strong>{theme.count}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="jd-analysis-card">
          <div className="jd-analysis-card-title">Application strategy</div>
          <ul className="jd-analysis-actions">
            {analysis.actionBullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>

        <div className="jd-analysis-card">
          <div className="jd-analysis-card-title">Boards & companies</div>
          <div className="jd-analysis-mini">
            {analysis.topBoards.map((board) => (
              <span key={board.board}>{board.board} <strong>{board.count}</strong></span>
            ))}
          </div>
          <div className="jd-analysis-mini">
            {analysis.topCompanies.map((company) => (
              <span key={company.company}>{company.company} <strong>{company.count}</strong></span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
