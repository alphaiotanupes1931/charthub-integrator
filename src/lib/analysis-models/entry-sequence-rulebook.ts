// The entry sequence agreed on the Oct 4 call. One fixed order; every model,
// the coach, and analytics read it from here so a new idea cannot silently
// replace the entry rule. Trial only until held-out results approve it.

export const ENTRY_SEQUENCE_VERSION = "entry-sequence-1.0-shadow";

export const ENTRY_SEQUENCE_STEPS = [
  { id: 1, title: "Top-down bias", rule: "Monthly, weekly and daily bias plus the 4H trend set the direction." },
  { id: 2, title: "Session phase", rule: "Read what the last finished session did: consolidated, swept a high or low, broke structure, or continued." },
  { id: 3, title: "1H structural phase", rule: "Consolidation, accumulation, distribution or continuation on the 1H chart." },
  { id: 4, title: "Confirmation", rule: "A wick through a high or low that closes back inside (sweep), then a close through structure on the opposite side." },
  { id: 5, title: "Retest", rule: "Price pulls back through the break toward the order block the move started from." },
  { id: 6, title: "Entry", rule: "15m order block inside the 1H order block, usually with a fair value gap beside it. Entry on the candle body." },
  { id: 7, title: "Target", rule: "The swing high for a long, the swing low for a short." },
] as const;

export const ENTRY_SEQUENCE_GUARDS = [
  "The break of structure confirms the trade. It never sets the entry price.",
  "Consolidation with no sweep means no entry: wait for the sweep.",
  "In a continuation, a level on the way is not a reversal while a deeper order block in the bias direction is untouched.",
  "No qualifying 1H order block means no entry.",
] as const;
