import { useEffect, useRef, useState } from "react";

/**
 * ZorNote's own confirm / prompt / alert dialogs.
 * The browser's built-in ones don't wait for an answer inside the desktop app (WebKitGTK),
 * so "Cancel" was ignored. These return a Promise that resolves only when the user answers.
 */

type Req =
  | { kind: "confirm"; message: string; okLabel: string; resolve: (v: boolean) => void }
  | { kind: "prompt"; message: string; value: string; resolve: (v: string | null) => void }
  | { kind: "alert"; message: string; resolve: () => void };

let push: ((r: Req) => void) | null = null;
const queue: Req[] = [];

function send(r: Req) {
  if (push) push(r);
  else queue.push(r);
}

export const ask = {
  /** `okLabel` is the red button's text ("Delete", "Replace", …). */
  confirm: (message: string, okLabel = "Delete") =>
    new Promise<boolean>((resolve) => send({ kind: "confirm", message, okLabel, resolve })),
  prompt: (message: string, value = "") =>
    new Promise<string | null>((resolve) => send({ kind: "prompt", message, value, resolve })),
  alert: (message: string) => new Promise<void>((resolve) => send({ kind: "alert", message, resolve })),
};

/** Mount once (in App). */
export function AskHost() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    push = (r) => setReqs((q) => [...q, r]);
    if (queue.length) setReqs((q) => [...q, ...queue.splice(0)]);
    return () => { push = null; };
  }, []);

  const cur = reqs[0];
  useEffect(() => {
    if (!cur) return;
    if (cur.kind !== "prompt") setTimeout(() => okBtn.current?.focus(), 0);
  }, [cur]);

  if (!cur) return null;

  const done = (ok: boolean) => {
    if (cur.kind === "confirm") cur.resolve(ok);
    else if (cur.kind === "prompt") cur.resolve(ok ? input.current?.value ?? "" : null);
    else cur.resolve();
    setReqs((q) => q.slice(1));
  };

  return (
    <div className="overlay ask-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) done(false); }}>
      <div
        className="dialog ask"
        role="dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(true); }
        }}
      >
        <p className="ask-msg">{cur.message}</p>
        {cur.kind === "prompt" && (
          <input
            ref={input}
            key={reqs.length + ":" + cur.message + ":" + cur.value}
            className="ask-input"
            defaultValue={cur.value}
            autoFocus
            onFocus={(e) => e.currentTarget.select()} // old name selected: typing replaces it, like OneNote
          />
        )}
        <div className="row ask-row">
          <button
            ref={okBtn}
            className={cur.kind === "confirm" ? "primary danger" : "primary"}
            onClick={() => done(true)}
          >
            {cur.kind === "confirm" ? cur.okLabel : "OK"}
          </button>
          {cur.kind !== "alert" && <button onClick={() => done(false)}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
