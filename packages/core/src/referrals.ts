/**
 * Monetization layer: referral and affiliate programmes surfaced in the setup wizard and the
 * "Run 24/7" guide. Every link shown to a user is labelled as an affiliate link. The owner's
 * codes come from config.referralCodes; without a code the plain URL is used.
 *
 * Evidence for each programme is in research/switchboard-research.md. Terms change; the
 * `evidence` field says what was seen and where, not a guarantee.
 */
export interface ReferralProgram {
  id: string;
  kind: 'inference' | 'hosting' | 'gpu';
  name: string;
  what: string;
  /** Plain URL used when no code is configured. */
  url: string;
  /** URL template with {code}; omitted when the programme only gives a dashboard link. */
  template?: string;
  reward: string;
  evidence: string;
  /** How the user applies for the programme (owner-facing). */
  applyUrl: string;
}

export const REFERRAL_PROGRAMS: ReferralProgram[] = [
  {
    id: 'openrouter', kind: 'inference', name: 'OpenRouter', what: 'One key for 300+ models from every major lab.',
    url: 'https://openrouter.ai/keys', reward: 'No general referral programme found; listed for completeness, no affiliate link.',
    evidence: 'openrouter.ai/startup-program shows partner-referred startup credits only (checked Oct 25, 2026).', applyUrl: 'https://openrouter.ai/startup-program',
  },
  {
    id: 'novita', kind: 'inference', name: 'Novita AI', what: 'Open-weight models (Llama, DeepSeek, Qwen) at low prices.',
    url: 'https://novita.ai/', template: 'https://novita.ai/referral?invited_code={code}',
    reward: 'Two-sided $10 credit referral, capped per user; vouchers expire after 90 days.', evidence: 'novita.ai/referral (Oct 25, 2026).', applyUrl: 'https://novita.ai/referral',
  },
  {
    id: 'aimlapi', kind: 'inference', name: 'AI/ML API', what: 'Aggregator with 300+ models behind one OpenAI-compatible endpoint.',
    url: 'https://aimlapi.com/', template: 'https://aimlapi.com/?via={code}',
    reward: 'Up to 30% recurring affiliate commission per its own page.', evidence: 'aimlapi.com/affiliate (Oct 25, 2026).', applyUrl: 'https://aimlapi.com/affiliate',
  },
  {
    id: 'llmgateway', kind: 'inference', name: 'LLM Gateway', what: 'Unified gateway with usage analytics.',
    url: 'https://llmgateway.io/', template: 'https://llmgateway.io/?ref={code}',
    reward: '1% of referred spend as credits.', evidence: 'llmgateway.io/referrals (Oct 25, 2026).', applyUrl: 'https://llmgateway.io/referrals',
  },
  {
    id: 'digitalocean', kind: 'hosting', name: 'DigitalOcean', what: 'Run Switchboard 24/7 on a $6 to $12 per month droplet.',
    url: 'https://www.digitalocean.com/', template: 'https://m.do.co/c/{code}',
    reward: 'Affiliate page advertises 10% monthly commission for a year on referred spend; terms differ between two official pages.',
    evidence: 'digitalocean.com/affiliates and try.digitalocean.com/affiliates (Oct 25, 2026).', applyUrl: 'https://www.digitalocean.com/affiliates',
  },
  {
    id: 'vultr', kind: 'hosting', name: 'Vultr', what: 'Cheap VPS with many regions.',
    url: 'https://www.vultr.com/', template: 'https://www.vultr.com/?ref={code}',
    reward: 'Third-party listings cite $30 to $100 CPA per activated referral; official terms not retrieved.',
    evidence: 'Aggregator listings only (Oct 25, 2026).', applyUrl: 'https://www.vultr.com/company/referral-program/',
  },
  {
    id: 'hetzner', kind: 'hosting', name: 'Hetzner Cloud', what: 'Lowest-cost EU and US VPS.',
    url: 'https://www.hetzner.com/cloud', template: 'https://hetzner.cloud/?ref={code}',
    reward: 'Account credits for referrer and referee, not cash.', evidence: 'hetzner.com/legal/referrals (Oct 25, 2026).', applyUrl: 'https://www.hetzner.com/legal/referrals',
  },
  {
    id: 'runpod', kind: 'gpu', name: 'RunPod', what: 'GPU pods for hosting your own open models behind an OpenAI-compatible endpoint.',
    url: 'https://www.runpod.io/', template: 'https://runpod.io?ref={code}',
    reward: '10% cash commission for six months via PartnerStack per a 2026 roundup; a credit programme also exists.',
    evidence: 'promptquorum.com roundup (Oct 25, 2026); verify in the RunPod dashboard.', applyUrl: 'https://www.runpod.io/affiliate',
  },
];

export const AFFILIATE_DISCLOSURE = 'Links marked "affiliate" may earn the Switchboard maintainers a commission or credits at no extra cost to you. They never change which option we recommend.';

export interface ReferralLink extends ReferralProgram {
  href: string;
  affiliate: boolean;
}

export function referralLinks(codes: Record<string, string>): ReferralLink[] {
  return REFERRAL_PROGRAMS.map(p => {
    const code = codes[p.id]?.trim();
    const affiliate = Boolean(code && p.template);
    const href = affiliate && p.template ? p.template.replace('{code}', encodeURIComponent(code as string)) : p.url;
    return { ...p, href, affiliate };
  });
}
