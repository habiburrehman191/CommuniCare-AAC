export interface PslAacMapping {
  label: string;
  displayTitle: string;
  urduDisplayTitle: string;
  englishMessage: string;
  urduMessage: string;
}

export const REVIEWED_PSL_AAC_MAPPINGS: Record<string, PslAacMapping> = {
  water: {
    label: 'water',
    displayTitle: 'Water',
    urduDisplayTitle: 'پانی',
    englishMessage: 'I need water.',
    urduMessage: 'مجھے پانی چاہیے۔',
  },
  thankyou: {
    label: 'thankyou',
    displayTitle: 'Thank You',
    urduDisplayTitle: 'شکریہ',
    englishMessage: 'Thank you.',
    urduMessage: 'شکریہ۔',
  },
  hello: {
    label: 'hello',
    displayTitle: 'Hello',
    urduDisplayTitle: 'ہیلو / سلام',
    englishMessage: 'Hello.',
    urduMessage: 'السلام علیکم۔',
  },
  donttouch: {
    label: 'donttouch',
    displayTitle: "Don't Touch",
    urduDisplayTitle: 'مت چھوئیں',
    englishMessage: "Don't touch.",
    urduMessage: 'مت چھوئیں۔',
  },
};

/**
 * CommuniCare AAC Sign V1 verified 8-class mappings:
 * 7 communication signs mapped to canonical bilingual sentences + 1 rejection class (NO_SIGN).
 */
export const COMMUNICARE_AAC_SIGN_MAPPINGS: Record<string, PslAacMapping> = {
  water: {
    label: 'water',
    displayTitle: 'Water',
    urduDisplayTitle: 'پانی',
    englishMessage: 'I need water.',
    urduMessage: 'مجھے پانی چاہیے۔',
  },
  help: {
    label: 'help',
    displayTitle: 'Help',
    urduDisplayTitle: 'مدد',
    englishMessage: 'I need help now.',
    urduMessage: 'مجھے ابھی مدد چاہیے۔',
  },
  hungry: {
    label: 'hungry',
    displayTitle: 'Hungry',
    urduDisplayTitle: 'بھوک',
    englishMessage: 'I need food.',
    urduMessage: 'مجھے کھانا چاہیے۔',
  },
  need: {
    label: 'need',
    displayTitle: 'Need',
    urduDisplayTitle: 'ضرورت',
    englishMessage: 'I need this.',
    urduMessage: 'مجھے اس کی ضرورت ہے۔',
  },
  want: {
    label: 'want',
    displayTitle: 'Want',
    urduDisplayTitle: 'چاہئے',
    englishMessage: 'I want this.',
    urduMessage: 'مجھے یہ چاہیے۔',
  },
  hello: {
    label: 'hello',
    displayTitle: 'Hello',
    urduDisplayTitle: 'ہیلو / سلام',
    englishMessage: 'Hello.',
    urduMessage: 'السلام علیکم۔',
  },
  thankyou: {
    label: 'thankyou',
    displayTitle: 'Thank You',
    urduDisplayTitle: 'شکریہ',
    englishMessage: 'Thank you.',
    urduMessage: 'شکریہ۔',
  },
};

export function getPslAacMapping(label: string): PslAacMapping | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'no_sign' || normalized === 'no sign') {
    return null;
  }
  return COMMUNICARE_AAC_SIGN_MAPPINGS[normalized] ?? REVIEWED_PSL_AAC_MAPPINGS[normalized] ?? null;
}

