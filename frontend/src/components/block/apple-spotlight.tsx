'use client';

import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import {
    Activity,
    Calendar,
    ChevronRight,
    Files,
    Folder,
    Globe,
    Image as ImageIcon,
    LayoutGrid,
    Mail,
    MessageSquare,
    Music,
    Search,
    Settings,
    StickyNote,
    Terminal
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const Twitter = ({ className = 'size-5' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
        <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
    </svg>
);

export interface Shortcut {
    label: string;
    icon: React.ReactNode;
    link?: string;
    onClick?: () => void;
}

export interface SearchResult {
    icon: React.ReactNode;
    label: string;
    description: string;
    link?: string;
    onClick?: () => void;
}

export const SVGFilter = () => (
    <svg width="0" height="0" className="absolute pointer-events-none">
        <filter id="blob">
            <feGaussianBlur stdDeviation="10" in="SourceGraphic" />
            <feColorMatrix
                values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -9"
                result="blob"
            />
            <feBlend in="SourceGraphic" in2="blob" />
        </filter>
    </svg>
);

export const ShortcutButton = ({
    icon,
    link = '#',
    label,
    onClick
}: {
    icon: React.ReactNode;
    link?: string;
    label: string;
    onClick?: () => void;
}) => {
    const handleClick = (e: React.MouseEvent) => {
        if (onClick) {
            e.preventDefault();
            onClick();
        } else if (link === '#' || !link) {
            e.preventDefault();
        }
    };

    return (
        <a
            href={link}
            target={link !== '#' && link.startsWith('http') ? '_blank' : undefined}
            rel={link !== '#' && link.startsWith('http') ? 'noopener noreferrer' : undefined}
            aria-label={label}
            onClick={handleClick}
            className="block"
        >
            <div className="rounded-full cursor-pointer hover:shadow-lg opacity-40 hover:opacity-100 transition-[opacity,shadow,transform] duration-200 hover:scale-105 bg-neutral-200/60 dark:bg-neutral-800/80 backdrop-blur-md p-0.5">
                <div className="size-16 aspect-square flex items-center justify-center text-neutral-800 dark:text-neutral-100">
                    {icon}
                </div>
            </div>
        </a>
    );
};

export const SpotlightPlaceholder = ({ text, className }: { text: string; className?: string }) => (
    <motion.div layout className={cn('absolute text-gray-400 dark:text-neutral-500 flex items-center pointer-events-none z-10 select-none', className)}>
        <AnimatePresence mode="popLayout">
            <motion.p
                layoutId={`placeholder-${text}`}
                key={`placeholder-${text}`}
                initial={{ opacity: 0, y: 10, filter: 'blur(5px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, filter: 'blur(5px)' }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
            >
                {text}
            </motion.p>
        </AnimatePresence>
    </motion.div>
);

export const SpotlightInput = ({
    placeholder,
    hidePlaceholder,
    value,
    onChange,
    onKeyDown,
    placeholderClassName,
    inputRef: externalRef
}: {
    placeholder: string;
    hidePlaceholder: boolean;
    value: string;
    onChange: (value: string) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    placeholderClassName?: string;
    inputRef?: React.RefObject<HTMLInputElement | null>;
}) => {
    const internalRef = useRef<HTMLInputElement>(null);
    const ref = externalRef || internalRef;

    useEffect(() => {
        ref.current?.focus();
    }, [ref]);

    return (
        <div className="flex items-center w-full justify-start gap-3 px-6 h-16">
            <motion.div layoutId="search-icon" className="text-neutral-500 dark:text-neutral-400 flex items-center">
                <Search className="size-6" />
            </motion.div>
            <div className="flex-1 relative text-xl font-normal">
                {!hidePlaceholder && <SpotlightPlaceholder text={placeholder} className={placeholderClassName} />}
                <motion.input
                    ref={ref}
                    layout="position"
                    type="text"
                    aria-label="Search shortcuts"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    className="w-full bg-transparent outline-none ring-none text-neutral-900 dark:text-neutral-100 placeholder:text-transparent"
                />
            </div>
        </div>
    );
};

export const SearchResultCard = ({
    icon,
    label,
    description,
    link = '#',
    isLast,
    onClick
}: SearchResult & { isLast: boolean; onClick?: () => void }) => {
    const handleClick = (e: React.MouseEvent) => {
        if (onClick) {
            e.preventDefault();
            onClick();
        } else if (link === '#' || !link) {
            e.preventDefault();
        }
    };

    return (
        <a
            href={link}
            target={link !== '#' && link.startsWith('http') ? '_blank' : undefined}
            onClick={handleClick}
            className="overflow-hidden w-full group/card block text-left"
        >
            <div className={cn(
                'flex items-center justify-start gap-3 py-2.5 px-3 rounded-xl transition-all duration-150 w-full',
                'text-neutral-800 dark:text-neutral-200 hover:bg-white/80 dark:hover:bg-neutral-800/80 hover:shadow-sm cursor-pointer',
                isLast && 'rounded-b-2xl'
            )}>
                <div className="size-8 [&_svg]:stroke-[1.6] [&_svg]:size-5 aspect-square flex items-center justify-center text-neutral-600 dark:text-neutral-300">
                    {icon}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                    <p className="font-medium text-sm truncate text-neutral-900 dark:text-neutral-100">{label}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate opacity-80">{description}</p>
                </div>
                <div className="flex items-center justify-end opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 text-neutral-400">
                    <ChevronRight className="size-5" />
                </div>
            </div>
        </a>
    );
};

export const SearchResultsContainer = ({
    searchResults,
    onHover,
    onSelect
}: {
    searchResults: SearchResult[];
    onHover: (index: number | null) => void;
    onSelect?: (result: SearchResult) => void;
}) => (
    <motion.div
        layout
        onMouseLeave={() => onHover(null)}
        className="px-2 border-t border-neutral-200/60 dark:border-neutral-800/80 flex flex-col bg-neutral-100/90 dark:bg-neutral-900/90 max-h-96 overflow-y-auto w-full py-2"
    >
        {searchResults.map((result, index) => (
            <motion.div
                key={`search-result-${index}`}
                onMouseEnter={() => onHover(index)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: index * 0.05, duration: 0.2, ease: 'easeOut' }}
            >
                <SearchResultCard
                    {...result}
                    isLast={index === searchResults.length - 1}
                    onClick={() => {
                        if (result.onClick) result.onClick();
                        if (onSelect) onSelect(result);
                    }}
                />
            </motion.div>
        ))}
    </motion.div>
);

export interface AppleSpotlightProps {
    shortcuts?: Shortcut[];
    searchResults?: SearchResult[];
    isOpen?: boolean;
    handleClose?: () => void;
    value?: string;
    onChange?: (value: string) => void;
    onSelectResult?: (result: SearchResult) => void;
    placeholder?: string;
    className?: string;
    children?: React.ReactNode;
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
    { label: 'Apps', icon: <LayoutGrid className="size-6" />, link: '#' },
    { label: 'Files', icon: <Folder className="size-6" />, link: '#' },
    { label: 'Actions', icon: <Activity className="size-6" />, link: '#' },
    { label: 'Clipboard', icon: <Files className="size-6" />, link: '#' }
];

export const DEFAULT_SEARCH_RESULTS: SearchResult[] = [
    { icon: <Twitter className="size-5" />, label: 'Twitter', description: 'Open Twitter', link: '#' },
    { icon: <Globe className="size-5" />, label: 'Safari', description: 'Open web browser', link: '#' },
    { icon: <Mail className="size-5" />, label: 'Mail', description: 'Open Mail', link: '#' },
    { icon: <Calendar className="size-5" />, label: 'Calendar', description: 'View calendar', link: '#' },
    { icon: <StickyNote className="size-5" />, label: 'Notes', description: 'Open Notes', link: '#' },
    { icon: <ImageIcon className="size-5" />, label: 'Photos', description: 'Browse photos', link: '#' },
    { icon: <Settings className="size-5" />, label: 'Settings', description: 'Open Settings', link: '#' },
    { icon: <Terminal className="size-5" />, label: 'Terminal', description: 'Open Terminal', link: '#' },
    { icon: <Folder className="size-5" />, label: 'Finder', description: 'Open Finder', link: '#' },
    { icon: <MessageSquare className="size-5" />, label: 'Messages', description: 'Open Messages', link: '#' },
    { icon: <Music className="size-5" />, label: 'Music', description: 'Open Music', link: '#' }
];

export function AppleSpotlight({
    shortcuts = DEFAULT_SHORTCUTS,
    searchResults = DEFAULT_SEARCH_RESULTS,
    isOpen = true,
    handleClose = () => { },
    value: controlledValue,
    onChange: controlledOnChange,
    onSelectResult,
    placeholder: customPlaceholder,
    className,
    children
}: AppleSpotlightProps) {
    const [hovered, setHovered] = useState(false);
    const [hoveredSearchResult, setHoveredSearchResult] = useState<number | null>(null);
    const [hoveredShortcut, setHoveredShortcut] = useState<number | null>(null);
    const [internalValue, setInternalValue] = useState('');

    const searchValue = controlledValue !== undefined ? controlledValue : internalValue;
    const setSearchValue = controlledOnChange || setInternalValue;

    const currentResults = searchResults && searchResults.length > 0 ? searchResults : DEFAULT_SEARCH_RESULTS;

    const computedPlaceholder =
        hoveredShortcut !== null && shortcuts[hoveredShortcut]
            ? shortcuts[hoveredShortcut].label
            : hoveredSearchResult !== null && currentResults[hoveredSearchResult]
            ? currentResults[hoveredSearchResult].label
            : customPlaceholder || 'Search';

    return (
        <AnimatePresence mode="wait">
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, filter: 'blur(20px)', scaleX: 1.3, scaleY: 1.1, y: -10 }}
                    animate={{ opacity: 1, filter: 'blur(0px)', scaleX: 1, scaleY: 1, y: 0 }}
                    exit={{ opacity: 0, filter: 'blur(20px)', scaleX: 1.3, scaleY: 1.1, y: 10 }}
                    transition={{ stiffness: 550, damping: 50, type: 'spring' }}
                    className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4"
                    onClick={handleClose}
                >
                    <SVGFilter />
                    <div
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => { setHovered(false); setHoveredShortcut(null); }}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                            'w-full flex items-center justify-end gap-3 z-20 group relative',
                            '[&_svg]:stroke-[1.4]',
                            'max-w-3xl',
                            className
                        )}
                    >
                        <AnimatePresence mode="popLayout">
                            <motion.div
                                layoutId="search-input-container"
                                transition={{ layout: { duration: 0.5, type: 'spring', bounce: 0.2 } }}
                                style={{ borderRadius: '30px' }}
                                className="h-full w-full flex flex-col items-center justify-start z-10 relative shadow-2xl overflow-hidden border border-neutral-200/80 dark:border-neutral-800/90 bg-neutral-100/85 dark:bg-neutral-900/85 backdrop-blur-2xl text-neutral-900 dark:text-neutral-100"
                            >
                                <SpotlightInput
                                    placeholder={computedPlaceholder}
                                    placeholderClassName={hoveredSearchResult !== null ? 'text-neutral-900 dark:text-white font-medium' : 'text-neutral-400 dark:text-neutral-500'}
                                    hidePlaceholder={!(hoveredSearchResult !== null || !searchValue)}
                                    value={searchValue}
                                    onChange={setSearchValue}
                                />
                                {children ? (
                                    children
                                ) : (
                                    searchValue && (
                                        <SearchResultsContainer
                                            searchResults={currentResults}
                                            onHover={setHoveredSearchResult}
                                            onSelect={onSelectResult}
                                        />
                                    )
                                )}
                            </motion.div>
                            {hovered && !searchValue && shortcuts.map((shortcut, index) => (
                                <motion.div
                                    key={`shortcut-${index}`}
                                    onMouseEnter={() => setHoveredShortcut(index)}
                                    layout
                                    initial={{ scale: 0.7, x: -1 * (64 * (index + 1)) }}
                                    animate={{ scale: 1, x: 0 }}
                                    exit={{ scale: 0.7, x: 1 * (16 * (shortcuts.length - index - 1) + 64 * (shortcuts.length - index - 1)) }}
                                    transition={{ duration: 0.8, type: 'spring', bounce: 0.2, delay: index * 0.05 }}
                                    className="rounded-full cursor-pointer flex-shrink-0"
                                >
                                    <ShortcutButton
                                        icon={shortcut.icon}
                                        link={shortcut.link}
                                        label={shortcut.label}
                                        onClick={shortcut.onClick}
                                    />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default AppleSpotlight;
