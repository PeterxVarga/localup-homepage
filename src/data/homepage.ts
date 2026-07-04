// ============================================================
// LocalUp Homepage Data
// Edit this file to update all page content without touching components
// ============================================================

// --- Site Meta ---
export const siteMeta = {
  title: 'LocalUp — Local Growth Partner for Service Businesses',
  description:
    'LocalUp helps service businesses improve their website, Google presence, reviews, and local visibility so nearby customers find, trust, and contact them.',
  url: 'https://localup.io',
  ogImage: '/og-image.png',
};

// --- Navigation ---
export const navLinks = [
  { label: 'Solutions', href: '#solutions' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Resources', href: '#resources' },
];

// --- Hero Section ---
export const heroContent = {
  eyebrow: 'Local growth partner for service businesses',
  title: 'Get found locally.\nGet chosen more often.',
  description:
    'LocalUp improves your website, reviews, and local visibility\nso nearby customers can easily find and book your services.',
  primaryCta: { label: 'Get your free local audit', href: '#audit' },
  secondaryCta: { label: 'See how it works', href: '#how-it-works' },
  ratingLabel: '4.8 average rating',
};

// --- What LocalUp Improves ---
export const improvesContent = {
  eyebrow: 'What LocalUp Improves',
  title: 'Improve the places customers check before they contact you.',
  description:
    'LocalUp helps service businesses look clearer, more trustworthy, and easier to contact across the moments that influence local customers most.',
  cards: [
    {
      title: 'Website clarity',
      description: 'Make your site clear, credible, and easy to act on.',
      variant: 'dark' as const,
    },
    {
      title: 'Google presence',
      description: 'Show up with accurate, useful information when people search.',
      variant: 'light' as const,
    },
    {
      title: 'Reviews & reputation',
      description: 'Build trust before people decide who to contact.',
      variant: 'light' as const,
    },
    {
      title: 'Enquiry path',
      description: 'Make calls, messages, and bookings easier to take.',
      variant: 'light' as const,
    },
  ],
};

// --- Services Included ---
export const servicesContent = {
  eyebrow: 'SERVICES INCLUDED',
  title: 'The key local growth services, brought together in one package.',
  description:
    'LocalUp bundles every essential local growth service into one connected package so nothing gets missed and you see real results.',
  leftCard: {
    heading: 'No more separate marketing pieces.',
    description:
      'SEO, website fixes, reviews, listings, and tracking — aligned around one goal: more local enquiries.',
    checkItems: ['Search visibility', 'Trust signals', 'Contact paths', 'Clear updates'],
  },
  items: [
    {
      title: 'Google Business Profile improvements',
      description: 'Photos, posts, details',
      icon: '/assets/icons/map-pin.svg',
    },
    {
      title: 'Local SEO foundations',
      description: 'Keywords, categories, service areas',
      icon: '/assets/icons/search.svg',
    },
    {
      title: 'Service page improvements',
      description: 'Content, structure, trust signals',
      icon: '/assets/icons/file-text.svg',
    },
    {
      title: 'Website conversion fixes',
      description: 'CTAs, forms, bookings',
      icon: '/assets/icons/layout.svg',
    },
    {
      title: 'Review request system',
      description: 'Automated requests, follow-ups',
      icon: '/assets/icons/star-small.svg',
    },
    {
      title: 'Listings & business info cleanup',
      description: 'NAP, categories, consistency',
      icon: '/assets/icons/list.svg',
    },
    {
      title: 'Local trust signal improvements',
      description: 'Answers, FAQs, photos, badges',
      icon: '/assets/icons/shield.svg',
    },
    {
      title: 'Clear progress tracking',
      description: 'Monthly updates, real results',
      icon: '/assets/icons/trending-up.svg',
    },
  ],
  bottomCard: {
    heading: 'Not sure what your business needs first?',
    description:
      'Get a free local audit and we\'ll show you the clearest opportunities across your website, Google presence, reviews, and enquiry path.',
    cta: { label: 'Get your free local audit', href: '#audit' },
  },
};

// --- Transparent Client Dashboard ---
export const dashboardContent = {
  eyebrow: 'Transparent Client Dashboard',
  eyebrowIcon: '/assets/icons/eye.svg',
  title: 'Always know how your local presence is progressing.',
  description:
    'From website updates to reviews, leads, and monthly reporting, everything stays visible in one place.',
  screenshot: '/assets/images/dashboard-mockup.png',
  bgDecor: '/assets/images/concentric-circles.svg',
  features: [
    {
      title: 'Know what changed',
      description: 'See updates, wins, and activity as they happen.',
      icon: '/assets/icons/check-circle.svg',
    },
    {
      title: 'Follow visible progress',
      description: 'Track growth across inquiries, visibility, and reviews.',
      icon: '/assets/icons/eye-progress.svg',
    },
    {
      title: 'See what\'s next',
      description: 'Get clear next steps and reports that keep you moving forward.',
      icon: '/assets/icons/arrow-right-black.svg',
    },
  ],
};

// --- Getting Started ---
export const gettingStartedContent = {
  eyebrow: 'Getting Started',
  title: 'Simple setup. Clear progress. Ongoing improvement.',
  description:
    'A simple, proven process to uncover opportunities, set up LocalUp, and drive real local growth—month after month.',
  steps: [
    {
      number: '01',
      title: 'Free audit call',
      description:
        "We'll review your local presence, identify opportunities, and share priorities tailored to your business.",
      badge: '20 min',
      badgeIcon: '/assets/icons/clock-small.svg',
    },
    {
      number: '02',
      title: 'LocalUp setup',
      description:
        'Our team sets everything up, connects your data, and configures your dashboard for success.',
      badge: '2–3 business days after access',
      badgeIcon: '/assets/icons/calendar.svg',
    },
    {
      number: '03',
      title: 'Monthly progress brief',
      description:
        'We monitor, optimize, and deliver clear insights—so your business keeps growing locally.',
      badge: 'Ongoing',
      badgeIcon: '/assets/icons/clock-small.svg',
    },
  ],
  bottomCard: {
    heading: 'Built for results. Backed by local experts.',
    description: 'Transparent process. Clear communication. Measurable impact.',
    badges: ['Local expertise', 'Data-driven insights', 'Continuous optimization'],
  },
};

// --- Pricing ---
export const pricingContent = {
  eyebrow: 'GROWTH PLANS',
  title: 'Choose the right level of local growth support.',
  description:
    'Every plan includes the key services your business needs to get found, earn trust, and turn interest into more calls, messages, and bookings.',
  plans: [
    {
      name: 'Starter Setup',
      description: 'The essentials to get your presence in shape and start getting found.',
      recommended: false,
      theme: 'light' as const,
      icon: '/assets/icons/sprout.svg',
      includesPrefix: 'Includes:',
      items: [
        'Google Business Profile optimization',
        'Website & on-page SEO fixes',
        'Basic review strategy',
        'Local business listings cleanup',
      ],
      cta: { label: 'Starts with a free audit', href: '#audit' },
      footnote: 'Perfect for businesses getting started with local growth.',
    },
    {
      name: 'Managed Growth',
      description: 'Ongoing optimization and content that drives steady, measurable results.',
      recommended: true,
      theme: 'dark' as const,
      icon: '/assets/icons/trending-up.svg',
      includesPrefix: 'Includes everything in Starter, plus:',
      items: [
        'Monthly content & post creation',
        'Review generation & management',
        'Local SEO & category optimization',
        'Monthly performance reporting',
        'Priority email & chat support',
      ],
      cta: { label: 'Custom quote', href: '#audit' },
      footnote: 'Our most popular plan for businesses ready to grow consistently.',
    },
    {
      name: 'Growth Partner',
      description: 'Strategic partnership with hands-on support to accelerate your growth.',
      recommended: false,
      theme: 'light' as const,
      icon: '/assets/icons/crown-gold.svg',
      includesPrefix: 'Includes:',
      items: [
        'Custom local growth strategy',
        'Dedicated success manager',
        'Advanced tracking & insights',
        'Quarterly strategy reviews',
        'Priority implementation support',
      ],
      cta: { label: 'Custom quote', href: '#audit' },
      footnote: 'Built for businesses ready to lead their market.',
    },
  ],
  bottomBar: {
    heading: 'Not sure where to start?',
    description:
      "Begin with a free local audit. We'll review your presence and recommend the best path forward.",
    cta: { label: 'Get your free audit', href: '#audit' },
  },
};

// --- FAQ ---
export const faqContent = {
  eyebrow: 'FAQ',
  title: 'Questions before you start?',
  description:
    'Learn how LocalUp works, what we handle for you, and what happens after your free audit.',
  items: [
    {
      question: 'What happens after the free audit?',
      answer:
        "We'll walk you through our findings, prioritize the highest-impact opportunities, and recommend the best plan for your goals. You're free to move forward, take your time, or just take the insights—we're here to help either way.",
    },
    {
      question: 'Do I need to manage the dashboard myself?',
      answer:
        "No, we manage everything. The dashboard is there to show your real-time performance and where your leads are coming from, keeping things clear and simple.",
    },
    {
      question: 'Is this SEO, website work, or review management?',
      answer:
        "It's all of them. LocalUp bundles website conversion optimization, local SEO, Google Business optimization, and review request automation into one connected package to ensure nothing is missed.",
    },
    {
      question: 'How quickly can setup start?',
      answer:
        "Setup begins immediately after our audit call. Once we have the necessary access to your site and Google profile, our team will have everything configured in 2–3 business days.",
    },
    {
      question: 'Can I start small and scale later?',
      answer:
        "Yes, absolutely. You can start with our Starter Setup to get your local presence in shape, and upgrade to Managed Growth when you're ready for ongoing optimization.",
    },
    {
      question: 'Do I need an existing website or Google Business Profile?',
      answer:
        "Having them helps, but if you don't, our team will build your core local presence from scratch as part of the initial onboarding setup.",
    },
  ],
  sidebar: {
    heading: 'Still unsure? Start with a free audit.',
    description:
      "We'll review your local presence, highlight opportunities, and share clear next steps—no obligation.",
    checkItems: ['No commitment', 'Clear actionable insights', 'Personal recommendations'],
    cta: { label: 'Get your free audit →', href: '#audit' },
  },
};

// --- Final CTA ---
export const finalCtaContent = {
  eyebrow: "Let's get started",
  title: 'A clearer local\ngrowth plan starts here.',
  description:
    "Begin with a free audit and we'll show you the most important\nopportunities for getting found, trusted, and contacted.",
  primaryCta: { label: 'Get your free local audit', href: '#audit-form' },
  secondaryCta: { label: 'Talk it through in 20 min', href: '#schedule' },
  trustBadges: ['No obligation', 'Clear next steps', 'Tailored recommendations'],
};

// --- Footer ---
export const footerContent = {
  description: 'Building visibility and trust for local service businesses. Get found by the customers right in your neighborhood.',
  socials: [
    { name: 'LinkedIn', icon: '/assets/icons/linkedin-white.svg', href: '#linkedin' },
    { name: 'Twitter', icon: '/assets/icons/twitter-white.svg', href: '#twitter' },
    { name: 'Instagram', icon: '/assets/icons/instagram-white.svg', href: '#instagram' },
    { name: 'Facebook', icon: '/assets/icons/facebook-white.svg', href: '#facebook' },
  ],
  columns: [
    {
      label: 'Services',
      links: [
        { label: 'Local SEO', href: '#solutions' },
        { label: 'Website Clarity', href: '#solutions' },
        { label: 'Google Presence', href: '#solutions' },
        { label: 'Review Management', href: '#how-it-works' },
        { label: 'Enquiry Path', href: '#how-it-works' },
      ],
    },
    {
      label: 'Company',
      links: [
        { label: 'About Us', href: '#about' },
        { label: 'Our Method', href: '#method' },
        { label: 'Case Studies', href: '#cases' },
        { label: 'Contact Sales', href: '#audit' },
      ],
    },
    {
      label: 'Resources',
      links: [
        { label: 'Local Growth Blog', href: '#blog' },
        { label: 'Free Audit', href: '#audit' },
        { label: 'SEO Checklist', href: '#checklist' },
        { label: 'Community', href: '#community' },
      ],
    },
    {
      label: 'Legal',
      links: [
        { label: 'Privacy Policy', href: '#privacy' },
        { label: 'Terms of Service', href: '#terms' },
        { label: 'Cookie Policy', href: '#cookie' },
      ],
    },
  ],
  bottom: {
    copyright: `© ${new Date().getFullYear()} LocalUp. All rights reserved.`,
    trustLabel: 'Partnering with 2,500+ local businesses',
    links: [
      { label: 'Sitemap', href: '#sitemap' },
      { label: 'Accessibility', href: '#accessibility' },
    ],
  },
};
