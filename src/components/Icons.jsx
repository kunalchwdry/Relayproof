import React from 'react';

export default function Icon({ name, size = 16, className = '' }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true,
  };

  const glyphs = {
    brand: <><path d="M5.2 12c0-3.8 3.1-6.8 6.8-6.8 2.1 0 4 .9 5.2 2.5M18.8 12c0 3.8-3.1 6.8-6.8 6.8-2.1 0-4-.9-5.2-2.5"/><path d="M16.5 5.5v2.7h-2.8M7.5 18.5v-2.7h2.8"/><circle cx="12" cy="12" r="1.55" fill="currentColor" stroke="none"/></>,
    verify: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4M8.5 10.8l1.6 1.6 3.1-3.3"/></>,
    issue: <><path d="M12 3.8 19 7v5.2c0 4.1-2.7 6.9-7 8-4.3-1.1-7-3.9-7-8V7l7-3.2Z"/><path d="M12 8v7M8.5 11.5h7"/></>,
    archive: <><path d="M4.5 7.2h15v12.2h-15V7.2ZM3.5 4.6h17v2.6h-17V4.6Z"/><path d="M9 11.1h6M9 14.3h6"/></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
    upload: <><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v5h14v-5"/></>,
    audio: <><path d="M9 18V5l11-2v13"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/></>,
    video: <><rect x="3" y="5.5" width="13" height="13" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
    check: <path d="m5 12 4.3 4.3L19 6.8"/>,
    warning: <><path d="M12 7v5M12 16h.01"/><path d="M10.3 3.8 2.5 17.2a1.9 1.9 0 0 0 1.7 2.8h15.6a1.9 1.9 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z"/></>,
    shield: <><path d="M12 3.5 18.5 6v5c0 4.2-2.5 7.3-6.5 9.1C8 18.3 5.5 15.2 5.5 11V6L12 3.5Z"/><path d="m8.5 11.8 2.2 2.1 4.6-4.7"/></>,
    fingerprint: <><path d="M4 10.5a8 8 0 0 1 16 0M6.5 11.3a5.5 5.5 0 0 1 11 0c0 3.2-.4 5.5-1.3 7.2M9 12a3 3 0 0 1 6 0c0 3.2-.3 5.7-1.1 7.6M12 15.2c0 2-.2 3.5-.7 5"/></>,
    block: <><path d="M3.5 5.5 12 2l8.5 3.5v13L12 22l-8.5-3.5v-13Z"/><path d="m3.8 5.7 8.2 3.5 8.2-3.5M12 9.2V22"/></>,
    receipt: <><path d="M4 2.5h11l5 5v14l-2.4-1.4-2.6 1.4-3-1.4-3 1.4-2.6-1.4L4 21.5v-19Z"/><path d="M14.5 2.8v5h5M7.5 12h8M7.5 15.5h8"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></>,
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></>,
    link: <><path d="M10 13.5 14 9.5M8.2 15.3 6.8 16.7a3 3 0 0 1-4.2-4.2l4.2-4.2A3 3 0 0 1 11 8.2M15.8 8.7l1.4-1.4a3 3 0 0 1 4.2 4.2l-4.2 4.2a3 3 0 0 1-4.2.1"/></>,
  };

  return <svg {...common}>{glyphs[name] || glyphs.info}</svg>;
}
