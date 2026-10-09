// Graphiques SVG. Les tracés utilisent un viewBox 100 × H étiré (preserveAspectRatio="none") avec des traits
// non déformés ; les points sont des éléments HTML positionnés en %, pour rester ronds.
const pathD = pts => pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
const Dot = ({ x, y, h, color }) => <span className="dot" style={{ left: `${x}%`, top: `${y / h * 100}%`, background: color }} />;

// Position : la valeur suivie (cours ou spectateurs) de l'ouverture jusqu'à maintenant, sur toute la fenêtre
// [x0, x1] jusqu'à l'échéance. Pointillé = valeur d'entrée ; zone verte du côté gagnant, rouge du côté perdant.
export function PositionChart({ id, entry, dir, pts, x0, x1, h = 64 }) {
  const v = pts.map(p => p[1]), lo = Math.min(entry, ...v), r = (Math.max(entry, ...v) - lo) || entry * .01;
  const X = x => Math.min(100, Math.max(0, (x - x0) / Math.max(1e-9, x1 - x0) * 100)), Y = p => 6 + (1 - (p - lo) / r) * (h - 12), ye = Y(entry);
  const [xn, last] = pts[pts.length - 1], win = (dir === "up" ? 1 : -1) * (last - entry) >= 0, col = win ? "var(--up)" : "var(--down)";
  const line = pathD(pts.map(([x, p]) => [X(x), Y(p)])), area = `${line}L${X(xn).toFixed(2)},${ye.toFixed(2)}L${X(pts[0][0]).toFixed(2)},${ye.toFixed(2)}Z`;
  const [over, under] = dir === "up" ? ["var(--up-soft)", "var(--down-soft)"] : ["var(--down-soft)", "var(--up-soft)"];
  const cid = "c" + id;
  return (
    <div className="tchart" style={{ height: h }}>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <clipPath id={cid + "a"}><rect x="0" y="0" width="100" height={ye} /></clipPath>
        <clipPath id={cid + "b"}><rect x="0" y={ye} width="100" height={h - ye} /></clipPath>
        <path d={area} fill={over} clipPath={`url(#${cid}a)`} />
        <path d={area} fill={under} clipPath={`url(#${cid}b)`} />
        <line x1="0" x2="100" y1={ye} y2={ye} stroke="var(--faint)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <Dot x={X(pts[0][0])} y={ye} h={h} color="var(--muted)" />
      <Dot x={X(xn)} y={Y(last)} h={h} color={col} />
    </div>
  );
}

// Position sur un article : minutes de jeu de l'ouverture à l'échéance.
export const TradeChart = ({ b, path, upto, h }) => {
  const n = Math.max(b.start_tick, Math.min(b.end_tick, upto)), pts = [];
  for (let i = b.start_tick; i <= n; i++) pts.push([i, path[i]]);
  return <PositionChart id={b.id} entry={b.entry} dir={b.dir} pts={pts} x0={b.start_tick} x1={b.end_tick} h={h} />;
};

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
