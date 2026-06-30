// The calm scenic backdrop: night-sky gradient, twinkling stars, a moon/sun orb,
// and three layered mountain ridges. Every value comes from the active theme's
// CSS variables, so this same component renders the day, evening, and night
// scenes without changing. It sits behind all content and never overlaps body
// text (the busy part stays low and in the upper-right margin).

export default function Background() {
  return (
    <div className="bg-layer" aria-hidden="true">
      <div className="bg-stars" />
      <div className="bg-orb" />
      <div className="bg-m1" />
      <div className="bg-m2" />
      <div className="bg-m3" />
      <div className="bg-haze" />
    </div>
  );
}
