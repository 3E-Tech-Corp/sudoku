/**
 * Deck theme configuration.
 *
 * Each theme maps card data → an image URL living under /cards/<theme>/.
 * Two "real" SVG sets are shipped:
 *   • classic  – ornate French-suited deck (cardsJS / LGPL-2.1)
 *   • modern   – clean jumbo-index deck (saulspatz/SVGCards / LGPL-2.1)
 *
 * A third "neon" theme reuses the modern SVGs but applies a CSS filter.
 */

export interface DeckTheme {
  id: string;
  name: string;
  /** Short preview description */
  description: string;
  /** Directory under /cards/ that holds the SVGs */
  assetDir: string;
  /** Build the card-face URL for a given number (1-13) + suit name */
  cardUrl: (number: number, suit: string) => string;
  /** Card-back URL */
  backUrl: string;
  /** Optional CSS filter applied to <img> elements */
  imgFilter?: string;
  /** Preview card for the picker (Ace of Spades) */
  previewUrl: string;
}

// ────────────────────────────────────────────────────────
//  Classic – richardschneider/cardsJS  (ornate French)
// ────────────────────────────────────────────────────────
const CLASSIC_SUIT: Record<string, string> = {
  Hearts: 'H', Diamonds: 'D', Clubs: 'C', Spades: 'S',
};
const CLASSIC_FACE: Record<number, string> = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K',
};

const classicTheme: DeckTheme = {
  id: 'classic',
  name: 'Classic',
  description: 'Traditional ornate design',
  assetDir: 'classic',
  cardUrl: (num, suit) => {
    const s = CLASSIC_SUIT[suit];
    if (!s) return '';
    const f = CLASSIC_FACE[num] ?? String(num);
    return `/cards/classic/${f}${s}.svg`;
  },
  backUrl: '/cards/classic/BLUE_BACK.svg',
  previewUrl: '/cards/classic/AS.svg',
};

// ────────────────────────────────────────────────────────
//  Modern – saulspatz/SVGCards  (clean jumbo-index)
// ────────────────────────────────────────────────────────
const MODERN_SUIT: Record<string, string> = {
  Hearts: 'heart', Diamonds: 'diamond', Clubs: 'club', Spades: 'spade',
};
const MODERN_FACE: Record<number, string> = {
  1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King',
};

const modernTheme: DeckTheme = {
  id: 'modern',
  name: 'Modern',
  description: 'Clean jumbo-index cards',
  assetDir: 'modern',
  cardUrl: (num, suit) => {
    const s = MODERN_SUIT[suit];
    if (!s) return '';
    const f = MODERN_FACE[num] ?? String(num);
    return `/cards/modern/${s}${f}.svg`;
  },
  backUrl: '/cards/modern/blueBack.svg',
  previewUrl: '/cards/modern/spadeAce.svg',
};

// ────────────────────────────────────────────────────────
//  Neon – modern SVGs with a CSS hue-rotate/saturate
// ────────────────────────────────────────────────────────
const neonTheme: DeckTheme = {
  id: 'neon',
  name: 'Neon',
  description: 'Glowing neon look',
  assetDir: 'modern', // reuses same files
  cardUrl: modernTheme.cardUrl,
  backUrl: modernTheme.backUrl,
  imgFilter: 'invert(1) hue-rotate(180deg) saturate(2.5) brightness(1.1)',
  previewUrl: modernTheme.previewUrl,
};

// ────────────────────────────────────────────────────────
//  Exports
// ────────────────────────────────────────────────────────
export const DECK_THEMES: DeckTheme[] = [classicTheme, modernTheme, neonTheme];

export const DEFAULT_THEME_ID = 'classic';

const STORAGE_KEY = 'deckTheme';

export function getSavedThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage unavailable – silently ignore
  }
}

export function getThemeById(id: string): DeckTheme {
  return DECK_THEMES.find((t) => t.id === id) ?? DECK_THEMES[0];
}
