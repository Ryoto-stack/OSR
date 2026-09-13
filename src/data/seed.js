/* =========================================================
   seed.js — starter library for an Online Support Rep
   All wording is generic and yours to edit; nothing is
   company-official. Delete what you won't use.
   ========================================================= */

function seedData() {
  const S = (id, name, color, desc) => ({ id, name, color, desc, order: 0 });

  const cats = [
    S('first-touch', 'First touch', '#2f6df6', 'First reply to a new thread: acknowledge, set an expectation, ask for what you need.'),
    S('triage', 'Troubleshooting', '#0f9d8a', 'Diagnostic questions and the step-by-step fixes you send over and over.'),
    S('access', 'Account & access', '#7b5cd6', 'Login, password, permissions, 2FA, lockouts, security checks.'),
    S('billing', 'Billing', '#d98314', 'Invoices, failed payments, refunds, plan changes.'),
    S('handoff', 'Handoffs & escalations', '#c1362f', 'Warm transfers that give the next team everything and lose nothing.'),
    S('incidents', 'Outages & known issues', '#b0457a', 'Incident ack, status updates, all-clear follow-ups.'),
    S('followup', 'Follow-ups', '#2f6df6', 'Chasers, no-reply nudges, "waiting on the other team" updates.'),
    S('closure', 'Resolutions & closures', '#2f8a3f', 'Fix confirmed, recap, close politely, not-a-bug explanations.'),
    S('tough', 'Tough news', '#c1362f', 'Apologies, de-escalation, declines, delays you have to own.'),
    S('policy', 'Policy & scope', '#4a5b6a', 'Privacy requests, what we do not do, SLA wording.')
  ];

  let i = 0;
  const T = (category, title, tags, body, useWhen, fav) => ({
    id: 'tpl_' + (++i).toString().padStart(2, '0'),
    title, category, tags, body: body.trim(), useWhen: useWhen || '',
    favorite: !!fav, usage: 0, pinned: false, order: i,
    fileIds: [], createdAt: nowISO(), updatedAt: nowISO(), lastUsed: null
  });

  const templates = [
    T('first-touch', 'Acknowledge + set expectation', ['ack', 'default'], `
Hi {{first_name}},

Thanks for reaching out — I've got your message and I'm looking into the {{issue}} issue now.

Quick note on timing: I'll come back to you with an update by {{time_frame}}. If you can, it would help to have {{need}} while I dig in.

Best,
{{agent_name}}
`, 'Always-safe opener. Use it the moment you pick up a thread so nobody sits in silence.', true),

    T('first-touch', 'Acknowledge + ask for details', ['ack', 'questions'], `
Hi {{first_name}},

Thanks for flagging this. I want to make sure I look at the right thing, so could you confirm a few details?

1. What were you doing right before the issue appeared?
2. Does it happen every time, or only sometimes?
3. Which {{device_or_browser}} are you on?
4. A screenshot or a short screen recording of the error (if you see one) helps a lot.

Once I have those, I can move quickly on it.

Best,
{{agent_name}}
`, 'When the report is vague ("it does not work") and you need repro steps before you can act.'),

    T('first-touch', 'Reopen / duplicate thread merge', ['housekeeping'], `
Hi {{first_name}},

I found an existing ticket on this — {{old_ticket_id}} — so I've merged your reply into that one and closed this thread to keep everything in one place.

No action needed from you. You'll hear from me in that thread.

Best,
{{agent_name}}
`, 'Same client wrote twice about the same issue, or two clients share one incident ticket.'),

    T('triage', 'Clear browser cache / cookies', ['howto', 'browser'], `
Hi {{first_name}},

This usually clears up once the old saved data is out of the way. Two minutes, then let me know:

1. Open {{browser}} settings, go to Privacy / Security.
2. Choose "Clear browsing data", tick "Cookies and other site data" and "Cached images and files".
3. Set the time range to All time, then clear it.
4. Close the browser fully, reopen it, and sign in again.

If it still misbehaves after that, tell me and we'll look at the next step.

Best,
{{agent_name}}
`, 'Styling glitches, stale data, "I can see the old page", random login loops.', true),

    T('triage', 'Test on another device / network', ['howto', 'network'], `
Hi {{first_name}},

Before we change anything on your side, let's narrow down where the problem sits. Could you try these three?

- A different browser (or a private/incognito window)
- A different device — phone on mobile data instead of Wi-Fi
- Turn off any VPN, ad blocker, or browser extension for one attempt

Then tell me which of those worked. That one answer usually tells me whether this is your network, your device, or something on our side.

Best,
{{agent_name}}
`, 'Splits "our product is broken" from "their environment is blocking us" in one reply.'),

    T('triage', 'Collect logs / diagnostics', ['technical'], `
Hi {{first_name}},

I'd like to look at the logs to see what happened on our side. Two things:

1. Reproduce the issue once and note the exact time (with timezone if you can).
2. Grab the {{log_location}} from the app — Help / Troubleshooting / "Export logs".

Attach the file to this thread, or if it's big, drop it in {{upload_link}} and just tell me the filename. It's deleted after we're done.

Best,
{{agent_name}}
`, 'Anything where you need timestamps to correlate with backend events.'),

    T('triage', 'Send a repro request internally', ['internal'], `
Team,

Handing this over with a clean repro so nobody has to guess:

What the client sees: {{symptom}}
Expected: {{expected}}
Steps: 1) {{step1}} 2) {{step2}} 3) {{step3}}
Environment: {{env}}  |  Account: {{account_id}}  |  Ticket: {{ticket_id}}
Frequency: {{frequency}}  |  Started: {{started_on}}
Logs / evidence: {{attachments}}

Nothing was changed on the account. Happy to run the repro live with whoever picks it up.

Thanks,
{{agent_name}}
`, 'Paste into Slack/Jira/Zendesk internal note when engineering or L2 needs to act.'),

    T('access', 'Password reset steps', ['password'], `
Hi {{first_name}},

Here's how to reset it:

1. Go to {{reset_link}}
2. Enter the email on the account ({{masked_email}})
3. Check your inbox for the code — it expires in 15 minutes
4. Set a new password of at least {{min_len}} characters

If the email doesn't land within a few minutes, check Spam and any "Promotions" style folder, then reply here and I'll trigger it manually from my side.

For your safety I can't set or view a password for you, and I never ask for it in chat or email.

Best,
{{agent_name}}
`, 'The single most common access request. Includes the never-ask-for-credentials line on purpose.', true),

    T('access', 'Password reset email not arriving', ['password', 'email'], `
Hi {{first_name}},

I checked and the reset email was sent to {{masked_email}} at {{sent_time}} and was delivered, so it's being held up on the way in. Common causes:

- Filters or rules moving mail automatically (search for the sender address)
- A corporate spam gateway quarantining it — worth asking your IT team to allowlist {{sender_domain}}
- A full mailbox

The fastest fix on my side is a one-time login code: reply with the last four digits of the number or the {{verification_item}} on the account, and I'll send a code good for 30 minutes.

Best,
{{agent_name}}
`, 'After they have done the reset and claim nothing arrived.'),

    T('access', 'Identity verification before sensitive change', ['security', 'policy'], `
Hi {{first_name}},

I can help with this. Before I make any change to the account, I need to verify it's you — this protects you and your data.

Please confirm two of the following:

- Full name on the account
- Last 4 digits of the payment method on file
- Date the account was created
- The {{verification_item}} we can match on record

Please don't send full card numbers, passwords, or one-time codes — I only ever need the last 4.

Best,
{{agent_name}}
`, 'Required before email change, merge, deletion, refund, or unlock.', true),

    T('access', '2FA locked out', ['2fa', 'security'], `
Hi {{first_name}},

Losing the authenticator app is recoverable, but it takes two steps because this is a security-sensitive change.

1. Verify: reply with {{verification_item}} and the email on the account. (Never send your codes.)
2. Once verified, I'll temporarily disable {{method}} and you'll be asked to enrol a new device on your next login.
3. Save the backup codes shown right after — that's what stops this from happening again.

I can do step 2 within {{time_frame}} of your reply.

Best,
{{agent_name}}
`, 'Client changed phones or lost their authenticator. Follow your own security policy before using.'),

    T('access', 'Account locked after failed logins', ['lockout'], `
Hi {{first_name}},

The account locked itself after several failed sign-in attempts — that's the security feature working, not a fault.

I've unlocked it now. Two asks so it doesn't lock again in the next hour:

- Sign out of any other devices or older browser tabs still holding the old password
- Update the saved password in your browser's password manager (this is the usual culprit)
- Then log in once with the current password

Tell me if you still see the lock message and I'll look at the sign-in logs directly.

Best,
{{agent_name}}
`, 'Post-lockout, after you actually unlocked it.'),

    T('billing', 'Payment failed / invoice overdue', ['invoice'], `
Hi {{first_name}},

A quick heads-up that the {{plan}} payment for invoice {{invoice_id}} didn't go through on {{date}}, so access will be limited on {{cut_off_date}}. This is usually one of three things:

- the card expired or was replaced by the bank
- insufficient funds or a fraud block
- the billing address / postal code no longer matches what the bank has

You can update the payment method here: {{billing_link}} — once it's saved, I can retry the charge from my side and confirm for you.

If that payment was already made another way, reply with the reference and I'll match it up.

Best,
{{agent_name}}
`, 'Dunning/failed charge. Friendly, factual, always includes a deadline and a way out.'),

    T('billing', 'Refund request — approving', ['refund'], `
Hi {{first_name}},

Good news — I've approved a refund of {{amount}} for invoice {{invoice_id}}. It goes back to the original payment method ({{masked_card}}), and banks typically take 3-10 working days to show it.

You'll get an automated credit note from {{billing_system}} separately; that's the receipt, nothing more to do.

And because the refund cancels the {{item}}, that access ends today. I'm happy to set you up again whenever you're ready.

Best,
{{agent_name}}
`, 'Refund is within policy and you have already actioned it in the system.'),

    T('billing', 'Refund request — declining politely', ['refund', 'policy'], `
Hi {{first_name}},

I've looked at this carefully. The charge is outside our refund window ({{window}}) and it was for {{delivered}}, which was used on {{dates}} — so I'm not able to reverse it.

What I can do:

- {{alternative_1}}
- {{alternative_2}}

If you were charged in error, or something in the process wasn't clear at the time, tell me what happened and I'll escalate to the billing team for a second look. I'd rather get that from you than leave you with a flat no.

Best,
{{agent_name}}
`, 'Out of policy decline. Give a reason, an alternative, and an escalation route — never just "no".'),

    T('billing', 'Plan change / downgrade explanation', ['plan'], `
Hi {{first_name}},

Here's exactly what switching to {{new_plan}} does, so there are no surprises:

- New price: {{price}} per {{period}}, billed on {{next_bill_date}}
- {{what_you_keep}} keeps working as is
- {{what_you_lose}} is no longer included — you'll keep the data, but you'll need to export it if you want it out
- Any unused credit of {{credit}} is applied to the next invoice automatically

The change takes effect {{effective}}. Reply "go ahead" and I'll action it for you — no forms, no self-serve clicking.

Best,
{{agent_name}}
`, 'Downgrades especially: state what breaks in plain words before they lose it.'),

    T('handoff', 'Warm transfer to a specialist team', ['escalation', 'default'], `
Hi {{first_name}},

I want the right person on this. I'm handing your ticket to {{team}}, who own {{area}} and have deeper access than I do.

I've passed along everything you've already told me — logs, timestamps, what we've tried — so you won't be asked to repeat it. Their standard response time is {{sla}}, and they can be reached in this thread; I'll keep watching it and follow up if you don't hear back by {{follow_up_date}}.

Best,
{{agent_name}}
`, 'Your main handoff email. Sets an expectation and promises you stay on the thread.', true),

    T('handoff', 'Escalate to L2 with a case summary', ['escalation', 'internal'], `
Escalating {{ticket_id}} — {{severity}}.

Client: {{account_name}} ({{account_id}}, {{tier}})
Problem: {{one_line_problem}}
Impact: {{business_impact}}
What I already tried: {{actions_taken}} — none moved it.
Evidence: {{evidence}}
Client ask: {{client_ask}}
Deadline pressure: {{deadline_or_none}}

I've told the client to expect an update by {{promised_time}}. Please keep me in the loop so I can relay it; I'd rather they hear one voice.

{{agent_name}}
`, 'Paste into the internal queue. Includes the promise you already made to the client — that is what L2 most needs.'),

    T('handoff', 'Out of scope → point to the right channel', ['routing'], `
Hi {{first_name}},

I looked into this and it sits outside what my team handles — I don't want to be the bottleneck on it.

The right place for {{topic}} is {{correct_channel}} ({{correct_contact}}). They'll have the tooling and permissions for it, and mentioning {{magic_word}} there will get it triaged correctly.

I'll leave this ticket open for {{days}} in case you need help getting there, and I'll note what we found so you don't have to start from zero with them.

Best,
{{agent_name}}
`  , 'The "not my team" reply, done kindly: name the destination, say what to tell them, keep a safety net.'),

    T('incidents', 'Known outage — acknowledgement', ['incident'], `
Hi {{first_name}},

You're not doing anything wrong — this is on us.

We're seeing a {{symptom}} affecting {{scope}} since {{start_time}}. Our engineers have it as a priority and the working theory is {{cause_or_unknown}}.

There's nothing you need to do, and no need to open a new ticket. I'll email you here the moment it's fixed, or by {{next_update_time}} with an update — whichever comes first.

Live status: {{status_page}}

Best,
{{agent_name}}
`, 'Many tickets from one incident. Reassure, and never promise a fix time you do not own.', true),

    T('incidents', 'Incident resolved — follow-up', ['incident', 'closure'], `
Hi {{first_name}},

Good news: {{symptom}} is fixed as of {{end_time}} ({{duration}} total).

What happened: {{plain_language_cause}}
What we changed so it doesn't repeat: {{fix}}

You don't need to do anything — {{action_needed}}. If you still see the problem, reply here and it comes straight back to me, not to the queue.

Apologies for the disruption.

Best,
{{agent_name}}
`, 'Send this even if they never replied to your first one. It closes the loop and stops reopen tickets.'),

    T('followup', 'Nudge after no reply (1st)', ['no-reply'], `
Hi {{first_name}},

Just floating this back up — I wanted to check whether you got a chance to look at my last note about {{issue}}.

If it's resolved, brilliant, no need to reply in detail. If it's still happening, one line on what you're seeing now is enough for me to pick it up again.

Best,
{{agent_name}}
`, '3-4 business days after your last reply. Short: the easier it is to answer, the more likely they do.'),

    T('followup', 'Closing for inactivity (2nd nudge)', ['no-reply', 'closure'], `
Hi {{first_name}},

I haven't heard back, so I'll close this ticket in {{days}} to keep your queue tidy — that's not me brushing you off, just admin.

If you reply any time in that window, it reopens with me and I'll have the full history. And if it's fixed and all is well, a thumbs up is plenty.

Best,
{{agent_name}}
`, 'Second nudge before auto-close. Always give an easy path back.'),

    T('followup', 'Waiting on another team', ['sla'], `
Hi {{first_name}},

A status note rather than a fix, because I don't want you sitting wondering:

I'm currently {{blocker}} — waiting on {{team}}, who confirmed they're on it. Nothing is needed from you.

My next update to you will be {{next_update_date}} even if there's no progress, and I'll chase them on your behalf before then.

Best,
{{agent_name}}
`, 'Proactive update when YOU are blocked. Prevents the angry "any news?" email.', true),

    T('closure', 'Fix confirmed + wrap-up', ['closure', 'default'], `
Hi {{first_name}},

Glad we got there. To recap what changed:

- Cause: {{cause}}
- Fix: {{fix}}
- Done on: {{date}}

Nothing to do on your side. One last thing: if anything about this comes back within {{window}}, reply here and it lands straight with me — you won't start the queue again.

Thanks for being patient while we worked it out.

Best,
{{agent_name}}
`, 'After a confirmed fix. The recap is what stops reopens and gives you a paper trail.', true),

    T('closure', 'Not a bug — expected behaviour', ['education'], `
Hi {{first_name}},

I've checked this end to end and the behaviour you saw is how {{feature}} is designed to work, so there's nothing broken to fix — I know that's not the answer you were hoping for, so let me be clear about the reasoning:

Why it works this way: {{reason}}
How to get the result you wanted: {{workaround}}

I've also logged your feedback as {{feedback_ref}}, because a better default or a clearer message here would have saved you this ticket. That goes to the product team with your use case attached.

Best,
{{agent_name}}
`, 'The "no fault found" reply. Always hand them a workaround and log feedback.'),

    T('tough', 'Genuine apology + make-good', ['apology'], `
Hi {{first_name}},

You're right to be annoyed, and I'm sorry. {{what_we_should_have_done}} — that's on us, not on you.

Here's what I've done about it:
- {{fix_1}}
- {{fix_2}}
- {{goodwill}} (applied today)

And what stops a repeat: {{prevention}}.

I'm {{agent_name}} and this stays mine until you say you're happy with it. If you'd like to escalate or have it reviewed by my manager, just say so — that's a fair ask and I'll arrange it myself.

Best,
{{agent_name}}
`, 'Real service failure. Own it plainly, no "sorry for any inconvenience" filler, and offer escalation unprompted.'),

    T('tough', 'De-escalate an angry client', ['apology', 'de-escalation'], `
Hi {{first_name}},

I've read the whole thread, and I get why you're frustrated. You've been asked to explain this more than once and it's still not fixed. That's not acceptable.

Let me change how this is handled:

1. I'm taking ownership of {{ticket_id}} today — you won't have to re-explain it to another person.
2. I'll investigate {{specific_item}} properly rather than re-sending the standard steps.
3. You'll get a real update from me by {{time}}, and it will say what changed, not that we're "still looking into it".

If it would help to talk it through, reply with a couple of times that suit and I'll call you.

Best,
{{agent_name}}
`, 'Hot tone, threats to churn or post publicly. Name the specific failure, promise a time, offer a call.'),

    T('policy', 'Data / privacy request', ['privacy'], `
Hi {{first_name}},

Thanks for sending this — it's a fair request and we take it seriously.

To action it I need: the {{verification_item}} to confirm the account owner, and which you'd like: a copy of your data, correction of specific fields, or deletion.

What happens next:
- I verify the request and log it: {{days_1}} working days
- We prepare the export or apply the change: up to {{days_2}} working days
- You get a written confirmation once it's done

Deletion has consequences I have to spell out: {{deletion_impact}}. I'll follow your privacy policy on anything we're legally required to retain.

Best,
{{agent_name}}
`, 'GDPR/CCPA style requests. Never action before verification. Watch your own deadline clock.'),

    T('policy', 'Unsupported request / can\'t do it', ['scope'], `
Hi {{first_name}},

I asked around before answering so I could give you a definite one: we're not able to {{request}}.

Why: {{reason}} — {{feature}} simply doesn't support it today, and doing it manually would leave your account in an inconsistent state, which is worse for you than a clear no.

What I can do instead:
- {{alt_1}}
- {{alt_2}}

If your underlying goal is {{real_goal}}, tell me and I'll check whether a different route gets you there — sometimes the workaround is in another product area entirely.

Best,
{{agent_name}}
`, "'Can't you just…' requests. Explain the why, offer the alternative, ask for the actual goal.'"),

    T('policy', 'SLA / timeline expectation set', ['sla'], `
Hi {{first_name}},

Setting expectations clearly so you can plan around it:

What we'll do: {{committed_action}}
When: by {{committed_date}}
What we can't promise: {{out_of_promise}}
What would change the date: {{risk}}

You'll hear from me on {{cadence}} whether or not there's progress — no chasing required.

Best,
{{agent_name}}
`, 'Useful for anything multi-day. A written, bounded promise beats a vague "soon".'),

    T('first-touch', 'Greeting with no answer yet (hold)', ['ack'], `
Hi {{first_name}},

Thanks for your note — I'm on it.

I don't have an answer in this email yet; what I've done so far is {{step_done}}, and I'm now checking {{checking}}.

Back to you by {{time_frame}}. If anything changes on your side in the meantime (it starts working, gets worse, or you see an error message), reply here so I see it before I dig in.

Best,
{{agent_name}}
`, 'Honest holding reply when you need more than a few minutes but should not stay silent.')
  ];

  const phrases = [
    { text: 'Thanks for your patience while we looked into this.', note: 'opening' },
    { text: "I can see exactly why that's frustrating.", note: 'empathy' },
    { text: "Let me take that off your hands and check it for you.", note: 'ownership' },
    { text: 'You won\'t need to repeat any of this to the next person.', note: 'handoff' },
    { text: 'There\'s nothing you need to do right now.', note: 'reassure' },
    { text: 'If anything here is unclear, ask me and I\'ll re-explain it.', note: 'clarity' },
    { text: "I'd rather give you a firm no than a vague maybe.", note: 'boundary' },
    { text: 'I\'ll follow up on {{next_update_date}} even if there\'s no change.', note: 'sla' },
    { text: 'Reply here and it comes straight back to me, not to the queue.', note: 'closure' },
    { text: 'That\'s on us, not on you.', note: 'accountability' },
    { text: 'For your security I can\'t accept passwords or one-time codes by email.', note: 'security' },
    { text: 'Just to confirm I have this right before I make any change: {{restatement}}?', note: 'verify' },
    { text: 'Apologies — you shouldn\'t have had to contact us twice about this.', note: 'apology' },
    { text: 'Here\'s what I did, and what it changes for you:', note: 'structure' }
  ].map((p, n) => ({
    id: 'ph_' + (n + 1), text: p.text, note: p.note, tags: [p.note],
    usage: 0, favorite: false, createdAt: nowISO(), updatedAt: nowISO()
  }));

  const SUBJECTS = {
    'Acknowledge + set expectation': 'Re: {{ticket_id}} — looking into it now',
    'Acknowledge + ask for details': 'Re: {{ticket_id}} — a couple of things to check first',
    'Reopen / duplicate thread merge': 'Re: {{ticket_id}} — merged into your existing ticket',
    'Greeting with no answer yet (hold)': 'Re: {{ticket_id}} — update coming {{time_frame}}',
    'Clear browser cache / cookies': 'Re: {{ticket_id}} — two minutes to try',
    'Test on another device / network': 'Re: {{ticket_id}} — three quick checks to narrow it down',
    'Collect logs / diagnostics': 'Re: {{ticket_id}} — can you grab the logs for me?',
    'Send a repro request internally': 'Repro for {{ticket_id}} — {{symptom}}',
    'Password reset steps': 'Re: {{ticket_id}} — resetting your password',
    'Password reset email not arriving': 'Re: {{ticket_id}} — the reset email is being blocked',
    'Identity verification before sensitive change': 'Re: {{ticket_id}} — one security check before I change anything',
    '2FA locked out': 'Re: {{ticket_id}} — getting you back in without risking the account',
    'Account locked after failed logins': 'Re: {{ticket_id}} — account unlocked, one thing to fix',
    'Payment failed / invoice overdue': 'Action needed: invoice {{invoice_id}} payment failed',
    'Refund request — approving': 'Refund confirmed — invoice {{invoice_id}}',
    'Refund request — declining politely': 'Re: {{invoice_id}} — what I could and could not do',
    'Plan change / downgrade explanation': 'Re: switching to {{new_plan}} — what changes',
    'Warm transfer to a specialist team': 'Re: {{ticket_id}} — passed to {{team}} (I am still on it)',
    'Escalate to L2 with a case summary': 'ESC {{severity}}: {{ticket_id}} — {{one_line_problem}}',
    'Out of scope → point to the right channel': 'Re: {{ticket_id}} — who actually handles {{topic}}',
    'Known outage — acknowledgement': 'Known issue: {{symptom}} (we are on it)',
    'Incident resolved — follow-up': 'Resolved: {{symptom}}',
    'Nudge after no reply (1st)': 'Re: {{ticket_id}} — still needing you?',
    'Closing for inactivity (2nd nudge)': 'Closing {{ticket_id}} in {{days}} days unless you need more',
    'Waiting on another team': 'Re: {{ticket_id}} — status while I wait on {{team}}',
    'Fix confirmed + wrap-up': 'Re: {{ticket_id}} — fixed, here is the recap',
    'Not a bug — expected behaviour': 'Re: {{ticket_id}} — why {{feature}} works this way',
    'Genuine apology + make-good': 'Re: {{ticket_id}} — sorry, and what I have done about it',
    'De-escalate an angry client': 'Re: {{ticket_id}} — I am taking this over personally',
    'Data / privacy request': 'Your data request — what happens next',
    'Unsupported request / can\'t do it': 'Re: {{ticket_id}} — honest answer on {{request}}',
    'SLA / timeline expectation set': 'Re: {{ticket_id}} — what to expect and when'
  };
  templates.forEach((t) => { t.subject = SUBJECTS[t.title] || ''; });

  cats.forEach((c, n) => { c.order = n; });
  return { cats, templates, phrases };
}
