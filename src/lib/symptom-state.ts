export type SymptomIntensities = {
  dryness: number;
  burning: number;
  photophobia: number;
  blurry_vision: number;
  tearing: number;
  stinging?: number | null;
  pressure?: number | null;
};

export type SymptomState = "calmado" | "leve" | "sensible" | "reactivo" | "brote";

export function calcSymptomState(s: SymptomIntensities): SymptomState {
  const vals = [
    s.dryness,
    s.burning,
    s.photophobia,
    s.blurry_vision,
    s.tearing,
    s.stinging ?? 0,
    s.pressure ?? 0,
  ];
  const max = Math.max(...vals);
  const nonZero = vals.filter((v) => v > 0);
  const avg = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;

  if (max >= 9 || (max >= 8 && avg >= 6)) return "brote";
  if (max >= 7 || avg >= 5.5) return "reactivo";
  if (max >= 5 || avg >= 3.5) return "sensible";
  if (max >= 2) return "leve";
  return "calmado";
}
