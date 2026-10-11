import { useEffect, useRef } from "react";
import "./fire.css";
import { ParticleField } from "./particleField";
import { useFireTheme } from "./FireThemeProvider";

/**
 * A quiet, full-screen particle atmosphere behind the application interface.
 */
export function FireBackground() {
  const { effective, reducedMotion, tier, theme } = useFireTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<ParticleField | null>(null);
  const settingsRef = useRef(effective);
  settingsRef.current = effective;
  const paletteRef = useRef(theme.particles);
  paletteRef.current = theme.particles;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const field = new ParticleField({
      canvas,
      tier,
      reducedMotion,
      readSettings: () => settingsRef.current,
      readPalette: () => paletteRef.current,
    });
    fieldRef.current = field;
    field.start();

    return () => {
      field.destroy();
      fieldRef.current = null;
    };
  }, [tier, reducedMotion]);

  return (
    <div className="fire-stage cinematic-stage" data-reduced={reducedMotion} aria-hidden="true">
      <div className="cinematic-haze cinematic-haze--left" />
      <div className="cinematic-haze cinematic-haze--right" />
      <canvas ref={canvasRef} className="fire-canvas cinematic-particles" />
    </div>
  );
}
