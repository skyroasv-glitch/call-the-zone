import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Stops one broken subtree from blanking the whole page.
 *
 * The case this exists for is a redeploy. Vite gives every chunk a content
 * hash, so the moment new files ship the old `Scene-*.js` stops existing — and
 * any tab still holding the previous index.html asks for it the first time it
 * opens a pitch. That import rejects, React unmounts the tree, and the player
 * is left looking at an empty dark page with nothing to click. Without a
 * boundary there is no recovery path at all, because `lazy()` caches the failed
 * promise: retrying in place fails again forever. Only a reload fixes it, so
 * that is what the fallback offers.
 *
 * It also catches the other way the 3D scene can die — a device that cannot
 * give three.js a WebGL context — which otherwise fails the same silent way.
 */

/** A chunk that no longer exists reads differently across browsers. */
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i;

interface Props {
  children: ReactNode;
  /** Shown above the reload button; the boundary supplies the rest. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No reporting service wired up, so at least leave a trail in the console.
    console.error("Caught by ErrorBoundary:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = STALE_CHUNK.test(error.message);
    return (
      <div className="boundary" role="alert">
        <p className="boundary-title">
          {stale ? "A new version was published" : this.props.label ?? "Something broke"}
        </p>
        <p className="boundary-note">
          {stale
            ? "This tab is still running the old one. Reload to pick it up — your streak is saved."
            : "Reload to start again. Your streak is saved."}
        </p>
        <button className="primary-btn" style={{ width: "auto", padding: "12px 26px" }}
          onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
