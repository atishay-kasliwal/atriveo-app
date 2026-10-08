# Wake Forest – CAIR (May–Aug 2025): fact sheet

Facts only, each with its source and status. Bullets for any role are written from **confirmed** lines only.

| Fact | Source | Status |
|---|---|---|
| Tumor segmentation model in PyTorch on N4ITK bias-corrected MRI, **90%+ mask accuracy** | bank AC-033 (confirmed 2026-10-05) | confirmed |
| Tumor location, segmentation and masking at **~99% agreement** with physician-created ground truth (a separate measure from the 90%+) | you, 2026-10-08 ("both are correct, keep separate") | confirmed |
| Segmentation **3 hours → 2 minutes** | bank AC-031 | confirmed |
| Manual workflow (plane conversion to DWI/T2 plus hand masking across ~5 scans) **~1 hour → under 1 minute** (a separate measure from 3 h → 2 min) | you, 2026-10-08 | confirmed |
| **10K+ MRI studies**; ~5 scans per patient | bank AC-031; you | confirmed |
| **~50,000 scans, ~2 TB** | Codex interview summary | needs confirmation |
| Ground truth created by radiologists, residents and doctors | you | confirmed |
| Team of **~20 residents and 2 lead doctors**; CAIR ~100 people | you | confirmed |
| Clinicians ran a year-long review of outcomes and suggestions (accurate? helpful?) and still do | you | confirmed |
| Integrated into the hospital pipeline; collaborators still use it because of the time saved | you | confirmed |
| Cloud: **GCP and AWS both used** (AWS: EC2 inference with FastAPI, Lambda orchestration) | you, 2026-10-08 | **needs confirmation: which parts ran on which** (a role names a cloud only where that part ran on it) |
| Epic, DICOM → NIfTI, normalization, skull stripping, motion rejection, ITK-SNAP-assisted masks, multiple scanner generations and vendors | Codex interview summary | needs confirmation |
| ~200 radiomic features (bank: 200+ PyRadiomics biomarkers) | bank AC-044 | confirmed |
| Patient similarity over 10K+ historical cases; Claude summaries of similar patients' histories; outcomes at 6/12/24 months | bank AC-045 / AC-046 | confirmed |
| React/TypeScript clinician dashboard with mask refinement | bank AC-047 | confirmed |
| Not for the resume: the 100-year-old patient outlier (good interview story) | you | n/a |
