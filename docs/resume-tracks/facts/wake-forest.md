# Wake Forest – CAIR (May–Aug 2025): fact sheet

Facts only, each with its source and status. Bullets for any role are written from **confirmed** lines only.

| Fact | Source | Status |
|---|---|---|
| Tumor segmentation model in PyTorch on N4ITK bias-corrected MRI, **90%+ mask accuracy** | bank AC-033 (confirmed 2026-10-05) | confirmed |
| Tumor location, segmentation and masking at **~99% agreement** with physician-created ground truth (a separate measure from the 90%+) | you, 2026-10-08 ("both are correct, keep separate") | confirmed |
| Segmentation **3 hours → 2 minutes** | bank AC-031 | confirmed |
| Manual workflow (plane conversion to DWI/T2 plus hand masking across ~5 scans) **~1 hour → under 1 minute** (a separate measure from 3 h → 2 min) | you, 2026-10-08 | confirmed |
| **10K+ MRI studies**; ~5 scans per patient | bank AC-031; you | confirmed |
| **~50,000 scans** | you, 2026-10-08 | confirmed |
| Data size: **2 TB or 22 TB?** (Codex summary said ~2 TB; your voice note read "22 TB") | you | **needs confirmation** |
| Ground truth created by radiologists, residents and doctors | you | confirmed |
| Team of **~20 residents and 2 lead doctors**; CAIR ~100 people | you | confirmed |
| Clinicians ran a year-long review of outcomes and suggestions (accurate? helpful?) and still do | you | confirmed |
| Integrated into the hospital pipeline; collaborators still use it because of the time saved | you | confirmed |
| Cloud: both used; you asked not to go into GCP, so **Wake Forest bullets name no cloud** | you, 2026-10-08 | decided |
| Epic; DICOM → NIfTI; skull stripping; motion rejection; ITK-SNAP | you, 2026-10-08 | confirmed |
| Normalization; multiple scanner generations and vendors | Codex interview summary | needs confirmation |
| ~200 radiomic features (bank: 200+ PyRadiomics biomarkers) | bank AC-044 | confirmed |
| Patient similarity over 10K+ historical cases; Claude summaries of similar patients' histories; outcomes at 6/12/24 months | bank AC-045 / AC-046 | confirmed |
| React/TypeScript clinician dashboard with mask refinement | bank AC-047 | confirmed |
| Not for the resume: the 100-year-old patient outlier (good interview story) | you | n/a |
| **A/B tests of the segmentation/prediction algorithms** (comparing versions) | you, 2026-10-08 | confirmed. **Which versions and what result?** |
| **R** used to build models | you, 2026-10-08 | confirmed |
| **Excel, advanced:** cleaning and structuring unstructured data, detailed formulas | you, 2026-10-08 | confirmed |
| SQL used | you, 2026-10-08 | confirmed |
| Title on your DS resume: **AI and Data Analytics Intern** | your DS resume, 2026-10-08 | title option for DS/DA |
| **Reconciled Epic patient records with 450+ MRI studies**: standardized validation, privacy controls, better completeness | your DS resume, 2026-10-08 | confirmed |
| **Automated DICOM ingestion, cleaning and preprocessing**, manual preparation time −50% | your DS resume, 2026-10-08 | confirmed |
| **500+ quantitative features from 450+ MRI scans** (PyRadiomics, N4ITK) for **stroke analysis** | your DS resume, 2026-10-08 | confirmed: a separate analysis from the 10K-study tumor platform |
| **87% predictive accuracy**: trained and validated SVM, Random Forest, XGBoost and LightGBM, with SHAP | your DS resume, 2026-10-08 | confirmed: this is the algorithm comparison (A/B of models) |
| Presented clinical trends and model findings to a 20-member team with R, ggplot2, Shiny | your DS resume, 2026-10-08 | confirmed |

| Fact (2026-10-09) | Status |
| --- | --- |
| Apache Airflow used for the MRI data pipelines | Confirmed |
| Survival / prognosis models on the 200+ radiomic biomarkers: **C-index about 0.7** | Confirmed (his estimate) |
| Presentation to the 20-member team changed the team's next modeling decisions | Confirmed |
| Portfolio site: 10 TB, 4 h → 18 min, 95% concordance (an earlier or later stage of the same project; see below) | Both true |
| Correction 2026-10-09: the stroke model's **87% is recall** (SVM), accuracy ~63%; best AUC 0.80; the "0.7" he recalled matches the best SVM's **0.697 AUC** (MRI repo), so bullets say AUC, not C-index | MRI repo results files |
| MRI repo held patient files with MRN numbers and was public; made **private** 2026-10-09 (history cleanup still to do) | — |
| 2026-10-09: the portfolio figures (10 TB, 4 h → 18 min, 95% radiologist concordance) and the resume figures (2 TB, 3 h → 2 min / 1 h → <1 min, 99% physician agreement) are **both true: measured at different stages as the project progressed** (Atishay). Not a mismatch; in interviews, tell it as the progression | Confirmed |
