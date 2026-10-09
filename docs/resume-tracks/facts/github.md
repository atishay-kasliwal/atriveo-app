# Facts from your GitHub (read 2026-10-08)

Source: `gh` on atishay-kasliwal: READMEs and the Research-Cohorts work reports. Each fact is checkable in the repo.

| Fact | Repo | Use |
|---|---|---|
| **FedTalk (Stony Brook):** FOMC audio → Whisper transcripts; statements and news → sentences → `sentence-transformers` (768-dim) embeddings in Pinecone; per-minute retrieval; GPT-4o predicts market reaction; scored against SPY moves (Alpaca minute data) at 1/5/10-minute windows | fedtalk-openai-analysis-main, Research-Cohorts | DS (evaluation, NLP, LLM) |
| FedTalk results: **58.7% accuracy, 100% precision, 58.7% recall, 0.74 weighted F1**; volatility clustered higher right after releases; limits stated (few independent events) | same | DS |
| FedTalk extended to a **live dashboard: 13 FOMC sessions (Jun 2024 – Dec 2025)**, each scored on accuracy, MAE and MSE; model-vs-model comparison; paper-trading simulation | Research-Cohorts | DS, DA |
| Stony Brook title in your work report: **Software Engineer – Research** | Research-Cohorts | title evidence |
| **Stroke MRI pipeline (Wake Forest CAIR × Atrium Health, NSF and NIH funded):** DICOM → NIfTI across 5 modalities (T1, T2, FLAIR, DWI, ADC); FreeSurfer registration; N4 bias correction; lesion masking; **cross-modality validation (Pearson, Dice, Jaccard)**; radiomics; **Random Forest, XGBoost, CatBoost predicting mRS** at discharge and follow-up; **feature models substantially beat a clinical-variables-only baseline**; resumable batch processing over the real de-identified cohort | Research-Cohorts | DS |
| **hushh.ai:** Monte Carlo GBM simulator (thousands of paths); **Policy Gradient deep-hedging RL that matched or beat Black-Scholes** under its training conditions (did not generalize across moneyness, stated honestly) | Research-Cohorts (cohorts repo) | DS (needs: how to present hushh.ai) |
| hushh.ai: KaiWeightEvalService, an offline replay-and-gate evaluation of the finance agent's weights with an audit trail; paired on the 3-agent debate engine | Research-Cohorts | DS/SWE |
| **Intel Image Classification:** ResNet-152 transfer learning, 6 scene classes, **90.7% validation accuracy** | Intel-Image-Classification | DS project |
| **Walmart Sales Prediction:** 45 stores, department-level weekly sales, holiday-markdown effects, linear regression with shrinkage | Walmart-Sales-Prediction | DS/DA project |
| **Heart Disease Prediction:** UCI dataset (14 attributes), EDA, correlation analysis, classification | Heart-Disease-Prediction | DS/DA project |
| **Bayesian MMM** (simulated data): R² 0.949, MAPE 2.74%, 5 channels over 156 weeks, holdout A/B, Monte Carlo, budget optimization, Tableau exports | bayesian-marketing-mix-model | DS project, **always labelled simulated** |
