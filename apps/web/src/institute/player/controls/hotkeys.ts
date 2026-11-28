import type { ControlsAction } from "./transport.js";
import { TransportAction } from "./transport.js";

export interface SectionNavigation {
  readonly previous?: () => void;
  readonly next?: () => void;
  readonly first?: () => void;
  readonly last?: () => void;
  readonly home?: () => void;
  readonly continuePlaying?: () => void;
}

const ignoresKey = (
  event: KeyboardEvent,
  scope: HTMLElement,
  target: Element
) =>
  event.defaultPrevented ||
  event.isComposing ||
  event.ctrlKey ||
  event.metaKey ||
  event.altKey ||
  !scope.contains(target) ||
  target.closest(
    "select, textarea, [contenteditable]:not([contenteditable=false]), [role=textbox], input:not([type=range])"
  ) !== null;

const runKey = (
  event: KeyboardEvent,
  handle: (() => void) | null | undefined,
  repeat = false
) => {
  if (handle !== null && handle !== undefined) {
    event.preventDefault();

    if (repeat || !event.repeat) {
      handle();
    }
  }
};

const navigationKey = (
  key: string,
  range: boolean,
  navigation?: SectionNavigation
) => {
  switch (key) {
    case "Home": {
      return range ? undefined : navigation?.first;
    }

    case "End": {
      return range ? undefined : navigation?.last;
    }

    case "ArrowDown": {
      return range ? undefined : navigation?.next;
    }

    case "ArrowUp": {
      return range ? undefined : navigation?.previous;
    }

    case "G": {
      return navigation?.last;
    }

    case "j": {
      return navigation?.next;
    }

    case "k": {
      return navigation?.previous;
    }

    default: {
      return null;
    }
  }
};

const transportKey = (key: string, shiftKey: boolean) => {
  const distanceMs = shiftKey ? 5000 : 2000;

  switch (key) {
    case "ArrowLeft":
    case "h": {
      return TransportAction.cases.SeekBy.make({ ms: -distanceMs });
    }

    case "ArrowRight":
    case "l": {
      return TransportAction.cases.SeekBy.make({ ms: distanceMs });
    }

    case "<": {
      return TransportAction.cases.StepRate.make({ direction: -1 });
    }

    case ">": {
      return TransportAction.cases.StepRate.make({ direction: 1 });
    }

    case "r": {
      return TransportAction.cases.Replay.make({});
    }

    default: {
      return null;
    }
  }
};

const chapterKey = ({ key, shiftKey }: KeyboardEvent) => {
  const normalized = /^[a-z]$/iu.test(key) ? key.toLowerCase() : key;

  return normalized === "g" && shiftKey ? "G" : normalized;
};

export const attachHotkeys = (
  scope: HTMLElement,
  act: (action: ControlsAction) => void,
  navigation: SectionNavigation | undefined,
  ended: () => boolean
) => {
  let gAt = Number.NEGATIVE_INFINITY;

  const reset = () => {
    gAt = Number.NEGATIVE_INFINITY;
  };

  const toggle = () => {
    act(TransportAction.cases.Toggle.make({}));
  };

  const keydown = (event: KeyboardEvent) => {
    const target = scope.ownerDocument.activeElement;
    const key = chapterKey(event);
    const awaitedG = event.timeStamp - gAt <= 500;

    reset();

    if (target === null || ignoresKey(event, scope, target)) {
      return;
    }

    if (key === "g" && (navigation?.first || navigation?.home)) {
      runKey(event, () => {
        if (awaitedG && navigation.first !== undefined) {
          navigation.first();
        } else {
          gAt = event.timeStamp;
        }
      });

      return;
    }

    if (key === "h" && awaitedG && navigation?.home !== undefined) {
      runKey(event, navigation.home);

      return;
    }

    if (
      key === " " &&
      target.closest("button, a[href], input, summary") === null
    ) {
      runKey(event, ended() ? (navigation?.continuePlaying ?? toggle) : toggle);

      return;
    }

    const navigate = navigationKey(
      key,
      target.matches("input[type=range]"),
      navigation
    );

    const action = transportKey(key, event.shiftKey);

    if (navigate !== null && navigate !== undefined) {
      runKey(event, navigate);
    } else if (action !== null) {
      runKey(
        event,
        () => {
          act(action);
        },
        key !== "r"
      );
    }
  };

  const focusout = (event: FocusEvent) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !scope.contains(event.relatedTarget)
    ) {
      reset();
    }
  };

  scope.addEventListener("keydown", keydown);
  scope.addEventListener("focusout", focusout);

  return () => {
    scope.removeEventListener("keydown", keydown);
    scope.removeEventListener("focusout", focusout);
  };
};
