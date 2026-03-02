const NetworkMiniGraph = () => {
  const nodePositions = [
    { x: 30, y: 20 },
    { x: 70, y: 15 },
    { x: 75, y: 55 },
    { x: 25, y: 55 },
  ];

  return (
    <svg width="100" height="70" viewBox="0 0 100 70" className="mx-auto">
      {/* Lines between nodes */}
      {nodePositions.map((from, i) =>
        nodePositions.slice(i + 1).map((to, j) => (
          <line
            key={`${i}-${j}`}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="hsl(var(--primary))"
            strokeWidth="1"
            opacity="0.3"
            className="animate-network-pulse"
            style={{ animationDelay: `${(i + j) * 0.4}s` }}
          />
        ))
      )}
      {/* Nodes */}
      {nodePositions.map((pos, i) => (
        <circle
          key={i}
          cx={pos.x} cy={pos.y} r="4"
          fill={i === 0 ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
          className={i === 0 ? '' : 'animate-pulse-dot'}
          style={{ animationDelay: `${i * 0.5}s` }}
        />
      ))}
    </svg>
  );
};

export default NetworkMiniGraph;
