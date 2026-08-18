import { landingStyles } from "./landing-styles";

const LinkedInIcon = () => (
  <svg className="li" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
  </svg>
);

const DownloadIcon = () => (
  <svg className="li" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" /><path d="M7 12l5 5 5-5" /><path d="M4 20h16" />
  </svg>
);

const CheckIcon = () => (
  <svg className="li" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Mark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.6" />
    <circle cx="12" cy="12" r="4.5" stroke="#fff" strokeWidth="1.6" />
    <circle cx="12" cy="12" r="1.6" fill="#fff" />
    <path d="M12 12L19 6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export function Landing({
  signedIn,
  appVersion,
  extensionVersion,
}: {
  signedIn: boolean;
  appVersion: string;
  extensionVersion: string;
}) {
  const primaryHref = signedIn ? "/dashboard" : "/login";
  const primaryLabel = signedIn ? "Open the dashboard" : "Sign in with LinkedIn";
  const secondaryHref = signedIn ? "/summary" : "/login";

  return (
    <div className="rdpage">
      <style dangerouslySetInnerHTML={{ __html: landingStyles }} />

      <header>
        <div className="wrap nav">
          <a className="brand" href="/">
            <span className="dot"><Mark /></span>
            <span>Social<small>by Gershon.AI</small></span>
          </a>
          <nav className="nav-links">
            <a className="link" href="#how">How it works</a>
            <a className="link" href="#features">Features</a>
            <a className="link" href="#extension">Extension</a>
            <a className="link" href="#reporting">Reporting</a>
            <a className="link" href={primaryHref}>{signedIn ? "Dashboard" : "Sign in"}</a>
            <a className="btn btn-primary" href={primaryHref}>
              <LinkedInIcon />
              {signedIn ? "Open dashboard" : "Get started"}
            </a>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="rings"><span /><span /><span /><span /><div className="sweep" /></div>
        <div className="wrap">
          <span className="kicker">◆ Social campaign compliance · LinkedIn &amp; X</span>
          <h1>Proof that every campaign<br /><span className="g">is actually being published</span> — daily.</h1>
          <p className="sub">
            Social watches every company you run campaigns for, collects what they actually posted on LinkedIn and X,
            and turns it into a compliance picture you can defend: who is on cadence, who went quiet, and exactly what
            shipped. Collection runs in <em>your</em> browser through a Chrome extension. No password sharing.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href={primaryHref}>
              <LinkedInIcon />
              {primaryLabel}
            </a>
            <a className="btn btn-lite" href="#extension">
              <DownloadIcon />
              Get the Chrome extension
            </a>
          </div>
          <div className="trust">
            Runs every day · LinkedIn + X in one view · your data never leaves your account ·{" "}
            <a href={secondaryHref} style={{ color: "#bcd0ff", fontWeight: 600, textDecoration: "underline" }}>
              {signedIn ? "Jump to the summary →" : "Already have an account? Sign in →"}
            </a>
          </div>

          <div className="mock">
            <div className="bar"><i /><i /><i /><span className="u">social.gershoncrm.com/dashboard</span></div>
            <div className="flow">
              <div className="stage">
                <h4>1 · Companies</h4>
                <div className="big">Who you track</div>
                <div className="lbl">clients and campaign accounts, synced from the CRM</div>
                <ul><li>Pulled from Streak</li><li>Client / Campaign / Recycled</li><li>LinkedIn + X handles</li></ul>
              </div>
              <div className="arrow">→</div>
              <div className="stage">
                <h4>2 · Collection</h4>
                <div className="big">What they posted</div>
                <div className="lbl">gathered daily in your own browser session</div>
                <ul><li>Chrome extension collector</li><li>Posts, dates, engagement</li><li>Stall alerts if it dries up</li></ul>
              </div>
              <div className="arrow">→</div>
              <div className="stage">
                <h4>3 · Proof</h4>
                <div className="big">Compliance</div>
                <div className="lbl">graded, charted, and ready to send</div>
                <ul><li>Green / amber / red status</li><li>Follower &amp; network trends</li><li>Monthly client report link</li></ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="stats">
          <div className="stat"><b>LinkedIn + X</b><span>both networks, one timeline</span></div>
          <div className="stat"><b>Daily</b><span>collection and digest email</span></div>
          <div className="stat"><b>Per company</b><span>no aggregate hand-waving</span></div>
          <div className="stat"><b>Shareable report</b><span>a permanent link per client</span></div>
        </div>
      </div>

      <section className="pad" id="features">
        <div className="wrap">
          <div className="eyebrow">What you get</div>
          <h2 className="sec">Campaigns are only worth what was actually published. Social measures that.</h2>
          <p className="lead">
            Reporting from a scheduler tells you what was <em>queued</em>. Social reads the live profiles and records
            what really went out — so cadence, gaps and results are facts, not promises.
          </p>
          <div className="grid3">
            <div className="card"><div className="ic">🏢</div><h3>Every company in one place</h3><p>Companies sync straight from Streak and stay categorised — Client, Campaign or Recycled — with their LinkedIn page and X handle attached.</p></div>
            <div className="card"><div className="ic">🧩</div><h3>The extension does the collecting</h3><p>A Chrome extension collects posts in your own logged-in session, on a daily schedule. Nothing is scraped from a server, and no credentials are shared.</p></div>
            <div className="card"><div className="ic">🚦</div><h3>Compliance at a glance</h3><p>Each company gets a green / amber / red posting status over the window you choose — last week, last month, this year or all time.</p></div>
            <div className="card"><div className="ic">📡</div><h3>Networks &amp; followers</h3><p>See the split by network and by category, and track follower movement per client — never blended into a meaningless total.</p></div>
            <div className="card"><div className="ic">🧠</div><h3>Content intelligence</h3><p>An AI read of each company&apos;s output: themes, tone, cadence and what is working, generated on demand from the posts already collected.</p></div>
            <div className="card"><div className="ic">📩</div><h3>Daily digest &amp; health alerts</h3><p>A morning email recaps what landed. If collection stalls for 36 hours you get an alert instead of a silent, empty dashboard.</p></div>
          </div>
        </div>
      </section>

      <section className="pad band" id="how">
        <div className="wrap">
          <div className="eyebrow">How it works</div>
          <h2 className="sec">Three steps to a self-running compliance record.</h2>
          <div className="steps">
            <div className="step"><div className="n">1</div><h3>Sign in &amp; sync your companies</h3><p>Sign in with LinkedIn, pull your current clients from Streak, and confirm each company&apos;s LinkedIn page and X handle.</p></div>
            <div className="step"><div className="n">2</div><h3>Install the extension</h3><p>Download the collector, load it once, and pin it. From then on it gathers posts in your browser every day, on its own.</p></div>
            <div className="step"><div className="n">3</div><h3>Read the proof — and send it</h3><p>Watch the dashboard for anyone slipping, and send each client their monthly report from a permanent link that always shows current numbers.</p></div>
          </div>
        </div>
      </section>

      <section className="pad" id="extension">
        <div className="wrap">
          <div className="eyebrow">The collector</div>
          <h2 className="sec">Get the GershonAI Chrome extension.</h2>
          <p className="lead">
            Social collects inside <em>your</em> browser, using <em>your</em> LinkedIn and X sessions — so there is no
            password sharing and nothing to configure on a server. The extension is the engine; the dashboard is the cockpit.
          </p>

          <div className="extbox">
            <div className="extbox-main">
              <div className="extbox-head">
                <span className="extbox-ic">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 2v6" /><path d="M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v5" />
                  </svg>
                </span>
                <div>
                  <h3>GershonAI — Social Collector</h3>
                  <div className="extbox-meta">Version <b>{extensionVersion}</b> · ~42 KB · Chrome &amp; Edge (Chromium)</div>
                </div>
              </div>
              <a className="btn btn-primary extbox-dl" href="/gershonai-extension.zip" download>
                <DownloadIcon />
                Download the extension
              </a>
              <p className="extbox-note">
                New here? <a href="/login">Sign in first</a> — the extension files everything it collects under your
                account, so it needs you signed in once.
              </p>
            </div>

            <div className="extbox-steps">
              <div className="extbox-steptitle">Install in about a minute</div>
              <ol>
                <li>Download the zip above and unzip it.</li>
                <li>Open <code>chrome://extensions</code>.</li>
                <li>Turn on <b>Developer mode</b> (top-right).</li>
                <li>Click <b>Load unpacked</b> and pick the unzipped folder.</li>
                <li>Open the extension popup and hit <b>Sync now</b>.</li>
              </ol>
              <div className="extbox-foot">
                Already installed? The popup shows your installed version and warns you in red when a newer one is
                available — update by reloading the card on <code>chrome://extensions</code>.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pad band" id="reporting">
        <div className="wrap why">
          <div>
            <div className="eyebrow" style={{ textAlign: "left" }}>Why it works</div>
            <h2>The report writes itself — and the link never expires.</h2>
            <p>
              At the end of every month each campaign company gets a report built from posts already collected: volume,
              networks, cadence and reach. It goes out by email and lives at a permanent link, so a client who opens it
              in March still sees the right numbers.
            </p>
            <ul className="checklist">
              <li><CheckIcon /><span>No password sharing — collection runs in your own browser.</span></li>
              <li><CheckIcon /><span>Every company is auditable post by post, with dates and sources.</span></li>
              <li><CheckIcon /><span>Silence is loud: stalls trigger an alert, not an empty chart.</span></li>
            </ul>
          </div>
          <div className="pricecard">
            <div className="tag">Monthly campaign report</div>
            <div className="amt">5 <small>core datapoints</small></div>
            <ul>
              <li>Posts published this month</li>
              <li>Breakdown by network</li>
              <li>Posting cadence vs. target</li>
              <li>Follower movement</li>
              <li>Engagement on what shipped</li>
            </ul>
            <a className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} href={signedIn ? "/reports" : "/login"}>
              {signedIn ? "Open reports" : "Sign in to view reports"}
            </a>
            <p style={{ textAlign: "center", color: "var(--muted)", fontSize: ".85rem", margin: ".9rem 0 0" }}>
              Sent automatically on the 1st — and available any time from the{" "}
              <a href={signedIn ? "/reports" : "/login"} style={{ color: "var(--brand)", fontWeight: 600 }}>Reports</a> page.
            </p>
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap">
          <h2>Stop taking &ldquo;we posted it&rdquo; on trust.</h2>
          <p>
            Let Social collect what actually went live on LinkedIn and X, every day — and turn it into a compliance
            record and a client report you can send without editing.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href={primaryHref}>
              <LinkedInIcon />
              {primaryLabel}
            </a>
            <a className="btn btn-lite" href="#extension">Get the Chrome extension →</a>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <a className="brand" href="/">
            <span className="dot"><Mark size={16} /></span>
            <span>Social<small>by Gershon.AI</small></span>
          </a>
          <div className="foot-links">
            <a className="link" href="#how">How it works</a>
            <a className="link" href="#features">Features</a>
            <a className="link" href="#extension">Extension</a>
            <a className="link" href="#reporting">Reporting</a>
            <a className="link" href={primaryHref}>{signedIn ? "Dashboard" : "Sign in"}</a>
            <a className="link" href="mailto:support@gershonconsulting.com">Support</a>
          </div>
          <div className="copy">
            © 2026 Gershon.AI · social.gershonCRM — social campaign compliance and reporting for LinkedIn and X. v{appVersion}
          </div>
        </div>
      </footer>
    </div>
  );
}
