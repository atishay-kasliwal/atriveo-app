# Open source bank finalization, 2026-11-25

User approval: "finalize it", following the reviewed dashboard drafts. Bank v72 adds 24 points (8 merged, 16 open) with per-PR skill evidence. Existing general-resume pins are retained. Status is never printed, open work ranks below merged work, and upstream organizations are never employers.

These points pass the bank's wording checks at 9.5 or above. That is a mechanical writing score, not an assertion that every contribution has equal recruiting value. Metrics describe the scope or author-reported validation, never invented adoption, accuracy or production impact. The underlying upstream suites were not rerun for this bank update.

Four small contributions stay as dashboard notes without resume fits: git-koi #73 (constants), AURA #903 (field comment), NVKR #461 (expected command count), developer-portfolios #4050 (directory listing).

NVKE #2423 explicitly credits an upstream fix and is marked shared. Macaron #183 remains an upstream draft. Documentation/configuration entries receive no implementation-language credit.

## Finalized points

### AC-321: OSSAfrica/skillguard#233

Added scanner-version provenance to SkillGuard's Go JSON reports across 2 input paths, linking file and stdin scan results to their release so users can compare findings as detection rules change.

Source: https://github.com/OSSAfrica/skillguard/pull/233

Evidence: JSON report version round-trip regression; file and stdin paths use the same report construction.

Limits: Release provenance, not measured scanner accuracy or adoption.

### AC-322: dsx-ai-factory/nvke#2423

Repaired conflicting CoreDNS listener bindings across 4 Kubernetes zones by applying an upstream fix, adding Go regression coverage that keeps base-zone bindings consistent with the node-cache address during configuration changes.

Source: https://github.com/dsx-ai-factory/nvke/pull/2423

Evidence: Regression reads the applied ConfigMap and compares all four base zones with the DaemonSet local address.

Limits: Applies kfelternv's upstream fix; cluster validation was performed by that contributor, not this author.

### AC-323: lmcinnes/umap#1360

Solved UMAP's empty-string distance bug by guarding undefined bit shifts in Python, covering 3 input cases with uncompiled regression checks that expose the failure independently of processor architecture.

Source: https://github.com/lmcinnes/umap/pull/1360

Evidence: Three empty-string cases exercise the uncompiled path; original behavior fails before the early returns.

Limits: No ppc64el hardware run; platform-independent regression reproduces the undefined-shift cause.

### AC-324: kroxylicious/kroxylicious#5368

Revised Kroxylicious Vault setup examples to replace token-shaped credentials with explicit placeholders, reducing the guide's gitleaks service-token findings from 1 to 0 so documentation avoids triggering credential-leak alerts.

Source: https://github.com/kroxylicious/kroxylicious/pull/5368

Evidence: Gitleaks 8.30.1 reports one service-token finding before the guide edit and none afterwards.

Limits: Documentation only; no Java implementation or real credential-rotation claim.

### AC-325: kiali/kiali#10570

Clarified incomplete AI responses in Kiali's React chatbot through explicit navigation feedback and text-aware copy controls, covering 7 regression cases so users can distinguish actionable links from genuinely empty answers.

Source: https://github.com/kiali/kiali/pull/10570

Evidence: Seven added chatbot tests cover copy, navigation, auto-navigation, empty responses and streaming.

Limits: User-facing React change; no backend Go implementation or adoption metric.

### AC-326: open-macaron/macaron#183

Simplified Macaron's NestJS pricing initialization from 2 file reads to 1 by sharing an injected PriceList, giving key minting and model preferences the same pricing instance with module-level regression coverage.

Source: https://github.com/open-macaron/macaron/pull/183

Evidence: Module regression verifies one PriceList file read and shared calls from key minting and model preferences.

Limits: Upstream draft PR; controller suite has known failures and database integration was not run.

### AC-327: yalongwastaken/git-koi#74

Simplified git-koi's Rust feeding renderer into separate ring and pellet routines, preserving byte-identical output across 40 render comparisons so animation logic can be changed independently without altering existing visuals.

Source: https://github.com/yalongwastaken/git-koi/pull/74

Evidence: Forty render variants remain byte-identical; deliberately changing ring dither affects feeding renders.

Limits: Behavior-preserving refactor; no performance improvement or user-growth claim.

### AC-328: yalongwastaken/git-koi#72

Repaired truncated color markings across 6 git-koi body shapes by extending Rust pigment sampling to the nose, verifying red and blue patches through regression tests and regenerated visual reference sheets.

Source: https://github.com/yalongwastaken/git-koi/pull/72

Evidence: Red and blue nose markings checked across six bodies; regenerated light and dark reference sheets reviewed.

Limits: Rendering correctness, not measured engagement or rendering speed.

### AC-329: Nixtla/neuralforecast#1774

Repaired NeuralForecast Python preprocessing that could return 2 identically named columns by validating calendar features before insertion, giving users explicit conflict errors instead of ambiguous forecasting inputs with regression coverage.

Source: https://github.com/Nixtla/neuralforecast/pull/1774

Evidence: Duplicate calendar-feature regression fails on the original implementation and passes with validation.

Limits: Rejects naming collisions; no forecast-accuracy improvement claimed.

### AC-330: Nixtla/neuralforecast#1773

Repaired NeuralForecast's Python checks that silently skipped model-loss failures by propagating exceptions and extending synthetic series, validating the corrected training checks with 35 passing CPU tests so broken runs fail visibly.

Source: https://github.com/Nixtla/neuralforecast/pull/1773

Evidence: Corrected model/loss checks pass 35 CPU tests after exceptions propagate and test series are long enough.

Limits: Suite count, not model accuracy or production throughput.

### AC-331: NVIDIA/nodewright#1047

Simplified NVIDIA Nodewright's webhook Secret configuration by deriving 2 settings from one Kustomize source, synchronizing the manager's Secret name with its Kubernetes RBAC permission when the base configuration changes.

Source: https://github.com/NVIDIA/nodewright/pull/1047

Evidence: Pinned Kustomize build confirms the base manager environment and Role Secret rule change together.

Limits: Configuration only, no Go code or cluster e2e; overlays that patch the env value still need the documented replacement.

### AC-332: dsx-ai-factory/nvkr#482

Specified NVKR migration acceptance through per-output build-digest equivalence in architecture documentation, accounting for 14 additional family outputs so renamed artifacts and composite membership have explicit verification requirements before cutover.

Source: https://github.com/dsx-ai-factory/nvkr/pull/482

Evidence: ADR reconciliation checks pass; authored definitions account for fourteen added family-only outputs.

Limits: Documentation defines a cutover gate; no implemented migration or Go work claimed.

### AC-333: cockpit-project/cockpit#23924

Repaired Cockpit's deprecated JavaScript lifecycle listeners with cache-aware pagehide handling, eliminating unload warnings in a 10-visit Chrome reproduction while preserving frame reloads and navigation for users returning to the console.

Source: https://github.com/cockpit-project/cockpit/pull/23924

Evidence: Installed bundles reproduced removal of unload deprecations across the reported Chrome page visits; reload/navigation checked.

Limits: Manual Fedora/Chrome reproduction, not the integration suite; unrelated xterm CSP issue remains.

### AC-334: dsx-ai-factory/nvke#2246

Diagnosed misleading NVKE qualification failures caused by stale retry errors and corrected Go failure attribution, verifying behavior across 30 race-enabled unit repetitions so JUnit reports retain only relevant failure causes.

Source: https://github.com/dsx-ai-factory/nvke/pull/2246

Evidence: Race-enabled unit selection repeated thirty times; a Ginkgo harness verifies JUnit stale-cause removal.

Limits: Test tooling only; a progress report can suppress a genuine cause but full system-err is retained.

### AC-335: Seagey/couch-tv#60

Added Python build-time icon retrieval for Couch TV apps missing bundled logos, verifying downloads and rejection paths with 2 self-signed HTTPS regression tests so LG packages include usable app icons.

Source: https://github.com/Seagey/couch-tv/pull/60

Evidence: Two tests cover packaging and invalid/unreachable icons against a self-signed HTTPS server.

Limits: No physical LG TV validation; TV icon requests deliberately disable certificate checks for the local self-signed endpoint.

### AC-336: keycloak/keycloak#54938

Revised Keycloak's Java OIDC test to restore 2 client configuration changes automatically after failures, preserving public-client authentication coverage while preventing modified settings from leaking into subsequent test cases.

Source: https://github.com/keycloak/keycloak/pull/54938

Evidence: OIDC test passes against embedded server; both authenticator and public-client changes use managed cleanup.

Limits: Migration of one test, not ownership of the authentication subsystem or the entire framework.

### AC-337: aschiff98/triangle-startups-community#22

Added offline job-export comparison in TypeScript with explicit handling for uncertain matches, passing 39 tests on fictional fixtures so readable reports preserve unknown dates and direct ambiguous records to review.

Source: https://github.com/aschiff98/triangle-startups-community/pull/22

Evidence: Thirty-nine tests plus build/check pass; deterministic reports verified with fictional exported jobs.

Limits: Fictional export fixtures; no real aggregator coverage, production jobs processed or adoption claim.

### AC-338: OSSAfrica/skillguard#218

Repaired SkillGuard's GitHub Actions reports that lost scan counts or mislabeled execution errors, validating 8 local harness scenarios so workflows receive accurate totals and distinguish scanner failures from rejected skills.

Source: https://github.com/OSSAfrica/skillguard/pull/218

Evidence: Eight local stand-in-Docker harness scenarios cover pass/fail/error both with and without output.

Limits: Real Docker Action and container permissions were not tested locally.

### AC-339: OSSAfrica/skillguard#217

Updated SkillGuard's Go YAML parser to accept valid scalar trigger metadata that previously stopped scans, covering 13 input cases while preserving explicit errors for malformed skills entering analysis.

Source: https://github.com/OSSAfrica/skillguard/pull/217

Evidence: Thirteen Go parser table cases cover scalar/list forms and rejection of malformed mappings/nested lists.

Limits: Parser correctness; no claim of improving security detection rates.

### AC-340: mezmo/aura#873

Repaired missing Jenkins integration reports in Mezmo AURA by publishing JUnit results during unconditional stage cleanup, verifying 3 local harness outcomes so failed test runs preserve structured diagnostics for reviewers.

Source: https://github.com/mezmo/aura/pull/873

Evidence: Local Jenkins control-flow harness publishes one report on success, test failure and coverage failure.

Limits: Live failing-run Jenkins validation pending; no Rust code or CI runtime improvement claimed.

### AC-341: cockpit-project/cockpit-podman#2720

Clarified missing-container views in Cockpit Podman with React links to excluded owners, verifying selection with 2 container-owning accounts so users can navigate from an empty All view to their containers.

Source: https://github.com/cockpit-project/cockpit-podman/pull/2720

Evidence: Manually checked two container-owning users on Fedora; added steps to testOtherUsers.

Limits: Integration suite not run locally; only owners with running containers are discovered.

### AC-342: FrostyX/tracer#233

Diagnosed and repaired Tracer crashes caused by zombie sshd processes with unreadable command lines, restoring Cockpit service-restart queries on Fedora with 127 Python tests passing after the fix.

Source: https://github.com/FrostyX/tracer/pull/233

Evidence: Affected Fedora system reproduces stock failure and corrected Cockpit output; 127 Python tests pass, 23 skipped.

Limits: Fixes missing process metadata; no measured latency, uptime or adoption improvement.

### AC-343: mezmo/aura#866

Updated 2 Mezmo AURA Docker build definitions to pin upstream math-mcp arithmetic fixes, giving agent example builds numeric median ordering and division-by-zero errors from the corrected dependency revision.

Source: https://github.com/mezmo/aura/pull/866

Evidence: Both Docker definitions pin the upstream math-mcp arithmetic-fix commit and matching build command.

Limits: Dependency/configuration only; no local image build or upstream arithmetic-code ownership claimed in this point.

### AC-344: mezmo/aura#864

Repaired unbounded raw-output retention in Mezmo AURA's Rust persistence wrapper by clearing context-free calls before returning, with 47 library tests passing to guard cleanup when task metadata is absent.

Source: https://github.com/mezmo/aura/pull/864

Evidence: Context-free raw-output cleanup regression plus 47 persistence-wrapper library tests pass.

Limits: Existing orchestrator sets task context and was unaffected; fix covers other stacks using the wrapper.
