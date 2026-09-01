import { SKINS, awaySkinFor, skinById } from "../scene/uniform";

/**
 * Uniform picker. The swatch is a miniature of the kit rather than a single
 * colour chip — jersey, sleeve and pants read very differently on the field,
 * and a one-colour dot would sell three of them as the same skin.
 */
export function SkinPicker({ skinId, onPick }: {
  skinId: string;
  onPick: (id: string) => void;
}) {
  const away = awaySkinFor(skinById(skinId));

  return (
    <section className="skins" aria-label="Uniform">
      <div className="skins-head">
        <h2>Uniform</h2>
        <p>Worn by your pitcher and catcher · batter bats in {away.name}</p>
      </div>
      <div className="skin-row" role="radiogroup" aria-label="Uniform">
        {SKINS.map((s) => {
          const on = s.id === skinId;
          return (
            <button
              key={s.id}
              className={`skin-chip${on ? " on" : ""}`}
              role="radio"
              aria-checked={on}
              onClick={() => onPick(s.id)}
              title={s.blurb}
            >
              <span className="skin-swatch" aria-hidden="true">
                <span className="sw-jersey" style={{ background: s.jersey }}>
                  {s.pinstripe && (
                    <span
                      className="sw-stripes"
                      style={{
                        backgroundImage:
                          `repeating-linear-gradient(90deg, ${s.pinstripe} 0 1px, transparent 1px 4px)`,
                      }}
                    />
                  )}
                  <span className="sw-collar" style={{ background: s.trim }} />
                </span>
                <span className="sw-pants" style={{ background: s.pants }} />
                <span className="sw-socks" style={{ background: s.socks }} />
              </span>
              <span className="skin-name">{s.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
