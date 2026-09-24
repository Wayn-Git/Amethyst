'use client';

import React, { useState } from 'react';
import { motion } from 'motion/react';

// Vite/React-compatible Image polyfill matching Next.js Image component interface
const Image = ({
  src,
  alt = '',
  width,
  height,
  className,
  onLoad,
  onError,
  sizes,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  sizes?: string;
  width?: number | string;
  height?: number | string;
}) => (
  <img
    src={src}
    alt={alt}
    width={width}
    height={height}
    className={className}
    onLoad={onLoad}
    onError={onError}
    sizes={sizes}
    loading="lazy"
    {...props}
  />
);

const DEFAULT_PLACEHOLDER = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260" fill="none"><rect width="400" height="260" fill="%231e1e24"/><circle cx="200" cy="105" r="28" fill="%232c2c34"/><path d="M190 105h20M200 95v20" stroke="%236e6e7c" stroke-width="2" stroke-linecap="round"/><text x="200" y="160" text-anchor="middle" fill="%238a8a9a" font-family="sans-serif" font-size="13" font-weight="500">Resource</text></svg>`;

export interface MasonryItem {
  image?: string;
  title?: string;
  description?: string;
  onClick?: (e?: React.MouseEvent) => void;
  [key: string]: any;
}

export interface MasonryGridProps {
  items: MasonryItem[];
  columns?: number;
  onSelect?: (item: any) => void;
  className?: string;
}

export function MasonryGrid({ items, columns, onSelect, className }: MasonryGridProps) {
  const [imagesLoaded, setImagesLoaded] = useState<{ [key: string]: boolean }>({});

  if (!items || items.length === 0) {
    return <div className="text-center p-4">No items to display</div>;
  }

  const getColumnCount = () => {
    if (typeof window === 'undefined') return 1;
    const width = window.innerWidth;
    if (width >= 1024) return 4;
    if (width >= 768) return 3;
    if (width >= 640) return 2;
    return 1;
  };

  return (
    <div
      style={{ columns: columns }}
      className={`${!columns ? 'columns-1 sm:columns-2 md:columns-3 lg:columns-4' : ''} gap-2 overflow-y-auto p-3 w-full ${className || 'max-w-4xl'}`}
    >
      {items.map((item, index) => {
        const columnCount = columns || getColumnCount();
        const rowIndex = Math.floor(index / columnCount);
        const imgSrc = item.image || DEFAULT_PLACEHOLDER;
        const key = item.image || `item-${index}`;

        return (
          <motion.div
            key={index}
            className="break-inside-avoid mb-4 relative group rounded-xl overflow-hidden p-1 border border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 cursor-pointer"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.5, delay: rowIndex * 0.1, ease: 'easeOut' } }}
            whileHover={{ scale: 1.05 }}
            onClick={(e) => {
              if (item.onClick) item.onClick(e);
              if (onSelect) onSelect(item);
            }}
          >
            <div className="relative w-full flex gap-1 flex-col items-start justify-start">
              {!imagesLoaded[key] && (
                <div className="absolute inset-0 w-full h-[300px] bg-neutral-500/50 animate-pulse rounded-lg" />
              )}
              <Image
                src={imgSrc}
                alt={item.title || ''}
                width={400}
                height={300}
                className={`w-full h-auto transition-transform duration-300 rounded-lg ${!imagesLoaded[key] ? 'opacity-0' : 'opacity-100'}`}
                sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                onLoad={() => setImagesLoaded((prev) => ({ ...prev, [key]: true }))}
                onError={() => setImagesLoaded((prev) => ({ ...prev, [key]: true }))}
              />
              {imagesLoaded[key] && (
                <div className="w-full">
                  <h3 className="text-sm font-medium">{item.title}</h3>
                  <p className="mt-0 text-xs text-neutral-500 line-clamp-2 overflow-hidden">{item.description}</p>
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

export default MasonryGrid;
