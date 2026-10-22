# FAQ

### What is Marlo?

Marlo is an open-source AI CMO for one website at a time. It audits the site, turns the problems into ranked findings with evidence, helps you fix them (including draft GitHub PRs), and checks again afterward. It also tracks Search Console and GA4 traffic and how AI answers mention you (GEO).

### Is it really free to self-host?

Yes. It is licensed under the AGPL-3.0. Self-host has every feature unlocked and no plan limits. You pay only your own providers, such as your LLM, Tavily or Gemini. See [self-hosting.md](self-hosting.md).

### What do the hosted plans cost?

Free, Lite and Pro, per website. Pricing is in **beta**: there is no payment gateway yet, enforcement is off, and the paid plans have a waitlist. The suggested prices are Lite $29/month and Pro $79/month (with 2 months free on annual billing). See [plans-and-pricing.md](plans-and-pricing.md).

### What does "verified" mean?

A check ran again and the issue was gone. That check can be a Re-check you click, the automatic check on hosted (24 hours after a fix), or, for a GEO gap, a later real AI-answer run that names you. You cannot mark a finding verified by hand. A check that could not run is reported as skipped, with the reason, and changes nothing.

### A finding says "No longer detected". Is it fixed?

Not yet. It means a newer audit of the same page did not report the issue. That is a good sign, but not proof, so the finding stays open until a Re-check confirms it.

### What is the difference between "real" and "simulated" GEO?

**Real** answers come from Gemini with Google Search grounding. **Simulated** answers are a stand-in: a Tavily web search summarized by a Groq model. They are labelled, and the two are never mixed or counted together. Marlo does not query ChatGPT, Perplexity or Claude.

### Why does my audit show "Not measured"?

That value needs a source that is not available, such as a PageSpeed key, or the measurement timed out. Marlo shows "Not measured" instead of an estimate.

### Does setup keep running if I close the tab?

No. Setup runs in your browser. Progress is saved for each project, so when you come back it resumes the missing steps. The finish-setup checklist has a Retry button for each step.

### Will Marlo push changes to my site or repository on its own?

No. Fix PRs open as **drafts**, and nothing in the code merges them. CMS publishes and PRs need your approval first. Social posts are drafts that open the network's compose page.

### How many pages does the audit crawl?

The audit checks one page in depth. The site crawl (Links tab) samples up to 8 pages linked from the homepage. A full crawl of hundreds of pages is not built yet.

### Can I use my own model key on hosted?

Yes. Hosted includes platform-managed default models, and you can add your own provider key in Settings.

### Is my data isolated from other users?

On hosted, yes. Row-level security and ownership checks on project routes keep each user's data separate. See [security.md](security.md). Self-host SQLite mode is single-user with no sign-in, so keep it private.

### Where did `okara-alternative` go?

That was this repository's old name. The repository is now `Kumar2421/okara-alternative`, and GitHub redirects the old URL. Marlo is inspired by Okara but is not affiliated with it. Some internal names, such as the SQLite file `data/okara.db`, still use the old name.

### How do I report a security issue?

Use GitHub private vulnerability reporting. See [SECURITY.md](../SECURITY.md).
