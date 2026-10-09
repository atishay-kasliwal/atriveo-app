# Data Science and Data Analyst resumes: research and approach

Written 2026-10-08, before the DS and DA rounds. The cycle is the same as FDE and SWE: facts, bullets, a blind
30-posting test at 90%+, then ship as a pinned set.

## 1. What the postings ask for

Evidence: 690 DS and 225 DA postings from 439 companies, collected by Atriveo. DS titles: data scientist 468, applied
scientist 167, ML scientist 33, research scientist 15.

| Asks for | DS | DA | Other roles |
|---|---|---|---|
| ML modeling (train / evaluate / deploy) | **89%** | 16% | 39% |
| Stakeholders / communicating insights | 79% | **88%** | 64% |
| Statistics / statistical modeling | **75%** | 43% | 21% |
| SQL / data wrangling | 64% | **74%** | 34% |
| Production / MLOps | 67% | 34% | 76% |
| Experimentation / A/B tests / causal | **54%** | 10% | 14% |
| Business impact / KPIs | 52% | 44% | 23% |
| Dashboards / BI | 35% | **63%** | 9% |

**Tools:**
- **DS:** Python 91%, SQL 55%, Excel 36%, AWS 19%, Spark 16%, PyTorch 16%, scikit-learn 14%.
- **DA:** SQL 70%, Excel 63%, Python 49%, Tableau 31%, Power BI 31%, Snowflake 12%.

## 2. How they're judged (hiring guides and hiring-manager accounts)

**Data Science:**
- **Two axes:** technical depth and business impact. "A PhD who cannot explain how their model moved a product
  metric will lose out to an MS candidate who drove a 15 percent increase in conversion through rigorous A/B
  testing" ([ResumeGeni](https://resumegeni.com/resume-guides/data-scientist)).
- **Statistical rigor is what separates DS from DA:** experimental design, hypothesis testing, causal inference, the
  limits of observational data. Name methods in context (Cox regression, t-test, gradient boosting), not as a list.
- **Compare with a baseline.** Not "performed feature engineering" but "[model] reached ### precision and recall vs
  model X" ([Blind resume reviews](https://www.teamblind.com/post/resume-review-for-data-scientistanalyst-nmcsaxja)).
- **If the outcome can't be measured, measure the input:** dataset size, number of experiments, stakeholders
  briefed.
- **Shape:** at most 4 bullets per employer. A project needs a real outcome, "not a toy example"
  ([Hacking Data Science](https://hackingdatascience.substack.com/p/how-to-write-data-science-resume)).

**Data Analyst:**
- **The 30-second scan:** a hiring manager wants "SQL fluency, a named BI tool, and one quantified business outcome
  on page one" ([ResumeGeni BI guide](https://resumegeni.com/resume-guides/business-intelligence-analyst)).
- **Pair the analysis with the decision it drove:** the metric, the magnitude, the audience. Quantify report
  adoption, refresh-time cuts, ad-hoc requests removed, hours saved
  ([Enhancv](https://enhancv.com/resume-examples/data-reporting-analyst/)).
- **Examples of the shape:** "SQL + Python reporting pipeline cut weekly dashboard prep from 12 hours to 45 minutes";
  "Tableau dashboard tracking $8M ad spend; insights moved 22% of budget".

## 3. The layers

**DS** (each bullet a distinct fact):
1. **Model vs baseline:** [model] on [data] → [metric] vs [baseline or chance].
2. **Statistical rigor:** [named method: survival model, hypothesis test, Monte Carlo, Bayesian] → [what it
   established].
3. **Data at scale and features:** [N records or scans or years] → [features or pipeline that made it usable].
4. **Decision and impact:** [who used the result] → [what changed: time, decisions, adoption].
5. **Production (DS-to-ML roles):** [deployed, monitored, MLflow / Bedrock] → [reliability].

**DA:**
1. **SQL on real data:** [queries or models on N rows] → [speed or accuracy].
2. **Dashboard or BI tool:** [Tableau / Power BI / Looker] for [audience] → [adoption, hours saved].
3. **Decision driven:** [analysis] → [business decision and its number].
4. **Reporting automation:** [manual report] → [automated, time saved].

## 4. Your evidence today

| Layer | DS | DA |
|---|---|---|
| Model vs baseline | FOMC 68% directional vs 50% chance (13 sessions); 3-agent system 60% on 30 S&P 500 stocks; 90%+ masks; ~99% physician agreement | — |
| Statistical rigor | Kaplan-Meier and Cox survival models (73-patient cohorts, mri-research); Wake Forest radiomics survival models; MMM Ridge regression, t-tests, 1,000-run Monte Carlo with 90% interval coverage (simulated data) | weak |
| Data at scale | 200K+ financial records; 50K scans (2 TB); 7 years of FOMC; 200+ radiomic features | 50K+ Atriveo applications (not yet analysed as such) |
| Decision / users | trading team, 20–30 analysts, clinicians; hospital still uses the pipeline | 5 daily analysts on a React analytics dashboard; Fidelity compliance console, 500+ daily events |
| SQL / BI tool | — | **missing: no real SQL, Tableau or Power BI work in the bank** |

**DS is well supported.** It needs a few facts (survival-model metric, baselines) and careful method naming.

**DA has a real gap:** the two things DA screens for first (SQL and a named BI tool on real data) aren't in the bank.

## 5. The best way for us

1. **DS first.** Short fact check, then bullets, test and ship.
2. **For DA, close the gap with real work on real data you own: Atriveo's.** 50K+ applications with sources, job
   boards, roles, resume tracks and inbox outcomes is a genuine analyst dataset.
   - Load it into a SQL database (Postgres or DuckDB) and write the analysis in SQL: response and interview rates by
     source, job board, role track and time to apply.
   - Build a Tableau Public or Power BI dashboard on top.
   - Act on one finding (for example, which sources or resume tracks get responses).
   - The result is true, specific bullets ("SQL over 50K+ applications… dashboard… shifted X") and a portfolio link.
3. **The same dataset gives DS a real experiment.** Compare response rates across resume versions (general vs
   tailored, old vs new FDE/SWE sets) with a proper test and honest causal language. That's the A/B or causal
   evidence 54% of DS postings ask for.
4. **Simulated data stays labelled.** The MMM project can support DS as "simulated data", never presented as real
   business impact.
5. **Titles:** Stony Brook on DS resumes already prints "Data Scientist (Research)". DA needs a decision, since your
   work there wasn't an analyst role; "Data Analyst" at Stony Brook would be a stretch.
