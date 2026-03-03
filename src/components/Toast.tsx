// ABOUTME: Simple auto-dismissing toast notification.
// ABOUTME: Renders fixed at the bottom of the screen.

import { createSignal, onMount, Show } from "solid-js";

interface Props {
  message: string;
  type?: "error" | "success" | "info";
  duration?: number;
  onDismiss: () => void;
}

export function Toast(props: Props) {
  const [visible, setVisible] = createSignal(true);

  onMount(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      props.onDismiss();
    }, props.duration ?? 4000);
    return () => clearTimeout(timer);
  });

  return (
    <Show when={visible()}>
      <div class={`toast toast-${props.type ?? "error"}`} onClick={() => { setVisible(false); props.onDismiss(); }}>
        {props.message}
      </div>
    </Show>
  );
}
