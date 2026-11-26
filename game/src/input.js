// Keyboard and mouse, read once a frame into a plain command object. The flight model never sees an
// event: it gets pitch, roll and throttle, which is also what lets the screenshot autopilot drive
// the same code the player does.

const KEY_PITCH_UP = ['ArrowUp', 'KeyW'];
const KEY_PITCH_DOWN = ['ArrowDown', 'KeyS'];
const KEY_ROLL_LEFT = ['ArrowLeft', 'KeyA'];
const KEY_ROLL_RIGHT = ['ArrowRight', 'KeyD'];
const KEY_THROTTLE_UP = ['KeyE', 'ShiftLeft', 'ShiftRight'];
const KEY_THROTTLE_DOWN = ['KeyQ', 'ControlLeft'];
const KEY_RESET = ['KeyR'];
const KEY_PAUSE = ['KeyP', 'Escape'];

export function createInput(target) {
  const held = new Set();
  const pressedThisFrame = new Set();
  let pointerX = 0;
  let pointerY = 0;
  let pointerDown = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    held.add(event.code);
    pressedThisFrame.add(event.code);
    // The arrows and space scroll a page by default; this game owns them.
    if (
      event.code.startsWith('Arrow') ||
      event.code === 'Space' ||
      KEY_THROTTLE_UP.includes(event.code) ||
      KEY_THROTTLE_DOWN.includes(event.code)
    ) {
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onPointerMove(event) {
    const rect = target.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  }

  function onPointerDown() {
    pointerDown = true;
  }

  function onPointerUp() {
    pointerDown = false;
  }

  function onBlur() {
    held.clear();
    pointerDown = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('blur', onBlur);

  const anyHeld = (codes) => codes.some((code) => held.has(code));

  return {
    /** The command for this step, from the keys held right now. */
    read(throttle) {
      let pitch = 0;
      let roll = 0;
      if (anyHeld(KEY_PITCH_UP)) pitch += 1;
      if (anyHeld(KEY_PITCH_DOWN)) pitch -= 1;
      if (anyHeld(KEY_ROLL_LEFT)) roll -= 1;
      if (anyHeld(KEY_ROLL_RIGHT)) roll += 1;

      // The mouse steers too, for a player who prefers it: the pointer's offset from centre is the
      // stick. It is additive, so a player can use either hand.
      if (pointerDown) {
        roll += pointerX * 0.9;
        pitch -= pointerY * 0.9;
      }

      let nextThrottle = throttle;
      if (anyHeld(KEY_THROTTLE_UP)) nextThrottle += 0.9 * (1 / 60);
      if (anyHeld(KEY_THROTTLE_DOWN)) nextThrottle -= 0.9 * (1 / 60);

      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
        throttle: Math.max(0, Math.min(1, nextThrottle)),
      };
    },

    /** True once per physical press: the caller uses it for reset and pause. */
    consume(code) {
      if (!pressedThisFrame.has(code)) return false;
      pressedThisFrame.delete(code);
      return true;
    },

    resetFrame() {
      pressedThisFrame.clear();
    },

    isReset: () => KEY_RESET,
    isPause: () => KEY_PAUSE,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
