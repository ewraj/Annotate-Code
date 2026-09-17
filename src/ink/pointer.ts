/**
 * The stylus pipeline.
 *
 * Three things here are the difference between ink that feels alive and ink that feels like
 * a web page, and none of them are optional:
 *
 *   - **Coalesced events.** A stylus samples far faster than the display refreshes. The
 *     browser batches those samples and hands you only the latest one per frame unless you
 *     ask for the rest. Without `getCoalescedEvents()` you draw visible polygons.
 *   - **Palm rejection.** A hand resting on a tablet generates `touch` events across a wide
 *     contact patch. Once a pen has been seen, touch stops drawing and goes back to
 *     scrolling — which is also what a user expects a second finger to do.
 *   - **Real pressure.** Straight from the device, with a constant fallback for hardware
 *     that reports none, so a mouse draws an even line rather than a whiskery one.
 */

/** What a mouse (or any device with no pressure sensor) draws at. */
const FLAT_PRESSURE = 0.5;

/**
 * Whether a pen has ever been used in this session.
 *
 * Deliberately module-level and never reset: a user who picks up a stylus has told us which
 * device is the pen for the rest of the sitting, and flapping back to touch-draws the first
 * time they put it down is worse than being slightly sticky.
 */
let penSeen = false;

export function notePointerType(type: string): void {
  if (type === 'pen') penSeen = true;
}

/** Test seam. Palm rejection is session state, and tests need to not inherit it. */
export function resetPalmRejection(): void {
  penSeen = false;
}

/**
 * Should this event draw?
 *
 * Touch draws only until a pen shows up. After that it scrolls, which is what the palm
 * resting on the screen should have been doing all along.
 */
export function canDraw(event: { pointerType: string }): boolean {
  if (event.pointerType === 'touch') return !penSeen;
  return true;
}

/**
 * Pressure, normalised.
 *
 * A device with no sensor reports exactly 0 while the button is down; browsers also report
 * 0.5 for mouse buttons. Both mean "no real pressure here", so both get the flat value.
 */
export function pressureOf(event: PointerEvent): number {
  if (event.pointerType === 'pen' && event.pressure > 0) return event.pressure;
  return FLAT_PRESSURE;
}

/**
 * Every sample behind one pointer event, oldest first.
 *
 * Falls back to the event itself where `getCoalescedEvents` is missing (Safari has been
 * late to this) — one sample per frame still draws, just less smoothly.
 */
export function samplesOf(event: PointerEvent): PointerEvent[] {
  const coalesced = event.getCoalescedEvents?.();
  return coalesced && coalesced.length > 0 ? coalesced : [event];
}
