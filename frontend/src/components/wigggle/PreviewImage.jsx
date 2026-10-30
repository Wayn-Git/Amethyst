export default function PreviewImage({ src, alt = '', fill: _fill, priority: _priority, unoptimized: _unoptimized, quality: _quality, sizes: _sizes, ...props }) {
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" {...props} />
}
