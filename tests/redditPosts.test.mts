import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPostUrl, cleanPostTitle, hasUsableText, isRedditPostUrl, looksLikeSeller, subredditOf } from "../lib/domain/leads/intent/redditPosts.ts";
import { qualifyLead } from "../lib/domain/leads/qualify.ts";

const POST = "https://www.reddit.com/r/smallbusiness/comments/1xr59oi/need_a_web_designer_for_my_clinic/";

test("only a link to one Reddit post counts, not a subreddit, search, feed or look-alike host", () => {
  assert.equal(isRedditPostUrl(POST), true);
  assert.equal(isRedditPostUrl("https://old.reddit.com/r/smallbusiness/comments/1xr59oi/"), true);
  assert.equal(isRedditPostUrl("https://www.reddit.com/r/PPC/new?after=abc&sort=new"), false);
  assert.equal(isRedditPostUrl("https://www.reddit.com/r/smallbusiness/"), false);
  assert.equal(isRedditPostUrl("https://www.reddit.com/search?q=clinic"), false);
  assert.equal(isRedditPostUrl("https://reddit.com.evil.test/r/x/comments/abcde/"), false);
  assert.equal(isRedditPostUrl("javascript:alert(1)"), false);
  assert.equal(isRedditPostUrl(null), false);
});

test("the subreddit and one canonical address per post come from any host or slug", () => {
  assert.equal(subredditOf(POST), "smallbusiness");
  assert.equal(canonicalPostUrl(POST), "https://www.reddit.com/r/smallbusiness/comments/1xr59oi/");
  assert.equal(canonicalPostUrl("https://old.reddit.com/r/smallbusiness/comments/1xr59oi/another_slug?utm=x"), "https://www.reddit.com/r/smallbusiness/comments/1xr59oi/");
  assert.equal(canonicalPostUrl("https://www.reddit.com/r/smallbusiness/"), null);
});

test("search-result titles lose their subreddit suffix", () => {
  assert.equal(cleanPostTitle("Looking for a trustworthy web design company : r/Naples_FL"), "Looking for a trustworthy web design company");
  assert.equal(cleanPostTitle("Need a bookkeeper - Reddit"), "Need a bookkeeper");
  assert.equal(cleanPostTitle("  Plain   title "), "Plain title");
});

test("sellers, job seekers and 'how do I find clients' posts are dropped; real asks are kept (titles from real searches)", () => {
  const sellers = [
    "[FOR HIRE] WordPress Developer", "Anyone need a custom website? (Free)", "How did you land your first clients?", "I built my restaurant's ops platform",
    "Started a Small Software Development Business", "Looking for sales partners in India", "I’m a Freelance Web Developer Helping Small Businesses Build Modern, Affordable Websites",
    "Get 100 Web Design Clients Without Relying on Referrals", "Finding Web Design Clients Shouldn't Take This Much Time", "Affordable Website Design & Development for Small Businesses ($400–$900)",
    "Looking for Remote Bookkeeping / Accounting Opportunities", "Looking for Freelance E-Commerce Bookkeeping Clients – CPA", "Looking for an Accounting Job to Support My Studies",
    "Cold emailing 200+ firms and businesses in October", "How do I find good clients for my Software Agency ?", "Planning to Start a Website Development Business for Cafes",
    "Helping Local Businesses Build Custom Software &", "Strategies on getting CPAs to refer business?",
  ];
  for (const t of sellers) assert.equal(looksLikeSeller(t), true, t);
  const buyers = [
    "Looking for a trustworthy and professional web design company", "Needing a book keeper (and pos accountant) for UK Ecommerce business", "Can anyone recommend a CRM for my small clinic?",
    "Recommend a CRM system for a startup/small insurance agency.", "Solo Looking for Website Redesign (need advice moving from Squarespace)", "Need a website designer", "Which CRM do you recommend",
    "CRM recommendations for a small Travel Agency?", "Which accounting firm will you recommend for a Small Business?", "Need help with selecting a marketing company (as a practice owner)", "Looking for a Web Designer!",
  ];
  for (const t of buyers) assert.equal(looksLikeSeller(t), false, t);
});

test("a post with no real text is not usable", () => {
  assert.equal(hasUsableText("Help", ""), false);
  assert.equal(hasUsableText("Need a web designer for my clinic", ""), true);
});

test("a Reddit post is a reachable channel, so a request with a reason qualifies without any email", () => {
  const q = qualifyLead({ sourceUrl: POST, fitReason: 'Asked on r/smallbusiness: "need a web designer for my clinic".' });
  assert.equal(q.qualified, true);
  assert.deepEqual(q.channels, ["reddit"]);
  assert.equal(qualifyLead({ sourceUrl: "https://www.reddit.com/r/smallbusiness/", fitReason: "x" }).qualified, false);
});
