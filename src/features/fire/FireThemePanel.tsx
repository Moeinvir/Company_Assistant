import { RotateCcw, Sparkles } from "lucide-react";
import { FIRE_SLIDERS, FIRE_THEMES } from "@/fire/fireThemes";
import { useFireTheme } from "@/fire/FireThemeProvider";
import { Button, Slider, Switch } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Fire theme customizer. Every control writes straight into the centralized
 * FireTheme configuration, which publishes CSS variables the whole product
 * reads — no component holds its own copy of a fire value.
 */
export function FireThemePanel({
  compact,
  showHeading = true,
}: {
  compact?: boolean;
  showHeading?: boolean;
}) {
  const { settings, effective, theme, setTheme, update, reset, reducedMotion, liteMode } =
    useFireTheme();

  return (
    <div className={cn("space-y-5", compact && "space-y-4")}>
      {showHeading ? (
        <div>
          <h3 className="text-micro font-semibold text-ink">Visual atmosphere</h3>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-mute">
            Adjust the cinematic particle field and interface accent from one place.
          </p>
        </div>
      ) : null}

      <div
        role="radiogroup"
        aria-label="Fire theme"
        className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}
      >
        {FIRE_THEMES.map((entry) => {
          const active = entry.id === theme.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={entry.blurb}
              onClick={() => setTheme(entry.id)}
              className={cn(
                "group flex items-center gap-2.5 rounded-[10px] border p-2 text-start transition-[border-color,background,box-shadow] duration-200",
                active
                  ? "border-accent/45 bg-accent/[0.07] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_24%,transparent)]"
                  : "border-hairline bg-black/25 hover:border-hairline-strong hover:bg-surface-2",
              )}
            >
              <span
                className="size-7 shrink-0 rounded-full border border-white/10"
                style={{
                  backgroundImage: `linear-gradient(145deg, ${entry.swatch[0]}, ${entry.swatch[1]} 52%, ${entry.swatch[2]})`,
                }}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block truncate text-2xs font-medium text-ink">{entry.name}</span>
                {!compact ? (
                  <span className="mt-0.5 block truncate text-[10px] text-ink-faint">
                    hue {entry.accent.h}°
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-3.5 border-t border-hairline pt-4">
        {FIRE_SLIDERS.map((slider) => (
          <Slider
            key={slider.key}
            label={slider.label}
            hint={compact ? undefined : slider.hint}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={settings[slider.key]}
            format={slider.format}
            onChange={(value) => update({ [slider.key]: value })}
          />
        ))}
      </div>

      <div className="space-y-3.5 border-t border-hairline pt-4">
        <Switch
          checked={settings.reactive}
          onChange={(value) => update({ reactive: value })}
          label="Cursor moves the particles"
          description="Particles softly scatter away from the pointer, then gather back into place."
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
        <p className="text-2xs leading-relaxed text-ink-faint">
          {reducedMotion ? (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3" aria-hidden />
              Reduced motion is on: particles remain still.
            </span>
          ) : liteMode ? (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3" aria-hidden />
              Lightweight mode: fewer particles for this device.
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3" aria-hidden />
              {effective.density > 0.6 ? "Full particle field" : "Reduced particle field"}
            </span>
          )}
        </p>
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<RotateCcw className="size-3.5" aria-hidden />}
          onClick={reset}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
