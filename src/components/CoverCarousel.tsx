import React, { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { fileUrl } from '../api'

export default function CoverCarousel({ images, onRemove, onView, intervalMs = 3500 }: {
  images: { url: string; category?: string }[]
  onRemove: (url: string) => void
  onView?: (image: { url: string; category?: string }) => void
  intervalMs?: number
}) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (active >= images.length) setActive(0)
  }, [images.length, active])

  useEffect(() => {
    if (images.length < 2) return
    const t = setInterval(() => setActive((i) => (i + 1) % images.length), intervalMs)
    return () => clearInterval(t)
  }, [images.length, intervalMs])

  if (!images.length) return null
  const current = images[Math.min(active, images.length - 1)]

  return (
    <div className="group relative h-40 w-full overflow-hidden rounded-xl bg-slate-100"
      onClick={() => onView?.(current)} role={onView ? 'button' : undefined}>
      {images.map((img, i) => (
        <img key={img.url} src={fileUrl(img.url)} alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${i === active ? 'opacity-100' : 'opacity-0'}`} />
      ))}
      <button onClick={(e) => { e.stopPropagation(); onRemove(current.url) }}
        className="absolute end-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-white/90 text-rose-500 opacity-0 transition group-hover:opacity-100">
        <Trash2 size={13} />
      </button>
      {images.length > 1 && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
          {images.map((img, i) => (
            <button key={img.url} onClick={(e) => { e.stopPropagation(); setActive(i) }}
              className={`h-1.5 rounded-full transition-all ${i === active ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
