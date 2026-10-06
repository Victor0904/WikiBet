// Graphiques SVG. Les tracés utilisent un viewBox 100 × H étiré (preserveAspectRatio="none") avec des traits
// non déformés ; les points sont des éléments HTML positionnés en %, pour rester ronds.
const pathD = pts => pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
const Dot = ({ x, y, h, color }) => <span className="dot" style={{ left: `${x}%`, top: `${y / h * 100}%`, background: color }} />;

// Position : le cours de l'ouverture jusqu'à maintenant, sur toute la fenêtre jusqu'à l'échéance.
// Pointillé = cours d'entrée ; zone verte du côté gagnant, rouge du côté perdant.
export function TradeChart({ b, path, upto, h = 64 }) {
  const a = b.start_tick, z = b.end_tick, n = Math.max(a, Math.min(z, upto));
  const v = path.slice(a, n + 1), lo = Math.min(b.entry, ...v), r = (Math.max(b.entry, ...v) - lo) || b.entry * .01;
  const X = i => (i - a) / Math.max(1, z - a) * 100, Y = p => 6 + (1 - (p - lo) / r) * (h - 12), ye = Y(b.entry);
  const last = v[v.length - 1], win = (b.dir === "up" ? 1 : -1) * (last - b.entry) >= 0, col = win ? "var(--up)" : "var(--down)";
  const line = pathD(v.map((p, k) => [X(a + k), Y(p)])), area = `${line}L${X(n).toFixed(2)},${ye.toFixed(2)}L0,${ye.toFixed(2)}Z`;
  const [over, under] = b.dir === "up" ? ["var(--up-soft)", "var(--down-soft)"] : ["var(--down-soft)", "var(--up-soft)"];
  const id = "c" + b.id;
  return (
    <div className="tchart" style={{ height: h }}>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <clipPath id={id + "a"}><rect x="0" y="0" width="100" height={ye} /></clipPath>
        <clipPath id={id + "b"}><rect x="0" y={ye} width="100" height={h - ye} /></clipPath>
        <path d={area} fill={over} clipPath={`url(#${id}a)`} />
        <path d={area} fill={under} clipPath={`url(#${id}b)`} />
        <line x1="0" x2="100" y1={ye} y2={ye} stroke="var(--faint)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <Dot x={0} y={ye} h={h} color="var(--muted)" />
      <Dot x={X(n)} y={Y(last)} h={h} color={col} />
    </div>
  );
}

// Mini-courbe d'un article sur la séance en cours (ouverture → maintenant), couleur selon la variation.
export function Spark({ path, t, h = 30 }) {
  const n = Math.max(1, t), step = Math.max(1, Math.floor(n / 80)), v = [];
  for (let i = 0; i <= n; i += step) v.push(path[i]);
  if ((n % step) !== 0) v.push(path[n]);
  const lo = Math.min(...v), r = (Math.max(...v) - lo) || 1, up = v[v.length - 1] >= v[0];
  const line = pathD(v.map((p, k) => [k / Math.max(1, v.length - 1) * 100, 3 + (1 - (p - lo) / r) * (h - 6)]));
  return (
    <svg className="spark" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={line} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
