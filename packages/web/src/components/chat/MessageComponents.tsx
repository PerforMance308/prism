import React from 'react';

// Message components

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex flex-col items-end gap-2 my-4">
      <div className="max-w-[90%] p-4 text-sm leading-relaxed bg-surface-variant rounded-xl rounded-tr-none text-on-surface">
        {content}
      </div>
      <span className="text-[10px] text-on-surface-variant uppercase tracking-widest">You</span>
    </div>
  );
}

export function InlineMd({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest.length > 0) {
    const bold = rest.match(/\*\*(.+?)\*\*/);
    const code = rest.match(/`(.+?)`/);
    const bits = [bold ? { t: 'b', m: bold, i: bold.index! } : null, code ? { t: 'c', m: code, i: code.index! } : null]
      .filter(Boolean)
      .sort((a, b) => a!.i - b!.i);
    if (bits.length === 0) {
      parts.push(rest);
      break;
    }
    const hit = bits[0]!;
    if (hit.i > 0) parts.push(rest.slice(0, hit.i));
    if (hit.t === 'b') {
      parts.push(
        <strong key={i++} className="font-semibold text-on-surface">
          {hit.m![1]}
        </strong>
      );
    } else {
      parts.push(
        <code key={i++} className="text-[11px] bg-surface-high text-primary px-1 py-0.5 rounded font-mono">
          {hit.m![1]}
        </code>
      );
    }
    rest = rest.slice(hit.i + hit.m![0].length);
  }
  return <>{parts}</>;
}

export function AssistantMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="flex flex-col items-start gap-3 my-4">
      <div className="max-w-[95%] p-5 rounded-xl rounded-tl-none bg-surface-high border-l-2 border-tertiary/40 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-tertiary/20 to-transparent" />
        <div className="text-sm leading-relaxed text-on-surface">
          {lines.map((line, i) => {
            if (line.startsWith('## ')) {
              return (
                <div key={i} className="text-sm font-semibold text-on-surface mt-3 mb-1">
                  {line.slice(3)}
                </div>
              );
            }
            if (line.startsWith('- ')) {
              return (
                <div key={i} className="pl-4 relative">
                  <span className="absolute left-0 text-tertiary">•</span>
                  <InlineMd text={line.slice(2)} />
                </div>
              );
            }
            return (
              <div key={i} className={i === 0 ? '' : 'mt-1'}>
                <InlineMd text={line} />
              </div>
            );
          })}
        </div>
      </div>
      <span className="text-[10px] text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
        <svg className="w-3 h-3 text-tertiary" fill="currentColor" viewBox="0 0 20 20">
          <path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" />
        </svg>
        OpenObs
      </span>
    </div>
  );
}

export function ErrorMessage({ content }: { content: string }) {
  return (
    <div className="my-2">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/25">
        <svg className="w-3.5 h-3.5 text-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-7.5 13A1 1 0 003.66 18h16.68a1 1 0 00.87-1.5l-7.5-13a1 1 0 00-1.74 0z" />
        </svg>
        <span className="text-xs text-error">{content}</span>
      </div>
    </div>
  );
}
