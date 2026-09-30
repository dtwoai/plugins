---
name: dtwo-end-user-guide
description: |
  Produce a short PDF — one page whenever the content fits — that an administrator forwards to their END
  USERS, telling those users what systems an existing Dtwo gateway reaches and how to connect their own AI
  client to it. Tailored to one client (Claude
  Code, Claude Desktop, Cursor, Codex) and to whether the organization has already configured that client
  centrally. This documents a gateway for the people who will use it — it does not build or change one.
  TRIGGER when: user wants something to hand to their users — "a guide I can send the team", "instructions for
  my users", "how do people connect to this", an end-user one-pager, handout, or rollout doc for a gateway.
  SKIP when: the user is creating, configuring or deploying a gateway themselves (use setup for a first
  gateway, dtwo-gateway-config for YAML and MCP server entries); attaching or publishing policies (use
  dtwo-gateway-policy); writing Rego (use dtwo-policy-rego).
---

<!-- © 2026 Dtwo, Inc. -->

# Dtwo End-User Guide

You produce a short PDF an administrator forwards to their colleagues — one page when the content fits, two
when the gateway is large. It tells those colleagues what
systems their AI assistant can now reach through an existing Dtwo gateway, and exactly how to connect their
own client to it.

**The reader is not the administrator.** The person running this skill already has a gateway; the person
holding the output is someone who just needs to use it. Write for a non-technical colleague who has never
heard of MCP. Nothing in the document tells anyone how to create or configure a gateway.

## Companion skills

- **dtwo-gateway-config** — load when the user wants to change what's behind the gateway before documenting it.
- **setup** — the admin-facing counterpart. If the user has no gateway yet, they want that skill, not this one.

## Voice

- Plain and direct. No marketing language, no superlatives, no "unlock", "seamless", "empower".
- **Never call Dtwo a "gateway" in the document.** That word is internal. To end users it is a connection, or just Dtwo.
- Value first, mechanism second. Say what the reader can now do, not how routing works.
- Short sentences. Contractions are fine.

## Step 1 — Pick the gateway

Call `dtwo-list-gateways`. Show the user the gateways by name and ask which one the document is for.

If the Dtwo MCP server is not connected, say so and stop — the document cannot be built without the gateway's
real server list. Never invent connected systems.

## Step 2 — Read the gateway configuration

From the chosen gateway's `configuration` YAML, extract:

- `url` — the MCP endpoint users connect to.
- `mcp_servers[].name` — the connected systems. These drive the whole first section.
- The auth mode, which decides the sign-in wording:
  - `jwks_info.jwt_issuer` is a Dtwo Auth0 tenant (`*-dtwo.us.auth0.com`) → **dtwo** → "sign in with your Dtwo account"
  - any other issuer (Okta, Entra, etc.) → **custom** → "sign in with your organization's identity provider"
  - `authentication.enabled: false` → **none** → "This connection doesn't ask for a sign-in, so it connects straight away."

Derive the MCP server name used in commands and config as the kebab-cased gateway name (`Acme Prod` →
`acme-prod`), falling back to `dtwo-gateway` if unnamed. For Claude Desktop's connector name, prefer something
a person would recognize — `Dtwo` unless the user says otherwise.

**Filter out non-work servers.** Gateways often carry development scaffolding a colleague would not recognize:
echo servers, pass-through-auth dev entries, anything on `host.docker.internal` or `localhost` with a name like
`echo`, `test`, `probe`, `my-*-mcp`. Propose leaving those off the page and confirm, rather than listing them
beside Salesforce and Slack.

## Step 3 — Pick the AI client

Ask which client the instructions are for: **Claude Code**, **Claude Desktop**, **Cursor**, or **Codex**.

The answer names the document — carry it into both the headline and the opening paragraph. The page is always
written for one specific client, and saying so up top is what tells a reader at a glance whether it applies to
them.

**Validate Claude Desktop first.** Its custom connector is added through Anthropic's UI and connects from
outside the user's machine, so the gateway URL must be HTTPS and must not be a loopback host (`localhost`,
`127.0.0.1`, `::1`). If the chosen gateway fails that test, say Claude Desktop can't reach this gateway and
offer Claude Code, Cursor or Codex instead — all three run locally.

## Step 4 — Ask about org-wide configuration

Only two clients can be configured centrally. Ask this question **only** for them:

- **Claude Desktop** — a Team/Enterprise Owner can add the connector under Organization settings → Connectors,
  making it available to everyone. Ask: "Has a Dtwo admin already added this connector for the whole organization?"
- **Claude Code** — `managedMcpServers` in managed settings (MDM profile, registry policy, `managed-settings.json`,
  or server-managed settings) delivers the server to every user pre-configured. Requires Claude Code v2.1.259+.
  Ask the same question.

**Do not ask for Cursor or Codex.** Neither can provision a server centrally:

- Cursor admins get an allowlist and a team marketplace, but adding a server to the allowlist does not push it
  to users' machines — team members still configure it themselves.
- Codex managed configuration treats `mcp_servers` purely as an approved list. There is no provisioning mechanism.

When the answer is yes, the "add it yourself" step is dropped and replaced by a "don't see it?" fallback note.

## Step 5 — Build the document

Write the HTML to a temporary directory, render it, and save the PDF where the user can reach it — the current
working directory by default, or `/mnt/user-data/outputs/` when running in Cowork. Name the file after the
client (`dtwo-claude-desktop-onboarding.pdf`) so someone holding several can tell them apart.

Fetch the Dtwo mark and recolour it for the dark masthead:

```bash
curl -sS -L https://www.dtwo.ai/favicon.svg -o logo.svg
sed 's/fill="#02329F"/fill="#FFFFFF"/g' logo.svg > logo-white.svg
# embed both as data:image/svg+xml;base64,<...> in the HTML
```

Render with headless Chrome. The binary's location varies by machine — probe for it rather than hardcoding:

```bash
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome)" "$(command -v chromium)" "$(command -v chromium-browser)" \
  /opt/pw-browsers/chromium-*/chrome-linux/chrome ; do
  [ -x "$c" ] && CHROME="$c" && break
done
"$CHROME" --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=guide.pdf --virtual-time-budget=3000 "file://$PWD/guide.html"
```

If no Chrome is found, say so and offer the HTML file instead — it prints to PDF correctly from any browser
with background graphics enabled. Do not silently fall back to a different renderer; the layout is tuned for
Chrome's print engine.

Official logos for many connected systems are at `https://docs.dtwo.ai/logos/<name>.svg` (hubspot, apollo,
slack, granola, salesforce, notion, github, linear, stripe, atlassian, ms365, google-drive, gmail,
google-calendar, google-sheets, google-docs, zoom, box, dropbox, airtable, asana, canva, datadog, glean,
monday, servicenow, splunk, docusign, gusto, zapier). Use them if the user wants real marks; otherwise use the
coloured accent bar in the template. Never hand-draw a brand logo.

## Page structure

Letter width, four zones in this order. One page is the target, not a constraint — see **Page length**:

1. **Masthead** (dark navy) — Dtwo mark + wordmark, "Getting started" tag, two-line headline naming the client,
   and a two-sentence opening.
2. **What's in the package** — one card per connected system: coloured accent bar, name, role label,
   one-sentence description.
3. **Setup instructions** — the per-client steps below, plus a Connector URL bar and a caveat note where they apply.
4. **How to use it** — three example asks that chain the gateway's actual servers, each with a small
   "A → B → C" caption.

Footer: Dtwo mark and a live `docs.dtwo.ai` hyperlink. No placeholder contact text.

### Headline

**The headline names the client the document was built for. Never write "your AI assistant" in the title** —
the reader is being handed instructions for one specific tool, and the title should say which.

Line 1 is `Give {CLIENT}`; line 2 carries the accent colour:

| client | headline |
|---|---|
| Claude Desktop | **Give Claude Desktop** / *secure access to your work tools.* |
| Claude Code | **Give Claude Code** / *secure access to your work tools.* |
| Cursor | **Give Cursor** / *secure access to your work tools.* |
| Codex | **Give Codex** / *secure access to your work tools.* |

All four fit the masthead at 29pt on two lines.

### Opening paragraph

**The opening names the client too.** The first sentence says what Dtwo does for that specific product, so a
reader who skims only the masthead knows both what this is and whether it applies to them. Substitute
`{CLIENT}` for the subject — never "your AI assistant":

> Dtwo connects {CLIENT} to the systems you use every day through one secure connection. It works in those
> systems directly, pulling data and making updates, so there's no tab-switching or copy-and-paste.

So, for Claude Desktop:

> Dtwo connects Claude Desktop to the systems you use every day through one secure connection. It works in
> those systems directly, pulling data and making updates, so there's no tab-switching or copy-and-paste.

Naming the product twice in the masthead is deliberate, not an accident to edit out. Keep the second sentence
free of the name — "It works in those systems directly" — so the repetition lands once and then moves on.
"Give your AI assistant secure access to your work tools." with a matching generic opening is the
client-neutral fallback, used only when the user asks for one.

## Per-client setup steps

`{NAME}` = connector/server name. `{URL}` = gateway MCP URL. `{IDP}` = "your Dtwo account" or "your
organization's identity provider".

### Claude Desktop — user adds it (4 steps + URL bar)

1. **Add the connector** — In Claude Desktop, open **Settings → Connectors** and select **Add custom connector**. Name it {NAME} and paste the URL below.
2. **Sign in** — Select **Connect**. Claude opens your browser so you can sign in with {IDP}.
3. **Switch it on** — Start a new chat, open the dropdown in the chat box, choose **Connectors**, and switch {NAME} on. A connector that's added but left off is never called.
4. **Check it worked** — Ask Claude what tools it has through {NAME}. It should list the tools from each of the systems above.

URL bar: `{URL}`. Note: "Your Claude organization owner may need to enable custom connectors for your account.
If Claude Desktop doesn't offer the option, ask an owner to enable it."

### Claude Desktop — org already configured (3 steps, no URL bar)

1. **Connect** — Open **Settings → Connectors**. {NAME} is already listed for your organization. Select **Connect** and sign in with {IDP} when the browser opens.
2. **Switch it on** — Start a new chat, open the dropdown in the chat box, choose **Connectors**, and switch {NAME} on. A connector that's added but left off is never called.
3. **Check it worked** — Ask Claude what tools it has through {NAME}. It should list the tools from each of the systems above.

Note: "Don't see {NAME} in your connector list? Your admin hasn't added it yet — check with them."

### Claude Code — user adds it (3 steps)

1. **Add the connection** — Run this in your terminal: `claude mcp add --transport http {NAME} {URL}` (append ` --client-id <CLIENT_ID>` when the gateway uses a custom identity provider).
2. **Sign in** — Run `/mcp`, select {NAME}, and sign in with {IDP}.
3. **Check it worked** — Run `/mcp` again. {NAME} shows as connected, with its tools listed underneath.

Offer the `.mcp.json` form as an alternative if the user prefers a file:

```json
{
  "mcpServers": {
    "{NAME}": {
      "type": "http",
      "url": "{URL}"
    }
  }
}
```

### Claude Code — org already configured (3 steps)

1. **Open Claude Code** — {NAME} is already set up by your organization. There's nothing to install.
2. **Sign in** — Run `/mcp`, select {NAME}, and sign in with {IDP}.
3. **Check it worked** — Run `/mcp` again. {NAME} shows as connected, with its tools listed underneath.

Note: "Don't see it? Your organization's settings may not have reached this machine yet, or Claude Code may
need updating to v2.1.259 or later."

### Cursor (3 steps)

1. **Add the connection** — Add this to `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` for one project:

```json
{
  "mcpServers": {
    "{NAME}": {
      "url": "{URL}",
      "auth": {
        "CLIENT_ID": "<CLIENT_ID>"
      }
    }
  }
}
```

(drop the `auth` block when the gateway has authentication switched off)

2. **Enable and sign in** — In Cursor, open **Customize → MCPs** and enable the server. Complete the browser sign-in with {IDP}.
3. **Check it worked** — In **Customize → MCPs**, confirm {NAME} is enabled and its tools are listed.

Note: "If your admin has published Dtwo to your team marketplace, install it from there instead of pasting this in."

### Codex (3 steps)

1. **Add the connection** — With the Codex CLI installed, run: `codex mcp add {NAME} --url {URL}` (append ` --oauth-client-id '<CLIENT_ID>'` for a custom identity provider).
2. **Sign in** — Complete the browser sign-in with {IDP}. If sign-in doesn't start, run `codex mcp login {NAME}`.
3. **Check it worked** — Start a new task in Codex and ask which tools it has through {NAME}. It should list the tools from the systems above.

## Config examples in the document

Any command or config block printed on the page is something a reader will retype or paste. Correctness beats
compactness every time.

- **Pretty-print JSON across multiple lines with two-space indentation.** Never collapse a config to one line
  to save vertical space. A reader who mistypes a collapsed brace gets an error they can't diagnose.
- Keep `white-space: pre-wrap` on the code block so the indentation survives and long URLs still wrap.
- Never break a shell command across lines without a trailing `\\`. A wrapped command that looks like two
  commands is worse than one that overflows.
- If an indented block makes the page too tall, that is a page-length decision (below), not a reason to
  reformat the code.

## System descriptions

One line each, written for a colleague. For a server not listed, write a plain one-sentence description of what
that product does and pick a colour close to its brand.

| server | label | role | description | colour |
|---|---|---|---|---|
| hubspot | HubSpot | Your CRM | Look up companies, contacts and deals. Search records, read pipeline reporting, log activity. | `#FF7A59` |
| salesforce | Salesforce | Your CRM | Look up accounts, opportunities and contacts, run reports, and update records. | `#00A1E0` |
| apollo | Apollo.io | Prospecting | Find people and companies that match who you sell to, and enrich the contacts you already have. | `#5C4CE5` |
| slack | Slack | Team context | Search the channels you're already in, catch up on history you missed, post back to the team. | `#4A154B` |
| granola | Granola | Meeting notes | Pull notes and transcripts from your calls, so answers come from what was actually said. | `#E8A33D` |
| ms365 | Microsoft 365 | Mail and files | Reach your mail, calendar, Teams messages, SharePoint files and OneNote. | `#D83B01` |
| drive / google-drive | Google Drive | Files | Search your documents and pull what's in them. | `#1FA463` |
| mail / gmail | Gmail | Your inbox | Search mail, read threads, and draft replies. | `#EA4335` |
| calendar | Google Calendar | Your schedule | See what's on, find free time, and check who's attending. | `#4285F4` |
| sheets | Google Sheets | Spreadsheets | Read and update spreadsheet data. | `#0F9D58` |
| google-docs | Google Docs | Documents | Read and edit documents. | `#4285F4` |
| notion | Notion | Your workspace | Search pages and databases, and write updates back. | `#2F3437` |
| atlassian | Atlassian | Issues and docs | Search Jira issues and Confluence pages, and create or update work items. | `#0052CC` |
| github | GitHub | Your code | Search repositories, read code and issues, and check pull requests. | `#24292F` |
| linear | Linear | Issue tracking | Find issues, check what's in flight, and file new work. | `#5E6AD2` |
| stripe | Stripe | Payments | Look up customers, charges and subscriptions. | `#635BFF` |
| datadog | Datadog | Monitoring | Query metrics, logs and monitors. | `#632CA6` |
| zapier | Zapier | Everything else | Reach thousands of other apps through your existing Zapier connections. | `#FF4F00` |

## Example asks

Write three, each chaining real servers from this gateway, using the reader's language rather than tool names.
Give each a caption naming the systems in order. Two-system examples are fine when the gateway is small. With
only one server, drop the captions and write three single-system asks instead.

Match the examples to what the gateway actually holds: a CRM-and-notes gateway earns call-logging and
follow-up examples; an issues-and-chat gateway earns release-status and bug-filing ones. Generic sales examples
on an engineering gateway are the fastest way to make the page feel untrue.

## HTML template

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>{TITLE}</title>
<style>
  @page { size: Letter; margin: 0; }
  :root{ --ink:#081B2E; --blue:#02329F; --blue2:#344FA0; --coral:#EA5D4C;
    --mist:#EDF0F5; --muted:#5A6B7E; --line:#DCE2EA; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body{ font-family:"Carlito","Liberation Sans","Helvetica Neue",Arial,sans-serif; color:var(--ink); font-size:10pt; line-height:1.45; }
  .page{ width:8.5in; height:11in; position:relative; overflow:hidden; background:#fff; }
  .mast{ background:var(--ink); color:#fff; padding:.4in .68in .34in; position:relative; }
  .rule-top{ position:absolute; top:0; left:0; right:0; height:6px;
    background:linear-gradient(90deg,var(--blue) 0%,var(--blue2) 45%,var(--coral) 100%); }
  .mast-head{ display:flex; justify-content:space-between; align-items:baseline; }
  .lockup{ display:flex; align-items:center; gap:12px; }
  .lockup img{ width:33px; height:35px; display:block; }
  .wordmark{ font-size:13pt; font-weight:700; letter-spacing:.15em; text-transform:uppercase; }
  .wordmark span{ color:var(--coral); }
  .mast-head .tag{ font-size:8pt; letter-spacing:.2em; text-transform:uppercase; color:#8FA6C4; font-weight:700; }
  h1{ margin-top:.16in; font-size:29pt; line-height:1.05; letter-spacing:-.025em; font-weight:700; }
  h1 .accent{ color:#9FC0FF; }
  .mast p{ margin-top:.13in; font-size:10.8pt; line-height:1.5; color:#C3D3E6; max-width:6.6in; }
  .body{ padding:.34in .68in 0; }
  .sec{ margin-top:.32in; } .sec:first-child{ margin-top:0; }
  .kicker{ font-size:8pt; letter-spacing:.2em; text-transform:uppercase; color:var(--blue);
    font-weight:700; display:flex; align-items:center; gap:10px; }
  .kicker::after{ content:""; flex:1; height:1px; background:var(--line); }
  .systems{ display:flex; flex-wrap:wrap; gap:13px; margin-top:.22in; }
  .sys{ flex:1; border:1px solid var(--line); border-radius:11px; padding:15px 14px 16px; }
  .sys .bar{ width:30px; height:4px; border-radius:2px; }
  .sys h3{ font-size:11.5pt; margin-top:11px; letter-spacing:-.01em; }
  .sys .role{ font-size:8.4pt; color:var(--blue); text-transform:uppercase; letter-spacing:.08em; font-weight:700; margin-top:2px; }
  .sys p{ font-size:9pt; color:var(--muted); margin-top:8px; line-height:1.5; }
  .steps{ display:flex; gap:13px; margin-top:.22in; }
  .step{ flex:1; background:var(--mist); border-radius:11px; padding:15px 14px 16px; }
  .step .n{ width:23px; height:23px; border-radius:50%; background:var(--ink); color:#fff;
    display:flex; align-items:center; justify-content:center; font-size:9.5pt; font-weight:700; }
  .step h3{ font-size:11pt; margin-top:10px; }
  .step p{ font-size:9pt; color:var(--muted); margin-top:6px; line-height:1.5; }
  .step p strong{ color:var(--ink); font-weight:700; }
  .step code{ font-family:"Liberation Mono",Menlo,Consolas,monospace; font-size:8.1pt; color:var(--blue);
    background:#fff; border:1px solid #D6E1F7; padding:6px 8px; border-radius:5px;
    display:block; margin-top:8px; overflow-wrap:break-word; line-height:1.5;
    white-space:pre-wrap; }  /* pre-wrap keeps JSON indentation and still wraps long URLs */
  .urlbar{ margin-top:.14in; display:flex; align-items:center; gap:14px;
    border:1px solid #D6E1F7; background:#F4F7FD; border-radius:9px; padding:11px 15px; }
  .urlbar .lbl{ font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); font-weight:700; white-space:nowrap; }
  .urlbar .val{ font-family:"Liberation Mono",Menlo,Consolas,monospace; font-size:10pt; color:var(--blue); font-weight:700; }
  .note{ font-size:8.5pt; color:var(--muted); margin-top:9px; line-height:1.45; }
  .ex{ display:flex; gap:14px; margin-top:.22in; }
  .exq{ flex:1; border-left:3px solid var(--coral); padding:2px 0 2px 12px; }
  .exq p{ font-size:9.4pt; line-height:1.48; }
  .exq .m{ font-size:7.9pt; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); font-weight:700; margin-top:6px; }
  .foot{ position:absolute; left:.68in; right:.68in; bottom:.34in; border-top:1px solid var(--line);
    padding-top:10px; display:flex; font-size:8.5pt; color:#93A3B5; }
  .foot .right{ display:flex; align-items:center; gap:8px; }
  .foot .right img{ width:15px; height:16px; display:block; opacity:.85; }
  .foot a{ color:var(--blue); text-decoration:none; font-weight:700; }
</style></head>
<body><section class="page">
  <div class="mast">
    <div class="rule-top"></div>
    <div class="mast-head">
      <div class="lockup"><img src="{LOGO_WHITE}" alt="Dtwo"><div class="wordmark">Dtwo<span>.</span></div></div>
      <div class="tag">Getting started</div>
    </div>
    <h1>Give {CLIENT}<br><span class="accent">secure access to your work tools.</span></h1>
    <p>{OPENING}</p>
  </div>
  <div class="body">
    <div class="sec">
      <div class="kicker">What's in the package</div>
      <div class="systems">{SYSTEM_CARDS}</div>
    </div>
    <div class="sec">
      <div class="kicker">Setup instructions</div>
      <div class="steps">{STEP_CARDS}</div>
      {URL_BAR}
      {NOTE}
    </div>
    <div class="sec">
      <div class="kicker">How to use it</div>
      <div class="ex">{EXAMPLES}</div>
    </div>
  </div>
  <div class="foot"><span class="right"><img src="{LOGO_BLUE}" alt=""><a href="https://docs.dtwo.ai">docs.dtwo.ai</a></span></div>
</section></body></html>
```

Set the `<title>` to the client-specific headline. If `pikepdf` or `exiftool` is available, set the PDF metadata
title to match; skip it silently if neither is installed.

## Page length

**One page is the target, not a rule.** A gateway with four or five systems fits comfortably. A gateway with
ten does not, and squeezing it in produces a document nobody can read. When the content does not fit, let it
run to a second page.

### Type floors — never go below these to save a page

| element | minimum |
|---|---|
| headline | 24pt |
| opening paragraph | 10pt |
| card description | 8.5pt |
| step body | 8.5pt |
| example ask | 8.5pt |
| code block | 8pt |

Trimming spacing is fine. Going under these sizes is not. If it still doesn't fit, add the page.

### Card grid by server count

| systems | layout | expect |
|---|---|---|
| 1–4 | one row, `flex:1` each | one page |
| 5–8 | wrap to rows of four, `flex:0 0 calc(25% - 10px)` | one page, tight |
| 9+ | rows of four, same as above | two pages |

`.systems` already carries `flex-wrap:wrap` in the template, so wrapping only needs the per-card `flex` basis
above. With four or fewer, leave `flex:1` and they fill the row.

### Going to two pages

The single-page template pins the page to `11in` with `overflow:hidden` and absolutely positions the footer,
so a second page's content is silently **clipped**, not flowed. Switch these before rendering anything longer:

```css
.page{
  width:8.5in;
  min-height:11in;   /* was: height:11in */
  height:auto;
  overflow:visible;  /* was: hidden — this is what clips page 2 */
}
.foot{
  position:static;   /* was: absolute with bottom:.34in */
  margin:.5in .68in .34in;
}
.sys, .step, .exq{ break-inside:avoid; }
.sec{ break-inside:avoid; }
```

Put the break between **What's in the package** and **Setup instructions**, so the masthead and the system
cards carry page one and the steps start clean on page two. Never split a row of cards, a row of steps, or a
single step across the break. Force it with `break-before:page` on the setup section if the natural break
lands badly.

The footer flows to the end of the last page. That is correct — it is a sign-off, not a running footer.

### Always look at the result

Render to PNG and Read every page. Prefer poppler, which shows the PDF exactly as printed:

```bash
pdftoppm -png -r 90 guide.pdf op        # one op-N.png per page
```

If `pdftoppm` is not installed, fall back to the Chrome you already found — don't ask the user to install
anything:

```bash
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size=816,1056 --screenshot=op.png "file://$PWD/guide.html"
```

`816×1056` is one Letter page at 96 dpi. For a two-page document use `--window-size=816,2112`. The screenshot
renders screen layout, not print, so it catches clipping, overflow and footer collisions but does **not** show
where the print page break falls — on a two-page document, also confirm the PDF has two pages
(`grep -ao '/Count [0-9]*' guide.pdf | awk '{print $2}' | sort -n | tail -1` prints the page count) and tell the user the break
position was checked from the CSS rather than the rendered PDF.

Confirm: nothing clipped at a page edge, no card or step orphaned alone at the top of page two, no text
colliding with the footer, and page one not left half empty by a premature break.

If the result is one page with a lot of empty space at the bottom, push `.sec` margin-top, `.body`
padding-top, and card padding up until the content fills it. Starting points for the common shapes:

| cards / steps | `.sec` margin-top | `.body` padding-top | card padding |
|---|---|---|---|
| 4 cards, 4 steps | `.28in` | `.3in` | `14px 13px 15px` |
| 4 cards, 3 steps | `.36in` | `.36in` | `15px 13px 16px` |
| 3 cards, 3 steps | `.42in` | `.4in` | `17px 16px 18px` |

## Before delivering

- Confirm the word "gateway" appears nowhere in the rendered text: `pdftotext guide.pdf - | grep -i gateway`.
  Without `pdftotext`, check the HTML's visible text instead — it's the same content:
  `perl -0pe 's/<style.*?<\/style>//gs; s/<[^>]*>//g' guide.html | grep -i gateway`
- Confirm the headline **and** the opening paragraph both name the chosen client, not "your AI assistant".
- Confirm the URL and every command match the gateway's real values. Nothing invented.
- Confirm no placeholder text survives unless the user asked for one.
- Confirm every config block is indented across multiple lines, not collapsed onto one.
- On a two-page document, confirm nothing is clipped and the break falls where you intended.

Tell the user which gateway, client and configuration the document assumes — the same gateway produces a
different page for each combination, and that line is what stops the wrong one being forwarded.
