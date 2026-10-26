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
            <a className="link" href="#world">Your world</a>
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
          <span className="kicker">◆ Social listening for your business world · LinkedIn &amp; X</span>
          <h1>See who is posting what<br /><span className="g">across your whole business world.</span></h1>
          <p className="sub">
            Social collects every LinkedIn and X post from the companies you are connected with — your clients, your
            partners, your competitors and your own company — every day, in the background. Then it turns them into
            analytics, competitor comparisons and a monthly report you can send.
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
            LinkedIn + X in one place · clients, partners, competitors, internal · runs in your own browser, no password sharing ·{" "}
            <a href={secondaryHref} style={{ color: "#bcd0ff", fontWeight: 600, textDecoration: "underline" }}>
              {signedIn ? "Jump to the summary →" : "Already have an account? Sign in →"}
            </a>
          </div>

          <div className="mock">
            <div className="bar"><i /><i /><i /><span className="u">social.gershon.ai/dashboard</span></div>
            <div className="flow">
              <div className="stage">
                <h4>1 · Connect</h4>
                <div className="big">Your world</div>
                <div className="lbl">the companies you work with and watch</div>
                <ul><li>Clients &amp; partners</li><li>Competitors</li><li>Your own company</li></ul>
              </div>
              <div className="arrow">→</div>
              <div className="stage">
                <h4>2 · Collect</h4>
                <div className="big">LinkedIn + X</div>
                <div className="lbl">every post, every day, automatically</div>
                <ul><li>Runs in your own Chrome</li><li>No password sharing</li><li>Likes, comments, reposts</li></ul>
              </div>
              <div className="arrow">→</div>
              <div className="stage">
                <h4>3 · Understand</h4>
                <div className="big">Intelligence</div>
                <div className="lbl">who said what, and what it means</div>
                <ul><li>Themes &amp; key words</li><li>Followers &amp; competitors</li><li>Monthly report &amp; PDF</li></ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="stats">
          <div className="stat"><b>LinkedIn + X</b><span>collected together, every day</span></div>
          <div className="stat"><b>4 circles</b><span>clients, partners, competitors, internal</span></div>
          <div className="stat"><b>Daily</b><span>collection, digest and alerts</span></div>
          <div className="stat"><b>Monthly PDF</b><span>one-page report per company</span></div>
        </div>
      </div>

      <section className="pad" id="features">
        <div className="wrap">
          <div className="eyebrow">Features</div>
          <h2 className="sec">Everything you need to follow the companies around you.</h2>
          <p className="lead">
            Social does one thing well: it collects what the companies in your world <em>actually</em> published on
            LinkedIn and X, and helps you understand it.
          </p>
          <div className="grid3">
            <div className="card"><div className="ic">🌐</div><h3>Your whole business world</h3><p>Follow your clients, partners, competitors and your own company in one place, each in its own category, with its own timeline of posts.</p></div>
            <div className="card"><div className="ic">✨</div><h3>Intelligence (AI)</h3><p>Read each company&apos;s themes, key words and tone, and spot what changed since last week — always linked back to the posts it came from.</p></div>
            <div className="card"><div className="ic">🧩</div><h3>Automatic daily collection</h3><p>The Chrome extension collects every company&apos;s LinkedIn and X posts in the background, in your own session — no password sharing, nothing to run by hand.</p></div>
            <div className="card"><div className="ic">🚦</div><h3>Posting compliance at a glance</h3><p>Each company gets a green / amber / red status over the window you choose — last week, last month, this month, this year or all time.</p></div>
            <div className="card"><div className="ic">🔭</div><h3>Competitor Watch</h3><p>Compare a company with the competitors you track: who posts, what they post about, their key words and how often they publish.</p></div>
            <div className="card"><div className="ic">📈</div><h3>Networks, followers &amp; analytics</h3><p>Follower growth and engagement per company and per network — never blended into one meaningless total across clients.</p></div>
            <div className="card"><div className="ic">📄</div><h3>Reports, PDF &amp; export</h3><p>Monthly reports by email and permanent share link, a one-page PDF for any company and any month, and a CSV export of posts, followers and competitors.</p></div>
          </div>
        </div>
      </section>

      <section className="pad band" id="world">
        <div className="wrap why">
          <div>
            <div className="eyebrow" style={{ textAlign: "left" }}>Your world</div>
            <h2>Who is posting what — in one feed.</h2>
            <p>
              Add the companies you are connected with and Social reads their LinkedIn pages and X accounts every day.
              You see every post, with its date, its link and how people reacted, grouped the way you work.
            </p>
            <ul className="checklist">
              <li><CheckIcon /><span>Clients — what the companies you serve are saying.</span></li>
              <li><CheckIcon /><span>Partners — what they promote and announce.</span></li>
              <li><CheckIcon /><span>Competitors — their topics, key words and posting rhythm.</span></li>
              <li><CheckIcon /><span>Internal — your own company, measured the same way.</span></li>
            </ul>
          </div>
          <div className="pricecard">
            <div className="tag">Collection only — nothing is posted</div>
            <div className="amt">4 <small>circles of companies</small></div>
            <ul>
              <li><b>Clients</b></li>
              <li><b>Partners</b></li>
              <li><b>Competitors</b></li>
              <li><b>Internal</b></li>
              <li>Collected daily on LinkedIn and X</li>
            </ul>
            <a className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} href={signedIn ? "/clients" : "/login"}>
              {signedIn ? "Open your companies" : "Sign in to start"}
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
            <div className="step"><div className="n">2</div><h3>Install the extension</h3><p>Load the Chrome extension once. It collects what every company posted — in the background, every day.</p></div>
            <div className="step"><div className="n">3</div><h3>Read, compare, report</h3><p>Browse who posted what, compare companies with their competitors, and send each client their monthly report or PDF.</p></div>
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
            The extension collects inside <em>your</em> browser, using <em>your</em> LinkedIn and X
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
          <h2>Know what your whole business world is posting.</h2>
          <p>
            Clients, partners, competitors and your own company — every LinkedIn and X post, collected and explained
            in one place.
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
            <a className="link" href="#world">Your world</a>
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
