# ⚡ ProTrackR

> **Discipline isn’t a checklist. It’s an honest scoreboard.**

🌐 **Live Web App:** [https://protrackr-web.vercel.app/](https://protrackr-web.vercel.app/)

---

### What is ProTrackR & Why Did I Build It?

Most habit trackers feel like glorified grocery lists. 

You drink a cup of water? You get a checkmark. You crush a brutal 2-hour workout? You get... the exact same checkmark. And if you binge junk food or scroll Instagram for three hours? Nothing happens. Crickets. 

That felt broken. In the real world:
- High-impact habits move the needle way more than tiny tasks.
- Bad habits set you back—and pretending they don't doesn't build discipline.
- A single missed day shouldn't wipe out months of hard work just because an arbitrary "streak counter" reset to zero.

**ProTrackR is an honest daily protocol engine.** It gives weight to your wins, holds you accountable for your slips, and scores your day with a real, objective number.

---

### How It’s Different (The Gaps Conventional Apps Miss)

| Conventional Habit Apps | ProTrackR |
| :--- | :--- |
| **Flat checkboxes** (drinking water = running 10km) | **Weighted scoring** (assign custom `+pts` to big wins) |
| **Ignores bad habits** (out of sight, out of mind) | **Negative penalties** (`-pts` deduct from your daily score) |
| **Fragile 7-day streaks** that break your spirit | **2026–2050 timeline heatmap** showing your long-term growth |
| **Bloated subscriptions** ($9.99/mo for basic features) | **100% free**, zero paywalls, zero ads, zero spam |
| **Heavy frameworks** that take seconds to load | **Instant load times** with ultra-clean glassmorphic UI |

---

### The Tech Stack & Why I Picked It

We kept the architecture lean, fast, and free of unnecessary bloat. Here’s what powers ProTrackR and the reasoning behind every choice:

#### 1. Frontend: Vanilla HTML5 + Modern CSS + Pure JavaScript
* **Why?** I refused to ship 50MB of React runtime just to check off a daily habit. ProTrackR loads in milliseconds on any mobile phone or desktop browser. Custom CSS delivers a responsive cyberpunk glassmorphic dark theme, and lightweight inline SVG handles responsive charts at a silky 60fps.

#### 2. Local Database: SQLite + WAL Mode (`better-sqlite3`)
* **Why?** Zero cloud database costs and zero network latency. With Write-Ahead Logging (`WAL`) enabled, reads and writes take microseconds directly on disk without table locking or corruption risks.

#### 3. Cloud Database & Sync: Supabase (PostgreSQL with RLS)
* **Why?** For cloud-connected deployments, Supabase offers industrial-strength PostgreSQL. Built-in Row-Level Security (RLS) ensures your protocols and history belong strictly to your user ID—nobody else can see or touch your data.

#### 4. Backend: Node.js & Express 5
* **Why?** Minimal overhead, rock-solid stability, and asynchronous request handling for clean authentication, task CRUD, and real-time event streaming.

#### 5. Auth & Security: 2-Step Email OTP + Google Sign-In + bcrypt
* **Why?** 
  - **Email OTP (`nodemailer`):** Verifies real users upfront so you never deal with bot spam or annoying password reset loops.
  - **Google One-Tap (`google-auth-library`):** Instant, frictionless login with zero password fatigue.
  - **Client & Server Password Guards:** Real-time visual password-strength meter on the front, salted hashes via `bcryptjs` on the back.

#### 6. Deployment: Vercel
* **Why?** Global edge delivery, automated HTTPS, and zero server management headaches.

---

### Quick Start (Run it Locally)

Want to run ProTrackR on your own machine? It takes less than 30 seconds:

```bash
# 1. Clone the repo
git clone https://github.com/your-username/protrackr.git
cd protrackr

# 2. Install dependencies
npm install

# 3. Start the engine
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

To run the automated 10-point test suite:
```bash
npm test
```

---

### Experience It Live

Take control of your daily protocols right now:  
👉 **[https://protrackr-web.vercel.app/](https://protrackr-web.vercel.app/)**
