// Landing-page styles — same design system as radar.gershoncrm.com.
// Scoped under .rdpage so nothing leaks into the Tailwind dashboard UI.
export const landingStyles = `
  .rdpage{
    --bg:#0b1020; --bg2:#0e1530; --ink:#0b1020; --paper:#ffffff;
    --muted:#5b6478; --line:#e6e9f2; --soft:#f5f7fc;
    --brand:#3b5bfd; --brand2:#22d3ee; --brand-ink:#1e34c4;
    --grad:linear-gradient(120deg,#3b5bfd 0%,#6366f1 45%,#22d3ee 100%);
    --ok:#16a34a; --shadow:0 18px 50px rgba(18,28,64,.14);
    --radius:16px;
  }
  .rdpage *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  .rdpage{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:#1a2133;background:var(--paper);line-height:1.55;-webkit-font-smoothing:antialiased}
  .rdpage a{color:inherit;text-decoration:none}
  .rdpage .wrap{max-width:1120px;margin:0 auto;padding:0 24px}
  .rdpage .btn{display:inline-flex;align-items:center;gap:.5rem;font-weight:600;font-size:.98rem;padding:.8rem 1.25rem;border-radius:12px;border:1px solid transparent;cursor:pointer;transition:.18s;white-space:nowrap}
  .rdpage .btn-primary{background:var(--grad);color:#fff;box-shadow:0 8px 22px rgba(59,91,253,.35)}
  .rdpage .btn-primary:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(59,91,253,.45)}
  .rdpage .btn-ghost{background:#fff;border-color:var(--line);color:#1a2133}
  .rdpage .btn-ghost:hover{border-color:#c8cfe6;background:var(--soft)}
  .rdpage .btn-lite{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.22);color:#fff}
  .rdpage .btn-lite:hover{background:rgba(255,255,255,.16)}
  .rdpage .li{width:16px;height:16px;flex:none}

  .rdpage header{position:sticky;top:0;z-index:40;backdrop-filter:saturate(180%) blur(12px);background:rgba(255,255,255,.82);border-bottom:1px solid var(--line)}
  .rdpage .nav{display:flex;align-items:center;justify-content:space-between;height:66px}
  .rdpage .brand{display:flex;align-items:center;gap:.6rem;font-weight:800;font-size:1.12rem;letter-spacing:-.02em}
  .rdpage .brand .dot{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center;box-shadow:0 6px 16px rgba(59,91,253,.4)}
  .rdpage .brand small{display:block;font-weight:600;font-size:.62rem;letter-spacing:.14em;color:var(--muted);text-transform:uppercase;margin-top:-2px}
  .rdpage .nav-links{display:flex;align-items:center;gap:1.4rem}
  .rdpage .nav-links a.link{color:#3a4258;font-weight:500;font-size:.95rem}
  .rdpage .nav-links a.link:hover{color:var(--brand-ink)}
  @media(max-width:720px){.rdpage .nav-links a.link{display:none}}

  .rdpage .hero{position:relative;overflow:hidden;background:radial-gradient(1200px 600px at 78% -10%,#1b2a63 0,transparent 55%),radial-gradient(900px 500px at 10% 0,#12224d 0,transparent 55%),linear-gradient(180deg,#0b1020,#0e1734);color:#eaf0ff}
  .rdpage .hero .wrap{padding:76px 24px 90px;position:relative;z-index:2}
  .rdpage .kicker{display:inline-flex;align-items:center;gap:.5rem;font-size:.8rem;font-weight:600;letter-spacing:.02em;color:#bcd0ff;background:rgba(120,150,255,.12);border:1px solid rgba(140,165,255,.28);padding:.4rem .8rem;border-radius:999px}
  .rdpage .hero h1{font-size:clamp(2.1rem,5vw,3.5rem);line-height:1.05;letter-spacing:-.03em;margin:1.1rem 0 0;font-weight:800;color:#fff}
  .rdpage .hero h1 .g{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
  .rdpage .hero p.sub{font-size:1.14rem;color:#c3ccea;max-width:640px;margin:1.1rem 0 0}
  .rdpage .cta-row{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:1.8rem}
  .rdpage .trust{margin-top:1.4rem;font-size:.86rem;color:#93a0c9}
  .rdpage .rings{position:absolute;right:-160px;top:-120px;width:620px;height:620px;opacity:.5;z-index:1;pointer-events:none}
  .rdpage .rings span{position:absolute;inset:0;margin:auto;border:1px solid rgba(120,160,255,.28);border-radius:50%}
  .rdpage .rings span:nth-child(1){width:620px;height:620px}
  .rdpage .rings span:nth-child(2){width:460px;height:460px}
  .rdpage .rings span:nth-child(3){width:300px;height:300px}
  .rdpage .rings span:nth-child(4){width:150px;height:150px}
  .rdpage .sweep{position:absolute;inset:0;margin:auto;width:620px;height:620px;border-radius:50%;background:conic-gradient(from 0deg,rgba(34,211,238,.28),transparent 30%);animation:rdspin 6s linear infinite}
  @keyframes rdspin{to{transform:rotate(360deg)}}

  .rdpage .mock{margin-top:3.2rem;position:relative;z-index:2;background:#0c1430;border:1px solid rgba(120,150,255,.22);border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden}
  .rdpage .mock .bar{display:flex;align-items:center;gap:.5rem;padding:.7rem 1rem;border-bottom:1px solid rgba(120,150,255,.16);background:#0a1128}
  .rdpage .mock .bar i{width:11px;height:11px;border-radius:50%;background:#334166;display:inline-block}
  .rdpage .mock .bar .u{margin-left:.6rem;font-size:.8rem;color:#8ea0d0}
  .rdpage .flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:0;align-items:stretch;padding:26px 22px}
  @media(max-width:760px){.rdpage .flow{grid-template-columns:1fr;gap:14px}.rdpage .flow .arrow{display:none}}
  .rdpage .stage{background:#0f1a3d;border:1px solid rgba(120,150,255,.18);border-radius:14px;padding:16px 16px 18px}
  .rdpage .stage h4{margin:0;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#7f8fc4}
  .rdpage .stage .big{font-size:1.9rem;font-weight:800;color:#fff;margin:.25rem 0 .1rem}
  .rdpage .stage .lbl{font-size:.86rem;color:#aeb9de}
  .rdpage .stage ul{margin:.7rem 0 0;padding:0;list-style:none;font-size:.82rem;color:#c7d0ee}
  .rdpage .stage ul li{display:flex;align-items:center;gap:.45rem;padding:.16rem 0}
  .rdpage .stage ul li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--brand2)}
  .rdpage .arrow{display:grid;place-items:center;color:#5f6ea3;font-size:1.4rem;padding:0 6px}

  .rdpage .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:-40px;position:relative;z-index:5;box-shadow:var(--shadow)}
  @media(max-width:720px){.rdpage .stats{grid-template-columns:repeat(2,1fr)}}
  .rdpage .stat{background:#fff;padding:22px 18px;text-align:center}
  .rdpage .stat b{display:block;font-size:1.7rem;font-weight:800;letter-spacing:-.02em;color:var(--brand-ink)}
  .rdpage .stat span{font-size:.82rem;color:var(--muted)}

  .rdpage section.pad{padding:76px 0}
  .rdpage .eyebrow{text-align:center;font-size:.78rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--brand)}
  .rdpage h2.sec{text-align:center;font-size:clamp(1.6rem,3.4vw,2.35rem);line-height:1.12;letter-spacing:-.02em;margin:.6rem auto 0;max-width:720px;font-weight:800}
  .rdpage p.lead{text-align:center;color:var(--muted);max-width:640px;margin:1rem auto 0;font-size:1.05rem}

  .rdpage .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:44px}
  @media(max-width:900px){.rdpage .grid3{grid-template-columns:1fr 1fr}}
  @media(max-width:600px){.rdpage .grid3{grid-template-columns:1fr}}
  .rdpage .card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:24px;transition:.18s}
  .rdpage .card:hover{border-color:#c9d2ee;box-shadow:var(--shadow);transform:translateY(-2px)}
  .rdpage .card .ic{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:1.3rem;background:linear-gradient(135deg,#eef2ff,#e0f7ff);border:1px solid #e2e8ff}
  .rdpage .card h3{margin:.9rem 0 .35rem;font-size:1.08rem;letter-spacing:-.01em}
  .rdpage .card p{margin:0;color:var(--muted);font-size:.94rem}

  .rdpage .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:44px}
  @media(max-width:820px){.rdpage .steps{grid-template-columns:1fr}}
  .rdpage .step{position:relative;padding:26px 22px;background:var(--soft);border:1px solid var(--line);border-radius:var(--radius)}
  .rdpage .step .n{width:38px;height:38px;border-radius:11px;background:var(--grad);color:#fff;font-weight:800;display:grid;place-items:center;box-shadow:0 8px 18px rgba(59,91,253,.35)}
  .rdpage .step h3{margin:.8rem 0 .3rem;font-size:1.08rem}
  .rdpage .step p{margin:0;color:var(--muted);font-size:.94rem}

  .rdpage .extbox{display:grid;grid-template-columns:1.05fr .95fr;gap:0;margin-top:44px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}
  @media(max-width:820px){.rdpage .extbox{grid-template-columns:1fr}}
  .rdpage .extbox-main{padding:30px 32px}
  .rdpage .extbox-head{display:flex;align-items:center;gap:14px}
  .rdpage .extbox-ic{width:52px;height:52px;flex:none;border-radius:14px;display:grid;place-items:center;color:var(--brand-ink);background:linear-gradient(135deg,#eef2ff,#e0f7ff);border:1px solid #e2e8ff}
  .rdpage .extbox-head h3{margin:0;font-size:1.12rem;letter-spacing:-.01em}
  .rdpage .extbox-meta{font-size:.85rem;color:var(--muted);margin-top:2px}
  .rdpage .extbox-dl{margin-top:22px}
  .rdpage .extbox-note{margin:.9rem 0 0;font-size:.88rem;color:var(--muted)}
  .rdpage .extbox-note a{color:var(--brand);font-weight:600}
  .rdpage .extbox-steps{padding:30px 32px;background:var(--soft);border-left:1px solid var(--line)}
  @media(max-width:820px){.rdpage .extbox-steps{border-left:none;border-top:1px solid var(--line)}}
  .rdpage .extbox-steptitle{font-size:.76rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brand)}
  .rdpage .extbox-steps ol{margin:.9rem 0 0;padding-left:20px;color:#33405e;font-size:.94rem;line-height:1.85}
  .rdpage .extbox-steps code{background:#e8ecf9;border-radius:5px;padding:1px 6px;font-size:.86em}
  .rdpage .extbox-foot{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-size:.86rem;color:var(--muted)}
  .rdpage .band{background:linear-gradient(180deg,#f7f9ff,#eef2ff);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .rdpage .why{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center}
  @media(max-width:820px){.rdpage .why{grid-template-columns:1fr}}
  .rdpage .why h2{font-size:clamp(1.5rem,3vw,2.1rem);letter-spacing:-.02em;margin:0 0 .8rem;font-weight:800}
  .rdpage .why p{color:#44506e;margin:.6rem 0}
  .rdpage .checklist{list-style:none;margin:1.2rem 0 0;padding:0}
  .rdpage .checklist li{display:flex;gap:.7rem;align-items:flex-start;padding:.45rem 0;font-size:.98rem}
  .rdpage .checklist li svg{flex:none;margin-top:2px}
  .rdpage .pricecard{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:26px}
  .rdpage .pricecard .tag{font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--brand)}
  .rdpage .pricecard .amt{font-size:2.2rem;font-weight:800;letter-spacing:-.02em;margin:.3rem 0}
  .rdpage .pricecard .amt small{font-size:.95rem;font-weight:600;color:var(--muted)}
  .rdpage .pricecard ul{list-style:none;margin:1rem 0;padding:0}
  .rdpage .pricecard ul li{display:flex;gap:.55rem;align-items:center;padding:.34rem 0;font-size:.95rem;color:#33405e}
  .rdpage .pricecard ul li::before{content:"✓";color:var(--ok);font-weight:800}

  .rdpage .final{background:radial-gradient(900px 420px at 50% -20%,#22345f 0,transparent 60%),linear-gradient(180deg,#0b1020,#0e1734);color:#fff;text-align:center}
  .rdpage .final .wrap{padding:80px 24px}
  .rdpage .final h2{font-size:clamp(1.7rem,3.6vw,2.6rem);letter-spacing:-.02em;margin:0;font-weight:800}
  .rdpage .final p{color:#bcc7ea;max-width:560px;margin:1rem auto 0}
  .rdpage .final .cta-row{justify-content:center}

  .rdpage footer{background:#0a0e1c;color:#93a0c9;font-size:.9rem}
  .rdpage footer .wrap{padding:44px 24px;display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between;align-items:center}
  .rdpage footer .brand{color:#fff}
  .rdpage footer .brand small{color:#7482ab}
  .rdpage footer a.link:hover{color:#fff}
  .rdpage .foot-links{display:flex;gap:1.4rem;flex-wrap:wrap}
  .rdpage .copy{width:100%;border-top:1px solid rgba(255,255,255,.08);padding-top:18px;color:#6d7aa4;font-size:.82rem}

  /* Tailwind preflight overrides — restore list markers + baseline typography */
  .rdpage .extbox-steps ol{list-style:decimal}
  .rdpage svg{display:inline-block;vertical-align:middle}
  .rdpage em{font-style:italic}
  .rdpage b{font-weight:700}
`;
