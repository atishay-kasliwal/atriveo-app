// All Things Open 2026 (Oct 19-20, Raleigh): the public program as listed on the conference site and your workbook.
// Titles, rooms, times and speaker names only. Your own people, notes and follow-ups come from Network, never from here.
export interface AtoSession { id: string; title: string; date: string; start: number; end: number; room: string; track: string; kind: "session" | "workshop"; speakers: string[]; company: string; link: string }
export const ATO_DAYS: [string, string][] = [["2026-10-19", "Mon Oct 19"], ["2026-10-20", "Tue Oct 20"]];
export const ATO_SESSIONS: AtoSession[] = [
 {
  "id": "953ee6cfe61a",
  "title": "AI Agents & Vibe Coding workshop",
  "date": "2026-10-19",
  "start": 540,
  "end": 780,
  "room": "Ballroom A",
  "track": "Extended Workshop",
  "kind": "workshop",
  "speakers": [
   "Mark Hinkle"
  ],
  "company": "Peripety Labs / All Things AI",
  "link": ""
 },
 {
  "id": "9d4efb52b35b",
  "title": "AI for DevSecOps workshop",
  "date": "2026-10-19",
  "start": 540,
  "end": 780,
  "room": "Ballroom A",
  "track": "Extended Workshop",
  "kind": "workshop",
  "speakers": [
   "John Willis"
  ],
  "company": "AI CIO",
  "link": ""
 },
 {
  "id": "497880e4575f",
  "title": "AI Agents in Production workshop",
  "date": "2026-10-19",
  "start": 540,
  "end": 780,
  "room": "Ballroom B",
  "track": "Extended Workshop",
  "kind": "workshop",
  "speakers": [
   "Don Shin"
  ],
  "company": "CrossComm",
  "link": ""
 },
 {
  "id": "898f82b86c24",
  "title": "From Zero to Secure Agent: Building and Hardening AI Agents with Open Source Tools",
  "date": "2026-10-19",
  "start": 540,
  "end": 645,
  "room": "Room 301A & B",
  "track": "Deep Dive Session 1",
  "kind": "workshop",
  "speakers": [
   "Anya Derbakova"
  ],
  "company": "AWS",
  "link": "https://2026.allthingsopen.org/sessions/from-zero-to-secure-agent-building-and-hardening-ai-agents-with-open-source-tools"
 },
 {
  "id": "647c3aa14a1f",
  "title": "Taming Agentic AI: How to run Agents generated Code Safely on Kubernetes",
  "date": "2026-10-19",
  "start": 540,
  "end": 645,
  "room": "Room 302A & B",
  "track": "Deep Dive Session 4",
  "kind": "workshop",
  "speakers": [
   "Abdel Sghiouar"
  ],
  "company": "Google Cloud",
  "link": "https://2026.allthingsopen.org/sessions/taming-agentic-ai-how-to-run-agents-generated-code-safely-on-kubernetes"
 },
 {
  "id": "f8becf7df74f",
  "title": "Open Agent Design: Building with Open Models, Extending with Frontier",
  "date": "2026-10-19",
  "start": 540,
  "end": 645,
  "room": "Room 302C",
  "track": "Deep Dive Session 2",
  "kind": "workshop",
  "speakers": [
   "Nathan Fulton"
  ],
  "company": "IBM",
  "link": "https://2026.allthingsopen.org/sessions/open-agent-design-building-with-open-models-extending-with-frontier"
 },
 {
  "id": "8c53a18e1d93",
  "title": "Job Search Like a Pro: Using Claude to Land Your Next Role",
  "date": "2026-10-19",
  "start": 540,
  "end": 645,
  "room": "Room 303",
  "track": "Deep Dive Session 3",
  "kind": "workshop",
  "speakers": [
   "Taylor Desseyn"
  ],
  "company": "Randstad Digital/Torc",
  "link": "https://2026.allthingsopen.org/sessions/job-search-like-a-pro-using-claude-to-land-your-next-role"
 },
 {
  "id": "4faf9f642b1e",
  "title": "Closing the Agentic Loop",
  "date": "2026-10-19",
  "start": 660,
  "end": 780,
  "room": "Room 301A & B",
  "track": "Deep Dive Session 1",
  "kind": "workshop",
  "speakers": [
   "Kent C. Dodds"
  ],
  "company": "Kent C. Dodds Tech LLC",
  "link": "https://2026.allthingsopen.org/sessions/closing-the-agentic-loop"
 },
 {
  "id": "6f012755bd03",
  "title": "From Zero to Running Agent: Build and Ship an Open Source AI System in One Day",
  "date": "2026-10-19",
  "start": 660,
  "end": 780,
  "room": "Room 302A & B",
  "track": "Deep Dive Session 4",
  "kind": "workshop",
  "speakers": [
   "Daphne Charles"
  ],
  "company": "Salesforce",
  "link": "https://2026.allthingsopen.org/sessions/from-zero-to-running-agent-build-and-ship-an-open-source-ai-system-in-one-day"
 },
 {
  "id": "c06d84251823",
  "title": "Your Agent Shipped the Fix. Did It Work?",
  "date": "2026-10-19",
  "start": 660,
  "end": 780,
  "room": "Room 302C",
  "track": "Deep Dive Session 2",
  "kind": "workshop",
  "speakers": [
   "Jason Ostroski"
  ],
  "company": "Dynatrace",
  "link": "https://2026.allthingsopen.org/sessions/your-agent-shipped-the-fix-did-it-work"
 },
 {
  "id": "b40ade72dafe",
  "title": "One Function Changed. What Breaks Next?",
  "date": "2026-10-19",
  "start": 660,
  "end": 780,
  "room": "Room 303",
  "track": "Deep Dive Session 3",
  "kind": "workshop",
  "speakers": [
   "Nyah Macklin"
  ],
  "company": "Neo4j",
  "link": "https://2026.allthingsopen.org/sessions/one-function-changed-what-breaks-next"
 },
 {
  "id": "9fc6d2e222da",
  "title": "All Things Claude AI: From coding to cowork to security and integrations",
  "date": "2026-10-19",
  "start": 870,
  "end": 990,
  "room": "Room 301A & B",
  "track": "Deep Dive Session 1",
  "kind": "workshop",
  "speakers": [
   "Brent Laster"
  ],
  "company": "Tech Skills Transformations",
  "link": "https://2026.allthingsopen.org/sessions/all-things-claude-ai-from-coding-to-cowork-to-security-and-integrations"
 },
 {
  "id": "453fb2ecfe64",
  "title": "Provenance Driven Development: Building Real Software with Atomic and OpenCode",
  "date": "2026-10-19",
  "start": 870,
  "end": 990,
  "room": "Room 302A & B",
  "track": "Deep Dive Session 4",
  "kind": "workshop",
  "speakers": [
   "Lee Faus"
  ],
  "company": "Atomic Software Co.",
  "link": "https://2026.allthingsopen.org/sessions/provenance-driven-development-building-real-software-with-atomic-and-opencode"
 },
 {
  "id": "4abcf097763c",
  "title": "The Linux Helpdesk",
  "date": "2026-10-19",
  "start": 870,
  "end": 990,
  "room": "Room 302C",
  "track": "Deep Dive Session 2",
  "kind": "workshop",
  "speakers": [
   "Jay LaCroix"
  ],
  "company": "Learn Linux TV",
  "link": "https://2026.allthingsopen.org/sessions/the-linux-helpdesk"
 },
 {
  "id": "17dcc95f6e44",
  "title": "Voice Agent Bootcamp: Build and Deploy Your First Agent from Scratch",
  "date": "2026-10-19",
  "start": 870,
  "end": 990,
  "room": "Room 303",
  "track": "Deep Dive Session 3",
  "kind": "workshop",
  "speakers": [
   "Jesse Hall"
  ],
  "company": "LiveKit",
  "link": "https://2026.allthingsopen.org/sessions/voice-agent-bootcamp-build-and-deploy-your-first-agent-from-scratch"
 },
 {
  "id": "92cd41695315",
  "title": "The Future of Apps is Open Source and Agentic",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Ballroom A",
  "track": "Machine Learning / AI 1",
  "kind": "session",
  "speakers": [
   "Mark Techson",
   "Andrew Brogdon",
   "Marc Dougherty"
  ],
  "company": "Google",
  "link": "https://2026.allthingsopen.org/sessions/the-future-of-apps-is-open-source-and-agentic"
 },
 {
  "id": "f096bc623e25",
  "title": "Skill Issue: Why Your AI Agent Still Sucks",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Ballroom B",
  "track": "Developer 1",
  "kind": "session",
  "speakers": [
   "Angie Jones"
  ],
  "company": "Agentic AI Foundation",
  "link": "https://2026.allthingsopen.org/sessions/skill-issue-why-your-ai-agent-still-sucks"
 },
 {
  "id": "e2c5f4e49f7a",
  "title": "Making AI Agents Smarter with Memory: Context Management in Agentic AI",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Ballroom C",
  "track": "Machine Learning / AI 2",
  "kind": "session",
  "speakers": [
   "Prathibha Chowdary"
  ],
  "company": "MongoDB",
  "link": ""
 },
 {
  "id": "7b5515cec63f",
  "title": "To Boldly Go: Data Science Exploration with AI Agents in the Enterprise",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Room 301A",
  "track": "Machine Learning / AI 3",
  "kind": "session",
  "speakers": [
   "Dawn Wages"
  ],
  "company": "AWS",
  "link": ""
 },
 {
  "id": "0a17b0e4cf95",
  "title": "Getting People to Actually Contribute: How OSS Programs Lower the Barrier to Entry",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Room 301B",
  "track": "101",
  "kind": "session",
  "speakers": [],
  "company": "Amazon Web Services",
  "link": ""
 },
 {
  "id": "b31acd42286d",
  "title": "5 Common Linux Adoption Mistakes and How to Overcome Them",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Room 302A",
  "track": "Linux / Networking / Infrastructure",
  "kind": "session",
  "speakers": [
   "Jay LaCroix"
  ],
  "company": "Amazon / Linux TV",
  "link": ""
 },
 {
  "id": "7b33a992fcfb",
  "title": "eBPF for AI Powered Root Cause Analysis",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Room 304",
  "track": "DevOps",
  "kind": "session",
  "speakers": [
   "Peter Zaitsev"
  ],
  "company": "Percona",
  "link": "https://2026.allthingsopen.org/sessions/ebpf-for-ai-powered-root-cause-analysis"
 },
 {
  "id": "a1d43c3e7b51",
  "title": "AI Wrote the Code: Is It Secure?",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Room 305A",
  "track": "Developer 2",
  "kind": "session",
  "speakers": [
   "Adhithi Ravichandran"
  ],
  "company": "Surya Consulting, Inc.",
  "link": ""
 },
 {
  "id": "4a1743616b49",
  "title": "Don't Let the Chocolate Pile Up: Scaling DevRel Content with AI Agents",
  "date": "2026-10-20",
  "start": 630,
  "end": 660,
  "room": "Room 305B",
  "track": "DevRel",
  "kind": "session",
  "speakers": [
   "Nitya Narasimhan"
  ],
  "company": "Microsoft",
  "link": "https://2026.allthingsopen.org/sessions/dont-let-the-chocolate-pile-up-scaling-devrel-content-with-ai-agents"
 },
 {
  "id": "7db992e0bbc6",
  "title": "Supply Chain Security in the Age of the AI Hacker",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Ballroom A",
  "track": "Machine Learning / AI 1",
  "kind": "session",
  "speakers": [
   "Stephen Husak"
  ],
  "company": "Capital One",
  "link": "https://2026.allthingsopen.org/sessions/supply-chain-security-in-the-age-of-the-ai-hacker"
 },
 {
  "id": "eb574e380b0c",
  "title": "Stop Wasting GPUs: Building a Global Compute Cache for AI Inference",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Ballroom B",
  "track": "Developer 1",
  "kind": "session",
  "speakers": [
   "Sheilah Kirui"
  ],
  "company": "Akamai",
  "link": "https://2026.allthingsopen.org/sessions/stop-wasting-gpus-building-a-global-compute-cache-for-ai-inference"
 },
 {
  "id": "c663c361aa9b",
  "title": "Context Management in Agents",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Ballroom C",
  "track": "Machine Learning / AI 2",
  "kind": "session",
  "speakers": [
   "Laurie Voss"
  ],
  "company": "Azure AI / Microsoft",
  "link": ""
 },
 {
  "id": "655904394584",
  "title": "Simplifying Data and AI in the Enterprise: A Platform Engineer's Guide to Isolation Technologies",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Room 301A",
  "track": "Machine Learning / AI 3",
  "kind": "session",
  "speakers": [
   "Sanchit Juneja"
  ],
  "company": "Inku",
  "link": ""
 },
 {
  "id": "ba4628f6e269",
  "title": "Demystifying AI: A Practical Introduction for Developers",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Room 301B",
  "track": "101",
  "kind": "session",
  "speakers": [
   "Michael Holt"
  ],
  "company": "Arm",
  "link": "https://2026.allthingsopen.org/sessions/demystifying-ai-a-practical-introduction-for-developers"
 },
 {
  "id": "acaa6983b132",
  "title": "Building Your Secured Infrastructure with Open Source",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Room 302A",
  "track": "Linux / Networking / Infrastructure",
  "kind": "session",
  "speakers": [],
  "company": "Open Source Security Foundation",
  "link": ""
 },
 {
  "id": "8fec7f43fd38",
  "title": "My AI Driven React Workflow: Building faster with Agents",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Room 305A",
  "track": "Developer 2",
  "kind": "session",
  "speakers": [
   "Aileen Villanueva"
  ],
  "company": "Independent",
  "link": "https://2026.allthingsopen.org/sessions/my-ai-driven-react-workflow-building-faster-with-agents"
 },
 {
  "id": "fea8a78aded0",
  "title": "Open Source Developer Relations: A Field Guide",
  "date": "2026-10-20",
  "start": 675,
  "end": 705,
  "room": "Room 305B",
  "track": "DevRel",
  "kind": "session",
  "speakers": [
   "Danica Fine"
  ],
  "company": "Snowflake",
  "link": "https://2026.allthingsopen.org/sessions/open-source-developer-relations-a-field-guide"
 },
 {
  "id": "e5bde8f8e1de",
  "title": "Designing Production Grade Agentic Systems: From Prototype to Scalable Infrastructure",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Ballroom A",
  "track": "Machine Learning / AI 1",
  "kind": "session",
  "speakers": [
   "Siddhi Patil"
  ],
  "company": "Amazon Web Services",
  "link": "https://2026.allthingsopen.org/sessions/designing-production-grade-agentic-systems-from-prototype-to-scalable-infrastructure"
 },
 {
  "id": "96e5a1214680",
  "title": "How we built a software factory with Kiro Crew to merge 1,000 PRs in a week",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Ballroom B",
  "track": "Developer 1",
  "kind": "session",
  "speakers": [
   "Joe Guo",
   "Kyle Seaman"
  ],
  "company": "Amazon Web Services",
  "link": "https://2026.allthingsopen.org/sessions/how-we-built-a-software-factory-with-kiro-crew-to-merge-1000-prs-in-a-week"
 },
 {
  "id": "dd9d8001e613",
  "title": "Agentic AI: Black Box or Observable?",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Ballroom C",
  "track": "Machine Learning / AI 2",
  "kind": "session",
  "speakers": [
   "Shay Bannon"
  ],
  "company": "ScyllaDB",
  "link": ""
 },
 {
  "id": "464c1d5a9586",
  "title": "Fine Grained Authorization for AI Workloads",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Room 301A",
  "track": "Machine Learning / AI 3",
  "kind": "session",
  "speakers": [
   "Michael Ferrando"
  ],
  "company": "Auth0",
  "link": ""
 },
 {
  "id": "eb5b2a95033d",
  "title": "Code Reviews: Compassion and Connection",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Room 301B",
  "track": "101",
  "kind": "session",
  "speakers": [
   "Alex Odadede"
  ],
  "company": "Red Hat",
  "link": ""
 },
 {
  "id": "ff5767b51276",
  "title": "Your Production Ready OSS AI Assistant",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Room 304",
  "track": "DevOps",
  "kind": "session",
  "speakers": [
   "Michael Levan"
  ],
  "company": "Solo.io",
  "link": "https://2026.allthingsopen.org/sessions/your-production-ready-oss-ai-assistant"
 },
 {
  "id": "90fcd3e58a07",
  "title": "An Agent Is Just a Directory",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Room 305A",
  "track": "Developer 2",
  "kind": "session",
  "speakers": [
   "Amy Egan"
  ],
  "company": "Vercel",
  "link": "https://2026.allthingsopen.org/sessions/an-agent-is-just-a-directory"
 },
 {
  "id": "a2f5179c9bc8",
  "title": "Stop Scrolling: How to Make Developers Care About Your Open Source Project",
  "date": "2026-10-20",
  "start": 720,
  "end": 750,
  "room": "Room 305B",
  "track": "DevRel",
  "kind": "session",
  "speakers": [
   "Brooke Jamieson"
  ],
  "company": "AWS",
  "link": "https://2026.allthingsopen.org/sessions/stop-scrolling-how-to-make-developers-care-about-your-open-source-project"
 },
 {
  "id": "67abf88570fa",
  "title": "FEATURED SESSION: Efficient Agents in Minutes",
  "date": "2026-10-20",
  "start": 780,
  "end": 850,
  "room": "Ballroom A",
  "track": "Machine Learning / AI 1",
  "kind": "session",
  "speakers": [
   "Gabe Goodhart"
  ],
  "company": "IBM Research",
  "link": ""
 },
 {
  "id": "c3c342cae628",
  "title": "And I Would've Gotten Away with It Too, If It Weren't for Those Meddling Logs",
  "date": "2026-10-20",
  "start": 780,
  "end": 850,
  "room": "Ballroom B",
  "track": "Lightning Talks",
  "kind": "session",
  "speakers": [
   "Buddy Rikard"
  ],
  "company": "n8n",
  "link": "https://2026.allthingsopen.org/sessions/and-i-wouldve-gotten-away-with-it-too-if-it-werent-for-those-meddling-logs"
 },
 {
  "id": "4b06893fd05f",
  "title": "Building Accessibility into Open Source, One Practical Step at a Time",
  "date": "2026-10-20",
  "start": 780,
  "end": 850,
  "room": "Ballroom B",
  "track": "Lightning Talks",
  "kind": "session",
  "speakers": [
   "Maria Lamardo"
  ],
  "company": "GitHub",
  "link": "https://2026.allthingsopen.org/sessions/building-accessibility-into-open-source-one-practical-step-at-a-time"
 },
 {
  "id": "c4cdc540b797",
  "title": "Unify Your Context: The Unix Way to Build an AI Org",
  "date": "2026-10-20",
  "start": 780,
  "end": 850,
  "room": "Ballroom B",
  "track": "Lightning Talks",
  "kind": "session",
  "speakers": [
   "Aniket Agrawal",
   "Arun Rai",
   "Saket Raman"
  ],
  "company": "Xyne",
  "link": "https://2026.allthingsopen.org/sessions/unify-your-context-the-unix-way-to-build-an-ai-org"
 },
 {
  "id": "67a87041da0c",
  "title": "What Makes Open Source Work: Licensing and Beyond",
  "date": "2026-10-20",
  "start": 780,
  "end": 850,
  "room": "Ballroom B",
  "track": "Lightning Talks",
  "kind": "session",
  "speakers": [
   "Peter Farkas"
  ],
  "company": "Percona",
  "link": "https://2026.allthingsopen.org/sessions/what-makes-open-source-work-licensing-and-beyond"
 },
 {
  "id": "37ad4ef7f0ee",
  "title": "Your Next Power User Won't Learn Your UI",
  "date": "2026-10-20",
  "start": 780,
  "end": 850,
  "room": "Ballroom B",
  "track": "Lightning Talks",
  "kind": "session",
  "speakers": [
   "Alex Thomas"
  ],
  "company": "Applied Visions",
  "link": "https://2026.allthingsopen.org/sessions/your-next-power-user-wont-learn-your-ui"
 },
 {
  "id": "5ea1e2bb030b",
  "title": "FEATURED SESSION: Beyond Open Source",
  "date": "2026-10-20",
  "start": 780,
  "end": 850,
  "room": "Ballroom C",
  "track": "Machine Learning / AI 2",
  "kind": "session",
  "speakers": [
   "Alex Odadede"
  ],
  "company": "Red Hat",
  "link": ""
 },
 {
  "id": "640e265a5158",
  "title": "AI Systems Fail Silently: Building Trust Layers with Open Source for Reliable AI",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Ballroom A",
  "track": "Machine Learning / AI 1",
  "kind": "session",
  "speakers": [],
  "company": "SailPoint",
  "link": ""
 },
 {
  "id": "623efc9c213a",
  "title": "20 Years of OSS Version Control: What Actually Forced Each Change",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Ballroom B",
  "track": "Developer 1",
  "kind": "session",
  "speakers": [
   "Lee Faus"
  ],
  "company": "Atomic Software Co.",
  "link": ""
 },
 {
  "id": "62858b0b20a0",
  "title": "The Architecture of Agentic AI",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Ballroom C",
  "track": "Machine Learning / AI 2",
  "kind": "session",
  "speakers": [
   "Bob Ward"
  ],
  "company": "IBM",
  "link": ""
 },
 {
  "id": "95f0f051508d",
  "title": "From Embeddings to MCP: Building an Open Visual Search Engine Without a Vector Database",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Room 301A",
  "track": "Machine Learning / AI 3",
  "kind": "session",
  "speakers": [
   "Alex Thomas"
  ],
  "company": "Applied Visions",
  "link": ""
 },
 {
  "id": "05e314875587",
  "title": "Becoming a More Effective Open Source Contributor Using AI Tooling",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Room 301B",
  "track": "101",
  "kind": "session",
  "speakers": [
   "Brad Topol"
  ],
  "company": "IBM",
  "link": "https://2026.allthingsopen.org/sessions/becoming-a-more-effective-open-source-contributor-using-ai-tooling"
 },
 {
  "id": "a64d9c36fea3",
  "title": "Beyond Upgrades: Continuous Modernization at Scale",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Room 304",
  "track": "DevOps",
  "kind": "session",
  "speakers": [
   "Dipanjan Haldar",
   "Karthikeyan Chinnaraj"
  ],
  "company": "Fidelity Investments",
  "link": "https://2026.allthingsopen.org/sessions/beyond-upgrades-continuous-modernization-at-scale"
 },
 {
  "id": "e3626fc8c375",
  "title": "Agents, Tools, and MCP, oh my! Next level AI concepts for developers",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Room 305A",
  "track": "Developer 2",
  "kind": "session",
  "speakers": [
   "Jennifer Reif"
  ],
  "company": "Neo4j",
  "link": "https://2026.allthingsopen.org/sessions/agents-tools-and-mcp-oh-my-next-level-ai-concepts-for-developers"
 },
 {
  "id": "7ade92f16fe1",
  "title": "Points, Levels, and Merge Requests: Gamifying the Contributor Experience",
  "date": "2026-10-20",
  "start": 870,
  "end": 900,
  "room": "Room 305B",
  "track": "DevRel",
  "kind": "session",
  "speakers": [
   "Arianna Haradon"
  ],
  "company": "GitLab",
  "link": "https://2026.allthingsopen.org/sessions/points-levels-and-merge-requests-gamifying-the-contributor-experience"
 },
 {
  "id": "35f142a50682",
  "title": "Building Functional Dev Environments for Humans and Agents",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Ballroom A",
  "track": "Machine Learning / AI 1",
  "kind": "session",
  "speakers": [
   "Matyas Danter"
  ],
  "company": "Amazon Web Services",
  "link": "https://2026.allthingsopen.org/sessions/building-functional-dev-environments-for-humans-and-agents"
 },
 {
  "id": "fdddcca55ab4",
  "title": "Building the Same AI Agent with LangGraph, CrewAI, and a Language You Haven't Heard Of",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Ballroom B",
  "track": "Developer 1",
  "kind": "session",
  "speakers": [
   "Jason Mars"
  ],
  "company": "University of Michigan",
  "link": "https://2026.allthingsopen.org/sessions/building-the-same-ai-agent-with-langgraph-crewai-and-a-language-you-havent-heard-of"
 },
 {
  "id": "d27a0fc89f52",
  "title": "How Open is your Realtime AI Stack?",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Room 301A",
  "track": "Machine Learning / AI 3",
  "kind": "session",
  "speakers": [
   "Omar Varrak"
  ],
  "company": "LiveKit",
  "link": "https://2026.allthingsopen.org/sessions/how-open-is-your-realtime-ai-stack"
 },
 {
  "id": "c6ce51573410",
  "title": "API Call to Custom Agent in 30 Minutes",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Room 301B",
  "track": "101",
  "kind": "session",
  "speakers": [
   "Tom Smyk"
  ],
  "company": "Major League Hacking",
  "link": "https://2026.allthingsopen.org/sessions/api-call-to-custom-agent-in-30-minutes"
 },
 {
  "id": "4165853d5d9a",
  "title": "Teaching the Needle: Philosophy Against Immutability",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Room 302A",
  "track": "Linux / Networking / Infrastructure",
  "kind": "session",
  "speakers": [
   "Jonathan Plocher"
  ],
  "company": "Rocky Linux",
  "link": ""
 },
 {
  "id": "9992abc5855c",
  "title": "Three Projects, One Stack: How Foundation Led Collaboration is Reshaping Open Source Observability",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Room 304",
  "track": "DevOps",
  "kind": "session",
  "speakers": [
   "Dotan Horovits"
  ],
  "company": "OpenSearch",
  "link": "https://2026.allthingsopen.org/sessions/three-projects-one-stack-how-foundation-led-collaboration-is-reshaping-open-source-observability"
 },
 {
  "id": "367920fffce4",
  "title": "The Last Mile of AI Assisted Development",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Room 305A",
  "track": "Developer 2",
  "kind": "session",
  "speakers": [
   "Collin Griffin",
   "David Johnson"
  ],
  "company": "Krumware",
  "link": "https://2026.allthingsopen.org/sessions/the-last-mile-of-ai-assisted-development"
 },
 {
  "id": "3a6856368862",
  "title": "When Information Isn't Enough",
  "date": "2026-10-20",
  "start": 915,
  "end": 945,
  "room": "Room 305B",
  "track": "DevRel",
  "kind": "session",
  "speakers": [
   "Jason Torres"
  ],
  "company": "JetBrains",
  "link": "https://2026.allthingsopen.org/sessions/when-information-isnt-enough"
 },
 {
  "id": "bb798d7c5a35",
  "title": "Make What Agents Want",
  "date": "2026-10-20",
  "start": 960,
  "end": 990,
  "room": "Ballroom A",
  "track": "Machine Learning / AI 1",
  "kind": "session",
  "speakers": [
   "Juan Pablo Flores",
   "Ritvi Mishra"
  ],
  "company": "CodeRabbit",
  "link": "https://2026.allthingsopen.org/sessions/make-what-agents-want"
 },
 {
  "id": "33f845aed660",
  "title": "The Machine Church: Your Own AI Coding Model on Your Laptop",
  "date": "2026-10-20",
  "start": 960,
  "end": 990,
  "room": "Ballroom C",
  "track": "Machine Learning / AI 2",
  "kind": "session",
  "speakers": [],
  "company": "The Paper Computer Company",
  "link": ""
 },
 {
  "id": "369f76efd5d5",
  "title": "Beyond Code: Trust Issues: How to Make Your First Open Source Contribution Actually Matter",
  "date": "2026-10-20",
  "start": 960,
  "end": 990,
  "room": "Room 301B",
  "track": "101",
  "kind": "session",
  "speakers": [
   "Nihal Kakul"
  ],
  "company": "Revscale AI",
  "link": ""
 },
 {
  "id": "3fe6b4de5189",
  "title": "From Markup to Markdown",
  "date": "2026-10-20",
  "start": 960,
  "end": 990,
  "room": "Room 302A",
  "track": "Linux / Networking / Infrastructure",
  "kind": "session",
  "speakers": [
   "Jim Hall"
  ],
  "company": "The FreeDOS Project",
  "link": "https://2026.allthingsopen.org/sessions/from-markup-to-markdown"
 },
 {
  "id": "e4b249bb311a",
  "title": "Bring Your Kubernetes Game to the Next Level with These Open Source Tools",
  "date": "2026-10-20",
  "start": 960,
  "end": 990,
  "room": "Room 304",
  "track": "DevOps",
  "kind": "session",
  "speakers": [
   "Frédéric Harper"
  ],
  "company": "TinyMCE",
  "link": "https://2026.allthingsopen.org/sessions/bring-your-kubernetes-game-to-the-next-level-with-these-open-source-tools"
 },
 {
  "id": "6eab858dfc40",
  "title": "Lessons Learned While Moving 2 Million Engineers From AngularJS to Angular",
  "date": "2026-10-20",
  "start": 960,
  "end": 990,
  "room": "Room 305B",
  "track": "DevRel",
  "kind": "session",
  "speakers": [
   "Stephen Fluin"
  ],
  "company": "HeroDevs",
  "link": "https://2026.allthingsopen.org/sessions/lessons-learned-while-moving-2-million-engineers-from-angularjs-to-angular"
 }
];
