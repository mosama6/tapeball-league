import { useEffect, useState } from "react";
import { apiPath } from "./config";

export function GallerySlideshow({
  items
}: {
  items: Array<{ id: string; title: string; category: string; src: string | null }>;
}) {
  const slides = items.filter((i) => i.src);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % slides.length), 4500);
    return () => clearInterval(t);
  }, [slides.length]);
  if (slides.length === 0) return null;
  const slide = slides[i] ?? slides[0];
  return (
    <div className="gallery">
      <img src={apiPath(slide.src!)} alt={slide.title} />
      <div className="gallery-caption">
        <span className="tiny">{slide.category === "SQUAD" ? "Squad" : "Team"}</span>
        <strong>{slide.title}</strong>
      </div>
      {slides.length > 1 && (
        <div className="gallery-dots">
          {slides.map((s, idx) => (
            <button key={s.id} className={idx === i ? "on" : ""} aria-label={s.title} onClick={() => setI(idx)} />
          ))}
        </div>
      )}
    </div>
  );
}
