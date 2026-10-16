import { SocialMark } from "@/components/brand/social-mark";
import { landingStyles } from "./landing-styles";
import { EXTENSION_ZIP_URL, EXTENSION_ZIP_NAME } from "@/lib/extension-version";

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
            <SocialMark size={30} />
            <span>Social<small>by Gershon.AI</small></span>
          </a>
          <nav className="nav-links">
            <a className="link" href="#features">Features</a>
            <a className="link" href="#publishing">Publishing</a>
            <a className="link" href="#how">How it works</a>
            <a className="link" href="#reporting">Reporting</a>
            <a className="link" href="#extension">Extension</a>
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
          <span className="kicker">◆ Social network management software · LinkedIn &amp; X</span>
          <h1>Manage every social account<br /><span className="g">from first draft to monthly proof.</span></h1>
          <p className="sub">
            Social is one place to plan, approve, publish and measure LinkedIn and X for every company you manage.
            Write the content, get the client&apos;s approval in one batch, schedule it on both networks at once — then
            Social checks what really went live and turns it into analytics and a client-ready monthly report.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href={primaryHref}>
              <LinkedInIcon />
              {primaryLabel}
            </a>
            <a className="btn btn-lite" href="#features">
              See all features →
            </a>
          </div>
          <div className="trust">
            LinkedIn + X in one place · client approval built in · runs in your own browser, no password sharing ·{" "}
            <a href={secondaryHref} style={{ color: "#bcd0ff", fontWeight: 600, textDecoration: "underline" }}>
              {signedIn ? "Jump to the summary →" : "Already have an account? Sign in →"}
            </a>
          </div>

          <div className="mock">
            <div className="bar"><i /><i /><i /><span className="u">social.gershon.ai/publishing</span></div>
            <div className="flow">
              <div className="stage">
                <h4>1 · Plan &amp; approve</h4>
                <div className="big">Content</div>
                <div className="lbl">written, reviewed and validated by the client</div>
                <ul><li>Content library &amp; calendar</li><li>Batch client review</li><li>One week always ready</li></ul>
              </div>
              <div className="arrow">→</div>
              <div className="stage">
                <h4>2 · Publish</h4>
                <div className="big">LinkedIn + X</div>
                <div className="lbl">scheduled once, posted on both networks</div>
                <ul><li>One picture per post</li><li>AI-suggested X version</li><li>Every post verified</li></ul>
              </div>
              <div className="arrow">→</div>
              <div className="stage">
                <h4>3 · Measure &amp; report</h4>
                <div className="big">Proof</div>
                <div className="lbl">collected daily, charted and ready to send</div>
                <ul><li>Green / amber / red status</li><li>Followers &amp; competitors</li><li>Monthly report &amp; PDF</li></ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="stats">
          <div className="stat"><b>LinkedIn + X</b><span>publish and track both, together</span></div>
          <div className="stat"><b>Batch approval</b><span>clients validate content in one pass</span></div>
          <div className="stat"><b>Daily</b><span>collection, digest and alerts</span></div>
          <div className="stat"><b>Monthly PDF</b><span>one-page report per company</span></div>
        </div>
      </div>

      <section className="pad" id="features">
        <div className="wrap">
          <div className="eyebrow">Features</div>
          <h2 className="sec">Everything you need to run social for the companies you manage.</h2>
          <p className="lead">
            Most tools stop at the scheduler. Social covers the whole cycle — content, approval, publishing, monitoring
            and reporting — and measures what was <em>actually</em> published, not just what was queued.
          </p>
          <div className="grid3">
            <div className="card"><div className="ic">🗓️</div><h3>Publishing calendar &amp; scheduler</h3><p>Plan posts on a calendar and publish to LinkedIn and X at the same time. Every post carries its picture, and Social checks that each one really went out.</p></div>
            <div className="card"><div className="ic">✅</div><h3>Client review &amp; approval</h3><p>Send content to the client in one batch, discuss it in comments, and let them approve all at once — with clear Approved, Pending approval and Submitted status.</p></div>
            <div className="card"><div className="ic">📦</div><h3>Always a week ahead</h3><p>A content inventory keeps one week of validated posts ready to publish, warns you when it runs low and reminds clients about posts still waiting for approval.</p></div>
            <div className="card"><div className="ic">✨</div><h3>Intelligence (AI)</h3><p>Suggest the X version of a LinkedIn post within the character limit, read each company&apos;s themes and tone, and turn collected content into ready-to-use post ideas.</p></div>
            <div className="card"><div className="ic">🧩</div><h3>Automatic daily collection</h3><p>The Chrome extension collects every company&apos;s LinkedIn and X posts in the background, in your own session — no password sharing, nothing to run by hand.</p></div>
            <div className="card"><div className="ic">🚦</div><h3>Posting compliance at a glance</h3><p>Each company gets a green / amber / red status over the window you choose — last week, last month, this month, this year or all time.</p></div>
            <div className="card"><div className="ic">🔭</div><h3>Competitor Watch</h3><p>Compare a company with the competitors you track: who posts, what they post about, their key words and how often they publish.</p></div>
            <div className="card"><div className="ic">📈</div><h3>Networks, followers &amp; analytics</h3><p>Follower growth and engagement per company and per network — never blended into one meaningless total across clients.</p></div>
            <div className="card"><div className="ic">📄</div><h3>Reports, PDF &amp; export</h3><p>Monthly reports by email and permanent share link, a one-page PDF for any company and any month, and a CSV export of posts, followers and competitors.</p></div>
          </div>
        </div>
      </section>

      <section className="pad band" id="publishing">
        <div className="wrap why">
          <div>
            <div className="eyebrow" style={{ textAlign: "left" }}>Publishing</div>
            <h2>Write once, approve once, publish on LinkedIn and X.</h2>
            <p>
              Publishing replaces your separate scheduler. Your team creates the content, the client reviews the whole
              batch from a single email link, and approved posts go out on schedule on both networks — from your browser,
              or from the client&apos;s own Chrome extension when they publish under their own account.
            </p>
            <ul className="checklist">
              <li><CheckIcon /><span>One picture per post, on LinkedIn and X.</span></li>
              <li><CheckIcon /><span>✨ One click suggests the X version, always under the X limit.</span></li>
              <li><CheckIcon /><span>Every scheduled post is checked to confirm it really went live.</span></li>
              <li><CheckIcon /><span>Inventory warnings and review reminders keep a week of content ready.</span></li>
            </ul>
          </div>
          <div className="pricecard">
            <div className="tag">Client review — one batch, one email</div>
            <div className="amt">3 <small>clear statuses</small></div>
            <ul>
              <li><b style={{ color: "#16a34a" }}>● Approved</b> — validated, ready to publish</li>
              <li><b style={{ color: "#ea580c" }}>● Pending approval</b> — the client left comments</li>
              <li><b style={{ color: "#dc2626" }}>● Submitted</b> — sent, not reviewed yet</li>
              <li>Approve all in one click</li>
              <li>Comments stay with each post</li>
            </ul>
            <a className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} href={signedIn ? "/publishing" : "/login"}>
              {signedIn ? "Open Publishing" : "Sign in to start publishing"}
            </a>
          </div>
        </div>
      </section>

      <section className="pad" id="how">
        <div className="wrap">
          <div className="eyebrow">How it works</div>
          <h2 className="sec">Up and running in three steps.</h2>
          <div className="steps">
            <div className="step"><div className="n">1</div><h3>Sign up &amp; add your companies</h3><p>Sign in with LinkedIn to get your own workspace, add the companies you manage (or sync them from your CRM) with their LinkedIn page and X handle.</p></div>
            <div className="step"><div className="n">2</div><h3>Install the extension</h3><p>Load the Chrome extension once. It publishes your approved posts and collects what every company posted — in the background, every day.</p></div>
            <div className="step"><div className="n">3</div><h3>Publish, measure, report</h3><p>Run your calendar and client approvals, watch the dashboard for anyone slipping, and send each client their monthly report or PDF.</p></div>
          </div>
        </div>
      </section>

      <section className="pad band" id="reporting">
        <div className="wrap why">
          <div>
            <div className="eyebrow" style={{ textAlign: "left" }}>Reporting</div>
            <h2>The report writes itself — and the link never expires.</h2>
            <p>
              Every month each company gets a one-page report built from the posts Social collected: volume, networks,
              cadence and reach. It goes out by email, lives at a permanent link, and can be downloaded as a PDF for any
              company and any of the last twelve months.
            </p>
            <ul className="checklist">
              <li><CheckIcon /><span>Every company is auditable post by post, with dates and sources.</span></li>
              <li><CheckIcon /><span>Daily digest email, plus an alert when collection stalls.</span></li>
              <li><CheckIcon /><span>Export posts, followers and competitors to CSV at any time.</span></li>
            </ul>
          </div>
          <div className="pricecard">
            <div className="tag">Monthly company report</div>
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
              Sent automatically on the 1st — PDF on every company page.
            </p>
          </div>
        </div>
      </section>

      <section className="pad" id="extension">
        <div className="wrap">
          <div className="eyebrow">The Chrome extension</div>
          <h2 className="sec">Get the Social Chrome extension.</h2>
          <p className="lead">
            The extension publishes and collects inside <em>your</em> browser, using <em>your</em> LinkedIn and X
            sessions — so there is no password sharing and nothing to configure on a server. It works in the background
            and tells you when a newer version is available.
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
                  <h3>Social by Gershon.AI — LinkedIn &amp; X</h3>
                  <div className="extbox-meta">Version <b>{extensionVersion}</b> · Chrome &amp; Edge (Chromium)</div>
                </div>
              </div>
              <a className="btn btn-primary extbox-dl" href={EXTENSION_ZIP_URL} download={EXTENSION_ZIP_NAME}>
                <DownloadIcon />
                Download the extension
              </a>
              <p className="extbox-note">
                New here? <a href="/login">Sign in first</a> — the extension works under your account, so it needs you
                signed in once.
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

      <section className="final">
        <div className="wrap">
          <h2>Run every social account you manage from one place.</h2>
          <p>
            Plan, approve and publish on LinkedIn and X — then let Social prove what went live and send the report
            for you.
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
            <SocialMark size={24} />
            <span>Social<small>by Gershon.AI</small></span>
          </a>
          <div className="foot-links">
            <a className="link" href="#features">Features</a>
            <a className="link" href="#publishing">Publishing</a>
            <a className="link" href="#how">How it works</a>
            <a className="link" href="#reporting">Reporting</a>
            <a className="link" href="#extension">Extension</a>
            <a className="link" href={primaryHref}>{signedIn ? "Dashboard" : "Sign in"}</a>
            <a className="link" href="mailto:support@gershonconsulting.com">Support</a>
          </div>
          <div className="copy">
            © 2026 Gershon.AI · Social — social network management software for LinkedIn and X. v{appVersion}
          </div>
        </div>
      </footer>
    </div>
  );
}
