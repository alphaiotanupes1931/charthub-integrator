import type { TraderTypeId } from "./config";
import comebackOg from "@/assets/share/comeback-og.png.asset.json";
import comebackStory from "@/assets/share/comeback-story.png.asset.json";
import stopOg from "@/assets/share/stop_mover-og.png.asset.json";
import stopStory from "@/assets/share/stop_mover-story.png.asset.json";
import gutOg from "@/assets/share/gut-og.png.asset.json";
import gutStory from "@/assets/share/gut-story.png.asset.json";
import sgOg from "@/assets/share/second_guesser-og.png.asset.json";
import sgStory from "@/assets/share/second_guesser-story.png.asset.json";
import otOg from "@/assets/share/overtrader-og.png.asset.json";
import otStory from "@/assets/share/overtrader-story.png.asset.json";
import ntOg from "@/assets/share/new_trader-og.png.asset.json";
import ntStory from "@/assets/share/new_trader-story.png.asset.json";

/** Public site origin used for absolute share links and link-preview images. */
export const SITE_ORIGIN = "https://trademindaicoach.com";

export const SHARE_IMAGES: Record<TraderTypeId, { og: string; story: string }> = {
  comeback: { og: comebackOg.url, story: comebackStory.url },
  stop_mover: { og: stopOg.url, story: stopStory.url },
  gut: { og: gutOg.url, story: gutStory.url },
  second_guesser: { og: sgOg.url, story: sgStory.url },
  overtrader: { og: otOg.url, story: otStory.url },
  new_trader: { og: ntOg.url, story: ntStory.url },
};

export const TYPE_SLUGS: Record<string, TraderTypeId> = {
  "comeback-trader": "comeback", "stop-mover": "stop_mover", "gut-trader": "gut",
  "second-guesser": "second_guesser", overtrader: "overtrader", "new-trader": "new_trader",
};
export const SLUG_FOR: Record<TraderTypeId, string> = Object.fromEntries(
  Object.entries(TYPE_SLUGS).map(([s, t]) => [t, s]),
) as Record<TraderTypeId, string>;

export function absolute(url: string) {
  return url.startsWith("http") ? url : `${SITE_ORIGIN}${url}`;
}
