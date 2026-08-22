import { trackProductEvent, type ProductEventName, type ProductEventProps } from "@/lib/product-events.functions";

/**
 * Fire-and-forget funnel tracking. Analytics must never break a page, so every
 * failure is swallowed; the caller does not await anything meaningful.
 */
export function track(event: ProductEventName, props?: ProductEventProps): void {
  void (async () => {
    try {
      await trackProductEvent({ data: { event, props } });
    } catch {
      // Ignored on purpose.
    }
  })();
}
