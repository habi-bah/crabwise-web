# crabwise-web

**The web app for Crabwise, a Rust learning community on Stellar. Watch and download lessons, write Rust in the browser, earn XLM when your code passes, join staked study pods, chat with the community, trade, and ask an AI coach.**

![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Network: Stellar](https://img.shields.io/badge/Network-Stellar-blue) ![Framework: Next.js](https://img.shields.io/badge/Framework-Next.js_14-black) ![Language: TypeScript](https://img.shields.io/badge/Language-TypeScript-blue) ![Styling: Tailwind](https://img.shields.io/badge/Styling-TailwindCSS-38bdf8)

> **Status:** early design and Testnet development. Routes and components below describe the target design. Items marked *planned* are not yet implemented.

**Part of Crabwise:** crabwise-web (this repo) · [crabwise-api](https://github.com/your-org/crabwise-api) · [crabwise-contracts](https://github.com/your-org/crabwise-contracts)

---

## What is Crabwise?

Learning Rust is hard, and most learners quit at the borrow checker. Crabwise connects tutors and learners in one app:

- **Learn:** video courses and live sessions from tutors. Download lessons and study offline.
- **Earn:** write Rust in the browser and earn XLM when your code passes the tutor's tests.
- **Connect:** a social feed, forum, and chat for the Rust community.
- **Trade:** swap assets on Stellar without leaving the app. Funds stay in your own wallet.
- **Ask:** an AI coach that explains compiler errors, gives hints before answers, and summarises the latest crypto news with sources.

### The two unique features

1. **Proof of Compile.** Open a challenge, write your solution, and run the tests. When a sandboxed runner confirms they pass, your XLM reward unlocks. No waiting for manual grading.
2. **Molt Pods.** Join a small cohort, stake a few XLM against weekly goals, and get your stake back plus a share of what dropouts forfeit. Part of the forfeits funds scholarships for learners who cannot afford courses.

---

## Features

### For Learners
- Browse and search courses, preview lessons, and read reviews
- Buy with XLM or USDC. Access is checked on-chain, and your purchase is yours
- **Download lessons** (including a data-saver quality) and watch offline
- In-browser Rust editor with run, test, and error explanations
- Earn XLM from Proof of Compile challenges
- Join Molt Pods and track weekly progress
- Book live sessions with tutors
- Tip posts and tutors with XLM

### For Tutors
- Tutor studio: create courses, upload videos, add lessons and quizzes
- Build challenges with public and hidden tests, and fund the reward budget
- Run Molt Pods as a curator
- Set availability for live sessions
- See earnings, ratings, and learner progress

### For Everyone
- Feed with posts, replies, reposts, likes, follows, and hashtags
- Forum threads by topic, with accepted answers
- Direct messages and course rooms
- Trade page with quotes, price-impact warnings, and a vetted asset list
- AI coach and a crypto news digest with sources
- Light and dark themes, a data-saver mode, and keyboard-friendly navigation

### AI Features
| Feature | Where you see it |
|---|---|
| **Compiler Error Explainer** | Click "Explain" on any error in the editor |
| **Hint Ladder** | Ask for a hint, then a bigger hint, then the answer. Graded challenges can be set to hints only |
| **Course Q&A** | Ask a question inside a lesson and get an answer linked to the exact lesson |
| **Code Review** | Paste or select code for a review of style and safety |
| **Study Plan** | Tell the coach your goal and time, get a weekly plan |
| **Crypto News Digest** | Short summaries with links to the original articles and timestamps |

The coach never gives financial advice and never decides a reward. News summaries are labelled as AI-generated.

---

## Routes

| Route | Description |
|---|---|
| `/` | Landing page and trending courses |
| `/courses` | Browse and search courses |
| `/courses/[id]` | Course details, preview, reviews, and buy button |
| `/learn/[courseId]` | Course player with lessons, downloads, and notes |
| `/challenges` | Proof of Compile challenges |
| `/challenges/[id]` | Editor, run tests, submit, and claim reward |
| `/pods` | Open Molt Pods |
| `/pods/[id]` | Goals, members, standings, and contest form |
| `/tutors` | Find tutors |
| `/tutors/[address]` | Tutor profile, courses, and booking |
| `/sessions` | Your upcoming and past sessions |
| `/feed` | Home timeline |
| `/forum` | Topics and threads |
| `/messages` | Direct messages and course rooms |
| `/trade` | Swap assets from your wallet |
| `/coach` | AI coach |
| `/news` | Crypto news digest |
| `/studio` | Tutor studio (courses, videos, challenges, pods) |
| `/wallet` | Balances, rewards, tips, and transaction history |
| `/downloads` | Offline library |
| `/settings` | Profile, language, data-saver, and notifications |

---

## Project Structure

```
crabwise-web/
├── app/                          # Next.js 14 App Router
│   ├── (marketing)/
│   ├── courses/
│   ├── learn/
│   ├── challenges/
│   ├── pods/
│   ├── tutors/
│   ├── feed/
│   ├── forum/
│   ├── messages/
│   ├── trade/
│   ├── coach/
│   ├── news/
│   ├── studio/
│   └── wallet/
├── components/
│   ├── editor/                   # Monaco editor, run panel, error explainer
│   ├── player/                   # Video player, offline controls
│   ├── pods/                     # Pod cards, standings, contest form
│   ├── feed/                     # Post composer, timeline, tip button
│   ├── trade/                    # Swap form, price-impact warning
│   ├── coach/                    # Chat UI, hint ladder
│   └── ui/                       # Shared primitives (shadcn/ui)
├── lib/
│   ├── stellar/                  # Wallet kit, transaction builders, Horizon helpers
│   ├── contracts/                # Typed clients for crabwise-contracts
│   ├── api/                      # Typed API client for crabwise-api
│   ├── offline/                  # Service worker helpers, IndexedDB, WebCrypto
│   └── i18n/                     # Translations (planned)
├── public/
├── tests/                        # Vitest and Playwright tests
├── .env.example
└── README.md                     <- you are here
```
**Stack:** Next.js 14, TypeScript, TailwindCSS, shadcn/ui, TanStack Query, Zustand, Monaco Editor, Stellar Wallets Kit (Freighter, LOBSTR, xBull), @stellar/stellar-sdk, Service Worker, IndexedDB, Vitest, Playwright

---

## Key Flows

### Buy and download a course
1. Connect a Stellar wallet.
2. Press **Buy**. The app builds a `CourseMarket.purchase` transaction and your wallet signs it.
3. The app checks `has_access` and unlocks the lessons.
4. Press **Download** on a lesson. The app fetches a signed link and a device-bound licence key from the backend, stores the encrypted file in the browser, and decrypts it in memory for offline playback.

### Earn XLM with Proof of Compile
1. Open a challenge and write Rust in the editor.
2. **Run** to test against the public tests. This is a practice run with no reward.
3. **Submit** for a reward-eligible run. The backend sandbox runs the tests and the runner attests the result on-chain.
4. When the result shows **Passed**, press **Claim**. The contract pays the reward to your wallet.

### Join a Molt Pod
1. Open a pod and read the goals, stake, and schedule.
2. **Join** and stake the exact amount before the pod starts.
3. Track weekly progress and live standings. If an attestation looks wrong, **Contest** it inside the contest window.
4. After the pod ends, **Claim** your stake and any share of forfeits.

### Swap on the Trade page
1. Choose assets from the vetted list. The app adds a trustline if needed.
2. See the quote, path, price impact, and slippage setting.
3. Your wallet signs the swap. Crabwise never holds your funds, and trading is risky.

---

## Getting Started

### Prerequisites
- Node.js 20 or later
- pnpm 9 or later
- A Stellar wallet (Freighter, LOBSTR, or xBull) set to Testnet
- A running [crabwise-api](https://github.com/your-org/crabwise-api) (or the hosted Testnet API)

### Install
```bash
git clone https://github.com/your-org/crabwise-web.git
cd crabwise-web
pnpm install
cp .env.example .env.local
```

### Environment variables
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_CONTRACT_TUTOR_REGISTRY=...
NEXT_PUBLIC_CONTRACT_COURSE_MARKET=...
NEXT_PUBLIC_CONTRACT_COMPILE_VAULT=...
NEXT_PUBLIC_CONTRACT_MOLT_POD=...
```

### Run
```bash
pnpm dev          # http://localhost:3000
pnpm build        # Production build
pnpm start
```

### Test
```bash
pnpm test         # Unit tests (Vitest)
pnpm test:e2e     # End-to-end tests (Playwright)
pnpm lint
pnpm typecheck
```

---

## Design Notes

- **Low bandwidth first.** Data-saver mode loads small images, 240p video, and skips autoplay. Pages work on slow connections.
- **Offline.** Downloaded lessons play without a connection. Editor runs need a connection because the sandbox is server-side.
- **Accessible.** Keyboard navigation, visible focus states, captions on videos, and sufficient colour contrast.
- **Safe by default.** Every signing request shows a plain-language summary of what the transaction does before the wallet opens.
- **Clear risk wording.** Trade and pod screens state plainly that funds can be lost and that nothing is financial advice.

---

## Security

- The app never sees private keys. All signing happens in the user's wallet.
- Downloaded videos are stored encrypted, and keys are bound to the device.
- User-generated content is sanitised before it is rendered.
- Learner code is only ever executed in the backend sandbox, never in the browser's main context.
- Responsible disclosure: `security@your-domain.example`

---

## Roadmap

| Phase | Milestone |
|---|---|
| 1 | Wallet login, course browsing, and purchase flow on Testnet |
| 2 | Course player with offline downloads |
| 3 | Editor and Proof of Compile challenges |
| 4 | Feed, forum, and messages |
| 5 | Molt Pods, AI coach, news, and Trade page |
| 6 | Tutor studio, translations, accessibility audit, and Mainnet launch |

---

## Planned Issues for Contributors

| Type | Examples |
|---|---|
| **Bug fixes** | Wallet reconnect on refresh, offline playback on Safari, editor layout on small screens, timeline scroll jumps |
| **New features** | Course filters, pod standings chart, dark mode polish, post composer with code blocks, tip button, notification centre |
| **UI and design** | Empty states, loading skeletons, mobile layouts, crab-themed illustrations and badges |
| **Accessibility** | Keyboard focus order, screen-reader labels, video captions, colour-contrast fixes |
| **Translations** | Add the interface in Hausa, Yoruba, Igbo, French, or Portuguese |
| **Testing** | Playwright flows for buy, run, submit, and claim; unit tests for transaction builders |
| **Documentation** | Component docs, contribution guide, wallet setup guide, design tokens |
| **Good first issues** | Typos, copy edits, icons, README examples, small component fixes |

Every issue has a description, acceptance criteria, and a pointer to the relevant files.

---

## Contributing

```bash
git checkout -b feat/your-feature
pnpm lint && pnpm typecheck && pnpm test
# open a PR against main
```
See `CONTRIBUTING.md`.

## License
MIT, 2026 Crabwise Contributors

---

*Built on Stellar. Learn Rust, wisely.*
