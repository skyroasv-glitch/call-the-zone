import { lazy, Suspense, useEffect, useRef } from "react";
import { useGame, currentStreak } from "./game/store";
import { startAmbience, setMuted } from "./audio/stadium";
import { Home } from "./ui/Home";
import { Matchup } from "./ui/Matchup";
import { StreakDots } from "./ui/StreakDots";
import { Reveal } from "./ui/Reveal";
import { Summary } from "./ui/Summary";
import { CallTimer } from "./ui/CallTimer";
import { ErrorBoundary } from "./ui/ErrorBoundary";

/** How many pitches the end-of-run plot shows; an infinite run can dwarf it. */
const RECAP_TAIL = 20;
const loadScene = () => import("./scene/Scene");
const Scene = lazy(async () => {
  const module = await loadScene();
  return { default: module.Scene };
});

export default function App() {
  const {
    phase, mode, puzzle, isFallback, error, index, judged, save, deadline,
    startDaily, startInfinite, goHome, throwPitch, call, next, endRun, timeUp,
    replay, restart, toggleMuted, markIntroSeen, chooseSkin, bankRun,
  } = useGame();
  const showIntro = phase === "ready" && !save.introSeen;
  const introButton = useRef<HTMLButtonElement>(null);

  /*
   * Browsers suspend an AudioContext created before the user has interacted, so
   * the ambience is built on the first gesture and never before.
   */
  useEffect(() => {
    if (save.muted) return;
    const begin = () => { setMuted(false); startAmbience(); };
    window.addEventListener("pointerdown", begin, { once: true });
    window.addEventListener("keydown", begin, { once: true });
    return () => {
      window.removeEventListener("pointerdown", begin);
      window.removeEventListener("keydown", begin);
    };
  }, [save.muted]);

  /*
   * Bank an infinite run if the tab goes away. `pagehide` rather than
   * `beforeunload`: it fires on mobile backgrounding and on bfcache eviction,
   * where beforeunload often does not. Banking is by delta, so a tab that comes
   * back and keeps playing still totals up correctly.
   */
  useEffect(() => {
    const bank = () => bankRun();
    window.addEventListener("pagehide", bank);
    return () => window.removeEventListener("pagehide", bank);
  }, [bankRun]);

  // keyboard: space = pitch, B/S = call, Enter = advance, Esc = home
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `key` for the space bar is " ", but not every source agrees — fall back
      // to `code` so a synthetic "Space" is understood too.
      const k = e.code === "Space" ? " " : e.key.toLowerCase();
      /*
       * Space and Enter also activate whatever button has focus, so with the
       * mute toggle focused a Space would flip the sound AND throw the pitch.
       * The letter shortcuts stay live regardless.
       */
      if ((k === " " || k === "enter")
        && (e.target as HTMLElement | null)?.closest?.("button, a, input, select, textarea")) {
        return;
      }
      if (phase === "home") {
        if (k === "d") void startDaily();
        else if (k === "i") void startInfinite();
        return;
      }
      // Keep the first-play explainer a real pause in the flow; otherwise a
      // quick Space press can start the pitch behind the dialog.
      if (phase === "ready" && !save.introSeen) return;
      if (k === "escape") { goHome(); return; }
      if (phase === "ready" && (k === " " || k === "enter")) { e.preventDefault(); throwPitch(); }
      else if (phase === "awaiting" && k === "b") call("ball");
      else if (phase === "awaiting" && k === "s") call("strike");
      else if (phase === "revealed" && (k === "enter" || k === " ")) { e.preventDefault(); next(); }
      else if ((phase === "awaiting" || phase === "revealed") && k === "r") replay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, save.introSeen, startDaily, startInfinite, goHome, throwPitch, call, next, replay]);

  useEffect(() => {
    if (!showIntro) return;
    const frame = requestAnimationFrame(() => introButton.current?.focus());
    const keepFocusInDialog = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      introButton.current?.focus();
    };
    window.addEventListener("keydown", keepFocusInDialog);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keepFocusInDialog);
    };
  }, [showIntro]);

  if (phase === "home") {
    return (
      <div className="app home-app">
        <Home
          save={save}
          onDaily={() => { void loadScene(); void startDaily(); }}
          onInfinite={() => { void loadScene(); void startInfinite(); }}
          onWarmup={() => { void loadScene(); }}
          onPickSkin={chooseSkin}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error">
        Couldn't load the pitches.<br />{error}
        <br /><button className="ghost-btn" style={{ marginTop: 16 }} onClick={goHome}>Back</button>
      </div>
    );
  }
  if (!puzzle) return <div className="loading">Warming up…</div>;

  const infinite = mode === "infinite";
  const total = puzzle.pitches.length;
  const pitch = puzzle.pitches[Math.min(index, total - 1)];
  const done = phase === "summary";
  const hot = currentStreak(judged);
  const score = judged.filter((j) => j.correct).length;
  const recap = infinite ? judged.slice(-RECAP_TAIL) : judged;

  return (
    <div className="app">
      <header className="header">
        <button className="back" onClick={goHome} aria-label="Back to menu" title="Back to menu">‹</button>
        <h1 className="brand">Call the <span>Zone</span></h1>
        <div className="header-meta">
          <span>{infinite ? "Infinite" : puzzle.date}</span>
          <span>{infinite ? `${score}/${judged.length}` : `${save.streak}🔥`}</span>
          {infinite && !done && (
            <button className="end-run" onClick={endRun} disabled={!judged.length}>End run</button>
          )}
          <button
            className="mute"
            onClick={(e) => {
              if (save.muted) startAmbience();
              toggleMuted();
              /*
               * Hand focus back after a mouse click. The key handler ignores
               * Space and Enter while a control is focused (or they would both
               * activate the button and throw a pitch) — so a lingering focus
               * here would kill the primary shortcuts for the rest of the
               * session. detail === 0 means the click came from the keyboard,
               * where taking focus away would be the wrong thing to do.
               */
              if (e.detail > 0) e.currentTarget.blur();
            }}
            aria-pressed={save.muted}
            aria-label={save.muted ? "Unmute crowd" : "Mute crowd"}
            title={save.muted ? "Unmute crowd" : "Mute crowd"}
          >
            {save.muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      {!done && <Matchup pitch={pitch} index={index} total={infinite ? 0 : total} fallback={!infinite && isFallback} />}

      <main className="stage">
        {/* Scoped to the scene: if the 3D chunk dies, the header, the score and
            the controls all survive and the player gets a way out. */}
        <ErrorBoundary label="The field didn't load">
          <Suspense fallback={<div className="scene-loading" role="status"><span className="loading-ball" />Setting the field…</div>}>
            <Scene pitch={done ? null : pitch} recap={done ? recap : undefined} />
          </Suspense>
        </ErrorBoundary>
        {!done && !infinite && <StreakDots judged={judged} index={index} total={total} />}
        {!done && infinite && (
          <div className="run-hud">
            <span className="run-count">#{index + 1}</span>
            <span>{score}/{judged.length}</span>
          </div>
        )}
        {!done && hot >= 2 && <div className="hot-streak">{hot} in a row</div>}
        {phase === "ready" && <div className="hint">Space to pitch</div>}
        {phase === "awaiting" && (
          <div className="hint">
            {deadline !== null ? "Call it — clock's running" : "The zone stays hidden until you call it"}
          </div>
        )}
        {done && <div className="hint">Where {infinite ? "your last pitches" : "your five pitches"} crossed</div>}
      </main>

      <footer className="controls">
        {phase === "ready" && (
          <button className="primary-btn" onClick={throwPitch}>Throw the pitch</button>
        )}
        {phase === "pitching" && (
          <button className="primary-btn" disabled style={{ opacity: 0.45, cursor: "default" }}>
            Watch it…
          </button>
        )}
        {phase === "awaiting" && deadline !== null && (
          <CallTimer deadline={deadline} onExpire={timeUp} />
        )}
        {phase === "awaiting" && (
          <div className="call-row">
            <button className="call-btn ball" onClick={() => call("ball")}>
              Ball<kbd>B</kbd>
            </button>
            <button className="call-btn strike" onClick={() => call("strike")}>
              Strike<kbd>S</kbd>
            </button>
          </div>
        )}
        {phase === "revealed" && (
          <Reveal
            j={judged[judged.length - 1]}
            last={!infinite && index + 1 >= total}
            onNext={next}
            onReplay={replay}
          />
        )}
        {done && (
          <Summary
            date={puzzle.date}
            mode={mode}
            judged={judged}
            save={save}
            onReplayDay={restart}
            onHome={goHome}
          />
        )}
      </footer>
      {showIntro && (
        <div className="intro-scrim">
          <section className="intro-card" role="dialog" aria-modal="true" aria-labelledby="intro-title">
            <p className="intro-kicker">How to play</p>
            <h2 id="intro-title">Call it before you see it.</h2>
            <ol>
              <li>Watch the pitch from behind the plate.</li>
              <li>Call <b>Ball</b> or <b>Strike</b> when it crosses.</li>
              <li>Then see the ABS rulebook and umpire calls.</li>
            </ol>
            <button ref={introButton} className="primary-btn" onClick={markIntroSeen}>Step in</button>
          </section>
        </div>
      )}
    </div>
  );
}
