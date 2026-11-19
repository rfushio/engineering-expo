import { IDLE, type Input } from '../shared/protocol';

type Contact = { kind: 'touch' | 'pointer'; id: number };
type Position = { clientX: number; clientY: number };

// Touch lists are authoritative on phones. Pointer capture is only a convenience
// for mouse/pen; release listeners also run globally if capture is interrupted.
export function bindControllerInput(move: HTMLElement, button: HTMLElement, stick: HTMLElement, knob: HTMLElement,
  canPlay: () => boolean, onRelease: (input: Input) => void) {
  const input = IDLE();
  let movement: Contact | null = null, field: Contact | null = null;
  let center = { x: 0, y: 0 }, radius = 50;
  const nativeTouch = 'ontouchstart' in window;
  const matches = (contact: Contact | null, kind: Contact['kind'], id: number) => contact?.kind === kind && contact.id === id;
  function releaseCapture(element: HTMLElement, contact: Contact | null) {
    if (contact?.kind !== 'pointer') return;
    try { if (element.hasPointerCapture(contact.id)) element.releasePointerCapture(contact.id); } catch { /* Already cancelled by the browser. */ }
  }
  function stopMove() {
    const old = movement; movement = null; input.x = input.y = 0;
    stick.hidden = true; move.classList.remove('moving'); releaseCapture(move, old);
  }
  function stopField() {
    const old = field; field = null; input.field = false;
    button.classList.remove('pressed'); releaseCapture(button, old);
  }
  function clear() { stopMove(); stopField(); onRelease({ ...input }); }
  function updateStick(position: Position) {
    const dx = position.clientX - center.x, dy = position.clientY - center.y, length = Math.hypot(dx, dy);
    const fraction = Math.min(1, length / radius), strength = Math.max(0, (fraction - .12) / .88);
    input.x = length ? dx / length * strength : 0; input.y = length ? dy / length * strength : 0;
    const scale = length > radius ? radius / length : 1;
    knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  }
  function beginMove(contact: Contact, position: Position) {
    movement = contact; center = { x: position.clientX, y: position.clientY };
    radius = Math.max(1, Math.min(55, move.clientHeight * .23));
    const rect = move.getBoundingClientRect();
    stick.style.left = `${center.x - rect.left}px`; stick.style.top = `${center.y - rect.top}px`;
    stick.style.width = stick.style.height = `${radius * 2}px`;
    stick.hidden = false; move.classList.add('moving'); updateStick(position);
  }
  function beginField(contact: Contact) { field = contact; input.field = true; button.classList.add('pressed'); }
  function inZone(target: EventTarget | null, zone: HTMLElement) { return target instanceof Node && zone.contains(target); }
  function prevent(event: Event) { if (event.cancelable) event.preventDefault(); }
  function touch(event: TouchEvent) {
    const active = Array.from(event.touches);
    const wasActive = movement !== null || field !== null;
    const onControls = Array.from(event.changedTouches).some(t => inZone(t.target, move) || inZone(t.target, button));
    // Prevent browser gestures before Safari can take ownership of these fingers.
    if (wasActive || onControls || active.length > 1 || event.type === 'touchmove') prevent(event);
    if (event.type === 'touchcancel') { clear(); return; }
    if (!canPlay()) { if (wasActive) clear(); return; }
    let released = false;
    if (movement?.kind === 'touch' && !active.some(t => t.identifier === movement!.id)) { stopMove(); released = true; }
    if (field?.kind === 'touch' && !active.some(t => t.identifier === field!.id)) { stopField(); released = true; }
    if (event.type === 'touchstart') for (const t of Array.from(event.changedTouches)) {
      if (!active.some(a => a.identifier === t.identifier)) continue;
      if (movement === null && inZone(t.target, move)) beginMove({ kind: 'touch', id: t.identifier }, t);
      else if (field === null && inZone(t.target, button)) beginField({ kind: 'touch', id: t.identifier });
    }
    const moving = movement?.kind === 'touch' ? active.find(t => t.identifier === movement!.id) : undefined;
    if (moving) updateStick(moving);
    if (released) onRelease({ ...input });
  }
  if (nativeTouch) for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    document.addEventListener(type, touch as EventListener, { capture: true, passive: false });
  }
  function pointerStart(event: PointerEvent, zone: HTMLElement) {
    if ((nativeTouch && event.pointerType === 'touch') || event.button !== 0 || !canPlay()) return;
    if (zone === move ? movement !== null : field !== null) return;
    prevent(event);
    if (zone === move) beginMove({ kind: 'pointer', id: event.pointerId }, event);
    else beginField({ kind: 'pointer', id: event.pointerId });
    try { zone.setPointerCapture(event.pointerId); } catch { /* Global listeners still handle release. */ }
  }
  move.addEventListener('pointerdown', e => pointerStart(e, move));
  button.addEventListener('pointerdown', e => pointerStart(e, button));
  function pointerEnd(event: PointerEvent) {
    let released = false;
    if (matches(movement, 'pointer', event.pointerId)) { stopMove(); released = true; }
    if (matches(field, 'pointer', event.pointerId)) { stopField(); released = true; }
    if (released) onRelease({ ...input });
  }
  document.addEventListener('pointermove', event => {
    if (event.buttons === 0) { pointerEnd(event); return; }
    if (matches(movement, 'pointer', event.pointerId)) { prevent(event); updateStick(event); }
  }, { capture: true, passive: false });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, pointerEnd as EventListener, true);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu', 'selectstart', 'dragstart']) {
    document.addEventListener(type, prevent, { capture: true, passive: false });
  }
  return { clear, read: (): Input => ({ ...input }) };
}
