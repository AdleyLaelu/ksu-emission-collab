export function speedFromGreenshields(q, uf, kj) {
  if (!(q > 0) || !(uf > 0) || !(kj > 0)) return null;
  const a = uf / kj, b = -uf, c = q;
  const disc = b*b - 4*a*c;
  if (disc < 0) return null;
  const sqrt = Math.sqrt(disc);
  const k1 = (-b + sqrt) / (2*a);
  const k2 = (-b - sqrt) / (2*a);
  const candidates = [k1, k2].filter((k) => k > 0);
  if (!candidates.length) return null;
  const k = Math.min(...candidates);
  const u = q / k;
  return { speed: u, density: k };
}
